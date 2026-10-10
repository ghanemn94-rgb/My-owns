// P4 slice K (traceability, Modular entry, portfolios, workstreams), the dashboard RAG policy and the transformation
// chip on the REAL stack (support/with-stack.sh; no mocks): T-DG4-FE-G2 (p4-work-split §J+K JK.7; ADR-0037 §3/§4,
// ADR-0038). Every record is SYNTHETIC demo data. No product gate (G1-G6) is decided here, and none implies an
// engineering gate (DG0-DG7).
//  1. Modular entry (REQ-PB-005, REQ-S03-005): a Modular transformation entering at Design lists the missing baseline
//     and outcome links as blocking; no gate is labelled "approved"; an inherited baseline is recorded through the form
//     with its provenance and the inherited label, read back (getInheritedRecord) and withdrawn with a reason; an
//     accepted Modular-links waiver (G3, no initiative) is then shown as in force, and the links stay missing.
//  2. Traceability (REQ-PB-044, REQ-S03-006): an initiative without a TOM gap is in the orphan report; clicking its
//     graph node opens the initiative; a capability → KPI link of 60 % and a contribution share of 40 % make the KPI's
//     set 100 % (0 % unallocated); raising the link to 70 % is refused (110 %), translated; the impact of the KPI
//     definition lists the Outcomes area and the dashboards. After the links, the outcome link is no longer missing.
//  3. Workstreams and portfolios (REQ-S03-001): WS-01 and WS-02 in order; an initiative in two workstreams and a
//     transformation in two portfolios are refused, translated.
//  4. RAG policy (ADR-0037 §3/§10): read-only for the Transformation Lead; the Transformation Office saves it.
//  5. Transformation chip (REQ-S13-002): the Executive Overview narrows by a chosen readable transformation (the id is
//     sent to the server), shown as a chip with the organization as scope.
//  6. 390 px wide, and 200 % text: no page-level horizontal scroll on the five new screens.
// Every step: a full-page screenshot per language and axe with 0 serious or critical issues.
import { expect, test, type Page } from "@playwright/test";
import { asUser, defineRecords, syntheticUser } from "./support/p3-journey-setup.ts";
import {
  SYN_RETAIL,
  apiSession,
  expectAccessible,
  langOf,
  shot,
  tr,
  trackRequests,
  type ApiSession,
} from "./support/ui.ts";

test.describe.configure({ mode: "serial" });

let tid = "";
let base = "";
let lead: ApiSession;
let sponsor: ApiSession;
let baselineId = "";
let iniId = "";
let iniName = "";
let capId = "";
let kpiId = "";
let okpiId = "";
const stamp = Date.now().toString(36);

async function go(page: Page, path: string) {
  await page.goto(path);
  await expect(page.locator("main#main h1")).toBeVisible();
}

async function expectNoPageOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

test.beforeAll(async ({ playwright }, info) => {
  const lang = langOf(info);
  lead = await apiSession(playwright, "dev.lead");
  tid = (
    await lead.call<{ id: string }>("POST", "/api/v1/transformations", {
      businessUnitId: SYN_RETAIL,
      name: `Synthetic P4 traceability ${lang.toUpperCase()} ${stamp}`,
      mode: "modular",
      entryPhase: "design",
    })
  ).id;
  base = `/api/v1/transformations/${tid}`;
  // Inherited prior approvals of G1 and G2 (ADR-0021 §5, the p3-inherited-approval.spec.ts setup): verified evidence of
  // the earlier approval, recorded by the Lead and accepted by a synthetic Sponsor. A demo acceptance approves nothing
  // real; it is never a platform gate decision.
  const office = await apiSession(playwright, "dev.office");
  const admin = await apiSession(playwright, "dev.admin");
  const me = await admin.call<{ organization: { id: string } }>("GET", "/api/v1/me");
  const sp = await syntheticUser(
    admin,
    me.organization.id,
    tid,
    `dev.p4trace.sp.${lang}.${stamp}`,
    // Sorts after "Synthetic Transformation Lead": journeys.spec.ts expects that user on page 1 of /admin/users, and
    // the chromium-ar run sees every user the chromium-en specs created (W17 e2e finding).
    `Synthetic Waiver Sponsor trace ${lang}`,
    "SP",
    lang,
  );
  sponsor = await apiSession(playwright, sp.username);
  for (const gateCode of ["G1", "G2"]) {
    const ev = await lead.call<{ id: string; version: number }>("POST", `${base}/evidence`, {
      kind: "note",
      title: `Synthetic prior ${gateCode} approval minute`,
      ownerUserId: lead.userId,
      noteBody: `Synthetic minute of an earlier ${gateCode} approval.`,
    });
    await office.call(
      "POST",
      `${base}/evidence/${ev.id}/review`,
      { result: "verified", accessibilityStatus: "accessible", note: "Synthetic review" },
      { ifMatch: ev.version },
    );
    const disp = await lead.call<{ id: string; version: number }>("POST", `${base}/gate-dispensations`, {
      kind: "inherited_approval",
      gateCode,
      approvingBody: "Synthetic executive committee",
      approvedOn: "2026-01-15",
      evidenceId: ev.id,
    });
    await sponsor.call(
      "POST",
      `${base}/gate-dispensations/${disp.id}/decision`,
      { result: "accepted", note: "Synthetic demo acceptance (approves nothing real)" },
      { ifMatch: disp.version },
    );
  }
  // A baseline without a value: the Modular "baseline missing" item stays blocking until a value is recorded.
  baselineId = (
    await lead.call<{ id: string }>("POST", `${base}/baselines`, {
      metric: `Synthetic inherited handling time ${lang} ${stamp}`,
      unit: "minutes",
      scope: "operational",
    })
  ).id;
});

test("1. Modular entry: blocking missing links, no gate labelled approved; inherited baseline recorded, read, withdrawn", async ({
  browser,
}, info) => {
  const lang = langOf(info);
  const tl = await asUser(browser, lang, "dev.lead");
  const page = tl.page;
  const foreign = trackRequests(page);
  await go(page, `/transformations/${tid}/modular-entry`);
  await expect(page.locator("main#main h1")).toHaveText(tr(lang, "traceability.modular.title"));
  await expect(page.locator("[data-mode='modular'][data-entry-phase='design']")).toBeVisible();
  await expect(page.locator("[data-missing='baseline_missing'][data-severity='blocking']")).toBeVisible();
  await expect(page.locator("[data-missing='outcome_link_missing'][data-severity='blocking']")).toBeVisible();
  await expect(page.locator("[data-blocking='2']")).toBeVisible();
  await expect(page.locator("[data-waiver='none']")).toBeVisible();
  await expect(page.locator("[data-gate]")).toHaveCount(6);
  await expect(page.locator("[data-gate-label='approved']")).toHaveCount(0);
  // REQ-S03-005: the inherited G2 (and G1) approval is labelled Inherited, never Approved.
  for (const g of ["G1", "G2"]) {
    await expect(page.locator(`[data-gate='${g}']`)).toHaveAttribute("data-gate-label", "inherited");
    await expect(page.locator(`[data-gate='${g}']`)).toContainText(tr(lang, "traceability.inheritedLabel"));
    await expect(page.locator(`[data-gate='${g}']`)).not.toContainText(tr(lang, "traceability.gateLabel.approved"));
  }
  // The prior approvals are listed read-only with the inherited label.
  await expect(page.locator("[data-prior-approval]")).toHaveCount(2);
  await shot(page, lang, "p4trace-01-modular-missing");
  await expectAccessible(page, lang, "p4trace-modular");

  // Record the baseline as inherited, through the form.
  await page.locator("[data-action='create-inherited']").click();
  const dialog = page.getByRole("dialog");
  await dialog.locator("[data-field='kind']").selectOption("baseline");
  await dialog.locator("[data-field='baselineId']").selectOption(baselineId);
  await dialog.locator("[data-field='sourceDescription']").fill(`Synthetic earlier programme pack ${lang} ${stamp}`);
  await dialog.locator("[data-field='originalOwner']").fill("Synthetic former PMO");
  await dialog.locator("[data-field='originalDate']").fill("2026-03-01");
  await shot(page, lang, "p4trace-02-inherited-form");
  await expectAccessible(page, lang, "p4trace-inherited-form");
  await dialog.getByRole("button", { name: tr(lang, "traceability.inherited.createSubmit") }).click();
  await expect(dialog).toHaveCount(0);
  const row = page.locator("#modular-inherited tr", { hasText: `Synthetic earlier programme pack ${lang} ${stamp}` });
  await expect(row).toBeVisible();
  await expect(row.locator("[data-inherited-label]")).toContainText(tr(lang, "traceability.inheritedLabel"));
  if (lang === "en") await expect(row).toContainText("Inherited - recorded, not granted in platform");
  else await expect(page.locator("[data-provisional]")).toBeVisible();
  // getInheritedRecord: the record read on its own, with its provenance
  await row.locator("[data-action='view-inherited']").click();
  await expect(page.locator("[data-inherited-view] [data-inherited-status='active']")).toBeVisible();
  await expect(page.locator("[data-inherited-view]")).toContainText("Synthetic former PMO");
  await shot(page, lang, "p4trace-03-inherited-view");
  // Inheriting a baseline does not give it a value: still blocking.
  await expect(page.locator("[data-missing='baseline_missing']")).toBeVisible();
  // Withdraw with a reason (If-Match); the row stays in the history.
  await row.locator("[data-action='withdraw-inherited']").click();
  const w = page.getByRole("dialog");
  await w.locator("[data-field='reason']").fill("Synthetic: superseded by a fresh measurement");
  await w.getByRole("button", { name: tr(lang, "traceability.inherited.withdraw") }).click();
  await expect(w).toHaveCount(0);
  await expect(row).toHaveCount(0);
  await page.getByLabel(tr(lang, "traceability.inherited.includeWithdrawn")).check();
  await expect(
    page.locator("#modular-inherited tr", { hasText: "Synthetic: superseded by a fresh measurement" }),
  ).toBeVisible();
  await shot(page, lang, "p4trace-04-inherited-withdrawn");
  await expectAccessible(page, lang, "p4trace-inherited-withdrawn");

  // REQ-PB-005 / D-110 (a): a Modular-links waiver (G3, no initiative) recorded by the Lead and accepted by the
  // synthetic Sponsor (a demo acceptance approves nothing real) is shown as in force; the links stay listed as missing.
  const expires = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  const waiver = await lead.call<{ id: string; version: number }>("POST", `${base}/gate-dispensations`, {
    kind: "waiver",
    gateCode: "G3",
    reason: `Synthetic: the inherited baseline is being located ${lang} ${stamp}`,
    expiresOn: expires,
  });
  await sponsor.call(
    "POST",
    `${base}/gate-dispensations/${waiver.id}/decision`,
    { result: "accepted", note: "Synthetic demo acceptance (approves nothing real)" },
    { ifMatch: waiver.version },
  );
  await go(page, `/transformations/${tid}/modular-entry`);
  const inForce = page.locator(`[data-waiver='${waiver.id}']`);
  await expect(inForce).toHaveAttribute("data-waiver-expires", expires);
  await expect(inForce).toContainText(`Synthetic: the inherited baseline is being located ${lang} ${stamp}`);
  await expect(page.locator("[data-missing='baseline_missing'][data-severity='blocking']")).toBeVisible();
  await expect(page.locator("[data-missing='outcome_link_missing'][data-severity='blocking']")).toBeVisible();
  await expect(page.locator("[data-gate-label='approved']")).toHaveCount(0);
  await shot(page, lang, "p4trace-04b-waiver-in-force");
  await expectAccessible(page, lang, "p4trace-waiver-in-force");
  expect(foreign).toEqual([]);
  await tl.close();
});

test("2. Traceability: orphan initiative, node opens record, 100 % set, 110 % refused, impact of a KPI", async ({
  browser,
}, info) => {
  const lang = langOf(info);
  // Chain records through the API (each has its own DG2/DG3 screen); the slice K actions go through the new screens.
  const d = await defineRecords(base, lead);
  kpiId = d.kpiId;
  okpiId = d.outcomeKpiId;
  capId = (
    await lead.call<{ id: string }>("POST", `${base}/capability-heatmap`, {
      name: `Synthetic digital onboarding ${lang} ${stamp}`,
      currentLevel: 2,
      targetLevel: 4,
      sourcingNeed: "build",
    })
  ).id;
  iniName = `Synthetic app relaunch ${lang} ${stamp}`;
  iniId = (
    await lead.call<{ id: string }>("POST", "/api/v1/initiatives", {
      transformationId: tid,
      name: iniName,
      objective: "Synthetic objective",
      scopeIn: "Synthetic retail scope",
      executiveOwnerUserId: lead.userId,
      workstreamLeadUserId: lead.userId,
      plannedStart: "2026-11-01",
      plannedEnd: "2027-03-31",
    })
  ).id;
  await lead.call("POST", `/api/v1/initiatives/${iniId}/outcome-contributions`, {
    outcomeId: d.outcomeId,
    outcomeKpiId: d.outcomeKpiId,
    contributionStatement: "Synthetic: the relaunch shortens onboarding.",
  });
  const fresh = await lead.call<{ version: number }>("GET", `/api/v1/initiatives/${iniId}`);
  await lead.call("POST", `/api/v1/initiatives/${iniId}/submit`, {}, { ifMatch: fresh.version });

  const tl = await asUser(browser, lang, "dev.lead");
  const page = tl.page;
  const foreign = trackRequests(page);
  await go(page, `/transformations/${tid}/traceability`);
  await expect(page.locator("main#main h1")).toHaveText(tr(lang, "traceability.title"));
  await expect(page.locator(`[data-node='${iniId}']`)).toBeVisible();
  // Orphan report: the initiative has no TOM gap; the expected step is named.
  const orphan = page.locator(`[data-orphan-id='${iniId}']`);
  await expect(orphan).toBeVisible();
  await expect(orphan.locator("[data-expected]")).toHaveAttribute("data-expected", /tom_gap → initiative/);
  await expect(orphan).toContainText(
    tr(lang, "traceability.orphans.expectedStep", {
      from: tr(lang, "traceability.nodeType.tom_gap"),
      to: tr(lang, "traceability.nodeType.initiative"),
    }),
  );
  await shot(page, lang, "p4trace-05-graph-orphans");
  await expectAccessible(page, lang, "p4trace-graph");
  // Clicking the node opens the initiative.
  await page.locator(`[data-node='${iniId}'] a[data-node-link]`).click();
  await expect(page).toHaveURL(new RegExp(`/transformations/${tid}/initiatives/${iniId}$`));
  await expect(page.locator("main#main").getByText(iniName).first()).toBeVisible();
  await go(page, `/transformations/${tid}/traceability`);

  // A capability → KPI trace link with a 60 % share, through the form.
  await page.locator("[data-action='create-link']").click();
  let dialog = page.getByRole("dialog");
  await dialog.locator("[data-field='linkKind']").selectOption("capability_kpi");
  await dialog.locator("[data-field='fromId']").selectOption(capId);
  await dialog.locator("[data-field='toId']").selectOption(okpiId);
  await dialog.locator("[data-field='contributionStatement']").fill("Synthetic: digital onboarding cuts handling time");
  await dialog.locator("[data-field='allocationShare']").fill("0.6");
  await dialog.getByRole("button", { name: tr(lang, "traceability.links.createSubmit") }).click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.locator("#trace-links tr", { hasText: "Synthetic: digital onboarding cuts handling time" }),
  ).toBeVisible();

  // The KPI's allocation set: 60 % + the contribution's 40 % = 100 %, 0 % unallocated.
  await page.locator("#alloc-target").selectOption(`outcome_kpi:${okpiId}`);
  const set = page.locator(`[data-allocation-set='outcome_kpi:${okpiId}']`);
  await expect(set.locator("[data-total='0.600000']")).toBeVisible();
  await expect(set.locator("[data-unallocated='0.400000']")).toContainText("40%");
  await set.locator("[data-action='set-share']").first().click();
  dialog = page.getByRole("dialog");
  await dialog.locator("[data-field='allocationShare']").fill("0.4");
  await expect(dialog.locator("[data-would-total='1.000000']")).toContainText("100%");
  await dialog.getByRole("button", { name: tr(lang, "traceability.save") }).click();
  await expect(dialog).toHaveCount(0);
  await expect(set.locator("[data-total='1.000000']")).toContainText("100%");
  await expect(set.locator("[data-unallocated='0.000000']")).toContainText("0%");
  await shot(page, lang, "p4trace-06-allocation-100");
  await expectAccessible(page, lang, "p4trace-allocation");

  // Raising the capability link to 70 % would total 110 %: refused by the server, translated, with the total.
  await set
    .locator("tr", { hasText: `Synthetic digital onboarding ${lang} ${stamp}` })
    .locator("[data-action='edit-share']")
    .click();
  dialog = page.getByRole("dialog");
  await dialog.locator("[data-field='allocationShare']").fill("0.7");
  await dialog.getByRole("button", { name: tr(lang, "traceability.save") }).click();
  const alert = dialog.getByRole("alert");
  await expect(alert).toHaveAttribute("data-problem", "trace_link.allocation_exceeds_total");
  await expect(alert).toContainText(tr(lang, "traceability.problem.trace_link__allocation_exceeds_total"));
  await expect(alert.locator("[data-refused-total='1.100000']")).toContainText("110%");
  await shot(page, lang, "p4trace-07-allocation-110-refused");
  await expectAccessible(page, lang, "p4trace-allocation-refused");
  await dialog.getByRole("button", { name: tr(lang, "common.action.cancel") }).click();
  await expect(set.locator("[data-total='1.000000']")).toBeVisible();

  // Impact of the KPI definition (changing its target): the Outcomes area and the dashboards that read it.
  await page.locator("#impact-root").selectOption(`kpi_definition:${kpiId}`);
  const impact = page.locator(`[data-impact-root='kpi_definition:${kpiId}']`);
  await expect(
    impact.locator("[data-impact-dashboard='transformation'][data-impact-area='outcomes']").first(),
  ).toBeVisible();
  await expect(impact.locator("[data-impact-dashboard='executive']").first()).toBeVisible();
  await expect(impact.locator("[data-hidden-count]")).toBeVisible();
  await shot(page, lang, "p4trace-08-impact");
  await expectAccessible(page, lang, "p4trace-impact");

  // Back on Modular entry: the outcome link is supplied now; the baseline (no value) is still missing.
  await go(page, `/transformations/${tid}/modular-entry`);
  await expect(page.locator("[data-missing='baseline_missing']")).toBeVisible();
  await expect(page.locator("[data-missing='outcome_link_missing']")).toHaveCount(0);
  await shot(page, lang, "p4trace-09-modular-after-links");
  expect(foreign).toEqual([]);
  await tl.close();
});

test("3. Workstreams WS-01/WS-02; one workstream per initiative; one portfolio per transformation", async ({
  browser,
}, info) => {
  const lang = langOf(info);
  const tl = await asUser(browser, lang, "dev.lead");
  let page = tl.page;
  await go(page, `/transformations/${tid}/workstreams`);
  for (const n of [1, 2]) {
    await page.locator("[data-action='create-workstream']").click();
    const dialog = page.getByRole("dialog");
    await dialog.locator("[data-field='name']").fill(`Synthetic workstream ${n} ${lang}`);
    await dialog.getByRole("button", { name: tr(lang, "traceability.workstreams.createSubmit") }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator(`[data-workstream='WS-0${n}']`)).toBeVisible();
  }
  await shot(page, lang, "p4trace-10-workstreams");
  await expectAccessible(page, lang, "p4trace-workstreams");
  for (const n of [1, 2]) {
    await go(page, `/transformations/${tid}/workstreams`);
    await page.locator(`[data-workstream='WS-0${n}']`).click();
    await expect(page.locator(`[data-workstream-code='WS-0${n}']`)).toBeVisible();
    await page.locator("[data-action='add-initiative']").click();
    const dialog = page.getByRole("dialog");
    await dialog.locator("[data-field='initiativeId']").selectOption(iniId);
    await dialog.getByRole("button", { name: tr(lang, "traceability.workstreams.addSubmit") }).click();
    if (n === 1) {
      await expect(dialog).toHaveCount(0);
      await expect(page.locator("#workstream-initiatives tr", { hasText: iniName })).toBeVisible();
    } else {
      const alert = dialog.getByRole("alert");
      await expect(alert).toHaveAttribute("data-problem", "workstream.initiative_already_assigned");
      await expect(alert).toContainText(tr(lang, "problems.workstream__initiative_already_assigned"));
      await shot(page, lang, "p4trace-11-initiative-already-assigned");
      await expectAccessible(page, lang, "p4trace-initiative-refused");
    }
  }
  await tl.close();

  const to = await asUser(browser, lang, "dev.office");
  page = to.page;
  await go(page, "/portfolios");
  await expect(page.locator("main#main h1")).toHaveText(tr(lang, "traceability.portfolios.title"));
  const codes = [`PF${stamp.toUpperCase()}${lang.toUpperCase()}1`, `PF${stamp.toUpperCase()}${lang.toUpperCase()}2`];
  for (const [n, code] of codes.entries()) {
    await go(page, "/portfolios");
    await page.locator("[data-action='create-portfolio']").click();
    let dialog = page.getByRole("dialog");
    await dialog.locator("[data-field='code']").fill(code);
    await dialog.locator("[data-field='name']").fill(`Synthetic portfolio ${n + 1} ${lang}`);
    await dialog.getByRole("button", { name: tr(lang, "traceability.portfolios.createSubmit") }).click();
    await expect(dialog).toHaveCount(0);
    await page.locator(`[data-portfolio='${code}']`).click();
    await expect(page.locator("main#main h1")).toContainText(code);
    await page.locator("[data-action='add-transformation']").click();
    dialog = page.getByRole("dialog");
    await dialog.locator("[data-field='transformationId']").selectOption(tid);
    await dialog.getByRole("button", { name: tr(lang, "traceability.portfolios.addSubmit") }).click();
    if (n === 0) {
      await expect(dialog).toHaveCount(0);
      await expect(
        page.locator("#portfolio-transformations tr", { hasText: `Synthetic P4 traceability` }),
      ).toBeVisible();
      await shot(page, lang, "p4trace-12-portfolio");
      await expectAccessible(page, lang, "p4trace-portfolio");
    } else {
      const alert = dialog.getByRole("alert");
      await expect(alert).toHaveAttribute("data-problem", "portfolio.transformation_already_placed");
      await expect(alert).toContainText(tr(lang, "problems.portfolio__transformation_already_placed"));
      await shot(page, lang, "p4trace-13-transformation-already-placed");
      await expectAccessible(page, lang, "p4trace-portfolio-refused");
    }
  }
  await to.close();
});

test("4. RAG policy: no organization read → not found; read-only for the auditor; the Transformation Office saves it", async ({
  browser,
}, info) => {
  const lang = langOf(info);
  // The Lead's grant is on a business unit: the organization's policy is not readable (404, translated).
  const tl = await asUser(browser, lang, "dev.lead");
  await go(tl.page, "/dashboards/rag-policy");
  await expect(tl.page.locator("main#main h1")).toHaveText(tr(lang, "dashboards.ragPolicy.title"));
  await expect(tl.page.locator("[data-state='no-permission']")).toContainText(tr(lang, "common.state.notFoundTitle"));
  await expect(tl.page.locator("[data-action='save-policy']")).toHaveCount(0);
  await tl.close();
  // The auditor reads it (organization.read) but cannot change it.
  const aud = await asUser(browser, lang, "dev.auditor");
  await go(aud.page, "/dashboards/rag-policy");
  await expect(aud.page.locator("[data-policy-version]")).toBeVisible();
  await expect(aud.page.locator("[data-action='save-policy']")).toHaveCount(0);
  await expect(aud.page.getByText(tr(lang, "dashboards.ragPolicy.readOnly"))).toBeVisible();
  await shot(aud.page, lang, "p4trace-14a-rag-policy-read-only");
  await expectAccessible(aud.page, lang, "p4trace-rag-policy-read-only");
  await aud.close();

  const to = await asUser(browser, lang, "dev.office");
  const page = to.page;
  await go(page, "/dashboards/rag-policy");
  const state = page.locator("[data-policy-version]");
  await expect(state).toBeVisible();
  const before = Number(await state.getAttribute("data-policy-version"));
  // Only the note changes: every threshold keeps its value, so other dashboards are not affected.
  await page.locator("[data-field='note']").fill(`Synthetic policy note ${lang} ${stamp}`);
  const put = page.waitForRequest((r) => r.method() === "PUT" && r.url().endsWith("/dashboard-rag-policy"));
  await page.locator("[data-action='save-policy']").click();
  const req = await put;
  expect(req.headers()["if-match"]).toBe(`"${before}"`);
  expect(req.postDataJSON()).toEqual({ note: `Synthetic policy note ${lang} ${stamp}` });
  await expect(page.locator("[data-saved]")).toBeVisible();
  await expect(page.locator(`[data-policy-version='${before + 1}']`)).toBeVisible();
  await shot(page, lang, "p4trace-14-rag-policy");
  await expectAccessible(page, lang, "p4trace-rag-policy");
  await to.close();
});

test("5. Transformation chip: a readable transformation narrows the Executive Overview, shown as a chip", async ({
  browser,
}, info) => {
  const lang = langOf(info);
  const tl = await asUser(browser, lang, "dev.lead");
  const page = tl.page;
  await go(page, "/executive-overview");
  await expect(page.locator("[data-filter-scope='organization']")).toBeVisible();
  const select = page.locator("[data-filter='transformation']");
  await expect(select.locator(`option[value='${tid}']`)).toHaveCount(1);
  const sent = page.waitForRequest(
    (r) =>
      r.url().includes("/api/v1/overview?") && new URL(r.url()).searchParams.getAll("transformationId").includes(tid),
  );
  await select.selectOption(tid);
  await sent;
  await expect(page).toHaveURL(new RegExp(`[?&]tr=${tid}`));
  await expect(page.locator(`[data-chip='tr'][data-chip-id='${tid}']`)).toBeVisible();
  await expect(select.locator(`option[value='${tid}']`)).toHaveCount(0);
  await shot(page, lang, "p4trace-15-transformation-chip");
  await expectAccessible(page, lang, "p4trace-transformation-chip");
  await tl.close();
});

test("6. 390 px wide and 200 % text: no page-level horizontal scroll", async ({ browser }, info) => {
  const lang = langOf(info);
  const to = await asUser(browser, lang, "dev.office");
  const page = to.page;
  const screens: [string, string][] = [
    [`/transformations/${tid}/traceability`, "p4trace-16-traceability"],
    [`/transformations/${tid}/modular-entry`, "p4trace-17-modular"],
    [`/transformations/${tid}/workstreams`, "p4trace-18-workstreams"],
    ["/portfolios", "p4trace-19-portfolios"],
    ["/dashboards/rag-policy", "p4trace-20-rag-policy"],
  ];
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [path, name] of screens) {
    await go(page, path);
    await page.waitForLoadState("networkidle");
    await expectNoPageOverflow(page);
    await shot(page, lang, `${name}-390`);
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  for (const [path, name] of screens) {
    await go(page, path);
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "200%";
    });
    await page.waitForLoadState("networkidle");
    await expectNoPageOverflow(page);
    await shot(page, lang, `${name}-200pct`);
  }
  await to.close();
});
