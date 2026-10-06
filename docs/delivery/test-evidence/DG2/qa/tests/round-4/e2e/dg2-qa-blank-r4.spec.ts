// qa-verifier DG2 round 4 — independent re-verification of F-DG2-210 (blank text in P2 web forms) and F-DG2-211
// (RecordForm error banner semantics) on candidate 29ced0ed (T-DG2-REV-QA-R4). Authored by qa-verifier, NOT by an
// implementer. Derived from the round-3 spec dg2-qa-blank-r3.spec.ts: every round-3 SOFT assertion is now HARD (not
// weakened), and the scope is widened to every form named in the round-4 claim, with whitespace AND invisible-only
// (format characters / fillers) values.
//
// Runs in chromium-en (English LTR) and chromium-ar (Arabic RTL) against the REAL built SPA + API + PostgreSQL
// (e2e/support/qa-stack.sh, port-parameterised copy); no mocks. Copy to e2e/ in a disposable clone and run:
//   QA_SHOT_DIR=<dir> e2e/support/qa-stack-port.sh npx playwright test e2e/dg2-qa-blank-r4.spec.ts --workers=1
//
// For every form: a non-empty value with no visible content shows the localized validation__blank message on the
// field (aria-invalid=true, aria-describedby includes the message, the field has focus), NO mutating request is sent,
// and the stored state (versions, values) is unchanged. Visible text is stored verbatim. Each blank state gets a
// screenshot and an axe scan (wcag2a/2aa/21a/21aa; serious/critical fail). All data is SYNTHETIC; the gate submission
// and decision are synthetic demo records and approve nothing real (G1–G6 never imply DG0–DG7).
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";
import {
  DEV_USERS,
  SYN_RETAIL,
  apiSession,
  escape,
  expectAccessible,
  fieldLabel,
  langOf,
  rowAction,
  signIn,
  tr,
  trackRequests,
  type ApiSession,
  type Lang,
} from "../apps/web/e2e/support/ui.ts";

// Default mode: one failing form must not hide the result of the others. Ordered tests that need a predecessor's state
// check their precondition explicitly.
test.describe.configure({ mode: "default" });

const DIR = process.env["QA_SHOT_DIR"] ?? "test-results/qa-r4";
async function qaShot(page: Page, lang: Lang, name: string) {
  mkdirSync(join(DIR, lang), { recursive: true });
  await page.screenshot({ path: join(DIR, lang, `${name}.png`), fullPage: true });
}
const section = (page: Page, lang: Lang, key: string) => page.getByRole("region", { name: tr(lang, key), exact: true });

const WS = "   \t  ";
/** ZWSP, WORD JOINER, HANGUL FILLER, RLM, NBSP: no visible code point (F-DG2-160 predicate). */
const INVISIBLE = "​⁠ㅤ‏ ";
/** Visible text with leading/trailing spaces and an Arabic RLM: must be stored exactly as typed. */
const VERBATIM = "  ‏نص QA اصطناعي (synthetic)  ";

/** Every mutating request the page sends. */
function trackMutations(page: Page): string[] {
  const sent: string[] = [];
  page.on("request", (r) => {
    if (r.method() !== "GET" && r.method() !== "HEAD") sent.push(`${r.method()} ${new URL(r.url()).pathname}`);
  });
  return sent;
}

/** HARD: the localized blank message is on the field (aria-invalid, aria-describedby) and the field has focus. */
async function expectBlank(lang: Lang, scope: Page | Locator, labelKey: string, focused = true) {
  const field = scope.getByLabel(fieldLabel(lang, labelKey));
  const msg = tr(lang, "problems.validation__blank");
  await expect(field).toHaveAttribute("aria-invalid", "true");
  await expect(field).toHaveAccessibleDescription(new RegExp(escape(msg)));
  if (focused) await expect(field).toBeFocused();
  await expect(scope.getByText(msg, { exact: false }).first()).toBeVisible();
}

type Charter = { charter: { version: number; caseForChange: string | null; outOfScope: string | null } };
type Items = { items: { id: string; version: number; currentState: string | null; rootCause: string | null }[] };

let tid = "";
let lead: ApiSession;
const T = () => `/api/v1/transformations/${tid}`;
const ws = (tab: string) => `/transformations/${tid}/${tab}`;
const versionsOf = async () => (await lead.call<{ items: unknown[] }>("GET", `${T()}/charter/versions`)).items.length;

test.beforeAll(async ({ playwright }, info) => {
  lead = await apiSession(playwright, "dev.lead");
  const created = await lead.call<{ id: string }>("POST", "/api/v1/transformations", {
    businessUnitId: SYN_RETAIL,
    name: `QA r4 blank ${langOf(info).toUpperCase()} (synthetic)`,
    mode: "end_to_end",
  });
  tid = created.id;
});

// ------------------------------------------------------------------------------------------- charter (RecordForm)

test("R4-01 charter create: whitespace and invisible-only Case for change are refused; visible text is verbatim", async ({
  page,
}, info) => {
  const lang = langOf(info);
  const foreign = trackRequests(page);
  expect((await lead.req.get(`${T()}/charter`)).status()).toBe(404);
  await signIn(page, lang, "dev.lead");
  const sent = trackMutations(page);
  await page.goto(ws("charter"));
  await page.getByRole("button", { name: tr(lang, "define.charter.create"), exact: true }).click();
  for (const [kind, value] of [
    ["whitespace", WS],
    ["invisible", INVISIBLE],
  ] as const) {
    await page.getByLabel(fieldLabel(lang, "define.charter.field.caseForChange")).fill(value);
    await page.getByRole("button", { name: tr(lang, "define.charter.create"), exact: true }).click();
    await expectBlank(lang, page, "define.charter.field.caseForChange");
    console.log(`QA-R4 [${lang}] charter create ${kind}: blank message shown, sent=${JSON.stringify(sent)}`);
    expect(sent).toEqual([]);
    expect((await lead.req.get(`${T()}/charter`)).status()).toBe(404);
  }
  await qaShot(page, lang, "qa-r4-01-charter-create-blank");
  await expectAccessible(page, lang, "qa-r4-charter-create-blank");
  await page.getByLabel(fieldLabel(lang, "define.charter.field.caseForChange")).fill(VERBATIM);
  await page.getByRole("button", { name: tr(lang, "define.charter.create"), exact: true }).click();
  await expect(page.locator("[data-state='charter-version']")).toHaveAttribute("data-charter-version", "1");
  const saved = await lead.call<Charter>("GET", `${T()}/charter`);
  expect(saved.charter.caseForChange).toBe(VERBATIM);
  expect(saved.charter.outOfScope).toBeNull();
  expect(foreign).toEqual([]);
});

test("R4-02 charter edit: whitespace/invisible Out of scope (was null) writes no version; chip stays failing", async ({
  page,
}, info) => {
  const lang = langOf(info);
  const foreign = trackRequests(page);
  if ((await lead.req.get(`${T()}/charter`)).status() === 404)
    await lead.call("POST", `${T()}/charter`, { transformationName: "QA r4 (synthetic)" });
  const before = await lead.call<Charter>("GET", `${T()}/charter`);
  expect(before.charter.outOfScope).toBeNull();
  const nVersions = await versionsOf();
  await signIn(page, lang, "dev.lead");
  const sent = trackMutations(page);
  await page.goto(ws("charter"));
  const fields = section(page, lang, "define.charter.fieldsTitle");
  await fields.getByRole("button", { name: tr(lang, "define.charter.edit"), exact: true }).click();
  for (const value of [WS, INVISIBLE]) {
    await page.getByLabel(fieldLabel(lang, "define.charter.field.outOfScope")).fill(value);
    await page.getByLabel(fieldLabel(lang, "define.charter.changeSummary")).fill("QA synthetic: blank exclusions");
    await page.getByRole("button", { name: tr(lang, "define.charter.saveVersion"), exact: true }).click();
    await expectBlank(lang, page, "define.charter.field.outOfScope");
  }
  await qaShot(page, lang, "qa-r4-02-out-of-scope-blank");
  await expectAccessible(page, lang, "qa-r4-out-of-scope-blank");
  const after = await lead.call<Charter>("GET", `${T()}/charter`);
  console.log(
    `QA-R4 [${lang}] edit Out of scope (null) to blank: v${before.charter.version} -> v${after.charter.version}; sent=${JSON.stringify(sent)}`,
  );
  expect(sent).toEqual([]);
  expect(after.charter.version).toBe(before.charter.version);
  expect(after.charter.outOfScope).toBeNull();
  expect(await versionsOf()).toBe(nVersions);
  await page.goto(ws("charter"));
  await expect(
    section(page, lang, "define.charter.scope.title").locator("[data-scope-check='exclusions_documented'] [data-result]"),
  ).toHaveAttribute("data-result", "attention");
  expect(foreign).toEqual([]);
});

test("R4-03 charter edit: spaces over an existing Out of scope keep it; a change summary alone is 'no changes' (banner axe)", async ({
  page,
}, info) => {
  const lang = langOf(info);
  const foreign = trackRequests(page);
  if ((await lead.req.get(`${T()}/charter`)).status() === 404)
    await lead.call("POST", `${T()}/charter`, { transformationName: "QA r4 (synthetic)" });
  const c0 = await lead.call<Charter>("GET", `${T()}/charter`);
  const EXCL = "Enterprise contracts (synthetic)";
  if (c0.charter.outOfScope !== EXCL)
    await lead.call(
      "PATCH",
      `${T()}/charter`,
      { outOfScope: EXCL, changeSummary: "QA: real exclusion" },
      { ifMatch: c0.charter.version },
    );
  const before = await lead.call<Charter>("GET", `${T()}/charter`);
  const nVersions = await versionsOf();
  await signIn(page, lang, "dev.lead");
  const sent = trackMutations(page);
  await page.goto(ws("charter"));
  const fields = section(page, lang, "define.charter.fieldsTitle");
  await fields.getByRole("button", { name: tr(lang, "define.charter.edit"), exact: true }).click();
  await page.getByLabel(fieldLabel(lang, "define.charter.field.outOfScope")).fill(WS);
  await page.getByLabel(fieldLabel(lang, "define.charter.changeSummary")).fill("QA synthetic: spaces over exclusions");
  await page.getByRole("button", { name: tr(lang, "define.charter.saveVersion"), exact: true }).click();
  await expectBlank(lang, page, "define.charter.field.outOfScope");
  await qaShot(page, lang, "qa-r4-03-out-of-scope-replaced-by-blank");
  await expectAccessible(page, lang, "qa-r4-out-of-scope-replaced-by-blank");
  expect(sent).toEqual([]);
  let after = await lead.call<Charter>("GET", `${T()}/charter`);
  expect(after.charter.outOfScope).toBe(EXCL);
  expect(after.charter.version).toBe(before.charter.version);

  // Restore the field; only the change summary differs -> "no changes", in the role=alert banner around a real list.
  await page.getByLabel(fieldLabel(lang, "define.charter.field.outOfScope")).fill(EXCL);
  await page.getByRole("button", { name: tr(lang, "define.charter.saveVersion"), exact: true }).click();
  const banner = page.locator("[data-state='form-errors']");
  await expect(banner).toBeVisible();
  await expect(banner).toHaveAttribute("role", "alert");
  expect(await banner.evaluate((el) => el.tagName)).toBe("DIV");
  await expect(banner.locator(":scope > ul")).toHaveCount(1);
  await expect(banner.getByRole("list")).toHaveCount(1);
  await expect(banner.getByRole("listitem")).toHaveText([tr(lang, "problems.validation__empty_update")]);
  await qaShot(page, lang, "qa-r4-04-charter-no-changes-banner");
  await expectAccessible(page, lang, "qa-r4-charter-no-changes-banner");
  expect(sent).toEqual([]);
  after = await lead.call<Charter>("GET", `${T()}/charter`);
  expect(after.charter.version).toBe(before.charter.version);
  expect(await versionsOf()).toBe(nVersions);
  await page.goto(ws("charter"));
  await expect(
    section(page, lang, "define.charter.scope.title").locator("[data-scope-check='exclusions_documented'] [data-result]"),
  ).toHaveAttribute("data-result", "pass");
  expect(foreign).toEqual([]);
});

// ------------------------------------------------------------------------------------------------ T01 (RecordDialog)

test("R4-04 T01: whitespace/invisible Current state refused; unchanged save is the banner (axe); visible text verbatim", async ({
  page,
}, info) => {
  const lang = langOf(info);
  const foreign = trackRequests(page);
  const pick = (r: Items) => r.items.map((i) => [i.id, i.version, i.currentState]).sort();
  const before = await lead.call<Items>("GET", `${T()}/diagnostic-items?limit=50`);
  await signIn(page, lang, "dev.lead");
  const sent = trackMutations(page);
  await page.goto(ws("diagnose"));
  const t01 = section(page, lang, "diagnose.t01.title");
  await expect(t01.getByRole("rowheader")).toHaveCount(6);
  const firstDimension = (await t01.getByRole("rowheader").first().textContent())!.trim();
  await t01.getByRole("button", { name: rowAction(lang, "common.action.edit", firstDimension) }).click();
  const dialog = page.getByRole("dialog");
  for (const value of [WS, INVISIBLE]) {
    await dialog.getByLabel(fieldLabel(lang, "diagnose.t01.currentState")).fill(value);
    await dialog.getByRole("button", { name: tr(lang, "common.action.saveDraft"), exact: true }).click();
    await expectBlank(lang, dialog, "diagnose.t01.currentState");
    await expect(dialog.getByText(tr(lang, "problems.validation__empty_update"))).toHaveCount(0);
  }
  await qaShot(page, lang, "qa-r4-05-t01-blank");
  await expectAccessible(page, lang, "qa-r4-t01-blank");
  expect(sent).toEqual([]);
  expect(pick(await lead.call<Items>("GET", `${T()}/diagnostic-items?limit=50`))).toEqual(pick(before));

  // The exact round-3 F-DG2-211 state: the RecordForm banner in the T01 dialog ("no changes").
  await dialog.getByRole("button", { name: tr(lang, "common.action.cancel"), exact: true }).click();
  await t01.getByRole("button", { name: rowAction(lang, "common.action.edit", firstDimension) }).click();
  await dialog.getByRole("button", { name: tr(lang, "common.action.saveDraft"), exact: true }).click();
  const banner = dialog.locator("[data-state='form-errors']");
  await expect(banner).toHaveAttribute("role", "alert");
  await expect(banner.getByRole("listitem")).toHaveText([tr(lang, "problems.validation__empty_update")]);
  await qaShot(page, lang, "qa-r4-06-t01-no-changes-banner");
  await expectAccessible(page, lang, "qa-r4-t01-no-changes-banner");
  expect(sent).toEqual([]);

  // Visible text: saved verbatim (one PATCH).
  await dialog.getByLabel(fieldLabel(lang, "diagnose.t01.currentState")).fill(VERBATIM);
  await dialog.getByRole("button", { name: tr(lang, "common.action.saveDraft"), exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const after = await lead.call<Items>("GET", `${T()}/diagnostic-items?limit=50`);
  expect(after.items.filter((i) => i.currentState === VERBATIM)).toHaveLength(1);
  expect(sent.filter((s) => s.startsWith("PATCH"))).toHaveLength(1);
  expect(foreign).toEqual([]);
});

// ------------------------------------------------------------------------------------------------ North Star (Define)

test("R4-05 North Star: whitespace/invisible statement is refused and nothing is set", async ({ page }, info) => {
  const lang = langOf(info);
  const foreign = trackRequests(page);
  expect((await lead.req.get(`${T()}/north-star`)).status()).toBe(404);
  await signIn(page, lang, "dev.lead");
  const sent = trackMutations(page);
  await page.goto(ws("define"));
  await page.getByRole("button", { name: tr(lang, "define.northStar.set"), exact: true }).click();
  for (const value of [WS, INVISIBLE]) {
    await page.getByLabel(fieldLabel(lang, "define.northStar.statement")).fill(value);
    await page.getByRole("button", { name: tr(lang, "define.northStar.save"), exact: true }).click();
    await expectBlank(lang, page, "define.northStar.statement");
  }
  await qaShot(page, lang, "qa-r4-07-north-star-blank");
  await expectAccessible(page, lang, "qa-r4-north-star-blank");
  expect(sent).toEqual([]);
  expect((await lead.req.get(`${T()}/north-star`)).status()).toBe(404);
  expect(foreign).toEqual([]);
});

// ------------------------------------------------------------------------------------------- Journey steps (Design)

test("R4-06 journey steps: invisible name, whitespace hand-off and an invisible list item are refused; no version", async ({
  page,
}, info) => {
  const lang = langOf(info);
  const NAME = `QA r4 journey ${lang} (synthetic)`;
  const created = await lead.call<{ id: string; version: number }>("POST", `${T()}/journeys`, {
    name: NAME,
    kind: "journey",
    state: "current",
    steps: [{ key: crypto.randomUUID(), ordinal: 1, name: "QA step", actor: "QA agent" }],
  });
  const foreign = trackRequests(page);
  await signIn(page, lang, "dev.lead");
  const sent = trackMutations(page);
  await page.goto(ws("design"));
  await page.getByRole("button", { name: rowAction(lang, "design.journeys.open", NAME) }).click();
  await page.getByRole("button", { name: tr(lang, "design.journeys.editSteps"), exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(fieldLabel(lang, "common.field.name")).fill("ㅤ​");
  await dialog.getByLabel(fieldLabel(lang, "design.journeys.handoffTo")).fill(WS);
  await dialog.getByLabel(fieldLabel(lang, "design.journeys.systemsHint")).fill("SAP, ‏");
  await dialog.getByRole("button", { name: tr(lang, "common.action.save"), exact: true }).click();
  await expectBlank(lang, dialog, "common.field.name", true);
  await expectBlank(lang, dialog, "design.journeys.handoffTo", false);
  await expectBlank(lang, dialog, "design.journeys.systemsHint", false);
  await qaShot(page, lang, "qa-r4-08-journey-steps-blank");
  await expectAccessible(page, lang, "qa-r4-journey-steps-blank");
  expect(sent).toEqual([]);
  const after = await lead.call<{ version: number; steps: { name: string; handoffTo: string | null }[] }>(
    "GET",
    `${T()}/journeys/${created.id}`,
  );
  expect(after.version).toBe(created.version);
  expect(after.steps[0]!.name).toBe("QA step");
  expect(foreign).toEqual([]);
});

// ---------------------------------------------------------------------------------------- Reason dialog (archive)

test("R4-07 reason dialog: a whitespace archive reason is refused and nothing is archived", async ({ page }, info) => {
  const lang = langOf(info);
  const POOL = `QA r4 pool ${lang} (synthetic)`;
  await lead.call("POST", `${T()}/value-pools`, {
    name: POOL,
    quantificationStatus: "unquantified",
    unquantifiedReason: "QA synthetic: not sized",
    materiality: "material",
  });
  const poolOf = async () =>
    (
      await lead.call<{ items: { name: string; status: string; version: number }[] }>(
        "GET",
        `${T()}/value-pools?limit=100`,
      )
    ).items.find((p) => p.name === POOL)!;
  const before = await poolOf();
  const foreign = trackRequests(page);
  await signIn(page, lang, "dev.lead");
  const sent = trackMutations(page);
  await page.goto(ws("diagnose"));
  await page.getByRole("button", { name: rowAction(lang, "common.action.archive", POOL) }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(fieldLabel(lang, "common.form.reason")).fill("      ");
  await dialog.getByRole("button", { name: tr(lang, "common.action.archive"), exact: true }).click();
  await expectBlank(lang, dialog, "common.form.reason");
  await qaShot(page, lang, "qa-r4-09-archive-reason-blank");
  await expectAccessible(page, lang, "qa-r4-archive-reason-blank");
  expect(sent).toEqual([]);
  const after = await poolOf();
  expect([after.status, after.version]).toEqual([before.status, before.version]);
  expect(foreign).toEqual([]);
});

// ---------------------------------------------------------------- Decision outcome (row-action NoteDecisionDialog)

test("R4-08 design decision: whitespace/invisible outcome is refused and nothing is decided; visible text verbatim", async ({
  page,
}, info) => {
  const lang = langOf(info);
  const d = await lead.call<{ id: string; code: string; version: number }>("POST", "/api/v1/decisions", {
    transformationId: tid,
    title: `QA r4 decision ${lang} (synthetic)`,
    ownerUserId: DEV_USERS.lead,
    options: [{ title: "QA option A (synthetic)" }, { title: "QA option B (synthetic)" }],
  });
  const foreign = trackRequests(page);
  await signIn(page, lang, "dev.lead");
  const sent = trackMutations(page);
  await page.goto(ws("decisions"));
  await page.getByRole("button", { name: rowAction(lang, "decisions.decide", d.code) }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("radio").first().check();
  for (const value of [WS, INVISIBLE]) {
    await dialog.getByLabel(fieldLabel(lang, "decisions.field.outcome")).fill(value);
    await dialog.getByRole("button", { name: tr(lang, "decisions.decide"), exact: true }).click();
    await expectBlank(lang, dialog, "decisions.field.outcome");
  }
  await qaShot(page, lang, "qa-r4-10-decision-outcome-blank");
  await expectAccessible(page, lang, "qa-r4-decision-outcome-blank");
  expect(sent).toEqual([]);
  const mid = await lead.call<{ status: string; version: number }>("GET", `/api/v1/decisions/${d.id}`);
  expect([mid.status, mid.version]).toEqual(["open", d.version]);
  await dialog.getByLabel(fieldLabel(lang, "decisions.field.outcome")).fill(VERBATIM);
  await dialog.getByRole("button", { name: tr(lang, "decisions.decide"), exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const done = await lead.call<{ status: string; outcomeText: string | null }>("GET", `/api/v1/decisions/${d.id}`);
  console.log(`QA-R4 [${lang}] decision after visible outcome: status=${done.status}`);
  expect(done.outcomeText).toBe(VERBATIM);
  expect(foreign).toEqual([]);
});

// ------------------------------------------------------------------------------ Evidence review note (other user)

async function asUser(browser: Browser, lang: Lang, username: string) {
  const context = await browser.newContext({ locale: lang === "ar" ? "ar-SA" : "en-US", timezoneId: "Asia/Riyadh" });
  const page = await context.newPage();
  await signIn(page, lang, username);
  return { page, close: () => context.close() };
}

test("R4-09 evidence review: a whitespace review note is refused and nothing is reviewed", async ({
  browser,
}, info) => {
  const lang = langOf(info);
  const TITLE = `QA r4 evidence ${lang} (synthetic)`;
  const ev = await lead.call<{ id: string; version: number }>("POST", `${T()}/evidence`, {
    kind: "note",
    title: TITLE,
    ownerUserId: DEV_USERS.lead,
    noteBody: "QA synthetic note body",
  });
  const office = await asUser(browser, lang, "dev.office");
  const page = office.page;
  const foreign = trackRequests(page);
  const sent = trackMutations(page);
  await page.goto(ws("evidence"));
  await page.getByRole("button", { name: rowAction(lang, "evidence.review.action", TITLE) }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("radio").first().check();
  const radios = dialog.getByRole("radio");
  for (let i = 0; i < (await radios.count()); i++) {
    const r = radios.nth(i);
    if ((await r.getAttribute("value")) === "accessible") await r.check();
  }
  await dialog.getByLabel(fieldLabel(lang, "evidence.review.note")).fill(WS);
  await dialog.getByRole("button", { name: tr(lang, "evidence.review.record"), exact: true }).click();
  await expectBlank(lang, dialog, "evidence.review.note");
  await qaShot(page, lang, "qa-r4-11-evidence-review-note-blank");
  await expectAccessible(page, lang, "qa-r4-evidence-review-note-blank");
  expect(sent).toEqual([]);
  const after = await lead.call<{ version: number }>("GET", `${T()}/evidence/${ev.id}`);
  expect(after.version).toBe(ev.version);
  await office.close();
  expect(foreign).toEqual([]);
});

// -------------------------------------------------------------------------- Gate G1 submission note and decision

/** Makes G1 of this transformation complete through the real API (synthetic records only). */
async function completeG1(office: ApiSession) {
  const base = T();
  const baseline = await lead.call<{ id: string }>("POST", `${base}/baselines`, {
    metric: "QA synthetic error rate",
    unit: "%",
    scope: "operational",
    value: "4.25",
    source: "QA synthetic extract",
    baselineDate: "2026-09-01",
  });
  const note = await lead.call<{ id: string; version: number }>("POST", `${base}/evidence`, {
    kind: "note",
    title: "QA synthetic baseline paper",
    ownerUserId: DEV_USERS.lead,
    noteBody: "QA synthetic: 4.25%.",
  });
  await lead.call("POST", `${base}/evidence-links`, { evidenceId: note.id, recordType: "baseline", recordId: baseline.id });
  await office.call(
    "POST",
    `${base}/evidence/${note.id}/review`,
    { result: "verified", accessibilityStatus: "accessible", note: "QA synthetic check" },
    { ifMatch: note.version },
  );
  const items = await lead.call<Items>("GET", `${base}/diagnostic-items?limit=100`);
  for (const item of items.items)
    await lead.call(
      "PATCH",
      `${base}/diagnostic-items/${item.id}`,
      {
        currentState: "QA synthetic current",
        rootCause: "QA synthetic cause",
        impactText: "QA synthetic impact",
        confidence: "M",
        baselineId: baseline.id,
      },
      { ifMatch: item.version },
    );
  const methodology = await lead.call<{ diagnosticWorkstreams: { code: string }[] }>("GET", `${base}/methodology`);
  await lead.call("POST", `${base}/diagnostic-findings`, {
    workstreamCode: methodology.diagnosticWorkstreams[0]!.code,
    kind: "root_cause",
    statement: "QA synthetic root cause",
    status: "confirmed",
  });
  if ((await lead.req.get(`${base}/charter`)).status() === 404)
    await lead.call("POST", `${base}/charter`, { transformationName: "QA r4 (synthetic)" });
  const charter = await lead.call<Charter>("GET", `${base}/charter`);
  await lead.call(
    "PATCH",
    `${base}/charter`,
    {
      transformationName: "QA r4 charter (synthetic)",
      caseForChange: "QA synthetic case",
      inScope: "QA synthetic scope",
      outOfScope: "QA synthetic exclusion",
      executiveSponsorUserId: DEV_USERS.office,
      transformationLeadUserId: DEV_USERS.lead,
      baselineDate: "2026-09-01",
      changeSummary: "QA: G1 fields",
    },
    { ifMatch: charter.charter.version },
  );
}
interface GateApi {
  gate: { status: string; version: number; latestSubmissionNo: number };
  canSubmit: boolean;
  currentSubmission: { submissionNo: number; status: string; submissionNote: string | null } | null;
}

test("R4-10 gate G1 submission note (invisible-only) refused; gate decision rationale/comments blank refused", async ({
  page,
  browser,
  playwright,
}, info) => {
  const lang = langOf(info);
  const office = await apiSession(playwright, "dev.office");
  await completeG1(office);
  const g0 = await lead.call<GateApi>("GET", `${T()}/gates/G1`);
  console.log(`QA-R4 [${lang}] G1 canSubmit=${g0.canSubmit} latest=${g0.gate.latestSubmissionNo}`);
  expect(g0.canSubmit).toBe(true);
  const foreign = trackRequests(page);
  await signIn(page, lang, "dev.lead");
  const sent = trackMutations(page);
  await page.goto(ws("gates/G1"));
  await page.getByRole("button", { name: tr(lang, "gates.submit.action"), exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(fieldLabel(lang, "gates.submit.note")).fill(INVISIBLE);
  await dialog.getByRole("button", { name: tr(lang, "gates.submit.confirm"), exact: true }).click();
  await expectBlank(lang, dialog, "gates.submit.note");
  await qaShot(page, lang, "qa-r4-12-gate-note-invisible");
  await expectAccessible(page, lang, "qa-r4-gate-note-invisible");
  expect(sent).toEqual([]);
  const g1 = await lead.call<GateApi>("GET", `${T()}/gates/G1`);
  expect([g1.gate.version, g1.gate.latestSubmissionNo, g1.currentSubmission]).toEqual([g0.gate.version, 0, null]);
  await dialog.getByLabel(fieldLabel(lang, "gates.submit.note")).fill(VERBATIM);
  await dialog.getByRole("button", { name: tr(lang, "gates.submit.confirm"), exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const g2 = await lead.call<GateApi>("GET", `${T()}/gates/G1`);
  expect(g2.currentSubmission?.submissionNote).toBe(VERBATIM);
  expect(foreign).toEqual([]);

  // Decision by a synthetic Sponsor grant for dev.office on this transformation only (demo data, approves nothing).
  const admin = await apiSession(playwright, "dev.admin");
  await admin.call("POST", "/api/v1/role-assignments", {
    userId: DEV_USERS.office,
    roleCode: "SP",
    scope: { type: "transformation", id: tid },
    reason: "QA r4 synthetic demo approver",
  });
  const op = await asUser(browser, lang, "dev.office");
  const osent = trackMutations(op.page);
  await op.page.goto(ws("gates/G1"));
  await op.page.getByRole("button", { name: tr(lang, "gates.decision.action"), exact: true }).click();
  const dd = op.page.getByRole("dialog");
  await dd.getByRole("radio", { name: tr(lang, "gates.outcome.approved"), exact: true }).check();
  // Comments blank with a valid rationale.
  await dd.getByLabel(fieldLabel(lang, "gates.decision.rationale")).fill("QA synthetic rationale with visible text");
  await dd.getByLabel(fieldLabel(lang, "gates.decision.comments")).fill(WS);
  await dd.getByRole("button", { name: tr(lang, "gates.decision.confirm"), exact: true }).click();
  await expectBlank(lang, dd, "gates.decision.comments");
  // Rationale invisible-only.
  await dd.getByLabel(fieldLabel(lang, "gates.decision.comments")).fill("");
  await dd.getByLabel(fieldLabel(lang, "gates.decision.rationale")).fill(INVISIBLE);
  await dd.getByRole("button", { name: tr(lang, "gates.decision.confirm"), exact: true }).click();
  await expectBlank(lang, dd, "gates.decision.rationale");
  await qaShot(op.page, lang, "qa-r4-13-gate-decision-blank");
  await expectAccessible(op.page, lang, "qa-r4-gate-decision-blank");
  expect(osent).toEqual([]);
  const g3 = await lead.call<GateApi>("GET", `${T()}/gates/G1`);
  expect(g3.currentSubmission?.status).toBe("pending");
  expect(g3.gate.version).toBe(g2.gate.version);
  await op.close();
});
