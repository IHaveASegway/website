import { expect, test, type Page } from '@playwright/test';
import { NOT_FOUND_PAGE, pages } from './expected';

// The layout between the fold's two sizes (design-system.md, "Home, row by row"): what the build of
// 2026-10-24 got wrong between a phone and a laptop. Its hero buttons were 278, 362, 176 and 136 px
// wide at 600, 767, 768 and 1024 px; at 1024 to 1100 px the title broke onto a second line in
// columns 9 to 12; and on a phone the copyright alone stood flush right under lines that start at
// the frame's edge. The hero checks run with the web fonts and without them, which are a little
// wider. Since ADR 0025 the buttons are the address's and LinkedIn's, of two widths: each keeps its
// own at every screen width.

type Fonts = 'loaded' | 'blocked';
const FONTS: readonly Fonts[] = ['loaded', 'blocked'];

async function open(page: Page, path: string) {
  await page.goto(path);
  await page.evaluate(() => document.fonts.ready);
}

/** The lines a text takes, counted by the tops of its boxes. Runs in the page. */
function linesOf(selector: string): number {
  const element = document.querySelector(selector);
  if (!element) return 0;
  const range = document.createRange();
  range.selectNodeContents(element);
  return new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size;
}

/** The widths of Home's hero buttons, to the pixel. Runs in the page. */
function buttonWidths(): number[] {
  return [...document.querySelectorAll('.hero-actions .btn')].map((button) =>
    Math.round(button.getBoundingClientRect().width),
  );
}

/** The footer's items that start a line away from the frame's edge. Runs in the page. */
function linesOffTheEdge(): string[] {
  const footer = document.querySelector('.site-footer');
  if (!footer) return ['no footer'];
  const edge = footer.getBoundingClientRect().left;
  const items = [...footer.querySelectorAll(':scope > *, :scope > ul > li')].filter(
    (item) => item.localName !== 'ul',
  );
  const starts = new Map<number, Element>();
  for (const item of items) {
    const box = item.getBoundingClientRect();
    const top = Math.round(box.top);
    const first = starts.get(top);
    if (!first || box.left < first.getBoundingClientRect().left) starts.set(top, item);
  }
  return [...starts.values()]
    .filter((item) => Math.abs(item.getBoundingClientRect().left - edge) > 0.5)
    .map((item) => (item.textContent ?? '').trim());
}

/** How far the copyright ends before the footer's end, in px, optionally with the footer's links
 *  removed first, as on a build with no page or checked profile to list. Runs in the page. */
function copyrightShortOfTheEnd(withoutLinks: boolean): number | null {
  const footer = document.querySelector('.site-footer');
  const copyright = footer?.querySelector('.fine-print');
  if (!footer || !copyright) return null;
  if (withoutLinks) footer.querySelector('.footer-links')?.remove();
  return footer.getBoundingClientRect().right - copyright.getBoundingClientRect().right;
}

const WIDTHS = [320, 390, 600, 767, 768, 1023, 1024, 1060, 1100, 1199, 1200, 1440];

for (const fonts of FONTS) {
  test(`Home's buttons are one width and its title one line from 320 to 1440 px, fonts ${fonts}`, async ({
    page,
  }) => {
    if (fonts === 'blocked') await page.route('**/*.woff2', (route) => route.abort());
    const widths: number[][] = [];
    const titleLines: Record<number, number> = {};
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      await open(page, '/');
      (await page.evaluate(buttonWidths)).forEach((button, i) => (widths[i] ??= []).push(button));
      titleLines[width] = await page.evaluate(linesOf, '.hero-title');
    }
    // Each button one width at every screen width, within a pixel of rounding.
    expect(widths.length, 'Home has buttons').toBeGreaterThan(0);
    for (const [i, each] of widths.entries())
      expect(
        Math.max(...each) - Math.min(...each),
        `button ${i + 1}: ${each.join(', ')}`,
      ).toBeLessThanOrEqual(1);
    expect(titleLines, 'lines of the title at each width').toEqual(
      Object.fromEntries(WIDTHS.map((width) => [width, 1])),
    );
  });
}

for (const width of [320, 390]) {
  test(`every line of the footer starts at the frame's edge at ${width} px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    for (const path of [...pages(), NOT_FOUND_PAGE]) {
      await open(page, path);
      expect(await page.evaluate(linesOffTheEdge), path).toEqual([]);
    }
  });
}

// From 48rem the footer is one line, and the copyright ends it, whether or not there are links
// between it and the address: the links take the rest of the line, or, with none, the address's end
// margin does. On the first fix of 2026-10-25 the links alone pushed it, and without them it stood
// at 211 to 384 px of a 1,312 px frame.
for (const width of [768, 1440]) {
  test(`the copyright ends the footer's line at ${width} px, with links and without`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    for (const path of [...pages(), NOT_FOUND_PAGE]) {
      for (const withoutLinks of [false, true]) {
        await open(page, path);
        const short = await page.evaluate(copyrightShortOfTheEnd, withoutLinks);
        expect(short, `${path}, ${withoutLinks ? 'no links' : 'links'}`).not.toBeNull();
        expect(
          Math.abs(short ?? 0),
          `${path}, ${withoutLinks ? 'no links' : 'links'}`,
        ).toBeLessThanOrEqual(0.5);
      }
    }
  });
}

test('known answers: the layout checks count lines, read widths and find a line off the edge', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.setContent(
    [
      '<body style="margin: 0; font: 16px monospace">',
      '<p class="hero-title" style="width: 100px">Senior Software Engineer</p>',
      '<div class="hero-actions"><a class="btn" style="display: inline-block; width: 132px">A</a>',
      '<a class="btn" style="display: inline-block; width: 176px">B</a></div>',
      '<footer><div class="site-footer" style="display: flex; flex-wrap: wrap; width: 300px">',
      '<a style="width: 250px">hello@example.com</a><ul style="display: flex; margin: 0; padding: 0"><li>Link</li></ul>',
      '<p style="margin: 0 0 0 auto">© 2026</p></div></footer>',
      '</body>',
    ].join(''),
  );
  expect(await page.evaluate(linesOf, '.hero-title')).toBe(3);
  expect(await page.evaluate(buttonWidths)).toEqual([132, 176]);
  expect(await page.evaluate(linesOffTheEdge)).toEqual(['© 2026']);
});

test('known answers: the copyright check measures how far it ends from the line end, links or none', async ({
  page,
}) => {
  await page.setViewportSize({ width: 800, height: 600 });
  // The first fix's footer: the links grow, and nothing else pushes the copyright.
  const footer = (address: string) =>
    page.setContent(
      '<body style="margin: 0; font: 16px monospace">' +
        '<div class="site-footer" style="display: flex; flex-wrap: wrap; width: 600px">' +
        `<a class="footer-email" style="${address}">hi@example.com</a>` +
        '<ul class="footer-links" style="display: flex; flex: 1 1 auto; margin: 0; padding: 0"><li>Link</li></ul>' +
        '<p class="fine-print" style="margin: 0">© 2026</p></div></body>',
    );
  await footer('');
  expect(await page.evaluate(copyrightShortOfTheEnd, false)).toBe(0);
  // Without the links it follows the address, most of the 600 px line short of the end.
  expect(await page.evaluate(copyrightShortOfTheEnd, true)).toBeGreaterThan(300);
  await footer('margin-inline-end: auto');
  expect(await page.evaluate(copyrightShortOfTheEnd, true)).toBe(0);
});
