// qa-verifier DG6 round 2 probe (T-DG6-REV-QA-R2), NOT part of the candidate. Lines 3-288 are copied verbatim from the candidate's
// apps/worker/test/integration/operations-freshness.test.ts lines 1-286 (seed/evaluate helpers); the round-1 probe (unchanged) and the round-2 adversarial cases follow.
// The KPI freshness scan, starter 16 version 2, the catalogue triggers and the exception alerts, against a real
// PostgreSQL (T-DG6-BE-K2; ADR-0053 §2, §3, §6; REQ-S12-019; p6-work-split §J/C.4). Proves:
//  - the trigger catalogue lists connector.run_failed and data.stale (admin-selectable, M0239), each fed to the engine;
//  - starter 16 version 1 is unchanged history (superseded, same content and hash), version 2 is the effective
//    published version with {job.failed, connector.run_failed, data.stale}, each change audited; the starter guard still
//    refuses an application (API) version that adds a trigger, and accepts one that keeps version 2's set;
//  - a KPI whose last accepted actual is older than staleAfterDays -> exactly one data.stale event per stale episode
//    (a second scan writes nothing), one `data_stale` exception linked to the KPI, recorded as one execution of starter
//    16 v2; a redelivered event creates nothing; the KPI still reads Stale with its last value and date, and no KPI row
//    is written; fresh again -> `recovered`;
//  - one alert per OPEN (one notification per acknowledge holder, one `alert: true` log line), none per recurrence;
//    platform exceptions alert every organization's holders; heartbeat_missed gets no second log line;
//  - a narrowed grant fails the scan with service_identity.out_of_scope (least privilege, visibly).
// All data is SYNTHETIC. Nothing here approves anything (not a business approval, G1-G6) or touches DG0-DG7.
import { createHash, randomUUID } from "node:crypto";
import { insertAuditEvent, sql, type Db } from "@mth/db";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  DATA_STALE_EVENT,
  dataStaleEventKey,
  EXCEPTION_ALERTS_HANDLER,
  EXCEPTION_OPENED_MESSAGE,
  EXCEPTION_RAISE_HANDLER,
  FRESHNESS_SCAN_HANDLER,
  kpiFreshness,
  OPERATIONS_HANDLERS,
  setOperationsAlertLogger,
} from "../../src/handlers/operations.ts";
import { DOMAIN_HANDLERS } from "../../src/handlers/index.ts";
import { raiseOperationalExceptionTwin, jobActor } from "../../src/kit.ts";
import { AUTOMATION_EVENT_QUEUES } from "../../src/queues/automation.ts";
import { QUEUES_FOR_EVENT } from "../../src/queues/index.ts";
import { seedTransformationWithOutbox, workerEnv, type WorkerEnv } from "../support.ts";

let env: WorkerEnv;
const lines: { obj: Record<string, unknown>; msg: string }[] = [];
beforeAll(async () => {
  env = await workerEnv();
  setOperationsAlertLogger({ error: (obj, msg) => lines.push({ obj: obj as Record<string, unknown>, msg }) });
}, 60_000);
afterAll(async () => {
  setOperationsAlertLogger(null);
  await env.close();
});
afterEach(() => {
  lines.length = 0;
});

const STARTER_16 = "01920005-0075-7000-8000-000000000110";
const STARTER_16_V1 = "01920005-0075-7000-8000-000000000210";
const STARTER_16_V2 = "01920006-0117-7000-8000-000000000001";
const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const userActor = (userId: string) =>
  ({ actorType: "user", actorUserId: userId, requestId: `test-${randomUUID()}`, source: "api" }) as const;

interface World {
  readonly organizationId: string;
  readonly transformationId: string;
  readonly userId: string;
  readonly kpiId: string;
  readonly versionId: string;
  readonly periodId: string;
}

/** Today's business date in Asia/Riyadh (the organizations here have no calendar: the organization zone applies). */
async function today(db: Db): Promise<string> {
  const r = await sql<{ d: string }>`SELECT p4_business_date(now(), 'Asia/Riyadh')::text AS d`.execute(db);
  return r.rows[0]!.d;
}

/** A transformation with one active monthly KPI (staleAfterDays 30) and the open period that contains today. */
async function seed(db: Db): Promise<World> {
  const { transformationId, userId } = await seedTransformationWithOutbox(db);
  const { organization_id: organizationId } = await db
    .selectFrom("transformation")
    .select("organization_id")
    .where("id", "=", transformationId)
    .executeTakeFirstOrThrow();
  const kpiId = randomUUID();
  const versionId = randomUUID();
  const periodId = randomUUID();
  const d = await today(db);
  const monthStart = `${d.slice(0, 7)}-01`;
  await db.transaction().execute(async (tx) => {
    const audit = (recordType: string, recordId: string, action: string, withT = true) =>
      insertAuditEvent(tx, userActor(userId), {
        action,
        recordType,
        recordId,
        organizationId,
        ...(withT ? { transformationId } : {}),
        newVersion: 1,
      });
    await tx
      .insertInto("kpi_definition")
      .values({
        id: kpiId,
        organization_id: organizationId,
        transformation_id: transformationId,
        name: "Synthetic data-feed KPI",
        unit_kind: "percentage",
        polarity: "higher_is_better",
        status: "active",
        owner_user_id: userId,
        created_by: userId,
        updated_by: userId,
      })
      .execute();
    await audit("kpi_definition", kpiId, "kpi_definition.create");
    await tx
      .insertInto("reporting_period")
      .values({
        id: periodId,
        organization_id: organizationId,
        frequency: "monthly",
        period_label: d.slice(0, 7),
        period_start: monthStart,
        period_end: sql<string>`(date_trunc('month', ${monthStart}::date) + interval '1 month - 1 day')::date`,
        status: "open",
        opened_at: sql<Date>`now()`,
        created_by: userId,
        updated_by: userId,
      })
      .execute();
    await audit("reporting_period", periodId, "reporting_period.create", false);
  });
  // A direct-approval version (no business approval involved), created as a draft and activated, each step audited.
  await db.transaction().execute(async (tx) => {
    await tx
      .insertInto("kpi_version")
      .values({
        id: versionId,
        organization_id: organizationId,
        transformation_id: transformationId,
        kpi_definition_id: kpiId,
        version_no: 1,
        measure_type: "higher_is_better",
        value_nature: "ratio",
        unit_kind: "percentage",
        frequency: "monthly",
        aggregation_rule: "weighted_ratio",
        numerator_label: "Synthetic active users",
        denominator_label: "Synthetic eligible users",
        submission_route: "direct_accept",
        dq_stale_after_days: 30,
        created_by: userId,
        updated_by: userId,
      })
      .execute();
    await insertAuditEvent(tx, userActor(userId), {
      action: "kpi_version.create",
      recordType: "kpi_version",
      recordId: versionId,
      organizationId,
      transformationId,
      newVersion: 1,
    });
    await tx
      .updateTable("kpi_version")
      .set({ status: "active", activated_at: sql<Date>`now()`, activated_by: userId, version: 2 })
      .where("id", "=", versionId)
      .execute();
    await insertAuditEvent(tx, userActor(userId), {
      action: "kpi_version.activate",
      recordType: "kpi_version",
      recordId: versionId,
      organizationId,
      transformationId,
      priorVersion: 1,
      newVersion: 2,
    });
  });
  return { organizationId, transformationId, userId, kpiId, versionId, periodId };
}

/** One synthetic calculation run whose period evaluation carries `value` with data as of `dataAsOf` (KBE-C's shape). */
async function evaluate(db: Db, w: World, value: string, dataAsOf: string): Promise<string> {
  const runId = randomUUID();
  const evaluationId = randomUUID();
  await db.transaction().execute(async (tx) => {
    await tx
      .insertInto("calculation_run")
      .values({
        id: runId,
        organization_id: w.organizationId,
        transformation_id: w.transformationId,
        trigger_kind: "actual_accepted",
        trigger_record_type: "kpi_actual",
        trigger_record_id: randomUUID(),
        trigger_slot: 1,
        idempotency_key: `test-run:${runId}`,
        status: "completed",
        evaluation_count: 1,
        formula_engine_version: "synthetic",
        kpi_rules_version: "mth-kpi/1.0.0",
        started_at: sql<Date>`now()`,
      })
      .execute();
    await tx
      .insertInto("kpi_evaluation")
      .values({
        id: evaluationId,
        organization_id: w.organizationId,
        transformation_id: w.transformationId,
        calculation_run_id: runId,
        kpi_definition_id: w.kpiId,
        kpi_version_id: w.versionId,
        scope_kind: "transformation",
        scope_id: w.transformationId,
        reporting_period_id: w.periodId,
        period_label: "P",
        value_basis: "period",
        value,
        value_status: "ok",
        value_reason: null,
        value_source: "entered",
        trend: "unknown",
        calculated_rag: "green",
        deviation: "within",
        threshold_source: "default",
        explanation_key: "kpi.rag.synthetic",
        data_as_of: dataAsOf,
      })
      .execute();
  });
  return evaluationId;
}

/** Holds `roleCode` at the organization (an `operations.acknowledge` holder for ADM_TECH and KDS; 0103). */
async function grantAtOrganization(w: World, roleCode: string, userId: string): Promise<void> {
  const role = await env.db.selectFrom("role").select("id").where("code", "=", roleCode).executeTakeFirstOrThrow();
  await env.owner.query(
    `INSERT INTO scoped_assignment (id, organization_id, user_id, role_id, scope_type, scope_id, reason, granted_by)
     VALUES ($1, $2, $3, $4, 'organization', $2, 'synthetic fixture', $3)`,
    [randomUUID(), w.organizationId, userId, role.id],
  );
}

async function newUser(w: World): Promise<string> {
  const id = randomUUID();
  await env.db
    .insertInto("app_user")
    .values({
      id,
      organization_id: w.organizationId,
      display_name: "Synthetic admin",
      created_by: null,
      updated_by: null,
    })
    .execute();
  return id;
}

const scan = (w: World | null, tag: string) =>
  FRESHNESS_SCAN_HANDLER.handle(env.db, w === null ? {} : { organizationId: w.organizationId }, `scan-${tag}`);
const sweep = (w: World | null, tag: string) =>
  EXCEPTION_ALERTS_HANDLER.handle(env.db, w === null ? {} : { organizationId: w.organizationId }, `alerts-${tag}`);

async function staleEvents(w: World) {
  return env.db
    .selectFrom("outbox_event")
    .select(["id", "organization_id", "event_type", "schema_version", "payload", "idempotency_key"])
    .where("event_type", "=", DATA_STALE_EVENT)
    .where("organization_id", "=", w.organizationId)
    .orderBy("seq")
    .execute();
}

const envelopeOf = (e: Awaited<ReturnType<typeof staleEvents>>[number]) => ({
  outboxEventId: e.id,
  eventType: e.event_type,
  schemaVersion: e.schema_version,
  idempotencyKey: e.idempotency_key,
  organizationId: e.organization_id,
  payload: e.payload as Record<string, unknown>,
});

const exceptionsOf = (w: World) =>
  env.db
    .selectFrom("operational_exception")
    .selectAll()
    .where("organization_id", "=", w.organizationId)
    .where("source_code", "=", `kpi:${w.kpiId}`)
    .orderBy("first_occurred_at")
    .execute();

// ---------------------------------------------------------------------------------------------- qa-verifier probe
// REQ-S12-019 "when a connector or job fails or DATA BECOMES STALE, create a visible operational exception and retain
// last known values with freshness labels". The candidate's own test puts the stale evaluation INTO the current open
// period. Here the last accepted data sits in the PREVIOUS month's period and the current month's period is open (as
// the kpi.reporting_period_open job opens it) with no data yet: the KPI's data is stale by the same rule.
async function previousPeriodWith(w: World, value: string, dataAsOf: string): Promise<string> {
  const prevId = randomUUID();
  const d = await today(env.db);
  const monthStart = `${d.slice(0, 7)}-01`;
  await env.db.transaction().execute(async (tx) => {
    await tx
      .insertInto("reporting_period")
      .values({
        id: prevId,
        organization_id: w.organizationId,
        frequency: "monthly",
        period_label: "prev",
        period_start: sql<string>`(date_trunc('month', ${monthStart}::date) - interval '1 month')::date`,
        period_end: sql<string>`(date_trunc('month', ${monthStart}::date) - interval '1 day')::date`,
        status: "open",
        opened_at: sql<Date>`now()`,
        created_by: w.userId,
        updated_by: w.userId,
      })
      .execute();
    await insertAuditEvent(tx, userActor(w.userId), {
      action: "reporting_period.create",
      recordType: "reporting_period",
      recordId: prevId,
      organizationId: w.organizationId,
      newVersion: 1,
    });
  });
  await evaluate(env.db, { ...w, periodId: prevId }, value, dataAsOf);
  return prevId;
}

describe("QA-DG6R1 probe: REQ-S12-019 stale data once a later period is open", () => {
  it("control: stale evaluation in the newest period -> the scan counts it stale (1) and emits one data.stale", async () => {
    const w = await seed(env.db);
    await evaluate(env.db, w, "0.4125", "2026-01-15");
    const r = (await scan(w, "ctl")) as { stale: number; emitted: number };
    console.log(`PROBE control: ${JSON.stringify(r)}`);
    expect([r.stale, r.emitted]).toEqual([1, 1]);
  });
  it("probe: last data (as of 2026-01-15) in the previous period, the current period open and empty -> expected stale 1, one data.stale", async () => {
    const w = await seed(env.db);
    await previousPeriodWith(w, "0.4125", "2026-01-15");
    const read = await kpiFreshness(
      env.db,
      { id: w.kpiId, organization_id: w.organizationId, transformation_id: w.transformationId, frequency: "monthly" },
      await today(env.db),
    );
    const r = (await scan(w, "probe")) as { stale: number; emitted: number };
    const events = await staleEvents(w);
    console.log(`PROBE later-period: kpiFreshness=${JSON.stringify(read)} scan=${JSON.stringify(r)} data.stale events=${events.length}`);
    expect.soft(read.freshness, "kpiFreshness of a KPI whose last data is 2026-01-15 (window 30 days)").toBe("stale");
    expect.soft([r.stale, r.emitted], "scan result").toEqual([1, 1]);
    expect(events, "data.stale events").toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------------------------- qa-verifier round 2
// Adversarial cases beyond the candidate's regression tests (T-DG6-REV-QA-R2): two empty later periods; a fresher value
// in a later period must win over an older stale one (no false stale); and recovery once data arrives in the current
// period after a stale episode in an earlier one.
async function periodBack(w: World, monthsBack: number, status: "open" | "closed"): Promise<string> {
  const id = randomUUID();
  const d = await today(env.db);
  await env.db.transaction().execute(async (tx) => {
    await tx
      .insertInto("reporting_period")
      .values({
        id,
        organization_id: w.organizationId,
        frequency: "monthly",
        period_label: `QA-BACK-${monthsBack}`,
        period_start: sql<string>`(date_trunc('month', ${d}::date) - make_interval(months => ${monthsBack}))::date`,
        period_end: sql<string>`(date_trunc('month', ${d}::date) - make_interval(months => ${monthsBack - 1}) - interval '1 day')::date`,
        status,
        opened_at: sql<Date>`now()`,
        closed_at: status === "closed" ? sql<Date>`now()` : null,
        created_by: w.userId,
        updated_by: w.userId,
      })
      .execute();
    await insertAuditEvent(tx, userActor(w.userId), {
      action: "reporting_period.create",
      recordType: "reporting_period",
      recordId: id,
      organizationId: w.organizationId,
      newVersion: 1,
    });
  });
  return id;
}
const minusDays = async (n: number) =>
  (await sql<{ d: string }>`SELECT (p4_business_date(now(), 'Asia/Riyadh') - ${n}::int)::text AS d`.execute(env.db)).rows[0]!.d;
const readQa = async (w: World) =>
  kpiFreshness(
    env.db,
    { id: w.kpiId, organization_id: w.organizationId, transformation_id: w.transformationId, frequency: "monthly" },
    await today(env.db),
  );

describe("QA-DG6R2 adversarial: freshness from the latest accepted value across periods", () => {
  it("A: data in the period two months back (closed), the previous AND current periods open and empty -> stale, one event", async () => {
    const w = await seed(env.db);
    const p2 = await periodBack(w, 2, "closed");
    await periodBack(w, 1, "open");
    const asOf = await minusDays(70);
    await evaluate(env.db, { ...w, periodId: p2 }, "0.31", asOf);
    const read = await readQa(w);
    const r = (await scan(w, "qa-a")) as { stale: number; emitted: number };
    const r2 = (await scan(w, "qa-a2")) as { stale: number; emitted: number };
    console.log(`PROBE-R2 A: read=${JSON.stringify(read)} scan1=${JSON.stringify(r)} scan2=${JSON.stringify(r2)}`);
    expect([read.freshness, read.lastValue, read.dataAsOf]).toEqual(["stale", "0.31", asOf]);
    expect([r.stale, r.emitted]).toEqual([1, 1]);
    expect([r2.stale, r2.emitted]).toEqual([1, 0]);
    expect(await staleEvents(w)).toHaveLength(1);
  });

  it("B: an old stale value two months back but a FRESH value in the previous period -> fresh, no event (no false stale)", async () => {
    const w = await seed(env.db);
    const p2 = await periodBack(w, 2, "closed");
    const p1 = await periodBack(w, 1, "closed");
    await evaluate(env.db, { ...w, periodId: p2 }, "0.10", await minusDays(80));
    const fresh = await minusDays(3);
    await evaluate(env.db, { ...w, periodId: p1 }, "0.9", fresh); // "0.9": numeric output form (the first run used "0.90" and failed only on that text)
    const read = await readQa(w);
    const r = (await scan(w, "qa-b")) as { stale: number; emitted: number };
    console.log(`PROBE-R2 B: read=${JSON.stringify(read)} scan=${JSON.stringify(r)}`);
    expect([read.freshness, read.lastValue, read.dataAsOf]).toEqual(["fresh", "0.9", fresh]);
    expect([r.stale, r.emitted]).toEqual([0, 0]);
    expect(await staleEvents(w)).toHaveLength(0);
  });

  it("D: stale in the previous period (event 1), then fresh data lands in the current period -> fresh, no new event", async () => {
    const w = await seed(env.db);
    const p1 = await periodBack(w, 1, "closed");
    await evaluate(env.db, { ...w, periodId: p1 }, "0.20", await minusDays(65));
    const r1 = (await scan(w, "qa-d1")) as { stale: number; emitted: number };
    const fresh = await minusDays(1);
    await evaluate(env.db, w, "0.55", fresh);
    const read = await readQa(w);
    const r2 = (await scan(w, "qa-d2")) as { stale: number; emitted: number };
    console.log(`PROBE-R2 D: scan1=${JSON.stringify(r1)} read=${JSON.stringify(read)} scan2=${JSON.stringify(r2)}`);
    expect([r1.stale, r1.emitted]).toEqual([1, 1]);
    expect([read.freshness, read.lastValue]).toEqual(["fresh", "0.55"]);
    expect([r2.stale, r2.emitted]).toEqual([0, 0]);
    expect(await staleEvents(w)).toHaveLength(1);
  });
});
