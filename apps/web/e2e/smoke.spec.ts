import { expect, test } from '@playwright/test';
import { FILES, MISSING, ON_WORKER_PREVIEW, ORIGIN, PAGES, PREVIEW_404_GAP } from './expected';

// The smoke: run against every preview, against each Version URL before it takes traffic, against
// production through the zone (prod-smoke), and locally against wrangler dev. HTTP only, so it
// needs no browser.

for (const path of PAGES) {
  test(`${path} answers 200 with its own page`, async ({ request }) => {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('text/html');
    const html = await response.text();
    // The canonical link names this page and no other, and the 404 page has none, so a 200 that
    // serves the wrong page fails here. Previews carry the production URL too: the bytes are the same.
    expect(html).toContain(`<link rel="canonical" href="${ORIGIN}${path}">`);
    expect(html, 'a page in the sitemap is indexable').not.toMatch(/<meta name="robots"/i);
    if (path === '/') expect(html).toMatch(/<h1[^>]*>Joseph Peterson<\/h1>/);
  });
}

for (const path of FILES) {
  test(`${path} answers 200`, async ({ request }) => {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.status()).toBe(200);
    expect((await response.body()).byteLength).toBeGreaterThan(0);
  });
}

test('an unknown path answers 404 with the 404 page, which is noindex', async ({ request }) => {
  test.fail(ON_WORKER_PREVIEW, PREVIEW_404_GAP);
  const response = await request.get(MISSING, { maxRedirects: 0 });
  expect(response.status()).toBe(404);
  const html = await response.text();
  expect(html).toContain('Page not found');
  expect(html).toContain('<meta name="robots" content="noindex">');
});

test('/404 itself, which Workers serves with status 200, is noindex too', async ({ request }) => {
  // not_found_handling serves 404.html at its own address as a page (ADR 0005's /404 row): a soft
  // 404 that only noindex keeps out of search results.
  const response = await request.get('/404', { maxRedirects: 0 });
  expect([200, 404]).toContain(response.status());
  expect(await response.text()).toContain('<meta name="robots" content="noindex">');
});

test('a page URL in any other form redirects to its slash form', async ({ request }) => {
  // Home alone has one other form, /index.html. Each page added later brings its slashless form.
  const forms: [string, string][] = [
    ['/index.html', '/'],
    ...PAGES.filter((page) => page !== '/').map((page): [string, string] => [
      page.slice(0, -1),
      page,
    ]),
  ];
  for (const [from, to] of forms) {
    const response = await request.get(from, { maxRedirects: 0 });
    expect([301, 307, 308], `${from} status`).toContain(response.status());
    const location = response.headers()['location'] ?? '';
    expect(new URL(location, response.url()).pathname, `${from} location`).toBe(to);
  }
});

test('the configuration files are not served as assets', async ({ request }) => {
  for (const path of ['/_headers', '/_redirects']) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.status(), path).toBe(404);
  }
});
