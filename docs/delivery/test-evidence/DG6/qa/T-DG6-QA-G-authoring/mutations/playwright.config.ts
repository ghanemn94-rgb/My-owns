import { defineConfig, devices } from "@playwright/test";
const baseURL = process.env["E2E_BASE_URL"] ?? "http://localhost:3000";
// Mutation-check config (T-DG6-QA-G): the repository config, restricted to the mutated copies in this directory.
export default defineConfig({
  testDir: ".",
  testMatch: ["e2e/*.spec.ts"],
  outputDir: process.env["QA_MUT_OUTPUT"] ?? "test-results",
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  reporter: [["list"]],
  use: { baseURL, trace: "off", screenshot: "off" },
  projects: [
    { name: "chromium-en", use: { ...devices["Desktop Chrome"], locale: "en-US", timezoneId: "Asia/Riyadh" } },
    { name: "chromium-ar", use: { ...devices["Desktop Chrome"], locale: "ar-SA", timezoneId: "Asia/Riyadh" } },
  ],
});
