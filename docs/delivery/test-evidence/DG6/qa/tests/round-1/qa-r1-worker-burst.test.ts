// qa-verifier DG6 clean re-gate round 1 (T-DG6-REV-QA-RG-R1): independent worker-burst probe for D-203 O-1 (bounded
// batches, bounded concurrency) and REQ-S20-013 (no duplicate execution). Kept outside the frozen candidate; to run it,
// copy it to apps/worker/test/integration/ in a DISPOSABLE clone and run the Vitest `integration` project under
// tests/qa/support/with-pg.sh. It measures, on a real PostgreSQL with pg-boss and the product's own startWorker:
//   (1) a burst of N jobs (each handler 25 ms) drained by ONE worker with the defaults (batch 8, concurrency 4) and by
//       ONE worker with batch 1 / concurrency 1, both with a 2 s job polling interval: the time to drain each, every job
//       handled exactly once, every row `completed` with retry_count 0;
//   (2) the same burst drained by TWO workers at once (defaults): every job handled exactly once (no duplicate
//       execution across workers), all `completed`.
// The figures are PROVISIONAL engineering measurements on a shared loaded sandbox host; the assertions are the
// no-duplicate and completion properties, plus "batched is faster than batch-of-one". SYNTHETIC data only; no job decides
// a business approval (G1-G6) or touches DG0-DG7.
import type PgBoss from "pg-boss";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RECALCULATE_QUEUE } from "../../src/handlers/kpi.ts";
import type { JobHandler } from "../../src/handlers/spec.ts";
import { ensureQueues } from "../../src/queues/index.ts";
import { JOB_THROUGHPUT_DEFAULTS, startWorker, type RunningWorker } from "../../src/worker.ts";
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
const N = 400;
const DEFAULTS = { jobBatchSize: JOB_THROUGHPUT_DEFAULTS.batchSize, jobConcurrency: JOB_THROUGHPUT_DEFAULTS.concurrency };

function probeHandler(marker: string, runs: Map<number, number>): JobHandler {
  return {
    queue: RECALCULATE_QUEUE,
    handle: async (_db, data) => {
      const d = data as { marker?: string; n?: number };
      if (d.marker !== marker) return "ignored";
      runs.set(d.n!, (runs.get(d.n!) ?? 0) + 1);
      await new Promise((r) => setTimeout(r, 25));
      return `done ${d.n}`;
    },
  };
}

async function burst(marker: string): Promise<string[]> {
  const ids: string[] = [];
  for (let n = 0; n < N; n += 1) ids.push((await boss.send(RECALCULATE_QUEUE, { marker, n }))!);
  return ids;
}

async function settled(ids: readonly string[]) {
  const r = await env.owner.query<{ state: string; retry_count: number; c: string }>(
    "SELECT state::text AS state, retry_count, count(*)::text AS c FROM pgboss.job WHERE id = ANY($1::uuid[]) GROUP BY 1, 2",
    [ids],
  );
  return r.rows.map((x) => `${x.state}/retry${x.retry_count}:${x.c}`).sort();
}

async function drain(workers: { jobBatchSize: number; jobConcurrency: number }[]) {
  const marker = randomUUID();
  const runs = new Map<number, number>();
  const ids = await burst(marker);
  const started: RunningWorker[] = [];
  const t0 = performance.now();
  try {
    for (const w of workers)
      started.push(
        await startWorker({
          db: env.db,
          boss,
          timeZone: "Asia/Riyadh",
          log: quiet,
          pollIntervalMs: 200,
          jobPollingIntervalSeconds: 2,
          handlers: [probeHandler(marker, runs)],
          ...w,
        }),
      );
    await waitFor(async () => ([...runs.keys()].length >= N ? true : null), 600_000, 50);
    const ms = performance.now() - t0;
    // Let in-flight settlements finish before reading the job rows.
    await waitFor(async () => ((await settled(ids)).join() === `completed/retry0:${N}` ? true : null), 60_000, 200);
    return { ms, runs, rows: await settled(ids) };
  } finally {
    for (const w of started) await w.stop();
  }
}

describe("qa-verifier R1 worker burst (D-203 O-1, REQ-S20-013)", () => {
  it("defaults vs batch-of-one: every job once, all completed; batching drains faster", { timeout: 900_000 }, async () => {
    expect(JOB_THROUGHPUT_DEFAULTS).toMatchObject({ batchSize: 8, concurrency: 4 });
    const batched = await drain([DEFAULTS]);
    const single = await drain([{ jobBatchSize: 1, jobConcurrency: 1 }]);
    for (const r of [batched, single]) {
      expect(r.runs.size).toBe(N);
      expect([...r.runs.values()].every((v) => v === 1)).toBe(true);
      expect(r.rows).toEqual([`completed/retry0:${N}`]);
    }
    console.log(
      `QA-R1 worker burst: N=${N} handler 25 ms; batch 8 x 4 drained in ${batched.ms.toFixed(0)} ms ` +
        `(${((N / batched.ms) * 1000).toFixed(1)} jobs/s); batch 1 x 1 in ${single.ms.toFixed(0)} ms ` +
        `(${((N / single.ms) * 1000).toFixed(1)} jobs/s); load ${(await import("node:os")).loadavg().map((x) => x.toFixed(1)).join(" ")}`,
    );
    expect(batched.ms).toBeLessThan(single.ms);
  });

  it("two workers on one queue (defaults): every job handled exactly once, all completed", { timeout: 900_000 }, async () => {
    const r = await drain([DEFAULTS, DEFAULTS]);
    const dup = [...r.runs.entries()].filter(([, v]) => v !== 1);
    console.log(`QA-R1 worker burst, two workers: N=${N} drained in ${r.ms.toFixed(0)} ms; duplicates ${dup.length}`);
    expect(r.runs.size).toBe(N);
    expect(dup).toEqual([]);
    expect(r.rows).toEqual([`completed/retry0:${N}`]);
  });
});
