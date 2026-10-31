import { PROPERTIES } from './raft/check';
import { leaderOf, type Sim } from './raft/sim';
import type { RouteData } from './route-lab/data';
import type { Day } from './route-lab/days';
import { formatDuration } from './route-lab/format';
import type { Measured } from './route-lab/plan';

// Each lab drawn as its line (ADR 0025): the real shape of the system it runs, in the lab's own
// colour, on Home's board and later on the Lab index. This module is the lines' model and their
// words, worked out from what the labs themselves compute at build: the Route Lab's solve of its
// default day, and the Raft Lab's opening run. Plain TypeScript with no DOM, so the components
// (components/board/) and the unit tests read the same numbers, and none of them is typed.

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
  /** The orders delivered on the still board: every stop behind a van. */
  readonly delivered: number;
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
  const behind = (van: RoutesVan) => Math.max(0, Math.min(van.now - 1, van.stops.length));
  return { vans, delivered: vans.reduce((sum, van) => sum + behind(van), 0) };
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

/** The Routes line's describer on the board: the day's numbers, from the solve. */
export function routesWords(day: Day, measured: Measured): string {
  const vans = measured.vans.filter((van) => van.stops.length > 0).length;
  return `${day.orders.length} orders on ${vans} ${vans === 1 ? 'van' : 'vans'}: ${formatDuration(measured.drive)} of driving, the last van back after ${formatDuration(measured.back)}.`;
}

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
  readonly term: number;
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
    term: leader?.term ?? 0,
    followers: sim.servers.filter((s) => s !== leader).map((s) => s.id + 1),
    log: (leader?.log ?? []).map((_, i) => i < (leader?.commitIndex ?? 0)),
    words: `${lead} ${held}`,
  };
}
