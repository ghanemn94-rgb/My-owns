// scoring.ts unit tests (ADR-0022 "Verification"; T-DG3-KBE-A). Worked fixtures from the playbook (B0076/B0077) plus an
// exhaustive property test whose oracle is exact rational arithmetic in BigInt (never a float, never decimal.js).
import { describe, expect, it } from "vitest";
import {
  axisScore,
  CRITERION_CODES,
  DEFAULT_WEIGHTS_V1,
  display100,
  display100Formatted,
  DISPLAY100_CONVERSION,
  DISPLAY100_LABEL_EN,
  FEASIBILITY_AXIS_CRITERIA,
  isValidScore,
  scoreResultView,
  ScoringInputError,
  VALUE_AXIS_CRITERIA,
  validateWeightSet,
  weightedScore,
  weightedScoreDisplay,
  weightTotal,
  type CriterionWeight,
} from "./scoring.ts";

const T = { timeout: 10_000 };

const V1 = DEFAULT_WEIGHTS_V1;
/** ADR-0022 §1 example accepted as version 2 (B0077: risk/compliance replaces part of strategic fit). */
const V2: CriterionWeight[] = [
  { criterionCode: "strategic_fit", weightPercent: "15" },
  { criterionCode: "financial_value", weightPercent: "25" },
  { criterionCode: "customer_impact", weightPercent: "20" },
  { criterionCode: "feasibility", weightPercent: "15" },
  { criterionCode: "time_to_value", weightPercent: "15" },
  { criterionCode: "risk_compliance", weightPercent: "10" },
];
const S54321 = { strategic_fit: 5, financial_value: 4, customer_impact: 3, feasibility: 2, time_to_value: 1 };

describe("weight-set validation (ADR-0022 §1)", () => {
  it("accepts the v1 source defaults 25/25/20/15/15 with total 100.00", T, () => {
    expect(validateWeightSet(V1)).toEqual({ ok: true, total: "100.00" });
    expect(weightTotal(V1)).toBe("100.00");
  });

  it("accepts v2 with risk_compliance 10 and strategic fit 15", T, () => {
    expect(validateWeightSet(V2)).toEqual({ ok: true, total: "100.00" });
  });

  it.each([
    ["95", "10", "95.00"],
    ["105", "20", "105.00"],
  ])(
    "rejects a set totalling %s%% with prioritization.weights_total",
    (_total, lastWeight, got) => {
      const w = [...V1.slice(0, 4), { criterionCode: "time_to_value", weightPercent: lastWeight }];
      const r = validateWeightSet(w);
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.problems).toEqual([
        { code: "prioritization.weights_total", pointer: "/weights", detail: `Weights must total 100% (got ${got}%)` },
      ]);
    },
    10_000,
  );

  it("checks the total exactly (33.33 × 3 = 99.99 is refused; 33.33+33.33+33.34 accepted)", T, () => {
    const three = (c: string) => [
      { criterionCode: "strategic_fit", weightPercent: "33.33" },
      { criterionCode: "financial_value", weightPercent: "33.33" },
      { criterionCode: "customer_impact", weightPercent: c },
    ];
    expect(validateWeightSet(three("33.33")).ok).toBe(false);
    expect(validateWeightSet(three("33.34"))).toEqual({ ok: true, total: "100.00" });
  });

  it("refuses more than 2 fraction digits, non-strings, negatives and zero weights", T, () => {
    const bad = (weightPercent: unknown) =>
      validateWeightSet([
        { criterionCode: "strategic_fit", weightPercent: weightPercent as string },
        { criterionCode: "financial_value", weightPercent: "50" },
      ]);
    for (const v of ["50.001", "-50", "5e1", " 50", "50.", ".5", "", "abc"]) {
      const r = bad(v);
      expect(r.ok, v).toBe(false);
      if (!r.ok) expect(r.problems.map((p) => p.code)).toContain("prioritization.weight_format");
    }
    const n = bad(50);
    expect(n.ok).toBe(false);
    if (!n.ok) expect(n.problems[0]!.code).toBe("prioritization.weight_format");
    const zero = validateWeightSet([
      { criterionCode: "strategic_fit", weightPercent: "0" },
      { criterionCode: "financial_value", weightPercent: "100" },
    ]);
    expect(zero.ok).toBe(false);
    if (!zero.ok) expect(zero.problems.map((p) => p.code)).toEqual(["prioritization.weight_range"]);
    const over = validateWeightSet([
      { criterionCode: "strategic_fit", weightPercent: "100.01" },
      { criterionCode: "financial_value", weightPercent: "50" },
    ]);
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.problems.map((p) => p.code)).toContain("prioritization.weight_range");
  });

  it("refuses unknown and duplicate criteria and a wrong criteria count", T, () => {
    const unknown = validateWeightSet([
      { criterionCode: "vibes", weightPercent: "50" },
      { criterionCode: "financial_value", weightPercent: "50" },
    ]);
    expect(unknown.ok).toBe(false);
    if (!unknown.ok)
      expect(unknown.problems[0]).toMatchObject({
        code: "prioritization.unknown_criterion",
        pointer: "/weights/0/criterionCode",
      });
    const proto = validateWeightSet([
      { criterionCode: "__proto__", weightPercent: "50" },
      { criterionCode: "constructor", weightPercent: "50" },
    ]);
    expect(proto.ok).toBe(false);
    const dup = validateWeightSet([
      { criterionCode: "feasibility", weightPercent: "50" },
      { criterionCode: "feasibility", weightPercent: "50" },
    ]);
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.problems.map((p) => p.code)).toEqual(["prioritization.duplicate_criterion"]);
    const one = validateWeightSet([{ criterionCode: "feasibility", weightPercent: "100" }]);
    expect(one.ok).toBe(false);
    if (!one.ok) expect(one.problems.map((p) => p.code)).toEqual(["prioritization.criteria_count"]);
    expect(CRITERION_CODES).toHaveLength(6);
  });
});

describe("weightedScore (ADR-0022 §2)", () => {
  it("5,4,3,2,1 under 25/25/20/15/15 → 3.3000 stored, 3.30 displayed", T, () => {
    const r = weightedScore(S54321, V1);
    expect(r).toEqual({
      completeness: "complete",
      weightedScore: "3.3000",
      missingCriteria: [],
      inputs: {
        strategic_fit: { score: "5", weightPercent: "25.00" },
        financial_value: { score: "4", weightPercent: "25.00" },
        customer_impact: { score: "3", weightPercent: "20.00" },
        feasibility: { score: "2", weightPercent: "15.00" },
        time_to_value: { score: "1", weightPercent: "15.00" },
      },
    });
    expect(weightedScoreDisplay(r.weightedScore)).toBe("3.30");
  });

  it("accepts scores as decimal strings with the same result", T, () => {
    const strings = Object.fromEntries(Object.entries(S54321).map(([k, v]) => [k, String(v)]));
    expect(weightedScore(strings, V1).weightedScore).toBe("3.3000");
  });

  it("v2 scores risk_compliance too", T, () => {
    const r = weightedScore({ ...S54321, risk_compliance: 5 }, V2);
    // (5×15 + 4×25 + 3×20 + 2×15 + 1×15 + 5×10) / 100 = (75+100+60+30+15+50)/100 = 3.30
    expect(r.weightedScore).toBe("3.3000");
  });

  it("a missing score → incomplete, weightedScore null (never 0), missing criteria listed in set order", T, () => {
    const r = weightedScore({ strategic_fit: 5, customer_impact: null, feasibility: 2 }, V1);
    expect(r.completeness).toBe("incomplete");
    expect(r.weightedScore).toBeNull();
    expect(r.missingCriteria).toEqual(["financial_value", "customer_impact", "time_to_value"]);
    expect(r.inputs["customer_impact"]).toEqual({ score: null, weightPercent: "20.00" });
    // v1 scores alone are incomplete under v2: risk_compliance is missing
    const v2 = weightedScore(S54321, V2);
    expect(v2).toMatchObject({ completeness: "incomplete", weightedScore: null, missingCriteria: ["risk_compliance"] });
    expect(weightedScoreDisplay(null)).toBeNull();
    expect(display100(null)).toBeNull();
  });

  it.each([0, 6, 2.5, -1, Number.NaN, Number.POSITIVE_INFINITY, "0", "6", "2.5", "4.0", " 4", "04", "", true, {}])(
    "rejects score %s",
    (bad) => {
      expect(isValidScore(bad)).toBe(false);
      expect(() => weightedScore({ ...S54321, feasibility: bad as number }, V1)).toThrow(ScoringInputError);
      try {
        weightedScore({ ...S54321, feasibility: bad as number }, V1);
      } catch (e) {
        expect((e as ScoringInputError).code).toBe("prioritization.score_range");
        expect((e as ScoringInputError).pointer).toBe("/scores/feasibility");
      }
    },
    10_000,
  );

  it("accepts 1..5 as integers and as strings", T, () => {
    for (const s of [1, 2, 3, 4, 5, "1", "2", "3", "4", "5"]) expect(isValidScore(s)).toBe(true);
  });

  it("throws on an invalid weight set with the ADR code", T, () => {
    const w = [...V1.slice(0, 4), { criterionCode: "time_to_value", weightPercent: "10" }];
    expect(() => weightedScore(S54321, w)).toThrow(/Weights must total 100% \(got 95.00%\)/);
  });

  it("ignores scores of criteria outside the set and inherited prototype keys", T, () => {
    const scores = Object.create({ strategic_fit: 5 }) as Record<string, number>;
    Object.assign(scores, {
      financial_value: 4,
      customer_impact: 3,
      feasibility: 2,
      time_to_value: 1,
      risk_compliance: 5,
    });
    const r = weightedScore(scores, V1);
    expect(r.completeness).toBe("incomplete");
    expect(r.missingCriteria).toEqual(["strategic_fit"]);
  });

  it("is exact where binary floats are not (weights 33.33/33.33/33.34, all scores 3 → 3.0000)", T, () => {
    const w = [
      { criterionCode: "strategic_fit", weightPercent: "33.33" },
      { criterionCode: "financial_value", weightPercent: "33.33" },
      { criterionCode: "customer_impact", weightPercent: "33.34" },
    ];
    expect(weightedScore({ strategic_fit: 3, financial_value: 3, customer_impact: 3 }, w).weightedScore).toBe("3.0000");
    // 0.01-weight granularity → 4 decimals: 1×33.33 + 2×33.33 + 4×33.34 = 99.99+133.36 = 233.35 → 2.3335
    expect(weightedScore({ strategic_fit: 1, financial_value: 2, customer_impact: 4 }, w).weightedScore).toBe("2.3335");
    expect(weightedScoreDisplay("2.3335")).toBe("2.33");
  });
});

describe("display helpers (ADR-0022 §2–§3)", () => {
  it("0–100 view of 3.30 → 57.5 with the conversion string and label", T, () => {
    expect(display100("3.30")).toBe("57.5");
    expect(display100("3.3000")).toBe("57.5");
    expect(DISPLAY100_CONVERSION).toBe("(score-1)/4*100");
    expect(DISPLAY100_LABEL_EN).toBe("0–100 view = (weighted score − 1) ÷ 4 × 100");
  });

  it(
    "0–100 bounds and rounding: 1 → 0, 5 → 100, 2.3335 → 33.34 (half-up of 33.3375), 1.0001 → 0 (0.0025 → 0)",
    T,
    () => {
      expect(display100("1.0000")).toBe("0");
      expect(display100("5.0000")).toBe("100");
      expect(display100("2.3335")).toBe("33.34");
      expect(display100("1.0002")).toBe("0.01"); // 0.005 → half-up 0.01
      expect(display100("1.0001")).toBe("0"); // 0.0025 → 0.00
      expect(display100("not a number")).toBeNull();
    },
  );

  it("display uses ROUND_HALF_UP at 2 digits and locale digits", T, () => {
    expect(weightedScoreDisplay("3.1250")).toBe("3.13");
    expect(weightedScoreDisplay("3.1249")).toBe("3.12");
    expect(weightedScoreDisplay("5.0000")).toBe("5.00");
    expect(weightedScoreDisplay("3.3000", { locale: "ar", digits: "arab" })).toBe("٣٫٣٠");
    expect(display100Formatted("3.3000", { locale: "en" })).toBe("57.5");
    expect(display100Formatted(null)).toBeNull();
  });

  it("scoreResultView matches the contract ScoreResult fields", T, () => {
    expect(scoreResultView(weightedScore(S54321, V1))).toEqual({
      completeness: "complete",
      weightedScore: "3.3000",
      weightedScoreDisplay: "3.30",
      display100: "57.5",
      conversion: "(score-1)/4*100",
      missingCriteria: [],
    });
    expect(scoreResultView(weightedScore({}, V1))).toEqual({
      completeness: "incomplete",
      weightedScore: null,
      weightedScoreDisplay: null,
      display100: null,
      conversion: "(score-1)/4*100",
      missingCriteria: ["strategic_fit", "financial_value", "customer_impact", "feasibility", "time_to_value"],
    });
  });

  it("comparison axes (ADR-0022 §7): weighted mean of the axis criteria, Unknown when one is missing", T, () => {
    // value: (4×25 + 3×20)/45 = 160/45 = 3.5555… → 3.5556
    expect(axisScore(S54321, V1, VALUE_AXIS_CRITERIA)).toBe("3.5556");
    // feasibility: (2×15 + 1×15)/30 = 1.5
    expect(axisScore(S54321, V1, FEASIBILITY_AXIS_CRITERIA)).toBe("1.5000");
    expect(axisScore({ ...S54321, time_to_value: null }, V1, FEASIBILITY_AXIS_CRITERIA)).toBeNull();
    expect(
      axisScore(S54321, [{ criterionCode: "strategic_fit", weightPercent: "100" }], VALUE_AXIS_CRITERIA),
    ).toBeNull();
  });
});

describe("property: all 5^5 integer score combinations under v1 equal an independent BigInt rational computation", () => {
  // Oracle: weights in hundredths of a percent (25.00% → 2500n). weighted = Σ s·w / 100 / 100 = N / 10000 exactly.
  const W = [2500n, 2500n, 2000n, 1500n, 1500n];
  const codes = ["strategic_fit", "financial_value", "customer_impact", "feasibility", "time_to_value"];

  /** Fixed-point string of n / 10^scale (n ≥ 0). */
  function fixed(n: bigint, scale: number): string {
    const s = n.toString().padStart(scale + 1, "0");
    return scale === 0 ? s : `${s.slice(0, -scale)}.${s.slice(-scale)}`;
  }
  /** Half-up rounding of num/den (num ≥ 0, den > 0) to an integer. */
  function roundHalfUp(num: bigint, den: bigint): bigint {
    return (2n * num + den) / (2n * den);
  }

  it("stored value, 2-digit display and 0–100 view all match for 3125 combinations", { timeout: 30_000 }, () => {
    let checked = 0;
    for (let i = 0; i < 5 ** 5; i++) {
      const s: bigint[] = [];
      let k = i;
      for (let c = 0; c < 5; c++) {
        s.push(BigInt((k % 5) + 1));
        k = Math.floor(k / 5);
      }
      const scores = Object.fromEntries(codes.map((code, c) => [code, Number(s[c])]));
      const N = s.reduce((acc, sc, c) => acc + sc * W[c]!, 0n); // weighted × 10000
      const r = weightedScore(scores, V1);
      expect(r.weightedScore).toBe(fixed(N, 4));
      // display: round N/10000 to 2 decimals half-up → round(N / 100)
      expect(weightedScoreDisplay(r.weightedScore)).toBe(fixed(roundHalfUp(N, 100n), 2));
      // 0–100: (N/10000 − 1)/4 × 100 = (N − 10000)/400; ×100 for 2 decimals → (N − 10000)/4, half-up
      const hundredths = roundHalfUp(N - 10000n, 4n);
      const expected100 = fixed(hundredths, 2).replace(/\.?0+$/, "") || "0";
      expect(display100(r.weightedScore)).toBe(expected100);
      checked++;
    }
    expect(checked).toBe(3125);
  });
});
