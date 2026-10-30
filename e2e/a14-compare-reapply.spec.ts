// A14 "Concurrent editing", the user-visible path (qa-verifier, T-DG6-QA-C; REQ-S16-026, REQ-S20-014, REQ-S15-011
// conflict state). Acceptance texts (binding, docs/delivery/requirements.csv):
//  - REQ-S16-026: "two users edit the same initiative; the second save returns 409 and the UI offers compare and
//    reapply without losing the first change";
//  - REQ-S20-014 (§20 A14): "Conflicting updates show a recoverable conflict rather than silently overwriting accepted
//    changes".
// Black-box on the REAL stack (apps/web/e2e/support/with-stack.sh: disposable PostgreSQL, migrate, seed-dev, the API
// serving the built SPA). Two SYNTHETIC seed users: `dev.lead` edits the initiative in the browser; `dev.office` saves a
// different field of the same initiative through the API while the lead's edit dialog is open (the first change).
// Asserted, in English (LTR) and Arabic (RTL): <html lang/dir>; the lead's save does NOT overwrite anything (the API
// answered 409 and the record is still at the office's version); the conflict state says nothing was saved and
// compares the lead's unsaved values with the current saved values, field by field, showing the office's value;
// "re-apply my change on the current version" saves the lead's change as the next version and the office's change is
// still there (API read and page); axe reports 0 serious/critical issues on the conflict state and the saved page; no
// request leaves the application origin; no engineering-gate name in product text. Screenshots in
// E2E_SCREENSHOT_DIR/<lang>/a14-*.png. All data is SYNTHETIC; an edit approves nothing (no G1-G6 business approval).
import { expect, test } from "@playwright/test";
import {
  apiSession,
  escape,
  expectAccessible,
  fieldLabel,
  langOf,
  shot,
  signIn,
  SYN_RETAIL,
  tr,
  trackRequests,
  type ApiSession,
} from "../apps/web/e2e/support/ui.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const stamp = "20261030";
let lead: ApiSession;
let office: ApiSession;
let tid: string;
let iid: string;

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ playwright }, info) => {
  test.setTimeout(120_000);
  const lang = langOf(info);
  lead = await apiSession(playwright, "dev.lead");
  office = await apiSession(playwright, "dev.office");
  tid = (
    await lead.call<{ id: string }>("POST", "/api/v1/transformations", {
      businessUnitId: SYN_RETAIL,
      name: `Synthetic QA A14 compare and reapply ${lang.toUpperCase()} ${stamp}`,
      mode: "end_to_end",
    })
  ).id;
  iid = (
    await lead.call<{ id: string }>("POST", "/api/v1/initiatives", {
      transformationId: tid,
      name: `Synthetic QA A14 initiative ${lang.toUpperCase()}`,
    })
  ).id;
});

test("A14: the second save gets a recoverable conflict; compare and re-apply keep the first change", async ({
  page,
}, info) => {
  const lang = langOf(info);
  const foreign = trackRequests(page);
  const mine = lang === "ar" ? "هدف اصطناعي كتبه القائد" : "Synthetic objective written by the lead";
  const theirs = lang === "ar" ? "مخاطر اصطناعية حفظها المكتب أولاً" : "Synthetic risks saved first by the office";

  await signIn(page, lang, "dev.lead");
  await page.goto(`/transformations/${tid}/initiatives/${iid}`);
  await expect(page.locator("html")).toHaveAttribute("lang", lang);
  await expect(page.locator("html")).toHaveAttribute("dir", lang === "ar" ? "rtl" : "ltr");
  await page.getByRole("button", { name: new RegExp(escape(tr(lang, "portfolio.card.edit"))) }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByLabel(fieldLabel(lang, "portfolio.t05.objective")).fill(mine);

  // The first change: the office saves a different field of the same initiative while the dialog is open.
  const first = await office.call<Body>(
    "PATCH",
    `/api/v1/initiatives/${iid}`,
    { risksSummary: theirs },
    { ifMatch: 1 },
  );
  expect(first.version).toBe(2);

  const saveResponse = page.waitForResponse(
    (r) => r.url().endsWith(`/api/v1/initiatives/${iid}`) && r.request().method() === "PATCH",
  );
  await dialog.getByRole("button", { name: tr(lang, "common.action.save"), exact: true }).click();
  const refused = await saveResponse;
  expect(refused.status(), "the second save returns 409").toBe(409);

  const conflict = page.getByRole("alert").filter({ hasText: tr(lang, "common.conflict.title") });
  await expect(conflict).toBeVisible();
  await expect(conflict).toContainText(tr(lang, "common.conflict.title"));
  const compare = conflict.getByRole("table", { name: tr(lang, "common.conflict.compareCaption") });
  await expect(compare).toBeVisible();
  await expect(compare.getByRole("columnheader", { name: tr(lang, "common.conflict.mine") })).toBeVisible();
  await expect(compare.getByRole("columnheader", { name: tr(lang, "common.conflict.current") })).toBeVisible();
  const risksRow = compare
    .getByRole("row")
    .filter({ has: page.getByRole("rowheader", { name: tr(lang, "portfolio.t05.risks") }) });
  await expect(risksRow, "the compare shows the office's saved value").toContainText(theirs);
  const objectiveRow = compare
    .getByRole("row")
    .filter({ has: page.getByRole("rowheader", { name: tr(lang, "portfolio.t05.objective") }) });
  await expect(objectiveRow, "the compare shows the lead's unsaved value").toContainText(mine);

  // Nothing was overwritten by the refused save.
  const during = await office.call<Body>("GET", `/api/v1/initiatives/${iid}`);
  expect([during.version, during.risksSummary, during.objective]).toEqual([2, theirs, null]);
  await expectAccessible(page, lang, "a14-conflict");
  await shot(page, lang, "a14-conflict");

  const reapplyResponse = page.waitForResponse(
    (r) => r.url().endsWith(`/api/v1/initiatives/${iid}`) && r.request().method() === "PATCH",
  );
  await conflict.getByRole("button", { name: tr(lang, "common.conflict.reapply"), exact: true }).click();
  expect((await reapplyResponse).status(), "the re-applied save succeeds").toBe(200);
  await expect(dialog).toBeHidden();

  const after = await office.call<Body>("GET", `/api/v1/initiatives/${iid}`);
  expect([after.version, after.objective, after.risksSummary], "both changes kept: none lost").toEqual([
    3,
    mine,
    theirs,
  ]);
  await expect(page.locator("main#main")).toContainText(mine);
  await expect(page.locator("main#main")).toContainText(theirs);
  await expectAccessible(page, lang, "a14-reapplied");
  await shot(page, lang, "a14-reapplied");

  const text = (await page.locator("body").innerText()).toUpperCase();
  expect(text, "no engineering-gate name in product text").not.toMatch(/\bDG[0-7]\b/);
  expect(foreign, "no request leaves the application origin").toEqual([]);
});
