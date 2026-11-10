// qa-verifier DG6 round 5 (T-DG6-REV-QA-R5): independent probe, NOT part of the frozen candidate. Copied into a
// disposable clone as apps/api/test/integration/operations/zz-qa-dg6r5-concurrent-job-failure.test.ts and run on a
// disposable PostgreSQL (tests/qa/support/with-pg.sh npx vitest run --project integration <file>).
// Question (A13 "failed jobs remain recoverable", REQ-S20-013; REQ-S12-019 "when a connector or job fails ... create a
// visible operational exception"; D-203 worker batching with WORKER_JOB_CONCURRENCY 4): when several jobs of ONE queue
// fail on their last attempt at the same time (a common cause, e.g. a downstream outage), does every failure reach the
// failure queue (operational_failure) and the queue's operational exception (one occurrence each)?
// It calls the worker's own captureJobFailure (the function worker.ts runs after a job's last failed attempt)
// concurrently, N times, with distinct job ids and idempotency keys on the same queue, and counts:
//   - the operational_failure rows of the queue (expected N: one per failed job, each retryable);
//   - the occurrence_count of the queue's job_failed exception (expected N);
//   - the rejected captures (expected 0) and their messages.
// Every value is SYNTHETIC. Nothing approves anything (no G1-G6 business approval; unrelated to DG0-DG7).
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { captureJobFailure } from "../../../../worker/src/kit.ts";
import { seedWorld, startApi, type TestApi, type World } from "../../support/harness.ts";

let api: TestApi;
let w: World;
const tag = () => [...randomBytes(8)].map((b) => String.fromCharCode(97 + (b % 26))).join("");

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
});
afterAll(async () => {
  await api?.close();
});

async function burst(n: number, opened: boolean) {
  const q = `qarfive.burst_${tag()}`; // letters, digits and underscore only (the 0074 queue_name rule)
  const fail = (i: number) =>
    captureJobFailure(api.db, {
      queue: q,
      jobId: crypto.randomUUID(),
      data: {
        outboxEventId: crypto.randomUUID(),
        eventType: "synthetic.event",
        schemaVersion: 1,
        idempotencyKey: `synthetic:${q}:${i}:${tag()}`,
        organizationId: w.orgA.id,
        payload: {},
      },
      attempts: 3,
      error: new Error(`Synthetic downstream outage (job ${i}).`),
    });
  // Optionally open the queue's exception first (then every capture of the burst is a recurrence).
  let base = 0;
  if (opened) {
    await fail(-1);
    base = 1;
  }
  const settled = await Promise.allSettled(Array.from({ length: n }, (_, i) => fail(i)));
  const rejected = settled
    .filter((s): s is PromiseRejectedResult => s.status === "rejected")
    .map((s) => String((s.reason as Error)?.message ?? s.reason).slice(0, 200));
  const failures = await api.db
    .selectFrom("operational_failure")
    .select(["id", "status"])
    .where("queue_name", "=", q)
    .execute();
  const ex = await api.db
    .selectFrom("operational_exception")
    .select(["id", "occurrence_count", "status"])
    .where("source_code", "=", q)
    .execute();
  return { q, n, base, rejected, failures: failures.length, exceptions: ex };
}

describe("QA-R5 concurrent last-attempt job failures on one queue", () => {
  for (const opened of [false, true])
    it(`every one of 8 concurrent failures is captured (exception ${opened ? "already open" : "not yet open"}), 5 rounds`, async () => {
      const lost: string[] = [];
      for (let round = 0; round < 5; round++) {
        const r = await burst(8, opened);
        const occ = r.exceptions.reduce((s, x) => s + x.occurrence_count, 0);
        console.log(
          `QA-R5 BURST opened=${opened} round ${round}: queue ${r.q}; captures ${r.n} (+${r.base} before); rejected ${r.rejected.length}; ` +
            `operational_failure rows ${r.failures} (expected ${r.n + r.base}); exceptions ${r.exceptions.length} with ` +
            `occurrences ${occ} (expected ${r.n + r.base}); reasons ${JSON.stringify([...new Set(r.rejected)])}`,
        );
        if (r.rejected.length > 0 || r.failures !== r.n + r.base || occ !== r.n + r.base)
          lost.push(`round ${round}: rejected ${r.rejected.length}, failures ${r.failures}/${r.n + r.base}, occurrences ${occ}`);
      }
      expect(lost).toEqual([]);
    });
});
