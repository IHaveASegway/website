import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { NOT_FOUND_PAGE, PAGES } from './expected';

// WCAG 2.2 AA (design-system.md, "Accessibility rules"). axe finds part of what matters, about 57%
// of issues in Deque's own data; the keyboard and screen-reader pass in the pull request template
// covers the rest.

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const ROUTES = [...PAGES, NOT_FOUND_PAGE];
type Media = Parameters<Page['emulateMedia']>[0] & {};
const MEDIA: Record<string, Media> = {
  dark: { colorScheme: 'dark' },
  light: { colorScheme: 'light' },
  'more contrast': { colorScheme: 'dark', contrast: 'more' },
  'forced colors': { colorScheme: 'light', forcedColors: 'active' },
};

/** A theme stored in this browser, the opposite of the OS's: the toggle's two saved states. */
const STORED: Record<string, { media: Media; theme: 'light' | 'dark' }> = {
  'dark OS, light stored': { media: { colorScheme: 'dark' }, theme: 'light' },
  'light OS, dark stored': { media: { colorScheme: 'light' }, theme: 'dark' },
};

for (const path of ROUTES) {
  for (const [name, media] of Object.entries(MEDIA)) {
    test(`axe finds no violation on ${path}, ${name}`, async ({ page }) => {
      await page.emulateMedia(media);
      await page.goto(path);
      const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
      expect(results.violations).toEqual([]);
    });
  }
  for (const [name, { media, theme }] of Object.entries(STORED)) {
    test(`axe finds no violation on ${path}, ${name}`, async ({ page }) => {
      await page.emulateMedia(media);
      await page.addInitScript((choice) => localStorage.setItem('theme', choice), theme);
      await page.goto(path);
      expect(await page.evaluate(() => document.documentElement.dataset['theme'])).toBe(theme);
      const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
      expect(results.violations).toEqual([]);
    });
  }
}

// The fallback fonts are wider than a condensed face would be if they were not fitted, and the
// overflow PR 2's first CI run found happened in a fallback, so the check runs without the web
// fonts too.
for (const fonts of ['loaded', 'blocked'] as const) {
  test(`no sideways scrolling at 320 px, web fonts ${fonts} (SC 1.4.10)`, async ({ page }) => {
    if (fonts === 'blocked') await page.route('**/*.woff2', (route) => route.abort());
    await page.setViewportSize({ width: 320, height: 640 });
    for (const path of ROUTES) {
      await page.goto(path);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow, path).toBeLessThanOrEqual(0);
    }
  });
}

test('every focusable element shows a visible outline from the keyboard (SC 2.4.7)', async ({
  page,
}) => {
  for (const path of ROUTES) {
    await page.goto(path);
    // Only what Tab reaches: a negative tabindex (a skip link's target, often <main tabindex="-1">),
    // a disabled control or a hidden one is focusable by script but never by Tab.
    const count = await page.evaluate(
      () =>
        [
          ...document.querySelectorAll<HTMLElement & { disabled?: boolean }>(
            'a[href], button, input, select, textarea, [tabindex]',
          ),
        ].filter(
          (element) => element.tabIndex >= 0 && !element.disabled && element.checkVisibility(),
        ).length,
    );
    for (let i = 0; i < count; i++) {
      await page.keyboard.press('Tab');
      const focus = await page.evaluate(() => {
        const element = document.activeElement;
        if (!element || element === document.body) return null;
        const style = getComputedStyle(element);
        return {
          name: element.textContent?.trim(),
          style: style.outlineStyle,
          width: parseFloat(style.outlineWidth),
        };
      });
      expect(focus, `${path}: Tab ${i + 1} reaches an element`).not.toBeNull();
      expect(focus?.style, `${path}: ${focus?.name}`).not.toBe('none');
      expect(focus?.width, `${path}: ${focus?.name}`).toBeGreaterThanOrEqual(2);
    }
  }
});
