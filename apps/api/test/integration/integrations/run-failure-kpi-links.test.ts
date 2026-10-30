// A connector's last failure links the KPIs its run feeds (T-DG6-BE-X2; F-DG6-QA-A-2; ADR-0053 §2 "connector classes:
// the KPIs the connector's mappings feed", ADR-0055 §1-§3; REQ-S12-019). Against the run's disposable PostgreSQL:
//  1. the failing run's `connector.run_failed` event names the KPIs of the connector's TARGET transformation that its
//     source rows name (the test adapter's fixture, through the connector's field mappings); a KPI of another
//     transformation, an unknown id and a non-id are never linked;
//  2. a KPI the connector staged before (its earlier batches) is linked even when the failing configuration names none;
//  3. a connector that feeds no KPI (`target_kind = none`) links none;
//  4. the worker's production consumer (`handleConnectorException`) opens exactly ONE exception linked to those KPIs, and
//     `getOperationalException` shows each with its DG4 freshness and last value; a redelivery adds nothing.
// Every value is SYNTHETIC. Nothing here approves anything (G1-G6) or touches DG0-DG7.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { handleConnectorException } from "../../../../worker/src/handlers/integrations.ts";
import { executeIntegrationRun, kpisFedBy } from "../../../src/modules/integrations/runs.ts";
import {
  call,
  seedWorld,
  signIn,
  startApi,
  uniq,
  type Session,
  type TestApi,
  type World,
} from "../../support/harness.ts";
import { DIRECT_FLOW, monthlyPeriod, ownedKpi, REVIEW_FLOW } from "../kpi-p4/kbe-c-fixtures.ts";
import { seedKpiWorld, type KpiWorld } from "../kpi/fixtures.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const CONNECTORS = "/api/v1/admin/connectors";
const EXCEPTIONS = "/api/v1/admin/operations/exceptions";

let api: TestApi;
let w: World;
let k: KpiWorld; // transformation T (the connectors' target)
let other: KpiWorld; // another transformation of the same organization
let admin: Session; // ADM_TECH @ A
let direct: string;
let review: string;
let foreign: string; // a KPI of the other transformation

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  k = await seedKpiWorld(api, w);
  other = await seedKpiWorld(api, w);
  admin = await signIn(api.app, w.admin.subject);
  direct = (await ownedKpi(api, k, DIRECT_FLOW)).id;
  review = (await ownedKpi(api, k, REVIEW_FLOW)).id;
  foreign = (await ownedKpi(api, other, DIRECT_FLOW)).id;
}, 180_000);

afterAll(async () => {
  await api?.close();
});

const ifm = (v: number) => ({ "if-match": `"${v}"` });

interface ConnectorOptions {
  readonly targetKind?: "kpi_actual" | "none";
  readonly adapterSettings: Record<string, unknown>;
  readonly fieldMappings?: { source: string; target: string }[];
}

function configBody(o: ConnectorOptions) {
  const targetKind = o.targetKind ?? "kpi_actual";
  return {
    sourceSystemId: "synthetic.be-x2:kpi-links",
    endpointUrl: null,
    credentialRefs: {},
    fieldMappings: o.fieldMappings ?? [],
    targetTransformationId: targetKind === "kpi_actual" ? k.transformationId : null,
    cadence: "manual",
    retryMaxAttempts: 0,
    retryBackoffSeconds: 10,
    commitMode: "manual",
    commitOnBehalfOf: null,
    outboundActions: [],
    reconciliationRule: "none",
    adapterSettings: o.adapterSettings,
    reason: "Synthetic connector for the BE-X2 KPI-link suite.",
  };
}

async function enabledConnector(o: ConnectorOptions): Promise<{ id: string; code: string }> {
  const code = uniq("x2k-").toLowerCase();
  const created = await call<Body>(api.app, "POST", CONNECTORS, {
    session: admin,
    body: {
      organizationId: w.orgA.id,
      code,
      nameEn: "Synthetic KPI source",
      nameAr: "مصدر مؤشرات اصطناعي",
      adapterKind: "test_adapter",
      targetKind: o.targetKind ?? "kpi_actual",
      config: configBody(o),
    },
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const enabled = await call<Body>(api.app, "POST", `${CONNECTORS}/${created.body.id}/enable`, {
    session: admin,
    headers: ifm(1),
    body: { reason: null },
  });
  expect(enabled.status, JSON.stringify(enabled.body)).toBe(200);
  return { id: created.body.id as string, code };
}

/** Queues a manual run and executes it (the API's run watch step for one run). */
async function runOnce(connectorId: string): Promise<{ id: string; status: string; error_code: string | null }> {
  const queued = await call<Body>(api.app, "POST", `${CONNECTORS}/${connectorId}/runs`, { session: admin, body: {} });
  expect(queued.status, JSON.stringify(queued.body)).toBe(202);
  await executeIntegrationRun(api.db, queued.body.id as string);
  return api.db
    .selectFrom("integration_run")
    .select(["id", "status", "error_code"])
    .where("id", "=", queued.body.id as string)
    .executeTakeFirstOrThrow();
}

async function failedEvent(runId: string) {
  return api.db
    .selectFrom("outbox_event")
    .select(["id", "organization_id", "event_type", "schema_version", "idempotency_key", "payload"])
    .where("aggregate_id", "=", runId)
    .where("event_type", "=", "connector.run_failed")
    .executeTakeFirstOrThrow();
}

const linksOf = (payload: unknown) => (payload as { kpiLinks?: unknown }).kpiLinks;
const sorted = (ids: string[]) =>
  [...ids].sort().map((id) => ({ kpiDefinitionId: id, transformationId: k.transformationId }));

describe("connector.run_failed names the KPIs the failing run feeds (ADR-0053 §2, ADR-0055)", () => {
  it("the fixture's KPIs of the target transformation, through the field mappings; never another transformation's", async () => {
    const rows = [
      { ref: direct, period: "2026-01", amount: "1" },
      { ref: review.toUpperCase(), period: "2026-02", amount: "2" }, // ids compare case-insensitively
      { ref: foreign, period: "2026-03", amount: "3" }, // another transformation: a row reason, never fed
      { ref: randomUUID(), period: "2026-04", amount: "4" }, // no such KPI
      { ref: "not-a-kpi-id", period: "2026-05", amount: "5" },
      { ref: direct, period: "2026-06", amount: "6" }, // the same KPI once
    ];
    const c = await enabledConnector({
      adapterSettings: { mode: "failing", fixture: { rows, controlColumn: "amount" } },
      fieldMappings: [
        { source: "ref", target: "kpi_id" },
        { source: "period", target: "period_label" },
        { source: "amount", target: "value" },
      ],
    });
    const run = await runOnce(c.id);
    expect(run).toMatchObject({ status: "failed", error_code: "connector.source_unavailable" });
    const event = await failedEvent(run.id);
    expect(linksOf(event.payload)).toEqual(sorted([direct, review]));
  });

  it("the A17 default fixture of a stopped connector links its kpiId", async () => {
    const c = await enabledConnector({ adapterSettings: { mode: "stopped", kpiId: direct } });
    const run = await runOnce(c.id);
    expect(run).toMatchObject({ status: "failed", error_code: "connector.stopped" });
    expect(linksOf((await failedEvent(run.id)).payload)).toEqual(sorted([direct]));
  });

  it("a KPI the connector staged before is linked although the failing configuration names none", async () => {
    const [p1] = [(await monthlyPeriod(api, w)).label];
    const healthyRows = [
      {
        source_record_id: "X2-H1",
        kpi_id: review,
        scope_kind: "transformation",
        scope_id: k.transformationId,
        period_label: p1!,
        value: "5",
        data_as_of: "2041-01-31",
      },
    ];
    const c = await enabledConnector({
      adapterSettings: { mode: "healthy", fixture: { rows: healthyRows, controlColumn: "value" } },
    });
    const ok = await runOnce(c.id);
    expect(ok.status, JSON.stringify(ok)).toBe("succeeded");
    // Version 2: failing, with a fixture whose rows name no KPI (an http_pull source that stopped answering stands the same).
    const current = await call<Body>(api.app, "GET", `${CONNECTORS}/${c.id}`, { session: admin });
    const put = await call<Body>(api.app, "PUT", `${CONNECTORS}/${c.id}`, {
      session: admin,
      headers: ifm(current.body.version as number),
      body: {
        nameEn: "Synthetic KPI source",
        nameAr: "مصدر مؤشرات اصطناعي",
        config: configBody({ adapterSettings: { mode: "failing", fixture: { rows: [], controlColumn: "value" } } }),
      },
    });
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    const failed = await runOnce(c.id);
    expect(failed.status).toBe("failed");
    expect(linksOf((await failedEvent(failed.id)).payload)).toEqual(sorted([review]));
  });

  it("a connector that feeds no KPI (target none) links none", async () => {
    const c = await enabledConnector({ targetKind: "none", adapterSettings: { mode: "failing", kpiId: direct } });
    const run = await runOnce(c.id);
    expect(run.status).toBe("failed");
    expect(linksOf((await failedEvent(run.id)).payload)).toEqual([]);
    const connector = await api.db.selectFrom("connector").selectAll().where("id", "=", c.id).executeTakeFirstOrThrow();
    const config = await api.db
      .selectFrom("connector_config_version")
      .selectAll()
      .where("connector_id", "=", c.id)
      .where("version_no", "=", connector.config_version_no)
      .executeTakeFirstOrThrow();
    expect(await kpisFedBy(api.db, connector, config)).toEqual([]);
  });
});

describe("the worker's consumer links the exception to those KPIs, once (REQ-S12-019; F-DG6-QA-A-2)", () => {
  it("exactly one exception, linked to the fed KPI, shown with its DG4 freshness; a redelivery adds nothing", async () => {
    const c = await enabledConnector({ adapterSettings: { mode: "failing", kpiId: direct } });
    const run = await runOnce(c.id);
    expect(run.status).toBe("failed");
    const event = await failedEvent(run.id);
    const envelope = {
      outboxEventId: event.id,
      eventType: event.event_type,
      schemaVersion: event.schema_version,
      idempotencyKey: event.idempotency_key,
      organizationId: event.organization_id!,
      payload: event.payload as Record<string, unknown>,
    };
    const first = await handleConnectorException(api.db, envelope, `x2-${randomUUID()}`);
    expect(first.outcome).toBe("raised");
    const again = await handleConnectorException(api.db, envelope, `x2-${randomUUID()}`);
    expect(again).toEqual({ outcome: "duplicate", exceptionIds: [] });
    const exceptions = await api.db
      .selectFrom("operational_exception")
      .select(["id", "status"])
      .where("source_kind", "=", "connector")
      .where("source_code", "=", c.code)
      .execute();
    expect(exceptions).toEqual([{ id: first.exceptionIds[0], status: "open" }]);
    const links = await api.db
      .selectFrom("operational_exception_kpi")
      .select(["kpi_definition_id", "transformation_id"])
      .where("operational_exception_id", "=", first.exceptionIds[0]!)
      .execute();
    expect(links).toEqual([{ kpi_definition_id: direct, transformation_id: k.transformationId }]);
    // Read by a holder of transformation.read at the KPI's transformation (the KPI panel's own gate, ADR-0053 §9).
    const office = await signIn(api.app, w.office.subject);
    const detail = await call<Body>(api.app, "GET", `${EXCEPTIONS}/${first.exceptionIds[0]}`, { session: office });
    expect(detail.status, JSON.stringify(detail.body)).toBe(200);
    expect(detail.body).toMatchObject({ linkedKpiCount: 1, hiddenKpiCount: 0 });
    const linked = (detail.body.linkedKpis as Body[]).find((x) => x.kpiDefinitionId === direct);
    expect(linked, JSON.stringify(detail.body.linkedKpis)).toBeDefined();
    // No actual exists for this KPI here: the last value is Unknown (null), never 0.
    expect(linked.lastValue).toBeNull();
  });
});
