// P4 slice A (KPI engine) on the REAL stack (support/with-stack.sh; no mocks): T-DG4-FE-B (p4-work-split §A.5).
// Every record is SYNTHETIC demo data. The trajectory approval is a demo business approval that approves nothing real,
// and no product gate (G1-G6) implies any engineering gate (DG0-DG7).
//  1. The Lead opens the KPIs: the dictionary says what is missing before the KPI can be measured.
//  2. The Lead creates a draft version (aggregation rule, target, review route) and activates it, then a threshold
//     version and a draft trajectory; a synthetic Sponsor approves the trajectory (API).
//  3. Before any actual, the RAG panel shows Unknown, grey and labelled with its reason, never 0 or green.
//  4. The KPI owner completes the four-step update with the KEYBOARD ONLY; the confirmation lists the downstream views,
//     "review pending" and the Finance review state.
//  4b. The KPI owner may choose an earlier open period too: the transformation's periods (T-DG4-FE-R1, KBE-R2).
//  5. The reviewer (Business Owner) accepts it from the review queue; the owner is never offered a decision.
//  6. The RAG panel: the seven elements, the explanation names threshold version 1. The e2e stack runs no worker, so
//     the calculation stays pending and the status stays Unknown (honest; the worker is proven by KBE-C's tests).
//  7. A manual override (reason, evidence, expiry) is displayed beside the calculated RAG.
//  8. Data quality and an auditor's read-only view; 390 px and 200 % text checks of the KPI and update screens.
// Every step: a full-page screenshot per language and axe with 0 serious or critical issues.
import { expect, test, type Locator, type Page } from "@playwright/test";
import { syntheticUser, type SyntheticUser } from "./support/p3-journey-setup.ts";
import {
  SYN_RETAIL,
  apiSession,
  escape,
  expectAccessible,
  fieldLabel,
  langOf,
  shot,
  signIn,
  tr,
  trackRequests,
  type ApiSession,
  type Lang,
} from "./support/ui.ts";

test.describe.configure({ mode: "serial" });

let tid = "";
let T = "";
let orgId = "";
let kpiId = "";
let periodId = "";
let periodLabel = "";
let earlierPeriodId = "";
let earlierPeriodLabel = "";
let owner: SyntheticUser;
let reviewer: SyntheticUser;
let sponsor: SyntheticUser;
let auditor: SyntheticUser;
let lead: ApiSession;
const stamp = Date.now().toString(36);
const KPI_NAME = (lang: Lang) => `Synthetic digital adoption ${lang.toUpperCase()} ${stamp}`;

async function go(page: Page, path: string) {
  await page.goto(path);
  await expect(page.locator("main#main h1")).toBeVisible();
}

const submitOf = (dialog: Locator) => dialog.locator("[data-action='submit']");

/** The document never scrolls sideways (tables scroll inside their own labelled region). */
async function expectNoPageOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

test.beforeAll(async ({ playwright }, info) => {
  const lang = langOf(info);
  lead = await apiSession(playwright, "dev.lead");
  const admin = await apiSession(playwright, "dev.admin");
  const office = await apiSession(playwright, "dev.office");
  const created = await lead.call<{ id: string }>("POST", "/api/v1/transformations", {
    businessUnitId: SYN_RETAIL,
    name: `Synthetic P4 KPI ${lang.toUpperCase()} ${stamp}`,
    mode: "end_to_end",
  });
  tid = created.id;
  T = `/api/v1/transformations/${tid}`;
  orgId = (await admin.call<{ organization: { id: string } }>("GET", "/api/v1/me")).organization.id;
  const mk = (code: string, role: string, name: string) =>
    syntheticUser(admin, orgId, tid, `dev.p4kpi.${code}.${lang}.${stamp}`, `${name} ${lang}`, role, lang);
  owner = await mk("kds", "KDS", "Synthetic KPI owner");
  reviewer = await mk("bo", "BO", "Synthetic Business Owner");
  sponsor = await mk("sp", "SP", "Synthetic Sponsor");
  auditor = await mk("aud", "AUD", "Synthetic Auditor");
  // The review route goes to the mapped Business Owner (ADR-0026 §2).
  await lead.call("POST", `${T}/role-mappings`, { partyCode: "BO", targetKind: "user", userId: reviewer.id });
  // A DG2 KPI definition (percentage, monthly), owned by the synthetic KPI owner, activated.
  const kpi = await lead.call<{ id: string; version: number }>("POST", `${T}/kpi-definitions`, {
    name: KPI_NAME(lang),
    unitKind: "percentage",
    polarity: "higher_is_better",
    frequency: "monthly",
    ownerUserId: owner.id,
  });
  await lead.call("POST", `${T}/kpi-definitions/${kpi.id}/activate`, undefined, { ifMatch: kpi.version });
  kpiId = kpi.id;
  // One open monthly reporting period of the organization (a free month: periods never overlap).
  const P = `/api/v1/organizations/${orgId}/reporting-periods`;
  for (let i = 0; i < 48 && !periodId; i++) {
    const y = 2031 + Math.floor(((lang === "en" ? 0 : 24) + i) / 12);
    const m = (((lang === "en" ? 0 : 24) + i) % 12) + 1;
    const mm = String(m).padStart(2, "0");
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    try {
      const p = await office.call<{ id: string; version: number; periodLabel: string }>(
        "POST",
        P,
        {
          frequency: "monthly",
          periodLabel: `${y}-${mm}`,
          periodStart: `${y}-${mm}-01`,
          periodEnd: `${y}-${mm}-${last}`,
        },
        { expect: 201 },
      );
      await office.call("POST", `${P}/${p.id}/open`, undefined, { ifMatch: p.version });
      periodId = p.id;
      periodLabel = p.periodLabel;
    } catch {
      // that month exists already: try the next one
    }
  }
  expect(periodId, "an open monthly period").not.toBe("");
  // T-DG4-FE-R1: a second open monthly period, EARLIER than the first (so the KPI's current period stays the first):
  // the update form must offer it too (listTransformationReportingPeriods), not only the current period.
  for (let i = 0; i < 48 && !earlierPeriodId; i++) {
    const y = 2027 + Math.floor(((lang === "en" ? 0 : 24) + i) / 12);
    const m = (((lang === "en" ? 0 : 24) + i) % 12) + 1;
    const mm = String(m).padStart(2, "0");
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    try {
      const p = await office.call<{ id: string; version: number; periodLabel: string }>(
        "POST",
        P,
        {
          frequency: "monthly",
          periodLabel: `${y}-${mm}`,
          periodStart: `${y}-${mm}-01`,
          periodEnd: `${y}-${mm}-${last}`,
        },
        { expect: 201 },
      );
      await office.call("POST", `${P}/${p.id}/open`, undefined, { ifMatch: p.version });
      earlierPeriodId = p.id;
      earlierPeriodLabel = p.periodLabel;
    } catch {
      // that month exists already: try the next one
    }
  }
  expect(earlierPeriodId, "an earlier open monthly period").not.toBe("");
  // Synthetic evidence the owner attaches.
  await lead.call("POST", `${T}/evidence`, {
    kind: "note",
    title: `Synthetic adoption extract ${lang}`,
    noteBody: "Synthetic extract (demo data).",
    ownerUserId: lead.userId,
  });
});

test("1. KPIs: the dictionary says what is missing before the KPI can be measured", async ({ page }, info) => {
  const lang = langOf(info);
  const foreign = trackRequests(page);
  await signIn(page, lang, "dev.lead");
  await go(page, `/transformations/${tid}/kpis`);
  await expect(page.locator("main#main h1")).toHaveText(tr(lang, "kpiP4.list.title"));
  const row = page.locator("#kpi-dictionary tr", { hasText: KPI_NAME(lang) });
  await expect(row.locator("[data-ready='false']")).toContainText(tr(lang, "kpiP4.missing.active_version"));
  // a transformation-scoped Lead cannot list the organization's periods: an honest note, never "not found"
  await expect(page.locator("#reporting-periods [data-state='periods-org-only']")).toBeVisible();
  await shot(page, lang, "p4kpi-01-dictionary");
  await expectAccessible(page, lang, "p4kpi-01-dictionary");
  expect(foreign).toEqual([]);
});

test("1b. reporting periods (transformation office): the update due date is Unknown without a calendar", async ({
  page,
}, info) => {
  const lang = langOf(info);
  await signIn(page, lang, "dev.office");
  await go(page, `/transformations/${tid}/kpis`);
  const row = page.locator(`#reporting-periods tr:has([data-period='${periodLabel}'])`);
  await expect(row.locator("[data-status='open']")).toBeVisible();
  // a working-day date: without a business calendar (dev seed) it is Unknown, never a guessed date
  await expect(row.locator("[data-value-status='unknown']")).toContainText(tr(lang, "kpiP4.reason.due_date_unknown"));
  await shot(page, lang, "p4kpi-01b-reporting-periods");
  await expectAccessible(page, lang, "p4kpi-01b-reporting-periods");
});

test("2. versions, threshold and trajectory through the UI (business approval of the trajectory)", async ({
  page,
  playwright,
}, info) => {
  const lang = langOf(info);
  await signIn(page, lang, "dev.lead");
  await go(page, `/transformations/${tid}/kpis/${kpiId}`);
  // a draft version with its aggregation rule, target and review route
  await page.locator("[data-action='new-version']").click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel(fieldLabel(lang, "kpiP4.version.targetValue")).fill("25");
  await dialog.getByLabel(fieldLabel(lang, "kpiP4.version.targetDate")).fill("2032-12-31");
  await dialog.getByLabel(fieldLabel(lang, "kpiP4.version.reviewer")).selectOption("BO");
  await shot(page, lang, "p4kpi-02-version-draft-form");
  await expectAccessible(page, lang, "p4kpi-02-version-draft-form");
  await submitOf(dialog).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator("#kpi-versions [data-status='draft']")).toBeVisible();
  await page.locator("[data-action='activate-version']").click();
  dialog = page.getByRole("dialog");
  await submitOf(dialog).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator("#kpi-versions [data-status='active']")).toBeVisible();
  // a threshold version (relative: amber from 5 %, red from 10 %)
  await page.locator("[data-action='new-threshold']").click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel(fieldLabel(lang, "kpiP4.threshold.amber")).fill("5");
  await dialog.getByLabel(fieldLabel(lang, "kpiP4.threshold.red")).fill("10");
  await dialog.getByLabel(fieldLabel(lang, "kpiP4.action.reason")).fill("Synthetic tolerance agreed in the demo");
  await submitOf(dialog).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator("#kpi-thresholds")).toContainText("5 %");
  // a draft trajectory; the author cannot approve it
  await page.locator("[data-action='new-trajectory']").click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel(fieldLabel(lang, "kpiP4.trajectory.points")).fill("2030-12-31 5\n2032-12-31 25");
  await submitOf(dialog).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator("#kpi-trajectories [data-status='draft']")).toBeVisible();
  await shot(page, lang, "p4kpi-03-version-threshold-trajectory");
  await expectAccessible(page, lang, "p4kpi-03-version-threshold-trajectory");
  // the synthetic Sponsor approves it (a demo business approval)
  const sp = await apiSession(playwright, sponsor.username);
  const list = await sp.call<{ items: { id: string; version: number }[] }>(
    "GET",
    `${T}/kpi-definitions/${kpiId}/trajectories`,
  );
  await sp.call(
    "POST",
    `${T}/target-trajectories/${list.items[0]!.id}/approve`,
    { comment: "Synthetic demo approval" },
    {
      ifMatch: list.items[0]!.version,
    },
  );
});

test("3. before any actual the RAG panel is Unknown, grey and labelled, never 0 or green", async ({ page }, info) => {
  const lang = langOf(info);
  await signIn(page, lang, "dev.lead");
  await go(page, `/transformations/${tid}/kpis/${kpiId}`);
  const panel = page.locator("[data-rag-panel]");
  await expect(panel.locator("[data-element='actual'] [data-value-status='unknown']")).toBeVisible();
  await expect(panel.locator("[data-element='actual']")).toContainText(tr(lang, "kpiP4.valueStatus.unknown"));
  await expect(panel.locator("[data-rag='green']")).toHaveCount(0);
  await expect(panel.locator("[data-element='actual']")).not.toContainText(/\b0\b/);
  await shot(page, lang, "p4kpi-04-rag-panel-unknown");
  await expectAccessible(page, lang, "p4kpi-04-rag-panel-unknown");
});

test("4. the KPI owner completes the four-step update with the keyboard only", async ({ page }, info) => {
  const lang = langOf(info);
  await signIn(page, lang, owner.username);
  await go(page, `/transformations/${tid}/kpis/${kpiId}/actuals`);
  const form = page.locator("form").filter({ has: page.locator("fieldset[data-step='1']") });
  await expect(form.locator("fieldset[data-step] > legend")).toHaveText(
    [1, 2, 3, 4].map((n) => tr(lang, `kpiP4.update.step${n}`)),
  );
  await shot(page, lang, "p4kpi-05-update-form");
  await expectAccessible(page, lang, "p4kpi-05-update-form");
  // Keyboard only from here: Tab moves between controls, ArrowDown chooses the period, typing enters the value,
  // Space ticks the evidence, Enter submits. The list holds every open monthly period of the organization (latest
  // first, T-DG4-FE-R1), so ArrowDown is pressed until this KPI's period is chosen.
  const tabTo = async (target: Locator, max = 200) => {
    for (let i = 0; i < max; i++) {
      if (await target.evaluate((el) => el === document.activeElement)) return;
      await page.keyboard.press("Tab");
    }
    await expect(target).toBeFocused();
  };
  await page.locator("main#main h1").focus();
  const periodSelect = form.getByLabel(fieldLabel(lang, "kpiP4.field.period"));
  await tabTo(periodSelect); // step 2
  const optionCount = await periodSelect.locator("option").count();
  for (let i = 0; i < optionCount && (await periodSelect.inputValue()) !== periodId; i++)
    await page.keyboard.press("ArrowDown");
  await expect(periodSelect).toHaveValue(periodId);
  const value = form.getByLabel(new RegExp(`^${escape(tr(lang, "kpiP4.field.actual"))}`));
  await tabTo(value); // step 3
  await page.keyboard.type("12.5");
  const evidence = form.getByLabel(`Synthetic adoption extract ${lang}`);
  await tabTo(evidence);
  await page.keyboard.press("Space");
  await expect(evidence).toBeChecked();
  const submit = form.locator("[data-action='submit-actual']");
  await tabTo(submit); // step 4
  await page.keyboard.press("Enter");
  const confirmation = page.locator("[data-state='kpi-update-confirmation']");
  await expect(confirmation).toBeVisible();
  await expect(confirmation).toBeFocused();
  await expect(confirmation).toHaveAttribute("data-review-pending", "true");
  await expect(confirmation).toContainText(tr(lang, "kpiP4.confirm.reviewPending"));
  const finance = (await confirmation.getAttribute("data-finance-review")) ?? "";
  expect(["pending", "not_applicable", "unknown"]).toContain(finance);
  await expect(confirmation.locator("[data-confirm='finance']")).toContainText(
    tr(lang, `kpiP4.confirm.finance.${finance}`),
  );
  await expect(confirmation.locator("[data-downstream-kind='kpi_panel']")).toContainText(
    tr(lang, "kpiP4.downstream.kpi_panel"),
  );
  await expect(confirmation).toContainText(tr(lang, "kpiP4.actualStatus.submitted"));
  await shot(page, lang, "p4kpi-06-update-confirmation");
  await expectAccessible(page, lang, "p4kpi-06-update-confirmation");
});

test("4b. the KPI owner may choose any open period of the KPI's frequency, not only the current one", async ({
  page,
}, info) => {
  // T-DG4-FE-R1 (KBE-R2; REQ-S07-017 "select period"): the periods come from listTransformationReportingPeriods
  // (transformation.read); the organization list, which answers 404 to a transformation-scoped role, is never asked.
  const lang = langOf(info);
  const periodRequests: string[] = [];
  page.on("request", (req) => {
    const path = new URL(req.url()).pathname;
    if (/\/reporting-periods$/.test(path)) periodRequests.push(path);
  });
  await signIn(page, lang, owner.username);
  await go(page, `/transformations/${tid}/kpis/${kpiId}/actuals`);
  const form = page.locator("form").filter({ has: page.locator("fieldset[data-step='1']") });
  const periodSelect = form.getByLabel(fieldLabel(lang, "kpiP4.field.period"));
  await expect(periodSelect.locator(`option[value='${periodId}']`)).toHaveCount(1);
  await expect(periodSelect.locator(`option[value='${earlierPeriodId}']`)).toHaveCount(1);
  await expect(periodSelect.locator(`option[value='${earlierPeriodId}']`)).toContainText(earlierPeriodLabel);
  await periodSelect.selectOption(earlierPeriodId);
  await expect(periodSelect).toHaveValue(earlierPeriodId);
  expect(periodRequests.length).toBeGreaterThan(0);
  expect(periodRequests.every((p) => p === `/api/v1/transformations/${tid}/reporting-periods`)).toBe(true);
  await shot(page, lang, "p4kpi-06b-update-earlier-period");
  await expectAccessible(page, lang, "p4kpi-06b-update-earlier-period");
});

test("5. the reviewer accepts from the review queue; the owner is never offered a decision", async ({ page }, info) => {
  const lang = langOf(info);
  await signIn(page, lang, reviewer.username);
  await go(page, `/transformations/${tid}/kpi-review`);
  const row = page.locator("#kpi-review-queue tr", { hasText: KPI_NAME(lang) });
  await expect(row.locator("[data-actual-status='submitted']")).toBeVisible();
  await shot(page, lang, "p4kpi-07-review-queue");
  await expectAccessible(page, lang, "p4kpi-07-review-queue");
  await row.locator("[data-action='accept-actual']").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText(tr(lang, "kpiP4.review.acceptNote"));
  await submitOf(dialog).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator("#kpi-review-queue tr", { hasText: KPI_NAME(lang) })).toHaveCount(0);
});

test("6. the RAG panel: seven elements; the explanation names threshold version 1", async ({ page }, info) => {
  const lang = langOf(info);
  await signIn(page, lang, "dev.lead");
  await go(page, `/transformations/${tid}/kpis/${kpiId}`);
  const panel = page.locator("[data-rag-panel]");
  for (const el of ["actual", "expected", "target", "variance", "trend", "freshness", "explanation"])
    await expect(panel.locator(`[data-element='${el}']`), el).toBeVisible();
  await expect(panel.locator("[data-element='target']")).toContainText("25 %");
  await expect(panel.locator("[data-element='explanation'] [data-threshold-version='1']")).toContainText(
    tr(lang, "kpiP4.explanation.thresholdConfigured", {
      version: 1,
      amber: "5 %",
      red: "10 %",
      mode: tr(lang, "kpiP4.threshold.modes.relative"),
    }),
  );
  // no worker in the e2e stack: the accepted value waits for its calculation run and stays Unknown, never green
  await expect(panel.locator("[data-rag='green']")).toHaveCount(0);
  await shot(page, lang, "p4kpi-08-rag-panel-seven-elements");
  await expectAccessible(page, lang, "p4kpi-08-rag-panel-seven-elements");
  await go(page, `/transformations/${tid}/kpis/${kpiId}/actuals`);
  await expect(page.locator("#kpi-actuals [data-actual-status='accepted']")).toBeVisible();
  await shot(page, lang, "p4kpi-09-actual-accepted");
});

test("7. a manual override is displayed beside the calculated RAG", async ({ page }, info) => {
  const lang = langOf(info);
  await signIn(page, lang, "dev.lead");
  await go(page, `/transformations/${tid}/kpis/${kpiId}`);
  await page.locator("[data-action='new-override']").click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(fieldLabel(lang, "kpiP4.field.period")).selectOption(periodId);
  await dialog.getByLabel(fieldLabel(lang, "kpiP4.override.rag")).selectOption("amber");
  await dialog.getByLabel(fieldLabel(lang, "kpiP4.override.reason")).fill("Synthetic: data feed under repair");
  await dialog
    .getByLabel(fieldLabel(lang, "kpiP4.field.evidence"))
    .selectOption({ label: `Synthetic adoption extract ${lang}` });
  const expiry = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 16);
  await dialog.getByLabel(fieldLabel(lang, "kpiP4.override.expiresAt")).fill(expiry);
  await submitOf(dialog).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator("#kpi-overrides [data-in-force='true']")).toBeVisible();
  await expect(page.locator("#kpi-overrides [data-rag='amber']").first()).toContainText(tr(lang, "kpiP4.rag.amber"));
  await shot(page, lang, "p4kpi-10-override");
  await expectAccessible(page, lang, "p4kpi-10-override");
});

test("8. data quality, auditor read-only, 390 px and 200 % text", async ({ page, browser }, info) => {
  const lang = langOf(info);
  await signIn(page, lang, "dev.lead");
  await go(page, `/transformations/${tid}/data-quality`);
  await expect(page.locator("main#main h1")).toHaveText(tr(lang, "kpiP4.dq.title"));
  await shot(page, lang, "p4kpi-11-data-quality");
  await expectAccessible(page, lang, "p4kpi-11-data-quality");
  // auditor: read-only KPI page
  const ctx = await browser.newContext({ locale: lang === "ar" ? "ar-SA" : "en-US", timezoneId: "Asia/Riyadh" });
  const aud = await ctx.newPage();
  await signIn(aud, lang, auditor.username);
  await go(aud, `/transformations/${tid}/kpis/${kpiId}`);
  await expect(aud.locator("[data-rag-panel]")).toBeVisible();
  await expect(aud.locator("[data-state='read-only']")).toBeVisible();
  for (const a of ["new-version", "new-threshold", "new-trajectory", "new-override"])
    await expect(aud.locator(`[data-action='${a}']`), a).toHaveCount(0);
  await shot(aud, lang, "p4kpi-12-auditor-read-only");
  await expectAccessible(aud, lang, "p4kpi-12-auditor-read-only");
  await ctx.close();
  // narrow phone width (390 px) and 200 % text on the KPI page and the update form
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [path, name] of [
    [`/transformations/${tid}/kpis/${kpiId}`, "p4kpi-13-kpi-390px"],
    [`/transformations/${tid}/kpis/${kpiId}/actuals`, "p4kpi-14-update-390px"],
  ] as const) {
    await go(page, path);
    await expect(page.locator("main#main h1")).toBeVisible();
    await expectNoPageOverflow(page);
    await shot(page, lang, name);
    await expectAccessible(page, lang, name);
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  for (const [path, name] of [
    [`/transformations/${tid}/kpis/${kpiId}`, "p4kpi-15-kpi-200pct-text"],
    [`/transformations/${tid}/kpis/${kpiId}/actuals`, "p4kpi-16-update-200pct-text"],
  ] as const) {
    await go(page, path);
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "200%";
    });
    await expect(page.locator("main#main h1")).toBeVisible();
    await expectNoPageOverflow(page);
    await shot(page, lang, name);
  }
});
