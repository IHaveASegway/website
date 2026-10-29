import { expect, test, type Page } from '@playwright/test';
import { pages } from './expected';

// The rail and Home's living ground (ADR 0021), in a real WebGL2 context (SwiftShader in headless
// Chromium). The rail stands down the left edge from 80rem and the header is the row across the
// top below that; Home's drawing moves on the GPU, pauses on request (SC 2.2.2) and off screen,
// stays the build's drawing under reduced motion, without WebGL and when the context is lost, and
// never shifts the layout.

const live = (page: Page) => page.locator('html[data-ground-live]');
const canvas = (page: Page) => page.locator('canvas[data-ground-live]');
const drawing = (page: Page) => page.locator('svg.ground');
const toggle = (page: Page) => page.locator('[data-motion-toggle]');

/** The canvas's pixels, as a screenshot of its box. */
const frame = (page: Page) => canvas(page).screenshot({ animations: 'allow' });

test.describe('the rail', () => {
  test('from 80rem the header is a rail down the left edge, as tall as the window, beside main', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const tops: number[] = [];
    for (const path of ['/', '/about/', '/lab/']) {
      await page.goto(path);
      const header = await page.locator('.masthead').boundingBox();
      const main = await page.locator('main').boundingBox();
      expect(header, path).not.toBeNull();
      expect(header?.x, path).toBe(0);
      expect(header?.height, path).toBe(900);
      expect(main?.x ?? 0, path).toBeGreaterThanOrEqual((header?.width ?? 0) - 0.5);
      // The nav starts at the same height on every page, Home included.
      tops.push((await page.locator('.site-nav').boundingBox())?.y ?? -1);
    }
    expect(new Set(tops).size, `${tops}`).toBe(1);
    // It stays while the page scrolls.
    await page.goto('/about/');
    await page.mouse.wheel(0, 1200);
    await page.waitForFunction(() => scrollY > 600);
    expect((await page.locator('.site-nav').boundingBox())?.y).toBe(tops[0]);
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
    expect((await mark('.site-nav a[href="/lab/"]')).bar).toBeNull();
    await page.setViewportSize({ width: 1024, height: 900 });
    expect(await mark('.site-nav a[href="/about/"]')).toEqual({
      bar: null,
      underline: 'underline',
    });
  });

  test('Tab goes from the skip link through the rail, in order, then into main', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/lab/');
    await page.waitForFunction(() => 'palette' in document.documentElement.dataset);
    const order: string[] = [];
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Tab');
      order.push(
        await page.evaluate(() => {
          const at = document.activeElement;
          if (!at) return '';
          if (at.closest('main')) return 'main';
          return (at.getAttribute('aria-label') ?? at.textContent ?? '')
            .replace(/\s+/g, ' ')
            .trim();
        }),
      );
      if (order.at(-1) === 'main') break;
    }
    expect(order.slice(0, 5)).toEqual(
      ['Skip to content', 'Joseph Peterson', 'Lab', 'Writing', 'About'].filter(
        (step) => step !== 'Writing' || pages().includes('/writing/'),
      ),
    );
    expect(order.at(-1)).toBe('main');
  });
});

test.describe("Home's living ground", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('it takes over from the drawing, moves, pauses and plays, and the choice lasts the tab', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(live(page)).toHaveCount(1);
    await expect(canvas(page)).toBeVisible();
    await expect(drawing(page)).toBeHidden();
    await expect(canvas(page)).toHaveAttribute('aria-hidden', 'true');
    await expect(toggle(page)).toBeVisible();
    await expect(toggle(page)).toHaveAccessibleName('Pause motion');

    const a = await frame(page);
    await page.waitForTimeout(700);
    const b = await frame(page);
    expect(a.equals(b), 'it moves').toBe(false);

    await toggle(page).click();
    await expect(toggle(page)).toHaveAccessibleName('Play motion');
    await expect(page.locator('html')).toHaveAttribute('data-motion', 'paused');
    await page.waitForTimeout(100);
    const c = await frame(page);
    await page.waitForTimeout(700);
    expect(c.equals(await frame(page)), 'paused, it holds still').toBe(true);
    expect(await page.evaluate(() => sessionStorage.getItem('motion'))).toBe('paused');

    await page.reload();
    await expect(live(page)).toHaveCount(1);
    await expect(toggle(page)).toHaveAccessibleName('Play motion');
    await toggle(page).click();
    await expect(toggle(page)).toHaveAccessibleName('Pause motion');
    expect(await page.evaluate(() => sessionStorage.getItem('motion'))).toBeNull();
  });

  // Paused, the clock stands still, so a frame changes only with the pointer: over the drawing it
  // raises a hill and leans the camera, and away from it everything eases back to the same frame.
  test('the pointer bends the lines under it, and leaving lets them go', async ({ page }) => {
    await page.goto('/');
    await expect(live(page)).toHaveCount(1);
    await toggle(page).click();
    await page.waitForTimeout(300);
    const still = await frame(page);
    await page.mouse.move(1150, 330);
    await page.waitForTimeout(2500);
    const bent = await frame(page);
    expect(bent.equals(still), 'the pointer changes the frame').toBe(false);
    await page.mouse.move(60, 880);
    await page.waitForTimeout(6000);
    expect((await frame(page)).equals(still), 'away from it, the same frame again').toBe(true);
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
    await page.goto('/');
    await expect(live(page)).toHaveCount(1);
    await expect(toggle(page)).toBeVisible();
    await page.waitForTimeout(500);
    const { shifts, largest } = await page.evaluate(() => {
      const w = window as unknown as { shifts: number; largest: string };
      return { shifts: w.shifts, largest: w.largest };
    });
    expect(shifts).toBe(0);
    expect(largest).not.toBe('canvas');
  });

  test('under reduced motion the drawing stays, the module never loads, and there is no button', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const loaded: string[] = [];
    page.on('request', (r) => /ground-live/.test(r.url()) && loaded.push(r.url()));
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);
    await expect(live(page)).toHaveCount(0);
    await expect(drawing(page)).toBeVisible();
    await expect(canvas(page)).toBeHidden();
    await expect(page.locator('.motion-item')).toBeHidden();
    expect(loaded).toEqual([]);
  });

  test('without WebGL2 the drawing stays, and the button keeps its place unseen', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, kind: string) {
        if (/webgl/.test(kind)) return null;
        return (original as (k: string) => RenderingContext | null).call(this, kind);
      } as typeof original;
    });
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);
    await expect(live(page)).toHaveCount(0);
    await expect(drawing(page)).toBeVisible();
    await expect(toggle(page)).toBeHidden();
    await expect(page.locator('.motion-item')).toHaveCSS('visibility', 'hidden');
  });

  test('a lost context brings the drawing back', async ({ page }) => {
    await page.goto('/');
    await expect(live(page)).toHaveCount(1);
    await canvas(page).evaluate((c) =>
      (c as HTMLCanvasElement)
        .getContext('webgl2')
        ?.getExtension('WEBGL_lose_context')
        ?.loseContext(),
    );
    await expect(live(page)).toHaveCount(0);
    await expect(drawing(page)).toBeVisible();
    await expect(toggle(page)).toBeHidden();
  });

  test('no other page has the canvas or the button', async ({ page }) => {
    for (const path of pages().filter((p) => p !== '/')) {
      await page.goto(path);
      await expect(canvas(page), path).toHaveCount(0);
      await expect(toggle(page), path).toHaveCount(0);
    }
  });
});
