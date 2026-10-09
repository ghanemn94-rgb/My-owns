// My Work, Administration > Calendar and Jobs, Governance > Groups, and the P4 seams (T-DG4-FE-A; ADR-0025,
// ADR-0026 §1) with stubbed responses, in English (LTR) and Arabic (RTL). SYNTHETIC data only.
//  - work items and reminders are rendered from messageKey + messageParams at render time (S-6), in each language;
//  - an approval task is system-managed (no "mark done"); "mark done" and "mark as read" are bodiless POSTs with If-Match;
//  - the calendar is read-only without calendar.configure; the working-day calculator shows Unknown with its reason;
//  - every P4 route renders; the problems catalogue covers every slice I and C refusal code (ADR-0025, ADR-0026) and
//    the extra codes the merged implementers reported.
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RouteObject } from "react-router";
import { P4_PLANNED_ROUTES, routes } from "../../app/router.tsx";
import { NAV_SUBPAGES } from "../../app/nav.ts";
import { WORKSPACE_TABS, workspaceTabLabelKey } from "../../components/Workspace.tsx";
import { catalogues, createI18n } from "../../i18n/index.ts";
import { ORG_ID, TR_ID, mockApi, renderApp, route } from "../../test/fixtures.tsx";
import { isP4KeyOf, p4Keys } from "../../api/p4.ts";
import { calendar, esc, json, notification, p4Handlers, page, workItem } from "./p4fixtures.ts";

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const label = (text: string) => new RegExp(`^${esc(text)}`);

describe.each(["en", "ar"] as const)("My Work (%s)", (locale) => {
  const t = createI18n(locale).t;

  it("renders tasks and reminders from messageKey + messageParams; Unknown due dates; system-managed tasks", async () => {
    const kpiTask = workItem();
    const approvalTask = workItem({
      kind: "approval_decision",
      messageKey: "approvals.task.decide",
      messageParams: {
        title: "Synthetic scope change",
        approvalType: "decision_request",
        roundNo: 1,
        dueDate: "2026-10-08",
      },
      dueDate: "2026-10-08",
      linkPath: "/my-work/approvals/abc",
    });
    const n = notification();
    mockApi(
      ...p4Handlers(
        locale,
        [],
        [
          route("GET", /\/api\/v1\/me\/work-items/, () => page([kpiTask, approvalTask])),
          route("GET", /\/api\/v1\/me\/inbox/, () => json({ items: [n], nextCursor: null, unreadCount: 1 })),
        ],
      ),
    );
    renderApp("/my-work", { i18n: createI18n(locale) });
    const kpi = await screen.findByText(
      t("myWork.message.kpi__update_due", { kpiName: "Synthetic NPS", periodLabel: "2026-09" }),
    );
    const kpiRow = kpi.closest("tr")!;
    expect(kpiRow.querySelector("[data-due='unknown']")?.textContent).toContain(t("common.value.unknown"));
    expect(within(kpiRow).getByRole("button", { name: new RegExp(t("myWork.items.complete")) })).toBeTruthy();
    const approvalRow = document.querySelector(`[data-work-item='${approvalTask.id}']`)!.closest("tr")!;
    expect(approvalRow.textContent).toContain(t("myWork.items.systemManaged"));
    expect(within(approvalRow).queryByRole("button")).toBeNull();
    const message = document.querySelector(`[data-notification='${n.id}']`)!;
    expect(message.textContent).toContain(
      t("myWork.message.approvals__task__outcome", {
        title: "Synthetic scope change",
        roundNo: 1,
        outcome: t("myWork.param.outcome.approved"),
      }),
    );
    expect(document.querySelector("[data-unread-count='1']")?.textContent).toContain(
      t("myWork.inbox.unreadCount", { count: 1 }),
    );
  });

  it("marks a task done and a reminder read with bodiless POSTs and If-Match", async () => {
    const w = workItem({ version: 5 });
    const n = notification({ version: 2 });
    const api = mockApi(
      ...p4Handlers(
        locale,
        [],
        [
          route("GET", /\/api\/v1\/me\/work-items/, () => page([w])),
          route("GET", /\/api\/v1\/me\/inbox/, () => json({ items: [n], nextCursor: null, unreadCount: 1 })),
          route("POST", /\/complete$/, () => json({ ...w, status: "done" })),
          route("POST", /\/read$/, () => json({ ...n, readAt: "2026-10-02T09:00:00Z" })),
        ],
      ),
    );
    renderApp("/my-work", { i18n: createI18n(locale) });
    fireEvent.click(await screen.findByRole("button", { name: new RegExp(t("myWork.items.complete")) }));
    fireEvent.click(await screen.findByRole("button", { name: new RegExp(t("myWork.inbox.markRead")) }));
    await waitFor(() => expect(api.requests.filter((r) => r.method === "POST")).toHaveLength(2));
    const [complete, read] = api.requests.filter((r) => r.method === "POST");
    expect(complete!.url).toContain(`/work-items/${w.id}/complete`);
    expect(complete!.headers["if-match"]).toBe('"5"');
    expect(complete!.body).toBeUndefined();
    expect(read!.url).toContain(`/me/inbox/${n.id}/read`);
    expect(read!.headers["if-match"]).toBe('"2"');
  });

  it("an unknown message key renders a neutral text, never the raw key", async () => {
    const w = workItem({ kind: "brand_new_kind", messageKey: "future.task.thing", messageParams: {} });
    mockApi(...p4Handlers(locale, [], [route("GET", /\/api\/v1\/me\/work-items/, () => page([w]))]));
    renderApp("/my-work", { i18n: createI18n(locale) });
    const link = await screen.findByText(t("myWork.message.fallback", { kind: "brand_new_kind" }));
    expect(link.textContent).not.toContain("future.task.thing");
  });
});

describe.each(["en", "ar"] as const)("Calendar, jobs and groups (%s)", (locale) => {
  const t = createI18n(locale).t;

  it("calendar: read-only without calendar.configure; the calculator shows Unknown with its reason", async () => {
    const c = calendar();
    mockApi(
      ...p4Handlers(
        locale,
        [],
        [
          route("GET", new RegExp(`/organizations/${ORG_ID}/calendars`), () => page([c])),
          route("GET", /\/working-days\?/, () =>
            json({
              calendarId: c.id,
              calendarVersion: 1,
              from: "2026-10-01",
              workingDays: 5,
              dueDate: null,
              unknownReason: "calendar_not_configured",
              skippedDates: [],
            }),
          ),
        ],
      ),
    );
    renderApp("/admin/calendar", { i18n: createI18n(locale) });
    expect(await screen.findByText(t("calendar.readOnly"))).toBeTruthy();
    expect(screen.queryByRole("button", { name: t("calendar.create.action") })).toBeNull();
    expect(screen.queryByRole("button", { name: t("calendar.edit.action") })).toBeNull();
    await waitFor(() => expect(document.querySelector("[data-calendar-detail='DEFAULT']")).toBeTruthy());
    const detail = document.querySelector("[data-calendar-detail='DEFAULT']")!;
    expect(detail.querySelector("[data-workweek='1,2,3,4,7']")).toBeTruthy();
    fireEvent.change(screen.getByLabelText(t("calendar.calc.from")), { target: { value: "2026-10-01" } });
    await waitFor(() => expect(document.querySelector("[data-state='working-days']")).toBeTruthy());
    const result = document.querySelector("[data-state='working-days']")!;
    expect(result.getAttribute("data-due")).toBe("unknown");
    expect(result.textContent).toContain(t("myWork.ui.unknownReason.calendar_not_configured"));
  });

  it("calendar: a technical administrator adds a holiday; a range error is caught before sending", async () => {
    const c = calendar();
    const api = mockApi(
      ...p4Handlers(
        locale,
        ["calendar.configure"],
        [
          route("GET", new RegExp(`/organizations/${ORG_ID}/calendars`), () => page([c])),
          route("POST", /\/holidays$/, () => ({ status: 201, body: {} })),
        ],
      ),
    );
    renderApp("/admin/calendar", { i18n: createI18n(locale) });
    fireEvent.click(await screen.findByRole("button", { name: t("calendar.holiday.add") }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(label(t("calendar.field.nameEn"))), {
      target: { value: "Synthetic National Day" },
    });
    fireEvent.change(within(dialog).getByLabelText(label(t("calendar.field.nameAr"))), {
      target: { value: "اليوم الوطني الاصطناعي" },
    });
    fireEvent.change(within(dialog).getByLabelText(label(t("calendar.holiday.from"))), {
      target: { value: "2026-09-24" },
    });
    const to = within(dialog).getByLabelText(label(t("calendar.holiday.to")));
    fireEvent.change(to, { target: { value: "2026-09-23" } });
    fireEvent.click(within(dialog).getByRole("button", { name: t("common.action.save") }));
    await waitFor(() => expect(to.getAttribute("aria-invalid")).toBe("true"));
    expect(api.requests.some((r) => r.method === "POST")).toBe(false);
    fireEvent.change(to, { target: { value: "2026-09-24" } });
    fireEvent.click(within(dialog).getByRole("button", { name: t("common.action.save") }));
    await waitFor(() => expect(api.requests.some((r) => r.method === "POST")).toBe(true));
    expect(api.requests.find((r) => r.method === "POST")!.body).toEqual({
      nameEn: "Synthetic National Day",
      nameAr: "اليوم الوطني الاصطناعي",
      dateFrom: "2026-09-24",
      dateTo: "2026-09-24",
    });
  });

  it("jobs: no permission without job.read; job.configure edits a schedule with If-Match", async () => {
    const job = {
      code: "approval.escalation_scan",
      queueName: "approvals",
      cron: "0 * * * *",
      timezone: "Asia/Riyadh",
      enabled: true,
      descriptionEn: "Escalate overdue approvals",
      descriptionAr: "تصعيد الموافقات المتأخرة",
      ownerModule: "workflows",
      version: 3,
      updatedAt: "2026-10-01T09:00:00Z",
    };
    const api = mockApi(
      ...p4Handlers(
        locale,
        ["job.read", "job.configure"],
        [
          route("GET", /\/admin\/job-schedules/, () => page([job])),
          route("PATCH", /\/admin\/job-schedules\//, () => json({ ...job, enabled: false, version: 4 })),
        ],
      ),
    );
    renderApp("/admin/jobs", { i18n: createI18n(locale) });
    fireEvent.click(await screen.findByRole("button", { name: new RegExp(t("common.action.edit")) }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByLabelText(t("calendar.jobs.enabledLabel")));
    fireEvent.change(within(dialog).getByLabelText(label(t("calendar.jobs.cron"))), {
      target: { value: "0 25 * * *" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: t("common.action.save") }));
    await waitFor(() =>
      expect(
        within(dialog)
          .getByLabelText(label(t("calendar.jobs.cron")))
          .getAttribute("aria-invalid"),
      ).toBe("true"),
    );
    fireEvent.change(within(dialog).getByLabelText(label(t("calendar.jobs.cron"))), { target: { value: "0 * * * *" } });
    fireEvent.click(within(dialog).getByRole("button", { name: t("common.action.save") }));
    await waitFor(() => expect(api.requests.some((r) => r.method === "PATCH")).toBe(true));
    const patch = api.requests.find((r) => r.method === "PATCH")!;
    expect(patch.url).toContain("/admin/job-schedules/approval.escalation_scan");
    expect(patch.body).toEqual({ enabled: false });
    expect(patch.headers["if-match"]).toBe('"3"');
    cleanup();
    mockApi(...p4Handlers(locale, [], []));
    renderApp("/admin/jobs", { i18n: createI18n(locale) });
    expect((await screen.findByRole("alert")).dataset["state"]).toBe("no-permission");
  });

  it("groups: membership grants no permission (stated); group.manage creates a group", async () => {
    const api = mockApi(
      ...p4Handlers(
        locale,
        ["group.manage"],
        [
          route("GET", new RegExp(`/organizations/${ORG_ID}/groups`), () => page([])),
          route("POST", new RegExp(`/organizations/${ORG_ID}/groups$`), () => ({ status: 201, body: {} })),
        ],
      ),
    );
    renderApp("/governance/groups", { i18n: createI18n(locale) });
    expect(await screen.findByText(t("groups.noPermissionNote"))).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: t("groups.create.action") }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(label(t("groups.field.code"))), { target: { value: "STEERCO" } });
    fireEvent.change(within(dialog).getByLabelText(label(t("groups.field.nameEn"))), {
      target: { value: "Synthetic SteerCo" },
    });
    fireEvent.change(within(dialog).getByLabelText(label(t("groups.field.nameAr"))), {
      target: { value: "لجنة توجيه اصطناعية" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: t("groups.create.submit") }));
    await waitFor(() => expect(api.requests.some((r) => r.method === "POST")).toBe(true));
    expect(api.requests.find((r) => r.method === "POST")!.body).toEqual({
      code: "STEERCO",
      nameEn: "Synthetic SteerCo",
      nameAr: "لجنة توجيه اصطناعية",
      ownerUserId: "01920000-0000-7000-9000-000000000201",
    });
  });
});

// ------------------------------------------------------------------------------------------------ seams

const shellChildren = (): RouteObject[] => routes.find((r) => r.path === "/")!.children!;

describe("P4 seams", () => {
  it("registers the slice I and C routes and every planned P4 route of FE-B…FE-G", () => {
    const paths = shellChildren().map((r) => r.path);
    for (const p of [
      "my-work/approvals",
      "my-work/approvals/:approvalId",
      "my-work/delegations",
      "admin/calendar",
      "admin/jobs",
      "governance/groups",
      "governance/groups/:groupId",
      "transformations/:id/role-mappings",
      "transformations/:id/decision-rights",
      "transformations/:id/raci",
      "transformations/:id/transform-readiness",
      "transformations/:id/approval-decisions",
      ...P4_PLANNED_ROUTES.map((r) => r.path),
    ])
      expect(paths, p).toContain(p);
    // The backend's work-item links resolve to a route (never "page not found").
    expect(paths).toContain("transformations/:id/kpis/:kpiId/actuals/:actualId");
    expect(paths).toContain("transformations/:id/benefit-overlaps/:overlapId");
  });

  it("labels every planned route, nav sub-entry and P4 workspace tab in both languages", () => {
    for (const lang of ["en", "ar"] as const) {
      const t = createI18n(lang).t;
      for (const r of P4_PLANNED_ROUTES) {
        expect(t(`nav.p4.${r.feature}.title`, { defaultValue: "" }), r.feature).not.toBe("");
        expect(t(`nav.p4.${r.feature}.summary`, { defaultValue: "" }), r.feature).not.toBe("");
      }
      for (const s of NAV_SUBPAGES) expect(t(`nav.sub.${s.id}`, { defaultValue: "" }), s.id).not.toBe("");
      for (const tab of WORKSPACE_TABS)
        expect(t(workspaceTabLabelKey(tab.id), { defaultValue: "" }), tab.id).not.toBe("");
    }
  });

  it("translates every slice I and C refusal code and the reported extra codes in both languages", () => {
    const codes = [
      // ADR-0025
      "calendar.workweek_invalid",
      "calendar.timezone_unknown",
      "calendar.code_taken",
      "calendar.holiday_range_invalid",
      "calendar.default_not_archivable",
      "job.cron_invalid",
      "job.timezone_unknown",
      "work_item.not_assignee",
      "work_item.closed",
      "work_item.system_managed",
      "inbox.already_read",
      // ADR-0026
      "delegation.loop",
      "delegation.self",
      "delegation.window_invalid",
      "delegation.delegate_is_requester",
      "delegation.admin_self",
      "delegation.not_delegator",
      "delegation.not_active",
      "approval.not_assignee",
      "approval.sod_requester",
      "approval.stale_version",
      "approval.not_open",
      "approval.rationale_required",
      "approval.defer_date_required",
      "approval.already_open",
      "approval.resubmit_needs_new_version",
      "approval.not_requester",
      "raci.invalid_value",
      "raci.accountable_count",
      "governance_matrix.in_approval",
      "governance_matrix.not_draft",
      "routing.role_unmapped",
      "routing.assignee_not_approver",
      "decision_right.party_unknown",
      "decision_right.sla_invalid",
      "decision_right.urgent_not_configured",
      "decision_right.urgent_reason_required",
      "role_mapping.already_mapped",
      // BE-B, BE-C, KBE-D2 handbacks
      "group.code_taken",
      "group.member_exists",
      "group.member_other_organization",
      "group.owner_invalid",
      "group.archived",
      "group.member_removed",
      "group.member_window_invalid",
      "role_mapping.party_unknown",
      "role_mapping.target_invalid",
      "role_mapping.ended",
      "delegation.delegate_unknown",
      "delegation.scope_invalid",
      "approval.decision_right_unknown",
      "approval.subject_unknown",
      "approval.calendar_not_configured",
      "raci.party_unknown",
      "benefit_valuation_method.not_approved",
      "benefit_value.period_range",
      "benefit_value.value_required",
    ];
    const flat = (o: object, p = ""): string[] =>
      Object.entries(o).flatMap(([k, v]) => (typeof v === "string" ? [p + k] : flat(v as object, `${p}${k}.`)));
    for (const lang of ["en", "ar"] as const) {
      const keys = new Set(flat(catalogues[lang].problems));
      expect(
        codes.filter((c) => !keys.has(c.replace(/\./g, "__"))),
        lang,
      ).toEqual([]);
    }
  });

  it("translates the approval reminder message keys (BE-B, BE-B2) in both languages", () => {
    for (const lang of ["en", "ar"] as const) {
      const t = createI18n(lang).t;
      for (const k of ["decide", "changes_requested", "outcome", "overdue", "overdue_routing_error", "escalated"])
        expect(t(`myWork.message.approvals__task__${k}`, { defaultValue: "" }), `${lang} ${k}`).not.toBe("");
    }
  });

  it("query keys: every transformation-scoped P4 key is refreshed for its transformation only", () => {
    expect(isP4KeyOf(TR_ID, p4Keys.area("raci", TR_ID))).toBe(true);
    expect(isP4KeyOf(TR_ID, p4Keys.area("kpis", TR_ID, "x"))).toBe(true);
    expect(isP4KeyOf(TR_ID, p4Keys.area("raci", "other"))).toBe(false);
    expect(isP4KeyOf(TR_ID, p4Keys.workItems())).toBe(false);
  });

  it.each(["en", "ar"] as const)("a planned P4 route shows the honest 'being built' state (%s)", async (locale) => {
    const t = createI18n(locale).t;
    mockApi(...p4Handlers(locale, []));
    renderApp(`/transformations/${TR_ID}/kpis`, { i18n: createI18n(locale) });
    expect(await screen.findByRole("heading", { level: 1, name: t("nav.p4.kpis.title") })).toBeTruthy();
    expect(document.querySelector("[data-state='being-built']")?.textContent).toContain(t("nav.p4.beingBuiltTitle"));
  });
});
