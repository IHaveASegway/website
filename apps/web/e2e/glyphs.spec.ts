import { expect, test, type Page } from '@playwright/test';
import { NOT_FOUND_PAGE, pages } from './expected';
import { fallbacksOn } from './fonts-drawn';

// Glyph coverage (design-system.md, "Budgets as CI fitness functions"): every character on every
// page is drawn by a self-hosted face, never by a system fallback. Chromium says which fonts drew
// each element's text (DevTools Protocol, CSS.getPlatformFontsForNode), after text-transform,
// so the check reads what was painted rather than a list of selectors that could drift.

for (const path of [...pages(), NOT_FOUND_PAGE]) {
  test(`every glyph on ${path} comes from a self-hosted face`, async ({ page }) => {
    await page.goto(path);
    const { fallbacks, elements, painted } = await fallbacksOn(page);
    expect(elements).toBeGreaterThan(5);
    // Hidden elements paint nothing and report no font; enough of the page must have painted.
    expect(painted).toBeGreaterThan(5);
    expect(fallbacks).toEqual([]);
  });
}

// The known answer. The check relies on Chromium reporting a face that local() maps to a system
// font, such as the fitted Arial fallback, as the system font (isCustomFont false), not as a web
// face. If that ever changed, every page above would pass while drawing glyphs in Arial. So a
// character outside both subsets (Ł, ó and ź are not in them) must be reported here.
test('known answer: a glyph outside the subsets is reported, with the system font that drew it', async ({
  page,
}) => {
  await page.goto('/');
  await page.evaluate(() => {
    const title = document.querySelector('.hero-title');
    if (!title) throw new Error('Home has no title line');
    title.textContent = 'Łódź';
  });
  const { fallbacks } = await fallbacksOn(page);
  expect(fallbacks.filter((line) => line.includes('"Łódź"')).length).toBeGreaterThan(0);
});

// A page fetches a face's file only if it draws text in that face (design-system.md, "The faces").
// Instrument Sans draws every page's first screen and is preloaded; JetBrains Mono sets values and
// code, so it is fetched where a page uses it. On 2026-10-24's build every page preloaded both, and
// the 404, which sets nothing in mono, fetched its 8,156 B anyway.

/** The font files a page fetched, and those of them whose face drew none of its text. `before`
 *  runs once the page has loaded, before the faces are read. */
async function unusedFonts(
  page: Page,
  path: string,
  before?: () => Promise<unknown>,
): Promise<{ fetched: string[]; unused: string[]; drawn: Set<string> }> {
  const fetched: string[] = [];
  page.on('request', (request) => {
    if (request.resourceType() === 'font') fetched.push(new URL(request.url()).pathname);
  });
  await page.goto(path);
  await before?.();
  const { drawn } = await fallbacksOn(page);
  // Each file's family, read from the page's own @font-face rules, without the Fonts API's hash.
  const families = await page.evaluate(() =>
    Object.fromEntries(
      [...document.styleSheets]
        .flatMap((sheet) => [...sheet.cssRules])
        .filter((rule): rule is CSSFontFaceRule => rule instanceof CSSFontFaceRule)
        .flatMap((rule) => {
          const src = /url\("?([^")]+)"?\)/.exec(rule.style.getPropertyValue('src'))?.[1];
          const family = rule.style.getPropertyValue('font-family').replace(/"/g, '');
          return src
            ? [[new URL(src, location.href).pathname, family.replace(/-[0-9a-f]+$/, '')]]
            : [];
        }),
    ),
  );
  return { fetched, unused: fetched.filter((file) => !drawn.has(families[file] ?? file)), drawn };
}

for (const path of [...pages(), NOT_FOUND_PAGE]) {
  test(`${path} fetches a font file only for a face it draws text in`, async ({ page }) => {
    const { fetched, unused, drawn } = await unusedFonts(page, path);
    expect(fetched.length, 'the page fetches its text face').toBeGreaterThan(0);
    expect(unused, `drawn in: ${[...drawn].join(', ')}`).toEqual([]);
  });
}

// The known answer: a page that fetches the mono file and draws nothing in it, as every page did
// with the preload, is reported, with that one file. The 404 sets nothing in mono on every build
// but the command menu's keys in its footer, which this copy of it leaves out; Home on the writing
// fixture sets a post's date in it too.
test('known answer: a font file fetched for a face that draws no text is reported', async ({
  page,
}) => {
  await page.route(`**${NOT_FOUND_PAGE}`, async (route) => {
    const response = await route.fetch();
    const body = (await response.text()).replace(/<li class="palette-item">.*?<\/li>/s, '');
    expect(body).not.toContain('palette-item');
    await route.fulfill({ response, body });
  });
  const { unused } = await unusedFonts(page, NOT_FOUND_PAGE, () =>
    page.evaluate(async () => {
      const mono = [...document.fonts].find((face) =>
        face.family.replace(/"/g, '').startsWith('JetBrains Mono-'),
      );
      if (!mono) throw new Error('the 404 declares no mono face');
      await mono.load();
    }),
  );
  expect(unused).toHaveLength(1);
  expect(unused[0]).toMatch(/\.woff2$/);
});
