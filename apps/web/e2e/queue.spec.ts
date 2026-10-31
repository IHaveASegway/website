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
    'No order was lost and the queue drains, but 1 order was printed twice.',
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
  for (const control of await page.locator('.qu-controls, .qu-clock').all())
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
  await expect(status(page)).toHaveText(/^All three held over 143 events/);
  // The key is a setting: it stays on for the run that starts over.
  await expect(page.getByRole('radio', { name: 'On' })).toBeChecked();
});

test('the second: acknowledging before the work, a crash loses the order the worker held, never printed', async ({
  page,
}) => {
  await page.goto(QUEUE);
  await page.getByRole('radio', { name: 'Before the work' }).check();
  await expect(log(page)).toContainText(
    'From the next delivery, an order is acknowledged as it is',
  );
  // Worker 1 holds order 26, delivered before the switch; its next order comes acknowledged. It
  // has no lamp lit between two orders, so the page is read without waiting for one.
  const working = map(page).locator('.qu-slot[data-worker="0"][data-state="working"]');
  const workingOn = () =>
    page.evaluate(
      () =>
        document
          .querySelector('[data-qu-map="wide"] .qu-slot[data-worker="0"][data-state="working"]')
          ?.getAttribute('data-order') ?? null,
    );
  await expect(working).toHaveAttribute('data-order', '26');
  for (let presses = 0; presses < 80 && (await workingOn()) !== '28'; presses++)
    await page.getByRole('button', { name: 'Next event' }).click();
  await expect(working).toHaveAttribute('data-order', '28');
  await page.getByRole('button', { name: 'Crash worker 1' }).click();
  await expect(summary(page)).toHaveText(
    /^Order 28 was lost: worker 1 crashed holding it, and it was acknowledged on delivery\./,
  );
  await expect(log(page)).toContainText(
    'Worker 1 crashes holding order 28. The broker had already let it go, so it is lost',
  );
  await expect(property(page, 'no-loss')).toHaveAttribute('data-held', 'false');
  await expect(property(page, 'no-loss')).toContainText('Broken: 1 order lost');
  // Its ticket never printed: hollow, and crossed.
  await expect(map(page).locator('.qu-ticket[data-order="28"]')).toHaveAttribute(
    'data-state',
    'lost',
  );
  await expect(status(page)).toHaveText(
    'The queue drains, but 1 order was lost and 1 order was printed twice.',
  );
});

test('the third: a poison order under requeue never drains; dead-lettered after four tries, everything behind it flows', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.goto(QUEUE);
  await page.getByRole('button', { name: 'Publish a poison order' }).click();
  await expect(map(page).locator('.qu-order[data-poison]')).toHaveAttribute('data-order', '39');
  await page.getByRole('button', { name: 'Stop taking orders' }).click();
  await expect(page.getByRole('button', { name: 'Take orders' })).toBeVisible();
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
  await page.getByRole('button', { name: 'Restart worker 2' }).click();
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

test('a link to a run opens it: #seed-8 loads that seed with no other intent, and Start over keeps it and the settings', async ({
  page,
}) => {
  await page.goto(`${QUEUE}#seed-8`);
  await expect(page.locator('[data-qu-seed]')).toHaveText('8');
  await page.getByRole('radio', { name: 'On' }).check();
  await page.getByRole('button', { name: 'Start over' }).click();
  await expect(page.locator('[data-qu-seed]')).toHaveText('8');
  await expect(clock(page)).toHaveText('Virtual time 4.000 s');
  await expect(page.getByRole('radio', { name: 'On' })).toBeChecked();
  expect(new URL(page.url()).hash).toBe('#seed-8');
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
