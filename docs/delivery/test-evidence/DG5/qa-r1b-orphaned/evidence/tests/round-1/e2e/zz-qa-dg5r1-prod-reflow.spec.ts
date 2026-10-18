// qa-verifier DG5 round 1 probe (T-DG5-REV-QA-R1B), outside the frozen candidate; run on apps/web/e2e/support/with-stack.sh.
// The P5 screens of a technical administrator (dev.admin: ADM_ACCESS + ADM_TECH; D-163) at 390 px and at 200 % text:
// no page-level horizontal scroll, h1 visible. Everything is SYNTHETIC; nothing names the engineering gates.
import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { expectAccessible, langOf, signIn } from "../apps/web/e2e/support/ui.ts";

const EVIDENCE = process.env["QA_EVIDENCE_DIR"] ?? path.join("test-results", "qa-dg5r1");
test.setTimeout(180_000);

test("P3b: the technical administrator's P5 screens at 390 px and 200 % text", async ({ page }, info) => {
  const lang = langOf(info);
  const dir = path.join(EVIDENCE, lang);
  mkdirSync(dir, { recursive: true });
  await signIn(page, lang, "dev.admin");
  const urls = ["/admin/jobs", "/admin/branding", "/admin/demo", "/playbook/reader", "/playbook/procedures"];
  const results: string[] = [];
  const bad: string[] = [];
  for (const [mode, w] of [["390px", 390], ["200pct", 1280]] as const) {
    await page.setViewportSize({ width: w, height: mode === "390px" ? 844 : 900 });
    for (const url of urls) {
      await page.goto(url);
      await expect(page.locator("main#main h1"), `${url} h1`).toBeVisible();
      await page.waitForLoadState("networkidle");
      if (mode === "200pct") await page.evaluate(() => (document.documentElement.style.fontSize = "200%"));
      await page.waitForTimeout(150);
      const o = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      results.push(`${mode} ${url} overflow=${o} h1="${(await page.locator("main#main h1").innerText()).trim()}"`);
      if (o > 1) bad.push(`${mode} ${url} overflow=${o}`);
      await page.screenshot({ path: path.join(dir, `p3b-${mode}-${url.replace(/[^a-z0-9]+/gi, "_")}.png`) });
    }
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/admin/jobs");
  await expect(page.locator("main#main h1")).toBeVisible();
  await expectAccessible(page, lang, "qa-dg5r1-jobs");
  console.info(`QA-DG5R1 P3b ${lang}:\n${results.join("\n")}`);
  expect(bad).toEqual([]);
});
