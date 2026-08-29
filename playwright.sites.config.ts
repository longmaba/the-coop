import { defineConfig, devices } from '@playwright/test';

const sitePort = process.env.THE_COOP_E2E_SITE_PORT ?? '5174';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'coop.spec.ts',
  globalSetup: './tests/e2e/sites-global-setup.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://127.0.0.1:${sitePort}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chrome-sites',
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chrome',
      },
    },
  ],
});
