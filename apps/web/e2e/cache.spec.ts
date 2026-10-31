import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// The Cache Lab in a browser: without JavaScript the page is the opening run the build drew, with
// no control; with it, nothing moves or loads until the visitor shows intent, the simulation takes
// over at the picture's exact moment and runs only between Run and Pause. Each of the entry's
// "Three things to try" plays here as it is written, with its seeds, times and numbers: the menu's
// stampede, played live from just before it, and the two switches that tame it, the flush at the
// morning rush and the two that spread its expiries, a lost node on the hash circle and by modulo,
// and a write with invalidation off. Under reduced motion it advances in still steps, a link opens
// a run with its switches, a page's lamps differ in shape, and the page meets axe after script
// redrew it.

const CACHE = '/lab/cache/';
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const OPENING =
  '1,500 reads in 5.0 s, 94.3% from the cache. When the menu expired at 3.0 s, the database fetched it 23 times at once and 2 reads timed out.';
const TAMED =
  '1,515 reads in 5.0 s, 99.9% from the cache. No page was fetched twice at once and no reader timed out.';
/** The picture's own name at the opening: what its parts show, not the caption's account. */
const MAP =
  'Readers, 300 a second, four cache nodes and the database. The nodes’ pages: 96 fresh, 23 expired, 0 missing and 1 being fetched. Menu, fresh until 12.5 s. The database: 1 of 8 connections busy and 0 fetches waiting.';

const summary = (page: Page) => page.locator('[data-cl-summary]');
const words = (page: Page, id: string) =>
  page.locator(`[data-cl-prop="${id}"] [data-cl-prop-words]`);
const said = (page: Page) => page.locator('[data-cl-said]');
const waiting = (page: Page) => page.locator('[data-cl-waiting]');
const clock = (page: Page) => page.locator('[data-cl-clock]');
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
  // The picture is named by what it shows, and the caption tells the run: neither repeats the
  // other. The strip's hollow bars have their key.
  await expect(page.getByRole('img', { name: MAP, exact: true })).toBeVisible();
  await expect(page.locator('[data-cl-map]')).not.toHaveAttribute('aria-labelledby', /./);
  await expect(page.locator('.cl-strip-key')).toHaveText('Reads still waiting');
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
  // The picture tells a stampede that has happened, so Run plays it from half a second before.
  await press(page, 'Run');
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
  expect(app).toHaveLength(1);
  await expect.poll(() => seconds(page), { timeout: 5_000 }).toBeGreaterThan(2.52);
  expect(await seconds(page)).toBeLessThan(5);
  await press(page, 'Pause');
  const paused = await seconds(page);
  await page.waitForTimeout(400);
  expect(await seconds(page)).toBe(paused);
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
  expect(await violations()).toEqual([]);
});

test('let the menu expire: the first run plays it, 23 fetches at once and two timeouts, then coalescing and serving stale tame it on the same seed', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.goto(CACHE);
  await expect(summary(page)).toHaveText(OPENING);
  const log = page.locator('[data-cl-lines]');
  await expect(log).toContainText('The menu now has 20 fetches in flight at once');
  await expect(log).toContainText('A reader of the menu gave up after waiting 1,000 ms');
  // The log names no expiry the picture contradicts: the herd's later fetches store it again.
  await expect(log).toContainText(
    'The menu is cached again as version 1; 22 more fetches of it are in flight, and each that comes back stores it again',
  );

  // The first run plays the stampede live, from half a second before the menu expires: every
  // connection lit, the menu fetched many times at once, and a line waiting beside the lamps.
  await runUntil(
    page,
    () =>
      document.querySelectorAll('.cl-conn[data-state="busy"]').length === 8 &&
      Number(document.querySelector('[data-cl-waiting]')?.textContent) >= 5,
  );
  const herd = await seconds(page);
  expect(herd).toBeGreaterThan(3);
  expect(herd).toBeLessThan(4.5);
  await expect(page.locator('[data-cl-menu]')).toHaveText(/^Menu, \d+ fetches at once$/);
  await runUntil(page, () =>
    /Virtual time ([5-9]|\d\d)\./.test(
      document.querySelector('[data-cl-clock]')?.textContent ?? '',
    ),
  );
  await expect(summary(page)).toHaveText(
    /When the menu expired at 3\.0 s, the database fetched it 23 times at once and 2 reads timed out\.$/,
  );

  // Turn on coalescing and serving stale, and start over: the same seed, from the same moment.
  await press(page, 'Coalesce misses');
  await press(page, 'Serve stale while refreshing');
  // A switch alone writes nothing: the link names how a run starts.
  expect(new URL(page.url()).hash).toBe('');
  const first = await page.evaluate(() => history.length);
  await press(page, 'Start over');
  await expect(clock(page)).toHaveText('Virtual time 2.500 s, 780 events, seed 7');
  // Start over writes the link with history.replaceState: no new entry in the history.
  expect(await page.evaluate(() => history.length)).toBe(first);
  await expect(said(page)).toHaveText(
    'Virtual time 2.500 s, 780 events, seed 7. Menu, fresh until 3.0 s.',
  );
  const restarted = [await summary(page).textContent(), await waiting(page).textContent()];
  await runUntil(page, () =>
    /Virtual time ([5-9]|\d\d)\./.test(
      document.querySelector('[data-cl-clock]')?.textContent ?? '',
    ),
  );
  await expect(summary(page)).toHaveText(
    /from the cache\. No page was fetched twice at once and no reader timed out\.$/,
  );
  for (const id of ['one-fetch', 'no-timeouts', 'fresh'])
    await expect(words(page, id)).toHaveText('Held');
  // One fetch refreshes the menu; its readers take the old copy meanwhile, and none waits a second.
  await expect(log).toContainText(
    "The menu's entry expired at 3.000 s: its readers still get it at once, while one fetch refreshes it",
  );
  await expect(log).not.toContainText('fetched twice at once');
  await expect(log).not.toContainText('gave up');

  // The address names the run, switches and all, so a reload, or the link shared, opens it again
  // at the picture's moment: the tamed run, not the opening.
  expect(new URL(page.url()).hash).toBe('#seed-7&coalesce=on&stale=on');
  await page.reload();
  await expect(clock(page)).toHaveText('Virtual time 5.000 s, 1,613 events, seed 7');
  await expect(summary(page)).toHaveText(TAMED);
  for (const name of ['Coalesce misses', 'Serve stale while refreshing'])
    await expect(page.getByRole('button', { name, exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  // It is the run Start over played: started over again, it stands where that one stood.
  const entries = await page.evaluate(() => history.length);
  await press(page, 'Start over');
  await expect(clock(page)).toHaveText('Virtual time 2.500 s, 780 events, seed 7');
  // The address names the run and replaces itself: no new entry in the history.
  expect(await page.evaluate(() => history.length)).toBe(entries);
  expect([await summary(page).textContent(), await waiting(page).textContent()]).toEqual(restarted);
  expect(new URL(page.url()).hash).toBe('#seed-7&coalesce=on&stale=on');
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

test('under reduce, Run advances in still steps of half a second of the chosen speed, and nothing animates', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(CACHE);
  // Run plays the stampede from 2.5 s, in still steps.
  await press(page, 'Run');
  await expect(clock(page)).toHaveText('Virtual time 2.500 s, 789 events, seed 7');
  await press(page, 'Pause');
  // Every time the clock shows, as it changes: a step the test did not sample cannot hide.
  await page.evaluate(() => {
    const shown = document.querySelector('[data-cl-clock]');
    const seen: string[] = [];
    Object.defineProperty(window, '__clockSeen', { value: seen });
    if (shown)
      new MutationObserver(() => seen.push(shown.textContent ?? '')).observe(shown, {
        childList: true,
        characterData: true,
        subtree: true,
      });
  });
  /** Runs until the clock has moved a few steps, then pauses: the steps it took, in virtual ms. */
  const steps = async (span: number) => {
    const from = await clock(page).textContent();
    await page.evaluate(() => {
      (window as unknown as { __clockSeen: string[] }).__clockSeen.length = 0;
    });
    const before = await seconds(page);
    await press(page, 'Run');
    await expect.poll(() => seconds(page), { timeout: 3_000 }).toBeGreaterThan(before + span);
    await press(page, 'Pause');
    const seen = await page.evaluate(
      () => (window as unknown as { __clockSeen: string[] }).__clockSeen,
    );
    const ms = [from, ...seen].map((text) =>
      Math.round(Number(/([\d.]+) s/.exec(text ?? '')?.[1]) * 1000),
    );
    return ms.slice(1).map((at, i) => at - (ms[i] as number));
  };
  // At Steady, 0.5 virtual seconds a second: steps of 250 virtual ms.
  const steady = await steps(0.6);
  expect(steady.length).toBeGreaterThan(2);
  expect(new Set(steady)).toEqual(new Set([250]));
  // At Slow, a fifth as fast: steps of 50, so the choice changes the steps as it changes a run.
  await choose(page, 'Slow');
  const slow = await steps(0.12);
  expect(slow.length).toBeGreaterThan(2);
  expect(new Set(slow)).toEqual(new Set([50]));
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
});

test('Next event says where the run stands when the log has nothing to tell, and the clock counts the events', async ({
  page,
}) => {
  await page.goto(CACHE);
  await expect(clock(page)).toHaveText('Virtual time 5.000 s, 1,704 events, seed 7');
  const heard: string[] = [];
  for (let i = 0; i < 5; i++) {
    await press(page, 'Next event');
    await expect(said(page)).not.toHaveText(heard.at(-1) ?? '');
    heard.push((await said(page).textContent()) ?? '');
  }
  // Each press is heard and says something new, even two moments in one millisecond, since the
  // events counted differ: the clock says the same, less its seed.
  expect(new Set(heard).size).toBe(heard.length);
  const last = heard.at(-1) ?? '';
  expect(last).toMatch(/^Virtual time 5\.\d{3} s, 1,7\d\d events$/);
  await expect(clock(page)).toHaveText(`${last}, seed 7`);
});

test('a link to a run opens it: #seed-8 loads that seed with no other intent, and Start over plays it from 2.5 s', async ({
  page,
}) => {
  await page.goto(`${CACHE}#seed-8`);
  await expect(summary(page)).not.toHaveText(OPENING);
  await expect(summary(page)).toHaveText(/When the menu expired at 3\.0 s/);
  await expect(clock(page)).toHaveText('Virtual time 5.000 s, 1,702 events, seed 8');
  await press(page, 'Start over');
  await expect(clock(page)).toHaveText('Virtual time 2.500 s, 813 events, seed 8');
  expect(new URL(page.url()).hash).toBe('#seed-8');
});

test('a link followed before the app has loaded loads it, and opens that run with its settings', async ({
  page,
}) => {
  const app: string[] = [];
  page.on('request', (r) => /\/_astro\/app\./.test(r.url()) && app.push(r.url()));
  await page.goto(CACHE);
  await page.waitForTimeout(300);
  expect(app).toEqual([]);
  // The boot script hears the link and loads the app, which opens the run the link names.
  await page.evaluate(() => (location.hash = '#seed-9&load=morning'));
  await expect(clock(page)).toHaveText('Virtual time 5.000 s, 3,167 events, seed 9');
  await expect(page.getByRole('radio', { name: 'Morning', exact: true })).toBeChecked();
  expect(app).toHaveLength(1);
});

test('a link names a run’s switches, load and placement; followed on the page it opens that run paused, and a value the lab cannot take is left out', async ({
  page,
}) => {
  await page.goto(`${CACHE}#seed-7&coalesce=on&stale=on`);
  await expect(summary(page)).toHaveText(TAMED);
  // Followed on the page while a run plays: that run, paused at the picture's moment.
  await choose(page, 'Quick');
  await press(page, 'Run');
  await expect.poll(() => seconds(page)).toBeGreaterThan(2.6);
  const open = (hash: string) => page.evaluate((link) => (location.hash = link), hash);
  await open('#seed-9&load=morning&placement=modulo&invalidate=off');
  await expect(clock(page)).toHaveText('Virtual time 5.000 s, 3,167 events, seed 9');
  await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Coalesce misses' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await expect(page.getByRole('radio', { name: 'Morning', exact: true })).toBeChecked();
  await expect(page.getByRole('radio', { name: 'Modulo', exact: true })).toBeChecked();
  await expect(page.getByRole('button', { name: 'Invalidate on write' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  // A load the lab does not have, a switch's word it does not know and a name it lacks are left
  // out: the run is seed 9's under the opening's settings, as the bare link gives it. It is
  // followed from another seed's run under other settings, so a page that ignored it would show
  // that run instead.
  await open('#seed-9');
  await expect(page.getByRole('radio', { name: 'Busy', exact: true })).toBeChecked();
  const bare = [
    await summary(page).textContent(),
    await page.locator('[data-cl-map]').getAttribute('aria-label'),
  ];
  await open('#seed-12&load=morning&coalesce=on');
  await expect(page.locator('[data-cl-clock]')).toHaveText(/, seed 12$/);
  await expect(page.getByRole('radio', { name: 'Morning', exact: true })).toBeChecked();
  await open('#seed-9&load=rush&coalesce=yes&colour=red');
  await expect(page.locator('[data-cl-readers]')).toHaveText('Readers, 300 a second');
  await expect(page.locator('[data-cl-clock]')).toHaveText(
    'Virtual time 5.000 s, 1,658 events, seed 9',
  );
  await expect(page.getByRole('button', { name: 'Coalesce misses' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  expect([
    await summary(page).textContent(),
    await page.locator('[data-cl-map]').getAttribute('aria-label'),
  ]).toEqual(bare);
});

test('a page’s four lamps differ in shape, not only colour: in both themes and in forced colours', async ({
  page,
}) => {
  // Each lamp's shape as its fill and the drawing over it: filled, half, hollow, a dot in its rim.
  const shapes = (selector: string) =>
    page.locator(selector).evaluateAll((lamps) =>
      lamps.map((lamp) => {
        const style = getComputedStyle(lamp);
        const fill = /^rgba\(.*, 0\)$|^transparent$/.test(style.backgroundColor)
          ? 'hollow'
          : 'filled';
        return `${fill} ${style.backgroundImage.replace(/\(.*$/s, '')}`;
      }),
    );
  for (const media of [
    { colorScheme: 'light' },
    { colorScheme: 'dark' },
    { forcedColors: 'active' },
  ] as const) {
    await page.emulateMedia(media);
    await page.goto(CACHE);
    expect(await shapes('.cl-legend .cl-lamp')).toEqual([
      'filled none',
      'hollow linear-gradient',
      'hollow none',
      'hollow radial-gradient',
    ]);
    // A connection is filled while a fetch runs on it, hollow while it is free.
    expect(new Set(await shapes('.cl-conn[data-state="busy"]'))).toEqual(new Set(['filled none']));
    expect(new Set(await shapes('.cl-conn[data-state="idle"]'))).toEqual(new Set(['hollow none']));
  }
});

test('on a phone, the line waiting stands beside the database’s lamps, and a log line that wraps keeps to its column', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(CACHE);
  const lamps = await page.locator('[data-cl-conns]').boundingBox();
  const count = await page.locator('[data-cl-waiting]').boundingBox();
  expect(lamps && count).toBeTruthy();
  if (!lamps || !count) return;
  expect(count.x).toBeGreaterThanOrEqual(lamps.x + lamps.width);
  expect(count.y).toBeLessThan(lamps.y + lamps.height);
  // Every line's words, wrapped or not, start right of its time.
  const under = await page.locator('[data-cl-lines] li').evaluateAll((items) =>
    items.flatMap((item) => {
      const at = item.querySelector('.cl-at')?.getBoundingClientRect();
      const words = [...item.childNodes].find(
        (node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim() !== '',
      );
      if (!at || !words) return [`no time or words: ${item.textContent}`];
      const range = document.createRange();
      range.selectNodeContents(words);
      return [...range.getClientRects()]
        .filter((rect) => rect.left < at.right)
        .map(() => item.textContent ?? '');
    }),
  );
  expect(under).toEqual([]);
  // And at least one of them wraps at this width, so the check has a line to hold.
  const wraps = await page
    .locator('[data-cl-lines] li')
    .evaluateAll(
      (items) => items.filter((item) => (item.getClientRects()[0]?.height ?? 0) > 30).length,
    );
  expect(wraps).toBeGreaterThan(0);
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
