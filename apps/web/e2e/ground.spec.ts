import { expect, test, type Page } from '@playwright/test';

// Page geometry (design-system.md, "Page geometry"): a page's drawing, About's wheels behind its
// top right or the 404's line under its words, ending in a buffer stop (ADR 0025), never sits
// under a word in the accent, never takes the pointer, and never prints. The wheels are --ground,
// which test/tokens.test.ts holds every text token to 4.5:1 on, so only the one accent mark, the
// buffer stop's lamp, can cost a word its contrast: it must touch no text, at a phone's width, a
// tablet's and a laptop's.

const PAGES = ['/', '/writing/', '/lab/', '/lab/routes/', '/does-not-exist/'];
const WIDTHS = [
  { width: 320, height: 640 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1440, height: 900 },
];

/** Every mark's box that overlaps a line of text on the page, as "mark × text". Text clipped
 *  away, the name only assistive technology reads (the command menu's button, in the header since
 *  ADR 0021), draws nothing for a mark to touch, though its boxes still span its words. */
const overlaps = (page: Page) =>
  page.evaluate(() => {
    const marks = [...document.querySelectorAll('.ground-mark')].map((m) =>
      m.getBoundingClientRect(),
    );
    const clipped = (node: Node) => {
      for (let at = node.parentElement; at; at = at.parentElement)
        if (getComputedStyle(at).clipPath !== 'none') return true;
      return false;
    };
    const found: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent?.trim() || !node.parentElement?.checkVisibility() || clipped(node))
        continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const box of range.getClientRects()) {
        for (const m of marks) {
          const apart =
            m.right <= box.left ||
            box.right <= m.left ||
            m.bottom <= box.top ||
            box.bottom <= m.top;
          if (!apart) found.push(`mark × "${node.textContent.trim().slice(0, 30)}"`);
        }
      }
    }
    return found;
  });

for (const size of WIDTHS) {
  test(`at ${size.width} px the accent mark touches no text on any page`, async ({ page }) => {
    await page.setViewportSize(size);
    for (const path of PAGES) {
      await page.goto(path);
      await page.evaluate(() => document.fonts.ready);
      expect(await overlaps(page), path).toEqual([]);
    }
  });
}

// The 404's drawing holds the one accent mark the site draws since ADR 0024, when Home's drawing
// gave way to the Route Lab's scene.
test('known answer: the overlap check finds a mark moved onto the title', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/does-not-exist/');
  await page.evaluate(() => {
    const name = document.querySelector('h1')?.getBoundingClientRect();
    const mark = document.querySelector('.ground-mark') as SVGGraphicsElement | null;
    if (!name || !mark) throw new Error('no title or no mark');
    const svg = mark.ownerSVGElement as SVGSVGElement;
    const point = new DOMPoint(name.left + 40, name.top + 40).matrixTransform(
      svg.getScreenCTM()?.inverse(),
    );
    mark.setAttribute('d', `M${point.x} ${point.y}h14v14h-14z`);
  });
  expect((await overlaps(page)).length).toBeGreaterThan(0);
});

test('the 404’s line takes no pointer, is hidden from assistive technology, and does not print', async ({
  page,
}) => {
  await page.goto('/does-not-exist/');
  const line = page.locator('svg.line-end');
  await expect(line).toHaveCount(1);
  await expect(page.locator('svg.ground')).toHaveCount(0);
  expect(await line.evaluate((g) => getComputedStyle(g).pointerEvents)).toBe('none');
  await expect(line).toHaveAttribute('aria-hidden', 'true');
  await page.emulateMedia({ media: 'print' });
  expect(await line.evaluate((g) => getComputedStyle(g).display)).toBe('none');
});

// The 404's line runs under the way home, a section's space below the button, and ends at the
// column's right edge, at every width (ADR 0025). As a background drawing anchored to the window's
// corner, until 2026-10-30, its lamp stood 8 px under the button at 390 px and its stop some 370 px
// past the column at 2560.
for (const [width, height] of [
  [390, 844],
  [1440, 900],
  [2560, 1440],
] as const) {
  test(`at ${width} px the 404's line ends at the column's edge, clear of the way home`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await page.goto('/does-not-exist/');
    const at = await page.evaluate(() => {
      const box = (selector: string) => document.querySelector(selector)?.getBoundingClientRect();
      const main = document.querySelector('main') as Element;
      const pad = Number.parseFloat(getComputedStyle(main).paddingInlineEnd);
      return {
        column: (box('main')?.right ?? 0) - pad,
        stop: box('.line-end-stop')?.right ?? 0,
        lamp: box('.line-end .ground-mark')?.top ?? 0,
        button: box('.notice-actions .btn')?.bottom ?? 0,
      };
    });
    expect(Math.abs(at.stop - at.column), JSON.stringify(at)).toBeLessThan(1);
    expect(at.lamp - at.button, JSON.stringify(at)).toBeGreaterThanOrEqual(40);
  });
}

// /about/'s wheels are not drawn on a phone, where the column is the window's whole width and they
// stood behind the contact links, and on a laptop they keep the page's gutter from its right edge.
test('/about/ draws no wheels on a phone, and keeps them inside the gutter on a laptop', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/about/');
  await expect(page.locator('svg.ground')).toBeHidden();
  await page.setViewportSize({ width: 1440, height: 900 });
  const right = await page
    .locator('svg.ground .ground-index')
    .evaluateAll((rims) => Math.max(...rims.map((rim) => rim.getBoundingClientRect().right)));
  expect(1440 - right).toBeGreaterThanOrEqual(64);
});

test('/about/, which holds the résumé, draws its wheels on screen and nothing on paper', async ({
  page,
}) => {
  // 1440, where the wheels clear the words and are drawn (below).
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/about/');
  const ground = page.locator('svg.ground');
  await expect(ground).toHaveCount(1);
  await page.emulateMedia({ media: 'print' });
  expect(await ground.evaluate((g) => getComputedStyle(g).display)).toBe('none');
});

// The wheels are display and the bio is content, and display never stands under content
// (2026-10-31): at 768 to 1199 and 1280 to 1439 px the left wheel stood behind the bio's lines. Where
// the wheels are drawn, every line of text in the drawing's height ends a gutter (28 px) short of
// them (the bar's controls, above the drawing, are not beside it); elsewhere they are not drawn. The widths are each side of every breakpoint (global.css,
// .ground), and the review's 1024 and 1280.
const GUTTER = 28;

/** Where the drawn wheels start, and every line of text beside them that reaches within a gutter. */
const wheelsAgainstText = (page: Page, gutter: number) =>
  page.evaluate((gap) => {
    const svg = document.querySelector('svg.ground');
    if (!svg || !svg.checkVisibility()) return { drawn: false, left: 0, crowded: [] as string[] };
    const shapes = [...svg.querySelectorAll('path')].map((p) => p.getBoundingClientRect());
    const left = Math.min(...shapes.map((r) => r.left));
    const top = Math.min(...shapes.map((r) => r.top));
    const bottom = Math.max(...shapes.map((r) => r.bottom));
    const crowded: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent?.trim() || !node.parentElement?.checkVisibility()) continue;
      if (node.parentElement.closest('.visually-hidden')) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const box of range.getClientRects())
        if (box.width > 0 && box.top < bottom && box.bottom > top && box.right + gap > left)
          crowded.push(
            `"${node.textContent.trim().slice(0, 30)}" ends at ${Math.round(box.right)}`,
          );
    }
    return { drawn: true, left: Math.round(left), crowded };
  }, gutter);

for (const width of [768, 1024, 1199, 1200, 1279, 1280, 1366, 1439, 1440, 1920, 2560]) {
  test(`at ${width} px /about/'s wheels stand clear of every word, or are not drawn`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/about/');
    await page.evaluate(() => document.fonts.ready);
    const at = await wheelsAgainstText(page, GUTTER);
    expect(at.crowded, `wheels from ${at.left} px`).toEqual([]);
    // The room the drawing needs: beside the words from 1200 (75rem). Until ADR 0027 the rail took
    // 224 px from 1280, and the wheels came back only at 1440.
    expect(at.drawn).toBe(width >= 1200);
  });
}

// The known answer: at 1024 the wheels are not drawn, and drawn anyway they stand behind the bio,
// as on the live site before this check, so the check would have caught it.
test('known answer: drawn at 1024 px, the wheels stand behind the bio and the check says so', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.goto('/about/');
  await page.evaluate(() => document.fonts.ready);
  await page.locator('svg.ground').evaluate((svg) => {
    (svg as SVGSVGElement).style.display = 'block';
  });
  const at = await wheelsAgainstText(page, GUTTER);
  expect(at.drawn).toBe(true);
  expect(at.crowded.length).toBeGreaterThan(0);
});
