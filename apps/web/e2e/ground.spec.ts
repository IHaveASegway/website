import { expect, test, type Page } from '@playwright/test';

// Page geometry (design-system.md, "Page geometry"): a page's drawing never sits under a word in
// the accent, never takes the pointer, and never prints. Its lines are --ground, which
// test/tokens.test.ts holds every text token to 4.5:1 on, so only the one accent mark can cost a
// word its contrast: it must touch no text, at a phone's width, a tablet's and a laptop's.

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

test('known answer: the overlap check finds a mark moved onto the name', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.evaluate(() => {
    const name = document.querySelector('h1')?.getBoundingClientRect();
    const mark = document.querySelector('.ground-mark') as SVGGraphicsElement | null;
    if (!name || !mark) throw new Error('no name or no mark');
    const svg = mark.ownerSVGElement as SVGSVGElement;
    const point = new DOMPoint(name.left + 40, name.top + 40).matrixTransform(
      svg.getScreenCTM()?.inverse(),
    );
    mark.setAttribute('d', `M${point.x} ${point.y}h14v14h-14z`);
  });
  expect((await overlaps(page)).length).toBeGreaterThan(0);
});

test('the drawing takes no pointer, is hidden from assistive technology, and does not print', async ({
  page,
}) => {
  await page.goto('/');
  const ground = page.locator('svg.ground');
  await expect(ground).toHaveCount(1);
  expect(await ground.evaluate((g) => getComputedStyle(g).pointerEvents)).toBe('none');
  await expect(ground).toHaveAttribute('aria-hidden', 'true');
  await page.emulateMedia({ media: 'print' });
  expect(await ground.evaluate((g) => getComputedStyle(g).display)).toBe('none');
});

test('/about/, which holds the résumé, draws its wheels on screen and nothing on paper', async ({
  page,
}) => {
  await page.goto('/about/');
  const ground = page.locator('svg.ground');
  await expect(ground).toHaveCount(1);
  await page.emulateMedia({ media: 'print' });
  expect(await ground.evaluate((g) => getComputedStyle(g).display)).toBe('none');
});
