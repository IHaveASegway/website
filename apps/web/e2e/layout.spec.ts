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

/** The footer's items that start a line away from the frame's edge, its content's left edge (the
 *  footer is the frame itself since ADR 0027). Runs in the page. */
function linesOffTheEdge(): string[] {
  const footer = document.querySelector('.site-footer');
  if (!footer) return ['no footer'];
  const edge =
    footer.getBoundingClientRect().left + Number.parseFloat(getComputedStyle(footer).paddingLeft);
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

/** Where the footer's parts stand (ADR 0027): who and the address, the links, the copyright,
 *  each part's box, optionally with the links removed first, as on a build with no page or checked
 *  profile to list. Runs in the page. */
function footerParts(withoutLinks: boolean) {
  const footer = document.querySelector('.site-footer') as HTMLElement;
  if (withoutLinks) footer.querySelector('.footer-links')?.remove();
  const edge =
    footer.getBoundingClientRect().left + Number.parseFloat(getComputedStyle(footer).paddingLeft);
  const box = (selector: string) => {
    const b = footer.querySelector(selector)?.getBoundingClientRect();
    return b ? { left: b.left - edge, top: b.top, bottom: b.bottom } : null;
  };
  return { who: box('.footer-who'), links: box('.footer-links'), copyright: box('.fine-print') };
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

// From 48rem the footer is two columns over a line (ADR 0027): who and the address at the frame's
// start, the links beside them in the same band, and the copyright under both, on a line of its
// own at the frame's start. Until 2026-10-31 it was one line, the copyright after the last link.
for (const width of [768, 1440, 2560]) {
  test(`the footer stands its links beside who it is, the copyright under both, at ${width} px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    for (const path of [...pages(), NOT_FOUND_PAGE]) {
      for (const withoutLinks of [false, true]) {
        await open(page, path);
        const parts = await page.evaluate(footerParts, withoutLinks);
        const where = `${path}, ${withoutLinks ? 'no links' : 'links'}`;
        expect(parts.who?.left, where).toBe(0);
        expect(parts.copyright?.left, where).toBe(0);
        expect(parts.copyright?.top ?? 0, where).toBeGreaterThanOrEqual(parts.who?.bottom ?? 0);
        if (parts.links) {
          expect(parts.links.left, where).toBeGreaterThan(0);
          expect(Math.abs(parts.links.top - (parts.who?.top ?? 0)), where).toBeLessThan(1);
          expect(parts.copyright?.top ?? 0, where).toBeGreaterThanOrEqual(parts.links.bottom);
        }
      }
    }
  });
}

// The bar's height and row, and the frame's place on a wide screen, are e2e/top-bar.spec.ts's
// since ADR 0027 replaced the rail with one bar at every width.

// Home's closing address fits its column on one line from 320 px up (home.css): at a title's size
// it is wider than a phone's column, so below 27rem it takes a section's size. Until 2026-10-30 it
// broke wherever the column ended, "hello@ihaveasegway.co" over "m".
test('Home’s closing address stands on one line from 320 to 1440 px', async ({ page }) => {
  for (const width of [320, 375, 390, 414, 431, 432, 768, 1440]) {
    await page.setViewportSize({ width, height: 800 });
    await open(page, '/');
    const lines = await page.evaluate(linesOf, '.toward-mail');
    test.skip(lines === 0, 'Home has no closing address here');
    expect(lines, `${width}`).toBe(1);
  }
});

// How I work reads as a section with five points under it: its title a step larger than each
// point's lead (design-system.md, "Type scale"). Until 2026-10-30 the leads were the title's size.
test('How I work’s title is larger than each of its leads, at 390 and 1440 px', async ({
  page,
}) => {
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await open(page, '/');
    const sizes = await page.evaluate(() => ({
      title: Number.parseFloat(
        getComputedStyle(document.querySelector('#how-title') ?? document.body).fontSize,
      ),
      leads: [...document.querySelectorAll('.principle-lead')].map((lead) =>
        Number.parseFloat(getComputedStyle(lead).fontSize),
      ),
    }));
    test.skip(sizes.leads.length === 0, 'Home has no How I work here');
    for (const lead of sizes.leads) expect(lead, `${width}`).toBeLessThan(sizes.title);
  }
});

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

test("known answers: the footer check reads each part from the frame's content edge", async ({
  page,
}) => {
  await page.setViewportSize({ width: 800, height: 600 });
  // The one-line footer before 2026-10-31: the copyright after the last link, on the same line.
  const footer = (layout: string) =>
    page.setContent(
      '<body style="margin: 0; font: 16px monospace">' +
        `<div class="site-footer" style="padding: 0 40px; width: 600px; ${layout}">` +
        '<div class="footer-who"><p style="margin: 0">Name</p><a>hi@example.com</a></div>' +
        '<ul class="footer-links" style="display: flex; margin: 0; padding: 0"><li>Link</li></ul>' +
        '<p class="fine-print" style="margin: 0; grid-column: 1 / -1">© 2026</p></div></body>',
    );
  await footer('display: flex; gap: 0 22px');
  const line = await page.evaluate(footerParts, false);
  expect(line.who?.left).toBe(0);
  expect(line.copyright?.left).toBeGreaterThan(0);
  // The system: two columns over the copyright's line.
  await footer('display: grid; grid-template-columns: 1fr auto');
  const grid = await page.evaluate(footerParts, false);
  expect(grid.copyright?.left).toBe(0);
  expect(grid.links?.left).toBeGreaterThan(0);
  expect(grid.copyright?.top ?? 0).toBeGreaterThanOrEqual(grid.links?.bottom ?? Infinity);
  const bare = await page.evaluate(footerParts, true);
  expect(bare.links).toBeNull();
});
