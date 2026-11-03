import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { ROUTE_LAB } from './expected';

// What runs by itself (ADR 0030). Each lab's demo is running when a visitor lands, with no press:
// until 2026-11-02 a lab stood still until a press, and Joseph read that as a page not started. It
// holds back for a visitor who asked for less motion or to save data, and for one who pressed the top
// bar's Pause earlier in the tab. It plays only while it's on the screen and says nothing to a screen
// reader, and the visitor's first press makes it theirs. e2e/steady.spec.ts checks that it moves
// nothing on a phone as it starts.
//
// The field behind every page runs by its own clocks, and a scroll has nothing to do with it: tied to
// the scroll and fading with it, each turn of a wheel read as the page reloading.

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

    test('its own Pause stops it alone: the field runs on, and the next lab lands running', async ({
      page,
    }) => {
      await page.goto(lab.path);
      await expect(run(page, lab)).toHaveText('Pause');
      await run(page, lab).click();
      await expect(run(page, lab)).toHaveText('Run');
      const first = await clock(page, lab).textContent();
      await page.waitForTimeout(700);
      await expect(clock(page, lab)).toHaveText(first ?? '');
      await expect(page.locator('html')).toHaveAttribute('data-motion', 'on');
      expect(await page.evaluate(() => sessionStorage.getItem('motion'))).toBeNull();

      const next = LABS[(LABS.indexOf(lab) + 1) % LABS.length] as Lab;
      await page.goto(next.path);
      await expect(run(page, next)).toHaveText('Pause');
    });

    test('the top bar’s Pause stops it for the tab, and its Play starts it', async ({ page }) => {
      await page.goto(lab.path);
      await expect(run(page, lab)).toHaveText('Pause');
      await page.locator('[data-motion-toggle]').click();
      await expect(run(page, lab)).toHaveText('Run');
      expect(await page.evaluate(() => sessionStorage.getItem('motion'))).toBe('paused');

      const next = LABS[(LABS.indexOf(lab) + 1) % LABS.length] as Lab;
      await page.goto(next.path);
      await page.waitForTimeout(800);
      await expect(run(page, next)).toHaveText('Run');
      await page.locator('[data-motion-toggle]').click();
      await expect(run(page, next)).toHaveText('Pause');
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

// The labs on one set of controls (docs/lab.md, "The controls"). The Raft Lab's first thing to try is
// a fault, so it has no fix to replay.
const FIXES = [
  {
    name: 'queue',
    path: '/lab/queue/',
    short: 'qu',
    fix: 'label:has(input[name="qu-key"][value="on"])',
    quick: 'label:has(input[name="qu-speed"][value="5"])',
    back: 'Virtual time 1.',
    link: '#seed-28&key=on',
    words:
      "The idempotency key is on. The run starts over under it, at 1.500 s, before worker 2's crash.",
    log: '2.873 s Worker 1 finds order 18 in the record and does not print it again',
  },
  {
    name: 'cache',
    path: '/lab/cache/',
    short: 'cl',
    fix: '[data-cl-toggle="coalesce"]',
    quick: 'label:has(input[name="cl-speed"][value="2"])',
    back: 'Virtual time 2.',
    link: '#seed-7&coalesce=on',
    words: 'Coalescing is on. The run starts over under it, at 2.500 s, before the menu expires.',
    log: 'its readers miss, and each node sends one fetch for them all',
  },
  {
    name: 'backfill',
    path: '/lab/backfill/',
    short: 'bf',
    fix: 'label:has(input[name="bf-mode"][value="overwrite"])',
    quick: 'label:has(input[name="bf-speed"][value="30"])',
    back: '00:00',
    link: '#seed-9&mode=overwrite',
    words:
      'Loads now overwrite their day. The week starts over under it, at 00:00, before the job is switched on.',
    log: "Wednesday's load fails part way, and as its overwrite is one atomic step, the report is as it was",
  },
] as const;

for (const lab of FIXES) {
  test.describe(`the ${lab.name} lab, as a visitor who lands on it running tries the fix`, () => {
    const clockOf = (page: Page) => page.locator(`[data-${lab.short}-clock]`);
    const line = (page: Page) => page.locator('[data-said]').first();

    // Until 2026-11-02 a fix pressed on the run that was already going changed nothing they could
    // see: the crash or the stampede had been and gone, and the checks stayed Broken beside a lit fix.
    test('its first press replays the run under the fix, still running, and says so', async ({
      page,
    }) => {
      await page.goto(lab.path);
      const run = page.locator(`[data-${lab.short}-run]`);
      await expect(run).toHaveText('Pause');
      await page.locator(lab.quick).click();
      await page.locator(lab.fix).click();
      await expect(line(page)).toHaveText(lab.words);
      await expect(line(page)).toBeVisible();
      await expect(run).toHaveText('Pause');
      expect(new URL(page.url()).hash).toBe(lab.link);
      await expect(page.locator(`#${lab.name}-lab [data-${lab.short}-lines]`)).toContainText(
        lab.log,
        { timeout: 20_000 },
      );
    });

    test('Start over goes back to the same moment, and plays on if it was playing', async ({
      page,
    }) => {
      await page.goto(lab.path);
      const run = page.locator(`[data-${lab.short}-run]`);
      await expect(run).toHaveText('Pause');
      await page.locator(`[data-${lab.short}-reset]`).click();
      await expect(run).toHaveText('Pause');
      await expect(clockOf(page)).toContainText(lab.back);
      await expect(line(page)).toHaveText(/ starts over under these settings, at /);
      // Stood still, it asks for the press it waits for.
      await run.click();
      await expect(run).toHaveText('Run');
      await page.locator(`[data-${lab.short}-reset]`).click();
      await expect(run).toHaveText('Run');
      await expect(line(page)).toHaveText(/ Press Run to watch it\.$/);
    });

    test('until a press, its lines say what their controls do, and never what the run does', async ({
      page,
    }) => {
      await page.goto(lab.path);
      await expect(page.locator(`[data-${lab.short}-run]`)).toHaveText('Pause');
      await page.waitForTimeout(600);
      const lines = page.locator('[data-said]');
      await expect(lines).toHaveCount(2);
      for (const each of await lines.all()) {
        await expect(each).toBeVisible();
        await expect(each).not.toHaveAttribute('data-spoke');
        expect(await each.textContent()).toBe(await each.getAttribute('data-said'));
        // A screen reader can read what a sighted visitor reads here. It's the only place that says
        // what these controls do before they're pressed.
        expect(await each.evaluate((line) => line.closest('[aria-hidden="true"]'))).toBeNull();
      }
    });

    // A dropped connection, or a deploy that retired the hashed file while the page was open. Until
    // 2026-11-02 the only word of it was in a line a screen reader alone could reach.
    test('a load that fails says so on the screen, leaves the picture as drawn, and a press tries again', async ({
      page,
    }) => {
      const words = 'The lab did not load. Press any control to try again.';
      await page.route('**/_astro/app.*.js', (route) => route.abort());
      await page.goto(lab.path);
      await expect(line(page)).toHaveText(words);
      await expect(line(page)).toBeVisible();
      // Every line says it: a visitor at the settings on a phone is a thousand pixels from the first.
      await expect(page.locator('[data-said]').last()).toHaveText(words);
      await expect(page.locator(`[data-${lab.short}-said]`)).toHaveText(words);
      const run = page.locator(`[data-${lab.short}-run]`);
      const standing = await clockOf(page).textContent();
      await page.waitForTimeout(300);
      await expect(run).toHaveText('Run');
      await expect(clockOf(page)).toHaveText(standing ?? '');

      // With a connection, a fresh page is the way back: a browser may keep a failed import, as
      // WebKit does (steady.spec.ts), and a deploy's new file has another name.
      await page.unroute('**/_astro/app.*.js');
      await run.click();
      await expect(run).toHaveText('Pause');
      await expect(line(page)).not.toHaveText(words);
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

  test('their button pauses and plays them, and the top bar’s reaches them too', async ({
    page,
  }) => {
    await page.goto(ROUTE_LAB);
    await expect(drive(page)).toHaveText('Pause');
    await drive(page).click();
    await expect(drive(page)).toHaveText('Run');
    await expect(drive(page)).toHaveAccessibleName('Run the vans');
    expect(await paused(page)).toBe(true);
    await drive(page).click();
    await expect(drive(page)).toHaveText('Pause');
    expect(await paused(page)).toBe(false);

    await page.locator('[data-motion-toggle]').click();
    await expect(drive(page)).toHaveText('Run');
    expect(await paused(page)).toBe(true);
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

test.describe('the field', () => {
  /** What runs by the clock, by the class of what it moves. */
  const running = (page: Page) =>
    page.evaluate(() => [
      ...new Set(
        document
          .getAnimations()
          .filter((a) => a.timeline === document.timeline && a.playState === 'running')
          .map((a) => (a.effect as KeyframeEffect).target?.getAttribute('class')?.split(' ')[0]),
      ),
    ]);

  for (const path of ['/', '/lab/', '/writing/', '/about/', '/writing/trading-bot-teardown/']) {
    test(`${path}: the lines run by themselves, under the top bar’s button`, async ({ page }) => {
      await page.goto(path);
      await expect.poll(() => running(page)).toEqual(expect.arrayContaining(['field-run']));
      await page.locator('[data-motion-toggle]').click();
      await expect.poll(() => running(page)).not.toEqual(expect.arrayContaining(['field-run']));
    });
  }

  test('a scroll has nothing to do with them', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-motion', 'on');
    // Everything the scroll could touch, watched while the wheel turns.
    await page.evaluate(() => {
      const w = window as unknown as { changes: number };
      w.changes = 0;
      new MutationObserver((list) => (w.changes += list.length)).observe(
        document.querySelector('.field') as Element,
        { attributes: true, subtree: true, childList: true },
      );
    });
    const line = page.locator('.field-run').first();
    const state = () =>
      line.evaluate((element) => {
        const [animation] = element.getAnimations();
        return {
          clock: animation?.timeline === document.timeline,
          state: animation?.playState,
          time: Number(animation?.currentTime),
          opacity: getComputedStyle(element).opacity,
          now: document.timeline.currentTime as number,
        };
      });
    const before = await state();
    await page.mouse.move(600, 400);
    for (let tick = 0; tick < 8; tick++) {
      await page.mouse.wheel(0, 240);
      await page.waitForTimeout(60);
    }
    const after = await state();
    expect(await page.evaluate(() => scrollY)).toBeGreaterThan(0);
    expect(await page.evaluate(() => (window as unknown as { changes: number }).changes)).toBe(0);
    expect(after.clock).toBe(true);
    expect(after.state).toBe('running');
    expect(after.opacity).toBe(before.opacity);
    // Its time went on by exactly the time that passed: it didn't restart or jump with the scroll.
    const passed = after.now - before.now;
    expect(Math.abs(after.time - before.time - passed)).toBeLessThan(100);
  });

  test('a section’s line lights once, and stays lit as the page scrolls back', async ({ page }) => {
    await page.goto('/');
    const last = page.locator('.section').last();
    await expect(last).not.toHaveAttribute('data-lit');
    await last.scrollIntoViewIfNeeded();
    await expect(last).toHaveAttribute('data-lit');
    await page.evaluate(() => scrollTo(0, 0));
    await page.waitForTimeout(200);
    await expect(last).toHaveAttribute('data-lit');
    // A row lights when it reaches its height in the window, and stays lit past it.
    const row = page.locator('.build').first();
    await row.scrollIntoViewIfNeeded();
    await expect(row).toHaveAttribute('data-lit');
    await page.evaluate(() => scrollTo(0, 0));
    await expect(row).toHaveAttribute('data-lit');
  });

  test('under reduced motion none of it runs, and every line stands lit', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    for (const path of ['/', '/lab/', '/writing/']) {
      await page.goto(path);
      await page.waitForTimeout(400);
      expect(await running(page)).toEqual([]);
    }
    await page.goto('/');
    const scale = await page
      .locator('.section')
      .last()
      .evaluate((section) => getComputedStyle(section, '::before').scale);
    expect(scale).toBe('none');
  });

  test('/lab/ runs its glyphs’ sparks, and so does a lab’s page, under the same button', async ({
    page,
  }) => {
    for (const path of ['/lab/', '/lab/raft/']) {
      await page.goto(path);
      await expect.poll(() => running(page)).toEqual(expect.arrayContaining(['iso-spark']));
      await page.locator('[data-motion-toggle]').click();
      await expect.poll(() => running(page)).not.toEqual(expect.arrayContaining(['iso-spark']));
      await page.locator('[data-motion-toggle]').click();
    }
  });
});
