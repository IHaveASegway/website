import { readLink, writeLink } from '../sim/link';
import { properties, type PropertyState } from './check';
import {
  crash,
  createSim,
  DRAIN_WITHIN,
  jobOf,
  live,
  LOADS,
  nextTime,
  runUntil,
  SERVICE,
  SLOWDOWN,
  type Action,
  type Config,
  type Effect,
  type Job,
  type Load,
  type Place,
  type Sample,
  type Sim,
  type Worker,
} from './sim';

// What the Queue Lab says about a run, as words, series and the picture's markup: the page draws
// them at build, for the opening run, so the demo is complete without JavaScript, and in the
// browser on every frame of a run, which it drives with runUntil, as replay does. Pure functions
// of the run. Markup carries classes and attributes only, never a style attribute: the page's
// policy refuses inline styles.

/**
 * The opening, the page's first picture: the bakery's orders at `busy`, three workers, prefetch 1,
 * acknowledgements after the ticket and no idempotency key. Worker 2 crashes at 2,400 ms between
 * an order's ticket and its ack, so the broker sends the order again and it is printed twice;
 * nothing is lost. The browser replays it to take over exactly where the picture stands.
 *
 * Seed 7 has worker 2 still working at 2,400 ms, its ticket not yet printed, so the order would be
 * sent again and printed once: no story. Seed 28 is the first seed from 7 whose worker 2 is then
 * between a ticket and its ack (order 18's ticket printed at 2,371 ms).
 *
 * Its actions are crashes alone: the page plays the ones still ahead of a run it starts over
 * (playTo), and a crash is the one action it needs for that.
 */
export const OPENING: {
  readonly seed: number;
  readonly config: Config;
  readonly actions: readonly Crash[];
  readonly until: number;
} = {
  seed: 28,
  config: { seed: 28, load: 'busy', workers: 3, prefetch: 1, ack: 'after', key: false },
  actions: [{ at: 2_400, kind: 'crash', worker: 1 }],
  until: 4_000,
};

/** One of the opening's actions: a worker crashing at its moment. */
export type Crash = Action & { readonly kind: 'crash' };

/**
 * The opening on a seed and settings, played to `until`: a fresh run that takes the opening's
 * crashes up to then, as replay would (sim.ts), and leaves the rest to come (aheadOf). The build's
 * picture, a link's run, Start over and every frame after it all go through playTo, so the page
 * takes over exactly where the picture stands by construction. Not replay itself: replay takes any
 * action, resizing the pool among them, which no control reaches, and the page's bundle would
 * carry it (test/support/labs.ts, the lab's budget).
 */
function opening(config: Config, until: number): Sim {
  const sim = createSim(config);
  playTo(sim, [...OPENING.actions], until);
  return sim;
}

export const openingRun = (): Sim => opening(OPENING.config, OPENING.until);

/**
 * Where the page plays a run from when the visitor starts it over, or runs one that still stands
 * untouched at the opening's moment: 1.5 s, before worker 2 has even taken order 18 (delivered at
 * 2,265 ms). The picture at 4.0 s tells a crash that has already happened; from here the visitor
 * watches it happen: order 18 taken, its ticket printed at 2,371 ms, the crash at 2.4 s, the
 * broker sending it again and worker 1 printing it a second time at 2,873 ms. At the Steady speed
 * that is most of a second of the run to settle on before the crash, where 400 ms passed in a
 * blink. One constant for Start over and for Run, so the two never start from different moments.
 */
export const REPLAY_FROM = 1_500;

/** The opening's actions a run replayed to `until` has still to take: the crashes after it. */
export const aheadOf = (until: number): Crash[] => OPENING.actions.filter((a) => a.at > until);

/**
 * Runs a run on to `until` as replay does, taking each of the opening's crashes still `ahead` at
 * its moment: every event up to that millisecond first, then the crash. A run started over at
 * REPLAY_FROM and played this way is, event for event, the run its link names. Within `limit`
 * events for each stretch, as a frame's budget; when the budget runs out first, the run stands
 * where it got to and the crash waits, still ahead, for the next frame. Takes what it plays off
 * `ahead`.
 */
export function playTo(sim: Sim, ahead: Crash[], until: number, limit = Infinity): void {
  for (let next = ahead[0]; next && next.at <= until; next = ahead[0]) {
    runUntil(sim, next.at, limit);
    if (sim.violation || nextTime(sim) <= next.at) return;
    ahead.shift();
    crash(sim, next.worker);
  }
  runUntil(sim, until, limit);
}

/** How many seeded runs the property sweep in test/queue.test.ts makes: the page says the number. */
export const SEEDS_IN_CI = 2_000;

export const seconds = (ms: number): string => `${(ms / 1000).toFixed(3)} s`;

/** A time to a tenth of a second, for the history strip's ends. */
export const tenths = (ms: number): string => `${(ms / 1000).toFixed(1)} s`;

const firstUp = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const firstDown = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

/** "a", "a and b", "a, b and c". */
function list(parts: readonly string[]): string {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
}

function brokenWords(sim: Sim, p: PropertyState): string {
  const n = p.count;
  switch (p.id) {
    case 'no-loss':
      return `${n} ${n === 1 ? 'order was' : 'orders were'} lost`;
    case 'once': {
      // `once` counts orders; more tickets than orders means one was printed three times or more.
      const times = sim.duplicates > n ? 'more than once' : 'twice';
      return `${n} ${n === 1 ? 'order was' : 'orders were'} printed ${times}`;
    }
    case 'drains':
      return `the queue did not drain within 30 s${n === 1 ? '' : `, ${n} times`}`;
  }
}

/**
 * When the page will know whether the queue drains, or null once it knows. The property is asked
 * only once orders stop, and answered when nothing is left or 30 s after the stop (sim.ts,
 * watchDrain), and a poison order can fail on every try until then. With every worker down the
 * wait stops, and its 30 s start again when one is up.
 */
function drainCheck(sim: Sim): string | null {
  if (sim.tallies.drains.count > 0) return null;
  if (sim.producing) return 'once orders stop';
  if (live(sim) === 0) return null;
  const since = sim.drain.since;
  return since === null ? '30 s after a worker is up' : `at ${tenths(since + DRAIN_WITHIN)}`;
}

/** The status line: the three properties as one sentence, or the bug that froze the run. Whether
 *  the queue drains is claimed only once it is known, and until then the line says when it is. */
export function statusText(sim: Sim): string {
  if (sim.violation)
    return `Stopped at ${seconds(sim.violation.at)}: an order appeared or disappeared, which is a bug. ${firstUp(sim.violation.detail)}.`;
  const check = drainCheck(sim);
  const asked = properties(sim).filter((p) => check === null || p.id !== 'drains');
  const held = asked.flatMap((p) => (p.held ? [firstDown(p.name)] : []));
  const broken = asked.flatMap((p) => (p.held ? [] : [brokenWords(sim, p)]));
  const events = sim.events.toLocaleString('en-US');
  const tail = check === null ? '' : ` Whether the queue drains is checked ${check}.`;
  if (broken.length === 0)
    return check === null
      ? `All three held over ${events} events: ${list(held)}.`
      : `${firstUp(list(held))} over ${events} events.${tail}`;
  if (held.length === 0) return `${firstUp(list(broken))}.${tail}`;
  return `${firstUp(list(held))}, but ${list(broken)}.${tail}`;
}

/** The first order the idempotency key kept from printing twice: done, printed once, and sent
 *  again after that ticket, so a later delivery found it in the done set. A done order's last
 *  delivery has run its ticket step, so that is the delivery that skipped. */
function skippedOrder(sim: Sim): Job | undefined {
  return sim.jobs.find(
    (job) =>
      job.place === 'done' &&
      job.effects.length === 1 &&
      job.delivered.length > 1 &&
      (job.effects[0] as Effect).at < (job.delivered.at(-1) as number),
  );
}

/**
 * The run's story in one sentence: of the first order printed twice, the first order lost, a
 * poison order failing over and over under requeue, and the queue that did not drain, the one that
 * happened last, which is what the visitor did last; with none, the first order the idempotency
 * key printed once. A printed order goes back to the broker only when its worker crashed before
 * its ack left, so a second ticket, or a skipped one, always has that story.
 */
function story(sim: Sim): string | null {
  const told: { at: number; text: string }[] = [];
  const twice = sim.tallies.once.first;
  if (twice) {
    const job = jobOf(sim, twice.job);
    const [a, b] = job.effects as [Effect, Effect];
    const times = job.effects.length === 2 ? 'twice' : `${job.effects.length} times`;
    const again =
      a.worker === b.worker
        ? `worker ${b.worker + 1} printed it a second time after its restart`
        : `worker ${b.worker + 1} printed it a second time`;
    told.push({
      at: twice.at,
      text: `Order ${job.id} was printed ${times}: worker ${a.worker + 1} crashed after printing its ticket and before its ack left, so the broker sent it again and ${again}.`,
    });
  }
  const lost = sim.tallies['no-loss'].first;
  if (lost) told.push({ at: lost.at, text: `${firstUp(lost.detail)}.` });
  // Told from when it was published: it is a problem from then on, while orders still come too,
  // and a later break takes the caption over.
  const looping =
    sim.handling === 'requeue'
      ? sim.jobs.find((job) => job.poison && job.ended === null && job.failures > 0)
      : undefined;
  if (looping) {
    const n = looping.failures;
    told.push({
      at: looping.published,
      text: `Poison order ${looping.id} has failed ${n} ${n === 1 ? 'time' : 'times'}: each time it comes straight back to the head of the queue and keeps a worker busy.`,
    });
  }
  const stuck = sim.tallies.drains.first;
  if (stuck) {
    const job = jobOf(sim, stuck.job);
    const poison = job.poison
      ? `, while poison order ${job.id} kept failing and going back to the head of the queue`
      : '';
    told.push({ at: stuck.at, text: `The queue did not drain: ${stuck.detail}${poison}.` });
  }
  // The latest; at the same moment, the earlier in the list above.
  const latest = told.reduce<(typeof told)[number] | undefined>(
    (shown, next) => (shown && shown.at >= next.at ? shown : next),
    undefined,
  );
  if (latest) return latest.text;
  const kept = skippedOrder(sim);
  if (!kept) return null;
  const printer = (kept.effects[0] as Effect).worker + 1;
  const sent = kept.delivered.length === 2 ? 'twice' : `${kept.delivered.length} times`;
  return `Order ${kept.id} was sent ${sent} and printed once: worker ${printer} crashed after printing its ticket and before its ack left, so the broker sent it again, and worker ${kept.worker + 1} found it in the done set and skipped the ticket.`;
}

function totals(sim: Sim): string {
  if (sim.jobs.length === 0) return 'No orders yet.';
  const lost = sim.lostCount;
  const head =
    lost === 0 ? 'Nothing was lost' : `${lost} ${lost === 1 ? 'order was' : 'orders were'} lost`;
  const parts = [`${sim.doneCount} ${sim.doneCount === 1 ? 'order is' : 'orders are'} done`];
  const open = live(sim);
  if (open > 0) parts.push(`${open} ${open === 1 ? 'is' : 'are'} queued or with a worker`);
  const dead = sim.dead.length;
  if (dead > 0) parts.push(`${dead} ${dead === 1 ? 'is' : 'are'} in the dead-letter queue`);
  return `${head}; ${list(parts)}.`;
}

/** One or two sentences for the picture's caption: what went wrong first, then the totals. */
export function summary(sim: Sim): string {
  if (sim.violation)
    return `The run stopped at ${seconds(sim.violation.at)}, because an order appeared or disappeared: ${sim.violation.detail}.`;
  const told = story(sim);
  return told ? `${told} ${totals(sim)}` : totals(sim);
}

/** A worker's one-line state, for its button and the text beside the picture. */
export function workerText(sim: Sim, k: number): string {
  const w = sim.workers[k] as Worker;
  const name = `Worker ${k + 1}`;
  if (w.state !== 'up') return `${name}, ${w.state}`;
  const parts = [name];
  if (w.slow) parts.push('slow');
  if (w.leaving) parts.push('leaving the pool');
  parts.push(w.busy === null ? 'idle' : `working on order ${w.busy}`);
  const waiting = w.window.length - (w.busy !== null && w.window[0] === w.busy ? 1 : 0);
  if (waiting > 0) parts.push(`${waiting} waiting`);
  return parts.join(', ');
}

/** The history strip: a sample every 250 ms of the last two minutes (sim.ts, Sample). */
export const history = (sim: Sim): readonly Sample[] => sim.samples;

export type Outcome = 'queued' | 'in-flight' | 'done' | 'dead' | 'lost';

const OUTCOME: Record<Place, Outcome> = {
  ready: 'queued',
  retry: 'queued',
  wire: 'in-flight',
  window: 'in-flight',
  orphan: 'in-flight',
  reply: 'in-flight',
  done: 'done',
  dead: 'dead',
  lost: 'lost',
};

/** One order's life, for the strip of the last orders: when it was published, each delivery, each
 *  ticket, when the broker let it go, and where it is now. */
export interface Lifecycle {
  readonly id: number;
  readonly poison: boolean;
  readonly published: number;
  readonly delivered: readonly number[];
  readonly effects: readonly Effect[];
  readonly acked: number | null;
  readonly ended: number | null;
  readonly redelivered: boolean;
  readonly outcome: Outcome;
}

export function lifecycles(sim: Sim, count = 120): Lifecycle[] {
  return sim.jobs.slice(-count).map((job) => ({
    id: job.id,
    poison: job.poison,
    published: job.published,
    delivered: [...job.delivered],
    effects: [...job.effects],
    acked: job.acked,
    ended: job.ended,
    redelivered: job.redelivered,
    outcome: OUTCOME[job.place],
  }));
}

// The page: its settings, the words beside the picture, the history strip and the picture.

/** How fast Run plays: virtual milliseconds for each real one. */
export const SPEEDS = [
  { name: 'Slow', value: 0.25 },
  { name: 'Steady', value: 1 },
  { name: 'Quick', value: 5 },
] as const;

/** How many orders a worker may hold, the choices the page offers. */
export const PREFETCHES = [1, 2, 5, 10] as const;

/**
 * The settings a link to a run names (lib/sim/link.ts), with the values the page offers and the
 * opening's: the load, the prefetch, when workers acknowledge, the key and what a failing order
 * gets. The speed is not one of them: it changes how fast a run plays, never the run.
 */
export const SETTINGS = {
  load: { values: Object.keys(LOADS) as Load[], opening: 'busy' },
  prefetch: { values: PREFETCHES, opening: 1 },
  ack: { values: ['after', 'before'], opening: 'after' },
  key: { values: [false, true], opening: false },
  handling: { values: ['requeue', 'dead-letter'], opening: 'requeue' },
} as const;

/** The link to a run's start: its seed, and each setting not the opening's (#seed-28&key=on). */
export const linkTo = (sim: Sim): string => writeLink(sim.seed, sim, SETTINGS);

/**
 * The run a link names, replayed to `until`: the opening's crash, on the link's seed and under its
 * settings. By default to the opening's moment, where the build's picture stands; Start over
 * replays it to REPLAY_FROM, and the crash after that is still ahead (aheadOf, playTo). Null when
 * the hash links to no run.
 */
export function openLink(hash: string, until: number = OPENING.until): Sim | null {
  const link = readLink(hash, SETTINGS);
  return link && opening({ ...OPENING.config, ...link.values, seed: link.seed }, until);
}

/**
 * Start over: the run this one's link names, the opening again on this run's seed and with the
 * visitor's settings, so the same crash comes at the same moment and the settings are all that
 * differ. Crashes, slow spells, poison orders and a stopped producer are things the visitor did,
 * so they go with the old run. The page starts it over at REPLAY_FROM; replayed to the opening's
 * moment, as by default, it is the run the link opens.
 */
export const startOver = (sim: Sim, until: number = OPENING.until): Sim =>
  openLink(linkTo(sim), until) as Sim;

/** A property's words beside its lamp: "Holds", or "Broken" and what broke it, counted. Until the
 *  page knows whether the queue drains, the words say when it will. */
export function propertyWords(sim: Sim, p: PropertyState): string {
  if (p.held) {
    const check = p.id === 'drains' ? drainCheck(sim) : null;
    return check === null ? 'Holds' : `Holds; checked ${check}`;
  }
  const n = p.count;
  const orders = `${n} ${n === 1 ? 'order' : 'orders'}`;
  switch (p.id) {
    case 'no-loss':
      return `Broken: ${orders} lost`;
    case 'once':
      return `Broken: ${orders} printed ${sim.duplicates > n ? 'more than once' : 'twice'}`;
    case 'drains': {
      const times = n === 1 ? '' : `, ${n} times`;
      return `Broken: not empty ${DRAIN_WITHIN / 1000} s after orders stopped${times}`;
    }
  }
}

const COUNTS = ['No', 'One', 'Two', 'Three', 'Four', 'Five'] as const;

/**
 * What the workers up can print, said beside the loads: about 3.2 orders a second each, from the
 * service time's mean (a log-normal's is its median times e^(spread² / 2)), and a tenth of that
 * while slow; the picture says which are. A worker leaving takes no new order, so it is not
 * counted. The opening has worker 2 down, so two print about 6.5, below a busy hour's 9 a second:
 * the queue grows until it is back.
 */
export function capacityWords(sim: Sim): string {
  const up = sim.workers.slice(0, sim.size).filter((w) => w.state === 'up' && !w.leaving);
  const mean = SERVICE.median * Math.exp(SERVICE.spread ** 2 / 2);
  const rate = up.reduce((sum, w) => sum + 1_000 / (mean * (w.slow ? SLOWDOWN : 1)), 0);
  const n = up.length;
  if (n === 0) return 'No worker is up, so no order is printed.';
  return `${COUNTS[n]} ${n === 1 ? 'worker is up and prints' : 'workers are up and print'} about ${rate.toFixed(1)}.`;
}

/** How many orders wait in the queue, and how long the oldest of them has waited. */
export function waitWords(sim: Sim): string {
  const n = sim.ready.length;
  if (n === 0) return 'None waiting';
  let oldest = Infinity;
  for (const id of sim.ready) oldest = Math.min(oldest, jobOf(sim, id).published);
  return `${n} waiting, the oldest for ${((sim.now - oldest) / 1000).toFixed(1)} s`;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** The history strip: the orders waiting over the last 30 s, or the first 30 s while the run is
 *  younger, in the strip's own units, which the page stretches across its column. */
export const STRIP = { span: 30_000, width: 300, height: 60 } as const;

/** The strip's scale stops at the first of these that the most orders waiting fit under. */
const SCALE = [10, 20, 50, 100, 200, 500, 1_000, 2_000, 5_000, 10_000];

export interface Strip {
  readonly from: number;
  readonly to: number;
  /** The most orders waiting in the span. */
  readonly peak: number;
  /** The top of the scale. */
  readonly most: number;
  /** The orders waiting, as a polyline's points. */
  readonly points: string;
  /** Each crash in the span: where it is across the strip, when, and which worker. */
  readonly crashes: readonly { readonly x: number; readonly at: number; readonly worker: number }[];
}

export function strip(sim: Sim): Strip {
  const to = Math.max(STRIP.span, sim.now);
  const from = to - STRIP.span;
  const shown = sim.samples.filter((s) => s.at >= from && s.at <= to);
  const peak = shown.reduce((most, s) => Math.max(most, s.ready), 0);
  const most = SCALE.find((n) => n >= peak) ?? Math.ceil(peak / 10_000) * 10_000;
  const x = (at: number) => round1(((at - from) / STRIP.span) * STRIP.width);
  const y = (n: number) => round1(STRIP.height - 2 - (n / most) * (STRIP.height - 4));
  const points = shown.map((s) => `${x(s.at)},${y(s.ready)}`).join(' ');
  const crashes = sim.actions.flatMap((a) =>
    a.kind === 'crash' && a.at >= from && a.at <= to
      ? [{ x: x(a.at), at: a.at, worker: a.worker }]
      : [],
  );
  return { from, to, peak, most, points, crashes };
}

/** The strip in words, for the picture's name. */
export function stripWords(sim: Sim): string {
  const { from, to, peak, crashes } = strip(sim);
  const span = `${tenths(from)} to ${tenths(to)}`;
  const head = `Orders waiting from ${span}: at most ${peak}, ${sim.ready.length} now.`;
  const told = crashes.map((c) => `Worker ${c.worker + 1} crashed at ${seconds(c.at)}.`);
  return [head, ...told].join(' ');
}

/**
 * One way to draw the picture: wide on a laptop's desk, narrow on a phone. Lengths are in the
 * drawing's own units, and the page scales the drawing to its column, words and all, so each
 * layout is drawn for the width it is shown at and keeps its words near the label size there.
 */
export interface Layout {
  readonly name: 'wide' | 'narrow';
  readonly width: number;
  readonly height: number;
  /** How high the main line runs; the middle track keeps to it. */
  readonly line: number;
  /** The tank: its left edge, the lamps it holds across and down, from one lamp's place to the
   *  next, and from the outer places to its walls. */
  readonly tank: {
    readonly x: number;
    readonly cols: number;
    readonly rows: number;
    readonly pitch: number;
    readonly pad: number;
  };
  /** The tracks: from one to the next, how far a diagonal runs along for each unit it climbs,
   *  where a track's first lamp (the order in work) sits, and from one lamp to the next. */
  readonly tracks: {
    readonly gap: number;
    readonly slope: number;
    readonly head: number;
    readonly pitch: number;
  };
  /** The oven tickets: consecutive orders in rows, from the left edge, each row numbered at its
   *  end with its last order where there is room. */
  readonly tickets: {
    readonly x: number;
    readonly cols: number;
    readonly rows: number;
    readonly pitch: number;
    readonly numbered: boolean;
  };
  /** The dead-letter siding: how high it runs, and where its buffer stops stand. */
  readonly siding: { readonly y: number; readonly end: number };
  readonly lamp: number;
  /** Where three captions stand: the end they are set from, and their baseline. */
  readonly words: {
    readonly orders: Caption;
    readonly tickets: Caption;
    readonly dead: Caption;
  };
}

interface Caption {
  readonly x: number;
  readonly y: number;
  readonly anchor: 'start' | 'end';
}

export const LAYOUTS = {
  wide: {
    name: 'wide',
    width: 960,
    height: 236,
    line: 96,
    tank: { x: 56, cols: 10, rows: 4, pitch: 17, pad: 7 },
    tracks: { gap: 56, slope: 1, head: 514, pitch: 22 },
    tickets: { x: 620, cols: 10, rows: 5, pitch: 20, numbered: true },
    siding: { y: 200, end: 900 },
    lamp: 7,
    words: {
      orders: { x: 0, y: 80, anchor: 'start' },
      tickets: { x: 612, y: 32, anchor: 'start' },
      dead: { x: 612, y: 226, anchor: 'start' },
    },
  },
  narrow: {
    name: 'narrow',
    width: 360,
    height: 202,
    line: 92,
    tank: { x: 8, cols: 4, rows: 5, pitch: 15, pad: 5 },
    tracks: { gap: 50, slope: 0.5, head: 246, pitch: 14 },
    tickets: { x: 298, cols: 5, rows: 6, pitch: 13, numbered: false },
    siding: { y: 180, end: 338 },
    lamp: 5,
    words: {
      orders: { x: 0, y: 40, anchor: 'start' },
      tickets: { x: 356, y: 40, anchor: 'end' },
      dead: { x: 111, y: 185, anchor: 'start' },
    },
  },
} as const satisfies Record<string, Layout>;

type Point = readonly [number, number];
const pts = (points: readonly Point[]) =>
  points.map(([x, y]) => `${round1(x)},${round1(y)}`).join(' ');
const text = (x: number, y: number, words: string, cls = 'qu-label', anchor = 'start') =>
  `<text class="${cls}" x="${round1(x)}" y="${round1(y)}"${anchor === 'start' ? '' : ` text-anchor="${anchor}"`}>${words}</text>`;
/** A diamond, the poison order's lamp, around (x, y). */
const diamond = (x: number, y: number, r: number) =>
  `M${round1(x)} ${round1(y - r)}L${round1(x + r)} ${round1(y)}L${round1(x)} ${round1(y + r)}L${round1(x - r)} ${round1(y)}Z`;

/** A ring around (x, y) as a path, so a mark inside it can be part of the same path. */
const ring = (x: number, y: number, r: number) =>
  `M${round1(x - r)} ${round1(y)}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;
/** Clock hands from the middle of a lamp of radius r, at three o'clock, as the Backfill Lab's
 *  waiting step draws them: the site's lamp for waiting to retry (design-system.md, "Lamps: one
 *  meaning per mark"). */
const hands = (x: number, y: number, r: number) =>
  `M${round1(x)} ${round1(y - 0.6 * r)}V${round1(y)}h${round1(0.5 * r)}`;

/** The workers the picture draws a track for: the pool, and any worker still leaving it. */
function tracked(sim: Sim): Worker[] {
  return sim.workers.filter((w) => w.id < sim.size || w.state !== 'off');
}

/** The word under a worker's name: down, slow or leaving the pool, or none. */
export function workerWord(w: Worker): string {
  if (w.state === 'down') return 'Down';
  if (w.leaving) return 'Leaving';
  return w.slow ? 'Slow' : '';
}

/**
 * The picture, as the markup inside its <svg>: orders come in on the left to the tank, where the
 * ready ones wait as hollow lamps, as on the board, and one waiting out a backoff has clock hands
 * in its lamp; a track a worker leaves it, holding the orders that worker has
 * taken, up to the prefetch it had when it took them, the one in work lit at its head; the main line runs on to the oven
 * tickets, one lamp an order in rows of consecutive orders, filled once printed, with a second
 * circle around it when it printed twice, and hollow and struck through once when it was lost;
 * and the dead-letter siding runs under them to its buffer stops. A crashed worker's track is drawn hollow. A poison order's
 * lamp is a diamond wherever it is.
 */
export function mapMarkup(sim: Sim, layout: Layout): string {
  const { line, tank, tracks, tickets, siding, lamp, words } = layout;
  const out: string[] = [];
  const workers = tracked(sim);
  const n = workers.length;
  const yOf = (i: number) => line + (i - (n - 1) / 2) * tracks.gap;
  const climb = ((n - 1) / 2) * tracks.gap;

  // The tank and the lines into and out of it.
  const tankW = tank.cols * tank.pitch + 2 * tank.pad;
  const tankH = tank.rows * tank.pitch + 2 * tank.pad;
  const tankTop = line - tankH / 2;
  const fork = tank.x + tankW + 8;
  const along = fork + climb * tracks.slope;
  const end = tracks.head + tracks.pitch / 2 + 6;
  const merged = end + climb * tracks.slope;
  const ticketTop = line - ((tickets.rows - 1) / 2) * tickets.pitch;
  const inflow: Point[] = [
    [0, line],
    [tank.x, line],
  ];
  const track = (points: readonly Point[], hollow: boolean) =>
    `<polyline class="qu-track" points="${pts(points)}"/>${hollow ? `<polyline class="qu-gap" points="${pts(points)}"/>` : ''}`;
  out.push(track(inflow, !sim.producing));
  out.push(
    track(
      [
        [tank.x + tankW, line],
        [fork, line],
      ],
      false,
    ),
  );
  out.push(
    track(
      [
        [merged, line],
        [tickets.x - 14, line],
      ],
      false,
    ),
  );
  // The siding leaves the last track where it straightens, and runs under the tickets.
  const last = yOf(n - 1);
  const drop = siding.y - last;
  out.push(
    track(
      [
        [end - 6, last],
        [end - 6 + drop * tracks.slope, siding.y],
        [siding.end, siding.y],
      ],
      false,
    ),
  );
  out.push(
    `<path class="qu-stop" d="M${siding.end + 4} ${siding.y - 9}V${siding.y + 9}M${siding.end + 10} ${siding.y - 6}V${siding.y + 6}"/>`,
  );
  workers.forEach((w, i) => {
    const y = yOf(i);
    const dy = Math.abs(y - line) * tracks.slope;
    out.push(
      track(
        [
          [fork, line],
          [fork + dy, y],
          [end, y],
          [end + dy, line],
        ],
        w.state !== 'up',
      ),
    );
  });
  out.push(
    `<rect class="qu-tank" x="${tank.x}" y="${round1(tankTop)}" width="${tankW}" height="${tankH}"/>`,
  );

  // The tank: the head of the queue at the exit, the rest filling back from it, column by column;
  // orders waiting out a backoff after them, with clock hands. Until 2026-10-31 they were squares,
  // filled, and hollow for a backoff, but on the site's lines a square is a place or a message,
  // filled is done, and an order in the queue is not yet: a hollow lamp, as the board draws it.
  const waiting = [
    ...sim.ready.map((id) => ({ id, state: 'ready' })),
    ...[...sim.retrying].map((id) => ({ id, state: 'retry' })),
  ];
  const room = tank.cols * tank.rows;
  const radius = (tank.pitch - 5) / 2;
  waiting.slice(0, room).forEach(({ id, state }, k) => {
    const col = tank.cols - 1 - Math.floor(k / tank.rows);
    const row = k % tank.rows;
    const cx = tank.x + tank.pad + (col + 0.5) * tank.pitch;
    const cy = tankTop + tank.pad + (row + 0.5) * tank.pitch;
    const poisoned = jobOf(sim, id).poison;
    const attrs = `class="qu-order" data-state="${state}"${poisoned ? ' data-poison=""' : ''} data-order="${id}"`;
    if (state === 'retry') {
      // One path, its lamp and its hands, so the clock lamp needs no class the opening lacks.
      const shape = poisoned ? diamond(cx, cy, radius + 1) : ring(cx, cy, radius);
      out.push(`<path ${attrs} d="${shape}${hands(cx, cy, radius)}"/>`);
    } else
      out.push(
        poisoned
          ? `<path ${attrs} d="${diamond(cx, cy, radius + 1)}"/>`
          : `<circle ${attrs} cx="${round1(cx)}" cy="${round1(cy)}" r="${radius}"/>`,
      );
  });
  out.push(text(tank.x, tankTop + tankH + 18, 'Queue'));
  // More than the tank shows: how many, under its name.
  if (waiting.length > room)
    out.push(text(tank.x, tankTop + tankH + 36, `${waiting.length} waiting`, 'qu-label qu-count'));
  const say = (at: Caption, what: string) => text(at.x, at.y, what, 'qu-label', at.anchor);
  out.push(say(words.orders, sim.producing ? 'Orders' : 'Orders stopped'));

  // A track a worker: its name and word, then its lamps, the order in work at the head.
  const nameX = along + 4;
  workers.forEach((w, i) => {
    const y = yOf(i);
    const name = `Worker ${w.id + 1}`;
    const word = workerWord(w);
    out.push(
      `<text class="qu-label" x="${round1(nameX)}" y="${round1(y - lamp - 7)}">${name}${word ? `<tspan class="qu-state" dx="6">${word}</tspan>` : ''}</text>`,
    );
    // An order sent and not yet acknowledged is one state, taken, whether it is still on its way
    // or was dropped in a crash: the broker holds it either way until it takes it back.
    const held =
      w.state === 'up'
        ? [
            ...w.window.map((id) => ({ id, state: id === w.busy ? 'working' : 'waiting' })),
            ...[...sim.wire]
              .filter((id) => jobOf(sim, id).worker === w.id)
              .map((id) => ({ id, state: 'taken' })),
          ]
        : // What it dropped, and what is still on its way to it, until the broker sees the close.
          [...sim.orphans, ...sim.wire]
            .filter((id) => jobOf(sim, id).worker === w.id)
            .map((id) => ({ id, state: 'taken' }));
    held.forEach(({ id, state }, k) => {
      const x = tracks.head - k * tracks.pitch;
      out.push(
        jobOf(sim, id).poison
          ? `<path class="qu-slot" data-state="${state}" data-poison="" data-worker="${w.id}" data-order="${id}" d="${diamond(x, y, lamp + 1)}"/>`
          : `<circle class="qu-slot" data-state="${state}" data-worker="${w.id}" data-order="${id}" cx="${round1(x)}" cy="${round1(y)}" r="${lamp}"/>`,
      );
    });
    if (w.state === 'up' && !w.leaving)
      for (let k = held.length; k < sim.prefetch; k++)
        out.push(
          `<circle class="qu-slot" data-state="room" cx="${round1(tracks.head - k * tracks.pitch)}" cy="${round1(y)}" r="1.5"/>`,
        );
  });

  // The oven tickets: rows of consecutive orders, the last rows that hold a ticket or a loss.
  let newest = 0;
  for (let k = sim.jobs.length - 1; k >= 0; k--) {
    const job = sim.jobs[k] as Job;
    if (job.effects.length > 0 || job.place === 'lost') {
      newest = job.id;
      break;
    }
  }
  const lastRow = Math.max(0, Math.floor((newest - 1) / tickets.cols));
  const firstRow = Math.max(0, lastRow - tickets.rows + 1);
  for (
    let id = firstRow * tickets.cols + 1;
    id <= Math.min(newest, (lastRow + 1) * tickets.cols);
    id++
  ) {
    const job = jobOf(sim, id);
    const k = id - 1 - firstRow * tickets.cols;
    const x = tickets.x + (k % tickets.cols) * tickets.pitch;
    const y = ticketTop + Math.floor(k / tickets.cols) * tickets.pitch;
    if (job.effects.length > 0) {
      out.push(
        `<circle class="qu-ticket" data-state="printed" data-order="${id}" cx="${round1(x)}" cy="${round1(y)}" r="${lamp - 1}"/>`,
      );
      if (job.effects.length > 1)
        out.push(
          `<circle class="qu-again" data-order="${id}" cx="${round1(x)}" cy="${round1(y)}" r="${lamp + 2}"/>`,
        );
    } else if (job.place === 'lost') {
      // A hollow lamp struck through once, corner to corner and a little past its ring: the
      // site's lost order (design-system.md, "Lamps: one meaning per mark"). A cross in a ring, ⊗,
      // is a station that failed, so the desk no longer draws it for an order.
      const r = lamp - 1;
      out.push(
        `<path class="qu-ticket" data-state="lost" data-order="${id}" d="${ring(x, y, r)}M${round1(x - r)} ${round1(y + r)}l${2 * r} ${-2 * r}"/>`,
      );
    }
  }
  // Each row's number is the last order it shows, so a row still filling says how far it has got.
  if (tickets.numbered && newest > 0)
    for (let row = firstRow; row <= lastRow; row++)
      out.push(
        text(
          tickets.x + tickets.cols * tickets.pitch - 2,
          ticketTop + (row - firstRow) * tickets.pitch + 5,
          String(Math.min((row + 1) * tickets.cols, newest)),
          'qu-label qu-count',
        ),
      );
  out.push(say(words.tickets, 'Oven tickets'));
  out.push(
    text(
      tickets.x,
      ticketTop + (tickets.rows - 1) * tickets.pitch + 22,
      `${sim.doneCount} done`,
      'qu-label qu-count',
    ),
  );

  // The dead letters, along the siding from its buffer stops back.
  const step = 2 * lamp + 4;
  const fit = Math.floor((siding.end - (end + drop * tracks.slope)) / step) - 1;
  sim.dead.slice(-fit).forEach((id, k, shown) => {
    const x = siding.end - 10 - (shown.length - 1 - k) * step;
    out.push(
      `<path class="qu-order" data-state="dead" data-poison="" data-order="${id}" d="${diamond(x, siding.y, lamp + 1)}"/>`,
    );
  });
  const deadWords = sim.dead.length > fit ? `Dead letters, ${sim.dead.length}` : 'Dead letters';
  out.push(say(words.dead, deadWords));
  return out.join('');
}
