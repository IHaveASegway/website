// Isometric drawings, worked out at build (ADR 0023): Home's Raft cluster, the stack beside How I
// work, and the small pictures on the lab's cards. A point in the world has x and y on the floor and
// z up; the projection is the true isometric one, each floor axis 30° off the horizontal, so a
// floor circle is an ellipse √(3/2) wide by √(1/2) tall. The pages get plain SVG: no script draws a
// line, a theme recolors every face through classes, and what moves is CSS on transform and
// opacity. A page may hold no style of its own, attribute or element (test/csp.test.ts), so the
// stylesheet's keyframes are shared, and a mover's path lives in the SVG transform of the group
// around it: that maps one unit along x to the whole of its path, and the keyframes move it one
// unit. Pure, so test/iso.test.ts asks it the same questions the components do.

export interface P3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface P2 {
  readonly x: number;
  readonly y: number;
}

const COS = Math.cos(Math.PI / 6);
const SIN = 0.5;

/** A world point on the page: +x runs right and down, +y left and down, +z straight up. */
export const project = ({ x, y, z }: P3): P2 => ({ x: (x - y) * COS, y: (x + y) * SIN - z });

/** A number as the markup writes it: one decimal, and never "-0". */
export const fmt = (n: number): string => {
  const v = Math.round(n * 10) / 10;
  return String(Object.is(v, -0) ? 0 : v);
};

/** A polygon's points attribute, from world points. */
export const points = (ps: readonly P3[]): string =>
  ps
    .map(project)
    .map((p) => `${fmt(p.x)},${fmt(p.y)}`)
    .join(' ');

/** The three faces a viewer sees of a box standing on z, its footprint x to x+w by y to y+d, h
 *  tall: the top, the face toward +y (lower left on the page) and the face toward +x (lower
 *  right). */
export interface Prism {
  readonly top: string;
  readonly left: string;
  readonly right: string;
}

export function prism(x: number, y: number, z: number, w: number, d: number, h: number): Prism {
  const X = x + w;
  const Y = y + d;
  const Z = z + h;
  return {
    top: points([
      { x, y, z: Z },
      { x: X, y, z: Z },
      { x: X, y: Y, z: Z },
      { x, y: Y, z: Z },
    ]),
    left: points([
      { x, y: Y, z },
      { x: X, y: Y, z },
      { x: X, y: Y, z: Z },
      { x, y: Y, z: Z },
    ]),
    right: points([
      { x: X, y, z },
      { x: X, y: Y, z },
      { x: X, y: Y, z: Z },
      { x: X, y, z: Z },
    ]),
  };
}

/** A number to four places, for a matrix or a shape drawn in a mover's own units. */
const fine = (n: number): string => {
  const v = Math.round(n * 1e4) / 1e4;
  return String(Object.is(v, -0) ? 0 : v);
};

/** A path on the page as a mover's frame: the SVG transform that maps one unit along x to the
 *  whole path from `from` to `to`, and one unit along y to a pixel across it, and the path's
 *  length, which a shape drawn in the frame divides its lengths along x by to keep its size. */
export function frame(from: P2, to: P2): { readonly transform: string; readonly length: number } {
  const vx = to.x - from.x;
  const vy = to.y - from.y;
  const length = Math.hypot(vx, vy);
  const nx = -vy / length;
  const ny = vx / length;
  return {
    transform: `matrix(${fine(vx)} ${fine(vy)} ${fine(nx)} ${fine(ny)} ${fine(from.x)} ${fine(from.y)})`,
    length,
  };
}

/** A circle on a level plane, as the ellipse it projects to. */
export function floorEllipse(cx: number, cy: number, z: number, r: number) {
  const c = project({ x: cx, y: cy, z });
  return {
    cx: fmt(c.x),
    cy: fmt(c.y),
    rx: fmt(r * COS * Math.SQRT2),
    ry: fmt(r * SIN * Math.SQRT2),
  };
}

/** The SVG matrix that lays text on the face of a box toward +y: its baseline runs along +x, down
 *  and to the right on the page, and its letters stand up the face. */
export const leftFaceMatrix = (at: P3): string => {
  const o = project(at);
  return `matrix(${COS.toFixed(4)} ${SIN} 0 1 ${fmt(o.x)} ${fmt(o.y)})`;
};

/** The box around every point, padded, as a viewBox. */
export function viewBoxOf(ps: readonly P2[], pad: number): string {
  const xs = ps.map((p) => p.x);
  const ys = ps.map((p) => p.y);
  const x = Math.floor(Math.min(...xs) - pad);
  const y = Math.floor(Math.min(...ys) - pad);
  return `${x} ${y} ${Math.ceil(Math.max(...xs) + pad) - x} ${Math.ceil(Math.max(...ys) + pad) - y}`;
}

const corners = (x: number, y: number, z: number, w: number, d: number, h: number): P3[] =>
  [x, x + w].flatMap((cx) =>
    [y, y + d].flatMap((cy) => [z, z + h].map((cz) => ({ x: cx, y: cy, z: cz }))),
  );

// --- Home's Raft cluster ---------------------------------------------------------------------

/** One server of the cluster. */
export interface Server {
  readonly id: number;
  readonly leader: boolean;
  readonly faces: Prism;
  /** The election timer's dial on its roof, and how full it stands, of 100. */
  readonly dial: ReturnType<typeof floorEllipse> & { readonly fill: number };
  /** Its log: a cell per entry on its right face, committed or not. */
  readonly log: readonly { readonly cell: string; readonly committed: boolean }[];
  /** Back to front, the order the servers are painted in. */
  readonly depth: number;
}

/** A heartbeat on its way from the leader to one follower: its frame, from the leader's edge to
 *  the follower's middle, and its dart, drawn in that frame so it keeps its size on the page and
 *  points the way it travels. */
export interface Packet {
  readonly to: number;
  readonly transform: string;
  readonly d: string;
}

export interface Cluster {
  readonly viewBox: string;
  readonly platform: Prism;
  /** The platform's floor lines, a path. */
  readonly floor: string;
  readonly links: readonly { readonly to: number; readonly d: string }[];
  readonly packets: readonly Packet[];
  readonly servers: readonly Server[];
  /** Where the leader's label sits, above its roof. */
  readonly label: P2;
  /** The leader's ripple, a circle on its roof that widens with each heartbeat. */
  readonly ripple: ReturnType<typeof floorEllipse>;
}

export const CLUSTER = {
  /** Half the platform's side, and its thickness. */
  half: 150,
  slab: 14,
  /** The servers stand on a circle this wide around the platform's middle. */
  orbit: 102,
  side: 44,
  height: 56,
  /** Entries in each log: the leader's last is not committed yet. */
  entries: 4,
  /** How full each follower's election timer stands, of 100, by its place after the leader: the
   *  heartbeats keep resetting them, so none is near full. */
  dials: [34, 58, 22, 46],
} as const;

/** Five servers on a platform, the leader at the back, heartbeats on the floor to the other four.
 *  The servers sit on a pentagon, so no link from the leader passes under another server. */
export function cluster(size = 5): Cluster {
  const { half, slab, orbit, side, height, entries, dials } = CLUSTER;
  // The leader at the back of the platform, the corner nearest the top of the page, then
  // clockwise as the page shows it.
  const centers = Array.from({ length: size }, (_, i) => {
    const a = (-3 * Math.PI) / 4 + (i * 2 * Math.PI) / size;
    return { x: orbit * Math.cos(a), y: orbit * Math.sin(a) };
  });
  const leader = centers[0] ?? { x: 0, y: 0 };
  const servers: Server[] = centers.map((c, i) => {
    const x = c.x - side / 2;
    const y = c.y - side / 2;
    const isLeader = i === 0;
    const count = isLeader ? entries + 1 : entries;
    // The log's cells on the face toward +x: a row along y, a third of the way up.
    const cell = (k: number) => {
      const y0 = y + 6 + k * 7.5;
      const z0 = height * 0.38;
      return points([
        { x: x + side, y: y0, z: z0 },
        { x: x + side, y: y0 + 6, z: z0 },
        { x: x + side, y: y0 + 6, z: z0 + 9 },
        { x: x + side, y: y0, z: z0 + 9 },
      ]);
    };
    return {
      id: i + 1,
      leader: isLeader,
      faces: prism(x, y, 0, side, side, height),
      dial: {
        ...floorEllipse(c.x, c.y, height, side * 0.3),
        fill: isLeader ? 100 : (dials[i - 1] ?? 0),
      },
      log: Array.from({ length: count }, (_, k) => ({ cell: cell(k), committed: k < entries })),
      depth: c.x + c.y,
    };
  });
  // A link runs on the floor from the leader's edge to the follower's middle, under its box.
  const links = centers.slice(1).map((c, i) => {
    const len = Math.hypot(c.x - leader.x, c.y - leader.y);
    const ux = (c.x - leader.x) / len;
    const uy = (c.y - leader.y) / len;
    const from = project({ x: leader.x + ux * side * 0.72, y: leader.y + uy * side * 0.72, z: 0 });
    const to = project({ x: c.x, y: c.y, z: 0 });
    return { to: i + 2, from, end: to };
  });
  const floor: string[] = [];
  for (let k = -half + 30; k < half; k += 30) {
    const a = project({ x: k, y: -half, z: 0 });
    const b = project({ x: k, y: half, z: 0 });
    const c = project({ x: -half, y: k, z: 0 });
    const d = project({ x: half, y: k, z: 0 });
    floor.push(`M${fmt(a.x)} ${fmt(a.y)}L${fmt(b.x)} ${fmt(b.y)}`);
    floor.push(`M${fmt(c.x)} ${fmt(c.y)}L${fmt(d.x)} ${fmt(d.y)}`);
  }
  const top = project({ x: leader.x, y: leader.y, z: height });
  const all = [
    ...corners(-half, -half, -slab, 2 * half, 2 * half, slab),
    ...centers.flatMap((c) => corners(c.x - side / 2, c.y - side / 2, 0, side, side, height)),
  ].map(project);
  return {
    viewBox: viewBoxOf([...all, { x: top.x, y: top.y - 40 }], 12),
    platform: prism(-half, -half, -slab, 2 * half, 2 * half, slab),
    floor: floor.join(''),
    links: links.map(({ to, from, end }) => ({
      to,
      d: `M${fmt(from.x)} ${fmt(from.y)}L${fmt(end.x)} ${fmt(end.y)}`,
    })),
    packets: links.map(({ to, from, end }) => {
      const { transform, length } = frame(from, end);
      const a = fine(6 / length);
      return { to, transform, d: `M${a} 0L0 3-${a} 0 0-3z` };
    }),
    servers: [...servers].sort((a, b) => a.depth - b.depth),
    label: { x: Number(fmt(top.x)), y: Number(fmt(top.y - 26)) },
    ripple: floorEllipse(leader.x, leader.y, height, side * 0.3),
  };
}

/** How long one heartbeat takes to go round, in seconds, as global.css times it. */
export const HEARTBEAT_S = 2.4;

// --- The stack beside How I work ------------------------------------------------------------

export interface Slab {
  readonly n: number;
  readonly faces: Prism;
  /** Where its number starts on its face toward +y, as an SVG matrix. */
  readonly label: string;
}

/** The stack's measures, and the most slabs it draws: global.css ties each slab to its line's
 *  view timeline by number, and names that many. */
export const STACK = { side: 150, thick: 18, gap: 12, most: 8 } as const;

/** A slab per principle, the first at the foot, each standing on the one before it with a gap,
 *  as an exploded drawing shows a part: the page settles each one as its line scrolls in. */
export function stack(count: number): {
  readonly viewBox: string;
  readonly slabs: readonly Slab[];
} {
  const { side, thick, gap, most } = STACK;
  if (count > most)
    throw new Error(`iso.ts: the stack draws up to ${most} slabs, and global.css names that many`);
  const slabs = Array.from({ length: count }, (_, i) => {
    const z = i * (thick + gap);
    return {
      n: i + 1,
      faces: prism(-side / 2, -side / 2, z, side, side, thick),
      label: leftFaceMatrix({ x: -side / 2 + 10, y: side / 2, z: z + thick * 0.3 }),
    };
  });
  const all = Array.from({ length: count }, (_, i) =>
    corners(-side / 2, -side / 2, i * (thick + gap), side, side, thick),
  )
    .flat()
    .map(project);
  // Room above the top slab for the lift the first frames give it.
  const top = project({ x: -side / 2, y: -side / 2, z: count * (thick + gap) + 40 });
  return { viewBox: viewBoxOf([...all, top], 8), slabs };
}

// --- The Route Lab's card -------------------------------------------------------------------

export interface RoutePicture {
  readonly viewBox: string;
  readonly platform: Prism;
  readonly bands: readonly ReturnType<typeof floorEllipse>[];
  readonly route: string;
  readonly stops: readonly P2[];
  readonly depot: Prism;
  /** The van's legs, stop to stop: each a frame for the van to cross, and the van drawn in it,
   *  round on the page. global.css times them one after another. */
  readonly legs: readonly { readonly transform: string; readonly rx: string }[];
  /** Where the van waits between rounds: the bakery. */
  readonly home: P2;
}

/** The van's radius on the page. */
export const VAN_R = 4.5;

/** The Route Lab's card picture: a depot, the bands a van reaches in so many minutes around it, and
 *  one van's round of five stops. */
export function routePicture(): RoutePicture {
  const half = 120;
  const stopsWorld = [
    { x: 0, y: 0 },
    { x: 70, y: -40 },
    { x: 95, y: 35 },
    { x: 40, y: 85 },
    { x: -45, y: 70 },
    { x: -80, y: -10 },
    { x: 0, y: 0 },
  ];
  const stops = stopsWorld.map((s) => project({ ...s, z: 0 }));
  const legs = stops.slice(1).map((s, i) => {
    const { transform, length } = frame(stops[i] ?? s, s);
    return { transform, rx: fine(VAN_R / length) };
  });
  const all = corners(-half, -half, -10, 2 * half, 2 * half, 10).map(project);
  return {
    viewBox: viewBoxOf([...all, project({ x: -12, y: -12, z: 30 })], 6),
    platform: prism(-half, -half, -10, 2 * half, 2 * half, 10),
    bands: [40, 75, 110].map((r) => floorEllipse(0, 0, 0, r)),
    route: stops.map((s, i) => `${i === 0 ? 'M' : 'L'}${fmt(s.x)} ${fmt(s.y)}`).join(''),
    stops: stops.slice(1, -1).map((s) => ({ x: Number(fmt(s.x)), y: Number(fmt(s.y)) })),
    depot: prism(-12, -12, 0, 24, 24, 22),
    legs,
    home: { x: Number(fmt(stops[0]?.x ?? 0)), y: Number(fmt(stops[0]?.y ?? 0)) },
  };
}
