// FE-F screens against the REAL API (apps/web/e2e/support/with-stack.sh; T-DG5-FE-F; slices G and H): each screen's
// main path and its main refusal, in EN and AR, with axe (no serious or critical violation) and a screenshot.
//  - REQ-PB-086 / S14-004 launch plan: the lead generates the plan of a fresh SYNTHETIC transformation from 2026-10-01
//    (the Days 31-60 tasks fall in November 2026); moving the start date by +7 days re-dates the unstarted tasks; a
//    predecessor loop is refused (422 launch_task.predecessor_cycle); "Blocked by" names the incomplete predecessor;
//    the auditor sees it read-only and gets 403 on a write.
//  - REQ-PB-087 Day-90 test: the six questions verbatim; one answer gives "Incomplete (1/6)"; completing is refused
//    (422 day_ninety_test.incomplete).
//  - REQ-PB-091 / PB-092 / S14-001 / S14-002 health check: 24 answers show "Incomplete (24/25)" and no band; the 25th
//    gives 17 / 25 and the band 16-20; submitting without the top 3 actions is refused (422
//    health_check.actions_required); with them the assessment is submitted.
//  - REQ-S14-003 scoring schemes: v1 with its four source bands and the implementation-assumption notice.
//  - REQ-S08-005 formula preview: the revenue uplift example is in SAR and a missing ARPU is "Not computable".
//  - REQ-S08-019 financial metrics: "Extension, not a playbook requirement", off by default; the lead (no
//    financial_metrics.enable) gets 403 on the switch.
//  - REQ-S07-016 KPI restatement: the prospective rule and the empty state of a new KPI; a restatement without
//    an approved version is refused (422 kpi_restatement.version_not_approved).
// All data is SYNTHETIC. Nothing here is a business approval, and nothing touches the engineering gates DG0-DG7.
import { expect, test, type Browser, type Page } from "@playwright/test";
import {
  SYN_RETAIL,
  apiSession,
  expectAccessible,
  langOf,
  shot,
  signIn,
  tr,
  trackRequests,
  type Lang,
} from "./support/ui.ts";

const h1 = (page: Page) => page.locator("main#main h1");
const alertOf = (page: Page) => page.locator("main [role='alert']").first();

async function asUser(browser: Browser, lang: Lang, username: string) {
  const context = await browser.newContext({ locale: lang === "ar" ? "ar-SA" : "en-US", timezoneId: "Asia/Riyadh" });
  const page = await context.newPage();
  await signIn(page, lang, username);
  return { page, close: () => context.close() };
}

test("Launch plan: generate from a start date, re-date by +7 days, the predecessor loop refusal, Blocked by, and AUD read-only", async ({
  page,
  browser,
  playwright,
}, info) => {
  test.setTimeout(240_000);
  const lang = langOf(info);
  const foreign = trackRequests(page);
  const lead = await apiSession(playwright, "dev.lead");
  const created = await lead.call<{ id: string; code: string }>("POST", "/api/v1/transformations", {
    businessUnitId: SYN_RETAIL,
    name: `Synthetic FE-F ${lang.toUpperCase()} launch`,
    mode: "end_to_end",
  });
  const tid = created.id;
  await signIn(page, lang, "dev.lead");
  await page.goto("/playbook/launch-plan");
  await expect(h1(page)).toHaveText(tr(lang, "launchHealthP5.launch.title"));
  await page.locator(`[data-entry='launch-plan'] a[href='/transformations/${tid}/launch-plan']`).click();
  await expect(page.getByText(tr(lang, "launchHealthP5.launch.noPlan"), { exact: true })).toBeVisible();
  await expect(page.locator("[data-window='days_31_60']")).toBeVisible();
  await page.getByLabel(tr(lang, "launchHealthP5.launch.startDate")).fill("2026-10-01");
  await page.getByRole("button", { name: tr(lang, "launchHealthP5.launch.generate"), exact: true }).click();
  await expect(page.locator("[data-start-date='2026-10-01']")).toBeVisible();
  // REQ-PB-086: the Days 31-60 tasks fall between 2026-11-01 and 2026-11-30.
  const window2 = page.locator("#window-days_31_60 [data-table='launch-tasks'] tbody tr");
  // The plan's start date renders before its task rows: wait for the first row before counting (D-165).
  await expect(window2.first()).toBeVisible();
  expect(await window2.count()).toBeGreaterThan(0);
  for (const due of await page
    .locator("#window-days_31_60 td[data-due]")
    .evaluateAll((els) => els.map((e) => e.getAttribute("data-due"))))
    expect(due! >= "2026-11-01" && due! <= "2026-11-30", String(due)).toBe(true);
  await expectAccessible(page, lang, "p5-launch-plan");
  await shot(page, lang, "p5-launch-plan");

  // REQ-S14-004: +7 days re-dates every unstarted task.
  const firstDue = await page.locator("#window-days_0_30 td[data-due]").first().getAttribute("data-due");
  await page.getByLabel(tr(lang, "launchHealthP5.launch.changeStart")).fill("2026-10-08");
  await page.getByRole("button", { name: tr(lang, "launchHealthP5.launch.redate"), exact: true }).click();
  await expect(page.locator("[data-last-shift='7']")).toBeVisible();
  const plus7 = new Date(`${firstDue}T00:00:00Z`);
  plus7.setUTCDate(plus7.getUTCDate() + 7);
  // The shift marker can render before the re-dated rows: the due date is awaited, not read once (D-165).
  await expect(page.locator("#window-days_0_30 td[data-due]").first()).toHaveAttribute(
    "data-due",
    plus7.toISOString().slice(0, 10),
  );

  // Predecessors: #2 after #1, then #1 after #2 is a loop (422); #2 is "Blocked by" #1 while #1 is incomplete.
  const editOf = (n: number) =>
    page.getByRole("button", { name: new RegExp(`^\\s*${tr(lang, "launchHealthP5.edit")}\\s*#${n}\\s*$`) });
  await editOf(2).click();
  const preds = page.locator("[data-form='task-predecessors']");
  await preds.getByRole("checkbox", { name: /^#1 / }).check();
  await preds.getByRole("button", { name: tr(lang, "launchHealthP5.launch.savePredecessors"), exact: true }).click();
  await expect(page.locator("tr[data-task] [data-blocked-by='1']").first()).toBeVisible();
  await editOf(1).click();
  await page.locator("[data-form='task-predecessors']").getByRole("checkbox", { name: /^#2 / }).check();
  await page
    .locator("[data-form='task-predecessors']")
    .getByRole("button", { name: tr(lang, "launchHealthP5.launch.savePredecessors"), exact: true })
    .click();
  await expect(alertOf(page)).toContainText(tr(lang, "problems.launch_task__predecessor_cycle"));
  await expectAccessible(page, lang, "p5-launch-plan-cycle");
  await shot(page, lang, "p5-launch-plan-cycle");

  // The auditor: read-only, and a write is 403.
  const auditor = await asUser(browser, lang, "dev.auditor");
  try {
    await auditor.page.goto(`/transformations/${tid}/launch-plan`);
    await expect(auditor.page.locator("[data-start-date='2026-10-08']")).toBeVisible();
    await expect(auditor.page.locator("[data-form='redate-plan']")).toHaveCount(0);
    await expect(auditor.page.locator("[data-state='read-only']").first()).toBeVisible();
  } finally {
    await auditor.close();
  }
  const aud = await apiSession(playwright, "dev.auditor");
  const plan = await lead.call<{ version: number }>("GET", `/api/v1/transformations/${tid}/launch-plan`);
  await aud.call(
    "PATCH",
    `/api/v1/transformations/${tid}/launch-plan`,
    { startDate: "2026-10-09" },
    { ifMatch: plan.version, expect: 403 },
  );
  expect(foreign).toEqual([]);

  // REQ-PB-087: the Day-90 test of the same plan.
  await page.goto(`/transformations/${tid}/day-90-test`);
  await expect(h1(page)).toHaveText(tr(lang, "launchHealthP5.day90.title"));
  await expect(page.locator("[data-question]")).toHaveCount(6);
  await expect(page.locator("[data-question='q1'] h3")).toContainText(
    lang === "en"
      ? "Can leaders explain the same case for change and North Star?"
      : "هل يستطيع القادة شرح مبررات التغيير والنجم الشمالي ذاتهما؟",
  );
  const q1 = page.locator("[data-form='respond-q1']");
  await q1.getByLabel(tr(lang, "launchHealthP5.day90.answer.yes"), { exact: true }).check();
  await q1.getByRole("button", { name: tr(lang, "launchHealthP5.day90.save", { n: 1 }), exact: true }).click();
  await expect(page.locator("[data-test-status='open']")).toContainText(
    tr(lang, "launchHealthP5.completion.incomplete", { answered: 1, total: 6 }),
  );
  await page.getByRole("button", { name: tr(lang, "launchHealthP5.day90.complete"), exact: true }).click();
  await expect(alertOf(page)).toContainText(tr(lang, "problems.day_ninety_test__incomplete"));
  await expectAccessible(page, lang, "p5-day-90-test");
  await shot(page, lang, "p5-day-90-test");
});

test("Health check: Incomplete (24/25) with no band, 17 / 25 in band 16-20, the top-3-actions refusal, submit; the schemes", async ({
  page,
  playwright,
}, info) => {
  test.setTimeout(240_000);
  const lang = langOf(info);
  const lead = await apiSession(playwright, "dev.lead");
  const { id: tid } = await lead.call<{ id: string }>("POST", "/api/v1/transformations", {
    businessUnitId: SYN_RETAIL,
    name: `Synthetic FE-F ${lang.toUpperCase()} health`,
    mode: "end_to_end",
  });
  await signIn(page, lang, "dev.lead");
  await page.goto("/playbook/health-check");
  await page.locator(`[data-entry='health-check'] a[href='/transformations/${tid}/health-check']`).click();
  await expect(h1(page)).toHaveText(tr(lang, "launchHealthP5.health.title"));
  await page.getByRole("button", { name: tr(lang, "launchHealthP5.health.start"), exact: true }).click();
  await expect(page.locator("[data-assessment-status='draft']")).toBeVisible();
  // 24 answers through the API (17 Yes), the 25th through the screen.
  const list = await lead.call<{ items: { id: string }[] }>("GET", `/api/v1/transformations/${tid}/health-checks`);
  const aid = list.items[0]!.id;
  for (let i = 1; i <= 24; i++) {
    const a = await lead.call<{ version: number }>("GET", `/api/v1/transformations/${tid}/health-checks/${aid}`);
    await lead.call(
      "PUT",
      `/api/v1/transformations/${tid}/health-checks/${aid}/answers/q${String(i).padStart(2, "0")}`,
      { response: i <= 17 ? "yes" : "no" },
      { ifMatch: a.version },
    );
  }
  await page.reload();
  const facts = page.locator("[data-assessment-status='draft']");
  await expect(facts).toContainText(tr(lang, "launchHealthP5.completion.incomplete", { answered: 24, total: 25 }));
  await expect(facts.locator("[data-band='none']")).toHaveText(tr(lang, "launchHealthP5.health.noBand"));
  await expect(page.locator("[data-state='scoring-assumption']").first()).toContainText(
    tr(lang, "launchHealthP5.health.scoringAssumption"),
  );
  await expect(page.locator("[data-question]")).toHaveCount(25);
  await expectAccessible(page, lang, "p5-health-check-incomplete");
  await shot(page, lang, "p5-health-check-incomplete");
  const q25 = page.locator("[data-form='answer-q25']");
  await q25.getByLabel(tr(lang, "launchHealthP5.health.response.no"), { exact: true }).check();
  await q25.getByRole("button", { name: tr(lang, "launchHealthP5.health.saveAnswer", { n: 25 }), exact: true }).click();
  await expect(page.locator("[data-field='score'] [data-score='17']")).toBeVisible();
  await expect(page.locator("[data-field='band'] [data-band='16-20']")).toBeVisible();
  await page.getByRole("button", { name: tr(lang, "launchHealthP5.health.submit"), exact: true }).click();
  await expect(alertOf(page)).toContainText(tr(lang, "problems.health_check__actions_required"));
  for (const n of [1, 2, 3])
    await page
      .getByLabel(tr(lang, "launchHealthP5.health.actionText", { n }), { exact: true })
      .fill(`Synthetic action ${n}`);
  // Wait for the save AND the reload of the assessment (its version steps), so Submit sends the current If-Match.
  const saved = page.waitForResponse((r) => r.request().method() === "PUT" && /\/actions$/.test(r.url()));
  const reloaded = page.waitForResponse(
    (r) => r.request().method() === "GET" && new RegExp(`/health-checks/${aid}$`).test(r.url()),
  );
  await page.getByRole("button", { name: tr(lang, "launchHealthP5.health.saveActions"), exact: true }).click();
  expect((await saved).status()).toBe(200);
  await reloaded;
  await expect(page.locator("[data-form='health-actions'] [role='alert']")).toHaveCount(0);
  await page.getByRole("button", { name: tr(lang, "launchHealthP5.health.submit"), exact: true }).click();
  await expect(page.locator("[data-assessment-status='submitted']")).toBeVisible();
  await expect(page.locator("[data-assessment-status='submitted'] [data-band='16-20']")).toBeVisible();
  await expectAccessible(page, lang, "p5-health-check-submitted");
  await shot(page, lang, "p5-health-check-submitted");

  // REQ-S14-003: the published scheme v1 with the four source bands.
  await page.goto("/admin/health-schemes");
  await expect(h1(page)).toHaveText(tr(lang, "launchHealthP5.schemes.title"));
  await expect(page.locator("[data-table='scheme-bands'] tbody tr")).toHaveCount(4);
  await expect(page.locator("[data-table='scheme-bands'] [data-band='16-20']")).toBeVisible();
  await expect(page.locator("[data-state='scoring-assumption']")).toBeVisible();
  await expectAccessible(page, lang, "p5-health-schemes");
  await shot(page, lang, "p5-health-schemes");
});

test("Formula preview, financial metrics and KPI restatement: SAR and Not computable; the extension off with its 403; the version refusal", async ({
  page,
  playwright,
}, info) => {
  test.setTimeout(240_000);
  const lang = langOf(info);
  const lead = await apiSession(playwright, "dev.lead");
  const { id: tid } = await lead.call<{ id: string }>("POST", "/api/v1/transformations", {
    businessUnitId: SYN_RETAIL,
    name: `Synthetic FE-F ${lang.toUpperCase()} value`,
    mode: "end_to_end",
  });
  const formula = await lead.call<{ id: string }>("POST", "/api/v1/benefit-formulas", {
    transformationId: tid,
    benefitName: "Synthetic revenue uplift",
    fromExample: "revenue_uplift",
  });
  await signIn(page, lang, "dev.lead");
  await page.goto(`/transformations/${tid}/benefit-formulas/${formula.id}`);
  await page.locator("[data-link='formula-preview'] a").click();
  await expect(h1(page)).toHaveText(tr(lang, "launchHealthP5.preview.title"));
  await expect(page.locator("[data-field='unit'] [data-unit-currency='SAR']")).toContainText("SAR");
  await expect(page.locator("main")).not.toContainText(/per customer/i);
  const missing = page.locator("[data-edge='arpu:missing']");
  await expect(missing).toContainText(tr(lang, "launchHealthP5.notComputable"));
  await expectAccessible(page, lang, "p5-formula-preview");
  await shot(page, lang, "p5-formula-preview");

  // REQ-S08-019: off by default, labelled an extension; the lead may not switch it on.
  await page.goto(`/transformations/${tid}/financial-metrics`);
  await expect(h1(page)).toHaveText(tr(lang, "launchHealthP5.finance.title"));
  await expect(page.locator("[data-state='extension']")).toContainText(tr(lang, "launchHealthP5.finance.extension"));
  const settings = await lead.call<{ enabled: boolean; version: number }>(
    "GET",
    "/api/v1/benefits/financial-metrics/settings",
  );
  if (!settings.enabled) await expect(page.locator("[data-enabled='false']")).toBeVisible();
  await lead.call(
    "PUT",
    "/api/v1/benefits/financial-metrics/settings/enablement",
    { enabled: true },
    { ifMatch: settings.version, expect: 403 },
  );
  await expectAccessible(page, lang, "p5-financial-metrics");
  await shot(page, lang, "p5-financial-metrics");

  // REQ-S07-016: a new KPI has no restatement; a restatement without a closed period is refused.
  const kpi = await lead.call<{ definition?: { id: string }; id?: string }>(
    "POST",
    `/api/v1/transformations/${tid}/kpi-definitions`,
    {
      name: "Synthetic roaming churn",
      unitKind: "count",
      unitLabel: "subscribers",
      polarity: "lower_is_better",
    },
  );
  const kpiId = kpi.definition?.id ?? kpi.id!;
  const versions = await lead.call<{ items: { id: string }[] }>(
    "GET",
    `/api/v1/transformations/${tid}/kpi-definitions/${kpiId}/versions`,
  );
  await page.goto(`/transformations/${tid}/kpis/${kpiId}/restatements`);
  await expect(h1(page)).toHaveText(tr(lang, "launchHealthP5.restatement.title"));
  await expect(page.locator("[data-state='prospective']")).toContainText(
    tr(lang, "launchHealthP5.restatement.prospective"),
  );
  await expect(page.getByText(tr(lang, "launchHealthP5.restatement.none"), { exact: true })).toBeVisible();
  await expect(page.getByText(tr(lang, "launchHealthP5.restatement.noClosedPeriods"), { exact: true })).toBeVisible();
  await expectAccessible(page, lang, "p5-kpi-restatements");
  await shot(page, lang, "p5-kpi-restatements");
  // No approved version exists yet (a new KPI has at most a draft): the restatement is refused before anything else.
  const refused = await lead.call<{ code: string }>(
    "POST",
    `/api/v1/transformations/${tid}/kpi-definitions/${kpiId}/restatements`,
    {
      kpiVersionId: versions.items[0]?.id ?? crypto.randomUUID(),
      reportingPeriodIds: [],
      reason: "Synthetic restatement",
    },
    { expect: 422 },
  );
  expect(refused.code).toBe("kpi_restatement.version_not_approved");
});
