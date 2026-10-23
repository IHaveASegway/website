import { expect, test } from 'vitest';
import { footerNav, headerNav, MANIFEST, present, routesFrom } from '../src/lib/nav';
import { html } from './support/dist';

// The nav manifest (design-system.md, "One nav manifest"): a link renders only when its page
// exists, so a planned page can sit in the manifest without ever producing a dead link.

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

test('this build links no manifest page it does not write', () => {
  const built = new Set(
    html.filter((f) => f.endsWith('index.html')).map((f) => `/${f.slice(0, -'index.html'.length)}`),
  );
  for (const item of [...headerNav, ...footerNav])
    expect(built.has(item.href), item.href).toBe(true);
});
