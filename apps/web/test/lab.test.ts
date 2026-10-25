import { describe, expect, test } from 'vitest';
import { labArea, labCards, labRoutes, labSchema } from '../src/lib/lab';

// The lab collection (lib/lab.ts; content.md, "Content model"), with known answers: what a lab
// entry may say about itself, which pages a build writes for the lab, and that /lab/api/ stays the
// lab Worker's (ADR 0009).

const entry = {
  title: 'A demo',
  summary: 'What it does.',
  lifecycle: 'live',
  runtime: { kind: 'browser' },
  decisions: ['0016'],
  firewall_reviewed: '2026-10-25',
};

describe('labSchema', () => {
  test('a browser demo needs no recording and no time limit', () => {
    expect(labSchema.safeParse(entry).success).toBe(true);
  });

  test('a demo on the lab Worker names its recording and keeps its state 15 minutes at most', () => {
    const worker = { kind: 'lab-worker', recording: 'run.ndjson', ttl_minutes: 15 };
    expect(labSchema.safeParse({ ...entry, runtime: worker }).success).toBe(true);
    expect(labSchema.safeParse({ ...entry, runtime: { ...worker, ttl_minutes: 16 } }).success).toBe(
      false,
    );
    expect(labSchema.safeParse({ ...entry, runtime: { kind: 'lab-worker' } }).success).toBe(false);
    expect(
      labSchema.safeParse({ ...entry, runtime: { kind: 'browser', recording: 'x' } }).success,
    ).toBe(false);
  });

  test('refuses what it does not know: another lifecycle, an extra key, a date with a time', () => {
    expect(labSchema.safeParse({ ...entry, lifecycle: 'building' }).success).toBe(false);
    expect(labSchema.safeParse({ ...entry, slug: 'routes' }).success).toBe(false);
    expect(
      labSchema.safeParse({ ...entry, firewall_reviewed: '2026-10-25T10:00:00Z' }).success,
    ).toBe(false);
    expect(labSchema.safeParse({ ...entry, decisions: ['16'] }).success).toBe(false);
    expect(labSchema.safeParse({ ...entry, title: 'x'.repeat(71) }).success).toBe(false);
  });
});

describe('labArea', () => {
  const demo = (slug: string) => ({ slug, title: slug, summary: `${slug}.`, decisions: [] });

  test('no demo, no lab: no index, no route, no card', () => {
    const empty = labArea([]);
    expect(empty.visible).toBe(false);
    expect(labRoutes(empty)).toEqual([]);
    expect(labCards(empty)).toEqual([]);
  });

  test('a demo brings /lab/ and its own page, by slug', () => {
    const area = labArea([demo('zeta'), demo('routes')]);
    expect(labRoutes(area)).toEqual(['/lab/', '/lab/routes/', '/lab/zeta/']);
    expect(labCards(area).map((c) => c.link.href)).toEqual(['/lab/routes/', '/lab/zeta/']);
  });

  test('"api" is never a demo: the lab Worker owns /lab/api/', () => {
    expect(() => labArea([demo('api')])).toThrow(/reserved/);
  });
});
