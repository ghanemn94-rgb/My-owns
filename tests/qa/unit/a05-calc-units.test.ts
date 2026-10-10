// A05 "Calculation correctness" (master prompt §20), the parts whose requirement rows say "unit tests" or are pure display
// and period rules (qa-verifier, T-DG4-QA-A). Black-box against the public @mth/shared calc and time entry points only
// (packages/shared/src/calc.ts and time/index.ts), with the worked examples of the row texts. The API-level checks are
// in tests/qa/integration/a05-calculation-correctness.test.ts. Values are decimal strings, never floats.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  comparePeriods,
  computeChange,
  computeCriticalPath,
  cumulativeValue,
  evaluateFormula,
  evaluateMeasure,
  formatPointChange,
  formatRelativeChange,
  rollUp,
} from "../../../packages/shared/src/calc.ts";
import { businessDateOf } from "../../../packages/shared/src/time/index.ts";

type Any = Parameters<typeof rollUp>[0];

describe("REQ-S07-002: polarity-aware evaluation (unit tests)", () => {
  it("higher-better 80 vs expected 90 is adverse; lower-better 80 vs 90 is favourable", () => {
    expect(evaluateMeasure({ measureType: "higher_is_better", actual: "80", expected: "90" }).deviation).toBe(
      "adverse",
    );
    expect(evaluateMeasure({ measureType: "lower_is_better", actual: "80", expected: "90" }).deviation).toBe(
      "favourable",
    );
  });

  it("band 5-10 with 12 is outside (adverse); 7 is inside", () => {
    const out = evaluateMeasure({ measureType: "acceptable_band", actual: "12", bandLower: "5", bandUpper: "10" });
    expect([out.deviation, out.bandPosition]).toEqual(["adverse", "above"]);
    const inside = evaluateMeasure({ measureType: "acceptable_band", actual: "7", bandLower: "5", bandUpper: "10" });
    expect(inside.bandPosition).toBe("inside");
  });

  it("a binary milestone not achieved by its due date is adverse", () => {
    const m = evaluateMeasure({
      measureType: "binary_milestone",
      achieved: false,
      achievedOn: null,
      dueDate: "2026-06-30",
      businessDate: "2026-07-01",
    });
    expect(m.deviation).toBe("adverse");
  });

  it("a missing actual is unknown, never a number", () => {
    const m = evaluateMeasure({ measureType: "higher_is_better", actual: null, expected: "90" });
    expect([m.deviation, m.shortfall]).toEqual(["unknown", null]);
  });
});

describe("REQ-S07-004: percentage points vs percent; cumulative YTD", () => {
  it("a rise from 0.10 to 0.12 is shown as +2.0 pp and +20%", () => {
    const c = computeChange({ from: "0.10", to: "0.12", unitKind: "percentage" });
    expect(c.absolute.label).toBe("pp");
    expect(formatPointChange(c.absolute.value)).toBe("+2.0 pp");
    expect(formatRelativeChange(c.relative.result)).toBe("+20%");
  });

  it("cumulative YTD of a flow KPI equals the sum of its period flows", () => {
    const p = (id: string, m: number) => ({
      id,
      frequency: "monthly" as const,
      periodStart: `2026-0${m}-01`,
      periodEnd: `2026-0${m}-${m === 2 ? "28" : m === 4 ? "30" : "31"}`,
      basis: "calendar" as const,
      weekCount: null,
    });
    const periods = [p("jan", 1), p("feb", 2), p("mar", 3)];
    const ytd = cumulativeValue({
      valueNature: "flow",
      current: periods[2]!,
      periods,
      values: {
        jan: { kind: "value", value: "10.1" },
        feb: { kind: "value", value: "20.2" },
        mar: { kind: "value", value: "30.3" },
      },
      ytdStartMonth: 1,
    });
    expect(ytd?.result).toMatchObject({ status: "ok", value: "60.6" });
  });
});

describe("REQ-S07-005: zero denominator, negative baseline, incomparable periods", () => {
  it("a zero base is 'Not computable' (no division error, not 0)", () => {
    const c = computeChange({ from: "0", to: "5", unitKind: "count" });
    expect(c.relative.result.value).toBeNull();
    expect(c.relative.result.status).not.toBe("ok");
    expect(formatRelativeChange(c.relative.result)).toBeNull();
    const f = evaluateFormula("a / b", [
      { name: "a", kind: "number", period: "none", value: "1" },
      { name: "b", kind: "number", period: "none", value: "0" },
    ]);
    expect(f.result).toBeNull();
  });

  it("a percentage change from a negative baseline is flagged", () => {
    expect(computeChange({ from: "-10", to: "5", unitKind: "count" }).relative.flag).toBe("negative_baseline");
  });

  it("a 4-week period compared to a 5-week period is 'Not comparable'", () => {
    const w = (id: string, start: string, end: string, weekCount: number) => ({
      id,
      frequency: "monthly" as const,
      periodStart: start,
      periodEnd: end,
      basis: "weeks" as const,
      weekCount,
    });
    const r = comparePeriods(w("a", "2026-01-04", "2026-01-31", 4), w("b", "2026-02-01", "2026-03-07", 5));
    expect(r).toEqual({ comparable: false, reason: "week_count" });
  });
});

describe("REQ-S07-010: explicit aggregation", () => {
  const base = {
    unitKind: "percentage",
    unitLabel: null,
    currency: null,
    rule: "weighted_ratio",
    valueNature: "ratio",
    stockAdditiveAcrossScopes: false,
    periodId: "p",
    basis: "period",
    previouslyReportingScopes: [],
  } as const;
  it("two BU ratios 1/10 and 9/10 roll up to 0.50 (weighted), not the mean of percentages", () => {
    const r = rollUp({
      ...base,
      inputs: [
        { ...base, scopeId: "a", entry: { kind: "ratio", numerator: "1", denominator: "10" } },
        { ...base, scopeId: "b", entry: { kind: "ratio", numerator: "9", denominator: "10" } },
      ],
    } as Any);
    expect(r).toMatchObject({ ok: true, kind: "value", result: { value: "0.5" } });
    // Discriminating case (the example above is 0.5 under both rules): 1/10 and 80/90 -> 81/100, not the mean 0.494.
    const unequal = rollUp({
      ...base,
      inputs: [
        { ...base, scopeId: "a", entry: { kind: "ratio", numerator: "1", denominator: "10" } },
        { ...base, scopeId: "b", entry: { kind: "ratio", numerator: "80", denominator: "90" } },
      ],
    } as Any);
    expect(unequal).toMatchObject({ ok: true, kind: "value", result: { value: "0.81" } });
  });

  it("summing SAR with USD without conversion is refused", () => {
    const money = { ...base, unitKind: "currency", currency: "SAR", rule: "sum", valueNature: "flow" } as const;
    const r = rollUp({
      ...money,
      inputs: [
        { ...money, scopeId: "a", entry: { kind: "value", value: "1" } },
        { ...money, currency: "USD", scopeId: "b", entry: { kind: "value", value: "1" } },
      ],
    } as Any);
    expect(r).toMatchObject({ ok: false, code: "kpi.aggregation_unit_mismatch" });
  });
});

describe("REQ-S16-025 / REQ-S08-004: decimal formula engine without dynamic code", () => {
  it("0.1 + 0.2 SAR = 0.3 exactly; 100000 x 0.02 x 50 SAR = 100000 exactly", () => {
    const sar = (name: string, value: string) => ({ name, kind: "currency", currency: "SAR", period: "none", value });
    expect(evaluateFormula("a + b", [sar("a", "0.1"), sar("b", "0.2")]).result).toMatch(/^0\.30*$/);
    // Discriminates decimals from floats (a float sum would be ...099.25).
    expect(evaluateFormula("a + b", [sar("a", "900719925474099.1"), sar("b", "0.2")]).result).toMatch(
      /^900719925474099\.30*$/,
    );
    const r = evaluateFormula("c * u * arpu", [
      { name: "c", kind: "count", unit: "customers", period: "none", value: "100000" },
      { name: "u", kind: "fraction", period: "none", value: "0.02" },
      sar("arpu", "50"),
    ]);
    expect(r.result).toMatch(/^100000(\.0+)?$/);
  });

  it("the formula engine sources contain no eval or Function constructor (code review check)", () => {
    const dir = path.resolve(import.meta.dirname, "../../../packages/shared/src/formula");
    const files = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const code = readFileSync(path.join(dir, f), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
      expect(code, f).not.toMatch(/\beval\s*\(|new\s+Function\s*\(|\bFunction\s*\(/);
    }
  });
});

describe("REQ-S09-009: critical path by zero total float (unit)", () => {
  it("A(3)->B(7)->D(2), A->C(4)->D: path A-B-D, P = 12; a missing duration claims no path", () => {
    const node = (id: string, d: number | null) => ({ initiativeId: id, code: id, name: id, durationWorkingDays: d });
    const nodes = (d: number | null) => [node("A", 3), node("B", 7), node("C", 4), node("D", d)];
    const edge = (n: number, from: string, to: string) => ({
      dependencyId: `dep${n}`,
      code: `DEP-0${n}`,
      fromInitiativeId: from,
      toInitiativeId: to,
    });
    const edges = [edge(1, "A", "B"), edge(2, "B", "D"), edge(3, "A", "C"), edge(4, "C", "D")];
    const ok = computeCriticalPath(nodes(2), edges);
    expect(ok.criticalPaths).toEqual([["A", "B", "D"]]);
    expect(ok.projectDurationWorkingDays).toBe(12);
    const missing = computeCriticalPath(nodes(null), edges);
    expect(missing.criticalPaths).toEqual([]);
    expect(missing.reason).toBe("missing_durations");
  });
});

describe("REQ-S15-008: business date in Asia/Riyadh", () => {
  it("2026-11-02 23:30 Asia/Riyadh (20:30 UTC) is business date 2026-11-02; 00:30 the next day is 2026-11-03", () => {
    expect(businessDateOf("2026-11-02T20:30:00Z", "Asia/Riyadh")).toBe("2026-11-02");
    expect(businessDateOf("2026-11-02T21:30:00Z", "Asia/Riyadh")).toBe("2026-11-03");
  });
});
