import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  ABOUT_HEADINGS,
  aboutParts,
  aboutSchema,
  LAB_NAMES,
  sectionOf,
  withLinks,
} from '../src/lib/about';
import { fixture, read } from './support/dist';

// /about/ (lib/about.ts): the bio, Joseph's words from src/content/about.md, then the résumé, which
// test/resume.test.ts checks. Every build writes the page; the bio is there exactly where its entry
// is, and the fixture builds, Writing's test builds, hold none. The entry holds the review stamp and
// nothing else: the nav names the page, and profile.json states every fact the résumé shows, so no
// fact has a second copy to fall out of date.

const fixtureBuild = fixture?.startsWith('.fixtures/') ?? false;
const page = read('about/index.html');
const entry = readFileSync(join(import.meta.dirname, '../src/content/about.md'), 'utf8');
const frontMatter = /^---\n([\s\S]*?)\n---\n/.exec(entry)?.[1] ?? '';
const body = entry.slice(entry.indexOf('\n---\n') + 5);

test('the entry carries the review stamp and no other field', () => {
  const keys = [...frontMatter.matchAll(/^([a-z_]+):/gm)].map(([, key]) => key);
  expect(keys).toEqual(Object.keys(aboutSchema.shape));
  expect(keys).toEqual(['firewall_reviewed']);
});

test('the bio renders exactly where its entry is, under its own heading, before Experience', () => {
  const bio = /<section class="section bio"[\s\S]*?<\/section>/.exec(page)?.[0];
  if (fixtureBuild) {
    expect(bio).toBeUndefined();
    return;
  }
  expect(bio).toBeDefined();
  expect(bio).toMatch(/<h2[^>]*>[\s\S]*?About me[\s\S]*?<\/h2>/);
  // Its first paragraph, the one that prints, as the entry opens.
  const first = body.trim().split('\n\n')[0]?.replace(/'/g, '’') ?? '';
  const shown = /<div class="prose">\s*<p>([\s\S]*?)<\/p>/.exec(bio ?? '')?.[1] ?? '';
  expect(shown.replace(/&#39;|&#x27;/g, "'").replace(/'/g, '’')).toBe(first);
  expect(page.indexOf('class="section bio"')).toBeLessThan(page.indexOf('id="experience-title"'));
});

test('the page has one Print button, and no PDF is written for it', () => {
  expect(page.match(/<button\b[^>]*\bdata-print\b/g)).toHaveLength(1);
  expect(page).not.toMatch(/href="[^"]*\.pdf"/);
});

// Home tells the bio in parts (ADR 0023): its opening, the principles under How I work, and what
// Joseph is working toward, read by aboutParts from the same file /about/ renders whole.
describe('aboutParts: Home reads the bio it does not own', () => {
  test('the real bio: an opening, then What I build, How I work and what comes next', () => {
    const parts = aboutParts(body);
    expect(parts.lede).toHaveLength(1);
    expect(parts.lede[0]).toMatch(/^I'm a software engineer/);
    // Home finds its parts by these headings, so the bio keeps them, in this order.
    expect(parts.sections.map((s) => s.heading)).toEqual(Object.values(ABOUT_HEADINGS));
    expect(parts.sections.map((s) => s.heading)).toEqual([
      'What I build',
      'How I work',
      "What I'm working toward",
    ]);
    const build = sectionOf(parts, ABOUT_HEADINGS.build);
    const how = sectionOf(parts, ABOUT_HEADINGS.how);
    const toward = sectionOf(parts, ABOUT_HEADINGS.toward);
    expect(build?.principles).toHaveLength(5);
    expect(build?.principles[0]?.lead).toBe('Queues that lose nothing.');
    expect(how?.principles).toHaveLength(5);
    expect(how?.principles[0]?.lead).toBe('The reasoning comes before the code.');
    expect(how?.paragraphs).toEqual([]);
    expect(toward?.principles).toEqual([]);
    expect(toward?.paragraphs).toHaveLength(1);
  });

  test('sectionOf: a section by its heading, wherever it stands, and none by another name', () => {
    const parts = aboutParts('Hi.\n\n### A\n\n- **One.** Two.\n\n### B\n\n- **Three.** Four.\n');
    expect(sectionOf(parts, 'B')?.principles).toEqual([{ lead: 'Three.', text: 'Four.' }]);
    expect(sectionOf(parts, 'C')).toBeUndefined();
  });

  test('known answers: a bold lead and its sentence, lines joined', () => {
    expect(aboutParts('Hi.\n\n### Work\n\n- **One.** Two\n  three.\n- **Four.** Five.\n')).toEqual({
      lede: ['Hi.'],
      sections: [
        {
          heading: 'Work',
          principles: [
            { lead: 'One.', text: 'Two three.' },
            { lead: 'Four.', text: 'Five.' },
          ],
          paragraphs: [],
        },
      ],
    });
  });

  test('markup Home would print as characters stops the build, rather than reach the page', () => {
    expect(() => aboutParts('See [the lab](/lab/).')).toThrow(/plain text only/);
    expect(() => aboutParts('### A\n\n- **One.** Has `code`.')).toThrow(/plain text only/);
    expect(() => aboutParts('### A\n\n- No bold lead.')).toThrow(/bold line/);
  });

  test('withLinks: the first mention of each name becomes its link, the rest stays text', () => {
    const names = [
      { name: 'Route Lab', href: '/lab/routes/' },
      { name: 'Raft Lab', href: '/lab/raft/' },
    ];
    expect(withLinks('The Route Lab and the Raft Lab; the Route Lab again.', names)).toEqual([
      'The ',
      { text: 'Route Lab', href: '/lab/routes/' },
      ' and the ',
      { text: 'Raft Lab', href: '/lab/raft/' },
      '; the Route Lab again.',
    ]);
    expect(withLinks('Nothing here.', names)).toEqual(['Nothing here.']);
    expect(withLinks('Route Lab', [])).toEqual(['Route Lab']);
  });

  test('withLinks: every lab the bio names links where its words are, the five of them', () => {
    const names = LAB_NAMES.map(({ slug, name }) => ({ name, href: `/lab/${slug}/` }));
    expect(LAB_NAMES.map((n) => n.name)).toEqual([
      'Route Lab',
      'Raft Lab',
      'Queue Lab',
      'Cache Lab',
      'Backfill Lab',
    ]);
    expect(withLinks('The Queue Lab, the Cache Lab and the Backfill Lab.', names)).toEqual([
      'The ',
      { text: 'Queue Lab', href: '/lab/queue/' },
      ', the ',
      { text: 'Cache Lab', href: '/lab/cache/' },
      ' and the ',
      { text: 'Backfill Lab', href: '/lab/backfill/' },
      '.',
    ]);
    // Each name the real bio holds, wherever it stands, becomes a link once.
    const text = aboutParts(body)
      .sections.flatMap((s) => [...s.principles.map((p) => p.text), ...s.paragraphs])
      .join(' ');
    const linked = withLinks(text, names).filter((run) => typeof run !== 'string');
    expect(linked.map((run) => run.text).sort()).toEqual(LAB_NAMES.map((n) => n.name).sort());
  });
});
