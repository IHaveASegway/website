import { firstUp, pageName, seconds, TIMEOUT, DATABASE } from './core';
import type { Fetch, Sim } from './sim';

// What the Cache Lab checks, in two kinds. Conservation is an invariant: every read ends as exactly
// one outcome, and every fetch the database starts ends, by the time its answer is due. It holds
// in every configuration, and a break is a bug in the simulation that freezes the run, as a
// broken safety property does in the Raft Lab. The three properties are different: a weak
// configuration breaking one is the lesson, so the run goes on and each break is counted, with the
// first one and the worst.

export const PROPERTIES = [
  { id: 'one-fetch', name: 'The database fetched each key once at a time' },
  { id: 'no-timeouts', name: 'No reader timed out' },
  { id: 'fresh', name: 'No reader saw a version older than the stale limit allows' },
] as const;

export type PropertyId = (typeof PROPERTIES)[number]['id'];

export interface Break {
  readonly at: number;
  readonly detail: string;
}

export interface PropertyState {
  readonly id: PropertyId;
  readonly name: string;
  readonly held: boolean;
  /** How many times it broke: overlapping fetches, timed-out reads, or reads too old. */
  readonly count: number;
  readonly first?: Break;
  /** The worst case, where one number says it: the most fetches of one page at once, or the
   *  oldest read's staleness in ms. */
  readonly worst?: number;
}

/** A herd: fetches of one page in flight together, from the first until none is left. */
export interface Herd {
  readonly key: number;
  readonly size: number;
  /** When its first fetch was asked. */
  readonly from: number;
  /** When the entry its first reader found too old had expired, or null when there was none. */
  readonly expired: number | null;
}

/** The running count of every property's breaks, kept by the simulation as they happen. */
export interface Tally {
  /** one-fetch: fetches asked while another fetch of the same page was still in flight. */
  overlaps: number;
  /** Of those, the ones beside a coalesced fetch from the same node in the same life: the
   *  overlap coalescing exists to prevent. A page that moves to another node mid-fetch is fetched
   *  again there, coalescing or not, because coalescing is per node. */
  sameNode: number;
  firstOverlap: Break | null;
  /** The most fetches of each page that were in flight at once. */
  readonly peak: number[];
  /** The largest herd so far. */
  herd: Herd | null;
  timeouts: number;
  firstTimeout: Break | null;
  /** fresh: reads that got a version the database had replaced, or an entry served past what
   *  the stale limit allows, and the worst staleness in ms. */
  staleReads: number;
  worstStale: number;
  firstStale: Break | null;
}

export const createTally = (pages: number): Tally => ({
  overlaps: 0,
  sameNode: 0,
  firstOverlap: null,
  peak: Array.from({ length: pages }, () => 0),
  herd: null,
  timeouts: 0,
  firstTimeout: null,
  staleReads: 0,
  worstStale: 0,
  firstStale: null,
});

/** A broken invariant: a bug, which stops the run where it happened. */
export interface Violation {
  readonly at: number;
  readonly detail: string;
}

/**
 * Conservation, after every event: no read or fetch has appeared from nowhere or vanished. Each
 * check is a few comparisons of counts the simulation keeps against the places reads and fetches
 * actually sit, so it runs after every event. `deep` also walks every waiting read and every fetch
 * in flight, which the simulation does every 100 ms.
 */
export function conservation(sim: Sim, deep = false): Violation | null {
  const fail = (detail: string): Violation => ({ at: sim.now, detail });
  const c = sim.counts;
  const ended = c.hit + c.stale + c.served + c.timeout;
  if (c.pending < 0 || c.reads !== ended + c.pending)
    return fail(
      `${c.reads} reads began, but ${ended} ended and ${c.pending} are waiting: some appeared or vanished`,
    );
  const waiting = sim.line.length - sim.lineHead;
  if (sim.running < 0 || sim.running > DATABASE.pool)
    return fail(`${sim.running} fetches are running on a pool of ${DATABASE.pool} connections`);
  if (c.fetches !== c.ended + c.cancelled + sim.running + waiting)
    return fail(
      `${c.fetches} fetches began, but ${c.ended} ended, ${c.cancelled} left the line, ${sim.running} run and ${waiting} wait: some vanished`,
    );
  // The counts agree for a fetch the database never answers: it is counted as running, and it
  // runs. Only its time gives it away, so each connection's fetch is held to the time its answer
  // was due. Events run in time order, so once the clock has passed that time, the answer is lost.
  if (sim.connections.length !== sim.running)
    return fail(
      `${sim.running} fetches are counted as running, but ${sim.connections.length} hold a connection`,
    );
  for (const fetch of sim.connections)
    if (fetch.ends < sim.now)
      return fail(
        `Fetch ${fetch.n}, of ${pageName(fetch.key)}, was due back at ${seconds(fetch.ends)}, but still holds a connection: the database never answered it`,
      );
  // Every reader gives up at 1,000 ms, so a read still waiting past that was lost track of. The
  // waiting reads sit in the order they began, so the oldest is first.
  const oldest = sim.waiting[sim.waitingHead];
  if (oldest && oldest.outcome === 'pending' && oldest.at + TIMEOUT < sim.now)
    return fail(
      `Read ${oldest.n}, of ${pageName(oldest.key)}, has waited ${Math.round(sim.now - oldest.at).toLocaleString('en-US')} ms, past the ${TIMEOUT.toLocaleString('en-US')} ms at which every reader gives up`,
    );
  if (!deep) return null;
  let pending = 0;
  for (let i = sim.waitingHead; i < sim.waiting.length; i++)
    if ((sim.waiting[i] as { outcome: string }).outcome === 'pending') pending++;
  if (pending !== c.pending)
    return fail(`${c.pending} reads are counted as waiting, but ${pending} are`);
  let flying = 0;
  for (const list of sim.flying) flying += list.length;
  if (flying !== sim.running + waiting)
    return fail(
      `${flying} fetches are in flight by page, but the pool holds ${sim.running + waiting}`,
    );
  // Nothing waits in line for nobody: a fetch in line has a reader still waiting on it, or is a
  // stale refresh, which no reader asked for. Every reader gives up within 1,000 ms, so a fetch
  // never waits in line longer than its newest reader, and the line stays bounded. With dropping
  // turned off the line keeps such fetches by design, and nothing bounds it: that is the lesson.
  if (!sim.drop) return null;
  for (let i = sim.lineHead; i < sim.line.length; i++) {
    const fetch = sim.line[i] as Fetch;
    if (fetch.why !== 'stale' && !fetch.readers.some((read) => read.outcome === 'pending'))
      return fail(
        `Fetch ${fetch.n}, of ${pageName(fetch.key)}, waits in line with no reader left waiting on it`,
      );
  }
  return null;
}

/** The three properties, in PROPERTIES' order: held or broken, with each one's count, first
 *  break and worst case. */
export function properties(sim: Sim): readonly [PropertyState, PropertyState, PropertyState] {
  const t = sim.tally;
  const state = (
    index: 0 | 1 | 2,
    count: number,
    first: Break | null,
    worst?: number,
  ): PropertyState => {
    const { id, name } = PROPERTIES[index];
    return {
      id,
      name,
      held: count === 0,
      count,
      ...(first ? { first } : {}),
      ...(worst === undefined ? {} : { worst }),
    };
  };
  return [
    state(0, t.overlaps, t.firstOverlap, Math.max(0, ...t.peak)),
    state(1, t.timeouts, t.firstTimeout),
    state(2, t.staleReads, t.firstStale, t.worstStale),
  ];
}

/**
 * Why a page was fetched while a fetch of it was in flight: another fetch from the same node (a
 * herd, which coalescing prevents), only fetches from the node it lived on before (it changed
 * node mid-fetch, which coalescing cannot prevent, being per node), or no node up to hold it.
 */
export type Cause = 'herd' | 'moved' | 'no node';

/** The causes that are not a herd, as the clause that says them. */
export const CAUSES = {
  moved: 'it changed node while a fetch of it still ran',
  'no node': 'no cache node was up to hold it',
} as const;

/** The detail of an overlap, for the property's first break: with coalescing on, one-fetch can
 *  still break, and the detail says why. */
export const overlapDetail = (key: number, together: number, cause: Cause): string =>
  `${firstUp(pageName(key))} was being fetched ${together} times at once${cause === 'herd' ? '' : `: ${CAUSES[cause]}`}`;
