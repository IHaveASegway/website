import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { ROUTE_LAB } from './expected';

// The space-time cube on the Route Lab (ADR 0019), in a real WebGL context (SwiftShader in headless
// Chromium): without JavaScript it is two pictures drawn at build; three.js loads only on intent
// at the cube, never on a scroll, a finger's included; the canvas takes the picture's place with
// the first plans, its marks where the picture drew them and nothing below moving; a drag or a key
// turns both cubes; the slider moves through the day and is named for what it sets; Play runs,
// pauses, stops at the end, and steps under reduced motion; a plan change compiles no new GPU
// program; a lost context brings the pictures back for good; without WebGL nothing changes.

const NBSP = ' ';
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const cube = (page: Page) => page.locator('[data-rl-cube]');
const canvases = (page: Page) => cube(page).locator('canvas');
const slider = (page: Page) => page.locator('[data-rl-cube-time]');
const play = (page: Page) => page.locator('[data-rl-cube-play]');
const value = async (page: Page) => Number(await slider(page).inputValue());

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
  await expect(canvases(page).first()).toHaveAccessibleDescription(/arrow keys/);
});

test('a finger that scrolls the page from on the cube loads nothing; a tap loads the scene', async ({
  browser,
}) => {
  const context = await browser.newContext({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  const asked: string[] = [];
  page.on('request', (r) => asked.push(new URL(r.url()).pathname));
  await page.goto(ROUTE_LAB);
  const stage = cube(page).locator('[data-rl-cube-plan="after"] [data-rl-cube-stage]');
  await stage.scrollIntoViewIfNeeded();
  const box = await stage.boundingBox();
  if (!box) throw new Error('no stage');
  const cdp = await context.newCDPSession(page);
  await cdp.send('Input.synthesizeScrollGesture', {
    x: Math.round(box.x + box.width / 2),
    y: Math.round(box.y + box.height / 2),
    yDistance: -300,
    gestureSourceType: 'touch',
  });
  await page.waitForTimeout(300);
  expect(asked.filter((p) => isCube(p) || /\/_astro\/app\.|route-data/.test(p))).toEqual([]);
  await stage.tap();
  await expect(canvases(page)).toHaveCount(2);
  await context.close();
});

test('the canvas starts where the picture was: each hour mark lands on the picture’s mark', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(ROUTE_LAB);
  const stage = cube(page).locator('[data-rl-cube-stage]').first();
  // The picture's marks: each label's tick starts 36 units right of its text (SpaceTime.astro).
  const drawn = await stage.evaluate((host) => {
    const svg = host.querySelector('svg') as SVGSVGElement;
    const [x0 = 0, y0 = 0, w = 1, h = 1] = (svg.getAttribute('viewBox') ?? '')
      .split(' ')
      .map(Number);
    const r = svg.getBoundingClientRect();
    return [...svg.querySelectorAll('.rl-cube-hour')].map((t) => [
      ((Number(t.getAttribute('x')) + 36 - x0) / w) * r.width,
      ((Number(t.getAttribute('y')) - y0) / h) * r.height,
    ]);
  });
  await turnOn(page);
  const placed = await stage.evaluate((host) =>
    [...host.querySelectorAll<HTMLElement>('[data-rl-cube-marks] li')].map((li) => [
      parseFloat(li.style.left),
      parseFloat(li.style.top),
    ]),
  );
  expect(placed).toHaveLength(drawn.length);
  placed.forEach(([x = 0, y = 0], k) => {
    expect(Math.abs(x - (drawn[k]?.[0] ?? 0))).toBeLessThan(1.5);
    expect(Math.abs(y - (drawn[k]?.[1] ?? 0))).toBeLessThan(1.5);
  });
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

test('the slider is named for what it sets, says its time once, and moves through the day', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(ROUTE_LAB);
  await expect(slider(page)).toHaveAccessibleName('Time after leaving');
  // The visible clock repeats aria-valuetext for the eye; assistive technology hears it once.
  await expect(page.locator('[data-rl-cube-clock]')).toHaveAttribute('aria-hidden', 'true');
  await expect(cube(page).locator('output, [role="status"], [aria-live]')).toHaveCount(0);
  await turnOn(page);
  const first = await shot(page);
  await slider(page).fill('4800');
  await expect(page.locator('[data-rl-cube-clock]')).toHaveText(`1${NBSP}h 20${NBSP}min`);
  await expect(slider(page)).toHaveAttribute('aria-valuetext', `1${NBSP}h 20${NBSP}min`);
  await expect(slider(page)).toHaveAccessibleName('Time after leaving');
  expect(await shot(page)).not.toEqual(first);
});

test('Play runs, its button pauses it, and it stops by itself at the end', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(ROUTE_LAB);
  await turnOn(page);
  await slider(page).fill('4800');
  await play(page).click();
  await expect(play(page)).toHaveText('Pause');
  await expect.poll(() => value(page)).toBeGreaterThan(4800);
  await play(page).click();
  await expect(play(page)).toHaveText('Play the day');
  const paused = await value(page);
  await page.waitForTimeout(300);
  expect(await value(page)).toBe(paused);

  const max = Number(await slider(page).getAttribute('max'));
  await slider(page).fill(String(max - 120));
  await play(page).click();
  await expect(play(page)).toHaveText('Play the day', { timeout: 3_000 });
  expect(await value(page)).toBe(max);
});

test('under reduced motion Play steps half an hour a second instead of gliding', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(ROUTE_LAB);
  await turnOn(page);
  await play(page).click();
  const seen = new Set<number>();
  for (let k = 0; k < 12; k++) {
    seen.add(await value(page));
    await page.waitForTimeout(200);
  }
  expect([...seen].every((v) => v % 1800 === 0)).toBe(true);
  expect(Math.max(...seen)).toBeGreaterThanOrEqual(1800);
  await play(page).click();
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
});

test('a press of Play before the scene loaded is kept, and the day plays once it arrives', async ({
  page,
}) => {
  await page.goto(ROUTE_LAB);
  await play(page).click();
  await expect(canvases(page)).toHaveCount(2);
  await expect(play(page)).toHaveText('Pause');
  await expect.poll(() => value(page)).toBeGreaterThan(0);
});

test('a change of plan redraws the cube from the app’s plans, and compiles no new GPU program', async ({
  page,
}) => {
  // Counts the GPU programs every WebGL2 context on the page makes.
  await page.addInitScript(() => {
    const counts = { programs: 0 };
    Object.defineProperty(window, '__gl', { value: counts });
    const proto = WebGL2RenderingContext.prototype;
    const program = proto.createProgram;
    proto.createProgram = function (this: WebGL2RenderingContext) {
      counts.programs++;
      return program.call(this);
    };
  });
  const gl = () =>
    page.evaluate(() => (window as unknown as { __gl: { programs: number } }).__gl.programs);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(ROUTE_LAB);
  await turnOn(page);
  await slider(page).fill('3600');
  await page.waitForTimeout(100);
  const programs = await gl();
  const backs = cube(page).locator('[data-rl-cube-back]');
  await expect(slider(page)).toHaveAttribute('max', String(3 * 3600));
  // A quiet Tuesday: eight orders and one van, out longer than any van of a busy Saturday, so both
  // cubes' time axis grows to the whole hour after the longest day, together.
  await page.check('input[name="rl-day"][value="quiet"]');
  await expect(page.locator('[data-rl-status]')).toHaveText(/Planned in/, { timeout: 20_000 });
  await expect(backs.last()).not.toContainText('previous orders');
  await expect(backs.first()).not.toHaveText(`Last van back after 2${NBSP}h 53${NBSP}min`);
  const minutes = (await backs.allTextContents()).map((t) => {
    const [, h = '0', m = '0'] = /after (\d+)\u00a0h (\d+)\u00a0min/.exec(t) ?? [];
    return Number(h) * 60 + Number(m);
  });
  const longest = Math.max(...minutes) * 60;
  const max = Number(await slider(page).getAttribute('max'));
  expect(max % 3600).toBe(0);
  expect(max).toBeGreaterThanOrEqual(longest - 30);
  expect(max).toBeLessThan(longest + 3600 + 30);
  // A day VROOM has answered says no "Planned in" again: wait for its plan to be the one on show.
  for (const day of ['busy', 'everything', 'quiet']) {
    await page.check(`input[name="rl-day"][value="${day}"]`);
    await expect(page.locator('[data-rl-plan="after"]')).not.toHaveAttribute('data-rl-stale', '', {
      timeout: 20_000,
    });
  }
  for (let t = 0; t < 7200; t += 600) await slider(page).fill(String(t));
  await page.waitForTimeout(100);
  expect(await gl()).toBe(programs);
});

test('on a phone one cube shows, the one the map switch chooses, and it draws when chosen', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(ROUTE_LAB);
  const before = page.locator('[data-rl-cube-plan="before"]');
  const after = page.locator('[data-rl-cube-plan="after"]');
  await expect(after).toBeVisible();
  await expect(before).toBeHidden();
  // A finger's swipe up or down scrolls the page: the stage leaves vertical panning to the page.
  expect(
    await after.locator('[data-rl-cube-stage]').evaluate((e) => getComputedStyle(e).touchAction),
  ).toBe('pan-y');
  await after.locator('[data-rl-cube-stage]').click();
  await expect(canvases(page)).toHaveCount(2);
  await page.locator('input[name="rl-view"][value="before"]').check({ force: true });
  await expect(before.locator('canvas')).toBeVisible();
  await expect(after).toBeHidden();
  await expect
    .poll(() =>
      before
        .locator('[data-rl-cube-marks] li')
        .first()
        .evaluate((li: HTMLElement) => parseFloat(li.style.left || '0')),
    )
    .toBeGreaterThan(0);
});

test('a lost WebGL context brings the pictures back, and a later change leaves them', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(ROUTE_LAB);
  await turnOn(page);
  await page.check('input[name="rl-day"][value="quiet"]');
  await expect(page.locator('[data-rl-status]')).toHaveText(/Planned in/, { timeout: 20_000 });
  await canvases(page)
    .first()
    .evaluate((c: HTMLCanvasElement) => {
      c.getContext('webgl2')?.getExtension('WEBGL_lose_context')?.loseContext();
    });
  await expect(canvases(page)).toHaveCount(0);
  const pictures = page.locator('svg[data-rl-cube-picture]');
  await expect(pictures.first()).toBeVisible();
  await expect(page.locator('[data-rl-cube-controls]').first()).toBeHidden();
  // The captions say the build's day again, the day the pictures show.
  const backs = cube(page).locator('[data-rl-cube-back]');
  await expect(backs.first()).toHaveText(`Last van back after 2${NBSP}h 53${NBSP}min`);
  // Nothing listens any more: another change and a theme change bring nothing back.
  await page.check('input[name="rl-day"][value="busy"]');
  await page.emulateMedia({ colorScheme: 'light' });
  await page.waitForTimeout(300);
  await expect(canvases(page)).toHaveCount(0);
  await expect(cube(page).locator('[data-rl-cube-marks]').first()).toBeHidden();
  await expect(backs.first()).toHaveText(`Last van back after 2${NBSP}h 53${NBSP}min`);
});

test('without WebGL the pictures stay, the cube’s controls hide, and focus is not lost', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, kind: string) {
      if (/webgl/.test(kind)) return null;
      return (original as (k: string) => RenderingContext | null).call(this, kind);
    } as typeof original;
  });
  await page.goto(ROUTE_LAB);
  await slider(page).focus();
  await expect(page.locator('[data-rl-cube-controls]').first()).toBeHidden();
  await expect(canvases(page)).toHaveCount(0);
  await expect(page.locator('svg[data-rl-cube-picture]').first()).toBeVisible();
  await expect(cube(page)).toBeFocused();
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
