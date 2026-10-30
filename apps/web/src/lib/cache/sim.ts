import { createAgenda, next, peekTime, schedule, type Agenda } from '../sim/agenda';
import { exponential, seeded, zipf, type Random } from '../sim/random';
import { conservation, createTally, overlapDetail, type Tally, type Violation } from './check';
import {
  CACHE_MS,
  DATABASE,
  fetchTime,
  firstUp,
  lifetime,
  LOADS,
  medianFetch,
  millis,
  NODES,
  owners,
  PAGES,
  pageName,
  refreshEarly,
  seconds,
  STALE_LIMIT,
  TIMEOUT,
  TTL,
  ZIPF,
  type Load,
  type Placement,
} from './core';

// A deterministic simulation of the bakery's cache in front of its database, in the style of the
// Raft Lab (ADR 0020): virtual time in milliseconds, one seeded stream for every draw, an agenda
// that orders events by time and then by the order they were scheduled, and the visitor's actions
// recorded at the virtual time they happened. The same seed and the same actions give the same
// run, event for event, in a test, at build and in the browser.
//
// The cache is look-aside, as in Nishtala et al. (NSDI 2013): a reader asks the page's node, and
// on a miss fetches the page from the database itself, then stores it on the page's node. A reader
// gives up after 1,000 ms, but the fetch it asked for still runs to the end and still stores the
// page: the database works for a reader who has gone, which is how a stampede feeds itself.

/**
 * Deliberately broken behaviours, for the tests only: each one is a bug the tests must catch
 * (test/cache.test.ts). The page never sets any.
 * - `leakFlight`: a reader waiting on a coalesced fetch is taken off it when it times out, but
 *   never ended, so it waits forever. Conservation must catch it.
 * - `staleForever`: stale-while-revalidate serves an entry however long ago it expired, past the
 *   4 s limit. `fresh` must break.
 * - `noJitter`: the jitter toggle is silently ignored. The known answer on how far apart entries
 *   set together expire must fail.
 * - `moduloOnCircle`: the circle places pages by modulo. The known answer on how many pages a lost
 *   node moves must fail.
 */
export interface Faults {
  readonly leakFlight?: boolean;
  readonly staleForever?: boolean;
  readonly noJitter?: boolean;
  readonly moduloOnCircle?: boolean;
}

/** The four mitigations, all off at first, and whether a write deletes what it changed. */
export type Toggle = 'coalesce' | 'stale' | 'early' | 'jitter' | 'invalidate';

export interface Config {
  readonly seed: number;
  readonly load?: Load;
  readonly placement?: Placement;
  readonly coalesce?: boolean;
  readonly stale?: boolean;
  readonly early?: boolean;
  readonly jitter?: boolean;
  /** Whether a write deletes the page's cached copies. On, unless the visitor turns it off. */
  readonly invalidate?: boolean;
  /** When the menu's warm entry expires, in ms. Every page starts cached, its entry expiring at a
   *  seeded moment within one TTL; the opening pins the menu's. */
  readonly menuExpires?: number;
  readonly faults?: Faults;
}

export interface Entry {
  readonly version: number;
  readonly writtenAt: number;
  readonly expiresAt: number;
  /** How long the fetch that set it took, from asking to the answer: XFetch's delta. */
  readonly delta: number;
}

export interface CacheNode {
  readonly id: number;
  up: boolean;
  /** Counts restarts: a node that comes back is a new process, which knows nothing of the fetches
   *  its last life asked for. */
  life: number;
  readonly entries: Map<number, Entry>;
  /** The latest fetch this node asked for, by page, until it is answered: with coalescing on, a
   *  miss waits on it instead of asking again. */
  readonly flights: Map<number, Fetch>;
}

/** How a read ended: a fresh hit, a stale hit, served by a fetch, or given up on. */
export type Outcome = 'hit' | 'stale' | 'served' | 'timeout';

export interface Read {
  readonly n: number;
  readonly key: number;
  readonly at: number;
  outcome: Outcome | 'pending';
  /** When it ended, and how long its reader waited: 1 ms for a hit, the fetch's time for a miss,
   *  1,000 ms for a reader who gave up. */
  ended: number;
  latency: number;
  /** The version it got, or 0 while it waits or when it gave up. */
  version: number;
  /** The fetch it waits on, when it missed. */
  fetch: Fetch | null;
}

export interface Fetch {
  readonly n: number;
  readonly key: number;
  /** Why it was asked: a reader missed; an entry past its expiry is refreshed behind the readers
   *  it is still served to; or the XFetch rule picked a reader to refresh it early. */
  readonly why: 'miss' | 'stale' | 'early';
  /** The node that asked for it and that node's life, or -1 when no node was up. */
  readonly node: number;
  readonly life: number;
  /** Whether coalescing was on when it was asked, so later misses on its node could wait on it. */
  readonly shared: boolean;
  readonly asked: number;
  started: number;
  ends: number;
  state: 'waiting' | 'running' | 'done';
  readonly readers: Read[];
}

export type Action =
  | { readonly at: number; readonly kind: 'flush' }
  | { readonly at: number; readonly kind: 'lose' | 'restore'; readonly node: number }
  | { readonly at: number; readonly kind: 'write'; readonly key: number }
  | { readonly at: number; readonly kind: 'load'; readonly load: Load }
  | { readonly at: number; readonly kind: 'placement'; readonly placement: Placement }
  | { readonly at: number; readonly kind: 'toggle'; readonly toggle: Toggle; readonly on: boolean };

export interface Line {
  readonly at: number;
  readonly text: string;
}

/** One point of the history strip, taken every 100 ms. */
export interface Sample {
  readonly at: number;
  /** The share of the last second's ended reads served from the cache, fresh or stale. */
  readonly hitRatio: number | null;
  /** Database connections in use, and fetches waiting for one. */
  readonly inUse: number;
  readonly waiting: number;
  /** Reads that began in the last second. */
  readonly readsPerSecond: number;
  /** The last second's read latencies, in ms: a reader who gave up counts the 1,000 ms it waited. */
  readonly p50: number | null;
  readonly p99: number | null;
  readonly timeouts: number;
}

/** A node lost: how many nodes were up before, and how many pages moved. */
export interface Loss {
  readonly at: number;
  readonly placement: Placement;
  readonly live: number;
  readonly moved: number;
}

type Event =
  | { readonly kind: 'read'; readonly stream: number }
  | { readonly kind: 'end'; readonly fetch: Fetch }
  | { readonly kind: 'give-up'; readonly read: Read }
  | { readonly kind: 'sample' };

/** A herd as it forms: when its first fetch was asked, why, and the most fetches in flight. */
interface Forming {
  readonly from: number;
  readonly expired: number | null;
  size: number;
}

export interface Sim {
  readonly seed: number;
  readonly faults: Faults;
  readonly random: Random;
  readonly agenda: Agenda<Event>;
  now: number;
  load: Load;
  placement: Placement;
  coalesce: boolean;
  stale: boolean;
  early: boolean;
  jitter: boolean;
  invalidate: boolean;
  readonly nodes: CacheNode[];
  /** Which node holds each page now, or -1 when no node is up. */
  owners: number[];
  /** The database, the source of truth: each page's version, and when each later version was
   *  written (writes[key][v - 1] is when version v + 1 was). */
  readonly versions: number[];
  readonly writes: number[][];
  /** The pool: fetches running, and the line waiting for a connection, first in, first out. */
  running: number;
  readonly line: Fetch[];
  lineHead: number;
  /** Each page's fetches in flight, asked and not yet answered. */
  readonly flying: Fetch[][];
  /** Each page's fetches over the run. */
  readonly fetchesOf: number[];
  readonly counts: {
    reads: number;
    pending: number;
    hit: number;
    stale: number;
    served: number;
    timeout: number;
    fetches: number;
    ended: number;
    /** Fetches that ended with every reader who waited on them gone. */
    wasted: number;
  };
  /** Reads that waited on a fetch, in the order they began, from `waitingHead` on. */
  readonly waiting: Read[];
  waitingHead: number;
  /** Reads that began in the last 2 s, and reads that ended in the last second. */
  readonly recent: Read[];
  readonly ended: Read[];
  readonly samples: Sample[];
  readonly tally: Tally;
  readonly herds: (Forming | null)[];
  readonly losses: Loss[];
  /** The arrival stream now running: a load change starts a new one, and the old one's next
   *  arrival is dropped when it comes. */
  stream: number;
  events: number;
  lines: Line[];
  readonly actions: Action[];
  violation: Violation | null;
  /** What the event log has said already, so each thing is said once. */
  readonly said: {
    readonly herd: number[];
    menuExpiry: number;
    poolFull: boolean;
    timeouts: number;
    readonly stale: Set<string>;
  };
}

const LINES = 200;
const SAMPLE_MS = 100;
/** One minute of the history strip. */
const SAMPLES = 600;
/** How far back the outcome strip reaches (view.ts), with a bucket to spare. */
const RECENT_MS = 2_100;
/** Herd sizes the event log reports as a herd grows. A herd of two is common on any hot page, so
 *  the log says it for the menu only. */
const HERD_STEPS = [2, 5, 10, 20, 50, 100, 200, 500, 1_000];

const drawPage = zipf(PAGES, ZIPF);

export function createSim(config: Config): Sim {
  const random = seeded(config.seed);
  const faults = config.faults ?? {};
  const placement = config.placement ?? 'circle';
  const nodes: CacheNode[] = Array.from({ length: NODES }, (_, id) => ({
    id,
    up: true,
    life: 0,
    entries: new Map(),
    flights: new Map(),
  }));
  const sim: Sim = {
    seed: config.seed,
    faults,
    random,
    agenda: createAgenda(),
    now: 0,
    load: config.load ?? 'busy',
    placement,
    coalesce: config.coalesce ?? false,
    stale: config.stale ?? false,
    early: config.early ?? false,
    jitter: config.jitter ?? false,
    invalidate: config.invalidate ?? true,
    nodes,
    owners: owners(placement, [true, true, true, true], Boolean(faults.moduloOnCircle)),
    versions: Array.from({ length: PAGES }, () => 1),
    writes: Array.from({ length: PAGES }, () => []),
    running: 0,
    line: [],
    lineHead: 0,
    flying: Array.from({ length: PAGES }, () => []),
    fetchesOf: Array.from({ length: PAGES }, () => 0),
    counts: {
      reads: 0,
      pending: 0,
      hit: 0,
      stale: 0,
      served: 0,
      timeout: 0,
      fetches: 0,
      ended: 0,
      wasted: 0,
    },
    waiting: [],
    waitingHead: 0,
    recent: [],
    ended: [],
    samples: [],
    tally: createTally(PAGES),
    herds: Array.from({ length: PAGES }, () => null),
    losses: [],
    stream: 0,
    events: 0,
    lines: [],
    actions: [],
    violation: null,
    said: {
      herd: Array.from({ length: PAGES }, () => 0),
      menuExpiry: NaN,
      poolFull: false,
      timeouts: 0,
      stale: new Set(),
    },
  };
  // The warm-up: the cache has been serving for a while, so every page is cached, each entry set
  // at a seeded moment in the last TTL, so their expiries spread over the next 8 s as they would
  // in a cache left alone. Every page draws, the menu too, so pinning the menu's expiry leaves
  // the rest of the run's draws where they were.
  for (let key = 0; key < PAGES; key++) {
    const drawn = random() * TTL;
    const expiresAt = key === 0 ? (config.menuExpires ?? drawn) : drawn;
    const node = sim.nodes[sim.owners[key] ?? -1];
    node?.entries.set(key, {
      version: 1,
      writtenAt: expiresAt - TTL,
      expiresAt,
      delta: medianFetch(key),
    });
  }
  schedule(sim.agenda, exponential(random, LOADS[sim.load]), { kind: 'read', stream: 0 });
  schedule(sim.agenda, SAMPLE_MS, { kind: 'sample' });
  return sim;
}

function say(sim: Sim, text: string): void {
  sim.lines.push({ at: sim.now, text });
  if (sim.lines.length > LINES) sim.lines.splice(0, sim.lines.length - LINES);
}

/** After every event and action: drop the readers who have ended from the front of the waiting
 *  list, then check conservation. */
function settle(sim: Sim, deep = false): void {
  while (
    sim.waitingHead < sim.waiting.length &&
    (sim.waiting[sim.waitingHead] as Read).outcome !== 'pending'
  )
    sim.waitingHead++;
  if (sim.waitingHead > 4_096) {
    sim.waiting.splice(0, sim.waitingHead);
    sim.waitingHead = 0;
  }
  sim.violation ??= conservation(sim, deep);
}

/** When the next event happens. Readers keep arriving, so there always is one. */
export const nextTime = (sim: Sim): number => peekTime(sim.agenda);

/** Processes the next event: in time order, and events at one virtual time in the order they
 *  were scheduled. */
export function step(sim: Sim): boolean {
  if (sim.violation) return false;
  const entry = next(sim.agenda);
  if (!entry) return false;
  sim.now = Math.max(sim.now, entry.at);
  const event = entry.event;
  switch (event.kind) {
    case 'read':
      arrive(sim, event.stream);
      break;
    case 'end':
      end(sim, event.fetch);
      break;
    case 'give-up':
      giveUp(sim, event.read);
      break;
    case 'sample':
      sample(sim);
      break;
  }
  sim.events += 1;
  settle(sim, event.kind === 'sample');
  return true;
}

/** Runs every event up to a virtual time, then stands at it. */
export function runUntil(sim: Sim, until: number, limit = Infinity): void {
  let left = limit;
  while (!sim.violation && left-- > 0 && nextTime(sim) <= until) step(sim);
  if (!sim.violation) sim.now = Math.max(sim.now, until);
}

function arrive(sim: Sim, stream: number): void {
  if (stream !== sim.stream) return;
  schedule(sim.agenda, sim.now + exponential(sim.random, LOADS[sim.load]), {
    kind: 'read',
    stream,
  });
  sim.counts.reads += 1;
  sim.counts.pending += 1;
  const read: Read = {
    n: sim.counts.reads,
    key: drawPage(sim.random),
    at: sim.now,
    outcome: 'pending',
    ended: NaN,
    latency: NaN,
    version: 0,
    fetch: null,
  };
  sim.recent.push(read);
  look(sim, read);
}

/** A reader asks the page's node: a hit, a stale hit, or a miss that goes to the database. */
function look(sim: Sim, read: Read): void {
  const key = read.key;
  const node = sim.nodes[sim.owners[key] ?? -1];
  const entry = node?.entries.get(key);
  if (node && entry) {
    if (sim.now < entry.expiresAt) {
      if (sim.early && refreshesEarly(sim, node, entry, read)) return;
      fromCache(sim, read, entry, 'hit');
      return;
    }
    if (sim.stale && (sim.now - entry.expiresAt <= STALE_LIMIT || sim.faults.staleForever)) {
      if (key === 0 && sim.said.menuExpiry !== entry.expiresAt) {
        sim.said.menuExpiry = entry.expiresAt;
        say(
          sim,
          `The menu's entry expired at ${seconds(entry.expiresAt)}: its readers still get it at once, while one fetch refreshes it`,
        );
      }
      // One refresh at a time per node: a fetch already in flight for the page will store it.
      if (!node.flights.has(key)) ask(sim, node, key, 'stale', null, entry.expiresAt);
      fromCache(sim, read, entry, 'stale');
      return;
    }
  }
  // A miss: the page is not cached on its node, or its entry is past what may be served.
  if (key === 0 && entry && sim.said.menuExpiry !== entry.expiresAt) {
    sim.said.menuExpiry = entry.expiresAt;
    say(
      sim,
      `The menu's entry expired at ${seconds(entry.expiresAt)}: ${sim.coalesce ? 'its readers miss, and each node sends one fetch for them all' : 'its readers miss, and each one fetches it from the database'}`,
    );
  }
  const flight = node?.flights.get(key);
  if (sim.coalesce && flight) {
    wait(sim, read, flight);
    return;
  }
  ask(sim, node, key, 'miss', read, entry ? entry.expiresAt : null);
}

/** XFetch: on a hit, this reader may be the one that refreshes the page before it expires. It
 *  waits for the fetch, as in the paper; everyone else keeps hitting the entry meanwhile. */
function refreshesEarly(sim: Sim, node: CacheNode, entry: Entry, read: Read): boolean {
  if (!refreshEarly(sim.now, entry.expiresAt, entry.delta, 1 - sim.random())) return false;
  // With coalescing on, a fetch already on its way will refresh the entry: take the hit.
  if (sim.coalesce && node.flights.has(read.key)) return false;
  if (read.key === 0)
    say(
      sim,
      `A reader refreshes the menu ${millis(entry.expiresAt - sim.now)} before its entry expires, by the XFetch rule`,
    );
  ask(sim, node, read.key, 'early', read, null);
  return true;
}

function fromCache(sim: Sim, read: Read, entry: Entry, outcome: 'hit' | 'stale'): void {
  read.version = entry.version;
  checkFresh(sim, read, entry);
  finish(sim, read, outcome, CACHE_MS);
}

/** fresh: a reader may not get a version the database has replaced, nor an entry past its expiry
 *  by more than the stale limit allows (0 without stale-while-revalidate, 4 s with it). */
function checkFresh(sim: Sim, read: Read, entry: Entry): void {
  const key = read.key;
  let staleness = -1;
  let detail = '';
  if (entry.version < (sim.versions[key] as number)) {
    const replaced = (sim.writes[key] as number[])[entry.version - 1] as number;
    staleness = sim.now - replaced;
    detail = `A reader of ${pageName(key)} got version ${entry.version}, ${millis(staleness)} after version ${entry.version + 1} was written`;
  }
  const limit = sim.stale ? STALE_LIMIT : 0;
  const over = sim.now - entry.expiresAt - limit;
  if (over > 0 && over > staleness) {
    staleness = over;
    detail = `${firstUp(pageName(key))} was served ${millis(sim.now - entry.expiresAt)} past its expiry, ${millis(over)} beyond the ${millis(limit)} the cache allows`;
  }
  if (staleness < 0) return;
  const t = sim.tally;
  t.staleReads += 1;
  t.worstStale = Math.max(t.worstStale, staleness);
  t.firstStale ??= { at: sim.now, detail };
  // Once per page, version and kind: a stale page is read many times a second.
  const once = `${key} ${entry.version} ${over > 0 ? 'late' : 'old'}`;
  if (!sim.said.stale.has(once)) {
    sim.said.stale.add(once);
    say(sim, detail);
  }
}

function finish(sim: Sim, read: Read, outcome: Outcome, latency: number): void {
  if (read.outcome !== 'pending') {
    sim.violation ??= {
      at: sim.now,
      detail: `Read ${read.n}, of ${pageName(read.key)}, ended twice: as ${read.outcome}, then as ${outcome}`,
    };
    return;
  }
  read.outcome = outcome;
  read.ended = sim.now;
  read.latency = latency;
  sim.counts.pending -= 1;
  sim.counts[outcome] += 1;
  sim.ended.push(read);
}

/** A fetch is asked for: it runs at once if a connection is free, or joins the line. */
function ask(
  sim: Sim,
  node: CacheNode | undefined,
  key: number,
  why: Fetch['why'],
  read: Read | null,
  expired: number | null,
): void {
  sim.counts.fetches += 1;
  const fetch: Fetch = {
    n: sim.counts.fetches,
    key,
    why,
    node: node?.id ?? -1,
    life: node?.life ?? 0,
    shared: sim.coalesce,
    asked: sim.now,
    started: NaN,
    ends: NaN,
    state: 'waiting',
    readers: [],
  };
  const flying = sim.flying[key] as Fetch[];
  if (flying.length === 0) sim.herds[key] = { from: sim.now, expired, size: 0 };
  else overlap(sim, fetch, flying);
  flying.push(fetch);
  noteHerd(sim, fetch, flying.length);
  sim.fetchesOf[key] = (sim.fetchesOf[key] as number) + 1;
  node?.flights.set(key, fetch);
  if (read) wait(sim, read, fetch);
  if (sim.running < DATABASE.pool) start(sim, fetch);
  else sim.line.push(fetch);
}

/** one-fetch broke: this page was already being fetched. With no node up there is nothing to
 *  coalesce on, so only a node that is up can overlap with itself. */
function overlap(sim: Sim, fetch: Fetch, flying: readonly Fetch[]): void {
  const t = sim.tally;
  t.overlaps += 1;
  for (const other of flying)
    if (fetch.node >= 0 && other.shared && other.node === fetch.node && other.life === fetch.life) {
      t.sameNode += 1;
      break;
    }
  t.firstOverlap ??= { at: sim.now, detail: overlapDetail(fetch.key, flying.length + 1) };
}

/** A herd grew to `size` fetches in flight, the latest being `fetch`: keep its peak, and say so
 *  at each step. */
function noteHerd(sim: Sim, fetch: Fetch, size: number): void {
  const key = fetch.key;
  const herd = sim.herds[key];
  if (herd) herd.size = Math.max(herd.size, size);
  const t = sim.tally;
  t.peak[key] = Math.max(t.peak[key] as number, size);
  if (herd && (!t.herd || herd.size > t.herd.size))
    t.herd = { key, size: herd.size, from: herd.from, expired: herd.expired };
  const reached = HERD_STEPS.includes(size) && size > (sim.said.herd[key] as number);
  if (!reached || (size === 2 && key !== 0)) return;
  sim.said.herd[key] = size;
  const second = {
    miss: 'a second reader missed before the first fetch came back',
    early: 'a second reader drew an early refresh while the first was still running',
    stale: 'a second node refreshes it while the first fetch is still running',
  };
  say(
    sim,
    size === 2
      ? `${firstUp(pageName(key))} is fetched twice at once: ${second[fetch.why]}`
      : `${firstUp(pageName(key))} now has ${size} fetches in flight at once`,
  );
}

function wait(sim: Sim, read: Read, fetch: Fetch): void {
  fetch.readers.push(read);
  read.fetch = fetch;
  sim.waiting.push(read);
  schedule(sim.agenda, read.at + TIMEOUT, { kind: 'give-up', read });
}

/** A fetch takes a connection. Its time is drawn now, with the line it leaves behind: each fetch
 *  still waiting slows the database by 0.6 ms. */
function start(sim: Sim, fetch: Fetch): void {
  sim.running += 1;
  fetch.state = 'running';
  fetch.started = sim.now;
  const waiting = sim.line.length - sim.lineHead;
  const time = fetchTime(fetch.key, waiting, sim.random);
  // A fetch reaches the database after the cache's millisecond that told its reader to fetch.
  fetch.ends = Math.max(sim.now, fetch.asked + CACHE_MS) + time;
  schedule(sim.agenda, fetch.ends, { kind: 'end', fetch });
}

/** The database answers a fetch: its readers still waiting are served, the page is stored, and
 *  the connection takes the next fetch in line. */
function end(sim: Sim, fetch: Fetch): void {
  if (fetch.state !== 'running') {
    sim.violation ??= {
      at: sim.now,
      detail: `Fetch ${fetch.n}, of ${pageName(fetch.key)}, ended twice`,
    };
    return;
  }
  fetch.state = 'done';
  sim.running -= 1;
  sim.counts.ended += 1;
  const key = fetch.key;
  const flying = sim.flying[key] as Fetch[];
  const index = flying.indexOf(fetch);
  if (index >= 0) flying.splice(index, 1);
  if (flying.length === 0) {
    sim.herds[key] = null;
    sim.said.herd[key] = 0;
  }
  // The database answers with the version it holds now. A real fetch reads before it answers,
  // and a write in between can put the old version back after the write's delete: the stale set
  // that the NSDI paper's leases prevent. Here the read and the answer are one instant, so that
  // race cannot happen, and `fresh` with invalidation on holds by this model's design.
  const version = sim.versions[key] as number;
  let served = 0;
  for (const read of fetch.readers) {
    if (read.outcome !== 'pending') continue;
    read.version = version;
    finish(sim, read, 'served', sim.now - read.at);
    served++;
  }
  // Every reader who waited on it has gone: the work is wasted, though the page is still stored.
  if (served === 0 && fetch.why !== 'stale') sim.counts.wasted += 1;
  store(sim, key, version, sim.now - fetch.asked);
  const asker = sim.nodes[fetch.node];
  if (asker?.flights.get(key) === fetch) asker.flights.delete(key);
  if (sim.lineHead < sim.line.length) {
    const following = sim.line[sim.lineHead] as Fetch;
    sim.lineHead += 1;
    if (sim.lineHead > 4_096) {
      sim.line.splice(0, sim.lineHead);
      sim.lineHead = 0;
    }
    start(sim, following);
  }
}

/** Look-aside: the fetcher stores the page on the node that holds it now, which is not the node
 *  that asked if a lost node or a new placement moved the page meanwhile. */
function store(sim: Sim, key: number, version: number, delta: number): void {
  const node = sim.nodes[sim.owners[key] ?? -1];
  if (!node) return;
  const jitter = sim.jitter && !sim.faults.noJitter;
  const expiresAt = sim.now + lifetime(jitter, jitter ? sim.random() : 0);
  const before = node.entries.get(key);
  node.entries.set(key, { version, writtenAt: sim.now, expiresAt, delta });
  if (key === 0 && (!before || before.expiresAt <= sim.now))
    say(sim, `The menu is cached again as version ${version}, until ${seconds(expiresAt)}`);
}

/** A reader's 1,000 ms are up. Its fetch, if any, runs on: the database cannot know. */
function giveUp(sim: Sim, read: Read): void {
  if (read.outcome !== 'pending') return;
  const fetch = read.fetch;
  if (sim.faults.leakFlight && fetch?.shared) {
    // The bug: the reader leaves the fetch's list and is never ended, so it waits forever.
    const index = fetch.readers.indexOf(read);
    if (index >= 0) fetch.readers.splice(index, 1);
    return;
  }
  finish(sim, read, 'timeout', TIMEOUT);
  const t = sim.tally;
  t.timeouts += 1;
  if (!t.firstTimeout) {
    t.firstTimeout = {
      at: sim.now,
      detail: `A reader of ${pageName(read.key)} gave up after waiting ${millis(TIMEOUT)}`,
    };
    const waiting = sim.line.length - sim.lineHead;
    say(sim, `${t.firstTimeout.detail}, with ${waiting} fetches in line for the database`);
  }
}

/** The nearest-rank quantile of sorted numbers. */
function quantile(sorted: readonly number[], q: number): number | null {
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)] as number;
}

/** Drops the reads at the front of a list, oldest first, that `gone` says have left its window. */
function dropFront(list: Read[], gone: (read: Read) => boolean): void {
  let count = 0;
  while (count < list.length && gone(list[count] as Read)) count++;
  if (count > 0) list.splice(0, count);
}

/** Every 100 ms: a point of the history strip, a deeper conservation check, and the event log's
 *  lines about the database's line and the readers giving up. */
function sample(sim: Sim): void {
  schedule(sim.agenda, sim.now + SAMPLE_MS, { kind: 'sample' });
  const since = sim.now - 1_000;
  dropFront(sim.recent, (read) => read.at < sim.now - RECENT_MS);
  dropFront(sim.ended, (read) => read.ended <= since);
  const latencies: number[] = [];
  let cached = 0;
  for (const read of sim.ended) {
    latencies.push(read.latency);
    if (read.outcome === 'hit' || read.outcome === 'stale') cached++;
  }
  latencies.sort((a, b) => a - b);
  let began = 0;
  for (let i = sim.recent.length - 1; i >= 0 && (sim.recent[i] as Read).at > since; i--) began++;
  const waiting = sim.line.length - sim.lineHead;
  sim.samples.push({
    at: sim.now,
    hitRatio: latencies.length > 0 ? cached / latencies.length : null,
    inUse: sim.running,
    waiting,
    readsPerSecond: began,
    p50: quantile(latencies, 0.5),
    p99: quantile(latencies, 0.99),
    timeouts: sim.counts.timeout,
  });
  if (sim.samples.length > SAMPLES) sim.samples.splice(0, sim.samples.length - SAMPLES);
  // The line is said full once it is as long as the pool, and empty once it is gone: a line that
  // comes and goes within a sample is not news.
  if (!sim.said.poolFull && waiting >= DATABASE.pool) {
    sim.said.poolFull = true;
    say(
      sim,
      `All ${DATABASE.pool} database connections are busy, and ${waiting} fetches wait in line for one`,
    );
  } else if (sim.said.poolFull && waiting === 0) {
    sim.said.poolFull = false;
    say(sim, 'The line for the database is empty again');
  }
  if (sim.now % 1_000 === 0 && sim.counts.timeout > sim.said.timeouts) {
    const fresh = sim.counts.timeout - sim.said.timeouts;
    sim.said.timeouts = sim.counts.timeout;
    say(
      sim,
      `${fresh.toLocaleString('en-US')} ${fresh === 1 ? 'reader' : 'readers'} gave up in the last second, ${sim.counts.timeout.toLocaleString('en-US')} in all`,
    );
  }
}

function record(sim: Sim, action: Action): void {
  sim.actions.push(action);
}

/** Places every page again after a node or the placement changed; returns how many moved. */
function place(sim: Sim): number {
  const before = sim.owners;
  sim.owners = owners(
    sim.placement,
    sim.nodes.map((node) => node.up),
    Boolean(sim.faults.moduloOnCircle),
  );
  let moved = 0;
  for (let key = 0; key < PAGES; key++) if (before[key] !== sim.owners[key]) moved++;
  return moved;
}

/** Every node empties at once: a cold start. The pages fetched next are set within the same
 *  moment, so they expire together 8 s later, unless jitter spreads them. */
export function flush(sim: Sim): void {
  record(sim, { at: sim.now, kind: 'flush' });
  for (const node of sim.nodes) node.entries.clear();
  say(
    sim,
    sim.jitter
      ? 'The cache is flushed: every node is empty, and each page misses until it is fetched again'
      : 'The cache is flushed: every node is empty, and the pages fetched again now will expire together',
  );
  settle(sim);
}

/** A cache node is lost with everything it held. Fetches it asked for still run at the database,
 *  and their readers still get them; what they fetch is stored on the page's new node. */
export function loseNode(sim: Sim, node: number): void {
  const lost = sim.nodes[node];
  if (!lost?.up) return;
  record(sim, { at: sim.now, kind: 'lose', node });
  let live = 0;
  for (const n of sim.nodes) if (n.up) live++;
  lost.up = false;
  lost.entries.clear();
  lost.flights.clear();
  const moved = place(sim);
  sim.losses.push({ at: sim.now, placement: sim.placement, live, moved });
  say(
    sim,
    live === 1
      ? `Node ${node + 1} is lost, and no cache node is left: every read goes to the database`
      : `Node ${node + 1} is lost with everything it held: ${moved} of ${PAGES} pages now live on another node`,
  );
  settle(sim);
}

/** A lost node comes back, empty: a new process, which knows nothing of its last life. */
export function restoreNode(sim: Sim, node: number): void {
  const back = sim.nodes[node];
  if (!back || back.up) return;
  record(sim, { at: sim.now, kind: 'restore', node });
  back.up = true;
  back.life += 1;
  const moved = place(sim);
  say(
    sim,
    `Node ${node + 1} is back, empty: ${moved} of ${PAGES} pages now live on a different node`,
  );
  settle(sim);
}

/**
 * The source of truth changes: the page's next version. With invalidation on, the write deletes
 * the page from every node that is up, not only the one that holds it now: a page that moved when
 * a node was lost may have left a copy on its old node, which would serve the old version again
 * the day the page moves back. With invalidation off, the old version stays until it expires.
 */
export function write(sim: Sim, key: number): void {
  if (!Number.isInteger(key) || key < 0 || key >= PAGES) return;
  record(sim, { at: sim.now, kind: 'write', key });
  const version = (sim.versions[key] as number) + 1;
  sim.versions[key] = version;
  (sim.writes[key] as number[]).push(sim.now);
  const name = firstUp(pageName(key));
  if (sim.invalidate) {
    for (const node of sim.nodes) if (node.up) node.entries.delete(key);
    say(sim, `${name} changes to version ${version}, and the write deletes its cached copy`);
  } else {
    const entry = sim.nodes[sim.owners[key] ?? -1]?.entries.get(key);
    say(
      sim,
      entry && entry.expiresAt > sim.now
        ? `${name} changes to version ${version}, but the cache serves version ${entry.version} until it expires at ${seconds(entry.expiresAt)}`
        : `${name} changes to version ${version}, and no live entry holds it, so its next reader fetches the new one`,
    );
  }
  settle(sim);
}

export function setLoad(sim: Sim, load: Load): void {
  if (load === sim.load || !(load in LOADS)) return;
  record(sim, { at: sim.now, kind: 'load', load });
  sim.load = load;
  // A new arrival stream at the new rate. A Poisson process has no memory, so starting one now is
  // the same as if the rate had always been this one; the old stream's pending arrival is dropped.
  sim.stream += 1;
  schedule(sim.agenda, sim.now + exponential(sim.random, LOADS[load]), {
    kind: 'read',
    stream: sim.stream,
  });
  say(sim, `Readers now ask for ${LOADS[load]} pages a second (${load})`);
  settle(sim);
}

const TOGGLE_LINES: Record<Toggle, readonly [off: string, on: string]> = {
  coalesce: [
    'Coalescing is off: every reader that misses fetches the page itself',
    'Coalescing is on: readers that miss the same page on one node wait on one fetch',
  ],
  stale: [
    'Stale-while-revalidate is off: an expired entry is a miss',
    'Stale-while-revalidate is on: an entry up to 4 s past its expiry is served at once while one fetch refreshes it',
  ],
  early: [
    'Early refresh is off: an entry is fetched again only once it has expired',
    'Early refresh is on: a read may refresh an entry before it expires, the more likely the nearer its expiry',
  ],
  jitter: [
    'Jitter is off: every entry lives exactly 8 s',
    'Jitter is on: each entry lives between 6.4 and 9.6 s',
  ],
  invalidate: [
    'Writes no longer delete the cached copy: the old version stays until it expires',
    'Writes delete the cached copy at once',
  ],
};

export function setToggle(sim: Sim, toggle: Toggle, on: boolean): void {
  if (sim[toggle] === on) return;
  record(sim, { at: sim.now, kind: 'toggle', toggle, on });
  sim[toggle] = on;
  say(sim, TOGGLE_LINES[toggle][on ? 1 : 0]);
  settle(sim);
}

export const setCoalesce = (sim: Sim, on: boolean): void => setToggle(sim, 'coalesce', on);
export const setStale = (sim: Sim, on: boolean): void => setToggle(sim, 'stale', on);
export const setEarly = (sim: Sim, on: boolean): void => setToggle(sim, 'early', on);
export const setJitter = (sim: Sim, on: boolean): void => setToggle(sim, 'jitter', on);
export const setInvalidate = (sim: Sim, on: boolean): void => setToggle(sim, 'invalidate', on);

export function setPlacement(sim: Sim, placement: Placement): void {
  if (placement === sim.placement) return;
  record(sim, { at: sim.now, kind: 'placement', placement });
  sim.placement = placement;
  const moved = place(sim);
  say(
    sim,
    `Pages are now placed ${placement === 'circle' ? 'on the hash circle' : 'by their hash modulo the live nodes'}: ${moved} of ${PAGES} move to another node`,
  );
  settle(sim);
}

/** Replays recorded actions on a fresh run of the same config: the run they came from, exactly. */
export function replay(config: Config, actions: readonly Action[], until: number): Sim {
  const sim = createSim(config);
  for (const action of actions) {
    runUntil(sim, action.at);
    switch (action.kind) {
      case 'flush':
        flush(sim);
        break;
      case 'lose':
        loseNode(sim, action.node);
        break;
      case 'restore':
        restoreNode(sim, action.node);
        break;
      case 'write':
        write(sim, action.key);
        break;
      case 'load':
        setLoad(sim, action.load);
        break;
      case 'placement':
        setPlacement(sim, action.placement);
        break;
      case 'toggle':
        setToggle(sim, action.toggle, action.on);
        break;
    }
  }
  runUntil(sim, until);
  return sim;
}

export type { Violation };
