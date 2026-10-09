// The KPI status panel against a real PostgreSQL (T-DG4-KBE-C; ADR-0028 §5-§6; REQ-S07-006, REQ-S07-008, REQ-S07-009):
//  - REQ-S07-008 "the KPI panel shows actual, expected-to-date, final target, variance, trend, data freshness and the
//    rule explanation naming the threshold version" - every element present (null with a reason when missing), the
//    explanation and reasons are i18n keys (the web renders them in en and ar);
//  - REQ-S07-009 display: an override in force changes displayedRag only (calculatedRag preserved); after expiry the
//    calculated RAG displays again, with no job;
//  - Stale data shows Stale (never green), an acceptable band outside its bounds is adverse, a 4-week vs 5-week
//    comparison is Not comparable (REQ-S07-005);
//  - AUD reads (200); outside the scope 404.
// All data is synthetic; nothing here grants a business approval or touches the engineering gates DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, seedWorld, signIn, startApi, type TestApi, type World } from "../../support/harness.ts";
import { seedKpiWorld, type KpiWorld } from "../kpi/fixtures.ts";
import {
  approvedTrajectory,
  DIRECT_FLOW,
  evidenceItem,
  monthlyPeriod,
  ownedKpi,
  runRecalculation,
  statusOf,
  submitActual,
  type Body,
} from "./kbe-c-fixtures.ts";

let api: TestApi;
let w: World;
let k: KpiWorld;
let period: { id: string; label: string; end: string };
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  k = await seedKpiWorld(api, w);
  period = await monthlyPeriod(api, w);
}, 60_000);
afterAll(() => api.close());

const SEVEN = ["actual", "expectedToDate", "finalTarget", "variance", "trend", "freshness", "explanation"] as const;

describe("the KPI panel (REQ-S07-008)", () => {
  it("returns the seven elements, the explanation naming the threshold version, and i18n keys", async () => {
    const kpi = await ownedKpi(api, k, { ...DIRECT_FLOW, targetValue: "150", targetDate: "2041-12-31" });
    const trajectory = await approvedTrajectory(api, k, kpi.id, [
      { pointDate: "2041-01-01", expectedValue: "90" },
      { pointDate: "2041-12-31", expectedValue: "150" },
    ]);
    await call(api.app, "POST", `${k.base}/kpi-definitions/${kpi.id}/rag-thresholds`, {
      session: k.s.kds,
      body: { toleranceMode: "absolute", amberThreshold: "5", redThreshold: "20", reason: "Synthetic tolerance" },
    });
    const res = await submitActual(api, k, kpi.id, { reportingPeriodId: period.id, value: "85" });
    await runRecalculation(api, res.body.actual.id);
    const s = await statusOf(api, k, kpi.id);
    expect(s.status, JSON.stringify(s.body)).toBe(200);
    for (const el of SEVEN) expect(s.body, el).toHaveProperty(el);
    expect(s.body).toMatchObject({
      actual: "85",
      finalTarget: "150",
      finalTargetDate: "2041-12-31",
      changeLabel: "unit",
      freshness: { status: "fresh", dataAsOf: "2041-01-31", staleAfterDays: 45 },
    });
    // Linear between 90 (01-01) and 150 (12-31) at 01-31: 90 + 60 * 30/364.
    expect(s.body.expectedToDate).toMatch(/^94\.94/);
    expect(s.body.variance).toMatch(/^-9\.94/);
    // Absolute mode: d = shortfall 9.94 > amber 5, <= red 20 -> amber, and the explanation names threshold version 1.
    expect(s.body.calculatedRag).toBe("amber");
    expect(s.body.explanation).toMatchObject({
      key: "kpi.rag.amber_band",
      thresholdSource: "configured",
      thresholdVersion: 1,
      toleranceMode: "absolute",
      amberThreshold: "5",
      redThreshold: "20",
      trajectoryVersion: trajectory.versionNo,
    });
    expect(s.body.explanation.key).toMatch(/^kpi\.rag\.[a-z_]+$/);
    expect(s.body.trend).toBe("unknown");
  });

  it("Stale data shows Stale with its reason, never green; a band outside its bounds is adverse", async () => {
    const stale = await ownedKpi(api, k, DIRECT_FLOW);
    await approvedTrajectory(api, k, stale.id, [{ pointDate: period.end, expectedValue: "10" }]);
    const r = await submitActual(api, k, stale.id, {
      reportingPeriodId: period.id,
      value: "10",
      dataAsOf: "2020-01-01",
    });
    await runRecalculation(api, r.body.actual.id);
    const s = await statusOf(api, k, stale.id);
    expect([s.body.actualStatus, s.body.actualReason, s.body.calculatedRag, s.body.freshness.status]).toEqual([
      "stale",
      "kpi.stale",
      "stale",
      "stale",
    ]);
    expect(s.body.actual).toBe("10");

    const band = await ownedKpi(
      api,
      k,
      {
        measureType: "acceptable_band",
        valueNature: "stock",
        aggregationRule: "last_value",
        submissionRoute: "direct_accept",
        bandLower: "5",
        bandUpper: "10",
      },
      { polarity: "within_band" },
    );
    const b = await submitActual(api, k, band.id, { reportingPeriodId: period.id, value: "12" });
    await runRecalculation(api, b.body.actual.id);
    const sb = await statusOf(api, k, band.id);
    // s = 12 - 10 = 2; relative d = 2 / (10 - 5) = 0.4 > 0.10 -> red, outside the band.
    expect([sb.body.calculatedRag, sb.body.explanation.key]).toEqual(["red", "kpi.rag.outside_band"]);
  });

  it("AUD reads the panel and the list; outside the transformation is 404", async () => {
    const kpi = await ownedKpi(api, k, DIRECT_FLOW);
    expect((await statusOf(api, k, kpi.id)).status).toBe(200);
    const outsider = await signIn(api.app, w.officeB.subject);
    expect(
      (await call(api.app, "GET", `${k.base}/kpi-definitions/${kpi.id}/status`, { session: outsider })).status,
    ).toBe(404);
    expect((await call(api.app, "GET", `${k.base}/kpi-status`, { session: outsider })).status).toBe(404);
  });
});

describe("override display (REQ-S07-009)", () => {
  it("an override in force changes displayedRag only; after expiry the calculated RAG displays again", async () => {
    const kpi = await ownedKpi(api, k, DIRECT_FLOW);
    await approvedTrajectory(api, k, kpi.id, [{ pointDate: period.end, expectedValue: "100" }]);
    const r = await submitActual(api, k, kpi.id, { reportingPeriodId: period.id, value: "50" });
    await runRecalculation(api, r.body.actual.id);
    expect((await statusOf(api, k, kpi.id)).body.calculatedRag).toBe("red");
    const evidenceId = await evidenceItem(api, k);
    const o = await call<Body>(api.app, "POST", `${k.base}/kpi-definitions/${kpi.id}/rag-overrides`, {
      session: k.s.bo,
      body: {
        scopeKind: "transformation",
        scopeId: k.transformationId,
        reportingPeriodId: period.id,
        overrideRag: "amber",
        reason: "Synthetic: the recovery plan is approved",
        evidenceId,
        expiresAt: new Date(Date.now() + 1500).toISOString(),
      },
    });
    expect([o.status, o.body.calculatedRag], JSON.stringify(o.body)).toEqual([201, "red"]);
    const during = await statusOf(api, k, kpi.id);
    expect([during.body.calculatedRag, during.body.displayedRag, during.body.override?.id]).toEqual([
      "red",
      "amber",
      o.body.id,
    ]);
    await new Promise((resolve) => setTimeout(resolve, 1700));
    const after = await statusOf(api, k, kpi.id);
    expect([after.body.calculatedRag, after.body.displayedRag, after.body.override]).toEqual(["red", "red", null]);
  });
});

describe("comparability (REQ-S07-005)", () => {
  it("a 4-week period after a 5-week period: trend not_comparable and a not_comparable finding", async () => {
    const to = await signIn(api.app, w.office.subject);
    const base = `/api/v1/organizations/${w.orgA.id}/reporting-periods`;
    const mk = async (label: string, start: string, end: string, weeks: number) => {
      const c = await call<Body>(api.app, "POST", base, {
        session: to,
        body: {
          frequency: "weekly",
          periodLabel: label,
          periodStart: start,
          periodEnd: end,
          basis: "weeks",
          weekCount: weeks,
        },
      });
      expect(c.status, JSON.stringify(c.body)).toBe(201);
      const op = await call<Body>(api.app, "POST", `${base}/${c.body.id}/open`, {
        session: to,
        headers: { "if-match": '"1"' },
      });
      expect(op.status).toBe(200);
      return c.body.id as string;
    };
    const five = await mk("2047-P01", "2047-01-05", "2047-02-08", 5);
    const four = await mk("2047-P02", "2047-02-09", "2047-03-08", 4);
    const kpi = await ownedKpi(api, k, DIRECT_FLOW, { frequency: "weekly" });
    for (const [pid, asOf] of [
      [five, "2047-02-08"],
      [four, "2047-03-08"],
    ] as const) {
      const r = await submitActual(api, k, kpi.id, { reportingPeriodId: pid, value: "4", dataAsOf: asOf });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      await runRecalculation(api, r.body.actual.id);
    }
    const s = await statusOf(api, k, kpi.id, `?reportingPeriodId=${four}`);
    expect(s.body.trend).toBe("not_comparable");
    const findings = await api.db
      .selectFrom("data_quality_finding")
      .select(["rule_code", "severity"])
      .where("kpi_definition_id", "=", kpi.id)
      .where("reporting_period_id", "=", four)
      .execute();
    expect(findings).toContainEqual({ rule_code: "not_comparable", severity: "info" });
  });
});
