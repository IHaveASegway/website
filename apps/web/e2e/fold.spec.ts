import { expect, test, type Page } from '@playwright/test';

// The fold (content.md, "Home page"): rows 1-3 of Home end inside the first screen at 390×844 and
// 1440×900, with the web fonts and without them. A row that has nothing to show is not rendered
// (row 2 left with the build readouts on 2026-10-24; row 3 waits on the career timeline and the
// stack line), so the last rendered row counts: today the hero, row 1, alone. On a phone the column
// leads with the name, the role and the buttons, then the opening and the figures, and the scene
// follows them in the page's flow (ADR 0024, postscript 2026-10-31), so the fold holds those three
// there.
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
  const faces = await page.evaluate(() =>
    [...document.fonts]
      .filter((face) =>
        /^(Barlow|Barlow Condensed|Barlow Semi Condensed|B612 Mono)-[0-9a-f]+$/.test(
          face.family.replace(/"/g, ''),
        ),
      )
      .map(
        (face) =>
          [
            `${face.family.replace(/"/g, '').replace(/-[0-9a-f]+$/, '')} ${face.weight}`,
            face.status,
          ] as const,
      ),
  );
  // Each web face once, by family and weight: a second face of one, in another state, would
  // otherwise go unseen. Home has no code, so it declares no mono face (Base.astro).
  expect(faces.map(([face]) => face).sort(), 'each web face once').toEqual([
    'Barlow 400',
    'Barlow 600',
    'Barlow Condensed 600',
    'Barlow Semi Condensed 500',
  ]);
  const web = Object.fromEntries(faces);
  // The three faces every first screen draws arrived, or every one failed: never a mix that would
  // measure something else. Barlow's SemiBold draws <strong> only, so it loads or fails with them,
  // or, on a Home that sets none, is never fetched ("unloaded").
  const status = fonts === 'loaded' ? 'loaded' : 'error';
  for (const face of ['Barlow 400', 'Barlow Condensed 600', 'Barlow Semi Condensed 500'])
    expect(web[face], face).toBe(status);
  expect([status, 'unloaded']).toContain(web['Barlow 600']);
  return page.evaluate(() => {
    const rows = [...document.querySelectorAll<HTMLElement>('[data-row]')];
    const box = (selector: string) => document.querySelector(selector)?.getBoundingClientRect();
    // Below 64rem the name, the role under it and the buttons lead the column, and the opening
    // sentence, the figures and then the scene follow (ADR 0024, postscript 2026-10-31): the fold
    // holds the three, the Email button among them. From 64rem the scene stands beside the words and the fold holds the hero.
    const lead = ['.hero-name', '.hero-title', '.hero-actions .btn-email'].map(
      (selector) => document.querySelector(selector)?.getBoundingClientRect().bottom ?? Infinity,
    );
    return {
      rows: rows.map((row) => row.dataset['row']),
      bottom:
        innerWidth < 1024
          ? Math.max(...lead)
          : Math.max(...rows.map((row) => row.getBoundingClientRect().bottom)),
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
        expect(result.rows).toEqual(['1']);
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
