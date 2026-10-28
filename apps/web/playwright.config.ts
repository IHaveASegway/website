import { defineConfig, devices } from '@playwright/test';
import { ON_WRITING_FIXTURE } from './e2e/expected';

// BASE_URL is a Worker Preview in the e2e job, or a Version URL in the deploy job's smoke.
// Without it, the suite starts wrangler dev on dist/: the same files and _headers rules a deploy
// uploads, so build first. Production has its own config: playwright.prod.config.ts.
//
// pnpm e2e:writing (E2E_SITE=writing-fixture) checks the test-only writing fixture build instead:
// wrangler dev on .fixtures/fixture-many, so posts, indexes and the feed meet axe, the CSP, the
// glyph and held-name checks and the smoke before a real post exists. Build it first with
// pnpm build:fixtures.
const target = ON_WRITING_FIXTURE ? undefined : process.env.BASE_URL || undefined; // empty when the preview was skipped
const local = ON_WRITING_FIXTURE ? 'http://127.0.0.1:8788' : 'http://127.0.0.1:8787';
// Each run keeps its own report and traces: the e2e job runs both, one after the other, and a
// second run would otherwise delete the first one's evidence when the first one failed.
const suffix = ON_WRITING_FIXTURE ? '-writing' : '';

export default defineConfig({
  testDir: './e2e',
  testIgnore: ['prod.spec.ts'],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0, // a flaky check is fixed, never retried into green (delivery.md, "Automatic rollback")
  outputDir: `test-results${suffix}`,
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never', outputFolder: `playwright-report${suffix}` }]]
    : 'list',
  use: {
    baseURL: target ?? local,
    trace: 'retain-on-failure',
  },
  projects: [
    // The e2e job: everything below, in Chromium.
    {
      name: 'site',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: ['prod.spec.ts', 'writing.spec.ts'],
    },
    // The deploy job's smoke of the Version URL: HTTP checks only, so no browser is installed.
    { name: 'smoke', testMatch: ['smoke.spec.ts', 'headers.spec.ts'] },
    // The writing fixture: every check that walks the page list, plus what only posts have, and
    // the résumé printed with the most roles and skills its schema allows. Home's own checks
    // (fold, motion, theme) run on the site, where Home is the same page.
    {
      name: 'writing-fixture',
      use: { ...devices['Desktop Chrome'] },
      testMatch: [
        'a11y.spec.ts',
        'csp.spec.ts',
        'glyphs.spec.ts',
        'llms.spec.ts',
        'not-on-site.spec.ts',
        'print.spec.ts',
        'about-print.spec.ts',
        'smoke.spec.ts',
        'writing.spec.ts',
      ],
    },
  ],
  ...(target
    ? {}
    : {
        webServer: {
          command: ON_WRITING_FIXTURE ? 'pnpm run serve:fixture' : 'pnpm run serve',
          url: `${local}/`,
          reuseExistingServer: !process.env.CI,
          timeout: 60_000,
        },
      }),
});
