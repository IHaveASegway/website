import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { NOT_FOUND_PAGE, pages } from './expected';

// WCAG 2.2 AA (design-system.md, "Accessibility rules"). axe finds part of what matters, about 57%
// of issues in Deque's own data; the keyboard and screen-reader pass in the pull request template
// covers the rest.

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const ROUTES = [...pages(), NOT_FOUND_PAGE];
type Media = Parameters<Page['emulateMedia']>[0] & {};
const MEDIA: Record<string, Media> = {
  dark: { colorScheme: 'dark' },
  light: { colorScheme: 'light' },
  'more contrast': { colorScheme: 'dark', contrast: 'more' },
  'forced colors': { colorScheme: 'light', forcedColors: 'active' },
};

/** A theme chosen in this tab, the opposite of the OS's: the toggle's two chosen states. */
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
      await page.addInitScript((choice) => sessionStorage.setItem('theme', choice), theme);
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

// Target size (design-system.md, "Accessibility rules"). axe's target-size rule passes a small
// target through SC 2.5.8's spacing exception, which is how 19 px footer links went unnoticed; this
// holds the site's own rule instead, at a phone's width. Every link and button is at least 24 × 24
// px, unless it sits in a sentence (the SC's inline exception), and the targets the house rule
// names are 44 px tall (min-height: 2.75rem): buttons, nav links and the footer's links.
const HOUSE_TARGETS = 'button, .btn, nav a, footer li a';

interface Miss {
  readonly target: string;
  readonly size: string;
  readonly rule: '44 px tall' | '24 × 24 px';
}

/** Every visible link and button smaller than its rule allows. Runs in the page. */
function undersized(house: string): Miss[] {
  const words = (element: Element | null) =>
    (element instanceof HTMLElement ? element.innerText : '').replace(/\s+/g, ' ').trim();
  // In a sentence: drawn inline, inside a block that holds other words too.
  const inSentence = (element: Element) => {
    if (getComputedStyle(element).display !== 'inline') return false;
    let block = element.parentElement;
    while (block && getComputedStyle(block).display === 'inline') block = block.parentElement;
    return words(block).length > words(element).length;
  };
  const misses: Miss[] = [];
  for (const element of document.querySelectorAll('a[href], button')) {
    if (!element.checkVisibility()) continue;
    const rect = element.getBoundingClientRect();
    const tenth = (px: number) => Math.round(px * 10) / 10;
    const [width, height] = [tenth(rect.width), tenth(rect.height)];
    const found = { target: words(element), size: `${width} × ${height} px` };
    if (element.matches(house) && height < 44) misses.push({ ...found, rule: '44 px tall' });
    if (!inSentence(element) && (width < 24 || height < 24))
      misses.push({ ...found, rule: '24 × 24 px' });
  }
  return misses;
}

test('every link and button at 390 px meets its target size (SC 2.5.8 and the 44 px rule)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ROUTES) {
    await page.goto(path);
    await page.evaluate(() => document.fonts.ready);
    expect(await page.evaluate(undersized, HOUSE_TARGETS), path).toEqual([]);
  }
});

test('known answers: the target check names a short list link and a small button, and passes a link in a sentence', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.setContent(
    [
      '<nav><a href="/a/" style="display: inline-flex; min-height: 44px; padding: 0 8px">Tall</a></nav>',
      '<p>A sentence with <a href="/b/">a link</a> in it.</p>',
      '<a href="/c/" style="display: block; line-height: 30px">Block</a>',
      '<footer><ul><li><a href="/d/">Short</a></li></ul></footer>',
      '<button type="button" style="width: 20px; height: 20px; padding: 0">x</button>',
    ].join(''),
  );
  const misses = await page.evaluate(undersized, HOUSE_TARGETS);
  expect(misses.map(({ target, rule }) => `${target}: ${rule}`)).toEqual([
    'Short: 44 px tall',
    'Short: 24 × 24 px',
    'x: 44 px tall',
    'x: 24 × 24 px',
  ]);
});

/**
 * How many times Tab stops on a page: each visible link, button and control, except that a group
 * of radio buttons (one name) is one stop, as browsers move through it with the arrow keys.
 * Runs in the page.
 */
function tabStops(): number {
  const groups = new Set<string>();
  return [
    ...document.querySelectorAll<HTMLElement & { disabled?: boolean }>(
      'a[href], button, input, select, textarea, [tabindex]',
    ),
  ].filter((element) => {
    if (element.tabIndex < 0 || element.disabled || !element.checkVisibility()) return false;
    if (element instanceof HTMLInputElement && element.type === 'radio' && element.name) {
      if (groups.has(element.name)) return false;
      groups.add(element.name);
    }
    return true;
  }).length;
}

test('known answer: a radio group is one Tab stop', async ({ page }) => {
  await page.setContent(
    [
      '<a href="/a/">A</a>',
      '<label><input type="radio" name="day" checked> One</label>',
      '<label><input type="radio" name="day"> Two</label>',
      '<label><input type="radio" name="vans"> 1</label>',
      '<label><input type="radio" name="vans"> 2</label>',
      '<button type="button">Go</button>',
    ].join(''),
  );
  expect(await page.evaluate(tabStops)).toBe(4);
  const reached: string[] = [];
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('Tab');
    reached.push(await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 20) ?? ''));
  }
  expect(reached.every((html) => html !== '' && !html.startsWith('<body'))).toBe(true);
});

test('every focusable element shows a visible outline from the keyboard (SC 2.4.7)', async ({
  page,
}) => {
  for (const path of ROUTES) {
    await page.goto(path);
    // Only what Tab reaches: a negative tabindex (a skip link's target, often <main tabindex="-1">),
    // a disabled control or a hidden one is focusable by script but never by Tab, and a radio
    // group is one stop (the Route Lab's day and vans).
    const count = await page.evaluate(tabStops);
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
