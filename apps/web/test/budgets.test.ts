import { describe, expect, test } from 'vitest';
import { declaredFonts, eagerScripts, gzipBytes, preloadedFonts } from '../src/lib/weights';
import { bytes, fileFor, files, html, kinds, read } from './support/dist';
import { BUDGETS, FEATURES, featureOf, gz, importsOf, measure, reachable } from './support/measure';

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

/** Every script no page loads eagerly: the lazy JavaScript a feature loads when it is used. */
const eager = new Set(html.flatMap((file) => eagerScripts(read(file)).external.map(fileFor)));
const lazy = files.filter((file) => /\.m?js$/.test(file) && !eager.has(file));

/** The lazy files over the general budget: each one outside a feature with a budget of its own
 *  (FEATURES) stays within 2,000 B, alone. */
export function lazyOverBudget(entries: readonly { file: string; bytes: number }[]): string[] {
  return entries
    .filter((e) => featureOf(e.file) === null && e.bytes > BUDGETS.lazyJavaScriptPerFeature)
    .map((e) => `${e.file}: ${e.bytes} B`);
}

test('lazy JavaScript: every script no page loads eagerly stays within one feature budget', () => {
  // A feature's code arrives as files no page names in a <script src>.
  expect(lazyOverBudget(lazy.map((file) => ({ file, bytes: gzipBytes(bytes(file)) })))).toEqual([]);
});

// The Route Lab's own budgets (ADR 0016). Its page keeps the eager budget above, like every page;
// only what loads once a visitor touches the demo has larger ones. The solver's files ship in
// every build, from public/; the page, and so the first-view figures, only where the lab builds.
describe('the Route Lab', () => {
  const feature = FEATURES['route-lab'];
  const own = files.filter((file) => featureOf(file) === 'route-lab');
  // Its lazy JavaScript: every script it owns but its entry bundle, which its page loads eagerly
  // and the eager budget above counts.
  const ownJs = own.filter((file) => /\.m?js$/.test(file) && !feature.entry.test(file));
  const wasm = files.filter((file) => kinds.get(file) === 'wasm');
  const page = files.includes(feature.page) ? read(feature.page) : null;
  const data = page ? fileFor(/data-rl-data="([^"]+)"/.exec(page)?.[1] ?? '') : null;

  test('owns the solver: three modules and one WebAssembly file, all lazy', () => {
    expect(ownJs.filter((f) => f.endsWith('.mjs'))).toHaveLength(3);
    expect(wasm.map(featureOf)).toEqual(['route-lab']);
    for (const file of ownJs) expect(eager.has(file), file).toBe(false);
  });

  const lazyBytes = ownJs.reduce((sum, file) => sum + gz(file), 0);
  test(`lazy JavaScript: ${lazyBytes} B of ${feature.lazyJavaScript}`, () => {
    expect(lazyBytes).toBeLessThanOrEqual(feature.lazyJavaScript);
  });

  const wasmBytes = wasm.reduce((sum, file) => sum + gz(file), 0);
  test(`WebAssembly: ${wasmBytes} B of ${feature.wasm}`, () => {
    expect(wasmBytes).toBeLessThanOrEqual(feature.wasm);
  });

  test.runIf(page !== null)('the page reaches its app through import(), and nothing else', () => {
    const chunks = reachable(feature.page);
    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) expect(featureOf(chunk)).toBe('route-lab');
  });

  test.runIf(page !== null)('the route data it fetches is one JSON file within its budget', () => {
    expect(data && files.includes(data), String(data)).toBe(true);
    expect(gz(data ?? '')).toBeLessThanOrEqual(feature.data);
  });

  // Its fonts are every face the page declares, not only the preloaded one: since 2026-10-25 the
  // mono face is fetched where a page draws it, not preloaded, and the Route Lab draws it on its
  // first screen (its labels, the days' notes, the vans), so a visitor fetches both faces before
  // the page is complete. e2e/glyphs.spec.ts requires every face a page fetches to draw some text.
  test.runIf(page !== null)(
    `its page's first view, HTML, CSS, the fonts it declares and eager JavaScript, stays within ${feature.firstView} B, and one solve within ${feature.firstSolve} B`,
    () => {
      const figures = measure(page ?? '');
      expect(declaredFonts(page ?? '')).toEqual(expect.arrayContaining(preloadedFonts(page ?? '')));
      const firstView =
        gzipBytes(page ?? '') + figures.css + figures.declaredFonts + figures.eagerJavaScript;
      expect(firstView).toBeLessThanOrEqual(feature.firstView);
      const firstSolve = firstView + gz(data ?? '') + lazyBytes + wasmBytes;
      expect(firstSolve).toBeLessThanOrEqual(feature.firstSolve);
    },
  );
});

test('known answers: the measure counts inline scripts and styles, and skips data blocks', () => {
  const page =
    '<style>a{color:red}</style><script>let a=1</script>' +
    '<script type="application/ld+json">{"a":1}</script><script type="module">let b=2</script>';
  const figures = measure(page);
  expect(figures.eagerJavaScript).toBe(gzipBytes('let a=1') + gzipBytes('let b=2'));
  expect(figures.css).toBe(gzipBytes('a{color:red}'));
  expect(figures.preloadedFonts).toBe(0);
  expect(figures.declaredFonts).toBe(0);
});

test('known answers: a page declares each face its @font-face names once, preloaded or not', () => {
  const face = (family: string, src: string) =>
    `@font-face{font-family:"${family}";src:${src} format("woff2");font-display:swap}`;
  const page =
    `<style>${face('S', 'url("/_astro/fonts/s.woff2")')}${face('S', 'url("/_astro/fonts/s.woff2")')}` +
    `${face('M', 'url(/_astro/fonts/m.woff2)')}</style>` +
    '<link rel="preload" href="/_astro/fonts/s.woff2" as="font" type="font/woff2" crossorigin>';
  expect(declaredFonts(page)).toEqual(['/_astro/fonts/s.woff2', '/_astro/fonts/m.woff2']);
  expect(preloadedFonts(page)).toEqual(['/_astro/fonts/s.woff2']);
  expect(declaredFonts('<p>no faces</p>')).toEqual([]);
});

test('known answers: a feature owns its paths, nothing else, and finds a chunk by its import', () => {
  expect(featureOf('lab/routes/solver/vroom-9.9.9-00000000/vroom.mjs')).toBe('route-lab');
  expect(featureOf('_astro/palette.0000.js')).toBeNull();
  expect(featureOf('lab/other/solver/x.mjs')).toBeNull();
  expect(
    FEATURES['route-lab'].entry.test(
      '_astro/RouteLab.astro_astro_type_script_index_0_lang.BW_ExEQE.js',
    ),
  ).toBe(true);
  expect(
    FEATURES['route-lab'].entry.test(
      '_astro/Other.astro_astro_type_script_index_0_lang.BW_ExEQE.js',
    ),
  ).toBe(false);
  expect(
    importsOf('import(`./app.D0Ld.js`).then(a);import"./b.js";export{c}from"../c.js"'),
  ).toEqual(['./app.D0Ld.js', './b.js', '../c.js']);
  expect(importsOf('let s="import x";fetch("./data.json")')).toEqual([]);
  // A lazy file outside every feature is held to the general budget: 2,001 B fails it, and the
  // solver's larger modules pass only because the Route Lab owns them.
  expect(
    lazyOverBudget([
      { file: '_astro/palette.0000.js', bytes: 2_001 },
      { file: '_astro/small.0000.js', bytes: 2_000 },
      { file: 'lab/routes/solver/vroom-9.9.9-00000000/vroom.mjs', bytes: 9_000 },
      { file: 'lab/other/vroom.mjs', bytes: 9_000 },
    ]),
  ).toEqual(['_astro/palette.0000.js: 2001 B', 'lab/other/vroom.mjs: 9000 B']);
});
