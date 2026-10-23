import { expect, test } from 'vitest';
import { MANIFEST, navFor, present, routesFrom } from '../src/lib/nav';
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

test('Writing joins the header, and RSS the footer, only with the routes content generates', () => {
  expect(navFor('header').map((i) => i.id)).toEqual([]);
  expect(navFor('footer').map((i) => i.id)).toEqual([]);
  expect(navFor('header', ['/writing/', '/notes/', '/rss.xml']).map((i) => i.id)).toEqual([
    'writing',
  ]);
  expect(navFor('footer', ['/writing/', '/notes/', '/rss.xml']).map((i) => i.id)).toEqual(['rss']);
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
