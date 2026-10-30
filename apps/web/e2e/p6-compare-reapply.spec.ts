// A14 compare and reapply with TWO browser sessions against the REAL API (apps/web/e2e/support/with-stack.sh;
// T-DG6-FE-D2; p6-work-split §H/G.6 "two sessions edit one initiative; the second gets 409, compares, reapplies; the
// first change intact"; ADR-0057 §7, §8). REQ-S16-026 acceptance: "two users edit the same initiative; the second save
// returns 409 and the UI offers compare and reapply without losing the first change". SYNTHETIC data and users.
//  - Session 1 (dev.office) and session 2 (dev.lead) open the same initiative's editor. Session 1 saves a new
//    objective and new risks (the first change). Session 2 changed the name and the objective; its save returns 409.
//  - Session 2's compare lists the name as its own change, the risks as the other user's change (kept, not sent) and
//    the objective as changed by both; re-apply waits for a choice; the user keeps the other user's objective.
//  - The re-applied PATCH carries If-Match of the current version and only the name; the API then has session 2's
//    name and session 1's objective and risks: the first change is intact.
//  - Inline edit (ADR-0057 §8): a register cell edit is one PATCH with If-Match; after another session's save it
//    shows the conflict state in the row, compares and re-applies on the current version.
// Every screen is checked with axe (no serious or critical violation) and captured in EN and AR.
// Budget (rules 13, 15): 180 s per test. Measured on the 4-core sandbox while other agents ran (load average 6.6-13.7;
// handback evidence e2e-p6-fe-d2-run1.txt, run2.txt): two-session A14 12.9-14.3 s, inline edit 5.5-6.8 s, draft
// reload 10.5-14.2 s. The worst case is 14.3 s; 180 s is about 12x that.
import { expect, test, type Page } from "@playwright/test";
import {
  apiSession,
  BASE,
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

interface Initiative {
  id: string;
  code: string;
  version: number;
  name: string;
  objective: string | null;
  risksSummary: string | null;
}

let lead: ApiSession;
let tid = "";
let iid = "";
let code = "";

test.beforeAll(async ({ playwright }, info) => {
  const lang = langOf(info);
  lead = await apiSession(playwright, "dev.lead");
  tid = (
    await lead.call<{ id: string }>("POST", "/api/v1/transformations", {
      businessUnitId: SYN_RETAIL,
      name: `Synthetic compare and reapply ${lang.toUpperCase()}`,
      mode: "end_to_end",
    })
  ).id;
  const created = await lead.call<Initiative>("POST", "/api/v1/initiatives", {
    transformationId: tid,
    name: `Synthetic two-session initiative ${lang.toUpperCase()}`,
  });
  iid = created.id;
  code = created.code;
});

test.afterAll(async () => {
  await lead?.req.dispose();
});

async function openEditor(page: Page, lang: "en" | "ar") {
  await page.goto(`/transformations/${tid}/initiatives/${iid}`);
  await page.getByRole("button", { name: new RegExp(escape(tr(lang, "portfolio.card.edit"))) }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  return dialog;
}

const patchOf = (page: Page) =>
  page.waitForResponse((r) => r.url().endsWith(`/api/v1/initiatives/${iid}`) && r.request().method() === "PATCH");

test("REQ-S16-026 A14: two sessions edit one initiative; the second gets 409, compares, re-applies; the first change is intact", async ({
  browser,
}, info) => {
  const lang = langOf(info);
  const started = Date.now();
  const ctx1 = await browser.newContext({ baseURL: BASE });
  const ctx2 = await browser.newContext({ baseURL: BASE });
  const one = await ctx1.newPage();
  const two = await ctx2.newPage();
  const foreign = [...trackRequests(one), ...trackRequests(two)];
  const t = (k: string, v: Record<string, string | number> = {}) => tr(lang, k, v);
  const theirObjective = lang === "ar" ? "هدف اصطناعي حفظه المكتب أولاً" : "Synthetic objective saved first";
  const theirRisks = lang === "ar" ? "مخاطر اصطناعية حفظها المكتب" : "Synthetic risks saved first";
  const myName = lang === "ar" ? "اسم اصطناعي من الجلسة الثانية" : "Synthetic name from session two";
  const myObjective = lang === "ar" ? "هدف اصطناعي من الجلسة الثانية" : "Synthetic objective from session two";

  await signIn(one, lang, "dev.office");
  await signIn(two, lang, "dev.lead");
  const d1 = await openEditor(one, lang);
  const d2 = await openEditor(two, lang);

  // Session 2 edits first, but has not saved yet.
  await d2.getByLabel(fieldLabel(lang, "portfolio.t05.name")).fill(myName);
  await d2.getByLabel(fieldLabel(lang, "portfolio.t05.objective")).fill(myObjective);

  // Session 1 saves first: the first change.
  await d1.getByLabel(fieldLabel(lang, "portfolio.t05.objective")).fill(theirObjective);
  await d1.getByLabel(fieldLabel(lang, "portfolio.t05.risks")).fill(theirRisks);
  const firstSave = patchOf(one);
  await d1.getByRole("button", { name: t("common.action.save"), exact: true }).click();
  expect((await firstSave).status(), "the first save").toBe(200);
  await expect(d1).toBeHidden();

  // Session 2 saves: 409, nothing overwritten.
  const refused = patchOf(two);
  await d2.getByRole("button", { name: t("common.action.save"), exact: true }).click();
  expect((await refused).status(), "the second save returns 409").toBe(409);
  const during = await lead.call<Initiative>("GET", `/api/v1/initiatives/${iid}`);
  expect([during.version, during.objective, during.risksSummary]).toEqual([2, theirObjective, theirRisks]);

  const conflict = two.getByRole("alert").filter({ hasText: t("common.conflict.title") });
  await expect(conflict).toBeVisible();
  await expect(conflict).toContainText(t("common.conflict.lead"));
  const table = conflict.getByRole("table", { name: t("common.conflict.compareCaption") });
  const rowOf = (key: string) =>
    table.getByRole("row").filter({ has: two.getByRole("rowheader", { name: t(key), exact: true }) });
  await expect(rowOf("portfolio.t05.name")).toHaveAttribute("data-compare-group", "mine");
  await expect(rowOf("portfolio.t05.risks")).toHaveAttribute("data-compare-group", "theirs");
  await expect(rowOf("portfolio.t05.risks")).toContainText(theirRisks);
  await expect(rowOf("portfolio.t05.objective")).toHaveAttribute("data-compare-group", "conflict");
  await expect(rowOf("portfolio.t05.objective")).toContainText(myObjective);
  await expect(rowOf("portfolio.t05.objective")).toContainText(theirObjective);
  const reapply = conflict.getByRole("button", { name: t("common.conflict.reapply"), exact: true });
  await expect(reapply).toBeDisabled();
  await expectAccessible(two, lang, "p6-compare-conflict");
  await table.scrollIntoViewIfNeeded();
  await shot(two, lang, "p6-compare-conflict");

  // Keep the other user's objective; re-apply sends only the name, on the current version.
  await rowOf("portfolio.t05.objective")
    .getByRole("radio", { name: t("productivity.compare.keepTheirs") })
    .check();
  await expect(reapply).toBeEnabled();
  await table.scrollIntoViewIfNeeded();
  await shot(two, lang, "p6-compare-resolved");
  const second = patchOf(two);
  await reapply.click();
  const res = await second;
  expect(res.status(), "the re-applied save").toBe(200);
  expect(res.request().headers()["if-match"]).toBe('"2"');
  expect(res.request().postDataJSON()).toEqual({ name: myName });
  await expect(d2).toBeHidden();

  const after = await lead.call<Initiative>("GET", `/api/v1/initiatives/${iid}`);
  expect([after.version, after.name, after.objective, after.risksSummary], "the first change is intact").toEqual([
    3,
    myName,
    theirObjective,
    theirRisks,
  ]);
  await expect(two.locator("main#main")).toContainText(theirObjective);
  await expect(two.locator("main#main")).toContainText(theirRisks);
  await expectAccessible(two, lang, "p6-compare-reapplied");
  await shot(two, lang, "p6-compare-reapplied");
  expect(foreign).toEqual([]);
  await ctx1.close();
  await ctx2.close();
  console.log(`p6-compare-reapply two sessions ${lang}: ${Date.now() - started} ms`);
});

test("ADR-0057 §8: an inline cell edit is one PATCH with If-Match; a 409 shows the conflict in the row; compare and re-apply", async ({
  page,
  playwright,
}, info) => {
  const lang = langOf(info);
  const started = Date.now();
  const foreign = trackRequests(page);
  const t = (k: string, v: Record<string, string | number> = {}) => tr(lang, k, v);
  const office = await apiSession(playwright, "dev.office");
  await signIn(page, lang, "dev.lead");
  await page.goto(`/transformations/${tid}/portfolio`);
  const editName = page.getByRole("button", {
    name: t("productivity.inlineEdit.editLabel", { field: t("portfolio.field.name"), record: code }),
    exact: true,
  });
  await editName.click();
  const input = page.getByLabel(
    t("productivity.inlineEdit.inputLabel", { field: t("portfolio.field.name"), record: code }),
    {
      exact: true,
    },
  );
  const before = await lead.call<Initiative>("GET", `/api/v1/initiatives/${iid}`);
  // Another session saves the objective meanwhile.
  const otherObjective = lang === "ar" ? "هدف اصطناعي من جلسة أخرى" : "Synthetic objective from another session";
  await office.call("PATCH", `/api/v1/initiatives/${iid}`, { objective: otherObjective }, { ifMatch: before.version });
  const inlineName = lang === "ar" ? "اسم اصطناعي معدّل في الخلية" : "Synthetic name edited in the cell";
  await input.fill(inlineName);
  const refused = patchOf(page);
  await input.press("Enter");
  const r1 = await refused;
  expect(r1.status(), "the stale cell save returns 409").toBe(409);
  expect(r1.request().headers()["if-match"]).toBe(`"${before.version}"`);
  expect(r1.request().postDataJSON()).toEqual({ name: inlineName });
  const cell = page.locator("[data-inline-edit='name'][data-row-state='conflict']");
  await expect(cell).toContainText(t("productivity.inlineEdit.conflict"));
  await expectAccessible(page, lang, "p6-inline-conflict");
  await shot(page, lang, "p6-inline-conflict");
  await cell.getByRole("button", { name: t("productivity.inlineEdit.compare"), exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.locator("tr[data-compare-group='mine'][data-field='name']")).toBeVisible();
  await expect(dialog).toContainText(t("productivity.inlineEdit.otherFields", { field: t("portfolio.field.name") }));
  await expectAccessible(page, lang, "p6-inline-compare");
  await dialog.locator("[data-state='conflict']").scrollIntoViewIfNeeded();
  await shot(page, lang, "p6-inline-compare");
  const second = patchOf(page);
  await dialog.getByRole("button", { name: t("common.conflict.reapply"), exact: true }).click();
  const r2 = await second;
  expect(r2.status()).toBe(200);
  expect(r2.request().headers()["if-match"]).toBe(`"${before.version + 1}"`);
  expect(r2.request().postDataJSON()).toEqual({ name: inlineName });
  await expect(page.locator("[data-register='initiatives']")).toContainText(inlineName);
  const after = await lead.call<Initiative>("GET", `/api/v1/initiatives/${iid}`);
  expect([after.name, after.objective]).toEqual([inlineName, otherObjective]);
  await office.req.dispose();
  expect(foreign).toEqual([]);
  console.log(`p6-compare-reapply inline ${lang}: ${Date.now() - started} ms`);
});
