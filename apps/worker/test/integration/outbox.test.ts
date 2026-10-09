// Durable automation, first cases of A13 (REQ-S16-005, REQ-S20-013, REQ-S12-004 increment; ADR-0008):
//  - the outbox relay is idempotent: relaying twice, replaying a send, or relaying concurrently yields ONE job;
//  - a duplicate delivery of a job produces no duplicate effect (ledger + one audit event);
//  - a restart loses no jobs;
//  - a job that keeps failing lands in the ops.failed dead-letter queue;
//  - the pg-boss schema is installed by `mth-db migrate` (migration 0006 == pg-boss's construction plan) and the
//    worker runs it as mth_app with migrate=false.
import { readFileSync } from "node:fs";
import { defaultMigrationsDir } from "@mth/db";
import PgBoss from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { handleTransformationCreated, STARTER_AUTOMATION_CONSUMER } from "../../src/handlers/index.ts";
import { ensureQueues, QUEUES } from "../../src/queues/index.ts";
import { relayOnce, txExecutor } from "../../src/relay.ts";
import { startWorker } from "../../src/worker.ts";
import { bossFor, seedTransformationWithOutbox, waitFor, workerEnv, type WorkerEnv } from "../support.ts";

let env: WorkerEnv;
let boss: PgBoss;

beforeAll(async () => {
  env = await workerEnv();
  boss = bossFor(env.appUrl);
  boss.on("error", () => undefined);
  await boss.start();
  await ensureQueues(boss);
});
afterAll(async () => {
  await boss.stop({ graceful: false, wait: true, timeout: 5000 });
  await env.close();
});

const jobsFor = async (outboxId: string) =>
  (await env.owner.query("SELECT id, name, state, data FROM pgboss.job WHERE data->>'outboxEventId' = $1", [outboxId]))
    .rows;

describe("pg-boss schema (installed by mth-db migrate)", () => {
  it("migration 0006 is exactly pg-boss 11's construction plan without its transaction wrapper", () => {
    const shipped = readFileSync(`${defaultMigrationsDir()}/0006_pgboss_schema_v25.sql`, "utf8");
    const plan = PgBoss.getConstructionPlans("pgboss")
      .replace(
        /^\s*BEGIN;\s*SET LOCAL lock_timeout = \d+;\s*SET LOCAL idle_in_transaction_session_timeout = \d+;\s*SELECT pg_advisory_xact_lock\([\s\S]*?\);\s*/,
        "",
      )
      .replace(/\s*COMMIT;\s*$/, "\n")
      .replace(/^\n+/, "");
    expect(shipped).toContain(plan);
  });

  it("runs as mth_app with migrate=false (the version check passes; no DDL rights needed)", async () => {
    expect(await boss.schemaVersion()).toBe(25);
    const { rows } = await env.owner.query("SELECT has_schema_privilege('mth_app', 'pgboss', 'CREATE') AS c");
    expect(rows[0].c).toBe(false);
  });
});

describe("outbox relay idempotency", () => {
  it("publishes each event exactly once, even when relayed twice", async () => {
    const { outboxId } = await seedTransformationWithOutbox(env.db);
    const first = await relayOnce(env.db, boss);
    const second = await relayOnce(env.db, boss);
    expect(first.published).toBeGreaterThanOrEqual(1);
    expect(second.published).toBe(0);
    const jobs = await jobsFor(outboxId);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ id: outboxId, name: QUEUES.transformationCreated });
    const row = await env.db
      .selectFrom("outbox_event")
      .select(["published_at", "publish_attempts"])
      .where("id", "=", outboxId)
      .executeTakeFirstOrThrow();
    expect(row.published_at).not.toBeNull();
    expect(row.publish_attempts).toBe(1);
  });

  it("is safe after a crash between send and mark (the replayed send is a no-op)", async () => {
    const { outboxId, idempotencyKey } = await seedTransformationWithOutbox(env.db);
    // Simulate a previous relay that enqueued the job but died before marking the row.
    const row = await env.db
      .selectFrom("outbox_event")
      .selectAll()
      .where("id", "=", outboxId)
      .executeTakeFirstOrThrow();
    await env.db.transaction().execute((tx) =>
      boss.send(
        QUEUES.transformationCreated,
        {
          outboxEventId: outboxId,
          eventType: row.event_type,
          schemaVersion: 1,
          idempotencyKey,
          organizationId: row.organization_id,
          payload: row.payload as object,
        },
        { id: outboxId, db: txExecutor(tx) },
      ),
    );
    await relayOnce(env.db, boss);
    expect(await jobsFor(outboxId)).toHaveLength(1);
    expect(
      (
        await env.db
          .selectFrom("outbox_event")
          .select("published_at")
          .where("id", "=", outboxId)
          .executeTakeFirstOrThrow()
      ).published_at,
    ).not.toBeNull();
  });

  it("never double-publishes with concurrent relays (FOR UPDATE SKIP LOCKED)", async () => {
    const seeded = await Promise.all([1, 2, 3, 4].map(() => seedTransformationWithOutbox(env.db)));
    const other = bossFor(env.appUrl);
    other.on("error", () => undefined);
    await other.start();
    try {
      await Promise.all([relayOnce(env.db, boss), relayOnce(env.db, other), relayOnce(env.db, boss)]);
    } finally {
      await other.stop({ graceful: false, wait: true, timeout: 5000 });
    }
    for (const s of seeded) expect(await jobsFor(s.outboxId)).toHaveLength(1);
  });

  it("records an unroutable event as a relay failure instead of dropping it", async () => {
    const { outboxId } = await seedTransformationWithOutbox(env.db);
    await env.owner.query("UPDATE outbox_event SET event_type = 'unknown.event' WHERE id = $1", [outboxId]);
    const r = await relayOnce(env.db, boss);
    expect(r.failed).toBe(1);
    const row = await env.db
      .selectFrom("outbox_event")
      .select(["published_at", "publish_attempts", "last_error"])
      .where("id", "=", outboxId)
      .executeTakeFirstOrThrow();
    expect(row).toMatchObject({
      published_at: null,
      publish_attempts: 1,
      last_error: "no queue for event type unknown.event",
    });
    await env.owner.query("UPDATE outbox_event SET publish_attempts = 10 WHERE id = $1", [outboxId]); // park it
  });
});

describe("idempotent consumer (processed_message ledger)", () => {
  it("processes a duplicate delivery once: one ledger row, one audit event", async () => {
    const s = await seedTransformationWithOutbox(env.db);
    const row = await env.db
      .selectFrom("outbox_event")
      .selectAll()
      .where("id", "=", s.outboxId)
      .executeTakeFirstOrThrow();
    const envelope = {
      outboxEventId: s.outboxId,
      eventType: "transformation.created",
      schemaVersion: 1,
      idempotencyKey: s.idempotencyKey,
      organizationId: row.organization_id,
      payload: row.payload,
    };
    const outcomes = await Promise.all([
      handleTransformationCreated(env.db, envelope, "job-a"),
      handleTransformationCreated(env.db, envelope, "job-b"),
      handleTransformationCreated(env.db, envelope, "job-c"),
    ]);
    expect(outcomes.sort()).toEqual(["done", "duplicate", "duplicate"]);
    const ledger = await env.db
      .selectFrom("processed_message")
      .selectAll()
      .where("idempotency_key", "=", s.idempotencyKey)
      .execute();
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ consumer: STARTER_AUTOMATION_CONSUMER, outcome: "done" });
    const audit = await env.db
      .selectFrom("audit_event")
      .selectAll()
      .where("transformation_id", "=", s.transformationId)
      .execute();
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: "transformation.starter_automation_requested",
      actor_type: "service",
      actor_user_id: null,
      on_behalf_of_user_id: s.userId,
      source: "worker",
    });
  });

  it("rejects a malformed envelope (so pg-boss retries it and finally dead-letters it)", async () => {
    await expect(handleTransformationCreated(env.db, { nope: true }, "job-x")).rejects.toThrow();
  });
});

describe("worker runtime: end to end, restarts and the dead-letter queue", () => {
  it("relays and handles a created transformation, and survives a restart without losing the job", async () => {
    const s = await seedTransformationWithOutbox(env.db);
    await relayOnce(env.db, boss); // enqueued while no handler is running (a "stopped" worker)
    const restarted = bossFor(env.appUrl);
    restarted.on("error", () => undefined);
    await restarted.start();
    const worker = await startWorker({
      db: env.db,
      boss: restarted,
      timeZone: "Asia/Riyadh",
      pollIntervalMs: 200,
      jobPollingIntervalSeconds: 0.5,
      log: { info: () => undefined, error: () => undefined },
    });
    try {
      const ledger = await waitFor(() =>
        env.db
          .selectFrom("processed_message")
          .selectAll()
          .where("idempotency_key", "=", s.idempotencyKey)
          .executeTakeFirst(),
      );
      expect(ledger.outcome).toBe("done");
      const job = await waitFor(
        async () =>
          (await env.owner.query("SELECT state FROM pgboss.job WHERE id = $1 AND state = 'completed'", [s.outboxId]))
            .rows[0],
      );
      expect(job.state).toBe("completed");
    } finally {
      await worker.stop();
      await restarted.stop({ graceful: false, wait: true, timeout: 5000 });
    }
  });

  it("moves a job that keeps failing to ops.failed after the bounded retries", async () => {
    const dlqBoss = bossFor(env.appUrl);
    dlqBoss.on("error", () => undefined);
    await dlqBoss.start();
    // Fast policy for the test (production: 5 retries from 10 s with backoff).
    const worker = await startWorker({
      db: env.db,
      boss: dlqBoss,
      timeZone: "Asia/Riyadh",
      pollIntervalMs: 200,
      jobPollingIntervalSeconds: 0.5,
      queuePolicy: { retryLimit: 1, retryDelay: 0, retryBackoff: false },
      log: { info: () => undefined, error: () => undefined },
    });
    try {
      const poisonId = crypto.randomUUID();
      await dlqBoss.send(QUEUES.transformationCreated, { poison: true }, { id: poisonId });
      const dead = await waitFor(
        async () =>
          (
            await env.owner.query("SELECT data FROM pgboss.job WHERE name = $1 AND data->>'poison' = 'true'", [
              QUEUES.failed,
            ])
          ).rows[0],
        20_000,
      );
      expect(dead.data).toEqual({ poison: true });
      const original = (await env.owner.query("SELECT state, retry_count FROM pgboss.job WHERE id = $1", [poisonId]))
        .rows[0];
      expect(original).toMatchObject({ state: "failed", retry_count: 1 });
    } finally {
      await worker.stop();
      await ensureQueues(dlqBoss); // restore the production policy
      await dlqBoss.stop({ graceful: false, wait: true, timeout: 5000 });
    }
    const q = await boss.getQueue(QUEUES.transformationCreated);
    expect(q).toMatchObject({ retryLimit: 5, retryDelay: 10, retryBackoff: true, deadLetter: QUEUES.failed });
  });
});
