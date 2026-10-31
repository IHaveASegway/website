import { expect, test, type Page } from '@playwright/test';
import { pages } from './expected';

// The rail (ADR 0021) and Home's scene (ADR 0024). The rail stands down the left edge from 80rem
// and the header is the row across the top below that. Home's scene drives the Route Lab's day on
// a canvas over the build's picture: it moves, pauses on request (SC 2.2.2), lifts the day into the
// space-time cube as the page scrolls, stays the build's picture under reduced motion and without
// its data, never shifts the layout, and the Raft Lab's election runs and pauses with it.

const live = (page: Page) => page.locator('html[data-scene-live]');
const canvas = (page: Page) => page.locator('canvas[data-scene-live]');
const drawing = (page: Page) => page.locator('svg.scene-picture');
const toggle = (page: Page) => page.locator('[data-motion-toggle]');

/** The canvas's own pixels, read from its backing store. Not a screenshot of its box: the hero's
 *  words and the readout stand over the canvas, and a screenshot would change when they do, as a
 *  late font's first paint did on production on 2026-10-29. */
const frame = (page: Page) =>
  canvas(page).evaluate((c) => (c as HTMLCanvasElement).toDataURL('image/png'));

test.describe('the rail', () => {
  // On Home the rail carries no name, since Home's <h1> is the name (ADR 0025): the search field
  // heads it there, and the nav starts higher. On every other page the nav starts at one height.
  test('from 80rem the header is a rail down the left edge, as tall as the window, beside main', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const tops: number[] = [];
    const searchTops: number[] = [];
    for (const path of ['/', '/about/', '/lab/']) {
      await page.goto(path);
      const header = await page.locator('.masthead').boundingBox();
      const main = await page.locator('main').boundingBox();
      expect(header, path).not.toBeNull();
      expect(header?.x, path).toBe(0);
      expect(header?.height, path).toBe(900);
      expect(main?.x ?? 0, path).toBeGreaterThanOrEqual((header?.width ?? 0) - 0.5);
      expect(await page.locator('.site-header .wordmark').count(), path).toBe(path === '/' ? 0 : 1);
      tops.push((await page.locator('.site-nav').boundingBox())?.y ?? -1);
      searchTops.push((await page.locator('.rail-search').boundingBox())?.y ?? -1);
    }
    const [homeNav = 0, ...others] = tops;
    expect(new Set(others).size, `${tops}`).toBe(1);
    expect(homeNav).toBeLessThan(others[0] ?? 0);
    // The search field heads Home's rail, at the rail's own top padding.
    expect(searchTops[0]).toBeLessThan(searchTops[1] ?? 0);
    // It stays while the page scrolls.
    await page.goto('/about/');
    await page.mouse.wheel(0, 1200);
    await page.waitForFunction(() => scrollY > 600);
    expect((await page.locator('.site-nav').boundingBox())?.y).toBe(others[0]);
  });

  test('below 80rem the header is the row across the top, above main', async ({ page }) => {
    for (const width of [390, 1024, 1279]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/about/');
      const header = await page.locator('.masthead').boundingBox();
      const main = await page.locator('main').boundingBox();
      expect(header?.width, `${width}`).toBe(width);
      expect(main?.y ?? 0, `${width}`).toBeGreaterThanOrEqual(
        (header?.y ?? 0) + (header?.height ?? 0) - 0.5,
      );
    }
  });

  test('the page is marked by the 2 px bar in the rail, and by its underline in the row', async ({
    page,
  }) => {
    const mark = (selector: string) =>
      page.locator(selector).evaluate((link) => {
        const bar = getComputedStyle(link, '::before');
        return {
          bar: bar.content !== 'none' && bar.display !== 'none' ? bar.width : null,
          underline: getComputedStyle(link).textDecorationLine,
        };
      });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/about/');
    expect(await mark('.site-nav a[href="/about/"]')).toEqual({ bar: '2px', underline: 'none' });
    expect((await mark('.site-nav a.bar-only[href="/lab/"]')).bar).toBeNull();
    await page.setViewportSize({ width: 1024, height: 900 });
    expect(await mark('.site-nav a[href="/about/"]')).toEqual({
      bar: null,
      underline: 'underline',
    });
  });

  // ADR 0022: the rail is an index, so Tab passes the search field and each item's leaves too, top
  // to bottom as they stand, before main. Since ADR 0023 an item's leaves are in its drop-down, so
  // on a demo, where Lab stands open, every demo and "View all demos" come between Lab and
  // Writing; Writing, closed, is one stop.
  test('Tab goes from the skip link through the rail, in order, then into main', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const demos = pages().filter((path) => /^\/lab\/[^/]+\/$/.test(path));
    await page.goto(demos[0] ?? '/lab/');
    await page.waitForFunction(() => 'palette' in document.documentElement.dataset);
    const stops: { name: string; href: string | null; y: number }[] = [];
    for (let i = 0; i < 24; i++) {
      await page.keyboard.press('Tab');
      stops.push(
        await page.evaluate(() => {
          const at = document.activeElement;
          if (!at || at.closest('main')) return { name: 'main', href: null, y: 0 };
          // Its name as assistive technology reads it: what aria-hidden leaves, such as the keys
          // shown beside the search field's words.
          const read = at.cloneNode(true) as Element;
          for (const hidden of read.querySelectorAll('[aria-hidden="true"]')) hidden.remove();
          return {
            name: (at.getAttribute('aria-label') ?? read.textContent ?? '')
              .replace(/\s+/g, ' ')
              .trim(),
            href: at.getAttribute('href'),
            y: at.getBoundingClientRect().y,
          };
        }),
      );
      if (stops.at(-1)?.name === 'main') break;
    }
    const names = stops.map((stop) => stop.name);
    expect(names.slice(0, 3)).toEqual(['Skip to content', 'Joseph Peterson', 'Search']);
    expect(names.at(-1)).toBe('main');
    const items = ['Lab', 'Writing', 'About'].filter(
      (step) => step !== 'Writing' || pages().includes('/writing/'),
    );
    expect(names.filter((name) => items.includes(name))).toEqual(items);
    const lab = names.indexOf('Lab');
    expect(stops.slice(lab + 1, lab + 2 + demos.length).map((stop) => stop.href)).toEqual([
      ...demos,
      '/lab/',
    ]);
    // Each stop after the skip link stands below the one before it.
    const ys = stops.slice(1, -1).map((stop) => stop.y);
    expect(ys).toEqual([...ys].sort((a, b) => a - b));
  });
});

/**
 * Home with time in the test's hands: once the page has loaded, frames come only when the test
 * runs the clock. On a shared CI runner a canvas is slow enough that the governor could pause the
 * scene mid-test, which is right for a visitor and wrong for a test; the governor has unit tests of
 * its own.
 */
async function home(page: Page) {
  await page.clock.install({ time: 0 });
  await page.goto('/');
  await page.clock.pauseAt(60_000);
  await page.clock.runFor(1_000);
  await expect(live(page)).toHaveCount(1);
}

/** Scrolls the window to `y` and waits for its scroll event. The page's clock is the test's, but
 *  the browser dispatches a scroll on its own next frame, so running the clock before it would run
 *  no frame the scroll asked for. */
const scrollToY = (page: Page, y: number) =>
  page.evaluate(
    (to) =>
      new Promise((done) => {
        addEventListener('scroll', () => done(null), { once: true });
        scrollTo(0, to);
      }),
    y,
  );

/** What the readout's clock says. */
const clock = (page: Page) => page.locator('[data-scene-clock]').textContent();

/** The play state of the Raft Lab's messages, each distinct one once. */
const election = (page: Page) =>
  page.evaluate(() => [
    ...new Set(
      [...document.querySelectorAll('.iso-cluster .iso-packet')].flatMap((p) =>
        p.getAnimations().map((a) => a.playState),
      ),
    ),
  ]);

test.describe("Home's scene", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('it takes over from the picture, drives the day, pauses and plays, and the choice lasts the tab', async ({
    page,
  }) => {
    await home(page);
    await expect(canvas(page)).toBeVisible();
    await expect(drawing(page)).toBeHidden();
    await expect(canvas(page)).toHaveAttribute('aria-hidden', 'true');
    await expect(toggle(page)).toBeVisible();
    await expect(toggle(page)).toHaveAccessibleName('Pause motion');
    // The readout's sentence stays for assistive technology; the live clock counts on screen.
    await expect(page.locator('.scene-hud-done')).toHaveCount(1);
    expect(await clock(page)).toMatch(/^\+\d.* of \d+ delivered$/);

    const a = await frame(page);
    const before = await clock(page);
    await page.clock.runFor(2_000);
    expect(a === (await frame(page)), 'it moves').toBe(false);
    expect(await clock(page), 'the clock counts').not.toBe(before);

    await toggle(page).click();
    await expect(toggle(page)).toHaveAccessibleName('Play motion');
    await expect(page.locator('html')).toHaveAttribute('data-motion', 'paused');
    await page.clock.runFor(1_000);
    const c = await frame(page);
    await page.clock.runFor(1_000);
    expect(c === (await frame(page)), 'paused, it holds still').toBe(true);
    expect(await page.evaluate(() => sessionStorage.getItem('motion'))).toBe('paused');

    await page.reload();
    await page.clock.runFor(1_000);
    await expect(live(page)).toHaveCount(1);
    await expect(toggle(page)).toHaveAccessibleName('Play motion');
    await toggle(page).click();
    await expect(toggle(page)).toHaveAccessibleName('Pause motion');
    expect(await page.evaluate(() => sessionStorage.getItem('motion'))).toBeNull();
  });

  // Paused, the clock stands still, so a frame changes only with the visitor's own scroll: the
  // Route Lab's chapter coming up the window lifts the day into the cube, and going back sets it
  // down again on the same frame.
  test('scrolling to the Route Lab lifts the day into the cube, and scrolling back sets it down', async ({
    page,
  }) => {
    await home(page);
    await toggle(page).click();
    await page.mouse.move(60, 880);
    await page.clock.runFor(3_000);
    const flat = await frame(page);
    await scrollToY(page, 900);
    await page.clock.runFor(3_000);
    expect((await frame(page)) === flat, 'lifted, the frame changes').toBe(false);
    await scrollToY(page, 0);
    await page.clock.runFor(3_000);
    expect((await frame(page)) === flat, 'set down, the same frame again').toBe(true);
  });

  test('the Raft Lab’s election runs with the scene and pauses with its button', async ({
    page,
  }) => {
    await home(page);
    expect(await election(page)).toEqual(['running']);
    await toggle(page).click();
    expect(await election(page)).toEqual(['paused']);
  });

  test('it shifts nothing, and is never the largest paint', async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { shifts: number; largest: string };
      w.shifts = 0;
      w.largest = '';
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as (PerformanceEntry & { value: number })[])
          w.shifts += entry.value;
      }).observe({ type: 'layout-shift', buffered: true });
      new PerformanceObserver((list) => {
        const last = list.getEntries().at(-1) as
          (PerformanceEntry & { element?: Element }) | undefined;
        w.largest = last?.element?.localName ?? '';
      }).observe({ type: 'largest-contentful-paint', buffered: true });
    });
    await home(page);
    await expect(toggle(page)).toBeVisible();
    await page.clock.runFor(500);
    const { shifts, largest } = await page.evaluate(() => {
      const w = window as unknown as { shifts: number; largest: string };
      return { shifts: w.shifts, largest: w.largest };
    });
    expect(shifts).toBe(0);
    expect(largest).not.toBe('canvas');
  });

  test('under reduced motion the picture stays, nothing loads, and there is no button', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const loaded: string[] = [];
    page.on('request', (r) => /route-scene|scene\.json/.test(r.url()) && loaded.push(r.url()));
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);
    await expect(live(page)).toHaveCount(0);
    await expect(drawing(page)).toBeVisible();
    await expect(canvas(page)).toBeHidden();
    await expect(page.locator('.motion-item')).toBeHidden();
    await expect(page.locator('.scene-hud-done')).toBeVisible();
    expect(loaded).toEqual([]);
  });

  test('without its data the picture stays, and the button keeps its place unseen', async ({
    page,
  }) => {
    await page.route('**/scene.json', (route) => route.abort());
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);
    await expect(live(page)).toHaveCount(0);
    await expect(drawing(page)).toBeVisible();
    await expect(toggle(page)).toBeHidden();
    await expect(page.locator('.motion-item')).toHaveCSS('visibility', 'hidden');
    expect(await election(page)).toEqual([]);
  });

  test('no other page has the canvas or the button', async ({ page }) => {
    for (const path of pages().filter((p) => p !== '/')) {
      await page.goto(path);
      await expect(canvas(page), path).toHaveCount(0);
      await expect(toggle(page), path).toHaveCount(0);
    }
  });
});

/** Where the stage's parts stand, in the window's pixels, and the name's size. */
const stageLayout = (page: Page) =>
  page.evaluate(() => {
    const box = (selector: string) => {
      const found = document.querySelector(selector);
      if (!found) throw new Error(`no ${selector}`);
      const { left, top, right, bottom, width, height } = found.getBoundingClientRect();
      return { left, top, right, bottom, width, height };
    };
    return {
      window: { width: document.documentElement.clientWidth, height: innerHeight },
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      main: box('main'),
      name: box('.hero-name'),
      side: box('.hero-side'),
      picture: box('.scene-picture'),
      chapter: box('[data-stage-chapter]'),
      covers: box('.card-covers'),
      how: box('#how'),
      size: getComputedStyle(document.querySelector('.hero-name') as Element).fontSize,
    };
  });

// On a phone the Route Lab's chapter opens below the scene's band, on the page's own background
// (home.css). Until 2026-10-30 a later rule with the same specificity won, the chapter centred its
// words in a screen-tall box, and its title ran through the readout and over the live scene. Every
// check above runs at 1440 × 900, so none of them saw it.
test.describe("Home's scene on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("the Route Lab's words start below the scene's band, not over it", async ({ page }) => {
    await page.goto('/');
    const gap = await page.locator('[data-stage-chapter]').evaluate((chapter) => {
      const title = chapter.querySelector('.card-title') as HTMLElement;
      return title.getBoundingClientRect().top - chapter.getBoundingClientRect().top;
    });
    // Above 52svh the chapter's background is transparent, and the scene shows through it.
    expect(gap).toBeGreaterThanOrEqual(844 * 0.52);
  });
});

// A larger screen than 1440 × 900 (ADR 0024, "A larger screen"): until 2026-10-29 the stage kept
// its 1440 sizes while the window grew, and a large screen showed a small picture floating in an
// empty one. Now the room goes to the scene, and the type keeps its size (SC 1.4.4).
test.describe("Home's stage on a larger screen", () => {
  test('the scene fills the room beside the words, which keep the frame and stand level with it', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    const design = await stageLayout(page);
    // Above the words, less what is below them: what the composition leaves at 1440 × 900.
    const offset = design.name.top - (design.window.height - design.side.bottom);
    for (const [width, height] of [
      [1920, 1080],
      [2560, 1440],
      [3440, 1440],
    ] as const) {
      await page.setViewportSize({ width, height });
      await page.goto('/');
      const at = await stageLayout(page);
      const where = `${width} × ${height}`;
      expect(at.overflow, where).toBe(0);
      // The scene's box runs to the window's right edge and nearly its full height, past the
      // Route Lab chapter's words, and the cards that cover the scene reach the column's edges.
      expect(at.picture.right, where).toBeCloseTo(at.window.width, 0);
      expect(at.picture.height, where).toBeGreaterThan(at.window.height * 0.85);
      expect(at.picture.left, where).toBeGreaterThanOrEqual(at.chapter.right + 32 - 0.5);
      expect([at.covers.left, at.covers.width], where).toEqual([at.main.left, at.main.width]);
      // The words start at the frame's edge, as every row below them does, at the name's size.
      expect(at.side.left, where).toBeCloseTo(at.how.left, 0);
      expect(at.size, where).toBe(design.size);
      // A taller window divides its extra height evenly above and below the words.
      const above = at.name.top;
      const below = at.window.height - at.side.bottom;
      expect(Math.abs(above - below - offset), where).toBeLessThanOrEqual(2);
    }
  });
});
