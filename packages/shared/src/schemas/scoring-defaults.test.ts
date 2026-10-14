// Unit tests of the T06 default weights and rubric mirrors (REQ-PB-093; ADR-0040 §5, ADR-0039 §12; T-DG5-KBE-A).
// Worked fixtures: the B0076 source defaults (25/25/20/15/15), the PB-093 acceptance weights (30/20/20/15/15), the
// B0077 risk/compliance criterion, and the 95 % total that a draft may hold but publish refuses.
import { describe, expect, it } from "vitest";
import { weightedScore } from "../scoring.ts";
import {
  SCORING_DEFAULT_CRITERIA,
  scoringDefaults,
  scoringDefaultsPut,
  scoringDefaultsQuery,
  scoringRubric,
  scoringWeight,
} from "./scoring-defaults.ts";

const NULL_LEVELS = [1, 2, 3, 4, 5].map((score) => ({ score, descriptorEn: null, descriptorAr: null }));
const w = (criterionCode: string, weightPercent: string) => ({ criterionCode, weightPercent });
const ACCEPTANCE = [
  w("strategic_fit", "30"),
  w("financial_value", "20"),
  w("customer_impact", "20"),
  w("feasibility", "15"),
  w("time_to_value", "15"),
];
const issues = (r: { success: boolean; error?: { issues: { message: string }[] } }) =>
  r.error?.issues.map((i) => i.message) ?? [];

describe("scoringWeight (decimal percent strings, never floats)", () => {
  it("accepts 0 < w <= 100 with at most two decimals", () => {
    for (const ok of ["25", "25.00", "12.5", "0.01", "99.99", "100", "100.0", "100.00", "7"])
      expect(scoringWeight.safeParse(w("feasibility", ok)).success, ok).toBe(true);
  });
  it("refuses zero, more than 100, three decimals, signs, exponents and numbers with validation.weight_percent", () => {
    for (const bad of ["0", "0.0", "0.00", "00", "100.01", "101", "12.345", "-5", "+5", "1e2", " 5", "5 ", ".5", ""]) {
      const r = scoringWeight.safeParse(w("feasibility", bad));
      expect(r.success, bad).toBe(false);
      expect(issues(r), bad).toContain("validation.weight_percent");
    }
    expect(scoringWeight.safeParse({ criterionCode: "feasibility", weightPercent: 15 }).success).toBe(false);
  });
  it("knows exactly the six T06 criteria (B0076 and B0077's risk/compliance)", () => {
    expect(SCORING_DEFAULT_CRITERIA).toEqual([
      "strategic_fit",
      "financial_value",
      "customer_impact",
      "feasibility",
      "time_to_value",
      "risk_compliance",
    ]);
    expect(scoringWeight.safeParse(w("speed", "10")).success).toBe(false);
  });
});

describe("scoringRubric (five 1-5 levels; null descriptors are kept, never invented)", () => {
  it("accepts five ordered levels with null or 1-500 character descriptors in both languages", () => {
    expect(scoringRubric.safeParse({ criterionCode: "feasibility", levels: NULL_LEVELS }).success).toBe(true);
    const text = NULL_LEVELS.map((l) => ({ ...l, descriptorEn: "x".repeat(500), descriptorAr: "وصف" }));
    expect(scoringRubric.safeParse({ criterionCode: "feasibility", levels: text }).success).toBe(true);
  });
  it("refuses four or six levels, unordered scores, empty, blank or over-long descriptors", () => {
    for (const levels of [
      NULL_LEVELS.slice(0, 4),
      [...NULL_LEVELS, { score: 5, descriptorEn: null, descriptorAr: null }],
      [...NULL_LEVELS].reverse(),
      NULL_LEVELS.map((l) => ({ ...l, score: 1 })),
      NULL_LEVELS.map((l) => ({ ...l, descriptorEn: "" })),
      NULL_LEVELS.map((l) => ({ ...l, descriptorEn: "   " })),
      NULL_LEVELS.map((l) => ({ ...l, descriptorAr: "x".repeat(501) })),
    ])
      expect(scoringRubric.safeParse({ criterionCode: "feasibility", levels }).success).toBe(false);
  });
});

describe("scoringDefaultsPut (2-6 distinct criteria; the total is checked at publish, not here)", () => {
  it("accepts the PB-093 acceptance set and the source set", () => {
    expect(scoringDefaultsPut.safeParse({ weights: ACCEPTANCE, rubrics: [] }).success).toBe(true);
  });
  it("accepts a 95% draft: the 100% rule is a publish rule (422 config_version.weights_total)", () => {
    const ninetyFive = [...ACCEPTANCE.slice(0, 4), w("time_to_value", "10")];
    expect(scoringDefaultsPut.safeParse({ weights: ninetyFive, rubrics: [] }).success).toBe(true);
  });
  it("refuses one or seven criteria, duplicates (validation.unique_items), a missing member and extra members", () => {
    expect(scoringDefaultsPut.safeParse({ weights: [ACCEPTANCE[0]], rubrics: [] }).success).toBe(false);
    expect(
      scoringDefaultsPut.safeParse({
        weights: [...ACCEPTANCE, w("risk_compliance", "1"), w("risk_compliance", "1")],
        rubrics: [],
      }).success,
    ).toBe(false);
    const dup = scoringDefaultsPut.safeParse({ weights: [ACCEPTANCE[0], ACCEPTANCE[0]], rubrics: [] });
    expect(issues(dup)).toContain("validation.unique_items");
    const dupRubric = scoringDefaultsPut.safeParse({
      weights: ACCEPTANCE,
      rubrics: [
        { criterionCode: "feasibility", levels: NULL_LEVELS },
        { criterionCode: "feasibility", levels: NULL_LEVELS },
      ],
    });
    expect(issues(dupRubric)).toContain("validation.unique_items");
    expect(scoringDefaultsPut.safeParse({ weights: ACCEPTANCE }).success).toBe(false);
    expect(scoringDefaultsPut.safeParse({ weights: ACCEPTANCE, rubrics: [], total: "100" }).success).toBe(false);
  });
});

describe("scoringDefaults (the response) and the query", () => {
  it("parses a version with decimal weights, a decimal total string and null descriptors", () => {
    const body = {
      versionId: "01920005-0000-7000-8000-000000000001",
      versionNo: 1,
      status: "published",
      isNewestPublished: true,
      weights: [w("strategic_fit", "25.00"), w("financial_value", "25.00")],
      weightTotal: "50.00",
      rubrics: [{ criterionCode: "strategic_fit", levels: NULL_LEVELS }],
      version: 1,
    };
    expect(scoringDefaults.parse(body)).toEqual(body);
    expect(scoringDefaults.safeParse({ ...body, extra: 1 }).success).toBe(false);
  });
  it("takes an optional uuid versionId and nothing else", () => {
    expect(scoringDefaultsQuery.safeParse({}).success).toBe(true);
    expect(scoringDefaultsQuery.safeParse({ versionId: "nope" }).success).toBe(false);
    expect(scoringDefaultsQuery.safeParse({ kind: "x" }).success).toBe(false);
  });
});

describe("worked fixture: a T06 sample scored with the defaults through the DG3 engine (unchanged)", () => {
  it("source defaults: scores 5/4/3/2/1 give (125+100+60+30+15)/100 = 3.3000", () => {
    const source = [
      w("strategic_fit", "25.00"),
      w("financial_value", "25.00"),
      w("customer_impact", "20.00"),
      w("feasibility", "15.00"),
      w("time_to_value", "15.00"),
    ];
    const scores = { strategic_fit: 5, financial_value: 4, customer_impact: 3, feasibility: 2, time_to_value: 1 };
    expect(weightedScore(scores, source).weightedScore).toBe("3.3000");
  });
  it("PB-093 defaults 30/20/20/15/15: the same scores give (150+80+60+30+15)/100 = 3.3500", () => {
    const set = ACCEPTANCE.map((x) => ({ ...x, weightPercent: `${x.weightPercent}.00` }));
    const scores = { strategic_fit: 5, financial_value: 4, customer_impact: 3, feasibility: 2, time_to_value: 1 };
    expect(weightedScore(scores, set).weightedScore).toBe("3.3500");
  });
});
