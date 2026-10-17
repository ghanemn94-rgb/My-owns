// qa-verifier A02 "Complete lifecycle" (DG5, T-DG5-QA-E): the user-visible path of the guided walkthrough
// (REQ-S18-004 "Help > Guided walkthrough"; REQ-S20-002; ADR-0050 §7) on a REAL demo stack
// (e2e/support/with-demo-stack.sh: `mth-db seed-demo`, MTH_ENV=demo, the built SPA), in chromium-en and chromium-ar.
// Acceptance asserted, black-box:
//  1. A demo database shows the persistent synthetic banner on every screen (ADR-0050 §2 a).
//  2. Step 1 "create transformation" is performed in the UI with the native create form; the walkthrough of that
//     transformation lists the twelve M0349 steps in order, in the user's language (lang/dir), with step 1 done and
//     the other eleven not done, each linking to the native screen where it is performed.
//  3. A native workflow on that transformation (generating a report, step 10) turns its step to done on reload: the
//     guide reads persisted records and writes nothing.
//  4. axe: 0 serious or critical issues on the walkthrough page.
// The full twelve-step lifecycle with its records is proven on the real API and PostgreSQL in
// tests/qa/integration/a02-a21-complete-lifecycle.test.ts. The dataset's demo role users (roaming.user.<role>) sign in
// only through a demo IdP, which this sandbox does not have, so this spec signs in the SYNTHETIC dev users (BLOCKED
// item in the handback). Everything is synthetic; nothing approves anything real or names DG0-DG7.
import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import {
  apiSession,
  expectAccessible,
  fieldLabel,
  langOf,
  signIn,
  tr,
  trackRequests,
} from "../apps/web/e2e/support/ui.ts";

const EVIDENCE = process.env["QA_EVIDENCE_DIR"] ?? path.join("test-results", "qa-a02");

/** M0349, verbatim, in order. */
const M0349 = [
  "create transformation",
  "diagnose and agree baseline",
  "define outcomes/KPIs",
  "design TOM",
  "prioritize initiatives and approve mobilization",
  "update delivery/adoption",
  "submit KPI actual",
  "validate benefit",
  "resolve executive decision",
  "generate report",
  "accept BAU handover",
  "continue performance monitoring",
];

test("A02: step 1 in the native create form, then the guided walkthrough reflects the persisted records (demo database)", async ({
  page,
  playwright,
}, info) => {
  const lang = langOf(info);
  const foreign = trackRequests(page);
  const dir = path.join(EVIDENCE, lang);
  mkdirSync(dir, { recursive: true });

  await signIn(page, lang, "dev.office");
  // 1. The synthetic banner of a demo database.
  await expect(page.locator("[data-state='demo-synthetic']").first()).toBeVisible();

  // 2. Step 1 with the native create form.
  await page.goto("/transformations/new");
  await expect(
    page.getByRole("heading", { level: 1, name: tr(lang, "transformations.createTitle"), exact: true }),
  ).toBeVisible();
  await page
    .getByLabel(fieldLabel(lang, "transformations.field.businessUnit"))
    .selectOption({ label: lang === "ar" ? "العمليات (اصطناعي) (SYN-OPS)" : "Synthetic Operations (SYN-OPS)" });
  const name = `Synthetic QA A02 ${lang.toUpperCase()} walkthrough`;
  await page.getByLabel(fieldLabel(lang, "transformations.field.name")).fill(name);
  await page.getByRole("button", { name: tr(lang, "transformations.form.create"), exact: true }).click();
  await page.waitForURL(/\/transformations\/[0-9a-f-]{36}$/);
  const id = new URL(page.url()).pathname.split("/").pop()!;
  await expect(page.locator("[data-state='demo-synthetic']").first()).toBeVisible();

  // The walkthrough of that transformation.
  await page.goto(`/walkthrough?transformationId=${id}`);
  await expect(page.locator("html")).toHaveAttribute("lang", lang);
  await expect(page.locator("html")).toHaveAttribute("dir", lang === "ar" ? "rtl" : "ltr");
  const steps = page.locator("[data-list='walkthrough-steps'] > li[data-step]");
  await expect(steps).toHaveCount(12);
  await expect(page.locator("[data-progress]")).toHaveAttribute("data-progress", "1");
  const codes = await steps.evaluateAll((els) => els.map((e) => e.getAttribute("data-step")));
  expect(codes).toEqual([
    "create_transformation",
    "diagnose_baseline",
    "define_outcomes_kpis",
    "design_tom",
    "prioritize_mobilize",
    "update_delivery_adoption",
    "submit_kpi_actual",
    "validate_benefit",
    "resolve_decision",
    "generate_report",
    "accept_bau_handover",
    "continue_monitoring",
  ]);
  const done = await steps.evaluateAll((els) => els.map((e) => e.getAttribute("data-completed")));
  expect(done).toEqual(["yes", ...Array<string>(11).fill("no")]);
  const titles = await steps.locator(".card__title").allInnerTexts();
  if (lang === "en") expect(titles.map((t) => t.replace(/^\s*\d+\.\s*/, "").trim())).toEqual(M0349);
  else {
    // Arabic titles (provisional translation): Arabic script, not the English text.
    for (const [i, t] of titles.entries()) {
      expect(t, `step ${i + 1}`).toMatch(/[؀-ۿ]/);
      expect(t).not.toContain(M0349[i]!);
    }
  }
  const links = await page.locator("[data-step-link]").evaluateAll((els) => els.map((e) => e.getAttribute("href")));
  expect(links[0]).toBe(`/transformations/${id}`);
  expect(links[9]).toBe(`/transformations/${id}/reports`);
  await page.screenshot({ path: path.join(dir, "a02-walkthrough-step1.png"), fullPage: true });
  await expectAccessible(page, lang, "a02-walkthrough");

  // 3. Step 10 through the native report generation; the guide only reads it.
  const office = await apiSession(playwright, "dev.office");
  await office.call("POST", `/api/v1/transformations/${id}/reports/charter/generate`, {}, { expect: 201 });
  await page.reload();
  await expect(page.locator("[data-progress]")).toHaveAttribute("data-progress", "2");
  await expect(page.locator("li[data-step='generate_report']")).toHaveAttribute("data-completed", "yes");
  await expect(page.locator("li[data-step='diagnose_baseline']")).toHaveAttribute("data-completed", "no");
  await page.screenshot({ path: path.join(dir, "a02-walkthrough-step10.png"), fullPage: true });
  await page.locator("[data-step-link='generate_report']").click();
  await page.waitForURL(`**/transformations/${id}/reports`);
  await expect(page.locator("[data-state='demo-synthetic']").first()).toBeVisible();
  await office.req.dispose();
  expect(foreign).toEqual([]);
});
