// qa-verifier DG2 round 3 — independent negative UI checks (T-DG2-REV-QA-R3). Authored by qa-verifier, NOT by an
// implementer. Runs in chromium-en (English LTR) and chromium-ar (Arabic RTL) against the REAL built SPA + API +
// PostgreSQL (e2e/support/qa-stack.sh); no mocks. Copy to e2e/ in a disposable clone and run:
//   QA_SHOT_DIR=<dir> e2e/support/qa-stack.sh npx playwright test e2e/dg2-qa-blank-r3.spec.ts --workers=1
//
// HARD assertions (data integrity, F-DG2-150 / D-063):
//   - whitespace-only text typed into a charter field or a T01 field is NEVER stored as content;
//   - an empty Out of scope shows the FAILING exclusions chip (attention, never pass/unknown), localized EN/AR;
//   - a T01 save with whitespace-only text changes no row version.
// SOFT assertions (expected UX per the assignment and D-063 "the web shows the EN/AR validation__blank message"):
//   - the localized blank-validation message is shown when whitespace-only text is submitted.
// The test logs what the UI actually did (QA-R3 lines). Every state gets a screenshot and an axe scan.
// All data is SYNTHETIC.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import {
  SYN_RETAIL,
  apiSession,
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

// Default mode (not serial): a soft failure must not skip the remaining checks. Each test is self-sufficient: the
// worker's beforeAll creates the transformation (again, after a worker restart), and tests create what they need.
test.describe.configure({ mode: "default" });

const DIR = process.env["QA_SHOT_DIR"] ?? "test-results/qa-r3";
async function qaShot(page: Page, lang: Lang, name: string) {
  mkdirSync(join(DIR, lang), { recursive: true });
  await page.screenshot({ path: join(DIR, lang, `${name}.png`), fullPage: true });
}
const section = (page: Page, lang: Lang, key: string) => page.getByRole("region", { name: tr(lang, key), exact: true });
const BLANK = "   \t  ";
const blankMessage = (page: Page, lang: Lang) =>
  page.getByText(tr(lang, "problems.validation__blank"), { exact: true }).first();

type Charter = { charter: { version: number; caseForChange: string | null; outOfScope: string | null } };
type Items = { items: { id: string; version: number; currentState: string | null; rootCause: string | null }[] };
const isBlankStored = (v: string | null) => v !== null && v.trim() === "";

let tid = "";
let lead: ApiSession;
const T = () => `/api/v1/transformations/${tid}`;
const ws = (tab: string) => `/transformations/${tid}/${tab}`;

test.beforeAll(async ({ playwright }, info) => {
  lead = await apiSession(playwright, "dev.lead");
  const created = await lead.call<{ id: string }>("POST", "/api/v1/transformations", {
    businessUnitId: SYN_RETAIL,
    name: `QA r3 blank ${langOf(info).toUpperCase()} (synthetic)`,
    mode: "end_to_end",
  });
  tid = created.id;
});

test("charter create with a whitespace-only Case for change", async ({ page }, info) => {
  const lang = langOf(info);
  const foreign = trackRequests(page);
  expect((await lead.req.get(`${T()}/charter`)).status()).toBe(404);
  await signIn(page, lang, "dev.lead");
  await page.goto(ws("charter"));
  await expect(page.getByText(tr(lang, "define.charter.empty"), { exact: true })).toBeVisible();
  await page.getByRole("button", { name: tr(lang, "define.charter.create"), exact: true }).click();
  await page.getByLabel(fieldLabel(lang, "define.charter.field.caseForChange")).fill(BLANK);
  await page.getByRole("button", { name: tr(lang, "define.charter.create"), exact: true }).click();
  await page.waitForLoadState("networkidle");
  const shown = await blankMessage(page, lang).isVisible();
  const res = await lead.req.get(`${T()}/charter`);
  const body = res.status() === 200 ? ((await res.json()) as Charter) : null;
  console.log(
    `QA-R3 [${lang}] create with blank caseForChange: blank message shown=${shown}; GET charter -> ${res.status()}` +
      (body ? ` v${body.charter.version} caseForChange=${JSON.stringify(body.charter.caseForChange)}` : ""),
  );
  await qaShot(page, lang, "qa-r3-01-charter-create-blank");
  await expectAccessible(page, lang, "qa-r3-charter-create-blank");
  // HARD: the blank text is never stored as content.
  if (body) expect(isBlankStored(body.charter.caseForChange)).toBe(false);
  // SOFT: the localized blank message (assignment / D-063).
  expect.soft(shown, "localized validation__blank message after a whitespace-only Case for change").toBe(true);
  expect.soft(res.status(), "nothing saved after a whitespace-only Case for change").toBe(404);
  expect(foreign).toEqual([]);
});

test("empty Out of scope: the exclusions chip FAILS (attention); whitespace-only Out of scope on edit", async ({
  page,
}, info) => {
  const lang = langOf(info);
  const foreign = trackRequests(page);
  if ((await lead.req.get(`${T()}/charter`)).status() === 404)
    await lead.call("POST", `${T()}/charter`, { transformationName: "QA r3 (synthetic)" });
  await signIn(page, lang, "dev.lead");
  await page.goto(ws("charter"));
  const before = await lead.call<Charter>("GET", `${T()}/charter`);
  expect(before.charter.outOfScope).toBeNull();

  const scope = section(page, lang, "define.charter.scope.title");
  const exclusions = scope.locator("[data-scope-check='exclusions_documented']");
  const chip = exclusions.locator("[data-result]");
  await expect(chip).toHaveAttribute("data-result", "attention");
  await expect(chip).toHaveText(tr(lang, "define.charter.precheck.result.attention"));
  await expect(chip).toHaveClass(/status-chip--at-risk/);
  await expect(exclusions).toContainText(tr(lang, "define.charter.precheck.detail.exclusions_documented.attention"));
  await exclusions.scrollIntoViewIfNeeded();
  await qaShot(page, lang, "qa-r3-02-exclusions-failing");
  await expectAccessible(page, lang, "qa-r3-exclusions-failing");

  const fields = section(page, lang, "define.charter.fieldsTitle");
  await fields.getByRole("button", { name: tr(lang, "define.charter.edit"), exact: true }).click();
  await page.getByLabel(fieldLabel(lang, "define.charter.field.outOfScope")).fill(BLANK);
  await page.getByLabel(fieldLabel(lang, "define.charter.changeSummary")).fill("QA synthetic: blank exclusions");
  await page.getByRole("button", { name: tr(lang, "define.charter.saveVersion"), exact: true }).click();
  await page.waitForLoadState("networkidle");
  const shown = await blankMessage(page, lang).isVisible();
  const after = await lead.call<Charter>("GET", `${T()}/charter`);
  console.log(
    `QA-R3 [${lang}] edit Out of scope (was null) to blank: blank message shown=${shown}; ` +
      `charter v${before.charter.version} -> v${after.charter.version} outOfScope=${JSON.stringify(after.charter.outOfScope)}`,
  );
  await qaShot(page, lang, "qa-r3-03-out-of-scope-blank");
  await expectAccessible(page, lang, "qa-r3-out-of-scope-blank");
  expect(isBlankStored(after.charter.outOfScope)).toBe(false);
  expect(after.charter.outOfScope).toBeNull();
  await page.goto(ws("charter"));
  await expect(
    section(page, lang, "define.charter.scope.title").locator(
      "[data-scope-check='exclusions_documented'] [data-result]",
    ),
  ).toHaveAttribute("data-result", "attention");
  expect.soft(shown, "localized validation__blank message after a whitespace-only Out of scope").toBe(true);
  expect.soft(after.charter.version, "no new charter version after a whitespace-only Out of scope").toBe(
    before.charter.version,
  );
  expect(foreign).toEqual([]);
});

test("existing Out of scope replaced by whitespace-only text in the UI", async ({ page }, info) => {
  const lang = langOf(info);
  const foreign = trackRequests(page);
  if ((await lead.req.get(`${T()}/charter`)).status() === 404)
    await lead.call("POST", `${T()}/charter`, { transformationName: "QA r3 (synthetic)" });
  const c0 = await lead.call<Charter>("GET", `${T()}/charter`);
  await lead.call(
    "PATCH",
    `${T()}/charter`,
    { outOfScope: "Enterprise contracts (synthetic)", changeSummary: "QA: real exclusion" },
    { ifMatch: c0.charter.version },
  );
  const before = await lead.call<Charter>("GET", `${T()}/charter`);
  await signIn(page, lang, "dev.lead");
  await page.goto(ws("charter"));
  const fields = section(page, lang, "define.charter.fieldsTitle");
  await fields.getByRole("button", { name: tr(lang, "define.charter.edit"), exact: true }).click();
  await page.getByLabel(fieldLabel(lang, "define.charter.field.outOfScope")).fill(BLANK);
  await page.getByLabel(fieldLabel(lang, "define.charter.changeSummary")).fill("QA synthetic: spaces over exclusions");
  await page.getByRole("button", { name: tr(lang, "define.charter.saveVersion"), exact: true }).click();
  await page.waitForLoadState("networkidle");
  const shown = await blankMessage(page, lang).isVisible();
  const after = await lead.call<Charter>("GET", `${T()}/charter`);
  console.log(
    `QA-R3 [${lang}] edit Out of scope (was text) to blank: blank message shown=${shown}; ` +
      `charter v${before.charter.version} -> v${after.charter.version} outOfScope=${JSON.stringify(after.charter.outOfScope)}`,
  );
  await qaShot(page, lang, "qa-r3-04-out-of-scope-replaced-by-blank");
  await expectAccessible(page, lang, "qa-r3-out-of-scope-replaced-by-blank");
  // HARD: never stored as blank; the chip matches what is stored (never 'pass' without a real exclusion).
  expect(isBlankStored(after.charter.outOfScope)).toBe(false);
  await page.goto(ws("charter"));
  const chip = section(page, lang, "define.charter.scope.title").locator(
    "[data-scope-check='exclusions_documented'] [data-result]",
  );
  await expect(chip).toHaveAttribute("data-result", after.charter.outOfScope ? "pass" : "attention");
  expect.soft(shown, "localized validation__blank message after spaces replace an existing Out of scope").toBe(true);
  expect.soft(after.charter.outOfScope, "existing Out of scope kept after a whitespace-only save").toBe(
    before.charter.outOfScope,
  );
  expect(foreign).toEqual([]);
});

test("T01 Current state whitespace-only", async ({ page }, info) => {
  const lang = langOf(info);
  const foreign = trackRequests(page);
  const before = await lead.call<Items>("GET", `${T()}/diagnostic-items?limit=50`);
  await signIn(page, lang, "dev.lead");
  await page.goto(ws("diagnose"));
  const t01 = section(page, lang, "diagnose.t01.title");
  await expect(t01.getByRole("rowheader")).toHaveCount(6);
  const firstDimension = (await t01.getByRole("rowheader").first().textContent())!.trim();
  await t01.getByRole("button", { name: rowAction(lang, "common.action.edit", firstDimension) }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(fieldLabel(lang, "diagnose.t01.currentState")).fill(BLANK);
  await dialog.getByRole("button", { name: tr(lang, "common.action.saveDraft"), exact: true }).click();
  await page.waitForLoadState("networkidle");
  const shown = await blankMessage(page, lang).isVisible();
  const dialogText = (await dialog.count()) ? ((await dialog.innerText()).match(/[^\n]*(?:نص|text|change|تغيير)[^\n]*/gi) ?? []) : [];
  const after = await lead.call<Items>("GET", `${T()}/diagnostic-items?limit=50`);
  const pick = (r: Items) => r.items.map((i) => [i.id, i.version, i.currentState]).sort();
  const unchanged = JSON.stringify(pick(after)) === JSON.stringify(pick(before));
  console.log(
    `QA-R3 [${lang}] T01 blank currentState: blank message shown=${shown}; dialog open=${(await dialog.count()) > 0}; ` +
      `dialog lines=${JSON.stringify(dialogText)}; rows unchanged=${unchanged}`,
  );
  await qaShot(page, lang, "qa-r3-05-t01-blank");
  expect(after.items.some((i) => isBlankStored(i.currentState))).toBe(false);
  expect(pick(after)).toEqual(pick(before));
  expect.soft(shown, "localized validation__blank message after a whitespace-only T01 Current state").toBe(true);
  expect(foreign).toEqual([]);
  // Last: the axe scan of this state (the RecordForm "no changes" banner).
  await expectAccessible(page, lang, "qa-r3-t01-blank");
});
