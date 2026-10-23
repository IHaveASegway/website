import { defineConfig } from 'vitest/config';

// Unit tests are fitness functions: each one turns a rule from the docs into a failing build.
// e2e/*.spec.ts belongs to Playwright, so only test/ is collected here.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // Vitest stubs CSS imports as empty strings. The Open Graph renderer reads its colors from
    // tokens.css with a ?raw import, as the build does, so that one file is passed through.
    css: { include: [/src\/styles\/tokens\.css/] },
  },
});
