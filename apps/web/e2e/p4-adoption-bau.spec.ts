// P4 slices F and G (adoption; BAU, performance areas, improvement, lessons) on the REAL stack (support/with-stack.sh;
// no mocks): T-DG4-FE-E (p4-work-split §F+G FG.8). Every record is SYNTHETIC demo data. The BAU handover acceptance
// recorded here is a synthetic, in-product demo business decision by the receiving owner that approves nothing real,
// and no product gate (G1-G6) implies any engineering gate (DG0-DG7).
//  1. T13 (REQ-PB-070, REQ-S11-001): the Transformation Lead adds a stakeholder group in the UI with the closed lists;
//     the plan shows the seven columns and influence separately; the API refuses stance 'Hostile'.
//  2. Interventions (REQ-S11-001): an intervention with owner and due date appears in the owner's My Work; its
//     work-item link opens the intervention.
//  3. Indicators (REQ-PB-071): the seven indicators by name (Arabic marked provisional).
//  4. Training vs proficiency and forms (REQ-PB-072, REQ-S11-002): 100 % training completion with no observation shows
//     proficiency Unknown; the Business Owner builds, publishes and answers a proficiency form; the observation links
//     to the group and the proficiency measure counts it.
//  5. Champion constraints (REQ-PB-073): a champion raises a constraint on a T04 design decision; it is listed on that
//     decision through the decision filter.
//  6. BAU handover (REQ-S11-005, REQ-PB-083): a handover missing data access is refused with "data access" named in
//     the shown language; another Business Owner cannot accept (403); the receiving owner accepts (business
//     approval) and exactly one recurring review is created for the BAU owner, also after a repeated accept.
//  7. Reopen, CI backlog and lessons (REQ-S11-009, REQ-PB-084, REQ-S11-008): reopening keeps the original handover
//     acceptance; a CI item; a published lesson is found from another transformation by its auditor.
//  8. Read-only auditor views; 390 px wide and 200 % text without page-level horizontal scroll.
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
let tid2 = "";
let T = "";
let orgId = "";
let groupId = "";
let areaId = "";
let handoverId = "";
let bo: SyntheticUser;
let bo2: SyntheticUser;
let auditor: SyntheticUser;
let lead: ApiSession;
let boApi: ApiSession;
const stamp = Date.now().toString(36);
const GROUP = (lang: string) => `Synthetic store supervisors ${lang} ${stamp}`;
const LESSON_WORD = `zebrafish${stamp}`;

/** A business date n days from today (Asia/Riyadh; the steps use margins of several days). */
const day = (n: number) => {
  const d = new Date(Date.now() + 3 * 3_600_000 + n * 86_400_000);
  return d.toISOString().slice(0, 10);
};

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
  const office = await apiSession(playwright, "dev.office");
  tid = (
    await lead.call<{ id: string }>("POST", "/api/v1/transformations", {
      businessUnitId: SYN_RETAIL,
      name: `Synthetic P4 adoption and BAU ${lang.toUpperCase()} ${stamp}`,
      mode: "end_to_end",
    })
  ).id;
  tid2 = (
    await lead.call<{ id: string }>("POST", "/api/v1/transformations", {
      businessUnitId: SYN_RETAIL,
      name: `Synthetic P4 other transformation ${lang.toUpperCase()} ${stamp}`,
      mode: "end_to_end",
    })
  ).id;
  T = `/api/v1/transformations/${tid}`;
  orgId = (await admin.call<{ organization: { id: string } }>("GET", "/api/v1/me")).organization.id;
  const mk = (code: string, role: string, name: string, on = tid) =>
    syntheticUser(admin, orgId, on, `dev.p4ad.${code}.${lang}.${stamp}`, `${name} ${lang}`, role, lang);
  bo = await mk("bo", "BO", "Synthetic Business Owner");
  bo2 = await mk("bo2", "BO", "Synthetic Second Business Owner");
  auditor = await mk("aud", "AUD", "Synthetic Auditor");
  await admin.call("POST", "/api/v1/role-assignments", {
    userId: auditor.id,
    roleCode: "AUD",
    scope: { type: "transformation", id: tid2 },
    reason: "Synthetic demo AUD on a second transformation for the lesson search (approves nothing real)",
  });
  boApi = await apiSession(playwright, bo.username);
  // One open monthly reporting period containing today (the indicators read the latest started period). Another
  // spec or the other language may have created it already: periods never overlap, so that one is used.
  const P = `/api/v1/organizations/${orgId}/reporting-periods`;
  const y = Number(day(0).slice(0, 4));
  const m = Number(day(0).slice(5, 7));
  const mm = String(m).padStart(2, "0");
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const res = await office.req.fetch(P, {
    method: "POST",
    headers: {
      "X-CSRF-Token": (await (await office.req.get("/api/v1/me")).json()).csrfToken,
      "Idempotency-Key": crypto.randomUUID(),
    },
    data: {
      frequency: "monthly",
      periodLabel: `${y}-${mm}`,
      periodStart: `${y}-${mm}-01`,
      periodEnd: `${y}-${mm}-${last}`,
    },
  });
  if (res.status() === 201) {
    const p = (await res.json()) as { id: string; version: number };
    await office.call("POST", `${P}/${p.id}/open`, undefined, { ifMatch: p.version });
  }
});

test("1. T13: a stakeholder group with the closed lists; seven columns; 'Hostile' refused", async ({
  browser,
}, info) => {
  const lang = langOf(info);
  const tl = await asUser(browser, lang, "dev.lead");
  const page = tl.page;
  const foreign = trackRequests(page);
  await go(page, `/transformations/${tid}/adoption`);
  await expect(page.locator("main#main h1")).toHaveText(tr(lang, "adoptionP4.plan.title"));
  await expect(page.locator("[data-tab='adoption']")).toHaveAttribute("aria-current", "page");
  await page.getByRole("button", { name: tr(lang, "adoptionP4.groups.create") }).click();
  const dialog = page.getByRole("dialog");
  await expect(field(dialog, "currentStance").locator("option:not([value=''])")).toHaveCount(3);
  await field(dialog, "name").fill(GROUP(lang));
  await field(dialog, "impact").selectOption("H");
  await field(dialog, "influence").selectOption("L");
  await field(dialog, "currentStance").selectOption("resist");
  await field(dialog, "requiredBehavior").fill("Synthetic: use the queue screen for every walk-in");
  await dialog
    .getByLabel(`${tr(lang, "adoptionP4.col.intervention")}: ${tr(lang, "adoptionP4.intervention.comms")}`)
    .check();
  await dialog
    .getByLabel(`${tr(lang, "adoptionP4.col.intervention")}: ${tr(lang, "adoptionP4.intervention.training")}`)
    .check();
  await field(dialog, "ownerUserId").selectOption(bo.id);
  await shot(page, lang, "p4ad-01-group-form");
  await submitOf(dialog).click();
  await expect(dialog).toBeHidden();
  const plan = page.locator("#t13");
  const headers = await plan.locator("thead th").allTextContents();
  for (const col of [
    "stakeholder",
    "impact",
    "currentStance",
    "requiredBehavior",
    "intervention",
    "owner",
    "adoptionKpi",
    "influence",
  ])
    expect(
      headers.some((h) => h.includes(tr(lang, `adoptionP4.col.${col}`))),
      col,
    ).toBe(true);
  const row = plan.locator("tr", { hasText: GROUP(lang) });
  await expect(row.locator("[data-stance='resist']")).toContainText(tr(lang, "adoptionP4.stance.resist"));
  await expect(row.locator("[data-level='H']")).toHaveText(tr(lang, "adoptionP4.level.H"));
  await expect(row.locator("[data-level='L']")).toHaveText(tr(lang, "adoptionP4.level.L"));
  await expect(row.locator("[data-interventions='comms,training']")).toBeVisible();
  if (lang === "ar") await expect(page.locator("[data-ar-provisional]").first()).toBeVisible();
  const groups = await lead.call<{ items: { id: string; name: string }[] }>("GET", `${T}/stakeholder-groups`);
  groupId = groups.items.find((g) => g.name === GROUP(lang))!.id;
  // The API refuses a stance outside the closed list (REQ-PB-070 "stance 'Hostile' is rejected").
  const hostile = await lead.req.fetch(`${T}/stakeholder-groups/${groupId}`, {
    method: "PATCH",
    headers: {
      "X-CSRF-Token": (await (await lead.req.get("/api/v1/me")).json()).csrfToken,
      "If-Match": '"1"',
    },
    data: { currentStance: "hostile" },
  });
  expect(hostile.status()).toBe(400);
  expect(JSON.stringify(await hostile.json())).toContain("stakeholder_group.stance_invalid");
  await shot(page, lang, "p4ad-02-t13-plan");
  await expectAccessible(page, lang, "p4ad-t13-plan");
  expect(foreign).toEqual([]);
  await tl.close();
});

test("2. An intervention with owner and due date appears in the owner's My Work", async ({ browser }, info) => {
  const lang = langOf(info);
  const tl = await asUser(browser, lang, "dev.lead");
  const page = tl.page;
  await go(page, `/transformations/${tid}/adoption-interventions`);
  await page.getByRole("button", { name: tr(lang, "adoptionP4.interventions.create") }).click();
  const dialog = page.getByRole("dialog");
  await field(dialog, "interventionType").selectOption("training");
  await field(dialog, "title").fill(`Synthetic queue screen training ${lang}`);
  await field(dialog, "stakeholderGroupId").selectOption(groupId);
  await field(dialog, "ownerUserId").selectOption(bo.id);
  await field(dialog, "dueDate").fill(day(10));
  await submitOf(dialog).click();
  await expect(dialog).toBeHidden();
  const row = page.locator("tr", { hasText: `Synthetic queue screen training ${lang}` });
  await expect(row.locator("[data-origin='manual']")).toBeVisible();
  await shot(page, lang, "p4ad-03-interventions");
  await expectAccessible(page, lang, "p4ad-interventions");
  await tl.close();
  // The owner's My Work holds the task; its link opens the intervention.
  const items = await boApi.call<{ items: { kind: string; linkPath: string | null }[] }>(
    "GET",
    "/api/v1/me/work-items",
  );
  const task = items.items.find((w) => w.kind === "adoption_intervention_due");
  expect(task, "adoption_intervention_due in the owner's My Work").toBeTruthy();
  const owner = await asUser(browser, lang, bo.username);
  await go(owner.page, task!.linkPath!);
  await expect(owner.page.locator("[data-intervention-detail]")).toBeVisible();
  await expect(owner.page.locator("main#main")).toContainText(`Synthetic queue screen training ${lang}`);
  await shot(owner.page, lang, "p4ad-04-intervention-detail");
  await expectAccessible(owner.page, lang, "p4ad-intervention-detail");
  await owner.close();
});

test("3. The seven leading adoption indicators by name", async ({ browser }, info) => {
  const lang = langOf(info);
  const tl = await asUser(browser, lang, "dev.lead");
  const page = tl.page;
  await go(page, `/transformations/${tid}/adoption-indicators`);
  const templates = page.locator("#adoption-templates");
  for (const name of [
    "Usage / activation rate",
    "Compliance with new process",
    "Cycle-time shift",
    "Training completion + observed proficiency",
    "Decision turnaround time",
    "Percentage of transactions handled through the new journey",
    "Exception / workaround rate",
  ])
    await expect(templates.getByText(name, { exact: true }).first()).toBeVisible();
  if (lang === "ar") await expect(templates.locator("[data-ar-provisional]").first()).toBeVisible();
  await expect(page.locator("#adoption-values")).toBeVisible();
  await shot(page, lang, "p4ad-05-indicators");
  await expectAccessible(page, lang, "p4ad-indicators");
  await tl.close();
});

test("4. Training 100 % with no observation shows proficiency Unknown; a form observation then counts", async ({
  browser,
}, info) => {
  const lang = langOf(info);
  await boApi.call("POST", `${T}/training-records`, {
    stakeholderGroupId: groupId,
    participantLabel: `Synthetic agent 7 ${lang}`,
    trainingTitle: `Synthetic queue screen course ${lang}`,
  });
  const owner = await asUser(browser, lang, bo.username);
  const page = owner.page;
  await go(page, `/transformations/${tid}/adoption-training`);
  await page.locator("#training-group").selectOption(groupId);
  await page.locator("[data-training-update]").first().click();
  let dialog = page.getByRole("dialog");
  await field(dialog, "status").selectOption("completed");
  await field(dialog, "completedOn").fill(day(0));
  await submitOf(dialog).click();
  await expect(dialog).toBeHidden();
  const completion = page.locator("[data-measure-card='training_completion']");
  const proficiency = page.locator("[data-measure-card='observed_proficiency']");
  await expect(completion.locator("[data-value-status='ok']")).toContainText("100");
  await expect(proficiency.locator("[data-value-status='unknown']")).toContainText(tr(lang, "common.value.unknown"));
  await expect(proficiency).not.toContainText("100");
  await shot(page, lang, "p4ad-06-training-vs-proficiency-unknown");
  await expectAccessible(page, lang, "p4ad-training-unknown");
  // Build, publish and answer a proficiency form (REQ-S11-002).
  await go(page, `/transformations/${tid}/assessment-forms`);
  await page.getByRole("button", { name: tr(lang, "adoptionP4.forms.create") }).click();
  dialog = page.getByRole("dialog");
  await field(dialog, "kind").selectOption("proficiency_assessment");
  await field(dialog, "name").fill(`Synthetic queue observation ${lang} ${stamp}`);
  await dialog.getByLabel(tr(lang, "adoptionP4.col.stakeholder")).selectOption(groupId);
  await dialog.getByLabel(tr(lang, "adoptionP4.forms.labelEn")).fill("Uses the queue screen unaided");
  await dialog.getByLabel(tr(lang, "adoptionP4.forms.labelAr")).fill("يستخدم شاشة الطابور دون مساعدة");
  await dialog.getByLabel(tr(lang, "adoptionP4.forms.proficiencyQuestion")).check();
  await shot(page, lang, "p4ad-07-form-builder");
  await expectAccessible(page, lang, "p4ad-form-builder");
  await submitOf(dialog).click();
  await expect(dialog).toBeHidden();
  await page.locator(`[data-form-link='Synthetic queue observation ${lang} ${stamp}']`).click();
  await expect(page.locator("[data-state='draft']")).toBeVisible();
  await page.locator("[data-publish]").click();
  await expect(page.locator("[data-respond]")).toBeVisible();
  await page.locator("[data-respond]").click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel(tr(lang, "adoptionP4.forms.subjectLabel")).fill(`Synthetic agent 7 ${lang}`);
  await dialog.locator("[data-answer='q1']").selectOption("yes");
  await submitOf(dialog).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator("#assessment-records [data-proficiency='proficient']")).toBeVisible();
  await shot(page, lang, "p4ad-08-form-response");
  await expectAccessible(page, lang, "p4ad-form");
  await go(page, `/transformations/${tid}/adoption-training`);
  await page.locator("#training-group").selectOption(groupId);
  await expect(proficiency.locator("[data-value-status='ok']")).toContainText("100");
  await expect(page.locator("#proficiency-observations tr", { hasText: `Synthetic agent 7 ${lang}` })).toBeVisible();
  await shot(page, lang, "p4ad-09-proficiency-counted");
  await owner.close();
});

test("5. A champion's constraint on a T04 design decision is listed on that decision", async ({ browser }, info) => {
  const lang = langOf(info);
  await lead.call("POST", `${T}/stakeholder-groups/${groupId}/champions`, { userId: bo.id });
  const decision = await lead.call<{ id: string; code: string }>("POST", "/api/v1/decisions", {
    transformationId: tid,
    kind: "design",
    title: `Synthetic queue screen layout ${lang}`,
  });
  const owner = await asUser(browser, lang, bo.username);
  const page = owner.page;
  await go(page, `/transformations/${tid}/decisions`);
  await page.locator("[data-raise-constraint]").click();
  const dialog = page.getByRole("dialog");
  const champions = page.waitForResponse((r) => r.url().includes(`/stakeholder-groups/${groupId}/champions`));
  await field(dialog, "groupId").selectOption(groupId);
  await champions;
  await field(dialog, "decisionId").selectOption(decision.id);
  await field(dialog, "constraintText").fill(`Synthetic: supervisors need offline mode ${lang}`);
  await submitOf(dialog).click();
  await expect(dialog).toBeHidden();
  const section = page.locator("#champion-constraints");
  await section.locator("#constraint-decision").selectOption(decision.id);
  await expect(section.locator("tr", { hasText: `Synthetic: supervisors need offline mode ${lang}` })).toBeVisible();
  await expect(section.locator("tbody th").first()).toContainText(decision.code);
  await shot(page, lang, "p4ad-10-champion-constraint");
  await expectAccessible(page, lang, "p4ad-champion-constraints");
  await owner.close();
});

test("6. BAU handover: data access missing is refused; only the receiving owner accepts; one review", async ({
  browser,
  playwright,
}, info) => {
  const lang = langOf(info);
  const owner = await asUser(browser, lang, bo.username);
  let page = owner.page;
  await go(page, `/transformations/${tid}/bau`);
  await page.getByRole("button", { name: tr(lang, "sustainP4.areas.create") }).click();
  let dialog = page.getByRole("dialog");
  await field(dialog, "name").fill(`Synthetic walk-in service ${lang}`);
  await submitOf(dialog).click();
  await expect(dialog).toBeHidden();
  await page
    .locator("tr", { hasText: `Synthetic walk-in service ${lang}` })
    .locator("[data-area-link]")
    .click();
  areaId = page.url().split("/performance-areas/")[1]!;
  await page.locator("#area-controls [data-create-control]").click();
  dialog = page.getByRole("dialog");
  await field(dialog, "name").fill(`Synthetic queue log reconciliation ${lang}`);
  await submitOf(dialog).click();
  await expect(dialog).toBeHidden();
  await owner.close();
  await lead.call("POST", `${T}/evidence`, {
    kind: "note",
    title: `Synthetic SOP sign-off ${lang}`,
    noteBody: "Synthetic SOP sign-off (demo data).",
    ownerUserId: lead.userId,
  });
  // The Transformation Lead prepares the handover without data access.
  const tl = await asUser(browser, lang, "dev.lead");
  page = tl.page;
  await go(page, `/transformations/${tid}/performance-areas/${areaId}`);
  await page.locator("[data-prepare-handover]").click();
  dialog = page.getByRole("dialog");
  await field(dialog, "receivingOwnerUserId").selectOption(bo.id);
  await field(dialog, "kpiOwnerUserId").selectOption(bo.id);
  await field(dialog, "operatingProcedures").fill("Synthetic SOP v2");
  await field(dialog, "capabilityReadiness").fill("Synthetic: supervisors trained");
  await field(dialog, "unresolvedAcceptedRisks").fill("Synthetic: none material");
  await field(dialog, "benefitMonitoringCadence").selectOption("monthly");
  await field(dialog, "improvementBacklogSummary").fill("Synthetic: one open item");
  await submitOf(dialog).click();
  await expect(dialog).toBeHidden();
  await page.locator("[data-handover-link]").first().click();
  handoverId = page.url().split("/bau-handovers/")[1]!;
  await page.locator("[data-add-evidence]").click();
  dialog = page.getByRole("dialog");
  await field(dialog, "evidenceId").selectOption({ label: `Synthetic SOP sign-off ${lang}` });
  await submitOf(dialog).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator("[data-item='data_access']")).toHaveAttribute("data-item-state", "missing");
  await page.locator("[data-submit-handover]").click();
  const alert = page.locator("[role='alert'][data-problem='bau_handover.incomplete']");
  await expect(alert).toBeVisible();
  await expect(alert.locator("[data-missing-items]")).toHaveText(tr(lang, "sustainP4.handover.item.data_access"));
  await shot(page, lang, "p4ad-11-handover-incomplete");
  await expectAccessible(page, lang, "p4ad-handover-incomplete");
  await page.locator("[data-edit-handover]").click();
  dialog = page.getByRole("dialog");
  await field(dialog, "dataAccess").fill("Synthetic: BI read role for the queue log");
  await submitOf(dialog).click();
  await expect(dialog).toBeHidden();
  await page.locator("[data-submit-handover]").click();
  await expect(page.locator("[data-status='submitted']").first()).toBeVisible();
  await tl.close();
  // Another Business Owner is not the receiving owner: no action offered, and the API answers 403.
  const other = await asUser(browser, lang, bo2.username);
  await go(other.page, `/transformations/${tid}/bau-handovers/${handoverId}`);
  await expect(other.page.locator("[data-state='receiving-owner-only']")).toBeVisible();
  await expect(other.page.locator("[data-accept-handover]")).toHaveCount(0);
  await other.close();
  const bo2Api = await apiSession(playwright, bo2.username);
  const h = await boApi.call<{ version: number }>("GET", `${T}/bau-handovers/${handoverId}`);
  const refused = await bo2Api.call<{ code: string }>(
    "POST",
    `${T}/bau-handovers/${handoverId}/accept`,
    {},
    {
      ifMatch: h.version,
      expect: 403,
    },
  );
  expect(refused.code).toBe("bau_handover.not_receiving_owner");
  // The receiving owner accepts (a business approval inside the product).
  const recv = await asUser(browser, lang, bo.username);
  page = recv.page;
  await go(page, `/transformations/${tid}/bau-handovers/${handoverId}`);
  await page.locator("[data-accept-handover]").click();
  dialog = page.getByRole("dialog");
  await expect(dialog.locator("[data-state='business-approval']")).toContainText(
    tr(lang, "myWork.ui.businessApproval"),
  );
  await expect(dialog).not.toContainText(/\bDG[0-7]\b/);
  await shot(page, lang, "p4ad-12-accept-business-approval");
  await expectAccessible(page, lang, "p4ad-accept");
  await submitOf(dialog).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator("[data-state='accepted-final']")).toBeVisible();
  const reviews = await boApi.call<{ items: { assigneeUserId: string }[] }>(
    "GET",
    `${T}/sustainment-reviews?performanceAreaId=${areaId}`,
  );
  expect(reviews.items).toHaveLength(1);
  expect(reviews.items[0]!.assigneeUserId).toBe(bo.id);
  const after = await boApi.call<{ version: number }>("GET", `${T}/bau-handovers/${handoverId}`);
  await boApi.call("POST", `${T}/bau-handovers/${handoverId}/accept`, {}, { ifMatch: after.version, expect: 422 });
  const again = await boApi.call<{ items: unknown[] }>("GET", `${T}/sustainment-reviews?performanceAreaId=${areaId}`);
  expect(again.items).toHaveLength(1);
  await go(page, `/transformations/${tid}/bau-reviews`);
  await expect(page.locator("#bau-reviews tbody tr")).toHaveCount(1);
  await shot(page, lang, "p4ad-13-first-review");
  await expectAccessible(page, lang, "p4ad-reviews");
  await recv.close();
});

test("7. Reopen keeps the handover acceptance; a CI item; a published lesson found from another transformation", async ({
  browser,
}, info) => {
  const lang = langOf(info);
  const owner = await asUser(browser, lang, bo.username);
  const page = owner.page;
  await go(page, `/transformations/${tid}/performance-areas/${areaId}`);
  await page.locator("[data-reopen]").click();
  let dialog = page.getByRole("dialog");
  await field(dialog, "reason").fill("Synthetic: walk-in waits deteriorated");
  await submitOf(dialog).click();
  await expect(dialog).toBeHidden();
  const cycle2 = page.locator("[data-cycle='2']");
  await expect(cycle2).toContainText("Synthetic: walk-in waits deteriorated");
  const accepted = await cycle2.locator("[data-prior-handover-accepted]").getAttribute("data-prior-handover-accepted");
  const h = await boApi.call<{ acceptedAt: string }>("GET", `${T}/bau-handovers/${handoverId}`);
  expect(accepted).toBe(h.acceptedAt);
  await shot(page, lang, "p4ad-14-reopened-cycles");
  await expectAccessible(page, lang, "p4ad-area");
  // CI backlog
  await go(page, `/transformations/${tid}/improvement`);
  await page.getByRole("button", { name: tr(lang, "sustainP4.improvement.create") }).click();
  dialog = page.getByRole("dialog");
  await field(dialog, "title").fill(`Synthetic: shorten the walk-in triage ${lang}`);
  await field(dialog, "priority").selectOption("H");
  await submitOf(dialog).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator("tr", { hasText: `Synthetic: shorten the walk-in triage ${lang}` })).toBeVisible();
  await shot(page, lang, "p4ad-15-ci-backlog");
  await expectAccessible(page, lang, "p4ad-ci");
  // Lessons: create and publish
  await go(page, `/transformations/${tid}/lessons`);
  await page.getByRole("button", { name: tr(lang, "sustainP4.lessons.create") }).click();
  dialog = page.getByRole("dialog");
  await field(dialog, "title").fill(`Synthetic: pilot with champions first ${lang}`);
  await field(dialog, "lessonText").fill(`Synthetic: champions halved the resistance ${LESSON_WORD}`);
  await field(dialog, "tags").fill("adoption, champions");
  await submitOf(dialog).click();
  await expect(dialog).toBeHidden();
  const row = page.locator("tr", { hasText: `Synthetic: pilot with champions first ${lang}` });
  await expect(row.locator("[data-status='draft']")).toBeVisible();
  await row.locator("[data-publish]").click();
  await expect(row.locator("[data-status='published']")).toBeVisible();
  await shot(page, lang, "p4ad-16-lessons");
  await expectAccessible(page, lang, "p4ad-lessons");
  await owner.close();
  // The auditor of the other transformation finds it (REQ-S11-008).
  const aud = await asUser(browser, lang, auditor.username);
  await go(aud.page, "/lessons");
  await aud.page.locator("#lesson-q").fill(LESSON_WORD);
  await aud.page.locator("[data-search-submit]").click();
  const hit = aud.page.locator("tr", { hasText: `Synthetic: pilot with champions first ${lang}` });
  await expect(hit).toBeVisible();
  await expect(hit).toContainText(`Synthetic P4 adoption and BAU ${lang.toUpperCase()} ${stamp}`);
  await shot(aud.page, lang, "p4ad-17-lesson-search");
  await expectAccessible(aud.page, lang, "p4ad-lesson-search");
  await aud.close();
});

test("8. Auditor read-only views; 390 px and 200 % text without page-level horizontal scroll", async ({
  browser,
}, info) => {
  const lang = langOf(info);
  const aud = await asUser(browser, lang, auditor.username);
  const page = aud.page;
  await go(page, `/transformations/${tid}/adoption`);
  await expect(page.locator("[data-state='read-only']")).toBeVisible();
  await expect(page.getByRole("button", { name: tr(lang, "adoptionP4.groups.create") })).toHaveCount(0);
  await go(page, `/transformations/${tid}/bau-handovers/${handoverId}`);
  await expect(page.locator("[data-accept-handover], [data-submit-handover]")).toHaveCount(0);
  await shot(page, lang, "p4ad-18-auditor-read-only");
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [path, name] of [
    [`/transformations/${tid}/adoption`, "plan"],
    [`/transformations/${tid}/adoption-training`, "training"],
    [`/transformations/${tid}/bau-handovers/${handoverId}`, "handover"],
    [`/transformations/${tid}/performance-areas/${areaId}`, "area"],
    ["/lessons", "lesson-search"],
  ] as const) {
    await go(page, path);
    await expectNoPageOverflow(page);
    await expectAccessible(page, lang, `p4ad-390-${name}`);
  }
  await shot(page, lang, "p4ad-19-390px");
  await page.setViewportSize({ width: 1280, height: 900 });
  for (const [path, name] of [
    [`/transformations/${tid}/adoption`, "plan"],
    [`/transformations/${tid}/performance-areas/${areaId}`, "area"],
    [`/transformations/${tid}/improvement`, "ci"],
  ] as const) {
    await go(page, path);
    await page.evaluate(() => (document.documentElement.style.fontSize = "200%"));
    await expectNoPageOverflow(page);
    await expectAccessible(page, lang, `p4ad-200pct-${name}`);
  }
  await shot(page, lang, "p4ad-20-200pct-text");
  await aud.close();
});
