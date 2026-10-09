// RAG with versioned thresholds (ADR-0028 §5, §6; REQ-S07-007; T-DG4-KBE-A). Synthetic fixtures.
import { describe, expect, it } from "vitest";
import {
  classifyDeviation,
  DEFAULT_RAG_THRESHOLDS,
  evaluateRag,
  KpiInputError,
  resolveThresholds,
  unknown,
  type DirectionalRagInput,
  type RagThresholdVersion,
} from "./index.ts";

const okv = (value: string) => ({ status: "ok" as const, value, reason: null });
const hib = (actual: string, expected: string, thresholds: RagThresholdVersion | null = null): DirectionalRagInput => ({
  measureType: "higher_is_better",
  actual: okv(actual),
  expected: okv(expected),
  trajectoryVersion: 3,
  thresholds,
});
const absolute: RagThresholdVersion = {
  id: "thr-abs",
  versionNo: 4,
  toleranceMode: "absolute",
  amberThreshold: "2",
  redThreshold: "5",
};

describe("thresholds", () => {
  it("defaults are relative 0.05 / 0.10, recorded as source default", () => {
    expect(DEFAULT_RAG_THRESHOLDS).toEqual({ toleranceMode: "relative", amberThreshold: "0.05", redThreshold: "0.10" });
    expect(resolveThresholds(null)).toEqual({
      source: "default",
      id: null,
      versionNo: null,
      toleranceMode: "relative",
      amberThreshold: "0.05",
      redThreshold: "0.10",
    });
  });
  it("a configured version is used as given", () => {
    expect(resolveThresholds(absolute)).toMatchObject({
      source: "configured",
      id: "thr-abs",
      versionNo: 4,
      toleranceMode: "absolute",
    });
  });
  it("refuses red < amber, negative amber, an unknown mode and a bad version number", () => {
    expect(() => resolveThresholds({ ...absolute, amberThreshold: "5", redThreshold: "2" })).toThrow(KpiInputError);
    expect(() => resolveThresholds({ ...absolute, amberThreshold: "-1" })).toThrow(KpiInputError);
    expect(() => resolveThresholds({ ...absolute, toleranceMode: "percent" as never })).toThrow(KpiInputError);
    expect(() => resolveThresholds({ ...absolute, versionNo: 0 })).toThrow(KpiInputError);
  });
  it("classifyDeviation boundaries: d ≤ amber green, ≤ red amber, > red red", () => {
    const t = resolveThresholds(null);
    expect(classifyDeviation("-1", t)).toBe("green");
    expect(classifyDeviation("0.05", t)).toBe("green");
    expect(classifyDeviation("0.050001", t)).toBe("amber");
    expect(classifyDeviation("0.1", t)).toBe("amber");
    expect(classifyDeviation("0.100001", t)).toBe("red");
  });
  it("amber = red collapses the amber band", () => {
    const t = resolveThresholds({
      id: "x",
      versionNo: 1,
      toleranceMode: "relative",
      amberThreshold: "0.1",
      redThreshold: "0.1",
    });
    expect(classifyDeviation("0.1", t)).toBe("green");
    expect(classifyDeviation("0.1000001", t)).toBe("red");
  });
});

describe("higher/lower is better against the trajectory (relative)", () => {
  it.each([
    ["100", "100", "green", "kpi.rag.on_or_better_than_trajectory", "0"],
    ["110", "100", "green", "kpi.rag.on_or_better_than_trajectory", "-0.1"],
    ["95", "100", "green", "kpi.rag.on_or_better_than_trajectory", "0.05"],
    ["94", "100", "amber", "kpi.rag.amber_band", "0.06"],
    ["90", "100", "amber", "kpi.rag.amber_band", "0.1"],
    ["89.99", "100", "red", "kpi.rag.red_threshold", "0.1001"],
    [
      "80",
      "90",
      "red",
      "kpi.rag.red_threshold",
      "0.11111111111111111111111111111111111111111111111111111111111111111111111111111111",
    ],
  ])("higher-is-better a=%s e=%s → %s", (a, e, rag, key, d) => {
    const r = evaluateRag(hib(a, e));
    expect(r).toMatchObject({
      calculatedRag: rag,
      explanationKey: key,
      adverseDeviation: d,
      thresholdSource: "default",
      thresholdId: null,
    });
  });
  it("lower-is-better: above the trajectory is adverse", () => {
    const base = { measureType: "lower_is_better" as const, trajectoryVersion: 1, thresholds: null };
    expect(evaluateRag({ ...base, actual: okv("80"), expected: okv("90") })).toMatchObject({
      calculatedRag: "green",
      deviation: "favourable",
    });
    // 99 vs 90: d = 9/90 = 0.10 exactly → amber (d ≤ red); 100 vs 90: d = 0.111… → red
    expect(evaluateRag({ ...base, actual: okv("99"), expected: okv("90") })).toMatchObject({
      calculatedRag: "amber",
      deviation: "adverse",
    });
    expect(evaluateRag({ ...base, actual: okv("100"), expected: okv("90") })).toMatchObject({
      calculatedRag: "red",
      deviation: "adverse",
    });
  });
  it("relative d uses |e| for a negative expectation", () => {
    // e = −100, a = −112 (higher is better): s = 12, d = 12/100 = 0.12 → red
    expect(evaluateRag(hib("-112", "-100"))).toMatchObject({ calculatedRag: "red", adverseDeviation: "0.12" });
  });
  it("relative with e = 0 → Not computable (kpi.zero_base), deviation still reported", () => {
    const r = evaluateRag(hib("5", "0"));
    expect(r).toMatchObject({
      calculatedRag: "not_computable",
      explanationKey: "kpi.rag.not_computable",
      reason: "kpi.zero_base",
      deviation: "favourable",
      adverseDeviation: null,
    });
  });
  it("absolute mode: d = s in the KPI's unit; e = 0 is fine", () => {
    expect(evaluateRag(hib("98", "100", absolute))).toMatchObject({ calculatedRag: "green", adverseDeviation: "2" });
    expect(evaluateRag(hib("97", "100", absolute))).toMatchObject({ calculatedRag: "amber", adverseDeviation: "3" });
    expect(evaluateRag(hib("94", "100", absolute))).toMatchObject({ calculatedRag: "red", adverseDeviation: "6" });
    expect(evaluateRag(hib("-6", "0", absolute))).toMatchObject({
      calculatedRag: "red",
      thresholdSource: "configured",
      thresholdId: "thr-abs",
    });
  });
  it("percentage KPI thresholds in absolute mode are fractions (0.02 = 2 pp)", () => {
    const pp: RagThresholdVersion = {
      id: "t",
      versionNo: 1,
      toleranceMode: "absolute",
      amberThreshold: "0.01",
      redThreshold: "0.02",
    };
    expect(evaluateRag(hib("0.335", "0.35", pp)).calculatedRag).toBe("amber");
    expect(evaluateRag(hib("0.32", "0.35", pp)).calculatedRag).toBe("red");
  });
});

describe("the explanation names the threshold used (ADR-0028 §6 element 7)", () => {
  it("configured", () => {
    const r = evaluateRag(hib("94", "100", absolute));
    expect(r.explanationParams).toEqual({
      thresholdSource: "configured",
      thresholdVersion: 4,
      toleranceMode: "absolute",
      amberThreshold: "2",
      redThreshold: "5",
      trajectoryVersion: 3,
      expected: "100",
      actual: "94",
      deviationValue: "6",
    });
  });
  it("default", () => {
    expect(evaluateRag(hib("94", "100")).explanationParams).toMatchObject({
      thresholdSource: "default",
      thresholdVersion: null,
      toleranceMode: "relative",
      amberThreshold: "0.05",
      redThreshold: "0.10",
    });
  });
  it("none when no threshold was applied (Unknown / Stale / milestone)", () => {
    const r = evaluateRag({ ...hib("1", "1", absolute), actual: unknown("kpi.no_accepted_actual") });
    expect(r).toMatchObject({ thresholdSource: "none", thresholdId: null });
    expect(r.explanationParams).toMatchObject({
      thresholdSource: "none",
      thresholdVersion: null,
      amberThreshold: null,
      reason: "kpi.no_accepted_actual",
    });
  });
});

describe("value statuses force the RAG (0035 kpi_evaluation_unknown_rag)", () => {
  it("Unknown actual → unknown, kpi.rag.no_actual, never green", () => {
    for (const reason of [
      "kpi.no_accepted_actual",
      "kpi.value_not_available",
      "kpi.no_active_version",
      "kpi.cumulative_incomplete",
    ] as const) {
      const r = evaluateRag({ ...hib("1", "1"), actual: unknown(reason) });
      expect(r).toMatchObject({
        calculatedRag: "unknown",
        explanationKey: "kpi.rag.no_actual",
        deviation: "unknown",
        reason,
      });
    }
  });
  it("Not computable actual → not_computable", () => {
    const r = evaluateRag({
      ...hib("1", "1"),
      actual: { status: "not_computable", value: null, reason: "kpi.zero_denominator" },
    });
    expect(r).toMatchObject({
      calculatedRag: "not_computable",
      explanationKey: "kpi.rag.not_computable",
      reason: "kpi.zero_denominator",
    });
  });
  it("Stale actual → stale, even if the number would be green", () => {
    const r = evaluateRag({ ...hib("1", "1"), actual: { status: "stale", value: "200", reason: "kpi.stale" } });
    expect(r).toMatchObject({ calculatedRag: "stale", explanationKey: "kpi.rag.stale", deviation: "unknown" });
    expect(r.explanationParams.actual).toBe("200");
  });
  it("no approved trajectory → unknown (kpi.rag.no_approved_trajectory)", () => {
    const r = evaluateRag({
      ...hib("1", "1"),
      expected: unknown("kpi.no_approved_trajectory"),
      trajectoryVersion: null,
    });
    expect(r).toMatchObject({ calculatedRag: "unknown", explanationKey: "kpi.rag.no_approved_trajectory" });
  });
  it("before the trajectory → unknown (kpi.rag.before_trajectory)", () => {
    const r = evaluateRag({ ...hib("1", "1"), expected: unknown("kpi.before_trajectory") });
    expect(r).toMatchObject({
      calculatedRag: "unknown",
      explanationKey: "kpi.rag.before_trajectory",
      reason: "kpi.before_trajectory",
    });
  });
  it("green/amber/red only ever come with a known deviation (0035 kpi_evaluation_rag_needs_data)", () => {
    for (const [a, e] of [
      ["100", "100"],
      ["94", "100"],
      ["50", "100"],
    ] as const) {
      const r = evaluateRag(hib(a, e));
      expect(["green", "amber", "red"]).toContain(r.calculatedRag);
      expect(r.deviation).not.toBe("unknown");
    }
  });
});

describe("acceptable band", () => {
  const band = (actual: string, thresholds: RagThresholdVersion | null = null) =>
    evaluateRag({ measureType: "acceptable_band", actual: okv(actual), bandLower: "5", bandUpper: "10", thresholds });
  it("inside → green (kpi.rag.inside_band), bounds included", () => {
    for (const a of ["5", "7", "10"])
      expect(band(a)).toMatchObject({
        calculatedRag: "green",
        explanationKey: "kpi.rag.inside_band",
        deviation: "within",
      });
  });
  it("outside → d = s / (U − L) against the thresholds (kpi.rag.outside_band)", () => {
    expect(band("10.25")).toMatchObject({
      calculatedRag: "green",
      explanationKey: "kpi.rag.outside_band",
      adverseDeviation: "0.05",
    });
    expect(band("10.5")).toMatchObject({ calculatedRag: "amber", adverseDeviation: "0.1" });
    expect(band("4")).toMatchObject({ calculatedRag: "red", adverseDeviation: "0.2", deviation: "adverse" });
  });
  it("absolute mode: d = s", () => {
    expect(band("12", absolute)).toMatchObject({ calculatedRag: "green", adverseDeviation: "2" });
    expect(band("16", absolute)).toMatchObject({ calculatedRag: "red", adverseDeviation: "6" });
  });
  it("relative with U = L → Not computable (kpi.zero_base)", () => {
    const r = evaluateRag({
      measureType: "acceptable_band",
      actual: okv("3"),
      bandLower: "3",
      bandUpper: "3",
      thresholds: null,
    });
    expect(r).toMatchObject({ calculatedRag: "not_computable", reason: "kpi.zero_base" });
  });
  it("names the band in the explanation", () => {
    expect(band("12").explanationParams).toMatchObject({
      bandLower: "5",
      bandUpper: "10",
      actual: "12",
      trajectoryVersion: null,
    });
  });
});

describe("binary milestone (thresholds unused)", () => {
  const m = (achieved: boolean, achievedOn: string | null, businessDate: string) =>
    evaluateRag({
      measureType: "binary_milestone",
      actual: { status: "ok", achieved, achievedOn },
      dueDate: "2026-06-30",
      businessDate,
      thresholds: absolute,
    });
  it("achieved on time → green (milestone_achieved)", () => {
    expect(m(true, "2026-06-01", "2026-07-10")).toMatchObject({
      calculatedRag: "green",
      explanationKey: "kpi.rag.milestone_achieved",
      thresholdSource: "none",
    });
  });
  it("not yet due → green (milestone_not_yet_due), not amber", () => {
    expect(m(false, null, "2026-06-30")).toMatchObject({
      calculatedRag: "green",
      explanationKey: "kpi.rag.milestone_not_yet_due",
      deviation: "within",
    });
  });
  it("overdue or late → red (milestone_overdue)", () => {
    expect(m(false, null, "2026-07-01")).toMatchObject({
      calculatedRag: "red",
      explanationKey: "kpi.rag.milestone_overdue",
    });
    expect(m(true, "2026-07-02", "2026-07-10")).toMatchObject({ calculatedRag: "red" });
  });
  it("achieved without a date → unknown, not green", () => {
    expect(m(true, null, "2026-07-10")).toMatchObject({
      calculatedRag: "unknown",
      explanationKey: "kpi.rag.no_actual",
    });
  });
  it("no accepted actual / stale → unknown / stale", () => {
    const base = {
      measureType: "binary_milestone" as const,
      dueDate: "2026-06-30",
      businessDate: "2026-07-10",
      thresholds: null,
    };
    expect(evaluateRag({ ...base, actual: unknown("kpi.no_accepted_actual") }).calculatedRag).toBe("unknown");
    expect(
      evaluateRag({ ...base, actual: { status: "stale", achieved: true, achievedOn: "2026-06-01" } }).calculatedRag,
    ).toBe("stale");
  });
});

describe("RAG never reads activity completion", () => {
  it("the input types carry no task, action, deliverable or initiative field", () => {
    const input = hib("120", "150");
    expect(Object.keys(input).sort()).toEqual(["actual", "expected", "measureType", "thresholds", "trajectoryVersion"]);
  });
  it("extra properties (e.g. a caller passing task completion) change nothing", () => {
    const plain = evaluateRag(hib("120", "150"));
    const withTasks = evaluateRag({
      ...hib("120", "150"),
      ...({ tasksComplete: 10, tasksTotal: 10, initiativeStatus: "completed" } as object),
    } as DirectionalRagInput);
    expect(withTasks).toEqual(plain);
    expect(withTasks.calculatedRag).toBe("red");
  });
});
