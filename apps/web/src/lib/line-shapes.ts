import {
  type BackfillLine,
  type CacheLine,
  type Lamp,
  type QueueLine,
  type RaftLine,
  type RoutesLine,
  spread,
  TANK,
} from './lines';

// Where each lab's line puts its stations, tracks and lamps (ADR 0025), at every size it is drawn:
// Home's board, wide and compact. One model, two renderers: the line
// components (components/board/lines/) draw it as SVG on the pages, and lib/og-lines.ts draws the
// board's wide size, scaled, on the link previews. Until 2026-10-31 the previews kept a copy of
// the components' sizes and arithmetic by hand, and a change to a line's shape had to be made in
// both: that day a merge changed the board's lines and had to patch the copy after it (5108b71).
// Now a shape changes here, once, and test/line-shapes.test.ts fails if the two drawings still
// come to disagree on a line's stations or lamps. Plain TypeScript with no DOM, so both renderers and the tests
// import it. Pattern: a single source of truth, read by a view per medium.
//
// Lengths are in two units, as the components draw them: pixels, which keep a lamp round and a
// track's height whatever the width, and shares of the drawing's width, in percent, which let the
// tracks run the width of the screen. Each field says which it is. The words a drawing names
// (a van's name, "Dead letters") are the components' alone: the previews draw no word.

/** Where a line is drawn: a band of Home's board, the one place since ADR 0027 (until then the
 *  Lab index drew each line large too, with its stations named). */
export type LineAt = 'board';

/** Each place draws its line twice, for a narrow screen and a wide one; lines.css shows one. */
export type Drawn = 'wide' | 'compact';

/** The size a place draws at from 48rem up: the one the previews scale to the card. */
export function wide<T extends { readonly name: Drawn }>(sizes: readonly T[]): T {
  const size = sizes.find((s) => s.name === 'wide');
  if (!size) throw new Error('line-shapes: no wide size');
  return size;
}

/** How far past a fork's bend a downed station's hollow starts, in pixels, so it never cuts the
 *  tracks that leave the fork beside it. */
export const GAP_FROM_FORK = 6;

// ---- The Route Lab ----------------------------------------------------------------------------

export interface RoutesSize {
  readonly name: Drawn;
  /** Its height, and the space between the vans' tracks. */
  readonly height: number;
  readonly gap: number;
  /** The depot's left edge and side, and where the vans' tracks fork from the stem. */
  readonly depot: number;
  readonly side: number;
  readonly fork: number;
  /** Where the day runs along the width, in percent, and the least room between two lamps. */
  readonly from: number;
  readonly to: number;
  readonly room: number;
  /** A stop's lamp, the van's lamp and the turning loop at a track's end, by radius. */
  readonly lamp: number;
  readonly van: number;
  readonly loop: number;
  /** Where the bakery's name starts, or null for none: on the board, the panel's text inset, so
   *  it lines up with the words above it rather than standing against the bezel. */
  readonly bakery: number | null;
  /** Whether each van's name stands at the end of its track. */
  readonly vans: boolean;
}

export const ROUTES_SIZES: Record<LineAt, readonly RoutesSize[]> = {
  board: [
    {
      name: 'wide',
      height: 96,
      gap: 26,
      depot: 40,
      side: 14,
      fork: 62,
      from: 16,
      to: 86,
      room: 2.8,
      lamp: 6,
      van: 9,
      loop: 7,
      bakery: 20,
      vans: true,
    },
    // On a phone each van still has its name at its track's end, so the last van's track stops
    // short enough for its name to fit inside the bezel from 320 px up.
    {
      name: 'compact',
      height: 64,
      gap: 15,
      depot: 16,
      side: 10,
      fork: 30,
      from: 19,
      to: 80,
      room: 3.9,
      lamp: 3.75,
      van: 6,
      loop: 4.5,
      bakery: null,
      vans: true,
    },
  ],
};

export interface RoutesVanShape {
  readonly name: string;
  /** Its track's height, in pixels, and how far it climbs or falls from the stem to reach it. */
  readonly y: number;
  readonly rise: number;
  /** The head of its track and its turning loop, in percent. */
  readonly head: number;
  readonly back: number;
  /** Each stop, in percent, filled once delivered, hollow while still on board. */
  readonly stops: readonly { readonly x: number; readonly lamp: Lamp }[];
  /** Where the still drawing lights the van: 0 at the head, k at stop k, stops + 1 at the loop. */
  readonly now: number;
}

export interface RoutesShape {
  readonly size: RoutesSize;
  readonly middle: number;
  readonly vans: readonly RoutesVanShape[];
}

/** The Routes line at a size: the bakery, and a track forking to each van, its stops placed by
 *  when it reaches them (lib/lines.ts, spread), at the middle of the day. */
export function routesShape(line: RoutesLine, size: RoutesSize): RoutesShape {
  const middle = size.height / 2;
  const count = line.vans.length;
  const gap = count > 3 ? size.gap * 0.85 : size.gap;
  const vans = line.vans.map((van, i) => {
    const y = Math.round(middle + (i - (count - 1) / 2) * gap);
    // The head of the track, each stop, then the turning loop where the van is back.
    const along = spread([0, ...van.stops, van.back], size.from, size.to, size.room);
    return {
      name: van.name,
      y,
      rise: Math.abs(y - middle),
      head: along[0] ?? size.from,
      back: along.at(-1) ?? size.to,
      // A stop the van has passed in the still drawing is delivered.
      stops: along.slice(1, -1).map((x, k) => ({
        x,
        lamp: (k + 1 < van.now ? 'filled' : 'hollow') as Lamp,
      })),
      now: van.now,
    };
  });
  return { size, middle, vans };
}

// ---- The Raft Lab -----------------------------------------------------------------------------

export interface RaftSize {
  readonly name: Drawn;
  readonly height: number;
  /** The hub's place, and how far out and down a spoke reaches. */
  readonly hub: number;
  readonly reach: readonly [number, number];
  /** The leader's lamp and a follower's, by radius. */
  readonly leader: number;
  readonly server: number;
  /** Where the log starts, the space between its entries, and an entry's lamp by radius. */
  readonly log: number;
  readonly step: number;
  readonly lamp: number;
  /** The buffer stop's width and height. */
  readonly stop: readonly [number, number];
  /** Whether each server's number stands in its lamp. */
  readonly numbers: boolean;
}

export const RAFT_SIZES: Record<LineAt, readonly RaftSize[]> = {
  board: [
    {
      name: 'wide',
      height: 80,
      hub: 96,
      reach: [44, 24],
      leader: 14,
      server: 11.5,
      log: 190,
      step: 30,
      lamp: 6,
      stop: [5, 20],
      numbers: true,
    },
    {
      name: 'compact',
      height: 56,
      hub: 60,
      reach: [30, 17],
      leader: 9,
      server: 6.5,
      log: 116,
      step: 18,
      lamp: 4,
      stop: [3.5, 13],
      numbers: false,
    },
  ],
};

// The followers' places around the hub: upper left, upper right, lower right, lower left.
const AROUND = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
] as const;

export interface RaftShape {
  readonly size: RaftSize;
  readonly middle: number;
  /** The leader's number at the hub, or null while none leads. */
  readonly leader: number | null;
  /** Every other server at a spoke's end, a hollow lamp each, in pixels. */
  readonly followers: readonly { readonly id: number; readonly x: number; readonly y: number }[];
  /** The leader's log, an entry each, filled once committed, in pixels. */
  readonly log: readonly { readonly x: number; readonly lamp: Lamp }[];
  /** The log's end, the buffer stop: a step past its last entry, where its first would be while
   *  it holds none. */
  readonly end: number;
}

/** The Raft line at a size: the leader at the hub, every other server on a spoke, and the leader's
 *  log running out to its buffer stop. */
export function raftShape(line: RaftLine, size: RaftSize): RaftShape {
  const middle = size.height / 2;
  const [dx, dy] = size.reach;
  const followers = line.followers.slice(0, AROUND.length).map((id, i) => {
    const [sx, sy] = AROUND[i] ?? [1, 1];
    return { id, x: size.hub + sx * dx, y: middle + sy * dy };
  });
  const log = line.log.map((committed, k) => ({
    x: size.log + k * size.step,
    lamp: (committed ? 'filled' : 'hollow') as Lamp,
  }));
  const end = size.log + line.log.length * size.step;
  return { size, middle, leader: line.leader, followers, log, end };
}

// ---- The Queue Lab ----------------------------------------------------------------------------

export interface QueueSize {
  readonly name: Drawn;
  /** Its height, and the space between the tracks after the fork. */
  readonly height: number;
  readonly gap: number;
  /** The publisher's left edge and side, the tank's first lamp and the space between its lamps. */
  readonly depot: number;
  readonly side: number;
  readonly tank: number;
  readonly step: number;
  /** Where a worker's lamp stands and its track ends, in percent; the siding's buffer stop. */
  readonly worker: number;
  readonly end: number;
  readonly stop: number;
  /** A waiting order's lamp and a worker's, by radius. */
  readonly lamp: number;
  readonly station: number;
  readonly labels: boolean;
}

export const QUEUE_SIZES: Record<LineAt, readonly QueueSize[]> = {
  board: [
    {
      name: 'wide',
      height: 96,
      gap: 21,
      depot: 40,
      side: 14,
      tank: 70,
      step: 16,
      worker: 62,
      end: 82,
      stop: 74,
      lamp: 5,
      station: 8,
      labels: true,
    },
    {
      name: 'compact',
      height: 64,
      gap: 13,
      depot: 16,
      side: 10,
      tank: 34,
      step: 9,
      worker: 72,
      end: 94,
      stop: 86,
      lamp: 3,
      station: 5,
      labels: false,
    },
  ],
};

export interface QueueTrack {
  readonly name: string;
  /** A worker's lamp: lit, hollow, or down, its track hollow from `hollow` to the track's end. */
  readonly lamp: Lamp;
  /** Whether this is the siding of dead letters, which ends in a buffer stop. */
  readonly dead: boolean;
  readonly y: number;
  readonly rise: number;
  /** Where a downed worker's hollow starts, in pixels. */
  readonly hollow: number;
}

export interface QueueShape {
  readonly size: QueueSize;
  readonly middle: number;
  /** Where the tracks fork, in pixels: past the tank's last place, so a fuller queue never
   *  reaches it. */
  readonly fork: number;
  /** A track per worker, in order, then the siding. */
  readonly tracks: readonly QueueTrack[];
  /** Each waiting order's lamp in the tank, in pixels. */
  readonly waiting: readonly number[];
  /** Each dead letter's lamp, in pixels back from the siding's buffer stop. */
  readonly letters: readonly number[];
}

/** The Queue line at a size: the publisher, the queue's tank, a fork to each worker's track, and
 *  the siding of dead letters ending in its buffer stop. */
export function queueShape(line: QueueLine, size: QueueSize): QueueShape {
  const middle = size.height / 2;
  const fork = size.tank + (TANK - 1) * size.step + size.lamp + 12;
  const rows = [
    ...line.workers.map((w) => ({ ...w, dead: false })),
    { name: 'Dead letters', lamp: 'hollow' as Lamp, dead: true },
  ];
  const tracks = rows.map((row, i) => {
    const y = Math.round(middle + (i - (rows.length - 1) / 2) * size.gap);
    const rise = Math.abs(y - middle);
    return { ...row, y, rise, hollow: fork + rise + GAP_FROM_FORK };
  });
  const waiting = Array.from({ length: line.waiting }, (_, k) => size.tank + k * size.step);
  const letters = Array.from({ length: line.dead }, (_, k) => -(k + 1) * size.step);
  return { size, middle, fork, tracks, waiting, letters };
}

// ---- The Cache Lab ----------------------------------------------------------------------------

export interface CacheSize {
  readonly name: Drawn;
  /** Its height, and the space between the nodes' tracks. */
  readonly height: number;
  readonly gap: number;
  /** Where the readers' stem forks, in pixels; where the nodes stand and their tracks join, in
   *  percent. */
  readonly fork: number;
  readonly node: number;
  readonly join: number;
  /** The database's side, and the space between its connections' lamps. */
  readonly side: number;
  readonly step: number;
  /** A node's lamp and a connection's, by radius. */
  readonly station: number;
  readonly lamp: number;
}

export const CACHE_SIZES: Record<LineAt, readonly CacheSize[]> = {
  board: [
    {
      name: 'wide',
      height: 96,
      gap: 21,
      fork: 62,
      node: 32,
      join: 56,
      side: 14,
      step: 16,
      station: 7,
      lamp: 5,
    },
    {
      name: 'compact',
      height: 64,
      gap: 13,
      fork: 30,
      node: 32,
      join: 56,
      side: 10,
      step: 9,
      station: 4.5,
      lamp: 3,
    },
  ],
};

export interface CacheShape {
  readonly size: CacheSize;
  readonly middle: number;
  /** Each node, in order: filled while up; down, its track hollow from `hollow` to the join. */
  readonly nodes: readonly {
    readonly lamp: Lamp;
    readonly y: number;
    readonly rise: number;
    readonly hollow: number;
  }[];
  /** From the join, in pixels: where every node's track meets the others, as far out as the
   *  widest fan needs, then the database, then its pool. */
  readonly meet: number;
  readonly database: number;
  /** Each connection's lamp, in pixels from the join, lit while a fetch runs on it. */
  readonly pool: readonly { readonly x: number; readonly lamp: Lamp }[];
}

/** The Cache line at a size: the readers fanning out to the cache nodes, their tracks joining at
 *  the database, and its pool of connections. */
export function cacheShape(line: CacheLine, size: CacheSize): CacheShape {
  const middle = size.height / 2;
  const nodes = line.nodes.map((lamp, i) => {
    const y = Math.round(middle + (i - (line.nodes.length - 1) / 2) * size.gap);
    const rise = Math.abs(y - middle);
    return { lamp, y, rise, hollow: size.fork + rise + GAP_FROM_FORK };
  });
  const meet = Math.max(0, ...nodes.map((node) => node.rise));
  const database = meet + 12;
  const pool = line.connections.map((running, k) => ({
    x: database + size.side + 14 + k * size.step,
    lamp: (running ? 'lit' : 'hollow') as Lamp,
  }));
  return { size, middle, nodes, meet, database, pool };
}

// ---- The Backfill Lab -------------------------------------------------------------------------

export interface BackfillSize {
  readonly name: Drawn;
  readonly height: number;
  /** The week's track and the report's, from the top. */
  readonly week: number;
  readonly report: number;
  /** Where the first day and the last stand, and the report, in percent. */
  readonly from: number;
  readonly to: number;
  readonly table: number;
  /** The report's side, and a day's lamp by radius. */
  readonly side: number;
  readonly lamp: number;
}

export const BACKFILL_SIZES: Record<LineAt, readonly BackfillSize[]> = {
  board: [
    {
      name: 'wide',
      height: 80,
      week: 22,
      report: 60,
      from: 14,
      to: 62,
      table: 72,
      side: 14,
      lamp: 7,
    },
    {
      name: 'compact',
      height: 56,
      week: 15,
      report: 42,
      from: 12,
      to: 72,
      table: 84,
      side: 10,
      lamp: 4.5,
    },
  ],
};

export interface BackfillShape {
  readonly size: BackfillSize;
  /** Each day's run, "Mon", its lamp, and its place along the week, in percent. */
  readonly days: readonly { readonly name: string; readonly lamp: Lamp; readonly x: number }[];
}

/** The Backfill line at a size: the week's runs along the top, each dropping to the report's
 *  track below, which ends in the report. */
export function backfillShape(line: BackfillLine, size: BackfillSize): BackfillShape {
  const span = line.days.length - 1;
  const days = line.days.map((day, i) => ({
    ...day,
    x: Math.round((size.from + (span > 0 ? (i / span) * (size.to - size.from) : 0)) * 100) / 100,
  }));
  return { size, days };
}
