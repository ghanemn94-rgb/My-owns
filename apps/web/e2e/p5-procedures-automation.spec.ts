// FE-D screens against the REAL API (apps/web/e2e/support/with-stack.sh; T-DG5-FE-D; slices C, D, E): each screen's
// main path and its main refusal, in EN and AR, with axe (no serious or critical violation) and a screenshot.
//  - REQ-S12-022 jobs operations: last success ("Never run") and next run for each scheduled job; run now; the auditor
//    (a non-admin) gets 403.
//  - REQ-S12-001 / S12-002 rule builder: a SYNTHETIC methodology administrator (ADM_METHOD granted to `dev.nobody` by
//    `dev.admin`, REVOKED at the end, as p5-studio.spec.ts does) builds a rule in the readable builder; submit before a
//    dry run is refused (422 automation_rule_version.dry_run_required); the dry run creates nothing; the Transformation
//    Office reviews; the administrator publishes, enables and then disables it (a reason is required). The rule's
//    condition (`gateCode eq "G6"` on gate.decided) and the final disable keep it from acting in later specs. A starter
//    says why it cannot be disabled.
//  - REQ-S06-002 my procedures and the instance view: the lead launches `baseline_validation` in a fresh SYNTHETIC
//    transformation; the instance shows its current step, the assignee role, the due date and the missing inputs;
//    completing the BO step as the TL is refused (403 procedure_step.not_assignee).
//  - REQ-S06-001 procedure builder: the definitions of the published version; in a procedures draft (created and
//    DISCARDED by the test), a new procedure without trigger and completion is validated (both findings listed) and its
//    save is refused (422 procedure_definition.trigger_required); a seeded definition is edited and saved to the draft.
//  - REQ-S12-025 notification preferences: quiet hours with start = end are refused (422 quiet_hours_invalid); quiet
//    hours with a daily digest are saved; the preferences are reset to "deliver at once" at the end.
//  - REQ-S10-015 / S04-011 / S12-015 / S12-002: the approval routes, gate conditions, cut-off pack and failure-queue
//    screens render their real (empty) states.
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
  type ApiSession,
  type Lang,
} from "./support/ui.ts";

const ORG = "01920000-0000-7000-9000-000000000001";
const NOBODY = "01920000-0000-7000-9000-000000000205";

async function asUser(
  browser: Browser,
  lang: Lang,
  username: string,
): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext({ locale: lang === "ar" ? "ar-SA" : "en-US", timezoneId: "Asia/Riyadh" });
  const page = await context.newPage();
  await signIn(page, lang, username);
  return { page, close: () => context.close() };
}

/** A SYNTHETIC ADM_METHOD grant for dev.nobody; returns the revoke to call in `finally`. */
async function grantMethodologyAdmin(admin: ApiSession): Promise<() => Promise<void>> {
  type Assignment = { id: string; roleCode: string; revokedAt: string | null; version: number };
  const active = async () =>
    (
      await admin.call<{ items: Assignment[] }>(
        "GET",
        `/api/v1/role-assignments?organizationId=${ORG}&userId=${NOBODY}`,
      )
    ).items.filter((a) => a.roleCode === "ADM_METHOD" && a.revokedAt === null);
  if ((await active()).length === 0)
    await admin.call("POST", "/api/v1/role-assignments", {
      userId: NOBODY,
      roleCode: "ADM_METHOD",
      scope: { type: "organization", id: ORG },
      reason: "Synthetic methodology administrator for the FE-D journey",
    });
  return async () => {
    for (const a of await active())
      await admin.call(
        "POST",
        `/api/v1/role-assignments/${a.id}/revoke`,
        { reason: "End of the synthetic FE-D journey" },
        { ifMatch: a.version },
      );
  };
}

const h1 = (page: Page) => page.locator("main#main h1");
const alertOf = (page: Page) => page.locator("main [role='alert']").first();

test("Jobs operations: last success and next run for each scheduled job, run now; the auditor gets 403", async ({
  page,
  browser,
}, info) => {
  test.setTimeout(90_000);
  const lang = langOf(info);
  const foreign = trackRequests(page);
  await signIn(page, lang, "dev.admin");
  await page.goto("/admin/jobs/operations");
  await expect(h1(page)).toHaveText(tr(lang, "workflowsP5.jobs.title"));
  const row = page.locator("tr", { hasText: "approval.escalation_scan" });
  // Last success is a recorded time, or "Never run" when no run has succeeded yet (in a long suite the job may
  // already have run): never empty, never a guessed time. The next run is a computed instant.
  const lastSuccess = row.locator("td").nth(0);
  await expect(lastSuccess.locator("[data-last-success], [data-status='never_run']")).toHaveCount(1);
  if ((await lastSuccess.locator("[data-status='never_run']").count()) === 1)
    await expect(lastSuccess.locator("[data-status='never_run']")).toHaveText(tr(lang, "workflowsP5.jobs.neverRun"));
  await expect(row.locator("[data-next-run]")).toHaveCount(1);
  await expect(page.getByRole("link", { name: tr(lang, "nav.sub.jobOperations"), exact: true })).toBeVisible();
  await expectAccessible(page, lang, "p5-jobs-operations");
  await shot(page, lang, "p5-jobs-operations");
  await row.getByRole("button", { name: new RegExp(tr(lang, "workflowsP5.jobs.runNow")) }).click();
  await expect(page.locator("main [role='alert']")).toHaveCount(0);
  // The auditor (not a technical administrator): the server's 403 is the no-permission state.
  const auditor = await asUser(browser, lang, "dev.auditor");
  try {
    await auditor.page.goto("/admin/jobs/operations");
    await expect(auditor.page.getByText(tr(lang, "common.state.noPermissionTitle"), { exact: true })).toBeVisible();
    await shot(auditor.page, lang, "p5-jobs-operations-403");
  } finally {
    await auditor.close();
  }
  expect(foreign).toEqual([]);
});

test("Automation: the readable builder, the dry-run refusal, a dry run with no side effects, review, publish, enable and disable", async ({
  page,
  browser,
  playwright,
}, info) => {
  test.setTimeout(150_000);
  const lang = langOf(info);
  const foreign = trackRequests(page);
  const admin = await apiSession(playwright, "dev.admin");
  const revoke = await grantMethodologyAdmin(admin);
  try {
    const code = `synthetic.fed.${lang}.${Date.now()}`;
    const lead = await apiSession(playwright, "dev.lead");
    const target = await lead.call<{ id: string }>("POST", "/api/v1/transformations", {
      businessUnitId: SYN_RETAIL,
      name: `Synthetic FE-D ${lang.toUpperCase()} automation`,
      mode: "end_to_end",
    });
    await signIn(page, lang, "dev.nobody");
    await page.goto("/admin/automation");
    await expect(h1(page)).toHaveText(tr(lang, "nav.p5.automation.title"));
    await expect(page.locator("[data-protected='true']").first()).toBeVisible();
    await page.getByRole("button", { name: tr(lang, "workflowsP5.rules.create"), exact: true }).click();
    const form = page.locator("[data-form='create-rule']");
    await form.getByLabel(tr(lang, "workflowsP5.field.code")).fill(code);
    await form
      .getByLabel(`${tr(lang, "workflowsP5.builder.name")} (${tr(lang, "workflowsP5.lang.en")})`)
      .fill("Synthetic FE-D follow-up");
    await form
      .getByLabel(`${tr(lang, "workflowsP5.builder.name")} (${tr(lang, "workflowsP5.lang.ar")})`)
      .fill("متابعة اصطناعية");
    await form.getByLabel(tr(lang, "workflowsP5.rules.scope")).selectOption("organization");
    await form.locator("#create-trigger-gate\\.decided").check();
    await form.getByRole("button", { name: tr(lang, "workflowsP5.rules.addCondition"), exact: true }).click();
    await form.getByLabel(tr(lang, "workflowsP5.rules.conditionField", { n: 1 })).selectOption("gateCode");
    await form.getByLabel(tr(lang, "workflowsP5.rules.conditionValue", { n: 1 })).fill("G6");
    await form.locator("#create-action-role-0").fill("TO");
    await expect(form.locator("[data-human-only='approve_gate']")).toBeVisible();
    await expectAccessible(page, lang, "p5-automation-builder");
    await shot(page, lang, "p5-automation-builder");
    await form.getByRole("button", { name: tr(lang, "workflowsP5.rules.createSubmit"), exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/automation\/rules\/[0-9a-f-]+$/);
    const ruleUrl = new URL(page.url()).pathname;
    await expect(page.locator("[data-panel='dry-run'] [data-status='not_run']")).toBeVisible();

    // The main refusal: submitting before a passing dry run of the current content.
    await page.getByRole("button", { name: tr(lang, "workflowsP5.rules.submit"), exact: true }).click();
    await expect(alertOf(page)).toHaveAttribute("data-problem", "automation_rule_version.dry_run_required");
    await expect(alertOf(page)).toContainText(tr(lang, "problems.automation_rule_version__dry_run_required"));

    // A dry run against a SYNTHETIC gate.decided event: what each action would do; nothing is created.
    const uuid = () => crypto.randomUUID();
    const sample = {
      gateInstanceId: uuid(),
      transformationId: target.id,
      gateCode: "G6",
      submissionId: uuid(),
      submissionNo: 1,
      gateDecisionId: uuid(),
      outcome: "approved",
      decidedBy: uuid(),
      nextPhase: null,
      scaleScopeItemIds: [],
      conditionIds: [],
    };
    await page.getByLabel(tr(lang, "workflowsP5.dryRun.payload")).fill(JSON.stringify(sample));
    await page.getByRole("button", { name: tr(lang, "workflowsP5.dryRun.run"), exact: true }).click();
    await expect(page.locator("[data-dry-run-result]")).toBeVisible();
    await expect(page.locator("[data-dry-run-result]")).toContainText(tr(lang, "workflowsP5.dryRun.noSideEffects"));
    await expectAccessible(page, lang, "p5-automation-dry-run");
    await shot(page, lang, "p5-automation-dry-run");
    const outcome = await page.locator("[data-dry-run-result]").getAttribute("data-dry-run-result");
    expect(outcome, "the dry run of the synthetic sample").toBe("pass");
    await expect(page.locator("[data-panel='dry-run'] > p [data-status='pass']")).toBeVisible();

    // Submit; the Transformation Office reviews (a configuration review, not a business approval).
    await page.getByRole("button", { name: tr(lang, "workflowsP5.rules.submit"), exact: true }).click();
    await expect(page.locator("[data-version-status='in_review']")).toBeVisible();
    const office = await asUser(browser, lang, "dev.office");
    try {
      await office.page.goto(ruleUrl);
      await office.page.locator("#review-outcome").selectOption("approve");
      await office.page.getByRole("button", { name: tr(lang, "workflowsP5.rules.recordReview"), exact: true }).click();
      await expect(office.page.locator("[data-version-status='approved']")).toBeVisible();
    } finally {
      await office.close();
    }

    // Publish, enable, then disable with a reason (an administrator rule may be disabled).
    await page.reload();
    await page.getByRole("button", { name: tr(lang, "workflowsP5.rules.publish"), exact: true }).click();
    await expect(page.locator("[data-version-status='published']")).toBeVisible();
    await page.getByRole("button", { name: tr(lang, "workflowsP5.rules.enable"), exact: true }).click();
    await expect(page.locator("[data-rule][data-enabled='true']")).toBeVisible();
    await expectAccessible(page, lang, "p5-automation-rule-enabled");
    await shot(page, lang, "p5-automation-rule-enabled");
    await page.locator("#disable-rule-text").fill("Synthetic: end of the FE-D journey");
    await page.getByRole("button", { name: tr(lang, "workflowsP5.rules.disable"), exact: true }).click();
    await expect(page.locator("[data-rule][data-enabled='false']")).toBeVisible();

    // A starter that implements an earlier-stage guarantee says why it cannot be disabled.
    await page.goto("/admin/automation");
    await page.locator("tr", { hasText: "starter.gate_approved" }).getByRole("link").first().click();
    await expect(page.locator("[data-state='guarantee-protected']")).toHaveText(
      tr(lang, "problems.automation_rule__guarantee_protected"),
    );
    await expect(page.getByRole("button", { name: tr(lang, "workflowsP5.rules.disable"), exact: true })).toHaveCount(0);
    await shot(page, lang, "p5-automation-starter");
  } finally {
    await revoke();
  }
  expect(foreign).toEqual([]);
});

test("My procedures: launch baseline validation; the instance shows its current step, assignee, due date and missing inputs; the TL cannot complete the BO step", async ({
  page,
  playwright,
}, info) => {
  test.setTimeout(90_000);
  const lang = langOf(info);
  const foreign = trackRequests(page);
  const lead = await apiSession(playwright, "dev.lead");
  const created = await lead.call<{ id: string; code: string }>("POST", "/api/v1/transformations", {
    businessUnitId: SYN_RETAIL,
    name: `Synthetic FE-D ${lang.toUpperCase()} procedures`,
    mode: "end_to_end",
  });
  await signIn(page, lang, "dev.lead");
  await page.goto("/playbook/procedures");
  await expect(h1(page)).toHaveText(tr(lang, "nav.p5.myProcedures.title"));
  const launch = page.locator("[data-form='launch-procedure']");
  await launch.getByLabel(tr(lang, "workflowsP5.procedures.procedure")).selectOption("baseline_validation");
  await launch.getByLabel(tr(lang, "workflowsP5.field.transformation")).selectOption(created.id);
  await expectAccessible(page, lang, "p5-my-procedures");
  await shot(page, lang, "p5-my-procedures");
  await launch.getByRole("button", { name: tr(lang, "workflowsP5.procedures.launch"), exact: true }).click();
  await expect(page).toHaveURL(/\/playbook\/procedures\/[0-9a-f-]+$/);
  const current = page.locator("[data-step='record_baseline']");
  await expect(current).toHaveAttribute("data-step-status", "active");
  await expect(current).toContainText("BO");
  await expect(page.locator("[data-missing-inputs='5']")).toBeVisible();
  await expect(page.locator("[data-next-action]")).toBeVisible();
  await expectAccessible(page, lang, "p5-procedure-instance");
  await shot(page, lang, "p5-procedure-instance");
  // The main refusal: the step belongs to the BO role; the lead (TL) cannot complete it.
  await page.getByRole("button", { name: tr(lang, "workflowsP5.procedures.complete"), exact: true }).click();
  await expect(alertOf(page)).toHaveAttribute("data-problem", "procedure_step.not_assignee");
  await expect(alertOf(page)).toContainText(tr(lang, "problems.procedure_step__not_assignee"));
  expect(foreign).toEqual([]);
});

test("Procedure builder: the published definitions; in a draft, validation lists every finding, a definition without a trigger is refused, a seeded one is saved to the draft", async ({
  page,
  playwright,
}, info) => {
  test.setTimeout(120_000);
  const lang = langOf(info);
  const foreign = trackRequests(page);
  const admin = await apiSession(playwright, "dev.admin");
  const revoke = await grantMethodologyAdmin(admin);
  type Version = { id: string; status: string; draftStage: string | null; isNewestPublished: boolean; version: number };
  let adm: ApiSession | null = null;
  let draft: Version | null = null;
  try {
    adm = await apiSession(playwright, "dev.nobody");
    for (const d of (
      await adm.call<{ items: Version[] }>("GET", "/api/v1/admin/methodology-versions?kind=procedure&status=draft")
    ).items)
      if (d.draftStage !== "discarded")
        await adm.call("POST", `/api/v1/admin/methodology-versions/${d.id}/discard`, undefined, { ifMatch: d.version });
    const published = (
      await adm.call<{ items: Version[] }>("GET", "/api/v1/admin/methodology-versions?kind=procedure&status=published")
    ).items.find((v) => v.isNewestPublished)!;

    // The published definitions, read-only (no draft is open).
    await signIn(page, lang, "dev.nobody");
    await page.goto("/admin/procedures");
    await expect(h1(page)).toHaveText(tr(lang, "nav.p5.procedureBuilder.title"));
    await expect(page.locator("#p5-procedure-definitions, [data-p5-screen='procedure-builder']").first()).toBeVisible();
    await expect(
      page.getByRole("link", { name: tr(lang, "nav.p5.methodologyCoverage.title"), exact: true }),
    ).toBeVisible();
    await expectAccessible(page, lang, "p5-procedure-builder");
    await shot(page, lang, "p5-procedure-builder");

    draft = await adm.call<Version>("POST", "/api/v1/admin/methodology-versions", {
      basedOnVersionId: published.id,
      titleEn: "Synthetic procedures draft (FE-D)",
      titleAr: "مسودة إجراءات اصطناعية",
    });
    await page.goto(`/admin/procedures/synthetic_fed_${lang}?versionId=${draft.id}&new=1`);
    const builder = page.locator("[data-form='procedure-builder']");
    await expect(builder).toBeVisible();
    // Everything but the trigger and the completion condition.
    const field = (key: string, l?: "en" | "ar", n = 0) =>
      builder
        .getByLabel(l ? `${tr(lang, key)} (${tr(lang, `workflowsP5.lang.${l}`)})` : tr(lang, key), { exact: true })
        .nth(n);
    await field("workflowsP5.builder.name", "en").fill("Synthetic FE-D review");
    await field("workflowsP5.builder.name", "ar").fill("مراجعة اصطناعية");
    await field("workflowsP5.builder.purpose", "en").fill("Synthetic purpose");
    await field("workflowsP5.builder.purpose", "ar").fill("غرض اصطناعي");
    await field("workflowsP5.builder.description", "en", 1).fill("One transformation");
    await field("workflowsP5.builder.description", "ar", 1).fill("تحول واحد");
    await field("workflowsP5.builder.launchRoles").fill("TL");
    await field("workflowsP5.builder.responsibleRoles").fill("TL");
    await field("workflowsP5.builder.validationRules", "en").fill("Synthetic rule");
    await field("workflowsP5.builder.validationRules", "ar").fill("قاعدة اصطناعية");
    await field("workflowsP5.builder.expectedOutputs", "en").fill("Synthetic output");
    await field("workflowsP5.builder.expectedOutputs", "ar").fill("مخرج اصطناعي");
    await builder.getByLabel(`${tr(lang, "workflowsP5.builder.stepKey")} 1`, { exact: true }).fill("review");
    await builder.getByLabel(`${tr(lang, "workflowsP5.builder.labelEn")} 1`, { exact: true }).fill("Review");
    await builder.getByLabel(`${tr(lang, "workflowsP5.builder.labelAr")} 1`, { exact: true }).fill("مراجعة");
    await builder.getByLabel(`${tr(lang, "workflowsP5.builder.responsibleRole")} 1`, { exact: true }).fill("TL");
    await page.getByRole("button", { name: tr(lang, "workflowsP5.builder.validate"), exact: true }).click();
    const report = page.locator("[data-validation='invalid']");
    await expect(report.locator("[data-finding='procedure_definition.trigger_required']")).toBeVisible();
    await expect(report.locator("[data-finding='procedure_definition.completion_required']")).toBeVisible();
    await expectAccessible(page, lang, "p5-procedure-builder-findings");
    await shot(page, lang, "p5-procedure-builder-findings");
    await page.getByRole("button", { name: tr(lang, "workflowsP5.builder.save"), exact: true }).click();
    await expect(alertOf(page)).toHaveAttribute(
      "data-problem",
      /^procedure_definition\.(trigger|completion)_required$/,
    );

    // A seeded definition, edited in the draft and saved (not published).
    await page.goto(`/admin/procedures/bau_handover?versionId=${draft.id}`);
    await page.getByRole("button", { name: tr(lang, "workflowsP5.builder.edit"), exact: true }).click();
    const nameEn = page.getByLabel(`${tr(lang, "workflowsP5.builder.name")} (${tr(lang, "workflowsP5.lang.en")})`, {
      exact: true,
    });
    await nameEn.fill(`BAU handover (synthetic ${lang})`);
    await page.getByRole("button", { name: tr(lang, "workflowsP5.builder.save"), exact: true }).click();
    await expect(page.locator("[data-state='saved-draft']")).toHaveText(tr(lang, "workflowsP5.builder.savedDraft"));
    await expect(page.locator("[data-version-state='editing']").first()).toBeVisible();
    await shot(page, lang, "p5-procedure-builder-saved");

    // The coverage view: every methodology element with its form or procedure.
    await page.goto("/admin/coverage");
    await expect(h1(page)).toHaveText(tr(lang, "nav.p5.methodologyCoverage.title"));
    await expect(page.locator("[data-totals]")).toBeVisible();
    await expectAccessible(page, lang, "p5-methodology-coverage");
    await shot(page, lang, "p5-methodology-coverage");
  } finally {
    if (adm && draft) {
      const current = await adm.call<Version>("GET", `/api/v1/admin/methodology-versions/${draft.id}`);
      if (current.status === "draft")
        await adm.call("POST", `/api/v1/admin/methodology-versions/${draft.id}/discard`, undefined, {
          ifMatch: current.version,
        });
    }
    await revoke();
  }
  expect(foreign).toEqual([]);
});

test("Notification preferences: equal quiet-hour times are refused; quiet hours with a daily digest are saved; reset to deliver at once", async ({
  page,
  playwright,
}, info) => {
  test.setTimeout(90_000);
  const lang = langOf(info);
  const foreign = trackRequests(page);
  const admin = await apiSession(playwright, "dev.admin");
  const revoke = await grantMethodologyAdmin(admin);
  try {
    await signIn(page, lang, "dev.nobody");
    await page.goto("/my-work/notification-preferences");
    await expect(h1(page)).toHaveText(tr(lang, "nav.p5.notificationPreferences.title"));
    await expect(page.locator("[data-state='urgent-policy']")).toHaveText(tr(lang, "workflowsP5.prefs.urgentNote"));
    await page.getByLabel(tr(lang, "workflowsP5.prefs.quietOn")).check();
    await page.getByLabel(new RegExp(tr(lang, "workflowsP5.prefs.quietStart"))).fill("22:00");
    await page.getByLabel(new RegExp(tr(lang, "workflowsP5.prefs.quietEnd"))).fill("22:00");
    await page.getByRole("button", { name: tr(lang, "workflowsP5.prefs.save"), exact: true }).click();
    await expect(alertOf(page)).toHaveAttribute("data-problem", "notification_preference.quiet_hours_invalid");
    await expect(alertOf(page)).toContainText(tr(lang, "problems.notification_preference__quiet_hours_invalid"));
    await page.getByLabel(new RegExp(tr(lang, "workflowsP5.prefs.quietEnd"))).fill("07:00");
    await page.getByLabel(tr(lang, "workflowsP5.prefs.digestMode")).selectOption("daily");
    await page.getByRole("button", { name: tr(lang, "workflowsP5.prefs.save"), exact: true }).click();
    await expect(page.locator("[data-state='saved']")).toHaveText(tr(lang, "workflowsP5.prefs.saved"));
    await expect(page.locator("[data-own='true']")).toBeVisible();
    await expect(page.locator("[data-quiet='22:00-07:00']")).toBeVisible();
    await expectAccessible(page, lang, "p5-notification-preferences");
    await shot(page, lang, "p5-notification-preferences");
  } finally {
    const nobody = await apiSession(playwright, "dev.nobody");
    const p = await nobody.call<{ version: number }>("GET", "/api/v1/me/notification-preferences");
    if (p.version > 0)
      await nobody.call(
        "PUT",
        "/api/v1/me/notification-preferences",
        { quietHoursStart: null, quietHoursEnd: null, digestMode: "off" },
        { ifMatch: p.version },
      );
    await revoke();
  }
  expect(foreign).toEqual([]);
});

test("Approval routes, gate conditions, the cut-off pack and the failure queue show their real states", async ({
  page,
  playwright,
}, info) => {
  test.setTimeout(90_000);
  const lang = langOf(info);
  const foreign = trackRequests(page);
  const lead = await apiSession(playwright, "dev.lead");
  const created = await lead.call<{ id: string }>("POST", "/api/v1/transformations", {
    businessUnitId: SYN_RETAIL,
    name: `Synthetic FE-D ${lang.toUpperCase()} governance`,
    mode: "end_to_end",
  });
  await signIn(page, lang, "dev.office");
  await page.goto("/admin/approval-routes");
  await expect(h1(page)).toHaveText(tr(lang, "nav.p5.approvalRoutes.title"));
  await expect(page.getByText(tr(lang, "workflowsP5.routes.empty"), { exact: true })).toBeVisible();
  await expectAccessible(page, lang, "p5-approval-routes");
  await shot(page, lang, "p5-approval-routes");
  await page.goto("/admin/automation/failures");
  await expect(h1(page)).toHaveText(tr(lang, "nav.p5.automationFailures.title"));
  await expectAccessible(page, lang, "p5-automation-failures");
  await shot(page, lang, "p5-automation-failures");
  await page.goto("/admin/automation/executions");
  await expect(h1(page)).toHaveText(tr(lang, "workflowsP5.executions.title"));
  await shot(page, lang, "p5-automation-executions");
  await page.goto(`/transformations/${created.id}/gate-conditions`);
  await expect(h1(page)).toHaveText(tr(lang, "workflowsP5.conditions.title"));
  await expect(page.getByText(tr(lang, "workflowsP5.conditions.empty"), { exact: true })).toBeVisible();
  await expectAccessible(page, lang, "p5-gate-conditions");
  await shot(page, lang, "p5-gate-conditions");
  // A meeting whose cut-off has not been reached has no pack yet (the scan generates it once, at the cut-off).
  await page.goto(`/transformations/${created.id}/meetings/${crypto.randomUUID()}/cutoff-pack`);
  await expect(h1(page)).toHaveText(tr(lang, "workflowsP5.cutoff.title"));
  await expect(page.getByText(tr(lang, "workflowsP5.cutoff.none"), { exact: true })).toBeVisible();
  await shot(page, lang, "p5-cutoff-pack-none");
  expect(foreign).toEqual([]);
});
