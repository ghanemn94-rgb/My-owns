// P4 contract exercises of BE-A (T-DG4-BE-A; p4-work-split §I+C.1, §1 S-10): the 15 slice I operations (calendars and
// holidays, working days, job schedules, My Work items and the inbox). Every call goes through `ctx.mirrored` (OpenAPI
// status/body/headers + problem mirror) and every success body is parsed with the zod mirror in P4_MIRRORS_BE_A. All
// data is synthetic; nothing here grants a business approval or touches the engineering gates DG0-DG7.
import {
  businessCalendar,
  businessCalendarPage,
  calendarHoliday,
  calendarHolidayPage,
  inboxNotification,
  inboxPage,
  jobSchedule,
  jobSchedulePage,
  workingDayComputation,
  workItem,
  workItemPage,
} from "@mth/shared/schemas";
import { expect } from "vitest";
import type { z } from "zod";
import { createWorkItemOnce } from "../../../src/modules/tasks/index.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import { signIn, uniq, type P4ExerciseContext } from "../../support/harness.ts";

export const P4_MIRRORS_BE_A: Readonly<Record<string, z.ZodType>> = {
  listBusinessCalendars: businessCalendarPage,
  createBusinessCalendar: businessCalendar,
  getBusinessCalendar: businessCalendar,
  updateBusinessCalendar: businessCalendar,
  listCalendarHolidays: calendarHolidayPage,
  createCalendarHoliday: calendarHoliday,
  updateCalendarHoliday: calendarHoliday,
  computeWorkingDayDueDate: workingDayComputation,
  listJobSchedules: jobSchedulePage,
  updateJobSchedule: jobSchedule,
  listMyWorkItems: workItemPage,
  getWorkItem: workItem,
  completeWorkItem: workItem,
  listMyInbox: inboxPage,
  markInboxNotificationRead: inboxNotification,
};

export async function exerciseP4BeAOperations(ctx: P4ExerciseContext): Promise<void> {
  const m = ctx.mirrored;
  const w = ctx.world;
  const admin = await signIn(ctx.api.app, w.admin.subject); // ADM_TECH @ org A: calendar.configure, job.*
  const auditor = await signIn(ctx.api.app, w.auditor.subject);
  const office = await signIn(ctx.api.app, w.office.subject);

  // ------------------------------------------------------------------ calendars and holidays (ADR-0025 §1)
  const ORG = `/api/v1/organizations/${w.orgA.id}/calendars`;
  expect((await m("GET", ORG, { session: auditor })).status).toBe(200);
  const code = uniq("CAL");
  const created = await m("POST", ORG, {
    session: admin,
    body: { code, nameEn: "Riyadh business calendar", nameAr: "تقويم أعمال الرياض", isDefault: true },
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  expect([created.body.timezone, created.body.workweek]).toEqual(["Asia/Riyadh", [7, 1, 2, 3, 4]]);
  // AUD is read-only (403); a taken code is 409; an invalid workweek and an unknown zone are 422.
  expect(
    (await m("POST", ORG, { session: auditor, body: { code: uniq("CAL"), nameEn: "x", nameAr: "س" } })).status,
  ).toBe(403);
  expect((await m("POST", ORG, { session: admin, body: { code, nameEn: "x", nameAr: "س" } })).status).toBe(409);
  expect(
    (await m("POST", ORG, { session: admin, body: { code: uniq("CAL"), nameEn: "x", nameAr: "س", workweek: [8] } }))
      .status,
  ).toBe(422);
  const C = `/api/v1/calendars/${created.body.id}`;
  expect((await m("GET", C, { session: auditor })).status).toBe(200);
  expect((await m("PATCH", C, { session: admin, body: { nameEn: "No If-Match" } })).status).toBe(428);
  expect((await m("PATCH", C, { session: admin, headers: ifm(9), body: { nameEn: "Stale" } })).status).toBe(409);
  const renamed = await m("PATCH", C, { session: admin, headers: ifm(1), body: { nameEn: "Riyadh calendar" } });
  expect([renamed.status, renamed.body.version]).toEqual([200, 2]);
  // The default calendar cannot be archived (422).
  expect((await m("PATCH", C, { session: admin, headers: ifm(2), body: { status: "archived" } })).status).toBe(422);

  expect((await m("GET", `${C}/holidays?year=2026`, { session: auditor })).status).toBe(200);
  const holiday = await m("POST", `${C}/holidays`, {
    session: admin,
    body: { dateFrom: "2026-10-15", dateTo: "2026-10-15", nameEn: "Synthetic holiday", nameAr: "عطلة اصطناعية" },
  });
  expect(holiday.status, JSON.stringify(holiday.body)).toBe(201);
  expect(
    (
      await m("POST", `${C}/holidays`, {
        session: admin,
        body: { dateFrom: "2026-10-15", dateTo: "2026-10-14", nameEn: "Backwards", nameAr: "معكوس" },
      })
    ).status,
  ).toBe(422);
  // REQ-S10-006: raised Wednesday 2026-10-14, holiday Thursday 2026-10-15, n = 5 -> Thursday 2026-10-22.
  const due = await m("GET", `${C}/working-days?from=2026-10-14&workingDays=5`, { session: auditor });
  expect([due.status, due.body.dueDate, due.body.unknownReason]).toEqual([200, "2026-10-22", null]);
  const H = `${C}/holidays/${holiday.body.id}`;
  const removed = await m("PATCH", H, { session: admin, headers: ifm(1), body: { status: "removed" } });
  expect([removed.status, removed.body.status]).toEqual([200, "removed"]);
  const without = await m("GET", `${C}/working-days?from=2026-10-14&workingDays=5`, { session: auditor });
  expect(without.body.dueDate).toBe("2026-10-21");

  // ------------------------------------------------------------------ job schedules (ADR-0025 §3)
  const J = "/api/v1/admin/job-schedules";
  const jobs = await m("GET", J, { session: admin });
  expect(jobs.status).toBe(200);
  expect((jobs.body.items as { code: string }[]).map((j) => j.code)).toEqual(
    expect.arrayContaining(["approval.escalation_scan", "delegation.expiry_sweep", "kpi.reporting_period_open"]),
  );
  expect((await m("GET", J, { session: auditor })).status).toBe(403);
  const job = (jobs.body.items as { code: string; version: number }[]).find(
    (j) => j.code === "delegation.expiry_sweep",
  )!;
  expect(
    (
      await m("PATCH", `${J}/delegation.expiry_sweep`, {
        session: admin,
        headers: ifm(job.version),
        body: { cron: "61 * * * *" },
      })
    ).status,
  ).toBe(422);
  const patched = await m("PATCH", `${J}/delegation.expiry_sweep`, {
    session: admin,
    headers: ifm(job.version),
    body: { cron: "*/30 * * * *" },
  });
  expect([patched.status, patched.body.cron]).toEqual([200, "*/30 * * * *"]);

  // ------------------------------------------------------------------ My Work items and the inbox (ADR-0025 §4)
  const item = await ctx.api.db.transaction().execute((tx) =>
    createWorkItemOnce(
      tx,
      { actorType: "service", actorUserId: null, requestId: "contract:be-a", source: "worker" },
      {
        organizationId: w.orgA.id,
        kind: "kpi_update_due",
        assigneeUserId: w.office.id,
        subjectType: "kpi_definition",
        subjectId: crypto.randomUUID(),
        linkPath: "/kpi/synthetic",
        messageKey: "tasks.kpi_update_due",
        messageParams: { periodLabel: "2026-10" },
        periodLabel: "2026-10",
        dedupeKey: uniq("contract.be_a:"),
      },
    ),
  );
  expect(item.outcome).toBe("created");
  const items = await m("GET", "/api/v1/me/work-items?status=open", { session: office });
  expect((items.body.items as { id: string }[]).map((i) => i.id)).toContain(item.workItemId);
  const W = `/api/v1/work-items/${item.workItemId}`;
  expect((await m("GET", W, { session: office })).status).toBe(200);
  expect((await m("GET", W, { session: auditor })).status).toBe(404);
  expect((await m("POST", `${W}/complete`, { session: auditor, headers: ifm(1) })).status).toBe(403);
  const done = await m("POST", `${W}/complete`, { session: office, headers: ifm(1) });
  expect([done.status, done.body.status]).toEqual([200, "done"]);
  expect((await m("POST", `${W}/complete`, { session: office, headers: ifm(2) })).status).toBe(422);

  const inbox = await m("GET", "/api/v1/me/inbox?unreadOnly=true", { session: office });
  expect(inbox.status).toBe(200);
  const note = (inbox.body.items as { id: string; workItemId: string }[]).find(
    (n) => n.workItemId === item.workItemId,
  )!;
  expect(note).toBeDefined();
  const N = `/api/v1/me/inbox/${note.id}/read`;
  expect((await m("POST", N, { session: auditor, headers: ifm(1) })).status).toBe(404);
  const read = await m("POST", N, { session: office, headers: ifm(1) });
  expect([read.status, read.body.readAt !== null]).toEqual([200, true]);
  expect((await m("POST", N, { session: office, headers: ifm(2) })).status).toBe(422);
}
