import { defineConfig } from 'vitest/config';

// Unit tests are fitness functions: each one turns a rule from the docs into a failing build.
// e2e/*.spec.ts belongs to Playwright, so only test/ is collected here.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
