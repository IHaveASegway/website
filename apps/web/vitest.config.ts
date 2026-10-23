import { defineConfig } from 'vitest/config';

// Unit tests are fitness functions: each one turns a rule from the docs into a failing build.
// e2e/*.spec.ts belongs to Playwright, so only test/ is collected here.
//
// Three projects. "site" runs everything on dist/. "writing fixture" runs the checks over the build
// again on .fixtures/fixture-three (scripts/build-fixtures.mjs): a build with essays, a note, both
// indexes and the feed, so those page types meet every check before a real post exists. "writing
// fixture preview" runs them on the same posts built as a pull request preview builds them, with a
// draft's page, which is public on the preview and so meets the same checks.
const DIST_CHECKS = [
  'budgets',
  'csp',
  'dist-files',
  'fonts',
  'jsonld',
  'nav',
  'not-on-site',
  'og',
  'readiness',
  'readouts',
  'scripts',
  'tokens',
  'urls',
].map((name) => `test/${name}.test.ts`);

export default defineConfig({
  test: {
    environment: 'node',
    // Vitest stubs CSS imports as empty strings. The Open Graph renderer reads its colors from
    // tokens.css with a ?raw import, as the build does, so that one file is passed through.
    css: { include: [/src\/styles\/tokens\.css/] },
    projects: [
      { extends: true, test: { name: 'site', include: ['test/**/*.test.ts'] } },
      {
        extends: true,
        test: {
          name: 'writing fixture',
          include: DIST_CHECKS,
          env: { TEST_DIST: '.fixtures/fixture-three', DRAFTS: 'exclude' },
        },
      },
      {
        extends: true,
        test: {
          name: 'writing fixture preview',
          include: DIST_CHECKS,
          env: { TEST_DIST: '.fixtures/fixture-three-preview', DRAFTS: 'include' },
        },
      },
    ],
  },
});
