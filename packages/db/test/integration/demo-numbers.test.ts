// The International Roaming dataset's numbers against a real, disposable PostgreSQL (ADR-0050 §4, §5; p5-work-split
// §J.3; T-DG5-KBE-H). Literal tests of §J.3: "the KPI and benefit conditions of coverage.test.ts (with BE-T), and
// recomputed values that equal the seeded values". KBE-H's modules are seeded through BE-S's seed transaction (every
// engine guard and every deferred constraint of 0033-0039 and 0061 runs at commit) on top of the test stand-ins for
// BE-T's anchor records; then every stored KPI evaluation, benefit calculation, measurement and plan value is
// recomputed FROM THE STORED ROWS with the DG3/DG4 engines (@mth/shared/calc) and compared. Everything is SYNTHETIC; a
// demo approval approves nothing real. Every database is a scratch database inside this run's disposable cluster.
import {
  applyFreshness,
  computeTrend,
  computeVariance,
  evaluateFormula,
  evaluateRag,
  expectedToDate,
  FORMULA_DECIMAL as D,
  freshness,
  periodValue,
  roundForStorage,
  type FormulaVariable,
  type KpiResult,
} from "@mth/shared/calc";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { countStaleKpis } from "../../src/demo/data/actuals.ts";
import { countSharedBenefits } from "../../src/demo/data/benefits.ts";
import { KBE_H_DATASET_MODULES } from "../../src/demo/data/finance.ts";
import { DEMO_ANCHORS } from "../../src/demo/data/kpis.ts";
import type { CoverageCondition } from "../../src/demo/coverage.ts";
import { seedDemo, type DemoRunSummary } from "../../src/demo/seed.ts";
import { migrate } from "../../src/migrate.ts";
import { TEST_ANCHOR_MODULES } from "../demo-roaming-anchors.ts";
import { createScratchDatabase, dropScratchDatabase, roleUrl, testDatabase } from "../helpers.ts";

const { adminUrl } = testDatabase();
const T = DEMO_ANCHORS.transformationId;
const dropAtEnd: string[] = [];
const MODULES = [...TEST_ANCHOR_MODULES, ...KBE_H_DATASET_MODULES];
/** The two coverage conditions of ADR-0050 §5 whose records are KBE-H's (BE-T wires them into coverage.ts). */
const CONDITIONS: readonly CoverageCondition[] = [
  { code: "kpi.stale", requirement: "a stale KPI", query: countStaleKpis },
  {
    code: "benefit.shared",
    requirement: "one benefit allocated to at least two initiatives",
    query: countSharedBenefits,
  },
];

let ownerUrl = "";
let summary: DemoRunSummary;
let client: pg.Client;

async function rows<T extends pg.QueryResultRow>(text: string, values: unknown[] = []): Promise<T[]> {
  return (await client.query<T>(text, values)).rows;
}
const eq = (a: string | null, b: string | null): boolean =>
  a === null || b === null ? a === b : new D(a).eq(new D(b));

beforeAll(async () => {
  const name = await createScratchDatabase(adminUrl, "mth_demo_numbers");
  dropAtEnd.push(name);
  ownerUrl = roleUrl(adminUrl, name, "mth_owner");
  await migrate(ownerUrl);
  summary = await seedDemo(ownerUrl, {
    mthEnv: "demo",
    runKind: "seed",
    requestedVia: "cli",
    requestedBy: null,
    modules: MODULES,
    conditions: CONDITIONS,
  });
  client = new pg.Client({ connectionString: ownerUrl });
  await client.connect();
}, 180_000);

afterAll(async () => {
  await client?.end();
  for (const n of dropAtEnd.reverse()) await dropScratchDatabase(adminUrl, n);
});

describe("REQ-S18-002 (with BE-T): the KPI and benefit coverage conditions", () => {
  it("the seed commits (every engine guard and deferred constraint) and finds a stale KPI and a shared benefit", () => {
    expect(summary.coverage).toEqual({ "kpi.stale": 1, "benefit.shared": 1 });
    expect(summary.coverageNotImplemented).toEqual([]);
    expect(summary.coverageComplete).toBe(true);
  });

  it("the stale KPI is the partner cost per MB: its number kept, labelled Stale, never green, with a stale finding", async () => {
    const [e] = await rows<{
      name: string;
      value: string;
      value_status: string;
      calculated_rag: string;
      data_as_of: string;
    }>(
      `SELECT d.name, e.value, e.value_status, e.calculated_rag, e.data_as_of FROM kpi_evaluation e
         JOIN kpi_definition d ON d.id = e.kpi_definition_id
        WHERE e.value_status = 'stale'`,
    );
    expect(e).toEqual({
      name: "Cost/MB, margin",
      value: "0.010650",
      value_status: "stale",
      calculated_rag: "stale",
      data_as_of: "2026-06-30",
    });
    const findings = await rows<{ rule_code: string; status: string }>(
      "SELECT rule_code, status FROM data_quality_finding WHERE transformation_id = $1",
      [T],
    );
    expect(findings).toEqual([{ rule_code: "stale", status: "open" }]);
  });

  it("the shared benefit is B01, allocated 70 % + 20 % to two initiatives, 10 % unallocated, counted once", async () => {
    const alloc = await rows<{ code: string; share: string; initiative_id: string }>(
      `SELECT b.code, a.share, a.initiative_id FROM benefit_allocation a JOIN benefit b ON b.id = a.benefit_id
        WHERE a.set_no = b.allocation_set_no ORDER BY a.share DESC`,
    );
    expect(alloc).toEqual([
      { code: "B01", share: "0.700000", initiative_id: DEMO_ANCHORS.initiatives.passRedesign },
      { code: "B01", share: "0.200000", initiative_id: DEMO_ANCHORS.initiatives.proactiveComms },
    ]);
    const [unallocated] = await rows<{ u: string }>(
      `SELECT 1 - sum(a.share) AS u FROM benefit_allocation a JOIN benefit b ON b.id = a.benefit_id WHERE b.code = 'B01'`,
    );
    expect(new D(unallocated!.u).eq("0.1")).toBe(true);
    const counted = await rows<{ benefit_id: string; counted: boolean }>(
      "SELECT benefit_id, counted FROM benefit_counting WHERE transformation_id = $1 ORDER BY benefit_id",
      [T],
    );
    expect(counted.map((c) => c.counted)).toEqual([true, true, true]);
  });

  it("the three chain benefits have distinct financial classifications (M0346) and map to KPI, formula and case line", async () => {
    const b = await rows<{
      code: string;
      benefit_type: string;
      value_class: string;
      kpi: string;
      formula: string;
      line_basis: string;
      lifecycle_step: string;
    }>(
      `SELECT b.code, b.benefit_type, b.value_class, k.name AS kpi, f.code AS formula, l.value_basis AS line_basis, b.lifecycle_step
         FROM benefit b JOIN kpi_definition k ON k.id = b.measurement_kpi_definition_id
         JOIN benefit_formula f ON f.id = b.benefit_formula_id JOIN business_case_line l ON l.id = b.business_case_line_id
        ORDER BY b.code`,
    );
    expect(b).toEqual([
      {
        code: "B01",
        benefit_type: "revenue",
        value_class: "revenue_uplift",
        kpi: "Attach rate / activation",
        formula: "BF-01",
        line_basis: "revenue_uplift",
        lifecycle_step: "measure",
      },
      {
        code: "B02",
        benefit_type: "cost",
        value_class: "avoided_cost",
        kpi: "Complaint rate",
        formula: "BF-02",
        line_basis: "avoided_cost",
        lifecycle_step: "enable",
      },
      {
        code: "B03",
        benefit_type: "revenue",
        value_class: "margin_uplift",
        kpi: "Cost/MB, margin",
        formula: "BF-03",
        line_basis: "margin_uplift",
        lifecycle_step: "measure",
      },
    ]);
  });

  it("one pending Finance validation (queued, B01 August), two synthetic approvals that approve nothing real", async () => {
    const fv = await rows<{
      code: string;
      status: string;
      period: string;
      approved_amount: string | null;
      decision_note: string | null;
      same_person: boolean;
    }>(
      `SELECT b.code, v.status, v.measurement_period_start::text AS period, v.approved_amount, v.decision_note,
              (v.decided_by IS NOT DISTINCT FROM m.submitted_by) AS same_person
         FROM finance_validation v JOIN benefit b ON b.id = v.benefit_id JOIN benefit_measurement m ON m.id = v.benefit_measurement_id
        ORDER BY b.code, period`,
    );
    expect(fv).toEqual([
      {
        code: "B01",
        status: "approved",
        period: "2026-07-01",
        approved_amount: "222750.0000",
        decision_note: "Synthetic demonstration - approves nothing real",
        same_person: false,
      },
      {
        code: "B01",
        status: "queued",
        period: "2026-08-01",
        approved_amount: null,
        decision_note: null,
        same_person: false,
      },
      {
        code: "B03",
        status: "approved",
        period: "2026-07-01",
        approved_amount: "80000.0000",
        decision_note: "Synthetic demonstration - approves nothing real",
        same_person: false,
      },
    ]);
  });
});

describe("§J.3: recomputed values equal the seeded values (from the stored rows, with the engines)", () => {
  it("every KPI evaluation: value, expected-to-date, variance, ratio, RAG, deviation, trend", async () => {
    const evals = await rows<Record<string, string | null>>(
      `SELECT e.*, d.unit_kind, v.measure_type, v.baseline_value, v.baseline_date::text AS baseline_date,
              v.dq_stale_after_days::text AS stale_days, av.numerator, av.denominator, av.data_as_of::text AS av_as_of,
              av.business_date::text AS business_date, p.period_start::text AS p_start, p.period_end::text AS p_end,
              t.amber_threshold, t.red_threshold, t.tolerance_mode, t.version_no::text AS t_version,
              pe.value AS prev_value, pe.value_status AS prev_status,
              pp.period_start::text AS pp_start, pp.period_end::text AS pp_end
         FROM kpi_evaluation e
         JOIN kpi_definition d ON d.id = e.kpi_definition_id
         JOIN kpi_version v ON v.id = e.kpi_version_id
         JOIN kpi_actual a ON a.kpi_definition_id = e.kpi_definition_id AND a.reporting_period_id = e.reporting_period_id
         JOIN kpi_actual_value av ON av.kpi_actual_id = a.id AND av.value_no = a.accepted_value_no
         JOIN reporting_period p ON p.id = e.reporting_period_id
         LEFT JOIN kpi_rag_threshold t ON t.id = e.threshold_id
         LEFT JOIN reporting_period pp ON pp.id = e.previous_period_id
         LEFT JOIN kpi_evaluation pe ON pe.kpi_definition_id = e.kpi_definition_id AND pe.reporting_period_id = e.previous_period_id AND pe.value_basis = e.value_basis
        WHERE e.transformation_id = $1 AND e.value_basis = 'period' ORDER BY d.name, p.period_start`,
      [T],
    );
    expect(evals).toHaveLength(9);
    for (const e of evals) {
      const points = (
        await rows<{ date: string; value: string }>(
          "SELECT point_date::text AS date, expected_value AS value FROM target_trajectory_point WHERE target_trajectory_id = $1 ORDER BY point_date",
          [e["target_trajectory_id"]],
        )
      ).map((p) => ({ date: p.date, value: p.value }));
      const raw = applyFreshness(
        periodValue("ratio", { kind: "ratio", numerator: e["numerator"]!, denominator: e["denominator"]! }),
        freshness({
          dataAsOf: e["av_as_of"]!,
          staleAfterDays: Number(e["stale_days"]),
          businessDate: e["business_date"]!,
        }),
      );
      const stored = roundForStorage(raw.value!);
      if (!stored.ok) throw new Error("out of range");
      const actual = { ...raw, value: stored.stored } as KpiResult;
      const expected = expectedToDate({
        trajectory: { basis: "period", interpolation: "linear", points, versionNo: 1 },
        baseline: { date: e["baseline_date"]!, value: e["baseline_value"]! },
        at: e["p_end"]!,
      });
      const rag = evaluateRag({
        measureType: e["measure_type"] as "higher_is_better" | "lower_is_better",
        thresholds:
          e["threshold_id"] === null
            ? null
            : {
                id: e["threshold_id"]!,
                versionNo: Number(e["t_version"]),
                toleranceMode: e["tolerance_mode"] as "relative" | "absolute",
                amberThreshold: e["amber_threshold"]!,
                redThreshold: e["red_threshold"]!,
              },
        actual,
        expected: expected.result,
        trajectoryVersion: 1,
      });
      const variance = computeVariance({
        actual: stored.stored,
        expected: expected.result.value!,
        unitKind: e["unit_kind"] as "percentage",
      });
      const trend = computeTrend({
        measureType: e["measure_type"] as "higher_is_better",
        current: actual,
        previous:
          e["prev_value"] === null || e["prev_value"] === undefined
            ? null
            : ({
                status: e["prev_status"],
                value: e["prev_value"],
                reason: e["prev_status"] === "stale" ? "kpi.stale" : null,
              } as KpiResult),
        currentPeriod: {
          id: e["reporting_period_id"]!,
          frequency: "monthly",
          periodStart: e["p_start"]!,
          periodEnd: e["p_end"]!,
          basis: "calendar",
          weekCount: null,
        },
        previousPeriod:
          e["pp_start"] === null
            ? null
            : {
                id: e["previous_period_id"]!,
                frequency: "monthly",
                periodStart: e["pp_start"]!,
                periodEnd: e["pp_end"]!,
                basis: "calendar",
                weekCount: null,
              },
        valueBasis: "period",
      });
      const r6 = (x: string): string => (roundForStorage(x) as { stored: string }).stored;
      const label = `${e["period_label"]} ${e["kpi_definition_id"]}`;
      expect(eq(e["value"]!, stored.stored), label).toBe(true);
      expect(e["value_status"], label).toBe(actual.status);
      expect(eq(e["expected_value"]!, r6(expected.result.value!)), label).toBe(true);
      expect(eq(e["variance"]!, r6(variance.variance)), label).toBe(true);
      expect(eq(e["variance_ratio"]!, r6(variance.varianceRatio.value!)), label).toBe(true);
      expect(e["calculated_rag"], label).toBe(actual.status === "stale" ? "stale" : rag.calculatedRag);
      expect(e["deviation"], label).toBe(rag.deviation);
      expect(e["trend"], label).toBe(trend.trend);
      expect(e["threshold_source"], label).toBe(rag.thresholdSource);
      expect(JSON.parse(JSON.stringify(e["explanation_params"])), label).toEqual(
        JSON.parse(JSON.stringify(rag.explanationParams)),
      );
      // Unknown and Stale are never 0 or green.
      if (actual.status !== "ok") expect(e["calculated_rag"]).not.toBe("green");
    }
  });

  it("every cumulative (YTD) evaluation: the weighted ratio of the window's accepted actuals; RAG Unknown or Stale, never green", async () => {
    const evals = await rows<Record<string, unknown>>(
      `SELECT e.*, v.dq_stale_after_days::text AS stale_days, v.measure_type,
              av.data_as_of::text AS av_as_of, av.business_date::text AS business_date,
              pe.value AS prev_value, pe.value_status AS prev_status
         FROM kpi_evaluation e
         JOIN kpi_version v ON v.id = e.kpi_version_id
         JOIN kpi_actual a ON a.kpi_definition_id = e.kpi_definition_id AND a.reporting_period_id = e.reporting_period_id
         JOIN kpi_actual_value av ON av.kpi_actual_id = a.id AND av.value_no = a.accepted_value_no
         LEFT JOIN kpi_evaluation pe ON pe.kpi_definition_id = e.kpi_definition_id
              AND pe.reporting_period_id = e.previous_period_id AND pe.value_basis = 'cumulative'
        WHERE e.transformation_id = $1 AND e.value_basis = 'cumulative' ORDER BY e.period_label, e.kpi_definition_id`,
      [T],
    );
    expect(evals).toHaveLength(9);
    for (const e of evals) {
      const inputs = e["inputs"] as { windowValues: { kpiActualId: string; valueNo: number }[] };
      // Σ numerators / Σ denominators over the window's accepted actual versions, from the stored values.
      const [w] = await rows<{ num: string; den: string; n: string }>(
        `SELECT sum(av.numerator)::text AS num, sum(av.denominator)::text AS den, count(*)::text AS n
           FROM kpi_actual_value av JOIN unnest($1::uuid[], $2::int[]) AS x(id, no) ON av.kpi_actual_id = x.id AND av.value_no = x.no`,
        [inputs.windowValues.map((x) => x.kpiActualId), inputs.windowValues.map((x) => x.valueNo)],
      );
      expect(Number(w!.n)).toBe(inputs.windowValues.length);
      const raw = applyFreshness(
        periodValue("ratio", { kind: "ratio", numerator: w!.num, denominator: w!.den }),
        freshness({
          dataAsOf: e["av_as_of"] as string,
          staleAfterDays: Number(e["stale_days"]),
          businessDate: e["business_date"] as string,
        }),
      );
      const stored = roundForStorage(raw.value!) as { stored: string };
      expect(eq(e["value"] as string, stored.stored)).toBe(true);
      expect(e["value_status"]).toBe(raw.status);
      expect([e["expected_value"], e["variance"], e["variance_ratio"], e["target_trajectory_id"]]).toEqual([
        null,
        null,
        null,
        null,
      ]);
      expect(e["calculated_rag"]).toBe(raw.status === "stale" ? "stale" : "unknown");
      expect(e["deviation"]).toBe("unknown");
      const prev = e["prev_value"] as string | null;
      const better =
        prev === null
          ? null
          : (e["measure_type"] === "higher_is_better" ? 1 : -1) * new D(stored.stored).comparedTo(prev);
      expect(e["trend"]).toBe(
        better === null ? "unknown" : better > 0 ? "improving" : better < 0 ? "worsening" : "flat",
      );
    }
  });

  it("every formula preview, benefit calculation, measurement and plan value, from the stored formula version", async () => {
    const versions = await rows<{ id: string; expression: string; preview_result: string }>(
      "SELECT id, expression, preview_result FROM benefit_formula_version WHERE transformation_id = $1",
      [T],
    );
    const varsOf = async (versionId: string): Promise<FormulaVariable[]> =>
      (
        await rows<{
          name: string;
          kind: string;
          unit: string | null;
          currency: string | null;
          period: string;
          value: string;
        }>(
          "SELECT name, kind, unit, currency, period, value FROM benefit_formula_variable WHERE formula_version_id = $1 ORDER BY ordinal",
          [versionId],
        )
      ).map((v) => ({
        name: v.name,
        kind: v.kind as FormulaVariable["kind"],
        unit: v.unit,
        currency: v.currency?.trim() ?? null,
        period: v.period as FormulaVariable["period"],
        value: v.value,
      }));
    expect(versions).toHaveLength(3);
    for (const v of versions) {
      const r = evaluateFormula(v.expression, await varsOf(v.id));
      expect(r.ok && eq(r.result, v.preview_result), v.expression).toBe(true);
    }
    const ms = await rows<{
      id: string;
      amount: string;
      formula_version_id: string;
      result: string;
      kpi_variable: string;
      expression: string;
    }>(
      `SELECT m.id, m.amount, m.formula_version_id, c.result, b.measurement_kpi_variable AS kpi_variable, fv.expression
         FROM benefit_measurement m JOIN benefit_calculation c ON c.id = m.benefit_calculation_id
         JOIN benefit b ON b.id = m.benefit_id JOIN benefit_formula_version fv ON fv.id = m.formula_version_id`,
    );
    expect(ms).toHaveLength(3);
    for (const m of ms) {
      const inputs = await rows<{
        variable_name: string;
        value: string;
        kpi_actual_id: string | null;
        actual_ratio: string | null;
      }>(
        `SELECT i.variable_name, i.value, i.kpi_actual_id, (av.numerator / av.denominator)::text AS actual_ratio
           FROM benefit_measurement_input i
           LEFT JOIN kpi_actual_value av ON av.kpi_actual_id = i.kpi_actual_id AND av.value_no = i.kpi_value_no
          WHERE i.measurement_id = $1`,
        [m.id],
      );
      const bound = inputs.filter((i) => i.kpi_actual_id !== null);
      expect(bound.map((i) => i.variable_name)).toEqual([m.kpi_variable]);
      // The bound input is the accepted KPI actual's value (numerator / denominator).
      expect(eq(bound[0]!.value, bound[0]!.actual_ratio)).toBe(true);
      const r = evaluateFormula(
        m.expression,
        await varsOf(m.formula_version_id),
        Object.fromEntries(inputs.map((i) => [i.variable_name, i.value])),
      );
      expect(r.ok).toBe(true);
      expect(eq(m.result, r.result)).toBe(true);
      expect(eq(m.amount, new D(r.result!).toDecimalPlaces(4, D.ROUND_HALF_UP).toString())).toBe(true);
    }
    const plans = await rows<{
      amount: string;
      kpi_value: string;
      kpi_variable: string;
      version_id: string;
      expression: string;
    }>(
      `SELECT p.amount, p.kpi_value, b.measurement_kpi_variable AS kpi_variable, fv.id AS version_id, fv.expression
         FROM benefit_plan_value p JOIN benefit b ON b.id = p.benefit_id
         JOIN benefit_formula f ON f.id = b.benefit_formula_id
         JOIN benefit_formula_version fv ON fv.formula_id = f.id AND fv.version_no = f.current_version_no`,
    );
    expect(plans).toHaveLength(10);
    for (const p of plans) {
      const r = evaluateFormula(p.expression, await varsOf(p.version_id), { [p.kpi_variable]: p.kpi_value });
      expect(eq(p.amount, r.result), `${p.kpi_variable}=${p.kpi_value}`).toBe(true);
    }
  });

  it("value bases are never mixed: each value state per value class, planned and forecast apart from validated", async () => {
    const lines = await rows<{ value_class: string; value_state: string; total: string; n: string }>(
      `SELECT c.value_class, l.value_state, sum(l.amount)::text AS total, count(*)::text AS n
         FROM benefit_value_line l JOIN benefit_counting c ON c.benefit_id = l.benefit_id
        WHERE l.transformation_id = $1 AND c.counted
        GROUP BY c.value_class, l.value_state ORDER BY c.value_class, l.value_state`,
      [T],
    );
    const t = Object.fromEntries(lines.map((l) => [`${l.value_class}/${l.value_state}`, new D(l.total).toString()]));
    expect(t).toEqual({
      "avoided_cost/planned": "184800",
      "margin_uplift/measured": "80000",
      "margin_uplift/planned": "240000",
      "margin_uplift/validated": "80000",
      "revenue_uplift/forecast": "148500",
      "revenue_uplift/measured": "321750",
      "revenue_uplift/planned": "891000",
      "revenue_uplift/submitted": "99000",
      "revenue_uplift/validated": "222750",
    });
    // B02 has no measurement: it has no measured or validated line at all (absent, never a 0 that reads as measured).
    expect(t).not.toHaveProperty("avoided_cost/validated");
    expect(t).not.toHaveProperty("avoided_cost/measured");
  });

  it("is deterministic: a second seed into a fresh database gives the same counts and checksum", async () => {
    const name = await createScratchDatabase(adminUrl, "mth_demo_numbers2");
    dropAtEnd.push(name);
    const url = roleUrl(adminUrl, name, "mth_owner");
    await migrate(url);
    const again = await seedDemo(url, {
      mthEnv: "demo",
      runKind: "seed",
      requestedVia: "cli",
      requestedBy: null,
      modules: MODULES,
      conditions: CONDITIONS,
    });
    expect(again.recordCounts).toEqual(summary.recordCounts);
    expect(again.checksumSha256).toBe(summary.checksumSha256);
    expect(again.seededRecords).toBe(summary.seededRecords);
  }, 180_000);
});
