import { expect, test } from '@playwright/test';
import { REVALIDATE, SECURITY_HEADERS, WRITING_FIXTURE_PAGES } from './expected';

// What only a build with posts can show (pnpm e2e:writing, on .fixtures/fixture-many). The page
// list checks (axe, the CSP and the request watcher, glyphs, held names, the smoke) walk every
// fixture page from their own specs; this one checks the feed in a real XML parser, the draft's
// absence, the post page's headers and layout, and the Markdown the tour post renders.

const POST = '/writing/fixture-measure-first/';
const TOUR = '/writing/fixture-markdown-tour/';
const NEWEST_FIRST = [
  '/notes/fixture-trailing-slashes/',
  '/writing/fixture-measure-first/',
  '/writing/fixture-retries-and-back-off/',
  '/writing/fixture-markdown-tour/',
  '/notes/fixture-small-note/',
];

test('/rss.xml parses as XML in the browser: RSS 2.0, five items, served as XML', async ({
  page,
  request,
}) => {
  const response = await request.get('/rss.xml');
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toMatch(/xml/);
  const xml = await response.text();
  await page.goto('/');
  const parsed = await page.evaluate((text) => {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    return {
      error: doc.querySelector('parsererror')?.textContent ?? null,
      root: doc.documentElement.nodeName,
      version: doc.documentElement.getAttribute('version'),
      items: [...doc.querySelectorAll('channel > item')].map((item) => ({
        title: item.querySelector('title')?.textContent,
        link: item.querySelector('link')?.textContent,
        description: item.querySelector('description')?.textContent,
      })),
    };
  }, xml);
  expect(parsed.error).toBeNull();
  expect(parsed.root).toBe('rss');
  expect(parsed.version).toBe('2.0');
  expect(parsed.items.map((i) => new URL(i.link ?? '').pathname)).toEqual(NEWEST_FIRST);
  // The parser undid the XML escaping: the title reads as written, and the description is HTML.
  expect(parsed.items[2]?.title).toBe('Retries & back-off, or why "later" beats "now"');
  expect(parsed.items[2]?.description).toContain('p99 &lt; 2 s');
});

test('a reader finds the feed from any page: <head> names it, and the footer links it', async ({
  page,
}) => {
  for (const path of WRITING_FIXTURE_PAGES) {
    await page.goto(path);
    await expect(page.locator('link[rel="alternate"][type="application/rss+xml"]')).toHaveAttribute(
      'href',
      '/rss.xml',
    );
    await expect(page.locator('.footer-links a[href="/rss.xml"]')).toHaveText('RSS');
  }
});

test('the footer lists pages first, then the checked profiles (content.md)', async ({ page }) => {
  await page.goto('/');
  const labels = await page.locator('.footer-links a').allTextContents();
  expect(labels[0]).toBe('RSS');
  expect(labels.slice(1)).toEqual(expect.arrayContaining(['LinkedIn']));
});

test('the draft is not served: production builds no page for it', async ({ request }) => {
  const response = await request.get('/notes/fixture-unfinished-thought/', { maxRedirects: 0 });
  expect(response.status()).toBe(404);
});

test('a post page carries the security headers and revalidates, like every page', async ({
  request,
}) => {
  const response = await request.get(POST, { maxRedirects: 0 });
  expect(response.status()).toBe(200);
  const headers = response.headers();
  for (const [name, value] of Object.entries(SECURITY_HEADERS))
    expect(headers[name], name).toBe(value);
  expect(headers['cache-control']).toBe(REVALIDATE);
});

test('at 320 px code blocks and tables wrap instead of scrolling the page or themselves', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 640 });
  for (const [path, selector, count] of [
    [POST, '.prose pre', 1],
    [TOUR, '.prose pre', 1],
    [TOUR, '.prose table', 2],
  ] as const) {
    await page.goto(path);
    const boxes = page.locator(selector);
    await expect(boxes).toHaveCount(count);
    for (const box of await boxes.all()) {
      await expect(box).toBeVisible();
      const sizes = await box.evaluate((element) => ({
        scroll: element.scrollWidth,
        client: element.clientWidth,
        // A table grows to fit its cells, so its own scroll width proves nothing: compare it with
        // the column it sits in.
        overhang:
          element.getBoundingClientRect().right -
          (element.closest('.prose')?.getBoundingClientRect().right ?? 0),
        page: document.documentElement.scrollWidth - window.innerWidth,
      }));
      expect(sizes.scroll, `${path} ${selector}`).toBeLessThanOrEqual(sizes.client);
      expect(sizes.overhang, `${path} ${selector}: wider than its column`).toBeLessThanOrEqual(0.5);
      expect(sizes.page, `${path}: the page scrolls sideways`).toBeLessThanOrEqual(0);
    }
  }
});

test("known answer: the tour's wide table needs the cell rule, so the check above exercises it", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto(TOUR);
  // Undo global.css's overflow-wrap: anywhere on the cells, through the CSSOM, which the policy
  // allows: without the rule the commit ids cannot break, and the table overhangs its column.
  const overhang = await page
    .locator('.prose table')
    .last()
    .evaluate((table) => {
      for (const cell of table.querySelectorAll<HTMLElement>('th, td'))
        cell.style.overflowWrap = 'normal';
      const column = table.closest('.prose')?.getBoundingClientRect().right ?? 0;
      return table.getBoundingClientRect().right - column;
    });
  expect(overhang).toBeGreaterThan(50);
});

test("a footnote's way back works, and the footnotes' heading is for assistive technology only", async ({
  page,
}) => {
  await page.goto(TOUR);
  const heading = page.locator('#footnote-label');
  await expect(heading).toHaveText('Footnotes');
  const box = await heading.boundingBox();
  expect((box?.width ?? 0) * (box?.height ?? 0)).toBeLessThanOrEqual(1);
  await page.locator('[data-footnote-ref]').first().click();
  await expect(page).toHaveURL(/#user-content-fn-measure$/);
  await page.locator('.data-footnote-backref').first().click();
  await expect(page).toHaveURL(/#user-content-fnref-measure$/);
  await expect(page.locator('.data-footnote-backref').first()).toHaveText('↑');
});

// The measure (tokens.css, --measure): about 68 characters a line of English at 16 px. A paragraph
// of ordinary prose is set in the post's own column and its lines counted, so the rule is checked
// in the face and size a reader gets, not computed from a unit.
test('a line of body text holds about 68 characters at 1440 px', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(POST);
  await page.evaluate(() => document.fonts.ready);
  const lines = await page.evaluate(() => {
    const p = document.createElement('p');
    p.textContent =
      'Most of the time went to one call that ran once per file. A cache in front of it would ' +
      'have hidden the cost instead of removing it, and the next person to read the code would ' +
      'have had two problems: the slow call, and a cache whose invalidation nobody could explain. ' +
      'So the plan changed before any code was written, and the change was smaller than the cache ' +
      'would have been. Measuring first is cheap; building the wrong thing is not.';
    document.querySelector('.prose')?.prepend(p);
    const text = p.firstChild as Text;
    const range = document.createRange();
    const counts = new Map<number, number>();
    for (let i = 0; i < text.length; i++) {
      range.setStart(text, i);
      range.setEnd(text, i + 1);
      const top = Math.round(range.getBoundingClientRect().top);
      counts.set(top, (counts.get(top) ?? 0) + 1);
    }
    return [...counts.values()];
  });
  const full = lines.slice(0, -1); // the last line is as short as the paragraph leaves it
  expect(full.length).toBeGreaterThan(3);
  const average = full.reduce((sum, n) => sum + n, 0) / full.length;
  expect(average).toBeGreaterThan(60);
  expect(average).toBeLessThan(75);
  for (const n of full) expect(n).toBeLessThanOrEqual(80); // WCAG 2.2 SC 1.4.8 asks for 80 at most
});

test("Home lists the three latest posts, /writing/ all five, and a post's way back works", async ({
  page,
}) => {
  await page.goto('/');
  const home = await page
    .locator('#writing a')
    .evaluateAll((anchors) => anchors.map((a) => (a as HTMLAnchorElement).pathname));
  expect(home).toEqual([...NEWEST_FIRST.slice(0, 3), '/writing/', '/rss.xml']);
  await page.goto('/writing/');
  const all = await page
    .locator('.post-title a')
    .evaluateAll((anchors) => anchors.map((a) => (a as HTMLAnchorElement).pathname));
  expect(all).toEqual(NEWEST_FIRST);
  await page.goto(POST);
  await page.getByRole('link', { name: 'All writing' }).click();
  await expect(page).toHaveURL(/\/writing\/$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Writing');
});
