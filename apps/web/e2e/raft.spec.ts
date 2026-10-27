import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// The Raft Lab in a browser (ADR 0020): without JavaScript the page is the opening run the build
// drew, with no control; with it, nothing moves or loads until the visitor shows intent, the
// simulation takes over at the picture's exact moment, runs only between Run and Pause, and keeps
// the five safety properties through a cut-off leader; under reduced motion it advances in
// discrete steps; and the page meets axe after a run, since script redrew it.

const RAFT = '/lab/raft/';
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const HELD = /^All five safety properties held over [\d,]+ events\.$/;

const clock = (page: Page) => page.locator('[data-rf-clock]');
const summary = (page: Page) => page.locator('[data-rf-summary]');
const status = (page: Page) => page.locator('[data-rf-status]');

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

test('without JavaScript, the page is the opening run: five nodes, three committed entries each, no control', async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(RAFT);
  await expect(page.locator('[data-rf-node]')).toHaveCount(5);
  await expect(page.locator('.rf-cell[data-done]')).toHaveCount(15);
  await expect(summary(page)).toHaveText(/^Node \d leads term \d+, 3 entries committed\.$/);
  await expect(status(page)).toHaveText(HELD);
  for (const control of await page.locator('.rf-controls, .rf-clock').all())
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
  await page.goto(RAFT);
  await page.waitForTimeout(300);
  expect(app).toEqual([]);
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);

  const opening = await seconds(page);
  await page.getByRole('button', { name: 'Run' }).click();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
  expect(app).toHaveLength(1);
  await expect.poll(() => seconds(page), { timeout: 5_000 }).toBeGreaterThan(opening + 0.02);
  await page.getByRole('button', { name: 'Pause' }).click();
  const paused = await seconds(page);
  await page.waitForTimeout(400);
  expect(await seconds(page)).toBe(paused);
  expect(await violations()).toEqual([]);
});

test('cut off the leader: a new term elects another leader, and every safety property holds', async ({
  page,
}) => {
  await page.goto(RAFT);
  const before = (await summary(page).textContent()) ?? '';
  const [, oldLeader, oldTerm] = /^Node (\d) leads term (\d+)/.exec(before) ?? [];
  await page.getByRole('button', { name: 'Cut off the leader' }).click();
  await page.selectOption('[data-rf-speed]', '0.1');
  await page.getByRole('button', { name: 'Run' }).click();
  // The old leader still leads its own term on its side; the majority elects a newer one.
  await expect
    .poll(
      async () => {
        const [, leader, term] =
          /^Node (\d) leads term (\d+)/.exec((await summary(page).textContent()) ?? '') ?? [];
        return leader !== undefined && leader !== oldLeader && Number(term) > Number(oldTerm);
      },
      { timeout: 15_000 },
    )
    .toBe(true);
  await page.getByRole('button', { name: 'Pause' }).click();
  await expect(status(page)).toHaveText(HELD);
  await expect(page.locator('[data-rf-lines]')).toContainText('The network splits');
});

test('a node button crashes it and then restarts it, and says so in its name', async ({ page }) => {
  await page.goto(RAFT);
  const first = page.locator('[data-rf-toggle="0"]');
  await first.click();
  await expect(first).toHaveText('Restart node 1');
  await expect(first).toHaveAccessibleName('Restart node 1, now down');
  await expect(page.locator('[data-rf-node="0"]')).toHaveAttribute('data-up', 'false');
  await first.click();
  await expect(first).toHaveText('Crash node 1');
  await expect(page.locator('[data-rf-node="0"]')).toHaveAttribute('data-up', 'true');
});

test('under reduce, Run advances in steps of 50 virtual ms, and nothing animates', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(RAFT);
  const opening = await seconds(page);
  await page.getByRole('button', { name: 'Run' }).click();
  await expect.poll(() => seconds(page), { timeout: 3_000 }).toBeGreaterThan(opening);
  await page.getByRole('button', { name: 'Pause' }).click();
  const moved = Math.round(((await seconds(page)) - opening) * 1000);
  expect(moved % 50).toBe(0);
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
});

test('a link to a run opens it: #seed-8 loads that seed with no other intent, and Start over moves on', async ({
  page,
}) => {
  await page.goto(`${RAFT}#seed-8`);
  await expect(page.locator('[data-rf-seed]')).toHaveText('8');
  await page.getByRole('button', { name: 'Start over' }).click();
  await expect(page.locator('[data-rf-seed]')).toHaveText('9');
  expect(new URL(page.url()).hash).toBe('#seed-9');
});

for (const colorScheme of ['light', 'dark'] as const) {
  test(`axe finds no violation after a run, ${colorScheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    await page.goto(RAFT);
    await page.getByRole('button', { name: 'Send a write' }).click();
    await page.getByRole('button', { name: 'Split 2 and 3' }).click();
    await page.getByRole('button', { name: 'Next event' }).click();
    const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  });
}
