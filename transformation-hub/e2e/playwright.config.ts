import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests. They need the API running in DEMO mode (http://127.0.0.1:4000) with the demo seed loaded; the web
 * app is started automatically unless one is already listening on the base URL.
 * Rate limits: behind the web tier's same-origin `/api` rewrite every browser shares the API's public-route bucket
 * (the web proxy strips client-supplied X-Forwarded-For — SEC-P1-04, ADR-0017), and this suite signs in many times a
 * minute. Start the API for e2e with HUB_RATE_LIMIT_PUBLIC_PER_MINUTE=1000 (dev/test only).
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
