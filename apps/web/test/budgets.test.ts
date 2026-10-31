import { describe, expect, test } from 'vitest';
import { declaredFonts, gzipBytes, preloadedFonts } from '../src/lib/weights';
import { bytes, fileFor, files, html, kinds, read } from './support/dist';
import {
  BUDGETS,
  cubeFiles,
  eagerFiles,
  FEATURES,
  featureOf,
  gz,
  importsOf,
  measure,
  reachable,
  staticClosure,
  staticImportsOf,
} from './support/measure';

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
/** Every script some page loads eagerly: those it names, and what they import statically. */
const eager = new Set(html.flatMap((file) => eagerFiles(read(file))));
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
  // and the eager budget above counts, and the space-time cube's, which has its own (ADR 0019).
  const cube = cubeFiles();
  const ownJs = own.filter(
    (file) => /\.m?js$/.test(file) && !feature.entry.test(file) && !cube.includes(file),
  );
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

  // The space-time cube (ADR 0019): three.js in one chunk, loaded on intent at the cube, never on
  // a scroll. A visitor who turns it has fetched the first view, the app, the route data and it.
  const cubeBytes = cube.reduce((sum, file) => sum + gz(file), 0);
  test(`the cube's lazy JavaScript: ${cubeBytes} B of ${feature.cube.lazyJavaScript}`, () => {
    expect(cube.length).toBeGreaterThan(0);
    for (const file of cube) expect(eager.has(file), file).toBe(false);
    expect(cubeBytes).toBeLessThanOrEqual(feature.cube.lazyJavaScript);
  });

  test.runIf(page !== null)(
    `its first view, the app, the route data and the cube stay within ${feature.cube.firstCube} B`,
    () => {
      const figures = measure(page ?? '');
      const firstView =
        gzipBytes(page ?? '') + figures.css + figures.declaredFonts + figures.eagerJavaScript;
      const appBytes = ownJs.filter((f) => !f.endsWith('.mjs')).reduce((s, f) => s + gz(f), 0);
      expect(firstView + appBytes + gz(data ?? '') + cubeBytes).toBeLessThanOrEqual(
        feature.cube.firstCube,
      );
    },
  );
});

// The Raft Lab's own budgets (ADR 0020): one app chunk, loaded on intent, and its page's first
// view within the 150 KB every page but the Route Lab's keeps.
describe('the Raft Lab', () => {
  const feature = FEATURES['raft-lab'];
  const own = files.filter((file) => featureOf(file) === 'raft-lab');
  const ownJs = own.filter((file) => /\.m?js$/.test(file) && !feature.entry.test(file));
  const page = files.includes(feature.page) ? read(feature.page) : null;

  test('owns one lazy chunk, and nothing a page loads eagerly', () => {
    expect(ownJs).toHaveLength(1);
    for (const file of ownJs) expect(eager.has(file), file).toBe(false);
  });

  const lazyBytes = ownJs.reduce((sum, file) => sum + gz(file), 0);
  test(`lazy JavaScript: ${lazyBytes} B of ${feature.lazyJavaScript}`, () => {
    expect(lazyBytes).toBeLessThanOrEqual(feature.lazyJavaScript);
  });

  test.runIf(page !== null)('the page reaches its app through import(), and nothing else', () => {
    const chunks = reachable(feature.page);
    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) expect(featureOf(chunk)).toBe('raft-lab');
  });

  test.runIf(page !== null)(
    `its first view, and with its app, stays within ${feature.firstView} B`,
    () => {
      const figures = measure(page ?? '');
      const firstView =
        gzipBytes(page ?? '') + figures.css + figures.declaredFonts + figures.eagerJavaScript;
      expect(firstView + lazyBytes).toBeLessThanOrEqual(feature.firstView);
    },
  );
});

// The Cache Lab's own budgets: one app chunk, loaded on intent, and its page's first view within
// the 150 KB every page but the Route Lab's keeps.
describe('the Cache Lab', () => {
  const feature = FEATURES['cache-lab'];
  const own = files.filter((file) => featureOf(file) === 'cache-lab');
  const ownJs = own.filter((file) => /\.m?js$/.test(file) && !feature.entry.test(file));
  const page = files.includes(feature.page) ? read(feature.page) : null;

  test('owns one lazy chunk, and nothing a page loads eagerly', () => {
    expect(ownJs).toHaveLength(1);
    for (const file of ownJs) expect(eager.has(file), file).toBe(false);
  });

  const lazyBytes = ownJs.reduce((sum, file) => sum + gz(file), 0);
  test(`lazy JavaScript: ${lazyBytes} B of ${feature.lazyJavaScript}`, () => {
    expect(lazyBytes).toBeLessThanOrEqual(feature.lazyJavaScript);
  });

  test.runIf(page !== null)('the page reaches its app through import(), and nothing else', () => {
    const chunks = reachable(feature.page);
    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) expect(featureOf(chunk)).toBe('cache-lab');
  });

  test.runIf(page !== null)(
    `its first view, and with its app, stays within ${feature.firstView} B`,
    () => {
      const figures = measure(page ?? '');
      const firstView =
        gzipBytes(page ?? '') + figures.css + figures.declaredFonts + figures.eagerJavaScript;
      expect(firstView + lazyBytes).toBeLessThanOrEqual(feature.firstView);
    },
  );
});

// Home's scene (ADR 0024): one chunk, which Home's motion module loads through import() after the
// page has painted, and the day's tracks it fetches; Home's first view with both, and with the
// Route Lab chunks the scene shares, within the 150 KB every page keeps.
describe("Home's scene", () => {
  const feature = FEATURES['route-scene'];
  const entry = files.filter((file) => feature.entry.test(file));
  const data = files.filter((file) => feature.paths.some((path) => file.startsWith(path)));

  test('is one lazy chunk, which no page loads eagerly', () => {
    expect(entry).toHaveLength(1);
    for (const file of entry) expect(eager.has(file), file).toBe(false);
  });

  // What a visitor fetches for it: the chunk and every chunk it imports statically.
  const fetched = staticClosure(entry);
  const lazyBytes = fetched.reduce((sum, file) => sum + gz(file), 0);
  test(`lazy JavaScript: ${lazyBytes} B of ${feature.lazyJavaScript}`, () => {
    expect(lazyBytes).toBeLessThanOrEqual(feature.lazyJavaScript);
  });

  const dataBytes = data.reduce((sum, file) => sum + gz(file), 0);
  test(`its data: ${dataBytes} B of ${feature.data}, where the Route Lab builds`, () => {
    expect(data.length).toBe(files.includes('lab/routes/index.html') ? 1 : 0);
    expect(dataBytes).toBeLessThanOrEqual(feature.data);
  });

  // The indexes load the same motion module, so they could reach the chunk too; they never do,
  // because the module loads it only where the canvas is, and only Home has one.
  test('Home reaches it through import(), and only Home has the canvas it draws on', () => {
    if (!html.some((file) => read(file).includes('data-scene-live'))) return;
    expect(reachable(feature.page)).toEqual(expect.arrayContaining(entry));
    expect(html.filter((file) => read(file).includes('data-scene-live'))).toEqual([feature.page]);
  });

  test(`Home's first view, with it, stays within ${feature.firstView} B`, () => {
    const page = read(feature.page);
    const figures = measure(page);
    const firstView =
      gzipBytes(page) + figures.css + figures.declaredFonts + figures.eagerJavaScript;
    expect(firstView + lazyBytes + dataBytes).toBeLessThanOrEqual(feature.firstView);
  });
});

test('known answers: eager JavaScript counts what a named script imports statically, not import()', () => {
  expect(staticImportsOf('import{t as e}from"./preload-helper.x.js";import"./b.js"')).toEqual([
    './preload-helper.x.js',
    './b.js',
  ]);
  expect(staticImportsOf('e(()=>import(`./app.x.js`))')).toEqual([]);
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
