import { expect, test, type Page } from '@playwright/test';

// The 404 (docs/design/overhaul.md, "404"; ADR 0027): its words and the way home, and the system
// drawn with one solid missing (lib/missing-piece.ts). It replaces ground.spec.ts, which held the
// 404's end of the line and About's wheels, both gone with the signal box. The invariants carry
// over: the drawing is display, so it never stands under a word, takes no pointer, says nothing
// to assistive technology and does not print; and the page never scrolls sideways.

const MISSING = '/does-not-exist/';
const WIDTHS = [
  { width: 320, height: 640 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1440, height: 900 },
  { width: 2560, height: 1440 },
];

/** Every line of text whose box overlaps the drawing's drawn shapes, as text. */
const underText = (page: Page) =>
  page.evaluate(() => {
    const svg = document.querySelector('svg.missing-piece');
    if (!svg || !svg.checkVisibility()) return null;
    const shapes = [...svg.querySelectorAll('path, text')]
      .filter((s) => s.checkVisibility())
      .map((s) => s.getBoundingClientRect());
    const found: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      if (!node.textContent?.trim() || !parent?.checkVisibility() || svg.contains(parent)) continue;
      if (getComputedStyle(parent).clipPath !== 'none') continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const box of range.getClientRects())
        for (const s of shapes)
          if (!(
            s.right <= box.left ||
            box.right <= s.left ||
            s.bottom <= box.top ||
            box.bottom <= s.top
          ))
            found.push(node.textContent.trim().slice(0, 30));
    }
    return [...new Set(found)];
  });

for (const size of WIDTHS) {
  test(`at ${size.width} px the 404's drawing stands clear of every word, inside the window`, async ({
    page,
  }) => {
    await page.setViewportSize(size);
    const response = await page.goto(MISSING);
    expect(response?.status()).toBe(404);
    await page.evaluate(() => document.fonts.ready);
    expect(await underText(page)).toEqual([]);
    const sideways = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(sideways).toBeLessThanOrEqual(0);
    // The drawing's box lies inside the window's width.
    const box = await page.locator('svg.missing-piece').boundingBox();
    expect(box).not.toBeNull();
    expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(size.width + 0.5);
  });
}

// The known answer: the same reading finds a shape moved onto the title.
test('known answer: the overlap check finds a shape moved onto the title', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(MISSING);
  await page.evaluate(() => {
    const title = document.querySelector('h1')?.getBoundingClientRect();
    const shape = document.querySelector('svg.missing-piece .mp-missing') as SVGPathElement | null;
    if (!title || !shape) throw new Error('no title or no missing solid');
    const svg = shape.ownerSVGElement as SVGSVGElement;
    const point = new DOMPoint(title.left + 40, title.top + 20).matrixTransform(
      svg.getScreenCTM()?.inverse(),
    );
    shape.setAttribute('d', `M${point.x} ${point.y}h14v14h-14z`);
  });
  expect((await underText(page))?.length).toBeGreaterThan(0);
});

test('the drawing takes no pointer, is hidden from assistive technology, and does not print', async ({
  page,
}) => {
  await page.goto(MISSING);
  const drawing = page.locator('svg.missing-piece');
  await expect(drawing).toHaveCount(1);
  await expect(drawing).toHaveAttribute('aria-hidden', 'true');
  expect(await drawing.evaluate((g) => getComputedStyle(g).pointerEvents)).toBe('none');
  // No old drawing stands anywhere on the page.
  await expect(page.locator('svg.ground, svg.line-end')).toHaveCount(0);
  await page.emulateMedia({ media: 'print' });
  expect(await drawing.evaluate((g) => getComputedStyle(g).display)).toBe('none');
});

// One solid is missing, dashed in the accent, and the request's way in is lit in the accent too:
// the one place the eye should land, the colour that marks where a visitor is (ADR 0027). Every
// other edge is the ink or the working rule, in both themes.
for (const scheme of ['light', 'dark'] as const) {
  test(`in the ${scheme} theme the missing solid is dashed in the accent, and only it and the way in are`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto(MISSING);
    const drawn = await page.evaluate(() => {
      const probe = document.createElement('span');
      probe.style.color = 'var(--primary)';
      document.body.append(probe);
      const accent = getComputedStyle(probe).color;
      probe.remove();
      const shapes = [...document.querySelectorAll('svg.missing-piece path')].map((p) => {
        const s = getComputedStyle(p);
        return { role: p.getAttribute('class'), stroke: s.stroke, dashed: s.strokeDasharray };
      });
      return { accent, shapes };
    });
    const lit = drawn.shapes.filter((s) => s.stroke === drawn.accent).map((s) => s.role);
    expect(lit.sort()).toEqual(['mp-lit', 'mp-missing']);
    const dashed = drawn.shapes.filter((s) => s.dashed !== 'none').map((s) => s.role);
    expect(dashed).toEqual(['mp-missing']);
  });
}

test('the way home is the one primary button, and it goes home', async ({ page }) => {
  await page.goto(MISSING);
  await expect(page.locator('main .btn-primary')).toHaveCount(1);
  await page.getByRole('link', { name: 'Go to the home page' }).click();
  await expect(page).toHaveURL(/\/$/);
});
