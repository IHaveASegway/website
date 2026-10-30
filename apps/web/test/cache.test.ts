import { describe, expect, test } from 'vitest';
import { conservation, properties } from '../src/lib/cache/check';
import {
  DATABASE,
  fetchTime,
  movedPages,
  owners,
  PAGES,
  refreshEarly,
  STALE_LIMIT,
  TIMEOUT,
  TTL,
} from '../src/lib/cache/core';
import {
  createSim,
  flush,
  loseNode,
  replay,
  restoreNode,
  runUntil,
  setCoalesce,
  setEarly,
  setInvalidate,
  setJitter,
  setLoad,
  setPlacement,
  setStale,
  step,
  write,
  type Config,
  type Faults,
  type Fetch,
  type Read,
  type Sample,
  type Sim,
} from '../src/lib/cache/sim';
import {
  BUCKETS,
  OPENING,
  openingRun,
  outcomeStrip,
  SEEDS_IN_CI,
  series,
  statusText,
  summary,
} from '../src/lib/cache/view';
import { seeded } from '../src/lib/sim/random';

// The Cache Lab's core: known answers for its rules (placement, the XFetch rule, the database's
// fetch time), then reads through the cache one mechanism at a time, then a property sweep. The
// sweep makes many seeded runs with random loads, mitigations, flushes, lost nodes and writes,
// checks conservation after every event, and holds each mitigation to what it promises. Four
// deliberately broken behaviours show the tests can find a real bug: each one must be caught.

const ALL = [true, true, true, true];
const without = (lost: number) => ALL.map((_, id) => id !== lost);
const count = <T>(list: readonly T[], matches: (item: T) => boolean): number => {
  let n = 0;
  for (const item of list) if (matches(item)) n++;
  return n;
};
const fresh = (sim: Sim) => properties(sim)[2];
/** The menu's reads among the last 2 s of reads, that began between two times. */
const menuReads = (sim: Sim, from: number, to: number): Read[] => {
  const out: Read[] = [];
  for (const read of sim.recent)
    if (read.key === 0 && read.at >= from && read.at < to) out.push(read);
  return out;
};
/** A warm run at a busy hour whose menu entry expires at `at`. */
const warm = (config: Partial<Config> = {}, at = 300): Sim =>
  createSim({ seed: 5, load: 'busy', menuExpires: at, ...config });

describe('placement', () => {
  test('every page lives on a node that is up, on either placement, and on none when all are down', () => {
    for (const placement of ['circle', 'modulo'] as const) {
      for (const node of owners(placement, [true, false, true, false]))
        expect([0, 2]).toContain(node);
      expect(owners(placement, [false, false, false, false])).toEqual(
        Array.from({ length: PAGES }, () => -1),
      );
    }
  });

  test.each([0, 1, 2, 3])(
    'losing node %i of 4 moves 24-36 of the 120 pages on the circle, and 84-96 under modulo',
    (lost) => {
      const circle = movedPages('circle', ALL, without(lost)) / PAGES;
      const modulo = movedPages('modulo', ALL, without(lost)) / PAGES;
      expect(circle).toBeGreaterThanOrEqual(0.2);
      expect(circle).toBeLessThanOrEqual(0.3);
      expect(modulo).toBeGreaterThanOrEqual(0.7);
      expect(modulo).toBeLessThanOrEqual(0.8);
    },
  );

  test("on the circle only the lost node's pages move, and they move back when it returns", () => {
    const before = owners('circle', ALL);
    const after = owners('circle', without(2));
    for (let key = 0; key < PAGES; key++)
      if (before[key] !== 2) expect(after[key]).toBe(before[key]);
    expect(after).not.toContain(2);
    expect(owners('circle', ALL)).toEqual(before);
  });

  test('a circle that silently places by modulo fails the known answer, through the simulation too', () => {
    for (const lost of [0, 1, 2, 3]) {
      expect(movedPages('circle', ALL, without(lost), true) / PAGES).toBeGreaterThan(0.3);
      const sim = createSim({ seed: 1, placement: 'circle', faults: { moduloOnCircle: true } });
      loseNode(sim, lost);
      expect((sim.losses[0]?.moved ?? 0) / PAGES).toBeGreaterThan(0.3);
    }
  });
});

describe('the XFetch rule', () => {
  test('a draw that adds nothing refreshes only once the entry has expired', () => {
    expect(refreshEarly(4_999, 5_000, 35, 1)).toBe(false);
    expect(refreshEarly(5_000, 5_000, 35, 1)).toBe(true);
  });

  test('a read refreshes with chance exp(-gap / delta), gap being the time left before expiry', () => {
    const random = seeded(11);
    for (const gap of [35, 70, 140]) {
      let yes = 0;
      for (let i = 0; i < 20_000; i++)
        if (refreshEarly(10_000 - gap, 10_000, 35, 1 - random())) yes++;
      expect(Math.abs(yes / 20_000 - Math.exp(-gap / 35))).toBeLessThan(0.015);
    }
  });
});

describe('the database', () => {
  test('a fetch takes its log-normal draw plus 0.6 ms for each fetch waiting in line behind it', () => {
    const draw = (waiting: number) => fetchTime(5, waiting, seeded(3));
    expect(draw(10) - draw(0)).toBeCloseTo(10 * DATABASE.perWaiting, 9);
    const median = (key: number) => {
      const random = seeded(4);
      const times = Array.from({ length: 4_001 }, () => fetchTime(key, 0, random));
      return times.sort((a, b) => a - b)[2_000] as number;
    };
    expect(Math.abs(median(5) - DATABASE.median)).toBeLessThan(1);
    // The menu, the dear page: twelve ordinary fetches' time.
    expect(Math.abs(median(0) - DATABASE.menuMedian)).toBeLessThan(10);
  });

  test('the pool runs at most 8 fetches, never idles while one waits, and takes the line in order', () => {
    const sim = createSim({ seed: 3, load: 'morning' });
    runUntil(sim, 1_000);
    flush(sim);
    let longest = 0;
    const problems: string[] = [];
    while (sim.now < 1_400) {
      step(sim);
      const waiting = sim.line.length - sim.lineHead;
      longest = Math.max(longest, waiting);
      if (sim.running > DATABASE.pool) problems.push(`${sim.running} running at ${sim.now}`);
      if (waiting > 0 && sim.running < DATABASE.pool)
        problems.push(`a free connection while ${waiting} wait, at ${sim.now}`);
      for (let i = sim.lineHead + 1; i < sim.line.length; i++)
        if ((sim.line[i] as Fetch).asked < (sim.line[i - 1] as Fetch).asked)
          problems.push(`the line is out of order at ${sim.now}`);
    }
    expect(problems).toEqual([]);
    expect(longest).toBeGreaterThan(20);
    expect(sim.violation).toBeNull();
  });
});

describe('a read', () => {
  test('a hit costs 1 ms; a miss waits for the database, which stores the page for 8 s', () => {
    const sim = warm();
    runUntil(sim, 1_500);
    for (const read of sim.recent) if (read.outcome === 'hit') expect(read.latency).toBe(1);
    // The menu's readers after its expiry each waited for a fetch, or gave up in the herd.
    const missed = menuReads(sim, 300, 500);
    expect(count(missed, (read) => read.outcome === 'served')).toBeGreaterThan(5);
    for (const read of missed) {
      expect(['served', 'timeout']).toContain(read.outcome);
      expect(read.latency).toBeGreaterThan(100);
    }
    const entry = sim.nodes[sim.owners[0] as number]?.entries.get(0);
    expect(entry?.version).toBe(1);
    expect((entry?.expiresAt ?? 0) - (entry?.writtenAt ?? 0)).toBeCloseTo(TTL, 6);
  });

  test('without coalescing every reader who misses fetches; with it, the readers on one node share one fetch', () => {
    const herd = warm();
    runUntil(herd, 1_500);
    expect(herd.tally.peak[0]).toBeGreaterThan(5);
    expect(properties(herd)[0].held).toBe(false);
    const one = warm({ coalesce: true });
    runUntil(one, 1_500);
    expect(one.fetchesOf[0]).toBe(1);
    expect(one.tally.peak[0]).toBe(1);
    const waited = menuReads(one, 300, 500);
    expect(waited.length).toBeGreaterThan(5);
    for (const read of waited) expect(read.outcome).toBe('served');
  });

  test('stale-while-revalidate serves an entry past its expiry at once, while one fetch refreshes it', () => {
    const sim = warm({ stale: true });
    runUntil(sim, 1_500);
    expect(sim.fetchesOf[0]).toBe(1);
    const early = menuReads(sim, 300, 450);
    expect(early.length).toBeGreaterThan(3);
    for (const read of early) {
      expect(read.outcome).toBe('stale');
      expect(read.latency).toBe(1);
    }
    expect(fresh(sim).held).toBe(true);
  });

  test('past the 4 s limit an expired entry is a miss; a cache that serves it anyway breaks fresh', () => {
    const late = -STALE_LIMIT - 500;
    const sim = warm({ stale: true }, late);
    runUntil(sim, 300);
    expect(count(menuReads(sim, 0, 300), (read) => read.outcome === 'stale')).toBe(0);
    expect(fresh(sim).held).toBe(true);
    const broken = warm({ stale: true, faults: { staleForever: true } }, late);
    runUntil(broken, 300);
    expect(fresh(broken).held).toBe(false);
    expect(fresh(broken).worst).toBeGreaterThanOrEqual(500);
    expect(fresh(broken).first?.detail).toMatch(/^The menu was served 4,5\d\d ms past its expiry/);
  });

  test('early refresh (XFetch) renews the menu before it expires, so none of its readers misses', () => {
    const sim = warm({ early: true }, 3_000);
    runUntil(sim, 3_500);
    // Every read of the menu was a hit, or a reader the rule picked to refresh it early.
    const menu = menuReads(sim, 1_400, 3_500);
    for (const read of menu)
      expect(read.outcome === 'hit' || read.fetch?.why === 'early').toBe(true);
    expect(count(menu, (read) => read.fetch?.why === 'early')).toBeGreaterThan(0);
    expect(sim.counts.timeout).toBe(0);
    // The rule draws for each reader alone: here the first refresh came late (836 ms before
    // expiry), and while it ran eight more readers won the draw. It thins a herd, and coalescing
    // ends it: with both on, one fetch.
    expect(sim.tally.peak[0]).toBe(9);
    const both = warm({ early: true, coalesce: true }, 3_000);
    runUntil(both, 3_500);
    expect(both.fetchesOf[0]).toBe(1);
  });

  test('a write with invalidation deletes every copy at once, and the next reader gets the new version', () => {
    const sim = createSim({ seed: 5, load: 'busy' });
    runUntil(sim, 1_000);
    write(sim, 0);
    for (const node of sim.nodes) expect(node.entries.has(0)).toBe(false);
    runUntil(sim, 2_500);
    // Every reader who got the page got version 2. Deleting a hot page sends all its readers to
    // the database at once, as an expiry does: the herd that the NSDI paper's leases also tame.
    const after = menuReads(sim, 1_000, 2_500);
    expect(count(after, (read) => read.version === 2)).toBeGreaterThan(50);
    for (const read of after)
      if (read.outcome === 'hit' || read.outcome === 'served') expect(read.version).toBe(2);
    expect(fresh(sim).held).toBe(true);
  });

  test('without invalidation the old version is served until it expires, and fresh counts each read', () => {
    const sim = warm({ invalidate: false }, 4_000);
    runUntil(sim, 1_000);
    write(sim, 0);
    runUntil(sim, 3_000);
    const old = menuReads(sim, 1_000, 3_000);
    expect(old.length).toBeGreaterThan(50);
    for (const read of old) expect(read.version).toBe(1);
    const property = fresh(sim);
    expect(property.held).toBe(false);
    expect(property.count).toBe(old.length);
    const last = old.at(-1)?.at ?? 0;
    expect(property.worst).toBeCloseTo(last - 1_000, 6);
    expect(property.first?.detail).toMatch(
      /^A reader of the menu got version 1, \d+ ms after version 2/,
    );
  });

  test('a reader gives up at 1,000 ms; its fetch runs on for nobody, and still stores the page', () => {
    const sim = openingRun();
    const gaveUp: Read[] = [];
    for (const read of sim.recent) if (read.outcome === 'timeout') gaveUp.push(read);
    expect(gaveUp.length).toBeGreaterThan(0);
    for (const read of gaveUp) {
      expect(read.latency).toBe(TIMEOUT);
      // Its fetch outlives it: still in line, or answered after the reader left.
      const fetch = read.fetch as Fetch;
      expect(fetch.state === 'waiting' || fetch.ends > read.at + TIMEOUT).toBe(true);
    }
    expect(sim.counts.wasted).toBeGreaterThan(0);
    const menu = sim.nodes[sim.owners[0] as number]?.entries.get(0);
    expect(menu?.expiresAt).toBeGreaterThan(OPENING.until);
  });

  test('a lost node takes its entries with it; restored, it comes back empty, in a new life', () => {
    const sim = createSim({ seed: 5, load: 'calm' });
    runUntil(sim, 500);
    const node = sim.owners[0] as number;
    loseNode(sim, node);
    expect(sim.nodes[node]?.entries.size).toBe(0);
    expect(sim.owners).not.toContain(node);
    expect(sim.losses).toEqual([
      {
        at: 500,
        placement: 'circle',
        live: 4,
        moved: count(owners('circle', ALL), (o) => o === node),
      },
    ]);
    runUntil(sim, 1_500);
    restoreNode(sim, node);
    expect(sim.nodes[node]?.entries.size).toBe(0);
    expect(sim.nodes[node]?.life).toBe(1);
    expect(sim.owners).toEqual(owners('circle', ALL));
  });

  test('coalescing is per node: a page that moves while it is fetched is fetched again on its new node', () => {
    const sim = warm({ coalesce: true });
    runUntil(sim, 400);
    expect(sim.flying[0]).toHaveLength(1);
    loseNode(sim, sim.owners[0] as number);
    runUntil(sim, 600);
    expect(sim.tally.overlaps).toBeGreaterThan(0);
    // Not a coalescing bug: no node fetched the page beside its own fetch.
    expect(sim.tally.sameNode).toBe(0);
    expect(properties(sim)[0].held).toBe(false);
  });

  test('a new load starts a new arrival stream at its rate', () => {
    const sim = createSim({ seed: 8, load: 'calm' });
    runUntil(sim, 2_000);
    setLoad(sim, 'morning');
    runUntil(sim, 4_000);
    const at = (t: number) => (series(sim).find((s) => s.at === t) as Sample).readsPerSecond;
    expect(Math.abs(at(2_000) - 120)).toBeLessThan(40);
    expect(Math.abs(at(4_000) - 600)).toBeLessThan(90);
  });
});

describe('jitter', () => {
  /** The pages fetched in the second after a flush: how long each one lives, and how far apart
   *  they expire, from first to last. */
  function refilled(config: Partial<Config>): { lifetimes: number[]; spread: number } {
    const sim = createSim({ seed: 9, load: 'busy', ...config });
    runUntil(sim, 1_000);
    flush(sim);
    runUntil(sim, 2_000);
    const lifetimes: number[] = [];
    const expiries: number[] = [];
    for (const node of sim.nodes)
      for (const entry of node.entries.values())
        if (entry.writtenAt >= 1_000) {
          lifetimes.push(entry.expiresAt - entry.writtenAt);
          expiries.push(entry.expiresAt);
        }
    return { lifetimes, spread: Math.max(...expiries) - Math.min(...expiries) };
  }

  test('the known answer: pages fetched together expire together, unless jitter spreads them', () => {
    const together = refilled({});
    expect(together.lifetimes.length).toBeGreaterThan(15);
    for (const life of together.lifetimes) expect(life).toBeCloseTo(TTL, 6);
    expect(together.spread).toBeLessThan(1_000);
    // Lifetimes of 6.4 to 9.6 s: a score of draws covers most of the 3.2 s between.
    const spread = refilled({ jitter: true });
    for (const life of spread.lifetimes) {
      expect(life).toBeGreaterThanOrEqual(0.8 * TTL);
      expect(life).toBeLessThanOrEqual(1.2 * TTL);
    }
    expect(spread.spread).toBeGreaterThan(2_500);
  });

  test('a jitter toggle that is silently ignored fails the known answer', () => {
    const ignored = refilled({ jitter: true, faults: { noJitter: true } });
    expect(ignored.spread).toBeLessThan(1_000);
    for (const life of ignored.lifetimes) expect(life).toBeCloseTo(TTL, 6);
  });
});

describe('conservation', () => {
  const running = () => {
    const sim = createSim({ seed: 1, load: 'busy' });
    runUntil(sim, 2_000);
    return sim;
  };

  test('holds in a run, and catches a read from nowhere, a vanished fetch and a forgotten reader', () => {
    expect(conservation(running(), true)).toBeNull();
    const extra = running();
    extra.counts.reads += 1;
    expect(conservation(extra)?.detail).toMatch(/some appeared or vanished/);
    const vanished = running();
    vanished.counts.fetches += 1;
    expect(conservation(vanished)?.detail).toMatch(/some vanished/);
    const forgotten = running();
    forgotten.waitingHead = forgotten.waiting.length;
    forgotten.waiting.push({
      n: 0,
      key: 3,
      at: 500,
      outcome: 'pending',
      ended: NaN,
      latency: NaN,
      version: 0,
      fetch: null,
    });
    forgotten.counts.reads += 1;
    forgotten.counts.pending += 1;
    expect(conservation(forgotten)?.detail).toMatch(/has waited 1,500 ms, past the 1,000 ms/);
  });
});

test('determinism: the same seed and actions give the same run, event for event', () => {
  const run = () => {
    const sim = createSim({ seed: 42, load: 'busy' });
    runUntil(sim, 1_200);
    setCoalesce(sim, true);
    runUntil(sim, 2_000);
    flush(sim);
    runUntil(sim, 2_600);
    loseNode(sim, 1);
    runUntil(sim, 3_100);
    write(sim, 0);
    setLoad(sim, 'morning');
    runUntil(sim, 3_900);
    restoreNode(sim, 1);
    setPlacement(sim, 'modulo');
    setStale(sim, true);
    setEarly(sim, true);
    setJitter(sim, true);
    setInvalidate(sim, false);
    write(sim, 4);
    runUntil(sim, 5_000);
    return sim;
  };
  const a = run();
  const b = run();
  const again = replay({ seed: 42, load: 'busy' }, a.actions, 5_000);
  const shape = (s: Sim) =>
    JSON.stringify([
      s.events,
      s.counts,
      s.lines,
      s.samples,
      s.tally,
      s.nodes.map((node) => [...node.entries]),
    ]);
  expect(a.actions).toHaveLength(12);
  expect(shape(b)).toBe(shape(a));
  expect(shape(again)).toBe(shape(a));
});

describe('the opening the page draws', () => {
  test('the menu expires at 3 s, its readers all miss, the pool fills and readers give up', () => {
    const sim = openingRun();
    expect(sim.violation).toBeNull();
    expect(sim.tally.herd).toMatchObject({ key: 0, expired: 3_000 });
    expect(sim.tally.peak[0]).toBeGreaterThanOrEqual(20);
    expect(sim.counts.timeout).toBeGreaterThan(0);
    expect(Math.max(...series(sim).map((s) => s.inUse))).toBe(DATABASE.pool);
    expect(summary(sim)).toContain('When the menu expired at 3.0 s');
    // Replayed, it is the same run: the browser takes over where the picture stands.
    expect(JSON.stringify(openingRun().lines)).toBe(JSON.stringify(sim.lines));
  });

  test('the same seed with coalescing and stale-while-revalidate: one fetch of the menu, no timeouts', () => {
    const sim = replay(
      { ...OPENING.config, coalesce: true, stale: true },
      OPENING.actions,
      OPENING.until,
    );
    expect(sim.fetchesOf[0]).toBe(1);
    expect(sim.counts.timeout).toBe(0);
    expect(statusText(sim)).toBe(
      `All three properties held over ${sim.counts.reads.toLocaleString('en-US')} reads.`,
    );
  });
});

describe('the view', () => {
  test('the summary and the status line say the story in numbers', () => {
    const sim = openingRun();
    expect(summary(sim)).toMatch(
      /^1,\d{3} reads in 5\.0 s, \d+\.\d% from the cache\. When the menu expired at 3\.0 s, the database fetched it \d+ times at once and \d+ reads timed out\.$/,
    );
    expect(statusText(sim)).toMatch(
      /^One fetch of a page at a time broke \d+ times and no timeouts broke (twice|\d+ times); fresh reads held\.$/,
    );
  });

  test('the history strip: a point every 100 ms, and the last 2 s of reads in 50 ms buckets', () => {
    const sim = openingRun();
    const points = series(sim);
    expect(points.map((p) => p.at)).toEqual(Array.from({ length: 50 }, (_, i) => (i + 1) * 100));
    const at = (t: number) => points.find((p) => p.at === t) as Sample;
    expect(at(2_900).hitRatio).toBeGreaterThan(0.95);
    expect(at(2_900).p50).toBe(1);
    expect(at(3_400).inUse).toBe(DATABASE.pool);
    expect(at(5_000).timeouts).toBe(sim.counts.timeout);
    const strip = outcomeStrip(sim);
    expect(strip).toHaveLength(BUCKETS);
    expect(strip[0]?.from).toBe(5_000 - (BUCKETS - 1) * 50);
    let total = 0;
    for (const bucket of strip)
      total += bucket.hit + bucket.stale + bucket.served + bucket.timeout + bucket.pending;
    expect(total).toBe(count(sim.recent, (read) => read.at >= (strip[0]?.from ?? 0)));
  });

  test("every line is a plain sentence in the site's voice", () => {
    // The words docs/content.md bans, because each claims a quality instead of showing it.
    const banned =
      /seamless|robust|blazing|leverage|cutting-edge|world-class|best-in-class|game-changing|revolutionary|next-generation|synergy|passionate|rockstar|ninja/i;
    const runs = [openingRun(), randomRun(3).sim, randomRun(4).sim];
    for (const sim of runs)
      for (const { text } of sim.lines) {
        expect(text).not.toMatch(banned);
        expect(text).not.toContain('!');
        expect(text).toMatch(/^[A-Z0-9]/);
      }
  });
});

const LOADS = ['calm', 'busy', 'morning'] as const;

/** A seeded run with faults: a random load, placement and set of toggles, then an action every
 *  0.25-1.75 s for 15 s: a flush, a lost or restored node, or a write, half of them to the menu. */
function randomRun(seed: number, faults: Faults = {}, force: Partial<Config> = {}) {
  const pick = seeded(seed * 7919 + 17);
  const coin = () => pick() < 0.5;
  const config: Config = {
    seed,
    load: LOADS[Math.floor(pick() * LOADS.length)] ?? 'busy',
    placement: coin() ? 'circle' : 'modulo',
    coalesce: coin(),
    stale: coin(),
    early: coin(),
    jitter: coin(),
    invalidate: coin(),
    faults,
    ...force,
  };
  const sim = createSim(config);
  for (
    let t = 250 + Math.floor(pick() * 1_500);
    t < 15_000;
    t += 250 + Math.floor(pick() * 1_500)
  ) {
    runUntil(sim, t);
    if (sim.violation) break;
    const roll = pick();
    const node = Math.floor(pick() * 4);
    if (roll < 0.15) flush(sim);
    else if (roll < 0.4) loseNode(sim, node);
    else if (roll < 0.6) restoreNode(sim, node);
    else write(sim, pick() < 0.5 ? 0 : Math.floor(pick() * PAGES));
  }
  runUntil(sim, 15_000);
  return { sim, config };
}

/** How many seeds the sweep runs: about 2.3 s of the suite on a laptop, 4 ms a seed. */
const SEEDS = SEEDS_IN_CI;

// The limit only catches a hang: the work is the same on every machine, but a CI runner beside
// the other test files is slower than a laptop, as the Raft Lab's sweep found (raft.test.ts).
describe('the property sweep', { timeout: 30_000 }, () => {
  test(`${SEEDS} random runs: conservation holds after every event, and each mitigation keeps its promise`, () => {
    const broken: string[] = [];
    let events = 0;
    const seen = { herds: 0, timeouts: 0, stale: 0, moved: 0, losses: 0 };
    for (let seed = 1; seed <= SEEDS; seed++) {
      const { sim, config } = randomRun(seed);
      events += sim.events;
      if (sim.violation) broken.push(`seed ${seed}: conservation: ${sim.violation.detail}`);
      // Coalescing: a node never fetches a page while its own coalesced fetch of it is in flight.
      if (config.coalesce && sim.tally.sameNode > 0)
        broken.push(`seed ${seed}: one node fetched a page twice with coalescing on`);
      // Invalidation: no reader gets a replaced version or an entry past the stale limit.
      if (config.invalidate && sim.tally.staleReads > 0)
        broken.push(
          `seed ${seed}: fresh broke with invalidation on: ${sim.tally.firstStale?.detail}`,
        );
      for (const loss of sim.losses) {
        if (loss.live !== 4) continue;
        seen.losses++;
        const share = loss.moved / PAGES;
        const [low, high] = loss.placement === 'circle' ? [0.2, 0.3] : [0.7, 0.8];
        if (share < low || share > high)
          broken.push(
            `seed ${seed}: losing a node of 4 moved ${loss.moved} pages (${loss.placement})`,
          );
      }
      if (!config.coalesce && sim.tally.overlaps > 0) seen.herds++;
      if (config.coalesce && sim.tally.overlaps > 0) seen.moved++;
      if (!config.coalesce && !config.stale && !config.early && config.load !== 'calm')
        if (sim.counts.timeout > 0) seen.timeouts++;
      if (!config.invalidate && sim.tally.staleReads > 0) seen.stale++;
    }
    expect(broken).toEqual([]);
    // The sweep did real work, and each property broke where the lesson says it does: herds
    // without coalescing, timeouts at a busy hour or the morning rush without mitigations, old
    // versions without invalidation, and fetches again for pages that moved mid-fetch.
    expect(events).toBeGreaterThan(SEEDS * 3_000);
    expect(seen.losses).toBeGreaterThan(SEEDS / 2);
    expect(seen.herds).toBeGreaterThan(0);
    expect(seen.timeouts).toBeGreaterThan(0);
    expect(seen.stale).toBeGreaterThan(0);
    expect(seen.moved).toBeGreaterThan(0);
  });

  test.each([
    [
      'leaks a coalesced reader that times out',
      { leakFlight: true },
      { coalesce: true },
      (sim: Sim) => /has waited/.test(sim.violation?.detail ?? ''),
    ],
    [
      'serves an entry past the 4 s stale limit',
      { staleForever: true },
      { stale: true, invalidate: true },
      (sim: Sim) => !fresh(sim).held,
    ],
    [
      'places pages by modulo on the circle',
      { moduloOnCircle: true },
      { placement: 'circle' },
      (sim: Sim) => sim.losses.some((loss) => loss.live === 4 && loss.moved / PAGES > 0.3),
    ],
  ] as const)('a cache that %s is caught within the sweep', (_name, faults, force, caught) => {
    let found: string | null = null;
    for (let seed = 1; seed <= SEEDS && !found; seed++) {
      const { sim } = randomRun(seed, faults, force);
      if (caught(sim)) found = `seed ${seed}`;
    }
    expect(found).not.toBeNull();
  });
});
