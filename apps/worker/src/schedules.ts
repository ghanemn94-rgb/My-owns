// Schedule registration of the scheduled-job kit (ADR-0025 §3; REQ-S16-005; T-DG4-BE-A). At start, and whenever the API
// emits the outbox event `job_schedule.updated`, the worker reads every `job_schedule` row and:
//  - calls boss.schedule(queue_name, cron, {}, { tz: timezone }) for each ENABLED row whose queue has a registered
//    handler in this worker (pg-boss keeps the cron in its own table and evaluates it in that timezone);
//  - calls boss.unschedule(queue_name) for each disabled row, and for each enabled row whose handler does not exist
//    yet (a stub domain): a job nobody consumes is never produced, and the row is reported as `unhandled`.
// Idempotent (schedule upserts; unschedule of a missing schedule is skipped). pg-boss on the product PostgreSQL stays
// the only queue (no separate queue service, M0310). A schedule only starts a job; no job decides a business approval.
import type { Db } from "@mth/db";
import { outboxEnvelope } from "@mth/shared/schemas";
import type PgBoss from "pg-boss";

export interface ScheduleSyncResult {
  readonly scheduled: readonly string[];
  readonly unscheduled: readonly string[];
  /** Enabled rows whose queue has no handler in this worker yet (not scheduled). */
  readonly unhandled: readonly string[];
}

export async function syncSchedules(
  db: Db,
  boss: PgBoss,
  handledQueues: ReadonlySet<string>,
): Promise<ScheduleSyncResult> {
  const rows = await db
    .selectFrom("job_schedule")
    .select(["code", "queue_name", "cron", "timezone", "enabled"])
    .orderBy("code")
    .execute();
  const existing = new Set((await boss.getSchedules()).map((s) => s.name));
  const scheduled: string[] = [];
  const unscheduled: string[] = [];
  const unhandled: string[] = [];
  for (const row of rows) {
    const handled = handledQueues.has(row.queue_name);
    if (row.enabled && handled) {
      await boss.schedule(row.queue_name, row.cron, {}, { tz: row.timezone });
      scheduled.push(row.code);
      continue;
    }
    if (row.enabled) unhandled.push(row.code);
    if (existing.has(row.queue_name)) {
      await boss.unschedule(row.queue_name);
      unscheduled.push(row.code);
    }
  }
  return { scheduled, unscheduled, unhandled };
}

/** The `job_schedule.updated` consumer: validates the envelope, then re-syncs every schedule (idempotent by nature). */
export async function handleJobScheduleUpdated(
  db: Db,
  boss: PgBoss,
  handledQueues: ReadonlySet<string>,
  data: unknown,
): Promise<ScheduleSyncResult> {
  const envelope = outboxEnvelope.parse(data);
  if (envelope.eventType !== "job_schedule.updated" || envelope.schemaVersion !== 1)
    throw new Error(`unexpected event ${envelope.eventType} v${envelope.schemaVersion} on job_schedule.updated`);
  return syncSchedules(db, boss, handledQueues);
}
