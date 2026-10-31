import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// The Queue Lab in a browser (ADR 0026, after ADR 0020's pattern): without JavaScript the page is
// the opening run the build drew, with no control; with it, nothing moves or loads until the
// visitor shows intent, the simulation takes over at the picture's exact moment and runs only
// between Run and Pause; each of the write-up's "Three things to try" plays as it says, with its
// seeds, times and numbers; under reduced motion Run moves in still steps; and the page meets axe
// after a run, since script redrew it.

const QUEUE = '/lab/queue/';
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const OPENING_STORY =
  'Order 18 was printed twice: worker 2 crashed after printing its ticket and before its ack left, so the broker sent it again and worker 1 printed it a second time. Nothing was lost; 25 orders are done and 13 are queued or with a worker.';

const clock = (page: Page) => page.locator('[data-qu-clock]');
const summary = (page: Page) => page.locator('[data-qu-summary]');
const status = (page: Page) => page.locator('[data-qu-status]');
const log = (page: Page) => page.locator('[data-qu-lines]');
/** The picture the page shows at this width: the wide one on a laptop. */
const map = (page: Page) => page.locator('[data-qu-map="wide"]');
const property = (page: Page, id: string) => page.locator(`[data-qu-prop="${id}"]`);

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

/** Virtual seconds on the clock. */
const seconds = async (page: Page) =>
  Number(/([\d.]+) s/.exec((await clock(page).textContent()) ?? '')?.[1] ?? NaN);

/** Runs at the quick speed until `done` holds, then pauses. */
async function runUntil(page: Page, done: () => Promise<boolean>, timeout = 20_000) {
  await page.getByRole('radio', { name: 'Quick' }).check();
  await page.getByRole('button', { name: 'Run' }).click();
  await expect.poll(done, { timeout }).toBe(true);
  await page.getByRole('button', { name: 'Pause' }).click();
}

test('without JavaScript, the page is the opening run: order 18 printed twice, worker 2 down, no control', async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(QUEUE);
  await expect(summary(page)).toHaveText(OPENING_STORY);
  await expect(status(page)).toHaveText(
    'No order was lost, but 1 order was printed twice. Whether the queue drains is checked once orders stop.',
  );
  // Worker 2's track is hollow and says Down; workers 1 and 3 each light the order in work.
  await expect(map(page).locator('.qu-gap')).toHaveCount(1);
  await expect(map(page).locator('.qu-state')).toHaveText(['Down']);
  await expect(map(page).locator('.qu-slot[data-state="working"]')).toHaveCount(2);
  // Orders 1 to 25 printed, order 18 with a second circle; 11 orders wait in the tank.
  await expect(map(page).locator('.qu-ticket[data-state="printed"]')).toHaveCount(25);
  await expect(map(page).locator('.qu-again')).toHaveCount(1);
  await expect(map(page).locator('.qu-again')).toHaveAttribute('data-order', '18');
  await expect(map(page).locator('.qu-order[data-state="ready"]')).toHaveCount(11);
  for (const [id, held] of [
    ['no-loss', 'true'],
    ['once', 'false'],
    ['drains', 'true'],
  ] as const)
    await expect(property(page, id)).toHaveAttribute('data-held', held);
  await expect(log(page)).toContainText("2.873 s Worker 1 prints order 18's ticket again");
  for (const control of await page.locator('.qu-controls, .qu-clock, .qu-key').all())
    await expect(control).toBeHidden();
  await context.close();
});

test('nothing loads or moves before intent; Run plays, Pause stops, with no policy violation', async ({
  page,
}) => {
  const violations = await watch(page);
  const app: string[] = [];
  page.on('request', (r) => /\/_astro\/app\./.test(r.url()) && app.push(r.url()));
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto(QUEUE);
  await page.waitForTimeout(300);
  expect(app).toEqual([]);
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);

  await expect(summary(page)).toHaveText(OPENING_STORY);
  const opening = await seconds(page);
  expect(opening).toBe(4);
  await page.getByRole('button', { name: 'Run' }).click();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
  expect(app).toHaveLength(1);
  await expect.poll(() => seconds(page), { timeout: 5_000 }).toBeGreaterThan(opening + 0.1);
  await page.getByRole('button', { name: 'Pause' }).click();
  const paused = await seconds(page);
  await page.waitForTimeout(400);
  expect(await seconds(page)).toBe(paused);
  expect(await violations()).toEqual([]);
  // The log the build wrote is the run's, each line once: the app writes it again from the start.
  const lines = await log(page).locator('li').allTextContents();
  expect(lines.length).toBeGreaterThanOrEqual(4);
  expect(new Set(lines).size).toBe(lines.length);
});

test('the first thing to try: worker 2 crashes at 2.4 s and order 18 prints twice; with the key on, Start over prints it once', async ({
  page,
}) => {
  await page.goto(QUEUE);
  await expect(summary(page)).toHaveText(OPENING_STORY);
  for (const line of [
    '2.400 s Worker 2 crashes holding order 18, after its ticket printed and before its ack left.',
    "2.404 s The broker sees worker 2's connection close and puts order 18 back at the head of the queue",
    "2.873 s Worker 1 prints order 18's ticket again: order 18 is printed twice",
  ])
    await expect(log(page)).toContainText(line);

  await page.getByRole('radio', { name: 'On' }).check();
  await page.getByRole('button', { name: 'Start over' }).click();
  await expect(clock(page)).toHaveText('Virtual time 4.000 s');
  await expect(summary(page)).toHaveText(
    /^Order 18 was sent twice and printed once: worker 2 crashed after printing its ticket and before its ack left, so the broker sent it again, and worker 1 found it in the done set and skipped the ticket\. Nothing was lost; 25 orders are done/,
  );
  await expect(log(page)).toContainText(
    '2.873 s Worker 1 finds order 18 in the done set and does not print it again',
  );
  await expect(map(page).locator('.qu-again')).toHaveCount(0);
  await expect(map(page).locator('.qu-ticket[data-order="18"]')).toHaveAttribute(
    'data-state',
    'printed',
  );
  await expect(status(page)).toHaveText(
    /^No order was lost and no order was printed twice over 143 events\. Whether the queue drains is checked once orders stop\.$/,
  );
  // The key is a setting: it stays on for the run that starts over.
  await expect(page.getByRole('radio', { name: 'On' })).toBeChecked();
});

test('the second: switched to acknowledging before the work, a worker crashed at once loses the order it held, never printed', async ({
  page,
}) => {
  await page.goto(QUEUE);
  // Worker 1 holds order 26 and worker 3 order 27, both sent before the switch.
  await page.getByRole('radio', { name: 'Before the work' }).check();
  await expect(log(page)).toContainText(
    'Orders are now acknowledged as they are delivered, before the work: at-most-once. The broker lets go at once of what it has already sent: orders 26 and 27',
  );
  await page.getByRole('button', { name: 'Crash worker 1' }).click();
  await expect(page.locator('[data-qu-said]')).toHaveText(
    'Worker 1 crashes holding order 26. The broker had already let it go, so it is lost',
  );
  await expect(summary(page)).toHaveText(
    /^Order 26 was lost: worker 1 crashed holding it, and it was acknowledged at the switch, before its ticket printed\./,
  );
  await expect(property(page, 'no-loss')).toHaveAttribute('data-held', 'false');
  await expect(property(page, 'no-loss')).toContainText('Broken: 1 order lost');
  // Its ticket never printed: hollow, and crossed.
  await expect(map(page).locator('.qu-ticket[data-order="26"]')).toHaveAttribute(
    'data-state',
    'lost',
  );
  await expect(status(page)).toHaveText(
    '1 order was lost and 1 order was printed twice. Whether the queue drains is checked once orders stop.',
  );
});

test('the third: a poison order, then no more orders: under requeue the queue never drains; dead-lettered after four tries, it drains', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.goto(QUEUE);
  await page.getByRole('button', { name: 'Publish a poison order' }).click();
  await expect(map(page).locator('.qu-order[data-poison]')).toHaveAttribute('data-order', '39');
  await page.getByRole('button', { name: 'Stop taking orders' }).click();
  await expect(page.getByRole('button', { name: 'Take orders' })).toBeVisible();
  // Until the 30 s are up, no line claims the queue drains.
  await expect(status(page)).toHaveText(/Whether the queue drains is checked at 34\.0 s\.$/);
  await runUntil(
    page,
    async () => (await property(page, 'drains').getAttribute('data-held')) === 'false',
  );
  await expect(summary(page)).toHaveText(
    /^The queue did not drain: 1 order was still queued or in flight 30 s after the producer stopped, while poison order 39 kept failing and going back to the head of the queue\./,
  );
  await expect(log(page)).toContainText(
    '34.000 s 30 s after the producer stopped, 1 order was still queued or in flight: the queue does not drain',
  );

  // The same, with dead-lettering: four tries, 200, 400 and 800 ms apart, then the siding.
  await page.getByRole('button', { name: 'Start over' }).click();
  await expect(clock(page)).toHaveText('Virtual time 4.000 s');
  await page.getByRole('radio', { name: 'Dead-letter after four tries' }).check();
  await page.getByRole('button', { name: 'Publish a poison order' }).click();
  await page.getByRole('button', { name: 'Stop taking orders' }).click();
  await runUntil(page, async () => ((await log(page).textContent()) ?? '').includes('it drained'));
  for (const line of [
    '6.233 s Order 39 fails on worker 3, try 1, and waits 200 ms before the next',
    '6.766 s Order 39 fails on worker 1, try 2, and waits 400 ms before the next',
    '7.598 s Order 39 fails on worker 3, try 3, and waits 800 ms before the next',
    '8.737 s Order 39 fails on worker 1, try 4, and goes to the dead-letter queue',
    '8.737 s Nothing is left in the queue or in flight: it drained in 4.7 s',
  ])
    await expect(log(page)).toContainText(line);
  await expect(map(page).locator('.qu-order[data-state="dead"]')).toHaveAttribute(
    'data-order',
    '39',
  );
  await expect(property(page, 'drains')).toHaveAttribute('data-held', 'true');
});

test('while orders still come, a poison order under requeue fails over and over: the caption tells it, and no line claims the queue drains', async ({
  page,
}) => {
  await page.goto(QUEUE);
  await page.getByRole('button', { name: 'Publish a poison order' }).click();
  await runUntil(page, async () =>
    /^Poison order 39 has failed [2-9]/.test((await summary(page).textContent()) ?? ''),
  );
  await expect(summary(page)).toHaveText(
    /^Poison order 39 has failed \d+ times: each time it comes straight back to the head of the queue and keeps a worker busy\./,
  );
  await expect(status(page)).toHaveText(
    'No order was lost, but 1 order was printed twice. Whether the queue drains is checked once orders stop.',
  );
  await expect(property(page, 'drains')).toContainText('Holds; checked once orders stop');
});

test('then a slow worker: with ten orders of prefetch it sits on nine it cannot reach, with one it holds one', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.goto(QUEUE);
  await page.getByRole('radio', { name: '10', exact: true }).check();
  await page.getByRole('button', { name: 'Slow down worker 1' }).click();
  await expect(map(page).locator('.qu-state')).toHaveText(['Slow', 'Down']);
  const waiting = map(page).locator('.qu-slot[data-worker="0"][data-state="waiting"]');
  await runUntil(page, async () => (await waiting.count()) === 9);
  await expect(map(page).locator('.qu-slot[data-worker="0"][data-state="working"]')).toHaveCount(1);

  await page.getByRole('radio', { name: '1', exact: true }).check();
  await page.getByRole('button', { name: 'Start over' }).click();
  await page.getByRole('button', { name: 'Slow down worker 1' }).click();
  await runUntil(page, async () => (await seconds(page)) > 10);
  await expect(waiting).toHaveCount(0);
});

test('and a rush: with three workers up, 14 orders a second outrun them, and the queue grows', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.goto(QUEUE);
  // The note under the loads says what the workers up print: two after the opening's crash.
  const capacity = page.locator('[data-qu-capacity]');
  await expect(capacity).toHaveText('Two workers are up and print about 6.5.');
  await page.getByRole('button', { name: 'Restart worker 2' }).click();
  await expect(capacity).toHaveText('Three workers are up and print about 9.7.');
  await page.getByRole('radio', { name: 'Rush' }).check();
  const waiting = async () =>
    Number(/^(\d+) waiting/.exec((await page.locator('[data-qu-wait]').textContent()) ?? '')?.[1]);
  await runUntil(page, async () => (await seconds(page)) > 20);
  const atTwenty = await waiting();
  expect(atTwenty).toBeGreaterThan(40);
  // More than the tank shows: the picture counts them.
  await expect(map(page).locator('.qu-count', { hasText: /^\d+ waiting$/ })).toHaveCount(1);
  await runUntil(page, async () => (await seconds(page)) > 30);
  expect(await waiting()).toBeGreaterThan(atTwenty);
});

test('a worker’s button crashes it and then restarts it, and says so in its name', async ({
  page,
}) => {
  await page.goto(QUEUE);
  const first = page.locator('[data-qu-crash="0"]');
  await first.click();
  await expect(first).toHaveText('Restart');
  await expect(first).toHaveAccessibleName('Restart worker 1');
  await expect(map(page).locator('.qu-state')).toHaveText(['Down', 'Down']);
  await expect(page.locator('[data-qu-said]')).toHaveText(/^Worker 1 crashes holding order 26\./);
  await first.click();
  await expect(first).toHaveText('Crash');
  await expect(first).toHaveAccessibleName('Crash worker 1');
  await expect(map(page).locator('.qu-state')).toHaveText(['Down']);
});

test('under reduce, Run advances in still steps of half a second, and nothing animates', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(QUEUE);
  const opening = await seconds(page);
  await page.getByRole('button', { name: 'Run' }).click();
  await expect.poll(() => seconds(page), { timeout: 3_000 }).toBeGreaterThan(opening);
  await page.getByRole('button', { name: 'Pause' }).click();
  const moved = Math.round(((await seconds(page)) - opening) * 1000);
  expect(moved % 500).toBe(0);
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
});

/** What the page says of the run it shows: its seed, clock, caption, status line and log. */
const shown = async (page: Page) => [
  await page.locator('[data-qu-seed]').textContent(),
  await clock(page).textContent(),
  await summary(page).textContent(),
  await status(page).textContent(),
  await log(page).locator('li').allTextContents(),
];

test('a link to a run opens it: #seed-8 loads that seed with no other intent, Start over keeps it and the settings', async ({
  page,
}) => {
  await page.goto(`${QUEUE}#seed-8`);
  await expect(page.locator('[data-qu-seed]')).toHaveText('8');
  await page.getByRole('radio', { name: 'On' }).check();
  await page.getByRole('button', { name: 'Start over' }).click();
  await expect(page.locator('[data-qu-seed]')).toHaveText('8');
  await expect(clock(page)).toHaveText('Virtual time 4.000 s');
  await expect(page.getByRole('radio', { name: 'On' })).toBeChecked();
});

test('Start over writes the link to its run, the seed and each setting changed, and a reload opens the same run', async ({
  page,
}) => {
  await page.goto(QUEUE);
  await page.getByRole('radio', { name: 'On' }).check();
  await page.getByRole('radio', { name: 'Rush' }).check();
  await page.getByRole('radio', { name: 'Dead-letter after four tries' }).check();
  // A choice alone writes nothing: the link names how a run starts.
  expect(new URL(page.url()).hash).toBe('');
  const entries = await page.evaluate(() => history.length);
  await page.getByRole('button', { name: 'Start over' }).click();
  await expect(clock(page)).toHaveText('Virtual time 4.000 s');
  // The address names the run and replaces itself: no new entry in the history.
  expect(new URL(page.url()).hash).toBe('#seed-28&load=rush&key=on&handling=dead-letter');
  expect(await page.evaluate(() => history.length)).toBe(entries);
  const before = await shown(page);
  expect(before[2]).not.toBe(OPENING_STORY);
  await page.reload();
  // The link loads the app with no other intent, and the run it opens has the settings checked.
  await expect(page.getByRole('radio', { name: 'Rush' })).toBeChecked();
  await expect(page.getByRole('radio', { name: 'On' })).toBeChecked();
  await expect(page.getByRole('radio', { name: 'Dead-letter after four tries' })).toBeChecked();
  expect(await shown(page)).toEqual(before);
});

test('a link followed before the app has loaded loads it, and opens that run with its settings', async ({
  page,
}) => {
  const app: string[] = [];
  page.on('request', (r) => /\/_astro\/app\./.test(r.url()) && app.push(r.url()));
  await page.goto(QUEUE);
  await page.waitForTimeout(300);
  expect(app).toEqual([]);
  // The boot script hears the link and loads the app, which opens the run the link names.
  await page.evaluate(() => (location.hash = '#seed-9&prefetch=10&ack=before'));
  await expect(page.locator('[data-qu-seed]')).toHaveText('9');
  await expect(clock(page)).toHaveText('Virtual time 4.000 s');
  await expect(page.getByRole('radio', { name: '10', exact: true })).toBeChecked();
  await expect(page.getByRole('radio', { name: 'Before the work' })).toBeChecked();
  expect(app).toHaveLength(1);
});

test('a link followed on the page opens its run paused at the opening’s moment, and a value the lab cannot take is left out', async ({
  page,
}) => {
  await page.goto(QUEUE);
  await page.getByRole('radio', { name: 'On' }).check();
  await page.getByRole('radio', { name: 'Quick' }).check();
  await page.getByRole('button', { name: 'Run' }).click();
  await expect.poll(() => seconds(page)).toBeGreaterThan(4.5);
  // Followed while the run plays: the page shows that seed's opening, paused, under the link's
  // settings, and the opening's for every setting it does not name.
  await page.evaluate(() => (location.hash = '#seed-9&prefetch=10&ack=before'));
  await expect(page.locator('[data-qu-seed]')).toHaveText('9');
  await expect(clock(page)).toHaveText('Virtual time 4.000 s');
  await expect(page.getByRole('button', { name: 'Run' })).toBeVisible();
  await expect(page.getByRole('radio', { name: '10', exact: true })).toBeChecked();
  await expect(page.getByRole('radio', { name: 'Before the work' })).toBeChecked();
  await expect(page.getByRole('radio', { name: 'Off' })).toBeChecked();
  const nine = await shown(page);
  await page.waitForTimeout(300);
  expect(await shown(page)).toEqual(nine);

  // A name the lab does not have and values its settings cannot take are dropped: the run is
  // seed 9's under the opening's settings, as the bare link gives it. It is followed from another
  // seed's run under other settings, so a page that ignored it would show that run instead.
  await page.evaluate(() => (location.hash = '#seed-9'));
  await expect(page.getByRole('radio', { name: '1', exact: true })).toBeChecked();
  const bare = await shown(page);
  await page.evaluate(() => (location.hash = '#seed-12&load=rush&prefetch=10'));
  await expect(page.locator('[data-qu-seed]')).toHaveText('12');
  await expect(page.getByRole('radio', { name: 'Rush' })).toBeChecked();
  await page.evaluate(() => (location.hash = '#seed-9&load=storm&prefetch=3&key=maybe&colour=red'));
  await expect(page.locator('[data-qu-seed]')).toHaveText('9');
  await expect(page.getByRole('radio', { name: 'Busy' })).toBeChecked();
  await expect(page.getByRole('radio', { name: '1', exact: true })).toBeChecked();
  await expect(page.getByRole('radio', { name: 'Off' })).toBeChecked();
  expect(await shown(page)).toEqual(bare);
  // A hash that links to no run, as the skip link's, leaves the run alone.
  await page.evaluate(() => (location.hash = '#main'));
  await page.waitForTimeout(200);
  expect(await shown(page)).toEqual(bare);
});

test('a choice shows its focus around its whole push-button, as a button does', async ({
  page,
}) => {
  await page.goto(QUEUE);
  await page.getByRole('button', { name: 'Start over' }).focus();
  await page.keyboard.press('Tab');
  const steady = page.getByRole('radio', { name: 'Steady' });
  await expect(steady).toBeFocused();
  const ring = await steady.evaluate((input) => {
    const style = getComputedStyle(input);
    const own = input.getBoundingClientRect();
    const button = (input.closest('label') as HTMLElement).getBoundingClientRect();
    return {
      style: style.outlineStyle,
      width: parseFloat(style.outlineWidth),
      around: own.width >= button.width && own.height >= button.height,
    };
  });
  expect(ring).toEqual({ style: 'solid', width: 2, around: true });
});

test('on a large screen the picture fills the desk', async ({ page }) => {
  await page.setViewportSize({ width: 2560, height: 1440 });
  await page.goto(QUEUE);
  const picture = await map(page).boundingBox();
  const figure = await page.locator('.qu-figure').boundingBox();
  expect(Math.round(picture?.width ?? 0)).toBe(Math.round(figure?.width ?? -1));
});

test('on a phone the narrow picture shows, and nothing scrolls sideways', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(QUEUE);
  await expect(page.locator('[data-qu-map="narrow"]')).toBeVisible();
  await expect(page.locator('[data-qu-map="wide"]')).toBeHidden();
  await page.getByRole('button', { name: 'Next event' }).click();
  await expect(page.locator('[data-qu-map="narrow"] .qu-again')).toHaveAttribute(
    'data-order',
    '18',
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});

for (const colorScheme of ['light', 'dark'] as const) {
  test(`axe finds no violation after a run, ${colorScheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    await page.goto(QUEUE);
    await page.getByRole('radio', { name: 'Before the work' }).check();
    await page.getByRole('button', { name: 'Publish a poison order' }).click();
    await page.getByRole('button', { name: 'Next event' }).click();
    await page.getByRole('button', { name: 'Crash worker 3' }).click();
    const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  });
}
