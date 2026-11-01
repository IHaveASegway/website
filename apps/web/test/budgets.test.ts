import { describe, expect, test } from 'vitest';
import { declaredFonts, gzipBytes, preloadedFonts, preloadedScripts } from '../src/lib/weights';
import { bytes, fileFor, files, html, kinds, read } from './support/dist';
import { labEntry, labName, labTitle, SIMULATED_LABS } from './support/labs';
import {
  BUDGETS,
  cubeFiles,
  eagerFiles,
  entryScripts,
  FEATURES,
  HOME,
  featureOf,
  gz,
  importsOf,
  measure,
  reachable,
  reachableFrom,
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
      const firstView = figures.firstView;
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
      const { firstView } = measure(page ?? '');
      const appBytes = ownJs.filter((f) => !f.endsWith('.mjs')).reduce((s, f) => s + gz(f), 0);
      expect(firstView + appBytes + gz(data ?? '') + cubeBytes).toBeLessThanOrEqual(
        feature.cube.firstCube,
      );
    },
  );
});

// Each simulated lab's own budgets (ADR 0020, ADR 0026; support/labs.ts). Its lazy JavaScript is
// every chunk its module can load, which is what a visitor downloads when they use it, so a chunk
// two labs share (lib/sim's, which three of them import) counts in each, and in full. Nothing it
// loads is loaded eagerly by any page, nor by anything but a simulated lab's module, so these
// budgets and the Route Lab's never count the same chunk. Its page's first view
// with all of it stays within the 150 KB every page but the Route Lab's keeps.
const simulatedEntries = SIMULATED_LABS.flatMap((lab) =>
  files.filter((file) => labEntry(lab).test(file)),
);
/** Every script the build's other entries load, at once or on intent. */
const others = entryScripts().filter((file) => !simulatedEntries.includes(file));
const loadedElsewhere = new Set([...staticClosure(others), ...reachableFrom(others)]);

for (const lab of SIMULATED_LABS) {
  describe(labTitle(lab), () => {
    const feature = FEATURES[labName(lab)];
    const entry = files.filter((file) => feature.entry.test(file));
    const loads = reachableFrom(entry);
    const page = files.includes(feature.page) ? read(feature.page) : null;

    test('its module is one bundle, and nothing it loads is loaded eagerly by any page', () => {
      expect(entry).toHaveLength(1);
      expect(loads.length).toBeGreaterThan(0);
      for (const file of loads) expect(eager.has(file), file).toBe(false);
    });

    test("everything it loads is loaded by the simulated labs' modules only", () => {
      expect(loads.filter((file) => loadedElsewhere.has(file))).toEqual([]);
    });

    const lazyBytes = loads.reduce((sum, file) => sum + gz(file), 0);
    test(`lazy JavaScript: ${lazyBytes} B of ${feature.lazyJavaScript}, in ${loads.length} ${loads.length === 1 ? 'chunk' : 'chunks'}`, () => {
      expect(lazyBytes).toBeLessThanOrEqual(feature.lazyJavaScript);
    });

    test.runIf(page !== null)('the page reaches its app through import(), and nothing else', () => {
      expect([...reachable(feature.page)].sort()).toEqual([...loads].sort());
    });

    const firstView = page === null ? 0 : measure(page).firstView + lazyBytes;
    test.runIf(page !== null)(
      `its first view, and with its app: ${firstView} B of ${feature.firstView}`,
      () => {
        expect(firstView).toBeLessThanOrEqual(feature.firstView);
      },
    );
  });
}

// The check above can fail: the other entries load chunks of their own, the Route Lab's app among
// them, and each simulated lab's module is an entry of the build, which no other script imports.
test("known answers: the other entries' chunks, the Route Lab's app among them, are loaded elsewhere", () => {
  expect(others.length).toBeGreaterThan(0);
  const routeLab = reachableFrom(files.filter((file) => FEATURES['route-lab'].entry.test(file)));
  expect(routeLab.length).toBeGreaterThan(0);
  for (const file of routeLab) expect(loadedElsewhere.has(file), file).toBe(true);
  expect(entryScripts()).toEqual(expect.arrayContaining(simulatedEntries));
  expect(simulatedEntries).toHaveLength(SIMULATED_LABS.length);
});

// Home's live picture (ADR 0028), the Raft Lab's cluster: SVG the build writes and CSS animates,
// with no script of its own. So Home reaches nothing through import() beyond what it loads at once,
// nothing on Home fetches a chunk or data after the first paint, and its first view is all its
// visitors fetch, within the 150 KB every page keeps. Until ADR 0027 Home loaded the Route Lab's
// scene, a chunk and the day's tracks, once it had painted.
describe("Home's live picture", () => {
  const feature = HOME;
  const page = read(feature.page);

  test('is SVG in the page, linking to the Raft Lab, exactly when this build writes it', () => {
    const figure = /<figure class="orbit"[^>]*>([\s\S]*?)<\/figure>/.exec(page)?.[1] ?? '';
    const raft = files.includes('lab/raft/index.html');
    expect(figure.includes('<svg'), 'the cluster').toBe(raft);
    if (raft) expect(figure).toContain('href="/lab/raft/"');
  });

  test('Home reaches no chunk on intent: what it can load, it loads at once', () => {
    expect([...reachable(feature.page)].filter((file) => !eager.has(file))).toEqual([]);
  });

  test(`Home's first view stays within ${feature.firstView} B`, () => {
    expect(measure(page).firstView).toBeLessThanOrEqual(feature.firstView);
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
  // The first view counts the page, which holds its inline code: once, not again beside it.
  expect(figures.firstView).toBe(gzipBytes(page));
});

test('known answers: a page that preloads a module loads it eagerly, with what that imports', () => {
  expect(
    preloadedScripts(
      '<link rel="modulepreload" href="/_astro/a.js"><link rel="preload" as="script" href="/_astro/b.js">' +
        '<link rel="preload" href="/_astro/fonts/c.woff2" as="font"><link rel="stylesheet" href="/_astro/d.css">',
    ),
  ).toEqual(['/_astro/a.js', '/_astro/b.js']);
  // Every chunk a simulated lab loads, preloaded by some page, is that page's eager JavaScript, so
  // the check that nothing a lab loads is loaded eagerly by any page would refuse it.
  for (const lab of SIMULATED_LABS) {
    const loads = reachableFrom(files.filter((file) => labEntry(lab).test(file)));
    for (const file of loads) {
      const page = `<link rel="modulepreload" href="/${file}">`;
      expect(eagerFiles(page), file).toContain(file);
      expect(measure(page).eagerJavaScript).toBeGreaterThanOrEqual(gz(file));
    }
  }
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
