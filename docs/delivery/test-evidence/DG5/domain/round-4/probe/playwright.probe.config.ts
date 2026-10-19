// domain-reviewer DG5 round-4 probe config (copied from round 3) (disposable clone only).
import { defineConfig, devices } from "@playwright/test";
const baseURL = process.env["E2E_BASE_URL"] ?? "http://localhost:3000";
export default defineConfig({
  testDir: ".",
  testMatch: [process.env["PROBE_MATCH"] ?? "dom-prod.spec.ts"],
  outputDir: process.env["PROBE_OUT"] + "/test-results",
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  timeout: 180_000,
  use: { baseURL, trace: "off", screenshot: "only-on-failure" },
  projects: [
    { name: "chromium-en", use: { ...devices["Desktop Chrome"], locale: "en-US", timezoneId: "Asia/Riyadh" } },
    { name: "chromium-ar", use: { ...devices["Desktop Chrome"], locale: "ar-SA", timezoneId: "Asia/Riyadh" } },
  ],
});
