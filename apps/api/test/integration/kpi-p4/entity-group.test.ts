// REQ-S16-014, the §16 entity group "KPIDefinition, KPIVersion, KPIActual, TargetTrajectory, CalculationRun and
// DataQualityFinding" (ADR-0027 §14; T-DG4-KBE-C with KBE-B): each is created and read through the API with
// authorization enforced. KPIDefinition, KPIVersion, TargetTrajectory and KPIActual through their create operations;
// CalculationRun and DataQualityFinding (no create operation) by accepting an actual and running the kpi.recalculate
// handler in the test, then getCalculationRun and listDataQualityFindings. An AUD caller gets 403 on each mutation and
// 200 on each read. All data is synthetic; the trajectory approval is a synthetic in-product business approval.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, seedWorld, startApi, type TestApi, type World } from "../../support/harness.ts";
import { seedKpiWorld, type KpiWorld } from "../kpi/fixtures.ts";
import { ifMatch, monthlyPeriod, runRecalculation, type Body } from "./kbe-c-fixtures.ts";

let api: TestApi;
let w: World;
let k: KpiWorld;
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  k = await seedKpiWorld(api, w);
}, 60_000);
afterAll(() => api.close());

const as = (session: KpiWorld["s"][keyof KpiWorld["s"]]) => ({
  get: (url: string) => call<Body>(api.app, "GET", url, { session }),
  post: (url: string, body?: object, version?: number) =>
    call<Body>(api.app, "POST", url, {
      session,
      ...(body === undefined ? {} : { body }),
      ...(version === undefined ? {} : { headers: ifMatch(version) }),
    }),
});

describe("REQ-S16-014: the KPI entity group through the API", () => {
  it("creates and reads each entity with authorization enforced (AUD 403 on writes, 200 on reads)", async () => {
    const kds = as(k.s.kds);
    const aud = as(k.s.auditor);
    const period = await monthlyPeriod(api, w);

    // KPIDefinition
    const defBody = {
      name: "Synthetic entity-group KPI",
      unitKind: "count",
      unitLabel: "orders",
      polarity: "higher_is_better",
      frequency: "monthly",
      ownerUserId: k.users.kds.id,
    };
    expect((await aud.post(`${k.base}/kpi-definitions`, defBody)).status).toBe(403);
    const def = await kds.post(`${k.base}/kpi-definitions`, defBody);
    expect(def.status, JSON.stringify(def.body)).toBe(201);
    expect((await aud.get(`${k.base}/kpi-definitions/${def.body.id}`)).status).toBe(200);
    expect(
      (await kds.post(`${k.base}/kpi-definitions/${def.body.id}/activate`, undefined, def.body.version)).status,
    ).toBe(200);

    // KPIVersion
    const versionBody = {
      measureType: "higher_is_better",
      valueNature: "flow",
      aggregationRule: "sum",
      submissionRoute: "direct_accept",
    };
    expect((await aud.post(`${k.base}/kpi-definitions/${def.body.id}/versions`, versionBody)).status).toBe(403);
    const version = await kds.post(`${k.base}/kpi-definitions/${def.body.id}/versions`, versionBody);
    expect(version.status, JSON.stringify(version.body)).toBe(201);
    expect((await aud.post(`${k.base}/kpi-versions/${version.body.id}/activate`, undefined, 1)).status).toBe(403);
    expect((await kds.post(`${k.base}/kpi-versions/${version.body.id}/activate`, undefined, 1)).status).toBe(200);
    expect((await aud.get(`${k.base}/kpi-versions/${version.body.id}`)).status).toBe(200);

    // TargetTrajectory
    const trajectoryBody = {
      scopeKind: "transformation",
      scopeId: k.transformationId,
      points: [{ pointDate: period.end, expectedValue: "100" }],
    };
    expect((await aud.post(`${k.base}/kpi-definitions/${def.body.id}/trajectories`, trajectoryBody)).status).toBe(403);
    const trajectory = await kds.post(`${k.base}/kpi-definitions/${def.body.id}/trajectories`, trajectoryBody);
    expect(trajectory.status, JSON.stringify(trajectory.body)).toBe(201);
    expect((await aud.post(`${k.base}/target-trajectories/${trajectory.body.id}/approve`, {}, 1)).status).toBe(403);
    expect((await as(k.s.sp).post(`${k.base}/target-trajectories/${trajectory.body.id}/approve`, {}, 1)).status).toBe(
      200,
    );
    expect((await aud.get(`${k.base}/target-trajectories/${trajectory.body.id}`)).status).toBe(200);

    // KPIActual (the accept that triggers the calculation run)
    const actualBody = {
      scopeKind: "transformation",
      scopeId: k.transformationId,
      reportingPeriodId: period.id,
      action: "submit",
      value: "120",
      dataAsOf: period.end,
    };
    expect((await aud.post(`${k.base}/kpi-definitions/${def.body.id}/actuals`, actualBody)).status).toBe(403);
    const actual = await kds.post(`${k.base}/kpi-definitions/${def.body.id}/actuals`, actualBody);
    expect([actual.status, actual.body.actual?.status], JSON.stringify(actual.body)).toEqual([201, "accepted"]);
    expect((await aud.get(`${k.base}/kpi-actuals/${actual.body.actual.id}`)).status).toBe(200);

    // CalculationRun: the kpi.recalculate handler, then getCalculationRun (AUD 200).
    const [result] = await runRecalculation(api, actual.body.actual.id);
    expect(result!.outcome).toBe("done");
    const runs = await aud.get(`${k.base}/calculation-runs?kpiDefinitionId=${def.body.id}`);
    expect(runs.status).toBe(200);
    const runId = runs.body.items[0].id;
    const run = await aud.get(`${k.base}/calculation-runs/${runId}`);
    expect([run.status, run.body.triggerKind, run.body.triggerRecordId, run.body.evaluations.length]).toEqual([
      200,
      "actual_accepted",
      actual.body.actual.id,
      2,
    ]);
    // 120 vs 100 on a higher-is-better KPI: favourable, green.
    const periodEval = run.body.evaluations.find((e: Body) => e.valueBasis === "period");
    expect([periodEval.value, periodEval.calculatedRag]).toEqual(["120", "green"]);

    // DataQualityFinding: a second KPI whose accepted value is out of its valid range gives a finding; listed for AUD.
    const def2 = await kds.post(`${k.base}/kpi-definitions`, { ...defBody, name: "Synthetic ranged KPI" });
    await kds.post(`${k.base}/kpi-definitions/${def2.body.id}/activate`, undefined, def2.body.version);
    const v2 = await kds.post(`${k.base}/kpi-definitions/${def2.body.id}/versions`, {
      ...versionBody,
      dataQuality: { staleAfterDays: 45, validMin: "0", validMax: "100", evidenceRequired: false },
    });
    await kds.post(`${k.base}/kpi-versions/${v2.body.id}/activate`, undefined, 1);
    const a2 = await kds.post(`${k.base}/kpi-definitions/${def2.body.id}/actuals`, { ...actualBody, value: "250" });
    expect(a2.status, JSON.stringify(a2.body)).toBe(201);
    await runRecalculation(api, a2.body.actual.id);
    const findings = await aud.get(`${k.base}/data-quality-findings?kpiDefinitionId=${def2.body.id}`);
    expect(findings.status, JSON.stringify(findings.body)).toBe(200);
    expect(findings.body.items.map((f: Body) => f.ruleCode)).toContain("out_of_range");
    const finding = findings.body.items.find((f: Body) => f.ruleCode === "out_of_range");
    expect(
      (
        await aud.post(
          `${k.base}/data-quality-findings/${finding.id}/resolve`,
          { outcome: "resolved", note: "Synthetic" },
          finding.version,
        )
      ).status,
    ).toBe(403);
    expect((await aud.get(`${k.base}/data-quality-findings/${finding.id}`)).status).toBe(200);
  });
});
