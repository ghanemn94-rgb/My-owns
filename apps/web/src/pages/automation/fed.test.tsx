// FE-D screens (T-DG5-FE-D; slices C, D, E) with STUBBED responses, in English (LTR) and Arabic (RTL). The live paths
// against the real API are e2e/p5-procedures-automation.spec.ts. SYNTHETIC data; nothing here is a business approval.
//  - REQ-S12-022: the jobs view shows last success and next run; null is "Never run" / "Disabled" / "Unknown", never a
//    time; a 403 (non-admin) is the no-permission state.
//  - REQ-S12-002 / S12-001: a starter says why it cannot be disabled; a draft's dry run is "Not run" until run; the dry
//    run result says nothing was created; submit without a dry run is the translated 422; enable sends If-Match;
//    the failure queue retries with If-Match and shows the translated refusal.
//  - REQ-S06-002: the instance shows its current step, assignee role, an Unknown due date with its reason, and its
//    missing inputs; completing without them is the translated 422.
//  - REQ-S06-001: a builder body without a trigger omits it (the server answers trigger_required); validation findings
//    are translated by code.
//  - REQ-S12-025: preferences PUT with If-Match "0" on first save; the quiet-hours refusal is translated.
//  - REQ-S12-015: "No reviewer assigned"; the review sends If-Match; 403 not_reviewer is translated.
//  - REQ-S10-015: in a sequential route, step 2 is "Waiting — not notified yet".
//  - Problem texts: every refusal row of ADR-0043 §9 and ADR-0044 §10 that these screens can receive has its exact
//    English text and an Arabic text.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Permission } from "@mth/shared";
import { createI18n, catalogues } from "../../i18n/index.ts";
import {
  ORG_ID,
  TR_ID,
  USER_ID,
  makeMe,
  makeTransformation,
  mockApi,
  problem,
  renderApp,
  route,
} from "../../test/fixtures.tsx";
import { toBody, toDraft } from "../procedure-builder/DefinitionPage.tsx";
import { toContentBody, toContentDraft } from "./ContentEditor.tsx";

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const en = catalogues.en.workflowsP5;
const ar = catalogues.ar.workflowsP5;
const grants = (permissions: Permission[]) => [
  { scope: { type: "organization" as const, id: ORG_ID }, inheritsDownward: false, permissions },
];
const meRoute = (permissions: Permission[], locale: "en" | "ar" = "en") =>
  route("GET", /\/api\/v1\/me$/, () => ({
    status: 200,
    body: makeMe(grants(permissions), { preferredLocale: locale }),
  }));
const ok = (body: unknown) => () => ({ status: 200, body });
/** Waits until the selector matches (waitFor retries only on a throw). */
const found = (selector: string) =>
  waitFor(() => {
    const el = document.querySelector(selector);
    if (!el) throw new Error(`not found: ${selector}`);
    return el as HTMLElement;
  });

const JOB = {
  code: "approval.escalation_scan",
  queueName: "approvals.escalation_scan",
  cron: "*/15 * * * *",
  timezone: "Asia/Riyadh",
  enabled: true,
  ownerModule: "workflows",
  descriptionEn: "Synthetic approval escalation scan",
  descriptionAr: "فحص تصعيد الاعتمادات (اصطناعي)",
  lastSuccessAt: null,
  lastRunAt: null,
  lastOutcome: null,
  nextRunAt: "2026-10-16T12:00:00Z",
  nextRunUnknownReason: null,
  openFailures: 0,
  allowedActions: ["run_now"],
};

describe("REQ-S12-022: the jobs operations view", () => {
  for (const locale of ["en", "ar"] as const) {
    it(`${locale}: never-run is "Never run", a disabled job is "Disabled", the next run is a time`, async () => {
      mockApi(
        meRoute(["organization.read", "job.read", "job.repair"], locale),
        route("GET", /\/api\/v1\/admin\/jobs$/, () => ({
          status: 200,
          body: {
            items: [
              JOB,
              {
                ...JOB,
                code: "kpi.reporting_period_open",
                enabled: false,
                nextRunAt: null,
                nextRunUnknownReason: "disabled",
                lastSuccessAt: "2026-10-15T09:00:00Z",
                lastOutcome: "succeeded",
                allowedActions: [],
              },
            ],
          },
        })),
      );
      renderApp("/admin/jobs/operations", { i18n: createI18n(locale) });
      const c = locale === "en" ? en : ar;
      expect(await screen.findByRole("heading", { level: 1, name: c.jobs.title })).toBeTruthy();
      const rows = await screen.findAllByRole("row");
      const first = rows.find((r) => r.textContent?.includes("approval.escalation_scan"))!;
      expect(within(first).getAllByText(c.jobs.neverRun).length).toBeGreaterThan(0);
      expect(first.querySelector("[data-status='never_run']")).toBeTruthy();
      expect(first.querySelector("[data-next-run='2026-10-16T12:00:00Z']")).toBeTruthy();
      const second = rows.find((r) => r.textContent?.includes("kpi.reporting_period_open"))!;
      expect(within(second).getByText(c.jobs.disabled)).toBeTruthy();
      expect(second.querySelector("[data-last-success]")).toBeTruthy();
      expect(document.documentElement.dir).toBe(locale === "ar" ? "rtl" : "ltr");
    });
  }

  it("a non-admin gets the server's 403 as the no-permission state; run now posts the job", async () => {
    mockApi(
      meRoute(["organization.read"]),
      route("GET", /\/api\/v1\/admin\/jobs$/, () => problem(403, "forbidden")),
    );
    renderApp("/admin/jobs/operations", { i18n: createI18n("en") });
    expect(await screen.findByText(catalogues.en.common.state.noPermissionTitle)).toBeTruthy();
    cleanup();
    const { requests } = mockApi(
      meRoute(["organization.read", "job.read", "job.repair"]),
      route("GET", /\/api\/v1\/admin\/jobs$/, ok({ items: [JOB] })),
      route("POST", /\/admin\/jobs\/approval\.escalation_scan\/run$/, () => ({
        status: 202,
        body: { code: JOB.code, jobId: null, singletonKey: "run-now:x", queuedAt: "2026-10-16T11:00:00Z" },
      })),
    );
    renderApp("/admin/jobs/operations", { i18n: createI18n("en") });
    fireEvent.click(await screen.findByRole("button", { name: `${en.jobs.runNow}: ${JOB.code}` }));
    await waitFor(() => expect(requests.some((r) => r.method === "POST" && r.url.endsWith("/run"))).toBe(true));
  });
});

const RULE_ID = "01920000-0000-7000-b100-000000000001";
const summary = {
  en: "When a gate is decided, create a task for TO.",
  ar: "عند البتّ في بوابة، أنشئ مهمة لمكتب التحوّل.",
};
const content = {
  triggerCodes: ["gate.decided"],
  conditions: [],
  actions: [{ type: "create_task", parameters: { assigneeRole: "TO", messageKey: "automation.message.follow_up" } }],
  runAs: "service",
  servicePermissionCodes: [],
  parameters: {},
};
function rule(over: Record<string, unknown> = {}) {
  return {
    id: RULE_ID,
    code: "synthetic.follow_up",
    origin: "admin",
    sourceRef: null,
    nameEn: "Synthetic follow-up",
    nameAr: "متابعة اصطناعية",
    descriptionEn: null,
    descriptionAr: null,
    scopeLevel: "transformation",
    organizationId: ORG_ID,
    transformationId: TR_ID,
    ownerUserId: USER_ID,
    ownerRoleCode: null,
    enabled: false,
    disableAllowed: true,
    disabledReason: null,
    effectiveVersionId: null,
    effectiveVersionNo: null,
    openVersionNo: 1,
    summary,
    version: 3,
    updatedAt: "2026-10-16T08:00:00Z",
    ...over,
  };
}
function ruleVersion(over: Record<string, unknown> = {}) {
  return {
    id: "01920000-0000-7000-b100-000000000101",
    ruleId: RULE_ID,
    versionNo: 1,
    status: "draft",
    content,
    contentSha256: "c".repeat(64),
    changeSummary: null,
    lastDryRun: null,
    dryRunCurrent: false,
    authoredBy: USER_ID,
    submittedAt: null,
    reviewedBy: null,
    reviewedAt: null,
    reviewNote: null,
    publishedBy: null,
    publishedAt: null,
    supersededAt: null,
    discardedAt: null,
    summary,
    version: 2,
    updatedAt: "2026-10-16T08:00:00Z",
    ...over,
  };
}
const catalogue = {
  triggers: [
    {
      code: "gate.decided",
      triggerKind: "event",
      ownerModule: "workflows",
      labelEn: "A gate is decided",
      labelAr: "البتّ في بوابة",
      conditionFields: ["gateCode", "outcome"],
      hasInitiatingUser: true,
      adminSelectable: true,
      sourceRef: "M0221",
    },
  ],
  actionTypes: [
    {
      code: "create_task",
      actionClass: "automatic",
      ownerModule: "tasks",
      labelEn: "Create a task",
      labelAr: "إنشاء مهمة",
      requiredPermissionCode: null,
      adminSelectable: true,
      parametersSchema: {},
      sourceRef: "M0221",
    },
  ],
};
const ruleRoutes = (r: Record<string, unknown>, v: Record<string, unknown>) => [
  route("GET", /\/admin\/automation-rules\/[^/]+$/, ok(r)),
  route("GET", /\/admin\/automation-rules\/[^/]+\/versions(\?.*)?$/, ok({ items: [v], nextCursor: null })),
  route("GET", /\/dry-runs(\?.*)?$/, ok({ items: [], nextCursor: null })),
  route("GET", /\/admin\/automation-catalogue$/, ok(catalogue)),
  route("GET", /\/admin\/automation-executions/, ok({ items: [], nextCursor: null })),
  route("GET", /\/api\/v1\/transformations(\?.*)?$/, ok({ items: [makeTransformation()], nextCursor: null })),
  route("GET", /\/api\/v1\/users\//, ok({ id: USER_ID, displayName: "Synthetic Owner" })),
];
const ADM_METHOD: Permission[] = ["organization.read", "automation.read", "automation.configure", "methodology.read"];

describe("REQ-S12-001 / S12-002: an automation rule", () => {
  it("a draft's dry run is Not run; submit without it is the translated 422; enable sends the rule's If-Match", async () => {
    const { requests } = mockApi(
      meRoute(ADM_METHOD),
      route("POST", /\/versions\/1\/submit$/, () => problem(422, "automation_rule_version.dry_run_required")),
      route("POST", /\/enable$/, () => problem(422, "automation_rule.no_effective_version")),
      ...ruleRoutes(rule(), ruleVersion()),
    );
    renderApp(`/admin/automation/rules/${RULE_ID}`, { i18n: createI18n("en") });
    expect(await screen.findByRole("heading", { level: 1, name: "Synthetic follow-up" })).toBeTruthy();
    expect(await screen.findByText(summary.en, { selector: "[data-summary='effective']" })).toBeTruthy();
    expect(document.querySelector("[data-panel='dry-run'] [data-status='not_run']")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: en.rules.submit }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(catalogues.en.problems.automation_rule_version__dry_run_required);
    expect(requests.find((r) => r.url.endsWith("/submit"))!.headers["if-match"]).toBe('"2"');
    fireEvent.click(screen.getByRole("button", { name: en.rules.enable }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        catalogues.en.problems.automation_rule__no_effective_version,
      ),
    );
    expect(requests.find((r) => r.url.endsWith("/enable"))!.headers["if-match"]).toBe('"3"');
  });

  it("a dry run shows what each action would do and that nothing was created", async () => {
    const run = {
      id: "01920000-0000-7000-b100-000000000201",
      versionId: "01920000-0000-7000-b100-000000000101",
      contentSha256: "c".repeat(64),
      outcome: "pass",
      conditionsMet: true,
      plannedActions: [
        {
          ordinal: 1,
          actionType: "create_task",
          outcome: "would_run",
          target: { role: "TO" },
          idempotencyKey: "k",
          messageKey: null,
        },
      ],
      findings: [],
      runBy: USER_ID,
      createdAt: "2026-10-16T09:00:00Z",
    };
    const { requests } = mockApi(
      meRoute(ADM_METHOD),
      route("POST", /\/dry-runs$/, () => ({ status: 201, body: run })),
      ...ruleRoutes(rule(), ruleVersion()),
    );
    renderApp(`/admin/automation/rules/${RULE_ID}`, { i18n: createI18n("en") });
    // The sample is pre-filled with the trigger's event fields once the builder catalogue is loaded.
    await waitFor(() =>
      expect((screen.getByLabelText(en.dryRun.payload) as HTMLTextAreaElement).value).toContain("gateCode"),
    );
    fireEvent.click(await screen.findByRole("button", { name: en.dryRun.run }));
    expect(await screen.findByText(en.dryRun.noSideEffects)).toBeTruthy();
    expect(document.querySelector("[data-planned='would_run']")).toBeTruthy();
    const post = requests.find((r) => r.method === "POST" && r.url.endsWith("/dry-runs"))!;
    expect(post.body).toMatchObject({
      triggerCode: "gate.decided",
      payload: { transformationId: TR_ID, gateCode: "", outcome: "" },
    });
  });

  it("ar: a starter says why it cannot be disabled and offers no disable action", async () => {
    mockApi(
      meRoute(ADM_METHOD, "ar"),
      ...ruleRoutes(
        rule({ origin: "starter", enabled: true, disableAllowed: false, effectiveVersionNo: 1, openVersionNo: null }),
        ruleVersion({ status: "published", publishedAt: "2026-10-01T00:00:00Z" }),
      ),
    );
    renderApp(`/admin/automation/rules/${RULE_ID}`, { i18n: createI18n("ar") });
    expect(await screen.findByText(catalogues.ar.problems.automation_rule__guarantee_protected)).toBeTruthy();
    expect(screen.queryByRole("button", { name: ar.rules.disable })).toBeNull();
    expect(document.documentElement.dir).toBe("rtl");
  });

  it("the builder body keeps the typed action settings and never sends a float", () => {
    const d = toContentDraft(content as Parameters<typeof toContentDraft>[0]);
    d.actions[0]!.dueInWorkingDays = "5";
    const body = toContentBody(d) as { actions: { parameters: Record<string, unknown> }[] };
    expect(body.actions[0]!.parameters).toEqual({
      assigneeRole: "TO",
      messageKey: "automation.message.follow_up",
      dueInWorkingDays: 5,
    });
  });
});

describe("REQ-S12-002: the failure queue", () => {
  it("retry sends If-Match; 422 automation_failure.not_open is one translated alert", async () => {
    const failure = {
      id: "01920000-0000-7000-b100-000000000301",
      source: "rule_execution",
      organizationId: ORG_ID,
      executionId: "01920000-0000-7000-b100-000000000401",
      jobScheduleCode: null,
      queueName: "automation.evaluate",
      jobId: null,
      idempotencyKey: "synthetic.follow_up:evt-1",
      errorCode: "automation.action_forbidden",
      errorMessage: "target outside scope",
      attempts: 1,
      firstFailedAt: "2026-10-16T08:00:00Z",
      lastFailedAt: "2026-10-16T08:00:00Z",
      status: "open",
      retryCount: 0,
      lastRetryBy: null,
      lastRetryAt: null,
      resolvedAt: null,
      dismissedBy: null,
      dismissedAt: null,
      dismissReason: null,
      allowedActions: ["retry", "dismiss"],
      version: 7,
      updatedAt: "2026-10-16T08:00:00Z",
    };
    const { requests } = mockApi(
      meRoute(["organization.read", "automation.read", "automation.repair"]),
      route("GET", /\/admin\/automation-failures/, ok({ items: [failure], nextCursor: null })),
      route("POST", /\/retry$/, () => problem(422, "automation_failure.not_open")),
    );
    renderApp("/admin/automation/failures", { i18n: createI18n("en") });
    expect(await screen.findByText(catalogues.en.problems.automation__action_forbidden)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: `${en.failures.retry}: ${failure.idempotencyKey}` }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(catalogues.en.problems.automation_failure__not_open);
    expect(requests.find((r) => r.url.endsWith("/retry"))!.headers["if-match"]).toBe('"7"');
  });
});

const INSTANCE_ID = "01920000-0000-7000-b200-000000000001";
function instance() {
  const step = {
    stepKey: "record_baseline",
    ordinal: 1,
    parallelGroup: null,
    stepKind: "task",
    nameEn: "Record the baseline",
    nameAr: "تسجيل خط الأساس",
    status: "active",
    assigneeRoleCode: "TL",
    assigneeUserId: null,
    dueDate: null,
    dueDateUnknownReason: "no_calendar",
    overdue: null,
    activatedAt: "2026-10-16T08:00:00Z",
    completedAt: null,
    completedBy: null,
    skipReason: null,
    approvalId: null,
    missingInputs: ["baselineValue"],
  };
  return {
    id: INSTANCE_ID,
    transformationId: null,
    procedureCode: "baseline_validation",
    procedureDefinitionId: "01920000-0000-7000-b200-000000000002",
    methodologyVersionId: "01920000-0000-7000-b200-000000000003",
    versionNo: 1,
    nameEn: "Baseline validation",
    nameAr: "التحقق من خط الأساس",
    status: "active",
    subjectRecordType: null,
    subjectRecordId: null,
    inputValues: {},
    dueDate: null,
    currentStepKeys: ["record_baseline"],
    missingInputs: [{ key: "baselineValue", labelEn: "Baseline value", labelAr: "قيمة خط الأساس" }],
    nextAction: {
      kind: "provide_input",
      stepKey: "record_baseline",
      messageKey: "procedure.next.provide_input",
      messageParams: {},
    },
    steps: [step],
    links: [],
    launchedBy: USER_ID,
    launchedAt: "2026-10-16T08:00:00Z",
    completedAt: null,
    cancelledAt: null,
    cancelReason: null,
    version: 5,
    updatedAt: "2026-10-16T08:00:00Z",
  };
}

describe("REQ-S06-002: a procedure instance", () => {
  for (const locale of ["en", "ar"] as const) {
    it(`${locale}: current step, assignee role, Unknown due date, missing inputs; completing is refused translated`, async () => {
      const { requests } = mockApi(
        meRoute(["organization.read", "procedure.read", "procedure.act"], locale),
        route("GET", /\/procedure-instances\/[^/]+$/, ok(instance())),
        route("GET", /\/procedure-definitions\//, () => problem(404, "not_found")),
        route("POST", /\/steps\/record_baseline\/complete$/, () =>
          problem(422, "procedure_step.inputs_missing", { missingInputs: ["baselineValue"] }),
        ),
      );
      renderApp(`/playbook/procedures/${INSTANCE_ID}`, { i18n: createI18n(locale) });
      const c = locale === "en" ? en : ar;
      const name = locale === "en" ? "Baseline validation" : "التحقق من خط الأساس";
      expect(await screen.findByRole("heading", { level: 1, name })).toBeTruthy();
      const row = document.querySelector("[data-step='record_baseline']") as HTMLElement;
      expect(row.dataset["stepStatus"]).toBe("active");
      expect(within(row).getByText("TL")).toBeTruthy();
      expect(row.querySelector("[data-due='unknown']")).toBeTruthy();
      expect(screen.getByText(locale === "en" ? "Baseline value" : "قيمة خط الأساس")).toBeTruthy();
      expect(screen.getByText(c.nextAction.provide_input)).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: c.procedures.complete }));
      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toContain(catalogues[locale].problems.procedure_step__inputs_missing);
      expect(requests.find((r) => r.url.endsWith("/complete"))!.headers["if-match"]).toBe('"5"');
    });
  }
});

describe("REQ-S06-001: the procedure builder", () => {
  it("a definition without a trigger or completion omits them, so the server refuses with its 422 codes", () => {
    const body = toBody(toDraft(null));
    expect(body).not.toHaveProperty("trigger");
    expect(body).not.toHaveProperty("completion");
    expect(body["steps"]).toHaveLength(1);
  });

  it("validation lists every finding, translated by its code", async () => {
    const V = "01920000-0000-7000-b300-000000000001";
    mockApi(
      meRoute(["organization.read", "methodology.read", "methodology.configure", "procedure.read"]),
      route(
        "GET",
        /\/admin\/methodology-versions\/[^/]+$/,
        ok({
          id: V,
          configKind: "procedure",
          key: "procedures",
          versionNo: 2,
          status: "draft",
          draftStage: "editing",
          origin: "draft",
          basedOnVersionId: null,
          rollbackOfVersionId: null,
          titleEn: "Synthetic procedures v2",
          titleAr: "إجراءات اصطناعية 2",
          changeSummary: null,
          definition: {},
          contentSha256: "d".repeat(64),
          isNewestPublished: false,
          latestChecks: { preview: null, compatibility: null, sourceCoverage: null },
          pendingReviewId: null,
          reviewRequired: true,
          publishedAt: null,
          publishedBy: null,
          discardedAt: null,
          version: 9,
          createdAt: "2026-10-16T08:00:00Z",
          createdBy: null,
          updatedAt: "2026-10-16T08:00:00Z",
          updatedBy: null,
        }),
      ),
      route(
        "POST",
        /\/procedure-definitions\/validate$/,
        ok({
          valid: false,
          findings: [
            {
              code: "procedure_definition.trigger_required",
              pointer: "/trigger",
              message: "A procedure needs a trigger.",
            },
            {
              code: "procedure_definition.completion_required",
              pointer: "/completion",
              message: "A procedure needs a completion condition.",
            },
          ],
        }),
      ),
    );
    renderApp(`/admin/procedures/synthetic_review?versionId=${V}&new=1`, { i18n: createI18n("en") });
    fireEvent.click(await screen.findByRole("button", { name: en.builder.validate }));
    const report = await found("[data-validation='invalid']");
    expect(report.textContent).toContain(catalogues.en.problems.procedure_definition__trigger_required);
    expect(report.textContent).toContain(catalogues.en.problems.procedure_definition__completion_required);
  });
});

describe("REQ-S12-025: notification preferences", () => {
  const prefs = {
    own: null,
    effective: {
      quietHoursStart: null,
      quietHoursEnd: null,
      timezone: "Asia/Riyadh",
      digestMode: "off",
      digestTime: "08:00:00",
    },
    version: 0,
  };
  it('the first save sends If-Match "0"; the quiet-hours refusal is translated', async () => {
    const { requests } = mockApi(
      meRoute(["organization.read", "notification.preferences"]),
      route("GET", /\/me\/notification-preferences$/, ok(prefs)),
      route("PUT", /\/me\/notification-preferences$/, () =>
        problem(422, "notification_preference.quiet_hours_invalid"),
      ),
    );
    renderApp("/my-work/notification-preferences", { i18n: createI18n("en") });
    expect(await screen.findByText(en.prefs.sourceDefault)).toBeTruthy();
    expect(screen.getByText(en.prefs.urgentNote)).toBeTruthy();
    fireEvent.click(screen.getByLabelText(en.prefs.quietOn));
    fireEvent.click(screen.getByRole("button", { name: en.prefs.save }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(catalogues.en.problems.notification_preference__quiet_hours_invalid);
    const put = requests.find((r) => r.method === "PUT")!;
    expect(put.headers["if-match"]).toBe('"0"');
    expect(put.body).toMatchObject({ quietHoursStart: "21:00", quietHoursEnd: "07:00", digestMode: "off" });
  });

  it("ar: the auditor reads the preferences but has no save action", async () => {
    mockApi(meRoute(["organization.read"], "ar"), route("GET", /\/me\/notification-preferences$/, ok(prefs)));
    renderApp("/my-work/notification-preferences", { i18n: createI18n("ar") });
    expect(await screen.findByText(ar.prefs.readOnly)).toBeTruthy();
    expect(screen.queryByRole("button", { name: ar.prefs.save })).toBeNull();
  });
});

describe("REQ-S12-015: the meeting cut-off pack", () => {
  const MEETING = "01920000-0000-7000-b400-000000000001";
  const pack = {
    id: "01920000-0000-7000-b400-000000000002",
    meetingId: MEETING,
    cutoffDate: "2026-10-14",
    asOf: "2026-10-14T21:30:00Z",
    openAsks: [
      {
        decisionId: "01920000-0000-7000-b400-000000000003",
        code: "ED-001",
        title: "Synthetic ask",
        status: "open",
        ownerUserId: null,
        dueDate: null,
        agendaItemId: "01920000-0000-7000-b400-000000000004",
      },
    ],
    agendaItemIds: ["01920000-0000-7000-b400-000000000004"],
    status: "draft",
    reviewedBy: null,
    reviewedAt: null,
    reviewNote: null,
    reviewerAssigned: false,
    version: 1,
    updatedAt: "2026-10-14T21:30:00Z",
  };
  it('"No reviewer assigned"; the review sends If-Match; 403 not_reviewer is translated', async () => {
    const { requests } = mockApi(
      meRoute(["organization.read", "transformation.read", "meeting.prepare"]),
      route("GET", /\/cutoff-pack$/, ok(pack)),
      route("POST", /\/cutoff-pack\/review$/, () => problem(403, "meeting_cutoff_pack.not_reviewer")),
    );
    renderApp(`/transformations/${TR_ID}/meetings/${MEETING}/cutoff-pack`, { i18n: createI18n("en") });
    expect(await screen.findByText(en.cutoff.noReviewer)).toBeTruthy();
    expect(screen.getByText("Synthetic ask")).toBeTruthy();
    expect(screen.getByText(en.cutoff.notPublishable)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: en.cutoff.review }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(catalogues.en.problems.meeting_cutoff_pack__not_reviewer);
    expect(requests.find((r) => r.url.endsWith("/review"))!.headers["if-match"]).toBe('"1"');
  });
});

describe("REQ-S10-015: an approval route", () => {
  it("in a sequential route step 2 is waiting and not notified until step 1 approves", async () => {
    const A = "01920000-0000-7000-b500-000000000001";
    const step = (n: number, status: string, activatedAt: string | null) => ({
      stepNo: n,
      roundNo: 1,
      approverRoleCode: n === 1 ? "SP" : "FIN",
      assigneeUserId: null,
      status,
      activatedAt,
      decidedBy: null,
      decidedOnBehalfOf: null,
      decidedAt: null,
      decisionNote: null,
    });
    mockApi(
      meRoute(["organization.read", "approval.decide"]),
      route(
        "GET",
        /\/approvals\/[^/]+\/route$/,
        ok({
          approvalId: A,
          routed: true,
          routeKey: "approval.charter",
          mode: "sequential",
          currentRoundNo: 1,
          steps: [step(1, "active", "2026-10-16T08:00:00Z"), step(2, "waiting", null)],
          approvalStatus: "pending",
          approvalVersion: 2,
        }),
      ),
    );
    renderApp(`/my-work/approvals/${A}/route`, { i18n: createI18n("en") });
    const second = await found("[data-step='2']");
    expect(within(second).getByText(en.routeStepStatus.waiting)).toBeTruthy();
    expect(within(second).getByText(en.routes.notNotified)).toBeTruthy();
    expect(screen.getByText(en.routes.sequentialNote)).toBeTruthy();
  });
});

// ------------------------------------------------------------------------------------------------ problem texts

function repoRoot(): string {
  for (let dir = process.cwd(); ; dir = dirname(dir)) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    if (dirname(dir) === dir) throw new Error("repository root not found");
  }
}
const ROW = /^\|\s*4\d\d\s*\|\s*`([a-z_][a-z0-9_.]*)`\s*\|\s*(.*?)\s*\|\s*$/;
/** Refusals of other screens (the transformation create of slice H): not received by the FE-D screens. */
const NOT_FED = new Set(["transformation.launch_start_invalid"]);

describe("the slice D and E problem texts (ADR-0043 §9, ADR-0044 §10)", () => {
  it("every refusal the FE-D screens can receive has its exact English text and an Arabic text", () => {
    const dir = join(repoRoot(), "docs", "architecture", "adr");
    const rows = new Map<string, string>();
    for (const n of ["0043", "0044"]) {
      const file = readdirSync(dir).find((f) => f.startsWith(`ADR-${n}-`))!;
      for (const line of readFileSync(join(dir, file), "utf8").split("\n")) {
        const m = ROW.exec(line);
        if (m && !NOT_FED.has(m[1]!)) rows.set(m[1]!, m[2]!);
      }
    }
    expect(rows.size).toBeGreaterThanOrEqual(35);
    const enP = catalogues.en.problems as unknown as Record<string, string>;
    const arP = catalogues.ar.problems as unknown as Record<string, string>;
    for (const [code, text] of rows) {
      const key = code.replace(/\./g, "__");
      expect(enP[key], code).toBe(text);
      expect(arP[key], code).toBeTruthy();
      expect(arP[key], code).not.toBe(text);
    }
    for (const code of [
      "automation.action_forbidden",
      "automation.action_failed",
      "automation.retries_exhausted",
      "automation.condition_unknown_value",
    ]) {
      const key = code.replace(/\./g, "__");
      expect(enP[key], code).toBeTruthy();
      expect(arP[key], code).toBeTruthy();
    }
  });
});
