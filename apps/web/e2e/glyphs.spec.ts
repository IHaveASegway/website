import { expect, test, type Page } from '@playwright/test';
import { NOT_FOUND_PAGE, pages } from './expected';

// Glyph coverage (design-system.md, "Budgets as CI fitness functions"): every character on every
// page is drawn by a self-hosted face, never by a system fallback. Chromium says which fonts drew
// each element's text (DevTools Protocol, CSS.getPlatformFontsForNode), after text-transform,
// so the check reads what was painted rather than a list of selectors that could drift.

interface DomNode {
  nodeId: number;
  nodeType: number;
  nodeName: string;
  nodeValue?: string;
  children?: DomNode[];
}

/** Elements with a text child that holds more than whitespace. */
function textParents(node: DomNode, found: DomNode[] = []): DomNode[] {
  const children = node.children ?? [];
  if (node.nodeType === 1 && children.some((c) => c.nodeType === 3 && (c.nodeValue ?? '').trim())) {
    found.push(node);
  }
  for (const child of children) textParents(child, found);
  return found;
}

/** Each element whose text a font outside the self-hosted faces drew, with that font. */
async function fallbacksOn(
  page: Page,
): Promise<{ fallbacks: string[]; elements: number; painted: number }> {
  await page.evaluate(() => document.fonts.ready);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('DOM.enable');
  await cdp.send('CSS.enable');
  const { root } = (await cdp.send('DOM.getDocument', { depth: -1 })) as { root: DomNode };
  const elements = textParents(root).filter(
    (node) => !['SCRIPT', 'STYLE', 'TITLE', 'NOSCRIPT'].includes(node.nodeName),
  );
  const fallbacks: string[] = [];
  let painted = 0;
  for (const element of elements) {
    const { fonts } = (await cdp.send('CSS.getPlatformFontsForNode', {
      nodeId: element.nodeId,
    })) as { fonts: { familyName: string; isCustomFont: boolean; glyphCount: number }[] };
    if (fonts.length > 0) painted++;
    for (const font of fonts.filter((f) => !f.isCustomFont)) {
      const text = (element.children ?? [])
        .map((c) => c.nodeValue ?? '')
        .join('')
        .trim();
      fallbacks.push(
        `<${element.nodeName.toLowerCase()}> "${text.slice(0, 40)}": ${font.glyphCount} glyphs in ${font.familyName}`,
      );
    }
  }
  await cdp.detach();
  return { fallbacks, elements: elements.length, painted };
}

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
    const proof = document.querySelector('.hero-proof');
    if (!proof) throw new Error('Home has no proof line');
    proof.textContent = 'Łódź';
  });
  const { fallbacks } = await fallbacksOn(page);
  expect(fallbacks.filter((line) => line.includes('"Łódź"')).length).toBeGreaterThan(0);
});
