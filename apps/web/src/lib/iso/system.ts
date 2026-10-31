// Home's drawing (docs/design/overhaul.md, "The isometric drawing"; ADR 0027): Joseph's five labs
// wired into one system on one isometric ground plane, worked out at build and drawn as SVG by
// components/iso/System.astro. This module is pure: the model, the projection and every path, so
// the unit tests ask it the same questions the page does (test/iso.test.ts).
//
// The system is the bakery the labs share. Two kinds of request come in at the plane's near-left
// edge. Orders wait in the Queue Lab's broker and fan out to its workers; the workers write to the
// database, which is the Raft Lab's cluster, and hand the day's orders to the Route Lab's planner,
// whose vans drive the road loop. Menu reads go to the Cache Lab's nodes, in front of the same
// database. Each night the Backfill Lab's steps load the database's day into the warehouse, and
// the warehouse writes the reports. How many workers, cache nodes, servers, vans and reports it
// draws is read from each lab's own opening run (index.astro), so the drawing never disagrees
// with the labs it links to.

/** The labs, by slug, as lib/lab.ts names them. */
export type Lab = 'routes' | 'raft' | 'queue' | 'cache' | 'backfill';

/** What the drawing counts from each lab's own opening run. */
export interface Counts {
  /** The Queue Lab's workers. */
  readonly workers: number;
  /** The Cache Lab's nodes. */
  readonly nodes: number;
  /** The Raft Lab's servers. */
  readonly servers: number;
  /** The index of the server that leads in the Raft Lab's opening run, or -1. */
  readonly leader: number;
  /** The Route Lab's vans on its default day. */
  readonly vans: number;
  /** The days the Backfill Lab's week reports. */
  readonly days: number;
}

/** A point in the model: x runs to the lower right on the screen, y to the lower left, z up. */
type P3 = readonly [number, number, number];

/** One solid's faces, each a closed path in the picture's pixels. A box shows three faces; a
 *  cylinder its top and its side. */
export interface Solid {
  readonly kind: 'box' | 'cylinder';
  /** The face lit from above. */
  readonly top: string;
  /** A box's face toward the lower left, or a cylinder's side. */
  readonly left: string;
  /** A box's face toward the lower right; empty on a cylinder. */
  readonly right: string;
  /** A cylinder's bands, the arcs that mark it as a store; empty on a box. */
  readonly bands: string;
  /** The solid's base on the ground: what the exploded view leaves behind. */
  readonly footprint: string;
  /** From the base's nearest corner down to the ground at full lift, so the exploded view draws a
   *  drop line from each solid to its footprint. */
  readonly drop: string;
  /** Marks a part with a role of its own: the Raft leader, a cache node, a step. */
  readonly role?: 'leader' | 'cache' | 'step' | 'sheet' | undefined;
  /** Painter's order: further back draws first. */
  readonly depth: number;
  /** Its extent in the picture, left, top, right, bottom: what a lab card's glyph frames. */
  readonly bounds: Bounds;
}

/** An extent in the picture's pixels: left, top, right, bottom. */
export type Bounds = readonly [number, number, number, number];

/** The extent that holds every one of these. */
export const union = (all: readonly Bounds[]): Bounds => [
  Math.min(...all.map((b) => b[0])),
  Math.min(...all.map((b) => b[1])),
  Math.max(...all.map((b) => b[2])),
  Math.max(...all.map((b) => b[3])),
];

/** A lab's part of the drawing: its solids, its name, and how far it lifts in the exploded view. */
export interface Part {
  readonly lab: Lab;
  /** The lab's name, as the drawing labels it. */
  readonly name: string;
  /** What the part is, in a few words with its count: "Broker and 3 workers". */
  readonly caption: string;
  readonly solids: readonly Solid[];
  /** Where the label's words start, and the line from the part to them. */
  readonly label: { readonly x: number; readonly y: number; readonly anchor: 'start' | 'end' };
  readonly pointer: string;
  /** How far the part lifts at the end of the exploded view, in pixels. */
  readonly lift: number;
  /** What it draws on the ground beside its solids, for its lab card's glyph: the Route Lab's road
   *  and vans. */
  readonly ground?: { readonly road: string; readonly vans: string } | undefined;
  /** The extent of its solids, and of its ground. */
  readonly bounds: Bounds;
}

/** A wire on the ground, and the lab whose wire it is (lit while that lab's part is pointed at). */
export interface Wire {
  readonly lab: Lab;
  readonly d: string;
  /** Requests travel along it while the drawing runs. */
  readonly flow: boolean;
  /** The nightly batch's wire, drawn dashed: it runs once a day, not all the time. */
  readonly nightly: boolean;
}

export interface System {
  readonly width: number;
  readonly height: number;
  /** The ground plane's outline, and its lattice of unit lines. */
  readonly plane: string;
  readonly lattice: string;
  /** Where requests come in: two arrows at the plane's edge, and what each lane carries. */
  readonly inlets: string;
  readonly sources: readonly { readonly x: number; readonly y: number; readonly words: string }[];
  readonly wires: readonly Wire[];
  /** In back-to-front order. */
  readonly parts: readonly Part[];
  /** The stampede: the burst of reads that hits the cache at once. */
  readonly burst: readonly string[];
  /** The one fetch coalescing lets through, from the cache to the database. */
  readonly fetch: string;
  /** The leader's heartbeats, one path to each follower. */
  readonly heartbeats: readonly string[];
  /** The nightly batch's run, from the database to the reports. */
  readonly nightly: string;
  /** The vans' road, a closed loop, and the dash pattern that spaces the vans along it. */
  readonly road: string;
  readonly vans: string;
}

/** A unit of the model, in pixels, and the projection's slopes: 30° isometric. */
export const UNIT = 30;
const C = Math.cos(Math.PI / 6);
const S = 0.5;
/** A unit of height, a little shorter than a unit across, so the solids read as low and wide. */
const Z = 0.82;

/** The plane's extent, in units. */
export const PLANE = { x: 13.5, y: 10 } as const;

/** Room around the plane: above it for the exploded view's highest lift and the labels, and to
 *  the sides for the labels. */
const PAD = { top: 96, side: 40, right: 60, bottom: 12 } as const;

const ORIGIN_X = PAD.side + (PLANE.y + 1.4) * C * UNIT;
const ORIGIN_Y = PAD.top;

const round = (n: number): number => Math.round(n * 10) / 10;

/** The picture's pixel for a point of the model. */
export function project([x, y, z]: P3): readonly [number, number] {
  return [
    round(ORIGIN_X + (x - y) * C * UNIT),
    round(ORIGIN_Y + (x + y) * S * UNIT - z * Z * UNIT),
  ];
}

const pt = (p: P3): string => project(p).join(' ');
const poly = (points: readonly P3[]): string => `M${points.map(pt).join('L')}Z`;
const line = (points: readonly P3[]): string => `M${points.map(pt).join('L')}`;

/** A box from (x, y, z), w along x, d along y and h tall: its three visible faces. */
export function box(x: number, y: number, z: number, w: number, d: number, h: number) {
  const [x1, y1, z1] = [x + w, y + d, z + h];
  return {
    kind: 'box' as const,
    top: poly([
      [x, y, z1],
      [x1, y, z1],
      [x1, y1, z1],
      [x, y1, z1],
    ]),
    // The face at y1 looks to the lower left; the face at x1 to the lower right.
    left: poly([
      [x, y1, z1],
      [x1, y1, z1],
      [x1, y1, z],
      [x, y1, z],
    ]),
    right: poly([
      [x1, y, z1],
      [x1, y1, z1],
      [x1, y1, z],
      [x1, y, z],
    ]),
    bands: '',
    footprint: poly([
      [x, y, 0],
      [x1, y, 0],
      [x1, y1, 0],
      [x, y1, 0],
    ]),
    corner: [x1, y1, z] as P3,
    depth: x + y + w + d,
    bounds: union(
      ([x, x1] as const).flatMap((px) =>
        ([y, y1] as const).flatMap((py) =>
          ([z, z1] as const).map((pz) => {
            const [sx, sy] = project([px, py, pz]);
            return [sx, sy, sx, sy] as Bounds;
          }),
        ),
      ),
    ),
  };
}

/** The ellipse a horizontal circle of radius r projects to: its half-width and half-height. */
export const ellipse = (r: number) => ({
  rx: round(r * Math.SQRT2 * C * UNIT),
  ry: round(r * Math.SQRT2 * S * UNIT),
});

/** A cylinder standing at (x, y) on z, radius r and h tall: its top, its side and two bands. */
export function cylinder(x: number, y: number, z: number, r: number, h: number) {
  const { rx, ry } = ellipse(r);
  const [cx, top] = project([x, y, z + h]);
  const [, base] = project([x, y, z]);
  const [, ground] = project([x, y, 0]);
  const l = round(cx - rx);
  const rr = round(cx + rx);
  const ring = (cy: number) => `M${l} ${cy}A${rx} ${ry} 0 0 0 ${rr} ${cy}`;
  const third = round((base - top) / 3);
  return {
    kind: 'cylinder' as const,
    top: `M${l} ${top}A${rx} ${ry} 0 1 0 ${rr} ${top}A${rx} ${ry} 0 1 0 ${l} ${top}Z`,
    left: `M${l} ${top}L${l} ${base}A${rx} ${ry} 0 0 0 ${rr} ${base}L${rr} ${top}Z`,
    right: '',
    bands: `${ring(round(top + third))}${ring(round(top + third * 2))}`,
    footprint: `M${l} ${ground}A${rx} ${ry} 0 1 0 ${rr} ${ground}A${rx} ${ry} 0 1 0 ${l} ${ground}Z`,
    corner: [x + r * 0.71, y + r * 0.71, z] as P3,
    depth: 2 * (x + y),
    bounds: [l, round(top - ry), rr, round(base + ry)] as Bounds,
  };
}

type Shape = ReturnType<typeof box> | ReturnType<typeof cylinder>;

/** A shape as a solid of a part: its drop line from its base to where it stands at full lift. */
function solid(shape: Shape, lift: number, role?: Solid['role']): Solid {
  const [cx, cy] = project(shape.corner);
  return {
    kind: shape.kind,
    top: shape.top,
    left: shape.left,
    right: shape.right,
    bands: shape.bands,
    footprint: shape.footprint,
    drop: `M${cx} ${cy}v${lift}`,
    role,
    depth: shape.depth,
    bounds: shape.bounds,
  };
}

/** Points evenly spaced on a line: n centres from a to b. */
const spread = (n: number, a: number, b: number): number[] =>
  n <= 1 ? [(a + b) / 2] : Array.from({ length: n }, (_, i) => a + ((b - a) * i) / (n - 1));

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Where each lab's part stands on the plane, in units. Two lanes of requests come in at the
 *  plane's near-left edge: menu reads along y = 2.6, orders along y = 7.4. */
const LANE = { reads: 2.6, orders: 7.4 } as const;
const RAFT = { x: 7.1, y: 2.7, r: 1.8 } as const;
const ROAD = { x0: 10.3, x1: 12.6, y0: 5.9, y1: 9.3, r: 0.6 } as const;

/** The lift of each part at the end of the exploded view, in pixels: the stores lowest, the edge
 *  highest. home.css lifts each part by the same amount (test/iso.test.ts). */
export const LIFT = { raft: 22, backfill: 30, cache: 44, queue: 44, routes: 58 } as const;

/** The whole drawing for these counts. */
export function system(counts: Counts): System {
  const workers = Math.max(1, Math.min(counts.workers, 5));
  const nodes = Math.max(1, Math.min(counts.nodes, 6));
  const servers = Math.max(3, Math.min(counts.servers, 7));
  const vans = Math.max(1, Math.min(counts.vans, 6));
  const days = Math.max(1, Math.min(counts.days, 7));
  const g = (x: number, y: number): P3 => [x, y, 0];

  // Cache: the nodes in up to two rows across the reads' lane, in front of the database.
  const rows = nodes > 3 ? 2 : 1;
  const perRow = Math.ceil(nodes / rows);
  const NODE = 0.95;
  const cacheYs = spread(perRow, LANE.reads - 0.62, LANE.reads + 0.62);
  const cacheBoxes = Array.from({ length: nodes }, (_, i) => {
    const row = Math.floor(i / perRow);
    const y = cacheYs[i % perRow] ?? LANE.reads;
    return box(1.7 + row * 1.2, y - NODE / 2 + (perRow > 1 ? 0 : 0), 0, NODE, NODE * 0.92, 1.25);
  });
  const cacheEnd = 1.7 + (rows - 1) * 1.2 + NODE;

  // Raft: the servers on a ring, the database the rest of the system writes to and reads from.
  const serverAt = Array.from({ length: servers }, (_, i) => {
    const a = (-3 * Math.PI) / 4 + (i * 2 * Math.PI) / servers;
    return [round(RAFT.x + RAFT.r * Math.cos(a)), round(RAFT.y + RAFT.r * Math.sin(a))] as const;
  });
  const serverCyls = serverAt.map(([x, y]) => cylinder(x, y, 0, 0.52, 1.35));
  const nearest = (x: number, y: number) =>
    serverAt.reduce((best, s) =>
      Math.hypot(s[0] - x, s[1] - y) < Math.hypot(best[0] - x, best[1] - y) ? s : best,
    );

  // Queue: the broker, a long tank along the orders' lane, then a worker for each the lab runs,
  // spread across the lane.
  const broker = box(0.9, LANE.orders - 0.65, 0, 2.9, 1.3, 1.15);
  const workerYs = spread(workers, LANE.orders - 1.8, LANE.orders + 1.8);
  const workerBoxes = workerYs.map((y) => box(5, y - 0.5, 0, 1, 1, 1));

  // Routes: the planner, with the solver on top of it, then the road the vans drive.
  const planner = box(7.4, LANE.orders - 1, 0, 2, 2, 1.05);
  const chip = box(7.95, LANE.orders - 0.45, 1.05, 0.9, 0.9, 0.22);

  // Backfill: three steps beyond the database, then the warehouse, then the reports, a sheet for
  // each day of the week the lab backfills.
  const stepXs = [9.55, 10.45, 11.35];
  const steps = stepXs.map((x) => box(x, LANE.reads - 0.35, 0, 0.7, 0.7, 0.55));
  const warehouse = cylinder(12.65, LANE.reads, 0, 0.72, 1.45);
  const sheets = Array.from({ length: days }, (_, i) =>
    box(11.85, 4.1, i * 0.09, 1.25, 1.05, 0.03),
  );

  // The road: a loop with rounded corners, and the vans spread evenly along it.
  const { x0, x1, y0, y1, r } = ROAD;
  const roadBounds = union(
    [g(x0, y0), g(x1, y0), g(x1, y1), g(x0, y1)].map((p) => {
      const [px, py] = project(p);
      return [px - 5, py - 5, px + 5, py + 5] as Bounds;
    }),
  );
  const q = (x: number, y: number) => project(g(x, y)).join(' ');
  const road =
    `M${q(x0 + r, y0)}L${q(x1 - r, y0)}Q${q(x1, y0)} ${q(x1, y0 + r)}` +
    `L${q(x1, y1 - r)}Q${q(x1, y1)} ${q(x1 - r, y1)}L${q(x0 + r, y1)}` +
    `Q${q(x0, y1)} ${q(x0, y1 - r)}L${q(x0, y0 + r)}Q${q(x0, y0)} ${q(x0 + r, y0)}Z`;
  const vansDash = `3.4 ${round(100 / vans - 3.4)}`;

  // Each label stands off the plane, in the room around it, at the end of a pointer that rises or
  // drops from a point on its part and then runs along: its words start just past the pointer.
  const callout = (from: P3, dy: number, dx: number) => {
    const [x, y] = project(from);
    const ly = round(y + dy);
    const lx = round(x + dx);
    const anchor = dx < 0 ? ('end' as const) : ('start' as const);
    return {
      pointer: `M${x} ${y}V${ly}H${lx}`,
      label: { x: round(lx + (dx < 0 ? -6 : 6)), y: round(ly + 5), anchor },
    };
  };
  const top = serverAt.reduce((a, b) => (a[0] + a[1] <= b[0] + b[1] ? a : b));
  const at = {
    cache: callout([1.7, (cacheYs[0] ?? LANE.reads) - NODE / 2, 1.25], -50, -50),
    raft: callout([top[0], top[1] - 0.52, 1.35], -46, 50),
    backfill: callout([13.1, 4.1, days * 0.09], 40, 30),
    queue: callout([0.9, LANE.orders - 0.65, 1.15], -32, -34),
    routes: callout([7.4, LANE.orders + 1, 0], 67, -20),
  };
  const drafts: Omit<Part, 'bounds'>[] = [
    {
      lab: 'cache',
      name: 'Cache',
      caption: `${plural(nodes, 'node')}, coalescing`,
      solids: cacheBoxes.map((b) => solid(b, LIFT.cache, 'cache')),
      ...at.cache,
      lift: LIFT.cache,
    },
    {
      lab: 'raft',
      name: 'Raft',
      caption: `${plural(servers, 'server')}, one database`,
      solids: serverCyls.map((c, i) =>
        solid(c, LIFT.raft, i === counts.leader ? 'leader' : undefined),
      ),
      ...at.raft,
      lift: LIFT.raft,
    },
    {
      lab: 'backfill',
      name: 'Backfill',
      caption: `Nightly, ${plural(days, 'report')}`,
      solids: [
        ...steps.map((b) => solid(b, LIFT.backfill, 'step')),
        solid(warehouse, LIFT.backfill),
        ...sheets.map((b) => solid(b, LIFT.backfill, 'sheet')),
      ],
      ...at.backfill,
      lift: LIFT.backfill,
    },
    {
      lab: 'queue',
      name: 'Queue',
      caption: `Broker and ${plural(workers, 'worker')}`,
      solids: [solid(broker, LIFT.queue), ...workerBoxes.map((b) => solid(b, LIFT.queue))],
      ...at.queue,
      lift: LIFT.queue,
    },
    {
      lab: 'routes',
      name: 'Routes',
      caption: `Planner and ${plural(vans, 'van')}`,
      solids: [solid(planner, LIFT.routes), solid(chip, LIFT.routes)],
      ground: { road, vans: vansDash },
      ...at.routes,
      lift: LIFT.routes,
    },
  ];

  // Painter's order for the parts: by their furthest-back solid, so a part in front draws over one
  // behind it; within a part, back to front too.
  const parts: Part[] = drafts
    .map((part) => {
      const solids = [...part.solids].sort(
        (a, b) => a.depth - b.depth || (a.kind === 'box' ? 1 : -1),
      );
      const extent = solids.map((s) => s.bounds);
      if (part.ground) extent.push(roadBounds);
      return { ...part, solids, bounds: union(extent) };
    })
    .sort(
      (a, b) =>
        Math.min(...a.solids.map((s) => s.depth)) - Math.min(...b.solids.map((s) => s.depth)),
    );

  const lowest = workerYs[0] ?? LANE.orders;
  const toRaft = nearest(5.5, lowest);
  const fromCache = nearest(cacheEnd, LANE.reads);
  const toBackfill = nearest(9.5, LANE.reads);
  const wire = (lab: Lab, points: readonly P3[], flow: boolean, nightly = false): Wire => ({
    lab,
    d: line(points),
    flow,
    nightly,
  });
  const wires: Wire[] = [
    // Menu reads: in at the edge, along the lane to the cache.
    wire('cache', [g(0, LANE.reads), g(1.7, LANE.reads)], true),
    // A miss: the cache to the database.
    wire('cache', [g(cacheEnd, LANE.reads), g(fromCache[0] - 0.5, LANE.reads)], false),
    // Orders: in at the edge, along the lane to the broker.
    wire('queue', [g(0, LANE.orders), g(0.9, LANE.orders)], true),
    // The broker's fan-out to each worker.
    ...workerYs.map((y) =>
      wire('queue', [g(3.8, LANE.orders), g(4.4, LANE.orders), g(4.4, y), g(5, y)], true),
    ),
    // The workers hand the day's orders to the planner.
    ...workerYs.map((y) =>
      wire('routes', [g(6, y), g(6.7, y), g(6.7, LANE.orders), g(7.4, LANE.orders)], true),
    ),
    // The planner to the road.
    wire('routes', [g(9.4, LANE.orders), g(ROAD.x0, LANE.orders)], true),
    // The workers write each order to the database: from the furthest-back worker to the ring.
    wire(
      'raft',
      [g(5.5, lowest - 0.5), g(5.5, toRaft[1] + 0.5), g(toRaft[0], toRaft[1] + 0.5)],
      true,
    ),
    // Each night: the database through the steps to the warehouse, then to the reports.
    wire(
      'backfill',
      [g(toBackfill[0] + 0.5, LANE.reads), g(12.65, LANE.reads), g(12.65, 4.1)],
      false,
      true,
    ),
  ];

  // The Raft ring's own wires: the leader to each follower, which the heartbeats travel.
  const leaderIndex = counts.leader >= 0 && counts.leader < servers ? counts.leader : 0;
  const lead = serverAt[leaderIndex] ?? [RAFT.x, RAFT.y];
  const heartbeats = serverAt
    .filter((_, i) => i !== leaderIndex)
    .map(([x, y]) => line([g(lead[0], lead[1]), g(x, y)]));
  wires.push(...heartbeats.map((d) => ({ lab: 'raft' as const, d, flow: false, nightly: false })));

  // The stampede: five reads abreast down the reads' lane at once.
  const burst = spread(5, LANE.reads - 0.8, LANE.reads + 0.8).map((y) =>
    line([g(-0.2, y), g(1.6, y)]),
  );
  const fetch = line([g(cacheEnd, LANE.reads), g(fromCache[0] - 0.5, LANE.reads)]);
  const nightly = wires.find((w) => w.nightly)?.d ?? '';

  // The plane and its lattice, a line every unit.
  const plane = poly([g(0, 0), g(PLANE.x, 0), g(PLANE.x, PLANE.y), g(0, PLANE.y)]);
  const lattice = [
    ...Array.from({ length: PLANE.x - 1 }, (_, i) => line([g(i + 1, 0), g(i + 1, PLANE.y)])),
    ...Array.from({ length: PLANE.y - 1 }, (_, i) => line([g(0, i + 1), g(PLANE.x, i + 1)])),
  ].join('');
  // An arrowhead pointing along +x at each lane's way in, off the plane's edge.
  const head = (y: number) =>
    line([g(-1.1, y), g(-0.15, y)]) + line([g(-0.6, y - 0.3), g(-0.15, y), g(-0.6, y + 0.3)]);
  const inlets = head(LANE.orders) + head(LANE.reads);
  const [readsX, readsY] = project(g(-1.2, LANE.reads));
  const [ordersX, ordersY] = project(g(-1.2, LANE.orders));

  const [right] = project(g(PLANE.x, 0));
  const [, bottom] = project(g(PLANE.x, PLANE.y));
  return {
    width: Math.ceil(right + PAD.right),
    height: Math.ceil(bottom + PAD.bottom),
    plane,
    lattice,
    inlets,
    sources: [
      { x: readsX - 4, y: readsY + 4, words: 'Menu reads' },
      { x: ordersX - 4, y: ordersY + 4, words: 'Orders' },
    ],
    wires,
    parts,
    burst,
    fetch,
    heartbeats,
    nightly,
    road,
    vans: vansDash,
  };
}
