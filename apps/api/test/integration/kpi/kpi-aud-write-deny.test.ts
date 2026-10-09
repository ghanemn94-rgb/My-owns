// AUD write-deny over EVERY kpi mutation (ADR-0020 §4 (c), REQ-S10-001 / A12: "a read-only auditor can view but
// every write returns 403"). The list of operations is GENERATED from docs/api/openapi.yaml (every non-GET operation
// on the kpi resources), so a new kpi mutation cannot escape the sweep: it fails here until it has a probe body.
// For each one the auditor sends a VALID request with the right If-Match and must get 403, the record must be
// unchanged, and the only audit row of the request must be the authorization denial. The auditor can read the same
// records (200), which is why the answer is 403, not 404. All data is synthetic.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { operations } from "../../support/contract.ts";
import { auditOfRequest, call, seedWorld, startApi, type TestApi } from "../../support/harness.ts";
import { P4_OPERATION_IDS } from "../../support/p4-operations.ts";
import { ifMatch, seedKpiWorld, type KpiWorld } from "./fixtures.ts";

let api: TestApi;
let k: KpiWorld;
const ids = new Map<string, string>();

const KPI_PATH =
  /^\/api\/v1\/transformations\/\{transformationId\}\/(kpi-definitions|baselines|outcome-kpis|value-pools)(\/|$)/;
// The P2 kpi mutations only: the P4 slice A operations under the same paths (T-DG4-ARCH-02, p4-operations.ts) get
// their own AUD tests from KBE-B and KBE-C once routed (p4-work-split.md S-4), as the P2 sweep in aud-write-deny.test.ts
// skips P3 and P4.
const kpiMutations = operations.filter(
  (o) => o.method !== "GET" && KPI_PATH.test(o.path) && !P4_OPERATION_IDS.has(o.operationId),
);

/** A valid body for every kpi mutation (so the 403 is the authorization decision, not a 400). */
const PROBE_BODIES = new Map<string, () => unknown>([
  ["createKpiDefinition", () => ({ name: "AUD probe KPI", unitKind: "count", polarity: "higher_is_better" })],
  ["updateKpiDefinition", () => ({ unitLabel: "probe" })],
  ["archiveKpiDefinition", () => ({ reason: "AUD probe" })],
  ["activateKpiDefinition", () => undefined], // no request body (D-061 / F-DG2-201)
  ["createBaseline", () => ({ metric: "AUD probe", unit: "u", scope: "cost" })],
  ["updateBaseline", () => ({ metric: "AUD probe 2" })],
  ["archiveBaseline", () => ({ reason: "AUD probe" })],
  ["validateBaseline", () => ({ result: "rejected", note: "AUD probe" })],
  [
    "createOutcomeKpi",
    () => ({ outcomeId: k.outcomeId, kpiDefinitionId: ids.get("kpiDefinitionId"), targetDate: "2027-12-31" }),
  ],
  ["updateOutcomeKpi", () => ({ ordinal: 2 })],
  ["archiveOutcomeKpi", () => ({ reason: "AUD probe" })],
  ["approveOutcomeKpiTrajectory", () => ({ note: "AUD probe" })],
  ["createValuePool", () => ({ name: "AUD probe pool" })],
  ["updateValuePool", () => ({ name: "AUD probe pool 2" })],
  ["archiveValuePool", () => ({ reason: "AUD probe" })],
  ["validateValuePool", () => ({ result: "rejected", note: "AUD probe" })],
]);

const TABLE_OF = new Map([
  ["kpiDefinitionId", "kpi_definition"],
  ["baselineId", "baseline"],
  ["outcomeKpiId", "outcome_kpi"],
  ["valuePoolId", "value_pool"],
] as const);

beforeAll(async () => {
  api = await startApi();
  const w = await seedWorld(api.db);
  k = await seedKpiWorld(api, w);
  const mk = async (url: string, session = k.s.tl, body: unknown) => {
    const r = await call<{ id: string }>(api.app, "POST", `${k.base}/${url}`, { session, body });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return r.body.id;
  };
  ids.set("kpiDefinitionId", await mk("kpi-definitions", k.s.tl, PROBE_BODIES.get("createKpiDefinition")!()));
  ids.set("baselineId", await mk("baselines", k.s.tl, { metric: "m", unit: "u", scope: "cost", value: "1" }));
  ids.set(
    "outcomeKpiId",
    await mk("outcome-kpis", k.s.tl, {
      outcomeId: k.outcomeId,
      kpiDefinitionId: ids.get("kpiDefinitionId"),
      targetDate: "2027-12-31",
      targetValue: "5",
    }),
  );
  ids.set(
    "valuePoolId",
    await mk("value-pools", k.s.tl, {
      name: "p",
      quantificationStatus: "quantified",
      downsideAmount: "1",
      upsideAmount: "2",
    }),
  );
});
afterAll(() => api.close());

describe("AUD -> 403 on every kpi mutation (generated from the contract)", () => {
  it("the generated list covers the 16 kpi mutations of the P2 contract, each with a probe body", () => {
    expect(kpiMutations.map((o) => o.operationId).sort()).toEqual([...PROBE_BODIES.keys()].sort());
    expect(kpiMutations).toHaveLength(16);
  });

  it("the auditor can read every kpi resource (so a denial is 403, not 404)", async () => {
    for (const [param, id] of ids) {
      const collection = new Map([
        ["kpiDefinitionId", "kpi-definitions"],
        ["baselineId", "baselines"],
        ["outcomeKpiId", "outcome-kpis"],
        ["valuePoolId", "value-pools"],
      ]).get(param)!;
      expect((await call(api.app, "GET", `${k.base}/${collection}`, { session: k.s.auditor })).status).toBe(200);
      expect((await call(api.app, "GET", `${k.base}/${collection}/${id}`, { session: k.s.auditor })).status).toBe(200);
    }
  });

  it.each(kpiMutations.map((o) => [o.operationId, o] as const))("%s", async (operationId, op) => {
    let recordParam: string | null = null;
    const url = op.path.replace(/\{([A-Za-z]+)\}/g, (_m, name: string) => {
      if (name === "transformationId") return k.transformationId;
      recordParam = name;
      return ids.get(name)!;
    });
    const before = await versionOf(recordParam);
    const res = await call<{ code: string }>(api.app, op.method, url, {
      session: k.s.auditor,
      body: PROBE_BODIES.get(operationId)!(),
      headers: before === null ? {} : ifMatch(before),
    });
    expect([res.status, res.body.code], operationId).toEqual([403, "forbidden"]);
    expect(await versionOf(recordParam)).toBe(before);
    const audit = await auditOfRequest(api.db, String(res.headers["x-request-id"]));
    expect(audit.map((e) => [e.action, e.actor_user_id])).toEqual([["authorization.denied", k.users.auditor.id]]);
  });
});

async function versionOf(param: string | null): Promise<number | null> {
  if (param === null) return null;
  const table = TABLE_OF.get(param as "baselineId")!;
  const r = await api.owner.query<{ version: number }>(`SELECT version FROM ${table} WHERE id = $1`, [ids.get(param)]);
  return r.rows[0]!.version;
}
