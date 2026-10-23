import { defineConfig, devices } from '@playwright/test';

// BASE_URL is a Worker Preview in the e2e job, or a Version URL in the deploy job's smoke.
// Without it, the suite starts wrangler dev on dist/: the same files and _headers rules a deploy
// uploads, so build first. Production has its own config: playwright.prod.config.ts.
const target = process.env.BASE_URL || undefined; // empty when the preview was skipped
const local = 'http://127.0.0.1:8787';

export default defineConfig({
  testDir: './e2e',
  testIgnore: ['prod.spec.ts'],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0, // a flaky check is fixed, never retried into green (delivery.md, "Automatic rollback")
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: target ?? local,
    trace: 'retain-on-failure',
  },
  projects: [
    // The e2e job: everything below, in Chromium.
    { name: 'site', use: { ...devices['Desktop Chrome'] } },
    // The deploy job's smoke of the Version URL: HTTP checks only, so no browser is installed.
    { name: 'smoke', testMatch: ['smoke.spec.ts', 'headers.spec.ts'] },
  ],
  ...(target
    ? {}
    : {
        webServer: {
          command: 'pnpm run serve',
          url: `${local}/`,
          reuseExistingServer: !process.env.CI,
          timeout: 60_000,
        },
      }),
});
