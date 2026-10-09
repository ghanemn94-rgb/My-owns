// Maintenance schedule (ADR-0008 §5): purge expired sessions, login states and Idempotency-Key records, scheduled
// with cron in the configured business time zone (default Asia/Riyadh). Not a business automation; not audited.
import { randomBytes, randomUUID as uuidv7 } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { purgeExpired } from "../../src/handlers/index.ts";
import { DOMAIN_QUEUES, ensureQueues, PURGE_CRON, QUEUES, schedulePurge } from "../../src/queues/index.ts";
import { bossFor, seedTransformationWithOutbox, workerEnv, type WorkerEnv } from "../support.ts";

let env: WorkerEnv;
beforeAll(async () => {
  env = await workerEnv();
});
afterAll(() => env.close());

describe("purgeExpired", () => {
  it("deletes only expired or long-revoked rows", async () => {
    const { userId } = await seedTransformationWithOutbox(env.db);
    const hour = 3_600_000;
    const now = Date.now();
    const session = (id: string, idle: number, absolute: number, revoked: number | null) =>
      env.db
        .insertInto("session")
        .values({
          id,
          token_hash: randomBytes(32),
          user_id: userId,
          auth_mode: "dev",
          csrf_token_hash: Buffer.alloc(32, 1),
          idle_expires_at: new Date(now + idle),
          absolute_expires_at: new Date(now + absolute),
          revoked_at: revoked === null ? null : new Date(now + revoked),
        })
        .execute();
    const live = uuidv7();
    const idleExpired = uuidv7();
    const absoluteExpired = uuidv7();
    const revokedOld = uuidv7();
    const revokedRecent = uuidv7();
    await session(live, hour, 10 * hour, null);
    await session(idleExpired, -hour, 10 * hour, null);
    await session(absoluteExpired, hour, -hour, null);
    await session(revokedOld, hour, 10 * hour, -48 * hour);
    await session(revokedRecent, hour, 10 * hour, -hour);
    await env.db
      .insertInto("oidc_login_state")
      .values({
        state_hash: Buffer.alloc(32, 7),
        code_verifier: "v",
        nonce: "n",
        browser_binding_hash: Buffer.alloc(32, 9),
        expires_at: new Date(now - 1000),
      })
      .execute();
    await env.db
      .insertInto("oidc_login_state")
      .values({
        state_hash: Buffer.alloc(32, 8),
        code_verifier: "v",
        nonce: "n",
        browser_binding_hash: Buffer.alloc(32, 9),
        expires_at: new Date(now + 600_000),
      })
      .execute();
    await env.owner.query(
      "INSERT INTO idempotency_record (user_id, key, request_hash, response_status, response_body, created_at, expires_at) VALUES ($1, 'expired-key-1', $2, 201, '{}', now() - interval '2 days', now() - interval '1 day')",
      [userId, "a".repeat(64)],
    );

    const result = await purgeExpired(env.db);
    expect(result).toEqual({ sessions: 3, loginStates: 1, idempotencyRecords: 1 });
    const left = (await env.db.selectFrom("session").select("id").execute()).map((r) => r.id).sort();
    expect(left).toEqual([live, revokedRecent].sort());
    expect(await purgeExpired(env.db)).toEqual({ sessions: 0, loginStates: 0, idempotencyRecords: 0 });
  });
});

describe("schedule", () => {
  it("registers the purge cron in the configured time zone, idempotently", async () => {
    const boss = bossFor(env.appUrl);
    boss.on("error", () => undefined);
    await boss.start();
    try {
      await ensureQueues(boss);
      await schedulePurge(boss, "Asia/Riyadh");
      await schedulePurge(boss, "Asia/Riyadh");
      const schedules = await boss.getSchedules(QUEUES.purge);
      expect(schedules).toHaveLength(1);
      expect(schedules[0]).toMatchObject({ name: QUEUES.purge, cron: PURGE_CRON, timezone: "Asia/Riyadh" });
      // pg-boss adds its own internal "__pgboss__*" queues when scheduling is enabled.
      const queues = (await boss.getQueues())
        .map((q) => q.name)
        .filter((n) => !n.startsWith("__pgboss"))
        .sort();
      // P4 (T-DG4-BE-A): + the job_schedule.updated queue and every domain queue (none until the domains fill theirs).
      expect(queues).toEqual(
        [
          QUEUES.purge,
          QUEUES.failed,
          QUEUES.transformationCreated,
          QUEUES.jobScheduleUpdated,
          ...DOMAIN_QUEUES.map((q) => q.name),
        ].sort(),
      );
    } finally {
      await boss.stop({ graceful: false, wait: true, timeout: 5000 });
    }
  });
});
