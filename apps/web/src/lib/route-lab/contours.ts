import type { Basemap, Isochrones } from './data';
import { pathData, type Line } from './legs';

// The isochrones' edges as lines, for the Route Lab's maps: where the area the bakery reaches in
// 10 or 20 minutes ends on land, with a label on each. The bands alone step only a little in
// lightness, as they must for every route to keep 3:1 on them (design-system.md, "Map colors"),
// so a line marks every other edge. Worked out at build from isochrones.json and basemap.json:
// an edge that runs along the water is the shore, not a drive time, and is left out, and each
// label sits where a ray from the bakery leaves its area, on land, clear of the map's own labels.
// Build-time only: nothing here reaches the browser.

type Loop = [number, number][];

/** The closed loops of SVG path data written as M, m, l and z (the pipeline's only commands). */
export function rings(d: string): Loop[] {
  const tokens = d.match(/[MmLlZz]|-?\d+(?:\.\d+)?/g) ?? [];
  const out: Loop[] = [];
  let command = 'M';
  let loop: Loop = [];
  let [x, y, sx, sy] = [0, 0, 0, 0];
  for (let k = 0; k < tokens.length;) {
    const token = tokens[k] ?? '';
    if (/[A-Za-z]/.test(token)) {
      command = token;
      k++;
      if (command === 'z' || command === 'Z') [x, y] = [sx, sy];
      continue;
    }
    const a = Number(token);
    const b = Number(tokens[k + 1]);
    k += 2;
    const fromOrigin = command === 'M' || command === 'L';
    [x, y] = fromOrigin ? [a, b] : [x + a, y + b];
    if (command === 'M' || command === 'm') {
      [sx, sy] = [x, y];
      loop = [[x, y]];
      out.push(loop);
      command = fromOrigin ? 'L' : 'l';
    } else loop.push([x, y]);
  }
  return out;
}

/** Whether a point is inside loops drawn with the even-odd rule, as the map fills them. */
export function inside(shape: readonly Loop[], px: number, py: number): boolean {
  let inner = false;
  for (const loop of shape) {
    for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
      const [xi = 0, yi = 0] = loop[i] ?? [];
      const [xj = 0, yj = 0] = loop[j] ?? [];
      if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inner = !inner;
    }
  }
  return inner;
}

export interface Contour {
  readonly minutes: number;
  /** The edge on land, as path data. */
  readonly d: string;
  /** Where its labels go: up to two, a quarter turn or more apart round the bakery; none when no
   *  spot on land is clear. */
  readonly labels: readonly { readonly x: number; readonly y: number }[];
}

/** How far either side of an edge to look for water, how close to the frame an edge may run, the
 *  least area a loop must hold to be drawn, and the shortest line, in map units (a map unit is
 *  about 3 m). A smaller loop is a pocket a few blocks wide, which would scatter loops over the
 *  map without saying more than the bands do. */
const SHORE = 10;
const FRAME = 2;
const AREA = 40_000;
const SHORTEST = 80;

/** A loop's area, by the shoelace formula. */
const area = (loop: Loop): number =>
  Math.abs(
    loop.reduce((sum, [x, y], k) => {
      const [nx = 0, ny = 0] = loop[(k + 1) % loop.length] ?? [];
      return sum + x * ny - nx * y;
    }, 0),
  ) / 2;

/** A line's length. */
const length = (line: Line): number => {
  let total = 0;
  for (let k = 2; k < line.length; k += 2)
    total += Math.hypot(
      (line[k] ?? 0) - (line[k - 2] ?? 0),
      (line[k + 1] ?? 0) - (line[k - 1] ?? 0),
    );
  return total;
};

/** The edge of one area on land: every segment with land on both sides, joined into lines. A
 *  segment along the frame is the map's edge, not the area's, and is left out too. */
function landEdge(shape: readonly Loop[], water: readonly Loop[], width: number, height: number) {
  const lines: Line[] = [];
  const near = (p: number, q: number, edge: number) =>
    Math.abs(p - edge) < FRAME && Math.abs(q - edge) < FRAME;
  for (const loop of shape.filter((r) => area(r) >= AREA)) {
    const point = (k: number) => loop[k % loop.length] ?? [0, 0];
    const land = loop.map((_, k) => {
      const [ax, ay] = point(k);
      const [bx, by] = point(k + 1);
      if (near(ax, bx, 0) || near(ax, bx, width) || near(ay, by, 0) || near(ay, by, height))
        return false;
      const length = Math.hypot(bx - ax, by - ay) || 1;
      const [nx, ny] = [((ay - by) / length) * SHORE, ((bx - ax) / length) * SHORE];
      const [mx, my] = [(ax + bx) / 2, (ay + by) / 2];
      return !inside(water, mx + nx, my + ny) && !inside(water, mx - nx, my - ny);
    });
    // Start just after a segment that is left out, so no line runs across the loop's seam.
    const from = Math.max(0, land.indexOf(false));
    let line: Line | null = null;
    for (let s = 1; s <= loop.length; s++) {
      const k = (from + s) % loop.length;
      if (!land[k]) {
        line = null;
        continue;
      }
      const [ax, ay] = point(k);
      const [bx, by] = point(k + 1);
      if (!line) {
        line = [ax, ay];
        lines.push(line);
      }
      line.push(bx, by);
    }
  }
  return lines.filter((line) => length(line) >= SHORTEST);
}

/**
 * The contours at `minutes`, each a line along its area's edge on land and up to two labels. A
 * label sits where a ray from the bakery first leaves the area, every 5 degrees round, on land and
 * inside the frame, clear of every place's marker, as far as it can be from every label already
 * on the map; a second one a quarter turn or more round from the first.
 */
/** A place's marker, as a radius in the map's units, that a label keeps clear of: a stop's
 *  numbered disc is the largest mark the routes draw on one. */
export const MARKER = 30;

/** A label's box in the map's units, from its anchor point (the text's baseline): the labels are
 *  68 units tall, with characters about 0.6 of that wide in the mono face and 0.55 in the sans. */
export interface Box {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}
export function labelBox(
  x: number,
  y: number,
  chars: number,
  anchor: 'start' | 'middle' | 'end',
  perChar: number,
): Box {
  const width = chars * perChar;
  const left = anchor === 'start' ? x : anchor === 'end' ? x - width : x - width / 2;
  return { left, right: left + width, top: y - 52, bottom: y + 17 };
}

/** Whether two boxes share any point. */
export const overlaps = (a: Box, b: Box): boolean =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

/** Whether a box leaves every place's marker whole: no place within MARKER of it. */
export const clearOfPlaces = (box: Box, places: readonly { x: number; y: number }[]): boolean =>
  places.every(
    (p) =>
      p.x < box.left - MARKER ||
      p.x > box.right + MARKER ||
      p.y < box.top - MARKER ||
      p.y > box.bottom + MARKER,
  );

/** Where "The bakery" goes: left of its mark, as before, unless that covers a place (International
 *  Fountain is there, a stop on the default day), and then right. */
export function bakeryLabelAt(
  bakery: { readonly x: number; readonly y: number },
  places: readonly { x: number; y: number }[],
): { x: number; y: number; anchor: 'start' | 'end' } {
  const tries = [
    { x: bakery.x - 24, y: bakery.y + 11, anchor: 'end' as const },
    { x: bakery.x + 24, y: bakery.y + 11, anchor: 'start' as const },
  ];
  const others = places.filter((p) => p.x !== bakery.x || p.y !== bakery.y);
  return (
    tries.find((t) => clearOfPlaces(labelBox(t.x, t.y, 10, t.anchor, 37), others)) ??
    (tries[0] as (typeof tries)[number])
  );
}

export function contours(
  iso: Isochrones,
  base: Basemap,
  taken: readonly { readonly x: number; readonly y: number }[],
  minutes: readonly number[],
  places: readonly { readonly x: number; readonly y: number }[] = [],
): Contour[] {
  const [, , width, height] = base.viewBox;
  const water = rings(base.water);
  const [dx, dy] = iso.depot;
  const placed = [...taken];
  return minutes.map((m) => {
    const index = iso.minutes.indexOf(m);
    if (index < 0) throw new Error(`route-lab: no isochrone at ${m} minutes`);
    const reach = rings(iso.within[index] ?? '');
    const d = landEdge(reach, water, width, height).map(pathData).join('');
    const labels: { x: number; y: number; degrees: number }[] = [];
    for (let n = 0; n < 2; n++) {
      let best: { x: number; y: number; degrees: number; room: number } | null = null;
      for (let degrees = 0; degrees < 360; degrees += 5) {
        const turn = (a: number) => Math.min(Math.abs(a - degrees), 360 - Math.abs(a - degrees));
        if (labels.some((l) => turn(l.degrees) < 90)) continue;
        const [cx, cy] = [Math.cos((degrees * Math.PI) / 180), Math.sin((degrees * Math.PI) / 180)];
        for (let r = 0; r < width + height; r += 4) {
          const [x, y] = [Math.round(dx + cx * r), Math.round(dy + cy * r)];
          if (x < 140 || x > width - 140 || y < 80 || y > height - 80) break;
          if (inside(reach, x, y) && !inside(reach, dx + cx * (r + 4), dy + cy * (r + 4))) {
            const wet = [-30, 0, 30].some((s) => inside(water, x + cx * s, y + cy * s));
            const room = Math.min(
              ...placed.map((p) => Math.max(Math.abs(p.x - x) / 3, Math.abs(p.y - y))),
            );
            // "20 min" in the mono face, centred: it may not cover a place's marker either, or
            // a stop's number reads as part of the time.
            const clear = clearOfPlaces(labelBox(x, y, 6, 'middle', 41), places);
            if (!wet && clear && room > 70 && (!best || room > best.room))
              best = { x, y, degrees, room };
            break;
          }
        }
      }
      if (!best) break;
      labels.push(best);
      placed.push(best);
    }
    return { minutes: m, d, labels: labels.map(({ x, y }) => ({ x, y })) };
  });
}
