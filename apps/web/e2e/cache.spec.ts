import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// The Cache Lab in a browser: without JavaScript the page is the opening run the build drew, with
// no control; with it, nothing moves or loads until the visitor shows intent, the simulation takes
// over at the picture's exact moment and runs only between Run and Pause. Each of the entry's
// "Three things to try" plays here as it is written, with its seeds, times and numbers: the menu's
// stampede and the two switches that tame it, the flush at the morning rush and the two that
// spread its expiries, a lost node on the hash circle and by modulo, and a write with invalidation
// off. Under reduced motion it advances in still steps, a link opens a seed, and the page meets axe
// after script redrew it.

const CACHE = '/lab/cache/';
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const OPENING =
  '1,500 reads in 5.0 s, 94.3% from the cache. When the menu expired at 3.0 s, the database fetched it 23 times at once and 2 reads timed out.';
const TAMED =
  '1,515 reads in 5.0 s, 99.9% from the cache. No page was fetched twice at once and no reader timed out.';

const summary = (page: Page) => page.locator('[data-cl-summary]');
const words = (page: Page, id: string) =>
  page.locator(`[data-cl-prop="${id}"] [data-cl-prop-words]`);
const said = (page: Page) => page.locator('[data-cl-said]');
const waiting = (page: Page) => page.locator('[data-cl-waiting]');
const press = (page: Page, name: string) => page.getByRole('button', { name, exact: true }).click();
const choose = (page: Page, name: string) => page.getByRole('radio', { name, exact: true }).check();

/** Virtual seconds on the clock. */
const seconds = async (page: Page) =>
  Number(
    /([\d.]+) s/.exec((await page.locator('[data-cl-clock]').textContent()) ?? '')?.[1] ?? NaN,
  );

/** Collects policy violations the page reports. */
async function watch(page: Page): Promise<() => Promise<string[]>> {
  await page.addInitScript(() => {
    const seen: string[] = [];
    Object.defineProperty(window, '__cspViolations', { value: seen });
    document.addEventListener('securitypolicyviolation', (event) => {
      seen.push(`${event.effectiveDirective} blocked ${event.blockedURI || 'inline'}`);
    });
  });
  return () =>
    page.evaluate(() => (window as unknown as { __cspViolations: string[] }).__cspViolations);
}

/** Runs at the quick speed until the page says `done`, checking every animation frame, then
 *  pauses. The run is the same whatever the frames: only where it stops can differ. */
async function runUntil(page: Page, done: () => boolean): Promise<void> {
  await choose(page, 'Quick');
  await press(page, 'Run');
  await page.waitForFunction(done, undefined, { polling: 'raf', timeout: 45_000 });
  await press(page, 'Pause');
}

test('without JavaScript, the page is the opening run: the menu’s stampede told, four nodes, no control', async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(CACHE);
  await expect(summary(page)).toHaveText(OPENING);
  await expect(page.locator('[data-cl-node]')).toHaveCount(4);
  await expect(page.locator('[data-cl-node][data-up="true"]')).toHaveCount(4);
  // Every page has its lamp on the node that holds it, and the menu its words: fresh until 12.5 s,
  // since each fetch of the herd stored it again as it came back, the last at 4.483 s.
  await expect(page.locator('.cl-pages .cl-lamp')).toHaveCount(120);
  await expect(page.locator('[data-cl-menu]')).toHaveText('Menu, fresh until 12.5 s');
  await expect(page.locator('.cl-conn')).toHaveCount(8);
  await expect(waiting(page)).toHaveText('0');
  await expect(words(page, 'one-fetch')).toHaveText(
    'Broken 40 times, at worst 23 fetches of one page at once',
  );
  await expect(words(page, 'no-timeouts')).toHaveText('Broken: 2 reads timed out');
  await expect(words(page, 'fresh')).toHaveText('Held');
  await expect(page.locator('[data-cl-prop][data-held="false"]')).toHaveCount(2);
  await expect(page.locator('.cl-panel')).toBeHidden();
  const controls = await page.evaluate(
    () =>
      [...document.querySelectorAll<HTMLElement>('#cache-lab button, #cache-lab input')].filter(
        (e) => e.checkVisibility(),
      ).length,
  );
  expect(controls).toBe(0);
  await context.close();
});

test('nothing loads or moves before intent; Run plays, Pause stops, with no policy violation', async ({
  page,
}) => {
  const violations = await watch(page);
  const app: string[] = [];
  page.on('request', (r) => /\/_astro\/app\./.test(r.url()) && app.push(r.url()));
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto(CACHE);
  await page.waitForTimeout(300);
  expect(app).toEqual([]);
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);

  expect(await seconds(page)).toBe(5);
  await press(page, 'Run');
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
  expect(app).toHaveLength(1);
  await expect.poll(() => seconds(page), { timeout: 5_000 }).toBeGreaterThan(5.02);
  await press(page, 'Pause');
  const paused = await seconds(page);
  await page.waitForTimeout(400);
  expect(await seconds(page)).toBe(paused);
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
  expect(await violations()).toEqual([]);
});

test('let the menu expire: 23 fetches at once and two timeouts, then coalescing and serving stale tame it on the same seed', async ({
  page,
}) => {
  await page.goto(CACHE);
  await expect(summary(page)).toHaveText(OPENING);
  const log = page.locator('[data-cl-lines]');
  await expect(log).toContainText('The menu now has 20 fetches in flight at once');
  await expect(log).toContainText('A reader of the menu gave up after waiting 1,000 ms');

  await press(page, 'Coalesce misses');
  await press(page, 'Serve stale while refreshing');
  await press(page, 'Start over');
  await expect(summary(page)).toHaveText(TAMED);
  await expect(said(page)).toHaveText(TAMED);
  for (const id of ['one-fetch', 'no-timeouts', 'fresh'])
    await expect(words(page, id)).toHaveText('Held');
  // One fetch refreshes the menu; its readers take the old copy meanwhile, and none waits a second.
  await expect(log).toContainText(
    "The menu's entry expired at 3.000 s: its readers still get it at once, while one fetch refreshes it",
  );
  await expect(log).not.toContainText('fetched twice at once');
  await expect(log).not.toContainText('gave up');
  // Start over plays the same readers again, with the switches as the visitor left them.
  expect(new URL(page.url()).hash).toBe('#seed-7');
  for (const name of ['Coalesce misses', 'Serve stale while refreshing'])
    await expect(page.getByRole('button', { name, exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
});

test('flush every node at the morning rush: the database falls behind, and the overload comes back with the expiries', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto(CACHE);
  await choose(page, 'Morning');
  await press(page, 'Flush every node');
  await expect(said(page)).toHaveText(
    'The cache is flushed: every node is empty, and the pages fetched again now will expire together',
  );
  await expect(page.locator('[data-cl-readers]')).toHaveText('Readers, 600 a second');
  // The cold start: every connection busy and hundreds of fetches in line.
  await runUntil(
    page,
    () => Number(document.querySelector('[data-cl-waiting]')?.textContent) > 200,
  );
  await expect(page.locator('.cl-conn[data-state="busy"]')).toHaveCount(8);
  expect(await seconds(page)).toBeLessThan(6.5);
  // Ten seconds on, the pages fetched together expire together, and the line forms again.
  await runUntil(page, () => {
    const at = Number(
      /([\d.]+) s/.exec(document.querySelector('[data-cl-clock]')?.textContent ?? '')?.[1],
    );
    return at > 12 && Number(document.querySelector('[data-cl-waiting]')?.textContent) >= 50;
  });
  expect(await seconds(page)).toBeLessThan(20);
  await expect(words(page, 'no-timeouts')).toHaveText(/^Broken: [\d,]{3,} reads timed out$/);
});

test('turn on jitter and early refresh before the flush, and the expiries spread out: no second wave', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto(CACHE);
  await choose(page, 'Morning');
  await press(page, 'Jitter expiry times');
  await press(page, 'Refresh early');
  await press(page, 'Flush every node');
  await expect(said(page)).toHaveText(
    'The cache is flushed: every node is empty, and each page misses until it is fetched again',
  );
  // From 11 s to 26 s, the most fetches ever waiting at once, read on every frame.
  await page.evaluate(() =>
    Object.defineProperty(window, '__most', { value: [0], writable: true }),
  );
  await runUntil(page, () => {
    const at = Number(
      /([\d.]+) s/.exec(document.querySelector('[data-cl-clock]')?.textContent ?? '')?.[1],
    );
    const most = (window as unknown as { __most: number[] }).__most;
    if (at > 11)
      most[0] = Math.max(
        most[0] ?? 0,
        Number(document.querySelector('[data-cl-waiting]')?.textContent),
      );
    return at >= 26;
  });
  const most = await page.evaluate(() => (window as unknown as { __most: number[] }).__most[0]);
  // Fewer than the pool's eight: the line never forms again.
  expect(most).toBeLessThan(8);
});

test('lose a node: the circle moves only its quarter of the pages, modulo about three quarters', async ({
  page,
}) => {
  await page.goto(CACHE);
  const first = page.locator('[data-cl-lose="0"]');
  await expect(first).toHaveAccessibleName('Lose node 1, now up, 28 pages');
  await first.click();
  await expect(said(page)).toHaveText(
    'Node 1 is lost with everything it held: 28 of 120 pages now live on another node',
  );
  await expect(page.locator('[data-cl-node="0"]')).toHaveAttribute('data-up', 'false');
  await expect(page.locator('[data-cl-node="0"] [data-cl-node-words]')).toHaveText('Down');
  await expect(first).toHaveAccessibleName('Restore node 1, now down');
  // Those 28 pages land on the other three nodes, empty.
  await expect(page.locator('.cl-pages .cl-lamp[data-state="missing"]')).toHaveCount(28);
  await first.click();
  await expect(said(page)).toHaveText(
    'Node 1 is back, empty: 28 of 120 pages now live on a different node',
  );

  await page.goto(CACHE);
  await choose(page, 'Modulo');
  await expect(said(page)).toHaveText(
    'Pages are now placed by their hash modulo the live nodes: 93 of 120 move to another node',
  );
  await page.locator('[data-cl-lose="0"]').click();
  await expect(said(page)).toHaveText(
    'Node 1 is lost with everything it held: 85 of 120 pages now live on another node',
  );
});

test('write to the menu with invalidation off: readers get the old version until it expires, and each is counted', async ({
  page,
}) => {
  await page.goto(CACHE);
  await press(page, 'Invalidate on write');
  await expect(page.getByRole('button', { name: 'Invalidate on write' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await press(page, 'Write to the menu');
  await expect(said(page)).toHaveText(
    'The menu changes to version 2, but the cache serves version 1 until it expires at 12.483 s',
  );
  await expect(page.locator('[data-cl-menu]')).toHaveText(
    'Menu, fresh until 12.5 s, still version 1',
  );
  await runUntil(page, () =>
    /^Broken: [\d,]+ reads/.test(
      document.querySelector('[data-cl-prop="fresh"] [data-cl-prop-words]')?.textContent ?? '',
    ),
  );
  await expect(words(page, 'fresh')).toHaveText(
    /^Broken: [\d,]+ reads?, the worst [\d,]+ ms out of date$/,
  );
});

test('under reduce, Run advances in steps of 100 virtual ms, and nothing animates', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(CACHE);
  await press(page, 'Run');
  await expect.poll(() => seconds(page), { timeout: 3_000 }).toBeGreaterThan(5);
  await press(page, 'Pause');
  const moved = Math.round(((await seconds(page)) - 5) * 1000);
  expect(moved % 100).toBe(0);
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
});

test('a link to a run opens it: #seed-8 loads that seed with no other intent, and Start over keeps it', async ({
  page,
}) => {
  await page.goto(`${CACHE}#seed-8`);
  await expect(page.locator('[data-cl-clock]')).toHaveText('Virtual time 5.000 s, seed 8');
  await expect(summary(page)).not.toHaveText(OPENING);
  await expect(summary(page)).toHaveText(/When the menu expired at 3\.0 s/);
  await press(page, 'Start over');
  await expect(page.locator('[data-cl-clock]')).toHaveText('Virtual time 5.000 s, seed 8');
  expect(new URL(page.url()).hash).toBe('#seed-8');
});

for (const colorScheme of ['light', 'dark'] as const) {
  test(`axe finds no violation after a run, ${colorScheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    await page.goto(CACHE);
    await press(page, 'Coalesce misses');
    await page.locator('[data-cl-lose="1"]').click();
    await choose(page, 'Morning');
    await press(page, 'Next event');
    const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  });
}
