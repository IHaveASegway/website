import { expect, test } from '@playwright/test';
import { IMMUTABLE, MISSING, NEVER_SENT, REVALIDATE, SECURITY_HEADERS } from './expected';

// Every value public/_headers sends, on a page, an asset and the 404 (security.md, "What CI
// checks"). HSTS is the zone's and previews never pass through the zone, so prod.spec.ts owns it.

const responses = [
  { label: 'a page', path: '/', status: 200 },
  { label: 'an asset', path: '/favicon.svg', status: 200 },
  { label: 'the 404', path: MISSING, status: 404 },
];

for (const { label, path, status } of responses) {
  test(`security headers on ${label}`, async ({ request }) => {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.status()).toBe(status);
    const headers = response.headers();
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      expect(headers[name], name).toBe(value);
    }
    for (const name of NEVER_SENT) {
      expect(headers[name], name).toBeUndefined();
    }
  });
}

test('hashed bundles are cached for a year; HTML revalidates', async ({ request }) => {
  const page = await request.get('/');
  expect(page.headers()['cache-control']).toBe(REVALIDATE);
  const stylesheet = /href="(\/_astro\/[^"]+\.css)"/.exec(await page.text())?.[1];
  expect(stylesheet, 'a stylesheet under /_astro/').toBeDefined();
  const bundle = await request.get(stylesheet ?? '');
  expect(bundle.status()).toBe(200);
  expect(bundle.headers()['cache-control']).toBe(IMMUTABLE);
});

test('security.txt is plain UTF-8 text (RFC 9116)', async ({ request }) => {
  const response = await request.get('/.well-known/security.txt');
  expect(response.headers()['content-type']).toMatch(/^text\/plain;\s*charset=utf-8$/i);
});
