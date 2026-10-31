// The last known value of a linked KPI while a LATER reporting period is open (T-DG6-BE-X4; REQ-S12-019 acceptance
// "A17;A22: a failing test connector produces one exception and the KPI shows Stale with its last value and date";
// M0239 "retain last known values with freshness labels"; ADR-0053 §2; contract getOperationalException
// `linkedKpis[].lastValue` "Last known accepted value"), against the run's disposable PostgreSQL.
//
// The real-world case: the current month's period is open and the failing feed never filled it. getOperationalException
// must still show the KPI's last value, its date and its DG4 freshness label (ADR-0028 read-time rule), read from the
// KPI's latest open or closed period of its frequency whose panel evaluation (highest run seq) carries a value, never
// only the organization's newest period. The same values as the DG4 panel for that period (parity). A KPI with no value
// in any period stays Unknown with nulls (never 0). The DG4 panel's own default period is unchanged.
//
// The exception is raised by the worker's real jobs (kpi.freshness_scan -> data.stale -> operations.exception_raise)
// with `{ organizationId }`, so only this file's organization is touched. Every value is SYNTHETIC; nothing here
// approves anything (not a business approval, G1-G6) or touches DG0-DG7, and no job writes a KPI value.
import { randomUUID } from "node:crypto";
import { insertAuditEvent, sql } from "@mth/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  DATA_STALE_EVENT,
  EXCEPTION_RAISE_HANDLER,
  FRESHNESS_SCAN_HANDLER,
  setOperationsAlertLogger,
} from "../../../../worker/src/handlers/operations.ts";
import {
  call,
  createTransformationRow,
  seedWorld,
  signIn,
  startApi,
  type Session,
  type TestApi,
  type World,
} from "../../support/harness.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const L = "/api/v1/admin/operations/exceptions";

let api: TestApi;
let w: World;
let office: Session;
let admin: Session;
let officeB: Session;
let t: string;
let otherT: string;
let kpiId: string;
let versionId: string;
let otherKpiId: string;
let otherVersionId: string;
let januaryId: string;
let exceptionId: string;

const actor = (userId: string) =>
  ({ actorType: "user", actorUserId: userId, requestId: `be-x4-${randomUUID()}`, source: "api" }) as const;

async function businessToday(): Promise<string> {
  const r = await sql<{ d: string }>`SELECT p4_business_date(now(), 'Asia/Riyadh')::text AS d`.execute(api.db);
  return r.rows[0]!.d;
}

/** A synthetic monthly reporting period of organization A (with its audit event). */
async function period(label: string, status: "scheduled" | "open" | "closed"): Promise<string> {
  const id = randomUUID();
  const by = w.office.id;
  await api.db.transaction().execute(async (tx) => {
    await tx
      .insertInto("reporting_period")
      .values({
        id,
        organization_id: w.orgA.id,
        frequency: "monthly",
        period_label: label,
        period_start: `${label}-01`,
        period_end: sql<string>`(date_trunc('month', ${`${label}-01`}::date) + interval '1 month - 1 day')::date`,
        status,
        opened_at: status === "scheduled" ? null : sql<Date>`now()`,
        closed_at: status === "closed" ? sql<Date>`now()` : null,
        created_by: by,
        updated_by: by,
      })
      .execute();
    await insertAuditEvent(tx, actor(by), {
      action: "reporting_period.create",
      recordType: "reporting_period",
      recordId: id,
      organizationId: w.orgA.id,
      newVersion: 1,
    });
  });
  return id;
}

/**
 * One synthetic calculation run with one period evaluation (KBE-C's shape). `value` null writes an Unknown evaluation
 * (`kpi.no_accepted_actual`), as a run over a period without an accepted actual does.
 */
async function evaluate(
  slot: { transformationId: string; kpiDefinitionId: string; kpiVersionId: string; periodId: string },
  value: string | null,
  dataAsOf: string | null,
): Promise<void> {
  const runId = randomUUID();
  await api.db.transaction().execute(async (tx) => {
    await tx
      .insertInto("calculation_run")
      .values({
        id: runId,
        organization_id: w.orgA.id,
        transformation_id: slot.transformationId,
        trigger_kind: "actual_accepted",
        trigger_record_type: "kpi_actual",
        trigger_record_id: randomUUID(),
        trigger_slot: 1,
        idempotency_key: `be-x4-run:${runId}`,
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
        id: randomUUID(),
        organization_id: w.orgA.id,
        transformation_id: slot.transformationId,
        calculation_run_id: runId,
        kpi_definition_id: slot.kpiDefinitionId,
        kpi_version_id: slot.kpiVersionId,
        scope_kind: "transformation",
        scope_id: slot.transformationId,
        reporting_period_id: slot.periodId,
        period_label: "P",
        value_basis: "period",
        value,
        value_status: value === null ? "unknown" : "ok",
        value_reason: value === null ? "kpi.no_accepted_actual" : null,
        value_source: "entered",
        trend: "unknown",
        calculated_rag: value === null ? "unknown" : "green",
        deviation: value === null ? "unknown" : "within",
        threshold_source: "default",
        explanation_key: "kpi.rag.synthetic",
        data_as_of: dataAsOf,
      })
      .execute();
  });
}

/** A synthetic monthly count KPI with an active version (staleAfterDays 30) on transformation `tid`. */
async function kpi(tid: string, name: string): Promise<{ id: string; versionId: string }> {
  const id = randomUUID();
  const vid = randomUUID();
  const by = w.office.id;
  await api.db.transaction().execute(async (tx) => {
    await tx
      .insertInto("kpi_definition")
      .values({
        id,
        organization_id: w.orgA.id,
        transformation_id: tid,
        name,
        unit_kind: "count",
        polarity: "higher_is_better",
        status: "active",
        owner_user_id: by,
        created_by: by,
        updated_by: by,
      })
      .execute();
    await insertAuditEvent(tx, actor(by), {
      action: "kpi_definition.create",
      recordType: "kpi_definition",
      recordId: id,
      organizationId: w.orgA.id,
      transformationId: tid,
      newVersion: 1,
    });
    await tx
      .insertInto("kpi_version")
      .values({
        id: vid,
        organization_id: w.orgA.id,
        transformation_id: tid,
        kpi_definition_id: id,
        version_no: 1,
        measure_type: "higher_is_better",
        value_nature: "flow",
        unit_kind: "count",
        frequency: "monthly",
        aggregation_rule: "sum",
        submission_route: "direct_accept",
        dq_stale_after_days: 30,
        created_by: by,
        updated_by: by,
      })
      .execute();
    await insertAuditEvent(tx, actor(by), {
      action: "kpi_version.create",
      recordType: "kpi_version",
      recordId: vid,
      organizationId: w.orgA.id,
      transformationId: tid,
      newVersion: 1,
    });
    await tx
      .updateTable("kpi_version")
      .set({ status: "active", activated_at: sql<Date>`now()`, activated_by: by, version: 2 })
      .where("id", "=", vid)
      .execute();
    await insertAuditEvent(tx, actor(by), {
      action: "kpi_version.activate",
      recordType: "kpi_version",
      recordId: vid,
      organizationId: w.orgA.id,
      transformationId: tid,
      priorVersion: 1,
      newVersion: 2,
    });
  });
  return { id, versionId: vid };
}

const slot = (periodId: string) => ({ transformationId: t, kpiDefinitionId: kpiId, kpiVersionId: versionId, periodId });

async function linked(session: Session): Promise<Body> {
  const got = await call<Body>(api.app, "GET", `${L}/${exceptionId}`, { session });
  expect(got.status, JSON.stringify(got.body)).toBe(200);
  return got.body;
}

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  office = await signIn(api.app, w.office.subject);
  admin = await signIn(api.app, w.admin.subject);
  officeB = await signIn(api.app, w.officeB.subject);
  setOperationsAlertLogger({ error: () => undefined });
  t = await createTransformationRow(api.db, w.orgA.id, w.a1, w.grantor.id);
  otherT = await createTransformationRow(api.db, w.orgA.id, w.a1, w.grantor.id);
  ({ id: kpiId, versionId } = await kpi(t, "Synthetic connector-fed KPI"));
  ({ id: otherKpiId, versionId: otherVersionId } = await kpi(otherT, "Synthetic other KPI"));
  // The last accepted actual: 250.75 as of 2026-01-31 in the closed January period (older than staleAfterDays).
  januaryId = await period("2026-01", "closed");
  await evaluate(slot(januaryId), "250.75", "2026-01-31");
  // The exception, raised by the worker's real jobs while January is the newest period.
  expect(await FRESHNESS_SCAN_HANDLER.handle(api.db, { organizationId: w.orgA.id }, "be-x4-scan-1")).toMatchObject({
    stale: 1,
    emitted: 1,
  });
  const events = await api.db
    .selectFrom("outbox_event")
    .select(["id", "organization_id", "event_type", "schema_version", "payload", "idempotency_key"])
    .where("event_type", "=", DATA_STALE_EVENT)
    .where("aggregate_id", "=", kpiId)
    .orderBy("seq")
    .execute();
  expect(events).toHaveLength(1);
  const e = events[0]!;
  await EXCEPTION_RAISE_HANDLER.handle(
    api.db,
    {
      outboxEventId: e.id,
      eventType: e.event_type,
      schemaVersion: e.schema_version,
      idempotencyKey: e.idempotency_key,
      organizationId: e.organization_id,
      payload: e.payload,
    },
    "be-x4-raise-1",
  );
  const row = await api.db
    .selectFrom("operational_exception")
    .select("id")
    .where("organization_id", "=", w.orgA.id)
    .where("source_code", "=", `kpi:${kpiId}`)
    .executeTakeFirstOrThrow();
  exceptionId = row.id;
});

afterAll(async () => {
  setOperationsAlertLogger(null);
  await api?.close();
});

describe("a linked KPI keeps its last known value while a later period is open (REQ-S12-019; ADR-0053 §2)", () => {
  const stale = {
    freshness: "stale",
    lastValue: "250.75",
    // The start of the data-as-of business date 2026-01-31 in Asia/Riyadh (UTC+3).
    lastValueAt: "2026-01-30T21:00:00.000Z",
  };

  it("baseline: January is the newest period; the data owner sees Stale, 250.75 and the date", async () => {
    const body = await linked(office);
    expect([body.linkedKpis.length, body.hiddenKpiCount]).toEqual([1, 0]);
    expect(body.linkedKpis[0]).toMatchObject({ kpiDefinitionId: kpiId, transformationId: t, ...stale });
  });

  it("a later open period WITHOUT an evaluation (the failing feed never filled it): still Stale, 250.75 and the date", async () => {
    await period("2026-02", "closed");
    await period((await businessToday()).slice(0, 7), "open");
    const body = await linked(office);
    expect(body.linkedKpis).toEqual([
      {
        kpiDefinitionId: kpiId,
        transformationId: t,
        name: "Synthetic connector-fed KPI",
        unitKind: "count",
        ...stale,
      },
    ]);
  });

  it("parity with the DG4 panel for the period that holds the value; the panel's own default period is unchanged", async () => {
    const forJanuary = await call<Body>(
      api.app,
      "GET",
      `/api/v1/transformations/${t}/kpi-definitions/${kpiId}/status?scopeKind=transformation&scopeId=${t}&reportingPeriodId=${januaryId}`,
      { session: office },
    );
    expect(forJanuary.status, JSON.stringify(forJanuary.body)).toBe(200);
    expect([forJanuary.body.actual, forJanuary.body.freshness.status, forJanuary.body.freshness.dataAsOf]).toEqual([
      "250.75",
      "stale",
      "2026-01-31",
    ]);
    // The panel without a period answers for the KPI's current (newest) period, as in DG4: Unknown, never 0 or green.
    const current = await call<Body>(api.app, "GET", `/api/v1/transformations/${t}/kpi-definitions/${kpiId}/status`, {
      session: office,
    });
    expect(current.status, JSON.stringify(current.body)).toBe(200);
    expect(current.body.actual).toBeNull();
    expect(current.body.freshness.status).not.toBe("fresh");
    expect(current.body.reportingPeriodId).not.toBe(januaryId);
  });

  it("an Unknown evaluation of a later period, a later SCHEDULED period with a value and another transformation's value never hide or replace it", async () => {
    const current = await api.db
      .selectFrom("reporting_period")
      .select("id")
      .where("organization_id", "=", w.orgA.id)
      .where("frequency", "=", "monthly")
      .where("status", "=", "open")
      .executeTakeFirstOrThrow();
    await evaluate(slot(current.id), null, null);
    const scheduled = await period("2099-12", "scheduled");
    await evaluate(slot(scheduled), "999", "2026-01-31");
    await evaluate(
      { transformationId: otherT, kpiDefinitionId: otherKpiId, kpiVersionId: otherVersionId, periodId: current.id },
      "777",
      await businessToday(),
    );
    expect((await linked(office)).linkedKpis[0]).toMatchObject(stale);
  });

  it("a recalculation of the same period (higher run seq) gives that period's newest value", async () => {
    await evaluate(slot(januaryId), "251.5", "2026-01-31");
    expect((await linked(office)).linkedKpis[0]).toMatchObject({ ...stale, lastValue: "251.5" });
  });

  it("authorization is unchanged: the admin without transformation.read only counts it; another organization gets 404", async () => {
    const body = await linked(admin);
    expect([body.linkedKpis, body.hiddenKpiCount]).toEqual([[], 1]);
    expect((await call<Body>(api.app, "GET", `${L}/${exceptionId}`, { session: officeB })).status).toBe(404);
  });

  it("a value in the later period then becomes the last value, Fresh with today's date", async () => {
    const today = await businessToday();
    const current = await api.db
      .selectFrom("reporting_period")
      .select("id")
      .where("organization_id", "=", w.orgA.id)
      .where("frequency", "=", "monthly")
      .where("status", "=", "open")
      .executeTakeFirstOrThrow();
    await evaluate(slot(current.id), "260", today);
    const got = (await linked(office)).linkedKpis[0];
    expect([got.freshness, got.lastValue]).toEqual(["fresh", "260"]);
    expect(got.lastValueAt).not.toBe(stale.lastValueAt);
  });
});

describe("a linked KPI with no value in any period stays Unknown (never 0)", () => {
  it("only Unknown evaluations: freshness unknown, lastValue and lastValueAt null", async () => {
    // A second KPI linked to the same exception (the consumer's insert, ADR-0053 §2) whose every evaluation is Unknown.
    const lone = await kpi(t, "Synthetic never-filled KPI");
    const current = await api.db
      .selectFrom("reporting_period")
      .select("id")
      .where("organization_id", "=", w.orgA.id)
      .where("frequency", "=", "monthly")
      .where("status", "=", "open")
      .executeTakeFirstOrThrow();
    await evaluate(
      { transformationId: t, kpiDefinitionId: lone.id, kpiVersionId: lone.versionId, periodId: januaryId },
      null,
      null,
    );
    await evaluate(
      { transformationId: t, kpiDefinitionId: lone.id, kpiVersionId: lone.versionId, periodId: current.id },
      null,
      null,
    );
    await api.db
      .insertInto("operational_exception_kpi")
      .values({
        id: randomUUID(),
        operational_exception_id: exceptionId,
        kpi_definition_id: lone.id,
        transformation_id: t,
        organization_id: w.orgA.id,
      })
      .execute();
    const body = await linked(office);
    expect(body.linkedKpis.find((k: Body) => k.kpiDefinitionId === lone.id)).toMatchObject({
      freshness: "unknown",
      lastValue: null,
      lastValueAt: null,
    });
  });
});
