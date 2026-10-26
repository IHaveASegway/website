import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { ROUTE_LAB } from './expected';

// The space-time cube on the Route Lab (ADR 0019), in a real WebGL context (SwiftShader in headless
// Chromium): without JavaScript it is two pictures drawn at build; three.js loads only on intent
// at the cube, never on a scroll; the canvas takes the picture's place with nothing below moving;
// a drag or a key turns both cubes, the slider moves through the day, Play stops at the end and
// its own button pauses it; a browser without WebGL keeps the pictures and shows no control.

const NBSP = '\u00a0';
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const cube = (page: Page) => page.locator('[data-rl-cube]');
const canvases = (page: Page) => cube(page).locator('canvas');
const slider = (page: Page) => page.locator('[data-rl-cube-time]');
const play = (page: Page) => page.locator('[data-rl-cube-play]');

/** The cube's chunk, by its name in /_astro/. */
const isCube = (path: string) => /\/_astro\/cube\.[\w-]+\.js$/.test(path);

/** Loads the scene with a mouse over the first cube, and waits for both canvases. */
async function turnOn(page: Page): Promise<void> {
  await cube(page).locator('[data-rl-cube-stage]').first().hover();
  await expect(canvases(page)).toHaveCount(2);
  await expect(cube(page).locator('[data-rl-cube-marks] li').first()).toBeVisible();
}

/** A picture of the first canvas, as the compositor shows it. */
const shot = (page: Page) => canvases(page).first().screenshot();

test('without JavaScript the cube is two pictures with names, and no control shows', async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(ROUTE_LAB);
  const pictures = page.locator('svg[data-rl-cube-picture]');
  await expect(pictures).toHaveCount(2);
  for (const picture of await pictures.all()) {
    await expect(picture).toBeVisible();
    await expect(picture).toHaveAccessibleName(/, in time: the map lies flat/);
    await expect(picture.locator('.rl-route')).toHaveCount(3);
  }
  await expect(pictures.first()).toHaveAccessibleName(
    new RegExp(`As the orders came in, .* back after 2${NBSP}h 53${NBSP}min\\.$`),
  );
  await expect(pictures.last()).toHaveAccessibleName(
    new RegExp(`Planned by VROOM, .* back after 2${NBSP}h 20${NBSP}min\\.$`),
  );
  await expect(page.locator('[data-rl-cube-controls]').first()).toBeHidden();
  await context.close();
});

test('a scroll loads no three.js; a mouse over the cube does, and nothing below it moves', async ({
  page,
}) => {
  const asked: string[] = [];
  page.on('request', (r) => asked.push(new URL(r.url()).pathname));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(ROUTE_LAB);
  await cube(page).scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  expect(asked.filter(isCube)).toEqual([]);
  // Where the next part of the page starts, on the page rather than the screen: hover() scrolls.
  const below = () =>
    page
      .locator('details.rl-orders')
      .evaluate((e) => Math.round(e.getBoundingClientRect().top + window.scrollY));
  const before = await below();
  await turnOn(page);
  expect(asked.filter(isCube)).toHaveLength(1);
  await expect(page.locator('svg[data-rl-cube-picture]').first()).toBeHidden();
  expect(await below()).toBe(before);
  await expect(canvases(page).first()).toHaveAttribute('role', 'img');
  await expect(canvases(page).first()).toHaveAccessibleName(/^As the orders came in, in time/);
});

test('a drag turns both cubes, the arrow keys turn them, and Home or the button sets them back', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(ROUTE_LAB);
  await turnOn(page);
  const first = await shot(page);
  const other = await canvases(page).last().screenshot();
  const box = await canvases(page).first().boundingBox();
  if (!box) throw new Error('no canvas');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  expect(await shot(page)).not.toEqual(first);
  // One camera: the other cube turned with it.
  expect(await canvases(page).last().screenshot()).not.toEqual(other);

  await page.locator('[data-rl-cube-reset]').click();
  expect(await shot(page)).toEqual(first);
  await canvases(page).first().focus();
  await page.keyboard.press('ArrowLeft');
  expect(await shot(page)).not.toEqual(first);
  await page.keyboard.press('Home');
  expect(await shot(page)).toEqual(first);
});

test('the slider moves through the day and says where it is; Play runs, pauses and stops at the end', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(ROUTE_LAB);
  await turnOn(page);
  const first = await shot(page);
  await slider(page).fill('4800');
  await expect(page.locator('[data-rl-cube-clock]')).toHaveText(`1${NBSP}h 20${NBSP}min`);
  await expect(slider(page)).toHaveAttribute('aria-valuetext', `1${NBSP}h 20${NBSP}min`);
  expect(await shot(page)).not.toEqual(first);

  await play(page).click();
  await expect(play(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(play(page)).toHaveText('Pause');
  await expect.poll(async () => Number(await slider(page).inputValue())).toBeGreaterThan(4800);
  await play(page).click();
  await expect(play(page)).toHaveAttribute('aria-pressed', 'false');
  const paused = await slider(page).inputValue();
  await page.waitForTimeout(300);
  expect(await slider(page).inputValue()).toBe(paused);

  // From near the end, Play runs out and stops by itself.
  const max = await slider(page).getAttribute('max');
  await slider(page).fill(String(Number(max) - 120));
  await play(page).click();
  await expect(play(page)).toHaveAttribute('aria-pressed', 'false', { timeout: 3_000 });
  expect(await slider(page).inputValue()).toBe(max);
});

test('a press of Play before the scene loaded is kept, and the day plays once it arrives', async ({
  page,
}) => {
  await page.goto(ROUTE_LAB);
  await play(page).click();
  await expect(canvases(page)).toHaveCount(2);
  await expect(play(page)).toHaveAttribute('aria-pressed', 'true');
});

test('a change of plan redraws the cube from the app’s plans, on the same scale for both', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(ROUTE_LAB);
  await turnOn(page);
  const backs = cube(page).locator('[data-rl-cube-back]');
  await expect(slider(page)).toHaveAttribute('max', String(3 * 3600));
  // A quiet Tuesday: eight orders and one van, which is out longer than any van of a busy Saturday,
  // so both cubes' time axis grows to the next whole hour, together.
  await page.check('input[name="rl-day"][value="quiet"]');
  await expect(page.locator('[data-rl-status]')).toHaveText(/Planned in/, { timeout: 20_000 });
  await expect(backs.last()).not.toContainText('previous orders');
  const text = await backs.allTextContents();
  const hours = text.map((t) => Number(/after (\d+)\u00a0h/.exec(t)?.[1] ?? 0));
  expect(text).not.toContain(`Last van back after 2${NBSP}h 53${NBSP}min`);
  await expect(slider(page)).toHaveAttribute('max', String((Math.max(...hours) + 1) * 3600));
});

test('on a phone one cube shows, the one the map switch chooses', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(ROUTE_LAB);
  const before = page.locator('[data-rl-cube-plan="before"]');
  const after = page.locator('[data-rl-cube-plan="after"]');
  await expect(after).toBeVisible();
  await expect(before).toBeHidden();
  await page.locator('input[name="rl-view"][value="before"]').check({ force: true });
  await expect(before).toBeVisible();
  await expect(after).toBeHidden();
  // A finger's swipe up or down scrolls the page: the stage leaves vertical panning to the page.
  expect(
    await before.locator('[data-rl-cube-stage]').evaluate((e) => getComputedStyle(e).touchAction),
  ).toBe('pan-y');
});

test('without WebGL the pictures stay and the cube’s controls hide', async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, kind: string) {
      if (/webgl/.test(kind)) return null;
      return (original as (k: string) => RenderingContext | null).call(this, kind);
    } as typeof original;
  });
  await page.goto(ROUTE_LAB);
  await cube(page).locator('[data-rl-cube-stage]').first().hover();
  await expect(page.locator('[data-rl-cube-controls]').first()).toBeHidden();
  await expect(canvases(page)).toHaveCount(0);
  await expect(page.locator('svg[data-rl-cube-picture]').first()).toBeVisible();
});

for (const colorScheme of ['dark', 'light'] as const) {
  test(`axe finds no violation with the cube on and the day half played, ${colorScheme}`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme });
    await page.goto(ROUTE_LAB);
    await turnOn(page);
    await slider(page).fill('5400');
    const results = await new AxeBuilder({ page })
      .include('[data-rl-cube]')
      .withTags(WCAG)
      .analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  });
}
