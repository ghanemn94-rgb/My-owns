// T-DG5-FE-D4 (D-166; REQ-S06-002, REQ-S06-003, REQ-S18-004): a procedure step's output record chosen in the UI,
// against the REAL API (apps/web/e2e/support/with-stack.sh), in EN and AR, with axe and screenshots.
//  - The lead (TL) launches `baseline_validation` on a new SYNTHETIC transformation. `record_baseline` is assigned to
//    TL (`procedures` v2, 0095) and its output is a `create` of a baseline.
//  - The TL provides the five inputs and links a SYNTHETIC evidence note (the step requires evidence).
//  - The output form says no eligible baseline exists yet and links the native screen. The TL follows that link,
//    records the baseline natively on the Diagnose screen (the DG2 createBaseline operation, with its own rules and
//    audit event), comes back, chooses it, and completes the step: `outputRecordId` names it.
//  - The step is completed, the instance shows the baseline as its output, and `validate_baseline` is active and
//    assigned to FIN (a Finance validation is a human action by FIN; nothing here performs it).
// All data is SYNTHETIC. Nothing here is a business approval, and nothing touches the engineering gates DG0-DG7.
import { expect, test, type Page } from "@playwright/test";
import {
  SYN_RETAIL,
  DEV_USERS,
  apiSession,
  escape,
  expectAccessible,
  fieldLabel,
  langOf,
  shot,
  signIn,
  tr,
  trackRequests,
  type Lang,
} from "./support/ui.ts";

const h1 = (page: Page) => page.locator("main#main h1");
const alertOf = (page: Page) => page.locator("main [role='alert']").first();

/** The five inputs of `baseline_validation` (their labels are the definition's own en/ar texts). */
const INPUTS: readonly { en: string; ar: string; value: string }[] = [
  { en: "Metric", ar: "المقياس", value: "Synthetic first-contact resolution" },
  { en: "Baseline value", ar: "قيمة خط الأساس", value: "61.5" },
  { en: "Unit", ar: "الوحدة", value: "%" },
  { en: "Baseline date", ar: "تاريخ خط الأساس", value: "2026-10-01" },
  { en: "Source", ar: "المصدر", value: "Synthetic contact-centre extract" },
];

test("Procedure outputs: the TL records a baseline natively, chooses it as record_baseline's output, and the step moves to FIN", async ({
  page,
  playwright,
}, info) => {
  test.setTimeout(150_000);
  const lang: Lang = langOf(info);
  const foreign = trackRequests(page);
  const lead = await apiSession(playwright, "dev.lead");
  const created = await lead.call<{ id: string }>("POST", "/api/v1/transformations", {
    businessUnitId: SYN_RETAIL,
    name: `Synthetic FE-D4 ${lang.toUpperCase()} procedure outputs`,
    mode: "end_to_end",
  });

  // 1. The TL launches baseline validation on the new transformation.
  await signIn(page, lang, "dev.lead");
  await page.goto("/playbook/procedures");
  await expect(h1(page)).toHaveText(tr(lang, "nav.p5.myProcedures.title"));
  const launch = page.locator("[data-form='launch-procedure']");
  await launch.getByLabel(tr(lang, "workflowsP5.procedures.procedure")).selectOption("baseline_validation");
  await launch.getByLabel(tr(lang, "workflowsP5.field.transformation")).selectOption(created.id);
  await launch.getByRole("button", { name: tr(lang, "workflowsP5.procedures.launch"), exact: true }).click();
  await expect(page).toHaveURL(/\/playbook\/procedures\/[0-9a-f-]+$/);
  const instanceUrl = page.url();
  const current = page.locator("[data-step='record_baseline']");
  await expect(current).toHaveAttribute("data-step-status", "active");
  await expect(current).toContainText("TL");

  // 2. The five inputs, then a SYNTHETIC evidence note linked to the step.
  const inputs = page.locator("[data-form='procedure-inputs']");
  for (const f of INPUTS) await inputs.getByLabel(new RegExp(`^${escape(lang === "ar" ? f.ar : f.en)}`)).fill(f.value);
  await inputs.getByRole("button", { name: tr(lang, "workflowsP5.procedures.saveInputs"), exact: true }).click();
  await expect(page.locator("[data-missing-inputs='0']")).toBeVisible();
  const evidenceTitle = `Synthetic FE-D4 ${lang.toUpperCase()} baseline working paper`;
  await lead.call("POST", `/api/v1/transformations/${created.id}/evidence`, {
    kind: "note",
    title: evidenceTitle,
    ownerUserId: DEV_USERS.lead,
    noteBody: "Synthetic: first-contact resolution sampled over September.",
  });
  await page.reload();
  const evidenceForm = page.locator("[data-form='evidence-record_baseline']");
  await evidenceForm.getByLabel(tr(lang, "workflowsP5.procedures.evidence")).selectOption({ label: evidenceTitle });
  await evidenceForm
    .getByRole("button", { name: tr(lang, "workflowsP5.procedures.linkEvidence"), exact: true })
    .click();
  await expect(page.locator("#evidence [data-record-type='evidence']")).toHaveCount(1);

  // 3. The output form: no baseline yet; it links the native screen.
  const complete = page.locator("[data-form='complete-record_baseline'][data-output-mode='create']");
  await expect(complete).toHaveAttribute("data-output-record-type", "baseline");
  await expect(complete.locator("[data-output-state='empty']")).toBeVisible();
  await expect(complete).toContainText(
    tr(lang, "workflowsP5.procedureOutput.none", { type: tr(lang, "workflowsP5.recordType.baseline") }),
  );
  await expectAccessible(page, lang, "p5-procedure-output-empty");
  await shot(page, lang, "p5-procedure-output-empty");

  // 4. The baseline is recorded natively, on the Diagnose screen the form links to.
  await complete.locator("[data-output-native='baseline']").click();
  await expect(page).toHaveURL(new RegExp(`/transformations/${created.id}/diagnose#baselines$`));
  await page
    .locator("#baselines")
    .getByRole("button", { name: tr(lang, "kpi.baseline.add") })
    .click();
  const dialog = page.getByRole("dialog");
  const metric = `Synthetic FE-D4 ${lang.toUpperCase()} first-contact resolution`;
  await dialog.getByLabel(fieldLabel(lang, "kpi.baseline.metric")).fill(metric);
  await dialog.getByLabel(fieldLabel(lang, "kpi.baseline.value")).fill("61.5");
  await dialog.getByLabel(fieldLabel(lang, "kpi.baseline.unit")).fill("%");
  await dialog.getByLabel(fieldLabel(lang, "kpi.baseline.source")).fill("Synthetic contact-centre extract");
  await dialog.getByLabel(fieldLabel(lang, "kpi.baseline.date")).fill("2026-10-01");
  await dialog.getByLabel(fieldLabel(lang, "kpi.baseline.scope")).selectOption({ index: 1 });
  await dialog.getByRole("button", { name: tr(lang, "common.action.create"), exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator("#baselines")).toContainText(metric);

  // 5. Back on the instance, the baseline is offered; the TL chooses it and completes the step.
  await page.goto(instanceUrl);
  const select = complete.locator("[data-output-select='baseline']");
  await expect(select).toBeEnabled();
  await expect(select.locator("option", { hasText: metric })).toHaveCount(1);
  await select.selectOption({ label: (await select.locator("option", { hasText: metric }).textContent())!.trim() });
  await expectAccessible(page, lang, "p5-procedure-output-chosen");
  await shot(page, lang, "p5-procedure-output-chosen");
  const sent = page.waitForRequest((r) => r.method() === "POST" && r.url().endsWith("/steps/record_baseline/complete"));
  await complete.getByRole("button", { name: tr(lang, "workflowsP5.procedures.complete"), exact: true }).click();
  const body = (await sent).postDataJSON() as { outputRecordId?: string };
  expect(body.outputRecordId).toMatch(/^[0-9a-f-]{36}$/);

  // 6. The step is completed, the baseline is the instance's output, and the FIN step is active.
  await expect(current).toHaveAttribute("data-step-status", "completed");
  const fin = page.locator("[data-step='validate_baseline']");
  await expect(fin).toHaveAttribute("data-step-status", "active");
  await expect(fin).toContainText("FIN");
  await expect(page.locator("#outputs [data-record-type='baseline']")).toHaveCount(1);
  await expect(alertOf(page)).toHaveCount(0);
  await expectAccessible(page, lang, "p5-procedure-output-done");
  await shot(page, lang, "p5-procedure-output-done");
  expect(foreign).toEqual([]);
});
