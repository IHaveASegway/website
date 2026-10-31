import { describe, expect, test } from 'vitest';
import {
  fanPath,
  LANES,
  linkPath,
  pageLamps,
  STRIP,
  stripEnds,
  stripPaths,
} from '../src/components/cache-lab/picture';
import { NODES, PAGES } from '../src/lib/cache/core';
import { flush, loseNode, replay, setToggle, write } from '../src/lib/cache/sim';
import {
  clockWords,
  menuWords,
  nodeWords,
  OPENING,
  openingRun,
  outcomeStrip,
  pagesOn,
  pageState,
  PROPERTY_NAMES,
  propertyLines,
  readersWords,
  stripWords,
  waiting,
  type Bucket,
} from '../src/lib/cache/view';

// What the Cache Lab's page draws (components/cache-lab, lib/cache/view.ts): the words beside the
// lamps and the shapes, with known answers from the opening run the build draws, so the picture
// says what the run did. The simulation's own tests are test/cache.test.ts.

const at = (until: number) => replay(OPENING.config, OPENING.actions, until);

describe('the properties beside their lamps', () => {
  test('the opening: the herd and the two timeouts broke two of them, in numbers; fresh held', () => {
    expect(propertyLines(openingRun())).toEqual([
      {
        id: 'one-fetch',
        name: 'One fetch of a page at a time',
        held: false,
        words: 'Broken 40 times, at worst 23 fetches of one page at once',
      },
      {
        id: 'no-timeouts',
        name: 'No reader timed out',
        held: false,
        words: 'Broken: 2 reads timed out',
      },
      { id: 'fresh', name: 'No reader got a page past its limit', held: true, words: 'Held' },
    ]);
  });

  test('the same seed with coalescing and stale-while-revalidate: all three hold', () => {
    const sim = replay({ ...OPENING.config, coalesce: true, stale: true }, [], OPENING.until);
    expect(propertyLines(sim).map((p) => p.words)).toEqual(['Held', 'Held', 'Held']);
    expect(Object.values(PROPERTY_NAMES)).toEqual(propertyLines(sim).map((p) => p.name));
  });

  test('a write with invalidation off: fresh counts the reads of the old version, and the worst', () => {
    const sim = openingRun();
    setToggle(sim, 'invalidate', false);
    write(sim, 0);
    expect(menuWords(sim)).toBe('Menu, fresh until 12.5 s, still version 1');
    const later = replay(
      OPENING.config,
      [
        { at: 5_000, kind: 'toggle', toggle: 'invalidate', on: false },
        { at: 5_000, kind: 'write', key: 0 },
      ],
      9_000,
    );
    const fresh = propertyLines(later)[2];
    expect(fresh?.held).toBe(false);
    expect(fresh?.words).toMatch(/^Broken: [\d,]+ reads, the worst [\d,]+ ms out of date$/);
  });
});

describe('the nodes and their pages', () => {
  test('every page has one lamp, on the node that holds it; a lost node holds none', () => {
    const sim = openingRun();
    const held = Array.from({ length: NODES }, (_, node) => pagesOn(sim, node));
    expect(held.flat().sort((a, b) => a - b)).toEqual(Array.from({ length: PAGES }, (_, k) => k));
    expect(held.map((keys) => keys.length)).toEqual([28, 32, 33, 27]);
    expect(nodeWords(sim, 0)).toBe('28 pages');
    loseNode(sim, 0);
    expect(pagesOn(sim, 0)).toEqual([]);
    expect(nodeWords(sim, 0)).toBe('Down');
    expect([1, 2, 3].map((node) => pagesOn(sim, node).length)).toEqual([40, 46, 34]);
  });

  test('a lamp is fresh, expired, missing or being fetched: the menu through its stampede', () => {
    // Expired at 3.000 s, and no reader has missed yet.
    expect(pageState(at(3_010), 0)).toBe('stale');
    expect(menuWords(at(3_010))).toBe('Menu, expired at 3.0 s');
    // The herd: every reader who misses fetches it, and the line forms behind the pool.
    const herd = at(3_300);
    expect(pageState(herd, 0)).toBe('fetching');
    expect(menuWords(herd)).toBe('Menu, 19 fetches at once');
    expect(waiting(herd)).toBe(13);
    // Its herd still in flight after the first fetch stored it again: still being fetched.
    expect(menuWords(at(3_500))).toBe('Menu, 19 fetches at once');
    // By the opening's moment, every fetch of it has come back.
    const opening = openingRun();
    expect(pageState(opening, 0)).toBe('fresh');
    expect(menuWords(opening)).toBe('Menu, fresh until 12.5 s');
    const states = new Set(Array.from({ length: PAGES }, (_, k) => pageState(opening, k)));
    expect([...states].sort()).toEqual(['fetching', 'fresh', 'stale']);
    // A flush empties every node: every lamp is missing, but for the one page a fetch still
    // runs for, which stays lit until it comes back.
    flush(opening);
    const after = Array.from({ length: PAGES }, (_, k) => pageState(opening, k));
    expect(after.filter((state) => state === 'missing')).toHaveLength(PAGES - 1);
    expect(after.filter((state) => state === 'fetching')).toHaveLength(opening.running);
    expect(menuWords(opening)).toBe('Menu, missing');
  });

  test('the markup: a lamp a page, in page order, and the menu first, with its words, where it lives', () => {
    const sim = openingRun();
    for (let node = 0; node < NODES; node++) {
      const markup = pageLamps(sim, node);
      expect(markup.match(/class="cl-lamp[ "]/g)).toHaveLength(pagesOn(sim, node).length);
      expect(markup.includes('data-cl-menu')).toBe(node === sim.owners[0]);
    }
    expect(pageLamps(sim, sim.owners[0] ?? -1)).toMatch(
      /^<span class="cl-menu"><span class="cl-lamp cl-menu-lamp" data-state="fresh"><\/span><span class="cl-menu-words" data-cl-menu>Menu, fresh until 12\.5 s<\/span><\/span>/,
    );
    loseNode(sim, 0);
    expect(pageLamps(sim, 0)).toBe('');
  });
});

describe('the strip', () => {
  test('its lanes are named in the order the entry says them, and draw what the opening got', () => {
    expect(LANES.map((lane) => lane.name)).toEqual([
      'Cache',
      'Stale copy',
      'Fresh fetch',
      'Timed out',
    ]);
    const sim = openingRun();
    expect(stripWords(sim)).toBe(
      'In the last 2 s, readers got 555 pages from the cache, 0 stale copies and 51 fresh fetches; 2 reads timed out, and 1 still waits.',
    );
    const paths = stripPaths(outcomeStrip(sim));
    expect(paths['stale']).toBe('');
    // The two readers who gave up began 50 ms apart, in the herd: one bar each, a quarter tall.
    expect(paths['timeout']).toBe('M51 98v-5.25h8v5.25zM61 98v-5.25h8v5.25z');
    expect(paths['pending']).toBe('M381 73v-8.32h8v8.32');
    expect(stripEnds(outcomeStrip(sim), sim.now)).toEqual(['3.05 s', '5.00 s']);
  });

  test('known answers: a bar is log-scaled, full from fifteen reads, and absent for none', () => {
    const bucket = (counts: Partial<Bucket>): Bucket => ({
      from: 0,
      hit: 0,
      stale: 0,
      served: 0,
      timeout: 0,
      pending: 0,
      ...counts,
    });
    const tall = (n: number) => {
      const d = stripPaths([bucket({ hit: n })])['hit'] ?? '';
      return d === '' ? 0 : Number(/v-([\d.]+)/.exec(d)?.[1]);
    };
    expect([0, 1, 3, 7, 15, 40].map(tall)).toEqual([0, 5.25, 10.5, 15.75, STRIP.tall, STRIP.tall]);
    // Reads still waiting: an open frame over the fresh fetches' bar, as tall as both together.
    expect(stripPaths([bucket({ served: 1, pending: 2 })])['pending']).toBe('M1 73v-10.5h8v10.5');
  });
});

test('the lines: three readers join into one at each node, and each node runs on to the database', () => {
  expect(fanPath(0)).toBe('M0 20H24L62 50H100M0 50H24L62 50H100M0 80H24L62 50H100');
  expect(fanPath(3)).toMatch(/L62 350H100$/);
  expect(linkPath(2)).toBe('M0 250H40L100 200');
});

test('the labels say the load and the clock', () => {
  const sim = openingRun();
  expect(readersWords(sim)).toBe('Readers, 300 a second');
  expect(clockWords(sim)).toBe('Virtual time 5.000 s, seed 7');
});
