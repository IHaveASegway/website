import { describe, expect, test } from 'vitest';
import type { RouteData } from '../src/lib/route-lab/data';
import { DEFAULT_DAY, days } from '../src/lib/route-lab/days';
import type { Line } from '../src/lib/route-lab/legs';
import { leg, routeData } from '../src/lib/route-lab/picture';
import { capacityFor, dealtInTurn, measure } from '../src/lib/route-lab/plan';
import {
  axes,
  boxFor,
  DEFAULT_VIEW,
  floorMatrix,
  frame,
  hourMarks,
  onCanvas,
  pose,
  project,
  screenLine,
  simplify,
  VAN_DASHES,
} from '../src/lib/route-lab/space-time';
import { positionAt, tracks } from '../src/lib/route-lab/timeline';

// The space-time cube's core (ADR 0019): a plan in time, and the one camera the build's picture and
// the browser's scene share. Known answers on a tiny made-up city first, then the real data, where
// every track must agree with measure(), the function every figure on the page comes from.

/** Three places on a line: the bakery at 0, A at 100, B at 300, ten seconds per unit of road. */
const tiny = {
  viewBox: [0, 0, 400, 100],
  serviceSeconds: 60,
  points: [
    { i: 0, label: 'Bakery', kind: 'bakery', x: 0, y: 0 },
    { i: 1, label: 'A', kind: 'cafe', order: 'bread', qty: 1, x: 100, y: 0 },
    { i: 2, label: 'B', kind: 'cafe', order: 'bread', qty: 1, x: 300, y: 0 },
  ],
  durations: [0, 1000, 3000, 1000, 0, 2000, 3000, 2000, 0],
  distances: [0, 100, 300, 100, 0, 200, 300, 200, 0],
} as unknown as RouteData;
/** Straight roads with a midpoint, so a leg has three points. */
const tinyLeg = (i: number, j: number): Line => {
  const a = tiny.points[i]?.x ?? 0;
  const b = tiny.points[j]?.x ?? 0;
  return [a, 0, (a + b) / 2, 0, b, 0];
};

describe('a plan in time', () => {
  test('known answer: one van, bakery to A to B and back', () => {
    const [track, ...rest] = tracks(tiny, tinyLeg, { routes: [[1, 2]], unassigned: [] });
    expect(rest).toEqual([]);
    expect(track?.stops).toEqual([
      { place: 1, x: 100, y: 0, arrives: 1000, leaves: 1060 },
      { place: 2, x: 300, y: 0, arrives: 3060, leaves: 3120 },
    ]);
    // Drive to A (half way at 500 s), stand 60 s, drive to B, stand, drive home.
    expect(track?.points).toEqual([
      0, 0, 0, 50, 0, 500, 100, 0, 1000, 100, 0, 1060, 200, 0, 2060, 300, 0, 3060, 300, 0, 3120,
      150, 0, 4620, 0, 0, 6120,
    ]);
    expect(track?.back).toBe(6120);
  });

  test('a van with no stop has no track; the others keep their van number', () => {
    const out = tracks(tiny, tinyLeg, { routes: [[], [2]], unassigned: [] });
    expect(out.map((t) => t.van)).toEqual([1]);
  });

  test('where a van is: at home before and after, on the road between, still at a stop', () => {
    const [track] = tracks(tiny, tinyLeg, { routes: [[1, 2]], unassigned: [] });
    if (!track) throw new Error('no track');
    expect(positionAt(track, -5)).toEqual([0, 0]);
    expect(positionAt(track, 250)).toEqual([25, 0]);
    expect(positionAt(track, 1030)).toEqual([100, 0]);
    expect(positionAt(track, 3090)).toEqual([300, 0]);
    expect(positionAt(track, 5370)).toEqual([75, 0]);
    expect(positionAt(track, 99999)).toEqual([0, 0]);
  });

  const day = days(routeData).find((d) => d.id === DEFAULT_DAY);
  if (!day) throw new Error(`no day ${DEFAULT_DAY}`);
  const plan = dealtInTurn(
    routeData,
    day.orders,
    day.vans,
    capacityFor(routeData, day.orders, day.vans),
  );
  const measured = measure(routeData, plan);
  const all = tracks(routeData, leg, plan);

  test('on the real data, every track agrees with measure(): each arrival, and when it is back', () => {
    expect(all.length).toBe(measured.vans.filter((v) => v.stops.length > 0).length);
    for (const track of all) {
      const van = measured.vans[track.van];
      expect(track.stops.map((s) => [s.place, s.arrives])).toEqual(
        van?.stops.map((s) => [s.place, s.arrives]),
      );
      expect(track.back).toBe(van?.back);
      expect(track.points.at(-1)).toBe(van?.back);
    }
  });

  test('on the real data, time never runs backwards, and every track starts and ends at the bakery', () => {
    const bakery = routeData.points[0];
    for (const { points } of all) {
      for (let k = 5; k < points.length; k += 3)
        expect(points[k]).toBeGreaterThanOrEqual(points[k - 3] ?? 0);
      expect(points.slice(0, 3)).toEqual([bakery?.x, bakery?.y, 0]);
      expect(points.slice(-3, -1)).toEqual([bakery?.x, bakery?.y]);
    }
  });
});

describe('the camera', () => {
  const box = boxFor([0, 0, 2000, 2564], 3 * 3600 + 1);

  test('the box rounds the time axis up to whole hours, and its center is the box’s middle', () => {
    expect(box.seconds).toBe(4 * 3600);
    expect(hourMarks(box)).toEqual([3600, 7200, 10800, 14400]);
    expect(box.center[1]).toBeCloseTo((box.seconds * box.scale) / 2);
    expect(boxFor([0, 0, 10, 10], 0).seconds).toBe(3600);
  });

  test('the camera’s axes are unit length and at right angles, and up leans toward world up', () => {
    const { right, up, back } = axes(DEFAULT_VIEW);
    const dot = (a: readonly number[], b: readonly number[]) =>
      a.reduce((s, v, k) => s + v * (b[k] ?? 0), 0);
    for (const v of [right, up, back]) expect(Math.hypot(...v)).toBeCloseTo(1);
    expect(dot(right, up)).toBeCloseTo(0);
    expect(dot(right, back)).toBeCloseTo(0);
    expect(dot(up, back)).toBeCloseTo(0);
    expect(up[1]).toBeGreaterThan(0);
    expect(right[1]).toBe(0);
  });

  test('known answer: looking straight down from the south, the floor is the map, upside up', () => {
    const view = { azimuth: 0, elevation: Math.PI / 2 - 1e-9 };
    const b = boxFor([0, 0, 100, 100], 3600);
    const [a, bb, c, d] = floorMatrix(view, b);
    expect([a, bb, c, d].map((v) => Math.round((v ?? 0) * 1e6) / 1e6 + 0)).toEqual([1, 0, 0, 1]);
  });

  test('the floor matrix lays every floor point where project() puts it', () => {
    const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0] = floorMatrix(DEFAULT_VIEW, box);
    for (const [x, y] of [
      [0, 0],
      [2000, 0],
      [700, 2564],
      [1234, 567],
    ] as const) {
      const [u, v] = project(DEFAULT_VIEW, box, [x, 0, y]);
      expect(a * x + c * y + e).toBeCloseTo(u);
      expect(b * x + d * y + f).toBeCloseTo(-v);
    }
  });

  test('the frame holds every corner of the box, the time axis’s top included', () => {
    const f = frame(DEFAULT_VIEW, box, 0);
    const top = box.seconds * box.scale;
    for (const x of [0, 2000])
      for (const z of [0, 2564])
        for (const y of [0, top]) {
          const [u, v] = project(DEFAULT_VIEW, box, [x, y, z]);
          expect(u).toBeGreaterThanOrEqual(f.left - 1e-9);
          expect(u).toBeLessThanOrEqual(f.right + 1e-9);
          expect(v).toBeGreaterThanOrEqual(f.bottom - 1e-9);
          expect(v).toBeLessThanOrEqual(f.top + 1e-9);
        }
  });
});

describe('simplifying a line', () => {
  test('known answers: a straight line keeps its ends; a corner past the tolerance stays', () => {
    expect(simplify([0, 0, 1, 0, 2, 0, 3, 0], 0.5)).toEqual([0, 0, 3, 0]);
    expect(simplify([0, 0, 5, 1, 10, 0], 2)).toEqual([0, 0, 10, 0]);
    expect(simplify([0, 0, 5, 3, 10, 0], 2)).toEqual([0, 0, 5, 3, 10, 0]);
    expect(simplify([0, 0, 1, 1], 0)).toEqual([0, 0, 1, 1]);
  });

  test('a real track loses most of its points and none of its shape beyond the tolerance', () => {
    const day = days(routeData).find((d) => d.id === DEFAULT_DAY);
    if (!day) throw new Error('no day');
    const plan = dealtInTurn(
      routeData,
      day.orders,
      day.vans,
      capacityFor(routeData, day.orders, day.vans),
    );
    const box = boxFor(routeData.viewBox, measure(routeData, plan).back);
    for (const track of tracks(routeData, leg, plan)) {
      const full = screenLine(DEFAULT_VIEW, box, track, 0);
      const kept = screenLine(DEFAULT_VIEW, box, track, 2);
      expect(kept.length).toBeLessThan(full.length / 2);
      expect(kept.slice(0, 2)).toEqual(full.slice(0, 2));
      expect(kept.slice(-2)).toEqual(full.slice(-2));
    }
  });
});

describe('the 3D camera’s pose', () => {
  const box = boxFor([0, 0, 2000, 2564], 3 * 3600);
  const f = frame(DEFAULT_VIEW, box);
  const aspect = (f.right - f.left) / (f.top - f.bottom);

  test('at the default view and the picture’s aspect, every point lands where the picture draws it', () => {
    const at = pose(DEFAULT_VIEW, box, aspect);
    for (const p of [
      [0, 0, 0],
      [2000, 0, 2564],
      [1000, 3 * 3600 * box.scale, 300],
      [123, 4567, 890],
    ] as const) {
      const [u, v] = project(DEFAULT_VIEW, box, p);
      // The picture's viewBox starts at (left, -top) and is as wide and tall as the frame.
      const picture = [(u - f.left) / (f.right - f.left), (-v + f.top) / (f.top - f.bottom)];
      const [x, y] = onCanvas(DEFAULT_VIEW, box, at, p);
      expect(x).toBeCloseTo(picture[0] ?? 0, 9);
      expect(y).toBeCloseTo(picture[1] ?? 0, 9);
    }
  });

  test('a wider canvas widens the frame, never crops it: the box’s corners stay inside', () => {
    for (const a of [aspect / 2, aspect * 2]) {
      const view = { azimuth: 1.1, elevation: 0.3 };
      const at = pose(view, box, a);
      expect(at.half.w / at.half.h).toBeCloseTo(a, 9);
      for (const x of [0, 2000])
        for (const z of [0, 2564])
          for (const y of [0, box.seconds * box.scale]) {
            const [cx, cy] = onCanvas(view, box, at, [x, y, z]);
            for (const c of [cx, cy]) {
              expect(c).toBeGreaterThanOrEqual(0);
              expect(c).toBeLessThanOrEqual(1);
            }
          }
    }
  });
});

describe('the vans’ lines in 3D', () => {
  test('known answer: van A is solid, and every other van has a rhythm of its own', () => {
    expect(VAN_DASHES[0]).toBeNull();
    const rhythms = VAN_DASHES.slice(1).map((d) => {
      const [dash = 0, gap = 0] = d ?? [];
      return { period: dash + gap, duty: dash / (dash + gap) };
    });
    // Two patterns read apart when their dash share or their period differs by a third or more.
    for (let i = 0; i < rhythms.length; i++)
      for (let j = i + 1; j < rhythms.length; j++) {
        const a = rhythms[i];
        const b = rhythms[j];
        if (!a || !b) continue;
        const duty = Math.abs(a.duty - b.duty) / Math.max(a.duty, b.duty);
        const period = Math.abs(a.period - b.period) / Math.max(a.period, b.period);
        expect(Math.max(duty, period), `vans ${i + 1} and ${j + 1}`).toBeGreaterThanOrEqual(1 / 3);
      }
  });
});
