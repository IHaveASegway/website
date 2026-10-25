import { expect, test } from '@playwright/test';
import {
  IMMUTABLE,
  MISSING,
  NEVER_SENT,
  ON_WORKER_PREVIEW,
  pages,
  PREVIEW_404_GAP,
  REVALIDATE,
  ROUTE_LAB,
  SECURITY_HEADERS,
  SOLVER,
  SOLVER_POLICY,
  VARY,
  varyNames,
} from './expected';

// Every value public/_headers sends, on a page, an asset and the 404 (security.md, "What CI
// checks"). HSTS is the zone's and previews never pass through the zone, so prod.spec.ts owns it.

const responses = [
  { label: 'a page', path: '/', status: 200 },
  { label: 'an asset', path: '/favicon.svg', status: 200 },
  { label: 'the 404', path: MISSING, status: 404 },
];

for (const { label, path, status } of responses) {
  test(`security headers on ${label}`, async ({ request }) => {
    test.fail(ON_WORKER_PREVIEW && status === 404, PREVIEW_404_GAP);
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

for (const { label, path, status } of responses) {
  test(`Vary names Accept-Encoding on ${label}`, async ({ request }) => {
    test.fail(ON_WORKER_PREVIEW && status === 404, PREVIEW_404_GAP);
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.status()).toBe(status);
    expect(varyNames(response.headers()['vary'])).toContain(VARY);
  });
}

test('known answers: Vary is read as a list of names, in any case', () => {
  expect(varyNames('Accept-Encoding')).toEqual([VARY]);
  expect(varyNames('Origin,  accept-encoding ')).toEqual(['origin', VARY]);
  expect(varyNames('Accept')).not.toContain(VARY);
  expect(varyNames(undefined)).toEqual([]);
});

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

// The Route Lab's solver (ADR 0016): each file carries its own policy beside the site's, as two
// headers the browser enforces together, and is cached for a year (its folder's name is a hash of
// its code). The module worker's script needs a JavaScript type, and streaming compilation needs
// application/wasm. The page that starts the worker carries the site's header policy only: its
// script policy is Astro's <meta>, with no 'wasm-unsafe-eval'. Each, and the page, names
// Accept-Encoding in Vary, as every response does: the WebAssembly is the largest file the site
// serves. A build from before the lab has none of it, so a rollback's smoke skips this.
test("the Route Lab's solver: its own policy beside the site's, its types, a year's cache", async ({
  request,
}) => {
  test.skip(!pages().includes(ROUTE_LAB), 'this build has no Route Lab');
  const policies = (headers: { name: string; value: string }[]) =>
    headers
      .filter((h) => h.name.toLowerCase() === 'content-security-policy')
      .map((h) => h.value)
      .sort();
  const types: [string, RegExp][] = [
    ['vroom-worker.mjs', /^text\/javascript\b/],
    ['vroom-solver.mjs', /^text\/javascript\b/],
    ['vroom.mjs', /^text\/javascript\b/],
    ['vroom.wasm', /^application\/wasm$/],
  ];
  for (const [file, type] of types) {
    const response = await request.get(`${SOLVER}${file}`, { maxRedirects: 0 });
    expect(response.status(), file).toBe(200);
    expect(policies(response.headersArray()), file).toEqual(
      [SOLVER_POLICY, SECURITY_HEADERS['content-security-policy']].sort(),
    );
    expect(response.headers()['content-type'], file).toMatch(type);
    expect(response.headers()['cache-control'], file).toBe(IMMUTABLE);
    expect(varyNames(response.headers()['vary']), file).toContain(VARY);
  }
  const page = await request.get(ROUTE_LAB, { maxRedirects: 0 });
  expect(policies(page.headersArray())).toEqual([SECURITY_HEADERS['content-security-policy']]);
  expect(varyNames(page.headers()['vary'])).toContain(VARY);
});
