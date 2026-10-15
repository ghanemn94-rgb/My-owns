// The run history of scheduled jobs and the "run now" dispatcher (ADR-0043 §6; REQ-S12-022 "store scheduled runs and
// execution outcomes in the database"; p5-work-split §D.4; T-DG5-BE-I2).
//
// recordJobRun: worker.ts calls it once per finished attempt of a job on a SCHEDULED queue (a queue named by a
//   job_schedule row; the first code when several rows share a queue, as the failure capture in kit.ts does). One
//   job_run row per (pg-boss job id, attempt) (UNIQUE job_run_job_attempt_key; ON CONFLICT DO NOTHING, so a
//   redelivered attempt records once). Append-only operational history: no audit event (it records the worker's own
//   run, not a change to a business record; 0074 header). A failed attempt stores an ADR-0043 §9 execution code:
//   `automation.retries_exhausted` on the last attempt (the job is then in the failure queue) and
//   `automation.action_failed` before it (pg-boss retries it with backoff).
// dispatchRunNow: the consumer of the internal outbox event `job.run_requested`, written by the API's run now in the
//   transaction of its audit event. After that COMMIT it sends the schedule's own job data (`{}`, exactly what
//   pg-boss's cron sends) to the schedule's queue under job id = the outbox event id, so a replayed dispatch sends
//   nothing new; the API's outbox idempotency key `run-now:<code>:<ISO minute>` already made a second request in the
//   same minute write nothing. A schedule disabled since the request, or whose queue no handler consumes in this
//   worker, is not sent (outcome `disabled` / `unhandled`). A job only starts work; none decides a business approval.
import { sql, type Db } from "@mth/db";
import { jobRunRequestedV1, outboxEnvelope } from "@mth/shared/schemas";
import type PgBoss from "pg-boss";

/** The queue that consumes `job.run_requested` (queues/jobs.ts). */
export const RUN_NOW_QUEUE = "jobs.run_now";
export const JOB_RUN_FAILED_CODE = "automation.action_failed";
export const JOB_RUN_EXHAUSTED_CODE = "automation.retries_exhausted";

/** The job_schedule code of a queue, or null when no schedule names it (the job is not a scheduled one). */
export async function scheduleCodeOfQueue(db: Db, queue: string): Promise<string | null> {
  const row = await db
    .selectFrom("job_schedule")
    .select("code")
    .where("queue_name", "=", queue)
    .orderBy("code")
    .executeTakeFirst();
  return row?.code ?? null;
}

export interface FinishedAttempt {
  readonly queue: string;
  readonly jobId: string;
  /** pg-boss retryCount of this attempt (0 for the first). */
  readonly retryCount: number;
  readonly retryLimit: number;
  readonly startedAt: Date;
  readonly finishedAt: Date;
  readonly failed: boolean;
}

export type RecordOutcome = "recorded" | "already_recorded" | "not_scheduled";

/** Records one finished attempt of a scheduled job (see the header). */
export async function recordJobRun(db: Db, run: FinishedAttempt): Promise<RecordOutcome> {
  const code = await scheduleCodeOfQueue(db, run.queue);
  if (code === null) return "not_scheduled";
  const attemptNo = Math.max(1, Math.min(100, run.retryCount + 1));
  const finishedAt = run.finishedAt < run.startedAt ? run.startedAt : run.finishedAt;
  const errorCode = !run.failed
    ? null
    : run.retryCount >= run.retryLimit
      ? JOB_RUN_EXHAUSTED_CODE
      : JOB_RUN_FAILED_CODE;
  const inserted = await db
    .insertInto("job_run")
    .values({
      id: sql<string>`mth_uuid_v7()`,
      job_schedule_code: code,
      job_id: run.jobId.slice(0, 100),
      attempt_no: attemptNo,
      outcome: run.failed ? "failed" : "succeeded",
      started_at: run.startedAt,
      finished_at: finishedAt,
      error_code: errorCode,
    })
    .onConflict((oc) => oc.constraint("job_run_job_attempt_key").doNothing())
    .returning("id")
    .executeTakeFirst();
  return inserted === undefined ? "already_recorded" : "recorded";
}

export type RunNowOutcome = "sent" | "already_sent" | "disabled" | "unhandled" | "unknown_schedule";

/** The `job.run_requested` consumer (see the header). */
export async function dispatchRunNow(
  db: Db,
  boss: PgBoss,
  handledQueues: ReadonlySet<string>,
  data: unknown,
): Promise<{ outcome: RunNowOutcome; code: string; jobId: string }> {
  const envelope = outboxEnvelope.parse(data);
  if (envelope.eventType !== "job.run_requested" || envelope.schemaVersion !== 1)
    throw new Error(`unexpected event ${envelope.eventType} v${envelope.schemaVersion} on ${RUN_NOW_QUEUE}`);
  const request = jobRunRequestedV1.parse(envelope.payload);
  const jobId = envelope.outboxEventId;
  const schedule = await db
    .selectFrom("job_schedule")
    .select(["code", "queue_name", "enabled"])
    .where("code", "=", request.jobScheduleCode)
    .executeTakeFirst();
  const code = request.jobScheduleCode;
  if (schedule === undefined) return { outcome: "unknown_schedule", code, jobId };
  if (!schedule.enabled) return { outcome: "disabled", code, jobId };
  if (!handledQueues.has(schedule.queue_name)) return { outcome: "unhandled", code, jobId };
  const sent = await boss.send(schedule.queue_name, {}, { id: jobId, singletonKey: request.singletonKey });
  return { outcome: sent === null ? "already_sent" : "sent", code, jobId };
}
