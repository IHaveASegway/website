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
    declaredFonts: declaredFonts(page).reduce(
      (sum, href) => sum + bytes(fileFor(href)).byteLength,
      0,
    ),
  };
}

/**
 * Features with budgets of their own (ADR 0016; design-system.md, "Budgets as CI fitness
 * functions"). A feature owns the files under its paths, its entry bundle and every chunk that
 * bundle reaches through its imports. Only the Route Lab has one: its lazy JavaScript (the app
 * chunk and the solver's three modules), its WebAssembly, the route data it fetches, and its
 * page's first view with and without one solve. Every other lazy file keeps the 2,000 B a feature
 * budget. Astro writes a component's bundles into every build, so a build without the page (the
 * writing fixtures) still holds them, and they still belong to the feature.
 */
export const FEATURES = {
  'route-lab': {
    page: 'lab/routes/index.html',
    entry: /^_astro\/RouteLab\.astro_astro_type_script_index_0_lang\.[\w-]+\.js$/,
    paths: ['lab/routes/solver/'],
    lazyJavaScript: 12_000,
    wasm: 360_000,
    data: 60_000,
    firstView: 150_000,
    firstSolve: 600_000,
  },
} as const;

export type Feature = keyof typeof FEATURES;

/** The relative modules a script imports, statically or with import(): "./x.js" and the like. */
export function importsOf(script: string): string[] {
  return [
    ...script.matchAll(
      /\bimport\(\s*[`'"]([^`'"]+)[`'"]\s*\)|\b(?:from|import)\s*[`'"](\.{1,2}\/[^`'"]+)[`'"]/g,
    ),
  ].map(([, dynamic, stat]) => (dynamic ?? stat ?? '') as string);
}

/** Every chunk some scripts reach through their imports, as dist/ files, without the scripts
 *  themselves: the lazy JavaScript a page's eager scripts can load. */
const reached = new Map<string, string[]>();
export function reachable(page: string): string[] {
  return reachableFrom(eagerScripts(read(page)).external.map(fileFor));
}

export function reachableFrom(eager: readonly string[]): string[] {
  const key = eager.join(' ');
  const known = reached.get(key);
  if (known) return known;
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
