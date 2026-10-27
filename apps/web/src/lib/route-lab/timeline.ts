import type { RouteData } from './data';
import type { Line } from './legs';
import { BAKERY, type Plan } from './plan';

// A plan in time: each van's day as a line through (x, y, t), the map's viewBox units and seconds
// after leaving the bakery. This is what the space-time cube draws (ADR 0019): Hägerstrand's
// time geography, where a van that drives traces a slope and a van that stands at a stop climbs
// straight up. Plain TypeScript with no DOM, like plan.ts, so the build's picture, the browser's
// cube and the unit tests run the same rules. Times come from the same matrices measure() reads,
// so a track ends exactly when measure() says the van is back.

/** One van's day: points as x, y, t triples, and each stop's place, arrival and departure. */
export interface Track {
  readonly van: number;
  readonly points: readonly number[];
  readonly stops: readonly {
    readonly place: number;
    readonly x: number;
    readonly y: number;
    readonly arrives: number;
    readonly leaves: number;
  }[];
  /** When the van is back at the bakery. */
  readonly back: number;
}

/** Every van with at least one stop, in van order. A van left at home has no track. */
export function tracks(data: RouteData, leg: (i: number, j: number) => Line, plan: Plan): Track[] {
  const n = data.points.length;
  const out: Track[] = [];
  plan.routes.forEach((route, van) => {
    if (route.length === 0) return;
    const points: number[] = [];
    const stops: Track['stops'][number][] = [];
    let clock = 0;
    const places = [BAKERY, ...route, BAKERY];
    for (let k = 1; k < places.length; k++) {
      const from = places[k - 1] ?? BAKERY;
      const to = places[k] ?? BAKERY;
      drive(points, leg(from, to), clock, data.durations[from * n + to] ?? 0);
      clock += data.durations[from * n + to] ?? 0;
      if (k < places.length - 1) {
        const p = data.points[to];
        const x = p?.x ?? 0;
        const y = p?.y ?? 0;
        stops.push({ place: to, x, y, arrives: clock, leaves: clock + data.serviceSeconds });
        clock += data.serviceSeconds;
        // Handing the order over: the van stands still while time goes up.
        points.push(x, y, clock);
      }
    }
    out.push({ van, points, stops, back: clock });
  });
  return out;
}

/** Appends one leg, its time spread along the road by length: a van drives the leg at one speed.
 *  A point that repeats the last one is left out, so a track has no zero-length step. */
function drive(points: number[], line: Line, start: number, seconds: number): void {
  let length = 0;
  for (let k = 2; k < line.length; k += 2)
    length += Math.hypot(
      (line[k] ?? 0) - (line[k - 2] ?? 0),
      (line[k + 1] ?? 0) - (line[k - 1] ?? 0),
    );
  let along = 0;
  for (let k = 0; k < line.length; k += 2) {
    if (k > 0)
      along += Math.hypot(
        (line[k] ?? 0) - (line[k - 2] ?? 0),
        (line[k + 1] ?? 0) - (line[k - 1] ?? 0),
      );
    const x = line[k] ?? 0;
    const y = line[k + 1] ?? 0;
    const t = start + (length > 0 ? (seconds * along) / length : k === 0 ? 0 : seconds);
    const last = points.length - 3;
    if (last >= 0 && points[last] === x && points[last + 1] === y && points[last + 2] === t)
      continue;
    points.push(x, y, t);
  }
}

/** Where a van is at time t: on the road between two points, at a stop, or at the bakery before
 *  it leaves and after it is back. A binary search, since the cube asks on every frame of play. */
export function positionAt(track: Track, t: number): readonly [number, number] {
  const p = track.points;
  const count = p.length / 3;
  if (count === 0) return [0, 0];
  if (t <= (p[2] ?? 0)) return [p[0] ?? 0, p[1] ?? 0];
  if (t >= (p[p.length - 1] ?? 0)) return [p[p.length - 3] ?? 0, p[p.length - 2] ?? 0];
  let lo = 0;
  let hi = count - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if ((p[mid * 3 + 2] ?? 0) <= t) lo = mid;
    else hi = mid;
  }
  const t0 = p[lo * 3 + 2] ?? 0;
  const t1 = p[hi * 3 + 2] ?? 0;
  const f = t1 > t0 ? (t - t0) / (t1 - t0) : 0;
  return [
    (p[lo * 3] ?? 0) + f * ((p[hi * 3] ?? 0) - (p[lo * 3] ?? 0)),
    (p[lo * 3 + 1] ?? 0) + f * ((p[hi * 3 + 1] ?? 0) - (p[lo * 3 + 1] ?? 0)),
  ];
}
