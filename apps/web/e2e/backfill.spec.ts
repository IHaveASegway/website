import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// The Backfill Lab in a browser (ADR 0026, as ADR 0020 for the Raft Lab): without JavaScript the
// page is the opening run the build drew, with no control; with it, nothing moves or loads until
// the visitor shows intent, the simulation takes over at the picture's exact minute and runs only
// between Run and Pause; each of the lab entry's "Three things to try" plays on the page with the
// entry's own numbers; under reduced motion time moves in still steps; and the page meets axe
// after a run, since script redrew it.

const BACKFILL = '/lab/backfill/';
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const MINUS = '−';
const OPENING_SUMMARY =
  "Every run has finished, and all 7 succeeded. Wednesday's report counts 275 orders, 96 more than the source: a failed load left 96 rows behind, and the retry appended all 179 again; the other 6 days match.";

const summary = (page: Page) => page.locator('[data-bf-summary]');
const day = (page: Page, n: number) => page.locator(`[data-bf-day="${n}"]`);
const lamp = (page: Page, n: number, step: number) =>
  day(page, n).locator(`[data-bf-step="${step}"]`);
const CHECK = 4;

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

/** Virtual minutes since midnight on the clock. */
async function minutes(page: Page): Promise<number> {
  const [, h, m] = /^(\d\d):(\d\d) on /.exec(
    (await page.locator('[data-bf-clock]').textContent()) ?? '',
  ) ?? ['', 'NaN', 'NaN'];
  return Number(h) * 60 + Number(m);
}

/** Start over, so the job is off at the minute the week ends, and wait for the app to say so. */
async function startOver(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Start over' }).click();
  await expect(summary(page)).toHaveText(/^The job graph is off\./);
}

/** Switch the job on and run the week at the quickest speed until every run has finished. */
async function backfill(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Switch the job on' }).click();
  await expect(page.getByRole('button', { name: 'Switch the job on' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('radio', { name: 'Quick' }).check();
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(summary(page)).toHaveText(/^Every run has finished/, { timeout: 20_000 });
  // The week ran out of things to do, so the run stopped by itself.
  await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeVisible();
}

test('without JavaScript, the page is the opening run: Wednesday counted twice, every other day right, no control', async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(BACKFILL);
  // The opening's story: Wednesday's failed load left 96 rows, and the retry appended all 179.
  await expect(day(page, 2).locator('[data-bf-report]')).toHaveText('275');
  await expect(day(page, 2).locator('[data-bf-source]')).toHaveText('179');
  await expect(day(page, 2).locator('[data-bf-diff]')).toHaveText('+96');
  await expect(lamp(page, 2, CHECK)).toHaveAttribute('data-lamp', 'cross');
  await expect(summary(page)).toHaveText(OPENING_SUMMARY);
  await expect(page.locator('[data-bf-day]')).toHaveCount(7);
  await expect(page.locator('[data-bf-step][data-lamp="filled"]')).toHaveCount(34);
  await expect(page.locator('[data-bf-check="totals"]')).toHaveAttribute('data-lamp', 'cross');
  await expect(page.locator('[data-bf-check="order"]')).toHaveAttribute('data-lamp', 'filled');
  await expect(page.locator('[data-bf-stray]')).toBeHidden();
  await expect(page.locator('.bf-strip-x')).toHaveCount(1);
  await expect(page.locator('[data-bf-lines] li').first()).toHaveText(
    "00:00 Wednesday's next load attempt will fail part way through",
  );
  for (const control of await page.locator('.bf-controls, .bf-clock').all())
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
  await page.goto(BACKFILL);
  await page.waitForTimeout(300);
  expect(app).toEqual([]);
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);

  await startOver(page);
  expect(app).toHaveLength(1);
  await page.getByRole('button', { name: 'Switch the job on' }).click();
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
  await expect.poll(() => minutes(page), { timeout: 5_000 }).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Pause' }).click();
  const paused = await minutes(page);
  await page.waitForTimeout(400);
  expect(await minutes(page)).toBe(paused);
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
  expect(await violations()).toEqual([]);
});

test('watch Wednesday count twice; then overwrite the day and start over, and every day matches: 2,012 orders', async ({
  page,
}) => {
  await page.goto(BACKFILL);
  await expect(page.locator('[data-bf-lines]')).toContainText(
    "Wednesday's load fails after appending 96 of its 179 rows, and they stay in the report",
  );
  await expect(page.locator('[data-bf-lines]')).toContainText(
    "Wednesday's check finds 275 orders in the report and 179 in the source: 96 too many",
  );
  await page.getByRole('radio', { name: 'Overwrite the day' }).check();
  await expect(page.locator('[data-bf-said]')).toHaveText(
    "Loads now overwrite their day's partition in one atomic step.",
  );
  await startOver(page);
  // Start over keeps the choice, and Wednesday's first load is set to fail again.
  await expect(page.getByRole('radio', { name: 'Overwrite the day' })).toBeChecked();
  await backfill(page);
  await expect(summary(page)).toHaveText(
    "Every run has finished, and all 7 succeeded. Every day's total matches the source: 2,012 orders in all.",
  );
  await expect(page.locator('[data-bf-lines]')).toContainText(
    "Wednesday's load fails part way, and as its overwrite is one atomic step, the report is as it was",
  );
  await expect(page.locator('[data-bf-week-report]')).toHaveText('2,012');
  await expect(page.locator('[data-bf-diff]:not(:empty)')).toHaveCount(0);
  await expect(page.locator(`[data-bf-step="${CHECK}"][data-lamp="filled"]`)).toHaveCount(7);
  await expect(page.locator('[data-bf-check][data-lamp="filled"]')).toHaveCount(3);
});

test("write to today: every day's orders land on Monday 26 October, and every check fails", async ({
  page,
}) => {
  await page.goto(BACKFILL);
  await page.getByRole('radio', { name: 'Today, by the clock' }).check();
  await startOver(page);
  await backfill(page);
  await expect(summary(page)).toHaveText(
    "Every run has finished, and all 7 succeeded. 7 days show no orders in the report, because their rows were filed under Monday 26 October, the clock's day.",
  );
  const stray = page.locator('[data-bf-stray]');
  await expect(stray).toBeVisible();
  await expect(stray.locator('[data-bf-stray-short]')).toHaveText('Mon 26');
  await expect(stray.locator('[data-bf-stray-rows]')).toHaveText('2,108');
  await expect(page.locator(`[data-bf-step="${CHECK}"][data-lamp="cross"]`)).toHaveCount(7);
  for (let n = 0; n < 7; n++) {
    await expect(day(page, n).locator('[data-bf-report]')).toHaveText('0');
    await expect(day(page, n).locator('[data-bf-diff]')).toHaveText(new RegExp(`^${MINUS}\\d+$`));
  }
});

test("rerun a finished day: with append Tuesday's total doubles; with overwrite nothing changes", async ({
  page,
}) => {
  await page.goto(BACKFILL);
  const tuesday = day(page, 1);
  await expect(tuesday.locator('[data-bf-report]')).toHaveText('379');
  await page.getByRole('radio', { name: 'Tuesday' }).check();
  await page.getByRole('button', { name: 'Clear Tuesday and rerun it' }).click();
  await expect(page.locator('[data-bf-said]')).toHaveText(
    "Tuesday 20 October is cleared, and its run starts again from extract. Tuesday's run starts.",
  );
  // A run slot is free, so the rerun starts at once, from extract: the sensor keeps its file.
  await expect(tuesday.locator('[data-bf-run-word]')).toHaveText('running');
  await expect(lamp(page, 1, 0)).toHaveAttribute('data-lamp', 'filled');
  await expect(lamp(page, 1, 1)).toHaveAttribute('data-lamp', 'lit');
  await page.getByRole('radio', { name: 'Quick' }).check();
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(tuesday.locator('[data-bf-run-word]')).toHaveText('done', { timeout: 20_000 });
  await expect(tuesday.locator('[data-bf-report]')).toHaveText('758');
  await expect(tuesday.locator('[data-bf-diff]')).toHaveText('+379');

  await page.getByRole('radio', { name: 'Overwrite the day' }).check();
  await startOver(page);
  await backfill(page);
  await expect(tuesday.locator('[data-bf-report]')).toHaveText('379');
  await page.getByRole('button', { name: 'Clear Tuesday and rerun it' }).click();
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(summary(page)).toHaveText(/^Every run has finished/, { timeout: 20_000 });
  await expect(tuesday.locator('[data-bf-run-word]')).toHaveText('done');
  await expect(tuesday.locator('[data-bf-report]')).toHaveText('379');
  await expect(tuesday.locator('[data-bf-diff]')).toHaveText('');
});

test("then Monday's file five hours late with one run at a time: the week waits behind it", async ({
  page,
}) => {
  await page.goto(BACKFILL);
  await page.getByRole('radio', { name: '1 run at once' }).check();
  await startOver(page);
  await expect(page.getByRole('radio', { name: '1 run at once' })).toBeChecked();
  await page.getByRole('button', { name: "Make Monday's file 5 hours late" }).click();
  await expect(page.locator('[data-bf-said]')).toHaveText(
    "Monday's export file is held back 5 hours: it lands at 05:00 on Monday 26 October.",
  );
  await page.getByRole('button', { name: 'Switch the job on' }).click();
  await page.getByRole('radio', { name: 'Quick' }).check();
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect.poll(() => minutes(page), { timeout: 10_000 }).toBeGreaterThanOrEqual(120);
  await page.getByRole('button', { name: 'Pause' }).click();
  await expect(summary(page)).toHaveText(
    '0 of 7 runs have finished; 1 running and 6 waiting for a run slot.',
  );
  await expect(lamp(page, 0, 0)).toHaveAttribute('data-lamp', 'lit');
  for (let n = 1; n < 7; n++)
    await expect(day(page, n).locator('[data-bf-run-word]')).toHaveText('waiting');
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(page.locator('[data-bf-lines]')).toContainText(
    "Monday's sensor finds the export file after 5 hours",
    { timeout: 20_000 },
  );
});

test('the buttons for one day say which day they act on', async ({ page }) => {
  await page.goto(BACKFILL);
  await page.getByRole('radio', { name: 'Thursday' }).check();
  for (const name of [
    "Fail Thursday's next load",
    "Make Thursday's file 5 hours late",
    'Clear Thursday and rerun it',
  ])
    await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
  // A press that can change nothing yet says what would.
  await page.getByRole('button', { name: "Fail Thursday's next load" }).click();
  await expect(page.locator('[data-bf-said]')).toHaveText(
    "Thursday's next load attempt will fail part way through. Thursday has loaded already, so this fails only a load after a clear.",
  );
});

test('under reduce, Run moves the clock in still steps of whole minutes, and nothing animates', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(BACKFILL);
  await startOver(page);
  await page.getByRole('button', { name: 'Switch the job on' }).click();
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect.poll(() => minutes(page), { timeout: 3_000 }).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Pause' }).click();
  // Steady is 6 virtual minutes a second: 3 a step, twice a second.
  expect((await minutes(page)) % 3).toBe(0);
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
});

test('a link to a week opens it: #seed-12 loads that seed with no other intent, and Start over keeps it', async ({
  page,
}) => {
  await page.goto(`${BACKFILL}#seed-12`);
  await expect(page.locator('[data-bf-seed]')).toHaveText('12');
  await expect(page.locator('[data-bf-lines] li').first()).toHaveText(
    "00:00 Wednesday's next load attempt will fail part way through",
  );
  await startOver(page);
  await expect(page.locator('[data-bf-seed]')).toHaveText('12');
});

for (const colorScheme of ['light', 'dark'] as const) {
  test(`axe finds no violation after a run, ${colorScheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    await page.goto(BACKFILL);
    await page.getByRole('radio', { name: 'Today, by the clock' }).check();
    await startOver(page);
    await page.getByRole('button', { name: 'Switch the job on' }).click();
    for (let i = 0; i < 12; i++) await page.getByRole('button', { name: 'Next event' }).click();
    await expect(page.locator('[data-bf-step][data-lamp="lit"]').first()).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  });
}
