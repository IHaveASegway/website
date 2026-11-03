import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { ROUTE_LAB, SOLVER } from './expected';

// The space-time cube on the Route Lab (ADR 0019), in a real WebGL context (SwiftShader in headless
// Chromium): without JavaScript it is two pictures drawn at build; the pictures and the words over
// them follow the plan on show, with no three.js and no WebGL; three.js loads only on intent
// at the cube, never on a scroll, a finger's included; the canvas takes the picture's place with
// the first plans, its marks where the picture drew them and nothing below moving; Tab reaches
// each cube from the first paint, in order, with the focus ring on it; a drag or a key turns both; the slider moves through the day and is named for what it sets; Play runs,
// pauses, stops at the end, and steps under reduced motion; a plan change compiles no new GPU
// program; a lost context brings the pictures back for good; without WebGL the pictures stay.

const NBSP = ' ';
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const cube = (page: Page) => page.locator('[data-rl-cube]');
const canvases = (page: Page) => cube(page).locator('canvas');
/** Each cube's frame: the picture, then the canvas, inside it; the stop for Tab and the keys. */
const frames = (page: Page) => cube(page).locator('[data-rl-cube-stage]');
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
  // Nothing turns a picture: it is no stop for Tab.
  for (const frame of await frames(page).all()) await expect(frame).not.toHaveAttribute('tabindex');
  await context.close();
});

// A quiet Tuesday, 8 orders and one van, as both plans draw it: dealt in turn back after 3 h 40 min,
// VROOM back after 2 h 48 min, on a time axis of 4 hours. The opening day says 2 h 53 and 2 h 20.
const quiet = async (page: Page) => {
  const backs = cube(page).locator('[data-rl-cube-back]');
  await expect(backs.first()).toHaveText(`Last van back after 3${NBSP}h 40${NBSP}min`, {
    timeout: 20_000,
  });
  await expect(backs.last()).toHaveText(`Last van back after 2${NBSP}h 48${NBSP}min`, {
    timeout: 20_000,
  });
  const pictures = page.locator('svg[data-rl-cube-picture]');
  for (const picture of await pictures.all()) {
    await expect(picture.locator('.rl-route')).toHaveCount(1);
    await expect(picture.locator('.rl-stop')).toHaveCount(8);
    await expect(picture.locator('.rl-cube-hour')).toHaveText(['1 h', '2 h', '3 h', '4 h']);
  }
  await expect(pictures.first().locator('title')).toHaveText(
    /^As the orders came in, in time: .* back after 3\u00a0h 40\u00a0min\.$/,
  );
  await expect(pictures.last().locator('title')).toHaveText(
    /^Planned by VROOM, in time: .* back after 2\u00a0h 48\u00a0min\.$/,
  );
  await expect(slider(page)).toHaveAttribute('max', String(4 * 3600));
};

/** Chooses a day from the page itself: with no pointer anywhere, and none near the cube. A real tap
 *  and a scroll fire a mouse's pointerover on the cube in WebKit, which loads the scene and hides
 *  the case this is for: a finger that never touches the cube. */
const chooseDay = (page: Page, day: string) =>
  page
    .locator(`input[name="rl-day"][value="${day}"]`)
    .evaluate((radio: HTMLInputElement) => radio.click());

test('on a finger’s change of day the cube’s pictures and words follow the maps, with no three.js', async ({
  browser,
}) => {
  const context = await browser.newContext({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 390, height: 664 },
  });
  const page = await context.newPage();
  const asked: string[] = [];
  page.on('request', (r) => asked.push(new URL(r.url()).pathname));
  await page.goto(ROUTE_LAB);
  await chooseDay(page, 'quiet');
  await quiet(page);
  await expect(page.locator('[data-rl-plan="after"] [data-rl-back]')).toHaveText(
    `Last van back after 2${NBSP}h 48${NBSP}min`,
  );
  await expect(canvases(page)).toHaveCount(0);
  await expect(cube(page).locator('[data-rl-cube-plan="after"] svg')).toBeVisible();
  expect(asked.filter(isCube)).toEqual([]);
  await context.close();
});

test('while VROOM plans, the words over its cube say the plan on show is for the previous orders', async ({
  page,
  context,
}) => {
  let hold = true;
  await context.route(`**${SOLVER}vroom-worker.mjs`, async (route) => {
    while (hold) await new Promise((resolve) => setTimeout(resolve, 50));
    await route.continue();
  });
  await page.goto(ROUTE_LAB);
  await chooseDay(page, 'quiet');
  const backs = cube(page).locator('[data-rl-cube-back]');
  // The plan as dealt waits with it, so the two pictures stand on one set of orders until it answers.
  await expect(backs.first()).toHaveText(`Last van back after 2${NBSP}h 53${NBSP}min`);
  await expect(backs.last()).toHaveText('For the previous orders');
  // VROOM's picture still draws the plan it says it does: three vans, for the opening day's orders.
  const pictures = page.locator('svg[data-rl-cube-picture]');
  await expect(pictures.last().locator('.rl-route')).toHaveCount(3);
  await expect(pictures.last().locator('title')).toHaveText(
    /^Planned by VROOM, for the previous orders, in time: /,
  );
  hold = false;
  await quiet(page);
});

test('back on the opening day the pictures are what the build drew, to the byte', async ({
  page,
}) => {
  await page.goto(ROUTE_LAB);
  const drawn = () =>
    page.evaluate(() =>
      [
        ...document.querySelectorAll(
          '[data-rl-cube-day], [data-rl-cube-back], [data-rl-cube] title',
        ),
      ]
        .map((node) => node.innerHTML)
        .join('\n'),
    );
  const built = await drawn();
  await chooseDay(page, 'quiet');
  await quiet(page);
  expect(await drawn()).not.toBe(built);
  await chooseDay(page, 'busy');
  await expect.poll(drawn, { timeout: 20_000 }).toBe(built);
});

test('a day that takes all of 24 hours says every third hour on the pillar, and marks every one', async ({
  page,
}) => {
  await page.goto(ROUTE_LAB);
  await chooseDay(page, 'everything');
  await page
    .locator('input[name="rl-vans"][value="1"]')
    .evaluate((radio: HTMLInputElement) => radio.click());
  const picture = page.locator('svg[data-rl-cube-picture]').first();
  await expect(picture.locator('.rl-cube-hour')).toHaveText(
    [3, 6, 9, 12, 15, 18, 21, 24].map((h) => `${h} h`),
    { timeout: 20_000 },
  );
  await expect(picture.locator('.rl-cube-tick')).toHaveCount(24);
  await expect(slider(page)).toHaveAttribute('max', String(24 * 3600));
});

for (const scene of [false, true]) {
  test(`with no orders the cube says nothing of a day, as the maps do, ${scene ? 'in the scene' : 'in its picture'}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(ROUTE_LAB);
    if (scene) await turnOn(page);
    await page.evaluate(() => {
      for (const box of document.querySelectorAll<HTMLInputElement>(
        'input[name="rl-order"]:checked',
      ))
        box.click();
    });
    const backs = cube(page).locator('[data-rl-cube-back]');
    await expect(backs).toHaveText(['', ''], { timeout: 20_000 });
    await expect(page.locator('[data-rl-back]')).toHaveText(['', '']);
    await expect(page.locator('svg[data-rl-cube-picture]').first().locator('title')).toHaveText(
      /No van leaves\.$/,
    );
    await expect(page.locator('svg[data-rl-cube-picture] .rl-route')).toHaveCount(0);
    if (scene) await expect(frames(page).first()).toHaveAccessibleName(/No van leaves\.$/);
  });
}

test('the hint says what this screen can do: its cubes, and keys where there are keys', async ({
  browser,
}) => {
  const hint = async (options: Parameters<typeof browser.newContext>[0]) => {
    const context = await browser.newContext(options);
    const page = await context.newPage();
    await page.goto(ROUTE_LAB);
    const shown = (await page.locator('[data-rl-cube-hint]').innerText()).trim();
    const described = frames(page).locator('visible=true').first();
    await expect(described).toHaveAccessibleDescription(shown);
    await context.close();
    return shown;
  };
  // Playwright's `isMobile` needs Chromium's touch emulation for (pointer: coarse).
  expect(
    await hint({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 664 } }),
  ).toBe('Drag the cube sideways to turn it.');
  expect(await hint({ viewport: { width: 700, height: 900 } })).toBe(
    'Drag the cube sideways to turn it. Or focus it and use the arrow keys.',
  );
  expect(await hint({ viewport: { width: 1440, height: 900 } })).toBe(
    'Drag a cube sideways to turn both. Or focus one and use the arrow keys.',
  );
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
  await expect(frames(page).first()).toHaveAttribute('role', 'img');
  await expect(frames(page).first()).toHaveAccessibleName(/^As the orders came in, in time/);
  await expect(frames(page).first()).toHaveAccessibleDescription(/arrow keys/);
  await expect(canvases(page).first()).not.toHaveAttribute('tabindex');
});

for (const [width, height, cubes] of [
  [1280, 900, ['As the orders came in', 'Planned by VROOM']],
  [390, 844, ['Planned by VROOM']],
] as const) {
  test(`at ${width} px Tab reaches each cube shown, in order, before the slider, with its ring, and its keys turn it`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await page.goto(ROUTE_LAB);
    // From the last link before the cube, as a keyboard user arrives: before three.js is here.
    await page
      .locator('#route-lab')
      .getByRole('link', { name: 'OpenStreetMap contributors' })
      .focus();
    for (const name of cubes) {
      await page.keyboard.press('Tab');
      const focused = page.locator(':focus');
      await expect(focused).toHaveAttribute('data-rl-cube-stage', '');
      await expect(focused).toHaveAccessibleName(new RegExp(`^${name}, in time`));
      expect(
        await focused.evaluate((e) => {
          const style = getComputedStyle(e);
          return [e.matches(':focus-visible'), style.outlineStyle, style.outlineWidth];
        }),
      ).toEqual([true, 'solid', '2px']);
      // The focus loaded the scene; the keys turn the cube on show.
      await expect(focused.locator('canvas')).toBeVisible();
      await expect(cube(page).locator('[data-rl-cube-marks] li').first()).toBeAttached();
      const before = await focused.locator('canvas').screenshot();
      await page.keyboard.press('ArrowLeft');
      await expect.poll(() => focused.locator('canvas').screenshot()).not.toEqual(before);
      await expect(focused).toBeFocused();
    }
    await page.keyboard.press('Tab');
    await expect(slider(page)).toBeFocused();
  });
}

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

// What the hint tells a phone to do. A drag fires no click, so until 2026-11-02 it did nothing until
// a tap had loaded the scene: the hint's one instruction didn't work the first time.
test('a finger’s drag sideways on the picture loads the scene and goes on to turn it', async ({
  browser,
}) => {
  const context = await browser.newContext({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 390, height: 664 },
  });
  const page = await context.newPage();
  const asked: string[] = [];
  page.on('request', (r) => asked.push(new URL(r.url()).pathname));
  await page.goto(ROUTE_LAB);
  await expect(page.locator('[data-rl-cube-hint]')).toHaveText(/^\s*Drag the cube sideways/);
  const stage = cube(page).locator('[data-rl-cube-plan="after"] [data-rl-cube-stage]');
  await stage.scrollIntoViewIfNeeded();
  const box = await stage.boundingBox();
  if (!box) throw new Error('no stage');
  const cdp = await context.newCDPSession(page);
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x = 0) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: type === 'touchEnd' ? [] : [{ x: box.x + x, y: box.y + box.height / 2 }],
    });

  // A finger settling on the picture is no drag.
  await touch('touchStart', 60);
  await touch('touchMove', 66);
  await page.waitForTimeout(300);
  expect(asked.filter(isCube)).toEqual([]);
  await touch('touchMove', 90);
  await expect(canvases(page)).toHaveCount(2);
  const canvas = cube(page).locator('[data-rl-cube-plan="after"] canvas');
  await expect(canvas).toBeVisible();
  await expect
    .poll(() => canvas.evaluate((c: HTMLCanvasElement) => c.width), { timeout: 20_000 })
    .toBeGreaterThan(0);

  // The same finger, still down: the scene came under it, and it turns the scene.
  const first = await canvas.screenshot();
  await touch('touchMove', 120);
  await touch('touchMove', 180);
  await expect.poll(() => canvas.screenshot()).not.toEqual(first);
  await touch('touchEnd');

  // And the next drag, on the canvas itself.
  const second = await canvas.screenshot();
  await touch('touchStart', 60);
  await touch('touchMove', 120);
  await touch('touchMove', 180);
  await touch('touchEnd');
  await expect.poll(() => canvas.screenshot()).not.toEqual(second);
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
  await frames(page).first().focus();
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

// The scene takes over from the picture at the same angle, so the picture draws what the scene does:
// until 2026-11-03 the band edges went from dotted to thin under a mouse, and Van C's line from a
// string of round dots to fine ones.
test('the still picture draws the band edges and the dashes as the scene does', async ({
  page,
}) => {
  await page.goto(ROUTE_LAB);
  const picture = page.locator('svg[data-rl-cube-picture]').first();
  const look = await picture.evaluate((svg) => {
    const route = svg.querySelector('.rl-route.van-c') as Element;
    const style = getComputedStyle(svg);
    return {
      edge: style.getPropertyValue('--rl-contour-dash').trim(),
      cap: getComputedStyle(route).strokeLinecap,
    };
  });
  expect(look).toEqual({ edge: 'none', cap: 'butt' });
  // The maps keep their dots.
  const map = page.locator('svg[data-rl-map]').first();
  expect(
    await map.evaluate((svg) => getComputedStyle(svg).getPropertyValue('--rl-contour-dash').trim()),
  ).toBe('');
});

// One button, one meaning (ADR 0030). Until 2026-11-03 the slider ran on under the top bar's Pause.
test('the top bar’s Pause stops the day playing, and its Play starts only what it stopped', async ({
  page,
}) => {
  const bar = page.locator('[data-motion-toggle]');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(ROUTE_LAB);
  await turnOn(page);
  await play(page).click();
  await expect(play(page)).toHaveText('Pause');
  await expect.poll(() => value(page)).toBeGreaterThan(0);
  await bar.click();
  await expect(play(page)).toHaveText('Play the day');
  const stopped = await value(page);
  await page.waitForTimeout(300);
  expect(await value(page)).toBe(stopped);
  await bar.click();
  await expect(play(page)).toHaveText('Pause');
  await expect.poll(() => value(page)).toBeGreaterThan(stopped);
  // Stopped by hand, it stays stopped.
  await play(page).click();
  await bar.click();
  await bar.click();
  await expect(bar).toHaveAttribute('aria-label', 'Pause motion');
  await expect(play(page)).toHaveText('Play the day');
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

test('a lost WebGL context brings the pictures back, on the plan on show, for good', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(ROUTE_LAB);
  await turnOn(page);
  await page.check('input[name="rl-day"][value="quiet"]');
  await expect(page.locator('[data-rl-status]')).toHaveText(/Planned in/, { timeout: 20_000 });
  await quiet(page);
  await canvases(page)
    .first()
    .evaluate((c: HTMLCanvasElement) => {
      c.getContext('webgl2')?.getExtension('WEBGL_lose_context')?.loseContext();
    });
  await expect(canvases(page)).toHaveCount(0);
  const pictures = page.locator('svg[data-rl-cube-picture]');
  await expect(pictures.first()).toBeVisible();
  await expect(page.locator('[data-rl-cube-controls]').first()).toBeHidden();
  // Nothing turns the pictures now: neither is a stop for Tab, and each is named by its picture.
  for (const frame of await frames(page).all()) {
    await expect(frame).not.toHaveAttribute('tabindex');
    await expect(frame).not.toHaveAttribute('role');
  }
  // The pictures and the words over them are the day on the maps: they followed it under the canvas
  // (until 2026-11-02 they went back to the opening day, under another day's maps).
  await quiet(page);
  // The scene listens no more, so another change and a theme change bring no canvas back; the
  // pictures go on following the maps.
  const backs = cube(page).locator('[data-rl-cube-back]');
  await page.check('input[name="rl-day"][value="busy"]');
  await page.emulateMedia({ colorScheme: 'light' });
  await page.waitForTimeout(300);
  await expect(canvases(page)).toHaveCount(0);
  await expect(cube(page).locator('[data-rl-cube-marks]').first()).toBeHidden();
  await expect(backs.first()).toHaveText(`Last van back after 2${NBSP}h 53${NBSP}min`);
  await expect(pictures.first().locator('.rl-route')).toHaveCount(3);
});

test('without WebGL the pictures and their words follow the plan, the same as with it', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, kind: string) {
      if (/webgl/.test(kind)) return null;
      return (original as (k: string) => RenderingContext | null).call(this, kind);
    } as typeof original;
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(ROUTE_LAB);
  // The mouse over the cube tries the scene, which this browser cannot draw.
  await cube(page).locator('[data-rl-cube-stage]').first().hover();
  await expect(page.locator('[data-rl-cube-controls]').first()).toBeHidden();
  await chooseDay(page, 'quiet');
  await quiet(page);
  await expect(canvases(page)).toHaveCount(0);
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

test('without WebGL a focused cube leaves the tab order, and focus moves to its section', async ({
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
  await frames(page).first().focus();
  await expect(cube(page)).toBeFocused();
  for (const frame of await frames(page).all()) await expect(frame).not.toHaveAttribute('tabindex');
  await expect(page.locator('svg[data-rl-cube-picture]').first()).toHaveAccessibleName(
    /^As the orders came in, in time/,
  );
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
