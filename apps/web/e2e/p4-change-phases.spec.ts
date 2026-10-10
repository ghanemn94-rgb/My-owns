// P4 slice H change control, the phase workspace, scale transitions and risk dispositions on the REAL stack
// (support/with-stack.sh; no mocks): T-DG4-FE-F2 (p4-work-split §H H.6). Every record is SYNTHETIC demo data. Every
// approval decision here is a synthetic, in-product demo business decision that approves nothing real, and no product
// gate (G1-G6) implies any engineering gate (DG0-DG7).
//  1. Phases (REQ-PB-014, REQ-S04-001): the catalogue lists six phases in order; a step with no record (version 0)
//     shows owner Unknown; the Lead assigns the owner (the first save sends If-Match "0") and starts it; requesting
//     review with no verified evidence is refused with the translated phase_step.completion_rule_unmet; the gate stays.
//  2. Materiality policy: read at version 0; the first save (If-Match "0") configures a 5-working-day threshold.
//  3. Change request (REQ-S09-010, REQ-S04-014): the Lead raises a schedule rebaseline on an approved milestone; the
//     form shows the forecast separately; the preview shows materiality and the preserved G4 approval; the draft is a
//     saved draft; on submit it is routed to the Sponsor with a frozen assessment (SHA-256) and the approved date is
//     unchanged.
//  4. Round 2 (ADR-0026 E1-E6): the Sponsor requests changes; the Lead edits and submits round 2; the Sponsor approves;
//     the milestone's approved date becomes the requested one; the G4 approval still reads approved.
//  5. G5 (REQ-S03-004, REQ-PB-020): scaling before G5 is refused with the translated invalid-transition naming G5; the
//     Lead proposes a disposition for the open High-impact risk and it reads pending.
//  6. Read-only auditor; 390 px wide and 200 % text without page-level horizontal scroll.
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
let T = "";
let orgId = "";
let iniId = "";
let milestoneId = "";
let crId = "";
let sp: SyntheticUser;
let auditor: SyntheticUser;
let lead: ApiSession;
let spApi: ApiSession;
const stamp = Date.now().toString(36);

/** A business date n days from today (Asia/Riyadh). */
const day = (n: number) => new Date(Date.now() + 3 * 3_600_000 + n * 86_400_000).toISOString().slice(0, 10);
const APPROVED = day(90);
const PROPOSED = day(150);
const PROPOSED_2 = day(160);

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

/** API setup of G1-G4 (their screens are covered by the P2/P3 specs): mandatory gaps covered, then approved. */
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

/** The Sponsor decides the change request's business approval through the canonical approval (synthetic). */
async function decide(outcome: "approve" | "request_changes") {
  const cr = await lead.call<{ approvalId: string }>("GET", `${T}/change-requests/${crId}`);
  const approval = await spApi.call<{ version: number; subjectVersion: number }>(
    "GET",
    `/api/v1/approvals/${cr.approvalId}`,
  );
  await spApi.call(
    "POST",
    `/api/v1/approvals/${cr.approvalId}/decisions`,
    {
      outcome,
      rationale:
        outcome === "approve"
          ? "Synthetic demo approval (approves nothing real)."
          : "Synthetic: move the date by ten more days to cover the data migration.",
      subjectVersion: approval.subjectVersion,
    },
    { ifMatch: approval.version },
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
      name: `Synthetic P4 change control and phases ${lang.toUpperCase()} ${stamp}`,
      mode: "end_to_end",
    })
  ).id;
  T = `/api/v1/transformations/${tid}`;
  orgId = (await admin.call<{ organization: { id: string } }>("GET", "/api/v1/me")).organization.id;
  // Display names sort after the seed "Synthetic Transformation Lead" (journeys.spec.ts reads the first users page).
  const mk = (code: string, role: string, name: string) =>
    syntheticUser(admin, orgId, tid, `dev.p4cr.${code}.${lang}.${stamp}`, `${name} ${lang}`, role, lang);
  sp = await mk("sp", "SP", "Synthetic Venture Sponsor");
  auditor = await mk("aud", "AUD", "Synthetic Viewer Change Auditor");
  spApi = await apiSession(playwright, sp.username);
  // Change requests and risk dispositions route to the SP party; map it to the synthetic Sponsor (an unmapped party is
  // the visible routing error of ADR-0026; the role-mapping screen is FE-A's and covered by p4-governance.spec.ts).
  await lead.call("POST", `${T}/role-mappings`, { partyCode: "SP", targetKind: "user", userId: sp.id });
  for (const code of ["G1", "G2", "G3", "G4"]) await passGate(T, code, lead, spApi);
  iniId = (
    await lead.call<{ id: string }>("POST", "/api/v1/initiatives", {
      transformationId: tid,
      name: `Synthetic rebaseline pilot ${lang} ${stamp}`,
    })
  ).id;
  const ms = await lead.call<{ id: string; version: number }>("POST", `/api/v1/initiatives/${iniId}/milestones`, {
    title: `Synthetic cut-over ${lang} ${stamp}`,
    forecastDate: day(100),
  });
  await lead.call(
    "POST",
    `/api/v1/milestones/${ms.id}/approve-date`,
    { approvedDate: APPROVED, reason: "Synthetic baseline date." },
    { ifMatch: ms.version },
  );
  milestoneId = ms.id;
  await lead.call("POST", `${T}/raid`, {
    type: "risk",
    description: `Synthetic: the billing cut-over may slip (${lang} ${stamp}).`,
    impact: "high",
    probability: "medium",
    ownerUserId: lead.userId,
  });
});

// ------------------------------------------------------------------------------------------------ 1. phases

test("1. phases: six phases in order; a version-0 step is assigned and started; an unmet rule is refused", async ({
  browser,
}, info) => {
  const lang = langOf(info);
  const ui = await asUser(browser, lang, "dev.lead");
  const page = ui.page;
  const foreign = trackRequests(page);
  await go(page, `/transformations/${tid}/phases`);
  const catalogue = page.locator("[data-phase-catalogue='6']");
  await expect(catalogue).toBeVisible();
  await expect(catalogue.locator("[data-phase]")).toHaveCount(6);
  expect(
    await catalogue.locator("[data-phase]").evaluateAll((rows) => rows.map((r) => r.getAttribute("data-phase"))),
  ).toEqual(["diagnose", "define", "design", "mobilize", "transform", "realize"]);
  await page.locator("[data-phase-tab='diagnose']").click();
  const panel = page.locator("[data-phase-panel='diagnose']");
  await expect(panel.locator("[data-phase-objective='diagnose']")).not.toBeEmpty();
  const first = panel.locator("[data-step]").first();
  await expect(first).toHaveAttribute("data-version", "0");
  await expect(first.locator("[data-owner='unknown']")).toContainText(tr(lang, "common.value.unknown"));
  await shot(page, lang, "p4-phases-01-catalogue-workspace");
  await expectAccessible(page, lang, "p4-phases-01-catalogue-workspace");
  const stepKey = (await first.getAttribute("data-step"))!;

  // Assign the owner: the first save of a step with no record sends If-Match "0" (D-109).
  const patch = page.waitForRequest((r) => r.method() === "PATCH" && r.url().endsWith(`/phase-steps/${stepKey}`));
  await first.locator("[data-action='step-owner']").click();
  let dialog = page.getByRole("dialog");
  await field(dialog, "ownerUserId").selectOption(lead.userId);
  await submitOf(dialog).click();
  expect((await patch).headers()["if-match"]).toBe('"0"');
  await expect(dialog).toBeHidden();
  const row = panel.locator(`[data-step='${stepKey}']`);
  await expect(row).toHaveAttribute("data-version", "1");
  await row.locator("[data-action='step-start']").click();
  dialog = page.getByRole("dialog");
  await submitOf(dialog).click();
  await expect(dialog).toBeHidden();
  await expect(row.locator("[data-step-status='in_progress']")).toBeVisible();

  // Request review with no verified evidence: refused, translated (REQ-S04-001).
  await row.locator("[data-action='step-request']").click();
  dialog = page.getByRole("dialog");
  await submitOf(dialog).click();
  await expect(dialog.getByRole("alert")).toContainText(tr(lang, "problems.phase_step__completion_rule_unmet"));
  if (lang === "ar") await expect(dialog.getByRole("alert")).not.toContainText("verified evidence");
  await shot(page, lang, "p4-phases-02-completion-rule-unmet");
  await expectAccessible(page, lang, "p4-phases-02-completion-rule-unmet");
  await dialog.getByRole("button", { name: tr(lang, "common.action.cancel") }).click();
  // Steps never move a gate (REQ-S04-002 first clause): G1 is still the approved setup decision, untouched.
  await expect(panel.locator("[data-gate-status='approved']")).toBeVisible();
  await expect(page.locator("[data-review-queue]")).toHaveCount(0);
  expect(foreign).toEqual([]);
  await ui.close();
});

// ------------------------------------------------------------------------------------------------ 2. policy

test('2. the materiality policy is read at version 0 and its first save sends If-Match "0"', async ({
  browser,
}, info) => {
  const lang = langOf(info);
  const ui = await asUser(browser, lang, "dev.lead");
  const page = ui.page;
  await go(page, `/transformations/${tid}/change-requests`);
  const facts = page.locator("[data-policy-version]");
  await expect(facts).toHaveAttribute("data-policy-version", "0");
  await expect(facts.locator("[data-policy-date='none']")).toContainText(
    tr(lang, "changeRequestsP4.policy.noThreshold"),
  );
  const put = page.waitForRequest((r) => r.method() === "PUT" && r.url().endsWith("/change-control-policy"));
  await page.locator("[data-action='edit-policy']").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.locator("[data-policy-first-save]")).toBeVisible();
  await dialog.locator("[data-field='days']").fill("5");
  await submitOf(dialog).click();
  expect((await put).headers()["if-match"]).toBe('"0"');
  await expect(dialog).toBeHidden();
  await expect(page.locator("[data-policy-date='5']")).toContainText(
    tr(lang, "changeRequestsP4.policy.days", { n: 5 }),
  );
  await expect(page.locator("[data-policy-version='1']")).toBeVisible();
  await shot(page, lang, "p4-change-01-policy");
  await expectAccessible(page, lang, "p4-change-01-policy");
  await ui.close();
});

// ------------------------------------------------------------------------------------------------ 3. raise and submit

test("3. the Lead raises a schedule rebaseline: preview, saved draft, submit to the Sponsor, frozen assessment", async ({
  browser,
}, info) => {
  const lang = langOf(info);
  const ui = await asUser(browser, lang, "dev.lead");
  const page = ui.page;
  const foreign = trackRequests(page);
  await go(page, `/transformations/${tid}/change-requests`);
  await page.locator("[data-action='raise-change-request']").click();
  const dialog = page.getByRole("dialog");
  await field(dialog, "subjectType").selectOption("milestone");
  await field(dialog, "initiativeId").selectOption(iniId);
  await expect(field(dialog, "subjectId").locator(`option[value='${milestoneId}']`)).toHaveCount(1);
  await field(dialog, "subjectId").selectOption(milestoneId);
  await field(dialog, "changeKind").selectOption("schedule_rebaseline");
  // REQ-S09-010: the forecast is shown separately from the approved date.
  await expect(dialog.locator("[data-forecast-shown]")).toContainText(day(100));
  await field(dialog, "to_approvedDate").fill(PROPOSED);
  await field(dialog, "reason").fill("Synthetic: the vendor moved the cut-over window.");
  await dialog.locator("[data-action='preview-impact']").click();
  const preview = dialog.locator("[data-impact-preview='draft']");
  await expect(preview.locator("[data-materiality='material']")).toBeVisible();
  await expect(preview.locator("[data-gate-item='G4'][data-preserved='true']")).toBeVisible();
  await shot(page, lang, "p4-change-02-raise-preview");
  await expectAccessible(page, lang, "p4-change-02-raise-preview");
  await submitOf(dialog).click();
  await expect(dialog).toBeHidden();
  const view = page.locator("[data-change-request]");
  await expect(view).toHaveAttribute("data-status", "draft");
  await expect(view.locator("[data-state='saved-draft']")).toContainText(tr(lang, "changeRequestsP4.detail.draftNote"));
  crId = page.url().split("/").pop()!;
  await shot(page, lang, "p4-change-03-saved-draft");
  await expectAccessible(page, lang, "p4-change-03-saved-draft");

  await view.locator("[data-action='submit-change-request']").click();
  const confirm = page.getByRole("dialog");
  await submitOf(confirm).click();
  await expect(confirm).toBeHidden();
  await expect(view).toHaveAttribute("data-status", "submitted");
  await expect(view.locator("[data-route-party='SP']")).toContainText(tr(lang, "changeRequestsP4.party.SP"));
  await expect(view.locator("[data-open-approval]")).toBeVisible();
  const ia = page.locator("[data-assessment-version]").first();
  await expect(ia).toHaveAttribute("data-current", "true");
  await expect(ia.locator("[data-sha256]")).toHaveText(/^[0-9a-f]{64}$/);
  await expect(ia.locator("[data-gate-item='G4'][data-preserved='true']")).toBeVisible();
  // Until it is approved, the approved date is unchanged.
  const m = await lead.call<{ approvedDate: string; forecastDate: string }>("GET", `/api/v1/milestones/${milestoneId}`);
  expect(m.approvedDate).toBe(APPROVED);
  expect(m.forecastDate).toBe(day(100));
  await shot(page, lang, "p4-change-04-submitted-assessment");
  await expectAccessible(page, lang, "p4-change-04-submitted-assessment");
  expect(foreign).toEqual([]);
  await ui.close();
});

// ------------------------------------------------------------------------------------------------ 4. round 2

test("4. returned by the Sponsor, edited and submitted as round 2, then approved and applied", async ({
  browser,
}, info) => {
  const lang = langOf(info);
  await decide("request_changes");
  const ui = await asUser(browser, lang, "dev.lead");
  const page = ui.page;
  await go(page, `/transformations/${tid}/change-requests/${crId}`);
  const view = page.locator("[data-change-request]");
  await expect(view).toHaveAttribute("data-status", "changes_requested");
  await expect(view.locator("[data-state='returned']")).toBeVisible();
  await view.locator("[data-action='edit-change-request']").click();
  const edit = page.getByRole("dialog");
  await field(edit, "to_approvedDate").fill(PROPOSED_2);
  await submitOf(edit).click();
  await expect(edit).toBeHidden();
  const resubmit = view.locator("[data-action='resubmit-change-request']");
  await expect(resubmit).toContainText(tr(lang, "changeRequestsP4.detail.resubmitRound", { n: 2 }));
  await resubmit.click();
  const confirm = page.getByRole("dialog");
  await submitOf(confirm).click();
  await expect(confirm).toBeHidden();
  await expect(view).toHaveAttribute("data-status", "submitted");
  await expect(view).toHaveAttribute("data-round", "2");
  await expect(page.locator("[data-assessment-version]")).toHaveCount(2);
  await shot(page, lang, "p4-change-05-round-2");
  await expectAccessible(page, lang, "p4-change-05-round-2");

  await decide("approve");
  await page.reload();
  await expect(view).toHaveAttribute("data-status", "approved");
  await expect(view.locator("[data-applied]")).toBeVisible();
  const m = await lead.call<{ approvedDate: string }>("GET", `/api/v1/milestones/${milestoneId}`);
  expect(m.approvedDate).toBe(PROPOSED_2);
  // The original G4 approval is preserved: the gate still reads approved.
  const g4 = await lead.call<GateViewLite>("GET", `${T}/gates/G4`);
  expect(g4.gate.status).toBe("approved");
  await shot(page, lang, "p4-change-06-approved-applied");
  await expectAccessible(page, lang, "p4-change-06-approved-applied");
  await ui.close();
});

// ------------------------------------------------------------------------------------------------ 5. G5

test("5. G5: scaling before approval is refused naming G5; a disposition is proposed for the open risk", async ({
  browser,
}, info) => {
  const lang = langOf(info);
  const ui = await asUser(browser, lang, "dev.lead");
  const page = ui.page;
  await go(page, `/transformations/${tid}/gates/G5`);
  await page.locator("[data-action='scale-initiative']").click();
  let dialog = page.getByRole("dialog");
  await field(dialog, "initiativeId").selectOption(iniId);
  await field(dialog, "businessUnitId").selectOption({ index: 1 });
  await submitOf(dialog).click();
  const alert = dialog.getByRole("alert");
  await expect(alert).toContainText(tr(lang, "problems.gate__g5_not_approved"));
  await expect(alert).toContainText("G5");
  await expect(alert).toHaveAttribute("data-problem", "gate.g5_not_approved");
  await shot(page, lang, "p4-scale-01-refused-before-g5");
  await expectAccessible(page, lang, "p4-scale-01-refused-before-g5");
  await dialog.getByRole("button", { name: tr(lang, "common.action.cancel") }).click();

  const risk = page.locator("[data-risk][data-risk-dispositioned='false']").first();
  await expect(risk.locator("[data-impact='high']")).toBeVisible();
  await risk.locator("[data-action='propose-disposition']").click();
  dialog = page.getByRole("dialog");
  await field(dialog, "disposition").selectOption("carry_into_bau");
  await field(dialog, "residualOwnerUserId").selectOption(lead.userId);
  await field(dialog, "rationale").fill("Synthetic: the BAU owner carries the residual cut-over risk.");
  await submitOf(dialog).click();
  await expect(dialog).toBeHidden();
  await expect(risk.locator("[data-disposition='carry_into_bau']")).toHaveAttribute("data-approval-status", "pending");
  // Pending is not closed: the row still reads not dispositioned.
  await expect(risk).toHaveAttribute("data-risk-dispositioned", "false");
  await shot(page, lang, "p4-risk-01-disposition-pending");
  await expectAccessible(page, lang, "p4-risk-01-disposition-pending");
  await ui.close();
});

// ------------------------------------------------------------------------------------------------ 6. auditor, 390 px, 200 %

test("6. the auditor reads without write actions; 390 px and 200 % text have no page-level overflow", async ({
  browser,
}, info) => {
  const lang = langOf(info);
  const aud = await asUser(browser, lang, auditor.username);
  await go(aud.page, `/transformations/${tid}/change-requests`);
  await expect(aud.page.locator("[data-cr-link]").first()).toBeVisible();
  await expect(aud.page.locator("[data-action='raise-change-request']")).toHaveCount(0);
  await expect(aud.page.locator("[data-action='edit-policy']")).toHaveCount(0);
  await go(aud.page, `/transformations/${tid}/phases`);
  await expect(aud.page.locator("[data-action='step-owner']")).toHaveCount(0);
  await shot(aud.page, lang, "p4-change-07-auditor-read-only");
  await expectAccessible(aud.page, lang, "p4-change-07-auditor-read-only");
  await aud.close();

  const ui = await asUser(browser, lang, "dev.lead");
  const page = ui.page;
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of [`phases`, `change-requests`, `change-requests/${crId}`, `gates/G5`]) {
    await go(page, `/transformations/${tid}/${path}`);
    await expectNoPageOverflow(page);
  }
  await shot(page, lang, "p4-change-08-390px");
  await expectAccessible(page, lang, "p4-change-08-390px");
  await page.setViewportSize({ width: 1280, height: 900 });
  for (const path of [`phases`, `change-requests/${crId}`]) {
    await go(page, `/transformations/${tid}/${path}`);
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "200%";
    });
    await expectNoPageOverflow(page);
  }
  await shot(page, lang, "p4-change-09-200pct-text");
  await expectAccessible(page, lang, "p4-change-09-200pct-text");
  await ui.close();
});
