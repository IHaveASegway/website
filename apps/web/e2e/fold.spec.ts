import { expect, test, type Page } from '@playwright/test';

// The fold (content.md, "Home page"): rows 1-3 of Home end inside the first screen at 390×844 and
// 1440×900, with the web fonts and without them. A row that has nothing to show yet (row 3 waits
// on the career timeline and the stack line) is not rendered, so the last rendered row counts.
// And the hero is the same height either way, within 1 px: the fallback faces are fitted so the
// name does not rewrap when its font arrives (layout shift).

const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 1440, height: 900 },
] as const;

type Fonts = 'loaded' | 'blocked';

async function measure(page: Page, fonts: Fonts) {
  if (fonts === 'blocked') await page.route('**/*.woff2', (route) => route.abort());
  await page.goto('/');
  await page.evaluate(() => document.fonts.ready);
  const web = await page.evaluate(() =>
    [...document.fonts]
      .filter((face) => /^(Instrument Sans|JetBrains Mono)-/.test(face.family.replace(/"/g, '')))
      .map((face) => face.status),
  );
  // Both web faces arrived, or both failed: never a mix that would measure something else.
  expect(web).toEqual(fonts === 'loaded' ? ['loaded', 'loaded'] : ['error', 'error']);
  return page.evaluate(() => {
    const rows = [...document.querySelectorAll<HTMLElement>('[data-row]')];
    const box = (selector: string) => document.querySelector(selector)?.getBoundingClientRect();
    return {
      rows: rows.map((row) => row.dataset['row']),
      bottom: Math.max(...rows.map((row) => row.getBoundingClientRect().bottom)),
      hero: box('[data-row="1"]')?.height ?? 0,
      name: box('.hero-name')?.height ?? 0,
    };
  });
}

for (const viewport of VIEWPORTS) {
  test.describe(`${viewport.width}×${viewport.height}`, () => {
    test.use({ viewport });

    const results: Partial<Record<Fonts, Awaited<ReturnType<typeof measure>>>> = {};

    for (const fonts of ['loaded', 'blocked'] as const) {
      test(`rows 1-3 end inside the first screen, fonts ${fonts}`, async ({ page }) => {
        const result = await measure(page, fonts);
        results[fonts] = result;
        console.log(
          `fold ${viewport.width}×${viewport.height} fonts ${fonts}: ${JSON.stringify(result)}`,
        );
        expect(result.rows).toEqual(['1', '2']);
        expect(result.bottom).toBeLessThanOrEqual(viewport.height);
      });
    }

    test('the hero is the same height with and without the web fonts', async ({ browser }) => {
      const heights: number[] = [];
      for (const fonts of ['loaded', 'blocked'] as const) {
        const context = await browser.newContext({ viewport });
        heights.push((await measure(await context.newPage(), fonts)).hero);
        await context.close();
      }
      expect(Math.abs((heights[0] ?? 0) - (heights[1] ?? 0))).toBeLessThanOrEqual(1);
    });
  });
}
