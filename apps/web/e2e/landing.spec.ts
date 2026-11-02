import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { ROUTE_LAB } from './expected';

// The run a visitor lands on (ADR 0030): each lab's demo is running when they arrive, with no press.
// Until 2026-11-02 a lab stood still until a press, and Joseph read that as a page not started. It
// holds back for a visitor who asked for less motion or to save data, and for one who pressed Pause
// earlier in the tab. It plays only while it's on the screen and says nothing to a screen reader,
// and the visitor's first press makes it theirs. e2e/steady.spec.ts checks that it moves nothing on a
// phone as it starts.

const LABS = [
  { name: 'raft', path: '/lab/raft/', short: 'rf' },
  { name: 'queue', path: '/lab/queue/', short: 'qu' },
  { name: 'cache', path: '/lab/cache/', short: 'cl' },
  { name: 'backfill', path: '/lab/backfill/', short: 'bf' },
] as const;

type Lab = (typeof LABS)[number];

const run = (page: Page, lab: Lab) => page.locator(`[data-${lab.short}-run]`);
const clock = (page: Page, lab: Lab) => page.locator(`[data-${lab.short}-clock]`);

/** Every script the page fetched past its eager one: a lab's simulation is the file named app. */
function appFetches(page: Page): string[] {
  const seen: string[] = [];
  page.on('request', (request) => {
    if (/\/_astro\/app\.[\w-]+\.js$/.test(new URL(request.url()).pathname))
      seen.push(request.url());
  });
  return seen;
}

for (const lab of LABS) {
  test.describe(`the ${lab.name} lab`, () => {
    test('a visitor lands on it running, with no press', async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(lab.path);
      await expect(run(page, lab)).toHaveText('Pause');
      await expect(run(page, lab)).toHaveAttribute('data-lamp', 'on');
      const first = await clock(page, lab).textContent();
      await expect(clock(page, lab)).not.toHaveText(first ?? '');
      expect(errors).toEqual([]);
    });

    test('axe finds no violation as it runs', async ({ page }) => {
      await page.goto(lab.path);
      await expect(run(page, lab)).toHaveText('Pause');
      const { violations } = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();
      expect(violations.map((v) => v.id)).toEqual([]);
    });

    test('under reduced motion it stands still and loads nothing', async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const fetched = appFetches(page);
      await page.goto(lab.path);
      const first = await clock(page, lab).textContent();
      await page.waitForTimeout(800);
      await expect(run(page, lab)).toHaveText('Run');
      await expect(clock(page, lab)).toHaveText(first ?? '');
      expect(fetched).toEqual([]);
    });

    test('a visitor saving data lands on it standing still', async ({ page }) => {
      await page.addInitScript(() =>
        Object.defineProperty(navigator, 'connection', { value: { saveData: true } }),
      );
      const fetched = appFetches(page);
      await page.goto(lab.path);
      await page.waitForTimeout(800);
      await expect(run(page, lab)).toHaveText('Run');
      expect(fetched).toEqual([]);
    });

    test('a link to a run opens that run paused, as it always has', async ({ page }) => {
      await page.goto(`${lab.path}#seed-12`);
      await page.waitForTimeout(800);
      await expect(run(page, lab)).toHaveText('Run');
    });

    test('Pause holds for the tab, on this lab and the next, until Run', async ({ page }) => {
      await page.goto(lab.path);
      await expect(run(page, lab)).toHaveText('Pause');
      await run(page, lab).click();
      await expect(run(page, lab)).toHaveText('Run');
      expect(await page.evaluate(() => sessionStorage.getItem('motion'))).toBe('paused');
      const first = await clock(page, lab).textContent();
      await page.waitForTimeout(700);
      await expect(clock(page, lab)).toHaveText(first ?? '');

      const next = LABS[(LABS.indexOf(lab) + 1) % LABS.length] as Lab;
      await page.goto(next.path);
      await page.waitForTimeout(800);
      await expect(run(page, next)).toHaveText('Run');

      await run(page, next).click();
      await expect(run(page, next)).toHaveText('Pause');
      expect(await page.evaluate(() => sessionStorage.getItem('motion'))).toBeNull();
    });

    test('it pauses off the screen and goes on when it comes back', async ({ page }) => {
      await page.goto(lab.path);
      await expect(run(page, lab)).toHaveText('Pause');
      await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
      await expect(run(page, lab)).toHaveText('Run');
      await page.evaluate(() => scrollTo(0, 0));
      await expect(run(page, lab)).toHaveText('Pause');
    });

    test('its live regions keep quiet until the first press, then speak', async ({ page }) => {
      await page.goto(lab.path);
      await expect(run(page, lab)).toHaveText('Pause');
      const said = page.locator(`#${lab.name}-lab [role="status"]`).first();
      await expect(said).toHaveAttribute('aria-live', 'off');
      await run(page, lab).click();
      await expect(said).not.toHaveAttribute('aria-live', 'off');
    });
  });
}

test.describe('the Route Lab', () => {
  const layers = (page: Page) => page.locator('[data-rl-fleet]');
  const drive = (page: Page) => page.locator('[data-rl-drive]').first();
  const time = (page: Page) =>
    layers(page)
      .first()
      .evaluate((svg) => (svg as SVGSVGElement).getCurrentTime());
  const paused = (page: Page) =>
    layers(page)
      .first()
      .evaluate((svg) => (svg as SVGSVGElement).animationsPaused());

  test('its vans are driving when a visitor lands, each on a route it draws', async ({ page }) => {
    await page.goto(ROUTE_LAB);
    await expect(layers(page).first()).toBeVisible();
    expect(await paused(page)).toBe(false);
    const start = await time(page);
    await expect.poll(() => time(page)).toBeGreaterThan(start);
    const routes = await page.evaluate(() =>
      [...document.querySelectorAll('[data-rl-fleet] mpath')].map((m) =>
        document.querySelector(m.getAttribute('href') ?? '') ? 'found' : m.getAttribute('href'),
      ),
    );
    expect(routes.length).toBeGreaterThan(0);
    expect(new Set(routes)).toEqual(new Set(['found']));
  });

  test('the button pauses them for the tab, and plays them', async ({ page }) => {
    await page.goto(ROUTE_LAB);
    await expect(drive(page)).toHaveText('Pause');
    await drive(page).click();
    await expect(drive(page)).toHaveText('Run');
    expect(await paused(page)).toBe(true);
    expect(await page.evaluate(() => sessionStorage.getItem('motion'))).toBe('paused');
    await drive(page).click();
    await expect(drive(page)).toHaveText('Pause');
    expect(await paused(page)).toBe(false);
  });

  test('under reduced motion they and their button are gone', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(ROUTE_LAB);
    await expect(layers(page).first()).toBeHidden();
    await expect(drive(page)).toBeHidden();
  });

  test('a new plan brings its own vans, and a tap still lands on the map', async ({ page }) => {
    await page.goto(ROUTE_LAB);
    const before = await layers(page).first().innerHTML();
    await page
      .locator('input[name="rl-vans"][value="2"]')
      .evaluate((radio: HTMLInputElement) => radio.click());
    await expect.poll(() => layers(page).first().innerHTML()).not.toBe(before);
    const pointer = await layers(page)
      .first()
      .evaluate((svg) => getComputedStyle(svg).pointerEvents);
    expect(pointer).toBe('none');
  });
});

test.describe('the indexes', () => {
  /** What on the page runs by the clock, by the class of what it moves. */
  const running = (page: Page) =>
    page.evaluate(() => [
      ...new Set(
        document
          .getAnimations()
          .filter((a) => a.timeline === document.timeline)
          .map((a) => (a.effect as KeyframeEffect).target?.getAttribute('class')?.split(' ')[0]),
      ),
    ]);
  const pulses = (page: Page) =>
    page.evaluate(
      () =>
        document.getAnimations().filter((a) => {
          const target = (a.effect as KeyframeEffect).target;
          return a.playState === 'running' && target?.matches('.field-pulse, .iso-spark');
        }).length,
    );

  test('/lab/ runs its glyphs’ sparks and the field’s pulses, under the top bar’s button', async ({
    page,
  }) => {
    await page.goto('/lab/');
    await expect
      .poll(() => running(page))
      .toEqual(expect.arrayContaining(['field-pulse', 'iso-spark']));
    await page.locator('[data-motion-toggle]').click();
    await expect.poll(() => pulses(page)).toBe(0);
  });

  test('/writing/ runs the field’s pulses under the top bar’s button', async ({ page }) => {
    await page.goto('/writing/');
    await expect.poll(() => running(page)).toEqual(expect.arrayContaining(['field-pulse']));
    await page.locator('[data-motion-toggle]').click();
    await expect.poll(() => pulses(page)).toBe(0);
  });

  test('a lab’s glyph runs with its demo, and stops with it', async ({ page }) => {
    await page.goto('/lab/raft/');
    const sparks = () => page.locator('.lab-head-glyph .iso-spark').first();
    await expect(page.locator('[data-rf-run]')).toHaveText('Pause');
    await expect(sparks()).toBeVisible();
    await page.locator('[data-rf-run]').click();
    await expect(sparks()).toBeHidden();
  });

  test('under reduced motion none of it runs', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    for (const path of ['/lab/', '/writing/']) {
      await page.goto(path);
      await page.waitForTimeout(400);
      expect(await running(page)).toEqual([]);
    }
  });
});
