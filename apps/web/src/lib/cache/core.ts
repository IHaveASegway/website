import { lognormal, type Random } from '../sim/random';

// The Cache Lab's rules: the bakery's pages and how often each is asked for, which cache node
// holds each page, how long a fetch and an entry last, and when a read refreshes an entry before it
// expires. Nothing here keeps state or reads a clock: time comes in as `now` and chance as a draw
// or a seeded stream, and the simulation (sim.ts) drives these rules in virtual time.
//
// The prior art the lab follows, all public:
// - Vattani, Chierichetti and Lowenstein, "Optimal Probabilistic Cache Stampede Prevention",
//   VLDB 2015: the XFetch rule (refreshEarly, below).
// - Nishtala et al., "Scaling Memcache at Facebook", NSDI 2013: a look-aside cache, a delete on
//   every write, and leases against thundering herds, which per-node coalescing stands in for.
// - RFC 5861, "HTTP Cache-Control Extensions for Stale Content": stale-while-revalidate.
// - Karger et al., "Consistent Hashing and Random Trees", STOC 1997: the hash circle.

/** The bakery's site: 120 pages, asked for by Zipf's law with s = 1.1. Page 0 is the menu. */
export const PAGES = 120;
export const ZIPF = 1.1;

/** The cache nodes, and how many virtual points each one puts on the hash circle. */
export const NODES = 4;
export const POINTS = 64;

/** What a cache read costs, in virtual ms: the whole of a hit's latency. */
export const CACHE_MS = 1;
/** How long an entry lives once it is set. */
export const TTL = 8_000;
/** With stale-while-revalidate on, how long past its expiry an entry may still be served. */
export const STALE_LIMIT = 4_000;
/** How long a reader waits before it gives up. */
export const TIMEOUT = 1_000;

/**
 * The database behind the cache. A fetch's time is log-normal, plus 0.6 ms for each fetch already
 * waiting for a connection when it starts: a loaded database answers more slowly, so a line that
 * forms feeds itself.
 *
 * The menu is the one dear page: it gathers every item on sale, so building it takes twelve
 * ordinary fetches' time. A stampede needs a page that is both the most read and slow to rebuild,
 * the case the XFetch paper is about. At 35 ms the menu's readers would miss for only 35 ms after
 * each expiry: two or three fetches at 300 reads a second, which a pool of 8 absorbs unseen.
 * 420 ms is measured, not guessed: over 60 seeds at a busy hour the menu's expiry made 20 or
 * more fetches at once in 35 and timed readers out in 52, and the database recovered before the
 * next expiry in 19 of 20 one-minute runs. At 460 ms a busy hour alone left a line that never
 * cleared in 10 of those 20 runs, before the visitor had done anything.
 */
export const DATABASE = {
  /** Connections in the pool: at most this many fetches run at once; the rest wait in line. */
  pool: 8,
  /** An ordinary page's fetch: its median, in ms, and the sigma of its log. */
  median: 35,
  spread: 0.35,
  /** The menu's fetch, with the same spread. */
  menuMedian: 420,
  /** What each fetch already waiting adds to a fetch's time, in ms. */
  perWaiting: 0.6,
} as const;

/** The median fetch time of a page: what a warm entry records as its last fetch's duration. */
export const medianFetch = (key: number): number =>
  key === 0 ? DATABASE.menuMedian : DATABASE.median;

/** How long a fetch takes once it has a connection: a log-normal draw around the page's median,
 *  plus 0.6 ms for each fetch still waiting in line behind it. */
export const fetchTime = (key: number, waiting: number, random: Random): number =>
  lognormal(random, medianFetch(key), DATABASE.spread) + DATABASE.perWaiting * waiting;

/** XFetch's β: above 1 refreshes earlier, below 1 later. The lab uses 1. */
export const BETA = 1;

/** With jitter on, each set's TTL is multiplied by a uniform draw from this range. */
export const JITTER = [0.8, 1.2] as const;

/** Reads a second, at each load the visitor can choose. */
export const LOADS = { calm: 120, busy: 300, morning: 600 } as const;
export type Load = keyof typeof LOADS;

export type Placement = 'modulo' | 'circle';

/** A page's name inside a sentence: "the menu", or "page 17". */
export const pageName = (key: number): string => (key === 0 ? 'the menu' : `page ${key}`);

/** A sentence's first letter, raised: "The menu", "Page 17". */
export const firstUp = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/** A virtual time, as the event log and the status line say it: "3.012 s". */
export const seconds = (ms: number): string => `${(ms / 1000).toFixed(3)} s`;

/** A duration in whole milliseconds: "1,204 ms". */
export const millis = (ms: number): string => `${Math.round(ms).toLocaleString('en-US')} ms`;

/** MurmurHash3's 32-bit finalizer: inputs one apart land far apart, so pages and points scatter
 *  over the whole circle instead of bunching where their numbers are close. */
export function mix(x: number): number {
  let h = x >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * Mixed into every page's hash. Over any good hash, losing one node of four moves 1/4 of the pages
 * on the circle and 3/4 under modulo on average, but 120 pages scatter about 4 points either side,
 * and the known answer (test/cache.test.ts) holds each of the four possible losses to 20-30% and
 * 70-80%. 5 is the first salt, counting from 0, for which all eight counts land there: the circle
 * moves 28, 32, 33 or 27 pages, modulo 85, 85, 89 or 90. With salt 0 one modulo loss moves 82.
 */
const SALT = 5;

/** Where a page sits on the circle, and the number modulo placement divides. */
export const pageHash = (key: number): number => mix(Math.imul(key + 1, 0x9e3779b1) ^ SALT);

/** Where a node's virtual point sits on the circle. */
const pointHash = (node: number, point: number): number =>
  mix(Math.imul(node * POINTS + point + 1, 0x85ebca77) ^ 0x27d4eb2f);

/**
 * Which node holds each page, given the nodes that are up: a node's id, or -1 when none is up.
 *
 * - `modulo`: the page's hash modulo the number of live nodes picks one of them. Simple, and
 *   losing one node of four moves about three pages in four, because the divisor changes for all.
 * - `circle`: consistent hashing. Each live node puts 64 points on a circle of 2^32 positions, and
 *   a page belongs to the first point at or after its own position. Losing a node moves only the
 *   pages its points held, about one in four; the virtual points keep the four shares even.
 *
 * `moduloOnCircle` is a deliberately broken placement for the tests: the circle silently uses
 * modulo, and the known answer on pages moved by a lost node must catch it.
 */
export function owners(
  placement: Placement,
  up: readonly boolean[],
  moduloOnCircle = false,
): number[] {
  const live: number[] = [];
  for (const [id, isUp] of up.entries()) if (isUp) live.push(id);
  const result = Array.from({ length: PAGES }, () => -1);
  if (live.length === 0) return result;
  if (placement === 'modulo' || moduloOnCircle) {
    for (let key = 0; key < PAGES; key++) result[key] = live[pageHash(key) % live.length] as number;
    return result;
  }
  const points = live.flatMap((node) =>
    Array.from({ length: POINTS }, (_, point) => ({ at: pointHash(node, point), node })),
  );
  points.sort((a, b) => a.at - b.at || a.node - b.node);
  for (let key = 0; key < PAGES; key++) {
    const h = pageHash(key);
    // The first point at or after the page's position, by binary search; past the last point
    // the circle wraps to the first.
    let low = 0;
    let high = points.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if ((points[mid] as { at: number }).at < h) low = mid + 1;
      else high = mid;
    }
    result[key] = (points[low % points.length] as { node: number }).node;
  }
  return result;
}

/** How many pages change node between two sets of live nodes: each one misses once on arrival. */
export function movedPages(
  placement: Placement,
  before: readonly boolean[],
  after: readonly boolean[],
  moduloOnCircle = false,
): number {
  const a = owners(placement, before, moduloOnCircle);
  const b = owners(placement, after, moduloOnCircle);
  let moved = 0;
  for (let key = 0; key < PAGES; key++) if (a[key] !== b[key]) moved++;
  return moved;
}

/**
 * The XFetch rule (Vattani, Chierichetti and Lowenstein, VLDB 2015): a read refreshes the entry
 * now when `now - delta * BETA * ln(u)` reaches its expiry, with `u` uniform in (0, 1] and `delta`
 * the time the last fetch took. -ln(u) is an exponential draw, so the chance is
 * exp(-(expiry - now) / delta): next to nothing a few deltas out, and close to 1 just before
 * expiry. A hot page is read often enough that some reader draws a refresh before it expires, so
 * its readers do not all miss at once; each reader draws alone, so a few may refresh together. A
 * cold page, read rarely, is left to expire, which costs little.
 */
export const refreshEarly = (now: number, expiresAt: number, delta: number, u: number): boolean =>
  now - delta * BETA * Math.log(u) >= expiresAt;

/** An entry's lifetime: the TTL, or with jitter the TTL times a uniform draw `u` mapped onto
 *  JITTER, so entries set together expire over 6.4 to 9.6 s instead of in the same instant. */
export const lifetime = (jitter: boolean, u: number): number =>
  jitter ? TTL * (JITTER[0] + (JITTER[1] - JITTER[0]) * u) : TTL;
