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
      throw err;
    }
    await settleRetriedJob(db, ref).catch((e: unknown) =>
      log.error({ queue, jobId: job.id, err: e instanceof Error ? e.message : String(e) }, "failure settle failed"),
    );
    return result;
  };

  await boss.work(
    QUEUES.transformationCreated,
    { batchSize: 1, pollingIntervalSeconds, includeMetadata: true },
    async ([job]) =>
      captured(QUEUES.transformationCreated, job!, async () => {
        const outcome = await handleTransformationCreated(db, job!.data, job!.id);
        log.info({ queue: QUEUES.transformationCreated, jobId: job!.id, outcome }, "job handled");
        return { outcome };
      }),
  );
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
    await boss.work(h.queue, { batchSize: 1, pollingIntervalSeconds, includeMetadata: true }, async ([job]) =>
      captured(h.queue, job!, async (attempt) => {
        const outcome = await h.handle(db, job!.data, job!.id, attempt);
        log.info({ queue: h.queue, jobId: job!.id, attempt, outcome }, "job handled");
        return { outcome };
      }),
    );
  }
  // T-DG5-BE-I (ADR-0043 §5): the retry dispatcher. The API moved the failure to `retrying` and wrote the
  // automation_failure.retry_requested event in one transaction; after that COMMIT the relay delivers it here. A rule
  // execution is resumed (completed actions are skipped by their keys); a job is re-sent to its original queue with its
  // original data under a deterministic job id (a replayed dispatch sends nothing new), and the handler's own runOnce
  // ledger skips work already done. A stale message (the entry moved on, or a later retry exists) does nothing.
  await boss.work(FAILURE_RETRY_QUEUE, { batchSize: 1, pollingIntervalSeconds, includeMetadata: true }, async ([job]) =>
    captured(FAILURE_RETRY_QUEUE, job!, async (attempt) => {
      const request = automationFailureRetryRequestedV1.parse(outboxEnvelope.parse(job!.data).payload);
      const failure = await db
        .selectFrom("operational_failure")
        .selectAll()
        .where("id", "=", request.failureId)
        .executeTakeFirst();
      let outcome: string;
      if (failure === undefined || failure.status !== "retrying" || failure.retry_count !== request.retryCount)
        outcome = "stale";
      else if (failure.source === "rule_execution" && failure.automation_execution_id !== null)
        outcome = (await resumeExecution(db, failure.automation_execution_id, job!.id, attempt)).outcome;
      else {
        const sent = await boss.send(failure.queue_name, failure.job_data as object, {
          id: failureRetryJobId(failure.id, failure.retry_count),
        });
        outcome = sent === null ? "already_sent" : "sent";
      }
      log.info({ queue: FAILURE_RETRY_QUEUE, jobId: job!.id, failureId: request.failureId, outcome }, "job handled");
      return { outcome };
    }),
  );
  const handledQueues: ReadonlySet<string> = new Set(handlers.map((h) => h.queue));
  log.info({ ...(await syncSchedules(db, boss, handledQueues)) }, "job schedules registered");
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
    },
  };
}
