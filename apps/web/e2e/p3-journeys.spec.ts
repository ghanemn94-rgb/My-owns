// P3 end-to-end journeys on the REAL stack (support/with-stack.sh; no mocks), in the project's language (chromium-en ->
// English LTR, chromium-ar -> Arabic RTL). T-DG3-FE-D. ONE continuous story through the whole Mobilize phase of one
// SYNTHETIC End-to-End transformation, ending in an approved G4:
//   1. sequencing: submit refused before G1 (readiness lists the missing areas); G1 approved with the three
//      confirmations; 'Outcome before activity'; a funded initiative's launch refused before G2/G3, accepted after;
//   2. prioritization: 5,4,3,2,1 -> 3.30 and 57.5 (labelled); 95% refused; weight version 2 approved by the Sponsor and
//      shown as the cause in the ranking history; an override without a reason refused; 'Selected - unfunded';
//   3. roadmap and dependencies: four source waves; a moved milestone in timeline, table and board; a 409 banner;
//      A->B->C->A refused naming the cycle; a needed-by conflict flagged (then mitigated);
//   4. business case and T09: ten sections, one class per line, the roll-up counts each line once, the revenue
//      example previews 100000 SAR, monthly ARPU x annual population refused, Finance validates (the author cannot);
//   5. capacity and funding: demand above capacity flagged, committed by the capacity owner; Funded;
//   6. G4: refused listing 'Owners', 'Finance validation' and the initiative; fixed and resubmitted; 403 for a
//      non-approver and for the submitter; 409 on a superseded submission; approved by the Sponsor -> Transform;
//   7. the read-only auditor sees every P3 screen with no enabled write control.
// Distinct people per role: TL dev.lead submits; a synthetic FIN user validates and records funding; a synthetic SP
// user approves the weights, the selection and the gates; the capacity owner (TO, dev.office) commits demand; AUD
// dev.auditor reads. Every business decision here is a SYNTHETIC demo record that approves nothing real, and product
// gate G4 (or any G1-G6) never implies any engineering gate (DG0-DG7).
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  SHOTS,
  SYN_RETAIL,
  apiSession,
  axeSummary,
  confirmG1Agreements,
  escape,
  exactly,
  expectAccessible,
  fieldLabel,
  langOf,
  shot,
  signIn,
  tr,
  trackRequests,
  type Lang,
} from "./support/ui.ts";
import {
  asUser,
  defineRecords,
  g1Records,
  g2Records,
  g3Records,
  submitAndApprove,
  syntheticUser,
  type SyntheticUser,
} from "./support/p3-journey-setup.ts";

test.describe.configure({ mode: "serial" });

test.afterAll(async ({}, info) => {
  const lang = langOf(info);
  mkdirSync(join(SHOTS, lang), { recursive: true });
  const mine = Object.fromEntries(Object.entries(axeSummary).filter(([k]) => k.includes("p3-journey")));
  writeFileSync(join(SHOTS, lang, "axe-summary-p3-journey.json"), `${JSON.stringify(mine, null, 2)}\n`);
});

let tid = "";
let sp: SyntheticUser;
let fin: SyntheticUser;
/** A: the journey's initiative (created in the UI); B and C: two more submitted initiatives (setup). */
const ini: Record<"A" | "B" | "C", { id: string; code: string; name: string }> = {
  A: { id: "", code: "", name: "Synthetic order validation at entry" },
  B: { id: "", code: "", name: "Synthetic billing data feed" },
  C: { id: "", code: "", name: "Synthetic rating engine change" },
};
let define = { outcomeId: "", kpiId: "", outcomeKpiId: "" };
let formulaId = "";
/** The cost-reduction example: one formula backs one benefit line only. */
let formula2Id = "";
let tCaseId = "";
let iCaseId = "";
const MILESTONE = "Synthetic order validation pilot go-live";

const T = () => `/api/v1/transformations/${tid}`;
const ws = (path: string) => `/transformations/${tid}/${path}`;
const label = (lang: Lang, key: string) => fieldLabel(lang, key);
const startsWith = (lang: Lang, key: string, vars: Record<string, string | number> = {}) =>
  new RegExp(`^\\s*${escape(tr(lang, key, vars))}`);
const region = (page: Page, lang: Lang, key: string) => page.getByRole("region", { name: tr(lang, key), exact: true });
const money = (lang: Lang, amount: string) => (lang === "ar" ? `${amount} SAR` : `SAR ${amount}`);
const user = (lang: Lang, role: string) => `dev.p3j.${role}.${lang}`;

async function milestoneShot(page: Page, lang: Lang, name: string) {
  await expectAccessible(page, lang, name);
  await shot(page, lang, name);
}

/**
 * No enabled write control in the page body: sorting, filters (`.filters`), pagination, column pickers, view toggles
 * and navigation are reading aids; a read-only input is not a write control.
 */
async function expectNoWriteControl(page: Page, lang: Lang) {
  const enabled = await page
    .locator("main#main")
    .locator("form, input, textarea, select, button")
    .evaluateAll((els) =>
      els
        .filter(
          (el) =>
            !(el as HTMLButtonElement).disabled &&
            !(el as HTMLInputElement).readOnly &&
            !el.closest(
              "thead, .register__toolbar, .pager, .column-picker, nav, .section-nav, .filters, [data-view-control]",
            ),
        )
        .map((el) => `${el.tagName}:${(el.textContent ?? "").trim()}`),
    );
  // View controls that only change what is shown (the 0-100 view, opening a read-only scorecard, viewing a gate
  // submission) are reading aids.
  const aids = [
    exactly(`BUTTON:${tr(lang, "prioritization.ranked.toggle100")}`),
    new RegExp(
      `^BUTTON:${escape(tr(lang, "prioritization.ranked.openScorecard", { code: "§" })).replace("§", "INI-\\d+")}$`,
    ),
    new RegExp(`^BUTTON:${escape(tr(lang, "gates.history.view"))}\\s*#\\d+$`),
  ];
  expect(enabled.filter((e) => !aids.some((a) => a.test(e)))).toEqual([]);
}

async function transition(page: Page, lang: Lang, id: string, text?: string): Promise<Locator> {
  await page.locator(`[data-transition='${id}']`).click();
  const dialog = page.getByRole("dialog");
  if (text !== undefined)
    await dialog
      .getByLabel(label(lang, `portfolio.transition.text.${id === "select" ? "rationale" : "note"}`))
      .fill(text);
  await dialog.getByRole("button", { name: tr(lang, `portfolio.transition.${id}.confirm`), exact: true }).click();
  return dialog;
}

// ------------------------------------------------------------------------------------------------ setup

test("setup: a synthetic End-to-End transformation, a synthetic Sponsor and Finance user, two draft initiatives", async ({
  playwright,
}, info) => {
  const lang = langOf(info);
  const lead = await apiSession(playwright, "dev.lead");
  const admin = await apiSession(playwright, "dev.admin");
  const created = await lead.call<{ id: string }>("POST", "/api/v1/transformations", {
    businessUnitId: SYN_RETAIL,
    name: `Synthetic P3 journey ${lang.toUpperCase()}`,
    mode: "end_to_end",
  });
  tid = created.id;
  const me = await admin.call<{ organization: { id: string } }>("GET", "/api/v1/me");
  const stamp = Date.now().toString(36);
  sp = await syntheticUser(
    admin,
    me.organization.id,
    tid,
    `${user(lang, "sp")}.${stamp}`,
    `Synthetic Sponsor ${lang.toUpperCase()}`,
    "SP",
    lang,
  );
  fin = await syntheticUser(
    admin,
    me.organization.id,
    tid,
    `${user(lang, "fin")}.${stamp}`,
    `Synthetic Finance ${lang.toUpperCase()}`,
    "FIN",
    lang,
  );
  for (const k of ["B", "C"] as const) {
    const i = await lead.call<{ id: string; code: string }>("POST", "/api/v1/initiatives", {
      transformationId: tid,
      name: ini[k].name,
      objective: `Synthetic objective of ${ini[k].name}`,
      scopeIn: "Synthetic retail scope",
      executiveOwnerUserId: lead.userId,
      workstreamLeadUserId: lead.userId,
      plannedStart: "2026-11-01",
      plannedEnd: k === "B" ? "2027-03-31" : "2027-06-30",
    });
    ini[k].id = i.id;
    ini[k].code = i.code;
  }
});

// ------------------------------------------------------------------------------------------------ 1. sequencing

test("1a. sequencing: a draft before G1 cannot be submitted (translated G1 reason); readiness lists the missing areas", async ({
  page,
}, info) => {
  const lang = langOf(info);
  const foreign = trackRequests(page);
  await signIn(page, lang, "dev.lead");
  await page.goto(ws("portfolio"));
  await page.getByRole("button", { name: tr(lang, "portfolio.create.action") }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel(label(lang, "portfolio.field.name")).fill(ini.A.name);
  await dialog.getByRole("button", { name: tr(lang, "portfolio.create.submit") }).click();
  await expect(page.locator("#initiative-summary-title")).toContainText(ini.A.name);
  ini.A.id = (await page.locator("[data-initiative]").first().getAttribute("data-initiative"))!;
  expect(ini.A.id).toMatch(/^[0-9a-f-]{36}$/);
  ini.A.code = ((await page.locator("#initiative-summary-title").textContent()) ?? "").match(/INI-\d+/)![0];

  // The card fields G4 reads later (objective, scope, owner, wave, dates) are entered through the card's edit form.
  await page.getByRole("button", { name: tr(lang, "portfolio.card.edit") }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel(label(lang, "portfolio.t05.objective")).fill("Synthetic: stop billing errors at order entry");
  await dialog.getByLabel(label(lang, "portfolio.field.scopeIn")).fill("Synthetic: retail consumer orders");
  await dialog
    .getByLabel(label(lang, "portfolio.t05.executiveOwner"))
    .selectOption("01920000-0000-7000-9000-000000000203");
  await dialog
    .getByLabel(label(lang, "portfolio.t05.workstreamLead"))
    .selectOption("01920000-0000-7000-9000-000000000203");
  await dialog.getByLabel(label(lang, "portfolio.field.wave")).selectOption({ index: 2 });
  await dialog.getByLabel(label(lang, "portfolio.field.plannedStart")).fill("2026-11-01");
  await dialog.getByLabel(label(lang, "portfolio.field.plannedEnd")).fill("2027-04-30");
  await dialog.getByRole("button", { name: tr(lang, "common.action.save"), exact: true }).click();
  await expect(dialog).toHaveCount(0);

  dialog = await transition(page, lang, "submit");
  const alert = dialog.getByRole("alert");
  await expect(alert).toHaveCount(1);
  await expect(alert).toHaveAttribute("data-problem", "initiative.g1_not_approved");
  await expect(alert).toContainText(tr(lang, "portfolio.problem.initiative__g1_not_approved"));
  await milestoneShot(page, lang, "p3-journey-01-submit-before-g1");
  await dialog.getByRole("button", { name: tr(lang, "common.action.cancel"), exact: true }).click();

  await page.goto(ws("readiness"));
  const missing = page.locator("[data-missing-areas]");
  await expect(missing).toHaveAttribute("data-missing-areas", "economics customer operations capability technology");
  for (const area of ["economics", "customer", "operations", "capability", "technology"])
    await expect(missing.locator(`[data-missing-area='${area}']`)).toContainText(tr(lang, `readiness.area.${area}`));
  await milestoneShot(page, lang, "p3-journey-02-readiness-missing-areas");
  expect(foreign).toEqual([]);
});

test("1b. sequencing: G1 is submitted by the lead and approved by the demo Sponsor with the three confirmations", async ({
  page,
  browser,
  playwright,
}, info) => {
  const lang = langOf(info);
  const lead = await apiSession(playwright, "dev.lead");
  // The G1 records themselves are P2 setup (covered on their own screens by the P2 specs).
  await g1Records(T(), lead, await apiSession(playwright, "dev.office"), sp.id);
  await signIn(page, lang, "dev.lead");
  await page.goto(ws("gates/G1"));
  await page.getByRole("button", { name: tr(lang, "gates.submit.action"), exact: true }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel(label(lang, "gates.submit.note")).fill("Synthetic G1 submission of the P3 journey");
  await dialog.getByRole("button", { name: tr(lang, "gates.submit.confirm"), exact: true }).click();
  await expect(dialog).toHaveCount(0);

  const sponsor = await asUser(browser, lang, sp.username);
  await sponsor.page.goto(ws("gates/G1"));
  await sponsor.page.getByRole("button", { name: tr(lang, "gates.decision.action"), exact: true }).click();
  dialog = sponsor.page.getByRole("dialog");
  await dialog.getByRole("radio", { name: tr(lang, "gates.outcome.approved"), exact: true }).check();
  await confirmG1Agreements(dialog, lang);
  await dialog
    .getByLabel(label(lang, "gates.decision.rationale"))
    .fill("Synthetic demo approval: problem, baseline and value pools agreed (approves nothing real).");
  await milestoneShot(sponsor.page, lang, "p3-journey-03-g1-confirmations");
  await dialog.getByRole("button", { name: tr(lang, "gates.decision.confirm"), exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(sponsor.page.locator("[data-gate-status='approved']").first()).toBeVisible();
  await expect(sponsor.page.locator("main#main .page-header__subtitle")).toContainText(
    tr(lang, "transformations.phase.define"),
  );
  await sponsor.close();
});

test("1c. sequencing: 'Outcome before activity' refuses a submission without an outcome/KPI link; with it, accepted", async ({
  page,
  playwright,
}, info) => {
  const lang = langOf(info);
  const foreign = trackRequests(page);
  const lead = await apiSession(playwright, "dev.lead");
  define = await defineRecords(T(), lead);
  await signIn(page, lang, "dev.lead");
  await page.goto(ws(`initiatives/${ini.A.id}`));
  let dialog = await transition(page, lang, "submit");
  const alert = dialog.getByRole("alert");
  await expect(alert).toHaveAttribute("data-problem", "initiative.outcome_before_activity");
  await expect(alert).toContainText(tr(lang, "portfolio.problem.initiative__outcome_before_activity"));
  if (lang === "en") await expect(alert).toContainText("Outcome before activity");
  await milestoneShot(page, lang, "p3-journey-04-outcome-before-activity");
  await dialog.getByRole("button", { name: tr(lang, "common.action.cancel"), exact: true }).click();

  await page.getByRole("button", { name: tr(lang, "portfolio.contribution.add") }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel(label(lang, "portfolio.contribution.field.outcome")).selectOption(define.outcomeId);
  await dialog.getByLabel(label(lang, "portfolio.contribution.field.kpiOptional")).selectOption(define.outcomeKpiId);
  await dialog
    .getByLabel(label(lang, "portfolio.contribution.field.statement"))
    .fill("Synthetic: fewer billing errors at the source");
  await dialog.getByRole("button", { name: tr(lang, "portfolio.contribution.add"), exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator("#contributions [data-has-kpi='true']")).toBeVisible();

  dialog = await transition(page, lang, "submit");
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(`[data-initiative='${ini.A.id}']`)).toHaveAttribute("data-status", "submitted");
  await milestoneShot(page, lang, "p3-journey-05-submitted");

  // B and C join the portfolio the same way (setup through the API).
  for (const k of ["B", "C"] as const) {
    await lead.call("POST", `/api/v1/initiatives/${ini[k].id}/outcome-contributions`, {
      outcomeId: define.outcomeId,
      outcomeKpiId: define.outcomeKpiId,
      contributionStatement: "Synthetic: fewer billing errors.",
    });
    const fresh = await lead.call<{ version: number }>("GET", `/api/v1/initiatives/${ini[k].id}`);
    await lead.call("POST", `/api/v1/initiatives/${ini[k].id}/submit`, {}, { ifMatch: fresh.version });
  }
  expect(foreign).toEqual([]);
});

// ------------------------------------------------------------------------------------------------ 2. prioritization

const SCORES_A = { strategic_fit: 5, financial_value: 4, customer_impact: 3, feasibility: 2, time_to_value: 1 };
const V1_WEIGHTS: Record<string, number> = {
  strategic_fit: 25,
  financial_value: 25,
  customer_impact: 20,
  feasibility: 15,
  time_to_value: 15,
};

async function scoreInUi(
  page: Page,
  lang: Lang,
  code: string,
  scores: Record<string, number>,
  weights: Record<string, number>,
) {
  await page
    .getByRole("button", { name: tr(lang, "prioritization.ranked.openScorecard", { code }), exact: true })
    .click();
  for (const [criterion, score] of Object.entries(scores))
    await page
      .getByLabel(
        new RegExp(
          `^${escape(tr(lang, "prioritization.scorecard.scoreFor", { criterion: tr(lang, `prioritization.criterion.${criterion}`), weight: String(weights[criterion]) }))}`,
        ),
      )
      .fill(String(score));
  await page.getByRole("button", { name: tr(lang, "prioritization.scorecard.save"), exact: true }).click();
}

async function recordSnapshot(page: Page, lang: Lang) {
  await page.getByRole("button", { name: tr(lang, "prioritization.rankings.create"), exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: tr(lang, "prioritization.rankings.createConfirm"), exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

test("2a. prioritization: 5,4,3,2,1 -> 3.30 and 57.5 (labelled); 95% refused; weight version 2 proposed; an override needs a reason", async ({
  page,
  playwright,
}, info) => {
  const lang = langOf(info);
  const foreign = trackRequests(page);
  // B and C are scored through the API (setup); A is scored on the scorecard.
  const lead = await apiSession(playwright, "dev.lead");
  for (const [k, s] of [
    ["B", { strategic_fit: 4, financial_value: 4, customer_impact: 3, feasibility: 3, time_to_value: 3 }],
    ["C", { strategic_fit: 3, financial_value: 3, customer_impact: 3, feasibility: 3, time_to_value: 3 }],
  ] as const)
    for (const [criterionCode, score] of Object.entries(s))
      await lead.call("POST", `/api/v1/initiatives/${ini[k].id}/scores`, { criterionCode, score });
  await signIn(page, lang, "dev.lead");
  await page.goto(ws("prioritization"));
  await scoreInUi(page, lang, ini.A.code, SCORES_A, V1_WEIGHTS);
  await expect(page.getByTestId("weighted-score")).toHaveText("3.30");
  const ranked = page.getByRole("table", { name: tr(lang, "prioritization.ranked.caption"), exact: true });
  const row = (code: string) => ranked.getByRole("row").filter({ hasText: code });
  await expect(row(ini.A.code)).toContainText("3.30");
  await milestoneShot(page, lang, "p3-journey-06-scored-330");
  await page.getByRole("button", { name: tr(lang, "prioritization.ranked.toggle100"), exact: true }).click();
  await expect(page.getByTestId("conversion-label")).toHaveText(tr(lang, "prioritization.conversion_label"));
  await expect(row(ini.A.code)).toContainText("57.5");
  await milestoneShot(page, lang, "p3-journey-07-view-100");
  await page.getByRole("button", { name: tr(lang, "prioritization.ranked.toggle100"), exact: true }).click();
  // Ranking snapshot #1 under weight version 1.
  await recordSnapshot(page, lang);

  const sent: string[] = [];
  page.on("request", (req) => {
    if (req.method() !== "GET") sent.push(`${req.method()} ${new URL(req.url()).pathname}`);
  });
  await page.getByRole("button", { name: tr(lang, "prioritization.weights.propose"), exact: true }).click();
  const dialog = page.getByRole("dialog");
  const crit = (c: string) => tr(lang, `prioritization.criterion.${c}`);
  const weight = (c: string) =>
    dialog.getByLabel(tr(lang, "prioritization.weights.weightFor", { criterion: crit(c) }), { exact: true });
  await weight("strategic_fit").fill("20");
  await expect(dialog.getByTestId("weights-total")).toContainText(
    tr(lang, "prioritization.problem.prioritization__weights_total", { total: "95.00" }),
  );
  await dialog
    .getByLabel(label(lang, "prioritization.weights.rationale"))
    .fill("Synthetic: regulated context adds risk/compliance");
  await dialog.getByRole("button", { name: tr(lang, "prioritization.weights.proposeSubmit"), exact: true }).click();
  expect(sent).toEqual([]);
  await milestoneShot(page, lang, "p3-journey-08-weights-95-refused");
  await weight("strategic_fit").fill("15");
  await dialog
    .getByLabel(tr(lang, "prioritization.weights.include", { criterion: crit("risk_compliance") }), { exact: true })
    .check();
  await weight("risk_compliance").fill("10");
  await expect(dialog.getByTestId("weights-total")).toContainText(tr(lang, "prioritization.weights.totalOk"));
  await dialog.getByRole("button", { name: tr(lang, "prioritization.weights.proposeSubmit"), exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId("weight-set-history").locator("[data-version='2']")).toContainText(
    tr(lang, "prioritization.weights.state.proposed"),
  );

  // An override without a reason is refused before anything is sent.
  sent.length = 0;
  await page.getByRole("button", { name: tr(lang, "prioritization.overrides.propose"), exact: true }).click();
  const od = page.getByRole("dialog");
  await od.getByLabel(label(lang, "prioritization.ranked.initiative")).selectOption(ini.C.id);
  await od.getByLabel(label(lang, "prioritization.overrides.rank")).fill("1");
  await od.getByRole("button", { name: tr(lang, "prioritization.overrides.proposeConfirm"), exact: true }).click();
  await expect(od.getByLabel(label(lang, "prioritization.overrides.reason"))).toHaveAttribute("aria-invalid", "true");
  expect(sent).toEqual([]);
  await milestoneShot(page, lang, "p3-journey-09-override-needs-reason");
  await od.getByRole("button", { name: tr(lang, "common.action.cancel"), exact: true }).click();
  expect(foreign).toEqual([]);
});

test("2b. prioritization: the demo Sponsor approves weight version 2; the history shows 'weight version 2'; A is 'Selected - unfunded'", async ({
  page,
  browser,
  playwright,
}, info) => {
  const lang = langOf(info);
  const sponsor = await asUser(browser, lang, sp.username);
  const foreign = trackRequests(sponsor.page);
  await sponsor.page.goto(ws("prioritization"));
  await sponsor.page
    .getByRole("button", { name: tr(lang, "prioritization.weights.approve", { n: 2 }), exact: true })
    .click();
  const dialog = sponsor.page.getByRole("dialog");
  await expect(dialog).toContainText(tr(lang, "prioritization.shared.businessApproval"));
  await dialog.getByRole("button", { name: tr(lang, "prioritization.weights.approveConfirm"), exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(sponsor.page.getByTestId("active-weight-set")).toContainText(
    tr(lang, "prioritization.weights.activeVersion", { n: 2 }),
  );

  // Version 2 adds risk/compliance: the lead scores A on it (B and C through the API) and records snapshot #2.
  const lead = await apiSession(playwright, "dev.lead");
  for (const k of ["B", "C"] as const)
    await lead.call("POST", `/api/v1/initiatives/${ini[k].id}/scores`, { criterionCode: "risk_compliance", score: 3 });
  await signIn(page, lang, "dev.lead");
  await page.goto(ws("prioritization"));
  await scoreInUi(page, lang, ini.A.code, { risk_compliance: 4 }, { risk_compliance: 10 });
  await expect(page.getByTestId("weighted-score")).not.toContainText(tr(lang, "prioritization.incomplete"));
  await recordSnapshot(page, lang);
  const hist = page.getByTestId("ranking-history");
  await expect(hist).toContainText(tr(lang, "prioritization.cause.weight", { n: 2 }));
  if (lang === "en") await expect(hist).toContainText("weight version 2");
  await hist.scrollIntoViewIfNeeded();
  await milestoneShot(page, lang, "p3-journey-10-history-weight-v2");

  // The Sponsor selects A (business approval): selected, but not funded.
  await sponsor.page.goto(ws(`initiatives/${ini.A.id}`));
  const sd = await transition(sponsor.page, lang, "select", "Synthetic demo selection: top of the ranking");
  await expect(sd).toHaveCount(0);
  await expect(sponsor.page.locator(`[data-initiative='${ini.A.id}']`)).toHaveAttribute("data-status", "selected");
  await expect(sponsor.page.locator("[data-funding='unfunded']").first()).toContainText(
    tr(lang, "portfolio.funding.selectedUnfunded"),
  );
  if (lang === "en")
    await expect(sponsor.page.locator("[data-funding='unfunded']").first()).toContainText("Selected - unfunded");
  await milestoneShot(sponsor.page, lang, "p3-journey-11-selected-unfunded");
  expect(foreign).toEqual([]);
  await sponsor.close();
});

// ------------------------------------------------------------------------------------------------ 3. roadmap

test("3a. roadmap: four source waves; a milestone created, its date approved and moved — timeline, table and board agree; a stale edit shows the 409 banner", async ({
  page,
  playwright,
}, info) => {
  const lang = langOf(info);
  const foreign = trackRequests(page);
  await signIn(page, lang, "dev.lead");
  await page.goto(ws(`initiatives/${ini.A.id}`));
  const milestones = page.locator("section#milestones");
  await milestones.getByRole("button", { name: startsWith(lang, "portfolio.milestone.add") }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel(label(lang, "portfolio.milestone.fieldTitle")).fill(MILESTONE);
  await dialog.getByLabel(label(lang, "portfolio.milestone.forecast")).fill("2026-12-10");
  await dialog.getByRole("button", { name: tr(lang, "portfolio.milestone.add"), exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(milestones).toContainText(MILESTONE);

  await page.goto(ws("roadmap"));
  const waves = page.getByTestId("waves");
  for (const name of ["Wave 0 — Mobilize", "Wave 1 — Prove", "Wave 2 — Scale", "Wave 3 — Embed"])
    await expect(waves).toContainText(name);
  await expect(page.getByTestId("wave-horizons").getByRole("listitem")).toHaveCount(4);
  await milestoneShot(page, lang, "p3-journey-12-roadmap-waves");

  // The approved (baseline) date, then a move of the forecast.
  await page
    .getByRole("button", { name: tr(lang, "roadmap.milestones.approveDate", { title: MILESTONE }), exact: true })
    .click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel(label(lang, "roadmap.milestones.approved")).fill("2026-12-01");
  await dialog.getByLabel(label(lang, "common.form.reason")).fill("Synthetic initial baseline of the pilot");
  await dialog.getByRole("button", { name: tr(lang, "roadmap.milestones.approveConfirm"), exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page
    .getByRole("button", { name: tr(lang, "roadmap.milestones.move", { title: MILESTONE }), exact: true })
    .click();
  await dialog.getByLabel(tr(lang, "roadmap.milestones.forecast"), { exact: true }).fill("2026-12-20");
  await dialog.getByRole("button", { name: tr(lang, "roadmap.milestones.moveConfirm"), exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const timeline = page
    .getByTestId("timeline-milestones")
    .locator("li", { hasText: MILESTONE })
    .getByTestId("timeline-date");
  await expect(timeline).toContainText(/20|٢٠/);
  const date = ((await timeline.textContent()) ?? "").trim();
  await expect(page.locator(`[data-initiative='${ini.A.code}'] [data-testid='table-next-milestone']`)).toContainText(
    date,
  );
  await expect(page.locator(`[data-card='${ini.A.code}'] [data-testid='board-next-milestone']`)).toContainText(date);
  await milestoneShot(page, lang, "p3-journey-13-milestone-moved");

  // Someone else moves it meanwhile: this page still holds the old version -> 409 and the conflict banner.
  const lead = await apiSession(playwright, "dev.lead");
  const list = await lead.call<{ items: { id: string; title: string; version: number }[] }>(
    "GET",
    `/api/v1/initiatives/${ini.A.id}/milestones`,
  );
  const m = list.items.find((x) => x.title === MILESTONE)!;
  await lead.call("PATCH", `/api/v1/milestones/${m.id}`, { forecastDate: "2026-12-22" }, { ifMatch: m.version });
  await page
    .getByRole("button", { name: tr(lang, "roadmap.milestones.move", { title: MILESTONE }), exact: true })
    .click();
  await dialog.getByLabel(tr(lang, "roadmap.milestones.forecast"), { exact: true }).fill("2026-12-24");
  await dialog.getByRole("button", { name: tr(lang, "roadmap.milestones.moveConfirm"), exact: true }).click();
  const conflict = page.locator("[data-state='conflict']");
  await expect(conflict).toContainText(tr(lang, "common.conflict.title"));
  await expect(timeline).toContainText(/22|٢٢/);
  await milestoneShot(page, lang, "p3-journey-14-milestone-409");
  expect(foreign).toEqual([]);
});

test("3b. dependencies: A->B and B->C recorded; C->A refused naming the cycle; the needed-by conflict is flagged, then mitigated", async ({
  page,
}, info) => {
  const lang = langOf(info);
  const foreign = trackRequests(page);
  await signIn(page, lang, "dev.lead");
  await page.goto(ws("dependencies"));
  const add = async (description: string, from: string, to: string, type: string, neededBy: string) => {
    await page.getByRole("button", { name: tr(lang, "dependencies.map.add"), exact: true }).click();
    const d = page.getByRole("dialog");
    await d.getByLabel(label(lang, "dependencies.col.dependency")).fill(description);
    await d.getByLabel(label(lang, "dependencies.form.fromInitiative")).selectOption(from);
    await d.getByLabel(label(lang, "dependencies.col.to")).selectOption(to);
    await d.getByLabel(label(lang, "dependencies.col.type")).selectOption(type);
    if (neededBy) await d.getByLabel(label(lang, "dependencies.col.neededBy")).fill(neededBy);
    await d.getByRole("button", { name: tr(lang, "dependencies.form.save"), exact: true }).click();
    return d;
  };
  // A (milestone forecast 22 Dec 2026, planned end 30 Apr 2027) is needed by B on 15 Nov 2026: a needed-by conflict.
  let d = await add("Synthetic: validated order data for billing", ini.A.id, ini.B.id, "data", "2026-11-15");
  await expect(d).toHaveCount(0);
  // B (planned end 31 Mar 2027) is needed by C on 31 May 2027: no conflict.
  d = await add("Synthetic: billing feed for the rating engine", ini.B.id, ini.C.id, "tech", "2027-05-31");
  await expect(d).toHaveCount(0);
  const table = page.getByTestId("t08");
  await expect(table.locator("tbody tr")).toHaveCount(2);
  const ab = table.locator("tbody tr", { hasText: "Synthetic: validated order data" });
  await expect(ab).toContainText(tr(lang, "roadmap.flag.schedule__needed_by_conflict"));
  await milestoneShot(page, lang, "p3-journey-15-needed-by-flag");

  d = await add("Synthetic: rating rules feed order validation", ini.C.id, ini.A.id, "decision", "2027-01-31");
  const alert = d.getByRole("alert");
  const path = `${ini.C.code} → ${ini.A.code} → ${ini.B.code} → ${ini.C.code}`;
  await expect(alert).toContainText(path);
  await expect(alert).toContainText(tr(lang, "dependencies.problem.dependency__cycle", { path: "" }).split(":")[0]!);
  await alert.scrollIntoViewIfNeeded();
  await milestoneShot(page, lang, "p3-journey-16-cycle-refused");
  await d.getByRole("button", { name: tr(lang, "common.action.cancel"), exact: true }).click();
  await expect(table.locator("tbody tr")).toHaveCount(2);

  // The flagged dependency gets a status and a mitigation (B is not in G4's scope; recorded for the story).
  const code = (await ab.getAttribute("data-dependency"))!;
  await ab.getByRole("button", { name: startsWith(lang, "dependencies.map.edit", { code }) }).click();
  d = page.getByRole("dialog");
  await d.getByLabel(label(lang, "dependencies.form.status")).selectOption("at_risk");
  await d
    .getByLabel(label(lang, "dependencies.form.mitigation"))
    .fill("Synthetic: B starts on a manual extract until A's pilot is live");
  await d.getByRole("button", { name: tr(lang, "dependencies.form.save"), exact: true }).click();
  await expect(d).toHaveCount(0);
  await expect(ab).toContainText("Synthetic: B starts on a manual extract");
  await milestoneShot(page, lang, "p3-journey-17-mitigated");
  expect(foreign).toEqual([]);
});

// ------------------------------------------------------------------------------------------------ 4. business case

/** Fills every section field of the case on its screen (text, the three owners, one decision ask) and saves. */
async function fillSections(page: Page, lang: Lang, financeId: string) {
  const sections = region(page, lang, "businessCases.sections.title");
  await expect(sections.locator("fieldset[data-section]")).toHaveCount(10);
  const areas = sections.locator("fieldset[data-section] textarea");
  const n = await areas.count();
  for (let k = 0; k < n; k++) {
    const area = areas.nth(k);
    if ((await area.inputValue()) === "") await area.fill(`Synthetic section text ${k + 1}`);
  }
  for (const [f, id] of [
    ["benefitOwnerUserId", "01920000-0000-7000-9000-000000000203"],
    ["initiativeOwnerUserId", "01920000-0000-7000-9000-000000000203"],
    ["financeValidatorUserId", financeId],
  ] as const)
    await sections.getByLabel(label(lang, `businessCases.sectionField.${f}`)).selectOption(id);
  await sections.locator("fieldset[data-section='decision_ask'] input[type='checkbox']").first().check();
  await sections.getByRole("button", { name: tr(lang, "businessCases.sections.save"), exact: true }).click();
  await expect(sections.locator("[data-state='saved']")).toBeVisible();
}

async function addLine(
  page: Page,
  lang: Lang,
  kind: "investment" | "benefit",
  cls: string,
  title: string,
  amount: string,
  formula?: string,
) {
  await page.getByRole("button", { name: tr(lang, `businessCases.line.add.${kind}`), exact: true }).click();
  const line = page.getByRole("dialog");
  await line.getByLabel(label(lang, "businessCases.line.class")).selectOption(cls);
  await line.getByLabel(label(lang, "businessCases.line.title")).fill(title);
  await line
    .getByLabel(new RegExp(`^${escape(tr(lang, "businessCases.line.amountIn", { currency: "SAR" }))}`))
    .fill(amount);
  if (formula) await line.getByLabel(label(lang, "businessCases.line.benefitFormulaId")).selectOption(formula);
  return line;
}

test("4a. T09: the revenue example previews 100000 SAR; instantiated; monthly ARPU with an annual population is refused", async ({
  page,
}, info) => {
  const lang = langOf(info);
  const foreign = trackRequests(page);
  await signIn(page, lang, "dev.lead");
  await page.goto(ws("benefit-formulas"));
  const revenue = page.locator("[data-example='revenue_uplift']");
  await expect(revenue).toContainText(tr(lang, "benefitFormulas.illustrative"));
  await expect(revenue.locator("[data-example-preview]")).toHaveAttribute("data-example-preview", "100000");
  await expect(revenue.locator("[data-example-preview]")).toContainText(money(lang, "100,000.00"));
  await milestoneShot(page, lang, "p3-journey-18-t09-example-100000");
  await revenue.getByRole("button", { name: startsWith(lang, "benefitFormulas.examples.instantiate") }).click();
  await page.waitForURL(new RegExp(`/transformations/${tid}/benefit-formulas/[0-9a-f-]{36}$`));
  formulaId = page.url().split("/").pop()!;

  const sent: string[] = [];
  page.on("request", (req) => {
    if (req.method() !== "GET") sent.push(`${req.method()} ${new URL(req.url()).pathname}`);
  });
  const builder = page.locator("[data-formula-builder]");
  const live = builder.locator("[data-live-check]");
  const arpu = builder.locator("[data-variable='arpu']");
  await arpu.getByLabel(tr(lang, "benefitFormulas.variables.period"), { exact: true }).selectOption("month");
  await expect(live.locator("[data-error-code='formula.period_mismatch']")).toBeVisible();
  await expect(live).toContainText(
    tr(lang, "benefitFormulas.engine.periodMismatch", {
      left: "arpu",
      leftPeriod: tr(lang, "benefitFormulas.periodUnit.month"),
      right: "eligible_customers",
      rightPeriod: tr(lang, "benefitFormulas.periodUnit.year"),
      convertTo: "year",
    }),
  );
  await builder
    .getByLabel(tr(lang, "benefitFormulas.builder.changeNote"), { exact: true })
    .fill("Synthetic: monthly ARPU");
  await builder.getByRole("button", { name: tr(lang, "benefitFormulas.builder.save"), exact: true }).click();
  // Refused before anything is sent: no new version.
  await expect(page.locator("[data-state='version-saved']")).toHaveCount(0);
  expect(sent).toEqual([]);
  await milestoneShot(page, lang, "p3-journey-19-t09-period-mismatch");
  await arpu.getByLabel(tr(lang, "benefitFormulas.variables.period"), { exact: true }).selectOption("year");
  await expect(live.locator("[data-check='valid']")).toBeVisible();

  // The cost-reduction example (500000 SAR) backs the initiative case's benefit line: one formula, one line.
  await page.goto(ws("benefit-formulas"));
  const cost = page.locator("[data-example='cost_reduction']");
  await expect(cost.locator("[data-example-preview]")).toHaveAttribute("data-example-preview", "500000");
  await cost.getByRole("button", { name: startsWith(lang, "benefitFormulas.examples.instantiate") }).click();
  await page.waitForURL(new RegExp(`/transformations/${tid}/benefit-formulas/(?!${formulaId})[0-9a-f-]{36}$`));
  formula2Id = page.url().split("/").pop()!;
  expect(foreign).toEqual([]);
});

test("4b. business case: ten sections, one class per line, an initiative case rolled up once", async ({
  page,
}, info) => {
  const lang = langOf(info);
  const foreign = trackRequests(page);
  await signIn(page, lang, "dev.lead");
  await page.goto(ws("business-cases"));
  await page.getByRole("button", { name: tr(lang, "businessCases.create.action"), exact: true }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel(label(lang, "businessCases.field.title")).fill("Synthetic retail transformation case");
  await dialog.getByRole("button", { name: tr(lang, "common.action.create"), exact: true }).click();
  await page.waitForURL(new RegExp(`/transformations/${tid}/business-cases/[0-9a-f-]{36}$`));
  tCaseId = page.url().split("/").pop()!;
  await fillSections(page, lang, fin.id);
  let line = await addLine(page, lang, "investment", "capex", "Synthetic validation platform licence", "1250000");
  await line.getByRole("button", { name: tr(lang, "common.action.create"), exact: true }).click();
  await expect(line).toHaveCount(0);
  line = await addLine(page, lang, "benefit", "revenue", "Synthetic attach-rate uplift", "3000000", formulaId);
  await line.getByRole("button", { name: tr(lang, "common.action.create"), exact: true }).click();
  await expect(line).toHaveCount(0);

  // The initiative case of A, a lighter linked case with its own two lines.
  await page.goto(ws("business-cases"));
  await page.getByRole("button", { name: tr(lang, "businessCases.create.action"), exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByRole("radio", { name: tr(lang, "businessCases.level.initiative") }).check();
  await dialog.getByLabel(label(lang, "businessCases.field.initiative")).selectOption(ini.A.id);
  await dialog.getByLabel(label(lang, "businessCases.field.title")).fill("Synthetic order validation case");
  await dialog.getByRole("button", { name: tr(lang, "common.action.create"), exact: true }).click();
  await page.waitForURL(new RegExp(`/transformations/${tid}/business-cases/[0-9a-f-]{36}$`));
  iCaseId = page.url().split("/").pop()!;
  expect(iCaseId).not.toBe(tCaseId);
  await fillSections(page, lang, fin.id);
  line = await addLine(page, lang, "investment", "opex", "Synthetic validation team run cost", "400000");
  await line.getByRole("button", { name: tr(lang, "common.action.create"), exact: true }).click();
  await expect(line).toHaveCount(0);
  line = await addLine(page, lang, "benefit", "cost_reduction", "Synthetic rework cost avoided", "500000", formula2Id);
  await line.getByRole("button", { name: tr(lang, "common.action.create"), exact: true }).click();
  await expect(line).toHaveCount(0);
  for (const cls of ["opex", "cost_reduction"])
    await expect(page.locator(`[data-class='${cls}']`).first()).toHaveText(tr(lang, `businessCases.class.${cls}`));
  await milestoneShot(page, lang, "p3-journey-20-initiative-case");

  // The transformation case rolls the initiative case up by reference: each line once.
  await page.goto(ws(`business-cases/${tCaseId}`));
  const sections = region(page, lang, "businessCases.sections.title");
  await expect(sections.locator("fieldset[data-section]")).toHaveCount(10);
  await expect(page.locator("[data-roll-up='2']")).toContainText(tr(lang, "businessCases.totals.rollUp", { count: 1 }));
  const totals = page.locator("[data-totals]");
  await expect(totals.locator("[data-total='gross'] [data-amount]").first()).toContainText(money(lang, "3,500,000.00"));
  await expect(totals.locator("[data-total='cost'] [data-amount]").first()).toContainText(money(lang, "1,650,000.00"));
  await expect(totals.locator("[data-total='net'] [data-amount]")).toContainText(money(lang, "1,850,000.00"));
  for (const cls of ["capex", "revenue"])
    await expect(page.locator(`[data-class='${cls}']`).first()).toHaveText(tr(lang, `businessCases.class.${cls}`));
  await milestoneShot(page, lang, "p3-journey-21-transformation-case-roll-up");
  expect(foreign).toEqual([]);
});

test("4c. Finance validates both baselines and formula version 1 (business approval); the author is not offered it and is refused", async ({
  page,
  browser,
  playwright,
}, info) => {
  const lang = langOf(info);
  // The author (the lead) first: no validation control, and the API refuses (403).
  await signIn(page, lang, "dev.lead");
  await page.goto(ws(`benefit-formulas/${formulaId}`));
  const authorRow = page.locator("[data-version='1']");
  await expect(authorRow).toBeVisible();
  await expect(
    authorRow.getByRole("button", { name: startsWith(lang, "benefitFormulas.versions.validate") }),
  ).toHaveCount(0);
  const lead = await apiSession(playwright, "dev.lead");
  await lead.call(
    "POST",
    `/api/v1/benefit-formulas/${formulaId}/versions/1/validation`,
    { result: "validated", note: "Synthetic self-validation attempt" },
    { expect: 403 },
  );

  const finance = await asUser(browser, lang, fin.username);
  const foreign = trackRequests(finance.page);
  for (const [id, name] of [
    [tCaseId, "p3-journey-22-finance-validates-case"],
    [iCaseId, ""],
  ] as const) {
    await finance.page.goto(ws(`business-cases/${id}`));
    const box = region(finance.page, lang, "businessCases.finance.title");
    await box.getByRole("button", { name: tr(lang, "businessCases.finance.action"), exact: true }).click();
    const dialog = finance.page.getByRole("dialog");
    await dialog.getByRole("radio", { name: tr(lang, "businessCases.finance.choice.validated"), exact: true }).check();
    await dialog.getByLabel(label(lang, "businessCases.finance.note")).fill("Synthetic Finance check of the baseline");
    if (name) await milestoneShot(finance.page, lang, name);
    await dialog.getByRole("button", { name: tr(lang, "businessCases.finance.confirm"), exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(box.locator("[data-finance-validation='validated']")).toContainText(
      tr(lang, "businessCases.finance.state.validated"),
    );
  }
  for (const id of [formula2Id, formulaId]) {
    await finance.page.goto(ws(`benefit-formulas/${id}`));
    const row = finance.page.locator("[data-version='1']");
    await row.getByRole("button", { name: startsWith(lang, "benefitFormulas.versions.validate") }).click();
    const dialog = finance.page.getByRole("dialog");
    await dialog.getByRole("radio", { name: tr(lang, "businessCases.finance.choice.validated"), exact: true }).check();
    await dialog
      .getByLabel(label(lang, "businessCases.finance.note"))
      .fill("Synthetic Finance check of the benefit logic");
    await dialog.getByRole("button", { name: tr(lang, "businessCases.finance.confirm"), exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(row.locator("[data-finance-validation='validated']")).toContainText(
      tr(lang, "businessCases.finance.state.validated"),
    );
  }
  await milestoneShot(finance.page, lang, "p3-journey-23-finance-validates-formula");
  expect(foreign).toEqual([]);
  await finance.close();
});

// ------------------------------------------------------------------------------------------------ 5. capacity, funding

test("5a. capacity: the owner records a role and capacity; the lead's demand above it is flagged; the owner raises capacity and commits", async ({
  page,
  browser,
}, info) => {
  const lang = langOf(info);
  const owner = await asUser(browser, lang, "dev.office");
  const foreign = trackRequests(owner.page);
  const op = owner.page;
  await op.goto(ws("capacity"));
  await op
    .locator("section#roles")
    .getByRole("button", { name: startsWith(lang, "capacity.roles.add") })
    .click();
  let dialog = op.getByRole("dialog");
  await dialog.getByLabel(label(lang, "capacity.roles.code")).fill("order_analyst");
  await dialog.getByLabel(label(lang, "capacity.roles.labelEn")).fill("Order analyst (synthetic)");
  await dialog.getByLabel(label(lang, "capacity.roles.labelAr")).fill("محلل طلبات (تجريبي)");
  await dialog.getByRole("button", { name: tr(lang, "capacity.roles.add"), exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const roleLabel = lang === "ar" ? "محلل طلبات (تجريبي)" : "Order analyst (synthetic)";
  await op
    .locator("section#capacity-rows")
    .getByRole("button", { name: startsWith(lang, "capacity.rows.add") })
    .click();
  dialog = op.getByRole("dialog");
  await dialog.getByLabel(label(lang, "capacity.grid.role")).selectOption({ label: roleLabel });
  await dialog.getByLabel(label(lang, "capacity.demands.month")).selectOption("2026-12-01");
  await dialog.getByLabel(label(lang, "capacity.edit.availableFte")).fill("1.00");
  await dialog.getByRole("button", { name: tr(lang, "capacity.rows.add"), exact: true }).click();
  await expect(dialog).toHaveCount(0);

  // The lead adds A's demand: 2.50 FTE against 1.00 available.
  await signIn(page, lang, "dev.lead");
  await page.goto(ws("capacity"));
  await page
    .locator("section#demands")
    .getByRole("button", { name: startsWith(lang, "capacity.demands.add") })
    .click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel(label(lang, "capacity.demands.initiative")).selectOption(ini.A.id);
  await dialog.getByLabel(label(lang, "capacity.grid.role")).selectOption({ label: roleLabel });
  await dialog.getByLabel(label(lang, "capacity.demands.month")).selectOption("2026-12-01");
  await dialog.getByLabel(label(lang, "capacity.edit.demandFte")).fill("2.50");
  await dialog.getByRole("button", { name: tr(lang, "capacity.demands.add"), exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const cell = page.getByTestId("capacity-grid").locator("[data-month='2026-12-01']");
  await expect(cell).toHaveAttribute("data-flag", "capacity.over_allocated");
  await expect(cell.getByTestId("shortfall")).toContainText(tr(lang, "capacity.grid.shortfall", { fte: "1.5" }));
  await milestoneShot(page, lang, "p3-journey-24-capacity-conflict");
  // The lead cannot commit: that is the capacity owner's.
  await expect(page.getByRole("button", { name: tr(lang, "capacity.demands.commit"), exact: true })).toHaveCount(0);

  // The owner raises December to 3.00 FTE and commits the demand.
  await op.reload();
  const row = op.getByTestId("capacity-rows").locator("[data-capacity-row='2026-12-01']");
  await row.getByRole("button", { name: startsWith(lang, "capacity.edit.edit") }).click();
  dialog = op.getByRole("dialog");
  await dialog.getByLabel(label(lang, "capacity.edit.availableFte")).fill("3.00");
  await dialog.getByRole("button", { name: tr(lang, "common.action.save"), exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const ownerCell = op.getByTestId("capacity-grid").locator("[data-month='2026-12-01']");
  await expect(ownerCell).not.toHaveAttribute("data-flag", "capacity.over_allocated");
  const table = op.getByTestId("demands");
  await table
    .locator("tr[data-demand-status='planned']")
    .first()
    .getByRole("button", { name: tr(lang, "capacity.demands.commit"), exact: true })
    .click();
  await expect(table.locator("tr[data-demand-status='committed']")).toHaveCount(1);
  await milestoneShot(op, lang, "p3-journey-25-capacity-committed");
  expect(foreign).toEqual([]);
  await owner.close();
});

test("5b. funding: Finance records an approved funding decision (business approval); A shows Funded", async ({
  browser,
}, info) => {
  const lang = langOf(info);
  const finance = await asUser(browser, lang, fin.username);
  const page = finance.page;
  const foreign = trackRequests(page);
  await page.goto(ws(`initiatives/${ini.A.id}`));
  await expect(page.locator("[data-funding='unfunded']").first()).toContainText(
    tr(lang, "portfolio.funding.selectedUnfunded"),
  );
  await page.getByRole("button", { name: startsWith(lang, "portfolio.fundingDecision.record") }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText(tr(lang, "portfolio.businessApproval"));
  await dialog.getByLabel(label(lang, "portfolio.fundingDecision.amount")).fill("1650000");
  await dialog
    .getByLabel(label(lang, "portfolio.fundingDecision.fundingSource"))
    .fill("Synthetic transformation budget");
  await dialog
    .getByLabel(label(lang, "portfolio.fundingDecision.rationale"))
    .fill("Synthetic demo funding approval (approves nothing real)");
  await milestoneShot(page, lang, "p3-journey-26-funding-dialog");
  await dialog.getByRole("button", { name: tr(lang, "portfolio.fundingDecision.confirm"), exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator("[data-funding='funded']").first()).toContainText(tr(lang, "portfolio.funding.funded"));
  await milestoneShot(page, lang, "p3-journey-27-funded");
  expect(foreign).toEqual([]);
  await finance.close();
});

// ------------------------------------------------------------------------------------------------ 1d. launch sequencing

test("1d. sequencing (End-to-End): launching the funded A before G2/G3 is refused; after G2 and G3 it launches", async ({
  page,
  playwright,
}, info) => {
  const lang = langOf(info);
  const foreign = trackRequests(page);
  await signIn(page, lang, "dev.lead");
  await page.goto(ws(`initiatives/${ini.A.id}`));
  let dialog = await transition(page, lang, "launch", "Synthetic launch attempt before G2/G3");
  const alert = dialog.getByRole("alert");
  await expect(alert).toHaveAttribute("data-problem", "initiative.direction_not_approved");
  await expect(alert).toContainText(tr(lang, "portfolio.problem.initiative__direction_not_approved"));
  if (lang === "en") await expect(alert).toContainText("North Star, outcomes and target state not yet approved");
  await milestoneShot(page, lang, "p3-journey-28-launch-before-g2-g3");
  await dialog.getByRole("button", { name: tr(lang, "common.action.cancel"), exact: true }).click();

  // G2 and G3 (P2 setup through the API; their screens are covered by p2-journeys.spec.ts), decided by the Sponsor.
  const lead = await apiSession(playwright, "dev.lead");
  const sponsor = await apiSession(playwright, sp.username);
  await g2Records(T(), lead, sponsor, define.outcomeKpiId);
  await submitAndApprove(T(), "G2", lead, sponsor);
  const { tomGapId } = await g3Records(T(), lead);
  await submitAndApprove(T(), "G3", lead, sponsor);

  // A addresses the T03 gap (problem / gap addressed), linked on the card.
  await page.reload();
  await page.getByRole("button", { name: tr(lang, "portfolio.gap.add") }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel(label(lang, "portfolio.gap.field.type")).selectOption("tom_gap");
  await dialog.getByLabel(label(lang, "portfolio.gap.field.target")).selectOption(tomGapId);
  await dialog.getByRole("button", { name: tr(lang, "portfolio.gap.add"), exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator("[data-gap-link='tom_gap']")).toBeVisible();

  dialog = await transition(page, lang, "launch", "Synthetic launch after G2 and G3");
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(`[data-initiative='${ini.A.id}']`)).toHaveAttribute("data-status", "launched");
  await expect(page.locator("main#main .page-header__subtitle")).toContainText(
    tr(lang, "transformations.phase.mobilize"),
  );
  await milestoneShot(page, lang, "p3-journey-29-launched");
  expect(foreign).toEqual([]);
});

// ------------------------------------------------------------------------------------------------ 6. G4

test("6a. G4: the lead's submission is refused listing 'Owners', 'Finance validation' and the initiative (translated)", async ({
  page,
  playwright,
}, info) => {
  const lang = langOf(info);
  const foreign = trackRequests(page);
  await signIn(page, lang, "dev.lead");
  await page.goto(ws("gates/G4"));
  await expect(page.locator("main#main h1")).toHaveText(exactly(tr(lang, "gates.gateTitle", { code: "G4" })));
  const incomplete = await page
    .locator("[data-criterion][data-completeness='incomplete']")
    .evaluateAll((els) => els.map((e) => `${e.getAttribute("data-criterion")}: ${(e.textContent ?? "").trim()}`));
  expect(incomplete, "G4 readiness before the concurrent changes").toEqual([]);
  await expect(page.locator("[data-criterion]")).toHaveCount(8);
  await milestoneShot(page, lang, "p3-journey-30-g4-ready");
  await page.getByRole("button", { name: tr(lang, "gates.submit.action"), exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel(label(lang, "gates.submit.note"))
    .fill("Synthetic G4 submission: the portfolio is executable");

  // Meanwhile, in another session: A's workstream lead is cleared and the initiative case's baseline is edited
  // (its Finance validation becomes Stale). The open dialog does not know.
  const lead = await apiSession(playwright, "dev.lead");
  const a = await lead.call<{ version: number }>("GET", `/api/v1/initiatives/${ini.A.id}`);
  await lead.call("PATCH", `/api/v1/initiatives/${ini.A.id}`, { workstreamLeadUserId: null }, { ifMatch: a.version });
  const kase = await lead.call<{ version: number }>("GET", `/api/v1/business-cases/${iCaseId}`);
  await lead.call(
    "PATCH",
    `/api/v1/business-cases/${iCaseId}`,
    { sections: { baselineSummary: "Synthetic baseline: 2.1M retail orders a year" } },
    { ifMatch: kase.version },
  );

  await dialog.getByRole("button", { name: tr(lang, "gates.submit.confirm"), exact: true }).click();
  const alert = dialog.getByRole("alert");
  await expect(alert).toHaveAttribute("data-problem", "gate_criteria_incomplete");
  const owners = alert.locator("[data-missing='g4.owner_missing']");
  await expect(owners).toContainText(tr(lang, "gates.missingItems.g4__owner_missing"));
  await expect(owners).toContainText(`${ini.A.code} ${ini.A.name}`);
  const finance = alert.locator("[data-missing='g4.finance_validation_missing']");
  await expect(finance).toContainText(tr(lang, "gates.missingItems.g4__finance_validation_missing"));
  if (lang === "en") {
    await expect(owners).toContainText("Owners");
    await expect(finance).toContainText("Finance validation");
  } else {
    await expect(owners).not.toContainText("Owners");
    await expect(finance).not.toContainText("Finance validation");
  }
  await expect(alert.locator("[data-missing]")).toHaveCount(2);
  await milestoneShot(page, lang, "p3-journey-31-g4-refused");
  await dialog.getByRole("button", { name: tr(lang, "common.action.cancel"), exact: true }).click();

  // The live readiness says the same, and submission is blocked until they are fixed.
  await page.reload();
  const ownersRow = page.locator("[data-criterion='g4.owners']");
  await expect(ownersRow).toHaveAttribute("data-completeness", "incomplete");
  await expect(ownersRow.locator("[data-missing='g4.owner_missing']")).toContainText(`${ini.A.code} ${ini.A.name}`);
  await expect(page.locator("[data-criterion='g4.finance_validation']")).toHaveAttribute(
    "data-completeness",
    "incomplete",
  );
  await expect(page.locator("[data-submit-blocked='true']")).toBeDisabled();
  await milestoneShot(page, lang, "p3-journey-32-g4-readiness-missing");
  expect(foreign).toEqual([]);
});

test("6b. G4: the lead restores the owner, Finance re-validates the case, the lead resubmits; 403 for a non-approver and the submitter", async ({
  page,
  browser,
  playwright,
}, info) => {
  const lang = langOf(info);
  const foreign = trackRequests(page);
  await signIn(page, lang, "dev.lead");
  await page.goto(ws(`initiatives/${ini.A.id}`));
  await page.getByRole("button", { name: tr(lang, "portfolio.card.edit") }).click();
  let dialog = page.getByRole("dialog");
  await dialog
    .getByLabel(label(lang, "portfolio.t05.workstreamLead"))
    .selectOption("01920000-0000-7000-9000-000000000203");
  await dialog.getByRole("button", { name: tr(lang, "common.action.save"), exact: true }).click();
  await expect(dialog).toHaveCount(0);

  const finance = await asUser(browser, lang, fin.username);
  await finance.page.goto(ws(`business-cases/${iCaseId}`));
  const box = region(finance.page, lang, "businessCases.finance.title");
  await expect(box.locator("[data-finance-validation='stale']")).toContainText(
    tr(lang, "businessCases.finance.state.stale"),
  );
  await box.getByRole("button", { name: tr(lang, "businessCases.finance.action"), exact: true }).click();
  dialog = finance.page.getByRole("dialog");
  await dialog.getByRole("radio", { name: tr(lang, "businessCases.finance.choice.validated"), exact: true }).check();
  await dialog
    .getByLabel(label(lang, "businessCases.finance.note"))
    .fill("Synthetic Finance re-check of the new baseline");
  await dialog.getByRole("button", { name: tr(lang, "businessCases.finance.confirm"), exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(box.locator("[data-finance-validation='validated']")).toBeVisible();

  await page.goto(ws("gates/G4"));
  await expect(page.locator("[data-criterion][data-completeness='incomplete']")).toHaveCount(0);
  await page.getByRole("button", { name: tr(lang, "gates.submit.action"), exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel(label(lang, "gates.submit.note")).fill("Synthetic G4 resubmission after the fixes");
  await dialog.getByRole("button", { name: tr(lang, "gates.submit.confirm"), exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator("[data-gate-status='submitted']").first()).toBeVisible();
  // The submitter is not offered the decision; neither is Finance (not the approver).
  await expect(page.getByRole("button", { name: tr(lang, "gates.decision.action"), exact: true })).toHaveCount(0);
  await milestoneShot(page, lang, "p3-journey-33-g4-submitted");
  await finance.page.goto(ws("gates/G4"));
  await expect(finance.page.locator("[data-gate-status='submitted']").first()).toBeVisible();
  await expect(finance.page.getByRole("button", { name: tr(lang, "gates.decision.action"), exact: true })).toHaveCount(
    0,
  );
  await finance.close();

  // The server refuses both with 403, and nothing is decided.
  const body = { submissionNo: 1, outcome: "approved", rationale: "Synthetic attempt that must be refused" };
  const finApi = await apiSession(playwright, fin.username);
  let gate = await finApi.call<{ gate: { version: number } }>("GET", `${T()}/gates/G4`);
  const nonApprover = await finApi.call<{ code: string }>("POST", `${T()}/gates/G4/decision`, body, {
    ifMatch: gate.gate.version,
    expect: 403,
  });
  expect(nonApprover.code).toBe("gate.not_approver");
  const lead = await apiSession(playwright, "dev.lead");
  gate = await lead.call<{ gate: { version: number } }>("GET", `${T()}/gates/G4`);
  const submitter = await lead.call<{ code: string }>("POST", `${T()}/gates/G4/decision`, body, {
    ifMatch: gate.gate.version,
    expect: 403,
  });
  // TL holds no gate.decide in the seeded catalogue, so the approver check refuses first.
  expect(submitter.code).toBe("gate.not_approver");

  // Separation of duties itself (gate.submitter_cannot_decide) needs a submitter who IS an approver. A separate
  // SYNTHETIC user holding both TL and SP on this transformation (used only for this refused decision) resubmits
  // (#2 supersedes #1) and tries to decide its own submission: 403, nothing decided.
  const admin = await apiSession(playwright, "dev.admin");
  const me = await admin.call<{ organization: { id: string } }>("GET", "/api/v1/me");
  const dual = await syntheticUser(
    admin,
    me.organization.id,
    tid,
    `${user(lang, "tlsp")}.${Date.now().toString(36)}`,
    `Synthetic TL and SP ${lang.toUpperCase()}`,
    "TL",
    lang,
  );
  await admin.call("POST", "/api/v1/role-assignments", {
    userId: dual.id,
    roleCode: "SP",
    scope: { type: "transformation", id: tid },
    reason: "Synthetic: a submitter who is also an approver, for the separation-of-duties check only",
  });
  const dualApi = await apiSession(playwright, dual.username);
  gate = await dualApi.call<{ gate: { version: number } }>("GET", `${T()}/gates/G4`);
  await dualApi.call(
    "POST",
    `${T()}/gates/G4/submissions`,
    { submissionNote: "Synthetic resubmission by a user who also holds SP" },
    { ifMatch: gate.gate.version },
  );
  gate = await dualApi.call<{ gate: { version: number } }>("GET", `${T()}/gates/G4`);
  const own = await dualApi.call<{ code: string }>(
    "POST",
    `${T()}/gates/G4/decision`,
    { ...body, submissionNo: 2 },
    { ifMatch: gate.gate.version, expect: 403 },
  );
  expect(own.code).toBe("gate.submitter_cannot_decide");
  const after = await lead.call<{ gate: { status: string; latestSubmissionNo: number } }>("GET", `${T()}/gates/G4`);
  expect(after.gate.status).toBe("submitted");
  expect(after.gate.latestSubmissionNo).toBe(2);
  expect(foreign).toEqual([]);
});

test("6c. G4: a decision on a superseded submission is a 409; the demo Sponsor approves the current one and the phase advances to Transform", async ({
  page,
  browser,
}, info) => {
  const lang = langOf(info);
  const sponsor = await asUser(browser, lang, sp.username);
  const sp1 = sponsor.page;
  const foreign = trackRequests(sp1);
  await sp1.goto(ws("gates/G4"));
  await sp1.getByRole("button", { name: tr(lang, "gates.decision.action"), exact: true }).click();
  const dialog = sp1.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: tr(lang, "gates.decision.title", { code: "G4", n: 2 }) }),
  ).toBeVisible();

  // Meanwhile the lead resubmits through the UI: submission 2 is superseded by 3.
  await signIn(page, lang, "dev.lead");
  await page.goto(ws("gates/G4"));
  await page.getByRole("button", { name: tr(lang, "gates.submit.action"), exact: true }).click();
  const sub = page.getByRole("dialog");
  await sub.getByLabel(label(lang, "gates.submit.note")).fill("Synthetic G4 resubmission with the latest evidence");
  await sub.getByRole("button", { name: tr(lang, "gates.submit.confirm"), exact: true }).click();
  await expect(sub).toHaveCount(0);

  await dialog.getByRole("radio", { name: tr(lang, "gates.outcome.approved"), exact: true }).check();
  await dialog
    .getByLabel(label(lang, "gates.decision.rationale"))
    .fill("Synthetic demo rationale: the portfolio is executable and value-backed.");
  await dialog.getByRole("button", { name: tr(lang, "gates.decision.confirm"), exact: true }).click();
  const conflict = dialog.locator("[data-problem='gate.submission_superseded']");
  await expect(conflict).toHaveAttribute("data-state", "conflict");
  await expect(conflict).toContainText(tr(lang, "problems.gate__submission_superseded"));
  await milestoneShot(sp1, lang, "p3-journey-34-g4-409-superseded");
  await dialog.getByRole("button", { name: tr(lang, "common.action.cancel"), exact: true }).click();

  await sp1.getByRole("button", { name: tr(lang, "gates.decision.action"), exact: true }).click();
  await expect(
    dialog.getByRole("heading", { name: tr(lang, "gates.decision.title", { code: "G4", n: 3 }) }),
  ).toBeVisible();
  // The page states it is a business approval decided by a person (BusinessApprovalNote).
  await expect(sp1.locator("main#main")).toContainText(tr(lang, "gates.businessApproval"));
  await dialog.getByRole("radio", { name: tr(lang, "gates.outcome.approved"), exact: true }).check();
  await dialog
    .getByLabel(label(lang, "gates.decision.rationale"))
    .fill("Synthetic demo rationale: the portfolio is executable and value-backed (approves nothing real).");
  await milestoneShot(sp1, lang, "p3-journey-35-g4-decision");
  await dialog.getByRole("button", { name: tr(lang, "gates.decision.confirm"), exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(sp1.locator("[data-gate-status='approved']").first()).toBeVisible();
  await expect(sp1.locator("main#main .page-header__subtitle")).toContainText(
    tr(lang, "transformations.phase.transform"),
  );
  await expect(sp1.locator("body")).not.toContainText(/\bDG[0-7]\b/);
  await milestoneShot(sp1, lang, "p3-journey-36-g4-approved-transform");
  expect(foreign).toEqual([]);
  await sponsor.close();
});

// ------------------------------------------------------------------------------------------------ 7. auditor

test("7. the read-only auditor sees every P3 screen with the journey's data and no enabled write control; sends nothing", async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  const lang = langOf(info);
  const foreign = trackRequests(page);
  await signIn(page, lang, "dev.auditor");
  const sent: string[] = [];
  page.on("request", (req) => {
    if (!["GET", "HEAD"].includes(req.method()) && !req.url().includes("/me/preferences"))
      sent.push(`${req.method()} ${new URL(req.url()).pathname}`);
  });
  const screens: [string, string, string][] = [
    ["portfolio", "main#main tbody tr", "p3-journey-37-aud-portfolio"],
    [`initiatives/${ini.A.id}`, "[data-t05='14']", "p3-journey-38-aud-card"],
    ["readiness", "tr[data-gate='G4'][data-gate-status='approved']", "p3-journey-39-aud-readiness"],
    ["dispensations", "main#main h1", "p3-journey-40-aud-dispensations"],
    ["prioritization", "[data-testid='ranking-history']", "p3-journey-41-aud-prioritization"],
    ["roadmap", "[data-testid='timeline-milestones']", "p3-journey-42-aud-roadmap"],
    ["dependencies", "[data-testid='t08'] tbody tr", "p3-journey-43-aud-dependencies"],
    ["capacity", "[data-testid='capacity-grid']", "p3-journey-44-aud-capacity"],
    ["business-cases", "main#main tbody tr", "p3-journey-45-aud-business-cases"],
    [`business-cases/${tCaseId}`, "[data-totals]", "p3-journey-46-aud-business-case"],
    ["benefit-formulas", "main#main tbody tr", "p3-journey-47-aud-benefit-formulas"],
    [`benefit-formulas/${formulaId}`, "[data-version='1']", "p3-journey-48-aud-benefit-formula"],
    ["gates/G4", "[data-criterion]", "p3-journey-49-aud-g4"],
  ];
  for (const [path, ready, name] of screens) {
    await page.goto(ws(path));
    await expect(page.locator(ready).first()).toBeVisible();
    await expect(page.locator("[data-state='loading']")).toHaveCount(0);
    await expect(page.locator("[data-state='read-only']").first()).toBeVisible();
    await expect(page.locator("main#main [data-transition]")).toHaveCount(0);
    await expectNoWriteControl(page, lang);
    await milestoneShot(page, lang, name);
  }
  await expect(page.locator("[data-gate-status='approved']").first()).toBeVisible();
  expect(sent).toEqual([]);
  expect(foreign).toEqual([]);
});
