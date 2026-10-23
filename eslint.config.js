// One flat config for the repository: JavaScript, TypeScript and Astro files.
import js from '@eslint/js';
import astro from 'eslint-plugin-astro';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig([
  globalIgnores([
    '**/dist/',
    '**/.astro/',
    '**/.wrangler/',
    '**/playwright-report/',
    '**/test-results/',
  ]),
  js.configs.recommended,
  tseslint.configs.recommended,
  astro.configs.recommended,
  {
    // Everything here runs in Node: build-time templates, scripts, tests and configs.
    languageOptions: { globals: { ...globals.node } },
  },
  {
    // Except the scripts a page runs: the inline theme script, for now (apps/web/src/scripts).
    files: ['apps/web/src/scripts/**/*.js'],
    languageOptions: { globals: { ...globals.browser } },
  },
]);
