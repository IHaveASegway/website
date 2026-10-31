import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import type { Post } from '../src/lib/posts';
import { recordDays, timeline } from '../src/lib/timeline';
import { fixture, read } from './support/dist';

// /about/'s brief timeline (lib/timeline.ts): a post on its published day, a lab on its decision
// record's, newest day first, and nothing the build does not hold. Known answers first, then the
// real records and the built page.

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
const post = (slug: string, published: string, over: Partial<Post> = {}): Post => ({
  section: 'writing',
  slug,
  title: `Title ${slug}`,
  summary: 'Summary',
  published: day(published),
  updated: null,
  draft: false,
  tags: [],
  kind: 'essay',
  source: null,
  minutes: 1,
  ...over,
});

test('known answers: a record is dated by the first day on its status line, or not at all', () => {
  const days = recordDays([
    { name: '0016-route-lab.md', text: '# Title\n\nStatus: Proposed · 2026-10-25 · Deciders: J\n' },
    { name: '0012-public.md', text: 'Status: Accepted · 2026-10-25 (proposed 2026-10-22) · x' },
    { name: '0099-undated.md', text: 'Status: Proposed\n\nOn 2026-01-01 nothing.' },
    { name: 'README.md', text: 'Status: Accepted · 2026-10-23' },
    { name: '0098-bad-day.md', text: 'Status: Proposed · 2026-02-30' },
  ]);
  expect([...days.entries()].map(([n, d]) => [n, d.toISOString().slice(0, 10)])).toEqual([
    ['0016', '2026-10-25'],
    ['0012', '2026-10-25'],
  ]);
});

test('known answers: posts and labs grouped by day, newest first, posts first within a day', () => {
  const days = new Map([
    ['0001', day('2026-10-20')],
    ['0002', day('2026-10-22')],
  ]);
  const got = timeline(
    [post('a', '2026-10-22'), post('b', '2026-10-21', { kind: 'postmortem' })],
    [
      { title: 'Lab one', href: '/lab/one/', decisions: ['0002', '0001'] },
      { title: 'Lab two', href: '/lab/two/', decisions: ['0002'] },
      { title: 'Undated lab', href: '/lab/three/', decisions: ['0003'] },
      { title: 'No record', href: '/lab/four/', decisions: [] },
    ],
    days,
  );
  expect(got.map((d) => [d.day.toISOString().slice(0, 10), d.items.map((i) => i.title)])).toEqual([
    ['2026-10-22', ['Title a', 'Lab two']],
    ['2026-10-21', ['Title b']],
    // A lab takes the earliest of its records' days.
    ['2026-10-20', ['Lab one']],
  ]);
  expect(got[1]?.items[0]).toEqual({ kind: 'Postmortem', title: 'Title b', href: '/writing/b/' });
  expect(got[0]?.items[1]?.kind).toBe('Lab');
  expect(timeline([], [], days)).toEqual([]);
});

// Every decision record a lab names is dated, so no live lab drops off the timeline unseen.
test('every decision record a lab entry names has a dated status line', () => {
  const app = join(import.meta.dirname, '..');
  const adr = join(app, '../../docs/adr');
  const days = recordDays(
    readdirSync(adr).map((name) => ({ name, text: readFileSync(join(adr, name), 'utf8') })),
  );
  const labs = join(app, 'src/content/lab');
  for (const file of readdirSync(labs).filter((f) => f.endsWith('.md'))) {
    const named = /^decisions:\s*\[([^\]]*)\]/m.exec(readFileSync(join(labs, file), 'utf8'))?.[1];
    for (const n of named?.match(/\d{4}/g) ?? []) expect(days.has(n), `${file}: ${n}`).toBe(true);
  }
});

test('the built /about/ lists one timeline row a day, each with its items linked, newest first', () => {
  const page = read('about/index.html');
  const timelineHtml = /<ol class="timeline"[\s\S]*?<\/ol>\s*<p class="about-note">/.exec(
    page,
  )?.[0];
  if (fixture?.startsWith('.fixtures/')) return; // the fixture builds hold no lab
  expect(timelineHtml).toBeDefined();
  const dates = [...(timelineHtml ?? '').matchAll(/<time datetime="(\d{4}-\d{2}-\d{2})"/g)].map(
    ([, d]) => d ?? '',
  );
  expect(dates.length).toBeGreaterThan(0);
  expect([...dates].sort().reverse()).toEqual(dates);
  expect(new Set(dates).size).toBe(dates.length);
  expect(timelineHtml).not.toMatch(/<a href="">/);
});
