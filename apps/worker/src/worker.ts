// Worker runtime (ADR-0008): the outbox relay loop, the pg-boss handlers and the maintenance schedule.
// A handler that throws is retried by pg-boss per the queue policy and lands in `ops.failed` when retries run out.
import type { Db } from "@mth/db";
import type PgBoss from "pg-boss";
import { DOMAIN_HANDLERS, handleTransformationCreated, purgeExpired, type JobHandler } from "./handlers/index.ts";
import type { JobAttempt } from "./handlers/spec.ts";
import { ensureQueues, OUTBOX_RELAY, QUEUES, schedulePurge, type QueuePolicyOverrides } from "./queues/index.ts";
import { relayOnce } from "./relay.ts";
// T-DG5-BE-I (ADR-0043 §5): the failure capture and the retry dispatcher.
import { automationFailureRetryRequestedV1, outboxEnvelope } from "@mth/shared/schemas";
import { resumeExecution } from "./automation/retry.ts";
import { captureJobFailure, FAILURE_RETRY_QUEUE, failureRetryJobId, settleRetriedJob } from "./kit.ts";
import { handleJobScheduleUpdated, syncSchedules } from "./schedules.ts";
// T-DG5-BE-I2 (ADR-0043 §6): the run history of scheduled jobs and the run-now dispatcher.
import { dispatchRunNow, recordJobRun, RUN_NOW_QUEUE } from "./job-runs.ts";
// T-DG5-BE-P (ADR-0044 §1, ADR-0048 §1): the worker's S12-004 launch-plan generator (starter 1 runs here).
import { wireWorkerLaunchPlanPort } from "./automation/ports/launch-plan-generator.ts";

export interface WorkerLogger {
  info(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

export interface WorkerOptions {
  readonly db: Db;
  readonly boss: PgBoss;
  readonly timeZone: string;
  readonly log?: WorkerLogger;
  readonly pollIntervalMs?: number;
  readonly jobPollingIntervalSeconds?: number;
  readonly queuePolicy?: QueuePolicyOverrides;
  /** The domain handlers to start (default: every registered DOMAIN_HANDLERS entry; tests pass their own). */
  readonly handlers?: readonly JobHandler[];
  /**
   * D-203 O-1 (T-DG6-BE-X9): jobs fetched per poll of one queue (WORKER_JOB_BATCH_SIZE) and how many of them run at
   * once (WORKER_JOB_CONCURRENCY). Defaults: JOB_THROUGHPUT_DEFAULTS. A fetch that returns a full batch polls again at
   * once instead of waiting for the polling interval, so a backlog drains at the handlers' own speed.
   */
  readonly jobBatchSize?: number;
  readonly jobConcurrency?: number;
}

/** D-203 O-1: the safe defaults (packages/config WORKER_JOB_BATCH_SIZE and WORKER_JOB_CONCURRENCY name the same values). */
export const JOB_THROUGHPUT_DEFAULTS = { batchSize: 8, concurrency: 4 } as const;

/**
 * D-203 O-1 (T-DG6-BE-X9): runs `run` for every job of one fetched batch, at most `concurrency` at a time, and settles
 * EACH job on its own: `boss.complete(queue, id, result)` when it resolves, `boss.fail(queue, id, error)` when it throws.
 * pg-boss's own settlement after the batch then finds no active job and changes nothing (its complete only updates
 * `state = 'active'`). So every job keeps exactly the retry, backoff and dead-letter of the batch-of-one worker: one
 * job's error never fails or retries its neighbours, and a job that succeeds is never re-run because a neighbour failed.
 * Exactly-once is unchanged: it never depended on serial execution (several worker processes already run one queue
 * concurrently), but on the UNIQUE backstops, idempotency keys and advisory locks inside each handler (ADR-0043).
 * A settlement that itself fails (the database is unreachable) is rethrown after the batch, so pg-boss fails every job
 * of the batch that is not completed and its retry policy applies (never a silent completion).
 */
export async function runJobBatch<J extends { readonly id: string }>(
  boss: Pick<PgBoss, "complete" | "fail">,
  queue: string,
  jobs: readonly J[],
  concurrency: number,
  run: (job: J) => Promise<unknown>,
): Promise<void> {
  let next = 0;
  let settleError: unknown = null;
  const lane = async () => {
    while (next < jobs.length) {
      const job = jobs[next]!;
      next += 1;
      let ok = true;
      let value: unknown;
      try {
        value = await run(job);
      } catch (err) {
        ok = false;
        value = err;
      }
      try {
        if (ok) await boss.complete(queue, job.id, outputOf(value));
        else await boss.fail(queue, job.id, outputOf(value));
      } catch (err) {
        settleError ??= err;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, jobs.length)) }, lane));
  if (settleError !== null) throw settleError instanceof Error ? settleError : new Error(String(settleError));
}

/** The output pg-boss stores for a job: the batch-of-one worker passed the handler's value (or error) the same way. */
function outputOf(value: unknown): object {
  if (value !== null && typeof value === "object") return value;
  return value === undefined || value === null ? {} : { value };
}

export interface RunningWorker {
  stop(): Promise<void>;
}

const consoleLogger: WorkerLogger = {
  info: (obj, msg) => console.log(JSON.stringify({ level: "info", msg, ...obj })),
  error: (obj, msg) => console.error(JSON.stringify({ level: "error", msg, ...obj })),
};

export async function startWorker(options: WorkerOptions): Promise<RunningWorker> {
  const { db, boss } = options;
  const log = options.log ?? consoleLogger;
  const pollingIntervalSeconds = options.jobPollingIntervalSeconds ?? 2;
  const batchSize = options.jobBatchSize ?? JOB_THROUGHPUT_DEFAULTS.batchSize;
  const concurrency = Math.min(options.jobConcurrency ?? JOB_THROUGHPUT_DEFAULTS.concurrency, batchSize);
  if (!Number.isInteger(batchSize) || batchSize < 1 || !Number.isInteger(concurrency) || concurrency < 1)
    throw new Error("worker: jobBatchSize and jobConcurrency must be integers >= 1");

  wireWorkerLaunchPlanPort(); // T-DG5-BE-P: starter 1's optional 90-day plan (ADR-0044 §2 step 3)
  await ensureQueues(boss, options.queuePolicy);
  await schedulePurge(boss, options.timeZone);

  // T-DG5-BE-I (ADR-0043 §5; REQ-S12-020): every domain job runs inside `captured`. On success it resolves a failure
  // the job was retrying; when its LAST attempt (retryCount >= retryLimit) throws, the failure enters the queue
  // (operational_failure, with the job.failed event) and the error is rethrown, so the job still reaches ops.failed
  // exactly as in DG4. A capture error is logged and never hides the job's own error.
  const captured = async <T>(
    queue: string,
    job: PgBoss.JobWithMetadata<unknown>,
    run: (attempt: JobAttempt) => Promise<T>,
  ): Promise<T> => {
    const attempt: JobAttempt = { retryCount: job.retryCount, retryLimit: job.retryLimit };
    const ref = { queue, jobId: job.id, data: job.data, createdOn: job.createdOn };
    // T-DG5-BE-I2 (ADR-0043 §6; REQ-S12-022): every finished attempt of a SCHEDULED queue's job leaves one job_run row
    // (after BE-I's capture; a recording error is logged and never hides or changes the job's own outcome).
    const startedAt = new Date();
    const recordRun = (failed: boolean) =>
      recordJobRun(db, { queue, jobId: job.id, ...attempt, startedAt, finishedAt: new Date(), failed }).catch(
        (e: unknown) =>
          log.error({ queue, jobId: job.id, err: e instanceof Error ? e.message : String(e) }, "job run record failed"),
      );
    let result: T;
    try {
      result = await run(attempt);
    } catch (err) {
      if (attempt.retryCount >= attempt.retryLimit)
        await captureJobFailure(db, { ...ref, attempts: attempt.retryCount + 1, error: err }).catch((e: unknown) =>
          log.error(
            { queue, jobId: job.id, err: e instanceof Error ? e.message : String(e) },
            "failure capture failed",
          ),
        );
      await recordRun(true);
      throw err;
    }
    await settleRetriedJob(db, ref).catch((e: unknown) =>
      log.error({ queue, jobId: job.id, err: e instanceof Error ? e.message : String(e) }, "failure settle failed"),
    );
    await recordRun(false);
    return result;
  };

  // D-203 O-1 (T-DG6-BE-X9): every captured queue fetches a bounded batch and runs it with bounded concurrency
  // (runJobBatch settles each job on its own). A full batch polls again at once (notifyWorker skips pg-boss's loop
  // delay); a partial or empty one waits the polling interval as before, so idle queues cost what they did.
  const work = async (
    queue: string,
    perJob: (job: PgBoss.JobWithMetadata<unknown>, attempt: JobAttempt) => Promise<unknown>,
  ): Promise<void> => {
    let workerId: string | null = null;
    workerId = await boss.work(
      queue,
      { batchSize, pollingIntervalSeconds, includeMetadata: true },
      async (jobs: PgBoss.JobWithMetadata<unknown>[]) => {
        await runJobBatch(boss, queue, jobs, concurrency, (job) =>
          captured(queue, job, (attempt) => perJob(job, attempt)),
        );
        if (jobs.length >= batchSize && workerId !== null) boss.notifyWorker(workerId);
      },
    );
  };

  await work(QUEUES.transformationCreated, async (job) => {
    const outcome = await handleTransformationCreated(db, job.data, job.id);
    log.info({ queue: QUEUES.transformationCreated, jobId: job.id, outcome }, "job handled");
    return { outcome };
  });
  // D-203 O-1: the two maintenance queues stay one job per fetch (a daily purge; schedule re-registrations, applied in
  // the order they arrive). Neither carries a burst of domain events.
  await boss.work(QUEUES.purge, { batchSize: 1, pollingIntervalSeconds }, async ([job]) => {
    const result = await purgeExpired(db);
    log.info({ queue: QUEUES.purge, jobId: job!.id, ...result }, "expired rows purged");
    return result;
  });
  // P4 (ADR-0025 §3; T-DG4-BE-A): one pg-boss worker per domain handler, then the job_schedule rows are registered with
  // pg-boss, and re-registered whenever the API emits job_schedule.updated.
  // T-DG4-BE-R2: the job's metadata gives each handler the attempt it is on (retryCount of retryLimit), so a handler
  // that records a final failure (kpi.recalculate) needs no read of pg-boss's own tables.
  const handlers = options.handlers ?? DOMAIN_HANDLERS;
  for (const h of handlers) {
    await work(h.queue, async (job, attempt) => {
      const outcome = await h.handle(db, job.data, job.id, attempt);
      log.info({ queue: h.queue, jobId: job.id, attempt, outcome }, "job handled");
      return { outcome };
    });
  }
  // T-DG5-BE-I (ADR-0043 §5): the retry dispatcher. The API moved the failure to `retrying` and wrote the
  // automation_failure.retry_requested event in one transaction; after that COMMIT the relay delivers it here. A rule
  // execution is resumed (completed actions are skipped by their keys); a job is re-sent to its original queue with its
  // original data under a deterministic job id (a replayed dispatch sends nothing new), and the handler's own runOnce
  // ledger skips work already done. A stale message (the entry moved on, or a later retry exists) does nothing.
  await work(FAILURE_RETRY_QUEUE, async (job, attempt) => {
    const request = automationFailureRetryRequestedV1.parse(outboxEnvelope.parse(job.data).payload);
    const failure = await db
      .selectFrom("operational_failure")
      .selectAll()
      .where("id", "=", request.failureId)
      .executeTakeFirst();
    let outcome: string;
    if (failure === undefined || failure.status !== "retrying" || failure.retry_count !== request.retryCount)
      outcome = "stale";
    else if (failure.source === "rule_execution" && failure.automation_execution_id !== null)
      outcome = (await resumeExecution(db, failure.automation_execution_id, job.id, attempt)).outcome;
    else {
      const sent = await boss.send(failure.queue_name, failure.job_data as object, {
        id: failureRetryJobId(failure.id, failure.retry_count),
      });
      outcome = sent === null ? "already_sent" : "sent";
    }
    log.info({ queue: FAILURE_RETRY_QUEUE, jobId: job.id, failureId: request.failureId, outcome }, "job handled");
    return { outcome };
  });
  const handledQueues: ReadonlySet<string> = new Set(handlers.map((h) => h.queue));
  log.info({ ...(await syncSchedules(db, boss, handledQueues)) }, "job schedules registered");
  // T-DG5-BE-I2 (ADR-0043 §6): "run now". The API wrote job.run_requested in the transaction of its audit event; after
  // that COMMIT the relay delivers it here, and the schedule's own job data is sent to its queue under job id = the
  // event id (a replayed dispatch sends nothing new). The run is then recorded like a scheduled one (job_run above).
  await work(RUN_NOW_QUEUE, async (job) => {
    const result = await dispatchRunNow(db, boss, handledQueues, job.data);
    log.info(
      { queue: RUN_NOW_QUEUE, jobId: job.id, outcome: result.outcome, code: result.code, runJobId: result.jobId },
      "job handled",
    );
    return result;
  });
  await boss.work(QUEUES.jobScheduleUpdated, { batchSize: 1, pollingIntervalSeconds }, async ([job]) => {
    const result = await handleJobScheduleUpdated(db, boss, handledQueues, job!.data);
    log.info({ queue: QUEUES.jobScheduleUpdated, jobId: job!.id, ...result }, "job schedules re-registered");
    return result;
  });

  let stopped = false;
  let running: Promise<void> = Promise.resolve();
  const interval = options.pollIntervalMs ?? OUTBOX_RELAY.pollIntervalMs;
  const tick = async () => {
    try {
      const r = await relayOnce(db, boss);
      if (r.published > 0 || r.failed > 0) log.info({ ...r }, "outbox relay");
    } catch (err) {
      log.error({ err: err instanceof Error ? err.message : String(err) }, "outbox relay failed");
    }
  };
  const loop = async () => {
    while (!stopped) {
      running = tick();
      await running;
      await new Promise((r) => setTimeout(r, interval));
    }
  };
  void loop();

  return {
    async stop() {
      stopped = true;
      await running;
      await boss.offWork(QUEUES.transformationCreated);
      await boss.offWork(QUEUES.purge);
      await boss.offWork(QUEUES.jobScheduleUpdated);
      for (const h of handlers) await boss.offWork(h.queue);
      await boss.offWork(FAILURE_RETRY_QUEUE);
      await boss.offWork(RUN_NOW_QUEUE);
    },
  };
}
