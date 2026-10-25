import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { parseHolds } from '../src/lib/held-names';
import { isNoindex } from '../src/lib/noindex.mjs';
import { postPath } from '../src/lib/posts';
import { projectCards } from '../src/lib/profile';
import { FEATURED_POSTS } from '../src/lib/work';
import { app, files, fixture, profile, read } from './support/dist';

// Selected work on Home (content.md, "Owned work"; lib/work.ts): a card renders only when the page
// it opens exists. That is the project cards whose check is recorded and whose hold is lifted,
// linking to their repositories, then a card per featured post this build lists, linking to the
// post. With no card, Home has no Selected work section and no Work button. This runs on every
// build vitest.config.ts names, so the real build (no card today) and the fixture builds (a made-up
// project, checked and held by nothing) meet the same check. The expected post cards are read
// from the build's own pages, not from lib/work.ts, so the rule is checked against what exists.

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

/** The cards Home must render, in order, worked out from the profile and from this build's pages. */
const expected: RenderedCard[] = [
  ...projects.map((card) => ({ title: card.title, href: card.link.href })),
  ...FEATURED_POSTS.map((post) => postPath(post))
    .filter(lists)
    .map((href) => ({ title: heading(href), href })),
];

/** Home's Selected work section, or null when Home has none. */
const section = /<section\b[^>]*\bid="work"[^>]*>([\s\S]*?)<\/section>/.exec(home)?.[1] ?? null;

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

test('with no card, Home has no Selected work section, and nothing links to it', () => {
  expect(section !== null, 'Selected work renders exactly when a card does').toBe(
    expected.length > 0,
  );
  expect(home.includes('href="#work"'), 'the Work button renders exactly with the section').toBe(
    expected.length > 0,
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

test('a project card links only to its own repository, and draws the external arrow', () => {
  for (const card of projects) {
    const link = new RegExp(
      `<a\\b[^>]*href="${card.link.href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>([\\s\\S]*?)</a>`,
    ).exec(home);
    expect(link, card.link.href).not.toBeNull();
    expect(link?.[1]).toContain('Source on GitHub');
    expect(link?.[1]).toContain('↗');
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
  'known answer: the card fixture renders its made-up project, linked to its repository',
  () => {
    expect(projects.map((c) => c.title)).toEqual(['fixture-project']);
    expect(homeCards()).toEqual([
      { title: 'fixture-project', href: 'https://github.com/IHaveASegway/fixture-project' },
    ]);
  },
);
