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
//    `listitem` violation in that state).
// All data is SYNTHETIC and created by the synthetic dev user `dev.lead`; nothing here is Mobily data.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Locator, type Page, type PlaywrightWorkerArgs } from "@playwright/test";
import {
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
