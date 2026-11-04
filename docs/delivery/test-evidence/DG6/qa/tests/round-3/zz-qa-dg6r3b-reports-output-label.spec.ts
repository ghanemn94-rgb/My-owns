// qa-verifier DG6 round 3 continuation (T-DG6-REV-QA-R3B): independent probe, NOT part of the frozen candidate. Copied into
// a disposable copy as e2e/zz-qa-dg6r3b-reports-output-label.spec.ts and run inside apps/web/e2e/support/with-stack.sh.
// Explains the stopped run's 07c failure: e2e/a02-demo-users-walkthrough.spec.ts step 10 timed out at 300 s with
// "Generate snapshot" disabled (452 click retries). The step does
//     tlPage.getByLabel(field(lang, "Output")).first().selectOption("charter")
// right after `visit()` (which waits only for the h1, lang/dir and the demo banner). The reports page has TWO selects
// labelled "Output" (reportsP5.generate.output): the Generate form's #report-definition, rendered only after the report
// definitions load (QueryState), and the snapshot list's filter #snapshot-filter-code, rendered at once. Hypothesis: when
// the definitions answer late, `.first()` resolves to the FILTER, "charter" is selected there, the Generate form's
// select stays empty, and its submit stays disabled for good.
// This probe holds GET /report-definitions for 4 s (page.route), performs the spec's exact locator and action, and
// records which select received "charter" and whether the Generate button is enabled. Control: the same without the delay.
// SYNTHETIC data only; nothing approves anything (no G1-G6 business approval; unrelated to DG0-DG7).
import { expect, test, type Page } from "@playwright/test";
import { SYN_RETAIL, apiSession, fieldLabel, langOf, signIn, tr } from "../apps/web/e2e/support/ui.ts";

test.describe.configure({ mode: "serial" });
test.setTimeout(180_000);
let tid = "";

test("setup: a fresh synthetic transformation", async ({ playwright }, info) => {
  const lead = await apiSession(playwright, "dev.lead");
  const t = await lead.call<{ id: string }>("POST", "/api/v1/transformations", {
    businessUnitId: SYN_RETAIL,
    name: `Synthetic QA R3B reports ${langOf(info)} ${Date.now().toString(36)}`,
    mode: "end_to_end",
  });
  tid = t.id;
});

async function attempt(page: Page, lang: "en" | "ar", delayMs: number) {
  await page.unroute("**/report-definitions**").catch(() => undefined);
  if (delayMs > 0)
    await page.route("**/report-definitions**", async (route) => {
      await new Promise((r) => setTimeout(r, delayMs));
      await route.continue();
    });
  await page.goto(`/transformations/${tid}/reports`);
  await expect(page.locator("main#main h1")).toBeVisible();
  const label = fieldLabel(lang, "reportsP5.generate.output");
  // The spec's exact action (field(lang, "Output") is the same catalogue string).
  await page.getByLabel(label).first().selectOption("charter", { timeout: 20_000 });
  await page.waitForTimeout(500);
  const state = await page.evaluate(() => ({
    generate: (document.getElementById("report-definition") as HTMLSelectElement | null)?.value ?? null,
    filter: (document.getElementById("snapshot-filter-code") as HTMLSelectElement | null)?.value ?? null,
  }));
  const submit = page.getByRole("button", { name: tr(lang, "reportsP5.generate.submit") });
  return { delayMs, ...state, generateEnabled: await submit.isEnabled() };
}

test("the spec's 'Output' locator under a late definitions answer", async ({ page }, info) => {
  const lang = langOf(info);
  await signIn(page, lang, "dev.lead");
  const control = await attempt(page, lang, 0);
  const delayed = await attempt(page, lang, 4_000);
  console.log(`QA-R3B OUTPUT-LABEL ${lang}: control ${JSON.stringify(control)}; delayed ${JSON.stringify(delayed)}`);
  // The control must behave as the spec expects; the delayed result is REPORTED (the hypothesis), not asserted.
  expect(control).toMatchObject({ generate: "charter", generateEnabled: true });
});
