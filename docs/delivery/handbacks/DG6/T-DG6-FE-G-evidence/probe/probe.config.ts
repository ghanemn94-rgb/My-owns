// T-DG6-FE-G probe config (evidence only, not part of the product suites): runs fe-g-probe.spec.ts against a real
// stack started by apps/web/e2e/support/with-stack.sh, in chromium-en and chromium-ar.
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: ["fe-g-probe.spec.ts"],
  outputDir: process.env["PROBE_OUTPUT_DIR"] ?? "test-results",
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  use: { baseURL: process.env["E2E_BASE_URL"] ?? "http://localhost:3000", screenshot: "only-on-failure" },
  projects: [
    { name: "chromium-en", use: { ...devices["Desktop Chrome"], locale: "en-US", timezoneId: "Asia/Riyadh" } },
    { name: "chromium-ar", use: { ...devices["Desktop Chrome"], locale: "ar-SA", timezoneId: "Asia/Riyadh" } },
  ],
});
