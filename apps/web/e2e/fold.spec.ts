import { expect, test, type Page } from '@playwright/test';

// The fold (content.md, "Home page"; ADR 0027): what Home's first screen holds at 390×844 and
// 1440×900, with the web fonts and without them. Row 1 is the opening (the name, the role, the
// buttons, the drawing and the bio's blocks), the one rendered row. On a phone the fold holds the
// name, the role, both buttons and the whole drawing under them; from 64rem it holds those, the
// drawing beside the blocks, and the first block. Until ADR 0027 the fold held the name, the role
// and the Email button, and the Route Lab's scene beside them.
// And the opening is the same height either way, within 1 px: the fallback faces are fitted so the
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
        /^(Archivo|Archivo Display|Archivo Wide|Archivo Label|B612 Mono)-[0-9a-f]+$/.test(
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
    'Archivo 400',
    'Archivo 600',
    'Archivo Display 800',
    'Archivo Label 600',
    'Archivo Wide 500',
  ]);
  const web = Object.fromEntries(faces);
  // The four faces every first screen draws arrived, or every one failed: never a mix that would
  // measure something else. Archivo's SemiBold draws <strong> only, so it loads or fails with them,
  // or, on a Home that sets none, is never fetched ("unloaded").
  const status = fonts === 'loaded' ? 'loaded' : 'error';
  for (const face of [
    'Archivo 400',
    'Archivo Display 800',
    'Archivo Label 600',
    'Archivo Wide 500',
  ])
    expect(web[face], face).toBe(status);
  expect([status, 'unloaded']).toContain(web['Archivo 600']);
  return page.evaluate(() => {
    const rows = [...document.querySelectorAll<HTMLElement>('[data-row]')];
    const box = (selector: string) => document.querySelector(selector)?.getBoundingClientRect();
    const bottoms = [
      '.nameplate',
      '.intro-role',
      '.intro-actions .btn-email',
      '.intro-actions .btn:last-child',
      'figure.iso svg',
      ...(innerWidth >= 1024 ? ['.bio-block:first-child'] : []),
    ].map((selector) => box(selector)?.bottom ?? Infinity);
    return {
      rows: rows.map((row) => row.dataset['row']),
      bottom: Math.max(...bottoms),
      hero: box('[data-row="1"]')?.height ?? 0,
      name: box('.nameplate')?.height ?? 0,
    };
  });
}

for (const viewport of VIEWPORTS) {
  test.describe(`${viewport.width}×${viewport.height}`, () => {
    test.use({ viewport });

    const results: Partial<Record<Fonts, Awaited<ReturnType<typeof measure>>>> = {};

    for (const fonts of ['loaded', 'blocked'] as const) {
      test(`the opening's lead ends inside the first screen, fonts ${fonts}`, async ({ page }) => {
        const result = await measure(page, fonts);
        results[fonts] = result;
        console.log(
          `fold ${viewport.width}×${viewport.height} fonts ${fonts}: ${JSON.stringify(result)}`,
        );
        expect(result.rows).toEqual(['1']);
        expect(result.bottom).toBeLessThanOrEqual(viewport.height);
      });
    }

    test('the opening is the same height with and without the web fonts', async ({ browser }) => {
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
