import { defineConfig, devices } from '@playwright/test';

/**
 * P1 end-to-end smoke tests. They need the API running in DEMO mode (http://127.0.0.1:4000) with the demo seed
 * loaded; the web app is started automatically unless one is already listening on the base URL.
 * Browsers: set PLAYWRIGHT_BROWSERS_PATH (e.g. /opt/pw-browsers) when they are installed outside the cache.
 */
const baseURL = process.env.HUB_WEB_URL ?? 'http://127.0.0.1:3000';

export default defineConfig({
  testDir: './tests',
  // Tests sign in as shared demo personas and one of them changes a persona's saved language: run serially.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  outputDir: 'test-results',
  use: {
    baseURL,
    locale: 'en-US',
    timezoneId: 'Asia/Riyadh',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1360, height: 900 } } }],
  webServer: {
    command: 'pnpm --filter @hub/web dev',
    url: `${baseURL}/login`,
    reuseExistingServer: true,
    timeout: 120_000,
    env: { NEXT_TELEMETRY_DISABLED: '1' },
  },
});
