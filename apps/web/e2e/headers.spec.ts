import { expect, test } from '@playwright/test';
import {
  IMMUTABLE,
  LEGACY_HEADER_POLICY,
  LEGACY_SOLVER_POLICY,
  MISSING,
  NEVER_SENT,
  ON_WORKER_PREVIEW,
  pagePolicyProblems,
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
// checks"), and the page policy the build writes beside them: one policy, the same on every
// response but a page with its own rule (src/lib/csp.mjs). HSTS is the zone's and previews never
// pass through the zone, so prod.spec.ts owns it.

/** The Content-Security-Policy headers of a response, each as sent. */
const policies = (headers: { name: string; value: string }[]) =>
  headers.filter((h) => h.name.toLowerCase() === 'content-security-policy').map((h) => h.value);

/** Whether the build served is from before 2026-10-25, whose pages carry their policy in a <meta>
 *  and whose header sends frame-ancestors alone (ADR 0018): a rollback's smoke can meet one. */
const legacyBuild = async (request: {
  get: (path: string) => Promise<{ text: () => Promise<string> }>;
}) => /<meta http-equiv="content-security-policy"/i.test(await (await request.get('/')).text());

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
    const legacy = await legacyBuild(request);
    expect(pagePolicyProblems(policies(response.headersArray()), legacy)).toEqual([]);
  });
}

test('known answers: the page policy check names a missing, loose or doubled policy', () => {
  const policy =
    "default-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; script-src 'self' 'sha256-HkhUKQRkeY+YHs24tEHcc5NkWrCeZx0fA/VDGQeJVnc='; style-src 'self'";
  expect(pagePolicyProblems([policy])).toEqual([]);
  expect(pagePolicyProblems([`${policy}; worker-src 'self'`])).toEqual([]);
  expect(pagePolicyProblems([LEGACY_HEADER_POLICY], true)).toEqual([]);
  expect(pagePolicyProblems([LEGACY_HEADER_POLICY])).not.toEqual([]);
  expect(pagePolicyProblems([])).toEqual(['0 policies, not 1']);
  expect(pagePolicyProblems([policy, policy])).toEqual(['2 policies, not 1']);
  expect(pagePolicyProblems([policy.replace("frame-ancestors 'none'; ", '')])).toEqual([
    "not frame-ancestors 'none'",
  ]);
  expect(
    pagePolicyProblems([policy.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'")]),
  ).toEqual([
    "script-src is not 'self' and hashes: 'self' 'unsafe-inline' 'sha256-HkhUKQRkeY+YHs24tEHcc5NkWrCeZx0fA/VDGQeJVnc='",
  ]);
  expect(pagePolicyProblems([`${policy}; worker-src *`])).toEqual(['worker-src *']);
  expect(pagePolicyProblems([`${policy}; report-uri /r`])).toEqual([
    'an unknown directive: report-uri',
  ]);
  expect(pagePolicyProblems([`script-src https://a.example; ${policy}`])).toEqual([
    'script-src is named twice',
    "script-src is not 'self' and hashes: https://a.example",
  ]);
});

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

// The Route Lab's solver (ADR 0016): each file carries its own policy and only that one, since
// its rule detaches the page policy (two would both be enforced, and the page's has no
// 'wasm-unsafe-eval'), and is cached for a year (its folder's name is a hash of its code). The
// module worker's script needs a JavaScript type, and streaming compilation needs
// application/wasm. The page that starts the worker carries the page policy with worker-src
// 'self', and no 'wasm-unsafe-eval'. Each, and the page, names Accept-Encoding in Vary, as every
// response does: the WebAssembly is the largest file the site serves. A build from before the lab
// has none of it, so a rollback's smoke skips this; one from before 2026-10-25 sent the solver's
// policy of then beside frame-ancestors (ADR 0018).
test("the Route Lab's solver: its own policy alone, its types, a year's cache", async ({
  request,
}) => {
  test.skip(!pages().includes(ROUTE_LAB), 'this build has no Route Lab');
  const legacy = await legacyBuild(request);
  const types: [string, RegExp][] = [
    ['vroom-worker.mjs', /^text\/javascript\b/],
    ['vroom-solver.mjs', /^text\/javascript\b/],
    ['vroom.mjs', /^text\/javascript\b/],
    ['vroom.wasm', /^application\/wasm$/],
  ];
  for (const [file, type] of types) {
    const response = await request.get(`${SOLVER}${file}`, { maxRedirects: 0 });
    expect(response.status(), file).toBe(200);
    expect(policies(response.headersArray()).sort(), file).toEqual(
      legacy ? [LEGACY_SOLVER_POLICY, LEGACY_HEADER_POLICY].sort() : [SOLVER_POLICY],
    );
    expect(response.headers()['content-type'], file).toMatch(type);
    expect(response.headers()['cache-control'], file).toBe(IMMUTABLE);
    expect(varyNames(response.headers()['vary']), file).toContain(VARY);
  }
  const page = await request.get(ROUTE_LAB, { maxRedirects: 0 });
  const policy = policies(page.headersArray());
  expect(pagePolicyProblems(policy, legacy)).toEqual([]);
  if (!legacy) expect(policy[0]).toContain("worker-src 'self'");
  expect(policy.join()).not.toContain('wasm-unsafe-eval');
  expect(varyNames(page.headers()['vary'])).toContain(VARY);
});
