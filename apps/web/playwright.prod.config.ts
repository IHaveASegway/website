import { defineConfig, devices } from '@playwright/test';
import { ORIGIN } from './e2e/expected';

// prod-smoke: the live site through the zone, which no preview passes through: HSTS, the www
// redirect, and HTML no zone feature has rewritten (delivery.md, "Quality gates"). It also runs the
// smoke every preview and Version URL gets (route status and content, the 404 page, the
// trailing-slash redirect), because production is reached through the zone and they are not.
export default defineConfig({
  testDir: './e2e',
  testMatch: ['prod.spec.ts', 'smoke.spec.ts'],
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: ORIGIN,
    trace: 'retain-on-failure',
  },
});
