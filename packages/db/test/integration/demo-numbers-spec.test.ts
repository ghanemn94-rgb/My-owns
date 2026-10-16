// Spec-level tests of the International Roaming dataset's numbers (p5-work-split §J.3; T-DG5-KBE-H): every seeded number is
// recomputed with the DG3/DG4 engines (@mth/shared/calc) and equals its literal; worked fixtures check the arithmetic by
// hand, including the two B0087 playbook shapes (Δ attach × customers × ARPU; volume × Δ unit cost); and the dataset
// rules hold: decimal strings only, value bases never mixed, Unknown and Stale never 0 or green, a forecast or a
// pending value never validated, allocations at most 100 % with the rest unallocated, fixed ids. These tests use no
// database, but import the engine, so they live outside packages/db/src (ADR-0002 rule 5) in the integration project;
// demo-numbers.test.ts recomputes the same numbers from the stored rows.
import {
  ENGINE_VERSION,
  FORMULA_DECIMAL as D,
  freshness,
  KPI_RULES_VERSION as ENGINE_KPI_RULES,
} from "@mth/shared/calc";
import { describe, expect, it } from "vitest";
import { DEMO_ACTUALS, previousActual, roundingRecord } from "../../src/demo/data/actuals.ts";
import { DEMO_BENEFITS, measuredKpiValue } from "../../src/demo/data/benefits.ts";
import {
  DEMO_CASE_LINES,
  DEMO_FORMULA_RESULT_TYPE,
  DEMO_FORMULAS,
  demoFormula,
} from "../../src/demo/data/business-cases.ts";
import { KBE_H_DATASET_MODULES, SYNTHETIC_APPROVAL_NOTE } from "../../src/demo/data/finance.ts";
import {
  DEMO_ANCHORS,
  DEMO_KPIS,
  DEMO_PERIODS,
  demoKpi,
  FORMULA_ENGINE_VERSION,
  KBE_H_FIRST_ORDER,
  kbeId,
  KPI_RULES_VERSION,
} from "../../src/demo/data/kpis.ts";
import { DEMO_ID_PATTERN } from "../../src/demo/seed.ts";
import {
  engineCumulative,
  engineEvaluation,
  formulaEvaluation,
  formulaResult,
  money4,
} from "../demo-numbers-engine.ts";

const DECIMAL = /^-?(0|[1-9]\d*)(\.\d+)?$/;
const d = (x: string) => new D(x);

describe("KPI evaluations: every literal equals the KPI engine's recomputation", () => {
  it.each(DEMO_ACTUALS.map((a) => [a.key, a] as const))("%s", (_key, a) => {
    expect(engineEvaluation(a).evaluation).toEqual(a.evaluation);
  });

  it.each(DEMO_ACTUALS.map((a) => [a.key, a] as const))("%s cumulative (YTD)", (_key, a) => {
    expect(engineCumulative(a).cumulative).toEqual(a.cumulative);
  });

  it.each(DEMO_ACTUALS.map((a) => [a.key, a] as const))(
    "%s lineage (exact value, threshold, explanation)",
    (_key, a) => {
      const e = engineEvaluation(a);
      const c = engineCumulative(a);
      expect(a.lineage.period).toEqual({
        exact: e.rounding["exact"],
        thresholdSource: e.thresholdSource,
        explanationParams: e.explanationParams,
      });
      expect(a.lineage.cumulative).toEqual({
        exact: c.rounding["exact"],
        thresholdSource: c.thresholdSource,
        explanationParams: c.explanationParams,
      });
      // The seed's plain-code rounding records equal the engine's.
      expect(roundingRecord(a.lineage.period.exact, a.evaluation.value)).toEqual(e.rounding);
      expect(roundingRecord(a.lineage.cumulative.exact, a.cumulative.value)).toEqual(c.rounding);
    },
  );

  it("the recorded engine versions are the engines' own", () => {
    expect([FORMULA_ENGINE_VERSION, KPI_RULES_VERSION]).toEqual([ENGINE_VERSION, ENGINE_KPI_RULES]);
  });

  it("worked fixture: attach rate YTD July = (39,000 + 43,740) / (200,000 + 216,000) = 0.198894 (weighted, not averaged)", () => {
    const ytd = d("39000").plus("43740").div(d("200000").plus("216000"));
    expect(ytd.toDecimalPlaces(6).toString()).toBe("0.198894");
    // The average of the two monthly percentages would be 0.19875: never used (REQ-S07-010).
    expect(d("0.195").plus("0.2025").div(2).toString()).toBe("0.19875");
    const a = DEMO_ACTUALS.find((x) => x.key === "attach_rate.2026-07")!;
    expect([a.cumulative.value, a.cumulative.calculatedRag]).toEqual(["0.198894", "unknown"]);
    for (const x of DEMO_ACTUALS) expect(x.cumulative.calculatedRag).not.toBe("green");
  });

  it("worked fixture: attach rate August = 41,800 / 220,000 = 0.19 against 0.21 expected: amber (d = 0.0952 in (0.05, 0.10])", () => {
    const a = DEMO_ACTUALS.find((x) => x.key === "attach_rate.2026-08")!;
    const value = d(a.numerator).div(a.denominator);
    expect(value.eq("0.19")).toBe(true);
    const expected = d("0.21"); // the trajectory point at the period end 2026-08-31
    const adverse = expected.minus(value).div(expected.abs()); // higher is better: shortfall / |expected|
    expect(adverse.toDecimalPlaces(6).toString()).toBe("0.095238");
    expect(adverse.gt("0.05") && adverse.lte("0.1")).toBe(true);
    expect(a.evaluation.calculatedRag).toBe("amber");
    expect(a.evaluation.variance).toBe(value.minus(expected).toString());
  });

  it("worked fixture: complaint rate August = 7,700 / 220,000 = 0.035 against 0.030 (lower is better, defaults): red", () => {
    const a = DEMO_ACTUALS.find((x) => x.key === "complaint_rate.2026-08")!;
    const value = d(a.numerator).div(a.denominator);
    const adverse = value.minus("0.03").div("0.03");
    expect(value.eq("0.035")).toBe(true);
    expect(adverse.toDecimalPlaces(6).toString()).toBe("0.166667");
    expect(adverse.gt("0.1")).toBe(true); // above the default red threshold 0.10
    expect(demoKpi("complaint_rate").threshold).toBeNull();
    expect(a.evaluation.calculatedRag).toBe("red");
  });

  it("worked fixture: partner cost July = 897,600 / 81,600,000 = 0.011 SAR/MB, 0.0005 better than 0.0115: green, favourable", () => {
    const a = DEMO_ACTUALS.find((x) => x.key === "cost_per_mb.2026-07")!;
    expect(d(a.numerator).div(a.denominator).eq("0.011")).toBe(true);
    expect([a.evaluation.variance, a.evaluation.calculatedRag, a.evaluation.deviation]).toEqual([
      "-0.0005",
      "green",
      "favourable",
    ]);
  });

  it("exactly one stale KPI (M0348): its data is more than its window old; the number is kept, the RAG is Stale, never 0 or green", () => {
    const stale = DEMO_ACTUALS.filter((a) => a.evaluation.valueStatus === "stale");
    expect(stale.map((a) => a.key)).toEqual(["cost_per_mb.2026-08"]);
    const a = stale[0]!;
    const k = demoKpi(a.kpi);
    const days = (Date.parse(a.businessDate) - Date.parse(a.dataAsOf)) / 86_400_000;
    expect([days, k.staleAfterDays]).toEqual([63, 45]);
    expect(
      freshness({ dataAsOf: a.dataAsOf, staleAfterDays: k.staleAfterDays, businessDate: a.businessDate }).status,
    ).toBe("stale");
    expect(a.evaluation.value).toBe("0.01065");
    expect(d(a.evaluation.value).isZero()).toBe(false);
    expect(a.evaluation.calculatedRag).toBe("stale");
    // Every other actual is fresh on its business date.
    for (const x of DEMO_ACTUALS.filter((y) => y !== a))
      expect(freshness({ dataAsOf: x.dataAsOf, staleAfterDays: 45, businessDate: x.businessDate }).status).toBe(
        "fresh",
      );
  });

  it("trends follow the previous month (first month Unknown, never a guessed trend)", () => {
    for (const a of DEMO_ACTUALS) {
      if (previousActual(a) === null) expect(a.evaluation.trend).toBe("unknown");
      else expect(a.evaluation.trend).not.toBe("unknown");
    }
  });

  it("every expected-to-date value is the approved trajectory point at the period end", () => {
    for (const a of DEMO_ACTUALS) {
      const p = DEMO_PERIODS.find((x) => x.key === a.period)!;
      const point = demoKpi(a.kpi).trajectory.points.find((x) => x.date === p.end)!;
      expect(d(a.evaluation.expected).eq(point.value), a.key).toBe(true);
    }
  });
});

describe("Business cases and formulas: previews, lines and the two B0087 playbook shapes", () => {
  it.each(DEMO_FORMULAS.map((f) => [f.code, f] as const))("%s preview equals the formula engine", (_c, f) => {
    expect(d(formulaResult(f)).eq(f.previewResult)).toBe(true);
  });

  it("every formula's result type is SAR per month, as recorded, and every measured calculation is unrounded", () => {
    for (const f of DEMO_FORMULAS) expect(formulaEvaluation(f).resultType).toEqual(DEMO_FORMULA_RESULT_TYPE);
    for (const b of DEMO_BENEFITS) {
      const f = demoFormula(b.formula);
      for (const m of b.measurements) {
        const e = formulaEvaluation(f, { [f.kpiVariable]: measuredKpiValue(m) });
        expect(e.rounding, m.key).toEqual(roundingRecord(m.amount, m.amount));
      }
    }
  });

  it("playbook example shape 1, Δ attach × customers × ARPU: (0.2025 - 0.18) × 220,000 × 45 SAR = 222,750 SAR (B01 July)", () => {
    const f = demoFormula("revenue_uplift");
    const hand = d("0.2025").minus("0.18").times("220000").times("45");
    expect(hand.toString()).toBe("222750");
    expect(d(formulaResult(f, { measured_attach_rate: "0.2025" })).eq(hand)).toBe(true);
    const m = DEMO_BENEFITS.find((b) => b.key === "revenue_uplift")!.measurements[0]!;
    expect([m.amount, measuredKpiValue(m)]).toEqual(["222750", "0.2025"]);
  });

  it("playbook example shape 2, volume × Δ unit cost: 80,000,000 MB × (0.012 - 0.011) SAR = 80,000 SAR (B03 July)", () => {
    const f = demoFormula("margin_improvement");
    const hand = d("80000000").times(d("0.012").minus("0.011"));
    expect(hand.toString()).toBe("80000");
    expect(d(formulaResult(f, { measured_cost_per_mb: "0.011" })).eq(hand)).toBe(true);
    const m = DEMO_BENEFITS.find((b) => b.key === "margin_improvement")!.measurements[0]!;
    expect([m.amount, measuredKpiValue(m)]).toEqual(["80000", "0.011"]);
  });

  it("each benefit line is 12 × its formula's monthly run-rate at target; each line has exactly one class and basis", () => {
    for (const l of DEMO_CASE_LINES) {
      expect((l.investmentClass === null) !== (l.benefitClass === null), l.key).toBe(true);
      if (l.formula !== null)
        expect(
          d(formulaResult(demoFormula(l.formula)))
            .times(12)
            .eq(l.amount),
          l.key,
        ).toBe(true);
    }
    // Gross benefit by basis, implementation cost by cash / non-cash: never summed across bases.
    const by = (pred: (l: (typeof DEMO_CASE_LINES)[number]) => boolean) =>
      DEMO_CASE_LINES.filter(pred)
        .reduce((s, l) => s.plus(l.amount), d("0"))
        .toString();
    expect(by((l) => l.valueBasis === "revenue_uplift")).toBe("7128000");
    expect(by((l) => l.valueBasis === "margin_uplift")).toBe("1920000");
    expect(by((l) => l.valueBasis === "avoided_cost")).toBe("1584000");
    expect(by((l) => l.valueBasis === "cash")).toBe("3660000");
    expect(by((l) => l.valueBasis === "non_cash")).toBe("1170000");
  });
});

describe("Benefit register: values, allocations, classifications, states", () => {
  it("every planned and forecast amount and every measured amount equals the formula engine (money rounded once)", () => {
    for (const b of DEMO_BENEFITS) {
      const f = demoFormula(b.formula);
      for (const p of b.planValues)
        expect(money4(formulaResult(f, { [f.kpiVariable]: p.kpiValue })), `${b.code} ${p.kind} ${p.start}`).toBe(
          p.amount,
        );
      for (const m of b.measurements)
        expect(money4(formulaResult(f, { [f.kpiVariable]: measuredKpiValue(m) })), m.key).toBe(m.amount);
      expect(d(b.plannedValue).eq(d(f.previewResult).times(12)), b.code).toBe(true);
    }
  });

  it("every planned value assumes the approved trajectory point of its month end", () => {
    for (const b of DEMO_BENEFITS)
      for (const p of b.planValues.filter((x) => x.kind === "planned")) {
        const point = demoKpi(b.kpi).trajectory.points.find((x) => x.date === p.end)!;
        expect(d(p.kpiValue).eq(point.value), `${b.code} ${p.start}`).toBe(true);
      }
  });

  it("the three chain benefits have distinct financial classifications (M0346), none non-financial or monetized without a method", () => {
    expect(DEMO_BENEFITS.map((b) => [b.code, b.benefitType, b.valueClass])).toEqual([
      ["B01", "revenue", "revenue_uplift"],
      ["B02", "cost", "avoided_cost"],
      ["B03", "revenue", "margin_uplift"],
    ]);
    expect(new Set(DEMO_BENEFITS.map((b) => b.valueClass)).size).toBe(3);
    expect(new Set(DEMO_BENEFITS.map((b) => b.kpi))).toEqual(new Set(DEMO_KPIS.map((k) => k.key)));
  });

  it("the shared benefit: B01 allocated to two initiatives, total at most 100 %, the remaining 10 % shown as unallocated", () => {
    const shared = DEMO_BENEFITS.filter((b) => new Set(b.allocations.map((a) => a.initiative)).size >= 2);
    expect(shared.map((b) => b.code)).toEqual(["B01"]);
    const total = shared[0]!.allocations.reduce((s, a) => s.plus(a.share), d("0"));
    expect(total.lte(1)).toBe(true);
    expect(d("1").minus(total).toString()).toBe("0.1");
  });

  it("one pending Finance validation; validated value only through a synthetic Finance decision; a forecast is never validated", () => {
    const ms = DEMO_BENEFITS.flatMap((b) => b.measurements.map((m) => [b.code, m] as const));
    expect(ms.filter(([, m]) => m.finance === "pending").map(([c, m]) => `${c} ${m.start}`)).toEqual([
      "B01 2026-08-01",
    ]);
    expect(ms.filter(([, m]) => m.finance === "validated").map(([c, m]) => `${c} ${m.start}`)).toEqual([
      "B01 2026-07-01",
      "B03 2026-07-01",
    ]);
    for (const [, m] of ms) expect((m.finance === "validated") === (m.decidedAt !== null)).toBe(true);
    // Only benefits whose baseline Finance validates can carry validated values (REQ-S08-008).
    for (const b of DEMO_BENEFITS)
      if (b.measurements.some((m) => m.finance === "validated")) expect(b.baselineValidated).toBe(true);
    expect(SYNTHETIC_APPROVAL_NOTE).toBe("Synthetic demonstration - approves nothing real");
  });
});

describe("Dataset rules", () => {
  it("every number is a decimal string (no binary float), and every percentage is a fraction in [0, 1]", () => {
    const numbers: [string, string][] = [];
    for (const k of DEMO_KPIS) {
      numbers.push([k.key, k.baselineValue], [k.key, k.targetValue], [k.key, k.validMin], [k.key, k.validMax]);
      for (const p of k.trajectory.points) numbers.push([`${k.key} ${p.date}`, p.value]);
      if (k.threshold) numbers.push([k.key, k.threshold.amber], [k.key, k.threshold.red]);
      if (k.unitKind === "percentage")
        for (const v of [k.baselineValue, k.targetValue, ...k.trajectory.points.map((p) => p.value)])
          expect(d(v).gte(0) && d(v).lte(1), k.key).toBe(true);
    }
    for (const a of DEMO_ACTUALS) {
      numbers.push([a.key, a.numerator], [a.key, a.denominator]);
      for (const f of ["value", "expected", "variance", "varianceRatio"] as const)
        numbers.push([a.key, a.evaluation[f]]);
    }
    for (const f of DEMO_FORMULAS) {
      numbers.push([f.code, f.previewResult]);
      for (const v of f.variables) numbers.push([`${f.code} ${v.name}`, v.value as string]);
    }
    for (const l of DEMO_CASE_LINES) numbers.push([l.key, l.amount]);
    for (const b of DEMO_BENEFITS) {
      numbers.push([b.code, b.plannedValue]);
      for (const a of b.allocations) numbers.push([b.code, a.share]);
      for (const p of b.planValues) numbers.push([b.code, p.amount], [b.code, p.kpiValue]);
      for (const m of b.measurements) numbers.push([m.key, m.amount]);
    }
    for (const [what, n] of numbers) {
      expect(typeof n, what).toBe("string");
      expect(n, what).toMatch(DECIMAL);
    }
  });

  it("fixed ids: every id is a 01995000-… literal, unique, and KBE-H's never collide with the anchors", () => {
    const anchors = [
      DEMO_ANCHORS.organizationId,
      DEMO_ANCHORS.businessUnitId,
      DEMO_ANCHORS.transformationId,
      ...Object.values(DEMO_ANCHORS.users),
      ...Object.values(DEMO_ANCHORS.initiatives),
    ];
    const ours = [
      ...DEMO_PERIODS.map((p) => p.id),
      ...DEMO_KPIS.flatMap((k) => [
        k.definitionId,
        k.versionId,
        k.trajectory.id,
        ...(k.threshold ? [k.threshold.id] : []),
      ]),
      ...DEMO_FORMULAS.flatMap((f) => [f.id, f.versionId]),
      ...DEMO_BENEFITS.map((b) => b.id),
    ];
    for (const id of [...anchors, ...ours]) expect(id).toMatch(DEMO_ID_PATTERN);
    expect(new Set([...anchors, ...ours]).size).toBe(anchors.length + ours.length);
    for (const id of ours) expect(id.slice(9, 10)).toBe("4");
    expect(kbeId(0x101, 1)).toBe("01995000-4101-7000-8000-000000000001");
    expect(() => kbeId(0x10, 1)).toThrow();
  });

  it("the modules run after BE-T's anchors, in the dependency order kpis -> actuals -> business cases -> benefits -> finance", () => {
    expect(KBE_H_DATASET_MODULES.map((m) => [m.key, m.order])).toEqual([
      ["kbe.kpis", 400],
      ["kbe.actuals", 410],
      ["kbe.business_cases", 420],
      ["kbe.benefits", 430],
      ["kbe.finance", 440],
    ]);
    for (const m of KBE_H_DATASET_MODULES) expect(m.order).toBeGreaterThanOrEqual(KBE_H_FIRST_ORDER);
  });

  it("every KPI and benefit says it is synthetic", () => {
    for (const k of DEMO_KPIS) expect(k.description).toMatch(/Synthetic demonstration value/);
    for (const b of DEMO_BENEFITS) expect(b.description).toMatch(/not Mobily actual performance/);
  });
});
