// P4 slice H gate screens and slice G closure on the REAL stack (support/with-stack.sh; no mocks): T-DG4-FE-F
// (p4-work-split §H H.6, §F+G FG.8). Every record is SYNTHETIC demo data. Every gate, exception, waiver and transition
// decision recorded here is a synthetic, in-product demo business decision that approves nothing real, and no product
// gate (G1-G6) implies any engineering gate (DG0-DG7).
//  1. G5 (REQ-PB-015, REQ-S04-012/013): the live criteria list the missing items; the Lead requests an exception with
//     reason, scope, compensating action and owner and expiry; the Sponsor (the gate's approver) accepts it and it
//     covers the criterion until its expiry.
//  2. Submission with exceptions (REQ-S04-012): the Lead submits G5; the submission records the exception lines.
//  3. Review table and Under Review (REQ-S04-009/010): the Sponsor records a criterion review; the gate is Under review;
//     unreviewed rows read "Not reviewed".
//  4. Scale scope (REQ-S04-007): a G5 approval without scale scope is stopped before sending; with one item it is
//     approved and the approved scope is shown. The Sponsor then revokes an exception with a reason.
//  5. G6 (REQ-PB-021, REQ-S04-008): the G6 page lists 'Ownership transfer' as missing; nothing can be submitted.
//  6. Modular G3 waiver (REQ-PB-005, D-110): the dispensations page refuses a Modular G2 waiver (DG3 text) and records
//     a G3 waiver of the missing links; with it accepted, G3 is submitted and the submission shows the missing links
//     and the waiver; after the waiver is revoked, the approval is refused with the translated
//     gate.modular_waiver_revoked text, which shows the revoke's date (`params.date`, ADR-0038 Q1) localized.
//  7. Closure (REQ-S03-003, REQ-S11-006): the four statuses side by side and the label; closing is refused, translated.
//  8. Transition decisions (REQ-S11-007; ADR-0026 E1-E6): the Business Owner drafts and submits one; the Sponsor
//     returns it; round 2 is submitted after an edit; another Business Owner's withdrawal is refused (403
//     approval.not_requester, translated); the requester withdraws it.
//  9. Read-only auditor; 390 px wide and 200 % text without page-level horizontal scroll.
// Every step: a full-page screenshot per language and axe with 0 serious or critical issues.
import { expect, test, type Locator, type Page } from "@playwright/test";
import { asUser, syntheticUser, type SyntheticUser } from "./support/p3-journey-setup.ts";
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
let mid = "";
let T = "";
let M = "";
let orgId = "";
let iniId = "";
let benefitId = "";
let sp: SyntheticUser;
let bo: SyntheticUser;
let bo2: SyntheticUser;
let auditor: SyntheticUser;
let mSp: SyntheticUser;
let lead: ApiSession;
let spApi: ApiSession;
let mSpApi: ApiSession;
let waiverId = "";
const stamp = Date.now().toString(36);
const RATIONALE = "Synthetic demo decision (approves nothing real).";

/** A business date n days from today (Asia/Riyadh). */
const day = (n: number) => new Date(Date.now() + 3 * 3_600_000 + n * 86_400_000).toISOString().slice(0, 10);

async function go(page: Page, path: string) {
  await page.goto(path);
  await expect(page.locator("main#main h1")).toBeVisible();
}

const submitOf = (dialog: Locator) => dialog.locator("[data-action='submit']");
const field = (dialog: Locator, name: string) => dialog.locator(`[data-field='${name}']`);

async function expectNoPageOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

type GateViewLite = {
  gate: { version: number; latestSubmissionNo: number; status: string };
  criteria: { key: string; mandatory: boolean; completeness: string }[];
};

/** Covers each listed mandatory criterion with an exception requested by `requester` and accepted by `approver`. */
async function cover(base: string, gateCode: string, keys: string[], requester: ApiSession, approver: ApiSession) {
  for (const key of keys) {
    const ex = await requester.call<{ id: string; version: number }>("POST", `${base}/gate-exceptions`, {
      gateCode,
      criterionKey: key,
      reason: `Synthetic: setup coverage of ${key}; this spec does not exercise it.`,
      scope: `Synthetic: ${key} only`,
      compensatingAction: "Synthetic: complete the criterion before the next gate.",
      compensatingOwnerUserId: requester.userId,
      expiresOn: day(60),
    });
    await approver.call(
      "POST",
      `${base}/gate-exceptions/${ex.id}/decision`,
      { outcome: "accepted", note: "Synthetic demo decision." },
      { ifMatch: ex.version },
    );
  }
}

/** API setup of G1-G4 (already covered by the P2/P3 specs on their screens): every mandatory gap covered, approved. */
async function passGate(base: string, code: string, submitter: ApiSession, approver: ApiSession) {
  const view = await submitter.call<GateViewLite>("GET", `${base}/gates/${code}`);
  const missing = view.criteria.filter((c) => c.mandatory && c.completeness !== "complete").map((c) => c.key);
  await cover(base, code, missing, submitter, approver);
  const fresh = await submitter.call<GateViewLite>("GET", `${base}/gates/${code}`);
  await submitter.call(
    "POST",
    `${base}/gates/${code}/submissions`,
    { submissionNote: `Synthetic ${code} submission` },
    { ifMatch: fresh.gate.version },
  );
  const pending = await approver.call<GateViewLite>("GET", `${base}/gates/${code}`);
  await approver.call(
    "POST",
    `${base}/gates/${code}/decision`,
    {
      submissionNo: pending.gate.latestSubmissionNo,
      outcome: "approved",
      rationale: `Synthetic demo approval of ${code} (approves nothing real).`,
      ...(code === "G1" ? { agreements: { problem: true, baseline: true, materialValuePools: true } } : {}),
    },
    { ifMatch: pending.gate.version },
  );
}

test.beforeAll(async ({ playwright }, info) => {
  test.setTimeout(240_000);
  const lang = langOf(info);
  lead = await apiSession(playwright, "dev.lead");
  const admin = await apiSession(playwright, "dev.admin");
  tid = (
    await lead.call<{ id: string }>("POST", "/api/v1/transformations", {
      businessUnitId: SYN_RETAIL,
      name: `Synthetic P4 G5 G6 and closure ${lang.toUpperCase()} ${stamp}`,
      mode: "end_to_end",
    })
  ).id;
  mid = (
    await lead.call<{ id: string }>("POST", "/api/v1/transformations", {
      businessUnitId: SYN_RETAIL,
      name: `Synthetic P4 Modular G3 waiver ${lang.toUpperCase()} ${stamp}`,
      mode: "modular",
      entryPhase: "design",
    })
  ).id;
  T = `/api/v1/transformations/${tid}`;
  M = `/api/v1/transformations/${mid}`;
  orgId = (await admin.call<{ organization: { id: string } }>("GET", "/api/v1/me")).organization.id;
  // Display names sort after the seed "Synthetic Transformation Lead", so the first page of the users list that
  // journeys.spec.ts reads is unchanged by this spec's users.
  const mk = (code: string, role: string, name: string, on = tid) =>
    syntheticUser(admin, orgId, on, `dev.p4gc.${code}.${lang}.${stamp}`, `${name} ${lang}`, role, lang);
  sp = await mk("sp", "SP", "Synthetic Value Sponsor");
  bo = await mk("bo", "BO", "Synthetic Value Owner");
  bo2 = await mk("bo2", "BO", "Synthetic Value Owner Second");
  auditor = await mk("aud", "AUD", "Synthetic Viewer Auditor");
  mSp = await mk("msp", "SP", "Synthetic Waiver Sponsor", mid);
  await admin.call("POST", "/api/v1/role-assignments", {
    userId: auditor.id,
    roleCode: "AUD",
    scope: { type: "transformation", id: mid },
    reason: "Synthetic demo AUD on the Modular transformation (approves nothing real)",
  });
  spApi = await apiSession(playwright, sp.username);
  mSpApi = await apiSession(playwright, mSp.username);
  for (const code of ["G1", "G2", "G3", "G4"]) await passGate(T, code, lead, spApi);
  iniId = (
    await lead.call<{ id: string }>("POST", "/api/v1/initiatives", {
      transformationId: tid,
      name: `Synthetic scale pilot ${lang} ${stamp}`,
    })
  ).id;
  // The Modular G3 criteria are covered by exceptions (the links precondition is what this spec exercises).
  const g3 = await lead.call<GateViewLite>("GET", `${M}/gates/G3`);
  await cover(
    M,
    "G3",
    g3.criteria.filter((c) => c.mandatory && c.completeness !== "complete").map((c) => c.key),
    lead,
    mSpApi,
  );
});

// ------------------------------------------------------------------------------------------------ 1. G5 exceptions

test("1. G5: missing items listed; the Lead requests an exception; the Sponsor accepts it and it covers", async ({
  browser,
}, info) => {
  const lang = langOf(info);
  const leadUi = await asUser(browser, lang, "dev.lead");
  const page = leadUi.page;
  const foreign = trackRequests(page);
  await go(page, `/transformations/${tid}/gates/G5`);
  await expect(page.locator("[data-criterion='g5.performance_evidence']")).toBeVisible();
  await expect(page.locator("[data-criterion='g5.performance_evidence'] [data-missing]").first()).toBeVisible();
  await shot(page, lang, "p4-gates-01-g5-missing");
  await expectAccessible(page, lang, "p4-gates-01-g5-missing");
  await page.locator("[data-action='request-exception']").click();
  const dialog = page.getByRole("dialog");
  await field(dialog, "criterionKey").selectOption("g5.performance_evidence");
  await field(dialog, "reason").fill("Synthetic: the pilot KPI actual arrives after the Finance close.");
  await field(dialog, "scope").fill("Synthetic: the pilot KPI of the retail stores only.");
  await field(dialog, "compensatingAction").fill("Synthetic: weekly manual KPI check by the Lead.");
  await field(dialog, "compensatingOwnerUserId").selectOption(lead.userId);
  // REQ-S04-013: without an expiry nothing is sent.
  await submitOf(dialog).click();
  await expect(field(dialog, "expiresOn")).toHaveAttribute("aria-invalid", "true");
  await field(dialog, "expiresOn").fill(day(30));
  await shot(page, lang, "p4-gates-02-exception-request");
  await expectAccessible(page, lang, "p4-gates-02-exception-request");
  await submitOf(dialog).click();
  await expect(dialog).toBeHidden();
  const row = page.locator("[data-exception='g5.performance_evidence']");
  await expect(row.locator("[data-exception-status='pending']")).toContainText(
    tr(lang, "gates.exception.status.pending"),
  );
  // The requester is never offered the decision.
  await expect(row.locator("[data-action='decide-exception']")).toHaveCount(0);
  expect(foreign).toEqual([]);
  await leadUi.close();

  const spUi = await asUser(browser, lang, sp.username);
  await go(spUi.page, `/transformations/${tid}/gates/G5`);
  const spRow = spUi.page.locator("[data-exception='g5.performance_evidence']");
  await spRow.locator("[data-action='decide-exception']").click();
  const decide = spUi.page.getByRole("dialog");
  await expect(decide.locator("[data-state='business-approval']")).toBeVisible();
  await field(decide, "outcome").selectOption("accepted");
  await field(decide, "note").fill("Synthetic demo decision (approves nothing real).");
  await submitOf(decide).click();
  await expect(decide).toBeHidden();
  await expect(spRow.locator("[data-state='covering']")).toBeVisible();
  await expect(spRow).toContainText("Synthetic: weekly manual KPI check by the Lead.");
  await shot(spUi.page, lang, "p4-gates-03-exception-accepted");
  await expectAccessible(spUi.page, lang, "p4-gates-03-exception-accepted");
  await spUi.close();
});

// ------------------------------------------------------------------------------------------------ 2. submission

test("2. the Lead submits G5 with exceptions; the submission records the exception lines", async ({
  browser,
}, info) => {
  const lang = langOf(info);
  const view = await lead.call<GateViewLite>("GET", `${T}/gates/G5`);
  const covered = new Set(["g5.performance_evidence"]);
  await cover(
    T,
    "G5",
    view.criteria.filter((c) => c.mandatory && c.completeness !== "complete" && !covered.has(c.key)).map((c) => c.key),
    lead,
    spApi,
  );
  const leadUi = await asUser(browser, lang, "dev.lead");
  const page = leadUi.page;
  await go(page, `/transformations/${tid}/gates/G5`);
  await page.getByRole("button", { name: tr(lang, "gates.submit.action"), exact: true }).click();
  const dialog = page.getByRole("dialog");
  // QA-C O-1 (T-DG4-FE-R3): incomplete outputs covered by accepted exceptions are not announced as a refusal; the
  // note counts them from the live gate view, and the server accepts the submission below.
  const live = await lead.call<GateViewLite>("GET", `${T}/gates/G5`);
  const mandatory = live.criteria.filter((c) => c.mandatory);
  const complete = mandatory.filter((c) => c.completeness === "complete").length;
  expect(complete).toBeLessThan(mandatory.length);
  await expect(dialog.locator("[data-submit-coverage='covered']")).toContainText(
    tr(lang, "gates.submit.coveredNote", {
      complete,
      total: mandatory.length,
      covered: mandatory.length - complete,
    }),
  );
  await expect(dialog.locator("[data-submit-coverage='refused']")).toHaveCount(0);
  await shot(page, lang, "p4-gates-03b-submit-dialog-covered");
  await expectAccessible(page, lang, "p4-gates-03b-submit-dialog-covered");
  await dialog.getByRole("button", { name: tr(lang, "gates.submit.confirm") }).click();
  await expect(dialog).toBeHidden();
  await page
    .locator("[data-submission='1']")
    .getByRole("button", { name: new RegExp(tr(lang, "gates.history.view")) })
    .click();
  const frozen = page.locator("[data-frozen-exception='g5.performance_evidence']");
  await expect(frozen).toContainText("Synthetic: the pilot KPI of the retail stores only.");
  await expect(frozen).toContainText("Synthetic: weekly manual KPI check by the Lead.");
  // The submitter cannot review their own submission.
  await expect(page.locator("[data-action='review-criterion']")).toHaveCount(0);
  await shot(page, lang, "p4-gates-04-submitted-with-exceptions");
  await expectAccessible(page, lang, "p4-gates-04-submitted-with-exceptions");
  await leadUi.close();
});

// ------------------------------------------------------------------------------------------------ 3. review table

test("3. the Sponsor records a criterion review: the gate is Under review; unreviewed rows read 'Not reviewed'", async ({
  browser,
}, info) => {
  const lang = langOf(info);
  const spUi = await asUser(browser, lang, sp.username);
  const page = spUi.page;
  await go(page, `/transformations/${tid}/gates/G5`);
  await page
    .locator("[data-submission='1']")
    .getByRole("button", { name: new RegExp(tr(lang, "gates.history.view")) })
    .click();
  const table = page.locator("[data-review-table='1']");
  await expect(table.locator("[data-review-row='g5.adoption'] [data-recommendation='none']")).toContainText(
    tr(lang, "gates.review.notReviewed"),
  );
  await table.locator("[data-review-row='g5.risk_closure'] [data-action='review-criterion']").click();
  const dialog = page.getByRole("dialog");
  await field(dialog, "finding").fill("Synthetic: no open High-impact risk at review time.");
  await field(dialog, "recommendation").selectOption("meets_with_conditions");
  await field(dialog, "openCondition").fill("Synthetic: re-check the RAID register before scaling.");
  await field(dialog, "riskNote").fill("Synthetic: supplier dependency watched weekly.");
  await field(dialog, "rationale").fill("Synthetic demo review rationale.");
  await submitOf(dialog).click();
  await expect(dialog).toBeHidden();
  const reviewed = table.locator("[data-review-row='g5.risk_closure']");
  await expect(reviewed.locator("[data-recommendation='meets_with_conditions']")).toContainText(
    tr(lang, "gates.review.recommendation.meets_with_conditions"),
  );
  await expect(reviewed).toContainText("Synthetic: re-check the RAID register before scaling.");
  await expect(table.locator("[data-review-gate-status='under_review']")).toContainText(
    tr(lang, "gates.status.under_review"),
  );
  await shot(page, lang, "p4-gates-05-review-table-under-review");
  await expectAccessible(page, lang, "p4-gates-05-review-table-under-review");
  await spUi.close();
});

// ------------------------------------------------------------------------------------------------ 4. scale scope

test("4. G5 approval needs the scale scope; approved with one item; the Sponsor revokes an exception", async ({
  browser,
}, info) => {
  const lang = langOf(info);
  const spUi = await asUser(browser, lang, sp.username);
  const page = spUi.page;
  // T-DG4-FE-R3 (ADR-0035 R1): the scope's units come from listScaleScopeBusinessUnits, read with transformation.read.
  const unitsRead = page.waitForResponse(
    (r) => r.request().method() === "GET" && /\/scale-scope\/business-units(\?|$)/.test(r.url()),
  );
  await go(page, `/transformations/${tid}/gates/G5`);
  const unitsRes = await unitsRead;
  expect(unitsRes.status()).toBe(200);
  const units = (
    (await unitsRes.json()) as {
      items: { id: string; code: string; nameEn: string; nameAr: string; selectable: boolean }[];
    }
  ).items;
  const retail = units.find((u) => u.id === SYN_RETAIL)!;
  expect(retail.selectable).toBe(true);
  await expect(page.locator("[data-scale-scope='none']")).toBeVisible();
  await page.getByRole("button", { name: tr(lang, "gates.decision.action"), exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("radio", { name: tr(lang, "gates.outcome.approved") }).check();
  await dialog.locator("textarea").first().fill(RATIONALE);
  await dialog.getByRole("button", { name: tr(lang, "gates.decision.confirm") }).click();
  await expect(dialog.locator("[data-state='scale-scope-invalid']")).toContainText(
    tr(lang, "gates.scale.itemIncomplete"),
  );
  await dialog.locator("[data-scope-initiative='0']").selectOption(iniId);
  // Exactly the selectable units are offered (plus "Choose"), each labelled "CODE name" in the page language.
  const offered = dialog.locator("[data-scope-unit='0'] option:not([value=''])");
  await expect(offered).toHaveCount(units.filter((u) => u.selectable).length);
  await expect(dialog.locator(`[data-scope-unit='0'] option[value='${SYN_RETAIL}']`)).toHaveText(
    `${retail.code} ${lang === "ar" ? retail.nameAr : retail.nameEn}`,
  );
  await dialog.locator("[data-scope-unit='0']").selectOption(SYN_RETAIL);
  await shot(page, lang, "p4-gates-06-g5-decision-scope");
  await expectAccessible(page, lang, "p4-gates-06-g5-decision-scope");
  await dialog.getByRole("button", { name: tr(lang, "gates.decision.confirm") }).click();
  await expect(dialog).toBeHidden();
  await expect(
    page.locator(`[data-scope-item='${iniId}:${SYN_RETAIL}'] [data-scale-unit='${retail.code}']`),
  ).toContainText(lang === "ar" ? retail.nameAr : retail.nameEn);
  // Revoke: the criterion is missing again from now on; the reason is shown.
  const row = page.locator("[data-exception='g5.performance_evidence']");
  await row.locator("[data-action='revoke-exception']").click();
  const revoke = page.getByRole("dialog");
  await field(revoke, "reason").fill("Synthetic: the pilot KPI is now reported; the exception is no longer needed.");
  await submitOf(revoke).click();
  await expect(revoke).toBeHidden();
  await expect(row.locator("[data-exception-status='revoked']")).toContainText(
    tr(lang, "gates.exception.status.revoked"),
  );
  await expect(row.locator("[data-revoke-reason]")).toContainText("Synthetic: the pilot KPI is now reported");
  await shot(page, lang, "p4-gates-07-g5-approved-scope-revoked");
  await expectAccessible(page, lang, "p4-gates-07-g5-approved-scope-revoked");
  await spUi.close();
});

// ------------------------------------------------------------------------------------------------ 5. G6

test("5. G6 lists 'Ownership transfer' as missing and cannot be submitted", async ({ browser }, info) => {
  const lang = langOf(info);
  const leadUi = await asUser(browser, lang, "dev.lead");
  const page = leadUi.page;
  await go(page, `/transformations/${tid}/gates/G6`);
  const ownership = page.locator("[data-criterion='g6.ownership_transfer']");
  await expect(ownership).toHaveAttribute("data-completeness", "incomplete");
  await expect(ownership.locator("[data-missing='g6.performance_area_none']")).toContainText(
    tr(lang, "gates.missingItems.g6__performance_area_none"),
  );
  await expect(page.locator("[data-submit-blocked='true']")).toBeDisabled();
  await shot(page, lang, "p4-gates-08-g6-missing-ownership");
  await expectAccessible(page, lang, "p4-gates-08-g6-missing-ownership");
  await leadUi.close();
});

// ------------------------------------------------------------------------------------------------ 6. Modular waiver

test("6. Modular G3: a G2 waiver is refused (DG3); a G3 links waiver is recorded, used at submission, and its revoke refuses approval", async ({
  browser,
}, info) => {
  const lang = langOf(info);
  const leadUi = await asUser(browser, lang, "dev.lead");
  const page = leadUi.page;
  await go(page, `/transformations/${mid}/dispensations`);
  const record = async (gate: string, reason: string) => {
    await page.getByRole("button", { name: new RegExp(tr(lang, "dispensations.record.action")) }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.locator("[data-kind-hint='modular']")).toHaveText(tr(lang, "gates.modularWaiver.kindHint"));
    await dialog.getByRole("radio", { name: tr(lang, "dispensations.kind.waiver") }).check();
    await dialog.getByLabel(new RegExp(tr(lang, "dispensations.field.gate"))).selectOption(gate);
    await dialog.locator("textarea").first().fill(reason);
    await dialog.locator("input[type='date']").fill(day(30));
    await dialog.getByRole("button", { name: tr(lang, "dispensations.record.submit") }).click();
    return dialog;
  };
  const refused = await record("G2", "Synthetic G2 waiver attempt");
  await expect(refused.getByRole("alert")).toContainText(
    tr(lang, "dispensations.problem.dispensation__waiver_requires_end_to_end"),
  );
  await shot(page, lang, "p4-gates-09-modular-g2-waiver-refused");
  await expectAccessible(page, lang, "p4-gates-09-modular-g2-waiver-refused");
  await refused.getByRole("button", { name: tr(lang, "common.action.cancel") }).click();
  const ok = await record("G3", "Synthetic: the inherited baseline is being located.");
  await expect(ok).toBeHidden();
  await expect(page.locator("[data-modular-links-waiver]").first()).toContainText(
    tr(lang, "gates.modularWaiver.label"),
  );
  await shot(page, lang, "p4-gates-10-modular-links-waiver");
  await expectAccessible(page, lang, "p4-gates-10-modular-links-waiver");
  // The G3 approver accepts it (API; the dispensation decision screen is DG3's and unchanged).
  const list = await lead.call<{ items: { id: string; gateCode: string; version: number; status: string }[] }>(
    "GET",
    `${M}/gate-dispensations`,
  );
  const w = list.items.find((d) => d.gateCode === "G3" && d.status === "pending")!;
  waiverId = w.id;
  await mSpApi.call(
    "POST",
    `${M}/gate-dispensations/${w.id}/decision`,
    { result: "accepted", note: "Synthetic demo decision." },
    { ifMatch: w.version },
  );
  await go(page, `/transformations/${mid}/gates/G3`);
  await page.getByRole("button", { name: tr(lang, "gates.submit.action"), exact: true }).click();
  const submit = page.getByRole("dialog");
  await submit.getByRole("button", { name: tr(lang, "gates.submit.confirm") }).click();
  await expect(submit).toBeHidden();
  await page
    .locator("[data-submission='1']")
    .getByRole("button", { name: new RegExp(tr(lang, "gates.history.view")) })
    .click();
  const links = page.locator("[data-modular-links]");
  await expect(links.locator("[data-missing-link='baseline_missing']")).toContainText(
    tr(lang, "problems.baseline_missing"),
  );
  await expect(links.locator("[data-missing-link='outcome_link_missing']")).toContainText(
    tr(lang, "problems.outcome_link_missing"),
  );
  await expect(links.locator(`[data-modular-waiver='${waiverId}']`)).toContainText(
    "Synthetic: the inherited baseline is being located.",
  );
  await shot(page, lang, "p4-gates-11-g3-submitted-under-waiver");
  await expectAccessible(page, lang, "p4-gates-11-g3-submitted-under-waiver");
  await leadUi.close();
  // The approver revokes the waiver; approving the frozen submission is then refused.
  const all = await mSpApi.call<{ items: { id: string; version: number }[] }>("GET", `${M}/gate-dispensations`);
  const fresh = all.items.find((d) => d.id === waiverId)!;
  await mSpApi.call(
    "POST",
    `${M}/gate-dispensations/${waiverId}/revoke`,
    { reason: "Synthetic: the inherited baseline could not be found." },
    { ifMatch: fresh.version },
  );
  const spUi = await asUser(browser, lang, mSp.username);
  await go(spUi.page, `/transformations/${mid}/gates/G3`);
  await spUi.page.getByRole("button", { name: tr(lang, "gates.decision.action"), exact: true }).click();
  const decide = spUi.page.getByRole("dialog");
  await decide.getByRole("radio", { name: tr(lang, "gates.outcome.approved") }).check();
  await decide.locator("textarea").first().fill(RATIONALE);
  const refusal = spUi.page.waitForResponse(
    (r) => r.request().method() === "POST" && r.url().endsWith(`${M}/gates/G3/decision`),
  );
  await decide.getByRole("button", { name: tr(lang, "gates.decision.confirm") }).click();
  // T-DG4-FE-R3 (ADR-0038 Q1): the refusal carries params.date (the revoke's business date, the date in `detail`),
  // and the screen shows it as a localized business date inside the translated text, never as the raw "YYYY-MM-DD".
  const refusedRes = await refusal;
  expect(refusedRes.status()).toBe(422);
  const problem = (await refusedRes.json()) as { code: string; detail: string; params?: { date?: string } };
  expect(problem.code).toBe("gate.modular_waiver_revoked");
  const date = problem.params?.date ?? "";
  expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(problem.detail).toContain(date);
  const alert = decide.getByRole("alert");
  await expect(alert).toHaveAttribute("data-problem", "gate.modular_waiver_revoked");
  // The date as lib/format.ts formatBusinessDate renders it, computed by the same browser.
  const shown = await spUi.page.evaluate(
    ([d, l]) => new Intl.DateTimeFormat(l, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`)),
    [date, lang === "ar" ? "ar-u-ca-gregory-nu-latn" : "en-GB"] as const,
  );
  const [before, after] = tr(lang, "problems.gate__modular_waiver_revoked").split("{{date, businessDate}}");
  expect(after, "the text has its date placeholder").toBeDefined();
  await expect(alert).toContainText(`${before}${shown}${after}`);
  await expect(alert).not.toContainText(date);
  await shot(spUi.page, lang, "p4-gates-12-g3-approval-refused-waiver-revoked");
  await expectAccessible(spUi.page, lang, "p4-gates-12-g3-approval-refused-waiver-revoked");
  await spUi.close();
});

// ------------------------------------------------------------------------------------------------ 7. closure

test("7. closure: four statuses side by side and the label; closing is refused with a translated reason", async ({
  browser,
}, info) => {
  const lang = langOf(info);
  const leadUi = await asUser(browser, lang, "dev.lead");
  const page = leadUi.page;
  await go(page, `/transformations/${tid}/closure`);
  await expect(page.locator("[data-transformation-label]")).toContainText(tr(lang, "closureP4.label.inDelivery"));
  for (const card of ["delivery", "value", "bau", "closure"])
    await expect(page.locator(`[data-status-card='${card}']`)).toBeVisible();
  const row = page.locator("[data-initiative-status]").first();
  await expect(row).toHaveAttribute("data-label", "In delivery");
  for (const group of ["delivery", "adoption", "value", "closure"])
    await expect(row.locator(`[data-status-group='${group}']`)).toBeVisible();
  await expect(row.locator("[data-status-group='value']")).toHaveAttribute("data-status-value", "no_benefit");
  expect((await page.locator("main").textContent())!.toLowerCase()).not.toContain("success");
  await page.locator("[data-action='close-transformation']").click();
  const dialog = page.getByRole("dialog");
  await submitOf(dialog).click();
  const alert = dialog.getByRole("alert");
  await expect(alert).toHaveAttribute("data-problem", /^closure\./);
  const code = (await alert.getAttribute("data-problem"))!;
  await expect(alert).toContainText(tr(lang, `problems.${code.replace(/\./g, "__")}`));
  await shot(page, lang, "p4-closure-01-statuses-close-refused");
  await expectAccessible(page, lang, "p4-closure-01-statuses-close-refused");
  await leadUi.close();
});

// ------------------------------------------------------------------------------------------------ 8. transitions

test("8. transition decision: submitted, returned, round 2 after an edit; a non-requester's withdrawal is refused", async ({
  browser,
  playwright,
}, info) => {
  const lang = langOf(info);
  const boApi = await apiSession(playwright, bo.username);
  benefitId = (
    await boApi.call<{ id: string }>("POST", `${T}/benefits`, {
      title: `Synthetic residual churn benefit ${lang} ${stamp}`,
      description: "Synthetic benefit still to be realized after closure.",
      benefitType: "revenue",
      valueClass: "revenue_uplift",
      financialStatementLine: "Synthetic revenue line",
      ownerUserId: bo.id,
      currency: "SAR",
    })
  ).id;
  // The transition-decision approval is routed to the SP party; map it to the synthetic Sponsor (an unmapped party is a
  // visible routing error, ADR-0026; the role-mapping screen is FE-A's and covered by p4-governance.spec.ts).
  await lead.call("POST", `${T}/role-mappings`, { partyCode: "SP", targetKind: "user", userId: sp.id });
  const boUi = await asUser(browser, lang, bo.username);
  const page = boUi.page;
  await go(page, `/transformations/${tid}/closure`);
  await expect(page.locator("[data-state='forecast-stays-forecast']")).toBeVisible();
  await page.locator("[data-action='create-transition-decision']").click();
  let dialog = page.getByRole("dialog");
  await field(dialog, "benefitId").selectOption(benefitId);
  await field(dialog, "residualOwnerUserId").selectOption(bo.id);
  await field(dialog, "rationale").fill("Synthetic: the churn benefit matures after closure.");
  await field(dialog, "expectedRealizationEnd").fill(day(300));
  await field(dialog, "firstMonitoringDate").fill(day(30));
  await submitOf(dialog).click();
  await expect(dialog).toBeHidden();
  const row = page.locator("[data-transition-decision]").first();
  await expect(row).toHaveAttribute("data-status", "draft");
  await row.locator("[data-action='submit-decision']").click();
  dialog = page.getByRole("dialog");
  await submitOf(dialog).click();
  await expect(dialog).toBeHidden();
  await expect(row).toHaveAttribute("data-status", "submitted");
  // The Sponsor returns it for changes (API; the approvals screen is FE-A's).
  const decisions = await boApi.call<{ items: { id: string; approvalId: string }[] }>(
    "GET",
    `${T}/transition-decisions`,
  );
  const approvalId = decisions.items[0]!.approvalId;
  const approval = await spApi.call<{ subjectVersion: number; version: number }>(
    "GET",
    `/api/v1/approvals/${approvalId}`,
  );
  await spApi.call(
    "POST",
    `/api/v1/approvals/${approvalId}/decisions`,
    {
      outcome: "request_changes",
      rationale: "Synthetic: name the monitoring KPI in the rationale.",
      subjectVersion: approval.subjectVersion,
    },
    { ifMatch: approval.version },
  );
  await page.reload();
  await expect(row.locator("[data-action='resubmit-decision']")).toContainText(
    tr(lang, "closureP4.decisions.resubmitRound", { n: 2 }),
  );
  await expect(row).toContainText(tr(lang, "closureP4.decisions.returned"));
  await row.locator("[data-action='edit-decision']").click();
  dialog = page.getByRole("dialog");
  await field(dialog, "rationale").fill(
    "Synthetic: the churn benefit matures after closure; monitored on the churn KPI.",
  );
  await submitOf(dialog).click();
  await expect(dialog).toBeHidden();
  await row.locator("[data-action='resubmit-decision']").click();
  dialog = page.getByRole("dialog");
  await submitOf(dialog).click();
  await expect(dialog).toBeHidden();
  await expect(row).toHaveAttribute("data-status", "submitted");
  await expect(row).toHaveAttribute("data-round", "2");
  await shot(page, lang, "p4-closure-02-transition-round-2");
  await expectAccessible(page, lang, "p4-closure-02-transition-round-2");

  // Another Business Owner (holding transition_decision.propose) cannot withdraw it while it is in approval.
  const other = await asUser(browser, lang, bo2.username);
  await go(other.page, `/transformations/${tid}/closure`);
  const otherRow = other.page.locator("[data-transition-decision]").first();
  await expect(otherRow.locator("[data-requester-only]")).toBeVisible();
  await otherRow.locator("[data-action='withdraw-decision']").click();
  const withdraw = other.page.getByRole("dialog");
  await submitOf(withdraw).click();
  await expect(withdraw.getByRole("alert")).toHaveAttribute("data-problem", "approval.not_requester");
  await expect(withdraw.getByRole("alert")).toContainText(tr(lang, "problems.approval__not_requester"));
  await shot(other.page, lang, "p4-closure-03-withdraw-not-requester");
  await expectAccessible(other.page, lang, "p4-closure-03-withdraw-not-requester");
  await other.close();

  // The requester withdraws it.
  await row.locator("[data-action='withdraw-decision']").click();
  dialog = page.getByRole("dialog");
  await submitOf(dialog).click();
  await expect(dialog).toBeHidden();
  await expect(row).toHaveAttribute("data-status", "withdrawn");
  await boUi.close();
});

// ------------------------------------------------------------------------------------------------ 9. read-only, narrow

test("9. the auditor sees read-only views; 390 px wide and 200 % text without page-level horizontal scroll", async ({
  browser,
}, info) => {
  const lang = langOf(info);
  const audUi = await asUser(browser, lang, auditor.username);
  const page = audUi.page;
  await go(page, `/transformations/${tid}/gates/G5`);
  await expect(page.locator("[data-state='read-only']")).toBeVisible();
  await expect(page.locator("[data-action='request-exception'], [data-action='revoke-exception']")).toHaveCount(0);
  await go(page, `/transformations/${tid}/closure`);
  await expect(page.locator("[data-state='read-only']")).toBeVisible();
  await expect(
    page.locator("[data-action='close-transformation'], [data-action='create-transition-decision']"),
  ).toHaveCount(0);
  await shot(page, lang, "p4-closure-04-auditor-read-only");
  await expectAccessible(page, lang, "p4-closure-04-auditor-read-only");
  const paths = [
    [`/transformations/${tid}/gates/G5`, "g5"],
    [`/transformations/${tid}/gates/G6`, "g6"],
    [`/transformations/${mid}/gates/G3`, "g3-modular"],
    [`/transformations/${tid}/closure`, "closure"],
  ] as const;
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [path, name] of paths) {
    await go(page, path);
    await expectNoPageOverflow(page);
    await expectAccessible(page, lang, `p4-gates-390-${name}`);
  }
  await shot(page, lang, "p4-closure-05-390px");
  await page.setViewportSize({ width: 1280, height: 900 });
  for (const [path, name] of paths) {
    await go(page, path);
    await page.evaluate(() => (document.documentElement.style.fontSize = "200%"));
    await expectNoPageOverflow(page);
    await expectAccessible(page, lang, `p4-gates-200pct-${name}`);
  }
  await shot(page, lang, "p4-closure-06-200pct-text");
  await audUi.close();
});
