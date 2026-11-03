import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  byLabOrder,
  LAB_NAMES,
  labArea,
  labCards,
  labName,
  labRoutes,
  labSchema,
} from '../src/lib/lab';
import { attribute, elementsOf, hasClass } from './support/html';
import { app, files, read } from './support/dist';

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

  test('a demo brings /lab/ and its own page', () => {
    const area = labArea([demo('zeta'), demo('routes')]);
    expect(labRoutes(area)).toEqual(['/lab/', '/lab/routes/', '/lab/zeta/']);
    expect(labCards(area).map((c) => c.link.href)).toEqual(['/lab/routes/', '/lab/zeta/']);
  });

  // Easiest to follow first, and What I build's order after that. By slug, a recruiter's first card
  // on /lab/ was the hardest word on the site, and the Route Lab was last.
  test('known answers: the labs come in the order a visitor meets them, a new one after them', () => {
    const slugs = ['backfill', 'cache', 'beta', 'queue', 'raft', 'alpha', 'routes'];
    expect(labArea(slugs.map(demo)).entries.map((entry) => entry.slug)).toEqual([
      'routes',
      'queue',
      'cache',
      'backfill',
      'raft',
      'alpha',
      'beta',
    ]);
    expect(byLabOrder('routes', 'backfill')).toBeLessThan(0);
    expect(byLabOrder('zeta', 'raft')).toBeGreaterThan(0);
    expect(labName('queue')).toBe('Queue Lab');
    expect(labName('zeta')).toBeUndefined();
  });

  test('"api" is never a demo: the lab Worker owns /lab/api/', () => {
    expect(() => labArea([demo('api')])).toThrow(/reserved/);
  });
});

// One order wherever the labs are listed as an index, and one name for each, so nobody has to
// translate between pages: /lab/'s cards, the command menu, and /lab/'s link preview, whose glyphs read
// the same list. Home's rows and /about/'s are the bio's, in the order Joseph tells them: until
// 2026-11-03 Home held the bio's order to this one, and the bio now leads with the Cache Lab.
describe.runIf(files.includes('lab/index.html'))('the labs as this build lists them', () => {
  const order = LAB_NAMES.map((lab) => lab.slug);
  const cards = elementsOf(read('lab/index.html')).filter((e) => hasClass(e, 'lab-card'));

  test('/lab/ lists them in the order they are met, each named on its card', () => {
    expect(cards.map((card) => attribute(card, 'data-line'))).toEqual(order);
    const page = read('lab/index.html');
    for (const { name } of LAB_NAMES) expect(page).toContain(`<p class="lab-name">${name}</p>`);
  });

  test("Home's rows go in the bio's order, each lab once, and the menu lists them in the labs' own", () => {
    const page = read('index.html');
    const builds = elementsOf(page)
      .filter((e) => hasClass(e, 'build') && attribute(e, 'data-line') !== undefined)
      .map((e) => attribute(e, 'data-line') as string);
    expect(builds).toEqual(['cache', 'queue', 'backfill', 'routes', 'raft']);
    expect([...builds].sort()).toEqual([...order].sort());
    const menu = elementsOf(page)
      .filter((e) => attribute(e, 'role') === 'option')
      .map((e) => /^palette-lab-(.+)$/.exec(attribute(e, 'id') ?? '')?.[1])
      .filter((slug) => slug !== undefined);
    expect(menu).toEqual(order);
  });

  // A rule pasted once for each of the sheet's three copies of the desk's controls went unseen: each
  // draws the same, and the sheet's bytes are what a phone pays.
  test("the sheet styles a lab's name in its lead once", () => {
    const sheet = readFileSync(join(app, 'src/styles/lab-page.css'), 'utf8');
    expect(sheet.match(/^\.lab-head-name \{/gm)).toHaveLength(1);
  });

  test("each lab's page opens its lead on its name, its link preview says it, and the menu finds it", () => {
    for (const { slug, name } of LAB_NAMES) {
      const page = read(`lab/${slug}/index.html`);
      expect(page, slug).toContain(`<span class="lab-head-name">${name}. </span>`);
      expect(page, slug).toMatch(
        new RegExp(`<meta property="og:title" content="[^"]* · ${name}">`),
      );
      const row = elementsOf(page).find((e) => attribute(e, 'id') === `palette-lab-${slug}`);
      expect(row && attribute(row, 'data-find'), slug).toContain(name);
    }
  });
});
