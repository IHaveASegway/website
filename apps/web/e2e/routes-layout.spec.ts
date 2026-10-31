import { expect, test, type Locator, type Page } from '@playwright/test';
import { ROUTE_LAB } from './expected';

// The Route Lab's desk as a visitor uses it (review of 2026-10-31, LAB-1): the cause and its effect
// on one screen. Where one map shows at a time, the map switch, the map and the controls that
// change it fit one 390 by 844 screen together, the map starts on the first screen, and Tab meets
// the controls in the order the screen shows them. From 64rem the controls head the desk, over the
// readout and both maps, as before.

/** A visible element's top and bottom on the page, not the screen. */
const span = (locator: Locator) =>
  locator.evaluate((e) => {
    const r = e.getBoundingClientRect();
    return { top: r.top + window.scrollY, bottom: r.bottom + window.scrollY };
  });

const visibleMap = (page: Page) => page.locator('svg[data-rl-map]:visible');

test('on a 390 by 844 phone the map switch, the map and the day and van controls share one screen', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(ROUTE_LAB);
  await expect(visibleMap(page)).toHaveCount(1);
  const view = await span(page.locator('.rl-view'));
  const map = await span(visibleMap(page));
  const days = await span(page.locator('.rl-days'));
  const more = await span(page.locator('.rl-more'));
  // Top to bottom: the switch, its map, then what changes it.
  expect(view.bottom).toBeLessThanOrEqual(map.top);
  expect(map.bottom).toBeLessThanOrEqual(days.top);
  expect(days.bottom).toBeLessThanOrEqual(more.top);
  expect(more.bottom - view.top).toBeLessThanOrEqual(844);
  // Scrolled there, every part is on screen at once.
  await page.evaluate((y) => window.scrollTo(0, y), view.top);
  for (const part of ['.rl-view', '.rl-days', '.rl-more']) {
    await expect(page.locator(part)).toBeInViewport({ ratio: 1 });
  }
  await expect(visibleMap(page)).toBeInViewport({ ratio: 1 });
  // And the first screen, before any scroll, already shows the top of the map.
  expect(map.top).toBeLessThan(844 - 100);
});

test('on a phone Tab meets the desk’s controls in the order the screen shows them', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(ROUTE_LAB);
  await page.locator('input[name="rl-view"]:checked').focus();
  const tops: number[] = [];
  const names: string[] = [];
  for (let k = 0; k < 4; k++) {
    if (k > 0) await page.keyboard.press('Tab');
    const focused = page.locator(':focus');
    names.push(await focused.evaluate((e) => (e as HTMLInputElement).name || e.textContent || ''));
    // A radio is drawn as its chip, so the chip is where the screen shows it.
    tops.push(
      await focused.evaluate(
        (e) => (e.closest('label') ?? e).getBoundingClientRect().top + window.scrollY,
      ),
    );
  }
  expect(names.map((n) => n.trim())).toEqual(['rl-view', 'rl-day', 'rl-vans', 'Surprise me']);
  // Each is on the row of the one before, or under it.
  tops.forEach((top, k) => expect(top).toBeGreaterThanOrEqual(tops[k - 1] ?? top));
});

test('from 64rem the controls head the desk, over the readout and both maps', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(ROUTE_LAB);
  await expect(page.locator('.rl-view')).toBeHidden();
  await expect(visibleMap(page)).toHaveCount(2);
  const controls = await span(page.locator('.rl-controls'));
  const readout = await span(page.locator('.rl-readout'));
  const map = await span(visibleMap(page).first());
  expect(controls.bottom).toBeLessThanOrEqual(readout.top);
  expect(readout.bottom).toBeLessThanOrEqual(map.top);
});
