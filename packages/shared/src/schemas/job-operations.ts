// zod mirrors of the P5 jobs operations view (docs/api/openapi.yaml JobOperation, JobOperationList, JobRun,
// JobOperationDetail, JobRunNowResult; ADR-0043 §6; REQ-S12-022; T-DG5-BE-I2), and the internal outbox event
// `job.run_requested` written by "run now".
import { z } from "zod";
import { timestamp, uuid } from "./common.ts";

/** Why a job has no next run: the schedule is disabled, or its cron matches nothing in the next 366 days. */
export const jobNextRunUnknownReason = z.enum(["disabled", "unknown"]);
export type JobNextRunUnknownReason = z.infer<typeof jobNextRunUnknownReason>;
export const jobRunOutcome = z.enum(["succeeded", "failed"]);
export const jobOperationAction = z.enum(["run_now", "retry_failures"]);
export type JobOperationAction = z.infer<typeof jobOperationAction>;

/** lastSuccessAt null = never run; nextRunAt null with nextRunUnknownReason (never a guessed time). */
export const jobOperation = z.strictObject({
  code: z.string(),
  queueName: z.string(),
  cron: z.string(),
  timezone: z.string(),
  enabled: z.boolean(),
  ownerModule: z.string(),
  descriptionEn: z.string(),
  descriptionAr: z.string(),
  lastSuccessAt: timestamp.nullable(),
  lastRunAt: timestamp.nullable(),
  lastOutcome: jobRunOutcome.nullable(),
  nextRunAt: timestamp.nullable(),
  nextRunUnknownReason: jobNextRunUnknownReason.nullable(),
  openFailures: z.number().int().min(0),
  allowedActions: z.array(jobOperationAction),
});
export type JobOperation = z.infer<typeof jobOperation>;
export const jobOperationList = z.strictObject({ items: z.array(jobOperation) });

export const jobRun = z.strictObject({
  id: uuid,
  jobId: z.string(),
  attemptNo: z.number().int().min(1),
  outcome: jobRunOutcome,
  startedAt: timestamp,
  finishedAt: timestamp,
  errorCode: z.string().nullable(),
});
export type JobRun = z.infer<typeof jobRun>;

export const jobOperationDetail = z.strictObject({
  job: jobOperation,
  runs: z.array(jobRun),
  nextCursor: z.string().nullable(),
});
export type JobOperationDetail = z.infer<typeof jobOperationDetail>;

export const jobRunNowResult = z.strictObject({
  code: z.string(),
  jobId: z.string().nullable(),
  singletonKey: z.string(),
  queuedAt: timestamp,
});
export type JobRunNowResult = z.infer<typeof jobRunNowResult>;

/** The singleton key of "run now" (ADR-0043 §6): `run-now:<code>:<ISO minute>`, e.g. run-now:kpi.x:2026-10-15T02:45. */
export function runNowSingletonKey(code: string, at: Date): string {
  return `run-now:${code}:${at.toISOString().slice(0, 16)}`;
}

/**
 * Internal outbox event (T-DG5-BE-I2; ADR-0043 §6): an administrator asked to run a scheduled job now. Written by the
 * API with idempotency key = the run-now singleton key, so a second request in the same minute writes nothing; after
 * COMMIT the worker sends the schedule's own job data (`{}`) to its queue, under the job id = this event's id (a
 * replayed dispatch sends nothing new). Running a job never decides a business approval.
 */
export const jobRunRequestedV1 = z.strictObject({
  jobScheduleCode: z.string().min(1).max(64),
  queueName: z.string().min(1).max(100),
  requestedBy: uuid,
  singletonKey: z.string().min(1).max(200),
});
export type JobRunRequestedV1 = z.infer<typeof jobRunRequestedV1>;
