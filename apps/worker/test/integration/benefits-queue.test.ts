// The benefits consumers against a real PostgreSQL (T-DG4-KBE-E; p4-work-split §B.3; ADR-0030 §3, §6; REQ-S12-014,
// REQ-S07-014, REQ-S12-006). The records are created through the API (the API test harness, same disposable database
// server), and the handlers run as the production worker runs them:
//  - REQ-S12-014 "submitting benefit evidence creates exactly one item in the Finance validation queue; replaying the
//    same event creates no second item": the relay delivers benefit.evidence_submitted to benefits.finance_queue; the
//    production worker writes ONE queue item; a redelivery (the same envelope as a new job) and a restarted worker that
//    receives it again write none (processed_message ledger + finance_validation_one_per_measurement);
//  - REQ-S07-014 "after an accepted KPI actual the linked benefit shows a pending amount and the validated total is
//    unchanged": kpi.values_recalculated of the accept run gives ONE pending (submitted) measurement per benefit and
//    run, computed by the DG3 engine from the accepted KPI value version (lineage recorded), with its queue item; a
//    replay creates none; a newer accepted value supersedes the earlier pending value and withdraws its queue item.
// Isolation (T-DG4-KBE-R4, D-114): this file starts the PRODUCTION worker, which consumes its queues in pg-boss order
// (oldest first). In the shared per-run database those queues also hold the jobs of every other file's events (the
// relay publishes every unpublished outbox row, and no other file runs a worker on these queues), and the worker drains
// them first, about one per 0.5 s polling interval: measured in the full suite at 0a3da46, 31 benefits.finance_queue
// jobs of other files were ahead of this test's job, which started 15.5 s after the worker, past the 15 s wait. So the
// file runs on its OWN scratch database of the run's cluster (created, migrated by the real runner and dropped here; the
// tests/qa A04 precedent), and the test asserts that its job is the only one in the queue before the worker starts.
// All data is SYNTHETIC; no job decides a Finance validation or touches the engineering gates DG0-DG7.
import type PgBoss from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "../../../../packages/db/src/migrate.ts";
import {
  createScratchDatabase,
  dropScratchDatabase,
  roleUrl,
  testDatabase,
} from "../../../../packages/db/test/helpers.ts";
import { call, seedWorld, startApi, type TestApi, type World } from "../../../api/test/support/harness.ts";
import { seedBenefitWorld, type BenefitWorld } from "../../../api/test/integration/benefits/fixtures.ts";
import {
  envelopeOf,
  measuredBenefit,
  queueItemOf,
  revenueFormula,
  runRecalculatePending,
  type Body,
} from "../../../api/test/integration/benefits/value-fixtures.ts";
import { seedKpiWorld, type KpiWorld } from "../../../api/test/integration/kpi/fixtures.ts";
import {
  actualAction,
  DIRECT_FLOW,
  monthlyPeriod,
  ownedKpi,
  runRecalculation,
  submitActual,
} from "../../../api/test/integration/kpi-p4/kbe-c-fixtures.ts";
import { BENEFITS_HANDLERS, FINANCE_QUEUE, FINANCE_QUEUE_CONSUMER } from "../../src/handlers/benefits.ts";
import { ensureQueues } from "../../src/queues/index.ts";
import { relayOnce } from "../../src/relay.ts";
import { startWorker, type RunningWorker } from "../../src/worker.ts";
import { bossFor, waitFor } from "../support.ts";

let api: TestApi;
let w: World;
let boss: PgBoss;
let dbName: string | undefined;
beforeAll(async () => {
  const { adminUrl } = testDatabase();
  dbName = await createScratchDatabase(adminUrl, "mth_bq");
  await migrate(roleUrl(adminUrl, dbName, "mth_owner"));
  api = await startApi({ database: dbName });
  w = await seedWorld(api.db);
  boss = bossFor(api.config.databaseUrl!);
  boss.on("error", () => undefined);
  await boss.start();
  await ensureQueues(boss);
}, 60_000);
afterAll(async () => {
  await boss?.stop({ graceful: false, wait: true, timeout: 5000 });
  await api?.close();
  if (dbName) await dropScratchDatabase(testDatabase().adminUrl, dbName);
}, 60_000);

const quiet = { info: () => undefined, error: () => undefined };
const worker = () =>
  startWorker({
    db: api.db,
    boss,
    timeZone: "Asia/Riyadh",
    log: quiet,
    pollIntervalMs: 200,
    jobPollingIntervalSeconds: 0.5,
    handlers: BENEFITS_HANDLERS,
  });
const validatedOf = async (b: BenefitWorld, benefitId: string) => {
  const r = await call<Body>(api.app, "GET", `${b.base}/benefits/${benefitId}/values`, { session: b.s.auditor });
  return Object.fromEntries((r.body.series as Body[]).map((s) => [s.state, s]));
};

describe("benefits.finance_queue through the relay and the production worker (REQ-S12-014)", () => {
  it("one queue item; a redelivery and a restarted worker write no second item", async () => {
    const b = await seedBenefitWorld(api, w);
    const ben = await measuredBenefit(api, b);
    const ev = await call<Body>(api.app, "POST", `${b.base}/evidence`, {
      session: b.s.tl,
      body: { kind: "note", title: "Synthetic", noteBody: "Synthetic", ownerUserId: b.users.tl.id },
    });
    const m = await call<Body>(api.app, "POST", `${b.base}/benefits/${ben.id}/measurements`, {
      session: b.s.bo,
      body: {
        periodStart: "2037-01-01",
        periodEnd: "2037-01-31",
        amount: "250000",
        evidenceIds: [ev.body.id],
        submit: true,
      },
    });
    expect(m.status, JSON.stringify(m.body)).toBe(201);
    // The relay ends a round at the first row it cannot publish (older rows of other files in the shared database, e.g.
    // events whose consumer is not merged yet, are retried until maxPublishAttempts): relay until OUR event is published.
    await waitFor(
      async () => {
        await relayOnce(api.db, boss);
        const row = await api.db
          .selectFrom("outbox_event")
          .select("published_at")
          .where("aggregate_id", "=", m.body.id)
          .where("event_type", "=", "benefit.evidence_submitted")
          .executeTakeFirstOrThrow();
        return row.published_at !== null ? true : null;
      },
      180_000,
      0,
    );
    // The precondition the isolation gives (D-114): no job of another file is queued ahead of this test's job.
    const queued = await api.owner.query(
      "SELECT data->>'outboxEventId' AS event FROM pgboss.job WHERE name = $1 AND state IN ('created', 'retry')",
      [FINANCE_QUEUE],
    );
    const ours = (await envelopeOf(api, m.body.id, "benefit.evidence_submitted"))!.outboxEventId;
    expect(queued.rows.map((r) => r.event)).toEqual([ours]);
    let running: RunningWorker = await worker();
    try {
      const item = await waitFor(async () => (await queueItemOf(api, m.body.id)) ?? null);
      expect([item.status, item.kind]).toEqual(["queued", "validation"]);
      const envelope = (await envelopeOf(api, m.body.id, "benefit.evidence_submitted"))!;
      await boss.send(FINANCE_QUEUE, envelope);
      await running.stop();
      running = await worker();
      await boss.send(FINANCE_QUEUE, envelope);
      await waitFor(async () => {
        const r = await api.owner.query(
          "SELECT count(*)::int AS n FROM pgboss.job WHERE name = $1 AND state = 'completed' AND data->>'outboxEventId' = $2",
          [FINANCE_QUEUE, envelope.outboxEventId],
        );
        return r.rows[0].n >= 3 ? true : null;
      });
      const items = await api.db
        .selectFrom("finance_validation")
        .select("id")
        .where("benefit_measurement_id", "=", m.body.id)
        .execute();
      expect(items).toHaveLength(1);
      const ledger = await api.db
        .selectFrom("processed_message")
        .select("idempotency_key")
        .where("consumer", "=", FINANCE_QUEUE_CONSUMER)
        .where("idempotency_key", "=", envelope.idempotencyKey)
        .execute();
      expect(ledger).toHaveLength(1);
      // Pending, never validated (REQ-S08-016).
      const s = await validatedOf(b, ben.id);
      expect([s.validated.total.amount, s.submitted.total.amount]).toEqual(["0.0000", "250000.0000"]);
    } finally {
      await running.stop();
    }
  });
});

/** A BenefitWorld view of a KPI world (the slice A fixtures' users hold TL, BO, FIN in the same transformation). */
function asBenefitWorld(k: KpiWorld, kpiDefinitionId: string): BenefitWorld {
  return {
    transformationId: k.transformationId,
    organizationId: w.orgA.id,
    base: k.base,
    users: {
      tl: k.users.tl,
      bo: k.users.bo,
      bo2: k.users.bo,
      fin: k.users.fin,
      auditor: k.users.auditor,
      admin: w.admin,
      outsider: k.users.outsider,
    },
    s: {
      tl: k.s.tl,
      bo: k.s.bo,
      bo2: k.s.bo,
      fin: k.s.fin,
      auditor: k.s.auditor,
      admin: k.s.nobody,
      outsider: k.s.outsider,
    },
    kpiDefinitionId,
    benefitFormulaId: "",
  };
}

describe("benefits.recalculate_pending (REQ-S07-014, REQ-S12-006)", () => {
  it("an accepted KPI actual gives one pending value per benefit and run; replay none; a newer value supersedes", async () => {
    const k = await seedKpiWorld(api, w);
    const kpi = await ownedKpi(api, k, DIRECT_FLOW, { unitKind: "count", unitLabel: "customers" });
    const b = asBenefitWorld(k, kpi.id);
    const formula = await revenueFormula(api, b);
    const ben = await measuredBenefit(api, b, {
      formula,
      extra: { measurementKpiDefinitionId: kpi.id, measurementKpiVariable: "eligible_customers" },
    });
    const period = await monthlyPeriod(api, w);
    const accepted = await submitActual(api, k, kpi.id, { reportingPeriodId: period.id, value: "100000" });
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(201);
    const actualId = accepted.body.actual.id as string;
    await runRecalculation(api, actualId);
    const runs = await api.db
      .selectFrom("calculation_run")
      .select("id")
      .where("trigger_record_id", "=", actualId)
      .orderBy("seq")
      .execute();
    expect(runs).toHaveLength(1);
    const first = await runRecalculatePending(api, runs[0]!.id);
    expect([first.outcome, first.created.length, first.superseded]).toEqual(["done", 1, []]);
    const pending = await api.db
      .selectFrom("benefit_measurement")
      .selectAll()
      .where("id", "=", first.created[0]!)
      .executeTakeFirstOrThrow();
    expect(pending).toMatchObject({
      benefit_id: ben.id,
      source: "kpi_recalculation",
      status: "submitted",
      submitted_by: null,
      calculation_run_id: runs[0]!.id,
      amount: "100000.0000",
      period_start: period.start,
      period_end: period.end,
      formula_version_id: formula.versionId,
    });
    const inputs = await api.db
      .selectFrom("benefit_measurement_input")
      .selectAll()
      .where("measurement_id", "=", pending.id)
      .execute();
    expect(inputs.find((i) => i.variable_name === "eligible_customers")).toMatchObject({
      kpi_actual_id: actualId,
      kpi_value_no: 1,
      value: "100000.000000",
    });
    const item = await queueItemOf(api, pending.id);
    expect([item!.status, item!.idempotency_key]).toEqual(["queued", `benefit.value_recalculated:${pending.id}`]);
    // The pending amount shows; the validated total is unchanged.
    let s = await validatedOf(b, ben.id);
    expect([s.submitted.total.amount, s.validated.total.amount]).toEqual(["100000.0000", "0.0000"]);
    // Replay: nothing new (ledger), and never a second pending value for the run (benefit_measurement_run_key).
    expect((await runRecalculatePending(api, runs[0]!.id)).outcome).toBe("duplicate");
    expect(
      await api.db
        .selectFrom("benefit_measurement")
        .select("id")
        .where("calculation_run_id", "=", runs[0]!.id)
        .execute(),
    ).toHaveLength(1);
    // A corrected KPI value (value 2, accepted) -> a new run -> a new pending value; the first is superseded.
    const second = await actualAction(api, k, actualId, "values", accepted.body.actual.version, {
      action: "submit",
      value: "110000",
      dataAsOf: "2041-01-31",
    });
    expect(second.status, JSON.stringify(second.body)).toBe(200);
    await runRecalculation(api, actualId);
    const runs2 = await api.db
      .selectFrom("calculation_run")
      .select("id")
      .where("trigger_record_id", "=", actualId)
      .orderBy("seq")
      .execute();
    expect(runs2).toHaveLength(2);
    const next = await runRecalculatePending(api, runs2[1]!.id);
    expect([next.created.length, next.superseded]).toEqual([1, [pending.id]]);
    const old = await api.db
      .selectFrom("benefit_measurement")
      .select("status")
      .where("id", "=", pending.id)
      .executeTakeFirstOrThrow();
    expect(old.status).toBe("superseded");
    expect((await queueItemOf(api, pending.id))!.status).toBe("withdrawn");
    s = await validatedOf(b, ben.id);
    expect([s.submitted.total.amount, s.submitted.count, s.validated.total.amount]).toEqual([
      "110000.0000",
      1,
      "0.0000",
    ]);
  });
});
