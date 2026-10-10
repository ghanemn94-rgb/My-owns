// P4 slices E and D (RAID, actions, corrective actions, forums, meetings, the T16 log) on the REAL stack
// (support/with-stack.sh; no mocks): T-DG4-FE-D (p4-work-split §E.5, §D.5). Every record is SYNTHETIC demo data. The
// executive Outcome recorded here is a synthetic, in-product demo business decision that approves nothing real, and no
// product gate (G1-G6) implies any engineering gate (DG0-DG7).
//  1. RAID (T15): the Transformation Lead logs a Risk (with Probability) and a Dependency (no Probability; the 'To'
//     initiative is required); the Dependency is the canonical T08 row (DEP-nn); its edit offers no 'In progress'.
//  2. Actions: an action added on the Risk appears in the action register with its source, follow-up date and the
//     overdue flag; the overdue filter keeps it.
//  3. Corrective actions: a Value Review case with owner and follow-up date; closed with a note; the rules page labels
//     the built-in rules "Default" until one is saved.
//  4. Forums: the five layers with the verbatim B0093 cadence (Arabic labelled provisional); the Transformation Office
//     creates a weekly Workstream Review series and changes it to fortnightly only after the "future meetings only"
//     confirmation; the result lists the kept meetings.
//  5. Meeting workspace on the Executive SteerCo: an executive ask missing Impact of delay and Required date lists both
//     and the chair's publish is refused (translated 422); once complete it publishes and appears in T16; the meeting
//     runs; the decision owner records the Outcome (a business decision); minutes are drafted, approved and published,
//     and are read-only afterwards.
//  6. T16 log: nine columns, the overdue filter; escalation rules labelled Default; the auditor's read-only views.
//  7. 390 px wide and 200 % text: no page-level horizontal scroll on the RAID register, the meeting and the T16 log.
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
let T = "";
let orgId = "";
let iniB = "";
let meetingId = "";
let office: SyntheticUser;
let sponsor: SyntheticUser;
let auditor: SyntheticUser;
let lead: ApiSession;
const stamp = Date.now().toString(36);

/** A business date n days from today (UTC date; the steps use margins of several days). */
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

async function go(page: Page, path: string) {
  await page.goto(path);
  await expect(page.locator("main#main h1")).toBeVisible();
}

const submitOf = (dialog: Locator) => dialog.locator("[data-action='submit']");
const field = (dialog: Locator, name: string) => dialog.locator(`[data-field='${name}']`);

async function expectNoPageOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

test.beforeAll(async ({ playwright }, info) => {
  const lang = langOf(info);
  lead = await apiSession(playwright, "dev.lead");
  const admin = await apiSession(playwright, "dev.admin");
  tid = (
    await lead.call<{ id: string }>("POST", "/api/v1/transformations", {
      businessUnitId: SYN_RETAIL,
      name: `Synthetic P4 RAID and governance ${lang.toUpperCase()} ${stamp}`,
      mode: "end_to_end",
    })
  ).id;
  T = `/api/v1/transformations/${tid}`;
  orgId = (await admin.call<{ organization: { id: string } }>("GET", "/api/v1/me")).organization.id;
  const mk = (code: string, role: string, name: string) =>
    syntheticUser(admin, orgId, tid, `dev.p4gov.${code}.${lang}.${stamp}`, `${name} ${lang}`, role, lang);
  office = await mk("to", "TO", "Synthetic Transformation Office");
  sponsor = await mk("sp", "SP", "Synthetic Executive Sponsor");
  auditor = await mk("aud", "AUD", "Synthetic Auditor");
  await lead.call("POST", "/api/v1/initiatives", { transformationId: tid, name: `Synthetic onboarding ${lang}` });
  iniB = (
    await lead.call<{ id: string }>("POST", "/api/v1/initiatives", {
      transformationId: tid,
      name: `Synthetic billing platform ${lang}`,
    })
  ).id;
});

test("1. RAID (T15): a Risk and a Dependency logged in the UI; the Dependency needs 'To' and is the T08 row", async ({
  browser,
}, info) => {
  const lang = langOf(info);
  const tl = await asUser(browser, lang, "dev.lead");
  const page = tl.page;
  const foreign = trackRequests(page);
  await go(page, `/transformations/${tid}/raid`);
  await expect(page.locator("main#main h1")).toHaveText(tr(lang, "raidP4.register.title"));
  await expect(page.locator("[data-tab='raid']")).toHaveAttribute("aria-current", "page");
  // Risk with Probability
  await page.getByRole("button", { name: tr(lang, "raidP4.register.create") }).click();
  let dialog = page.getByRole("dialog");
  await field(dialog, "type").selectOption("risk");
  await field(dialog, "description").fill(`Synthetic vendor delay ${lang}`);
  await field(dialog, "impact").selectOption("high");
  await field(dialog, "probability").selectOption("medium");
  await submitOf(dialog).click();
  await expect(dialog).toBeHidden();
  const risk = page.locator("tr", { hasText: `Synthetic vendor delay ${lang}` });
  await expect(risk.locator("[data-level='medium']")).toHaveText(tr(lang, "raidP4.level.medium"));
  await expect(risk.locator("[data-mitigation-header='action']")).toBeVisible();
  // Dependency: no Probability; 'To' is required (nothing is sent without it)
  await page.getByRole("button", { name: tr(lang, "raidP4.register.create") }).click();
  dialog = page.getByRole("dialog");
  await field(dialog, "type").selectOption("dependency");
  await expect(field(dialog, "probability")).toHaveCount(0);
  await field(dialog, "description").fill(`Synthetic billing API needed ${lang}`);
  await field(dialog, "impact").selectOption("medium");
  await submitOf(dialog).click();
  await expect(field(dialog, "toInitiativeId")).toHaveAttribute("aria-invalid", "true");
  await shot(page, lang, "p4raid-01-dependency-to-required");
  await field(dialog, "toInitiativeId").selectOption(iniB);
  await submitOf(dialog).click();
  await expect(dialog).toBeHidden();
  const dep = page.locator("tr", { hasText: `Synthetic billing API needed ${lang}` });
  await expect(dep.locator("[data-level='n/a']")).toBeVisible();
  await expect(dep.locator("[data-t08-link]")).toBeVisible();
  await expect(dep.locator("th").first()).toContainText("DEP-");
  // The same canonical T08 row, listed once on both registers
  const t08 = await lead.call<{ items: { id: string; code: string }[] }>(
    "GET",
    `/api/v1/dependencies?transformationId=${tid}`,
  );
  const raid = await lead.call<{ items: { id: string; code: string; recordTable: string; probability: null }[] }>(
    "GET",
    `${T}/raid`,
  );
  const depEntry = raid.items.find((r) => r.recordTable === "dependency")!;
  expect(depEntry.probability).toBeNull();
  expect(t08.items.filter((d) => d.id === depEntry.id)).toHaveLength(1);
  expect(raid.items.filter((r) => r.id === depEntry.id)).toHaveLength(1);
  // A Dependency has no 'In progress'
  await dep.locator("[data-edit]").click();
  dialog = page.getByRole("dialog");
  await expect(field(dialog, "status")).toHaveCount(0);
  await dialog.getByRole("button", { name: tr(lang, "common.action.cancel") }).click();
  await shot(page, lang, "p4raid-02-register");
  await expectAccessible(page, lang, "p4raid-register");
  await expect(page.locator("main")).not.toContainText(/\bDG[0-7]\b/);
  expect(foreign).toEqual([]);
  await tl.close();
});

test("2. Actions: an action on the Risk is listed with source, follow-up date and the overdue flag", async ({
  browser,
}, info) => {
  const lang = langOf(info);
  const tl = await asUser(browser, lang, "dev.lead");
  const page = tl.page;
  await go(page, `/transformations/${tid}/raid`);
  const risk = page.locator("tr", { hasText: `Synthetic vendor delay ${lang}` });
  await risk.locator("[data-entry-actions]").click();
  let dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: tr(lang, "raidP4.actions.add") }).click();
  dialog = page.getByRole("dialog");
  await field(dialog, "title").fill(`Synthetic call the vendor ${lang}`);
  await field(dialog, "dueDate").fill(day(-3));
  await field(dialog, "followUpDate").fill(day(4));
  await submitOf(dialog).click();
  // Back on the entry's own action list, which now shows the new action with its overdue flag
  dialog = page.getByRole("dialog", { name: tr(lang, "raidP4.actions.ofEntry", { code: "R-01" }) });
  await expect(
    dialog.locator("tr", { hasText: `Synthetic call the vendor ${lang}` }).locator("[data-overdue='true']"),
  ).toBeVisible();
  await shot(page, lang, "p4raid-03a-entry-actions");
  await dialog.getByRole("button", { name: tr(lang, "raidP4.closeDialog") }).click();
  await expect(dialog).toBeHidden();
  await go(page, `/transformations/${tid}/actions`);
  await expect(page.locator("main#main h1")).toHaveText(tr(lang, "raidP4.actions.title"));
  const row = page.locator("tr", { hasText: `Synthetic call the vendor ${lang}` });
  await expect(row.locator("[data-source='raid_entry']")).toHaveText(tr(lang, "raidP4.actions.source.raid_entry"));
  await expect(row.locator("[data-overdue='true']")).toContainText(tr(lang, "raidP4.overdue"));
  await expect(row.locator(`[data-due='${day(4)}']`)).toBeVisible();
  await page.locator("[data-filter='overdue']").check();
  await expect(row).toBeVisible();
  await shot(page, lang, "p4raid-03-action-register");
  await expectAccessible(page, lang, "p4raid-actions");
  await tl.close();
});

test("3. Corrective actions: a Value Review case with owner and follow-up date; rules labelled Default", async ({
  browser,
}, info) => {
  const lang = langOf(info);
  const tl = await asUser(browser, lang, "dev.lead");
  const page = tl.page;
  await go(page, `/transformations/${tid}/corrective-actions`);
  await page.getByRole("button", { name: tr(lang, "raidP4.corrective.create") }).click();
  let dialog = page.getByRole("dialog");
  await field(dialog, "findingRef").fill(`VR-${stamp}-${lang}`);
  await field(dialog, "title").fill(`Synthetic churn benefit below plan ${lang}`);
  await field(dialog, "recoveryPlan").fill("Synthetic recovery: retention offer pilot.");
  await field(dialog, "followUpDate").fill(day(14));
  await submitOf(dialog).click();
  await expect(dialog).toBeHidden();
  await page.locator("a", { hasText: `Synthetic churn benefit below plan ${lang}` }).click();
  const detail = page.locator("[data-case-detail]");
  await expect(detail.locator("[data-source-kind='value_review']")).toBeVisible();
  await expect(detail.locator(`[data-due='${day(14)}']`)).toBeVisible();
  await expect(detail.locator("[data-owner='unassigned']")).toHaveCount(0);
  await shot(page, lang, "p4raid-04-corrective-case");
  await expectAccessible(page, lang, "p4raid-corrective-case");
  await page.locator("[data-close-case]").click();
  dialog = page.getByRole("dialog");
  await field(dialog, "closureNote").fill("Synthetic: recovery confirmed at the Value Review.");
  await submitOf(dialog).click();
  await expect(dialog).toBeHidden();
  await expect(detail.locator("[data-status='closed']")).toBeVisible();
  await go(page, `/transformations/${tid}/corrective-action-rules`);
  await expect(page.locator("[data-rule='kpi_deviation'] [data-default='true']")).toHaveText(
    tr(lang, "raidP4.rules.default"),
  );
  await page.locator("[data-edit-rule='control_check']").click();
  dialog = page.getByRole("dialog");
  await field(dialog, "followUpWorkingDays").fill("3");
  await submitOf(dialog).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator("[data-rule='control_check'] [data-default]")).toHaveCount(0);
  await expect(page.locator("[data-rule='kpi_deviation'] [data-default='true']")).toBeVisible();
  await shot(page, lang, "p4raid-05-rules");
  await expectAccessible(page, lang, "p4raid-rules");
  await tl.close();
});

test("4. Forums: five layers verbatim; a series changed to fortnightly only after 'future meetings only'", async ({
  browser,
}, info) => {
  const lang = langOf(info);
  const to = await asUser(browser, lang, office.username);
  const page = to.page;
  await go(page, `/transformations/${tid}/forums`);
  await expect(page.locator("[data-forums='5']")).toBeVisible();
  await expect(page.locator("[data-verbatim-en='cadence']")).toHaveText([
    "Monthly",
    "Bi-weekly",
    "Weekly",
    "Daily / 2-3x week",
    "Monthly",
  ]);
  if (lang === "ar") await expect(page.locator("[data-provisional='true']")).toHaveCount(5);
  await shot(page, lang, "p4gov-06-forums");
  await expectAccessible(page, lang, "p4gov-forums");
  await page
    .locator("[data-template='workstream_review']")
    .locator("xpath=ancestor::section[1]")
    .getByRole("link")
    .click();
  await expect(page.locator("#forum-series")).toBeVisible();
  // Create a weekly series (Sunday) from today
  await page.getByRole("button", { name: tr(lang, "governanceP4.series.create") }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel(tr(lang, "calendar.weekday.7"), { exact: true }).check();
  await field(dialog, "startDate").fill(day(0));
  await submitOf(dialog).click();
  let result = page.getByRole("dialog", { name: tr(lang, "governanceP4.series.resultTitle") });
  await expect(result).toBeVisible();
  await result.getByRole("button", { name: tr(lang, "governanceP4.close") }).click();
  await expect(page.locator("[data-frequency='weekly:1']")).toBeVisible();
  // Change to fortnightly: refused until "future meetings only" is confirmed
  await page.locator("[data-edit-series]").click();
  dialog = page.getByRole("dialog");
  await expect(dialog).toContainText(tr(lang, "governanceP4.series.futureOnly"));
  await field(dialog, "intervalCount").fill("2");
  await submitOf(dialog).click();
  await expect(field(dialog, "confirmFuture")).toHaveAttribute("aria-invalid", "true");
  await field(dialog, "confirmFuture").selectOption("confirmed");
  await submitOf(dialog).click();
  result = page.getByRole("dialog", { name: tr(lang, "governanceP4.series.resultTitle") });
  await expect(result).toBeVisible();
  await expect(result.locator("[data-series-result='kept']")).toBeVisible();
  await shot(page, lang, "p4gov-07-series-result");
  await expectAccessible(page, lang, "p4gov-series-result");
  await result.getByRole("button", { name: tr(lang, "governanceP4.close") }).click();
  await expect(page.locator("[data-frequency='weekly:2']")).toBeVisible();
  await to.close();
});

test("5. Meeting workspace: an incomplete executive ask is refused, then published to T16 and decided in session", async ({
  browser,
}, info) => {
  const lang = langOf(info);
  const tl = await asUser(browser, lang, "dev.lead");
  let page = tl.page;
  const forums = await lead.call<{ items: { id: string; templateKey: string }[] }>("GET", `${T}/forums`);
  const steerco = forums.items.find((f) => f.templateKey === "executive_steerco")!;
  // The lead creates a SteerCo meeting in the UI
  await go(page, `/transformations/${tid}/meetings`);
  await page.getByRole("button", { name: tr(lang, "governanceP4.meetings.create") }).click();
  let dialog = page.getByRole("dialog");
  await field(dialog, "forumId").selectOption(steerco.id);
  await field(dialog, "scheduledDate").fill(day(7));
  await submitOf(dialog).click();
  await expect(dialog).toBeHidden();
  const list = await lead.call<{ items: { id: string; forumId: string; chairUserId: string | null }[] }>(
    "GET",
    `${T}/meetings?forumId=${steerco.id}`,
  );
  meetingId = list.items[0]!.id;
  await go(page, `/transformations/${tid}/meetings/${meetingId}`);
  // The chair: the Sponsor (named here when the SP role is not mapped to a person)
  if (list.items[0]!.chairUserId !== sponsor.id) {
    await page.getByRole("button", { name: tr(lang, "governanceP4.meeting.edit") }).click();
    dialog = page.getByRole("dialog");
    await field(dialog, "chairUserId").selectOption(sponsor.id);
    await submitOf(dialog).click();
    await expect(dialog).toBeHidden();
  }
  // An executive ask without Impact of delay and Required date: saved as a draft that lists both
  await page.getByRole("button", { name: tr(lang, "governanceP4.agenda.add") }).click();
  dialog = page.getByRole("dialog");
  await field(dialog, "title").fill(`Synthetic switch the billing vendor? ${lang}`);
  await field(dialog, "decisionRequired").fill("Synthetic: switch the billing vendor?");
  await field(dialog, "whyNow").fill("Synthetic: the contract renews next month.");
  await field(dialog, "options").fill("Stay with the current vendor\nSwitch to the second vendor");
  await field(dialog, "recommendation").fill("B");
  await field(dialog, "ownerUserId").selectOption(sponsor.id);
  await submitOf(dialog).click();
  await expect(dialog).toBeHidden();
  const missing = page.locator("[data-missing='impact_of_delay,required_date']");
  await expect(missing).toContainText(tr(lang, "governanceP4.ask.impact_of_delay"));
  await expect(missing).toContainText(tr(lang, "governanceP4.ask.required_date"));
  await shot(page, lang, "p4gov-08-ask-missing-elements");
  await expectAccessible(page, lang, "p4gov-meeting");
  // The chair's publish is refused (422, translated, one alert)
  const sp = await asUser(browser, lang, sponsor.username);
  await go(sp.page, `/transformations/${tid}/meetings/${meetingId}`);
  await sp.page.locator("[data-publish-item]").click();
  const alert = sp.page.locator("#meeting-agenda [role='alert']");
  await expect(alert).toHaveAttribute("data-problem", "agenda_item.executive_ask_incomplete");
  await expect(alert).toContainText(tr(lang, "problems.agenda_item__executive_ask_incomplete"));
  await expect(sp.page.locator("#meeting-agenda [role='alert']")).toHaveCount(1);
  await shot(sp.page, lang, "p4gov-09-publish-refused");
  // The lead completes the brief; the chair publishes the item and the agenda
  await page.reload();
  await page.locator("[data-edit-item]").click();
  dialog = page.getByRole("dialog");
  await field(dialog, "impactOfDelay").fill("Synthetic: a three-month slip of the onboarding wave.");
  await field(dialog, "requiredDate").fill(day(20));
  await submitOf(dialog).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator("[data-missing='none']")).toBeVisible();
  await sp.page.reload();
  await sp.page.locator("[data-publish-item]").click();
  await expect(sp.page.locator("[data-item-status='published']")).toBeVisible();
  await sp.page.locator("[data-meeting-action='publish-agenda']").click();
  await expect(sp.page.locator("[data-meeting-status='agenda_published']").first()).toBeVisible();
  // The ask is in the T16 log (from the agenda)
  const t16 = await lead.call<{ items: { id: string; askOrigin: string; status: string }[] }>(
    "GET",
    `${T}/executive-decisions`,
  );
  expect(t16.items.filter((d) => d.askOrigin === "agenda")).toHaveLength(1);
  // The lead starts the meeting and records the Sponsor present
  await page.reload();
  await page.locator("[data-meeting-action='start']").click();
  await expect(page.locator("[data-meeting-status='in_session']").first()).toBeVisible();
  await page.getByRole("button", { name: tr(lang, "governanceP4.attendance.record") }).click();
  dialog = page.getByRole("dialog");
  await field(dialog, "userId").selectOption(sponsor.id);
  await submitOf(dialog).click();
  await expect(dialog).toBeHidden();
  // The decision owner records the Outcome: a business decision, never an engineering gate
  await sp.page.reload();
  await sp.page.locator("[data-outcome-item]").click();
  dialog = sp.page.getByRole("dialog");
  await expect(dialog.locator("[data-state='business-decision']")).toContainText(
    tr(lang, "governanceP4.businessDecision"),
  );
  await field(dialog, "outcome").selectOption("decided");
  await field(dialog, "chosenOptionLabel").selectOption("B");
  await field(dialog, "outcomeText").fill("Synthetic: switch to the second vendor (demo decision).");
  await shot(sp.page, lang, "p4gov-10-outcome-business-decision");
  await expect(sp.page.locator("body")).not.toContainText(/\bDG[0-7]\b/);
  await submitOf(dialog).click();
  await expect(dialog).toBeHidden();
  await expect(sp.page.locator("[data-outcome='decided']")).toBeVisible();
  // End the meeting; minutes drafted (lead), approved and published (chair); read-only afterwards
  await page.reload();
  await page.locator("[data-meeting-action='close']").click();
  await expect(page.locator("[data-meeting-status='held']").first()).toBeVisible();
  await page.getByRole("button", { name: tr(lang, "governanceP4.minutes.create") }).click();
  dialog = page.getByRole("dialog");
  await field(dialog, "body").fill("Synthetic minutes: the SteerCo decided to switch the billing vendor (demo).");
  await submitOf(dialog).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator("[data-minutes='draft']")).toBeVisible();
  await sp.page.reload();
  await sp.page.locator("[data-minutes-action='approve']").click();
  await expect(sp.page.locator("[data-minutes='approved']")).toBeVisible();
  await sp.page.locator("[data-minutes-action='publish']").click();
  await expect(sp.page.locator("[data-state='minutes-published']")).toBeVisible();
  await expect(sp.page.locator("[data-minutes-action]")).toHaveCount(0);
  await expect(sp.page.locator("[data-publish-item]")).toHaveCount(0);
  page = sp.page;
  await shot(page, lang, "p4gov-11-minutes-published");
  await expectAccessible(page, lang, "p4gov-minutes-published");
  await sp.close();
  await tl.close();
});

test("6. T16 log, escalation rules and the auditor's read-only views", async ({ browser }, info) => {
  const lang = langOf(info);
  const tl = await asUser(browser, lang, "dev.lead");
  const page = tl.page;
  await go(page, `/transformations/${tid}/executive-decisions`);
  const table = page.getByRole("table", { name: tr(lang, "governanceP4.decisions.tableTitle") });
  for (const col of [
    "id",
    "decision",
    "whyNow",
    "options",
    "recommendation",
    "owner",
    "decisionDate",
    "impactOfDelay",
    "outcome",
  ])
    await expect(table.locator("thead")).toContainText(tr(lang, `governanceP4.decisions.col.${col}`));
  await expect(table.locator("[data-decision-status='decided']")).toBeVisible();
  // Raise an ask in the UI (all seven elements)
  await page.getByRole("button", { name: tr(lang, "governanceP4.decisions.create") }).click();
  const dialog = page.getByRole("dialog");
  await field(dialog, "title").fill(`Synthetic fund the second wave? ${lang}`);
  await field(dialog, "whyNow").fill("Synthetic: the budget cycle closes.");
  await field(dialog, "options").fill("Fund now\nDefer a quarter");
  await field(dialog, "recommendation").fill("A");
  await field(dialog, "impactOfDelay").fill("Synthetic: the wave slips one quarter.");
  await field(dialog, "ownerUserId").selectOption(sponsor.id);
  await field(dialog, "requiredDate").fill(day(30));
  await submitOf(dialog).click();
  await expect(dialog).toBeHidden();
  const ask = table.locator("tr", { hasText: `Synthetic fund the second wave? ${lang}` });
  await expect(ask.locator("[data-options='2']")).toBeVisible();
  await page.locator("[data-filter='overdue']").check();
  await expect(ask).toHaveCount(0);
  await shot(page, lang, "p4gov-12-t16-log");
  await expectAccessible(page, lang, "p4gov-t16");
  await go(page, `/transformations/${tid}/escalations`);
  await expect(page.locator("[data-rule='decision_sla'] [data-default='true']")).toBeVisible();
  await expect(page.locator("[data-rule='blocker_red'] [data-default='true']")).toBeVisible();
  await shot(page, lang, "p4gov-13-escalations");
  await expectAccessible(page, lang, "p4gov-escalations");
  await tl.close();
  // The auditor: read-only views, no write control
  const aud = await asUser(browser, lang, auditor.username);
  for (const [path, create] of [
    ["raid", "raidP4.register.create"],
    ["executive-decisions", "governanceP4.decisions.create"],
    [`meetings/${meetingId}`, "governanceP4.agenda.add"],
  ] as const) {
    await go(aud.page, `/transformations/${tid}/${path}`);
    await expect(aud.page.locator("[data-state='read-only']").first()).toBeVisible();
    await expect(aud.page.getByRole("button", { name: tr(lang, create) })).toHaveCount(0);
  }
  await expect(aud.page.locator("[data-edit]")).toHaveCount(0);
  await shot(aud.page, lang, "p4gov-14-auditor-meeting");
  await aud.close();
});

test("7. 390 px wide and 200 % text: no page-level horizontal scroll", async ({ browser }, info) => {
  const lang = langOf(info);
  const tl = await asUser(browser, lang, "dev.lead");
  const page = tl.page;
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [path, name] of [
    ["raid", "p4raid-15-raid-390"],
    [`meetings/${meetingId}`, "p4gov-16-meeting-390"],
    ["executive-decisions", "p4gov-17-t16-390"],
  ] as const) {
    await go(page, `/transformations/${tid}/${path}`);
    await expect(page.locator("main#main table").first()).toBeVisible();
    await expectNoPageOverflow(page);
    await shot(page, lang, name);
    await expectAccessible(page, lang, `${name}-axe`);
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  for (const [path, name] of [
    ["raid", "p4raid-18-raid-200pct"],
    ["executive-decisions", "p4gov-19-t16-200pct"],
  ] as const) {
    await go(page, `/transformations/${tid}/${path}`);
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "200%";
    });
    await expect(page.locator("main#main table").first()).toBeVisible();
    await expectNoPageOverflow(page);
    await shot(page, lang, name);
  }
  await tl.close();
});
