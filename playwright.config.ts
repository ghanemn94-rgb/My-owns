// Playwright config (ADR-0012). CF-2 resolution: browsers are NEVER downloaded (`playwright install` is not
// run anywhere). @playwright/test is pinned to exactly 1.56.1, whose browser registry expects chromium-1194;
// that revision is pre-installed under PLAYWRIGHT_BROWSERS_PATH (/opt/pw-browsers in the build sandbox, the
// version-matched Playwright image's /ms-playwright in CI). Changing the pin requires a matching browser
// image and an ADR-0012 update.
import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env["E2E_BASE_URL"] ?? "http://localhost:3000";

export default defineConfig({
  // e2e/** belongs to qa-verifier (acceptance suites); apps/web/e2e/** to frontend-ux-engineer (journeys,
  // visual EN/AR screenshots). Disjoint directories, so parallel worktrees never edit the same spec file.
  testDir: ".",
  testMatch: ["e2e/**/*.spec.ts", "apps/web/e2e/**/*.spec.ts"],
  testIgnore: ["**/node_modules/**"],
  outputDir: "test-results",
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium-en", use: { ...devices["Desktop Chrome"], locale: "en-US", timezoneId: "Asia/Riyadh" } },
    { name: "chromium-ar", use: { ...devices["Desktop Chrome"], locale: "ar-SA", timezoneId: "Asia/Riyadh" } },
  ],
});
