import { describe, expect, test } from 'vitest';
import { eagerScripts, gzipBytes } from '../src/lib/weights';
import { bytes, fileFor, files, html, read } from './support/dist';
import { BUDGETS, measure } from './support/measure';

// The byte budgets, measured on dist/ (support/measure.ts). This replaces PR 2's "no JavaScript at
// all" check, as that check said it would: the theme script is the site's first JavaScript.

for (const file of html) {
  describe(file, () => {
    const figures = measure(read(file));
    test(`eager JavaScript: ${figures.eagerJavaScript} B of ${BUDGETS.eagerJavaScript}`, () => {
      expect(figures.eagerJavaScript).toBeLessThanOrEqual(BUDGETS.eagerJavaScript);
    });
    test(`CSS: ${figures.css} B of ${BUDGETS.css}`, () => {
      expect(figures.css).toBeLessThanOrEqual(BUDGETS.css);
    });
    test(`preloaded fonts: ${figures.preloadedFonts} B of ${BUDGETS.preloadedFonts}`, () => {
      expect(figures.preloadedFonts).toBeLessThanOrEqual(BUDGETS.preloadedFonts);
    });
  });
}

test('lazy JavaScript: every script no page loads eagerly stays within one feature budget', () => {
  // A feature's code arrives as a chunk that no page names in a <script src>. PR 3 has none; the
  // first one (the palette) gets a per-feature map here.
  const eager = new Set(html.flatMap((file) => eagerScripts(read(file)).external.map(fileFor)));
  const lazy = files.filter((file) => /\.m?js$/.test(file) && !eager.has(file));
  for (const file of lazy) {
    expect(gzipBytes(bytes(file)), file).toBeLessThanOrEqual(BUDGETS.lazyJavaScriptPerFeature);
  }
});

test('known answers: the measure counts inline scripts and styles, and skips data blocks', () => {
  const page =
    '<style>a{color:red}</style><script>let a=1</script>' +
    '<script type="application/ld+json">{"a":1}</script><script type="module">let b=2</script>';
  const figures = measure(page);
  expect(figures.eagerJavaScript).toBe(gzipBytes('let a=1') + gzipBytes('let b=2'));
  expect(figures.css).toBe(gzipBytes('a{color:red}'));
  expect(figures.preloadedFonts).toBe(0);
});
