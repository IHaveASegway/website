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
    // Everything here runs in Node: build-time templates, scripts, tests and configs. Pages ship
    // no JavaScript; when a browser script arrives, it gets browser globals of its own.
    languageOptions: { globals: { ...globals.node } },
  },
]);
