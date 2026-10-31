import { describe, expect, test } from 'vitest';
import { createAgenda, next, peekTime, schedule } from '../src/lib/sim/agenda';
import { between, exponential, lognormal, seeded, zipf } from '../src/lib/sim/random';
import { seeded as raftSeeded } from '../src/lib/raft/sim';

// The pieces every simulated lab shares: one seeded stream, the distributions drawn from it, and
// the agenda that orders events. A lab's runs are only reproducible if these are.

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
