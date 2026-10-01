// Playwright config for the T-DG1-FE2 mocked-API visual evidence (see capture.spec.ts). Uses the pinned, pre-installed
// browsers (PLAYWRIGHT_BROWSERS_PATH); nothing is downloaded.
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: ["capture.spec.ts"],
  outputDir: `${process.env["TMPDIR"] ?? "/tmp"}/fe2-capture-results`,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env["E2E_BASE_URL"] ?? "http://localhost:4179",
    ...devices["Desktop Chrome"],
    timezoneId: "Asia/Riyadh",
  },
});
