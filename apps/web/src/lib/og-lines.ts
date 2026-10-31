import sharp from 'sharp';
import tokensCss from '../styles/tokens.css?raw';
import { openingRun as backfillOpening } from './backfill/view';
import { openingRun as cacheOpening } from './cache/view';
import {
  BACKFILL_SIZES,
  backfillShape,
  CACHE_SIZES,
  cacheShape,
  QUEUE_SIZES,
  queueShape,
  RAFT_SIZES,
  raftShape,
  ROUTES_SIZES,
  routesShape,
  wide,
} from './line-shapes';
import { backfillLine, cacheLine, type Lamp, queueLine, raftLine, routesLine } from './lines';
import { OG_SIZE, type OgArt } from './og';
import { openingRun as queueOpening } from './queue/view';
import { openingRun as raftOpening } from './raft/view';
import { demoPicture } from './route-lab/og-map';
import { routeLabPicture } from './route-lab/picture';
import { hex, themeColors } from './tokens';

// The labs' lines on their link previews (ADR 0025): a lab's card carries its own line across the
// top, in its own colour, and Home's and the Lab index's cards stack every line, as the board
// does. Each line is the board's wide drawing scaled to the card: the same shape (lib/line-shapes.ts)
// from the same opening run as its component in components/board/lines/. This is the shape's second
// renderer, SVG for a PNG drawn outside Astro; the components are the first. It holds no geometry
// of its own, only how a board pixel and a share of the width land on the card, and which mark
// each station's lamp is. It draws no word: no label, no server's number, so the card's only text
// is still its title and its label (lib/og.ts). The colours are the dark theme's tokens, as the
// card's are. Build-time only. test/line-shapes.test.ts reads the stations back from both
// drawings and fails if they disagree.

/** A line's picture on a lab's card: the full width, above the words, low enough that the
 *  longest title a card draws (three lines at 80 px, lib/og.ts titleSize) still fits beneath. */
export const OG_LINE = { width: OG_SIZE.width, height: 248 } as const;

/** Home's and the Lab index's picture: every line stacked, above a title of one line at 150 px. */
export const OG_BOARD = { width: OG_SIZE.width, height: 332 } as const;

/** Pixels on the card per pixel of the board's wide drawing: the lab's own card, and the stack. */
export const LINE_SCALE = 2.1;
export const BOARD_SCALE = 0.55;

/** The board's wide stroke widths, from styles/lines.css at 48rem and up. */
const STROKE = { track: 6, spoke: 4, loop: 3.5, lamp: 2.5, now: 3, cross: 3, gap: 2.25 } as const;

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
  const { size, middle, vans } = routesShape(routesLine(after.measured), wide(ROUTES_SIZES.board));
  const stem = middle * u;
  const shapes = [track(pen, 0, stem, size.depot * u, stem)];
  for (const van of vans) {
    const rise = (size.fork + van.rise) * u;
    shapes.push(
      path(
        pen,
        `M${n((size.depot + size.side) * u)} ${n(stem)}H${n(size.fork * u)}L${n(rise)} ${n(van.y * u)}`,
      ),
      track(pen, rise, van.y * u, at(van.back), van.y * u),
    );
  }
  shapes.push(square(pen, size.depot * u, (middle - size.side / 2) * u, size.side * u));
  for (const van of vans) {
    const y = van.y * u;
    const loop = at(van.back) + size.loop * u;
    shapes.push(
      `<circle cx="${n(loop)}" cy="${n(y)}" r="${n(size.loop * u)}" ${stroked(pen, STROKE.loop)}/>`,
    );
    for (const stop of van.stops) shapes.push(lamp(pen, at(stop.x), y, size.lamp, stop.lamp));
    // The van itself, lit where the still board shows it: the head of its track, a stop, or back.
    const here = [at(van.head), ...van.stops.map((stop) => at(stop.x)), loop][van.now];
    if (here !== undefined) shapes.push(lamp(pen, here, y, size.van, 'lit'));
  }
  return { height: size.height * u, shapes };
};

/** The Raft Lab's line (lines/raft.astro): the leader at the hub, every other server on a spoke,
 *  and the leader's log, filled once committed, ending in a buffer stop. */
const raft: Drawer = async (pen) => {
  const { u } = pen;
  const { size, middle, leader, followers, log, end } = raftShape(
    raftLine(raftOpening()),
    wide(RAFT_SIZES.board),
  );
  const [stopWidth, stopHeight] = size.stop;
  const shapes = [
    track(pen, 0, middle * u, end * u, middle * u),
    square(pen, end * u, (middle - stopHeight / 2) * u, stopWidth * u, stopHeight * u),
  ];
  for (const f of followers)
    shapes.push(track(pen, size.hub * u, middle * u, f.x * u, f.y * u, STROKE.spoke));
  for (const entry of log) shapes.push(lamp(pen, entry.x * u, middle * u, size.lamp, entry.lamp));
  for (const f of followers) shapes.push(lamp(pen, f.x * u, f.y * u, size.server, 'hollow'));
  if (leader !== null) shapes.push(disc(pen, size.hub * u, middle * u, size.leader * u));
  return { height: size.height * u, shapes };
};

/** The Queue Lab's line (lines/queue.astro): the publisher, the queue's tank, a fork to each
 *  worker's track, and the siding of dead letters ending in its buffer stop. */
const queue: Drawer = async (pen) => {
  const { u, at } = pen;
  const { size, middle, fork, tracks, waiting, letters } = queueShape(
    queueLine(queueOpening()),
    wide(QUEUE_SIZES.board),
  );
  const stem = middle * u;
  const shapes = [
    track(pen, 0, stem, size.depot * u, stem),
    track(pen, (size.depot + size.side) * u, stem, fork * u, stem),
  ];
  for (const t of tracks)
    shapes.push(
      track(pen, fork * u, stem, (fork + t.rise) * u, t.y * u),
      track(pen, (fork + t.rise) * u, t.y * u, at(t.dead ? size.stop : size.end), t.y * u),
    );
  shapes.push(square(pen, size.depot * u, (middle - size.side / 2) * u, size.side * u));
  for (const x of waiting) shapes.push(lamp(pen, x * u, stem, size.lamp, 'hollow'));
  for (const t of tracks) {
    const y = t.y * u;
    if (t.dead) {
      const stop = at(size.stop);
      shapes.push(
        square(pen, stop, y - size.station * u, (size.side / 3) * u, size.station * 2 * u),
      );
      for (const x of letters) shapes.push(disc(pen, stop + x * u, y, (size.lamp + 1) * u));
    } else if (t.lamp === 'down') shapes.push(gap(pen, t.hollow * u, y, at(size.end)));
    else shapes.push(lamp(pen, at(size.worker), y, size.station, t.lamp));
  }
  return { height: size.height * u, shapes };
};

/** The Cache Lab's line (lines/cache.astro): the readers fanning out to the cache nodes, their
 *  tracks joining at the database, and its pool of connections, lit while a fetch runs. */
const cache: Drawer = async (pen) => {
  const { u, at } = pen;
  const { size, middle, nodes, meet, database, pool } = cacheShape(
    cacheLine(cacheOpening()),
    wide(CACHE_SIZES.board),
  );
  const stem = middle * u;
  const fork = size.fork * u;
  // The join is a share of the width; the database and its pool stand in pixels past it.
  const join = at(size.join);
  const past = (x: number) => join + x * u;
  const shapes = [track(pen, 0, stem, fork, stem)];
  for (const node of nodes)
    shapes.push(
      track(pen, fork, stem, fork + node.rise * u, node.y * u),
      track(pen, fork + node.rise * u, node.y * u, join, node.y * u),
      path(
        pen,
        `M${n(join)} ${n(node.y * u)}H${n(past(meet - node.rise))}L${n(past(meet))} ${n(stem)}`,
      ),
    );
  shapes.push(
    track(pen, past(meet), stem, past(pool.at(-1)?.x ?? database), stem),
    square(pen, past(database), (middle - size.side / 2) * u, size.side * u),
  );
  for (const connection of pool)
    shapes.push(lamp(pen, past(connection.x), stem, size.lamp, connection.lamp));
  for (const node of nodes)
    shapes.push(
      node.lamp === 'down'
        ? gap(pen, node.hollow * u, node.y * u, join)
        : lamp(pen, at(size.node), node.y * u, size.station, node.lamp),
    );
  return { height: size.height * u, shapes };
};

/** The Backfill Lab's line (lines/backfill.astro): the week's runs along the top, each dropping
 *  to the report's track below, which ends in the report. */
const backfill: Drawer = async (pen) => {
  const { u, at } = pen;
  const { size, days } = backfillShape(backfillLine(backfillOpening()), wide(BACKFILL_SIZES.board));
  const week = size.week * u;
  const report = size.report * u;
  const shapes = [track(pen, 0, week, at(days.at(-1)?.x ?? size.to), week)];
  for (const day of days) shapes.push(track(pen, at(day.x), week, at(day.x), report, STROKE.spoke));
  shapes.push(
    track(pen, at(days[0]?.x ?? size.from), report, at(size.table), report),
    square(pen, at(size.table), report - (size.side / 2) * u, size.side * u),
  );
  for (const day of days) shapes.push(lamp(pen, at(day.x), week, size.lamp, day.lamp));
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

/** One lab's line as a card draws it at a scale, an SVG of the card's width and the line's own
 *  height, before it is placed: what test/line-shapes.test.ts reads the stations back from. */
export async function lineDrawing(
  slug: string,
  scale: number,
  app: string,
): Promise<string | undefined> {
  const drawn = await strip(slug, scale, app);
  return drawn && svg({ width: OG_SIZE.width, height: drawn.height }, drawn.shapes);
}

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
