// P4 slice B (benefits and Finance validation) on the REAL stack (support/with-stack.sh; no mocks): T-DG4-FE-C
// (p4-work-split §B.5). Every record is SYNTHETIC demo data. The Finance decisions recorded here are synthetic,
// in-product demo Finance validations that approve nothing real, and no product gate (G1-G6) implies any engineering
// gate (DG0-DG7).
//  1. The Business Owner creates a benefit in the UI and moves it Identify → Plan → Enable; the lifecycle shows the six
//     steps with question and output, and Measure lists the missing enabler until one is linked.
//  2. Allocations: 60 % + 50 % is refused (translated 422, nothing saved); 60 % + 30 % leaves 10 % unallocated.
//  3. The register: a CX benefit shows Value (SAR) n/a (never 0), a financial benefit its value; initiatives shown.
//  4. Finance validates the baseline (the comparison basis) in the UI.
//  5. The Business Owner records and submits a measurement with evidence: pending, labelled, validated total unchanged.
//  6. The worker (started for this step only; with-stack.sh starts none) puts exactly one item in the Finance queue;
//     Finance decides the six items and approves; the validated total rises by exactly the approved amount. An
//     amendment corrects it without editing the validated value.
//  7. A scenario value is labelled with its kind and stays out of every total.
//  8. The auditor's read-only views; 390 px and 200 % text checks of the register and the benefit page.
// Every step: a full-page screenshot per language and axe with 0 serious or critical issues.
import { spawn, type ChildProcess } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { asUser, syntheticUser, type SyntheticUser } from "./support/p3-journey-setup.ts";
import {
  SYN_RETAIL,
  apiSession,
  escape,
  expectAccessible,
  fieldLabel,
  langOf,
  shot,
  signIn,
  tr,
  trackRequests,
  type ApiSession,
  type Lang,
} from "./support/ui.ts";

test.describe.configure({ mode: "serial" });

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
let tid = "";
let T = "";
let orgId = "";
let benefitId = "";
let formulaId = "";
let iniA = "";
let iniB = "";
let evidenceTitle = "";
let fvId = "";
let owner: SyntheticUser;
let finance: SyntheticUser;
let auditor: SyntheticUser;
let lead: ApiSession;
let fin: ApiSession;
const stamp = Date.now().toString(36);
const TITLE = (lang: Lang) => `Synthetic churn reduction ${lang.toUpperCase()} ${stamp}`;
const CX_TITLE = (lang: Lang) => `Synthetic NPS uplift ${lang.toUpperCase()} ${stamp}`;

async function go(page: Page, path: string) {
  await page.goto(path);
  await expect(page.locator("main#main h1")).toBeVisible();
}

const submitOf = (dialog: Locator) => dialog.locator("[data-action='submit']");

async function expectNoPageOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

test.beforeAll(async ({ playwright }, info) => {
  const lang = langOf(info);
  lead = await apiSession(playwright, "dev.lead");
  const admin = await apiSession(playwright, "dev.admin");
  const created = await lead.call<{ id: string }>("POST", "/api/v1/transformations", {
    businessUnitId: SYN_RETAIL,
    name: `Synthetic P4 benefits ${lang.toUpperCase()} ${stamp}`,
    mode: "end_to_end",
  });
  tid = created.id;
  T = `/api/v1/transformations/${tid}`;
  orgId = (await admin.call<{ organization: { id: string } }>("GET", "/api/v1/me")).organization.id;
  const mk = (code: string, role: string, name: string) =>
    syntheticUser(admin, orgId, tid, `dev.p4ben.${code}.${lang}.${stamp}`, `${name} ${lang}`, role, lang);
  owner = await mk("bo", "BO", "Synthetic Benefit Owner");
  finance = await mk("fin", "FIN", "Synthetic Finance validator");
  auditor = await mk("aud", "AUD", "Synthetic Auditor");
  fin = await apiSession(playwright, finance.username);
  // Two initiatives (the enablers and allocation targets), a T09 formula, a CX KPI and one evidence note.
  iniA = (
    await lead.call<{ id: string }>("POST", "/api/v1/initiatives", {
      transformationId: tid,
      name: `Synthetic retention offers ${lang}`,
    })
  ).id;
  iniB = (
    await lead.call<{ id: string }>("POST", "/api/v1/initiatives", {
      transformationId: tid,
      name: `Synthetic digital care ${lang}`,
    })
  ).id;
  formulaId = (
    await lead.call<{ id: string }>("POST", "/api/v1/benefit-formulas", {
      transformationId: tid,
      benefitName: `Synthetic churn formula ${lang}`,
      fromExample: "revenue_uplift",
    })
  ).id;
  const kpi = await lead.call<{ id: string; version: number }>("POST", `${T}/kpi-definitions`, {
    name: `Synthetic NPS ${lang} ${stamp}`,
    unitKind: "score",
    polarity: "higher_is_better",
  });
  evidenceTitle = `Synthetic billing extract ${lang} ${stamp}`;
  await lead.call("POST", `${T}/evidence`, {
    kind: "note",
    title: evidenceTitle,
    noteBody: "Synthetic extract (demo data).",
    ownerUserId: lead.userId,
  });
  // A CX benefit (non-financial, no valuation method): Value (SAR) is n/a, never 0.
  const bo = await apiSession(playwright, owner.username);
  await bo.call("POST", `${T}/benefits`, {
    title: CX_TITLE(lang),
    description: "Better experience on the synthetic care journey.",
    benefitType: "cx",
    valueClass: "non_financial",
    ownerUserId: owner.id,
    currency: "SAR",
    measurementKpiDefinitionId: kpi.id,
  });
});

test("1. The Business Owner creates a benefit and moves it through Plan and Enable; Measure needs an enabler", async ({
  browser,
}, info) => {
  const lang = langOf(info);
  const bo = await asUser(browser, lang, owner.username);
  const foreign = trackRequests(bo.page);
  await go(bo.page, `/transformations/${tid}/benefits`);
  await expect(bo.page.locator("main#main h1")).toHaveText(tr(lang, "benefitsP4.register.title"));
  await bo.page.getByRole("button", { name: tr(lang, "benefitsP4.register.create") }).click();
  const dialog = bo.page.getByRole("dialog");
  await dialog.getByLabel(fieldLabel(lang, "benefitsP4.field.title")).fill(TITLE(lang));
  await dialog
    .getByLabel(fieldLabel(lang, "benefitsP4.field.description"))
    .fill("Lower churn on the synthetic prepaid base.");
  await dialog.getByLabel(fieldLabel(lang, "benefitsP4.field.benefitType")).selectOption("revenue");
  await dialog.getByLabel(fieldLabel(lang, "benefitsP4.field.valueClass")).selectOption("revenue_uplift");
  await dialog.getByLabel(fieldLabel(lang, "benefitsP4.field.owner")).selectOption(owner.id);
  await dialog.getByLabel(fieldLabel(lang, "benefitsP4.field.financialStatementLine")).fill("Revenue - prepaid");
  await dialog.getByLabel(fieldLabel(lang, "benefitsP4.field.plannedValue")).fill("10000000");
  await dialog.getByLabel(fieldLabel(lang, "benefitsP4.field.baselineValue")).fill("1000000");
  await dialog.getByLabel(fieldLabel(lang, "benefitsP4.field.baselineUnit")).fill("SAR");
  await dialog.getByLabel(fieldLabel(lang, "benefitsP4.field.formula")).selectOption(formulaId);
  await dialog.getByLabel(fieldLabel(lang, "benefitsP4.field.targetValue")).fill("1200000");
  await shot(bo.page, lang, "p4ben-01-create-benefit");
  await expectAccessible(bo.page, lang, "p4ben-01-create-benefit");
  await submitOf(dialog).click();
  await bo.page.waitForURL(new RegExp(`/transformations/${tid}/benefits/[0-9a-f-]{36}$`));
  benefitId = bo.page.url().split("/").pop()!;
  const lifecycle = bo.page.locator("[data-lifecycle]");
  await expect(lifecycle.locator("[data-step]")).toHaveCount(6);
  await expect(lifecycle).toHaveAttribute("data-lifecycle", "identify");
  // the Plan step shows its question and output (verbatim English; provisional Arabic labelled as such)
  const plan = lifecycle.locator("[data-step='plan']");
  if (lang === "en") await expect(plan.locator("[data-part='output']")).toHaveText("Baseline, formula, target, owner");
  else await expect(plan.locator("[data-state='ar-provisional']")).toBeVisible();
  for (const step of ["plan", "enable"] as const) {
    await bo.page.locator(`[data-advance='${step}']`).click();
    const d = bo.page.getByRole("dialog");
    await submitOf(d).click();
    await expect(d).toBeHidden();
    await expect(bo.page.locator("[data-lifecycle]")).toHaveAttribute("data-lifecycle", step);
  }
  // Measure lists the missing enabler (the Enable output)
  await expect(bo.page.locator("[data-step='measure'] [data-missing]")).toContainText(
    tr(lang, "benefitsP4.missing.enablers"),
  );
  await shot(bo.page, lang, "p4ben-02-lifecycle-enable-missing-enabler");
  await expectAccessible(bo.page, lang, "p4ben-02-lifecycle");
  await bo.page.getByRole("button", { name: tr(lang, "benefitsP4.enablers.add") }).click();
  const enabler = bo.page.getByRole("dialog");
  await enabler.getByLabel(fieldLabel(lang, "benefitsP4.field.initiative")).selectOption(iniA);
  await submitOf(enabler).click();
  await expect(enabler).toBeHidden();
  await expect(bo.page.locator("[data-enabler]")).toHaveCount(1);
  await expect(bo.page.locator("[data-enabler]")).toHaveAttribute("data-delivered", "false");
  await bo.page.locator("[data-advance='measure']").click();
  await submitOf(bo.page.getByRole("dialog")).click();
  await expect(bo.page.locator("[data-lifecycle]")).toHaveAttribute("data-lifecycle", "measure");
  await shot(bo.page, lang, "p4ben-03-lifecycle-measure");
  expect(foreign).toEqual([]);
  await bo.close();
});

test("2. Allocations: 60 % + 50 % is refused; 60 % + 30 % leaves 10 % unallocated", async ({ browser }, info) => {
  const lang = langOf(info);
  const bo = await asUser(browser, lang, owner.username);
  await go(bo.page, `/transformations/${tid}/benefits/${benefitId}`);
  await bo.page.getByRole("button", { name: tr(lang, "benefitsP4.allocations.edit") }).click();
  const dialog = bo.page.getByRole("dialog");
  const addRow = dialog.getByRole("button", { name: tr(lang, "benefitsP4.allocations.addRow") });
  await addRow.click();
  await addRow.click();
  const row = (i: number) => dialog.locator(`[data-allocation-row='${i}']`);
  await row(0).getByLabel(fieldLabel(lang, "benefitsP4.field.initiative")).selectOption(iniA);
  await row(0).getByLabel(fieldLabel(lang, "benefitsP4.allocations.sharePercent")).fill("60");
  await row(1).getByLabel(fieldLabel(lang, "benefitsP4.field.initiative")).selectOption(iniB);
  await row(1).getByLabel(fieldLabel(lang, "benefitsP4.allocations.sharePercent")).fill("50");
  await expect(dialog.locator("[data-state='over-100']")).toBeVisible();
  await submitOf(dialog).click();
  const alert = dialog.getByRole("alert");
  await expect(alert).toHaveAttribute("data-problem", "benefit_allocation.over_100");
  await expect(alert).toContainText(tr(lang, "problems.benefit_allocation__over_100"));
  await shot(bo.page, lang, "p4ben-04-allocations-over-100-refused");
  await expectAccessible(bo.page, lang, "p4ben-04-allocations-refused");
  // nothing saved
  const before = await bo.page.evaluate(
    async (url) => (await fetch(url)).json(),
    `${T}/benefits/${benefitId}/allocations`,
  );
  expect((before as { allocations: unknown[] }).allocations).toHaveLength(0);
  await row(1).getByLabel(fieldLabel(lang, "benefitsP4.allocations.sharePercent")).fill("30");
  await submitOf(dialog).click();
  await expect(dialog).toBeHidden();
  await expect(bo.page.locator("[data-share='unallocated']")).toContainText("10");
  await shot(bo.page, lang, "p4ben-05-allocations-unallocated-10");
  await expectAccessible(bo.page, lang, "p4ben-05-allocations");
  await bo.close();
});

test("3. Register: CX benefit Value (SAR) n/a, never 0; the allocated initiatives are named", async ({
  browser,
}, info) => {
  const lang = langOf(info);
  const bo = await asUser(browser, lang, owner.username);
  await go(bo.page, `/transformations/${tid}/benefits`);
  const cx = bo.page.locator("tr", { hasText: CX_TITLE(lang) });
  await expect(cx.locator("[data-value-status='not_applicable']").first()).toContainText(
    tr(lang, "benefitsP4.amount.na"),
  );
  await expect(cx.locator("[data-rag='unknown']")).toBeVisible();
  const fin1 = bo.page.locator("tr", { hasText: TITLE(lang) });
  await expect(fin1.locator("[data-amount='10000000.0000']").first()).toBeVisible();
  await expect(fin1.locator("[data-initiatives='2']")).toContainText(`Synthetic retention offers ${lang}`);
  await expect(fin1.locator("[data-realized] [data-part='pending']")).toContainText(
    tr(lang, "benefitsP4.realized.nonePending"),
  );
  await shot(bo.page, lang, "p4ben-06-register");
  await expectAccessible(bo.page, lang, "p4ben-06-register");
  await bo.close();
});

test("4. Finance validates the baseline (the comparison basis)", async ({ browser }, info) => {
  const lang = langOf(info);
  const f = await asUser(browser, lang, finance.username);
  await go(f.page, `/transformations/${tid}/benefits/${benefitId}`);
  await f.page.getByRole("button", { name: tr(lang, "benefitsP4.baseline.decide") }).click();
  const dialog = f.page.getByRole("dialog");
  await expect(dialog.locator("[data-state='finance-validation']")).toContainText(tr(lang, "benefitsP4.finance.label"));
  await dialog.getByLabel(fieldLabel(lang, "benefitsP4.baseline.decision")).selectOption("validated");
  await shot(f.page, lang, "p4ben-07-baseline-decision");
  await expectAccessible(f.page, lang, "p4ben-07-baseline-decision");
  await submitOf(dialog).click();
  await expect(dialog).toBeHidden();
  await expect(f.page.locator("[data-benefit-profile] [data-baseline-status]")).toHaveAttribute(
    "data-baseline-status",
    "validated",
  );
  await expect(f.page.locator("body")).not.toContainText(/\bDG[0-7]\b/);
  await f.close();
});

test("5. The Business Owner submits a measurement with evidence: pending, labelled, validated total unchanged", async ({
  browser,
}, info) => {
  const lang = langOf(info);
  const bo = await asUser(browser, lang, owner.username);
  await go(bo.page, `/transformations/${tid}/benefits/${benefitId}`);
  await bo.page.getByRole("button", { name: tr(lang, "benefitsP4.measurements.create") }).click();
  const dialog = bo.page.getByRole("dialog");
  await dialog.locator("[data-field='periodStart']").fill("2026-07-01");
  await dialog.locator("[data-field='periodEnd']").fill("2026-09-30");
  await dialog.locator("[data-field='amount']").fill("250000");
  await dialog.locator("[data-field='attribution']").fill("Synthetic: churn fell after the retention offers.");
  await dialog.locator("[data-field='assumptions']").fill("Synthetic: ARPU constant over the period.");
  await dialog.getByLabel(evidenceTitle).check();
  await dialog.locator("[data-field='submit']").check();
  await shot(bo.page, lang, "p4ben-08-measurement-form");
  await expectAccessible(bo.page, lang, "p4ben-08-measurement-form");
  await submitOf(dialog).click();
  await expect(dialog).toBeHidden();
  const row = bo.page.locator("tr[data-measurement='1']");
  await expect(row).toHaveAttribute("data-status", "submitted");
  await expect(row.locator("[data-measurement-status='submitted']")).toContainText(
    tr(lang, "benefitsP4.measurementStatus.submitted"),
  );
  await expect(bo.page.locator("[data-series='validated'] [data-amount]").first()).toHaveAttribute(
    "data-amount",
    "0.0000",
  );
  await expect(bo.page.locator("[data-series='submitted'] [data-amount]").first()).toHaveAttribute(
    "data-amount",
    "250000.0000",
  );
  await shot(bo.page, lang, "p4ben-09-measurement-pending");
  await go(bo.page, `/transformations/${tid}/benefits`);
  const realized = bo.page.locator("tr", { hasText: TITLE(lang) }).locator("[data-realized]");
  await expect(realized.locator("[data-part='validated'] [data-amount]")).toHaveAttribute("data-amount", "0.0000");
  await expect(realized.locator("[data-part='pending'] [data-amount]")).toHaveAttribute("data-amount", "250000.0000");
  await expect(realized.locator("[data-state='pending-label']")).toHaveText(
    tr(lang, "benefitsP4.realized.pendingLabel"),
  );
  await shot(bo.page, lang, "p4ben-10-register-pending");
  await expectAccessible(bo.page, lang, "p4ben-10-register-pending");
  await bo.close();
});

test("6. One Finance queue item; Finance decides the six items and approves; an amendment corrects without editing", async ({
  browser,
}, info) => {
  test.setTimeout(180_000);
  const lang = langOf(info);
  // The e2e stack runs no worker: start the real one for this step, against the same database, then stop it.
  const worker: ChildProcess = spawn(process.execPath, ["apps/worker/dist/main.js"], {
    cwd: ROOT,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let workerLog = "";
  worker.stdout?.on("data", (b: Buffer) => (workerLog += b.toString()));
  worker.stderr?.on("data", (b: Buffer) => (workerLog += b.toString()));
  try {
    await expect
      .poll(
        async () =>
          (await fin.call<{ items: { id: string }[] }>("GET", `${T}/finance-validations?status=queued`)).items.length,
        { timeout: 90_000, intervals: [1000] },
      )
      .toBe(1);
  } catch (e) {
    console.log(`worker log:\n${workerLog}`);
    throw e;
  } finally {
    worker.kill("SIGTERM");
    await new Promise((r) => (worker.exitCode !== null ? r(null) : worker.once("exit", r)));
  }
  // exactly one item for the submission (REQ-S12-014)
  const all = await fin.call<{ items: { id: string; benefitId: string }[] }>("GET", `${T}/finance-validations`);
  expect(all.items.filter((x) => x.benefitId === benefitId)).toHaveLength(1);
  fvId = all.items[0]!.id;

  const f = await asUser(browser, lang, finance.username);
  await go(f.page, "/finance-validation");
  await expect(f.page.locator("[data-state='finance-validation']")).toContainText(tr(lang, "benefitsP4.finance.label"));
  await expect(f.page.locator(`[data-finance-validation='${fvId}']`)).toBeVisible();
  await shot(f.page, lang, "p4ben-11-finance-queue");
  await expectAccessible(f.page, lang, "p4ben-11-finance-queue");
  await f.page.locator(`[data-finance-validation='${fvId}']`).click();
  await expect(f.page.locator("[data-items='6'] [data-finance-item]")).toHaveCount(6);
  await shot(f.page, lang, "p4ben-12-finance-item-six");
  await expectAccessible(f.page, lang, "p4ben-12-finance-item");
  await f.page.getByRole("button", { name: tr(lang, "benefitsP4.finance.decide") }).click();
  const dialog = f.page.getByRole("dialog");
  for (const item of ["baseline", "attribution", "calculation", "evidence", "measurementPeriod", "assumptions"])
    await dialog.locator(`[data-field='item_${item}']`).selectOption("accepted");
  await dialog.locator("[data-field='decision']").selectOption("approved");
  await dialog.locator("[data-field='approvedAmount']").fill("240000.5");
  await shot(f.page, lang, "p4ben-13-finance-decide");
  await expectAccessible(f.page, lang, "p4ben-13-finance-decide");
  await submitOf(dialog).click();
  await expect(dialog).toBeHidden();
  await expect(f.page.locator("[data-status='approved']").first()).toBeVisible();
  await expect(f.page.locator("[data-approved-amount]")).toHaveAttribute("data-approved-amount", "240000.5000");
  await expect(f.page.locator("[data-decided-by]")).toHaveAttribute("data-decided-by", finance.id);
  await shot(f.page, lang, "p4ben-14-finance-approved");
  // the validated total rose by exactly the approved amount; pending is gone
  await go(f.page, `/transformations/${tid}/benefits`);
  const realized = f.page.locator("tr", { hasText: TITLE(lang) }).locator("[data-realized]");
  await expect(realized.locator("[data-part='validated'] [data-amount]")).toHaveAttribute("data-amount", "240000.5000");
  await expect(
    f.page.locator("#benefit-totals [data-class='revenue_uplift'] [data-state='validated'] [data-amount]"),
  ).toHaveAttribute("data-amount", "240000.5000");
  await shot(f.page, lang, "p4ben-15-register-validated-totals");
  await expectAccessible(f.page, lang, "p4ben-15-register-validated");
  // an amendment (Finance) records the difference; the validated value is not edited and both stay visible
  await go(f.page, `/transformations/${tid}/finance-validations/${fvId}`);
  await f.page.getByRole("button", { name: tr(lang, "benefitsP4.finance.amend") }).click();
  const amend = f.page.getByRole("dialog");
  await amend
    .getByLabel(new RegExp(`^${escape(tr(lang, "benefitsP4.finance.correctedAmount", { currency: "SAR" }))}`))
    .fill("239500");
  await amend
    .getByLabel(fieldLabel(lang, "benefitsP4.field.reason"))
    .fill("Synthetic: one duplicated invoice removed.");
  await submitOf(amend).click();
  await expect(amend).toBeHidden();
  await go(f.page, `/transformations/${tid}/benefits/${benefitId}`);
  await expect(f.page.locator("tr[data-measurement]")).toHaveCount(2);
  await expect(f.page.locator("tr[data-measurement='1']")).toHaveAttribute("data-status", "validated");
  await expect(f.page.locator("[data-series='validated'] [data-amount]").first()).toHaveAttribute(
    "data-amount",
    "239500.0000",
  );
  await shot(f.page, lang, "p4ben-16-amendment");
  await expectAccessible(f.page, lang, "p4ben-16-amendment");
  // a reversal (Finance) nets the validated total to 0; the original, the amendment and the reversal all stay visible
  await go(f.page, `/transformations/${tid}/finance-validations/${fvId}`);
  await f.page.getByRole("button", { name: tr(lang, "benefitsP4.finance.reverse") }).click();
  const reverse = f.page.getByRole("dialog");
  await reverse
    .getByLabel(fieldLabel(lang, "benefitsP4.field.reason"))
    .fill("Synthetic: the value was attributed to the wrong benefit.");
  await submitOf(reverse).click();
  await expect(reverse).toBeHidden();
  await go(f.page, `/transformations/${tid}/benefits/${benefitId}`);
  await expect(f.page.locator("tr[data-measurement]")).toHaveCount(3);
  await expect(f.page.locator("tr[data-measurement][data-status='validated']")).toHaveCount(3);
  await expect(f.page.locator("[data-series='validated'] [data-amount]").first()).toHaveAttribute(
    "data-amount",
    "0.0000",
  );
  await shot(f.page, lang, "p4ben-16b-reversal-all-visible");
  await expectAccessible(f.page, lang, "p4ben-16b-reversal");
  await f.close();
});

test("7. A scenario value is labelled with its kind and stays out of every total", async ({ page }, info) => {
  const lang = langOf(info);
  await signIn(page, lang, "dev.lead");
  await go(page, `/transformations/${tid}/benefit-scenarios`);
  await page.getByRole("button", { name: tr(lang, "benefitsP4.scenarios.create") }).click();
  const create = page.getByRole("dialog");
  await create.getByLabel(fieldLabel(lang, "benefitsP4.scenarios.kind")).selectOption("upside");
  await create.getByLabel(fieldLabel(lang, "benefitsP4.field.title")).fill(`Synthetic upside ${lang}`);
  await submitOf(create).click();
  await expect(create).toBeHidden();
  await page.getByRole("button", { name: tr(lang, "benefitsP4.scenarios.addValue") }).click();
  const value = page.getByRole("dialog");
  await value.getByLabel(fieldLabel(lang, "benefitsP4.scenarios.benefit")).selectOption(benefitId);
  await value.getByLabel(fieldLabel(lang, "benefitsP4.field.periodStart")).fill("2027-01-01");
  await value.getByLabel(fieldLabel(lang, "benefitsP4.field.periodEnd")).fill("2027-12-31");
  await value.getByLabel(fieldLabel(lang, "benefitsP4.field.amount")).fill("7777777");
  await submitOf(value).click();
  await expect(value).toBeHidden();
  await expect(page.locator("[data-value-kind='upside']")).toContainText(tr(lang, "benefitsP4.scenarioKind.upside"));
  await shot(page, lang, "p4ben-17-scenario-labelled");
  await expectAccessible(page, lang, "p4ben-17-scenarios");
  await go(page, `/transformations/${tid}/benefits`);
  await expect(page.locator("#benefit-totals")).not.toContainText(/7[,٬]?777[,٬]?777/);
  const totals = await lead.call<{ currencies: { lines: { total: { amount: string | null } }[] }[] }>(
    "GET",
    `${T}/benefit-totals`,
  );
  expect(JSON.stringify(totals)).not.toContain("7777777");
});

test("8. Auditor read-only; register and benefit page at 390 px and 200 % text; the other benefit screens", async ({
  browser,
}, info) => {
  const lang = langOf(info);
  const aud = await asUser(browser, lang, auditor.username);
  await go(aud.page, `/transformations/${tid}/benefits`);
  await expect(aud.page.locator("[data-state='read-only']")).toHaveCount(1);
  await expect(aud.page.getByRole("button", { name: tr(lang, "benefitsP4.register.create") })).toHaveCount(0);
  await shot(aud.page, lang, "p4ben-18-auditor-register");
  await go(aud.page, `/transformations/${tid}/finance-validations/${fvId}`);
  await expect(aud.page.getByRole("button", { name: tr(lang, "benefitsP4.finance.decide") })).toHaveCount(0);
  await expect(aud.page.getByRole("button", { name: tr(lang, "benefitsP4.finance.amend") })).toHaveCount(0);
  await shot(aud.page, lang, "p4ben-19-auditor-finance-item");
  await expectAccessible(aud.page, lang, "p4ben-19-auditor-finance-item");
  for (const [path, name] of [
    ["benefit-groups", "p4ben-20-groups"],
    ["benefit-overlaps", "p4ben-21-overlaps"],
    ["benefit-valuation-methods", "p4ben-22-valuation-methods"],
    ["finance-validations", "p4ben-23-transformation-queue"],
  ] as const) {
    await go(aud.page, `/transformations/${tid}/${path}`);
    await shot(aud.page, lang, name);
    await expectAccessible(aud.page, lang, name);
  }
  const m = (await lead.call<{ items: { id: string }[] }>("GET", `${T}/benefits/${benefitId}/measurements`)).items[0]!;
  await go(aud.page, `/transformations/${tid}/benefit-measurements/${m.id}`);
  await expect(aud.page.locator("#measurement-lineage")).toBeVisible();
  await shot(aud.page, lang, "p4ben-24-measurement-lineage");
  await expectAccessible(aud.page, lang, "p4ben-24-measurement-lineage");
  // 390 px wide: no page-level horizontal scroll (tables scroll in their own labelled region)
  await aud.page.setViewportSize({ width: 390, height: 844 });
  for (const [path, name] of [
    ["benefits", "p4ben-25-register-390"],
    [`benefits/${benefitId}`, "p4ben-26-benefit-390"],
  ] as const) {
    await go(aud.page, `/transformations/${tid}/${path}`);
    await expectNoPageOverflow(aud.page);
    await shot(aud.page, lang, name);
    await expectAccessible(aud.page, lang, name);
  }
  // 200 % text
  await aud.page.setViewportSize({ width: 1280, height: 900 });
  for (const [path, name] of [
    ["benefits", "p4ben-27-register-200pct"],
    [`benefits/${benefitId}`, "p4ben-28-benefit-200pct"],
  ] as const) {
    await go(aud.page, `/transformations/${tid}/${path}`);
    await aud.page.evaluate(() => (document.documentElement.style.fontSize = "200%"));
    await expectNoPageOverflow(aud.page);
    await shot(aud.page, lang, name);
  }
  await aud.close();
});
