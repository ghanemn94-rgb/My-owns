// P4 slice E execution panels on the initiative page (budget lines, execution, schedule network and critical path) on
// the REAL stack (support/with-stack.sh; no mocks): T-DG4-FE-D2 (p4-work-split §E.5 second sentence; ADR-0031 §7-§11;
// REQ-S09-007, REQ-S09-009 UI halves). Every record is SYNTHETIC demo data; nothing here is a business approval, and no
// product gate (G1-G6) implies any engineering gate (DG0-DG7).
//  1. Finance adds two budget lines (0.1 + 0.2): the SAR budget total is exactly 0.3 (decimal), the actual total is
//     Unknown with its reason and the count of lines without it (never 0). An invalid amount is refused inline with the
//     §11 text; a duplicate label is the translated 409. An edit sends If-Match; a stale edit is a 409 and never
//     overwrites the other change.
//  2. Schedule network: with one initiative without a duration, no critical path is claimed and NOTHING is styled
//     critical; the Transformation Lead records the missing duration in the UI and the network computes the ADR-0031
//     §8 fixture (P = 18, INI-A → INI-B → INI-D critical, INI-C float 6). The execution view shows the milestone slip
//     in working days as the API computes it (or Unknown with its reason), and the critical-path membership.
//  3. The auditor's read-only panels; 390 px wide and 200 % text without page-level horizontal scroll.
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
let orgId = "";
const ini: Record<"A" | "B" | "C" | "D", { id: string; code: string }> = {
  A: { id: "", code: "" },
  B: { id: "", code: "" },
  C: { id: "", code: "" },
  D: { id: "", code: "" },
};
let finance: SyntheticUser;
let auditor: SyntheticUser;
let lead: ApiSession;
let fin: ApiSession;
const stamp = Date.now().toString(36);

async function go(page: Page, path: string) {
  await page.goto(path);
  await expect(page.locator("main#main h1")).toBeVisible();
}

const submitOf = (dialog: Locator) => dialog.locator("[data-action='submit']");
const field = (dialog: Locator, name: string) => dialog.locator(`[data-field='${name}']`);
const initiativePath = (id: string) => `/transformations/${tid}/initiatives/${id}`;

async function expectNoPageOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

interface Line {
  id: string;
  label: string;
  version: number;
  actualAmount: string | null;
  budgetAmount: string | null;
}

test.beforeAll(async ({ playwright }, info) => {
  const lang = langOf(info);
  lead = await apiSession(playwright, "dev.lead");
  const admin = await apiSession(playwright, "dev.admin");
  tid = (
    await lead.call<{ id: string }>("POST", "/api/v1/transformations", {
      businessUnitId: SYN_RETAIL,
      name: `Synthetic P4 execution ${lang.toUpperCase()} ${stamp}`,
      mode: "end_to_end",
    })
  ).id;
  orgId = (await admin.call<{ organization: { id: string } }>("GET", "/api/v1/me")).organization.id;
  const mk = (code: string, role: string, name: string) =>
    syntheticUser(admin, orgId, tid, `dev.p4exec.${code}.${lang}.${stamp}`, `${name} ${lang}`, role, lang);
  finance = await mk("fin", "FIN", "Synthetic Finance partner");
  auditor = await mk("aud", "AUD", "Synthetic Auditor");
  fin = await apiSession(playwright, finance.username);
  for (const k of ["A", "B", "C", "D"] as const) {
    const created = await lead.call<{ id: string; code: string }>("POST", "/api/v1/initiatives", {
      transformationId: tid,
      name: `Synthetic execution ${k} ${lang}`,
    });
    ini[k] = { id: created.id, code: created.code };
  }
  // ADR-0031 §8 fixture: A (5) -> B (10) -> D (3); A -> C (4) -> D. C's duration is recorded in the UI (step 2).
  for (const [k, d] of [
    ["A", 5],
    ["B", 10],
    ["D", 3],
  ] as const)
    await lead.call("POST", `/api/v1/initiatives/${ini[k].id}/schedule`, { durationWorkingDays: d });
  for (const [from, to] of [
    ["A", "B"],
    ["B", "D"],
    ["A", "C"],
    ["C", "D"],
  ] as const)
    await lead.call("POST", "/api/v1/dependencies", {
      transformationId: tid,
      description: `Synthetic: ${from} delivers before ${to}`,
      from: { kind: "initiative", initiativeId: ini[from].id },
      toInitiativeId: ini[to].id,
      dependencyType: "tech",
    });
  // B's milestones: approved Thu 2026-10-08, forecast Thu 2026-10-15 (ADR-0031 §7 example); one without a forecast.
  const I = `/api/v1/initiatives/${ini.B.id}`;
  const late = await lead.call<{ id: string; version: number }>("POST", `${I}/milestones`, {
    title: `Synthetic design sign-off ${lang}`,
    forecastDate: "2026-10-15",
  });
  await lead.call(
    "POST",
    `/api/v1/milestones/${late.id}/approve-date`,
    { approvedDate: "2026-10-08", reason: "Synthetic baseline date." },
    { ifMatch: late.version },
  );
  const open = await lead.call<{ id: string; version: number }>("POST", `${I}/milestones`, {
    title: `Synthetic data migration ${lang}`,
  });
  await lead.call(
    "POST",
    `/api/v1/milestones/${open.id}/approve-date`,
    { approvedDate: "2026-11-02", reason: "Synthetic baseline date." },
    { ifMatch: open.version },
  );
});

test("1. Budget lines: decimal totals per currency, Unknown with its reason, translated refusals, If-Match and the stale-edit 409", async ({
  browser,
}, info) => {
  const lang = langOf(info);
  const f = await asUser(browser, lang, finance.username);
  const page = f.page;
  const foreign = trackRequests(page);
  await go(page, initiativePath(ini.B.id));
  const section = page.locator("#budget-lines");
  await expect(section.locator("[data-budget-totals='none']")).toHaveAttribute("data-reason", "no_budget_lines");
  await expect(section.locator("[data-budget-totals='none'] [data-health='unknown']")).toBeVisible();
  await shot(page, lang, "p4exec-01-no-budget-lines");
  await expectAccessible(page, lang, "p4exec-01-no-budget-lines");
  // Line 1: an invalid amount is refused inline with the §11 text (nothing sent), then 0.1.
  await section.getByRole("button", { name: tr(lang, "executionP4.budget.add") }).click();
  let dialog = page.getByRole("dialog");
  await field(dialog, "label").fill(`Synthetic licences ${lang}`);
  await field(dialog, "budgetAmount").fill("1,000");
  await submitOf(dialog).click();
  await expect(dialog.getByText(tr(lang, "problems.budget_line__amount_invalid"))).toBeVisible();
  await shot(page, lang, "p4exec-02-amount-invalid");
  await field(dialog, "budgetAmount").fill("0.1");
  await submitOf(dialog).click();
  await expect(dialog).toBeHidden();
  // Line 2: 0.2 for November 2026.
  await section.getByRole("button", { name: tr(lang, "executionP4.budget.add") }).click();
  dialog = page.getByRole("dialog");
  await field(dialog, "label").fill(`Synthetic cloud credits ${lang}`);
  await field(dialog, "periodMonth").fill("2026-11");
  await field(dialog, "budgetAmount").fill("0.2");
  await submitOf(dialog).click();
  await expect(dialog).toBeHidden();
  // Totals: SAR budget exactly 0.3 (decimal); actual Unknown with its reason and count, never 0.
  const sar = section.locator("[data-total-currency='SAR']");
  await expect(sar.locator("[data-total='budget'] [data-amount]")).toHaveAttribute("data-amount", "0.3000");
  const actual = sar.locator("[data-total='actual']");
  await expect(actual).toHaveAttribute("data-status", "unknown");
  await expect(actual.locator("[data-unknown-reason='missing_amounts'] [data-health='unknown']")).toBeVisible();
  await expect(actual).toContainText(tr(lang, "executionP4.budget.totals.missing", { n: 2 }));
  await shot(page, lang, "p4exec-03-totals");
  await expectAccessible(page, lang, "p4exec-03-totals");
  // A duplicate label (same month) is the translated 409; nothing is created.
  await section.getByRole("button", { name: tr(lang, "executionP4.budget.add") }).click();
  dialog = page.getByRole("dialog");
  await field(dialog, "label").fill(`Synthetic licences ${lang}`);
  await submitOf(dialog).click();
  await expect(dialog.getByRole("alert")).toHaveAttribute("data-problem", "budget_line.duplicate");
  await expect(dialog.getByRole("alert")).toContainText(tr(lang, "problems.budget_line__duplicate"));
  await shot(page, lang, "p4exec-04-duplicate");
  await dialog.getByRole("button", { name: tr(lang, "common.action.cancel") }).click();
  const linesOf = async () =>
    (await fin.call<{ items: Line[] }>("GET", `/api/v1/initiatives/${ini.B.id}/budget-lines`)).items;
  expect(await linesOf()).toHaveLength(2);
  // Edit line 1 in the UI: If-Match is the version the screen read; only the changed member is sent.
  const l1 = (await linesOf()).find((l) => l.label === `Synthetic licences ${lang}`)!;
  const row1 = section.locator("tr", { has: page.locator(`[data-budget-line='Synthetic licences ${lang}']`) });
  await row1.locator("[data-action='edit-budget-line']").click();
  dialog = page.getByRole("dialog");
  await field(dialog, "actualAmount").fill("0.05");
  const patch = page.waitForRequest((r) => r.method() === "PATCH" && r.url().endsWith(`/budget-lines/${l1.id}`));
  await submitOf(dialog).click();
  const sent = await patch;
  expect(sent.headers()["if-match"]).toBe(`"${l1.version}"`);
  expect(sent.postDataJSON()).toEqual({ actualAmount: "0.05" });
  await expect(dialog).toBeHidden();
  // Stale edit: the screen read line 2; Finance changes it through the API meanwhile; the UI save is a 409.
  const l2 = (await linesOf()).find((l) => l.label === `Synthetic cloud credits ${lang}`)!;
  const row2 = section.locator("tr", { has: page.locator(`[data-budget-line='Synthetic cloud credits ${lang}']`) });
  await row2.locator("[data-action='edit-budget-line']").click();
  dialog = page.getByRole("dialog");
  await expect(dialog.locator(`[data-edit-version='${l2.version}']`)).toBeVisible();
  await fin.call("PATCH", `/api/v1/budget-lines/${l2.id}`, { actualAmount: "0.15" }, { ifMatch: l2.version });
  await field(dialog, "actualAmount").fill("0.99");
  await submitOf(dialog).click();
  await expect(dialog.getByRole("alert")).toHaveAttribute("data-state", "conflict");
  await expect(dialog.getByRole("alert")).toContainText(tr(lang, "myWork.ui.conflictReloaded"));
  await shot(page, lang, "p4exec-05-stale-edit-409");
  await expectAccessible(page, lang, "p4exec-05-stale-edit-409");
  const after = (await linesOf()).find((l) => l.id === l2.id)!;
  expect(after.actualAmount).toBe("0.1500");
  expect(after.version).toBe(l2.version + 1);
  await dialog.getByRole("button", { name: tr(lang, "common.action.cancel") }).click();
  // Both actuals known now: 0.05 + 0.15 = 0.2 exactly.
  await expect(sar.locator("[data-total='actual'] [data-amount]")).toHaveAttribute("data-amount", "0.2000");
  expect(foreign).toEqual([]);
  await f.close();
});

test("2. Schedule network: no critical claim with a missing duration; recording it computes the §8 critical path; execution slip", async ({
  browser,
}, info) => {
  const lang = langOf(info);
  const tl = await asUser(browser, lang, "dev.lead");
  const page = tl.page;
  await go(page, initiativePath(ini.B.id));
  const network = page.locator("#schedule-network [data-network-status]");
  await expect(network).toHaveAttribute("data-network-status", "not_computable");
  await expect(network.locator("[data-reason='missing_durations']")).toBeVisible();
  await expect(network.locator(`[data-missing='${ini.C.code}']`)).toBeVisible();
  // E.8 item 8: nothing is styled or labelled critical.
  await expect(network.locator("[data-critical], [data-critical-paths], [data-offset]")).toHaveCount(0);
  await expect(page.locator("#execution [data-on-critical-path='unknown'] [data-health='unknown']")).toBeVisible();
  await shot(page, lang, "p4exec-06-network-not-computable");
  await expectAccessible(page, lang, "p4exec-06-network-not-computable");
  // The Transformation Lead records C's duration on C's page.
  await go(page, initiativePath(ini.C.id));
  await page.locator("#schedule-network [data-action='set-duration']").click();
  const dialog = page.getByRole("dialog");
  await field(dialog, "durationWorkingDays").fill("4");
  const post = page.waitForRequest(
    (r) => r.method() === "POST" && r.url().endsWith(`/initiatives/${ini.C.id}/schedule`),
  );
  await submitOf(dialog).click();
  expect((await post).headers()["if-match"]).toBeUndefined();
  await expect(dialog).toBeHidden();
  const computed = page.locator("#schedule-network [data-network-status='computed']");
  await expect(computed.locator("[data-state='network-computed']")).toContainText(
    tr(lang, "executionP4.network.computed", { n: 18 }),
  );
  await expect(computed.locator(`[data-critical-path='${ini.A.code}>${ini.B.code}>${ini.D.code}']`)).toBeVisible();
  const cRow = computed.locator("tr", { has: page.locator(`text=${ini.C.code}`) }).first();
  await expect(cRow.locator("[data-critical='false']")).toBeVisible();
  await expect(cRow.locator("[data-offset]").nth(4)).toHaveAttribute("data-offset", "6");
  await expect(page.locator("#schedule-network [data-own-duration='4']")).toBeVisible();
  await shot(page, lang, "p4exec-07-network-computed");
  await expectAccessible(page, lang, "p4exec-07-network-computed");
  // B's execution view: on the critical path; the slip as the API computes it, or Unknown with its reason.
  await go(page, initiativePath(ini.B.id));
  await expect(page.locator("#execution [data-on-critical-path='true'] [data-critical='true']")).toBeVisible();
  const x = await lead.call<{
    milestones: { title: string; slipWorkingDays: { status: string; value: number | null; reason: string | null } }[];
  }>("GET", `/api/v1/initiatives/${ini.B.id}/execution`);
  const slipOf = (title: string) => x.milestones.find((m) => m.title === title)!.slipWorkingDays;
  const late = slipOf(`Synthetic design sign-off ${lang}`);
  const lateRow = page.locator("#execution tr", { hasText: `Synthetic design sign-off ${lang}` });
  if (late.status === "known") await expect(lateRow.locator(`[data-slip='${late.value}']`)).toBeVisible();
  else await expect(lateRow.locator(`[data-slip='unknown'][data-slip-reason='${late.reason}']`)).toBeVisible();
  const missing = slipOf(`Synthetic data migration ${lang}`);
  expect(missing.status).toBe("unknown");
  await expect(
    page.locator("#execution tr", { hasText: `Synthetic data migration ${lang}` }).locator("[data-slip='unknown']"),
  ).toHaveAttribute("data-slip-reason", missing.reason!);
  await page.locator("#execution").scrollIntoViewIfNeeded();
  await shot(page, lang, "p4exec-08-execution-slip");
  await expectAccessible(page, lang, "p4exec-08-execution-slip");
  await tl.close();
});

test("3. Auditor: read-only panels; 390 px wide and 200 % text without page-level horizontal scroll", async ({
  browser,
}, info) => {
  const lang = langOf(info);
  const aud = await asUser(browser, lang, auditor.username);
  const page = aud.page;
  await go(page, initiativePath(ini.B.id));
  await expect(page.locator("#budget-lines [data-state='panel-read-only']")).toBeVisible();
  await expect(page.locator("#budget-lines [data-total-currency='SAR']")).toBeVisible();
  await expect(page.getByRole("button", { name: tr(lang, "executionP4.budget.add") })).toHaveCount(0);
  await expect(page.locator("[data-action='edit-budget-line'], [data-action='archive-budget-line']")).toHaveCount(0);
  await expect(page.locator("[data-action='set-duration'], [data-action='change-duration']")).toHaveCount(0);
  await shot(page, lang, "p4exec-09-auditor-read-only");
  await expectAccessible(page, lang, "p4exec-09-auditor-read-only");
  await page.setViewportSize({ width: 390, height: 844 });
  await go(page, initiativePath(ini.B.id));
  await expect(page.locator("#schedule-network [data-network-status='computed']")).toBeVisible();
  await expectNoPageOverflow(page);
  await shot(page, lang, "p4exec-10-initiative-390");
  await expectAccessible(page, lang, "p4exec-10-initiative-390");
  await page.setViewportSize({ width: 1280, height: 900 });
  await go(page, initiativePath(ini.B.id));
  await expect(page.locator("#budget-lines [data-total-currency='SAR']")).toBeVisible();
  await page.evaluate(() => (document.documentElement.style.fontSize = "200%"));
  await expectNoPageOverflow(page);
  await shot(page, lang, "p4exec-11-initiative-200pct");
  await aud.close();
});
