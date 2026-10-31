import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { parseHolds } from '../src/lib/held-names';
import { isNoindex } from '../src/lib/noindex.mjs';
import { postPath } from '../src/lib/posts';
import { projectCards } from '../src/lib/profile';
import { FEATURED_POSTS } from '../src/lib/work';
import { app, files, fixture, profile, read } from './support/dist';

// Selected work on Home (content.md, "Owned work"; lib/work.ts): an item renders only when the page
// it opens exists. Each demo the lab builds is a lab card, its title linking to its page (ADR 0016,
// ADR 0027); then a card per project whose check is recorded and whose hold is lifted, linking to
// its repository, then a card per featured post this build lists, linking to the post. With
// neither, Home has no Selected work section. This runs on every build vitest.config.ts names, so
// the real build (no card today) and the fixture builds (a made-up project, checked and held by
// nothing) meet the same check. The expected demos and post cards are read from the build's own
// pages, not from lib/work.ts, so the rule is checked against what exists.

const holds = parseHolds(readFileSync(join(app, 'not-on-site.txt'), 'utf8'));
const projects = projectCards(profile, holds);
const home = read('index.html');

interface RenderedCard {
  readonly title: string;
  readonly href: string | null;
}

/** A page this build lists: its index.html exists and is not noindex. */
const lists = (path: string) => {
  const file = `${path.slice(1)}index.html`;
  return files.includes(file) && !isNoindex(read(file));
};

/** The text of a page's <h1>, as the build wrote it. */
const heading = (path: string) =>
  (/<h1\b[^>]*>([\s\S]*?)<\/h1>/.exec(read(`${path.slice(1)}index.html`))?.[1] ?? '').trim();

/** The lab's demo pages this build lists, /lab/<slug>/, by slug. */
const demos = files
  .filter((file) => /^lab\/[a-z0-9-]+\/index\.html$/.test(file))
  .map((file) => `/${file.slice(0, -'index.html'.length)}`)
  .filter(lists)
  .sort();

/** The cards Home must render, in order, worked out from the profile and from this build's pages:
 *  everything Selected work holds that is not a demo, in the list's order. */
const expected: RenderedCard[] = [
  ...projects.map((card) => ({ title: card.title, href: card.link.href })),
  ...FEATURED_POSTS.map((post) => postPath(post))
    .filter(lists)
    .map((href) => ({ title: heading(href), href })),
];

/** Home's Selected work section, or null when Home has none. */
const section = /<section\b[^>]*\bid="work"[^>]*>([\s\S]*?)<\/section>/.exec(home)?.[1] ?? null;

/** Home's lab cards (components/home/LabCards.astro), by title and link, in page order. */
function homeLabCards(): RenderedCard[] {
  return [
    ...(section ?? '').matchAll(/<li\b[^>]*class="card lab-card\b[^"]*"[^>]*>([\s\S]*?)<\/li>/g),
  ].map(([, body = '']) => {
    const link = /<a\b[^>]*class="card-more\b[^"]*"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/.exec(
      body,
    );
    return { title: (link?.[2] ?? '').trim(), href: link?.[1] ?? null };
  });
}

/** The cards in Home's Selected work section, in page order. */
function homeCards(): RenderedCard[] {
  return [
    ...(section ?? '').matchAll(/<article\b[^>]*class="card\b[^"]*"[^>]*>([\s\S]*?)<\/article>/g),
  ].map(([, body = '']) => ({
    title: (/<h3\b[^>]*>([\s\S]*?)<\/h3>/.exec(body)?.[1] ?? '').trim(),
    href:
      /<a\b[^>]*class="card-more\b[^"]*"[^>]*href="([^"]*)"/.exec(body)?.[1] ??
      /<a\b[^>]*href="([^"]*)"[^>]*class="card-more\b/.exec(body)?.[1] ??
      null,
  }));
}

test('Home renders exactly the cards whose page exists: checked, unheld projects, then listed featured posts', () => {
  expect(homeCards()).toEqual(expected);
});

// Home draws every demo the lab lists as a lab card, in the lab's order, each its own page's title
// and link (ADR 0027; until then a line on the board, ADR 0025).
test('Home draws a lab card for each demo this build lists, in the lab’s order, linking to it', () => {
  expect(homeLabCards()).toEqual(demos.map((href) => ({ title: heading(href), href })));
});

test('with no demo and no card, Home has no Selected work section, and nothing links to it', () => {
  expect(section !== null, 'Selected work renders exactly when a demo or a card does').toBe(
    demos.length + expected.length > 0,
  );
  expect(home.includes('href="#work"'), 'no button scrolls to it: the column leads to it').toBe(
    false,
  );
});

test("every card's link opens a page that exists: a listed page here, or a checked repository", () => {
  const repositories = new Set(projects.map((card) => card.link.href));
  for (const { href } of homeCards()) {
    expect(href, 'a card always has a link').not.toBeNull();
    if (href?.startsWith('/')) expect(lists(href), href).toBe(true);
    else expect(repositories.has(href ?? ''), String(href)).toBe(true);
  }
});

// A link says where it goes in words, with no arrow (ADR 0025): Barlow draws none, and until then
// the card drew ↗ in a system face.
test('a project card links only to its own repository, says so in words, and draws no arrow', () => {
  for (const card of projects) {
    const link = new RegExp(
      `<a\\b[^>]*href="${card.link.href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>([\\s\\S]*?)</a>`,
    ).exec(home);
    expect(link, card.link.href).not.toBeNull();
    expect(link?.[1]).toContain('Source on GitHub');
    expect(link?.[1]).not.toMatch(/[←↑→↓↗]/);
  }
});

// Only the projects are pinned here. Whether a post's card renders follows from the build's own
// pages, which the tests above already hold Home to, so publishing a featured post turns its card
// on without a change to this file.
test.runIf(fixture === undefined)(
  'today, as profile.json and the hold list stand, no project card renders and no fixture project leaks',
  () => {
    expect(projects).toEqual([]);
    expect(home).not.toContain('fixture-project');
  },
);

test.runIf(fixture?.includes('fixture-many') === true)(
  'known answer: the profile fixture renders its made-up project, linked to its repository',
  () => {
    expect(projects.map((c) => c.title)).toEqual(['fixture-project']);
    expect(homeCards()).toEqual([
      { title: 'fixture-project', href: 'https://github.com/IHaveASegway/fixture-project' },
    ]);
  },
);
