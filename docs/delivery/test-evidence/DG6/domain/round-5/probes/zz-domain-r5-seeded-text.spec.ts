// domain-reviewer DG6 round 5 (T-DG6-REV-DOM-RG-R5): F-DG6-990 on the RENDERED screens, EN and AR. NOT part of the
// candidate: copied into a disposable clone's e2e/ folder and run on the production-initialized stack
// (apps/web/e2e/support/with-stack.sh). Read-only: it only opens screens as dev.admin (SYNTHETIC user) and reads them.
// Every screen that renders a text 0130 reworded is opened; the visible text AND every form control's value must hold
// no DG0-DG7 token and no internal decision/ADR id, and the new business wording must be what is shown.
import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { langOf, signIn } from "../apps/web/e2e/support/ui.ts";

const SHOTS = process.env["E2E_SCREENSHOT_DIR"] ?? "test-results/zz-domain-r5";
const DG = /DG[0-7]/;
const REF = /(?<![A-Za-z0-9_])(?:D-\d{3}|ADR-\d{4})(?![0-9])/;

async function screenText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const values = Array.from(document.querySelectorAll("input, textarea")).map(
      (e) => (e as HTMLInputElement | HTMLTextAreaElement).value,
    );
    return `${document.body.innerText}\n${values.join("\n")}`;
  });
}

async function check(page: Page, lang: string, name: string, must: RegExp[]) {
  await expect(page.locator("main#main h1").first()).toBeVisible({ timeout: 30_000 });
  await page.waitForLoadState("networkidle");
  const text = await screenText(page);
  for (const m of must) expect(text, `${name}: shows ${m}`).toMatch(m);
  const dg = text.split("\n").filter((l) => DG.test(l));
  const ref = text.split("\n").filter((l) => REF.test(l));
  console.log(`[DOM-R5 ui] ${lang} ${name}: lines with a DG token ${dg.length}, with a decision/ADR id ${ref.length}`);
  expect(dg, `${name}: DG token`).toEqual([]);
  expect(ref, `${name}: decision/ADR id`).toEqual([]);
  mkdirSync(path.join(SHOTS, lang), { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, lang, `zz-r5-${name}.png`), fullPage: true });
}

test("F-DG6-990: reworded seeded texts on the rendered admin screens (no DG0-DG7, no internal ids)", async ({ page }, info) => {
  test.setTimeout(300_000);
  const lang = langOf(info);
  await signIn(page, lang, "dev.admin");
  await expect(page.locator("html")).toHaveAttribute("dir", lang === "ar" ? "rtl" : "ltr");

  // The lists page 10 rows at a time (kpi.freshness_scan is on page 2), so the reworded text is asserted on the job's
  // own page; every list page shown is still scanned for DG tokens and internal ids.
  await page.goto("/admin/jobs/operations");
  await check(page, lang, "jobs-operations", []);

  await page.goto("/admin/jobs");
  await check(page, lang, "jobs", []);

  await page.goto("/admin/jobs/operations/kpi.freshness_scan");
  await check(page, lang, "job-kpi-freshness-scan", lang === "en" ? [/the KPI freshness rule, unchanged/] : []);

  await page.goto("/admin/service-identities");
  await check(page, lang, "service-identities", []);
  // The seeded identity of the first 0114 job (a single-language reason, shown as is in both languages).
  await page.goto("/admin/service-identities/01920006-0114-7000-8000-000000000001");
  await check(page, lang, "service-identity-detail", [/Seeded declaration: the narrowest set of read permissions this job's handler needs\./]);

  await page.goto("/admin/procedures/kpi_submission");
  await check(
    page,
    lang,
    "procedure-kpi-submission",
    lang === "en" ? [/The KPI actual-submission rules apply unchanged\./] : [/تنطبق قواعد تقديم القيم الفعلية المعتمدة دون تغيير/],
  );

  await page.goto("/admin/procedures/benefit_validation");
  await check(page, lang, "procedure-benefit-validation", lang === "en" ? [/Finance validation follows the benefit validation rules/] : []);

  // The starter versions' change summary is served by listAutomationRuleVersions (checked by the API probe); the web
  // shows the rule list and rule page, which are scanned here.
  await page.goto("/admin/automation");
  await check(page, lang, "automation", []);
  await page.goto("/admin/automation/rules/01920005-0075-7000-8000-000000000101");
  await check(page, lang, "automation-rule", []);
});
