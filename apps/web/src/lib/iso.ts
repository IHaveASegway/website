// Isometric drawings, worked out at build (ADR 0023, ADR 0024): Home's Raft cluster, acting out
// an election. A point in the world has x and y on the floor and
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
  /** Where a label over its roof sits. */
  readonly label: P2;
}

/** A message on its way from one server to another: its frame, from the sender's edge to the
 *  receiver's middle, and its dart, drawn in that frame so it keeps its size on the page and
 *  points the way it travels. */
export interface Trip {
  readonly from: number;
  readonly to: number;
  /** The act of the election it belongs to (STORY). */
  readonly act: Act;
  readonly transform: string;
  readonly d: string;
}

export interface Cluster {
  readonly viewBox: string;
  readonly platform: Prism;
  /** The platform's floor lines, a path. */
  readonly floor: string;
  /** Every pair of servers is linked: Raft's servers all talk to each other. */
  readonly links: readonly string[];
  readonly trips: readonly Trip[];
  readonly servers: readonly Server[];
  /** A ripple on a leader's roof, widening with each heartbeat it sends. */
  readonly ripples: readonly {
    readonly server: number;
    readonly ellipse: ReturnType<typeof floorEllipse>;
  }[];
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

/** The acts of the election the picture plays, in order. */
export type Act = 'beat' | 'ask' | 'vote' | 'lead' | 'rejoin';

/**
 * The election Home's cluster acts out, as Raft runs one (Ongaro and Ousterhout, 2014, §5.2):
 * server 1 leads term 3 and sends heartbeats; it crashes; the follower whose timer stands fullest,
 * server 3, times out first, becomes a candidate for term 4 and asks the others for their votes;
 * with its own and three more, a majority of five, it leads term 4 and sends heartbeats of its own;
 * server 1 comes back as a follower and hears them too. global.css times every act on one loop of
 * `seconds`, and test/iso.test.ts holds the two together.
 */
export const STORY = {
  seconds: 15,
  leader: 1,
  candidate: 3,
  terms: [3, 4],
  acts: [
    { act: 'beat', from: [1], to: [2, 3, 4, 5] },
    { act: 'ask', from: [3], to: [1, 2, 4, 5] },
    { act: 'vote', from: [2, 4, 5], to: [3] },
    { act: 'lead', from: [3], to: [2, 4, 5] },
    { act: 'rejoin', from: [3], to: [1] },
  ],
} as const satisfies {
  seconds: number;
  leader: number;
  candidate: number;
  terms: readonly number[];
  acts: readonly { act: Act; from: readonly number[]; to: readonly number[] }[];
};

/** Five servers on a platform, the leader at the back, every pair linked on the floor. The servers
 *  sit on a pentagon, so no link passes under a third server. */
export function cluster(size = 5): Cluster {
  const { half, slab, orbit, side, height, entries, dials } = CLUSTER;
  // The leader at the back of the platform, the corner nearest the top of the page, then
  // clockwise as the page shows it.
  const centers = Array.from({ length: size }, (_, i) => {
    const a = (-3 * Math.PI) / 4 + (i * 2 * Math.PI) / size;
    return { x: orbit * Math.cos(a), y: orbit * Math.sin(a) };
  });
  const servers: Server[] = centers.map((c, i) => {
    const x = c.x - side / 2;
    const y = c.y - side / 2;
    const isLeader = i + 1 === STORY.leader;
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
    const roof = project({ x: c.x, y: c.y, z: height });
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
      label: { x: Number(fmt(roof.x)), y: Number(fmt(roof.y - 26)) },
    };
  });
  const center = (id: number) => centers[id - 1] ?? { x: 0, y: 0 };
  // A message runs on the floor from the sender's edge to the receiver's middle, under its box.
  const leg = (from: number, to: number) => {
    const a = center(from);
    const b = center(to);
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const ux = (b.x - a.x) / len;
    const uy = (b.y - a.y) / len;
    return {
      start: project({ x: a.x + ux * side * 0.72, y: a.y + uy * side * 0.72, z: 0 }),
      end: project({ x: b.x, y: b.y, z: 0 }),
    };
  };
  const links: string[] = [];
  for (let a = 0; a < size; a++)
    for (let b = a + 1; b < size; b++) {
      const p = project({ ...center(a + 1), z: 0 });
      const q = project({ ...center(b + 1), z: 0 });
      links.push(`M${fmt(p.x)} ${fmt(p.y)}L${fmt(q.x)} ${fmt(q.y)}`);
    }
  const trips: Trip[] = STORY.acts.flatMap(({ act, from, to }) =>
    from.flatMap((f) =>
      to.map((t) => {
        const { start, end } = leg(f, t);
        const { transform, length } = frame(start, end);
        const a = fine(6 / length);
        return { from: f, to: t, act, transform, d: `M${a} 0L0 3-${a} 0 0-3z` };
      }),
    ),
  );
  const floor: string[] = [];
  for (let k = -half + 30; k < half; k += 30) {
    const a = project({ x: k, y: -half, z: 0 });
    const b = project({ x: k, y: half, z: 0 });
    const c = project({ x: -half, y: k, z: 0 });
    const d = project({ x: half, y: k, z: 0 });
    floor.push(`M${fmt(a.x)} ${fmt(a.y)}L${fmt(b.x)} ${fmt(b.y)}`);
    floor.push(`M${fmt(c.x)} ${fmt(c.y)}L${fmt(d.x)} ${fmt(d.y)}`);
  }
  const all = [
    ...corners(-half, -half, -slab, 2 * half, 2 * half, slab),
    ...centers.flatMap((c) => corners(c.x - side / 2, c.y - side / 2, 0, side, side, height)),
  ].map(project);
  const labels = servers.map((server) => ({ x: server.label.x, y: server.label.y - 14 }));
  return {
    viewBox: viewBoxOf([...all, ...labels], 12),
    platform: prism(-half, -half, -slab, 2 * half, 2 * half, slab),
    floor: floor.join(''),
    links,
    trips,
    servers: [...servers].sort((a, b) => a.depth - b.depth),
    ripples: [STORY.leader, STORY.candidate].map((id) => ({
      server: id,
      ellipse: floorEllipse(center(id).x, center(id).y, height, side * 0.3),
    })),
  };
}
