// "A draft survives a browser reload" against the REAL API (apps/web/e2e/support/with-stack.sh; T-DG6-FE-D2;
// p6-work-split §H/G.6; ADR-0057 §6, §9). REQ-S15-010 acceptance: "unsaved drafts are recoverable" / "a draft survives
// a browser reload"; REQ-S15-011: "a draft is labelled 'Draft - not submitted' and never counted in approved totals".
// All data is SYNTHETIC (a fresh transformation and initiative per language, created through the API by the seeded
// dev Transformation Lead). Nothing here is a business approval, and nothing touches the engineering delivery gates.
//  - The lead edits the Initiative Card's objective; leaving the field autosaves the draft on the server
//    (createFormDraft, 201) — nothing is saved to the initiative.
//  - The browser storage is cleared and the page reloaded: the record page offers the draft with the badge
//    "Draft - not submitted", "Restore draft" and "Discard draft"; "Your drafts" lists it with its record link.
//  - Restore opens the editor with the drafted value; Save writes the initiative (PATCH 200) and closes the draft as
//    saved; the API then has the value and no open draft.
// Every screen is checked with axe (no serious or critical violation) and captured in EN and AR.
// Budget (rules 13, 15): 180 s per test. Measured on the 4-core sandbox while other agents ran (load average 6.6-13.7;
// handback evidence e2e-p6-fe-d2-run1.txt, run2.txt): two-session A14 12.9-14.3 s, inline edit 5.5-6.8 s, draft
// reload 10.5-14.2 s. The worst case is 14.3 s; 180 s is about 12x that.
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
} from "./support/ui.ts";

test.describe.configure({ mode: "serial", timeout: 180_000 });

let lead: ApiSession;
let tid = "";
let iid = "";

interface Initiative {
  id: string;
  version: number;
  objective: string | null;
  name: string;
}

test.beforeAll(async ({ playwright }, info) => {
  const lang = langOf(info);
  lead = await apiSession(playwright, "dev.lead");
  tid = (
    await lead.call<{ id: string }>("POST", "/api/v1/transformations", {
      businessUnitId: SYN_RETAIL,
      name: `Synthetic draft recovery ${lang.toUpperCase()}`,
      mode: "end_to_end",
    })
  ).id;
  iid = (
    await lead.call<{ id: string }>("POST", "/api/v1/initiatives", {
      transformationId: tid,
      name: `Synthetic draft recovery initiative ${lang.toUpperCase()}`,
    })
  ).id;
});

test.afterAll(async () => {
  await lead?.req.dispose();
});

test("REQ-S15-010: a draft survives a browser reload; restore and save it (REQ-S15-011 'Draft - not submitted')", async ({
  page,
}, info) => {
  const lang = langOf(info);
  const started = Date.now();
  const foreign = trackRequests(page);
  const drafted = lang === "ar" ? "هدف اصطناعي في مسودة" : "Synthetic objective kept in a draft";

  await signIn(page, lang, "dev.lead");
  await page.goto(`/transformations/${tid}/initiatives/${iid}`);
  await page.getByRole("button", { name: new RegExp(escape(tr(lang, "portfolio.card.edit"))) }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const objective = dialog.getByLabel(fieldLabel(lang, "portfolio.t05.objective"));
  await objective.fill(drafted);
  const created = page.waitForResponse(
    (r) => r.url().endsWith(`/api/v1/transformations/${tid}/form-drafts`) && r.request().method() === "POST",
  );
  await objective.press("Tab"); // leaving the field autosaves (ADR-0057 §6 "and on blur")
  expect((await created).status(), "createFormDraft").toBe(201);
  await expect(dialog.locator("[data-autosave='saved']")).toBeVisible();
  await expect(dialog.locator("[data-badge='draft-not-submitted']")).toHaveText(tr(lang, "productivity.drafts.badge"));
  await shot(page, lang, "p6-draft-autosaved");
  // Nothing was saved to the initiative: a draft is not submitted.
  const unsaved = await lead.call<Initiative>("GET", `/api/v1/initiatives/${iid}`);
  expect([unsaved.version, unsaved.objective]).toEqual([1, null]);

  // The browser forgets everything it held: the draft is on the server.
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.reload();
  const offer = page.getByRole("region", { name: tr(lang, "productivity.drafts.recoveryTitle"), exact: true });
  await expect(offer).toBeVisible();
  await expect(offer.locator("[data-badge='draft-not-submitted']")).toHaveText(tr(lang, "productivity.drafts.badge"));
  if (lang === "en") await expect(offer).toContainText("Draft - not submitted");
  await expect(offer.getByRole("button", { name: tr(lang, "productivity.drafts.discard"), exact: true })).toBeVisible();
  await expectAccessible(page, lang, "p6-draft-offer");
  await shot(page, lang, "p6-draft-offer");

  // "Your drafts" lists it, across transformations, with the record link.
  await page.goto("/my-work/drafts");
  await expect(page.getByRole("heading", { level: 1, name: tr(lang, "productivity.drafts.mineTitle") })).toBeVisible();
  const row = page.getByRole("row").filter({ hasText: `Synthetic draft recovery ${lang.toUpperCase()}` });
  await expect(row).toHaveCount(1);
  await expect(row.locator("[data-badge='draft-not-submitted']")).toBeVisible();
  await expectAccessible(page, lang, "p6-my-drafts");
  await shot(page, lang, "p6-my-drafts");
  await row.getByRole("link").click();
  await page.waitForURL(`**/transformations/${tid}/initiatives/${iid}`);

  // Restore, then save: the initiative gets the drafted value and the draft closes as saved.
  await offer.getByRole("button", { name: new RegExp(escape(tr(lang, "productivity.drafts.restore"))) }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel(fieldLabel(lang, "portfolio.t05.objective"))).toHaveValue(drafted);
  await expectAccessible(page, lang, "p6-draft-restored");
  await dialog.locator("[data-draft-session]").scrollIntoViewIfNeeded();
  await shot(page, lang, "p6-draft-restored");
  const saved = page.waitForResponse(
    (r) => r.url().endsWith(`/api/v1/initiatives/${iid}`) && r.request().method() === "PATCH",
  );
  const closed = page.waitForResponse((r) => r.url().includes("/form-drafts/") && r.url().endsWith("/close"));
  await dialog.getByRole("button", { name: tr(lang, "common.action.save"), exact: true }).click();
  expect((await saved).status(), "the record save").toBe(200);
  expect((await closed).status(), "the draft closes").toBe(200);
  await expect(dialog).toBeHidden();
  await expect(offer).toBeHidden();
  await expect(page.locator("main#main")).toContainText(drafted);

  const after = await lead.call<Initiative>("GET", `/api/v1/initiatives/${iid}`);
  expect([after.version, after.objective]).toEqual([2, drafted]);
  const open = await lead.call<{ items: { recordId: string }[] }>(
    "GET",
    `/api/v1/transformations/${tid}/form-drafts?recordType=T05&status=open`,
  );
  expect(open.items.filter((d) => d.recordId === iid)).toEqual([]);
  expect(foreign).toEqual([]);
  console.log(`p6-draft-recovery ${lang}: ${Date.now() - started} ms`);
});
