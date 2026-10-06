// P2 negative journeys for blank free text (F-DG2-210) and the form error banner (F-DG2-211), against the REAL API and
// PostgreSQL (support/with-stack.sh; no mocks), in the project's language (chromium-en -> English LTR, chromium-ar ->
// Arabic RTL). Each step takes a full-page screenshot (screenshots/<lang>/p2-blank-*.png) and runs axe; any serious or
// critical violation fails the step.
//
// What is asserted:
//  - text that is non-empty but has no visible content is an inline `validation.blank` error on its field
//    (aria-invalid, aria-describedby, focus) and NOTHING is sent: no charter is created, no charter version is written,
//    an existing Out of scope is not cleared, and no T01 PATCH is sent;
//  - a change summary alone is "There are no changes to save." in a live region that wraps a real list (no axe
//    `listitem` violation in that state);
//  - T-DG2-FE6, the hand-written P2 forms: a whitespace gate submission note submits nothing (the gate stays a draft
//    with no submission) and visible text is stored verbatim; a whitespace gate decision rationale decides nothing (the
//    submission stays pending, no decision); a whitespace journey-step actor writes no journey version; an
//    invisible-only archive reason ("\u200f" x4) in the reason dialog archives nothing.
// All data is SYNTHETIC and created by the synthetic dev users (`dev.lead`, `dev.office`, `dev.admin`); nothing here is
// Mobily data. The G1 submission below is a synthetic demo submission: no business approval is granted, and product
// gates G1-G6 never imply any engineering gate (DG0-DG7).
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Browser, type Locator, type Page, type PlaywrightWorkerArgs } from "@playwright/test";
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
  rowAction,
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
  writeFileSync(join(SHOTS, lang, "axe-summary-p2-blank.json"), `${JSON.stringify(axeSummary, null, 2)}\n`);
});

let tid = "";
const leadSession = (playwright: PlaywrightWorkerArgs["playwright"]): Promise<ApiSession> =>
  apiSession(playwright, "dev.lead");
const ws = (tab: string) => `/transformations/${tid}/${tab}`;
const charterUrl = () => `/api/v1/transformations/${tid}/charter`;

/** Every mutating request the page sends (method and path), to prove that nothing was sent. */
function trackMutations(page: Page): string[] {
  const sent: string[] = [];
  page.on("request", (req) => {
    if (req.method() !== "GET" && req.method() !== "HEAD") sent.push(`${req.method()} ${new URL(req.url()).pathname}`);
  });
  return sent;
}

/** The field shows the localized blank message, linked by aria-describedby, carries aria-invalid and has focus. */
async function expectBlankError(lang: Lang, labelKey: string, scope: Page | Locator) {
  const field = scope.getByLabel(fieldLabel(lang, labelKey));
  const message = tr(lang, "problems.validation__blank");
  await expect(field).toHaveAttribute("aria-invalid", "true");
  await expect(field).toHaveAccessibleDescription(new RegExp(escape(message)));
  await expect(field).toBeFocused();
  await expect(scope.getByText(message, { exact: false })).toBeVisible();
}

test("setup: a fresh End-to-End transformation for the blank-text checks", async ({ playwright }, info) => {
  const lang = langOf(info);
  const lead = await leadSession(playwright);
  const created = await lead.call<{ id: string }>("POST", "/api/v1/transformations", {
    businessUnitId: SYN_RETAIL,
    name: `Synthetic blank-text ${lang.toUpperCase()} check`,
    mode: "end_to_end",
  });
  tid = created.id;
  await lead.call("GET", charterUrl(), undefined, { expect: 404 });
});

test("Charter create: a whitespace Case for change is an inline error and creates no charter", async ({
  page,
  playwright,
}, info) => {
  const lang = langOf(info);
  const lead = await leadSession(playwright);
  const foreign = trackRequests(page);
  await signIn(page, lang, "dev.lead");
  const sent = trackMutations(page);
  await page.goto(ws("charter"));
  await page.getByRole("button", { name: tr(lang, "define.charter.create"), exact: true }).click();
  await page.getByLabel(fieldLabel(lang, "define.charter.field.caseForChange")).fill("   \n\t  ");
  await page.getByRole("button", { name: tr(lang, "define.charter.create"), exact: true }).click();
  await expectBlankError(lang, "define.charter.field.caseForChange", page);
  await shot(page, lang, "p2-blank-01-charter-create");
  await expectAccessible(page, lang, "p2-blank-charter-create");
  expect(sent.filter((s) => s.endsWith("/charter"))).toEqual([]);
  await lead.call("GET", charterUrl(), undefined, { expect: 404 });

  // With visible text the charter is created, and the text is stored verbatim (nothing trimmed).
  await page.getByLabel(fieldLabel(lang, "define.charter.field.caseForChange")).fill("  Synthetic: billing errors  ");
  await page.getByLabel(fieldLabel(lang, "define.charter.field.outOfScope")).fill("Synthetic: wholesale billing");
  await page.getByRole("button", { name: tr(lang, "define.charter.create"), exact: true }).click();
  await expect(page.locator("[data-state='charter-version']")).toHaveAttribute("data-charter-version", "1");
  const saved = await lead.call<{ charter: { caseForChange: string; outOfScope: string } }>("GET", charterUrl());
  expect(saved.charter.caseForChange).toBe("  Synthetic: billing errors  ");
  expect(saved.charter.outOfScope).toBe("Synthetic: wholesale billing");
  expect(foreign).toEqual([]);
});

test("Charter edit: a whitespace Out of scope is an inline error, writes no version and keeps the value", async ({
  page,
  playwright,
}, info) => {
  const lang = langOf(info);
  const lead = await leadSession(playwright);
  const foreign = trackRequests(page);
  await signIn(page, lang, "dev.lead");
  const sent = trackMutations(page);
  await page.goto(ws("charter"));
  const fields = page.getByRole("region", { name: tr(lang, "define.charter.fieldsTitle"), exact: true });
  await fields.getByRole("button", { name: tr(lang, "define.charter.edit"), exact: true }).click();
  await page.getByLabel(fieldLabel(lang, "define.charter.field.outOfScope")).fill("     ");
  await page.getByLabel(fieldLabel(lang, "define.charter.changeSummary")).fill("Synthetic: blank exclusions");
  await page.getByRole("button", { name: tr(lang, "define.charter.saveVersion"), exact: true }).click();
  await expectBlankError(lang, "define.charter.field.outOfScope", page);
  await shot(page, lang, "p2-blank-02-charter-edit");
  await expectAccessible(page, lang, "p2-blank-charter-edit");
  expect(sent.filter((s) => s.endsWith("/charter"))).toEqual([]);
  const after = await lead.call<{ charter: { version: number; outOfScope: string } }>("GET", charterUrl());
  expect(after.charter.version).toBe(1);
  expect(after.charter.outOfScope).toBe("Synthetic: wholesale billing");
  const versions = await lead.call<{ items: unknown[] }>("GET", `${charterUrl()}/versions`);
  expect(versions.items).toHaveLength(1);

  // F-DG2-211: with the field restored, a change summary alone is "no changes" in a live region around a real list;
  // axe must report no serious/critical violation (no `listitem`) in that error-banner state.
  await page.getByLabel(fieldLabel(lang, "define.charter.field.outOfScope")).fill("Synthetic: wholesale billing");
  await page.getByRole("button", { name: tr(lang, "define.charter.saveVersion"), exact: true }).click();
  const banner = page.locator("[data-state='form-errors']");
  await expect(banner).toHaveAttribute("role", "alert");
  await expect(banner.getByRole("listitem")).toHaveText([tr(lang, "problems.validation__empty_update")]);
  await shot(page, lang, "p2-blank-03-error-banner");
  await expectAccessible(page, lang, "p2-blank-error-banner");
  expect(sent.filter((s) => s.endsWith("/charter"))).toEqual([]);
  expect((await lead.call<{ charter: { version: number } }>("GET", charterUrl())).charter.version).toBe(1);
  expect(foreign).toEqual([]);
});

test("T01: a whitespace Current state is an inline error and sends nothing", async ({ page }, info) => {
  const lang = langOf(info);
  const foreign = trackRequests(page);
  await signIn(page, lang, "dev.lead");
  const sent = trackMutations(page);
  await page.goto(ws("diagnose"));
  const t01 = page.getByRole("region", { name: tr(lang, "diagnose.t01.title"), exact: true });
  await expect(t01.getByRole("rowheader")).toHaveCount(6);
  const firstDimension = (await t01.getByRole("rowheader").first().textContent())!.trim();
  await t01.getByRole("button", { name: rowAction(lang, "common.action.edit", firstDimension) }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(fieldLabel(lang, "diagnose.t01.currentState")).fill("  \t ");
  await dialog.getByRole("button", { name: tr(lang, "common.action.saveDraft"), exact: true }).click();
  await expectBlankError(lang, "diagnose.t01.currentState", dialog);
  await expect(dialog.getByText(tr(lang, "problems.validation__empty_update"))).toHaveCount(0);
  await shot(page, lang, "p2-blank-04-t01");
  await expectAccessible(page, lang, "p2-blank-t01");
  expect(sent).toEqual([]);
  expect(foreign).toEqual([]);
});

// ------------------------------------------------------------------------------------------------ T-DG2-FE6

const api = () => `/api/v1/transformations/${tid}`;
const POOL_NAME = "Synthetic blank-text value pool";
const JOURNEY_NAME = "Synthetic blank-text journey";

/** Makes G1 of this transformation complete through the real API (synthetic records only). */
async function completeG1(lead: ApiSession, office: ApiSession) {
  const base = api();
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
    name: POOL_NAME,
    quantificationStatus: "unquantified",
    unquantifiedReason: "Synthetic: not sized yet",
    materiality: "material",
  });
  const charter = await lead.call<{ charter: { version: number } }>("GET", `${base}/charter`);
  await lead.call(
    "PATCH",
    `${base}/charter`,
    {
      transformationName: "Synthetic blank-text charter",
      inScope: "Synthetic: retail consumer billing",
      executiveSponsorUserId: DEV_USERS.office,
      transformationLeadUserId: DEV_USERS.lead,
      baselineDate: "2026-09-01",
      changeSummary: "Synthetic: G1 fields",
    },
    { ifMatch: charter.charter.version },
  );
}

interface GateApi {
  gate: { status: string; version: number; latestSubmissionNo: number };
  canSubmit: boolean;
  currentSubmission: { submissionNo: number; status: string; submissionNote: string | null } | null;
}
const gateG1 = (s: ApiSession) => s.call<GateApi>("GET", `${api()}/gates/G1`);

test("Gate G1 submission: a whitespace note is an inline error and submits nothing; visible text is verbatim", async ({
  page,
  playwright,
}, info) => {
  const lang = langOf(info);
  const lead = await leadSession(playwright);
  await completeG1(lead, await apiSession(playwright, "dev.office"));
  const before = await gateG1(lead);
  expect(before.canSubmit).toBe(true);
  expect(before.gate.latestSubmissionNo).toBe(0);
  const foreign = trackRequests(page);
  await signIn(page, lang, "dev.lead");
  const sent = trackMutations(page);
  await page.goto(ws("gates/G1"));
  await page.getByRole("button", { name: tr(lang, "gates.submit.action"), exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(fieldLabel(lang, "gates.submit.note")).fill("   \n\t ");
  await dialog.getByRole("button", { name: tr(lang, "gates.submit.confirm"), exact: true }).click();
  await expectBlankError(lang, "gates.submit.note", dialog);
  await shot(page, lang, "p2-blank-05-gate-note");
  await expectAccessible(page, lang, "p2-blank-gate-note");
  expect(sent).toEqual([]);
  const unchanged = await gateG1(lead);
  expect(unchanged.gate.status).toBe(before.gate.status);
  expect(unchanged.gate.version).toBe(before.gate.version);
  expect(unchanged.gate.latestSubmissionNo).toBe(0);
  expect(unchanged.currentSubmission).toBeNull();

  // Visible text is submitted and stored exactly as typed.
  await dialog.getByLabel(fieldLabel(lang, "gates.submit.note")).fill("  Synthetic: G1 submission note  ");
  await dialog.getByRole("button", { name: tr(lang, "gates.submit.confirm"), exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const submitted = await gateG1(lead);
  expect(submitted.gate.latestSubmissionNo).toBe(1);
  expect(submitted.currentSubmission?.submissionNote).toBe("  Synthetic: G1 submission note  ");
  expect(foreign).toEqual([]);
});

/** A fresh browser context signed in as `username`. */
async function asUser(browser: Browser, lang: Lang, username: string) {
  const context = await browser.newContext({ locale: lang === "ar" ? "ar-SA" : "en-US", timezoneId: "Asia/Riyadh" });
  const page = await context.newPage();
  await signIn(page, lang, username);
  return { page, close: () => context.close() };
}

test("Gate G1 decision: a whitespace rationale is an inline error and decides nothing", async ({
  browser,
  playwright,
}, info) => {
  const lang = langOf(info);
  // A synthetic Executive Sponsor grant for the Transformation Office user on this transformation only (demo data).
  const admin = await apiSession(playwright, "dev.admin");
  await admin.call("POST", "/api/v1/role-assignments", {
    userId: DEV_USERS.office,
    roleCode: "SP",
    scope: { type: "transformation", id: tid },
    reason: "Synthetic demo approver for the blank-text check",
  });
  const lead = await leadSession(playwright);
  const before = await gateG1(lead);
  expect(before.currentSubmission?.status).toBe("pending");
  const office = await asUser(browser, lang, "dev.office");
  const page = office.page;
  const foreign = trackRequests(page);
  const sent = trackMutations(page);
  await page.goto(ws("gates/G1"));
  await page.getByRole("button", { name: tr(lang, "gates.decision.action"), exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("radio", { name: tr(lang, "gates.outcome.approved"), exact: true }).check();
  await dialog.getByLabel(fieldLabel(lang, "gates.decision.rationale")).fill("     \n   ");
  await dialog.getByRole("button", { name: tr(lang, "gates.decision.confirm"), exact: true }).click();
  await expectBlankError(lang, "gates.decision.rationale", dialog);
  await shot(page, lang, "p2-blank-06-gate-rationale");
  await expectAccessible(page, lang, "p2-blank-gate-rationale");
  expect(sent).toEqual([]);
  const after = await gateG1(lead);
  expect(after.gate.status).toBe(before.gate.status);
  expect(after.gate.version).toBe(before.gate.version);
  expect(after.currentSubmission?.status).toBe("pending");
  const view = await lead.call<{ decision: unknown }>("GET", `${api()}/gates/G1/submissions/1`);
  expect(view.decision).toBeNull();
  await dialog.getByRole("button", { name: tr(lang, "common.action.cancel"), exact: true }).click();
  await office.close();
  expect(foreign).toEqual([]);
});

test("Journey steps: a whitespace actor is an inline error and writes no journey version", async ({
  page,
  playwright,
}, info) => {
  const lang = langOf(info);
  const lead = await leadSession(playwright);
  const created = await lead.call<{ id: string; version: number }>("POST", `${api()}/journeys`, {
    name: JOURNEY_NAME,
    kind: "journey",
    state: "current",
    steps: [
      { key: "01920000-0000-7000-8000-00000000f601", ordinal: 1, name: "Synthetic step", actor: "Synthetic agent" },
    ],
  });
  const foreign = trackRequests(page);
  await signIn(page, lang, "dev.lead");
  const sent = trackMutations(page);
  await page.goto(ws("design"));
  await page.getByRole("button", { name: rowAction(lang, "design.journeys.open", JOURNEY_NAME) }).click();
  await page.getByRole("button", { name: tr(lang, "design.journeys.editSteps"), exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(fieldLabel(lang, "design.journeys.actor")).fill("   ");
  await dialog.getByRole("button", { name: tr(lang, "common.action.save"), exact: true }).click();
  await expectBlankError(lang, "design.journeys.actor", dialog);
  await shot(page, lang, "p2-blank-07-journey-actor");
  await expectAccessible(page, lang, "p2-blank-journey-actor");
  expect(sent).toEqual([]);
  const after = await lead.call<{ version: number; steps: { actor: string | null }[] }>(
    "GET",
    `${api()}/journeys/${created.id}`,
  );
  expect(after.version).toBe(created.version);
  expect(after.steps[0]!.actor).toBe("Synthetic agent");
  expect(foreign).toEqual([]);
});

test("Reason dialog: an invisible-only archive reason is an inline error and archives nothing", async ({
  page,
  playwright,
}, info) => {
  const lang = langOf(info);
  const lead = await leadSession(playwright);
  const poolOf = async () =>
    (
      await lead.call<{ items: { name: string; status: string; version: number }[] }>(
        "GET",
        `${api()}/value-pools?limit=100`,
      )
    ).items.find((p) => p.name === POOL_NAME)!;
  const before = await poolOf();
  const foreign = trackRequests(page);
  await signIn(page, lang, "dev.lead");
  const sent = trackMutations(page);
  await page.goto(ws("diagnose"));
  await page.getByRole("button", { name: rowAction(lang, "common.action.archive", POOL_NAME) }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(fieldLabel(lang, "common.form.reason")).fill("\u200f\u200f\u200f\u200f");
  await dialog.getByRole("button", { name: tr(lang, "common.action.archive"), exact: true }).click();
  await expectBlankError(lang, "common.form.reason", dialog);
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await shot(page, lang, "p2-blank-08-archive-reason");
  await expectAccessible(page, lang, "p2-blank-archive-reason");
  expect(sent).toEqual([]);
  const after = await poolOf();
  expect(after.status).toBe(before.status);
  expect(after.version).toBe(before.version);
  expect(foreign).toEqual([]);
});
