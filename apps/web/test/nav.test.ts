import { expect, test } from 'vitest';
import { labelOf, MANIFEST, navFor, present, routesFrom } from '../src/lib/nav';
import { files, html, read } from './support/dist';

// The nav manifest (design-system.md, "One nav manifest"): a link renders only when its page
// exists, so a planned page can sit in the manifest without ever producing a dead link. Static
// pages exist when their file does; Writing's pages and feed exist when content says so
// (lib/posts.ts, areaRoutes).

test('routes come from page files: index is "/", a folder index is its folder, 404 and endpoints are not pages', () => {
  const routes = routesFrom([
    '../pages/index.astro',
    '../pages/404.astro',
    '../pages/colophon/index.astro',
    '../pages/colophon/decisions/[slug].astro',
    '../pages/about.astro',
    '../pages/og.png.ts',
  ]);
  expect([...routes].sort()).toEqual(['/', '/about/', '/colophon/']);
});

test('a manifest item is linked only once its page exists', () => {
  expect(present(MANIFEST, new Set(['/'])).map((i) => i.id)).toEqual([]);
  expect(present(MANIFEST, new Set(['/', '/colophon/'])).map((i) => i.id)).toEqual(['colophon']);
});

// About, which holds the résumé, is a page file, so every build writes it and the header links it;
// Writing and RSS join with the routes content generates, and Lab with its first live demo, before
// Writing.
test('Writing joins the header, and RSS the footer, only with the routes content generates', () => {
  expect(navFor('header').map((i) => i.id)).toEqual(['about']);
  expect(navFor('footer').map((i) => i.id)).toEqual([]);
  expect(navFor('header', ['/writing/', '/notes/', '/rss.xml']).map((i) => i.id)).toEqual([
    'writing',
    'about',
  ]);
  expect(navFor('footer', ['/writing/', '/notes/', '/rss.xml']).map((i) => i.id)).toEqual(['rss']);
  expect(navFor('header', ['/lab/', '/writing/']).map((i) => i.id)).toEqual([
    'lab',
    'writing',
    'about',
  ]);
});

test("About names itself as the header does, and a missing item's label is an error", () => {
  expect(labelOf('about')).toBe('About');
  expect(() => labelOf('nowhere')).toThrow(/no item "nowhere"/);
});

// About's page file is in every build, so it stands in each list; Lab is what changes.
test('Lab joins the header, first, only with the routes the lab generates', () => {
  expect(navFor('header', ['/lab/', '/lab/routes/']).map((i) => i.id)).toEqual(['lab', 'about']);
  expect(navFor('header', ['/lab/routes/']).map((i) => i.id)).toEqual(['about']);
  expect(navFor('header', ['/writing/', '/lab/']).map((i) => i.id)).toEqual([
    'lab',
    'writing',
    'about',
  ]);
  expect(navFor('footer', ['/lab/']).map((i) => i.id)).toEqual([]);
});

// The top bar (ADR 0027, replacing the rail of ADRs 0021 to 0023): on every page the same header
// items, in the manifest's order, each a plain link, with no drop-down, and the item whose section
// the page is in marked with aria-current: the page itself, or a page inside it.
test("every page's top bar lists the header items in order, and marks its own section", () => {
  const built = files
    .filter((f) => f.endsWith('index.html'))
    .map((f) => `/${f.replace(/index\.html$/, '')}`);
  const items = navFor('header', built);
  expect(items.length).toBeGreaterThan(0);
  for (const file of html) {
    const page = read(file);
    const bar = /<nav class="site-nav"[\s\S]*?<\/nav>/.exec(page)?.[0] ?? '';
    const links = [...bar.matchAll(/<a href="([^"]+)"(?: aria-current="(page|true)")?>/g)];
    expect(
      links.map(([, href]) => href),
      file,
    ).toEqual(items.map((item) => item.href));
    expect(bar, `${file}: no drop-down in the bar`).not.toMatch(/<details/);
    const path = `/${file.replace(/index\.html$/, '')}`;
    const marked = links.filter(([, , current]) => current !== undefined).map(([, href]) => href);
    const expected = items.filter((item) => path.startsWith(item.href)).map((item) => item.href);
    expect(marked, file).toEqual(expected);
  }
});

// /about/ took /resume/'s place on 2026-10-28; /resume/ answers with a 301 (public/_redirects).
test('the manifest has no Résumé: no row links /resume/', () => {
  expect(MANIFEST.map((i) => i.href)).not.toContain('/resume/');
});

/** The links in a page's header nav and footer link row. */
function navLinks(page: string): string[] {
  const parts = [
    /<nav class="site-nav"[\s\S]*?<\/nav>/.exec(page)?.[0] ?? '',
    /<ul class="footer-links">[\s\S]*?<\/ul>/.exec(page)?.[0] ?? '',
  ];
  return parts.flatMap((part) =>
    [...part.matchAll(/<a href="([^"]+)"/g)].map(([, href = '']) => href),
  );
}

test('this build links no manifest page it does not write', () => {
  const targets = new Set(
    files.map((f) => `/${f.replace(/index\.html$/, '')}`).filter((f) => !f.endsWith('.html')),
  );
  for (const file of html) {
    for (const href of navLinks(read(file)).filter((h) => h.startsWith('/'))) {
      expect(targets.has(href), `${file}: ${href}`).toBe(true);
    }
  }
});
