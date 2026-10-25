import { eagerScripts, gzipBytes, pageStyles, preloadedFonts } from '../../src/lib/weights';
import { bytes, fileFor } from './dist';

// The byte budgets (design-system.md, "Budgets as CI fitness functions") and how a page is
// measured against them: gzip -9 for scripts and styles, served bytes for fonts (woff2 is already
// compressed). lib/weights.ts owns the method.

export const BUDGETS = {
  eagerJavaScript: 5_000,
  lazyJavaScriptPerFeature: 2_000,
  css: 15_000,
  preloadedFonts: 70_000,
} as const;

/** One page's figures, measured with lib/weights.ts. */
export function measure(page: string) {
  const { inline, external } = eagerScripts(page);
  const styles = pageStyles(page);
  return {
    eagerJavaScript:
      inline.reduce((sum, body) => sum + gzipBytes(body), 0) +
      external.reduce((sum, src) => sum + gzipBytes(bytes(fileFor(src))), 0),
    css:
      styles.linked.reduce((sum, href) => sum + gzipBytes(bytes(fileFor(href))), 0) +
      styles.inline.reduce((sum, body) => sum + gzipBytes(body), 0),
    preloadedFonts: preloadedFonts(page).reduce(
      (sum, href) => sum + bytes(fileFor(href)).byteLength,
      0,
    ),
  };
}
