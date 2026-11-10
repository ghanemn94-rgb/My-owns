// Graceful degradation with the test connector stopped (ADR-0055 §4; REQ-S17-005 "A17;A21: with the test connector
// stopped, a KPI actual can still be submitted by form, and the connector page shows an actionable error message";
// p6-work-split §B/A.8; T-DG6-BE-O), against the run's disposable PostgreSQL, through the API:
//  1. a kpi_actual test-adapter connector targeting the KPI world's transformation, in mode `stopped`, runs and fails
//     with `connector.stopped`;
//  2. the connector page (getConnector) then shows the actionable error: which run (runId, trigger, attempt, time), why
//     (the error code, rendered by the web catalogues with its why and what-to-do texts) and both fallbacks
//     (`kpi_form`, `import_file`); it is never shown verified or "live";
//  3. submitKpiActual by form succeeds exactly as without a connector (201, the DG4 direct-accept route);
//  4. createImport (a CSV of the kpi_actual.v1 template) succeeds and stages its rows;
//  5. the same holds with the connector disabled: no KPI or import route reads a connector's status.
// Every value is SYNTHETIC. The test adapter is the only source exercised: nothing is "live" or "connected to Mobily",
// and nothing here approves anything (G1-G6) or touches DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { executeIntegrationRun } from "../../../src/modules/integrations/runs.ts";
import { KPI_ACTUAL_IMPORT_COLUMNS } from "../../../src/modules/kpi/import-target.ts";
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
import { ifm } from "../../support/p2-fixtures.ts";
import { DIRECT_FLOW, monthlyPeriod, ownedKpi, submitActual } from "../kpi-p4/kbe-c-fixtures.ts";
import { seedKpiWorld, type KpiWorld } from "../kpi/fixtures.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const L = "/api/v1/admin/connectors";

let api: TestApi;
let w: World;
let k: KpiWorld;
let admin: Session; // ADM_TECH @ A: configures connectors
let kpi: { id: string; versionId: string; name: string };

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  k = await seedKpiWorld(api, w);
  admin = await signIn(api.app, w.admin.subject);
  kpi = await ownedKpi(api, k, DIRECT_FLOW);
}, 120_000);
afterAll(() => api.close());

/** A synthetic kpi_actual test-adapter connector of org A targeting the KPI world's transformation; enabled. */
async function stoppedConnector(): Promise<string> {
  const created = await call<Body>(api.app, "POST", L, {
    session: admin,
    body: {
      organizationId: w.orgA.id,
      code: uniq("gd-").toLowerCase(),
      nameEn: "Synthetic KPI source",
      nameAr: "مصدر مؤشرات اصطناعي",
      adapterKind: "test_adapter",
      targetKind: "kpi_actual",
      config: {
        sourceSystemId: "synthetic.kpi-source:degradation",
        endpointUrl: null,
        credentialRefs: {},
        fieldMappings: [],
        targetTransformationId: k.transformationId,
        cadence: "manual",
        retryMaxAttempts: 0,
        retryBackoffSeconds: 60,
        commitMode: "manual",
        commitOnBehalfOf: null,
        outboundActions: [],
        reconciliationRule: "none",
        adapterSettings: { mode: "stopped", kpiId: kpi.id },
        reason: "Synthetic connector for the REQ-S17-005 test.",
      },
    },
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const enabled = await call<Body>(api.app, "POST", `${L}/${created.body.id}/enable`, {
    session: admin,
    headers: ifm(1),
    body: { reason: null },
  });
  expect(enabled.status, JSON.stringify(enabled.body)).toBe(200);
  return created.body.id as string;
}

const HEADER = KPI_ACTUAL_IMPORT_COLUMNS.map((c) => c.key);
function csv(rows: Record<string, string>[]): Buffer {
  return Buffer.from(
    [HEADER.join(","), ...rows.map((r) => HEADER.map((h) => r[h] ?? "").join(","))].join("\r\n") + "\r\n",
  );
}

async function formSubmitWorks(): Promise<void> {
  const period = await monthlyPeriod(api, w);
  const res = await submitActual(api, k, kpi.id, { reportingPeriodId: period.id, value: "120.5" });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  expect(res.body.actual).toMatchObject({
    kpiDefinitionId: kpi.id,
    reportingPeriodId: period.id,
    route: "direct_accept",
  });
}

async function importWorks(): Promise<void> {
  const period = await monthlyPeriod(api, w);
  const bytes = csv([
    {
      kpi_id: kpi.id,
      scope_kind: "transformation",
      scope_id: k.transformationId,
      period_label: period.label,
      value: "42",
      data_as_of: "2041-01-31",
    },
  ]);
  const res = await call<Body>(api.app, "POST", `${k.base}/imports?template=kpi_actual.v1`, {
    session: k.s.kds,
    headers: { "content-type": "text/csv", "x-file-name": "synthetic-fallback" },
    body: bytes,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  expect(res.body).toMatchObject({ status: "staged", rowsTotal: 1, rowsValid: 1, connectorId: null });
}

describe("REQ-S17-005: with the test connector stopped, the form and the import keep working", () => {
  it("the connector page shows the actionable error (which run, why, both fallbacks); form and import succeed", async () => {
    const id = await stoppedConnector();
    const queued = await call<Body>(api.app, "POST", `${L}/${id}/runs`, { session: admin, body: {} });
    expect(queued.status, JSON.stringify(queued.body)).toBe(202);
    const ran = await executeIntegrationRun(api.db, queued.body.id as string);
    expect(ran.run).toMatchObject({ status: "failed", error_code: "connector.stopped" });

    const page = await call<Body>(api.app, "GET", `${L}/${id}`, { session: k.s.auditor });
    expect(page.status, JSON.stringify(page.body)).toBe(200);
    expect(page.body.actionableError).toMatchObject({
      runId: queued.body.id,
      triggerKind: "manual",
      attemptNo: 1,
      errorCode: "connector.stopped",
      fallbacks: ["kpi_form", "import_file"],
    });
    expect(typeof page.body.actionableError.finishedAt).toBe("string");
    // Never green: no success, and the connector is not verified.
    expect(page.body.lastSuccessAt).toBeNull();
    expect(page.body.verification).not.toBe("verified");
    expect(JSON.stringify(page.body)).not.toMatch(/\blive\b|Mobily/i);

    await formSubmitWorks();
    await importWorks();
  });

  it("the same with the connector disabled: no KPI or import route reads a connector's status", async () => {
    const id = await stoppedConnector();
    const disabled = await call<Body>(api.app, "POST", `${L}/${id}/disable`, {
      session: admin,
      headers: ifm(2),
      body: { reason: "Synthetic: the source is retired." },
    });
    expect([disabled.status, disabled.body.status], JSON.stringify(disabled.body)).toEqual([200, "disabled"]);
    await formSubmitWorks();
    await importWorks();
  });
});
