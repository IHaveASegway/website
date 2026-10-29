import type { RouteData } from './data';
import { formatDuration, NBSP } from './format';

export { formatDuration };

// The Route Lab's domain core: plain TypeScript with no DOM and no platform import, so the build
// (the picture without JavaScript), the browser and the unit tests run the same rules (lab.md,
// "One domain core per demo"). Two plans for the same orders and vans: the orders dealt to the vans
// in turn, as they came in, and VROOM's. VROOM itself runs elsewhere (a Web Worker in the browser,
// Node at build); this module builds its input and reads its output.

/** Point 0 is the bakery: every van starts and ends there. */
export const BAKERY = 0;

/** One van's stops, in the order it drives them, from the bakery and back. */
export type Route = readonly number[];

/** A plan: one route per van, in van order, and any order no van could take. */
export interface Plan {
  readonly routes: readonly Route[];
  readonly unassigned: readonly number[];
}

/** How much more than its share of the day's boxes a van may take. */
export const SHARE = 1.3;

/** Boxes a van holds before dealing is checked: 1.3 times its share of the day's boxes, rounded
 *  up, and never fewer than the largest order. The pipeline's ready-made days use this rule. */
export function shareCapacity(data: RouteData, orders: readonly number[], vans: number): number {
  const qty = orders.map((i) => data.points[i]?.qty ?? 0);
  const boxes = qty.reduce((sum, q) => sum + q, 0);
  return Math.max(1, ...qty, Math.ceil((boxes / Math.max(1, vans)) * SHARE));
}

/** Boxes a van holds: the share rule above, raised until the orders dealt in turn all fit. Dealing
 *  can leave an order no van has room for while the vans hold enough between them (2, 2 and 2 boxes,
 *  then 3, in three vans of 4), and then the two plans would not serve the same orders. VROOM still
 *  has to balance the loads. The ready-made days need no raise. */
export function capacityFor(data: RouteData, orders: readonly number[], vans: number): number {
  let capacity = shareCapacity(data, orders, vans);
  while (dealtInTurn(data, orders, vans, capacity).unassigned.length > 0) capacity++;
  return capacity;
}

/**
 * "As the orders came in": each order goes to the next van in turn, like dealing cards, skipping a
 * van with no room left, and each van drives its orders in the order they arrived.
 */
export function dealtInTurn(
  data: RouteData,
  orders: readonly number[],
  vans: number,
  capacity: number,
): Plan {
  const routes: number[][] = Array.from({ length: vans }, () => []);
  const loads = routes.map(() => 0);
  const unassigned: number[] = [];
  let next = 0;
  for (const order of orders) {
    const qty = data.points[order]?.qty ?? 0;
    let placed = false;
    for (let k = 0; k < vans && !placed; k++) {
      const van = (next + k) % vans;
      if ((loads[van] ?? 0) + qty <= capacity) {
        routes[van]?.push(order);
        loads[van] = (loads[van] ?? 0) + qty;
        next = (van + 1) % vans;
        placed = true;
      }
    }
    if (!placed) unassigned.push(order);
  }
  return { routes, unassigned };
}

/** How hard VROOM looks: its -x level. 5, its default, up to 40 orders; 3 above, which on the
 *  largest day here finds the same plan in about a quarter of the time (ADR 0016). */
export const explorationFor = (orders: number): number => (orders > 40 ? 3 : 5);

/** VROOM's input format (VROOM docs/API.md), as much of it as this demo uses. */
export interface VroomInput {
  readonly vehicles: readonly {
    id: number;
    start_index: number;
    end_index: number;
    capacity: [number];
  }[];
  readonly jobs: readonly {
    id: number;
    location_index: number;
    delivery: [number];
    service: number;
  }[];
  readonly matrices: { readonly car: { durations: number[][]; distances: number[][] } };
}

/**
 * VROOM's input for these orders and vans. The matrices are cut to the bakery and the orders, in
 * that order, so location k is the k-th of them; a job's id is its place's index, so the output
 * names places directly. Every van starts and ends at the bakery: a van with no end is the shape
 * that reaches an upstream overflow (tools/vroom-wasm/README.md).
 */
export function vroomInput(
  data: RouteData,
  orders: readonly number[],
  vans: number,
  capacity: number,
): VroomInput {
  const n = data.points.length;
  const places = [BAKERY, ...orders];
  const cut = (matrix: readonly number[]) =>
    places.map((from) => places.map((to) => matrix[from * n + to] ?? 0));
  return {
    vehicles: Array.from({ length: vans }, (_, v) => ({
      id: v + 1,
      start_index: 0,
      end_index: 0,
      capacity: [capacity],
    })),
    jobs: orders.map((order, k) => ({
      id: order,
      location_index: k + 1,
      delivery: [data.points[order]?.qty ?? 0],
      service: data.serviceSeconds,
    })),
    matrices: { car: { durations: cut(data.durations), distances: cut(data.distances) } },
  };
}

/** The parts of VROOM's output this demo reads. */
export interface VroomOutput {
  readonly code: number;
  readonly error?: string;
  readonly summary?: { readonly cost: number };
  readonly routes?: readonly {
    readonly vehicle: number;
    readonly steps: readonly { readonly type: string; readonly id?: number }[];
  }[];
  readonly unassigned?: readonly { readonly id: number }[];
}

/** VROOM's answer as a plan: each van's jobs in step order; a van VROOM left at home has none. */
export function fromVroom(output: VroomOutput, vans: number): Plan {
  if (output.code !== 0) throw new Error(`VROOM: ${output.error ?? `code ${output.code}`}`);
  const routes: number[][] = Array.from({ length: vans }, () => []);
  for (const route of output.routes ?? []) {
    routes[route.vehicle - 1] = route.steps.flatMap((s) =>
      s.type === 'job' && s.id !== undefined ? [s.id] : [],
    );
  }
  return { routes, unassigned: (output.unassigned ?? []).map((u) => u.id) };
}

/** One van's day, measured on the matrices. Times are seconds after leaving the bakery. */
export interface VanDay {
  readonly stops: readonly { readonly place: number; readonly arrives: number }[];
  /** Seconds behind the wheel, back to the bakery included. */
  readonly drive: number;
  readonly metres: number;
  readonly boxes: number;
  /** When the van is back: driving plus handing over every order. */
  readonly back: number;
}

/** A plan, measured: each van's day, and the totals the readout compares. */
export interface Measured {
  readonly vans: readonly VanDay[];
  readonly drive: number;
  readonly metres: number;
  /** When the last van with a stop is back, in seconds after leaving: the day's length. 0 with
   *  no stop. Total driving says what a plan costs; this says when the day is done, which is what
   *  another van buys. */
  readonly back: number;
}

export function measure(data: RouteData, plan: Plan): Measured {
  const n = data.points.length;
  const vans = plan.routes.map((route): VanDay => {
    let at = BAKERY;
    let drive = 0;
    let metres = 0;
    let clock = 0;
    const stops = route.map((place) => {
      drive += data.durations[at * n + place] ?? 0;
      metres += data.distances[at * n + place] ?? 0;
      clock += data.durations[at * n + place] ?? 0;
      const arrives = clock;
      clock += data.serviceSeconds;
      at = place;
      return { place, arrives };
    });
    drive += data.durations[at * n + BAKERY] ?? 0;
    metres += data.distances[at * n + BAKERY] ?? 0;
    clock += data.durations[at * n + BAKERY] ?? 0;
    const boxes = route.reduce((sum, place) => sum + (data.points[place]?.qty ?? 0), 0);
    return { stops, drive, metres, boxes, back: clock };
  });
  return {
    vans,
    drive: vans.reduce((sum, v) => sum + v.drive, 0),
    metres: vans.reduce((sum, v) => sum + v.metres, 0),
    back: Math.max(0, ...vans.filter((v) => v.stops.length > 0).map((v) => v.back)),
  };
}

/** The boxes these orders fill. */
export const boxesOf = (data: RouteData, orders: readonly number[]): number =>
  orders.reduce((sum, i) => sum + (data.points[i]?.qty ?? 0), 0);

/** Seconds from the bakery to a place by the fastest road, row 0 of the matrix: OSRM's car
 *  profile, as the isochrones are. */
export const fromBakery = (data: RouteData, place: number): number =>
  data.durations[BAKERY * data.points.length + place] ?? 0;

/** How long a solve took in this browser: "62 ms" under a second, "1.25 s" from one. */
export const solveTime = (ms: number): string =>
  ms < 1000 ? `${Math.max(1, Math.round(ms))}${NBSP}ms` : `${(ms / 1000).toFixed(2)}${NBSP}s`;

/** A distance in miles, to a tenth: "74.8 mi". */
export const formatMiles = (metres: number): string => `${(metres / 1609.344).toFixed(1)}${NBSP}mi`;

/** How much less driving one plan needs than another, in whole percent. */
export const percentLess = (before: number, after: number): number =>
  before > 0 ? Math.round(((before - after) / before) * 100) : 0;

/** A van's name: A, B, C, D. */
export const vanName = (van: number): string => String.fromCharCode(65 + van);
