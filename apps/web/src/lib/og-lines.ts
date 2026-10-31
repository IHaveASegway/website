import sharp from 'sharp';
import tokensCss from '../styles/tokens.css?raw';
import { openingRun as backfillOpening } from './backfill/view';
import { openingRun as cacheOpening } from './cache/view';
import {
  backfillLine,
  cacheLine,
  type Lamp,
  queueLine,
  raftLine,
  routesLine,
  spread,
  TANK,
} from './lines';
import { OG_SIZE, type OgArt } from './og';
import { openingRun as queueOpening } from './queue/view';
import { openingRun as raftOpening } from './raft/view';
import { demoPicture } from './route-lab/og-map';
import { routeLabPicture } from './route-lab/picture';
import { hex, themeColors } from './tokens';

// The labs' lines on their link previews (ADR 0025): a lab's card carries its own line across the
// top, in its own colour, and Home's and the Lab index's cards stack every line, as the board
// does. Each line is drawn from the same model and the same opening run as its component in
// components/board/lines/, at the board's wide sizes, scaled to the card. It draws no word: no
// label, no server's number, so the card's only text is still its title and its label (lib/og.ts).
// The colours are the dark theme's tokens, as the card's are. Build-time only.
//
// The geometry here is a second copy of the components' wide drawing, by hand: the components
// keep theirs in their frontmatter, which a PNG drawn outside Astro cannot import. The proper home
// for it is one module both read; until then, a change to a line's shape is made in both places.

/** A line's picture on a lab's card: the full width, above the words, low enough that the
 *  longest title a card draws (three lines at 80 px, lib/og.ts titleSize) still fits beneath. */
export const OG_LINE = { width: OG_SIZE.width, height: 248 } as const;

/** Home's and the Lab index's picture: every line stacked, above a title of one line at 150 px. */
export const OG_BOARD = { width: OG_SIZE.width, height: 332 } as const;

/** Pixels on the card per pixel of the board's wide drawing: the lab's own card, and the stack. */
const LINE_SCALE = 2.1;
const BOARD_SCALE = 0.55;

/** The board's wide stroke widths, from styles/lines.css at 48rem and up. */
const STROKE = { track: 6, spoke: 4, loop: 3.5, lamp: 2.5, now: 3, cross: 3, gap: 2.25 } as const;

/** How far past the fork's bend a downed station's hollow starts, as lines/queue.astro and
 *  cache.astro give it (GAP_FROM_FORK), so it never cuts the tracks that leave the fork beside it. */
const GAP_FROM_FORK = 6;

interface Ink {
  readonly line: string;
  readonly ground: string;
  readonly now: string;
}

/** One line, drawn at a scale into a strip of the card's width. */
interface Pen {
  readonly ink: Ink;
  /** Pixels per board pixel. */
  readonly u: number;
  /** A share of the width, in percent, as a pixel. */
  readonly at: (percent: number) => number;
}

type Drawer = (
  pen: Pen,
  app: string,
) => Promise<{ readonly height: number; readonly shapes: string[] }>;

const n = (x: number) => Math.round(x * 100) / 100;

const stroked = (pen: Pen, width: number) =>
  `fill="none" stroke="${pen.ink.line}" stroke-width="${n(width * pen.u)}"`;

function track(
  pen: Pen,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  width: number = STROKE.track,
) {
  return `<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}" ${stroked(pen, width)}/>`;
}

const path = (pen: Pen, d: string) => `<path d="${d}" ${stroked(pen, STROKE.track)}/>`;

const square = (pen: Pen, x: number, y: number, w: number, h = w) =>
  `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" fill="${pen.ink.line}"/>`;

const disc = (pen: Pen, x: number, y: number, r: number) =>
  `<circle cx="${n(x)}" cy="${n(y)}" r="${n(r)}" fill="${pen.ink.line}"/>`;

/** A station that is down: no lamp, its track hollow, the ground running down its middle, as
 *  lines.css draws .line-gap (design-system.md, "Lamps: one meaning per mark"). */
const gap = (pen: Pen, x1: number, y: number, x2: number) =>
  `<line x1="${n(x1)}" y1="${n(y)}" x2="${n(x2)}" y2="${n(y)}" fill="none" stroke="${pen.ink.ground}" stroke-width="${n(STROKE.gap * pen.u)}"/>`;

/** A station's lamp by its state (lib/lines.ts, Lamp): `r` in board pixels, as the components
 *  give it. A filled lamp's fill is one pixel wider than its rim, as lines.css draws it. */
function lamp(pen: Pen, x: number, y: number, r: number, state: Lamp): string {
  const { u, ink } = pen;
  if (state === 'lit')
    return `<circle cx="${n(x)}" cy="${n(y)}" r="${n(r * u)}" fill="${ink.now}" stroke="${ink.line}" stroke-width="${n(STROKE.now * u)}"/>`;
  const rim = `<circle cx="${n(x)}" cy="${n(y)}" r="${n(r * u)}" fill="${ink.ground}" stroke="${ink.line}" stroke-width="${n(STROKE.lamp * u)}"/>`;
  if (state === 'filled') return rim + disc(pen, x, y, (r + 1) * u);
  if (state === 'cross') {
    const d = r * 0.6 * u;
    return (
      rim +
      `<path d="M${n(x - d)} ${n(y - d)}l${n(2 * d)} ${n(2 * d)}m0 ${n(-2 * d)}l${n(-2 * d)} ${n(2 * d)}" fill="none" stroke="${ink.line}" stroke-width="${n(STROKE.cross * u)}" stroke-linecap="square"/>`
    );
  }
  return rim;
}

/** The Route Lab's line (lines/routes.astro): the bakery, and a track forking to each van, its
 *  stops placed by when it reaches them, at the middle of the day. */
const routes: Drawer = async (pen, app) => {
  const { u, at } = pen;
  const { after } = await routeLabPicture(app);
  const line = routesLine(after.measured);
  const size = { height: 96, gap: 26, depot: 40, side: 14, fork: 62, from: 16, to: 86, room: 2.8 };
  const r = { lamp: 6, van: 9, loop: 7 };
  const middle = (size.height / 2) * u;
  const count = line.vans.length;
  const gap = (count > 3 ? size.gap * 0.85 : size.gap) * u;
  const shapes = [track(pen, 0, middle, size.depot * u, middle)];
  const vans = line.vans.map((van, i) => {
    const y = Math.round(middle + (i - (count - 1) / 2) * gap);
    const along = spread([0, ...van.stops, van.back], size.from, size.to, size.room).map(at);
    return { ...van, y, along, rise: Math.abs(y - middle) };
  });
  const fork = size.fork * u;
  for (const van of vans) {
    const back = van.along.at(-1) ?? at(size.to);
    shapes.push(
      path(
        pen,
        `M${n((size.depot + size.side) * u)} ${n(middle)}H${n(fork)}L${n(fork + van.rise)} ${n(van.y)}`,
      ),
      track(pen, fork + van.rise, van.y, back, van.y),
    );
  }
  shapes.push(square(pen, size.depot * u, middle - (size.side / 2) * u, size.side * u));
  for (const van of vans) {
    const back = van.along.at(-1) ?? at(size.to);
    const loop = back + r.loop * u;
    shapes.push(
      `<circle cx="${n(loop)}" cy="${n(van.y)}" r="${n(r.loop * u)}" ${stroked(pen, STROKE.loop)}/>`,
    );
    const stops = van.along.slice(1, -1);
    stops.forEach((x, k) =>
      shapes.push(lamp(pen, x, van.y, r.lamp, k + 1 < van.now ? 'filled' : 'hollow')),
    );
    // The van itself, lit where the still board shows it: the head of its track, a stop, or back.
    const here = [van.along[0] ?? at(size.from), ...stops, loop][van.now];
    if (here !== undefined) shapes.push(lamp(pen, here, van.y, r.van, 'lit'));
  }
  return { height: size.height * u, shapes };
};

/** The Raft Lab's line (lines/raft.astro): the leader at the hub, every other server on a spoke,
 *  and the leader's log, filled once committed, ending in a buffer stop. */
const raft: Drawer = async (pen) => {
  const { u } = pen;
  const line = raftLine(raftOpening());
  const size = {
    height: 80,
    hub: 96,
    reach: [44, 24],
    leader: 14,
    server: 11.5,
    log: 190,
    step: 30,
    lamp: 6,
    stop: [5, 20],
  };
  const middle = (size.height / 2) * u;
  const [dx = 0, dy = 0] = size.reach;
  const around = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ] as const;
  const hub = size.hub * u;
  const followers = line.followers.slice(0, around.length).map((_, i) => {
    const [sx, sy] = around[i] ?? [1, 1];
    return { x: hub + sx * dx * u, y: middle + sy * dy * u };
  });
  // The log ends a step past its last entry in a buffer stop, as raft.astro draws it.
  const end = (size.log + line.log.length * size.step) * u;
  const [stopWidth = 0, stopHeight = 0] = size.stop;
  const shapes = [
    track(pen, 0, middle, end, middle),
    square(pen, end, middle - (stopHeight / 2) * u, stopWidth * u, stopHeight * u),
  ];
  for (const f of followers) shapes.push(track(pen, hub, middle, f.x, f.y, STROKE.spoke));
  line.log.forEach((committed, k) =>
    shapes.push(
      lamp(pen, (size.log + k * size.step) * u, middle, size.lamp, committed ? 'filled' : 'hollow'),
    ),
  );
  for (const f of followers) shapes.push(lamp(pen, f.x, f.y, size.server, 'hollow'));
  if (line.leader !== null) shapes.push(disc(pen, hub, middle, size.leader * u));
  return { height: size.height * u, shapes };
};

/** The Queue Lab's line (lines/queue.astro): the publisher, the queue's tank, a fork to each
 *  worker's track, and the siding of dead letters ending in its buffer stop. */
const queue: Drawer = async (pen) => {
  const { u, at } = pen;
  const line = queueLine(queueOpening());
  const size = {
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
  };
  const middle = (size.height / 2) * u;
  const fork = (size.tank + (TANK - 1) * size.step + size.lamp + 12) * u;
  const rows = [
    ...line.workers.map((w) => ({ lamp: w.lamp, dead: false })),
    { lamp: 'hollow' as Lamp, dead: true },
  ];
  const tracks = rows.map((row, i) => {
    const y = Math.round(middle + (i - (rows.length - 1) / 2) * size.gap * u);
    return { ...row, y, rise: Math.abs(y - middle) };
  });
  const shapes = [
    track(pen, 0, middle, size.depot * u, middle),
    track(pen, (size.depot + size.side) * u, middle, fork, middle),
  ];
  for (const t of tracks)
    shapes.push(
      track(pen, fork, middle, fork + t.rise, t.y),
      track(pen, fork + t.rise, t.y, at(t.dead ? size.stop : size.end), t.y),
    );
  shapes.push(square(pen, size.depot * u, middle - (size.side / 2) * u, size.side * u));
  for (let k = 0; k < line.waiting; k++)
    shapes.push(lamp(pen, (size.tank + k * size.step) * u, middle, size.lamp, 'hollow'));
  for (const t of tracks) {
    if (t.dead) {
      const stop = at(size.stop);
      shapes.push(
        square(pen, stop, t.y - size.station * u, (size.side / 3) * u, size.station * 2 * u),
      );
      for (let k = 0; k < line.dead; k++)
        shapes.push(disc(pen, stop - (k + 1) * size.step * u, t.y, (size.lamp + 1) * u));
    } else if (t.lamp === 'down')
      shapes.push(gap(pen, fork + t.rise + GAP_FROM_FORK * u, t.y, at(size.end)));
    else shapes.push(lamp(pen, at(size.worker), t.y, size.station, t.lamp));
  }
  return { height: size.height * u, shapes };
};

/** The Cache Lab's line (lines/cache.astro): the readers fanning out to the cache nodes, their
 *  tracks joining at the database, and its pool of connections, lit while a fetch runs. */
const cache: Drawer = async (pen) => {
  const { u, at } = pen;
  const line = cacheLine(cacheOpening());
  const size = {
    height: 96,
    gap: 21,
    fork: 62,
    node: 32,
    join: 56,
    side: 14,
    step: 16,
    station: 7,
    lamp: 5,
  };
  const middle = (size.height / 2) * u;
  const nodes = line.nodes.map((state, i) => {
    const y = Math.round(middle + (i - (line.nodes.length - 1) / 2) * size.gap * u);
    return { state, y, rise: Math.abs(y - middle) };
  });
  const fork = size.fork * u;
  const join = at(size.join);
  const meet = Math.max(0, ...nodes.map((node) => node.rise));
  const database = join + meet + 12 * u;
  const pool = line.connections.map((_, k) => database + (size.side + 14 + k * size.step) * u);
  const shapes = [track(pen, 0, middle, fork, middle)];
  for (const node of nodes)
    shapes.push(
      track(pen, fork, middle, fork + node.rise, node.y),
      track(pen, fork + node.rise, node.y, join, node.y),
      path(
        pen,
        `M${n(join)} ${n(node.y)}H${n(join + meet - node.rise)}L${n(join + meet)} ${n(middle)}`,
      ),
    );
  shapes.push(
    track(pen, join + meet, middle, pool.at(-1) ?? database, middle),
    square(pen, database, middle - (size.side / 2) * u, size.side * u),
  );
  pool.forEach((x, k) =>
    shapes.push(lamp(pen, x, middle, size.lamp, line.connections[k] ? 'lit' : 'hollow')),
  );
  for (const node of nodes)
    shapes.push(
      node.state === 'down'
        ? gap(pen, fork + node.rise + GAP_FROM_FORK * u, node.y, join)
        : lamp(pen, at(size.node), node.y, size.station, node.state),
    );
  return { height: size.height * u, shapes };
};

/** The Backfill Lab's line (lines/backfill.astro): the week's runs along the top, each dropping
 *  to the report's track below, which ends in the report. */
const backfill: Drawer = async (pen) => {
  const { u, at } = pen;
  const line = backfillLine(backfillOpening());
  const size = { height: 80, week: 22, report: 60, from: 14, to: 62, table: 72, side: 14, lamp: 7 };
  const week = size.week * u;
  const report = size.report * u;
  const span = line.days.length - 1;
  const days = line.days.map((day, i) => ({
    ...day,
    x: at(size.from + (span > 0 ? (i / span) * (size.to - size.from) : 0)),
  }));
  const shapes = [track(pen, 0, week, days.at(-1)?.x ?? at(size.to), week)];
  for (const day of days) shapes.push(track(pen, day.x, week, day.x, report, STROKE.spoke));
  shapes.push(
    track(pen, days[0]?.x ?? at(size.from), report, at(size.table), report),
    square(pen, at(size.table), report - (size.side / 2) * u, size.side * u),
  );
  for (const day of days) shapes.push(lamp(pen, day.x, week, size.lamp, day.lamp));
  return { height: size.height * u, shapes };
};

const DRAWERS: Readonly<Record<string, Drawer>> = { routes, raft, queue, cache, backfill };

/** The night theme's colours, as the card's are. */
const night = () => themeColors(tokensCss, 'dark');

function token(name: string): string {
  const value = night().get(name);
  if (!value) throw new Error(`og-lines: tokens.css has no --${name}`);
  return hex(value);
}

/** Whether a lab has its own colour, --line-<slug>, for its card's lamp. */
const hasColor = (slug: string) => night().has(`line-${slug}`);

async function strip(slug: string, u: number, app: string) {
  const draw = DRAWERS[slug];
  if (!draw) return undefined;
  const ink = { line: token(`line-${slug}`), ground: token('background'), now: token('primary') };
  return draw({ ink, u, at: (percent) => (percent / 100) * OG_SIZE.width }, app);
}

const svg = (box: { width: number; height: number }, shapes: readonly string[]) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${box.width}" height="${box.height}" viewBox="0 0 ${box.width} ${box.height}">${shapes.join('')}</svg>`;

const png = (text: string) => sharp(Buffer.from(text)).png({ compressionLevel: 9 }).toBuffer();

/** One lab's line across a card, centred in its strip, or none for a lab without a line. */
export async function linePicture(slug: string, app: string): Promise<Buffer | undefined> {
  const drawn = await strip(slug, LINE_SCALE, app);
  if (!drawn) return undefined;
  const top = (OG_LINE.height - drawn.height) / 2;
  return png(svg(OG_LINE, [`<g transform="translate(0 ${n(top)})">`, ...drawn.shapes, '</g>']));
}

/** Every line the board draws, in the board's order, stacked as its bands are, or none when no
 *  lab has a line (a build with no lab). */
export async function boardPicture(
  slugs: readonly string[],
  app: string,
): Promise<Buffer | undefined> {
  const drawn = (await Promise.all(slugs.map((slug) => strip(slug, BOARD_SCALE, app)))).filter(
    (d) => d !== undefined,
  );
  if (drawn.length === 0) return undefined;
  const total = drawn.reduce((sum, d) => sum + d.height, 0);
  // The bands share the room left over equally, above, between and below them.
  const space = (OG_BOARD.height - total) / (drawn.length + 1);
  if (space < 0) throw new Error(`og-lines: ${drawn.length} lines overfill the card's board`);
  const shapes: string[] = [];
  let y = space;
  for (const d of drawn) {
    shapes.push(`<g transform="translate(0 ${n(y)})">`, ...d.shapes, '</g>');
    y += d.height + space;
  }
  return png(svg(OG_BOARD, shapes));
}

/** What a demo's card carries beside its strings: its own picture where it has one (the Route
 *  Lab's map, lib/route-lab/og-map.ts), else its line; and its line colour on the lamp. `app` is
 *  apps/web. */
export async function demoArt(slug: string, app: string): Promise<OgArt> {
  const picture = (await demoPicture(slug, app)) ?? (await linePicture(slug, app));
  return { picture, line: hasColor(slug) ? slug : undefined };
}

/** What Home's card and the Lab index's carry: the board, every lab's line stacked. */
export async function boardArt(slugs: readonly string[], app: string): Promise<OgArt> {
  return { picture: await boardPicture(slugs, app) };
}
