import { describe, expect, test } from 'vitest';
import { conservation } from '../src/lib/cache/check';
import {
  backoff,
  LOADS,
  RETRIES,
  RETRY,
  TIMEOUT,
  type Load,
  type Retry,
} from '../src/lib/cache/core';
import {
  createSim,
  flush,
  replay,
  runUntil,
  setLoad,
  setRetry,
  setToggle,
  type Action,
  type Config,
  type Read,
  type Sim,
} from '../src/lib/cache/sim';
import { linkTo, openLink, OPENING, readersWords, summary, waiting } from '../src/lib/cache/view';
import { seeded } from '../src/lib/sim/random';

// The Cache Lab's retry storm: a metastable failure (Bronson, Aghayev, Charapko and Zhu,
// "Metastable Failures in Distributed Systems", HotOS 2021; Huang et al., "Metastable Failures in
// the Wild", OSDI 2022). A short trigger overloads the database; once it has passed, the load is
// calm again, but readers who time out ask again at once, and the pool keeps every fetch they
// asked for in line though nobody waits for it any more. Retries add work, and work nobody wants
// still runs, each fetch in line slowing the next by 0.6 ms (core.ts, DATABASE): the line outlasts
// its cause. The fixes are Brooker's backoff with full jitter ("Timeouts, retries, and backoff
// with jitter", Amazon Builders' Library, 2019), dropping the work nobody waits for, and both.
//
// The defaults, giving up and dropping, are the lab as it was: test/cache.test.ts and
// test/cache-lab.test.ts pin its numbers and run unchanged.

/** The trigger: from the opening's run (seed and all, a busy hour, the menu expiring at 3 s), the
 *  morning rush and a flush at 5.0 s, and calm again half a second later. */
const TRIGGER: readonly Action[] = [
  { at: 5_000, kind: 'load', load: 'morning' },
  { at: 5_000, kind: 'flush' },
  { at: 5_500, kind: 'load', load: 'calm' },
];
const CALM = 5_500;
/** Where the storm is judged: from 10 s after calm returns to 30 s after. */
const FROM = 15_500;
const END = 35_500;
/** A line this long at calm load is the storm. With dropping on, after the trigger, no seed's line
 *  came back past 39 once it had emptied; in a storm it is in the thousands. */
const STORM = 100;
/** When the visitor applies a fix to a storm already under way. */
const FIX = 20_000;

/**
 * How many seeds: from the data. A pilot of 60 seeds found the storm in 57, a share near 0.95; for
 * a 95% interval of about ±3 points on such a share, n = 1.96² × 0.95 × 0.05 / 0.03² ≈ 203. So 200,
 * which takes about 2 s for the storm's own runs, the longest, on a laptop.
 */
const SEEDS = 200;

interface Run {
  /** The line every 100 ms, from CALM + 100 ms to END. */
  readonly line: number[];
  readonly sim: Sim;
}

/** A seed's run under some settings: the trigger, or only the return to calm, then 30 s of calm,
 *  with `fix` applied at FIX. */
function run(
  seed: number,
  settings: Partial<Config>,
  trigger = true,
  fix?: { retry?: Retry; drop?: boolean },
): Run {
  const actions = trigger ? TRIGGER : TRIGGER.slice(2);
  const sim = replay({ ...OPENING.config, seed, ...settings }, actions, CALM);
  const line: number[] = [];
  for (let t = CALM + 100; t <= END; t += 100) {
    if (fix && t === FIX + 100) {
      if (fix.retry) setRetry(sim, fix.retry);
      if (fix.drop) setToggle(sim, 'drop', true);
    }
    runUntil(sim, t);
    line.push(waiting(sim));
  }
  return { line, sim };
}

const at = (line: readonly number[], t: number) => line[(t - CALM) / 100 - 1] as number;

/** The storm: the line at STORM or more at every point from FROM to the end. */
const storms = (line: readonly number[]): boolean =>
  line.slice((FROM - CALM) / 100 - 1).every((n) => n >= STORM);

/** How long after `since` the line emptied for good: the first point it is empty from which it
 *  never again reaches STORM. Null when it never did. */
function recovery(line: readonly number[], since: number): number | null {
  for (let i = (since - CALM) / 100; i < line.length; i++)
    if (line[i] === 0 && line.slice(i).every((n) => n < STORM)) return CALM + (i + 1) * 100 - since;
  return null;
}

/** The nearest-rank quantile of sorted numbers. */
const rank = (sorted: readonly number[], q: number) =>
  sorted[Math.max(0, Math.ceil(q * sorted.length) - 1)] as number;

interface Sweep {
  readonly storms: number;
  readonly recovered: number[];
}

const swept = new Map<string, Sweep>();

/** Every seed's run under some settings, once: a sweep two tests read is run once. */
function sweep(settings: Partial<Config>, trigger = true): Sweep {
  const key = JSON.stringify([settings, trigger]);
  const known = swept.get(key);
  if (known) return known;
  let count = 0;
  const recovered: number[] = [];
  for (let seed = 1; seed <= SEEDS; seed++) {
    const { line } = run(seed, settings, trigger);
    if (storms(line)) count++;
    const r = recovery(line, CALM);
    if (r !== null) recovered.push(r);
  }
  const result = { storms: count, recovered: recovered.sort((a, b) => a - b) };
  swept.set(key, result);
  return result;
}

const STORMY: Partial<Config> = { retry: 'at-once', drop: false };
const LOAD_NAMES = Object.keys(LOADS) as Load[];

describe('the two settings', () => {
  test('the defaults are the lab as it was: give up, and drop a fetch nobody waits for', () => {
    const sim = createSim({ seed: 1 });
    expect([sim.retry, sim.drop]).toEqual(['give-up', true]);
    const opening = replay(OPENING.config, [], OPENING.until);
    expect(opening.counts.retries).toBe(0);
    expect(linkTo(opening)).toBe('#seed-7');
  });

  test('a link names them after every other setting, and leaves out the defaults', () => {
    const sim = replay({ ...OPENING.config, load: 'calm', ...STORMY }, [], 1_000);
    expect(linkTo(sim)).toBe('#seed-7&load=calm&retry=at-once&drop=off');
    const again = openLink(linkTo(sim), 1_000) as Sim;
    expect([again.retry, again.drop, again.load]).toEqual(['at-once', false, 'calm']);
    expect(linkTo(openLink('#seed-7&retry=backoff') as Sim)).toBe('#seed-7&retry=backoff');
    // A value the setting cannot take is left out, and the setting keeps the opening's.
    const odd = openLink('#seed-7&retry=forever&drop=maybe') as Sim;
    expect([odd.retry, odd.drop]).toEqual(['give-up', true]);
  });

  test('a reader asks at most three times; at once means at its timeout, backoff within 2 s, then 4 s', () => {
    expect([1, 2].map((n) => backoff(n, 0.999_999))).toEqual([
      expect.closeTo(2_000, 0),
      expect.closeTo(4_000, 0),
    ]);
    for (const retry of ['at-once', 'backoff'] as const) {
      const { sim } = run(7, { retry, drop: false });
      expect(sim.violation).toBeNull();
      expect(sim.counts.retries).toBeGreaterThan(0);
      const tries = new Map<number, number>();
      for (const read of sim.recent) {
        if (!read.attempt) continue;
        expect(read.attempt).toBeLessThan(RETRY.attempts);
        tries.set(read.attempt, (tries.get(read.attempt) ?? 0) + 1);
      }
      // Seed 7 recovers with backoff, so its last 2 s hold no retry; at once, both kinds.
      if (retry === 'at-once') expect([...tries.keys()].sort()).toEqual([1, 2]);
    }
    // At once: every retry begins at the very moment an earlier read of its page timed out.
    const { sim } = run(7, STORMY);
    const gaveUp = new Set<string>();
    for (const read of sim.recent)
      if (read.outcome === 'timeout') gaveUp.add(`${read.key} ${read.at + TIMEOUT}`);
    let checked = 0;
    const first = (sim.recent[0] as Read).at;
    for (const read of sim.recent)
      if (read.attempt && read.at - TIMEOUT >= first) {
        expect(gaveUp.has(`${read.key} ${read.at}`)).toBe(true);
        checked++;
      }
    expect(checked).toBeGreaterThan(100);
  });

  test('chosen mid-run, each is an action a replay takes, and turning dropping on empties the line of fetches nobody waits for', () => {
    const live = replay({ ...OPENING.config, ...STORMY }, TRIGGER, FIX);
    const before = waiting(live);
    expect(before).toBeGreaterThan(1_000);
    setRetry(live, 'backoff');
    setToggle(live, 'drop', true);
    const after = waiting(live);
    // What stays has a reader still waiting on it, or is a stale refresh: the walk of the line
    // that conservation makes while dropping is on finds nothing else.
    expect(after).toBe(169);
    expect(conservation(live, true)).toBeNull();
    expect(live.lines.at(-1)?.text).toBe(
      `${(before - after).toLocaleString('en-US')} fetches leave the line: nobody waits for them any more`,
    );
    runUntil(live, 25_000);
    const again = replay({ ...OPENING.config, ...STORMY }, live.actions, 25_000);
    expect(JSON.stringify([again.counts, again.lines, again.samples])).toBe(
      JSON.stringify([live.counts, live.lines, live.samples]),
    );
    expect(live.violation).toBeNull();
    expect(again.violation).toBeNull();
  });

  test('the page says the storm: retries beside the readers, retries in the caption, the line in thousands in the log', () => {
    const { sim } = run(7, STORMY);
    expect(readersWords(sim)).toMatch(/^Readers, 120 a second, and \d+ retries a second$/);
    expect(summary(sim)).toMatch(/^[\d,]+ reads in 35\.5 s, [\d,]+ of them retries, [\d.]+% from/);
    expect(
      sim.lines.some((line) =>
        /^[\d,]+ fetches wait in line for the database, and nobody waits for [\d,]+ of them any more$/.test(
          line.text,
        ),
      ),
    ).toBe(true);
  });

  test('with retries on, the log counts a reader who timed out and asked again apart from one who gave up', () => {
    // At a whole second, when the log says its count.
    const sim = replay({ ...OPENING.config, seed: 7, ...STORMY }, TRIGGER, 30_000);
    const c = sim.counts;
    // Every timeout is one or the other, and only the third try's gives up while the policy holds.
    expect(c.again + c.gaveUp).toBe(c.timeout);
    expect(c.again).toBeGreaterThan(c.gaveUp);
    // The first timeout, said in the log and by the property's lamp, is a reader about to ask again.
    expect(sim.tally.firstTimeout?.detail).toBe(
      'A reader of the menu timed out after waiting 1,000 ms',
    );
    const texts = sim.lines.map((line) => line.text);
    const last = texts.findLast((text) => / in all$/.test(text));
    expect(last).toMatch(
      /^[\d,]+ readers timed out and asked again in the last second, and [\d,]+ gave up, [\d,]+ in all$/,
    );
    expect(last?.endsWith(`, ${c.gaveUp.toLocaleString('en-US')} in all`)).toBe(true);
    // Giving up, every timeout is a reader gone, and the log says it as it did before retries.
    const opening = replay(OPENING.config, [], 10_000);
    expect(opening.counts.gaveUp).toBe(opening.counts.timeout);
    expect(opening.counts.again).toBe(0);
    expect(opening.lines.some((line) => /asked again/.test(line.text))).toBe(false);
  });

  test('a reader whose retry comes after the visitor chose to give up gives up then, and is counted', () => {
    const sim = replay(
      { ...OPENING.config, seed: 7, retry: 'backoff', drop: false },
      TRIGGER,
      12_000,
    );
    expect(sim.counts.again).toBeGreaterThan(sim.counts.retries);
    setRetry(sim, 'give-up');
    // Readers backing off when the visitor chose: each gives up when its retry was due, within 4 s.
    const waited = sim.counts.again - sim.counts.retries;
    const retries = sim.counts.retries;
    runUntil(sim, 17_000);
    const c = sim.counts;
    expect(c.retries).toBe(retries);
    expect(c.again + c.gaveUp).toBe(c.timeout + waited);
    expect(sim.violation).toBeNull();
  });

  test('conservation holds over 200 runs that flip both settings, the load and the cache at random', () => {
    const broken: string[] = [];
    for (let seed = 1; seed <= 200; seed++) {
      const pick = seeded(seed * 104_729 + 3);
      const sim = createSim({ seed, load: 'busy', retry: 'at-once', drop: pick() < 0.5 });
      for (let t = 500; t < 12_000; t += 500) {
        runUntil(sim, t);
        const roll = pick();
        if (roll < 0.2) setRetry(sim, RETRIES[Math.floor(pick() * 3)] as Retry);
        else if (roll < 0.4) setToggle(sim, 'drop', pick() < 0.5);
        else if (roll < 0.55) setLoad(sim, LOAD_NAMES[Math.floor(pick() * 3)] as Load);
        else if (roll < 0.62) flush(sim);
      }
      runUntil(sim, 12_000);
      if (sim.violation) broken.push(`seed ${seed}: ${sim.violation.detail}`);
    }
    expect(broken).toEqual([]);
  });
});

// The limit only catches a hang: the storm's runs keep lines of thousands, about 10 ms each.
describe('the storm, swept over 200 seeds', { timeout: 120_000 }, () => {
  test('with retries at once and nothing dropped, the line outlasts the trigger in 190 of 200 seeds', () => {
    const storm = sweep(STORMY);
    // 95.0%; a 95% interval (Wilson) of 91.0 to 97.3%.
    expect(storm.storms).toBe(190);
    // The runs that stormed did not drain slowly: at the end their line is still long.
    const { line } = run(7, STORMY);
    expect(storms(line)).toBe(true);
    expect(at(line, 20_000)).toBe(1_250);
    expect(at(line, 30_500)).toBeGreaterThan(4_000);
  });

  test('the trigger is the cause: without it, the same settings storm in 1 seed of 200', () => {
    expect(sweep(STORMY, false).storms).toBe(1);
  });

  test('retries feed it: with the trigger and nothing dropped, readers who give up storm in 9 seeds', () => {
    const kept = sweep({ drop: false });
    expect(kept.storms).toBe(9);
    expect(kept.recovered).toHaveLength(191);
  });

  test('known answer: the sweep can fail. The lab as it was never storms, and recovers in 1.4 s at the median', () => {
    const today = sweep({});
    expect(today.storms).toBe(0);
    expect(today.recovered).toHaveLength(SEEDS);
    expect(rank(today.recovered, 0.5)).toBe(1_400);
    // And recovery can fail: the storm's own runs recover in only 10 seeds.
    expect(sweep(STORMY).recovered).toHaveLength(10);
  });

  test('fixed from the start: dropping recovers every seed, backoff alone only 50, both the fastest', () => {
    const drop = sweep({ retry: 'at-once' });
    expect(drop.storms).toBe(0);
    expect(drop.recovered).toHaveLength(SEEDS);
    expect([0.5, 0.9, 1].map((q) => rank(drop.recovered, q))).toEqual([2_600, 3_200, 4_000]);

    const both = sweep({ retry: 'backoff' });
    expect(both.storms).toBe(0);
    expect(both.recovered).toHaveLength(SEEDS);
    expect([0.5, 0.9, 1].map((q) => rank(both.recovered, q))).toEqual([1_700, 2_100, 3_000]);

    // Backoff spreads the retries out and lets some find the page cached again, but it sends as
    // many: in an open system it delays the work rather than shedding it (Brooker, "Fixing retries
    // with token buckets and circuit breakers", 2022). With every fetch kept, 150 seeds still storm.
    const backedOff = sweep({ retry: 'backoff', drop: false });
    expect(backedOff.storms).toBe(150);
    expect(backedOff.recovered).toHaveLength(50);
  });

  test('fixed during the storm, at 20 s: dropping ends it in every seed within 3.8 s, backoff alone in none', () => {
    const cured = { backoff: [] as number[], drop: [] as number[], both: [] as number[] };
    let storming = 0;
    let never = 0;
    for (let seed = 1; seed <= SEEDS; seed++) {
      if (!storms(run(seed, STORMY).line)) continue;
      storming++;
      for (const [name, fix] of [
        ['backoff', { retry: 'backoff' }],
        ['drop', { drop: true }],
        ['both', { retry: 'backoff', drop: true }],
      ] as const) {
        const r = recovery(run(seed, STORMY, true, fix).line, FIX);
        if (r === null) never += name === 'backoff' ? 1 : 0;
        else cured[name].push(r);
      }
    }
    expect(storming).toBe(190);
    expect(cured.backoff).toEqual([]);
    expect(never).toBe(190);
    for (const list of [cured.drop, cured.both]) list.sort((a, b) => a - b);
    expect(cured.drop).toHaveLength(190);
    expect([0.5, 0.9, 1].map((q) => rank(cured.drop, q))).toEqual([2_600, 3_300, 3_800]);
    expect(cured.both).toHaveLength(190);
    expect([0.5, 0.9, 1].map((q) => rank(cured.both, q))).toEqual([2_200, 2_700, 3_200]);
  });
});
