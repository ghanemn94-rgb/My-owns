// ADR-0053 §6 (REQ-S12-019/REQ-S16-029 A22; T-DG6-DO-D): the worker heartbeat writer of apps/worker/src/heartbeat.ts
// (started by main.ts) against a real PostgreSQL as mth_app:
//  1. the first beat inserts one row (beat 1, started_at = last_beat_at, database clock), each later beat moves it
//     forward by exactly one (version and beat_count; the worker_heartbeat_forward guard) and the timer beats on its own;
//  2. beats write no audit event (telemetry, the job_run precedent);
//  3. stop() ends the beats; a restarted process writes a new instance key and the old row is kept;
//  4. a failing database is logged (worker.heartbeat_failed) and never throws out of the worker.
// BE-K's getWorkerHeartbeat reads these rows (apps/api/test/integration/operations/exceptions.test.ts covers the
// alive/stale/unknown rule); the worker imports no API code (ADR-0002 rule 5). All data is SYNTHETIC.
import { createDb, createPool, sql } from "@mth/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startHeartbeat } from "../../src/heartbeat.ts";
import { waitFor, workerEnv, type WorkerEnv } from "../support.ts";

let env: WorkerEnv;
beforeAll(async () => {
  env = await workerEnv();
});
afterAll(async () => {
  await env.close();
});

async function rowOf(instanceKey: string) {
  return env.db
    .selectFrom("worker_heartbeat")
    .select([
      "instance_key",
      "app_version",
      "queue_count",
      "version",
      sql<string>`beat_count::text`.as("beats"),
      sql<boolean>`started_at = last_beat_at`.as("first"),
      sql<number>`extract(epoch FROM now() - last_beat_at)::float8`.as("age_seconds"),
    ])
    .where("instance_key", "=", instanceKey)
    .executeTakeFirst();
}

describe("the worker heartbeat writer (ADR-0053 §6)", () => {
  it("inserts beat 1, moves forward by exactly one per beat, and beats on its own timer", async () => {
    const hb = startHeartbeat({
      db: env.db,
      intervalSeconds: 1,
      appVersion: "0.1.0",
      queueCount: 42,
      instanceKey: "worker-it-a",
    });
    try {
      const first = await waitFor(async () => rowOf("worker-it-a"), 10_000);
      expect(first).toMatchObject({
        instance_key: "worker-it-a",
        app_version: "0.1.0",
        queue_count: 42,
        version: 1,
        beats: "1",
        first: true,
      });
      await hb.beat();
      const second = await rowOf("worker-it-a");
      expect(Number(second!.beats)).toBeGreaterThanOrEqual(2);
      expect(second!.version).toBe(Number(second!.beats));
      // The timer: at least one more beat within a few intervals, without a call.
      const before = Number(second!.beats);
      await waitFor(async () => {
        const r = await rowOf("worker-it-a");
        return r && Number(r.beats) > before ? r : undefined;
      }, 10_000);
      const fresh = await rowOf("worker-it-a");
      expect(fresh!.age_seconds).toBeLessThan(90);
      expect(fresh!.version).toBe(Number(fresh!.beats));
    } finally {
      await hb.stop();
    }
  });

  it("writes no audit event (telemetry, not audited)", async () => {
    const n = await env.db
      .selectFrom("audit_event")
      .select(sql<string>`count(*)::text`.as("n"))
      .where("record_type", "=", "worker_heartbeat")
      .executeTakeFirstOrThrow();
    expect(n.n).toBe("0");
  });

  it("stop() ends the beats; a restart writes a new instance key and keeps the old row", async () => {
    const a = startHeartbeat({
      db: env.db,
      intervalSeconds: 1,
      appVersion: "0.1.0",
      queueCount: 3,
      instanceKey: "worker-it-b",
    });
    await waitFor(async () => rowOf("worker-it-b"), 10_000);
    await a.stop();
    const stopped = await rowOf("worker-it-b");
    await new Promise((r) => setTimeout(r, 2_500));
    expect((await rowOf("worker-it-b"))!.beats).toBe(stopped!.beats);

    const b = startHeartbeat({ db: env.db, intervalSeconds: 1, appVersion: "0.1.0", queueCount: 3 });
    try {
      expect(b.instanceKey).toMatch(/^worker-[0-9a-f]{24}$/);
      expect(b.instanceKey).not.toBe("worker-it-b");
      const restarted = await waitFor(async () => rowOf(b.instanceKey), 10_000);
      expect(restarted).toMatchObject({ beats: "1", first: true });
      expect((await rowOf("worker-it-b"))!.beats).toBe(stopped!.beats);
    } finally {
      await b.stop();
    }
  });

  it("a failing database is logged as worker.heartbeat_failed and never throws", async () => {
    const pool = createPool(env.appUrl, { max: 1, applicationName: "worker-test-heartbeat-down" });
    const db = createDb(pool);
    await pool.end(); // the pool is closed: every query of this db fails
    const errors: object[] = [];
    const hb = startHeartbeat({
      db,
      intervalSeconds: 1,
      appVersion: "0.1.0",
      queueCount: 1,
      instanceKey: "worker-it-down",
      log: { error: (obj) => void errors.push(obj) },
    });
    await expect(hb.beat()).resolves.toBeUndefined();
    await hb.stop();
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors[0]).toMatchObject({ instanceKey: "worker-it-down", errorCode: "worker.heartbeat_failed" });
    expect(await rowOf("worker-it-down")).toBeUndefined();
  });
});
