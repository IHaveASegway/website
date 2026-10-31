import { boardView, type Lamp as StepLamp } from './backfill/view';
import { count, weekday } from './backfill/core';
import type { Sim as BackfillSim } from './backfill/sim';
import { DATABASE, firstUp, pageName } from './cache/core';
import type { Sim as CacheSim } from './cache/sim';
import type { Sim as QueueSim } from './queue/sim';
import { PROPERTIES } from './raft/check';
import { leaderOf, step, type Sim } from './raft/sim';
import type { RouteData } from './route-lab/data';
import type { Day } from './route-lab/days';
import { formatDuration } from './route-lab/format';
import type { Measured } from './route-lab/plan';

// Each lab drawn as its line (ADR 0025): the real shape of the system it runs, in the lab's own
// colour, on Home's board and on the Lab index. This module is the lines' model and their
// words, worked out from what the labs themselves compute at build: the Route Lab's solve of its
// default day, and the opening run of each simulated lab, through its own simulation. Plain
// TypeScript with no DOM, so the components (components/board/) and the unit tests read the same
// numbers, and none of them is typed.

/** The board's day in rounds. In each round every van steps once, one van a second, so a van with
 *  `n` stops is out for n + 1 rounds: it starts at the head of its track, then each stop, then it
 *  is back at the end of its track, where it stands until the day starts again. Twelve rounds
 *  hold a van of up to ten stops; the stylesheet's index rules (styles/board.css) count to
 *  ROUNDS - 1, and routesLine refuses a day they cannot hold. */
export const ROUNDS = 12;

/** The round the still board shows (under reduced motion, without JavaScript, and as the moving
 *  board comes up): the middle of its day. */
export const MIDDAY = ROUNDS / 2;

/** One van on the Routes line. */
export interface RoutesVan {
  /** "Van 1", as the Route Lab's chapter on Home lists it. */
  readonly name: string;
  /** Each stop's arrival, as a share of the whole day: when the last van is back is 1. */
  readonly stops: readonly number[];
  /** When the van is back at the bakery, as a share of the whole day. */
  readonly back: number;
  /** Where the still board shows it: 0 at the head of its track, k at stop k, stops + 1 back. */
  readonly now: number;
}

export interface RoutesLine {
  readonly vans: readonly RoutesVan[];
}

/** The Routes line for a plan, measured: every van with a stop, in van order, its stops placed by
 *  when it reaches them, so the drawing is the day's own shape. */
export function routesLine(measured: Measured): RoutesLine {
  const out = measured.vans
    .map((van, i) => ({ van, name: `Van ${i + 1}` }))
    .filter(({ van }) => van.stops.length > 0);
  const longest = Math.max(0, ...out.map(({ van }) => van.stops.length));
  if (longest + 2 > ROUNDS)
    throw new Error(`lines: a van with ${longest} stops needs more than ${ROUNDS} rounds`);
  const day = Math.max(1, ...out.map(({ van }) => van.back));
  const vans = out.map(({ van, name }) => ({
    name,
    stops: van.stops.map((stop) => stop.arrives / day),
    back: van.back / day,
    now: Math.min(MIDDAY, van.stops.length + 1),
  }));
  return { vans };
}

/**
 * Shares of a line laid out between `from` and `to` (percentages of its width), each at least
 * `gap` after the one before, so lamps that come close in time never sit on each other on the
 * narrowest screen the drawing is made for. Rounded to a hundredth of a percent.
 */
export function spread(shares: readonly number[], from: number, to: number, gap: number): number[] {
  const out: number[] = [];
  for (const share of shares) {
    const at = from + share * (to - from);
    out.push(Math.max(at, (out.at(-1) ?? -Infinity) + gap));
  }
  return out.map((x) => Math.round(x * 100) / 100);
}

/** "Van 1: 9 stops, Ravenna Park to International Fountain, back after 1 h 30 min": each van's day,
 *  from the solve, for the Route Lab's chapter on Home. A van with no stop stays at the bakery. */
export function vanLines(data: RouteData, measured: Measured): string[] {
  const place = (i: number | undefined) => data.points[i ?? -1]?.label ?? '';
  return measured.vans.map((van, i) => {
    const name = `Van ${i + 1}`;
    const n = van.stops.length;
    if (n === 0) return `${name} stays at the bakery`;
    const first = place(van.stops[0]?.place);
    const where = n === 1 ? first : `${first} to ${place(van.stops.at(-1)?.place)}`;
    return `${name}: ${n} ${n === 1 ? 'stop' : 'stops'}, ${where}, back after ${formatDuration(van.back)}`;
  });
}

/** The Routes line's describer on the board: the day's driving as the orders came in, then as
 *  VROOM plans it, from the build's solve of both plans, so the board shows the fix as well as
 *  what it fixes: "20 orders on 3 vans: 5 h 34 min of driving as the orders came in, 3 h 12 min
 *  planned by VROOM, the last van back after 2 h 20 min." */
export function routesWords(day: Day, before: Measured, after: Measured): string {
  const vans = after.vans.filter((van) => van.stops.length > 0).length;
  return `${day.orders.length} orders on ${vans} ${vans === 1 ? 'van' : 'vans'}: ${formatDuration(before.drive)} of driving as the orders came in, ${formatDuration(after.drive)} planned by VROOM, the last van back after ${formatDuration(after.back)}.`;
}

/** The Routes line's one fact on the Lab index: what VROOM saves on the lab's own day, from the
 *  build's solve of both plans: "A busy Saturday: 3 h 12 min of driving instead of 5 h 34 min." */
export const routesFact = (day: Day, before: Measured, after: Measured): string =>
  `${day.name}: ${formatDuration(after.drive)} of driving instead of ${formatDuration(before.drive)}.`;

/** The figure pair's caption on Home: "of driving on a busy Saturday, planned by VROOM in your
 *  browser", the day's own name in it. */
export const figureWords = (day: Day): string =>
  `of driving on ${day.name.replace(/^A /, 'a ')}, planned by VROOM in your browser`;

const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

/** A count under eleven in words, as the describers say it: "five". */
export const inWords = (n: number): string => WORDS[n] ?? String(n);

/** The Raft line: the leader at the hub, every other server on a spoke, and the leader's log. */
export interface RaftLine {
  /** The leading server's number, 1 to 5, or null while none leads. */
  readonly leader: number | null;
  /** The other servers' numbers, in order. */
  readonly followers: readonly number[];
  /** The leader's log, an entry each: true once a majority holds it, so it is committed. */
  readonly log: readonly boolean[];
  /** The describer: who leads, and whether the safety properties held. */
  readonly words: string;
}

/** The Raft line for a run: the Raft Lab's opening on Home's board (lib/raft/view.ts). */
export function raftLine(sim: Sim): RaftLine {
  const leader = leaderOf(sim);
  const held = sim.violation
    ? `${sim.violation.property} broke at ${sim.violation.at} ms.`
    : `All ${inWords(PROPERTIES.length)} safety properties hold.`;
  const lead = leader ? `Server ${leader.id + 1} leads term ${leader.term}.` : 'No server leads.';
  return {
    leader: leader ? leader.id + 1 : null,
    followers: sim.servers.filter((s) => s !== leader).map((s) => s.id + 1),
    log: (leader?.log ?? []).map((_, i) => i < (leader?.commitIndex ?? 0)),
    words: `${lead} ${held}`,
  };
}

/** How long, in virtual milliseconds, the Raft line's failover may take: many election timeouts
 *  (150 to 300 ms, lib/raft/core.ts), so only a run that cannot elect is refused. */
export const RAFT_RECOVERY = 5_000;

/**
 * The Raft line's fix on the board: the opening's leader crashed where the run stands, and Raft
 * electing another, so the board shows what the protocol does about the failure it is built for:
 * "Crash server 1, and server 5 leads term 2 after 221 ms, with all three committed entries kept."
 * `crashed` is the opening replayed with that crash as its last action; this plays it on, event by
 * event, until another server leads. Refused when none leads within RAFT_RECOVERY, when a property
 * broke, or when the new leader's log lost a committed entry, since the sentence says none did.
 */
export function raftFailover(opening: Sim, crashed: Sim): string {
  const old = leaderOf(opening);
  if (!old) throw new Error('lines: the Raft opening has no leader to crash');
  if (crashed.servers[old.id]?.up) throw new Error('lines: the Raft run did not crash its leader');
  const from = crashed.now;
  let next = leaderOf(crashed);
  while ((!next || next.id === old.id) && crashed.now - from < RAFT_RECOVERY && step(crashed))
    next = leaderOf(crashed);
  if (!next || next.id === old.id)
    throw new Error(`lines: no server led within ${RAFT_RECOVERY} ms of the leader's crash`);
  const committed = old.commitIndex;
  if (crashed.violation || next.hashes[committed] !== old.hashes[committed])
    throw new Error('lines: the Raft failover lost a committed entry or broke a property');
  const kept =
    committed === 0
      ? 'nothing committed lost'
      : committed === 1
        ? 'its committed entry kept'
        : `all ${inWords(committed)} committed entries kept`;
  return `Crash server ${old.id + 1}, and server ${next.id + 1} leads term ${next.term} after ${Math.round(crashed.now - from)} ms, with ${kept}.`;
}

/**
 * A station's state on a line (design-system.md, "Lamps: one meaning per mark"; ADR 0025: state is
 * a shape and a word): not started or idle (a hollow lamp), where the work is now (the lit lamp,
 * --primary), done or in service (filled), failed (a cross over a hollow lamp), or down: out of
 * service, drawn as its track hollow, with no lamp, as the labs' desks draw it.
 */
export type Lamp = 'hollow' | 'lit' | 'filled' | 'cross' | 'down';

const times = (n: number): string => (n === 1 ? 'once' : n === 2 ? 'twice' : `${count(n)} times`);
const orders = (n: number): string => `${count(n)} ${n === 1 ? 'order' : 'orders'}`;

/** The orders the Queue line's tank draws, a lamp each: the opening's queue, with room to spare.
 *  queueLine refuses a run with more waiting, as routesLine does a day the board cannot hold. */
export const TANK = 12;

/** The dead letters the Queue line's siding draws, a lamp each, back from its buffer stop. */
export const SIDING = 4;

/** The Queue line: the publisher, the broker's queue, a track to each worker, and the siding of
 *  dead letters. */
export interface QueueLine {
  /** Orders in the broker's queue, a lamp each in the tank. */
  readonly waiting: number;
  /** Each worker in the pool, in order: working on an order (lit), idle (hollow), or down after a
   *  crash (down: its track hollow). */
  readonly workers: readonly { readonly name: string; readonly lamp: Lamp }[];
  /** Orders in the dead-letter queue. */
  readonly dead: number;
  /** The describer: who is down, what was printed twice, and what was lost. */
  readonly words: string;
}

/** The Queue line for a run: the Queue Lab's opening on Home's board (lib/queue/view.ts). */
export function queueLine(sim: QueueSim): QueueLine {
  const waiting = sim.ready.length;
  const dead = sim.dead.length;
  if (waiting > TANK)
    throw new Error(`lines: ${waiting} orders waiting overfill a tank of ${TANK}`);
  if (dead > SIDING) throw new Error(`lines: ${dead} dead letters overfill a siding of ${SIDING}`);
  const pool = sim.workers.slice(0, sim.size);
  const workers = pool.map((w) => ({
    name: `Worker ${w.id + 1}`,
    lamp: (w.state !== 'up' ? 'down' : w.busy === null ? 'hollow' : 'lit') as Lamp,
  }));
  const down = pool.filter((w) => w.state !== 'up').map((w) => String(w.id + 1));
  const head =
    down.length === 0
      ? ''
      : down.length === 1
        ? `Worker ${down[0]} is down. `
        : `Workers ${down.slice(0, -1).join(', ')} and ${down.at(-1)} are down. `;
  const once = sim.tallies.once;
  const twice =
    once.count === 0
      ? 'No order was printed twice'
      : once.count === 1 && once.first
        ? `Order ${once.first.job} was printed twice`
        : `${orders(once.count)} were printed twice`;
  const lost = sim.lostCount === 0 ? 'no order was lost' : `${orders(sim.lostCount)} lost`;
  return { waiting, workers, dead, words: `${head}${twice}, and ${lost}.` };
}

/**
 * The Queue line's one fact on the Lab index: the opening's crash again, with the idempotency key
 * the lab entry tells the visitor to turn on: the order sent twice is printed once, and nothing is
 * lost. Refused for a run that lost or doubled an order, since the sentence says neither happened.
 */
export function queueFact(keyed: QueueSim): string {
  const kept = keptOnce(keyed);
  const crashed = (kept.effects[0]?.worker ?? 0) + 1;
  const seconds = Math.round(keyed.now / 1000);
  return `With an idempotency key, worker ${crashed}’s crash prints order ${kept.id} once: ${orders(keyed.doneCount)} done in ${seconds} s, none lost or printed twice.`;
}

/** The Queue line's fix on the board, after the crash its describer tells: "With an idempotency
 *  key, order 18 prints once." From the same run as the index's fact, refused as it is. */
export function queueFix(keyed: QueueSim): string {
  return `With an idempotency key, order ${keptOnce(keyed).id} prints once.`;
}

/** The order the keyed run was sent twice and printed once; refused for a run that lost or
 *  doubled an order, or sent none twice, since the sentences built on it say none did. */
function keptOnce(keyed: QueueSim): QueueSim['jobs'][number] {
  const kept = keyed.jobs.find((job) => job.effects.length === 1 && job.delivered.length > 1);
  if (!kept || keyed.lostCount > 0 || keyed.tallies.once.count > 0)
    throw new Error('lines: the opening with the key lost or doubled an order, or sent none twice');
  return kept;
}

/** The Cache line: the readers fanning in to the cache nodes, and the database's connections. */
export interface CacheLine {
  /** Each cache node, in order: up (filled) or down (its track hollow). */
  readonly nodes: readonly Lamp[];
  /** The database's pool, a lamp per connection: true while a fetch runs on it. */
  readonly connections: readonly boolean[];
  /** The describer: the worst herd and the readers who gave up. */
  readonly words: string;
}

/** The Cache line for a run: the Cache Lab's opening on Home's board (lib/cache/view.ts). */
export function cacheLine(sim: CacheSim): CacheLine {
  const herd = sim.tally.herd;
  const timeouts = sim.counts.timeout;
  const fetched =
    herd && herd.size >= 2
      ? herd.expired === null
        ? `The database fetched ${pageName(herd.key)} ${times(herd.size)} at once`
        : `When ${pageName(herd.key)} expired at ${(herd.expired / 1000).toFixed(1)} s, the database fetched it ${times(herd.size)} at once`
      : 'No page was fetched twice at once';
  const gave =
    timeouts === 0
      ? 'no reader timed out'
      : `${count(timeouts)} ${timeouts === 1 ? 'read' : 'reads'} timed out`;
  return {
    nodes: sim.nodes.map((node) => (node.up ? 'filled' : 'down')),
    connections: Array.from({ length: DATABASE.pool }, (_, k) => k < sim.running),
    words: `${fetched}, and ${gave}.`,
  };
}

/**
 * The Cache line's one fact on the Lab index: the opening's expiry again, with coalescing, which
 * the lab entry turns on first: the database's fetches of the expired page, with it and without.
 * Refused for an opening with no expiry's herd to compare.
 */
export function cacheFact(opening: CacheSim, coalesced: CacheSim): string {
  const herd = herdAtExpiry(opening);
  const page = pageName(herd.key);
  const at = (herd.expired / 1000).toFixed(1);
  const once = coalesced.fetchesOf[herd.key] ?? 0;
  const without = opening.fetchesOf[herd.key] ?? 0;
  return `${firstUp(`when ${page} expires at ${at} s`)}, coalescing has the database fetch it ${times(once)} instead of ${times(without)}.`;
}

/** The Cache line's fix on the board, after the stampede its describer tells: "With coalescing,
 *  the database fetches it once, and no read times out." From the same runs as the index's fact. */
export function cacheFix(opening: CacheSim, coalesced: CacheSim): string {
  const once = coalesced.fetchesOf[herdAtExpiry(opening).key] ?? 0;
  const timeouts = coalesced.counts.timeout;
  const gave =
    timeouts === 0
      ? 'no read times out'
      : `${count(timeouts)} ${timeouts === 1 ? 'read times' : 'reads time'} out`;
  return `With coalescing, the database fetches it ${times(once)}, and ${gave}.`;
}

/** The opening's herd at an expiry, which the cache's fact and fix compare; refused when there is
 *  none, since then there is nothing to compare. */
function herdAtExpiry(opening: CacheSim): NonNullable<CacheSim['tally']['herd']> & {
  readonly expired: number;
} {
  const herd = opening.tally.herd;
  if (!herd || herd.expired === null || herd.size < 2)
    throw new Error('lines: the cache opening has no herd at an expiry');
  return { ...herd, expired: herd.expired };
}

/** A day's lamp from its steps on the Backfill Lab's run board: failed if any step failed or its
 *  check found the totals apart, lit while a step runs or waits to retry, filled once every step
 *  succeeded, hollow before. */
function dayLamp(steps: readonly { readonly lamp: StepLamp }[]): Lamp {
  const lamps = steps.map((step) => step.lamp);
  if (lamps.some((lamp) => lamp === 'cross' || lamp === 'dash')) return 'cross';
  if (lamps.some((lamp) => lamp === 'lit' || lamp === 'clock')) return 'lit';
  return lamps.every((lamp) => lamp === 'filled') ? 'filled' : 'hollow';
}

/** The Backfill line: the week's daily runs, each writing its day into the report. */
export interface BackfillLine {
  /** Each day of the week, "Mon", and its run's lamp. */
  readonly days: readonly { readonly name: string; readonly lamp: Lamp }[];
  /** The describer: the days whose report is wrong, against the source. */
  readonly words: string;
}

/** The Backfill line for a run: the Backfill Lab's opening on Home's board (lib/backfill/view.ts),
 *  each day's lamp read from the lab's own run board. */
export function backfillLine(sim: BackfillSim): BackfillLine {
  const view = boardView(sim);
  const days = view.days.map((day) => ({
    name: weekday(day.day).slice(0, 3),
    lamp: dayLamp(day.steps),
  }));
  // A day crossed on the line says "failed" in the words (design-system.md, "Lamps: one meaning
  // per mark"): its check, when the totals it found differ, or else its run.
  const failed = view.days.filter((_, i) => days[i]?.lamp === 'cross');
  const checked = view.days.filter((day) => sim.runs[day.day]?.verdict).length;
  const total = sim.source.reduce((sum, n) => sum + n, 0);
  let words: string;
  if (failed.length === 0)
    words =
      checked === view.days.length
        ? `Every day matches the source: ${orders(total)} in the week.`
        : checked === 0
          ? 'No day has been checked yet.'
          : `${firstUp(inWords(checked))} of ${inWords(view.days.length)} days checked, each matching the source.`;
  else {
    const named = failed.map((day) =>
      day.difference === ''
        ? `${weekday(day.day)}’s run failed`
        : `${weekday(day.day)}’s check failed: its report counts ${day.report} orders against the source’s ${day.source}`,
    );
    const others = view.days.filter(
      (day) => day.difference === '' && sim.runs[day.day]?.verdict && !failed.includes(day),
    ).length;
    const rest =
      others > 0
        ? `; the other ${inWords(others)} ${others === 1 ? 'day matches' : 'days match'}`
        : '';
    words = `${named.join('; ')}${rest}.`;
  }
  return { days, words };
}

/**
 * The Backfill line's one fact on the Lab index: the opening's week again with loads that
 * overwrite their day, as the lab entry tells the visitor to switch it, against the appends the
 * opening runs: the week's report, every day written once. Refused unless every overwritten day
 * matches its source, since the sentence says the report and the source agree.
 */
export function backfillFact(appended: BackfillSim, overwritten: BackfillSim): string {
  const sum = (numbers: readonly number[]) => numbers.reduce((total, n) => total + n, 0);
  matchedWeek(overwritten);
  return `Loads that overwrite their day: the week’s report counts ${orders(sum(overwritten.report))}, as the source does, instead of ${count(sum(appended.report))}.`;
}

/** The Backfill line's fix on the board, after the failed check its describer tells: "Loads that
 *  overwrite their day make all seven match." From the same run as the index's fact. */
export function backfillFix(overwritten: BackfillSim): string {
  return `Loads that overwrite their day make all ${inWords(matchedWeek(overwritten))} match.`;
}

/** The days of a week whose every check ran and matched its source; refused otherwise, since the
 *  sentences built on it say the report and the source agree. */
function matchedWeek(overwritten: BackfillSim): number {
  const week = boardView(overwritten);
  if (week.days.some((day) => day.difference !== '' || !overwritten.runs[day.day]?.verdict))
    throw new Error('lines: the overwritten week does not match its source');
  return week.days.length;
}
