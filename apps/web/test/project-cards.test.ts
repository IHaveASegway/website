import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { parseHolds } from '../src/lib/held-names';
import { projectCards } from '../src/lib/profile';
import { app, fixture, profile, read } from './support/dist';

// Owned work on Home (content.md, "Owned work"): after the card for this site, one card per project
// whose readiness check is recorded and whose hold is lifted, linking to its repository. This runs
// on every build vitest.config.ts names, so the real build (no project card today) and the fixture
// builds (a made-up project, checked and held by nothing) meet the same check.

const holds = parseHolds(readFileSync(join(app, 'not-on-site.txt'), 'utf8'));
const expected = projectCards(profile, holds);

interface RenderedCard {
  readonly title: string;
  readonly href: string | null;
}

/** The cards in Home's Selected work section, in page order. */
function homeCards(): RenderedCard[] {
  const section = /<section\b[^>]*\bid="work"[^>]*>([\s\S]*?)<\/section>/.exec(read('index.html'));
  expect(section, 'Home has a Selected work section').not.toBeNull();
  return [
    ...(section?.[1] ?? '').matchAll(
      /<article\b[^>]*class="card\b[^"]*"[^>]*>([\s\S]*?)<\/article>/g,
    ),
  ].map(([, body = '']) => ({
    title: (/<h3\b[^>]*>([\s\S]*?)<\/h3>/.exec(body)?.[1] ?? '').trim(),
    href:
      /<a\b[^>]*class="card-more\b[^"]*"[^>]*href="([^"]*)"/.exec(body)?.[1] ??
      /<a\b[^>]*href="([^"]*)"[^>]*class="card-more\b/.exec(body)?.[1] ??
      null,
  }));
}

test('Home renders this site, then exactly the project cards that are checked and unheld, in profile order', () => {
  const cards = homeCards();
  expect(cards[0]?.title).toBe('This site');
  expect(cards.slice(1)).toEqual(expected.map((c) => ({ title: c.title, href: c.link.href })));
});

test('a project card links only to its own repository, and draws the external arrow', () => {
  const page = read('index.html');
  for (const card of expected) {
    const link = new RegExp(
      `<a\\b[^>]*href="${card.link.href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>([\\s\\S]*?)</a>`,
    ).exec(page);
    expect(link, card.link.href).not.toBeNull();
    expect(link?.[1]).toContain('Source on GitHub');
    expect(link?.[1]).toContain('↗');
  }
});

test.runIf(fixture === undefined)(
  'today, as profile.json and the hold list stand, no project card renders and no fixture project leaks',
  () => {
    expect(expected).toEqual([]);
    expect(homeCards().map((c) => c.title)).toEqual(['This site']);
    expect(read('index.html')).not.toContain('fixture-project');
  },
);

test.runIf(fixture?.includes('fixture-many') === true)(
  'known answer: the card fixture renders its made-up project, linked to its repository',
  () => {
    expect(expected.map((c) => c.title)).toEqual(['fixture-project']);
    expect(homeCards().at(-1)).toEqual({
      title: 'fixture-project',
      href: 'https://github.com/IHaveASegway/fixture-project',
    });
  },
);
