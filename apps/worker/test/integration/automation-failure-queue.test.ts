// REQ-S12-020 (A13): "killing the worker mid-job and restarting completes the job once; after the retry limit it lands
// in the failure queue" (ADR-0043 §5; p5-work-split §D.3; T-DG5-BE-I), against a real PostgreSQL with pg-boss and the
// production startWorker (its failure-capture lines):
//  1. a real worker process is SIGKILLed inside a job's transaction; a restarted worker completes the job exactly once,
//     and nothing enters the failure queue (the job did not fail for good);
//  2. a job that fails every attempt is retried under the unchanged RETRY_POLICY limit (5 retries, 6 attempts), then
//     reaches ops.failed as in DG4 AND the failure queue, with its idempotency key, its original data and the internal
//     job.failed event;
//  3. the retry of that entry (as the API writes it: `retrying` + the retry_requested event in one transaction) is
//     dispatched by the worker after COMMIT: the original data is re-sent once to the original queue under a
//     deterministic job id, the handler succeeds, the entry is resolved; a replayed request sends nothing more.
// All data is SYNTHETIC; no job decides a business approval.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { insertAuditEvent, sql } from "@mth/db";
import type PgBoss from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { JobHandler } from "../../src/handlers/spec.ts";
import { failureRetryJobId, FAILURE_RETRY_QUEUE } from "../../src/kit.ts";
import { createBoss, ensureQueues, QUEUES, RETRY_POLICY } from "../../src/queues/index.ts";
import { startWorker, type RunningWorker } from "../../src/worker.ts";
import { PROBE_QUEUE, probeHandler } from "../restart-probe.ts";
import { bossFor, seedTransformationWithOutbox, waitFor, workerEnv, type WorkerEnv } from "../support.ts";

let env: WorkerEnv;
let boss: PgBoss;
const FAULT_QUEUE = "test.failure_probe";
const quiet = { info: () => undefined, error: () => undefined };

beforeAll(async () => {
  env = await workerEnv();
  boss = bossFor(env.appUrl);
  boss.on("error", () => undefined);
  await boss.start();
  await ensureQueues(boss);
  const base = { policy: "standard" as const, deadLetter: QUEUES.failed };
  await boss.createQueue(PROBE_QUEUE, { name: PROBE_QUEUE, ...base, expireInSeconds: 2, retryLimit: 3, retryDelay: 1 });
  // The standard retry LIMIT (5 retries); only the delay is shortened for the test (no backoff).
  await boss.createQueue(FAULT_QUEUE, {
    name: FAULT_QUEUE,
    ...base,
    retryLimit: RETRY_POLICY.retryLimit,
    retryDelay: 0,
    retryBackoff: false,
  });
}, 60_000);
afterAll(async () => {
  await boss.stop({ graceful: false, wait: true, timeout: 5000 });
  await env.close();
});

const jobState = async (id: string) =>
  (await env.owner.query("SELECT state, retry_count FROM pgboss.job WHERE id = $1", [id])).rows[0] as
    | { state: string; retry_count: number }
    | undefined;
const failuresOfQueue = (queue: string) =>
  env.db.selectFrom("operational_failure").selectAll().where("queue_name", "=", queue).orderBy("created_at").execute();

describe("REQ-S12-020: kill the worker mid-job and restart it", () => {
  it("completes the job once; nothing enters the failure queue", { timeout: 90_000 }, async () => {
    expect(RETRY_POLICY.retryLimit).toBe(5);
    const seed = await seedTransformationWithOutbox(env.db);
    const org = (
      await env.db
        .selectFrom("app_user")
        .select("organization_id")
        .where("id", "=", seed.userId)
        .executeTakeFirstOrThrow()
    ).organization_id;
    const key = `automation-kill:${seed.transformationId}`;
    const jobId = (await boss.send(PROBE_QUEUE, { key, organizationId: org, ownerUserId: seed.userId }))!;
    const child = spawn(
      process.execPath,
      ["--conditions=@mth/source", fileURLToPath(new URL("../restart-child.ts", import.meta.url))],
      { env: { ...process.env, CHILD_DB_URL: env.appUrl }, stdio: ["ignore", "pipe", "pipe"] },
    );
    let out = "";
    const exited = new Promise<number | null>((resolve) => child.once("exit", (code) => resolve(code)));
    await new Promise<void>((resolve, reject) => {
      child.stdout.on("data", (b: Buffer) => {
        out += b.toString();
        if (out.includes("IN_JOB")) resolve();
      });
      child.stderr.on("data", (b: Buffer) => (out += b.toString()));
      child.once("exit", () => reject(new Error(`child exited before IN_JOB: ${out}`)));
    });
    child.kill("SIGKILL");
    expect(await exited).toBeNull();
    const restarted = createBoss(env.appUrl, {
      schedule: false,
      supervise: true,
      superviseIntervalSeconds: 1,
      monitorIntervalSeconds: 1,
      applicationName: "failure-queue-restart-boss",
    });
    restarted.on("error", () => undefined);
    await restarted.start();
    let worker: RunningWorker | null = null;
    try {
      worker = await startWorker({
        db: env.db,
        boss: restarted,
        timeZone: "Asia/Riyadh",
        jobPollingIntervalSeconds: 0.5,
        pollIntervalMs: 200,
        log: quiet,
        handlers: [probeHandler()],
      });
      await waitFor(async () => (await jobState(jobId))?.state === "completed", 60_000, 250);
      const items = await env.db.selectFrom("work_item").select("id").where("dedupe_key", "=", key).execute();
      expect(items).toHaveLength(1);
      expect(await failuresOfQueue(PROBE_QUEUE)).toEqual([]);
    } finally {
      await worker?.stop();
      await restarted.stop({ graceful: false, wait: true, timeout: 5000 });
    }
  });
});

describe("REQ-S12-020: after the retry limit the job is in the failure queue; a retry completes it once", () => {
  it(
    "captures the last attempt, keeps ops.failed, and resolves through the retry dispatcher",
    { timeout: 90_000 },
    async () => {
      const seed = await seedTransformationWithOutbox(env.db);
      const org = (
        await env.db
          .selectFrom("app_user")
          .select("organization_id")
          .where("id", "=", seed.userId)
          .executeTakeFirstOrThrow()
      ).organization_id;
      const envelope = {
        outboxEventId: randomUUID(),
        eventType: "test.synthetic",
        schemaVersion: 1,
        idempotencyKey: `test.synthetic:${randomUUID()}`,
        organizationId: org,
        payload: { synthetic: true },
      };
      let failing = true;
      const calls: { jobId: string; key: string }[] = [];
      const fault: JobHandler = {
        queue: FAULT_QUEUE,
        handle: async (_db, data, jobId) => {
          const key = (data as { idempotencyKey: string }).idempotencyKey;
          calls.push({ jobId, key });
          if (failing) throw new Error("synthetic permanent fault");
          return "done";
        },
      };
      let worker: RunningWorker | null = null;
      try {
        worker = await startWorker({
          db: env.db,
          boss,
          timeZone: "Asia/Riyadh",
          jobPollingIntervalSeconds: 0.5,
          pollIntervalMs: 200,
          log: quiet,
          handlers: [fault],
          queuePolicy: { retryDelay: 0, retryBackoff: false },
        });
        const jobId = (await boss.send(FAULT_QUEUE, envelope))!;
        await waitFor(async () => (await jobState(jobId))?.state === "failed", 60_000, 250);
        expect(await jobState(jobId)).toEqual({ state: "failed", retry_count: 5 });
        expect(calls.filter((c) => c.jobId === jobId)).toHaveLength(6);
        // DG4 unchanged: the dead letter still receives it.
        await waitFor(async () => {
          const r = await env.owner.query(
            "SELECT count(*)::int AS n FROM pgboss.job WHERE name = $1 AND data->>'idempotencyKey' = $2",
            [QUEUES.failed, envelope.idempotencyKey],
          );
          return r.rows[0].n === 1;
        });
        // The failure queue: one open entry with its idempotency key and its original data.
        const [entry, ...more] = await waitFor(async () => {
          const rows = await failuresOfQueue(FAULT_QUEUE);
          return rows.length > 0 ? rows : null;
        });
        expect(more).toEqual([]);
        expect(entry).toMatchObject({
          source: "job",
          status: "open",
          organization_id: org,
          job_id: jobId,
          idempotency_key: envelope.idempotencyKey,
          job_data: envelope,
          error_code: "automation.retries_exhausted",
          error_message: "synthetic permanent fault",
          attempts: 6,
        });
        const jobFailed = await env.db
          .selectFrom("outbox_event")
          .select(["event_type", "payload"])
          .where("aggregate_id", "=", entry!.id)
          .execute();
        expect(jobFailed).toEqual([
          {
            event_type: "job.failed",
            payload: { queueName: FAULT_QUEUE, jobScheduleCode: null, failureId: entry!.id },
          },
        ]);

        // The retry, as the API writes it (one transaction: `retrying`, its audit event, the retry_requested event).
        failing = false;
        const requestRetry = async () =>
          env.db.transaction().execute(async (tx) => {
            await insertAuditEvent(
              tx,
              { actorType: "user", actorUserId: seed.userId, source: "api", requestId: "test:retry" },
              {
                action: "operational_failure.retry",
                recordType: "operational_failure",
                recordId: entry!.id,
                organizationId: org,
                priorVersion: 1,
                newVersion: 2,
              },
            );
            await tx
              .updateTable("operational_failure")
              .set({
                status: "retrying",
                retry_count: 1,
                last_retry_by: seed.userId,
                last_retry_at: sql<Date>`now()`,
                version: 2,
                updated_by: seed.userId,
              })
              .where("id", "=", entry!.id)
              .execute();
          });
        const retryEvent = async (n: number) =>
          env.db
            .insertInto("outbox_event")
            .values({
              id: randomUUID(),
              organization_id: org,
              aggregate_type: "operational_failure",
              aggregate_id: entry!.id,
              event_type: "automation_failure.retry_requested",
              schema_version: 1,
              payload: JSON.stringify({ failureId: entry!.id, retryCount: 1 }),
              idempotency_key: `automation_failure.retry_requested:${entry!.id}:1:${n}`,
            })
            .execute();
        await requestRetry();
        await retryEvent(1);
        const retryJob = failureRetryJobId(entry!.id, 1);
        await waitFor(async () => (await jobState(retryJob))?.state === "completed", 60_000, 250);
        await waitFor(async () => {
          const r = await env.db
            .selectFrom("operational_failure")
            .select("status")
            .where("id", "=", entry!.id)
            .executeTakeFirstOrThrow();
          return r.status === "resolved";
        });
        expect(calls.filter((c) => c.jobId === retryJob)).toEqual([{ jobId: retryJob, key: envelope.idempotencyKey }]);
        expect(
          (
            await env.db
              .selectFrom("audit_event")
              .select("action")
              .where("record_id", "=", entry!.id)
              .orderBy("seq")
              .execute()
          ).map((a) => a.action),
        ).toEqual(["operational_failure.create", "operational_failure.retry", "operational_failure.resolve"]);

        // A replayed request (x2) is stale: nothing is re-sent, the handler is not called again.
        await retryEvent(2);
        await retryEvent(3);
        await waitFor(async () => {
          const r = await env.owner.query(
            "SELECT count(*)::int AS n FROM pgboss.job WHERE name = $1 AND state = 'completed'",
            [FAILURE_RETRY_QUEUE],
          );
          return r.rows[0].n === 3;
        }, 30_000);
        expect(calls.filter((c) => c.key === envelope.idempotencyKey)).toHaveLength(7);
        expect((await failuresOfQueue(FAULT_QUEUE)).map((f) => f.status)).toEqual(["resolved"]);
      } finally {
        await worker?.stop();
      }
    },
  );
});
