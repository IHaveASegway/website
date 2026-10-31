// One seeded random stream per simulated run, shared by the labs that simulate a system in
// virtual time (the queue, the cache and the backfill). The Raft Lab keeps its own copy of the
// same generator (lib/raft/sim.ts), so its pinned runs never move. Every draw comes from the stream
// a run was given: the same seed gives the same run in a test, at build and in the browser.

export type Random = () => number;

/** mulberry32: a small, fast seeded generator, plenty for arrivals, service times and faults. */
export function seeded(seed: number): Random {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The gap before the next arrival of a Poisson process with `perSecond` arrivals, in ms. */
export function exponential(random: Random, perSecond: number): number {
  return (-Math.log(1 - random()) / perSecond) * 1000;
}

/** A standard normal draw (Box-Muller), from two uniform draws. */
export function normal(random: Random): number {
  const u = 1 - random();
  const v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** A log-normal duration: half the draws fall under `median`; `spread` is the sigma of its log.
 *  Service times look like this: most are near the median, and a few are several times longer. */
export function lognormal(random: Random, median: number, spread: number): number {
  return median * Math.exp(spread * normal(random));
}

/** A whole number from `low` to `high`, both included. */
export function between(random: Random, low: number, high: number): number {
  return low + Math.floor(random() * (high - low + 1));
}

/**
 * Draws ranks 0..n-1 with Zipf's law, the shape of what people ask a cache for: rank 0 is asked
 * for most, rank 1 about 1/2^s as often, and so on. The weights are summed once, and each draw is
 * a binary search over them.
 */
export function zipf(n: number, s: number): (random: Random) => number {
  const cumulative: number[] = [];
  let total = 0;
  for (let rank = 1; rank <= n; rank++) {
    total += 1 / rank ** s;
    cumulative.push(total);
  }
  return (random) => {
    const target = random() * total;
    let low = 0;
    let high = n - 1;
    while (low < high) {
      const mid = (low + high) >> 1;
      if ((cumulative[mid] as number) < target) low = mid + 1;
      else high = mid;
    }
    return low;
  };
}
