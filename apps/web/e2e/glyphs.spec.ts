import { expect, test } from '@playwright/test';
import { NOT_FOUND_PAGE, pages } from './expected';
import { fallbacksOn } from './fonts-drawn';

// Glyph coverage (design-system.md, "Budgets as CI fitness functions"): every character on every
// page is drawn by a self-hosted face, never by a system fallback. Chromium says which fonts drew
// each element's text (DevTools Protocol, CSS.getPlatformFontsForNode), after text-transform,
// so the check reads what was painted rather than a list of selectors that could drift.

for (const path of [...pages(), NOT_FOUND_PAGE]) {
  test(`every glyph on ${path} comes from a self-hosted face`, async ({ page }) => {
    await page.goto(path);
    const { fallbacks, elements, painted } = await fallbacksOn(page);
    expect(elements).toBeGreaterThan(5);
    // Hidden elements paint nothing and report no font; enough of the page must have painted.
    expect(painted).toBeGreaterThan(5);
    expect(fallbacks).toEqual([]);
  });
}

// The known answer. The check relies on Chromium reporting a face that local() maps to a system
// font, such as the fitted Arial fallback, as the system font (isCustomFont false), not as a web
// face. If that ever changed, every page above would pass while drawing glyphs in Arial. So a
// character outside both subsets (Ł, ó and ź are not in them) must be reported here.
test('known answer: a glyph outside the subsets is reported, with the system font that drew it', async ({
  page,
}) => {
  await page.goto('/');
  await page.evaluate(() => {
    const title = document.querySelector('.hero-title');
    if (!title) throw new Error('Home has no title line');
    title.textContent = 'Łódź';
  });
  const { fallbacks } = await fallbacksOn(page);
  expect(fallbacks.filter((line) => line.includes('"Łódź"')).length).toBeGreaterThan(0);
});
