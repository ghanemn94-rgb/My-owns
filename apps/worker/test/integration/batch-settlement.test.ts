// T-DG6-BE-X9 (D-203 O-1): the worker fetches a bounded batch per poll and runs it with bounded concurrency, and every
// job of a batch keeps the retry, backoff and dead-letter of the batch-of-one worker. Proved against a real PostgreSQL
// with pg-boss:
//  - one job of a full batch fails its first attempt: only THAT job is retried (retry_count 1); its seven neighbours
//    complete once, on their first attempt, with their own output; the failed attempt's error is the job's output;
//  - a job that fails on its LAST attempt reaches state `failed` alone (its neighbours complete);
//  - at most `jobConcurrency` jobs of one queue run at the same time, and a backlog larger than the batch is drained
//    without waiting the polling interval between full batches (polling interval 30 s here: 40 jobs finish long before
//    a second poll could start).
// All data is SYNTHETIC; no job decides a business approval or touches the engineering gates DG0-DG7.
import type PgBoss from "pg-boss";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RECALCULATE_QUEUE } from "../../src/handlers/kpi.ts";
import type { JobHandler } from "../../src/handlers/spec.ts";
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

async function jobRows(ids: readonly string[]) {
  const r = await env.owner.query<{ id: string; state: string; retry_count: number; output: unknown }>(
    "SELECT id, state::text AS state, retry_count, output FROM pgboss.job WHERE id = ANY($1::uuid[])",
    [ids],
  );
  return new Map(r.rows.map((row) => [row.id, row]));
}

describe("bounded batches with per-job settlement (D-203 O-1)", () => {
  it("a failing job of a full batch is retried alone; its neighbours complete once", { timeout: 90_000 }, async () => {
    const policy = { retryLimit: 1, retryDelay: 0, retryBackoff: false };
    await ensureQueues(boss, policy);
    const marker = randomUUID();
    const runs = new Map<number, number>();
    const probe: JobHandler = {
      queue: RECALCULATE_QUEUE,
      handle: async (_db, data) => {
        const d = data as { marker?: string; n?: number; fail?: "once" | "always" };
        if (d.marker !== marker) return "ignored";
        runs.set(d.n!, (runs.get(d.n!) ?? 0) + 1);
        if (d.fail === "always" || (d.fail === "once" && runs.get(d.n!) === 1))
          throw new Error(`synthetic fault ${d.n}`);
        return `done ${d.n}`;
      },
    };
    // Queued before the worker starts, so the first fetch takes all 8 in ONE batch.
    const ids: string[] = [];
    for (let n = 0; n < 8; n += 1)
      ids.push(
        (await boss.send(
          RECALCULATE_QUEUE,
          { marker, n, ...(n === 2 ? { fail: "once" } : n === 5 ? { fail: "always" } : {}) },
          policy,
        ))!,
      );
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
        jobBatchSize: 8,
        jobConcurrency: 4,
      });
      const rows = await waitFor(
        async () => {
          const m = await jobRows(ids);
          return [...m.values()].every((r) => r.state === "completed" || r.state === "failed") && m.size === 8
            ? m
            : null;
        },
        60_000,
        100,
      );
      const byN = ids.map((id) => rows.get(id)!);
      // Six neighbours: one run each, completed on the first attempt with their own output.
      for (const n of [0, 1, 3, 4, 6, 7]) {
        expect(runs.get(n)).toBe(1);
        expect(byN[n]).toMatchObject({ state: "completed", retry_count: 0, output: { outcome: `done ${n}` } });
      }
      // The job that failed once: retried alone, then completed.
      expect(runs.get(2)).toBe(2);
      expect(byN[2]).toMatchObject({ state: "completed", retry_count: 1, output: { outcome: "done 2" } });
      // The job that always fails: both attempts, then `failed`, with its own error as the output.
      expect(runs.get(5)).toBe(2);
      expect(byN[5]).toMatchObject({ state: "failed", retry_count: 1 });
      expect(JSON.stringify(byN[5]!.output)).toContain("synthetic fault 5");
    } finally {
      await worker?.stop();
      await ensureQueues(boss);
    }
  });

  it("at most jobConcurrency run at once; full batches poll again without the polling interval", async () => {
    const marker = randomUUID();
    let running = 0;
    let peak = 0;
    let handled = 0;
    const probe: JobHandler = {
      queue: RECALCULATE_QUEUE,
      handle: async (_db, data) => {
        if ((data as { marker?: string }).marker !== marker) return "ignored";
        running += 1;
        peak = Math.max(peak, running);
        await new Promise((r) => setTimeout(r, 20));
        running -= 1;
        handled += 1;
        return "done";
      },
    };
    const N = 40;
    for (let n = 0; n < N; n += 1) await boss.send(RECALCULATE_QUEUE, { marker, n });
    let worker: RunningWorker | null = null;
    try {
      worker = await startWorker({
        db: env.db,
        boss,
        timeZone: "Asia/Riyadh",
        log: quiet,
        pollIntervalMs: 200,
        // A 30 s interval: five full batches of 8 would need 2 minutes if each fetch waited for it.
        jobPollingIntervalSeconds: 30,
        handlers: [probe],
        jobBatchSize: 8,
        jobConcurrency: 3,
      });
      await waitFor(async () => (handled >= N ? true : null), 25_000, 50);
      expect(handled).toBe(N);
      expect(peak).toBeLessThanOrEqual(3);
      expect(peak).toBeGreaterThan(1);
    } finally {
      await worker?.stop();
    }
  }, 60_000);
});
