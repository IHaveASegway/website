import { expect, test, type Page } from '@playwright/test';
import { create } from 'fontkitten';
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
// The three Barlow faces draw every page's first screen and are preloaded; Barlow's SemiBold draws
// <strong>, and B612 Mono code, so each is fetched where a page uses it. On 2026-10-24's build every
// page preloaded the mono face, and the 404, which set nothing in it, fetched its 8,156 B anyway.

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
  // Each file's family as the font names itself, read from the file: Chromium reports a web face
  // by the family in its own name table (CSS.getPlatformFontsForNode), and a static instance's
  // carries its weight ("Barlow Condensed SemiBold", "Barlow SemiBold"), not the @font-face rule's
  // name. So the match is per face: a SemiBold fetched beside a Regular that draws is still caught.
  const families: Record<string, string> = {};
  for (const file of new Set(fetched)) {
    const font = create(Buffer.from(await (await page.request.get(file)).body()));
    if (!font.isCollection) families[file] = font.familyName;
  }
  return { fetched, unused: fetched.filter((file) => !drawn.has(families[file] ?? file)), drawn };
}

for (const path of [...pages(), NOT_FOUND_PAGE]) {
  test(`${path} fetches a font file only for a face it draws text in`, async ({ page }) => {
    const { fetched, unused, drawn } = await unusedFonts(page, path);
    expect(fetched.length, 'the page fetches its text face').toBeGreaterThan(0);
    expect(unused, `drawn in: ${[...drawn].join(', ')}`).toEqual([]);
  });
}

// The known answer: a page that fetches the mono file and draws nothing in it is reported, with that
// one file. Only a page with code declares B612 Mono (Base.astro), so the copy here is such a page
// with its code taken out, and the face is loaded anyway, as a preload of it would.
test('known answer: a font file fetched for a face that draws no text is reported', async ({
  page,
}) => {
  let withCode: string | undefined;
  for (const path of pages()) {
    if ((await (await page.request.get(path)).text()).includes('B612 Mono-')) {
      withCode = path;
      break;
    }
  }
  if (!withCode) throw new Error('no page in this build declares B612 Mono');
  await page.route(`**${withCode}`, async (route) => {
    const response = await route.fetch();
    const body = (await response.text())
      .replace(/<pre\b[\s\S]*?<\/pre>/g, '')
      .replace(/<code\b[^>]*>[\s\S]*?<\/code>/g, '');
    expect(body).not.toMatch(/<(code|pre)\b/);
    await route.fulfill({ response, body });
  });
  const { unused } = await unusedFonts(page, withCode, () =>
    page.evaluate(async () => {
      const mono = [...document.fonts].find((face) =>
        face.family.replace(/"/g, '').startsWith('B612 Mono-'),
      );
      if (!mono) throw new Error('the page declares no mono face');
      await mono.load();
    }),
  );
  expect(unused).toHaveLength(1);
  expect(unused[0]).toMatch(/\.woff2$/);
});
