import { expect, test } from '@playwright/test';
import { pages } from './expected';

// The site as an index (ADR 0022): a row of an index opens its page wherever it is pressed, the
// rail lists every demo and marks the one on screen, and no page scrolls on past its own end.

const LISTS = ['/', '/lab/', '/writing/', '/notes/'];

for (const path of LISTS) {
  test(`${path}: a press on a row's empty space opens the page its link names`, async ({
    page,
  }) => {
    test.skip(!pages().includes(path), `this build has no ${path}`);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(path);
    // The first row that opens a page on this site: a project's card opens its repository.
    const rows = page.locator(
      'main :is(.card:has(.card-more[href^="/"]), .post-list > li:has(.post-title > a[href^="/"]))',
    );
    test.skip((await rows.count()) === 0, `${path} lists no row`);
    const row = rows.first();
    const href = await row.locator(':is(.card-more, .post-title > a)').getAttribute('href');
    await row.scrollIntoViewIfNeeded();
    const box = await row.boundingBox();
    if (!box) throw new Error(`${path}: the row is not drawn`);
    // The row's foot, at its start: its padding, under none of its words, where only the link's
    // stretched box can answer a press.
    const at = { x: box.x + 4, y: box.y + box.height - 4 };
    expect(
      await page.evaluate(
        ({ x, y }) => document.elementFromPoint(x, y)?.closest('a')?.getAttribute('href') ?? null,
        at,
      ),
    ).toBe(href);
    await page.mouse.click(at.x, at.y);
    await page.waitForURL(`**${href}`);
  });
}

test('the rail lists every demo under Lab, and marks the one on screen', async ({ page }) => {
  const demos = pages().filter((path) => /^\/lab\/[^/]+\/$/.test(path));
  test.skip(demos.length === 0, 'this build has no demo');
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const demo of demos) {
    await page.goto(demo);
    const leaves = page.locator('.site-nav a[href="/lab/"] + .nav-leaves a');
    expect(
      (await leaves.evaluateAll((links) => links.map((a) => a.getAttribute('href')))).sort(),
    ).toEqual([...demos].sort());
    await expect(leaves.and(page.locator('[aria-current="page"]'))).toHaveAttribute('href', demo);
    await expect(page.locator('.site-nav a[href="/lab/"]')).toHaveAttribute('aria-current', 'true');
  }
  // Below 80rem the header is the row across the top, with its items alone.
  await page.setViewportSize({ width: 1024, height: 900 });
  await expect(page.locator('.nav-leaves').first()).toBeHidden();
});

// The page's drawing is 900 px tall; on a page shorter than that it reached past the body, and the
// window scrolled on into nothing, beyond the rail and the footer (2026-10-29, /lab/ at 1512 × 737).
for (const { width, height } of [
  { width: 1512, height: 737 },
  { width: 390, height: 844 },
]) {
  test(`at ${width} × ${height} no page scrolls past its own end`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    for (const path of pages()) {
      await page.goto(path);
      const { document: whole, body } = await page.evaluate(() => ({
        document: document.documentElement.scrollHeight,
        body: Math.ceil(document.body.getBoundingClientRect().height),
      }));
      expect(whole, path).toBeLessThanOrEqual(body);
    }
  });
}
