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

/**
 * The commit Home must report, when this run knows which build is served (delivery.md, "Deploy,
 * verify, roll back"). EXPECTED_COMMIT names it outright. Otherwise GITHUB_SHA does, but only in
 * the jobs that serve their own run's dist/: e2e (a preview, or wrangler dev) and deploy (the
 * Version URL). prod-smoke can run after a rollback, when production serves an older build on
 * purpose, so there only EXPECTED_COMMIT counts.
 */
function expectedCommit(): string | undefined {
  const named = process.env['EXPECTED_COMMIT'];
  if (named) return named;
  if (['e2e', 'deploy'].includes(process.env['GITHUB_JOB'] ?? '')) return process.env['GITHUB_SHA'];
  return undefined;
}

test("Home's Build readout is the commit being served", async ({ request }) => {
  const commit = expectedCommit();
  test.skip(!commit, 'this run does not know which commit is served: set EXPECTED_COMMIT');
  const html = await (await request.get('/')).text();
  const build = /<dt class="label">Build<\/dt><dd>([0-9a-f]{7})<\/dd>/.exec(html)?.[1];
  expect(build).toBe(commit?.slice(0, 7));
});

test('the link preview image each page names answers 200 as a PNG', async ({ request }) => {
  // What a build contains is checked only against a build this run knows it serves; otherwise only
  // what the served pages themselves name is checked. A rollback makes an older build live on
  // purpose, and a build from before PR 3 names no image: prod-smoke must pass it, not send the
  // operator to roll back again.
  const thisRunsBuild = expectedCommit() !== undefined;
  let named = 0;
  for (const path of PAGES) {
    const html = await (await request.get(path)).text();
    const image = /<meta property="og:image" content="([^"]+)">/.exec(html)?.[1];
    // This run's build names one on every page (content.md, "Structured data and link previews").
    if (thisRunsBuild) expect(image, `${path} names no og:image`).toBeDefined();
    if (image === undefined) continue;
    named++;
    expect(image).toMatch(new RegExp(`^${ORIGIN}/`));
    // og:image names production; a preview serves the same bytes, so the path is asked of the
    // server under test, which is what this run can vouch for.
    const response = await request.get(new URL(image, ORIGIN).pathname);
    expect(response.status(), image).toBe(200);
    expect(response.headers()['content-type'], image).toBe('image/png');
  }
  test.skip(named === 0, 'the served build names no link preview image: an older build is live');
});
