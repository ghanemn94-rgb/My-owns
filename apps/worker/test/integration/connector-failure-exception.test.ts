// One connector's FINAL failure yields exactly ONE open operational exception, against a real PostgreSQL with pg-boss
// (T-DG6-BE-K2S, the merge seam of BE-K2 with BE-L2; ADR-0053 §2, §3; ADR-0055 §2; D-102). Proves:
//  - the relay fans `connector.run_failed` out to BOTH its consumers, BE-L2's `integrations.connector_exception` (the
//    connector's exception) and the engine's `automation.evaluate` (the catalogue trigger of admin rules), one job each,
//    with the D-102 deterministic job ids; a relay retry and a replayed send add no job;
//  - the production handlers (DOMAIN_HANDLERS) run both: exactly one ACTIVE exception for the connector and its failure
//    class (occurrence_count 1, one `operational_exception.opened` audit event, no recurrence); the failure is ONE
//    execution of starter 16 version 2 (0117), recorded around BE-L2's consumer, and the engine records no execution of
//    its own (it never runs a starter); a redelivery of both jobs creates nothing;
//  - a later final failure of the SAME connector recurs the same exception (count 2), never a second one.
// All data is SYNTHETIC. Nothing here approves anything (no business approval, G1-G6) or touches DG0-DG7.
import { randomUUID } from "node:crypto";
import { sql } from "@mth/db";
import type PgBoss from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CONNECTOR_EXCEPTION_QUEUE } from "../../src/handlers/integrations.ts";
import { DOMAIN_HANDLERS } from "../../src/handlers/index.ts";
import { ensureQueues, QUEUES_FOR_EVENT } from "../../src/queues/index.ts";
import { fanOutJobId, jobsForEvent, relayOnce } from "../../src/relay.ts";
import { startWorker, type RunningWorker } from "../../src/worker.ts";
import { bossFor, seedTransformationWithOutbox, waitFor, workerEnv, type WorkerEnv } from "../support.ts";

const AUTOMATION_EVALUATE = "automation.evaluate";
const STARTER_16 = "01920005-0075-7000-8000-000000000110";
const STARTER_16_V2 = "01920006-0117-7000-8000-000000000001";
/** The seeded identity of the connector-exception job (0116); any service identity row satisfies the FK. */
const CONNECTOR_EXCEPTION_IDENTITY = "01920006-0116-7000-8000-000000000011";
// Generous under load (F-DG4-143 class): the polling interval is 0.5 s; a loaded run has taken a few seconds.
const WAIT_MS = 60_000;

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

interface World {
  readonly organizationId: string;
  readonly connectorId: string;
  readonly connectorCode: string;
}

async function seed(): Promise<World> {
  const { transformationId } = await seedTransformationWithOutbox(env.db);
  const { organization_id: organizationId } = await env.db
    .selectFrom("transformation")
    .select("organization_id")
    .where("id", "=", transformationId)
    .executeTakeFirstOrThrow();
  // The seed's own transformation.created event is relayed (and not consumed here) so later relays see only ours.
  await relayOnce(env.db, boss, 50);
  return {
    organizationId,
    connectorId: randomUUID(),
    connectorCode: `k2s-${randomUUID().slice(0, 8)}`,
  };
}

/** The run's last failure, written as BE-L2's failing transaction writes it (apps/api integrations/runs.ts). */
async function finalFailure(w: World): Promise<{ outboxId: string; key: string; runId: string }> {
  const runId = randomUUID();
  const outboxId = randomUUID();
  const key = `connector.run_failed:${runId}`;
  await env.db
    .insertInto("outbox_event")
    .values({
      id: outboxId,
      organization_id: w.organizationId,
      aggregate_type: "integration_run",
      aggregate_id: runId,
      event_type: "connector.run_failed",
      schema_version: 1,
      payload: JSON.stringify({
        connectorId: w.connectorId,
        connectorCode: w.connectorCode,
        runId,
        serviceIdentityId: CONNECTOR_EXCEPTION_IDENTITY,
        failureClass: "connector_unreachable",
        errorCode: "connector.source_unavailable",
        errorMessage: "The source system did not respond.",
      }),
      idempotency_key: key,
    })
    .execute();
  return { outboxId, key, runId };
}

const jobsOf = async (outboxId: string) =>
  (
    await sql<{
      id: string;
      name: string;
      state: string;
    }>`SELECT id::text AS id, name, state FROM pgboss.job WHERE data->>'outboxEventId' = ${outboxId} ORDER BY name`.execute(
      env.db,
    )
  ).rows;

const activeExceptions = (w: World) =>
  env.db
    .selectFrom("operational_exception")
    .select(["id", "status", "failure_class", "occurrence_count", "source_kind", "last_error_code"])
    .where("organization_id", "=", w.organizationId)
    .where("source_kind", "=", "connector")
    .where("source_code", "=", w.connectorCode)
    .where("status", "in", ["open", "acknowledged"])
    .execute();

const allExceptions = (w: World) =>
  env.db
    .selectFrom("operational_exception")
    .select(["id"])
    .where("organization_id", "=", w.organizationId)
    .where("source_code", "=", w.connectorCode)
    .execute();

const executionsOf = (key: string) =>
  env.db
    .selectFrom("automation_execution")
    .select(["automation_rule_id", "automation_rule_version_id", "trigger_code", "status"])
    .where("trigger_key", "=", key)
    .execute();

const auditOf = (exceptionId: string) =>
  env.db
    .selectFrom("audit_event")
    .select(["action"])
    .where("record_type", "=", "operational_exception")
    .where("record_id", "=", exceptionId)
    .orderBy("occurred_at")
    .execute();

async function bothCompleted(outboxId: string): Promise<void> {
  await waitFor(async () => {
    const jobs = await jobsOf(outboxId);
    return jobs.length === 2 && jobs.every((j) => j.state === "completed");
  }, WAIT_MS);
}

describe("connector.run_failed: two consumers, one exception (ADR-0053 §2, §3; ADR-0055 §2; D-102)", () => {
  it("fans out to the connector-exception consumer and the engine; exactly one open exception, one starter-16 v2 execution", async () => {
    const w = await seed();
    const { outboxId, key } = await finalFailure(w);
    expect(QUEUES_FOR_EVENT["connector.run_failed"]).toEqual([CONNECTOR_EXCEPTION_QUEUE, AUTOMATION_EVALUATE]);

    const relayed = await relayOnce(env.db, boss, 50);
    expect(relayed.failed).toBe(0);
    const jobs = await jobsOf(outboxId);
    expect(Object.fromEntries(jobs.map((j) => [j.name, j.id]))).toEqual({
      [AUTOMATION_EVALUATE]: fanOutJobId(outboxId, AUTOMATION_EVALUATE),
      [CONNECTOR_EXCEPTION_QUEUE]: fanOutJobId(outboxId, CONNECTOR_EXCEPTION_QUEUE),
    });
    // A relay retry and a replayed send with the same ids add no job.
    await relayOnce(env.db, boss, 50);
    const row = await env.db
      .selectFrom("outbox_event")
      .select(["organization_id", "payload"])
      .where("id", "=", outboxId)
      .executeTakeFirstOrThrow();
    const envelope = {
      outboxEventId: outboxId,
      eventType: "connector.run_failed",
      schemaVersion: 1,
      idempotencyKey: key,
      organizationId: row.organization_id,
      payload: row.payload,
    };
    for (const j of jobsForEvent(outboxId, QUEUES_FOR_EVENT["connector.run_failed"]!))
      await boss.send(j.queue, envelope, { id: j.id });
    expect(await jobsOf(outboxId)).toHaveLength(2);

    // The production registrations of the two consumers (DOMAIN_HANDLERS: the starter wrapper included).
    const handlers = DOMAIN_HANDLERS.filter((h) => [CONNECTOR_EXCEPTION_QUEUE, AUTOMATION_EVALUATE].includes(h.queue));
    expect(handlers.map((h) => h.queue).sort()).toEqual([AUTOMATION_EVALUATE, CONNECTOR_EXCEPTION_QUEUE]);
    const worker: RunningWorker = await startWorker({
      db: env.db,
      boss,
      timeZone: "Asia/Riyadh",
      log: quiet,
      pollIntervalMs: 200,
      jobPollingIntervalSeconds: 0.5,
      handlers,
    });
    try {
      await bothCompleted(outboxId);
    } finally {
      await worker.stop();
    }

    const active = await activeExceptions(w);
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({
      status: "open",
      source_kind: "connector",
      failure_class: "connector_unreachable",
      occurrence_count: 1,
      last_error_code: "connector.source_unavailable",
    });
    expect(await allExceptions(w)).toHaveLength(1);
    expect((await auditOf(active[0]!.id)).map((a) => a.action)).toEqual(["operational_exception.opened"]);
    // One execution: starter 16 version 2 around BE-L2's consumer; the engine runs admin rules only (none here).
    expect(await executionsOf(key)).toEqual([
      {
        automation_rule_id: STARTER_16,
        automation_rule_version_id: STARTER_16_V2,
        trigger_code: "connector.run_failed",
        status: "succeeded",
      },
    ]);
    const ledger = await env.db
      .selectFrom("processed_message")
      .select("consumer")
      .where("idempotency_key", "=", key)
      .execute();
    expect(ledger.map((l) => l.consumer)).toEqual([CONNECTOR_EXCEPTION_QUEUE]);

    // A redelivery of both jobs (the handlers called again with the same envelope) creates nothing.
    for (const h of handlers)
      await h.handle(env.db, envelope, `redeliver-${h.queue}`, { retryCount: 0, retryLimit: 5 });
    const after = await activeExceptions(w);
    expect(after).toEqual(active);
    expect(await allExceptions(w)).toHaveLength(1);
    expect(await executionsOf(key)).toHaveLength(1);
  }, 120_000);

  it("a later final failure of the same connector recurs the one exception (count 2), never opens a second", async () => {
    const w = await seed();
    const handlers = DOMAIN_HANDLERS.filter((h) => [CONNECTOR_EXCEPTION_QUEUE, AUTOMATION_EVALUATE].includes(h.queue));
    const first = await finalFailure(w);
    const second = await finalFailure(w);
    expect((await relayOnce(env.db, boss, 50)).failed).toBe(0);
    const worker: RunningWorker = await startWorker({
      db: env.db,
      boss,
      timeZone: "Asia/Riyadh",
      log: quiet,
      pollIntervalMs: 200,
      jobPollingIntervalSeconds: 0.5,
      handlers,
    });
    try {
      await bothCompleted(first.outboxId);
      await bothCompleted(second.outboxId);
    } finally {
      await worker.stop();
    }
    const active = await activeExceptions(w);
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({ status: "open", occurrence_count: 2 });
    expect(await allExceptions(w)).toHaveLength(1);
    expect((await auditOf(active[0]!.id)).map((a) => a.action).sort()).toEqual([
      "operational_exception.opened",
      "operational_exception.recurred",
    ]);
    for (const k of [first.key, second.key])
      expect((await executionsOf(k)).map((e) => [e.automation_rule_version_id, e.status])).toEqual([
        [STARTER_16_V2, "succeeded"],
      ]);
  }, 120_000);
});
