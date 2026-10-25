import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compile } from 'tailwindcss';
import { describe, expect, test } from 'vitest';
import { app, dist, filesIn } from './support/dist';
import { attribute, elementsOf } from './support/html';

// Every class the built stylesheet styles is used by some element on a built page. Tailwind reads
// every word under src/, comments included, as a possible class name (global.css), so a comment
// that says "filter" ships a .filter utility and 13 @property rules to every page: +220 B gzip in
// pull request #8 (PR 5's hardening), which no budget or other check caught, because both builds
// carried it. The stylesheet is shared, and only the fixtures hold posts yet, so the pages read are
// every build's. Content is outside what Tailwind reads (global.css), and a canary proves it.

/**
 * Classes the stylesheet already held, unused, on main at d6ac7a8, before this check existed:
 * words Tailwind read as utilities. The card's "more" link left the list when the owned-work cards
 * began to render it, and "border" left the stylesheet with the ruler that named it (2026-10-24).
 * A class that leaves the stylesheet, or that a page starts to use, must leave
 * the list (the test below holds it exact). Adding one is a reviewed decision, and no check
 * prevents it.
 */
const KNOWN_UNUSED = [
  'block',
  'fixed',
  'hidden',
  'inline',
  'invisible',
  'lowercase',
  'static',
  'table',
  'visible',
] as const;

/** Every class a stylesheet's selectors name: comments and at-rule preludes skipped, escapes read. */
export function classesStyled(css: string): Set<string> {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const classes = new Set<string>();
  let prelude = '';
  for (const char of source) {
    if (char === '{') {
      if (!prelude.trim().startsWith('@')) {
        for (const [, name = ''] of prelude.matchAll(
          /\.((?:\\.|[A-Za-z_-])(?:\\.|[A-Za-z0-9_-])*)/g,
        )) {
          classes.add(name.replace(/\\(.)/g, '$1'));
        }
      }
      prelude = '';
    } else if (char === '}' || char === ';') {
      prelude = '';
    } else {
      prelude += char;
    }
  }
  return classes;
}

/** Every class an element on a page carries, as the browser parses the page. */
export function classesUsed(html: string): Set<string> {
  return new Set(
    elementsOf(html).flatMap((element) => (attribute(element, 'class') ?? '').split(/\s+/)),
  );
}

const BUILDS = [
  dist,
  join(app, 'dist-preview'),
  ...[
    'fixture-none',
    'fixture-none-preview',
    'fixture-none-node-env',
    'fixture-one',
    'fixture-one-preview',
    'fixture-many',
    'fixture-many-preview',
  ].map((name) => join(app, '.fixtures', name)),
];

/** Each build's pages, and the stylesheets they link, read from the build itself. */
function read(build: string) {
  if (!existsSync(join(build, 'index.html')))
    throw new Error(`${build} is missing: build it first`);
  const pages = filesIn(build)
    .filter((file) => file.endsWith('.html'))
    .map((file) => readFileSync(join(build, file), 'utf8'));
  const sheets = new Set(
    pages.flatMap((page) =>
      elementsOf(page)
        .filter(
          (element) => element.tagName === 'link' && attribute(element, 'rel') === 'stylesheet',
        )
        .map((element) => attribute(element, 'href') ?? ''),
    ),
  );
  return { pages, sheets: [...sheets].map((href) => readFileSync(join(build, href), 'utf8')) };
}

describe('every class the stylesheet styles is used on a built page', () => {
  const builds = BUILDS.map(read);
  const styled = new Set(builds.flatMap((b) => b.sheets.flatMap((s) => [...classesStyled(s)])));
  const used = new Set(builds.flatMap((b) => b.pages.flatMap((p) => [...classesUsed(p)])));
  const unused = [...styled].filter((name) => !used.has(name)).sort();

  test('the pages link a stylesheet, and it styles classes the pages use', () => {
    expect(styled.size).toBeGreaterThan(40);
    expect(used.has('prose') && styled.has('prose')).toBe(true);
  });

  test('no class is styled that no page uses, but the known ones on main', () => {
    const known = new Set<string>(KNOWN_UNUSED);
    expect(unused.filter((name) => !known.has(name))).toEqual([]);
  });

  test('the known list is exact: each is still styled, and still unused', () => {
    expect(KNOWN_UNUSED.filter((name) => !unused.includes(name))).toEqual([]);
  });
});

describe('the words of a post or a draft never reach the stylesheet', () => {
  const canary = (
    /^Canary: (.+)$/m.exec(readFileSync(join(app, 'src/content/README.md'), 'utf8'))?.[1] ?? ''
  )
    .split(' ')
    .filter(Boolean);

  test('each canary word is a utility Tailwind would emit, if it read src/content', async () => {
    expect(canary.length).toBeGreaterThan(3);
    const utilities = classesStyled((await compile('@tailwind utilities;')).build(canary));
    expect([...utilities].sort()).toEqual([...canary].sort());
  });

  test("none of them is in any build's stylesheet: global.css keeps Tailwind out of src/content", () => {
    const styled = new Set(
      BUILDS.map(read).flatMap((b) => b.sheets.flatMap((s) => [...classesStyled(s)])),
    );
    expect(canary.filter((name) => styled.has(name))).toEqual([]);
    expect(readFileSync(join(app, 'src/styles/global.css'), 'utf8')).toContain(
      "@source not '../content';",
    );
  });
});

test('known answers: classes read from selectors only, and the regression this check exists for', () => {
  const css =
    '/*! tailwindcss | https://tailwindcss.com */@layer utilities{.flex{display:flex}' +
    '.md\\:flex{display:flex}.w-1\\.5{width:.375rem}}@media (width>=48rem){.prose :not(pre)>code{padding:0.5rem}}' +
    '.card:has(.card-more):hover{color:red}@property --tw-blur{syntax:"*";inherits:false}' +
    '.filter{filter:var(--tw-blur,)}';
  expect([...classesStyled(css)].sort()).toEqual([
    'card',
    'card-more',
    'filter',
    'flex',
    'md:flex',
    'prose',
    'w-1.5',
  ]);
  const page = '<!-- <p class="filter"> --><main class="flex  prose"><p class="card">a</p></main>';
  expect([...classesUsed(page)].filter(Boolean).sort()).toEqual(['card', 'flex', 'prose']);
  // Pull request #8's comment "The sitemap filter" made Tailwind ship .filter, which no element uses.
  const unused = [...classesStyled(css)].filter((name) => !classesUsed(page).has(name));
  expect(unused).toContain('filter');
});
