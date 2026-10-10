// The production worker passes each job handler the attempt it is on (T-DG4-BE-R2, item 4 of its repair scope; the
// KBE-R1 handback): worker.ts reads `retryCount` and `retryLimit` from the job's own pg-boss metadata and hands them to
// `JobHandler.handle`, so no handler reads pg-boss's tables. Proved against a real PostgreSQL with pg-boss: a handler
// that fails its first attempt and succeeds on the retry sees {0 of 1} and then {1 of 1}, and `isFinalAttempt` agrees
// with pg-boss's own retry decision. KBE-R1's final-retry tests (kpi-recalculate.test.ts) cover the kpi handler's use of
// it. All data is SYNTHETIC; no job decides a business approval or touches the engineering gates DG0-DG7.
import type PgBoss from "pg-boss";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isFinalAttempt, RECALCULATE_QUEUE } from "../../src/handlers/kpi.ts";
import type { JobAttempt, JobHandler } from "../../src/handlers/spec.ts";
import { ensureQueues } from "../../src/queues/index.ts";
import { startWorker, type RunningWorker } from "../../src/worker.ts";
import { bossFor, waitFor, workerEnv, type WorkerEnv } from "../support.ts";

let env: WorkerEnv;
let boss: PgBoss;
beforeAll(async () => {
  env = await workerEnv();
  boss = bossFor(env.appUrl);
  boss.on("error", () => undefined);
  await boss.start();
  await ensureQueues(boss);
}, 60_000);
afterAll(async () => {
  await boss.stop({ graceful: false, wait: true, timeout: 5000 });
  await env.close();
});

const quiet = { info: () => undefined, error: () => undefined };

describe("worker.ts passes the job's attempt to its handler (T-DG4-BE-R2)", () => {
  it(
    "first attempt {retryCount 0, retryLimit 1} fails and is retried; the retry sees {1, 1}, the final attempt",
    { timeout: 60_000 },
    async () => {
      const policy = { retryLimit: 1, retryDelay: 0, retryBackoff: false };
      await ensureQueues(boss, policy);
      const marker = randomUUID();
      const seen: { jobId: string; attempt: JobAttempt | undefined }[] = [];
      // A synthetic handler on a registered queue (the queue's policy applies); it touches no table.
      const probe: JobHandler = {
        queue: RECALCULATE_QUEUE,
        handle: async (_db, data, jobId, attempt) => {
          if ((data as { marker?: string }).marker !== marker) return "ignored";
          seen.push({ jobId, attempt });
          if (seen.length === 1) throw new Error("synthetic first-attempt fault");
          return "done";
        },
      };
      let worker: RunningWorker | null = null;
      try {
        worker = await startWorker({
          db: env.db,
          boss,
          timeZone: "Asia/Riyadh",
          log: quiet,
          pollIntervalMs: 200,
          jobPollingIntervalSeconds: 0.5,
          handlers: [probe],
          queuePolicy: policy,
        });
        const jobId = await boss.send(RECALCULATE_QUEUE, { marker }, policy);
        expect(jobId).toBeTruthy();
        await waitFor(async () => (seen.length >= 2 ? true : null), 30_000, 100);
        expect(seen).toEqual([
          { jobId, attempt: { retryCount: 0, retryLimit: 1 } },
          { jobId, attempt: { retryCount: 1, retryLimit: 1 } },
        ]);
        expect(seen.map((s) => isFinalAttempt(s.attempt!))).toEqual([false, true]);
        // pg-boss agrees: the job completed after exactly one retry.
        const job = await waitFor(
          async () => {
            const r = await env.owner.query("SELECT state, retry_count, retry_limit FROM pgboss.job WHERE id = $1", [
              jobId,
            ]);
            return r.rows[0]?.state === "completed" ? r.rows[0] : null;
          },
          30_000,
          100,
        );
        expect([job.retry_count, job.retry_limit]).toEqual([1, 1]);
      } finally {
        await worker?.stop();
        await ensureQueues(boss);
      }
    },
  );
});
