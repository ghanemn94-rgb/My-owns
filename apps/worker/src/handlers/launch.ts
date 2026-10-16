// launch job handlers (P5; stub by T-DG5-BE-A, p5-plan §5.1 and §5.3; filled by T-DG5-BE-P2, p5-work-split §H.2).
//
// launch.day_ninety_tests (ADR-0048 §4 "Day 90 reached -> create test task"; REQ-PB-087). Daily at 00:50 Asia/Riyadh
// (job_schedule seeded by 0086). For every OPEN Day-90 leadership test whose scheduled date (the plan's start date + 90
// calendar days) is on or before TODAY in its transformation's time zone, it creates one `day_ninety_test_due` My Work
// item per active holder of `day_ninety_test.respond` whose grant applies to the transformation (SP and TL by default,
// 0087; the transformation's own scope, or a business unit above it / the organization when the role inherits
// downward). A closed transformation gets no task.
// Exactly once: the dedupe key `day_ninety_test:<testId>:<userId>` (createWorkItemOnce; the work_item
// (organization_id, dedupe_key) unique key is the backstop), so a second run on day 90, a redelivery or a retry
// creates nothing more. One transaction per test (the test row is locked and re-read as open inside it), no remote I/O
// inside it. Completing the test (API launch/day-ninety.ts) closes these items. The audit actor is the service
// (jobActor); a service holds no permission, and a task answers nothing: a Day-90 answer is a leader's, never a job's,
// and it is not a G1-G6 business approval. Nothing here touches the engineering gates DG0-DG7.
import { sql, type Db, type Tx } from "@mth/db";
import { z } from "zod";
import { createWorkItemOnce, jobActor } from "../kit.ts";
import type { JobHandler } from "./spec.ts";

export const DAY_NINETY_TESTS_QUEUE = "launch.day_ninety_tests";
export const DAY_NINETY_TASK_KIND = "day_ninety_test_due";
export const DAY_NINETY_TASK_MESSAGE = "launch.task.day_ninety_test_due";
const RESPOND = "day_ninety_test.respond";

/** The dedupe key of one respondent's task (ADR-0048 §4). */
export const dayNinetyTaskKey = (testId: string, userId: string): string => `day_ninety_test:${testId}:${userId}`;
/** The in-app link of the test (the web route `transformations/:id/day-90-test`). */
export const dayNinetyLinkPath = (transformationId: string): string =>
  `/transformations/${transformationId}/day-90-test`;

export interface DayNinetyTasksResult {
  readonly tests: number;
  readonly created: number;
  readonly existing: number;
}

const data = z.object({ organizationId: z.uuid().optional() }).loose();

interface DueTest {
  readonly id: string;
  readonly organization_id: string;
  readonly transformation_id: string;
}

/** The active holders of day_ninety_test.respond whose live grant applies to the transformation. */
async function respondents(tx: Tx, t: { id: string; organization_id: string; business_unit_id: string }) {
  const r = await sql<{ user_id: string }>`
    SELECT DISTINCT a.user_id
      FROM scoped_assignment a
      JOIN role r ON r.id = a.role_id
      JOIN role_permission rp ON rp.role_id = r.id AND rp.permission_code = ${RESPOND}
      JOIN app_user u ON u.id = a.user_id AND u.status = 'active'
     WHERE a.organization_id = ${t.organization_id}::uuid
       AND a.revoked_at IS NULL
       AND a.effective_from <= now()
       AND (a.effective_to IS NULL OR a.effective_to > now())
       AND (
            (a.scope_type = 'transformation' AND a.scope_id = ${t.id}::uuid)
         OR (r.inherits_downward AND a.scope_type = 'business_unit' AND a.scope_id IN (
               SELECT c.ancestor_id FROM business_unit_closure c WHERE c.descendant_id = ${t.business_unit_id}::uuid))
         OR (r.inherits_downward AND a.scope_type = 'organization' AND a.scope_id = ${t.organization_id}::uuid)
       )
     ORDER BY a.user_id`.execute(tx);
  return r.rows.map((x) => x.user_id);
}

/** The tasks of one due test, in `tx`: re-reads the test under its row lock and skips it unless it is still open and due. */
async function tasksOfTest(tx: Tx, jobId: string, testId: string): Promise<{ created: number; existing: number }> {
  const row = await sql<{
    id: string;
    organization_id: string;
    transformation_id: string;
    scheduled_date: string;
    business_unit_id: string;
    code: string;
    name: string;
  }>`
    SELECT d.id, d.organization_id, d.transformation_id, d.scheduled_date::text AS scheduled_date,
           t.business_unit_id, t.code, t.name
      FROM day_ninety_test d
      JOIN transformation t ON t.id = d.transformation_id
     WHERE d.id = ${testId}::uuid
       AND d.status = 'open'
       AND t.status <> 'closed'
       AND t.archived_at IS NULL
       AND d.scheduled_date <= p4_business_date(now(), t.timezone)
       FOR UPDATE OF d`.execute(tx);
  const test = row.rows[0];
  if (!test) return { created: 0, existing: 0 };
  let created = 0;
  let existing = 0;
  const people = await respondents(tx, {
    id: test.transformation_id,
    organization_id: test.organization_id,
    business_unit_id: test.business_unit_id,
  });
  for (const userId of people) {
    const r = await createWorkItemOnce(tx, jobActor(jobId), {
      organizationId: test.organization_id,
      transformationId: test.transformation_id,
      kind: DAY_NINETY_TASK_KIND,
      assigneeUserId: userId,
      subjectType: "day_ninety_test",
      subjectId: test.id,
      linkPath: dayNinetyLinkPath(test.transformation_id),
      messageKey: DAY_NINETY_TASK_MESSAGE,
      messageParams: {
        transformationCode: test.code,
        transformationName: test.name,
        scheduledDate: test.scheduled_date,
      },
      dueDate: test.scheduled_date,
      dedupeKey: dayNinetyTaskKey(test.id, userId),
    });
    if (r.outcome === "created") created += 1;
    else existing += 1;
  }
  return { created, existing };
}

/** The daily job (exported for the tests). `data.organizationId` narrows it to one organization (tests). */
export async function createDayNinetyTestTasks(db: Db, input: unknown, jobId: string): Promise<DayNinetyTasksResult> {
  const { organizationId } = data.parse(input ?? {});
  let q = db
    .selectFrom("day_ninety_test as d")
    .innerJoin("transformation as t", "t.id", "d.transformation_id")
    .select(["d.id", "d.organization_id", "d.transformation_id"])
    .where("d.status", "=", "open")
    .where("t.status", "<>", "closed")
    .where("t.archived_at", "is", null)
    .where(sql<boolean>`d.scheduled_date <= p4_business_date(now(), t.timezone)`);
  if (organizationId !== undefined) q = q.where("d.organization_id", "=", organizationId);
  const due: readonly DueTest[] = await q.orderBy("d.scheduled_date").orderBy("d.id").execute();
  let created = 0;
  let existing = 0;
  for (const test of due) {
    const r = await db.transaction().execute((tx) => tasksOfTest(tx, jobId, test.id));
    created += r.created;
    existing += r.existing;
  }
  return { tests: due.length, created, existing };
}

export const LAUNCH_HANDLERS: readonly JobHandler[] = [
  { queue: DAY_NINETY_TESTS_QUEUE, handle: (db, input, jobId) => createDayNinetyTestTasks(db, input, jobId) },
];
