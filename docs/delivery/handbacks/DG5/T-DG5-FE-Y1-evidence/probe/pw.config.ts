import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: ".", testMatch: ["*.probe.ts"], outputDir: process.env.TMPDIR + "/probe-results", retries: 0,
  reporter: [["list"]], use: { baseURL: process.env["E2E_BASE_URL"] ?? "http://localhost:3000" },
  projects: [
    { name: "chromium-en", use: { ...devices["Desktop Chrome"], locale: "en-US", timezoneId: "Asia/Riyadh" } },
    { name: "chromium-ar", use: { ...devices["Desktop Chrome"], locale: "ar-SA", timezoneId: "Asia/Riyadh" } },
  ],
});
