// qa-verifier A02 "Complete lifecycle" (DG5, T-DG5-QA-E2): REQ-S18-004, literally, "an e2e test performs all twelve
// walkthrough steps with the demo role users and verifies the resulting records". On a REAL demo stack
// (e2e/support/with-demo-stack.sh: `mth-db seed-demo` with AUTH_MODE=dev binds the demo users to the dev issuer, D-165;
// MTH_ENV=demo; the built SPA), in chromium-en and chromium-ar:
//  - the demo role users roaming.user.<role> sign in through the dev sign-in form (no synthetic dev.* user);
//  - the Transformation Lead creates a NEW transformation in the demo business unit in the native create form (step 1);
//  - the demo access administrator staffs it natively (POST /role-assignments: SP, BO, FIN, KDS, WL; ADR-0020 §5) and
//    the Lead maps the Sponsor and Business Owner (POST role-mappings). These are access set-up actions, not walkthrough
//    steps, and are done through the API by the same demo users;
//  - each walkthrough step is then performed IN THE UI by the role that holds the right (ADR-0050 §7 "SP, TL, BO, FIN,
//    TO …"), and after each one GET /demo/walkthrough reads it done from the persisted records, which are then read
//    back through the API and compared field by field;
//  - every visited screen shows the synthetic banner (REQ-S18-001), and the screens' html lang/dir follow the project.
// A step the UI cannot perform is a product defect: the failing step is kept (see the handback).
// Everything is SYNTHETIC: every decision below is a synthetic in-product decision on test data that approves nothing
// real. Nothing names the engineering gates DG0-DG7.
import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { expectAccessible, langOf, trackRequests, type ApiSession, type Lang } from "../apps/web/e2e/support/ui.ts";
import { startProductionWorker } from "./support/a13-a22-stack.ts";
import { DEMO_BU, catalogue, demoApi, demoPage, expectBanner, field, uiRe, type DemoRole } from "./support/a02-demo.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const EVIDENCE = process.env["QA_EVIDENCE_DIR"] ?? path.join("test-results", "qa-a02-e2");

test.describe.configure({ mode: "serial" });
test.setTimeout(300_000);

test("REQ-S18-004: the demo role users perform the twelve walkthrough steps in the UI on a new transformation; the resulting records are verified", async ({
  browser,
  playwright,
}, info) => {
  const lang: Lang = langOf(info);
  const dir = path.join(EVIDENCE, lang);
  mkdirSync(dir, { recursive: true });
  const pages: Page[] = [];
  const foreign: string[][] = [];
  const as = async (role: DemoRole): Promise<Page> => {
    const p = await demoPage(browser, lang, role);
    foreign.push(trackRequests(p));
    pages.push(p);
    return p;
  };
  const api: Partial<Record<DemoRole, ApiSession>> = {};
  const sessionOf = async (role: DemoRole): Promise<ApiSession> => (api[role] ??= await demoApi(playwright, role));
  const shot = (p: Page, name: string) => p.screenshot({ path: path.join(dir, `${name}.png`), fullPage: true });
  /** Visits a screen and checks its language, direction and the synthetic banner. */
  const visit = async (p: Page, url: string) => {
    await p.goto(url);
    await expect(p.locator("main#main h1")).toBeVisible();
    await expect(p.locator("html")).toHaveAttribute("lang", lang);
    await expect(p.locator("html")).toHaveAttribute("dir", lang === "ar" ? "rtl" : "ltr");
    await expectBanner(p, lang);
  };
  const tag = lang.toUpperCase();
  let t = "";
  const walk = async (): Promise<Record<string, boolean>> => {
    const tl = await sessionOf("tl");
    const w = await tl.call<Body>("GET", `/api/v1/demo/walkthrough?transformationId=${t}`);
    return Object.fromEntries((w.steps as Body[]).map((s) => [s.code, s.completed]));
  };
  const expectStep = async (code: string, done: boolean) =>
    expect.poll(async () => (await walk())[code], { message: `walkthrough ${code}`, timeout: 10_000 }).toBe(done);
  const dialogOf = (p: Page) => p.getByRole("dialog");

  // ---------------------------------------------------------------- 1. create transformation (TL, native form)
  const tlPage = await as("tl");
  await test.step("1 create transformation: roaming.user.tl in the native create form", async () => {
    await visit(tlPage, "/transformations/new");
    await tlPage.getByLabel(field(lang, "Business unit")).selectOption(DEMO_BU);
    await tlPage.getByLabel(field(lang, "Name")).first().fill(`Synthetic QA-E2 ${tag} demo-user walkthrough`);
    await tlPage.getByRole("button", { name: uiRe(lang, "Create transformation") }).click();
    await tlPage.waitForURL(/\/transformations\/[0-9a-f-]{36}$/);
    t = new URL(tlPage.url()).pathname.split("/").pop()!;
    await expectBanner(tlPage, lang);
    // The record badge in the record header (ADR-0050 §2 b).
    await expect(tlPage.locator("main [data-state='demo-record']").first()).toHaveText(
      catalogue(lang, "playbookP5.demo.recordBadge"),
    );
    await expectStep("create_transformation", true);
    const row = await (await sessionOf("tl")).call<Body>("GET", `/api/v1/transformations/${t}`);
    expect([row.businessUnitId, row.name, row.mode]).toEqual([
      DEMO_BU,
      `Synthetic QA-E2 ${tag} demo-user walkthrough`,
      "end_to_end",
    ]);
    await shot(tlPage, "01-created");
  });
  const base = `/transformations/${t}`;
  const API = `/api/v1/transformations/${t}`;

  // Staffing (access set-up, not a walkthrough step): the demo access administrator assigns the approver and team roles,
  // the Lead maps the Sponsor and the Business Owner.
  const ids: Record<string, string> = {};
  for (const r of ["sp", "bo", "fin", "kds", "wl"] as const) ids[r] = (await sessionOf(r)).userId;
  const adm = await sessionOf("adm_access");
  for (const [r, code] of [
    ["sp", "SP"],
    ["bo", "BO"],
    ["fin", "FIN"],
    ["kds", "KDS"],
    ["wl", "WL"],
  ] as const)
    await adm.call("POST", "/api/v1/role-assignments", {
      userId: ids[r],
      roleCode: code,
      scope: { type: "transformation", id: t },
      reason: `Synthetic QA-E2: ${code} of the demo walkthrough transformation (approves nothing real)`,
    });
  const tlApi = await sessionOf("tl");
  for (const [code, r] of [
    ["SP", "sp"],
    ["BO", "bo"],
  ] as const)
    await tlApi.call("POST", `${API}/role-mappings`, { partyCode: code, targetKind: "user", userId: ids[r] });

  // ---------------------------------------------------------------- 2. diagnose and agree baseline (TL records, FIN validates)
  const metric = `Synthetic QA-E2 ${tag} roaming revenue per month`;
  await test.step("2 diagnose and agree baseline: TL adds it, FIN validates it (synthetic)", async () => {
    await expectStep("diagnose_baseline", false);
    await visit(tlPage, `${base}/diagnose`);
    await tlPage.getByRole("button", { name: uiRe(lang, "Add baseline") }).click();
    const d = dialogOf(tlPage);
    await d.getByLabel(field(lang, "Metric")).fill(metric);
    await d.getByLabel(field(lang, "Value")).fill("1250000.00");
    await d.getByLabel(field(lang, "Unit")).fill("SAR");
    await d.getByLabel(field(lang, "Currency")).selectOption("SAR");
    await d.getByLabel(field(lang, "Source")).fill("Synthetic finance extract");
    await d.getByLabel(field(lang, "Baseline date")).fill("2026-01-31");
    await d.getByLabel(field(lang, "Scope")).selectOption("revenue");
    await d.getByRole("button", { name: uiRe(lang, "Create") }).click();
    await expect(d).toHaveCount(0);
    const finPage = await as("fin");
    await visit(finPage, `${base}/diagnose`);
    await finPage
      .getByRole("button", { name: new RegExp(`${catalogue(lang, "kpi.validation.action")}\\s*:\\s*${metric}`) })
      .click();
    const v = dialogOf(finPage);
    await v.getByRole("radio", { name: uiRe(lang, "Validated by Finance") }).check();
    await v.getByLabel(field(lang, "Note")).fill("Synthetic: matches the extract.");
    await v.getByRole("button", { name: uiRe(lang, "Record decision") }).click();
    await expect(v).toHaveCount(0);
    await expectStep("diagnose_baseline", true);
    const list = await tlApi.call<Body>("GET", `${API}/baselines?limit=50`);
    const b = (list.items as Body[]).find((x) => x.metric === metric);
    expect([b?.value, b?.unit, b?.currency, b?.scope, b?.validationStatus, b?.baselineDate]).toEqual([
      expect.stringMatching(/^1250000\.00*$/),
      "SAR",
      "SAR",
      "revenue",
      "validated",
      "2026-01-31",
    ]);
    await shot(finPage, "02-baseline-validated");
  });

  // ---------------------------------------------------------------- 3. define outcomes/KPIs (TL)
  const outcome = `Synthetic QA-E2 ${tag}: roaming revenue grows`;
  const kpiName = `Synthetic QA-E2 ${tag} roaming attach rate`;
  await test.step("3 define outcomes/KPIs: TL adds an outcome, a KPI and their T02 row", async () => {
    await expectStep("define_outcomes_kpis", false);
    await visit(tlPage, `${base}/define`);
    await tlPage.getByRole("button", { name: uiRe(lang, "Add outcome") }).click();
    let d = dialogOf(tlPage);
    await d.getByLabel(field(lang, "Outcome statement")).fill(outcome);
    await d.getByRole("button", { name: uiRe(lang, "Create") }).click();
    await expect(d).toHaveCount(0);
    await tlPage.getByRole("button", { name: uiRe(lang, "Add KPI") }).click();
    d = dialogOf(tlPage);
    await d.getByLabel(field(lang, "Name")).fill(kpiName);
    await d.getByLabel(field(lang, "Unit")).selectOption("count");
    await d.getByLabel(field(lang, "Polarity")).selectOption("higher_is_better");
    // The KPI is owned by the demo KPI/Data Steward, who submits its actuals (steps 7 and 12).
    await d.getByLabel(field(lang, "Owner")).selectOption(ids["kds"]!);
    await d.getByRole("button", { name: uiRe(lang, "Create") }).click();
    await expect(d).toHaveCount(0);
    await tlPage.getByRole("button", { name: uiRe(lang, "Add T02 row") }).click();
    d = dialogOf(tlPage);
    await d.getByRole("combobox").first().selectOption({ label: outcome });
    await d.getByRole("combobox").nth(1).selectOption({ label: kpiName });
    const date = d.locator("input[type='date']").first();
    await date.fill("2027-12-31");
    await d.getByRole("button", { name: uiRe(lang, "Create") }).click();
    await expect(d).toHaveCount(0);
    await expectStep("define_outcomes_kpis", true);
    const links = await tlApi.call<Body>("GET", `${API}/outcome-kpis?limit=50`);
    expect((links.items as Body[]).some((x) => x.status === "active" && x.targetDate === "2027-12-31")).toBe(true);
    await shot(tlPage, "03-outcome-kpi");
  });

  // ---------------------------------------------------------------- 4. design TOM (TL)
  await test.step("4 design TOM: TL writes the technology target design and adds a gap", async () => {
    await expectStep("design_tom", false);
    await visit(tlPage, `${base}/design`);
    await tlPage
      .locator("li[data-dimension='technology']")
      .getByRole("button")
      .filter({ hasText: catalogue(lang, "common.action.edit") })
      .click();
    let d = dialogOf(tlPage);
    await d.getByLabel(field(lang, "Target design")).fill("Synthetic QA-E2: digital roaming activation");
    await d.getByRole("button", { name: uiRe(lang, "Save changes") }).click();
    await expect(d).toHaveCount(0);
    await tlPage.getByRole("button", { name: uiRe(lang, "Add gap") }).click();
    d = dialogOf(tlPage);
    await d.getByLabel(field(lang, "TOM dimension")).selectOption("technology");
    await d.getByLabel(field(lang, "Gap")).fill("Synthetic QA-E2: activation is manual today");
    await d.getByRole("button", { name: uiRe(lang, "Create") }).click();
    await expect(d).toHaveCount(0);
    await expectStep("design_tom", true);
    const cell = (await tlApi.call<Body>("GET", `${API}/tom-canvas/technology`)).cell;
    expect(cell.targetDesign).toBe("Synthetic QA-E2: digital roaming activation");
    await shot(tlPage, "04-tom");
  });

  // ---------------------------------------------------------------- 5. prioritize initiatives and approve mobilization
  const today = new Date().toISOString().slice(0, 10);
  const plus = (n: number) => new Date(Date.parse(`${today}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
  const spApi = await sessionOf("sp");
  const boApi = await sessionOf("bo");
  const finApi = await sessionOf("fin");
  const kdsApi = await sessionOf("kds");
  /** Covers every mandatory criterion the live gate view reports incomplete with an exception the Sponsor accepts. */
  const coverGate = async (code: string) => {
    const view = await tlApi.call<Body>("GET", `${API}/gates/${code}`);
    for (const c of (view.criteria as Body[]).filter((x) => x.mandatory && x.completeness !== "complete")) {
      const ex = await tlApi.call<Body>("POST", `${API}/gate-exceptions`, {
        gateCode: code,
        criterionKey: c.key,
        reason: "Synthetic QA-E2: the evidence follows the pilot.",
        scope: `Synthetic QA-E2: ${c.key} for this ${code} submission only.`,
        compensatingAction: "Synthetic QA-E2: weekly interim report to the Business Owner.",
        compensatingOwnerUserId: ids["bo"],
        expiresOn: plus(120),
      });
      await spApi.call(
        "POST",
        `${API}/gate-exceptions/${ex.id}/decision`,
        { outcome: "accepted", note: "Synthetic QA-E2: accepted (approves nothing real)." },
        { ifMatch: ex.version },
      );
    }
  };
  let initiative: Body = null;
  await test.step("5 prioritize initiatives and approve mobilization: TL scores in the scorecard, TL submits G4, SP approves G4 (synthetic)", async () => {
    await expectStep("prioritize_mobilize", false);
    // Prerequisites (native, API, the same demo users): the initiative and its outcome contribution; G1-G3 passed.
    for (const code of ["G1", "G2", "G3"]) {
      await coverGate(code);
      const g = await tlApi.call<Body>("GET", `${API}/gates/${code}`);
      const sub = await tlApi.call<Body>(
        "POST",
        `${API}/gates/${code}/submissions`,
        { submissionNote: `Synthetic QA-E2 ${code}` },
        { ifMatch: g.gate.version },
      );
      await spApi.call("POST", `${API}/gates/${code}/decision`, {
        submissionNo: sub.submissionNo,
        outcome: "approved",
        rationale: `Synthetic QA-E2 approval of ${code} (approves nothing real).`,
        ...(code === "G1" ? { agreements: { problem: true, baseline: true, materialValuePools: true } } : {}),
      });
    }
    initiative = await tlApi.call<Body>("POST", "/api/v1/initiatives", {
      transformationId: t,
      name: `Synthetic QA-E2 ${tag} roaming pass redesign`,
    });
    const outcomes = await tlApi.call<Body>("GET", `${API}/outcome-kpis?limit=50`);
    const okpi = (outcomes.items as Body[])[0];
    await tlApi.call("POST", `/api/v1/initiatives/${initiative.id}/outcome-contributions`, {
      outcomeId: okpi.outcomeId,
      outcomeKpiId: okpi.id,
      contributionStatement: "Synthetic: more roaming passes sold.",
    });
    const fresh = await tlApi.call<Body>("GET", `/api/v1/initiatives/${initiative.id}`);
    await tlApi.call("POST", `/api/v1/initiatives/${initiative.id}/submit`, {}, { ifMatch: fresh.version });
    // UI: the Lead scores the initiative in the scorecard.
    await visit(tlPage, `${base}/prioritization`);
    await tlPage.getByLabel(field(lang, "Initiative to score")).selectOption(initiative.id);
    const crit = catalogue(lang, "prioritization.criterion.strategic_fit");
    const label = catalogue(lang, "prioritization.scorecard.scoreFor")
      .replace("{{criterion}}", crit)
      .replace("{{weight}}", "25");
    await tlPage.getByLabel(new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`)).fill("4");
    await tlPage.getByRole("button", { name: catalogue(lang, "prioritization.scorecard.save"), exact: true }).click();
    await expect
      .poll(async () => {
        const sc = await tlApi.call<Body>("GET", `/api/v1/initiatives/${initiative.id}/scores`);
        return (sc.items ?? sc.scores ?? []).some((x: Body) => x.criterionCode === "strategic_fit" && x.score === 4);
      })
      .toBe(true);
    // UI: the Lead submits G4, the Sponsor approves it; the demo approval label is shown (REQ-S21-001).
    await coverGate("G4");
    await visit(tlPage, `${base}/gates/G4`);
    await tlPage.getByRole("button", { name: catalogue(lang, "gates.submit.action"), exact: true }).click();
    let d = dialogOf(tlPage);
    await d.getByRole("button", { name: catalogue(lang, "gates.submit.confirm"), exact: true }).click();
    await expect(d).toHaveCount(0);
    const spPage = await as("sp");
    await visit(spPage, `${base}/gates/G4`);
    await expect(spPage.locator("[data-state='synthetic-approval']").first()).toHaveText(
      catalogue(lang, "playbookP5.demo.approvalLabel"),
    );
    await spPage.getByRole("button", { name: catalogue(lang, "gates.decision.action"), exact: true }).click();
    d = dialogOf(spPage);
    await d.getByRole("radio", { name: catalogue(lang, "gates.outcome.approved") }).check();
    await d.locator("textarea").first().fill("Synthetic QA-E2 approval of G4 (approves nothing real).");
    await d.getByRole("button", { name: catalogue(lang, "gates.decision.confirm"), exact: true }).click();
    await expect(d).toHaveCount(0);
    await expectStep("prioritize_mobilize", true);
    const g4 = await tlApi.call<Body>("GET", `${API}/gates/G4`);
    expect(g4.gate.status).toBe("approved");
    await shot(spPage, "05-g4-approved");
  });

  // ---------------------------------------------------------------- 6. update delivery/adoption (TL update, BO training)
  const periods = await kdsApi.call<Body>("GET", `${API}/reporting-periods?limit=100`);
  const open = (periods.items as Body[]).filter((x) => x.status === "open" && x.frequency === "monthly");
  expect(open.length, "an open monthly reporting period in the demo dataset").toBeGreaterThan(0);
  const period = open[0];
  const updateText = `Synthetic QA-E2 ${tag}: launched the roaming day-pass pilot in two markets.`;
  await test.step("6 update delivery/adoption: TL submits the owner update, BO records a completed training", async () => {
    await expectStep("update_delivery_adoption", false);
    const tr = await tlApi.call<Body>("GET", `${API}`);
    await visit(tlPage, `${base}/owner-updates`);
    await tlPage.locator("#update-period").selectOption(period.id);
    const card = tlPage.locator(`[data-update-subject='${tr.code}']`);
    await card.getByRole("button", { name: new RegExp(catalogue(lang, "reportsP5.updates.write")) }).click();
    await card.locator("#update-achievements").fill(updateText);
    await card.getByRole("button", { name: catalogue(lang, "reportsP5.updates.submit"), exact: true }).click();
    await expect(card).toHaveAttribute("data-update-status", "submitted");
    // Adoption: the Business Owner completes a training record of a stakeholder group (prerequisites through the API).
    const group = await tlApi.call<Body>("POST", `${API}/stakeholder-groups`, {
      name: `Synthetic QA-E2 ${tag} frequent travellers`,
      impact: "H",
      influence: "L",
      currentStance: "support",
      requiredBehavior: "Synthetic: activate roaming in the app",
      interventionTypes: ["training"],
      ownerUserId: ids["bo"],
    });
    await boApi.call("POST", `${API}/training-records`, {
      stakeholderGroupId: group.id,
      participantLabel: `Synthetic agent ${tag}`,
      trainingTitle: `Synthetic roaming app course ${tag}`,
    });
    const boPage = await as("bo");
    await visit(boPage, `${base}/adoption-training`);
    await boPage.locator("#training-group").selectOption(group.id);
    await boPage.locator("[data-training-update]").first().click();
    const td = dialogOf(boPage);
    await td.locator("[data-field='status']").selectOption("completed");
    await td.locator("[data-field='completedOn']").fill(today);
    await td.locator("[data-action='submit']").click();
    await expect(td).toHaveCount(0);
    await expectStep("update_delivery_adoption", true);
    const ups = await tlApi.call<Body>("GET", `${API}/updates?limit=50`);
    expect((ups.items as Body[]).some((u) => u.status === "submitted" && u.achievements === updateText)).toBe(true);
    await shot(boPage, "06-training");
  });
  // ---------------------------------------------------------------- 7. submit KPI actual (KDS)
  const activeVersion = async (kpiId: string) => {
    const v = await kdsApi.call<Body>("POST", `${API}/kpi-definitions/${kpiId}/versions`, {
      measureType: "higher_is_better",
      valueNature: "flow",
      aggregationRule: "sum",
      submissionRoute: "direct_accept",
    });
    await kdsApi.call("POST", `${API}/kpi-versions/${v.id}/activate`, undefined, { ifMatch: v.version });
  };
  const kpis = await tlApi.call<Body>("GET", `${API}/kpi-definitions?limit=50`);
  const kpi = (kpis.items as Body[]).find((k) => k.name === kpiName);
  await test.step("7 submit KPI actual: the KPI owner (KDS) submits in the four-step update form", async () => {
    await expectStep("submit_kpi_actual", false);
    // Prerequisites (native, API): the Lead activates the definition (DG2); the KPI owner adds and activates its
    // measurement version with the aggregation rule (DG4).
    await tlApi.call("POST", `${API}/kpi-definitions/${kpi.id}/activate`, undefined, { ifMatch: kpi.version });
    await activeVersion(kpi.id);
    const kdsPage = await as("kds");
    await visit(kdsPage, `${base}/kpis/${kpi.id}/actuals`);
    const form = kdsPage.locator("form").filter({ has: kdsPage.locator("fieldset[data-step='1']") });
    await form.getByLabel(field(lang, "Reporting period")).selectOption(period.id);
    await form.getByLabel(new RegExp(`^${catalogue(lang, "kpiP4.field.actual")}`)).fill("120.5");
    await form.locator("[data-action='submit-actual']").click();
    await expect(kdsPage.locator("[data-state='kpi-update-confirmation']")).toBeVisible();
    await expectStep("submit_kpi_actual", true);
    const actuals = await kdsApi.call<Body>("GET", `${API}/kpi-definitions/${kpi.id}/actuals?limit=50`);
    const a = (actuals.items as Body[])[0];
    expect([a.status, a.reportingPeriodId]).toEqual([expect.stringMatching(/^(submitted|accepted)$/), period.id]);
    expect(JSON.stringify(a)).toMatch(/"120\.50*"/);
    await shot(kdsPage, "07-kpi-actual");
  });

  // ---------------------------------------------------------------- 8. validate benefit (BO measures, FIN validates)
  await test.step("8 validate benefit: BO submits the measurement, FIN approves it in the Finance queue (synthetic)", async () => {
    await expectStep("validate_benefit", false);
    // Prerequisites (native, API, the same demo users): the T09 formula (TL) validated by Finance; the T14 benefit (BO)
    // moved to Measure with its enabler initiative; its baseline validated by Finance; FIN mapped as the validator.
    const formula = await tlApi.call<Body>("POST", "/api/v1/benefit-formulas", {
      transformationId: t,
      benefitName: `Synthetic QA-E2 ${tag} attach uplift`,
      initialVersion: {
        expression: "(target_attach_rate - baseline_attach_rate) * eligible_customers * arpu",
        variables: [
          { name: "baseline_attach_rate", kind: "fraction", period: "none", value: "0.10", source: "Synthetic CRM" },
          { name: "target_attach_rate", kind: "fraction", period: "none", value: "0.12" },
          { name: "eligible_customers", kind: "count", unit: "customers", period: "year", value: "100000" },
          { name: "arpu", kind: "currency", currency: "SAR", unit: "per customer", period: "year", value: "50" },
        ],
      },
    });
    await finApi.call(
      "POST",
      `/api/v1/benefit-formulas/${formula.id}/versions/1/validation`,
      { result: "validated", note: "Synthetic Finance check of the formula logic" },
      { ifMatch: 1 },
    );
    await tlApi.call("POST", `${API}/role-mappings`, { partyCode: "FIN", targetKind: "user", userId: ids["fin"] });
    let ben = await boApi.call<Body>("POST", `${API}/benefits`, {
      title: `Synthetic QA-E2 ${tag} roaming revenue uplift`,
      description: "Synthetic: more roaming passes.",
      benefitType: "revenue",
      valueClass: "revenue_uplift",
      ownerUserId: ids["bo"],
      currency: "SAR",
      financialStatementLine: "Revenue - roaming",
      baselineValue: "1000000",
      baselineUnit: "SAR",
      targetValue: "1200000",
      benefitFormulaId: formula.id,
    });
    for (const toStep of ["plan", "enable", "measure"]) {
      if (toStep === "measure")
        await boApi.call("POST", `${API}/benefits/${ben.id}/enablers`, { initiativeId: initiative.id });
      ben = await boApi.call<Body>("POST", `${API}/benefits/${ben.id}/lifecycle`, { toStep }, { ifMatch: ben.version });
    }
    await finApi.call(
      "POST",
      `${API}/benefits/${ben.id}/baseline-validation`,
      { decision: "validated" },
      { ifMatch: ben.version },
    );
    const ev = await tlApi.call<Body>("POST", `${API}/evidence`, {
      kind: "note",
      title: `Synthetic QA-E2 ${tag} finance extract`,
      noteBody: "Synthetic",
      ownerUserId: tlApi.userId,
    });
    const m = await boApi.call<Body>("POST", `${API}/benefits/${ben.id}/measurements`, {
      periodStart: "2026-09-01",
      periodEnd: "2026-09-30",
      amount: "250000.00",
      attribution: "Synthetic: control group of untreated travellers",
      assumptions: "Synthetic: ARPU stable over the period",
      evidenceIds: [ev.id],
      submit: true,
    });
    // The worker queues the Finance item (benefits.finance_queue): the real worker process against this database.
    const worker = await startProductionWorker();
    let fv: Body = null;
    try {
      const until = Date.now() + 90_000;
      while (!fv && Date.now() < until) {
        const q = await finApi.call<Body>("GET", `${API}/finance-validations?status=queued`);
        fv = (q.items as Body[]).find((x) => x.benefitMeasurementId === m.id || x.benefitId === ben.id) ?? null;
        if (!fv) await new Promise((r) => setTimeout(r, 1000));
      }
      expect(fv, `the worker queued the Finance item:\n${worker.output().slice(-2000)}`).not.toBeNull();
    } finally {
      await worker.stop();
    }
    const finPage = await as("fin");
    await visit(finPage, `${base}/finance-validations/${fv.id}`);
    await expect(finPage.locator("[data-state='synthetic-approval']").first()).toHaveText(
      catalogue(lang, "playbookP5.demo.approvalLabel"),
    );
    await finPage.getByRole("button", { name: catalogue(lang, "benefitsP4.finance.decide") }).click();
    const fd = dialogOf(finPage);
    for (const item of ["baseline", "attribution", "calculation", "evidence", "measurementPeriod", "assumptions"])
      await fd.locator(`[data-field='item_${item}']`).selectOption("accepted");
    await fd.locator("[data-field='decision']").selectOption("approved");
    await fd.locator("[data-field='approvedAmount']").fill("240000.00");
    await fd.locator("[data-action='submit']").click();
    await expect(fd).toHaveCount(0);
    await expectStep("validate_benefit", true);
    const after = await finApi.call<Body>("GET", `${API}/finance-validations/${fv.id}`);
    expect([after.status, after.approvedAmount, after.decidedBy]).toEqual([
      "approved",
      expect.stringMatching(/^240000\.00*$/),
      ids["fin"],
    ]);
    await shot(finPage, "08-finance-approved");
  });

  // ---------------------------------------------------------------- 9. resolve executive decision (TL raises, BO decides)
  const ask = `Synthetic QA-E2 ${tag}: switch the roaming partner`;
  await test.step("9 resolve executive decision: TL raises the ask, the BO records the decided outcome (synthetic)", async () => {
    await expectStep("resolve_decision", false);
    await visit(tlPage, `${base}/executive-decisions`);
    await tlPage.getByRole("button", { name: uiRe(lang, "Raise an executive ask") }).click();
    const d = dialogOf(tlPage);
    await d.getByLabel(field(lang, "Decision required")).fill(ask);
    await d.getByLabel(field(lang, "Why now")).fill("Synthetic: the renewal window closes this month");
    await d.getByLabel(field(lang, "Options")).fill("Switch partner\nRenew the current partner");
    await d.getByLabel(field(lang, "Recommendation")).fill("A");
    await d.getByLabel(field(lang, "Impact of delay")).fill("Synthetic: a further quarter on the current terms");
    await d.getByLabel(field(lang, "Decision owner")).selectOption(ids["bo"]!);
    await d.getByLabel(field(lang, "Required date")).fill("2041-06-30");
    await d.getByRole("button", { name: uiRe(lang, "Raise ask") }).click();
    await expect(d).toHaveCount(0);
    const boPage = await as("bo");
    await visit(boPage, `${base}/executive-decisions`);
    await boPage.getByRole("row").filter({ hasText: ask }).getByRole("link").first().click();
    await expectBanner(boPage, lang);
    await boPage
      .getByRole("button", { name: uiRe(lang, catalogue("en", "governanceP4.decisions.recordOutcome")) })
      .click();
    const o = dialogOf(boPage);
    await o.locator("select").first().selectOption("decided");
    await o.getByLabel(field(lang, catalogue("en", "governanceP4.decisions.chosenOption"))).selectOption("A");
    await o.locator("textarea").first().fill("Synthetic: switch partner");
    await o.getByRole("button", { name: uiRe(lang, catalogue("en", "governanceP4.decisions.recordOutcome")) }).click();
    await expect(o).toHaveCount(0);
    await expectStep("resolve_decision", true);
    const list = await tlApi.call<Body>("GET", `${API}/executive-decisions?limit=50`);
    const row = (list.items as Body[]).find((x) => x.decision === ask);
    expect([row?.status, row?.chosenOptionLabel, row?.ownerUserId, row?.decidedBy]).toEqual([
      "decided",
      "A",
      ids["bo"],
      ids["bo"],
    ]);
    await shot(boPage, "09-decision");
  });

  // ---------------------------------------------------------------- 10. generate report (TL)
  await test.step("10 generate report: TL generates the charter snapshot in the reports screen", async () => {
    await expectStep("generate_report", false);
    await visit(tlPage, `${base}/reports`);
    await tlPage.getByLabel(field(lang, "Output")).first().selectOption("charter");
    await tlPage.getByRole("button", { name: uiRe(lang, "Generate snapshot") }).click();
    await expectStep("generate_report", true);
    const snaps = await tlApi.call<Body>("GET", `${API}/report-snapshots?limit=50`);
    const snap = (snaps.items as Body[]).find((x) => x.definitionCode === "charter");
    expect([snap?.status, snap?.transformationId, snap?.createdBy]).toEqual(["generated", t, tlApi.userId]);
    // ADR-0050 §2 d: a report generated in a demo database records synthetic: true in its content.
    const full = await tlApi.call<Body>("GET", `${API}/report-snapshots/${snap.id}`);
    expect(JSON.stringify(full.content)).toContain('"synthetic":true');
    await shot(tlPage, "10-report");
  });

  // ---------------------------------------------------------------- 11. accept BAU handover (TL prepares, BO accepts)
  let acceptedAt = "";
  await test.step("11 accept BAU handover: BO creates the area, TL prepares and submits the handover, BO accepts it", async () => {
    await expectStep("accept_bau_handover", false);
    const boPage = await as("bo");
    await visit(boPage, `${base}/bau`);
    await boPage.getByRole("button", { name: catalogue(lang, "sustainP4.areas.create") }).click();
    let dd = dialogOf(boPage);
    const areaName = `Synthetic QA-E2 ${tag} roaming care`;
    await dd.locator("[data-field='name']").fill(areaName);
    await dd.locator("[data-action='submit']").click();
    await expect(dd).toHaveCount(0);
    await boPage.locator("tr", { hasText: areaName }).locator("[data-area-link]").click();
    await boPage.waitForURL(/\/performance-areas\//);
    const areaId = boPage.url().split("/performance-areas/")[1]!;
    await boPage.locator("#area-controls [data-create-control]").click();
    dd = dialogOf(boPage);
    await dd.locator("[data-field='name']").fill(`Synthetic QA-E2 ${tag} roaming log reconciliation`);
    await dd.locator("[data-action='submit']").click();
    await expect(dd).toHaveCount(0);
    const evTitle = `Synthetic QA-E2 ${tag} SOP sign-off`;
    await tlApi.call("POST", `${API}/evidence`, {
      kind: "note",
      title: evTitle,
      noteBody: "Synthetic SOP sign-off (demo data).",
      ownerUserId: tlApi.userId,
    });
    await visit(tlPage, `${base}/performance-areas/${areaId}`);
    await tlPage.locator("[data-prepare-handover]").click();
    dd = dialogOf(tlPage);
    await dd.locator("[data-field='receivingOwnerUserId']").selectOption(ids["bo"]!);
    await dd.locator("[data-field='kpiOwnerUserId']").selectOption(ids["kds"]!);
    await dd.locator("[data-field='operatingProcedures']").fill("Synthetic SOP v2");
    await dd.locator("[data-field='capabilityReadiness']").fill("Synthetic: agents trained");
    await dd.locator("[data-field='unresolvedAcceptedRisks']").fill("Synthetic: none material");
    await dd.locator("[data-field='benefitMonitoringCadence']").selectOption("monthly");
    await dd.locator("[data-field='improvementBacklogSummary']").fill("Synthetic: one open item");
    await dd.locator("[data-field='dataAccess']").fill("Synthetic: BI read role for the roaming log");
    await dd.locator("[data-action='submit']").click();
    await expect(dd).toHaveCount(0);
    await tlPage.locator("[data-handover-link]").first().click();
    await tlPage.waitForURL(/\/bau-handovers\//);
    const handoverId = tlPage.url().split("/bau-handovers/")[1]!;
    await tlPage.locator("[data-add-evidence]").click();
    dd = dialogOf(tlPage);
    await dd.locator("[data-field='evidenceId']").selectOption({ label: evTitle });
    await dd.locator("[data-action='submit']").click();
    await expect(dd).toHaveCount(0);
    await tlPage.locator("[data-submit-handover]").click();
    await expect(tlPage.locator("[data-status='submitted']").first()).toBeVisible();
    await visit(boPage, `${base}/bau-handovers/${handoverId}`);
    await boPage.locator("[data-accept-handover]").click();
    dd = dialogOf(boPage);
    await dd.locator("[data-action='submit']").click();
    await expect(dd).toHaveCount(0);
    await expect(boPage.locator("[data-state='accepted-final']")).toBeVisible();
    await expectStep("accept_bau_handover", true);
    const h = await boApi.call<Body>("GET", `${API}/bau-handovers/${handoverId}`);
    expect([h.status, h.receivingOwnerUserId]).toEqual(["accepted", ids["bo"]]);
    acceptedAt = h.acceptedAt;
    await shot(boPage, "11-handover-accepted");
  });

  // ---------------------------------------------------------------- 12. continue performance monitoring (KDS)
  await test.step("12 continue performance monitoring: KDS submits a KPI actual after the acceptance", async () => {
    await expectStep("continue_monitoring", false);
    // A second KPI of the same owner (prerequisite through the API), so its actual is new after the handover.
    const k2 = await tlApi.call<Body>("POST", `${API}/kpi-definitions`, {
      name: `Synthetic QA-E2 ${tag} roaming passes sold`,
      unitKind: "count",
      polarity: "higher_is_better",
      frequency: "monthly",
      ownerUserId: ids["kds"],
    });
    await tlApi.call("POST", `${API}/kpi-definitions/${k2.id}/activate`, undefined, { ifMatch: k2.version });
    await activeVersion(k2.id);
    const kdsPage = await as("kds");
    await visit(kdsPage, `${base}/kpis/${k2.id}/actuals`);
    const form = kdsPage.locator("form").filter({ has: kdsPage.locator("fieldset[data-step='1']") });
    await form.getByLabel(field(lang, "Reporting period")).selectOption(period.id);
    await form.getByLabel(new RegExp(`^${catalogue(lang, "kpiP4.field.actual")}`)).fill("42");
    await form.locator("[data-action='submit-actual']").click();
    await expect(kdsPage.locator("[data-state='kpi-update-confirmation']")).toBeVisible();
    await expectStep("continue_monitoring", true);
    const actuals = await kdsApi.call<Body>("GET", `${API}/kpi-definitions/${k2.id}/actuals?limit=50`);
    const a = (actuals.items as Body[])[0];
    expect(a.status).toMatch(/^(submitted|accepted)$/);
    expect(Date.parse(a.submittedAt)).toBeGreaterThan(Date.parse(acceptedAt));
    await shot(kdsPage, "12-monitoring");
  });

  // All twelve, from the persisted records.
  const final = await tlApi.call<Body>("GET", `/api/v1/demo/walkthrough?transformationId=${t}`);
  expect([final.completedCount, final.total]).toEqual([12, 12]);

  // The walkthrough screen of the new transformation shows the persisted progress, in the user's language.
  await visit(tlPage, `/walkthrough?transformationId=${t}`);
  await expectAccessible(tlPage, lang, "a02-e2-walkthrough");
  await shot(tlPage, "walkthrough");
  for (const p of pages) await p.context().close();
  for (const s of Object.values(api)) await s.req.dispose();
  expect(foreign.flat()).toEqual([]);
});
