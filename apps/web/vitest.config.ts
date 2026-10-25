import { defineConfig } from 'vitest/config';

// Unit tests are fitness functions: each one turns a rule from the docs into a failing build.
// e2e/*.spec.ts belongs to Playwright, so only test/ is collected here.
//
// "site" runs everything on dist/, the build that deploys. The other projects run the checks over
// a build again on the builds that hold what dist/ may not hold yet (scripts/build-fixtures.mjs):
//   site preview              dist-preview/, the real posts with drafts, which pull requests preview
//   writing fixture           five published posts, both indexes and the feed
//   writing fixture preview   the same with a draft, as a preview builds it
//   writing fixture at one    one published post and two drafts, drafts included: Writing at its
//                             minimum, and a draft that links the listed post
//   writing fixture, drafts   two drafts and nothing published, drafts included: what a pull
//     only                    request's preview builds while its one post is still a draft
// so every page type meets every check before a real post exists.
const DIST_CHECKS = [
  'budgets',
  'csp',
  'dist-files',
  'fonts',
  'glyph-coverage',
  'headings',
  'jsonld',
  'llms',
  'nav',
  'not-on-site',
  'og',
  'prose',
  'project-cards',
  'readiness',
  'readouts',
  'resume',
  'scripts',
  'theme-color',
  'tokens',
  'urls',
  'wasm',
].map((name) => `test/${name}.test.ts`);

// profile: the PROFILE_FIXTURE the build was made with (scripts/build-fixtures.mjs), so the checks
// read the same profile the build did.
const rerun = (name: string, build: string, drafts: 'include' | 'exclude', profile = '') => ({
  extends: true,
  test: {
    name,
    include: DIST_CHECKS,
    env: { TEST_DIST: build, DRAFTS: drafts, PROFILE_FIXTURE: profile },
  },
});

export default defineConfig({
  test: {
    environment: 'node',
    // Vitest stubs CSS imports as empty strings. The Open Graph renderer reads its colors from
    // tokens.css with a ?raw import, as the build does, so that one file is passed through.
    css: { include: [/src\/styles\/tokens\.css/] },
    projects: [
      {
        extends: true,
        test: { name: 'site', include: ['test/**/*.test.ts'], env: { PROFILE_FIXTURE: '' } },
      },
      rerun('site preview', 'dist-preview', 'include'),
      rerun('writing fixture', '.fixtures/fixture-many', 'exclude', 'resume'),
      rerun('writing fixture preview', '.fixtures/fixture-many-preview', 'include', 'resume'),
      rerun('writing fixture at one', '.fixtures/fixture-one-preview', 'include'),
      rerun('writing fixture, drafts only', '.fixtures/fixture-none-preview', 'include'),
    ],
  },
});
