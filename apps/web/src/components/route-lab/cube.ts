import {
  BufferGeometry,
  CanvasTexture,
  Color as Paint,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  PlaneGeometry,
  Points,
  PointsMaterial,
  SRGBColorSpace,
  Scene,
  WebGLRenderer,
  type Material,
  type Object3D,
  type Texture,
} from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { formatDuration } from '../../lib/route-lab/plan';
import { casedRoute, isRound, vanClass } from '../../lib/route-lab/render';
import {
  axes,
  boxFor,
  DEFAULT_VIEW,
  hourMarks,
  onCanvas,
  pose,
  VAN_DASHES,
  type Box,
  type View,
} from '../../lib/route-lab/space-time';
import { positionAt, tracks, type Track } from '../../lib/route-lab/timeline';
import type { PlansDetail } from './app';

// The space-time cube in WebGL (ADR 0019), loaded when a visitor shows intent at the cube and once
// the Route Lab's app has its plans (boot.ts). It is a view, not a model: both plans come from the
// app on 'rl:plans', the plans the maps draw, and nothing here plans, stores or sends anything.
// One camera turns both cubes, from the angle the build's pictures were drawn at
// (lib/route-lab/space-time.ts, pose), so each canvas takes its picture's place, with the first
// plans, without a jump. It draws only when something changes: a drag, a key, the time slider, a
// new plan or a theme. Nothing moves by itself but "Play the day", which the visitor starts, which
// stops at the day's end, and which the same button pauses; under reduced motion it steps.

/** "Play the day" crosses the whole time axis in this long; from half way, in half of it. */
const PLAY_MS = 12_000;
/** Under reduced motion, Play steps half an hour a second instead of gliding. */
const STEP_SECONDS = 1800;
const STEP_MS = 1000;
/** Radians a press of an arrow key turns the cube. */
const STEP = Math.PI / 24;
/** The camera never goes under the floor, nor straight overhead, where the time axis vanishes. */
const LOWEST = 0.12;
const HIGHEST = 1.4;
/** The floor texture's width: about one and a half times a cube's canvas at a 2× pixel ratio. */
const FLOOR_PX = 1536;
/** How many of the floor texture's pixels draw one screen pixel of a map's stroke. */
const FLOOR_STROKE = 3;
const PLAY = 'Play the day';
const PAUSE = 'Pause';

type Which = 'before' | 'after';

/** What a plan puts in one cube: its tracks, and the "now" marks moved as time changes. */
interface Drawn {
  readonly group: Group;
  readonly tracks: readonly Track[];
  readonly level: Group;
  readonly vans: readonly { drop: LineSegments; dot: Points }[];
}

interface Stage {
  readonly which: Which;
  readonly label: string;
  readonly host: HTMLElement;
  /** The element that holds the picture, then the canvas: the one stop for Tab, from the first
   *  paint (boot.ts), named for what it shows, and the one the arrow keys turn. */
  readonly frame: HTMLElement;
  readonly picture: SVGSVGElement;
  readonly canvas: HTMLCanvasElement;
  readonly marks: HTMLUListElement;
  readonly back: HTMLElement | null;
  readonly renderer: WebGLRenderer;
  readonly scene: Scene;
  readonly camera: OrthographicCamera;
  /** Width over height, the picture's, so the canvas takes exactly its room. */
  readonly aspect: number;
  /** The canvas's CSS size, from the ResizeObserver: no layout is read while drawing. */
  size: { width: number; height: number };
  drawn: Drawn | null;
  floor: Mesh | null;
  /** Each material a plan draws with, by role and van, kept for the theme's life: a plan with
   *  fewer vans never frees one, so the next plan never makes the GPU compile it again. */
  readonly materials: Map<string, Material>;
}

const LABELS: Record<Which, string> = {
  before: 'As the orders came in',
  after: 'Planned by VROOM',
};

/** Starts the cube, or returns false and leaves the pictures as they are when this browser cannot
 *  draw WebGL. Call it once the app has started: the canvases replace the pictures with the first
 *  plans the app sends. */
export function start(root: HTMLElement): boolean {
  const found = root.querySelector<HTMLElement>('[data-rl-cube]');
  if (!found) return false;
  const section: HTMLElement = found;
  const $ = <T extends Element>(selector: string) => section.querySelector<T>(selector);
  const slider = $<HTMLInputElement>('[data-rl-cube-time]');
  const clock = $<HTMLElement>('[data-rl-cube-clock]');
  const play = $<HTMLButtonElement>('[data-rl-cube-play]');
  const reset = $<HTMLButtonElement>('[data-rl-cube-reset]');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  // Every listener and observer this module adds, so a lost context can take them all away.
  const life = new AbortController();
  const { signal } = life;
  const observers: { disconnect(): void }[] = [];

  // Colors are the theme's tokens, read where the page sets them (tokens.css owns every value).
  // WebGL takes numbers, and three.js does not read the tokens' OKLCH, so a one-pixel canvas turns
  // each CSS color into sRGB.
  const probe = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  const rgbOf = (css: string): Paint => {
    const out = new Paint();
    if (!probe) return out;
    probe.clearRect(0, 0, 1, 1);
    probe.fillStyle = css;
    probe.fillRect(0, 0, 1, 1);
    const [r = 0, g = 0, b = 0] = probe.getImageData(0, 0, 1, 1).data;
    return out.setRGB(r / 255, g / 255, b / 255, SRGBColorSpace);
  };
  const token = (name: string) => getComputedStyle(root).getPropertyValue(name).trim();

  const stages: Stage[] = [];
  for (const host of section.querySelectorAll<HTMLElement>('[data-rl-cube-plan]')) {
    const which = host.dataset['rlCubePlan'] as Which;
    const picture = host.querySelector<SVGSVGElement>('[data-rl-cube-picture]');
    const marks = host.querySelector<HTMLUListElement>('[data-rl-cube-marks]');
    const frame = host.querySelector<HTMLElement>('[data-rl-cube-stage]');
    if (!picture || !marks || !frame) continue;
    const canvas = document.createElement('canvas');
    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
    } catch {
      for (const s of stages) s.renderer.dispose();
      return false;
    }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    const [, , w = 1, h = 1] = (picture.getAttribute('viewBox') ?? '').split(' ').map(Number);
    // The picture's own ratio, not the one the canvas's whole pixels round to, so the canvas is as
    // tall as the picture it replaces at any width: at the rail's widths (ADR 0021) the rounded one
    // moved everything below by a pixel. A CSSOM property, which the page policy allows.
    canvas.style.aspectRatio = `${w} / ${h}`;
    stages.push({
      which,
      label: LABELS[which],
      host,
      frame,
      picture,
      canvas,
      marks,
      back: host.querySelector('[data-rl-cube-back]'),
      renderer,
      scene: new Scene(),
      camera: new OrthographicCamera(),
      aspect: w / h,
      size: { width: 0, height: 0 },
      drawn: null,
      floor: null,
      materials: new Map(),
    });
  }
  if (stages.length === 0) return false;
  // What the build wrote under each cube, put back if the scene goes.
  const captions = stages.map((s) => s.back?.textContent ?? '');

  let view: View = DEFAULT_VIEW;
  let box: Box | null = null;
  let time = Number(slider?.value ?? 0);
  let latest: PlansDetail | null = null;
  let swapped = false;
  let dead = false;
  let playing: { from: number; at: number; frame: number; timer: number } | null = null;
  let wantPlay = false;
  /** Groups a new plan replaced: their geometry is freed after the next draw. Their materials are
   *  the stage's own and stay (Stage.materials). */
  let retired: Object3D[] = [];

  function draw(stage: Stage) {
    if (!box || stage.size.width === 0) return; // no plans yet, or the plan a phone does not show
    const at = pose(view, box, stage.aspect);
    const { back } = axes(view);
    const far = 4 * Math.max(box.width, box.depth);
    const camera = stage.camera;
    camera.left = -at.half.w;
    camera.right = at.half.w;
    camera.top = at.half.h;
    camera.bottom = -at.half.h;
    camera.near = 0;
    camera.far = 2 * far;
    const [tx, ty, tz] = at.target;
    camera.position.set(tx + back[0] * far, ty + back[1] * far, tz + back[2] * far);
    camera.up.set(0, 1, 0);
    camera.lookAt(tx, ty, tz);
    camera.updateProjectionMatrix();
    stage.renderer.render(stage.scene, camera);
    // The hour labels, where the scene draws each mark on the bakery's pillar.
    const bakery = latest?.data.points[0] ?? { x: 0, y: 0 };
    const items = stage.marks.children;
    hourMarks(box).forEach((s, k) => {
      const li = items[k] as HTMLElement | undefined;
      if (!li || !box) return;
      const [x, y] = onCanvas(view, box, at, [bakery.x, s * box.scale, bakery.y]);
      li.style.left = `${x * stage.size.width}px`;
      li.style.top = `${y * stage.size.height}px`;
    });
  }

  function drawAll() {
    if (dead) return;
    stages.forEach(draw);
    for (const object of retired)
      object.traverse((child) => (child as Partial<Mesh>).geometry?.dispose());
    retired = [];
  }

  /** The stage's material for a role, made the first time it is asked for. */
  function made<T extends Material>(stage: Stage, key: string, make: () => T): T {
    let material = stage.materials.get(key) as T | undefined;
    if (!material) {
      material = make();
      stage.materials.set(key, material);
    }
    return material;
  }

  /** Frees a stage's materials, their textures with them: a theme change recolors everything. */
  function forget(stage: Stage) {
    for (const m of stage.materials.values()) {
      (m as MeshBasicMaterial).map?.dispose();
      (m as MeshBasicMaterial).alphaMap?.dispose();
      m.dispose();
    }
    stage.materials.clear();
  }

  /** The map's floor, painted once per theme from the page's own basemap and shared by both
   *  cubes: Path2D reads the SVG path data the maps draw from (#rl-base), with each shape's own
   *  fill rule and the theme's colors, so there is no second copy of the map. */
  let floorCanvas: HTMLCanvasElement | null = null;
  function paintFloor(b: Box): HTMLCanvasElement {
    if (floorCanvas) return floorCanvas;
    const canvas = document.createElement('canvas');
    canvas.width = FLOOR_PX;
    canvas.height = Math.round((FLOOR_PX * b.depth) / b.width);
    const ctx = canvas.getContext('2d');
    const k = canvas.width / b.width;
    if (ctx) {
      ctx.fillStyle = token('--background');
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.scale(k, k);
      for (const path of document.querySelectorAll<SVGPathElement>('#rl-base path')) {
        const style = getComputedStyle(path);
        const shape = new Path2D(path.getAttribute('d') ?? '');
        if (style.fill !== 'none') {
          ctx.fillStyle = style.fill;
          ctx.fill(shape, style.fillRule === 'evenodd' ? 'evenodd' : 'nonzero');
        }
        if (style.stroke !== 'none') {
          ctx.strokeStyle = style.stroke;
          // The maps' strokes are screen pixels; the floor is drawn smaller than a map, so they
          // are drawn a few texture pixels wide here.
          const px = (value: string) => ((parseFloat(value) || 0) * FLOOR_STROKE) / k;
          ctx.lineWidth = px(style.strokeWidth) || FLOOR_STROKE / k;
          ctx.setLineDash(
            style.strokeDasharray === 'none' ? [] : style.strokeDasharray.split(/[\s,]+/).map(px),
          );
          ctx.lineCap = style.strokeLinecap as CanvasLineCap;
          ctx.stroke(shape);
        }
      }
    }
    floorCanvas = canvas;
    return canvas;
  }

  function floorMesh(stage: Stage, b: Box): Mesh {
    const texture = new CanvasTexture(paintFloor(b));
    texture.colorSpace = SRGBColorSpace;
    texture.anisotropy = stage.renderer.capabilities.getMaxAnisotropy();
    const geometry = new PlaneGeometry(b.width, b.depth);
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(b.width / 2, -0.5, b.depth / 2);
    return new Mesh(geometry, new MeshBasicMaterial({ map: texture }));
  }

  /** A round mark for the vans whose map stops are circles: a disc the points cut out. */
  let disc: HTMLCanvasElement | null = null;
  function discTexture(): Texture {
    if (!disc) {
      disc = document.createElement('canvas');
      disc.width = disc.height = 64;
      const ctx = disc.getContext('2d');
      if (ctx) {
        ctx.fillStyle = 'white';
        ctx.beginPath();
        ctx.arc(32, 32, 30, 0, 2 * Math.PI);
        ctx.fill();
      }
    }
    return new CanvasTexture(disc);
  }

  const dots = (stage: Stage, van: number, size: number) =>
    made(
      stage,
      `dots-${van}-${size}`,
      () =>
        new PointsMaterial({
          color: rgbOf(token(`--map-van-${vanClass(van)}`)),
          size,
          sizeAttenuation: false,
          ...(isRound(van) ? { alphaMap: discTexture(), alphaTest: 0.5, transparent: true } : {}),
        }),
    );

  /** Line segments through `points`, in a token's color, with the stage's material for `key`. */
  function segments(
    stage: Stage,
    key: string,
    points: number[],
    css: string,
    opacity = 1,
  ): LineSegments {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(points, 3));
    return new LineSegments(
      geometry,
      made(
        stage,
        key,
        () =>
          new LineBasicMaterial({ color: rgbOf(token(css)), transparent: opacity < 1, opacity }),
      ),
    );
  }

  /** A rectangle at height y over the whole floor, as line segments. */
  const rim = (w: number, d: number, y: number) => [
    ...[0, y, 0, w, y, 0],
    ...[w, y, 0, w, y, d],
    ...[w, y, d, 0, y, d],
    ...[0, y, d, 0, y, 0],
  ];

  /** Everything that follows from a plan: the box, the bakery's pillar and its hour marks, each
   *  van's track with its stops, and the "now" level with a mark per van. */
  function build(stage: Stage, plan: PlansDetail['dealt'], detail: PlansDetail, b: Box) {
    if (stage.drawn) {
      stage.scene.remove(stage.drawn.group);
      retired.push(stage.drawn.group);
    }
    if (!stage.floor) {
      stage.floor = floorMesh(stage, b);
      stage.scene.add(stage.floor);
    }
    const group = new Group();
    const top = b.seconds * b.scale;
    const bakery = detail.data.points[0] ?? { x: 0, y: 0 };
    const { width: w, depth: d } = b;
    group.add(segments(stage, 'edge', rim(w, d, 0), '--input'));
    // The box's top at the last hour and its four upright edges, fainter than the floor's.
    const cage = rim(w, d, top);
    for (const [x, z] of [
      [0, 0],
      [w, 0],
      [w, d],
      [0, d],
    ] as const)
      cage.push(x, 0, z, x, top, z);
    group.add(segments(stage, 'cage', cage, '--input', 0.55));
    const tick = 0.012 * Math.max(w, d);
    const axis = [bakery.x, 0, bakery.y, bakery.x, top, bakery.y];
    for (const s of hourMarks(b)) {
      const y = s * b.scale;
      axis.push(bakery.x - tick, y, bakery.y, bakery.x + tick, y, bakery.y);
    }
    group.add(segments(stage, 'axis', axis, '--foreground'));

    const planned = tracks(detail.data, detail.leg, plan);
    for (const track of planned) {
      const positions: number[] = [];
      for (let k = 0; k < track.points.length; k += 3)
        positions.push(
          track.points[k] ?? 0,
          (track.points[k + 2] ?? 0) * b.scale,
          track.points[k + 1] ?? 0,
        );
      const geometry = new LineGeometry();
      geometry.setPositions(positions);
      const dash = VAN_DASHES[track.van] ?? null;
      // Van A's line runs on a casing in the desk's colour, as on the maps (route-lab.css): drawn
      // first and writing no depth, so every other line is drawn over it, as the maps paint them.
      if (casedRoute(track.van)) {
        const casing = new Line2(
          geometry,
          made(
            stage,
            'casing',
            () =>
              new LineMaterial({
                color: rgbOf(token('--map-water')).getHex(),
                linewidth: 6,
                worldUnits: false,
                depthWrite: false,
              }),
          ),
        );
        casing.renderOrder = -1;
        group.add(casing);
      }
      const line = new Line2(
        geometry,
        made(
          stage,
          `line-${track.van}`,
          () =>
            new LineMaterial({
              color: rgbOf(token(`--rl-route-${vanClass(track.van)}`)).getHex(),
              linewidth: 3,
              worldUnits: false,
              dashed: dash !== null,
              dashSize: dash?.[0] ?? 1,
              gapSize: dash?.[1] ?? 1,
            }),
        ),
      );
      if (dash) line.computeLineDistances();
      group.add(line);
      const stops = new BufferGeometry();
      stops.setAttribute(
        'position',
        new Float32BufferAttribute(
          track.stops.flatMap((s) => [s.x, s.arrives * b.scale, s.y]),
          3,
        ),
      );
      group.add(new Points(stops, dots(stage, track.van, 8)));
    }

    // "Now": made once per plan, then only moved as time changes.
    const level = new Group();
    const sheet = new PlaneGeometry(w, d);
    sheet.rotateX(-Math.PI / 2);
    sheet.translate(w / 2, 0, d / 2);
    level.add(
      new Mesh(
        sheet,
        made(
          stage,
          'level',
          () =>
            new MeshBasicMaterial({
              color: rgbOf(token('--foreground')),
              transparent: true,
              opacity: 0.07,
              depthWrite: false,
              side: DoubleSide,
            }),
        ),
      ),
    );
    level.add(segments(stage, 'level-edge', rim(w, d, 0), '--foreground', 0.5));
    group.add(level);
    const vans = planned.map((track) => {
      const css = `--map-van-${vanClass(track.van)}`;
      const drop = segments(stage, `drop-${track.van}`, [0, 0, 0, 0, 0, 0], css, 0.6);
      const at = new BufferGeometry();
      at.setAttribute('position', new Float32BufferAttribute([0, 0, 0], 3));
      const dot = new Points(at, dots(stage, track.van, 14));
      group.add(drop, dot);
      return { drop, dot };
    });
    stage.drawn = { group, tracks: planned, level, vans };
    stage.scene.add(group);

    // The marks' labels: one per hour, placed on every draw.
    stage.marks.replaceChildren(
      ...hourMarks(b).map((s) => {
        const li = document.createElement('li');
        li.textContent = `${s / 3600} h`;
        return li;
      }),
    );

    const back = Math.max(0, ...planned.map((t) => t.back));
    const stale = stage.which === 'after' && !detail.fresh ? ', for the previous orders' : '';
    if (stage.back) stage.back.textContent = `Last van back after ${formatDuration(back)}${stale}`;
    stage.frame.setAttribute(
      'aria-label',
      `${stage.label}${stale}, in time: the map lies flat, time rises from it, and each van’s line climbs as its day goes on. The last van is back after ${formatDuration(back)}.`,
    );
  }

  /** Moves "now" to the slider's time: the level, and each van's mark and its line down to the
   *  map. Hidden at time 0, when every van is at the bakery. */
  function moment(stage: Stage) {
    const drawn = stage.drawn;
    if (!drawn || !box) return;
    const y = time * box.scale;
    drawn.level.visible = time > 0;
    drawn.level.position.y = y;
    drawn.tracks.forEach((track, k) => {
      const marks = drawn.vans[k];
      if (!marks) return;
      const [x, z] = positionAt(track, time);
      const drop = marks.drop.geometry.getAttribute('position');
      drop.setXYZ(0, x, 0, z);
      drop.setXYZ(1, x, y, z);
      drop.needsUpdate = true;
      marks.drop.geometry.computeBoundingSphere();
      const dot = marks.dot.geometry.getAttribute('position');
      dot.setXYZ(0, x, y, z);
      dot.needsUpdate = true;
      marks.dot.geometry.computeBoundingSphere();
      marks.drop.visible = marks.dot.visible = time > 0;
    });
  }

  function setTime(seconds: number) {
    time = Math.max(0, Math.min(box?.seconds ?? 0, seconds));
    if (slider) {
      slider.value = String(Math.round(time));
      slider.setAttribute('aria-valuetext', formatDuration(time));
    }
    if (clock) clock.textContent = formatDuration(time);
    stages.forEach(moment);
    drawAll();
  }

  function plans(detail: PlansDetail) {
    latest = detail;
    const longest = Math.max(
      ...[detail.dealt, detail.solved].flatMap((plan) =>
        tracks(detail.data, detail.leg, plan).map((t) => t.back),
      ),
      0,
    );
    const seconds = box?.seconds;
    box = boxFor(detail.data.viewBox, longest);
    if (slider) slider.max = String(box.seconds);
    for (const stage of stages)
      build(stage, stage.which === 'before' ? detail.dealt : detail.solved, detail, box);
    if (!swapped) swap();
    // A plan that changes the time axis while the day plays: carry on from where it stands.
    if (playing && seconds !== box.seconds) {
      playing.from = Math.min(time, box.seconds);
      playing.at = performance.now();
    }
    setTime(time);
    if (wantPlay) {
      wantPlay = false;
      go();
    }
  }

  // The app sends its plans on every redraw, inside the handler of the change that caused it; the
  // cube builds them on the next frame, once, however many arrived, so the change answers first.
  let pending: PlansDetail | null = null;
  root.addEventListener(
    'rl:plans',
    (event) => {
      const first = pending === null;
      pending = (event as CustomEvent<PlansDetail>).detail;
      if (first)
        requestAnimationFrame(() => {
          const detail = pending;
          pending = null;
          if (detail && !dead) plans(detail);
        });
    },
    { signal },
  );

  /** The canvas takes the picture's place, with the first plans: the picture leaves the page's
   *  tree, the frame round both carries the name, and both have one aspect, so nothing below
   *  moves. */
  function swap() {
    swapped = true;
    for (const stage of stages) {
      stage.picture.after(stage.canvas);
      stage.picture.setAttribute('hidden', '');
      // The frame's name was the picture's; from here it is the plan's on show (build, above).
      stage.frame.removeAttribute('aria-labelledby');
      stage.marks.hidden = false;
      const observer = new ResizeObserver(() => {
        const width = stage.canvas.parentElement?.clientWidth ?? 0;
        stage.size = { width, height: width / stage.aspect };
        if (width === 0 || dead) return;
        stage.renderer.setSize(width, width / stage.aspect, false);
        draw(stage);
      });
      observer.observe(stage.host);
      observers.push(observer);
      stage.canvas.addEventListener('webglcontextlost', fallBack, { signal });
    }
  }

  /** A lost context: the pictures come back as the build drew them, with their captions, and the
   *  cube's controls hide; nothing here listens any more. */
  function fallBack() {
    if (dead) return;
    stop();
    dead = true;
    life.abort();
    for (const observer of observers) observer.disconnect();
    stages.forEach((stage, k) => {
      stage.canvas.remove();
      stage.marks.hidden = true;
      stage.picture.removeAttribute('hidden');
      stage.frame.removeAttribute('aria-label');
      if (stage.back) stage.back.textContent = captions[k] ?? '';
      stage.renderer.dispose();
    });
    hideControls(section);
  }

  // Turning: a drag sideways turns both cubes; with a mouse, a drag up or down tilts them. A
  // finger's drag up or down scrolls the page instead (touch-action: pan-y in route-lab.css).
  let drag: { x: number; y: number; view: View; id: number } | null = null;
  const turn = (to: View) => {
    view = {
      azimuth: to.azimuth,
      elevation: Math.max(LOWEST, Math.min(HIGHEST, to.elevation)),
    };
    drawAll();
  };
  for (const stage of stages) {
    const canvas = stage.canvas;
    canvas.addEventListener(
      'pointerdown',
      (event) => {
        if (event.button !== 0) return;
        drag = { x: event.clientX, y: event.clientY, view, id: event.pointerId };
        canvas.setPointerCapture(event.pointerId);
      },
      { signal },
    );
    canvas.addEventListener(
      'pointermove',
      (event) => {
        if (!drag || event.pointerId !== drag.id) return;
        const tilt = event.pointerType === 'mouse' ? (event.clientY - drag.y) * 0.006 : 0;
        turn({
          azimuth: drag.view.azimuth - (event.clientX - drag.x) * 0.008,
          elevation: drag.view.elevation + tilt,
        });
      },
      { signal },
    );
    const end = () => {
      drag = null;
    };
    canvas.addEventListener('pointerup', end, { signal });
    canvas.addEventListener('pointercancel', end, { signal });
    stage.frame.addEventListener(
      'keydown',
      (event) => {
        const moves: Record<string, View> = {
          ArrowLeft: { ...view, azimuth: view.azimuth + STEP },
          ArrowRight: { ...view, azimuth: view.azimuth - STEP },
          ArrowUp: { ...view, elevation: view.elevation + STEP },
          ArrowDown: { ...view, elevation: view.elevation - STEP },
          Home: DEFAULT_VIEW,
        };
        const next = moves[event.key];
        if (!next) return;
        event.preventDefault();
        turn(next);
      },
      { signal },
    );
  }
  reset?.addEventListener('click', () => turn(DEFAULT_VIEW), { signal });

  slider?.addEventListener(
    'input',
    () => {
      stop();
      setTime(Number(slider.value));
    },
    { signal },
  );

  // "Play the day": the slider crosses the whole time axis in PLAY_MS, from where it stands, or
  // from the start when it is at the end; under reduced motion it steps half an hour a second.
  // The same button pauses it (SC 2.2.2), and its words say what a press does.
  function stop() {
    if (playing) {
      cancelAnimationFrame(playing.frame);
      clearTimeout(playing.timer);
    }
    playing = null;
    wantPlay = false;
    if (play) play.textContent = PLAY;
  }
  function go() {
    if (playing || dead) return;
    if (play) play.textContent = PAUSE;
    if (!box) {
      wantPlay = true; // the first plans start it
      return;
    }
    if (time >= box.seconds) setTime(0);
    playing = { from: time, at: performance.now(), frame: 0, timer: 0 };
    if (reduced.matches) {
      const tick = () => {
        if (!playing || !box) return;
        setTime(Math.min(box.seconds, (Math.floor(time / STEP_SECONDS) + 1) * STEP_SECONDS));
        if (time >= box.seconds) return stop();
        playing.timer = window.setTimeout(tick, STEP_MS);
      };
      playing.timer = window.setTimeout(tick, STEP_MS);
      return;
    }
    const glide = (now: number) => {
      if (!playing || !box) return;
      const t = playing.from + ((now - playing.at) / PLAY_MS) * box.seconds;
      setTime(t);
      if (t >= box.seconds) return stop();
      playing.frame = requestAnimationFrame(glide);
    };
    playing.frame = requestAnimationFrame(glide);
  }
  play?.addEventListener('click', () => (playing || wantPlay ? stop() : go()), { signal });

  // A theme change repaints the floor and recolors the lines from the new tokens, on the next
  // frame, after the toggle has answered.
  const repaint = () =>
    requestAnimationFrame(() => {
      if (dead) return;
      floorCanvas = null;
      for (const stage of stages) {
        if (stage.floor) {
          stage.scene.remove(stage.floor);
          retired.push(stage.floor);
          const material = stage.floor.material as MeshBasicMaterial;
          material.map?.dispose();
          material.dispose();
        }
        stage.floor = null;
        forget(stage);
      }
      if (latest) plans(latest);
    });
  const themes = new MutationObserver(repaint);
  themes.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  observers.push(themes);
  for (const query of ['(prefers-color-scheme: dark)', '(prefers-contrast: more)'])
    matchMedia(query).addEventListener('change', repaint, { signal });

  // A press of Play before the scene loaded is kept (boot.ts).
  if (play?.dataset['rlCubeWant']) {
    delete play.dataset['rlCubeWant'];
    go();
  }
  root.dispatchEvent(new Event('rl:ask'));
  return true;
}

/** Hides the cube's controls and takes the cubes out of the tab order, where nothing turns them
 *  any more: each is its picture again, named by it. Focus moves to the cube's section first if it
 *  was on one of them, so a keyboard user is not left on the page's body; the page stays where it
 *  is, since the section's top is often far above the screen, and the visitor was looking at the
 *  cube, not there. */
export function hideControls(section: HTMLElement): void {
  const parts = section.querySelectorAll<HTMLElement>('[data-rl-cube-controls]');
  const frames = section.querySelectorAll<HTMLElement>('[data-rl-cube-stage]');
  if ([...parts, ...frames].some((part) => part.contains(document.activeElement)))
    section.focus({ preventScroll: true });
  for (const part of parts) part.hidden = true;
  for (const frame of frames) {
    for (const name of ['tabindex', 'role', 'aria-labelledby', 'aria-describedby', 'aria-label'])
      frame.removeAttribute(name);
  }
}
