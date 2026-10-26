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
  type Object3D,
} from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { formatDuration } from '../../lib/route-lab/plan';
import { vanClass } from '../../lib/route-lab/render';
import {
  axes,
  boxFor,
  DEFAULT_VIEW,
  frame,
  hourMarks,
  project,
  type Box,
  type View,
} from '../../lib/route-lab/space-time';
import { positionAt, tracks, type Track } from '../../lib/route-lab/timeline';
import type { PlansDetail } from './app';

// The space-time cube in WebGL (ADR 0019), loaded when a visitor shows intent at the cube (boot.ts).
// It is a view, not a model: both plans come from the Route Lab's app on 'rl:plans', the same
// plans the maps draw, and nothing here plans, stores or sends anything. One camera turns both
// cubes, from the angle the build's pictures were drawn at (lib/route-lab/space-time.ts), so each
// canvas takes its picture's place without a jump. It draws only when something changes: a drag,
// a key, the time slider, a new plan or a theme. Nothing moves by itself but "Play the day", which
// the visitor starts, which stops at the day's end, and which the same button pauses.

/** How long "Play the day" takes from leaving to the end of the time axis. */
const PLAY_MS = 12_000;
/** Radians a press of an arrow key turns the cube. */
const STEP = Math.PI / 24;
/** The camera never goes under the floor, nor straight overhead, where the time axis vanishes. */
const LOWEST = 0.12;
const HIGHEST = 1.4;
/** How many of the floor texture's pixels draw one screen pixel of a map's stroke. */
const FLOOR_STROKE = 4;
/** Dash and gap per van, in map units, so color is never the only signal (SC 1.4.1). */
const DASHES: readonly (readonly [number, number] | null)[] = [null, [36, 18], [6, 16], [36, 14]];

type Which = 'before' | 'after';

interface Stage {
  readonly which: Which;
  readonly label: string;
  readonly host: HTMLElement;
  readonly picture: SVGSVGElement;
  readonly canvas: HTMLCanvasElement;
  readonly marks: HTMLUListElement;
  readonly back: HTMLElement | null;
  readonly renderer: WebGLRenderer;
  readonly scene: Scene;
  readonly camera: OrthographicCamera;
  /** Width over height, the picture's, so the canvas takes exactly its room. */
  readonly aspect: number;
  content: Group;
  /** The map's floor: the same for every plan, painted again only for a new theme. */
  floor: Mesh | null;
  now: Group;
  tracks: Track[];
}

const LABELS: Record<Which, string> = {
  before: 'As the orders came in',
  after: 'Planned by VROOM',
};

/** Starts the cube, or returns false and leaves the pictures as they are when this browser cannot
 *  draw WebGL. */
export function start(root: HTMLElement): boolean {
  const found = root.querySelector<HTMLElement>('[data-rl-cube]');
  if (!found) return false;
  const section: HTMLElement = found;
  const $ = <T extends Element>(selector: string) => section.querySelector<T>(selector);
  const slider = $<HTMLInputElement>('[data-rl-cube-time]');
  const clock = $<HTMLOutputElement>('[data-rl-cube-clock]');
  const play = $<HTMLButtonElement>('[data-rl-cube-play]');
  const reset = $<HTMLButtonElement>('[data-rl-cube-reset]');

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
    const holder = host.querySelector<HTMLElement>('[data-rl-cube-stage]');
    const picture = host.querySelector<SVGSVGElement>('[data-rl-cube-picture]');
    const marks = host.querySelector<HTMLUListElement>('[data-rl-cube-marks]');
    if (!holder || !picture || !marks) continue;
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
    canvas.tabIndex = 0;
    canvas.setAttribute('role', 'img');
    stages.push({
      which,
      label: LABELS[which],
      host,
      picture,
      canvas,
      marks,
      back: host.querySelector('[data-rl-cube-back]'),
      renderer,
      scene: new Scene(),
      camera: new OrthographicCamera(),
      aspect: w / h,
      content: new Group(),
      floor: null,
      now: new Group(),
      tracks: [],
    });
  }
  if (stages.length === 0) return false;

  let view: View = DEFAULT_VIEW;
  let box: Box | null = null;
  let time = Number(slider?.value ?? 0);
  let latest: PlansDetail | null = null;
  let playing: { from: number; at: number; frame: number } | null = null;
  /** Where the camera looks, on the screen, from the box's center: the frame's middle. */
  let mid = { u: 0, v: 0 };

  /** Frames the camera on the box from the current view, at the stage's own aspect: the frame
   *  from space-time.ts, widened on one axis until it matches. */
  function aim(stage: Stage) {
    if (!box) return;
    const f = frame(view, box);
    let half = { w: (f.right - f.left) / 2, h: (f.top - f.bottom) / 2 };
    mid = { u: (f.right + f.left) / 2, v: (f.top + f.bottom) / 2 };
    half =
      half.w / half.h > stage.aspect
        ? { w: half.w, h: half.w / stage.aspect }
        : { w: half.h * stage.aspect, h: half.h };
    const { right, up, back } = axes(view);
    const c = box.center;
    const far = 4 * Math.max(box.width, box.depth);
    const camera = stage.camera;
    camera.left = -half.w;
    camera.right = half.w;
    camera.top = half.h;
    camera.bottom = -half.h;
    camera.near = 0;
    camera.far = 2 * far;
    // Look at the frame's middle rather than the box's, so the cube stays centered as it turns.
    const target = [
      c[0] + mid.u * right[0] + mid.v * up[0],
      c[1] + mid.u * right[1] + mid.v * up[1],
      c[2] + mid.u * right[2] + mid.v * up[2],
    ] as const;
    camera.position.set(
      target[0] + back[0] * far,
      target[1] + back[1] * far,
      target[2] + back[2] * far,
    );
    camera.up.set(0, 1, 0);
    camera.lookAt(target[0], target[1], target[2]);
    camera.updateProjectionMatrix();
  }

  /** The hour labels, placed over the canvas where the scene draws each mark on the pillar. */
  function place(stage: Stage) {
    if (!box || !latest) return;
    const bakery = latest.data.points[0] ?? { x: 0, y: 0 };
    const width = stage.canvas.clientWidth;
    const height = stage.canvas.clientHeight;
    const cam = stage.camera;
    const b = box;
    const items = [...stage.marks.children] as HTMLElement[];
    hourMarks(b).forEach((s, k) => {
      // project() measures from the box's center; the camera looks at the frame's middle.
      const [u, v] = project(view, b, [bakery.x, s * b.scale, bakery.y]);
      const li = items[k];
      if (!li) return;
      li.style.left = `${((u - mid.u - cam.left) / (cam.right - cam.left)) * width}px`;
      li.style.top = `${((cam.top - (v - mid.v)) / (cam.top - cam.bottom)) * height}px`;
    });
  }

  function draw(stage: Stage) {
    if (stage.canvas.clientWidth === 0) return; // the plan a phone does not show
    aim(stage);
    stage.renderer.render(stage.scene, stage.camera);
    place(stage);
  }

  const drawAll = () => stages.forEach(draw);

  function dispose(object: Object3D) {
    object.traverse((child) => {
      const thing = child as Partial<Mesh>;
      thing.geometry?.dispose();
      const materials = thing.material;
      for (const m of Array.isArray(materials) ? materials : materials ? [materials] : []) {
        (m as MeshBasicMaterial).map?.dispose();
        m.dispose();
      }
    });
  }

  /** The map's floor, painted from the page's own basemap: Path2D reads the SVG path data the
   *  maps draw from (#rl-base), in the colors the theme gives it, so there is no second copy. */
  function floor(b: Box): Mesh {
    const canvas = document.createElement('canvas');
    canvas.width = 2048;
    canvas.height = Math.round((2048 * b.depth) / b.width);
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
          ctx.fill(shape);
        }
        if (style.stroke !== 'none') {
          ctx.strokeStyle = style.stroke;
          // The maps' strokes are screen pixels on a map about a third of this canvas's width;
          // the floor is drawn smaller again, so they are drawn about four times as wide here.
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
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    texture.anisotropy = stages[0]?.renderer.capabilities.getMaxAnisotropy() ?? 1;
    const geometry = new PlaneGeometry(b.width, b.depth);
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(b.width / 2, -0.5, b.depth / 2);
    return new Mesh(geometry, new MeshBasicMaterial({ map: texture }));
  }

  function segments(points: number[], css: string, opacity = 1): LineSegments {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(points, 3));
    return new LineSegments(
      geometry,
      new LineBasicMaterial({ color: rgbOf(css), transparent: opacity < 1, opacity }),
    );
  }

  /** Everything that follows from a plan: the floor, its edge, the bakery's pillar and its hour
   *  marks, and each van's track with its stops. */
  function build(stage: Stage, plan: PlansDetail['dealt'], detail: PlansDetail, b: Box) {
    dispose(stage.content);
    stage.scene.remove(stage.content);
    const group = new Group();
    // The floor depends on the theme alone, not on the plan: every change on the maps sends new
    // plans, and painting 2,048 px of basemap again each time would hold up the page's response.
    if (!stage.floor) {
      stage.floor = floor(b);
      stage.scene.add(stage.floor);
    }
    const top = b.seconds * b.scale;
    const bakery = detail.data.points[0] ?? { x: 0, y: 0 };
    const { width: w, depth: d } = b;
    group.add(
      segments(
        [0, 0, 0, w, 0, 0, w, 0, 0, w, 0, d, w, 0, d, 0, 0, d, 0, 0, d, 0, 0, 0],
        token('--input'),
      ),
    );
    // The box's top at the last hour and its four upright edges, fainter than the floor's.
    const cage = [
      0,
      top,
      0,
      w,
      top,
      0,
      w,
      top,
      0,
      w,
      top,
      d,
      w,
      top,
      d,
      0,
      top,
      d,
      0,
      top,
      d,
      0,
      top,
      0,
    ];
    for (const [x, z] of [
      [0, 0],
      [w, 0],
      [w, d],
      [0, d],
    ] as const)
      cage.push(x, 0, z, x, top, z);
    group.add(segments(cage, token('--input'), 0.55));
    const tick = 0.012 * Math.max(w, d);
    const axis = [bakery.x, 0, bakery.y, bakery.x, top, bakery.y];
    for (const s of hourMarks(b)) {
      const y = s * b.scale;
      axis.push(bakery.x - tick, y, bakery.y, bakery.x + tick, y, bakery.y);
    }
    group.add(segments(axis, token('--foreground')));

    stage.tracks = tracks(detail.data, detail.leg, plan);
    for (const track of stage.tracks) {
      const css = token(`--map-van-${vanClass(track.van)}`);
      const positions: number[] = [];
      for (let k = 0; k < track.points.length; k += 3)
        positions.push(
          track.points[k] ?? 0,
          (track.points[k + 2] ?? 0) * b.scale,
          track.points[k + 1] ?? 0,
        );
      const geometry = new LineGeometry();
      geometry.setPositions(positions);
      const dash = DASHES[track.van] ?? null;
      const material = new LineMaterial({
        color: rgbOf(css).getHex(),
        linewidth: 3,
        worldUnits: false,
        dashed: dash !== null,
        dashSize: dash?.[0] ?? 1,
        gapSize: dash?.[1] ?? 1,
      });
      const line = new Line2(geometry, material);
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
      group.add(
        new Points(
          stops,
          new PointsMaterial({ color: rgbOf(css), size: 7, sizeAttenuation: false }),
        ),
      );
    }
    stage.content = group;
    stage.scene.add(group);

    // The marks' labels: one per hour, placed on every draw.
    stage.marks.replaceChildren(
      ...hourMarks(b).map((s) => {
        const li = document.createElement('li');
        li.textContent = `${s / 3600} h`;
        return li;
      }),
    );
    stage.marks.hidden = false;

    const back = Math.max(0, ...stage.tracks.map((t) => t.back));
    const stale = stage.which === 'after' && !detail.fresh ? ', for the previous orders' : '';
    if (stage.back) stage.back.textContent = `Last van back after ${formatDuration(back)}${stale}`;
    stage.canvas.setAttribute(
      'aria-label',
      `${stage.label}${stale}, in time: the map lies flat, time rises from it, and each van’s line climbs as its day goes on. The last van is back after ${formatDuration(back)}.`,
    );
  }

  /** "Now": a level through the cube at the slider's time, where each van is, and a line down to
   *  the place on the map under it. Left out at time 0, when every van is at the bakery. */
  function moment(stage: Stage) {
    dispose(stage.now);
    stage.scene.remove(stage.now);
    const group = new Group();
    if (box && time > 0) {
      const y = time * box.scale;
      const { width: w, depth: d } = box;
      const level = new PlaneGeometry(w, d);
      level.rotateX(-Math.PI / 2);
      level.translate(w / 2, y, d / 2);
      group.add(
        new Mesh(
          level,
          new MeshBasicMaterial({
            color: rgbOf(token('--foreground')),
            transparent: true,
            opacity: 0.07,
            depthWrite: false,
            side: DoubleSide,
          }),
        ),
      );
      group.add(
        segments(
          [0, y, 0, w, y, 0, w, y, 0, w, y, d, w, y, d, 0, y, d, 0, y, d, 0, y, 0],
          token('--foreground'),
          0.5,
        ),
      );
      for (const track of stage.tracks) {
        const [x, z] = positionAt(track, time);
        const css = token(`--map-van-${vanClass(track.van)}`);
        group.add(segments([x, 0, z, x, y, z], css, 0.6));
        const at = new BufferGeometry();
        at.setAttribute('position', new Float32BufferAttribute([x, y, z], 3));
        group.add(
          new Points(
            at,
            new PointsMaterial({ color: rgbOf(css), size: 13, sizeAttenuation: false }),
          ),
        );
      }
    }
    stage.now = group;
    stage.scene.add(group);
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
    box = boxFor(detail.data.viewBox, longest);
    if (slider) slider.max = String(box.seconds);
    for (const stage of stages)
      build(stage, stage.which === 'before' ? detail.dealt : detail.solved, detail, box);
    setTime(time);
  }

  // The plans, now and on every change. The app may still be loading: its first redraw sends them.
  root.addEventListener('rl:plans', (event) => plans((event as CustomEvent<PlansDetail>).detail));

  // The canvas takes the picture's place: the picture leaves the page's tree, the canvas carries
  // its name, and both have one aspect, so nothing below moves.
  for (const stage of stages) {
    stage.picture.after(stage.canvas);
    stage.picture.setAttribute('hidden', '');
    new ResizeObserver(() => {
      const width = stage.canvas.parentElement?.clientWidth ?? 0;
      if (width === 0) return;
      stage.renderer.setSize(width, width / stage.aspect, false);
      draw(stage);
    }).observe(stage.host);
    stage.canvas.addEventListener('webglcontextlost', () => fallBack());
  }

  function fallBack() {
    stop();
    for (const stage of stages) {
      stage.canvas.remove();
      stage.marks.hidden = true;
      stage.picture.removeAttribute('hidden');
      stage.renderer.dispose();
    }
    for (const part of section.querySelectorAll<HTMLElement>('[data-rl-cube-controls]'))
      part.hidden = true;
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
    canvas.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      drag = { x: event.clientX, y: event.clientY, view, id: event.pointerId };
      canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener('pointermove', (event) => {
      if (!drag || event.pointerId !== drag.id) return;
      const tilt = event.pointerType === 'mouse' ? (event.clientY - drag.y) * 0.006 : 0;
      turn({
        azimuth: drag.view.azimuth - (event.clientX - drag.x) * 0.008,
        elevation: drag.view.elevation + tilt,
      });
    });
    const end = () => {
      drag = null;
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('keydown', (event) => {
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
    });
  }
  reset?.addEventListener('click', () => turn(DEFAULT_VIEW));

  slider?.addEventListener('input', () => {
    stop();
    setTime(Number(slider.value));
  });

  // "Play the day": the slider runs to the end of the time axis in PLAY_MS, from where it stands,
  // or from the start when it is at the end. The same button pauses it (SC 2.2.2).
  function stop() {
    if (playing) cancelAnimationFrame(playing.frame);
    playing = null;
    play?.setAttribute('aria-pressed', 'false');
    if (play) play.textContent = 'Play the day';
  }
  function go() {
    if (!box) return;
    if (time >= box.seconds) setTime(0);
    play?.setAttribute('aria-pressed', 'true');
    if (play) play.textContent = 'Pause';
    const step = (now: number) => {
      if (!playing || !box) return;
      const t = playing.from + ((now - playing.at) / PLAY_MS) * box.seconds;
      setTime(t);
      if (t >= box.seconds) return stop();
      playing.frame = requestAnimationFrame(step);
    };
    playing = { from: time, at: performance.now(), frame: requestAnimationFrame(step) };
  }
  play?.addEventListener('click', () => (playing ? stop() : go()));

  // A theme change repaints the floor and recolors the lines from the new tokens.
  const repaint = () => {
    for (const stage of stages) {
      if (stage.floor) {
        dispose(stage.floor);
        stage.scene.remove(stage.floor);
      }
      stage.floor = null;
    }
    if (latest) plans(latest);
  };
  new MutationObserver(repaint).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  });
  for (const query of ['(prefers-color-scheme: dark)', '(prefers-contrast: more)'])
    matchMedia(query).addEventListener('change', repaint);

  // A press of Play before the scene loaded is kept (boot.ts), and so is the slider's place.
  root.dispatchEvent(new Event('rl:ask'));
  if (play?.dataset['rlCubeWant']) {
    delete play.dataset['rlCubeWant'];
    if (box) go();
    else root.addEventListener('rl:plans', () => go(), { once: true });
  }
  return true;
}
