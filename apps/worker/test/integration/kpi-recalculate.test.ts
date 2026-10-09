// The KPI recalculation consumer and the period-open job against a real PostgreSQL with pg-boss (T-DG4-KBE-C;
// p4-work-split §A.3; ADR-0027 §7-§8; ADR-0025 §3-§4; REQ-S07-013, REQ-S12-005, REQ-S12-006):
//  - the relay delivers kpi.actual_accepted to kpi.recalculate; the production worker writes exactly ONE calculation run
//    with its evaluations and one kpi.values_recalculated;
//  - a redelivered message (the same envelope sent again) and a worker restart that receives it again write no second
//    run (the processed_message ledger and the unique trigger key);
//  - kpi.reporting_period_open opens a scheduled period whose end is before today's business date, once, with one
//    audit event, and creates one kpi_update_due task per KPI owner (dedupe key kpi.period_open:<kpi>:<label>:<owner>);
//    a second run creates nothing;
//  - T-DG4-KBE-R1 item 3 (ADR-0027 §8 step 4): a run whose LAST attempt fails is recorded as one `failed`
//    calculation_run with error_code kpi.recalculate_failed (no evaluation, no kpi.values_recalculated, no ledger row,
//    no audit event; the slot stays accepted), through the production worker with retries and directly per attempt;
//    an earlier attempt's failure records nothing; a replay writes no second run.
//    The failure is forced by a synthetic BEFORE INSERT trigger on kpi_evaluation for the one seeded transformation.
// The rows are written as the API would write them, each with its audit event (the p2 audit guards). All data is
// SYNTHETIC; no job decides a business approval or touches the engineering gates DG0-DG7.
import { insertAuditEvent, sql, type Db } from "@mth/db";
import type PgBoss from "pg-boss";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  isFinalAttempt,
  openDuePeriods,
  recalculate,
  RECALCULATE_FAILED_CODE,
  RECALCULATE_QUEUE,
} from "../../src/handlers/kpi.ts";
import { ensureQueues } from "../../src/queues/index.ts";
import { relayOnce } from "../../src/relay.ts";
import { startWorker, type RunningWorker } from "../../src/worker.ts";
import { KPI_HANDLERS } from "../../src/handlers/kpi.ts";
import { bossFor, seedTransformationWithOutbox, waitFor, workerEnv, type WorkerEnv } from "../support.ts";

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
const actor = (userId: string) =>
  ({ actorType: "user", actorUserId: userId, requestId: `test-${randomUUID()}`, source: "api" }) as const;

interface Seeded {
  readonly organizationId: string;
  readonly transformationId: string;
  readonly userId: string;
  readonly kpiId: string;
  readonly periodId: string;
  readonly actualId: string;
}

/** A transformation with one active KPI (direct-accept flow), an open monthly period and one accepted actual. */
async function seedAcceptedActual(db: Db, periodStatus: "open" | "scheduled" = "open"): Promise<Seeded> {
  const { transformationId, userId } = await seedTransformationWithOutbox(db);
  const t = await db
    .selectFrom("transformation")
    .select("organization_id")
    .where("id", "=", transformationId)
    .executeTakeFirstOrThrow();
  const organizationId = t.organization_id;
  const kpiId = randomUUID();
  const versionId = randomUUID();
  const periodId = randomUUID();
  const actualId = randomUUID();
  await db.transaction().execute(async (tx) => {
    const audit = async (recordType: string, recordId: string, action: string, newVersion: number, withT = true) =>
      insertAuditEvent(tx, actor(userId), {
        action,
        recordType,
        recordId,
        organizationId,
        ...(withT ? { transformationId } : {}),
        priorVersion: newVersion > 1 ? newVersion - 1 : null,
        newVersion,
      });
    await tx
      .insertInto("kpi_definition")
      .values({
        id: kpiId,
        organization_id: organizationId,
        transformation_id: transformationId,
        name: "Synthetic worker KPI",
        unit_kind: "count",
        unit_label: "lines",
        polarity: "higher_is_better",
        frequency: "monthly",
        status: "active",
        owner_user_id: userId,
        created_by: userId,
        updated_by: userId,
      })
      .execute();
    await audit("kpi_definition", kpiId, "kpi_definition.create", 1);
    await tx
      .insertInto("kpi_version")
      .values({
        id: versionId,
        organization_id: organizationId,
        transformation_id: transformationId,
        kpi_definition_id: kpiId,
        version_no: 1,
        measure_type: "higher_is_better",
        value_nature: "flow",
        unit_kind: "count",
        unit_label: "lines",
        frequency: "monthly",
        aggregation_rule: "sum",
        submission_route: "direct_accept",
        created_by: userId,
        updated_by: userId,
      })
      .execute();
    await audit("kpi_version", versionId, "kpi_version.create", 1);
    await tx
      .updateTable("kpi_version")
      .set({ status: "active", activated_at: sql<Date>`now()`, activated_by: userId, version: 2 })
      .where("id", "=", versionId)
      .execute();
    await audit("kpi_version", versionId, "kpi_version.activate", 2);
    await tx
      .insertInto("reporting_period")
      .values({
        id: periodId,
        organization_id: organizationId,
        frequency: "monthly",
        period_label: "2026-01",
        period_start: "2026-01-01",
        period_end: "2026-01-31",
        created_by: userId,
        updated_by: userId,
      })
      .execute();
    await audit("reporting_period", periodId, "reporting_period.create", 1, false);
    if (periodStatus === "scheduled") return;
    await tx
      .updateTable("reporting_period")
      .set({ status: "open", opened_at: sql<Date>`now()`, version: 2 })
      .where("id", "=", periodId)
      .execute();
    await audit("reporting_period", periodId, "reporting_period.open", 2, false);
    await tx
      .insertInto("kpi_actual")
      .values({
        id: actualId,
        organization_id: organizationId,
        transformation_id: transformationId,
        kpi_definition_id: kpiId,
        scope_kind: "transformation",
        scope_id: transformationId,
        reporting_period_id: periodId,
        period_start: "2026-01-01",
        period_end: "2026-01-31",
        period_label: "2026-01",
        accepted_value_no: 1,
        status: "accepted",
        route: "direct_accept",
        submitted_by: userId,
        submitted_at: sql<Date>`now()`,
        decided_by: userId,
        decided_at: sql<Date>`now()`,
        created_by: userId,
        updated_by: userId,
      })
      .execute();
    await tx
      .insertInto("kpi_actual_value")
      .values({
        id: randomUUID(),
        organization_id: organizationId,
        transformation_id: transformationId,
        kpi_actual_id: actualId,
        value_no: 1,
        kpi_version_id: versionId,
        value: "42",
        // Fresh data (today, UTC): within the 45-day staleness window of the default data-quality rule.
        data_as_of: new Date().toISOString().slice(0, 10),
        entered_by: userId,
        business_date: "2026-02-01",
      })
      .execute();
    await tx
      .insertInto("kpi_actual_review")
      .values({
        id: randomUUID(),
        organization_id: organizationId,
        transformation_id: transformationId,
        kpi_actual_id: actualId,
        value_no: 1,
        outcome: "direct_accept",
        decided_by: userId,
        business_date: "2026-02-01",
      })
      .execute();
    await audit("kpi_actual", actualId, "kpi_actual.accepted", 1);
    await tx
      .insertInto("outbox_event")
      .values({
        id: randomUUID(),
        organization_id: organizationId,
        aggregate_type: "kpi_actual",
        aggregate_id: actualId,
        event_type: "kpi.actual_accepted",
        schema_version: 1,
        idempotency_key: `kpi.actual_accepted:${actualId}:1`,
        payload: JSON.stringify({
          kpiActualId: actualId,
          valueNo: 1,
          kpiDefinitionId: kpiId,
          transformationId,
          scopeKind: "transformation",
          scopeId: transformationId,
          reportingPeriodId: periodId,
        }),
      })
      .execute();
  });
  return { organizationId, transformationId, userId, kpiId, periodId, actualId };
}

const runsOf = (db: Db, actualId: string) =>
  db.selectFrom("calculation_run").selectAll().where("trigger_record_id", "=", actualId).execute();

async function envelopeOf(db: Db, actualId: string) {
  const r = await db
    .selectFrom("outbox_event")
    .select(["id", "organization_id", "event_type", "schema_version", "payload", "idempotency_key"])
    .where("aggregate_id", "=", actualId)
    .where("event_type", "=", "kpi.actual_accepted")
    .executeTakeFirstOrThrow();
  return {
    outboxEventId: r.id,
    eventType: r.event_type,
    schemaVersion: r.schema_version,
    idempotencyKey: r.idempotency_key,
    organizationId: r.organization_id,
    payload: r.payload as Record<string, unknown>,
  };
}

describe("kpi.recalculate through the relay and the production worker (REQ-S07-013, REQ-S12-006)", () => {
  it("writes one run; a redelivery and a restarted worker write no second run", async () => {
    const s = await seedAcceptedActual(env.db);
    // Relay every pending event (the seed's transformation.created and kpi.actual_accepted).
    const relayed = await relayOnce(env.db, boss);
    expect(relayed.failed).toBe(0);
    let worker: RunningWorker = await startWorker({
      db: env.db,
      boss,
      timeZone: "Asia/Riyadh",
      log: quiet,
      pollIntervalMs: 200,
      jobPollingIntervalSeconds: 0.5,
      handlers: KPI_HANDLERS,
    });
    try {
      const runs = await waitFor(async () => {
        const r = await runsOf(env.db, s.actualId);
        return r.length > 0 ? r : null;
      });
      expect(runs.map((r) => [r.trigger_kind, r.status, r.evaluation_count])).toEqual([
        ["actual_accepted", "completed", 2],
      ]);
      const evaluation = await env.db
        .selectFrom("kpi_evaluation")
        .select(["value", "value_status", "calculated_rag", "explanation_key"])
        .where("calculation_run_id", "=", runs[0]!.id)
        .where("value_basis", "=", "period")
        .executeTakeFirstOrThrow();
      // No approved trajectory: the value is known, the RAG Unknown with its reason (never green).
      expect(evaluation).toEqual({
        value: "42.000000",
        value_status: "ok",
        calculated_rag: "unknown",
        explanation_key: "kpi.rag.no_approved_trajectory",
      });
      // Redelivery of the same message (a new pg-boss job with the same envelope).
      const envelope = await envelopeOf(env.db, s.actualId);
      await boss.send(RECALCULATE_QUEUE, envelope);
      // Restart: stop the worker, start a new one, deliver once more.
      await worker.stop();
      worker = await startWorker({
        db: env.db,
        boss,
        timeZone: "Asia/Riyadh",
        log: quiet,
        pollIntervalMs: 200,
        jobPollingIntervalSeconds: 0.5,
        handlers: KPI_HANDLERS,
      });
      await boss.send(RECALCULATE_QUEUE, envelope);
      await waitFor(async () => {
        const r = await env.owner.query(
          "SELECT count(*)::int AS n FROM pgboss.job WHERE name = $1 AND state = 'completed' AND data->>'outboxEventId' = $2",
          [RECALCULATE_QUEUE, envelope.outboxEventId],
        );
        return r.rows[0].n >= 3 ? true : null;
      });
      expect((await runsOf(env.db, s.actualId)).length).toBe(1);
      const ledger = await env.db
        .selectFrom("processed_message")
        .select("idempotency_key")
        .where("consumer", "=", "kpi.recalculate.v1")
        .where("idempotency_key", "=", envelope.idempotencyKey)
        .execute();
      expect(ledger.length).toBe(1);
      const recalculated = await env.db
        .selectFrom("outbox_event")
        .select("id")
        .where("event_type", "=", "kpi.values_recalculated")
        .where("aggregate_id", "=", runs[0]!.id)
        .execute();
      expect(recalculated.length).toBe(1);
      // Calling the handler directly once more is a duplicate as well.
      expect((await recalculate(env.db, envelope, "direct")).outcome).toBe("duplicate");
      // Runs write no audit event (system lineage).
      const audit = await env.db.selectFrom("audit_event").select("id").where("record_id", "=", runs[0]!.id).execute();
      expect(audit).toEqual([]);
    } finally {
      await worker.stop();
    }
  });
});

describe("kpi.reporting_period_open (REQ-S12-005)", () => {
  it("opens a due scheduled period once and creates one update task per KPI owner", async () => {
    const s = await seedAcceptedActual(env.db, "scheduled");
    const first = await openDuePeriods(env.db, { organizationId: s.organizationId }, "job-1");
    expect(first).toEqual({ opened: 1, tasks: 1 });
    const period = await env.db
      .selectFrom("reporting_period")
      .selectAll()
      .where("id", "=", s.periodId)
      .executeTakeFirstOrThrow();
    expect([period.status, period.version]).toEqual(["open", 2]);
    const events = await env.db
      .selectFrom("audit_event")
      .select(["action", "actor_type"])
      .where("record_id", "=", s.periodId)
      .orderBy("seq")
      .execute();
    expect(events.at(-1)).toEqual({ action: "reporting_period.open", actor_type: "service" });
    const tasks = await env.db
      .selectFrom("work_item")
      .select(["kind", "assignee_user_id", "dedupe_key", "status"])
      .where("subject_id", "=", s.kpiId)
      .execute();
    expect(tasks).toEqual([
      {
        kind: "kpi_update_due",
        assignee_user_id: s.userId,
        dedupe_key: `kpi.period_open:${s.kpiId}:2026-01:${s.userId}`,
        status: "open",
      },
    ]);
    // A second run (a retry or the next day) opens nothing and creates no second task.
    expect(await openDuePeriods(env.db, { organizationId: s.organizationId }, "job-2")).toEqual({
      opened: 0,
      tasks: 0,
    });
    expect((await env.db.selectFrom("work_item").select("id").where("subject_id", "=", s.kpiId).execute()).length).toBe(
      1,
    );
  });
});

// ------------------------------------------------------------------------------------------------ T-DG4-KBE-R1 item 3

const FAULT = "kbe_r1_synthetic_fault";

/** Makes every kpi_evaluation insert of `transformationId` fail (a synthetic fault; DDL as the owner, test DB only). */
async function faultOn(transformationId: string): Promise<void> {
  if (!/^[0-9a-f-]{36}$/.test(transformationId)) throw new Error("uuid expected");
  await env.owner.query(`
    CREATE OR REPLACE FUNCTION ${FAULT}() RETURNS trigger LANGUAGE plpgsql AS $f$
    BEGIN
      IF NEW.transformation_id = '${transformationId}'::uuid THEN
        RAISE EXCEPTION 'synthetic fault (T-DG4-KBE-R1)';
      END IF;
      RETURN NEW;
    END $f$`);
  await env.owner.query(`DROP TRIGGER IF EXISTS ${FAULT} ON kpi_evaluation`);
  await env.owner.query(
    `CREATE TRIGGER ${FAULT} BEFORE INSERT ON kpi_evaluation FOR EACH ROW EXECUTE FUNCTION ${FAULT}()`,
  );
}
async function faultOff(): Promise<void> {
  await env.owner.query(`DROP TRIGGER IF EXISTS ${FAULT} ON kpi_evaluation`);
  await env.owner.query(`DROP FUNCTION IF EXISTS ${FAULT}()`);
}

/** The failed-run shape every check expects: one run, failed, with its code, nothing calculated. */
async function expectOneFailedRun(s: Seeded) {
  const runs = await runsOf(env.db, s.actualId);
  expect(
    runs.map((r) => [r.trigger_kind, r.status, r.error_code, r.evaluation_count, r.finding_count, r.idempotency_key]),
  ).toEqual([["actual_accepted", "failed", RECALCULATE_FAILED_CODE, 0, 0, `kpi.actual_accepted:${s.actualId}:1`]]);
  const run = runs[0]!;
  expect(run.trigger_record_type).toBe("kpi_actual");
  expect(run.trigger_slot).toBe(1);
  expect(run.transformation_id).toBe(s.transformationId);
  expect(run.completed_at.getTime()).toBeGreaterThanOrEqual(run.started_at.getTime());
  expect(
    await env.db.selectFrom("kpi_evaluation").select("id").where("calculation_run_id", "=", run.id).execute(),
  ).toEqual([]);
  expect(
    await env.db
      .selectFrom("outbox_event")
      .select("id")
      .where("event_type", "in", ["kpi.values_recalculated", "kpi.deviation_evaluated"])
      .where("aggregate_id", "=", run.id)
      .execute(),
  ).toEqual([]);
  // Runs are system lineage: no audit event. The accepted slot is untouched.
  expect(await env.db.selectFrom("audit_event").select("id").where("record_id", "=", run.id).execute()).toEqual([]);
  const slot = await env.db
    .selectFrom("kpi_actual")
    .select(["status", "accepted_value_no"])
    .where("id", "=", s.actualId)
    .executeTakeFirstOrThrow();
  expect(slot).toEqual({ status: "accepted", accepted_value_no: 1 });
  return run;
}

describe("kpi.recalculate: a failure on the last attempt is recorded as a failed run (ADR-0027 §8 step 4; T-DG4-KBE-R1)", () => {
  it("isFinalAttempt follows pg-boss: retry while retryCount < retryLimit", () => {
    expect(isFinalAttempt({ retryCount: 0, retryLimit: 2 })).toBe(false);
    expect(isFinalAttempt({ retryCount: 1, retryLimit: 2 })).toBe(false);
    expect(isFinalAttempt({ retryCount: 2, retryLimit: 2 })).toBe(true);
    expect(isFinalAttempt({ retryCount: 0, retryLimit: 0 })).toBe(true);
  });

  it("per attempt: earlier failures record nothing, the last one records one failed run, a replay writes no second run", async () => {
    const s = await seedAcceptedActual(env.db);
    const envelope = await envelopeOf(env.db, s.actualId);
    await faultOn(s.transformationId);
    try {
      for (const retryCount of [0, 1]) {
        await expect(recalculate(env.db, envelope, "direct", { retryCount, retryLimit: 2 })).rejects.toThrow(
          /synthetic fault/,
        );
        expect(await runsOf(env.db, s.actualId)).toEqual([]);
      }
      // No attempt information and no pg-boss job of that id ("direct"): not known to be the last, nothing recorded.
      await expect(recalculate(env.db, envelope, "direct")).rejects.toThrow(/synthetic fault/);
      expect(await runsOf(env.db, s.actualId)).toEqual([]);
      // The last attempt: the error still propagates (pg-boss fails the job), and one failed run is recorded.
      await expect(recalculate(env.db, envelope, "direct", { retryCount: 2, retryLimit: 2 })).rejects.toThrow(
        /synthetic fault/,
      );
      const run = await expectOneFailedRun(s);
      // No ledger row was committed by a failing attempt.
      expect(
        await env.db
          .selectFrom("processed_message")
          .select("idempotency_key")
          .where("consumer", "=", "kpi.recalculate.v1")
          .where("idempotency_key", "=", envelope.idempotencyKey)
          .execute(),
      ).toEqual([]);
      // A second "last attempt" (e.g. a manual retry of the dead-lettered job), fault still in place, finds the
      // trigger's one run before calculating: it neither fails again nor writes a second run.
      const again = await recalculate(env.db, envelope, "direct", { retryCount: 2, retryLimit: 2 });
      expect(again).toEqual({ outcome: "already_run", runId: run.id, evaluationCount: 0 });
      expect((await runsOf(env.db, s.actualId)).map((r) => r.id)).toEqual([run.id]);
    } finally {
      await faultOff();
    }
    // With the fault gone, a redelivery is a duplicate (the replay above committed the ledger row): still one run.
    expect((await recalculate(env.db, envelope, "replay")).outcome).toBe("duplicate");
    expect((await runsOf(env.db, s.actualId)).map((r) => r.status)).toEqual(["failed"]);
  });

  it(
    "through the production worker: the attempt that pg-boss retries records nothing, the final attempt records the failed run and the job dead-letters",
    { timeout: 60_000 },
    async () => {
      const s = await seedAcceptedActual(env.db);
      await faultOn(s.transformationId);
      // One retry, no delay: the job is sent by the relay with these limits.
      const policy = { retryLimit: 1, retryDelay: 0, retryBackoff: false };
      await ensureQueues(boss, policy);
      let worker: RunningWorker | null = null;
      try {
        const relayed = await relayOnce(env.db, boss);
        expect(relayed.failed).toBe(0);
        const envelope = await envelopeOf(env.db, s.actualId);
        worker = await startWorker({
          db: env.db,
          boss,
          timeZone: "Asia/Riyadh",
          log: quiet,
          pollIntervalMs: 200,
          jobPollingIntervalSeconds: 0.5,
          handlers: KPI_HANDLERS,
          queuePolicy: policy,
        });
        const job = await waitFor(
          async () => {
            const r = await env.owner.query(
              "SELECT id, state, retry_count, retry_limit FROM pgboss.job WHERE name = $1 AND data->>'outboxEventId' = $2",
              [RECALCULATE_QUEUE, envelope.outboxEventId],
            );
            return r.rows[0]?.state === "failed" ? r.rows[0] : null;
          },
          30_000,
          250,
        );
        // Two attempts: the first was retried (pg-boss counted it), the second was the last.
        expect([job.retry_count, job.retry_limit]).toEqual([1, 1]);
        await expectOneFailedRun(s);
        // The dead-letter queue keeps the job for an operator (ADR-0008 §4).
        const dead = await env.owner.query(
          "SELECT count(*)::int AS n FROM pgboss.job WHERE name = 'ops.failed' AND data->>'outboxEventId' = $1",
          [envelope.outboxEventId],
        );
        expect(dead.rows[0].n).toBe(1);
      } finally {
        await worker?.stop();
        await faultOff();
        await ensureQueues(boss);
      }
    },
  );
});
