import type { Line } from './legs';
import { pathData } from './legs';
import type { Track } from './timeline';

// The space-time cube's geometry (ADR 0019): one orthographic camera, shared by the picture the
// build draws and the 3D scene the browser draws, so the scene takes the picture's place without a
// jump. World axes: X is the map's x, Z the map's y (south, as SVG's y runs down), and Y is time,
// up. The map's floor is a plane, so its projection is affine, and the picture draws the page's
// own basemap through one matrix rather than a second copy of it. No DOM and no three.js here.

export type Vec3 = readonly [number, number, number];

/** Where the camera looks from: radians around the vertical axis, and above the floor. */
export interface View {
  readonly azimuth: number;
  readonly elevation: number;
}

/** Looking from the south-west, a little above: the bakery's pillar stands clear of the city. */
export const DEFAULT_VIEW: View = { azimuth: -0.55, elevation: 0.5 };

/** How tall the time axis stands, as a share of the map's larger side. */
const HEIGHT = 0.62;

/** The cube's size: the map's floor, and how many world units one second climbs. */
export interface Box {
  readonly width: number;
  readonly depth: number;
  /** World units per second: the tallest track fills HEIGHT of the map's larger side. */
  readonly scale: number;
  /** The seconds the time axis spans, a whole number of hours. */
  readonly seconds: number;
  readonly center: Vec3;
}

/** A box for tracks that end by `seconds`, rounded up to the hour, at least one. Both plans of a
 *  day share one box, so the plan that takes longer stands taller. */
export function boxFor(viewBox: readonly [number, number, number, number], seconds: number): Box {
  const [, , width, depth] = viewBox;
  const hours = Math.max(1, Math.ceil(seconds / 3600));
  const span = hours * 3600;
  const scale = (HEIGHT * Math.max(width, depth)) / span;
  return { width, depth, scale, seconds: span, center: [width / 2, (span * scale) / 2, depth / 2] };
}

/** The camera's axes: right and up on the screen, and back toward the viewer. */
export function axes(view: View): { right: Vec3; up: Vec3; back: Vec3 } {
  const ce = Math.cos(view.elevation);
  const back: Vec3 = [
    Math.sin(view.azimuth) * ce,
    Math.sin(view.elevation),
    Math.cos(view.azimuth) * ce,
  ];
  // right = normalize(worldUp × back); up = back × right, as a lookAt with up (0, 1, 0) makes them.
  const rl = Math.hypot(back[2], back[0]);
  const right: Vec3 = [back[2] / rl, 0, -back[0] / rl];
  const up: Vec3 = [
    back[1] * right[2] - back[2] * right[1],
    back[2] * right[0] - back[0] * right[2],
    back[0] * right[1] - back[1] * right[0],
  ];
  return { right, up, back };
}

/** A world point on the screen, measured from the box's center: u to the right, v up. */
export function project(view: View, box: Box, p: Vec3): readonly [number, number] {
  const { right, up } = axes(view);
  const d: Vec3 = [p[0] - box.center[0], p[1] - box.center[1], p[2] - box.center[2]];
  return [
    d[0] * right[0] + d[1] * right[1] + d[2] * right[2],
    d[0] * up[0] + d[1] * up[1] + d[2] * up[2],
  ];
}

/** The SVG matrix that lays the map's floor (time 0) on the screen, with SVG's y running down:
 *  (x, y) to (a x + c y + e, b x + d y + f). */
export function floorMatrix(view: View, box: Box): readonly number[] {
  const [ox, oy] = project(view, box, [0, 0, 0]);
  const [xx, xy] = project(view, box, [1, 0, 0]);
  const [zx, zy] = project(view, box, [0, 0, 1]);
  return [xx - ox, -(xy - oy), zx - ox, -(zy - oy), ox, -oy];
}

/** What the camera must hold: the floor's corners and the top of the time axis over each, in
 *  screen units around the box's center, with a margin. The 3D scene's orthographic frustum is
 *  this rectangle, so it frames the scene exactly as the picture does. */
export function frame(
  view: View,
  box: Box,
  margin = 0.04,
): { left: number; right: number; top: number; bottom: number } {
  const top = box.seconds * box.scale;
  const corners: Vec3[] = [];
  for (const x of [0, box.width])
    for (const z of [0, box.depth]) for (const y of [0, top]) corners.push([x, y, z]);
  const us = corners.map((c) => project(view, box, c)[0]);
  const vs = corners.map((c) => project(view, box, c)[1]);
  const pad = margin * Math.max(box.width, box.depth);
  return {
    left: Math.min(...us) - pad,
    right: Math.max(...us) + pad,
    bottom: Math.min(...vs) - pad,
    top: Math.max(...vs) + pad,
  };
}

/** A track on the screen, in SVG units (y down), simplified to within `tolerance` units:
 *  Douglas-Peucker, since the roads carry far more points than a picture this size can show. */
export function screenLine(view: View, box: Box, track: Track, tolerance = 2): Line {
  const flat: number[] = [];
  const p = track.points;
  for (let k = 0; k < p.length; k += 3) {
    const [u, v] = project(view, box, [p[k] ?? 0, (p[k + 2] ?? 0) * box.scale, p[k + 1] ?? 0]);
    flat.push(u, -v);
  }
  return simplify(flat, tolerance);
}

/** Douglas-Peucker on a flat x, y list: keeps the ends, and every point further than `tolerance`
 *  from the line its neighbours left would draw. Iterative, so a long track cannot overflow. */
export function simplify(line: Line, tolerance: number): Line {
  const count = line.length / 2;
  if (count <= 2) return [...line];
  const keep = new Uint8Array(count);
  keep[0] = 1;
  keep[count - 1] = 1;
  const stack: [number, number][] = [[0, count - 1]];
  const x = (i: number) => line[i * 2] ?? 0;
  const y = (i: number) => line[i * 2 + 1] ?? 0;
  while (stack.length > 0) {
    const [a, b] = stack.pop() ?? [0, 0];
    const dx = x(b) - x(a);
    const dy = y(b) - y(a);
    const len = Math.hypot(dx, dy);
    let worst = -1;
    let far = 0;
    for (let i = a + 1; i < b; i++) {
      const d =
        len === 0
          ? Math.hypot(x(i) - x(a), y(i) - y(a))
          : Math.abs(dy * x(i) - dx * y(i) + x(b) * y(a) - y(b) * x(a)) / len;
      if (d > far) [far, worst] = [d, i];
    }
    if (worst >= 0 && far > tolerance) {
      keep[worst] = 1;
      stack.push([a, worst], [worst, b]);
    }
  }
  const out: Line = [];
  for (let i = 0; i < count; i++) if (keep[i]) out.push(x(i), y(i));
  return out;
}

/** The hour marks on the bakery's pillar: every hour the axis spans, from the first. */
export const hourMarks = (box: Box): number[] =>
  Array.from({ length: Math.round(box.seconds / 3600) }, (_, k) => (k + 1) * 3600);

const round = (line: Line): Line => line.map((v) => Math.round(v));

/** SVG path data for a screen line, as integers: the units are a few tenths of a pixel. */
export const screenPath = (line: Line): string => pathData(round(line));

/** Where the 3D scene's orthographic camera stands and what it holds, at a canvas's aspect: the
 *  frame, widened on one axis until it matches, around the frame's middle, so the cube stays
 *  centered as it turns. At DEFAULT_VIEW and the picture's own aspect this is exactly the picture
 *  (test/space-time.test.ts), which is why the canvas takes the picture's place without a jump. */
export interface Pose {
  /** The point the camera looks at, in world units. */
  readonly target: Vec3;
  /** Half the width and height the camera holds, in screen units. */
  readonly half: { readonly w: number; readonly h: number };
  /** The frame's middle, on the screen, from the box's center. */
  readonly mid: { readonly u: number; readonly v: number };
}

export function pose(view: View, box: Box, aspect: number): Pose {
  const f = frame(view, box);
  const mid = { u: (f.right + f.left) / 2, v: (f.top + f.bottom) / 2 };
  const w = (f.right - f.left) / 2;
  const h = (f.top - f.bottom) / 2;
  const half = w / h > aspect ? { w, h: w / aspect } : { w: h * aspect, h };
  const { right, up } = axes(view);
  const c = box.center;
  const target: Vec3 = [
    c[0] + mid.u * right[0] + mid.v * up[0],
    c[1] + mid.u * right[1] + mid.v * up[1],
    c[2] + mid.u * right[2] + mid.v * up[2],
  ];
  return { target, half, mid };
}

/** Where a world point falls on a canvas the pose fills, as fractions from its left and top. */
export function onCanvas(view: View, box: Box, at: Pose, p: Vec3): readonly [number, number] {
  const [u, v] = project(view, box, p);
  return [
    (u - at.mid.u + at.half.w) / (2 * at.half.w),
    (at.half.h - (v - at.mid.v)) / (2 * at.half.h),
  ];
}

/** Each van's line in 3D: a dash and a gap in map units, or none, so color is never the only
 *  signal (SC 1.4.1). WebGL's dashed line takes one dash and one gap, so the maps' dash-dot for
 *  van D becomes an even dash: solid, long dashes, dots and even dashes, each a different rhythm. */
export const VAN_DASHES: readonly (readonly [number, number] | null)[] = [
  null,
  [48, 16],
  [6, 16],
  [24, 24],
];
