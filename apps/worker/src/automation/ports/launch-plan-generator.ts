// The worker twin of the API's launch-plan generator (apps/api/src/modules/launch/plan.ts `generateLaunchPlanInTx` and
// port.ts; ADR-0044 §1-§2, ADR-0048 §1; p5-work-split §H.1; T-DG5-BE-P). Starter 1 runs in the worker, which imports
// no API code (ADR-0002), so the worker registers this twin as its LaunchPlanPort at composition (worker.ts). It writes
// exactly what the API generator writes (apps/api/test/integration/launch/worker-parity.test.ts proves it): under the
// launchPlan lock (730267) it returns the existing plan untouched when there is one (a replay writes nothing; the
// UNIQUE `launch_plan_idempotency_key` is the backstop), else it creates the plan (`generated_via = 'automation'`), one
// task per `launch_template_item` and the Day-90 test, dated day d = start date + d calendar days (D-142 Q6), with one
// audit event per row. The rows carry the transformation's creator; the audit actor is the service acting on behalf of
// that creator, with the job id (`job:<id>`). It grants and approves nothing.
import { insertAuditEvent, sql, type AuditActor, type Tx } from "@mth/db";
import {
  registerLaunchPlanPort,
  type LaunchPlanOutcome,
  type LaunchPlanPort,
  type LaunchPlanRequest,
} from "./launch-plan.ts";

/** Lock class launchPlan (ADR-0048 §8; apps/api platform/advisory-locks.ts; taken by the 0086 guards). */
const LAUNCH_PLAN_LOCK_CLASS = 730267;
const DAY_NINETY = 90;
const DAY_MS = 86_400_000;
const BUSINESS_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** n new UUIDv7 ids from the database (the worker has no uuid dependency; the starters.ts `newId` precedent). */
async function newIds(tx: Tx, n: number): Promise<string[]> {
  const r = await sql<{ id: string }>`SELECT mth_uuid_v7() AS id FROM generate_series(1, ${n}::int)`.execute(tx);
  return r.rows.map((x) => x.id);
}

function addCalendarDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d) + n * DAY_MS).toISOString().slice(0, 10);
}

export const workerLaunchPlanGenerator: LaunchPlanPort = {
  async generate(tx: Tx, request: LaunchPlanRequest): Promise<LaunchPlanOutcome> {
    if (request.idempotencyKey !== `launch_plan:${request.transformationId}`)
      throw new Error(`launch plan port: idempotency key must be launch_plan:${request.transformationId}`);
    if (!BUSINESS_DATE.test(request.startDate))
      throw new Error(`launch plan port: start date ${request.startDate} is not a business date`);
    await sql`SELECT pg_advisory_xact_lock(${LAUNCH_PLAN_LOCK_CLASS}::int4, hashtext(${request.transformationId}))`.execute(
      tx,
    );
    const existing = await tx
      .selectFrom("launch_plan")
      .select("id")
      .where("transformation_id", "=", request.transformationId)
      .executeTakeFirst();
    if (existing) return { outcome: "existing", launchPlanId: existing.id };
    const t = await tx
      .selectFrom("transformation")
      .select(["organization_id", "created_by"])
      .where("id", "=", request.transformationId)
      .executeTakeFirst();
    if (!t) throw new Error(`launch plan port: transformation ${request.transformationId} does not exist`);
    const actor: AuditActor = {
      actorType: "service",
      actorUserId: null,
      onBehalfOfUserId: t.created_by,
      requestId: `job:${request.jobId}`,
      source: "worker",
    };
    const scope = { organizationId: t.organization_id, transformationId: request.transformationId };
    const [planId] = (await newIds(tx, 1)) as [string];
    const inserted = await tx
      .insertInto("launch_plan")
      .values({
        id: planId,
        organization_id: t.organization_id,
        transformation_id: request.transformationId,
        start_date: request.startDate,
        generated_via: "automation",
        idempotency_key: request.idempotencyKey,
        created_by: t.created_by,
        updated_by: t.created_by,
      })
      .onConflict((oc) => oc.doNothing())
      .returning("id")
      .executeTakeFirst();
    if (!inserted) {
      const row = await tx
        .selectFrom("launch_plan")
        .select("id")
        .where("transformation_id", "=", request.transformationId)
        .executeTakeFirstOrThrow();
      return { outcome: "existing", launchPlanId: row.id };
    }
    await insertAuditEvent(tx, actor, {
      action: "launch_plan.generate",
      recordType: "launch_plan",
      recordId: planId,
      ...scope,
      newVersion: 1,
      changes: {
        start_date: { from: null, to: request.startDate },
        generated_via: { from: null, to: "automation" },
      },
    });
    const items = await tx
      .selectFrom("launch_template_item")
      .select(["code", "window_code", "item_kind", "ordinal", "text_en", "output_record_type", "start_day", "due_day"])
      .orderBy("ordinal")
      .execute();
    const ids = await newIds(tx, items.length);
    const tasks = items.map((item, i) => ({
      id: ids[i]!,
      organization_id: t.organization_id,
      transformation_id: request.transformationId,
      plan_id: planId,
      ordinal: item.ordinal,
      template_item_code: item.code,
      window_code: item.window_code,
      task_kind: item.item_kind,
      title: item.text_en,
      start_date: addCalendarDays(request.startDate, item.start_day),
      due_date: addCalendarDays(request.startDate, item.due_day),
      output_record_type: item.output_record_type,
      created_by: t.created_by,
      updated_by: t.created_by,
    }));
    if (tasks.length > 0) await tx.insertInto("launch_task").values(tasks).execute();
    for (const task of tasks)
      await insertAuditEvent(tx, actor, {
        action: "launch_task.generate",
        recordType: "launch_task",
        recordId: task.id,
        ...scope,
        newVersion: 1,
        changes: {
          template_item_code: { from: null, to: task.template_item_code },
          title: { from: null, to: task.title },
          start_date: { from: null, to: task.start_date },
          due_date: { from: null, to: task.due_date },
        },
      });
    const [testId] = (await newIds(tx, 1)) as [string];
    const scheduledDate = addCalendarDays(request.startDate, DAY_NINETY);
    await tx
      .insertInto("day_ninety_test")
      .values({
        id: testId,
        organization_id: t.organization_id,
        transformation_id: request.transformationId,
        plan_id: planId,
        scheduled_date: scheduledDate,
        created_by: t.created_by,
        updated_by: t.created_by,
      })
      .execute();
    await insertAuditEvent(tx, actor, {
      action: "day_ninety_test.create",
      recordType: "day_ninety_test",
      recordId: testId,
      ...scope,
      newVersion: 1,
      changes: { scheduled_date: { from: null, to: scheduledDate } },
    });
    return { outcome: "created", launchPlanId: planId };
  },
};

/** The worker composition's one wiring call (worker.ts `startWorker`). */
export function wireWorkerLaunchPlanPort(): void {
  registerLaunchPlanPort(workerLaunchPlanGenerator);
}
