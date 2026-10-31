import { expect, test } from '@playwright/test';

// A section's picture belongs to that section (ADR 0024, postscript 2026-10-31): nothing Home's
// scene draws covers a word, at any width or scroll position, and nothing stands still on a narrow
// screen. Until 2026-10-31 a phone's running scene was a band held at the window's top from the
// buttons to the Route Lab chapter's end: the figures and the vans' days scrolled under it, cut in
// half at its edge, and it still stood over the board after the chapter had ended. Every check
// before this one looked at the scene at one scroll position, so none saw it.
//
// The scene's box is what it draws in: its overflow is hidden, and from 64rem it starts where the
// column's words end (home.css). So the check scrolls Home in steps of half a screen, with the
// scene running, and at each step no visible word's box may cross the scene's.

const SIZES = [
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
] as const;

/** Elements that hold words. */
const WORDS = 'h1, h2, h3, p, li, a, dd, dt, figcaption';

for (const viewport of SIZES) {
  test(`at ${viewport.width} × ${viewport.height} the scene covers no word at any scroll`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto('/');
    await expect(page.locator('html[data-scene-live]')).toHaveCount(1);
    const end = await page.evaluate(
      () => document.documentElement.scrollHeight - document.documentElement.clientHeight,
    );
    const step = Math.round(viewport.height / 2);
    let steps = 0;
    for (let y = 0; ; y = Math.min(y + step, end)) {
      await page.evaluate((to) => scrollTo(0, to), y);
      const found = await page.evaluate((selector) => {
        const scene = document.querySelector<HTMLElement>('[data-scene]');
        if (!scene) throw new Error('no scene');
        const s = scene.getBoundingClientRect();
        const crossing: string[] = [];
        for (const element of document.querySelectorAll<HTMLElement>(selector)) {
          if (scene.contains(element) || !element.checkVisibility({ visibilityProperty: true }))
            continue;
          const b = element.getBoundingClientRect();
          // A visually hidden heading is a 1 px box that draws nothing.
          if (b.width <= 1 || b.height <= 1) continue;
          // Boxes that only touch, within half a pixel, do not cross.
          const overlap =
            Math.min(b.right, s.right) - Math.max(b.left, s.left) > 0.5 &&
            Math.min(b.bottom, s.bottom) - Math.max(b.top, s.top) > 0.5;
          if (overlap)
            crossing.push(`${element.localName}: ${element.textContent?.trim().slice(0, 40)}`);
        }
        return { crossing, position: getComputedStyle(scene).position };
      }, WORDS);
      expect(found.crossing, `at scroll ${y}`).toEqual([]);
      if (viewport.width < 1024)
        expect(['sticky', 'fixed'], `at scroll ${y}`).not.toContain(found.position);
      steps += 1;
      if (y >= end) break;
    }
    // Home is several screens long at every size, so the check has looked at many scrolls.
    expect(steps).toBeGreaterThan(4);
  });
}
