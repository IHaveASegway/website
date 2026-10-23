import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { NEVER_SENT, ORIGIN, PAGES, SECURITY_HEADERS } from './expected';

// prod-smoke: https://ihaveasegway.com through the zone. A Version URL or a preview is served from
// workers.dev and never passes through the zone, so these checks run only here and in the weekly
// audit (scripts/verify-zone.sh).

// ADR 0011's ramp, in seconds: 5 minutes, a week, a month, a year. Each step is set at the zone;
// any step passes here, and preload stays off until its own ADR.
const HSTS_RAMP = [300, 604_800, 2_592_000, 31_536_000];

test('HSTS is a step of the ramp, with includeSubDomains and without preload', async ({
  request,
}) => {
  const hsts = (await request.get('/')).headers()['strict-transport-security'] ?? '';
  const maxAge = Number(/max-age=(\d+)/i.exec(hsts)?.[1]);
  expect(HSTS_RAMP, `max-age in "${hsts}"`).toContain(maxAge);
  expect(hsts).toMatch(/includesubdomains/i);
  expect(hsts).not.toMatch(/preload/i);
});

test('www redirects to the apex with a 301, keeping the path and query', async ({ request }) => {
  const response = await request.get('https://www.ihaveasegway.com/a/?b=1', { maxRedirects: 0 });
  expect(response.status()).toBe(301);
  expect(response.headers()['location']).toBe(`${ORIGIN}/a/?b=1`);
});

test('plain HTTP redirects to HTTPS (Always Use HTTPS)', async ({ request }) => {
  const response = await request.get('http://ihaveasegway.com/', { maxRedirects: 0 });
  expect(response.status()).toBe(301);
  expect(response.headers()['location']).toBe(`${ORIGIN}/`);
});

test('security.txt is served, with the contact address and an Expires at least 30 days away', async ({
  request,
}) => {
  const response = await request.get('/.well-known/security.txt');
  expect(response.status()).toBe(200);
  const text = await response.text();
  expect(text).toContain('Contact: mailto:hello@ihaveasegway.com');
  const expires = Date.parse(/^Expires:\s*(\S+)/m.exec(text)?.[1] ?? '');
  expect(expires - Date.now()).toBeGreaterThan(30 * 24 * 3600 * 1000);
});

test('robots.txt is served, with its Sitemap line', async ({ request }) => {
  const response = await request.get('/robots.txt');
  expect(response.status()).toBe(200);
  expect(await response.text()).toContain(`Sitemap: ${ORIGIN}/sitemap-index.xml`);
});

test('the security headers are present, and the forbidden ones absent', async ({ request }) => {
  const response = await request.get('/');
  // A 404 answer carries the same headers, so first prove this is the page.
  expect(response.status()).toBe(200);
  const headers = response.headers();
  for (const [name, value] of Object.entries(SECURITY_HEADERS))
    expect(headers[name], name).toBe(value);
  for (const name of NEVER_SENT) expect(headers[name], name).toBeUndefined();
});

test('no zone feature injected a script into the HTML', async ({ request }) => {
  for (const path of PAGES) {
    expect(await (await request.get(path)).text(), path).not.toContain('/cdn-cgi/');
  }
});

test('the served HTML is the deployed artifact, byte for byte', async ({ request }) => {
  // DIST_DIR is the dist/ this run deployed. A rollback or a manual run has none to compare.
  const dist = process.env.DIST_DIR;
  test.skip(!dist, 'no deployed artifact in this run');
  for (const path of PAGES) {
    const built = await readFile(join(dist ?? '', path, 'index.html'));
    const served = await (await request.get(path)).body();
    expect(served.equals(built), `${path} differs from the build: a zone feature rewrote it`).toBe(
      true,
    );
  }
});

test('no CSP violation on Home in production', async ({ page }) => {
  const violations: string[] = [];
  page.on('console', (message) => {
    if (/content security policy/i.test(message.text())) violations.push(message.text());
  });
  await page.goto('/', { waitUntil: 'load' });
  expect(violations).toEqual([]);
});
