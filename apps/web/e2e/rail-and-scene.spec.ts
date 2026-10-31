import { expect, test, type Page } from '@playwright/test';
import { pages } from './expected';

// Home's scene (ADR 0024, ADR 0025). Home's scene drives the Route Lab's
// day on a canvas over the build's picture: it moves, pauses on request (SC 2.2.2), lifts the day
// into the space-time cube as the page scrolls, stays the build's picture under reduced motion and
// without its data, never shifts the layout, and the board's day runs and pauses with it. The map
// lies on the water beside the words: its west edge just past the column at every width.

const live = (page: Page) => page.locator('html[data-scene-live]');
const canvas = (page: Page) => page.locator('canvas[data-scene-live]');
const drawing = (page: Page) => page.locator('svg.scene-picture');
const toggle = (page: Page) => page.locator('[data-motion-toggle]');

/** The canvas's own pixels, read from its backing store. Not a screenshot of its box: the hero's
 *  words and the readout stand over the canvas, and a screenshot would change when they do, as a
 *  late font's first paint did on production on 2026-10-29. */
const frame = (page: Page) =>
  canvas(page).evaluate((c) => (c as HTMLCanvasElement).toDataURL('image/png'));

// The rail's tests (ADRs 0021 to 0023) gave way to the top bar's, in e2e/top-bar.spec.ts (ADR
// 0027).

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

/** The play state of the board's day: its vans' clocks (styles/board.css), each distinct one once. */
const boardDay = (page: Page) =>
  page.evaluate(() => [
    ...new Set(
      [...document.querySelectorAll('[data-board] .line-van')].flatMap((van) =>
        van.getAnimations().map((a) => a.playState),
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
    // The caption's sentence stays for assistive technology; the live clock counts on screen, in
    // the same words.
    await expect(page.locator('.scene-clock-done')).toHaveCount(1);
    expect(await clock(page)).toMatch(/^\d.* into the day: \d+ of \d+ orders delivered\.$/);

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

  // The board stands still until it is seen; then its lamps come up and its vans step, while the
  // scene runs, and the scene's button pauses them where they stand.
  test('the board’s day comes up once it is seen, runs with the scene and pauses with its button', async ({
    page,
  }) => {
    await home(page);
    const board = page.locator('[data-board]');
    expect(await boardDay(page)).toEqual([]);
    await expect(board).not.toHaveAttribute('data-seen');
    await board.scrollIntoViewIfNeeded();
    await page.clock.runFor(500);
    await expect(board).toHaveAttribute('data-seen', '');
    expect(await boardDay(page)).toEqual(['running']);
    await toggle(page).click();
    expect(await boardDay(page)).toEqual(['paused']);
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
    await expect(page.locator('.scene-clock-done')).toBeVisible();
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
    // Seen, the board without the scene's data stays its still drawing: nothing marks it seen, and
    // its day does not run. Unscrolled, the check could not fail, since the day waits to be seen.
    const board = page.locator('[data-board]');
    await board.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    await expect(board).not.toHaveAttribute('data-seen');
    expect(await boardDay(page)).toEqual([]);
  });

  test('no other page has the canvas or the button', async ({ page }) => {
    for (const path of pages().filter((p) => p !== '/')) {
      await page.goto(path);
      await expect(canvas(page), path).toHaveCount(0);
      await expect(toggle(page), path).toHaveCount(0);
    }
  });
});

/** Where the stage's parts stand, in the window's pixels, and the name's size. The column's words
 *  run from the name to the caption under the buttons. */
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
      title: box('.hero-title'),
      column: box('.stage > .hero'),
      caption: box('.hero-caption'),
      actions: box('.hero-actions'),
      lede: box('.hero-lede'),
      figures: box('.figures'),
      scene: box('.scene'),
      picture: box('.scene-picture'),
      chapter: box('[data-stage-chapter]'),
      covers: box('.covers'),
      how: box('#how'),
      size: getComputedStyle(document.querySelector('.hero-name') as Element).fontSize,
    };
  });

// Below 64rem the column leads with the name, the role and the buttons, then the opening sentence
// and the figures, then the scene with its caption, then the Route Lab's chapter (ADR 0024,
// postscript 2026-10-31). The scene is a picture in the page's flow, live or still: no word scrolls
// under it, and it lifts the day into the cube as it passes up the window, wholly on screen. Until
// 2026-10-31 a running scene was a band held at the window's top from the buttons to the chapter's
// end, and the figures and the vans' days scrolled under it, cut in half at its edge
// (e2e/scene-covers-nothing.spec.ts holds every width and scroll to that).
test.describe("Home's scene on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('the scene stands between the figures and the chapter, its caption under it', async ({
    page,
  }) => {
    await page.goto('/');
    const at = await stageLayout(page);
    expect(at.overflow).toBe(0);
    expect(at.lede.top).toBeGreaterThanOrEqual(at.actions.bottom - 0.5);
    expect(at.scene.top).toBeGreaterThanOrEqual(at.figures.bottom - 0.5);
    // Its caption, which names what it shows and credits the map, stands right under it, and the
    // chapter follows the caption.
    expect(at.caption.top - at.scene.bottom).toBeLessThan(16);
    expect(at.chapter.top).toBeGreaterThanOrEqual(at.caption.bottom - 0.5);
    expect(at.scene.height).toBeGreaterThanOrEqual(280);
    expect([at.scene.left, at.scene.width]).toEqual([0, at.window.width]);
  });

  // Paused, the clock stands still, so a frame changes only with the scroll. The scene's own
  // passage up the window lifts the day (route-scene.ts, passing): flat while its foot is at the
  // window's foot, all the way up before its top leaves the window, and set down again on the way
  // back. It moves with the page all the while, never held at the window's top.
  test('it scrolls with the page, and its own passage up the window lifts the day into the cube', async ({
    page,
  }) => {
    await home(page);
    await toggle(page).click();
    const at = await stageLayout(page);
    const y0 = await page.evaluate(() => scrollY);
    const top = at.scene.top + y0;
    // Its foot at the window's foot: wholly on screen, and flat.
    const foot = Math.max(0, Math.round(top + at.scene.height - at.window.height));
    await scrollToY(page, foot);
    await page.clock.runFor(3_000);
    const flat = await frame(page);
    // Its top near the window's top: wholly on screen, and lifted.
    const high = Math.round(top - 8);
    await scrollToY(page, high);
    await page.clock.runFor(3_000);
    const lifted = await frame(page);
    expect(lifted === flat, 'lifted, the frame changes').toBe(false);
    const there = await stageLayout(page);
    expect(there.scene.top, 'it scrolled with the page').toBeCloseTo(8, 0);
    expect(there.scene.bottom).toBeLessThanOrEqual(there.window.height);
    expect(
      await page.evaluate(
        () => getComputedStyle(document.querySelector('.scene') as Element).position,
      ),
    ).toBe('relative');
    // Past it, nothing of it stands over the chapter: it has scrolled away.
    await scrollToY(page, Math.round(top + at.scene.height + 200));
    const past = await stageLayout(page);
    expect(past.scene.bottom).toBeLessThan(0);
    // Back where its foot meets the window's foot, the same flat frame again.
    await scrollToY(page, foot);
    await page.clock.runFor(3_000);
    expect((await frame(page)) === flat, 'set down, the same frame again').toBe(true);
  });

  test('under reduced motion the scene is the picture in the column, and scrolls away with it', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    const at = await stageLayout(page);
    await page.evaluate((y) => scrollTo(0, y), at.scene.bottom + 200);
    const after = await stageLayout(page);
    expect(after.scene.bottom).toBeLessThan(0);
    expect(after.caption.top - after.scene.bottom).toBeLessThan(16);
  });
});

// From 64rem the map lies on the water beside the column (ADR 0025): the picture's box, which pins
// the map's west edge at its own, starts the shore's width past the column's words, so the words
// stand on the sound at every width, and no street runs under them.
test.describe("Home's map beside the column", () => {
  for (const [width, height] of [
    [1024, 768],
    [1280, 800],
    [1440, 900],
    [2560, 1440],
  ] as const) {
    test(`at ${width} × ${height} the map starts just past the words`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto('/');
      const at = await stageLayout(page);
      expect(at.overflow).toBe(0);
      const shore = at.picture.left - at.column.right;
      expect(shore, 'the water between the words and the map').toBeGreaterThanOrEqual(31.5);
      expect(shore).toBeLessThanOrEqual(48);
      expect(at.picture.right).toBeCloseTo(at.window.width, 0);
      // The words' column holds every word of the column.
      for (const part of [at.name, at.title, at.lede, at.actions, at.caption])
        expect(part.right).toBeLessThanOrEqual(at.column.right + 0.5);
    });
  }
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
    const offset = design.name.top - (design.window.height - design.caption.bottom);
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
      // Route Lab chapter's words, and the board after the chapter stands in the frame, as every
      // row does: the scene has left with the chapter, so nothing covers it.
      expect(at.picture.right, where).toBeCloseTo(at.window.width, 0);
      expect(at.picture.height, where).toBeGreaterThan(at.window.height * 0.85);
      expect(at.picture.left, where).toBeGreaterThanOrEqual(at.chapter.right + 32 - 0.5);
      expect(at.covers.left, where).toBeCloseTo(at.how.left, 0);
      // The words start at the frame's edge, as every row below them does, at the name's size.
      expect(at.title.left, where).toBeCloseTo(at.how.left, 0);
      expect(at.size, where).toBe(design.size);
      // A taller window divides its extra height evenly above and below the words.
      const above = at.name.top;
      const below = at.window.height - at.caption.bottom;
      expect(Math.abs(above - below - offset), where).toBeLessThanOrEqual(2);
    }
  });
});

// The column always has words in view (HOM-4). From 64rem the Route Lab's chapter is a screen tall,
// because the lift needs that much scroll, and its words are far shorter than a screen, so they
// come up straight after the column's and then stand still in the middle of the window, beside the
// cube, until the chapter's end takes them away with the scene (home.css, .chapter-words). Until
// 2026-10-31 they sat in the middle of the chapter's own box, and a taller window put half its extra
// height under the column's words and half again above the chapter's: the column had no word for
// 42% of the window at 1920 × 1080 and 56% at 2560 × 1440, against 30% at 1440 × 900. Scrolling from
// the top until the board is in view, in steps of a tenth of the window, no stretch of the window
// without a word in the column may be more than three eighths of it; the words left over at the
// widest, a screen tall chapter's, are 453 px, which leaves 34% above and below them at 2560 × 1440.
// Below 64rem nothing stands still (scene-covers-nothing.spec.ts): the words scroll with the page.
/** Scrolls the window to `y` and waits two frames for sticky boxes to stand where the scroll puts
 *  them. Not scrollToY, which waits for a scroll event that a scroll to where the window already
 *  stands never sends. */
const settle = (page: Page, y: number) =>
  page.evaluate(
    (to) =>
      new Promise((done) => {
        scrollTo(0, to);
        requestAnimationFrame(() => requestAnimationFrame(() => done(null)));
      }),
    y,
  );

test.describe('Home’s column on a tall screen', () => {
  for (const [width, height] of [
    [1440, 900],
    [1920, 1080],
    [2560, 1440],
    [3440, 1440],
  ] as const) {
    test(`at ${width} × ${height} the column is never without words for most of the window`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height });
      await page.goto('/');
      const end = await page.evaluate(
        () => (document.querySelector('.covers') as Element).getBoundingClientRect().top + scrollY,
      );
      const step = Math.round(height / 10);
      let worst = { blank: 0, at: 0 };
      for (let y = 0; y <= end; y += step) {
        await settle(page, y);
        // The longest stretch of the window's height that no word of main crosses; the board
        // counts as one block of content once it is in view.
        const blank = await page.evaluate(() => {
          const view = innerHeight;
          const boxes = [
            ...document.querySelectorAll<HTMLElement>(
              'main :is(h1, h2, h3, p, li, a, .figure-before, .figure-after, .figure-words)',
            ),
          ]
            .filter((e) => !e.closest('.visually-hidden, .covers') && e.getClientRects().length > 0)
            .concat(document.querySelector<HTMLElement>('.covers') ?? [])
            .map((e) => e.getBoundingClientRect())
            .map((b) => [Math.max(b.top, 0), Math.min(b.bottom, view)] as const)
            .filter(([top, bottom]) => bottom > top)
            .sort((a, b) => a[0] - b[0]);
          let edge = 0;
          let gap = 0;
          for (const [top, bottom] of boxes) {
            gap = Math.max(gap, top - edge);
            edge = Math.max(edge, bottom);
          }
          return Math.max(gap, view - edge);
        });
        if (blank > worst.blank) worst = { blank, at: y };
      }
      expect(
        worst.blank / height,
        `${Math.round(worst.blank)} px at scroll ${worst.at}`,
      ).toBeLessThanOrEqual(3 / 8);

      // Where the scene lets go, at the chapter's end, the chapter's words stand wholly in the
      // window, about its middle: they leave with the scene.
      const chapterEnd = await page.evaluate(() => {
        const c = (
          document.querySelector('[data-stage-chapter]') as Element
        ).getBoundingClientRect();
        return Math.round(c.bottom + scrollY - innerHeight);
      });
      await settle(page, chapterEnd);
      const words = await page.evaluate(() => {
        const top = (document.querySelector('.chapter-title') as Element).getBoundingClientRect()
          .top;
        const bottom = (document.querySelector('.chapter-link') as Element).getBoundingClientRect()
          .bottom;
        return { top, bottom };
      });
      expect(words.top).toBeGreaterThanOrEqual(0);
      expect(words.bottom).toBeLessThanOrEqual(height);
      expect(Math.abs((words.top + words.bottom) / 2 - height / 2)).toBeLessThanOrEqual(
        height / 10,
      );
    });
  }

  test('below 64rem the chapter’s words scroll with the page', async ({ page }) => {
    for (const width of [390, 768, 1000]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto('/');
      expect(
        await page.evaluate(
          () => getComputedStyle(document.querySelector('.chapter-words') as Element).position,
        ),
        `${width} px`,
      ).toBe('static');
    }
  });
});
