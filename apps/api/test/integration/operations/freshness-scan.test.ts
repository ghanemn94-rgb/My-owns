// The KPI freshness scan seen through the API (T-DG6-BE-K2; ADR-0053 §2, §6; REQ-S12-019 acceptance "an exception is
// shown to admins and data owners; values display as Stale with last update time"; A17/A22 "the KPI shows Stale with
// its last value and date"), against the run's disposable PostgreSQL. A KPI whose last accepted actual is older than
// its staleAfterDays goes through the worker's real jobs (kpi.freshness_scan -> data.stale -> operations.exception_raise
// -> operations.exception_alerts, each under its service identity) and then:
//  - the DG4 KPI panel still answers Stale with the last value and its data-as-of date (unchanged DG4 response);
//  - getOperationalException shows exactly one `data_stale` exception linked to the KPI, with the same freshness label,
//    last value and date; listOperationalExceptions lists it; the auditor reads it (read-only) and cannot acknowledge;
//  - the acknowledge holder got one in-app alert; fresh data resolves the exception `recovered`.
// The jobs run with `{ organizationId }` so they touch only this file's organization (the database is shared by the
// run's files). Every value is SYNTHETIC; nothing here approves anything (not a business approval, G1-G6) or touches
// DG0-DG7, and no KPI value is written by the jobs.
import { randomUUID } from "node:crypto";
import { insertAuditEvent, sql } from "@mth/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  DATA_STALE_EVENT,
  EXCEPTION_ALERTS_HANDLER,
  EXCEPTION_RAISE_HANDLER,
  FRESHNESS_SCAN_HANDLER,
  setOperationsAlertLogger,
} from "../../../../worker/src/handlers/operations.ts";
import { ifm } from "../../support/p2-fixtures.ts";
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
let auditor: Session;
let t: string;
let kpiId: string;
let versionId: string;
let periodId: string;
const alerts: Record<string, unknown>[] = [];

const actor = (userId: string) =>
  ({ actorType: "user", actorUserId: userId, requestId: `be-k2-${randomUUID()}`, source: "api" }) as const;

async function businessToday(): Promise<string> {
  const r = await sql<{ d: string }>`SELECT p4_business_date(now(), 'Asia/Riyadh')::text AS d`.execute(api.db);
  return r.rows[0]!.d;
}

/** One synthetic calculation run whose period evaluation carries `value` with data as of `dataAsOf` (KBE-C's shape). */
async function evaluate(value: string, dataAsOf: string): Promise<void> {
  const runId = randomUUID();
  await api.db.transaction().execute(async (tx) => {
    await tx
      .insertInto("calculation_run")
      .values({
        id: runId,
        organization_id: w.orgA.id,
        transformation_id: t,
        trigger_kind: "actual_accepted",
        trigger_record_type: "kpi_actual",
        trigger_record_id: randomUUID(),
        trigger_slot: 1,
        idempotency_key: `be-k2-run:${runId}`,
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
        transformation_id: t,
        calculation_run_id: runId,
        kpi_definition_id: kpiId,
        kpi_version_id: versionId,
        scope_kind: "transformation",
        scope_id: t,
        reporting_period_id: periodId,
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
}

const jobs = {
  scan: (tag: string) => FRESHNESS_SCAN_HANDLER.handle(api.db, { organizationId: w.orgA.id }, `be-k2-scan-${tag}`),
  alerts: (tag: string) =>
    EXCEPTION_ALERTS_HANDLER.handle(api.db, { organizationId: w.orgA.id }, `be-k2-alerts-${tag}`),
  async raiseAll(tag: string) {
    const events = await api.db
      .selectFrom("outbox_event")
      .select(["id", "organization_id", "event_type", "schema_version", "payload", "idempotency_key"])
      .where("event_type", "=", DATA_STALE_EVENT)
      .where("aggregate_id", "=", kpiId)
      .orderBy("seq")
      .execute();
    for (const [i, e] of events.entries())
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
        `be-k2-raise-${tag}-${i}`,
      );
    return events.length;
  },
};

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  office = await signIn(api.app, w.office.subject);
  admin = await signIn(api.app, w.admin.subject);
  auditor = await signIn(api.app, w.auditor.subject);
  setOperationsAlertLogger({ error: (obj) => alerts.push(obj as Record<string, unknown>) });
  t = await createTransformationRow(api.db, w.orgA.id, w.a1, w.grantor.id);
  kpiId = randomUUID();
  versionId = randomUUID();
  periodId = randomUUID();
  const d = await businessToday();
  const by = w.office.id;
  await api.db.transaction().execute(async (tx) => {
    await tx
      .insertInto("kpi_definition")
      .values({
        id: kpiId,
        organization_id: w.orgA.id,
        transformation_id: t,
        name: "Synthetic feed-fed KPI",
        unit_kind: "percentage",
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
      recordId: kpiId,
      organizationId: w.orgA.id,
      transformationId: t,
      newVersion: 1,
    });
    await tx
      .insertInto("kpi_version")
      .values({
        id: versionId,
        organization_id: w.orgA.id,
        transformation_id: t,
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
        created_by: by,
        updated_by: by,
      })
      .execute();
    await insertAuditEvent(tx, actor(by), {
      action: "kpi_version.create",
      recordType: "kpi_version",
      recordId: versionId,
      organizationId: w.orgA.id,
      transformationId: t,
      newVersion: 1,
    });
    await tx
      .updateTable("kpi_version")
      .set({ status: "active", activated_at: sql<Date>`now()`, activated_by: by, version: 2 })
      .where("id", "=", versionId)
      .execute();
    await insertAuditEvent(tx, actor(by), {
      action: "kpi_version.activate",
      recordType: "kpi_version",
      recordId: versionId,
      organizationId: w.orgA.id,
      transformationId: t,
      priorVersion: 1,
      newVersion: 2,
    });
    // The organization's current monthly period (shared by every KPI of the organization in this file).
    await tx
      .insertInto("reporting_period")
      .values({
        id: periodId,
        organization_id: w.orgA.id,
        frequency: "monthly",
        period_label: d.slice(0, 7),
        period_start: `${d.slice(0, 7)}-01`,
        period_end: sql<string>`(date_trunc('month', ${`${d.slice(0, 7)}-01`}::date) + interval '1 month - 1 day')::date`,
        status: "open",
        opened_at: sql<Date>`now()`,
        created_by: by,
        updated_by: by,
      })
      .execute();
    await insertAuditEvent(tx, actor(by), {
      action: "reporting_period.create",
      recordType: "reporting_period",
      recordId: periodId,
      organizationId: w.orgA.id,
      newVersion: 1,
    });
  });
});

afterAll(async () => {
  setOperationsAlertLogger(null);
  await api?.close();
});

describe("a stale KPI through the API (REQ-S12-019; ADR-0053 §2)", () => {
  let exceptionId: string;

  it("one data_stale exception linked to the KPI; the KPI panel still shows Stale with its last value and date", async () => {
    await evaluate("0.4125", "2026-01-15");
    expect(await jobs.scan("1")).toMatchObject({ stale: 1, emitted: 1 });
    expect(await jobs.scan("2")).toMatchObject({ stale: 1, emitted: 0 });
    expect(await jobs.raiseAll("1")).toBe(1);
    expect(await jobs.raiseAll("1-replay")).toBe(1); // the same event again: a duplicate, nothing new

    // The DG4 panel (unchanged): Stale, last value and its data-as-of date; never 0 or green.
    const panel = await call<Body>(api.app, "GET", `/api/v1/transformations/${t}/kpi-definitions/${kpiId}/status`, {
      session: office,
    });
    expect(panel.status, JSON.stringify(panel.body)).toBe(200);
    expect([panel.body.actual, panel.body.actualStatus, panel.body.freshness]).toEqual([
      "0.4125",
      "stale",
      { status: "stale", dataAsOf: "2026-01-15", staleAfterDays: 30 },
    ]);

    const listed = await call<Body>(
      api.app,
      "GET",
      `${L}?organizationId=${w.orgA.id}&sourceKind=data_freshness&limit=100`,
      { session: office },
    );
    expect(listed.status, JSON.stringify(listed.body)).toBe(200);
    const mine = (listed.body.items as Body[]).filter((i) => i.sourceCode === `kpi:${kpiId}`);
    expect(mine).toHaveLength(1);
    exceptionId = mine[0].id;
    expect(mine[0]).toMatchObject({
      failureClass: "data_stale",
      status: "open",
      occurrenceCount: 1,
      lastErrorCode: "kpi.stale",
      linkedKpiCount: 1,
    });

    const got = await call<Body>(api.app, "GET", `${L}/${exceptionId}`, { session: office });
    expect(got.status).toBe(200);
    expect(got.body.hiddenKpiCount).toBe(0);
    expect(got.body.linkedKpis).toHaveLength(1);
    expect(got.body.linkedKpis[0]).toMatchObject({
      kpiDefinitionId: kpiId,
      transformationId: t,
      freshness: "stale",
      lastValue: "0.4125",
    });
    // The last update time: the start of the data-as-of business date in Asia/Riyadh (UTC+3).
    expect(got.body.linkedKpis[0].lastValueAt).toBe("2026-01-14T21:00:00.000Z");
    expect(got.body.events.map((e: Body) => e.eventKind)).toEqual(["opened"]);
  });

  it("the auditor reads it and is refused the acknowledgement (403); the acknowledge holder got one alert", async () => {
    const read = await call<Body>(api.app, "GET", `${L}/${exceptionId}`, { session: auditor });
    expect(read.status).toBe(200);
    const ack = await call<Body>(api.app, "POST", `${L}/${exceptionId}/acknowledge`, {
      session: auditor,
      headers: ifm(read.body.version),
      body: { note: "Synthetic acknowledgement" },
    });
    expect(ack.status).toBe(403);

    expect(await jobs.alerts("1")).toMatchObject({ alerted: 1 });
    expect(await jobs.alerts("2")).toMatchObject({ alerted: 0, notifications: 0 });
    const inbox = await api.db
      .selectFrom("inbox_notification")
      .select(["recipient_user_id", "message_key", "link_path"])
      .where("organization_id", "=", w.orgA.id)
      .where("dedupe_key", "like", `operational_exception:${exceptionId}:opened:%`)
      .execute();
    expect(inbox.map((n) => n.recipient_user_id)).toContain(w.admin.id);
    expect(inbox.map((n) => n.recipient_user_id)).not.toContain(w.auditor.id);
    expect(new Set(inbox.map((n) => n.message_key))).toEqual(new Set(["operations.exception_opened"]));
    expect(alerts.filter((a) => a["exceptionId"] === exceptionId)).toEqual([
      expect.objectContaining({ alert: true, alertCode: "data_stale" }),
    ]);
    // The admin's inbox shows it through the API (in-app first).
    const myInbox = await call<Body>(api.app, "GET", "/api/v1/me/inbox?limit=100", { session: admin });
    expect(myInbox.status, JSON.stringify(myInbox.body)).toBe(200);
    const alert = (myInbox.body.items as Body[]).find((i) => i.messageKey === "operations.exception_opened");
    expect(alert, JSON.stringify(myInbox.body)).toBeDefined();
    expect(alert.messageParams).toEqual({
      failureClass: "data_stale",
      sourceKind: "data_freshness",
      sourceCode: `kpi:${kpiId}`,
    });
  });

  it("fresh data again resolves the exception `recovered`; the panel shows the new value as fresh", async () => {
    await evaluate("0.4300", await businessToday());
    expect(await jobs.scan("3")).toMatchObject({ stale: 0, recovered: 1 });
    const got = await call<Body>(api.app, "GET", `${L}/${exceptionId}`, { session: office });
    expect([got.body.status, got.body.resolution, got.body.resolvedBy]).toEqual(["resolved", "recovered", null]);
    expect(got.body.linkedKpis[0]).toMatchObject({ freshness: "fresh", lastValue: "0.43" });
    const panel = await call<Body>(api.app, "GET", `/api/v1/transformations/${t}/kpi-definitions/${kpiId}/status`, {
      session: office,
    });
    expect([panel.body.actual, panel.body.freshness.status]).toEqual(["0.43", "fresh"]);
  });
});
