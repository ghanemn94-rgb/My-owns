// P3 prioritization, roadmap and dependencies on the REAL stack (support/with-stack.sh; no API mocks), in the
// project's language (chromium-en -> English LTR, chromium-ar -> Arabic RTL). T-DG3-FE-B. SYNTHETIC data only: the
// transformation, initiatives, scores, G1 submission and its demo approval are invented. A demo Sponsor decision in this
// test approves nothing real, and product gates G1-G6 never imply any engineering gate.
//  - Prioritization: 3.30 and 'incomplete'; the 0-100 view (57.5) with its label; a score of 6 refused inline; the live
//    100% check (95% refused); weight version 2 proposed by the lead and approved by another person (business approval);
//    ranking history with 'weight version 2'; an override with a reason, decided by another person.
//  - Roadmap: the four source waves; moving a milestone updates the timeline, the initiative table and the work board;
//    a stale edit answers 409 and shows the conflict notice.
//  - Dependencies: the seven T08 columns, the needed-by flag, and a cycle refused with its path.
//  - The read-only auditor; axe on every screen (0 serious/critical).
//  - Capacity: BE-E's API is not in this tree yet, so its screen is shown with STUBBED responses (page.route) only for the
//    screenshot and axe; its live e2e is the next wave.
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
  const mine = Object.fromEntries(Object.entries(axeSummary).filter(([k]) => k.includes("p3-prioritization")));
  writeFileSync(join(SHOTS, lang, "axe-summary-p3-prioritization.json"), `${JSON.stringify(mine, null, 2)}\n`);
});

let tid = "";
const ini: { id: string; code: string }[] = [];
let milestoneId = "";

const T = () => `/api/v1/transformations/${tid}`;
const ws = (path: string) => `/transformations/${tid}/${path}`;

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

/** Makes G1 complete through the real API (synthetic records only; the same steps as p2-blank-text.spec.ts). */
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
  // The charter as in p2-blank-text.spec.ts (created there through the UI; here through the API).
  await lead.call("POST", `${base}/charter`, {
    transformationName: "Synthetic prioritization charter",
    caseForChange: "Synthetic: billing errors",
    outOfScope: "Synthetic: wholesale billing",
    inScope: "Synthetic: retail consumer billing",
    executiveSponsorUserId: DEV_USERS.office,
    transformationLeadUserId: DEV_USERS.lead,
    baselineDate: "2026-09-01",
  });
}

test("setup: a synthetic transformation with G1 approved (demo), three submitted initiatives, scores, a milestone and dependencies", async ({
  playwright,
}, info) => {
  test.setTimeout(120_000);
  const lang = langOf(info);
  const lead = await apiSession(playwright, "dev.lead");
  const office = await apiSession(playwright, "dev.office");
  const admin = await apiSession(playwright, "dev.admin");
  const created = await lead.call<{ id: string }>("POST", "/api/v1/transformations", {
    businessUnitId: SYN_RETAIL,
    name: `Synthetic P3 prioritization ${lang.toUpperCase()} check`,
    mode: "end_to_end",
  });
  tid = created.id;
  // A synthetic Executive Sponsor grant for the Transformation Office user on this transformation only (demo data).
  await admin.call("POST", "/api/v1/role-assignments", {
    userId: DEV_USERS.office,
    roleCode: "SP",
    scope: { type: "transformation", id: tid },
    reason: "Synthetic demo approver for the prioritization check",
  });
  await completeG1(lead, office);
  const g1 = await lead.call<{ gate: { version: number } }>("GET", `${T()}/gates/G1`);
  await lead.call(
    "POST",
    `${T()}/gates/G1/submissions`,
    { submissionNote: "Synthetic G1 submission" },
    { ifMatch: g1.gate.version },
  );
  const g1b = await office.call<{ gate: { version: number } }>("GET", `${T()}/gates/G1`);
  await office.call(
    "POST",
    `${T()}/gates/G1/decision`,
    {
      submissionNo: 1,
      outcome: "approved",
      rationale: "Synthetic demo approval for the prioritization check.",
      agreements: { problem: true, baseline: true, materialValuePools: true },
    },
    { ifMatch: g1b.gate.version },
  );
  // Outcome before activity: one outcome with a KPI.
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
  const scores: Record<string, number>[] = [
    { strategic_fit: 5, financial_value: 4, customer_impact: 3, feasibility: 2, time_to_value: 1 },
    { strategic_fit: 4, financial_value: 4, customer_impact: 3, feasibility: 3 },
    { strategic_fit: 3, financial_value: 3, customer_impact: 3, feasibility: 3, time_to_value: 3 },
  ];
  for (let n = 0; n < 3; n++) {
    const i = await lead.call<{ id: string; code: string }>("POST", "/api/v1/initiatives", {
      transformationId: tid,
      name: `Synthetic initiative ${n + 1}`,
    });
    ini.push({ id: i.id, code: i.code });
    await lead.call("POST", `/api/v1/initiatives/${i.id}/outcome-contributions`, {
      outcomeId: outcome.id,
      outcomeKpiId: okpi.id,
      contributionStatement: "Synthetic: fewer billing errors.",
    });
    const fresh = await lead.call<{ version: number }>("GET", `/api/v1/initiatives/${i.id}`);
    await lead.call("POST", `/api/v1/initiatives/${i.id}/submit`, {}, { ifMatch: fresh.version });
    for (const [criterionCode, score] of Object.entries(scores[n]!))
      await lead.call("POST", `/api/v1/initiatives/${i.id}/scores`, { criterionCode, score });
  }
  const m = await lead.call<{ id: string; version: number }>("POST", `/api/v1/initiatives/${ini[0]!.id}/milestones`, {
    title: "Synthetic pilot go-live",
    forecastDate: "2026-11-20",
  });
  milestoneId = m.id;
  await lead.call(
    "POST",
    `/api/v1/milestones/${m.id}/approve-date`,
    { approvedDate: "2026-11-15", reason: "Synthetic initial baseline" },
    { ifMatch: m.version },
  );
  await lead.call("POST", `/api/v1/initiatives/${ini[0]!.id}/deliverables`, { title: "Synthetic pilot report" });
  // INI-01 -> INI-02 needed by 1 Nov (INI-01 finishes 20 Nov: needed-by conflict); INI-02 -> INI-03.
  await lead.call("POST", "/api/v1/dependencies", {
    transformationId: tid,
    description: "Synthetic: billing data feed",
    from: { kind: "initiative", initiativeId: ini[0]!.id },
    toInitiativeId: ini[1]!.id,
    dependencyType: "data",
    neededBy: "2026-11-01",
  });
  await lead.call("POST", "/api/v1/dependencies", {
    transformationId: tid,
    description: "Synthetic: rating engine change",
    from: { kind: "initiative", initiativeId: ini[1]!.id },
    toInitiativeId: ini[2]!.id,
    dependencyType: "tech",
  });
  // Ranking snapshot #1 under weight version 1.
  await lead.call("POST", `${T()}/prioritization/rankings`, { note: "Synthetic snapshot under version 1" });
});

test("lead: ranked table, 0–100 view, scorecard (6 refused), the live 100% check, weight version 2 proposal and an override", async ({
  page,
}, info) => {
  const lang = langOf(info);
  const foreign = trackRequests(page);
  await signIn(page, lang, "dev.lead");
  await page.goto(ws("prioritization"));
  const ranked = page.getByRole("table", { name: tr(lang, "prioritization.ranked.caption"), exact: true });
  const row = (code: string) => ranked.getByRole("row").filter({ hasText: code });
  await expect(row(ini[0]!.code)).toContainText("3.30");
  await expect(row(ini[1]!.code)).toContainText(tr(lang, "prioritization.incomplete"));
  await expect(row(ini[2]!.code)).toContainText("3.00");
  await shot(page, lang, "p3-prioritization-ranked");
  await expectAccessible(page, lang, "p3-prioritization-ranked");

  await page.getByRole("button", { name: tr(lang, "prioritization.ranked.toggle100"), exact: true }).click();
  await expect(page.getByTestId("conversion-label")).toHaveText(tr(lang, "prioritization.conversion_label"));
  await expect(row(ini[0]!.code)).toContainText("57.5");
  await expect(row(ini[1]!.code)).toContainText(tr(lang, "prioritization.incomplete"));
  await shot(page, lang, "p3-prioritization-view100");

  // Scorecard: 6 is refused inline and nothing is sent.
  const sent: string[] = [];
  page.on("request", (req) => {
    if (req.method() !== "GET") sent.push(`${req.method()} ${new URL(req.url()).pathname}`);
  });
  await page
    .getByRole("button", { name: tr(lang, "prioritization.ranked.openScorecard", { code: ini[1]!.code }), exact: true })
    .click();
  const ttv = page.getByLabel(
    new RegExp(
      `^${escape(tr(lang, "prioritization.scorecard.scoreFor", { criterion: tr(lang, "prioritization.criterion.time_to_value"), weight: "15" }))}`,
    ),
  );
  await expect(page.getByTestId("weighted-score")).toContainText(tr(lang, "prioritization.incomplete"));
  await ttv.fill("6");
  await page.getByRole("button", { name: tr(lang, "prioritization.scorecard.save"), exact: true }).click();
  await expect(ttv).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByText(tr(lang, "prioritization.problem.prioritization__score_range"))).toBeVisible();
  expect(sent).toEqual([]);
  await shot(page, lang, "p3-prioritization-scorecard");
  await expectAccessible(page, lang, "p3-prioritization-scorecard");
  await ttv.fill("");

  // Weight set proposal: 95% is refused live; 100% (version 2 example) is proposed.
  await page.getByRole("button", { name: tr(lang, "prioritization.weights.propose"), exact: true }).click();
  const dialog = page.getByRole("dialog");
  const crit = (c: string) => tr(lang, `prioritization.criterion.${c}`);
  const weight = (c: string) =>
    dialog.getByLabel(tr(lang, "prioritization.weights.weightFor", { criterion: crit(c) }), { exact: true });
  await weight("strategic_fit").fill("20");
  const total = dialog.getByTestId("weights-total");
  await expect(total).toContainText(
    tr(lang, "prioritization.problem.prioritization__weights_total", { total: "95.00" }),
  );
  await dialog
    .getByLabel(fieldLabel(lang, "prioritization.weights.rationale"))
    .fill("Synthetic: regulated context adds risk/compliance");
  await dialog.getByRole("button", { name: tr(lang, "prioritization.weights.proposeSubmit"), exact: true }).click();
  expect(sent).toEqual([]);
  await shot(page, lang, "p3-prioritization-weights-95");
  await expectAccessible(page, lang, "p3-prioritization-weights-95");
  await weight("strategic_fit").fill("15");
  await dialog
    .getByLabel(tr(lang, "prioritization.weights.include", { criterion: crit("risk_compliance") }), { exact: true })
    .check();
  await weight("risk_compliance").fill("10");
  await expect(total).toContainText(tr(lang, "prioritization.weights.totalOk"));
  await dialog.getByRole("button", { name: tr(lang, "prioritization.weights.proposeSubmit"), exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const history = page.getByTestId("weight-set-history");
  await expect(history.locator("[data-version='2']")).toContainText(tr(lang, "prioritization.weights.state.proposed"));
  await expect(history.locator("[data-version='2']")).toContainText(tr(lang, "prioritization.weights.ownProposal"));

  // Override: a reason is required; then proposed.
  sent.length = 0;
  await page.getByRole("button", { name: tr(lang, "prioritization.overrides.propose"), exact: true }).click();
  const od = page.getByRole("dialog");
  await od.getByLabel(fieldLabel(lang, "prioritization.ranked.initiative")).selectOption(ini[2]!.id);
  await od.getByLabel(fieldLabel(lang, "prioritization.overrides.rank")).fill("1");
  await od.getByRole("button", { name: tr(lang, "prioritization.overrides.proposeConfirm"), exact: true }).click();
  await expect(od.getByLabel(fieldLabel(lang, "prioritization.overrides.reason"))).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  expect(sent).toEqual([]);
  await od.getByLabel(fieldLabel(lang, "prioritization.overrides.reason")).fill("Synthetic: regulatory deadline");
  await od.getByRole("button", { name: tr(lang, "prioritization.overrides.proposeConfirm"), exact: true }).click();
  await expect(od).toHaveCount(0);
  await expect(page.getByTestId("overrides")).toContainText(tr(lang, "prioritization.overrides.state.proposed"));
  await shot(page, lang, "p3-prioritization-proposals");
  await expectAccessible(page, lang, "p3-prioritization-proposals");
  expect(foreign).toEqual([]);
});

test("another person (demo Sponsor) approves weight version 2 and the override (business approvals); history shows 'weight version 2'", async ({
  browser,
  playwright,
}, info) => {
  const lang = langOf(info);
  const office = await asUser(browser, lang, "dev.office");
  const page = office.page;
  await page.goto(ws("prioritization"));
  await page.getByRole("button", { name: tr(lang, "prioritization.weights.approve", { n: 2 }), exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText(tr(lang, "prioritization.shared.businessApproval"));
  await shot(page, lang, "p3-prioritization-approve-v2");
  await expectAccessible(page, lang, "p3-prioritization-approve-v2");
  await dialog.getByRole("button", { name: tr(lang, "prioritization.weights.approveConfirm"), exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId("active-weight-set")).toContainText(
    tr(lang, "prioritization.weights.activeVersion", { n: 2 }),
  );

  await page.getByRole("button", { name: tr(lang, "prioritization.overrides.decide"), exact: true }).click();
  const od = page.getByRole("dialog");
  await expect(od).toContainText(tr(lang, "prioritization.shared.businessApproval"));
  await od.getByRole("radio", { name: tr(lang, "prioritization.overrides.result.approved"), exact: true }).check();
  await od.getByRole("button", { name: tr(lang, "prioritization.overrides.decideConfirm"), exact: true }).click();
  await expect(od).toHaveCount(0);
  await expect(page.getByTestId("overrides")).toContainText(tr(lang, "prioritization.overrides.state.approved"));

  // A new snapshot (by the lead) records the change of weights and the override.
  // Version 2 adds risk/compliance: INI-01 and INI-03 are scored on it (INI-02 stays incomplete).
  const lead = await apiSession(playwright, "dev.lead");
  for (const i of [ini[0]!, ini[2]!])
    await lead.call("POST", `/api/v1/initiatives/${i.id}/scores`, { criterionCode: "risk_compliance", score: 3 });
  await lead.call("POST", `${T()}/prioritization/rankings`, { note: "Synthetic snapshot under version 2" });
  await page.reload();
  const hist = page.getByTestId("ranking-history");
  await expect(hist).toContainText(tr(lang, "prioritization.cause.weight", { n: 2 }));
  await expect(hist).toContainText(
    tr(lang, "prioritization.cause.override", { reason: "Synthetic: regulatory deadline" }),
  );
  await hist.scrollIntoViewIfNeeded();
  await shot(page, lang, "p3-prioritization-history");
  await expectAccessible(page, lang, "p3-prioritization-history");
  await office.close();
});

test("roadmap: source waves; moving a milestone updates the timeline, table and board; a stale edit is a 409 conflict", async ({
  page,
  playwright,
}, info) => {
  const lang = langOf(info);
  const foreign = trackRequests(page);
  await signIn(page, lang, "dev.lead");
  await page.goto(ws("roadmap"));
  const waves = page.getByTestId("waves");
  for (const name of ["Wave 0 — Mobilize", "Wave 1 — Prove", "Wave 2 — Scale", "Wave 3 — Embed"])
    await expect(waves).toContainText(name);
  if (lang === "en") await expect(waves).toContainText("Evidence + capacity");
  await expect(page.getByTestId("wave-horizons").getByRole("listitem")).toHaveCount(4);
  await shot(page, lang, "p3-prioritization-roadmap");
  await expectAccessible(page, lang, "p3-prioritization-roadmap");

  const title = "Synthetic pilot go-live";
  await page.getByRole("button", { name: tr(lang, "roadmap.milestones.move", { title }), exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(tr(lang, "roadmap.milestones.forecast"), { exact: true }).fill("2026-12-05");
  await dialog.getByRole("button", { name: tr(lang, "roadmap.milestones.moveConfirm"), exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const timeline = page.getByTestId("timeline-date").first();
  await expect(timeline).toContainText(/5|٥/);
  const date = (await timeline.textContent())!.trim();
  await expect(page.locator(`[data-initiative='${ini[0]!.code}'] [data-testid='table-next-milestone']`)).toContainText(
    date,
  );
  await expect(page.locator(`[data-card='${ini[0]!.code}'] [data-testid='board-next-milestone']`)).toContainText(date);
  await expect(page.getByTestId("milestone-forecast").first()).toContainText(date);

  // Someone else moves it meanwhile; this page still holds the old version -> 409, conflict notice, reload.
  const lead = await apiSession(playwright, "dev.lead");
  const current = await lead.call<{ version: number }>("GET", `/api/v1/milestones/${milestoneId}`);
  await lead.call(
    "PATCH",
    `/api/v1/milestones/${milestoneId}`,
    { forecastDate: "2026-12-10" },
    { ifMatch: current.version },
  );
  await page.getByRole("button", { name: tr(lang, "roadmap.milestones.move", { title }), exact: true }).click();
  await dialog.getByLabel(tr(lang, "roadmap.milestones.forecast"), { exact: true }).fill("2026-12-12");
  await dialog.getByRole("button", { name: tr(lang, "roadmap.milestones.moveConfirm"), exact: true }).click();
  const conflict = page.locator("[data-state='conflict']");
  await expect(conflict).toContainText(tr(lang, "common.conflict.title"));
  await expect(page.getByTestId("timeline-date").first()).toContainText(/10|١٠/);
  await shot(page, lang, "p3-prioritization-roadmap-409");
  await expectAccessible(page, lang, "p3-prioritization-roadmap-409");
  expect(foreign).toEqual([]);
});

test("dependencies: the seven T08 columns, the needed-by flag and a cycle refused with its path", async ({
  page,
}, info) => {
  const lang = langOf(info);
  await signIn(page, lang, "dev.lead");
  await page.goto(ws("dependencies"));
  const table = page.getByTestId("t08");
  await expect(table.getByRole("row")).toHaveCount(3);
  const headers = await table.getByRole("columnheader").allTextContents();
  expect(headers.slice(0, 7).map((h) => h.trim())).toEqual(
    ["dependency", "from", "to", "type", "neededBy", "owner", "statusMitigation"].map((k) =>
      tr(lang, `dependencies.col.${k}`),
    ),
  );
  await expect(table).toContainText(tr(lang, "roadmap.flag.schedule__needed_by_conflict"));
  await shot(page, lang, "p3-prioritization-dependencies");
  await expectAccessible(page, lang, "p3-prioritization-dependencies");

  await page.getByRole("button", { name: tr(lang, "dependencies.map.add"), exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(fieldLabel(lang, "dependencies.col.dependency")).fill("Synthetic: closes the loop");
  await dialog.getByLabel(fieldLabel(lang, "dependencies.form.fromInitiative")).selectOption(ini[2]!.id);
  await dialog.getByLabel(fieldLabel(lang, "dependencies.col.to")).selectOption(ini[0]!.id);
  await dialog.getByLabel(fieldLabel(lang, "dependencies.col.type")).selectOption("decision");
  await dialog.getByRole("button", { name: tr(lang, "dependencies.form.save"), exact: true }).click();
  const alert = dialog.getByRole("alert");
  // ADR-0023 §5: the reported cycle is from → to → … → from of the refused edge (INI-03 → INI-01 here).
  const path = `${ini[2]!.code} → ${ini[0]!.code} → ${ini[1]!.code} → ${ini[2]!.code}`;
  await expect(alert).toContainText(path);
  await expect(alert).toContainText(tr(lang, "dependencies.problem.dependency__cycle", { path: "" }).split(":")[0]!);
  await alert.scrollIntoViewIfNeeded();
  await shot(page, lang, "p3-prioritization-cycle");
  await expectAccessible(page, lang, "p3-prioritization-cycle");
});

test("the read-only auditor: prioritization, roadmap and dependencies show data with no enabled write control", async ({
  browser,
}, info) => {
  const lang = langOf(info);
  const aud = await asUser(browser, lang, "dev.auditor");
  const page = aud.page;
  const writes: string[] = [];
  page.on("request", (req) => {
    if (!["GET", "HEAD"].includes(req.method())) writes.push(`${req.method()} ${new URL(req.url()).pathname}`);
  });
  for (const [path, name] of [
    ["prioritization", "p3-prioritization-aud-prioritization"],
    ["roadmap", "p3-prioritization-aud-roadmap"],
    ["dependencies", "p3-prioritization-aud-dependencies"],
  ] as const) {
    await page.goto(ws(path));
    await expect(page.locator("[data-state='read-only']")).toBeVisible();
    await expect(page.locator("main#main table").first()).toBeVisible();
    const enabledWrites = page
      .locator("main#main")
      .getByRole("button")
      .filter({
        hasText: new RegExp(
          [
            "prioritization.weights.propose",
            "prioritization.overrides.propose",
            "prioritization.rankings.create",
            "prioritization.scorecard.save",
            "dependencies.map.add",
            "roadmap.milestones.moveConfirm",
          ]
            .map((k) => escape(tr(lang, k)))
            .join("|"),
        ),
      });
    await expect(enabledWrites).toHaveCount(0);
    await expect(page.locator("main#main").getByRole("button", { name: /approve|اعتماد|move|نقل/i })).toHaveCount(0);
    await shot(page, lang, name);
    await expectAccessible(page, lang, name);
  }
  expect(writes.filter((w) => !w.endsWith("/me/preferences"))).toEqual([]);
  await aud.close();
});

test("capacity screen with STUBBED capacity responses (BE-E's API lands in the next wave): grid, shortfall, Unknown; axe", async ({
  page,
}, info) => {
  const lang = langOf(info);
  await signIn(page, lang, "dev.lead");
  const role = "01920000-0000-7000-aa00-000000000001";
  await page.route("**/api/v1/transformations/*/capacity-plan*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        transformationId: tid,
        roles: [
          {
            id: role,
            code: "data_engineer",
            labelEn: "Data engineer (synthetic)",
            labelAr: "مهندس بيانات (اصطناعي)",
            status: "active",
            version: 1,
          },
        ],
        cells: [
          {
            resourceRoleId: role,
            periodMonth: "2026-11-01",
            availableFte: "2.00",
            demandFte: "3.50",
            committedDemandFte: "1.00",
            shortfallFte: "1.50",
            flag: "capacity.over_allocated",
          },
          {
            resourceRoleId: role,
            periodMonth: "2026-12-01",
            availableFte: null,
            demandFte: "1.25",
            committedDemandFte: "0.00",
            shortfallFte: null,
            flag: "capacity.unknown",
          },
          {
            resourceRoleId: role,
            periodMonth: "2027-01-01",
            availableFte: "4.00",
            demandFte: "1.00",
            committedDemandFte: "1.00",
            shortfallFte: null,
            flag: null,
          },
        ],
      }),
    }),
  );
  await page.route("**/api/v1/resource-demands?*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: [
          {
            id: "01920000-0000-7000-aa00-000000000101",
            transformationId: tid,
            initiativeId: ini[0]!.id,
            resourceRoleId: role,
            periodMonth: "2026-11-01",
            demandFte: "2.50",
            ownerUserId: null,
            note: null,
            status: "planned",
            committedBy: null,
            committedAt: null,
            version: 1,
          },
        ],
        nextCursor: null,
      }),
    }),
  );
  await page.goto(ws("capacity"));
  const grid = page.getByTestId("capacity-grid");
  await expect(grid.locator("[data-month='2026-11-01']")).toContainText(
    tr(lang, "capacity.grid.shortfall", { fte: "1.5" }),
  );
  await expect(grid.locator("[data-month='2026-12-01']")).toContainText(tr(lang, "capacity.grid.unknownCapacity"));
  await shot(page, lang, "p3-prioritization-capacity-stubbed");
  await expectAccessible(page, lang, "p3-prioritization-capacity-stubbed");
});
