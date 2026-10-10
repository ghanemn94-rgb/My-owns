// Worker runtime (ADR-0008): the outbox relay loop, the pg-boss handlers and the maintenance schedule.
// A handler that throws is retried by pg-boss per the queue policy and lands in `ops.failed` when retries run out.
import type { Db } from "@mth/db";
import type PgBoss from "pg-boss";
import { DOMAIN_HANDLERS, handleTransformationCreated, purgeExpired, type JobHandler } from "./handlers/index.ts";
import type { JobAttempt } from "./handlers/spec.ts";
import { ensureQueues, OUTBOX_RELAY, QUEUES, schedulePurge, type QueuePolicyOverrides } from "./queues/index.ts";
import { relayOnce } from "./relay.ts";
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

  await boss.work(QUEUES.transformationCreated, { batchSize: 1, pollingIntervalSeconds }, async ([job]) => {
    const outcome = await handleTransformationCreated(db, job!.data, job!.id);
    log.info({ queue: QUEUES.transformationCreated, jobId: job!.id, outcome }, "job handled");
    return { outcome };
  });
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
    await boss.work(h.queue, { batchSize: 1, pollingIntervalSeconds, includeMetadata: true }, async ([job]) => {
      const attempt: JobAttempt = { retryCount: job!.retryCount, retryLimit: job!.retryLimit };
      const outcome = await h.handle(db, job!.data, job!.id, attempt);
      log.info({ queue: h.queue, jobId: job!.id, attempt, outcome }, "job handled");
      return { outcome };
    });
  }
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
    },
  };
}
