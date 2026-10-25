import type { Page } from '@playwright/test';

// Which fonts drew a page's text (design-system.md, "Budgets as CI fitness functions"): Chromium
// says which fonts drew each element's text (DevTools Protocol, CSS.getPlatformFontsForNode),
// after text-transform. glyphs.spec.ts walks every page with it, for glyph coverage and for the
// faces a page fetches but never draws in, and lab.spec.ts the Route Lab after a solve, whose
// tables the browser writes.

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

/** Each element whose text a font outside the self-hosted faces drew, with that font, and the
 *  self-hosted families that drew any text. */
export async function fallbacksOn(
  page: Page,
): Promise<{ fallbacks: string[]; elements: number; painted: number; drawn: Set<string> }> {
  await page.evaluate(() => document.fonts.ready);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('DOM.enable');
  await cdp.send('CSS.enable');
  const { root } = (await cdp.send('DOM.getDocument', { depth: -1 })) as { root: DomNode };
  const elements = textParents(root).filter(
    (node) => !['SCRIPT', 'STYLE', 'TITLE', 'NOSCRIPT'].includes(node.nodeName),
  );
  const fallbacks: string[] = [];
  const drawn = new Set<string>();
  let painted = 0;
  for (const element of elements) {
    const { fonts } = (await cdp.send('CSS.getPlatformFontsForNode', {
      nodeId: element.nodeId,
    })) as { fonts: { familyName: string; isCustomFont: boolean; glyphCount: number }[] };
    if (fonts.length > 0) painted++;
    for (const font of fonts.filter((f) => f.isCustomFont)) drawn.add(font.familyName);
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
  return { fallbacks, elements: elements.length, painted, drawn };
}
