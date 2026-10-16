// The Day-90 test task job (T-DG5-BE-P2; p5-work-split §H.2; ADR-0048 §4 "Day 90 reached -> create test task";
// REQ-PB-087). The plans are generated through the real API (startApi, the run's disposable PostgreSQL) and the
// worker's handler runs against the same database. Proves:
//  - the job run twice on day 90 creates one `day_ninety_test_due` task per SP/TL holder (the holders of
//    day_ninety_test.respond whose grant applies to the transformation), with the dedupe key
//    `day_ninety_test:<testId>:<userId>`, its notification and audit events; AUD, TO and WL get none;
//  - a test not yet due (day 89 today) and a completed test get no task;
//  - "today" is the business date in the transformation's time zone (default Asia/Riyadh);
//  - the handler is registered for the 0086 schedule (so the worker schedules it).
// All data is SYNTHETIC; a task answers nothing, and no job decides a business approval or touches DG0-DG7.
import { sql } from "@mth/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, seedWorld, startApi, type TestApi, type World } from "../../../api/test/support/harness.ts";
import { ifm, setupP2World, type P2World } from "../../../api/test/support/p2-fixtures.ts";
import { DOMAIN_HANDLERS } from "../../src/handlers/index.ts";
import {
  createDayNinetyTestTasks,
  DAY_NINETY_TASK_KIND,
  DAY_NINETY_TESTS_QUEUE,
  dayNinetyTaskKey,
} from "../../src/handlers/launch.ts";
import { LAUNCH_QUEUES } from "../../src/queues/launch.ts";

let api: TestApi;
let w: World;
const send = (m: string, u: string, o?: Parameters<typeof call>[3]) => call(api.app, m, u, o);

const plusDays = (d: string, days: number) => {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
};

/** Today in the transformation's time zone, as the job computes it. */
async function businessToday(transformationId: string): Promise<string> {
  const r = await sql<{ d: string }>`
    SELECT p4_business_date(now(), timezone)::text AS d FROM transformation WHERE id = ${transformationId}::uuid`.execute(
    api.db,
  );
  return r.rows[0]!.d;
}

/** A P2 world whose plan starts `daysAgo` days before today (day 90 is today when daysAgo = 90). */
async function worldWithPlan(daysAgo: number): Promise<{ p: P2World; testId: string; scheduled: string }> {
  const p = await setupP2World(api, w);
  const today = await businessToday(p.transformationId);
  const res = await send("POST", `/api/v1/transformations/${p.transformationId}/launch-plan`, {
    session: p.lead.session,
    body: { startDate: plusDays(today, -daysAgo) },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const t = await api.db
    .selectFrom("day_ninety_test")
    .select(["id", "scheduled_date"])
    .where("transformation_id", "=", p.transformationId)
    .executeTakeFirstOrThrow();
  return { p, testId: t.id, scheduled: String(t.scheduled_date).slice(0, 10) };
}

const tasksOf = (testId: string) =>
  api.db
    .selectFrom("work_item")
    .select(["id", "assignee_user_id", "dedupe_key", "kind", "due_date", "link_path", "message_key", "created_source"])
    .where("subject_type", "=", "day_ninety_test")
    .where("subject_id", "=", testId)
    .orderBy("assignee_user_id")
    .execute();

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
}, 60_000);
afterAll(async () => {
  await api.close();
}, 60_000);

describe("launch.day_ninety_tests (ADR-0048 §4; REQ-PB-087)", () => {
  it("is registered for the 0086 schedule, with its queue", async () => {
    expect(DOMAIN_HANDLERS.map((h) => h.queue)).toContain(DAY_NINETY_TESTS_QUEUE);
    expect(LAUNCH_QUEUES.map((q) => q.name)).toEqual([DAY_NINETY_TESTS_QUEUE]);
    const s = await api.db
      .selectFrom("job_schedule")
      .select(["queue_name", "cron", "timezone"])
      .where("code", "=", DAY_NINETY_TESTS_QUEUE)
      .executeTakeFirstOrThrow();
    expect(s).toEqual({ queue_name: DAY_NINETY_TESTS_QUEUE, cron: "50 0 * * *", timezone: "Asia/Riyadh" });
  });

  it("run twice on day 90 it creates one task per SP/TL holder, and none for AUD, TO or WL", async () => {
    const { p, testId, scheduled } = await worldWithPlan(90);
    expect(scheduled).toBe(await businessToday(p.transformationId)); // day 90 is today
    const first = await createDayNinetyTestTasks(api.db, { organizationId: w.orgA.id }, "day90-run-1");
    const afterFirst = await tasksOf(testId);
    const second = await createDayNinetyTestTasks(api.db, { organizationId: w.orgA.id }, "day90-run-2");
    const afterSecond = await tasksOf(testId);
    expect(afterSecond).toEqual(afterFirst);
    expect(second.created).toBe(0);
    expect(first.created).toBeGreaterThanOrEqual(2);

    // The holders of day_ninety_test.respond in scope: the SP (transformation grant) and the TL (business-unit grant).
    const assignees = afterFirst.map((t) => t.assignee_user_id);
    expect(new Set(assignees).size).toBe(assignees.length); // one task per holder
    expect(assignees).toContain(p.lead.id);
    expect(assignees).toContain(p.sponsor.id);
    for (const none of [p.auditor.id, p.office.id, p.contributor.id]) expect(assignees).not.toContain(none);
    for (const t of afterFirst) {
      expect(t).toMatchObject({
        kind: DAY_NINETY_TASK_KIND,
        dedupe_key: dayNinetyTaskKey(testId, t.assignee_user_id),
        link_path: `/transformations/${p.transformationId}/day-90-test`,
        message_key: "launch.task.day_ninety_test_due",
        created_source: "worker",
      });
      expect(String(t.due_date).slice(0, 10)).toBe(scheduled);
      // Each item has one audit event by the service (never a user), and one notification.
      const audit = await api.db
        .selectFrom("audit_event")
        .select(["action", "actor_type", "source", "request_id"])
        .where("record_id", "=", t.id)
        .execute();
      expect(audit).toEqual([
        { action: "work_item.create", actor_type: "service", source: "worker", request_id: "job:day90-run-1" },
      ]);
      const notes = await api.db
        .selectFrom("inbox_notification")
        .select("id")
        .where("work_item_id", "=", t.id)
        .execute();
      expect(notes).toHaveLength(1);
    }
    // Every holder in scope is someone with day_ninety_test.respond: the role of each task's grant grants it.
    for (const userId of assignees) {
      const r = await sql<{ n: number }>`
        SELECT count(*)::int AS n FROM scoped_assignment a
          JOIN role_permission rp ON rp.role_id = a.role_id AND rp.permission_code = 'day_ninety_test.respond'
         WHERE a.user_id = ${userId}::uuid AND a.revoked_at IS NULL`.execute(api.db);
      expect(r.rows[0]!.n).toBeGreaterThan(0);
    }
  });

  it("a test not yet due (day 89 today) and a completed test get no task", async () => {
    const early = await worldWithPlan(89);
    expect(early.scheduled).toBe(plusDays(await businessToday(early.p.transformationId), 1));
    const done = await worldWithPlan(120);
    // Complete the second test through the API (TL answers all six).
    let version = 1;
    for (const q of ["q1", "q2", "q3", "q4", "q5", "q6"]) {
      const res = await send("PUT", `/api/v1/transformations/${done.p.transformationId}/day-90-test/responses/${q}`, {
        session: done.p.lead.session,
        headers: ifm(version),
        body: { answer: "yes" },
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      version = res.body.version as number;
    }
    const completed = await send("POST", `/api/v1/transformations/${done.p.transformationId}/day-90-test/complete`, {
      session: done.p.lead.session,
      headers: ifm(version),
    });
    expect(completed.status, JSON.stringify(completed.body)).toBe(200);
    await createDayNinetyTestTasks(api.db, { organizationId: w.orgA.id }, "day90-run-3");
    expect(await tasksOf(early.testId)).toEqual([]);
    expect(await tasksOf(done.testId)).toEqual([]);
  });
});
