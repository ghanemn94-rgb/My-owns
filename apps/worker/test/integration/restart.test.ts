// REQ-S16-005 (A13): "killing the worker mid-job and restarting it completes the job exactly once with no duplicate
// notification" (ADR-0025 §3; p4-work-split §I+C.1; T-DG4-BE-A). Against a real PostgreSQL with pg-boss:
//  1. a REAL worker process (test/restart-child.ts, the production startWorker with a probe handler built only from the
//     kit: runOnce + createWorkItemOnce) takes the job and stops inside its transaction after writing the task and the
//     reminder, before COMMIT;
//  2. the process is killed with SIGKILL: nothing it wrote is committed (no task, no reminder, no ledger row);
//  3. a restarted worker gets the job again (pg-boss expires the dead worker's active job and retries it) and completes
//     it: exactly one task, one reminder, one processed_message row and one audit event of each;
//  4. a redelivery of the same job (same idempotency key) is a no-op.
// All data is SYNTHETIC; no job decides a business approval.
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import type PgBoss from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createBoss, ensureQueues, QUEUES } from "../../src/queues/index.ts";
import { startWorker, type RunningWorker } from "../../src/worker.ts";
import { PROBE_CONSUMER, PROBE_QUEUE, probeHandler } from "../restart-probe.ts";
import { bossFor, seedTransformationWithOutbox, waitFor, workerEnv, type WorkerEnv } from "../support.ts";

let env: WorkerEnv;
let boss: PgBoss;
beforeAll(async () => {
  env = await workerEnv();
  boss = bossFor(env.appUrl);
  boss.on("error", () => undefined);
  await boss.start();
  await ensureQueues(boss);
  // The probe queue: an active job expires after 2 s (a dead worker never completes it), then it is retried.
  const policy = {
    policy: "standard" as const,
    expireInSeconds: 2,
    retryLimit: 3,
    retryDelay: 1,
    deadLetter: QUEUES.failed,
  };
  await boss.createQueue(PROBE_QUEUE, { name: PROBE_QUEUE, ...policy });
}, 60_000);
afterAll(async () => {
  await boss.stop({ graceful: false, wait: true, timeout: 5000 });
  await env.close();
});

const CHILD = fileURLToPath(new URL("../restart-child.ts", import.meta.url));

function startChild(): {
  child: ChildProcess;
  inJob: Promise<void>;
  exited: Promise<number | null>;
  output: () => string;
} {
  const child = spawn(process.execPath, ["--conditions=@mth/source", CHILD], {
    env: { ...process.env, CHILD_DB_URL: env.appUrl },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  const inJob = new Promise<void>((resolve, reject) => {
    child.stdout!.on("data", (b: Buffer) => {
      out += b.toString();
      if (out.includes("IN_JOB")) resolve();
    });
    child.stderr!.on("data", (b: Buffer) => {
      out += b.toString();
    });
    child.once("exit", () => reject(new Error(`child exited before IN_JOB: ${out}`)));
  });
  inJob.catch(() => undefined);
  const exited = new Promise<number | null>((resolve) => child.once("exit", (code) => resolve(code)));
  return { child, inJob, exited, output: () => out };
}

const count = async (table: "work_item" | "inbox_notification", key: string) =>
  Number(
    (
      await env.db
        .selectFrom(table)
        .select((eb) => eb.fn.countAll<string>().as("n"))
        .where("dedupe_key", "=", key)
        .executeTakeFirstOrThrow()
    ).n,
  );
const ledger = async (key: string) =>
  (
    await env.db
      .selectFrom("processed_message")
      .selectAll()
      .where("consumer", "=", PROBE_CONSUMER)
      .where("idempotency_key", "=", key)
      .execute()
  ).length;
const jobState = async (id: string) =>
  (await env.owner.query("SELECT state, retry_count FROM pgboss.job WHERE id = $1", [id])).rows[0] as
    | { state: string; retry_count: number }
    | undefined;

describe("kill the worker mid-job and restart it (REQ-S16-005, A13)", () => {
  it("completes the job exactly once, with one task and one reminder", { timeout: 90_000 }, async () => {
    const seed = await seedTransformationWithOutbox(env.db);
    const org = (
      await env.db
        .selectFrom("app_user")
        .select("organization_id")
        .where("id", "=", seed.userId)
        .executeTakeFirstOrThrow()
    ).organization_id;
    const key = `kpi.period_open:${seed.transformationId}:2026-10:${seed.userId}`;
    const jobId = (await boss.send(PROBE_QUEUE, { key, organizationId: org, ownerUserId: seed.userId }))!;

    // 1. A real worker process takes the job and stops inside its transaction, effects written, not committed.
    const run = startChild();
    await run.inJob;
    expect((await jobState(jobId))?.state).toBe("active");
    expect([await count("work_item", key), await count("inbox_notification", key), await ledger(key)]).toEqual([
      0, 0, 0,
    ]);

    // 2. Kill it (no graceful shutdown, no COMMIT).
    run.child.kill("SIGKILL");
    expect(await run.exited).toBeNull();
    await waitFor(async () => {
      const r = await env.owner.query(
        "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND application_name LIKE 'restart-child%'",
      );
      return r.rows[0].n === 0;
    });
    expect([await count("work_item", key), await count("inbox_notification", key), await ledger(key)]).toEqual([
      0, 0, 0,
    ]);

    // 3. Restart: a worker with supervision on (pg-boss expires the dead worker's job and retries it).
    const restartedBoss = createBoss(env.appUrl, {
      schedule: false,
      supervise: true,
      superviseIntervalSeconds: 1,
      monitorIntervalSeconds: 1,
      applicationName: "restart-parent-boss",
    });
    restartedBoss.on("error", () => undefined);
    await restartedBoss.start();
    let worker: RunningWorker | null = null;
    try {
      worker = await startWorker({
        db: env.db,
        boss: restartedBoss,
        timeZone: "Asia/Riyadh",
        jobPollingIntervalSeconds: 0.5,
        pollIntervalMs: 200,
        log: { info: () => undefined, error: () => undefined },
        handlers: [probeHandler()],
      });
      await waitFor(async () => (await jobState(jobId))?.state === "completed", 60_000, 250);
      expect((await jobState(jobId))!.retry_count).toBeGreaterThanOrEqual(1);
      expect([await count("work_item", key), await count("inbox_notification", key), await ledger(key)]).toEqual([
        1, 1, 1,
      ]);
      const audit = await env.db
        .selectFrom("audit_event as a")
        .select(["a.action", "a.actor_type", "a.source"])
        .where((eb) =>
          eb.or([
            eb("a.record_id", "in", eb.selectFrom("work_item").select("id").where("dedupe_key", "=", key)),
            eb("a.record_id", "in", eb.selectFrom("inbox_notification").select("id").where("dedupe_key", "=", key)),
          ]),
        )
        .orderBy("a.seq")
        .execute();
      expect(audit).toEqual([
        { action: "work_item.create", actor_type: "service", source: "worker" },
        { action: "inbox_notification.create", actor_type: "service", source: "worker" },
      ]);

      // 4. A redelivery of the same job is a no-op (the ledger row and the unique keys).
      const again = (await restartedBoss.send(PROBE_QUEUE, { key, organizationId: org, ownerUserId: seed.userId }))!;
      await waitFor(async () => (await jobState(again))?.state === "completed", 30_000, 250);
      const output = (await env.owner.query("SELECT output FROM pgboss.job WHERE id = $1", [again])).rows[0].output;
      expect(output).toEqual({ outcome: "duplicate" });
      expect([await count("work_item", key), await count("inbox_notification", key), await ledger(key)]).toEqual([
        1, 1, 1,
      ]);
    } finally {
      await worker?.stop();
      await restartedBoss.stop({ graceful: false, wait: true, timeout: 5000 });
    }
  });
});
