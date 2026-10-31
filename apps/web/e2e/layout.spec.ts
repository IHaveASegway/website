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

/** How far the copyright starts after the item before it on its line, in px, optionally with the
 *  footer's links removed first, as on a build with no page or checked profile to list; null if
 *  it stands on a line of its own. Runs in the page. */
function copyrightAfterTheLast(withoutLinks: boolean): number | null {
  const footer = document.querySelector('.site-footer');
  const copyright = footer?.querySelector('.fine-print');
  if (!footer || !copyright) return null;
  if (withoutLinks) footer.querySelector('.footer-links')?.remove();
  const own = copyright.getBoundingClientRect();
  const before = [...footer.querySelectorAll(':scope > a, :scope > ul > li')]
    .map((item) => item.getBoundingClientRect())
    .filter((box) => Math.abs(box.top + box.height / 2 - (own.top + own.height / 2)) < 4)
    .map((box) => box.right)
    .filter((right) => right <= own.left + 0.5);
  return before.length === 0 ? null : own.left - Math.max(...before);
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

// From 48rem the footer is one line, flush left and ragged right as everything is (ADR 0025): the
// copyright follows the last link, or the address with no links, a gap's width after it. Until
// 2026-10-30 the links took the rest of the line and the copyright stood at its far end, a second
// right edge on every page.
for (const width of [768, 1440, 2560]) {
  test(`the copyright follows the footer's links at ${width} px, with links and without`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    for (const path of [...pages(), NOT_FOUND_PAGE]) {
      for (const withoutLinks of [false, true]) {
        await open(page, path);
        const gap = await page.evaluate(copyrightAfterTheLast, withoutLinks);
        const where = `${path}, ${withoutLinks ? 'no links' : 'links'}`;
        expect(gap, where).not.toBeNull();
        expect(gap ?? Infinity, where).toBeLessThanOrEqual(24);
      }
    }
  });
}

// Below 80rem the header is one bar of one height on every page, 56 px with its rule under it,
// the name at its start on every page but Home (ADR 0025). Until 2026-10-30 the name took a line
// of its own at 390 px, and the bar was 108 px on every page but Home's 64.
for (const width of [390, 1024]) {
  test(`below 80rem the bar is one line, 56 px tall, on every page, at ${width} px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    for (const path of [...pages(), NOT_FOUND_PAGE]) {
      await open(page, path);
      await page.waitForFunction(() => 'palette' in document.documentElement.dataset);
      const bar = await page.evaluate(() => {
        const header = document.querySelector('.site-header')?.getBoundingClientRect();
        const name = document.querySelector('.site-header .wordmark')?.getBoundingClientRect();
        const nav = document.querySelector('.site-header .site-nav')?.getBoundingClientRect();
        return {
          height: header?.height ?? 0,
          oneLine: !name || !nav || Math.abs(name.top - nav.top) < 1,
        };
      });
      expect(bar, path).toEqual({ height: 56, oneLine: true });
    }
  });
}

// Everything stands flush left on one edge (ADR 0025): on a large screen the frame starts the
// page's gutter past the rail, and the room the screen adds is left at its end. Until 2026-10-30
// the frame was centred, and at 2560 px the words stood some 510 px from the rail.
test('at 2560 px every page starts the gutter past the rail, and so does its footer', async ({
  page,
}) => {
  await page.setViewportSize({ width: 2560, height: 1440 });
  for (const path of [...pages(), NOT_FOUND_PAGE]) {
    await open(page, path);
    const edges = await page.evaluate(() => {
      const rail = document.querySelector('.masthead')?.getBoundingClientRect().right ?? 0;
      const gutter = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) * 4;
      // The page's left edge: where its headings and paragraphs start, the leftmost of them.
      const words = [...document.querySelectorAll('main :is(h1, h2, h3, p, li)')]
        .map((element) => element.getBoundingClientRect())
        .filter((box) => box.width > 0)
        .map((box) => box.left);
      const footer = document.querySelector('.site-footer')?.getBoundingClientRect().left ?? 0;
      return { words: Math.min(...words) - rail - gutter, footer: footer - rail - gutter };
    });
    // A title's own side bearing (Home's name starts 0.055em left of the edge) is under 10 px.
    expect(Math.abs(edges.words), path).toBeLessThan(10);
    expect(Math.abs(edges.footer), path).toBeLessThan(0.5);
  }
});

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

test('known answers: the copyright check measures its gap after the last item, links or none', async ({
  page,
}) => {
  await page.setViewportSize({ width: 800, height: 600 });
  // The footer before 2026-10-30: the links grow, and push the copyright to the line's end.
  const footer = (links: string) =>
    page.setContent(
      '<body style="margin: 0; font: 16px monospace">' +
        '<div class="site-footer" style="display: flex; flex-wrap: wrap; gap: 0 22px; width: 600px">' +
        '<a class="footer-email">hi@example.com</a>' +
        `<ul class="footer-links" style="display: flex; margin: 0; padding: 0; ${links}"><li>Link</li></ul>` +
        '<p class="fine-print" style="margin: 0">© 2026</p></div></body>',
    );
  await footer('flex: 1 1 auto');
  expect(await page.evaluate(copyrightAfterTheLast, false)).toBeGreaterThan(300);
  // Ragged right: it follows the last link, and without the links the address, a gap after it.
  await footer('');
  expect(await page.evaluate(copyrightAfterTheLast, false)).toBe(22);
  expect(await page.evaluate(copyrightAfterTheLast, true)).toBe(22);
});
