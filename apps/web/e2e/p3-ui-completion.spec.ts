// P3 UI completion on the REAL stack (support/with-stack.sh; no API mocks), in the project's language (chromium-en ->
// English LTR, chromium-ar -> Arabic RTL). T-DG3-FE-E. SYNTHETIC data only: the transformation, initiatives, scores,
// G1 submission and its demo approval, selection, funding decision, roles, capacity and demand are invented. A demo
// Sponsor / funding decision in this test approves nothing real, and product gates G1-G6 never imply any engineering
// gate (DG0-DG7).
//  - Funding (REQ-S09-003, REQ-S04-006): a demo SP records an approved funding decision on a selected initiative
//    (business approval, no on-behalf control); the card and the portfolio list show Funded; after a deselect and
//    re-selection the card shows 'Selected - unfunded' again (BE-E §7.1); a revoke on an unfunded initiative is refused
//    (422 funding.not_revocable, translated, one alert).
//  - Deliverables and milestones (REQ-PB-045, REQ-S09-006): the lead creates three deliverables and a milestone on the
//    card; the 3-7 warning clears; the roadmap's timeline, table and board show the milestone, and its deliverables
//    list shows the three.
//  - Waves (ADR-0023 §1): the lead edits a wave's planned dates (overlapping another wave's) and owner; the source text
//    is read-only.
//  - Capacity (REQ-PB-059, REQ-S09-004): the capacity owner (TO) creates a role, a capacity row and a demand above
//    capacity; the conflict indicator with its shortfall shows; a month without capacity is Unknown; a duplicate row is
//    refused (409 capacity.duplicate, translated); committing works.
//  - The transformation audit trail labels these events (nothing marked untranslated).
//  - The read-only auditor; axe (0 serious/critical) on every new dialog state.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";
import {
  DEV_USERS,
  SHOTS,
  SYN_RETAIL,
  apiSession,
  axeSummary,
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

test.afterAll(async ({}, info) => {
  const lang = langOf(info);
  mkdirSync(join(SHOTS, lang), { recursive: true });
  const mine = Object.fromEntries(Object.entries(axeSummary).filter(([k]) => k.includes("p3-completion")));
  writeFileSync(join(SHOTS, lang, "axe-summary-p3-completion.json"), `${JSON.stringify(mine, null, 2)}\n`);
});

let tid = "";
const ini: { id: string; code: string; name: string }[] = [];

const T = () => `/api/v1/transformations/${tid}`;
const ws = (path: string) => `/transformations/${tid}/${path}`;
const card = (n: number) => ws(`initiatives/${ini[n]!.id}`);
/** "Label (required)" or "Label" of a catalogue key, as an exact accessible name. */
const label = (lang: Lang, key: string) => fieldLabel(lang, key);
const button = (lang: Lang, key: string) => new RegExp(`^\\s*${escape(tr(lang, key))}`);

async function asUser(
  browser: Browser,
  lang: Lang,
  username: string,
): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext({ locale: lang === "ar" ? "ar-SA" : "en-US", timezoneId: "Asia/Riyadh" });
  const page = await context.newPage();
  await signIn(page, lang, username);
  return { page, close: () => context.close() };
}

/** G1 complete through the real API (synthetic records only; the same steps as p3-prioritization-roadmap.spec.ts). */
async function completeG1(lead: ApiSession, office: ApiSession) {
  const base = T();
  const baseline = await lead.call<{ id: string }>("POST", `${base}/baselines`, {
    metric: "Synthetic billing error rate",
    unit: "%",
    scope: "operational",
    value: "4.25",
    source: "Synthetic billing extract",
    baselineDate: "2026-09-01",
  });
  const note = await lead.call<{ id: string; version: number }>("POST", `${base}/evidence`, {
    kind: "note",
    title: "Synthetic baseline working paper",
    ownerUserId: DEV_USERS.lead,
    noteBody: "Synthetic: 4.25% of bills corrected in August.",
  });
  await lead.call("POST", `${base}/evidence-links`, {
    evidenceId: note.id,
    recordType: "baseline",
    recordId: baseline.id,
  });
  await office.call(
    "POST",
    `${base}/evidence/${note.id}/review`,
    { result: "verified", accessibilityStatus: "accessible", note: "Synthetic check" },
    { ifMatch: note.version },
  );
  const items = await lead.call<{ items: { id: string; version: number }[] }>(
    "GET",
    `${base}/diagnostic-items?limit=100`,
  );
  for (const item of items.items)
    await lead.call(
      "PATCH",
      `${base}/diagnostic-items/${item.id}`,
      {
        currentState: "Synthetic current state",
        rootCause: "Synthetic root cause",
        impactText: "Synthetic impact",
        confidence: "M",
        baselineId: baseline.id,
      },
      { ifMatch: item.version },
    );
  const methodology = await lead.call<{ diagnosticWorkstreams: { code: string }[] }>("GET", `${base}/methodology`);
  await lead.call("POST", `${base}/diagnostic-findings`, {
    workstreamCode: methodology.diagnosticWorkstreams[0]!.code,
    kind: "root_cause",
    statement: "Synthetic: no validation at order entry",
    status: "confirmed",
  });
  await lead.call("POST", `${base}/value-pools`, {
    name: "Synthetic billing leakage pool",
    quantificationStatus: "unquantified",
    unquantifiedReason: "Synthetic: not sized yet",
    materiality: "material",
  });
  await lead.call("POST", `${base}/charter`, {
    transformationName: "Synthetic UI completion charter",
    caseForChange: "Synthetic: billing errors",
    outOfScope: "Synthetic: wholesale billing",
    inScope: "Synthetic: retail consumer billing",
    executiveSponsorUserId: DEV_USERS.office,
    transformationLeadUserId: DEV_USERS.lead,
    baselineDate: "2026-09-01",
  });
  const g1 = await lead.call<{ gate: { version: number } }>("GET", `${base}/gates/G1`);
  await lead.call(
    "POST",
    `${base}/gates/G1/submissions`,
    { submissionNote: "Synthetic G1 submission" },
    { ifMatch: g1.gate.version },
  );
  const g1b = await office.call<{ gate: { version: number } }>("GET", `${base}/gates/G1`);
  await office.call(
    "POST",
    `${base}/gates/G1/decision`,
    {
      submissionNo: 1,
      outcome: "approved",
      rationale: "Synthetic demo approval for the UI completion check.",
      agreements: { problem: true, baseline: true, materialValuePools: true },
    },
    { ifMatch: g1b.gate.version },
  );
}

async function selectInitiative(office: ApiSession, n: number, rationale: string) {
  const cur = await office.call<{ version: number }>("GET", `/api/v1/initiatives/${ini[n]!.id}`);
  await office.call("POST", `/api/v1/initiatives/${ini[n]!.id}/select`, { rationale }, { ifMatch: cur.version });
}

test("setup: a synthetic transformation with G1 approved (demo), two ranked initiatives, INI-01 selected (demo SP)", async ({
  playwright,
}, info) => {
  test.setTimeout(120_000);
  const lang = langOf(info);
  const lead = await apiSession(playwright, "dev.lead");
  const office = await apiSession(playwright, "dev.office");
  const admin = await apiSession(playwright, "dev.admin");
  const created = await lead.call<{ id: string }>("POST", "/api/v1/transformations", {
    businessUnitId: SYN_RETAIL,
    name: `Synthetic P3 UI completion ${lang.toUpperCase()} check`,
    mode: "end_to_end",
  });
  tid = created.id;
  // A synthetic Executive Sponsor grant for the Transformation Office user on this transformation only (demo data):
  // SP holds portfolio.select and funding.approve; TO already holds capacity.edit and capacity.commit.
  await admin.call("POST", "/api/v1/role-assignments", {
    userId: DEV_USERS.office,
    roleCode: "SP",
    scope: { type: "transformation", id: tid },
    reason: "Synthetic demo approver for the UI completion check",
  });
  await completeG1(lead, office);
  const outcome = await lead.call<{ id: string }>("POST", `${T()}/outcomes`, {
    statement: "Synthetic: billing errors fall.",
  });
  const kpi = await lead.call<{ id: string }>("POST", `${T()}/kpi-definitions`, {
    name: "Synthetic billing error rate KPI",
    unitKind: "count",
    polarity: "lower_is_better",
  });
  const okpi = await lead.call<{ id: string }>("POST", `${T()}/outcome-kpis`, {
    outcomeId: outcome.id,
    kpiDefinitionId: kpi.id,
    targetDate: "2027-12-31",
  });
  for (let n = 0; n < 2; n++) {
    const i = await lead.call<{ id: string; code: string; name: string }>("POST", "/api/v1/initiatives", {
      transformationId: tid,
      name: `Synthetic completion initiative ${n + 1}`,
    });
    ini.push({ id: i.id, code: i.code, name: i.name });
    await lead.call("POST", `/api/v1/initiatives/${i.id}/outcome-contributions`, {
      outcomeId: outcome.id,
      outcomeKpiId: okpi.id,
      contributionStatement: "Synthetic: fewer billing errors.",
    });
    const fresh = await lead.call<{ version: number }>("GET", `/api/v1/initiatives/${i.id}`);
    await lead.call("POST", `/api/v1/initiatives/${i.id}/submit`, {}, { ifMatch: fresh.version });
    for (const [criterionCode, score] of Object.entries({
      strategic_fit: 5 - n,
      financial_value: 4,
      customer_impact: 3,
      feasibility: 3,
      time_to_value: 2,
    }))
      await lead.call("POST", `/api/v1/initiatives/${i.id}/scores`, { criterionCode, score });
  }
  await lead.call("POST", `${T()}/prioritization/rankings`, { note: "Synthetic snapshot" });
  await selectInitiative(office, 0, "Synthetic: top of the proposed ranking");
  const selected = await lead.call<{ status: string; fundingState: string }>(
    "GET",
    `/api/v1/initiatives/${ini[0]!.id}`,
  );
  expect(selected.status).toBe("selected");
  expect(selected.fundingState).not.toBe("funded");
});

test("funding: the demo SP records an approved funding decision (business approval); Funded on the card and the list; the deselect rule", async ({
  browser,
  playwright,
}, info) => {
  test.setTimeout(120_000);
  const lang = langOf(info);
  const { page, close } = await asUser(browser, lang, "dev.office");
  const foreign = trackRequests(page);
  await page.goto(card(0));
  await expect(page.locator("[data-funding='unfunded']")).toContainText(tr(lang, "portfolio.funding.selectedUnfunded"));
  const record = page.getByRole("button", { name: button(lang, "portfolio.fundingDecision.record") });
  await expect(record).toContainText(tr(lang, "portfolio.businessApproval"));
  await record.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText(tr(lang, "portfolio.businessApproval"));
  await expect(dialog).toContainText(tr(lang, "portfolio.fundingDecision.inPerson"));
  await expect(dialog.locator("[name='onBehalfOfUserId']")).toHaveCount(0);
  // The rationale is required: refused inline, nothing sent.
  await dialog.getByRole("button", { name: tr(lang, "portfolio.fundingDecision.confirm"), exact: true }).click();
  await expect(dialog.getByLabel(label(lang, "portfolio.fundingDecision.rationale"))).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await dialog.getByLabel(label(lang, "portfolio.fundingDecision.amount")).fill("1250000.50");
  await dialog
    .getByLabel(label(lang, "portfolio.fundingDecision.fundingSource"))
    .fill("Synthetic transformation budget");
  await dialog
    .getByLabel(label(lang, "portfolio.fundingDecision.rationale"))
    .fill("Synthetic: approved by the demo funding committee");
  await shot(page, lang, "p3-completion-funding-dialog");
  await expectAccessible(page, lang, "p3-completion-funding-dialog");
  await dialog.getByRole("button", { name: tr(lang, "portfolio.fundingDecision.confirm"), exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator("[data-funding='funded']").first()).toContainText(tr(lang, "portfolio.funding.funded"));
  const history = page.getByTestId("funding-history");
  await expect(history.locator("[data-funding-outcome='approved']")).toContainText(
    tr(lang, "portfolio.fundingDecision.outcome.approved"),
  );
  await expect(history.locator("[data-amount='1250000.5000']")).toContainText("SAR");
  await shot(page, lang, "p3-completion-funded");
  // The portfolio list's Funding column follows.
  await page.goto(ws("portfolio"));
  const row = page.locator("tr", { hasText: ini[0]!.code });
  await expect(row.locator("[data-funding='funded']")).toContainText(tr(lang, "portfolio.funding.funded"));
  await shot(page, lang, "p3-completion-portfolio-funded");

  // The deselect rule (BE-E §7.1): deselect and re-select through the API (demo SP); the card is unfunded again.
  const office = await apiSession(playwright, "dev.office");
  const cur = await office.call<{ version: number }>("GET", `/api/v1/initiatives/${ini[0]!.id}`);
  await office.call(
    "POST",
    `/api/v1/initiatives/${ini[0]!.id}/deselect`,
    { rationale: "Synthetic: re-plan" },
    { ifMatch: cur.version },
  );
  await selectInitiative(office, 0, "Synthetic: selected again after re-planning");
  await page.goto(card(0));
  await expect(page.locator("[data-funding='unfunded']")).toContainText(tr(lang, "portfolio.funding.selectedUnfunded"));
  await expect(page.locator("[data-state='funding-voided']")).toContainText(
    tr(lang, "portfolio.fundingDecision.voidedBySelection"),
  );
  // Revoking an unfunded initiative is refused: 422 funding.not_revocable, translated, the dialog's one alert.
  await page.getByRole("button", { name: button(lang, "portfolio.fundingDecision.record") }).click();
  const again = page.getByRole("dialog");
  await again.getByLabel(label(lang, "portfolio.fundingDecision.outcomeLabel")).selectOption("revoked");
  await again.getByLabel(label(lang, "portfolio.fundingDecision.rationale")).fill("Synthetic: try to revoke");
  await again.getByRole("button", { name: tr(lang, "portfolio.fundingDecision.confirm"), exact: true }).click();
  await expect(again.getByRole("alert")).toHaveCount(1);
  await expect(again.getByRole("alert")).toContainText(tr(lang, "portfolio.problem.funding__not_revocable"));
  await shot(page, lang, "p3-completion-funding-refused");
  await expectAccessible(page, lang, "p3-completion-funding-refused");
  await again.getByRole("button", { name: tr(lang, "common.action.cancel"), exact: true }).click();
  await shot(page, lang, "p3-completion-reselected-unfunded");
  expect(foreign).toEqual([]);
  await close();
});

test("the lead creates three deliverables and a milestone on the card; the roadmap's timeline, table and board show them", async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  const lang = langOf(info);
  await signIn(page, lang, "dev.lead");
  await page.goto(card(1));
  const deliverables = page.locator("section#deliverables");
  await expect(deliverables.locator("[data-warning='initiative.deliverable_count']")).toBeVisible();
  for (const [n, due] of [
    [1, "2026-11-30"],
    [2, "2026-12-15"],
    [3, "2027-01-31"],
  ] as const) {
    await deliverables.getByRole("button", { name: button(lang, "portfolio.deliverable.add") }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel(label(lang, "portfolio.deliverable.fieldTitle")).fill(`Synthetic deliverable ${n}`);
    await dialog.getByLabel(label(lang, "portfolio.deliverable.dueDate")).fill(due);
    if (n === 1) {
      await shot(page, lang, "p3-completion-deliverable-dialog");
      await expectAccessible(page, lang, "p3-completion-deliverable-dialog");
    }
    await dialog.getByRole("button", { name: tr(lang, "portfolio.deliverable.add"), exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(deliverables.locator(`[data-deliverable-count='${n}']`)).toBeVisible();
  }
  // Three is inside 3-7: the warning clears (it is never a block).
  await expect(deliverables.locator("[data-warning='initiative.deliverable_count']")).toHaveCount(0);
  const milestones = page.locator("section#milestones");
  await milestones.getByRole("button", { name: button(lang, "portfolio.milestone.add") }).click();
  const md = page.getByRole("dialog");
  await md.getByLabel(label(lang, "portfolio.milestone.fieldTitle")).fill("Synthetic completion go-live");
  const waveSelect = md.getByLabel(label(lang, "portfolio.field.wave"));
  await waveSelect.selectOption({ index: 2 });
  await md.getByLabel(label(lang, "portfolio.milestone.forecast")).fill("2026-12-10");
  await shot(page, lang, "p3-completion-milestone-dialog");
  await expectAccessible(page, lang, "p3-completion-milestone-dialog");
  await md.getByRole("button", { name: tr(lang, "portfolio.milestone.add"), exact: true }).click();
  await expect(md).toBeHidden();
  await expect(milestones).toContainText("Synthetic completion go-live");
  await shot(page, lang, "p3-completion-card-parts");

  await page.goto(ws("roadmap"));
  // One cache entry behind the three views: the timeline lists the milestone, and the table and the board show the
  // same forecast date as the initiative's next milestone.
  const timelineItem = page
    .getByTestId("timeline-milestones")
    .locator("li", { hasText: "Synthetic completion go-live" });
  await expect(timelineItem).toBeVisible();
  const date = ((await timelineItem.getByTestId("timeline-date").textContent()) ?? "").trim();
  expect(date).not.toBe("");
  const tableRow = page.getByTestId("roadmap-table").locator(`[data-initiative='${ini[1]!.code}']`);
  await expect(tableRow.getByTestId("table-next-milestone")).toContainText("Synthetic completion go-live");
  await expect(tableRow.getByTestId("table-next-milestone")).toContainText(date);
  const boardCard = page.getByTestId("work-board").locator(`[data-card='${ini[1]!.code}']`);
  await expect(boardCard.getByTestId("board-next-milestone")).toContainText(date);
  const roadmapDeliverables = page.locator("section#deliverables");
  for (const n of [1, 2, 3]) await expect(roadmapDeliverables).toContainText(`Synthetic deliverable ${n}`);
  await shot(page, lang, "p3-completion-roadmap");
});

test("the lead edits a wave's planned dates (overlap accepted) and owner; the source text is read-only", async ({
  page,
}, info) => {
  const lang = langOf(info);
  await signIn(page, lang, "dev.lead");
  await page.goto(ws("roadmap"));
  const waves = page.getByTestId("waves");
  const row = waves.locator("[data-wave='wave_1']");
  await row.getByRole("button", { name: button(lang, "roadmap.waves.edit") }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.locator("[data-state='wave-source']")).toContainText("Wave 1");
  await expect(dialog.locator("[name='nameEn'], [name='purposeEn']")).toHaveCount(0);
  await dialog.getByLabel(label(lang, "roadmap.waves.plannedStart")).fill("2026-11-01");
  await dialog.getByLabel(label(lang, "roadmap.waves.plannedEnd")).fill("2027-02-28");
  await dialog.getByLabel(label(lang, "roadmap.waves.owner")).selectOption(DEV_USERS.lead);
  await shot(page, lang, "p3-completion-wave-dialog");
  await expectAccessible(page, lang, "p3-completion-wave-dialog");
  await dialog.getByRole("button", { name: tr(lang, "common.action.save"), exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(row.locator("[data-planned='2026-11-01/2027-02-28']")).toBeVisible();
  // Overlap with wave 2 (also from 1 Dec 2026) is accepted.
  await waves
    .locator("[data-wave='wave_2']")
    .getByRole("button", { name: button(lang, "roadmap.waves.edit") })
    .click();
  const d2 = page.getByRole("dialog");
  await d2.getByLabel(label(lang, "roadmap.waves.plannedStart")).fill("2026-12-01");
  await d2.getByLabel(label(lang, "roadmap.waves.plannedEnd")).fill("2027-06-30");
  await d2.getByRole("button", { name: tr(lang, "common.action.save"), exact: true }).click();
  await expect(d2).toBeHidden();
  await expect(waves.locator("[data-wave='wave_2'] [data-planned='2026-12-01/2027-06-30']")).toBeVisible();
  await shot(page, lang, "p3-completion-waves");
});

test("capacity owner: a role, a capacity row and a demand above capacity; the conflict shows; Unknown stays Unknown; commit", async ({
  browser,
}, info) => {
  test.setTimeout(120_000);
  const lang = langOf(info);
  const { page, close } = await asUser(browser, lang, "dev.office");
  await page.goto(ws("capacity"));
  const roles = page.locator("section#roles");
  await roles.getByRole("button", { name: button(lang, "capacity.roles.add") }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel(label(lang, "capacity.roles.code")).fill("data_engineer");
  await dialog.getByLabel(label(lang, "capacity.roles.labelEn")).fill("Data engineer (synthetic)");
  await dialog.getByLabel(label(lang, "capacity.roles.labelAr")).fill("مهندس بيانات (تجريبي)");
  await shot(page, lang, "p3-completion-role-dialog");
  await expectAccessible(page, lang, "p3-completion-role-dialog");
  await dialog.getByRole("button", { name: tr(lang, "capacity.roles.add"), exact: true }).click();
  await expect(dialog).toBeHidden();
  const roleLabel = lang === "ar" ? "مهندس بيانات (تجريبي)" : "Data engineer (synthetic)";
  await expect(page.getByTestId("roles")).toContainText("data_engineer");

  // Capacity: 1.00 FTE in November 2026.
  const rows = page.locator("section#capacity-rows");
  const addCapacity = async () => {
    await rows.getByRole("button", { name: button(lang, "capacity.rows.add") }).click();
    const d = page.getByRole("dialog");
    await d.getByLabel(label(lang, "capacity.grid.role")).selectOption({ label: roleLabel });
    await d.getByLabel(label(lang, "capacity.demands.month")).selectOption("2026-11-01");
    await d.getByLabel(label(lang, "capacity.edit.availableFte")).fill("1.00");
    return d;
  };
  dialog = await addCapacity();
  await expectAccessible(page, lang, "p3-completion-capacity-dialog");
  await dialog.getByRole("button", { name: tr(lang, "capacity.rows.add"), exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId("capacity-rows").locator("[data-capacity-row='2026-11-01']")).toBeVisible();
  // A second row for the same role and month: 409 capacity.duplicate, translated, one alert.
  dialog = await addCapacity();
  await dialog.getByRole("button", { name: tr(lang, "capacity.rows.add"), exact: true }).click();
  await expect(dialog.getByRole("alert")).toHaveCount(1);
  await expect(dialog.getByRole("alert")).toContainText(tr(lang, "capacity.problem.capacity__duplicate"));
  await shot(page, lang, "p3-completion-capacity-duplicate");
  await expectAccessible(page, lang, "p3-completion-capacity-duplicate");
  await dialog.getByRole("button", { name: tr(lang, "common.action.cancel"), exact: true }).click();

  // Demand above capacity (2.50 > 1.00) and a month with no capacity row (Unknown).
  const demands = page.locator("section#demands");
  for (const [month, fte] of [
    ["2026-11-01", "2.50"],
    ["2026-12-01", "0.50"],
  ] as const) {
    await demands.getByRole("button", { name: button(lang, "capacity.demands.add") }).click();
    const d = page.getByRole("dialog");
    await d.getByLabel(label(lang, "capacity.demands.initiative")).selectOption(ini[0]!.id);
    await d.getByLabel(label(lang, "capacity.grid.role")).selectOption({ label: roleLabel });
    await d.getByLabel(label(lang, "capacity.demands.month")).selectOption(month);
    await d.getByLabel(label(lang, "capacity.edit.demandFte")).fill(fte);
    if (month === "2026-11-01") {
      await shot(page, lang, "p3-completion-demand-dialog");
      await expectAccessible(page, lang, "p3-completion-demand-dialog");
    }
    await d.getByRole("button", { name: tr(lang, "capacity.demands.add"), exact: true }).click();
    await expect(d).toBeHidden();
  }
  const grid = page.getByTestId("capacity-grid");
  const over = grid.locator("[data-month='2026-11-01']");
  await expect(over).toHaveAttribute("data-flag", "capacity.over_allocated");
  await expect(over.getByTestId("shortfall")).toContainText(tr(lang, "capacity.grid.shortfall", { fte: "1.5" }));
  const unknown = grid.locator("[data-month='2026-12-01']");
  await expect(unknown).toHaveAttribute("data-flag", "capacity.unknown");
  await expect(unknown.locator("[data-health='unknown']")).toContainText(tr(lang, "common.value.unknown"));
  await shot(page, lang, "p3-completion-capacity-conflict");
  // Commit the November demand (a resourcing commitment, not a business approval).
  const table = page.getByTestId("demands");
  const planned = table.locator("tr[data-demand-status='planned']").first();
  await planned.getByRole("button", { name: tr(lang, "capacity.demands.commit"), exact: true }).click();
  await expect(table.locator("tr[data-demand-status='committed']")).toHaveCount(1);
  await shot(page, lang, "p3-completion-capacity-committed");
  await expectAccessible(page, lang, "p3-completion-capacity");
  await close();
});

test("the audit trail labels the funding, role, capacity and demand events (nothing untranslated)", async ({
  page,
}, info) => {
  const lang = langOf(info);
  await signIn(page, lang, "dev.lead");
  await page.goto(`/transformations/${tid}`);
  const trail = page.getByRole("region", { name: tr(lang, "transformations.audit.title"), exact: true });
  await expect(trail).toContainText(tr(lang, "transformations.audit.actions.resource_demand_commit"));
  await expect(trail).toContainText(tr(lang, "transformations.audit.actions.resource_demand_create"));
  await expect(trail).toContainText(tr(lang, "transformations.audit.actions.capacity_create"));
  const text = (await trail.textContent()) ?? "";
  for (const raw of [
    "resource_demand.",
    "capacity.create",
    tr(lang, "transformations.audit.untranslatedField"),
    tr(lang, "transformations.audit.untranslatedValue"),
    tr(lang, "transformations.audit.untranslatedAction"),
  ])
    expect(text).not.toContain(raw);
  await trail.scrollIntoViewIfNeeded();
  await shot(page, lang, "p3-completion-audit-trail");
});

test("the read-only auditor: card, capacity and roadmap show the new data with no write control; only GETs are sent", async ({
  browser,
}, info) => {
  const lang = langOf(info);
  const { page, close } = await asUser(browser, lang, "dev.auditor");
  const writes: string[] = [];
  page.on("request", (r) => {
    if (r.method() !== "GET" && !r.url().includes("/me/preferences")) writes.push(`${r.method()} ${r.url()}`);
  });
  await page.goto(card(0));
  await expect(page.getByTestId("funding-history")).toBeVisible();
  await expect(page.getByRole("button", { name: button(lang, "portfolio.fundingDecision.record") })).toHaveCount(0);
  await page.goto(card(1));
  await expect(page.locator("[data-deliverable-count='3']")).toBeVisible();
  for (const key of ["portfolio.deliverable.add", "portfolio.milestone.add", "portfolio.deliverable.archive"])
    await expect(page.getByRole("button", { name: button(lang, key) })).toHaveCount(0);
  await shot(page, lang, "p3-completion-aud-card");
  await page.goto(ws("capacity"));
  await expect(page.getByTestId("roles")).toContainText("data_engineer");
  for (const key of ["capacity.roles.add", "capacity.rows.add", "capacity.demands.add", "capacity.edit.edit"])
    await expect(page.getByRole("button", { name: button(lang, key) })).toHaveCount(0);
  await shot(page, lang, "p3-completion-aud-capacity");
  await expectAccessible(page, lang, "p3-completion-aud-capacity");
  await page.goto(ws("roadmap"));
  await expect(page.getByTestId("waves")).toBeVisible();
  for (const key of ["roadmap.waves.add", "roadmap.waves.edit"])
    await expect(page.getByRole("button", { name: button(lang, key) })).toHaveCount(0);
  await shot(page, lang, "p3-completion-aud-roadmap");
  expect(writes).toEqual([]);
  await close();
});
