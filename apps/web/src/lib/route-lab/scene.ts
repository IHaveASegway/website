import type { RouteData } from './data';
import type { Line } from './legs';
import type { Measured, Plan } from './plan';
import { axes } from './space-time';
import { tracks } from './timeline';

// Home's scene (ADR 0024): the Route Lab's default day, as VROOM plans it at build, driven on the
// map behind Joseph's name. The vans run their routes with trails behind them, and as the page
// scrolls the day rises off the map into the space-time cube (ADR 0019): time becomes height. Plain
// TypeScript with no DOM and no platform import, so the build's picture (components/
// RouteScene.astro), the scene's data file (pages/lab/[demo]/scene.json.ts), the browser's
// canvas (scripts/route-scene.ts) and the unit tests share one camera. Its axes are the cube's
// (space-time.ts), so a lifted scene is the cube seen from another angle, not a second model of it.

/** The camera: radians around the vertical axis and above the floor, and how far time stands up,
 *  0 for a flat map to 1 for the cube's full height. */
export interface Camera {
  readonly azimuth: number;
  readonly elevation: number;
  readonly lift: number;
}

/** Where the scene starts, and the build's picture with it: the city from the south-west, high
 *  enough that its shape reads as Seattle's. */
export const START: Camera = { azimuth: -0.5, elevation: 0.86, lift: 0 };
/** Where scrolling takes it: lower and further round, with time standing up. */
export const LIFTED: Camera = { azimuth: -0.86, elevation: 0.42, lift: 1 };
/** How far the camera sways about START's azimuth, and how long one sway takes. */
export const SWAY = 0.16;
export const SWAY_S = 48;

/** The time axis at lift 1, as a share of the map's larger side: the cube's own proportion. */
export const HEIGHT = 0.62;

/** The camera between START and LIFTED, `p` of the way, eased at both ends. */
export function cameraAt(p: number, sway = 0): Camera {
  const t = Math.min(1, Math.max(0, p));
  const e = t * t * (3 - 2 * t);
  return {
    azimuth: START.azimuth + (LIFTED.azimuth - START.azimuth) * e + sway,
    elevation: START.elevation + (LIFTED.elevation - START.elevation) * e,
    lift: e,
  };
}

/** One van's day for the scene: x, y, t triples, simplified; each stop as x, y and arrival. */
export interface SceneTrack {
  readonly van: number;
  readonly points: readonly number[];
  readonly stops: readonly number[];
  readonly back: number;
}

/** The fields of the data file that hold a list of numbers. */
const LISTS = new Set(['focus', 'map', 'bakery', 'points', 'stops']);

/** A list of numbers as the data file writes it: whole numbers with spaces between them, as SVG
 *  path data is. A list with commas reads as figures with thousands separators, and the content
 *  scan reads figures (content.md, "The content firewall"). */
export const unpack = (numbers: string): number[] =>
  numbers === '' ? [] : numbers.split(' ').map(Number);

/** The data file's text for a scene: JSON, with every list of numbers written as one string. */
export const sceneText = (scene: SceneData): string =>
  JSON.stringify(scene, (key: string, value: unknown) =>
    LISTS.has(key) && Array.isArray(value) ? value.join(' ') : value,
  );

/** A scene from the data file's text, its lists read back into numbers. */
export const readScene = (text: string): SceneData =>
  JSON.parse(text, (key: string, value: unknown) =>
    LISTS.has(key) && typeof value === 'string' ? unpack(value) : value,
  ) as SceneData;

/** The scene's data file: the tracks the canvas drives and the figures its readout counts. The
 *  map is not in it: the canvas reads the floor's paths from the build's picture, so Home holds one
 *  copy of the map. */
export interface SceneData {
  /** The part of the map the day happens in (focusOf): what the camera holds. */
  readonly focus: Bounds;
  /** The whole map, which fades out toward its edges (EDGE). */
  readonly map: Bounds;
  /** The seconds the time axis spans: whole hours, at least one (sceneSeconds). */
  readonly seconds: number;
  /** When the last van is back. */
  readonly back: number;
  /** The orders of the day. */
  readonly orders: number;
  readonly bakery: readonly [number, number];
  readonly tracks: readonly SceneTrack[];
}

/** The seconds the scene's time axis spans for a day that ends at `back`: whole hours, at least
 *  one, as the cube's box rounds them. */
export const sceneSeconds = (back: number): number => Math.max(1, Math.ceil(back / 3600)) * 3600;

/** Map units per second when a track is simplified: five seconds weigh as much as one unit. */
const TIME_WEIGHT = 0.2;
/** How far, in map units, a simplified track may stray: under a pixel at any size Home draws. */
export const TOLERANCE = 2.5;

/**
 * Douglas-Peucker over x, y, t triples, t weighted by TIME_WEIGHT, so a van standing at a stop (the
 * same x and y, later t) is kept while the road's extra points go. Keeps both ends. Iterative.
 */
export function simplify3(points: readonly number[], tolerance = TOLERANCE): number[] {
  const n = points.length / 3;
  if (n <= 2) return [...points];
  const at = (i: number): [number, number, number] => [
    points[i * 3] ?? 0,
    points[i * 3 + 1] ?? 0,
    (points[i * 3 + 2] ?? 0) * TIME_WEIGHT,
  ];
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length > 0) {
    const [a, b] = stack.pop() ?? [0, 0];
    const pa = at(a);
    const pb = at(b);
    const d: [number, number, number] = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]];
    const len2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
    let far = 0;
    let worst = -1;
    for (let i = a + 1; i < b; i++) {
      const p = at(i);
      const w: [number, number, number] = [p[0] - pa[0], p[1] - pa[1], p[2] - pa[2]];
      const s = len2 === 0 ? 0 : (w[0] * d[0] + w[1] * d[1] + w[2] * d[2]) / len2;
      const q = Math.min(1, Math.max(0, s));
      const dist = Math.hypot(w[0] - q * d[0], w[1] - q * d[1], w[2] - q * d[2]);
      if (dist > far) [far, worst] = [dist, i];
    }
    if (worst >= 0 && far > tolerance) {
      keep[worst] = 1;
      stack.push([a, worst], [worst, b]);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++)
    if (keep[i]) out.push(points[i * 3] ?? 0, points[i * 3 + 1] ?? 0, points[i * 3 + 2] ?? 0);
  return out;
}

/** A box on the map, in its units: left, top, right, bottom. */
export type Bounds = readonly [number, number, number, number];

/** How much room the camera leaves around the day's places, as a share of their larger side. */
export const FOCUS_PAD = 0.06;

/** How far in from each edge of the map its floor fades in, as a share of that side: the map's
 *  data stops at a rectangle, and a straight edge across the water would read as a slab. */
export const EDGE = 0.12;

/** The map's box, from its viewBox. */
export const mapBounds = ([x, y, w, h]: readonly [number, number, number, number]): Bounds => [
  x,
  y,
  x + w,
  y + h,
];

/** The box around some places, x, y pairs, padded by FOCUS_PAD and made square, so the camera
 *  holds the day rather than the whole map and keeps the same frame as it turns. */
export function focusOf(places: readonly number[], pad = FOCUS_PAD): Bounds {
  const xs = places.filter((_, k) => k % 2 === 0);
  const ys = places.filter((_, k) => k % 2 === 1);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const side = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  const half = (side * (1 + 2 * pad)) / 2;
  return [cx - half, cy - half, cx + half, cy + half].map(Math.round) as unknown as Bounds;
}

/** The places a plan's day touches: the bakery and every stop, as x, y pairs. */
export function dayPlaces(data: RouteData, plan: Plan): number[] {
  const bakery = data.points[0];
  return [
    bakery?.x ?? 0,
    bakery?.y ?? 0,
    ...plan.routes.flat().flatMap((i) => [data.points[i]?.x ?? 0, data.points[i]?.y ?? 0]),
  ];
}

/** The scene for a plan: its tracks, simplified. */
export function sceneOf(
  data: RouteData,
  leg: (i: number, j: number) => Line,
  after: { readonly plan: Plan; readonly measured: Measured },
): SceneData {
  const all = tracks(data, leg, after.plan);
  const bakery = data.points[0];
  return {
    focus: focusOf(dayPlaces(data, after.plan)),
    map: mapBounds(data.viewBox),
    seconds: sceneSeconds(after.measured.back),
    back: after.measured.back,
    orders: all.reduce((sum, track) => sum + track.stops.length, 0),
    bakery: [bakery?.x ?? 0, bakery?.y ?? 0],
    tracks: all.map((track) => ({
      van: track.van,
      points: simplify3(track.points).map(Math.round),
      stops: track.stops.flatMap((s) => [s.x, s.y, Math.round(s.arrives)]),
      back: track.back,
    })),
  };
}

/** A rectangle on the screen, in whatever units the drawing uses. */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** The scene's projection for a camera: map x and y and seconds t to the screen, x right and y
 *  down, about the focus's middle, before any scale. Orthographic, as the cube's camera is; the
 *  time axis stands HEIGHT of the focus's side at lift 1. */
export function projector(
  focus: Bounds,
  seconds: number,
  camera: Camera,
): (x: number, y: number, t: number) => readonly [number, number] {
  const { right, up } = axes(camera);
  const [x0, y0, x1, y1] = focus;
  const rise = (camera.lift * HEIGHT * Math.max(x1 - x0, y1 - y0)) / seconds;
  const cx = (x0 + x1) / 2;
  const cz = (y0 + y1) / 2;
  return (x, y, t) => {
    const dx = x - cx;
    const dy = t * rise;
    const dz = y - cz;
    return [dx * right[0] + dy * right[1] + dz * right[2], -(dx * up[0] + dy * up[1] + dz * up[2])];
  };
}

/** What the camera must hold: the focus's corners on the floor and, once time stands up, the
 *  cube's top over them. */
export function extent(focus: Bounds, seconds: number, camera: Camera): Rect {
  const at = projector(focus, seconds, camera);
  const [x0, y0, x1, y1] = focus;
  const xs: number[] = [];
  const ys: number[] = [];
  for (const x of [x0, x1])
    for (const y of [y0, y1])
      for (const t of camera.lift > 0 ? [0, seconds] : [0]) {
        const [u, v] = at(x, y, t);
        xs.push(u);
        ys.push(v);
      }
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  return { x: left, y: top, width: Math.max(...xs) - left, height: Math.max(...ys) - top };
}

/** The scale and offset that set `what` in the middle of `into`, as large as it fits. */
export function fit(what: Rect, into: Rect): { scale: number; x: number; y: number } {
  const scale = Math.min(into.width / what.width, into.height / what.height);
  return {
    scale,
    x: into.x + (into.width - what.width * scale) / 2 - what.x * scale,
    y: into.y + (into.height - what.height * scale) / 2 - what.y * scale,
  };
}

/** The matrix that lays the floor (time 0) on the screen through a fit: (x, y) to
 *  (a x + c y + e, b x + d y + f), as SVG's matrix() and DOMMatrix take it. */
export function floorMatrix(
  focus: Bounds,
  seconds: number,
  camera: Camera,
  at: { scale: number; x: number; y: number },
): [number, number, number, number, number, number] {
  const p = projector(focus, seconds, camera);
  const [ox, oy] = p(0, 0, 0);
  const [xx, xy] = p(1, 0, 0);
  const [yx, yy] = p(0, 1, 0);
  const s = at.scale;
  return [(xx - ox) * s, (xy - oy) * s, (yx - ox) * s, (yy - oy) * s, ox * s + at.x, oy * s + at.y];
}

/** Where a van is at time t on a scene track: x, y, interpolated, the bakery before and after. */
export function where(points: readonly number[], t: number): readonly [number, number] {
  const n = points.length / 3;
  if (n === 0) return [0, 0];
  if (t <= (points[2] ?? 0)) return [points[0] ?? 0, points[1] ?? 0];
  let lo = 0;
  let hi = n - 1;
  if (t >= (points[hi * 3 + 2] ?? 0)) return [points[hi * 3] ?? 0, points[hi * 3 + 1] ?? 0];
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if ((points[mid * 3 + 2] ?? 0) <= t) lo = mid;
    else hi = mid;
  }
  const t0 = points[lo * 3 + 2] ?? 0;
  const t1 = points[hi * 3 + 2] ?? 0;
  const k = t1 === t0 ? 0 : (t - t0) / (t1 - t0);
  return [
    (points[lo * 3] ?? 0) + ((points[hi * 3] ?? 0) - (points[lo * 3] ?? 0)) * k,
    (points[lo * 3 + 1] ?? 0) + ((points[hi * 3 + 1] ?? 0) - (points[lo * 3 + 1] ?? 0)) * k,
  ];
}
