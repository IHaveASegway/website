import { posix } from 'node:path';
import {
  declaredFonts,
  eagerScripts,
  gzipBytes,
  pageStyles,
  preloadedFonts,
} from '../../src/lib/weights';
import { bytes, fileFor, files, read } from './dist';

// The byte budgets (design-system.md, "Budgets as CI fitness functions") and how a page is
// measured against them: gzip -9 for scripts and styles, served bytes for fonts (woff2 is already
// compressed). lib/weights.ts owns the method.

export const BUDGETS = {
  eagerJavaScript: 5_000,
  lazyJavaScriptPerFeature: 2_000,
  css: 15_000,
  preloadedFonts: 70_000,
} as const;

/** One page's figures, measured with lib/weights.ts. Its eager JavaScript is every script it
 *  names and every chunk those import statically: the browser fetches them all before any intent.
 *  Since 2026-10-27 two demos' entries share Vite's preload helper as a chunk of its own, which a
 *  count of <script src> alone would miss. */
export function measure(page: string) {
  const { inline } = eagerScripts(page);
  const styles = pageStyles(page);
  return {
    eagerJavaScript:
      inline.reduce((sum, body) => sum + gzipBytes(body), 0) +
      eagerFiles(page).reduce((sum, file) => sum + gzipBytes(bytes(file)), 0),
    css:
      styles.linked.reduce((sum, href) => sum + gzipBytes(bytes(fileFor(href))), 0) +
      styles.inline.reduce((sum, body) => sum + gzipBytes(body), 0),
    preloadedFonts: preloadedFonts(page).reduce(
      (sum, href) => sum + bytes(fileFor(href)).byteLength,
      0,
    ),
    declaredFonts: declaredFonts(page).reduce(
      (sum, href) => sum + bytes(fileFor(href)).byteLength,
      0,
    ),
  };
}

/**
 * Features with budgets of their own (ADR 0016; design-system.md, "Budgets as CI fitness
 * functions"). A feature owns the files under its paths, its entry bundle and every chunk that
 * bundle reaches through its imports. The Route Lab's are its lazy JavaScript (the app
 * chunk and the solver's three modules), its WebAssembly, the route data it fetches, and its
 * page's first view with and without one solve. Every other lazy file keeps the 2,000 B a feature
 * budget. Astro writes a component's bundles into every build, so a build without the page (the
 * writing fixtures) still holds them, and they still belong to the feature.
 *
 * The space-time cube (ADR 0019) is a part of the Route Lab with a budget of its own: its chunk,
 * which holds three.js, and every chunk only it reaches. It loads only on intent at the cube, so
 * it counts in neither the lab's lazy JavaScript nor its first solve, and those keep their
 * meaning: a solver that grew would still fail them. Its own ceiling, the first view with the app,
 * the route data and the cube, is what a visitor who turns the cube has fetched.
 *
 * The Raft Lab (ADR 0020) has one too: its app chunk, and the first view of its page.
 *
 * So does the Queue Lab (ADR 0026), the same way.
 *
 * So does Home's scene (ADR 0024): the chunk that drives it, which Home's motion module loads after
 * the page has painted, the day's data it fetches, and Home's first view with both. It shares the
 * Route Lab's camera and formats (lib/route-lab), whose chunks the Route Lab owns; Home's first
 * view counts them too, since its visitors fetch them.
 */
export const FEATURES = {
  'route-lab': {
    page: 'lab/routes/index.html',
    entry: /^_astro\/RouteLab\.astro_astro_type_script_index_0_lang\.[\w-]+\.js$/,
    paths: ['lab/routes/solver/'],
    lazyJavaScript: 12_000,
    wasm: 360_000,
    data: 60_000,
    // 160 KB since the space-time cube's pictures (ADR 0019); every other page keeps 150 KB.
    firstView: 160_000,
    firstSolve: 600_000,
    cube: {
      entry: /^_astro\/cube\.[\w-]+\.js$/,
      lazyJavaScript: 150_000,
      firstCube: 400_000,
    },
  },
  // The Raft Lab (ADR 0020): its app, the servers, the simulator, the checker and what it draws,
  // in one chunk loaded on intent. No data file and no WebAssembly; its page keeps 150 KB.
  'raft-lab': {
    page: 'lab/raft/index.html',
    entry: /^_astro\/RaftLab\.astro_astro_type_script_index_0_lang\.[\w-]+\.js$/,
    paths: [],
    lazyJavaScript: 8_000,
    firstView: 150_000,
  },
  // The Queue Lab (ADR 0026): its app, the broker and workers, the checker and what it draws, in one
  // chunk loaded on intent, as the Raft Lab's. No data file and no WebAssembly; its page keeps 150 KB.
  // Its chunk measured 11,524 B on 2026-10-30, over the Raft Lab's 8,000: the core alone (lib/queue,
  // lib/sim) is about 6.2 KB, and the picture, its words and the controls the rest. Some of it never
  // runs on the page: the test-only faults (118 B) and resizing the pool (111 B, besides a leaving
  // worker's steps), which replay reaches and no control does; without both it would be 11,273 B.
  // So the budget is 12,000 B, a raise for ADR 0026 to accept or refuse.
  'queue-lab': {
    page: 'lab/queue/index.html',
    entry: /^_astro\/QueueLab\.astro_astro_type_script_index_0_lang\.[\w-]+\.js$/,
    paths: [],
    lazyJavaScript: 12_000,
    firstView: 150_000,
  },
  // Home's scene (ADR 0024): the canvas that drives the Route Lab's day behind the hero, and the
  // day's tracks it fetches. No library and no WebAssembly; Home keeps 150 KB with both.
  'route-scene': {
    page: 'index.html',
    entry: /^_astro\/route-scene\.[\w-]+\.js$/,
    paths: ['lab/routes/scene.json'],
    lazyJavaScript: 6_000,
    data: 4_000,
    firstView: 150_000,
  },
} as const;

/** The cube's files: its chunk, and every chunk it reaches that the app does not reach without
 *  passing through the cube. A chunk the app and the cube share is the app's. */
export function cubeFiles(): string[] {
  const entries = files.filter((f) => FEATURES['route-lab'].cube.entry.test(f));
  const app = files.filter((f) => FEATURES['route-lab'].entry.test(f));
  const viaApp = reachableFromExcept(app, entries);
  return [...entries, ...reachableFrom(entries).filter((f) => !viaApp.includes(f))];
}

/** What some scripts reach without passing through any of `skip`. */
function reachableFromExcept(eager: readonly string[], skip: readonly string[]): string[] {
  const seen = new Set<string>(eager);
  const queue = [...eager];
  for (let file = queue.shift(); file !== undefined; file = queue.shift()) {
    for (const spec of importsOf(read(file))) {
      const target = posix.normalize(posix.join(posix.dirname(file), spec));
      if (!seen.has(target) && !skip.includes(target) && files.includes(target)) {
        seen.add(target);
        queue.push(target);
      }
    }
  }
  return [...seen].filter((file) => !eager.includes(file));
}

export type Feature = keyof typeof FEATURES;

/** The relative modules a script imports statically: `import "./x.js"` and `from "./x.js"`, never
 *  import(), which loads only when the code reaches it. */
export function staticImportsOf(script: string): string[] {
  return [...script.matchAll(/\b(?:from|import)\s*[`'"](\.{1,2}\/[^`'"]+)[`'"]/g)].map(
    ([, spec]) => spec ?? '',
  );
}

/** Scripts and every chunk they import statically, as dist/ files: what loads with them. */
export function staticClosure(scripts: readonly string[]): string[] {
  const seen = new Set<string>(scripts);
  const queue = [...scripts];
  for (let file = queue.shift(); file !== undefined; file = queue.shift()) {
    for (const spec of staticImportsOf(read(file))) {
      const target = posix.normalize(posix.join(posix.dirname(file), spec));
      if (!seen.has(target) && files.includes(target)) {
        seen.add(target);
        queue.push(target);
      }
    }
  }
  return [...seen];
}

/** A page's eager JavaScript files: the scripts it names and their static imports. */
export const eagerFiles = (page: string): string[] =>
  staticClosure(eagerScripts(page).external.map(fileFor));

/** The relative modules a script imports, statically or with import(): "./x.js" and the like. */
export function importsOf(script: string): string[] {
  return [
    ...script.matchAll(
      /\bimport\(\s*[`'"]([^`'"]+)[`'"]\s*\)|\b(?:from|import)\s*[`'"](\.{1,2}\/[^`'"]+)[`'"]/g,
    ),
  ].map(([, dynamic, stat]) => (dynamic ?? stat ?? '') as string);
}

/** Every chunk some scripts reach through their imports, as dist/ files, without the scripts
 *  themselves or what they import statically: the lazy JavaScript a page's eager scripts can load. */
const reached = new Map<string, string[]>();
export function reachable(page: string): string[] {
  return reachableFrom(eagerScripts(read(page)).external.map(fileFor));
}

export function reachableFrom(scripts: readonly string[]): string[] {
  const key = scripts.join(' ');
  const known = reached.get(key);
  if (known) return known;
  const eager = staticClosure(scripts);
  const seen = new Set<string>(eager);
  const queue = [...eager];
  for (let file = queue.shift(); file !== undefined; file = queue.shift()) {
    for (const spec of importsOf(read(file))) {
      const target = posix.normalize(posix.join(posix.dirname(file), spec));
      if (!seen.has(target) && files.includes(target)) {
        seen.add(target);
        queue.push(target);
      }
    }
  }
  const lazy = [...seen].filter((file) => !eager.includes(file));
  reached.set(key, lazy);
  return lazy;
}

/** The feature a dist/ file belongs to, or null: under one of its paths, its entry bundle, or a
 *  chunk that bundle reaches. */
export function featureOf(file: string): Feature | null {
  for (const [name, feature] of Object.entries(FEATURES) as [
    Feature,
    (typeof FEATURES)[Feature],
  ][]) {
    if (feature.paths.some((path) => file.startsWith(path))) return name;
    const entries = files.filter((f) => feature.entry.test(f));
    if (entries.includes(file) || reachableFrom(entries).includes(file)) return name;
  }
  return null;
}

/** gzip -9 bytes of a dist/ file. */
export const gz = (file: string): number => gzipBytes(bytes(file));
