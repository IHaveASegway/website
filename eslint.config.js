// One flat config for the repository: JavaScript, TypeScript and Astro files.
import js from '@eslint/js';
import astro from 'eslint-plugin-astro';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig([
  globalIgnores([
    '**/dist/',
    '**/dist-preview/',
    '**/.fixtures/',
    '**/.astro/',
    '**/.wrangler/',
    '**/playwright-report/',
    '**/playwright-report-writing/',
    '**/test-results/',
    '**/test-results-writing/',
    // The Route Lab's solver as it ships: Emscripten's minified glue and the wrappers, a build
    // output pinned byte for byte by its lock (ADR 0016). Their source is linted in tools/vroom-wasm.
    'apps/web/public/lab/routes/solver/',
  ]),
  js.configs.recommended,
  tseslint.configs.recommended,
  astro.configs.recommended,
  {
    // Everything here runs in Node: build-time templates, scripts, tests and configs.
    languageOptions: { globals: { ...globals.node } },
  },
  {
    // Except the scripts a page runs: the inline theme script (apps/web/src/scripts), and the Route
    // Lab's worker and the page its browser test loads (tools/vroom-wasm).
    files: [
      'apps/web/src/scripts/**/*.js',
      'tools/vroom-wasm/vroom-worker.mjs',
      'tools/vroom-wasm/test/browser/**/*.mjs',
    ],
    languageOptions: { globals: { ...globals.browser, ...globals.worker } },
  },
  {
    // The solver's browser test runs in Node and hands functions to the page it drives.
    files: ['tools/vroom-wasm/test/browser.mjs'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
]);
