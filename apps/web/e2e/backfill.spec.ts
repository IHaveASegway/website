import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// The Backfill Lab in a browser (ADR 0026, as ADR 0020 for the Raft Lab): without JavaScript the
// page is the opening run the build drew, with no control; with it, nothing moves or loads until
// the visitor shows intent, the simulation takes over at the picture's exact minute and runs only
// between Run and Pause, and a hidden tab pauses it; each of the lab entry's "Three things to try"
// plays on the page with the entry's own numbers, in the entry's own steps; under reduced motion
// time moves in still steps of whole minutes; a link to a seed draws that seed's week, every
// column of it; and the page meets axe after a run, since script redrew it.

const BACKFILL = '/lab/backfill/';
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const MINUS = '−';
const OPENING_SUMMARY =
  "Every run has finished, and Wednesday's failed. Wednesday's report counts 275 orders, 96 more than the source: a failed load left 96 rows behind, and the retry appended all 179 again; the other 6 days match.";

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

/** Start over: the opening's week under the chosen settings, drawn at once. */
async function startOver(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Start over' }).click();
  await expect(page.locator('[data-bf-said]')).toHaveText(
    /^The week starts over under these settings, and stands at /,
  );
}

/** Make Monday's file late on a week whose Monday has found it: the week goes back to before the
 *  job is switched on, so a run from 00:00 can be watched. */
async function rewind(page: Page): Promise<void> {
  await page.getByRole('button', { name: "Make Monday's file 5 hours late" }).click();
  await expect(page.getByRole('button', { name: 'Switch the job on' })).not.toHaveAttribute(
    'aria-disabled',
  );
  await expect(page.locator('[data-bf-clock]')).toHaveText('00:00 on Monday 26 October');
}

/** Run, at the quickest speed, until every run has finished and the run stops by itself. */
async function runToTheEnd(page: Page): Promise<void> {
  await page.getByRole('radio', { name: 'Quick' }).check();
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(summary(page)).toHaveText(/^Every run has finished/, { timeout: 20_000 });
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
  // Its check found the totals apart and failed, and so did its run.
  await expect(day(page, 2).locator('[data-bf-run-word]')).toHaveText('failed');
  await expect(summary(page)).toHaveText(OPENING_SUMMARY);
  await expect(page.locator('[data-bf-day]')).toHaveCount(7);
  await expect(page.locator('[data-bf-step][data-lamp="filled"]')).toHaveCount(34);
  await expect(page.locator('[data-bf-check="totals"]')).toHaveAttribute('data-lamp', 'cross');
  await expect(page.locator('[data-bf-check="order"]')).toHaveAttribute('data-lamp', 'filled');
  await expect(page.locator('[data-bf-stray]')).toBeHidden();
  await expect(page.locator('[data-bf-week-source]')).toHaveText('2,012');
  // A cross for each failed attempt: Wednesday's first load, and its check.
  await expect(page.locator('.bf-strip-x')).toHaveCount(2);
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

  await rewind(page);
  expect(app).toHaveLength(1);
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

test('a hidden tab pauses the run, and the clock stays where it stopped', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto(BACKFILL);
  await rewind(page);
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect.poll(() => minutes(page), { timeout: 5_000 }).toBeGreaterThan(0);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeVisible();
  const hidden = await minutes(page);
  await page.waitForTimeout(500);
  expect(await minutes(page)).toBe(hidden);
});

test('with the job off, Next event and Run switch it on first, so the clock never moves with it off', async ({
  page,
}) => {
  await page.goto(BACKFILL);
  await rewind(page);
  await expect(summary(page)).toHaveText(/^The job graph is off\./);
  await page.getByRole('button', { name: 'Next event' }).click();
  // The switch only switches on, so it is no toggle: once the job is on it says so, unavailable.
  const on = page.getByRole('button', { name: 'The job is on' });
  await expect(on).toHaveAttribute('aria-disabled', 'true');
  await expect(on).not.toHaveAttribute('aria-pressed');
  await expect(page.locator('[data-bf-clock]')).toHaveText('00:00 on Monday 26 October');
  await expect(page.locator('[data-bf-said]')).toHaveText(
    /^The job graph is switched on with catch-up, which creates all 7 days' runs at once; 3 may run at a time\./,
  );
  // Unavailable, it is still a button a keyboard reaches, and pressed it says why it does nothing.
  await on.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-bf-said]')).toHaveText(
    'The job is on already: it was switched on at 00:00.',
  );
  // Back before the switch from the opening again, Run switches it on at 00:00 and plays.
  await startOver(page);
  await rewind(page);
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(page.getByRole('button', { name: 'The job is on' })).toHaveAttribute(
    'aria-disabled',
    'true',
  );
  await expect(page.locator('[data-bf-lines] li').filter({ hasText: 'is switched on' })).toHaveText(
    /^00:00 /,
  );
  await page.getByRole('button', { name: 'Pause' }).click();
});

test('watch Wednesday count twice; then overwrite the day and start over, and every day matches: 2,012 orders', async ({
  page,
}) => {
  await page.goto(BACKFILL);
  await expect(page.locator('[data-bf-lines]')).toContainText(
    "Wednesday's load fails after appending 96 of its 179 rows, and they stay in the report",
  );
  await expect(page.locator('[data-bf-lines]')).toContainText(
    "Wednesday's check finds 275 orders in the report and 179 in the source: 96 too many, so it fails and is not retried",
  );
  await expect(page.locator('[data-bf-lines]')).toContainText(
    "Wednesday's run fails: its check found the totals differ",
  );
  await page.getByRole('radio', { name: 'Overwrite the day' }).check();
  await expect(page.locator('[data-bf-said]')).toHaveText(
    "Loads now overwrite their day's partition in one atomic step.",
  );
  await startOver(page);
  // As the entry says, and at once: Start over keeps the choice, and Wednesday's first load
  // fails again, but this time it leaves nothing behind.
  await expect(page.getByRole('radio', { name: 'Overwrite the day' })).toBeChecked();
  await expect(summary(page)).toHaveText(
    "Every run has finished, and all 7 succeeded. Every day's total matches the source: 2,012 orders in all.",
  );
  await expect(page.locator('[data-bf-lines]')).toContainText(
    "Wednesday's load fails part way, and as its overwrite is one atomic step, the report is as it was",
  );
  await expect(page.locator('[data-bf-week-report]')).toHaveText('2,012');
  await expect(page.locator('[data-bf-week-source]')).toHaveText('2,012');
  await expect(page.locator('[data-bf-diff]:not(:empty)')).toHaveCount(0);
  await expect(page.locator(`[data-bf-step="${CHECK}"][data-lamp="filled"]`)).toHaveCount(7);
  await expect(page.locator('[data-bf-check][data-lamp="filled"]')).toHaveCount(3);
  await expect(page.locator('[data-bf-clock]')).toHaveText('02:10 on Monday 26 October');
  await expect(page.locator('[data-bf-events]')).toHaveText('44 events');
});

test("write to today: every day's orders land on Monday 26 October, and every check fails", async ({
  page,
}) => {
  await page.goto(BACKFILL);
  await page.getByRole('radio', { name: 'Today, by the clock' }).check();
  // The backfill runs again under the clock's day as the week starts over.
  await startOver(page);
  // Every check finds its day empty and fails, and every run with it.
  await expect(summary(page)).toHaveText(
    "Every run has finished, and all 7 failed. 7 days show no orders in the report, because their rows were filed under Monday 26 October, the clock's day.",
  );
  await expect(page.locator('[data-bf-run-word]')).toHaveText(
    Array.from({ length: 7 }, () => 'failed'),
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
  await expect(page.locator('[data-bf-week-diff]')).toHaveText(`${MINUS}2,012`);
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
  // The rerun's check finds Tuesday counted twice, so it fails, and the run with it.
  await expect(tuesday.locator('[data-bf-run-word]')).toHaveText('failed', { timeout: 20_000 });
  await expect(tuesday.locator('[data-bf-report]')).toHaveText('758');
  await expect(tuesday.locator('[data-bf-diff]')).toHaveText('+379');
  await expect(lamp(page, 1, CHECK)).toHaveAttribute('data-lamp', 'cross');

  await page.getByRole('radio', { name: 'Overwrite the day' }).check();
  await startOver(page);
  await expect(tuesday.locator('[data-bf-report]')).toHaveText('379');
  await page.getByRole('button', { name: 'Clear Tuesday and rerun it' }).click();
  await runToTheEnd(page);
  await expect(tuesday.locator('[data-bf-run-word]')).toHaveText('done');
  await expect(tuesday.locator('[data-bf-report]')).toHaveText('379');
  await expect(tuesday.locator('[data-bf-diff]')).toHaveText('');
});

test("then Monday's file five hours late with one run at a time: the week waits behind it", async ({
  page,
}) => {
  await page.goto(BACKFILL);
  await page.getByRole('radio', { name: '1 run at once' }).check();
  // Monday's sensor found its file long ago, so the week goes back to before the switch, with the
  // file late there and one run at a time, and Run switches the job on and plays it.
  await rewind(page);
  await expect(page.locator('[data-bf-said]')).toHaveText(
    "Monday's sensor has found its file already, so the week goes back to before the job is switched on. Monday's export file is held back 5 hours: it lands at 05:00 on Monday 26 October. Press Run to backfill the week.",
  );
  await expect(page.getByRole('radio', { name: '1 run at once' })).toBeChecked();
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

test('under reduce, Run moves the clock in still steps of 3 minutes, every one of them, and nothing animates', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(BACKFILL);
  await rewind(page);
  // Every time the clock shows, from 00:00 on, as it changes: a step the test did not sample
  // cannot hide.
  await page.evaluate(() => {
    const clock = document.querySelector('[data-bf-clock]');
    const seen = [clock?.textContent ?? ''];
    Object.defineProperty(window, '__clockSeen', { value: seen });
    if (clock)
      new MutationObserver(() => seen.push(clock.textContent ?? '')).observe(clock, {
        childList: true,
        characterData: true,
        subtree: true,
      });
  });
  const seen = () =>
    page.evaluate(() => (window as unknown as { __clockSeen: string[] }).__clockSeen);
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect.poll(async () => (await seen()).length, { timeout: 5_000 }).toBeGreaterThan(4);
  await page.getByRole('button', { name: 'Pause' }).click();
  const times = (await seen()).map((text) => {
    const [, h, m] = /^(\d\d):(\d\d) on /.exec(text) ?? ['', 'NaN', 'NaN'];
    return Number(h) * 60 + Number(m);
  });
  // Steady is 6 virtual minutes a second: 3 a step, twice a second, and never a frame's worth.
  expect(times[0]).toBe(0);
  expect(times.slice(1).map((t, i) => t - (times[i] as number))).toEqual(
    Array.from({ length: times.length - 1 }, () => 3),
  );
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
});

test("a link to a week opens it: #seed-12 draws that seed's week, every column of it, where its last event stands, and Start over keeps it", async ({
  page,
}) => {
  await page.goto(`${BACKFILL}#seed-12`);
  await expect(page.locator('[data-bf-seed]')).toHaveText('12');
  await expect(page.locator('[data-bf-lines] li').first()).toHaveText(
    "00:00 Wednesday's next load attempt will fail part way through",
  );
  // Seed 12's own week, not the build's seed 9: its sources, its totals and its clock.
  const sources = ['220', '161', '303', '404', '182', '143', '335'];
  const seedTwelve = async () => {
    for (const [n, source] of sources.entries())
      await expect(day(page, n).locator('[data-bf-source]')).toHaveText(source);
    await expect(page.locator('[data-bf-week-source]')).toHaveText('1,748');
    await expect(day(page, 2).locator('[data-bf-report]')).toHaveText('415');
    await expect(day(page, 2).locator('[data-bf-diff]')).toHaveText('+112');
    // The board and the property say the same of Wednesday.
    await expect(page.locator('[data-bf-check="totals"] [data-bf-check-word]')).toContainText(
      "Wednesday's report holds 415 orders and the source 303",
    );
    // Its week ends at 01:19, and the clock stands there, as a played week stops.
    await expect(page.locator('[data-bf-clock]')).toHaveText('01:19 on Monday 26 October');
    await expect(page.locator('[data-bf-lines] li').last()).toHaveText(
      '01:19 Every run has finished: 4 succeeded and 3 failed',
    );
  };
  await seedTwelve();
  await startOver(page);
  await expect(page.locator('[data-bf-seed]')).toHaveText('12');
  await seedTwelve();
});

/** What the page says of the week it shows: its seed, clock, events, caption, board and log. */
const shown = async (page: Page) => [
  await page.locator('[data-bf-seed]').textContent(),
  await page.locator('[data-bf-clock]').textContent(),
  await page.locator('[data-bf-events]').textContent(),
  await summary(page).textContent(),
  await page.locator('[data-bf-day]').allTextContents(),
  await page.locator('[data-bf-week-report]').textContent(),
  await page.locator('[data-bf-lines] li').allTextContents(),
];

test('Start over writes the link to its week, the seed and each setting changed, and a reload opens the same week', async ({
  page,
}) => {
  await page.goto(BACKFILL);
  await page.getByRole('radio', { name: 'Overwrite the day' }).check();
  await page.getByRole('radio', { name: '1 run at once' }).check();
  // A choice alone writes nothing: the link names how a week starts.
  expect(new URL(page.url()).hash).toBe('');
  const entries = await page.evaluate(() => history.length);
  await startOver(page);
  // The address names the week and replaces itself: no new entry in the history.
  expect(new URL(page.url()).hash).toBe('#seed-9&mode=overwrite&runs=1');
  expect(await page.evaluate(() => history.length)).toBe(entries);
  const before = await shown(page);
  expect(before[3]).not.toBe(OPENING_SUMMARY);
  await page.reload();
  // The link loads the app with no other intent, and the week it opens has the settings chosen.
  await expect(page.getByRole('radio', { name: 'Overwrite the day' })).toBeChecked();
  await expect(page.getByRole('radio', { name: '1 run at once' })).toBeChecked();
  expect(await shown(page)).toEqual(before);
});

test('a link followed on the page opens its week paused where the build’s would stand, and a value the lab cannot take is left out', async ({
  page,
}) => {
  await page.goto(BACKFILL);
  await rewind(page);
  await page.getByRole('radio', { name: 'Quick' }).check();
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect.poll(() => minutes(page), { timeout: 5_000 }).toBeGreaterThan(10);
  // Followed while the week plays: that week, paused, under the link's settings and the
  // opening's for every setting it does not name.
  await page.evaluate(() => (location.hash = '#seed-12&partition=today'));
  await expect(page.locator('[data-bf-seed]')).toHaveText('12');
  await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Today, by the clock' })).toBeChecked();
  await expect(page.getByRole('radio', { name: 'Append rows' })).toBeChecked();
  await expect(page.getByRole('radio', { name: '3 runs at once' })).toBeChecked();
  await expect(page.locator('[data-bf-stray]')).toBeVisible();
  const today = await shown(page);
  await page.waitForTimeout(300);
  expect(await shown(page)).toEqual(today);

  // A name the lab does not have and values its settings cannot take are dropped: the week is
  // seed 12's under the opening's settings, as the bare link gives it.
  await page.evaluate(() => (location.hash = '#seed-12'));
  await expect(page.getByRole('radio', { name: "The run's own day" })).toBeChecked();
  const bare = await shown(page);
  // Followed from another seed's week under other settings, so a page that ignored it would show
  // that week instead.
  await page.evaluate(() => (location.hash = '#seed-9&mode=overwrite&runs=1'));
  await expect(page.locator('[data-bf-seed]')).toHaveText('9');
  await expect(page.getByRole('radio', { name: '1 run at once' })).toBeChecked();
  await page.evaluate(
    () => (location.hash = '#seed-12&runs=9&mode=delete&partition=yesterday&colour=red'),
  );
  await expect(page.locator('[data-bf-seed]')).toHaveText('12');
  await expect(page.getByRole('radio', { name: '3 runs at once' })).toBeChecked();
  await expect(page.getByRole('radio', { name: 'Append rows' })).toBeChecked();
  expect(await shown(page)).toEqual(bare);
  // A hash that links to no week, as the skip link's, leaves the week alone.
  await page.evaluate(() => (location.hash = '#main'));
  await page.waitForTimeout(200);
  expect(await shown(page)).toEqual(bare);
});

test('a link followed before the app has loaded loads it, and opens that week with its settings', async ({
  page,
}) => {
  const app: string[] = [];
  page.on('request', (r) => /\/_astro\/app\./.test(r.url()) && app.push(r.url()));
  await page.goto(BACKFILL);
  await page.waitForTimeout(300);
  expect(app).toEqual([]);
  // The boot script hears the link and loads the app, which opens the week the link names.
  await page.evaluate(() => (location.hash = '#seed-12&mode=overwrite'));
  await expect(page.locator('[data-bf-seed]')).toHaveText('12');
  await expect(page.getByRole('radio', { name: 'Overwrite the day' })).toBeChecked();
  expect(app).toHaveLength(1);
});

test('the opening’s week has happened, so Run plays it again from the switch, and Next event steps it from there', async ({
  page,
}) => {
  await page.goto(BACKFILL);
  await page.locator('[data-bf-board]').hover();
  await expect(page.locator('[data-bf-lines] li')).not.toHaveCount(0);
  const opening = await shown(page);
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  // Back at the switch, said, and on the clock: the week plays as the entry tells it.
  await expect(page.locator('[data-bf-said]')).toHaveText(
    /^The week plays again from the switch\. The job graph is switched on with catch-up/,
  );
  expect(await minutes(page)).toBeLessThan(60);
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
  await page.getByRole('radio', { name: 'Quick' }).check();
  await expect(page.locator('[data-bf-lines]')).toContainText(
    "Wednesday's load fails after appending 96 of its 179 rows, and they stay in the report",
    { timeout: 20_000 },
  );
  // It stops where the picture stood, the same week: board, caption, clock and log.
  await expect(summary(page)).toHaveText(OPENING_SUMMARY, { timeout: 20_000 });
  await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeVisible();
  expect(await shown(page)).toEqual(opening);
  // Next event on a finished week takes it back to the switch too, one step at a time.
  await page.getByRole('button', { name: 'Next event' }).click();
  await expect(page.locator('[data-bf-clock]')).toHaveText('00:00 on Monday 26 October');
  await expect(page.locator('[data-bf-said]')).toHaveText(
    /^The week plays again from the switch\. /,
  );
  await expect(page.locator('[data-bf-events]')).toHaveText('0 events');
});

test('the log shows its newest line once the app wakes, as it does for a link', async ({
  page,
}) => {
  await page.goto(BACKFILL);
  const box = page.locator('.bf-lines');
  // The build writes the log oldest first, and it is longer than its box.
  expect(await box.evaluate((b) => b.scrollHeight > b.clientHeight && b.scrollTop === 0)).toBe(
    true,
  );
  await page.locator('[data-bf-board]').hover();
  await expect
    .poll(() => box.evaluate((b) => b.scrollHeight - b.clientHeight - b.scrollTop))
    .toBeLessThanOrEqual(1);
});

test('a choice shows its focus around its whole push-button, as a button does', async ({
  page,
}) => {
  await page.goto(BACKFILL);
  await page.getByRole('button', { name: 'Next event' }).focus();
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

for (const colorScheme of ['light', 'dark'] as const) {
  test(`axe finds no violation after a run, ${colorScheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    await page.goto(BACKFILL);
    await page.getByRole('radio', { name: 'Today, by the clock' }).check();
    await startOver(page);
    await expect(page.locator('[data-bf-stray]')).toBeVisible();
    await rewind(page);
    await page.getByRole('button', { name: 'Switch the job on' }).click();
    for (let i = 0; i < 12; i++) await page.getByRole('button', { name: 'Next event' }).click();
    await expect(page.locator('[data-bf-step][data-lamp="lit"]').first()).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  });
}
