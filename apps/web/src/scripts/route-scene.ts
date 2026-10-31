import { dayLine } from '../lib/route-lab/format';
import {
  cameraAt,
  extent,
  fit,
  floorMatrix,
  projector,
  EDGE,
  SWAY,
  SWAY_S,
  where,
  readScene,
  type Camera,
  type SceneData,
  type SceneTrack,
} from '../lib/route-lab/scene';

// Home's scene, live (ADR 0024, ADR 0025): the Route Lab's default day driven on the city beside
// Joseph's column, the map flat and north up, edge to edge, its water the page. Each van runs
// VROOM's route with a trail behind it and each stop lights as its order is handed over. Scrolling
// to the Route Lab's chapter lifts the day off the map into the space-time cube (ADR 0019): time
// stands up, so a van that drives traces a slope and one that waits at a stop climbs straight up,
// and the camera sways slowly about the cube. Canvas 2D through the cube's own camera
// (lib/route-lab/scene.ts): lines and dots need no 3D library, and the chunk stays a few kilobytes.
//
// src/scripts/motion.js loads this once Home has painted, without a reduced-motion preference and
// without Save-Data. Until then, and wherever it cannot run, the build's picture is the scene. It
// moves for more than 5 s, so the header's button pauses it, and the board's day with it (SC
// 2.2.2); the choice lasts for the tab (sessionStorage key "motion"), as the theme's does.

/** How long the day takes to drive on screen, and how long the finished day holds before it
 *  starts again. */
export const DAY_S = 26;
export const HOLD_S = 3;
/** How much of the day a trail shows behind its van, in the day's seconds. */
export const TRAIL = 1500;
/** How long a stop's circle takes to widen and fade, in seconds on screen. */
export const PULSE_S = 1.2;
/** The finest pixel ratio it draws at, and the slowest mean frame it accepts before it sheds load:
 *  first to a ratio of 1, then to a pause, as the button would. */
export const MAX_RATIO = 1.5;
export const SLOW_MS = 14;
export const WINDOW = 90;

/** The day's clock, in its own seconds, `seconds` into the loop: the day at DAY_S, then a hold. */
export function dayClock(seconds: number, back: number): number {
  const loop = DAY_S + HOLD_S;
  const at = ((seconds % loop) + loop) % loop;
  return at >= DAY_S ? back : (at / DAY_S) * back;
}

/** How far through the stage the page has scrolled, 0 to 1, from the stage's box and the window's
 *  height: 0 while its top is at the window's, 1 once its foot is at the window's. */
export function progress(top: number, height: number, view: number): number {
  const room = height - view;
  return room <= 0 ? 0 : Math.min(1, Math.max(0, -top / room));
}

/** How far an element has come up the window, 0 to 1: 0 while its top is at the window's foot or
 *  below, 1 once its top reaches the window's top. */
export function rising(top: number, view: number): number {
  return view <= 0 ? 0 : Math.min(1, Math.max(0, 1 - top / view));
}

/** The lift for a progress: none through the first fifth, so the hero stands still while it is
 *  read, then all of it by nine tenths. */
export const liftFor = (p: number): number => Math.min(1, Math.max(0, (p - 0.2) / 0.7));

/** 0 to 1, eased at both ends, as the camera's own easing is (lib/route-lab/scene.ts, cameraAt). */
export const smooth = (x: number): number => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};

/** How far into the lift the map has moved from where the build's picture draws it into the
 *  cube's room. The cube's frame comes in only after that, so every frame of it stands inside the
 *  room, never past the window's edge while the map is still on its way. */
export const PLACED = 0.4;
/** How far into the lift the map's edges have faded in full: from the first turn of the camera,
 *  so the straight edge where its data stops never shows on the way. */
export const FADED = 0.2;

/** Where the cube's frame stands for an eased lift `k`: how far the map has moved into the room,
 *  how strong the fade at the map's edges is, and how strong the frame is. */
export function liftStages(k: number): { placed: number; faded: number; frame: number } {
  return {
    placed: smooth(k / PLACED),
    faded: smooth(k / FADED),
    frame: smooth((k - PLACED) / (1 - PLACED)),
  };
}

/** The orders handed over by day-time `t`: each stop counts once its van has arrived. */
export function served(vans: readonly SceneTrack[], t: number): number {
  let n = 0;
  for (const track of vans)
    for (let k = 2; k < track.stops.length; k += 3) if ((track.stops[k] ?? 0) <= t) n += 1;
  return n;
}

/** The next pixel ratio for a mean frame, as the living ground shed load before it. */
export function nextRatio(meanMs: number, ratio: number): number {
  if (meanMs <= SLOW_MS) return ratio;
  return ratio > 1 ? 1 : 0;
}

const KEY = 'motion';
const stored = (): boolean => {
  try {
    return sessionStorage.getItem(KEY) === 'paused';
  } catch {
    return false;
  }
};
const store = (paused: boolean): void => {
  try {
    if (paused) sessionStorage.setItem(KEY, 'paused');
    else sessionStorage.removeItem(KEY);
  } catch {
    // Storage refused: the choice lasts until the page is left.
  }
};

interface Ink {
  land: string;
  water: string;
  road: string;
  major: string;
  place: string;
  depot: string;
  rule: string;
  vans: string[];
  /** The van itself: a lit lamp on its line (tokens.css, --primary). */
  lamp: string;
  glow: boolean;
}

/** The scene's colors, as the build's picture paints them: the stylesheet's tokens, through the
 *  picture's own elements, so a theme changes both at once. */
function inkOf(picture: SVGSVGElement): Ink {
  const style = (selector: string) => {
    const el = picture.querySelector(selector);
    return el ? getComputedStyle(el) : null;
  };
  const vans = ['a', 'b', 'c', 'd'].map(
    (van) => style(`.scene-van-${van}`)?.stroke ?? style('.scene-route')?.stroke ?? 'currentcolor',
  );
  const root = getComputedStyle(document.documentElement);
  const theme = document.documentElement.dataset['theme'];
  return {
    land: style('.scene-land')?.fill ?? 'transparent',
    water: style('.scene-water')?.fill ?? 'transparent',
    road: style('.scene-road')?.stroke ?? 'transparent',
    major: style('.scene-road-major')?.stroke ?? 'transparent',
    place: style('.scene-place')?.stroke ?? 'currentcolor',
    depot: style('.scene-depot')?.stroke ?? 'currentcolor',
    rule: root.getPropertyValue('--border').trim() || 'currentcolor',
    vans,
    lamp: getComputedStyle(picture).getPropertyValue('--primary').trim() || 'currentcolor',
    // Light trails glow on the dark page; on paper they are drawn plainly.
    glow:
      theme === 'dark' ||
      (theme !== 'light' && !matchMedia('(prefers-color-scheme: light)').matches),
  };
}

/** Starts the scene on `canvas`, over the build's picture beside it. False if it cannot run. */
export async function boot(canvas: HTMLCanvasElement): Promise<boolean> {
  const root = document.documentElement;
  const figure = canvas.closest<HTMLElement>('[data-scene]');
  const picture = figure?.querySelector<SVGSVGElement>('svg.scene-picture');
  const stage = canvas.closest<HTMLElement>('[data-stage]') ?? figure;
  // The Route Lab's chapter, which lifts the day as it comes up the window, and the board, which
  // follows the chapter once the scene has left with it; and the caption's clock, in the column.
  const chapter = stage?.querySelector<HTMLElement>('[data-stage-chapter]');
  const end = stage?.querySelector<HTMLElement>('[data-board]');
  const clock = stage?.querySelector<HTMLElement>('[data-scene-clock]');
  const toggle = document.querySelector<HTMLElement>('[data-motion-toggle]');
  const ctx = canvas.getContext('2d', { alpha: true });
  const url = canvas.dataset['sceneLive'];
  if (!figure || !picture || !stage || !ctx || !url) return false;
  const response = await fetch(url).catch(() => null);
  const text = response?.ok ? await response.text().catch(() => '') : '';
  let data: SceneData | null = null;
  try {
    data = readScene(text);
  } catch {
    data = null;
  }
  if (!data?.tracks?.length) return false;
  const vans = data.tracks;
  // What the stylesheet says of the scene's box (home.css): the gutter the cube keeps inside it, in
  // pixels, and whether it stands over the column's words, as the phone's band does while it runs.
  const looks = getComputedStyle(figure);
  const inset = () => Number.parseFloat(looks.getPropertyValue('--cube-inset')) || 0;
  const over = () => looks.getPropertyValue('--over-words').trim() === '1';
  // The floor's paths come from the picture: one copy of the map on the page.
  const floor = (name: string) =>
    new Path2D(picture.querySelector(`[data-floor="${name}"]`)?.getAttribute('d') ?? '');
  const land = floor('land');
  const water = floor('water');
  const minor = floor('minor');
  const major = floor('major');

  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const dark = matchMedia('(prefers-color-scheme: dark)');
  const state = {
    paused: stored(),
    off: false,
    seen: true,
    covered: false,
    seconds: 0,
    last: 0,
    frame: 0,
    lift: 0,
    toLift: 0,
    lean: 0,
    toLean: 0,
  };
  let ratio = 1;
  let cap = MAX_RATIO;
  let ink = inkOf(picture);
  const pace = { frames: 0, ms: 0 };
  let shown = '';

  const fitCanvas = () => {
    ratio = Math.min(devicePixelRatio || 1, cap);
    const width = Math.round(canvas.clientWidth * ratio);
    const height = Math.round(canvas.clientHeight * ratio);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
  };

  /** The flat map as the build's picture draws it, in the canvas's device pixels: the picture's own
   *  mapping from the camera's units to the screen, its box and its cover fit included, so the
   *  stylesheet alone decides where the map goes, and the canvas takes over without a jump. */
  const flat = () => {
    const m = picture.getScreenCTM();
    const c = canvas.getBoundingClientRect();
    return m ? { scale: m.a * ratio, x: (m.e - c.left) * ratio, y: (m.f - c.top) * ratio } : null;
  };

  /** Where the lifted cube stands: the part of the picture's box the canvas shows, beside the
   *  words from 64rem and the band below that, kept the page's gutter inside the canvas's edges,
   *  in device pixels. */
  const room = () => {
    const c = canvas.getBoundingClientRect();
    const p = picture.getBoundingClientRect();
    const gutter = inset();
    const left = Math.max(p.left, c.left + gutter);
    const top = Math.max(p.top, c.top + gutter);
    return {
      x: (left - c.left) * ratio,
      y: (top - c.top) * ratio,
      width: Math.max(1, Math.min(p.right, c.right - gutter) - left) * ratio,
      height: Math.max(1, Math.min(p.bottom, c.bottom - gutter) - top) * ratio,
    };
  };

  const draw = () => {
    const t = dayClock(state.seconds, data.back);
    // The lift, eased: 0 for the flat map, 1 for the cube. The camera sways, and leans toward the
    // pointer, only as time stands up: flat, the city stands still beside the words.
    const lifted = cameraAt(state.lift);
    const k = lifted.lift;
    const stages = liftStages(k);
    const sway = (SWAY * Math.sin((state.seconds / SWAY_S) * 2 * Math.PI) + state.lean) * k;
    const camera: Camera = { ...lifted, azimuth: lifted.azimuth + sway };
    // Flat, the map is where the picture draws it; lifted, the cube fills the room beside the
    // words; the framing moves from one to the other over the lift's first part (PLACED), and from
    // then on the cube is fitted to the room at every turn of the camera.
    const what = extent(data.focus, data.seconds, camera);
    const pad = 0.03 * Math.max(what.width, what.height);
    const cube = fit(
      {
        x: what.x - pad,
        y: what.y - pad,
        width: what.width + 2 * pad,
        height: what.height + 2 * pad,
      },
      room(),
    );
    const map = flat() ?? cube;
    const w = stages.placed;
    const at = {
      scale: map.scale + (cube.scale - map.scale) * w,
      x: map.x + (cube.x - map.x) * w,
      y: map.y + (cube.y - map.y) * w,
    };
    const project = projector(data.focus, data.seconds, camera);
    const screen = (x: number, y: number, s: number): [number, number] => {
      const [u, v] = project(x, y, s);
      return [u * at.scale + at.x, v * at.scale + at.y];
    };
    const px = ratio;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // The floor, laid through one matrix and stroked untransformed, so lines keep their width.
    const m = new DOMMatrix(floorMatrix(data.focus, data.seconds, camera, at));
    const laid = (path: Path2D) => {
      const out = new Path2D();
      out.addPath(path, m);
      return out;
    };
    ctx.fillStyle = ink.land;
    ctx.fill(laid(land));
    ctx.fillStyle = ink.water;
    ctx.fill(laid(water));
    ctx.strokeStyle = ink.road;
    ctx.lineWidth = 0.75 * px;
    ctx.stroke(laid(minor));
    ctx.strokeStyle = ink.major;
    ctx.lineWidth = 1.25 * px;
    ctx.stroke(laid(major));
    // Flat, the map runs past the screen's edges, and its water is the page, so nothing fades it.
    // As it lifts into the cube its whole floor comes into view, and the floor fades in from the
    // map's own edges (EDGE), in full from the camera's first turn (FADED), along each axis in
    // turn, laid through the floor's matrix so the fades lie on the map: a straight edge across
    // the water would read as a slab, and the map has no edge where its data stops.
    if (k > 0) {
      const [mx0, my0, mx1, my1] = data.map;
      ctx.globalCompositeOperation = 'destination-out';
      ctx.globalAlpha = stages.faded;
      ctx.setTransform(m);
      for (const [ax, ay, bx, by] of [
        [mx0, 0, mx1, 0],
        [0, my0, 0, my1],
      ] as const) {
        const edge = ctx.createLinearGradient(ax, ay, bx, by);
        edge.addColorStop(0, ink.depot);
        edge.addColorStop(EDGE, 'transparent');
        edge.addColorStop(1 - EDGE, 'transparent');
        edge.addColorStop(1, ink.depot);
        ctx.fillStyle = edge;
        ctx.fillRect(mx0, my0, mx1 - mx0, my1 - my0);
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
    }
    ctx.globalCompositeOperation = 'source-over';

    // The cube, once time stands up and the map is in the room: its edges, and a plane at the
    // day's hour.
    if (stages.frame > 0) {
      const [x0, y0, x1, y1] = data.focus;
      const top = data.seconds;
      const corners: [number, number][] = [
        [x0, y0],
        [x1, y0],
        [x1, y1],
        [x0, y1],
      ];
      ctx.strokeStyle = ink.rule;
      ctx.globalAlpha = stages.frame;
      ctx.lineWidth = px;
      ctx.beginPath();
      for (const [x, y] of corners) {
        ctx.moveTo(...screen(x, y, 0));
        ctx.lineTo(...screen(x, y, top));
      }
      corners.forEach(([x, y], k) => ctx[k ? 'lineTo' : 'moveTo'](...screen(x, y, top)));
      ctx.closePath();
      ctx.stroke();
      ctx.globalAlpha = stages.frame * 0.9;
      ctx.strokeStyle = ink.depot;
      ctx.setLineDash([4 * px, 6 * px]);
      ctx.beginPath();
      corners.forEach(([x, y], k) => ctx[k ? 'lineTo' : 'moveTo'](...screen(x, y, t)));
      ctx.closePath();
      ctx.stroke();
      ctx.setLineDash([]);
      // The bakery's pillar, the time axis, with a tick each hour.
      const [bx, by] = data.bakery;
      ctx.globalAlpha = stages.frame;
      ctx.strokeStyle = ink.depot;
      ctx.beginPath();
      ctx.moveTo(...screen(bx, by, 0));
      ctx.lineTo(...screen(bx, by, top));
      for (let h = 3600; h <= top; h += 3600) {
        const [hx, hy] = screen(bx, by, h);
        ctx.moveTo(hx - 5 * px, hy);
        ctx.lineTo(hx + 5 * px, hy);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Every place, small; each van's whole day, faint, the way the plan will go.
    ctx.fillStyle = ink.place;
    ctx.globalAlpha = 0.55;
    const s = 3 * px;
    for (const track of vans)
      for (let k = 0; k < track.stops.length; k += 3) {
        const [x, y] = screen(track.stops[k] ?? 0, track.stops[k + 1] ?? 0, 0);
        ctx.fillRect(x - s / 2, y - s / 2, s, s);
      }
    ctx.globalAlpha = 1;
    vans.forEach((track) => {
      const color = ink.vans[track.van] ?? ink.depot;
      const p = track.points;
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.3 + 0.25 * state.lift;
      ctx.lineWidth = 1.5 * px;
      ctx.beginPath();
      for (let k = 0; k < p.length; k += 3) {
        const q = screen(p[k] ?? 0, p[k + 1] ?? 0, p[k + 2] ?? 0);
        if (k) ctx.lineTo(...q);
        else ctx.moveTo(...q);
      }
      ctx.stroke();
    });
    ctx.globalAlpha = 1;

    // Each van's trail: the last part of its day, brighter toward the van, glowing on the dark.
    if (ink.glow) ctx.globalCompositeOperation = 'lighter';
    vans.forEach((track) => {
      const color = ink.vans[track.van] ?? ink.depot;
      const p = track.points;
      const from = t - TRAIL;
      const trail: [number, number, number][] = [];
      const start = where(p, Math.max(0, from));
      trail.push([...screen(start[0], start[1], Math.max(0, from)), Math.max(0, from)]);
      for (let k = 0; k < p.length; k += 3) {
        const pt = p[k + 2] ?? 0;
        if (pt > from && pt < t) trail.push([...screen(p[k] ?? 0, p[k + 1] ?? 0, pt), pt]);
      }
      const head = where(p, t);
      const [hx, hy] = screen(head[0], head[1], Math.min(t, track.back));
      trail.push([hx, hy, t]);
      ctx.strokeStyle = color;
      for (const [width, alpha] of ink.glow
        ? ([
            [12, 0.1],
            [5, 0.22],
            [2.75, 1],
          ] as const)
        : ([[3, 1]] as const)) {
        ctx.lineWidth = width * px;
        for (let k = 1; k < trail.length; k++) {
          const a = trail[k - 1];
          const b = trail[k];
          if (!a || !b) continue;
          const age = (t - b[2]) / TRAIL;
          ctx.globalAlpha = alpha * Math.max(0, 1 - age) ** 1.6;
          ctx.beginPath();
          ctx.moveTo(a[0], a[1]);
          ctx.lineTo(b[0], b[1]);
          ctx.stroke();
        }
      }
      // The van, while it is out: a lit lamp with a halo in its line's color.
      if (t > 0 && t < track.back) {
        ctx.globalAlpha = ink.glow ? 0.28 : 0.18;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(hx, hy, 13 * px, 0, 2 * Math.PI);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = ink.lamp;
        ctx.beginPath();
        ctx.arc(hx, hy, 4.5 * px, 0, 2 * Math.PI);
        ctx.fill();
      }
      // Each stop the van has reached, in its color, with a circle widening as it arrives.
      const perDay = data.back / DAY_S;
      for (let k = 0; k < track.stops.length; k += 3) {
        const arrives = track.stops[k + 2] ?? 0;
        if (arrives > t) continue;
        const [x, y] = screen(track.stops[k] ?? 0, track.stops[k + 1] ?? 0, 0);
        ctx.globalAlpha = 1;
        ctx.fillStyle = color;
        ctx.fillRect(x - 3 * px, y - 3 * px, 6 * px, 6 * px);
        const age = (t - arrives) / perDay / PULSE_S;
        if (age < 1) {
          ctx.globalAlpha = (1 - age) * 0.9;
          ctx.lineWidth = 1.5 * px;
          ctx.beginPath();
          ctx.arc(x, y, (5 + 22 * age) * px, 0, 2 * Math.PI);
          ctx.stroke();
        }
      }
    });
    ctx.globalCompositeOperation = 'source-over';
    // The bakery, where every van starts and ends.
    const [dx, dy] = screen(data.bakery[0], data.bakery[1], 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = ink.depot;
    ctx.fillRect(dx - 4 * px, dy - 4 * px, 8 * px, 8 * px);

    // The caption counts with the clock, a few times a second at most.
    const line = dayLine(t, served(vans, t), data.orders);
    if (clock && line !== shown) {
      shown = line;
      clock.textContent = line;
    }
  };

  const ease = (value: number, target: number, rate: number, dt: number) => {
    const next = target + (value - target) * Math.exp(-rate * dt);
    return Math.abs(next - target) < 1e-3 ? target : next;
  };

  const settled = () => state.lift === state.toLift && state.lean === state.toLean;
  const running = () =>
    !state.off && (!state.paused || !settled()) && state.seen && !state.covered && !document.hidden;
  const schedule = () => {
    if (running() && !state.frame) state.frame = requestAnimationFrame(tick);
  };
  const halt = () => {
    cancelAnimationFrame(state.frame);
    state.frame = 0;
    state.last = 0;
  };

  function tick(now: number) {
    state.frame = 0;
    const dt = state.last ? Math.min((now - state.last) / 1000, 0.1) : 0;
    state.last = now;
    if (!state.paused) state.seconds += dt;
    state.lift = ease(state.lift, state.toLift, 6, dt);
    state.lean = ease(state.lean, state.toLean, 2, dt);
    const begin = performance.now();
    draw();
    if (dt && !state.paused) {
      pace.frames += 1;
      pace.ms += performance.now() - begin;
      if (pace.frames === WINDOW) {
        const next = nextRatio(pace.ms / WINDOW, ratio);
        pace.frames = 0;
        pace.ms = 0;
        // Too slow even at 1: pause, as the button would, without storing it.
        if (next === 0) {
          state.paused = true;
          show();
        } else if (next !== ratio) {
          cap = next;
          fitCanvas();
        }
      }
    }
    schedule();
  }

  // The board (components/board/Board.astro) runs the Route Lab's day too, in CSS, while this
  // scene runs and on its button (styles/board.css). It comes up the first time it is seen while
  // the day runs: until then its lamps are out. Seen while paused, it keeps its still drawing, and
  // comes up when the day plays again with the board in view. Out of the window its day waits
  // (data-away), so it runs where it is seen and never on out of sight, far from the button.
  const board = end;
  let boardInView = false;
  const comeUp = () => {
    if (board && boardInView && !state.paused && !('seen' in board.dataset))
      board.dataset['seen'] = '';
  };
  if (board)
    new IntersectionObserver(
      ([entry]) => {
        boardInView = entry?.isIntersecting ?? false;
        board.toggleAttribute('data-away', !boardInView);
        comeUp();
      },
      { threshold: 0.25 },
    ).observe(board);

  const show = () => {
    const paused = state.paused;
    root.dataset['motion'] = paused ? 'paused' : 'on';
    if (toggle) {
      const name = paused ? 'Play motion' : 'Pause motion';
      toggle.setAttribute('aria-label', name);
      toggle.title = name;
      toggle.dataset['state'] = paused ? 'paused' : 'on';
    }
    comeUp();
  };

  const stop = () => {
    state.off = true;
    halt();
    if (toggle && document.activeElement === toggle)
      document.querySelector<HTMLElement>('[data-theme-toggle]')?.focus();
    delete root.dataset['motion'];
    delete root.dataset['sceneLive'];
  };

  toggle?.addEventListener('click', () => {
    state.paused = !state.paused;
    store(state.paused);
    show();
    state.last = 0;
    schedule();
    if (state.paused && !state.frame) draw();
  });

  const scrolled = () => {
    const b = (chapter ?? stage).getBoundingClientRect();
    // The chapter rises through the part of the window the words scroll in: below the band while
    // the band stands over them (a phone), and the whole window beside the scene from 64rem.
    const from = over() ? Math.max(0, figure.getBoundingClientRect().bottom) : 0;
    state.toLift = liftFor(
      chapter ? rising(b.top - from, innerHeight - from) : progress(b.top, b.height, innerHeight),
    );
    const covered = (end?.getBoundingClientRect().top ?? Infinity) <= 0;
    if (covered !== state.covered) {
      state.covered = covered;
      if (covered) halt();
    }
    schedule();
  };
  addEventListener('scroll', scrolled, { passive: true });

  // Over the scene, the pointer turns the camera a little toward itself; a hand's own movement is
  // not motion that starts by itself, so it works while paused (SC 2.2.2).
  addEventListener(
    'pointermove',
    (event) => {
      if (event.pointerType === 'touch') return;
      const b = canvas.getBoundingClientRect();
      const inside =
        event.clientX >= b.left &&
        event.clientX <= b.right &&
        event.clientY >= b.top &&
        event.clientY <= b.bottom;
      state.toLean = inside ? ((event.clientX - b.left) / b.width - 0.5) * 0.24 : 0;
      schedule();
    },
    { passive: true },
  );

  new IntersectionObserver(([entry]) => {
    state.seen = entry?.isIntersecting ?? true;
    if (state.seen) schedule();
    else halt();
  }).observe(canvas);
  document.addEventListener('visibilitychange', () => (document.hidden ? halt() : schedule()));
  reduce.addEventListener('change', () => (reduce.matches ? stop() : start()));

  const repaint = () => {
    ink = inkOf(picture);
    if (!state.frame && !state.off) draw();
  };
  new MutationObserver(repaint).observe(root, {
    attributes: true,
    attributeFilter: ['data-theme'],
  });
  dark.addEventListener('change', repaint);

  new ResizeObserver(() => {
    if (state.off) return;
    fitCanvas();
    if (!state.frame) draw();
  }).observe(canvas);

  // Live first, so the canvas has its box and the stylesheet's rules for a running scene hold (a
  // phone's band over the words) before the lift is read and the first frame drawn; nothing paints
  // until this returns.
  function start() {
    if (reduce.matches) return;
    state.off = false;
    root.dataset['sceneLive'] = '';
    fitCanvas();
    scrolled();
    state.lift = state.toLift;
    draw();
    show();
    schedule();
  }
  start();
  return true;
}
