import { describe, expect, test } from 'vitest';
import { createAgenda, next, peekTime, schedule } from '../src/lib/sim/agenda';
import { readLink, valueOf, word, writeLink, type Values } from '../src/lib/sim/link';
import { between, exponential, lognormal, seeded, zipf } from '../src/lib/sim/random';
import { seeded as raftSeeded } from '../src/lib/raft/sim';

// The pieces every simulated lab shares: one seeded stream, the distributions drawn from it, the
// agenda that orders events, and the link that names a run. A lab's runs are only reproducible if
// these are.

describe('the seeded stream', () => {
  test('is the Raft Lab’s generator, draw for draw', () => {
    const a = seeded(7);
    const b = raftSeeded(7);
    for (let i = 0; i < 1000; i++) expect(a()).toBe(b());
  });

  test('draws a Poisson process’s gaps with the asked-for mean', () => {
    const random = seeded(1);
    let sum = 0;
    for (let i = 0; i < 20_000; i++) sum += exponential(random, 10);
    expect(sum / 20_000).toBeGreaterThan(95);
    expect(sum / 20_000).toBeLessThan(105);
  });

  test('puts half of a log-normal’s draws under its median', () => {
    const random = seeded(2);
    let under = 0;
    for (let i = 0; i < 20_000; i++) if (lognormal(random, 300, 0.5) < 300) under++;
    expect(under / 20_000).toBeGreaterThan(0.48);
    expect(under / 20_000).toBeLessThan(0.52);
  });

  test('keeps whole numbers between their bounds, both included', () => {
    const random = seeded(3);
    const seen = new Set<number>();
    for (let i = 0; i < 1000; i++) seen.add(between(random, 2, 5));
    expect([...seen].sort()).toEqual([2, 3, 4, 5]);
  });

  test('draws rank 0 most often under Zipf’s law, and rank 1 about half as often at s = 1', () => {
    const random = seeded(4);
    const draw = zipf(100, 1);
    const counts = Array.from({ length: 100 }, () => 0);
    for (let i = 0; i < 50_000; i++) {
      const rank = draw(random);
      counts[rank] = (counts[rank] ?? 0) + 1;
    }
    const [first, second] = counts as [number, number];
    expect(first).toBe(Math.max(...counts));
    expect(second / first).toBeGreaterThan(0.45);
    expect(second / first).toBeLessThan(0.55);
  });
});

describe('the agenda', () => {
  test('gives events back by time, and same-time events in the order they were scheduled', () => {
    const agenda = createAgenda<string>();
    const random = seeded(5);
    const scheduled: { at: number; name: string }[] = [];
    for (let i = 0; i < 500; i++) {
      const at = Math.floor(random() * 50);
      const name = `e${i}`;
      schedule(agenda, at, name);
      scheduled.push({ at, name });
    }
    const expected = [...scheduled].sort((a, b) => a.at - b.at).map((e) => e.name);
    const got: string[] = [];
    while (Number.isFinite(peekTime(agenda))) got.push((next(agenda) as { event: string }).event);
    expect(got).toEqual(expected);
  });

  test('is empty at Infinity', () => {
    const agenda = createAgenda<number>();
    expect(peekTime(agenda)).toBe(Infinity);
    expect(next(agenda)).toBeUndefined();
    schedule(agenda, 3, 1);
    expect(next(agenda)?.event).toBe(1);
    expect(peekTime(agenda)).toBe(Infinity);
  });
});

// A lab's settings as a link names them (lib/sim/link.ts): a word, a whole number, and two
// switches, one of them on at the opening, as the Cache Lab's invalidation is.
const SETTINGS = {
  load: { values: ['calm', 'busy', 'rush'], opening: 'busy' },
  prefetch: { values: [1, 2, 5, 10], opening: 1 },
  key: { values: [false, true], opening: false },
  invalidate: { values: [true, false], opening: true },
} as const;
type Chosen = Values<typeof SETTINGS>;
const OPENING: Chosen = { load: 'busy', prefetch: 1, key: false, invalidate: true };

/** Every combination of the settings' values: 3 x 4 x 2 x 2. */
function everyChoice(): Chosen[] {
  const all: Chosen[] = [];
  for (const load of SETTINGS.load.values)
    for (const prefetch of SETTINGS.prefetch.values)
      for (const key of SETTINGS.key.values)
        for (const invalidate of SETTINGS.invalidate.values)
          all.push({ load, prefetch, key, invalidate });
  return all;
}

describe('a link to a run', () => {
  test('names the seed, then each setting that differs from the opening, in the order the lab declares them', () => {
    expect(writeLink(7, OPENING, SETTINGS)).toBe('#seed-7');
    expect(writeLink(28, { ...OPENING, key: true }, SETTINGS)).toBe('#seed-28&key=on');
    // The order the values come in is not the order the link names them.
    expect(
      writeLink(12, { invalidate: false, key: true, prefetch: 10, load: 'rush' }, SETTINGS),
    ).toBe('#seed-12&load=rush&prefetch=10&key=on&invalidate=off');
  });

  test('round trip: every combination of values reads back as written, and writes back the same link', () => {
    const choices = everyChoice();
    expect(choices).toHaveLength(48);
    for (const seed of [0, 7, 999_999])
      for (const values of choices) {
        const link = writeLink(seed, values, SETTINGS);
        expect(readLink(link, SETTINGS), link).toEqual({ seed, values });
        expect(writeLink(seed, readLink(link, SETTINGS)?.values ?? OPENING, SETTINGS)).toBe(link);
      }
  });

  test('a link that names no setting gives every setting the opening’s value', () => {
    expect(readLink('#seed-9', SETTINGS)).toEqual({ seed: 9, values: OPENING });
  });

  test('order does not matter: the same settings named in any order give the same run', () => {
    const named = ['load=calm', 'prefetch=5', 'key=on', 'invalidate=off'];
    const expected = {
      seed: 3,
      values: { load: 'calm', prefetch: 5, key: true, invalidate: false },
    };
    for (let turn = 0; turn < named.length; turn++) {
      const turned = [...named.slice(turn), ...named.slice(0, turn)];
      expect(readLink(`#seed-3&${turned.join('&')}`, SETTINGS)).toEqual(expected);
      expect(readLink(`#seed-3&${turned.reverse().join('&')}`, SETTINGS)).toEqual(expected);
    }
  });

  test('a name the lab does not have is dropped, and so is anything an object inherits', () => {
    for (const name of ['colour', 'seed', 'constructor', '__proto__', 'toString', 'hasOwnProperty'])
      expect(readLink(`#seed-7&${name}=on&key=on`, SETTINGS), name).toEqual({
        seed: 7,
        values: { ...OPENING, key: true },
      });
  });

  test('a value its setting cannot take is dropped, and the setting keeps the opening’s', () => {
    for (const pair of [
      'load=storm',
      'load=constructor',
      'load=Busy',
      'load=',
      'load',
      'load=calm=rush',
      'prefetch=3',
      'prefetch=01',
      'prefetch=1.0',
      'prefetch=on',
      'key=yes',
      'key=true',
      'key=1',
      'invalidate=OFF',
      '',
      '=',
    ])
      expect(readLink(`#seed-7&${pair}`, SETTINGS), pair).toEqual({ seed: 7, values: OPENING });
    // The rest of the link still counts.
    expect(readLink('#seed-7&load=storm&prefetch=10&key=maybe', SETTINGS)?.values).toEqual({
      ...OPENING,
      prefetch: 10,
    });
  });

  test('a setting named twice takes its last naming, and the opening’s value when it cannot take that', () => {
    expect(readLink('#seed-7&load=calm&load=rush', SETTINGS)?.values.load).toBe('rush');
    expect(readLink('#seed-7&load=calm&load=storm', SETTINGS)?.values.load).toBe('busy');
    // An opening's value named in the link is a value the setting can take, and the link it
    // writes back leaves it out.
    const busy = readLink('#seed-7&load=busy&key=off', SETTINGS);
    expect(busy).toEqual({ seed: 7, values: OPENING });
    expect(writeLink(7, busy?.values ?? OPENING, SETTINGS)).toBe('#seed-7');
  });

  test('a choice on the page names a value as a link does: a switch is on or off', () => {
    expect(SETTINGS.key.values.map(word)).toEqual(['off', 'on']);
    expect(SETTINGS.prefetch.values.map(word)).toEqual(['1', '2', '5', '10']);
    expect(valueOf(SETTINGS.key, 'on')).toBe(true);
    expect(valueOf(SETTINGS.invalidate, 'off')).toBe(false);
    expect(valueOf(SETTINGS.prefetch, '10')).toBe(10);
    expect(valueOf(SETTINGS.load, 'rush')).toBe('rush');
    for (const text of ['true', 'yes', '3', 'storm', '', undefined])
      expect(valueOf(SETTINGS.key, text) ?? valueOf(SETTINGS.prefetch, text)).toBeUndefined();
  });

  test('a hash that links to no run names none: the page opens the build’s run', () => {
    for (const hash of [
      '',
      '#',
      '#main',
      '#seed',
      '#seed-',
      '#seed-x',
      '#seed-1234567',
      '#seed--1',
      '#seed-7x',
      '#seed-7 ',
      '#seed-7?load=calm',
      'seed-7',
      '#Seed-7',
    ])
      expect(readLink(hash, SETTINGS), hash).toBeNull();
    // A seed of up to six digits, and a separator with nothing after it, still name a run.
    expect(readLink('#seed-999999', SETTINGS)?.seed).toBe(999_999);
    expect(readLink('#seed-7&', SETTINGS)).toEqual({ seed: 7, values: OPENING });
  });
});
