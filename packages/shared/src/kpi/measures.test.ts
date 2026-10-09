// Measure types and the adverse deviation (ADR-0028 §1, REQ-S07-002; T-DG4-KBE-A). Synthetic fixtures.
import { describe, expect, it } from "vitest";
import { bandShortfall, deviationOfShortfall, evaluateMeasure, KD, KpiInputError } from "./index.ts";

describe("higher_is_better: s = e − a", () => {
  it.each([
    ["80", "90", "adverse", "10"],
    ["90", "90", "within", "0"],
    ["95.5", "90", "favourable", "-5.5"],
    ["-5", "-10", "favourable", "-5"], // negative values: −5 is higher than −10
    ["0.11", "0.12", "adverse", "0.01"], // percentage fractions
  ])("a=%s e=%s → %s (s=%s)", (actual, expected, deviation, shortfall) => {
    expect(evaluateMeasure({ measureType: "higher_is_better", actual, expected })).toEqual({
      deviation,
      shortfall,
      bandPosition: null,
      milestoneState: null,
      unknownInput: null,
    });
  });
});

describe("lower_is_better: s = a − e", () => {
  it.each([
    ["80", "90", "favourable", "-10"],
    ["90", "90", "within", "0"],
    ["100", "90", "adverse", "10"],
    ["3.25", "3", "adverse", "0.25"],
  ])("a=%s e=%s → %s (s=%s)", (actual, expected, deviation, shortfall) => {
    expect(evaluateMeasure({ measureType: "lower_is_better", actual, expected })).toMatchObject({
      deviation,
      shortfall,
    });
  });
});

describe("acceptable_band [L, U]: bounds included", () => {
  it.each([
    ["12", "adverse", "2", "above"],
    ["10", "within", "0", "inside"],
    ["5", "within", "0", "inside"],
    ["7.5", "within", "0", "inside"],
    ["4", "adverse", "1", "below"],
    ["-1", "adverse", "6", "below"],
  ])("band 5–10 with %s → %s (s=%s, %s)", (actual, deviation, shortfall, bandPosition) => {
    expect(evaluateMeasure({ measureType: "acceptable_band", actual, bandLower: "5", bandUpper: "10" })).toMatchObject({
      deviation,
      shortfall,
      bandPosition,
    });
  });
  it("a band is never favourable", () => {
    for (const a of ["0", "5", "7", "10", "15"]) {
      expect(
        evaluateMeasure({ measureType: "acceptable_band", actual: a, bandLower: "5", bandUpper: "10" }).deviation,
      ).not.toBe("favourable");
    }
  });
  it("a degenerate band L = U is allowed (inside only on the point)", () => {
    expect(
      evaluateMeasure({ measureType: "acceptable_band", actual: "3", bandLower: "3", bandUpper: "3" }).deviation,
    ).toBe("within");
    expect(
      evaluateMeasure({ measureType: "acceptable_band", actual: "3.1", bandLower: "3", bandUpper: "3" }).deviation,
    ).toBe("adverse");
  });
  it("L > U is a caller error", () => {
    expect(() =>
      evaluateMeasure({ measureType: "acceptable_band", actual: "1", bandLower: "10", bandUpper: "5" }),
    ).toThrow(KpiInputError);
  });
});

describe("binary_milestone (due date D, business date)", () => {
  const ms = (achieved: boolean | null, achievedOn: string | null, businessDate: string) =>
    evaluateMeasure({ measureType: "binary_milestone", achieved, achievedOn, dueDate: "2026-06-30", businessDate });
  it("achieved on or before D → favourable", () => {
    expect(ms(true, "2026-06-30", "2026-07-15")).toMatchObject({
      deviation: "favourable",
      milestoneState: "achieved_on_time",
    });
    expect(ms(true, "2026-05-01", "2026-05-02")).toMatchObject({ deviation: "favourable" });
  });
  it("achieved after D → adverse", () => {
    expect(ms(true, "2026-07-01", "2026-07-15")).toMatchObject({
      deviation: "adverse",
      milestoneState: "achieved_late",
    });
  });
  it("not achieved, today after D → adverse; on or before D → within", () => {
    expect(ms(false, null, "2026-07-01")).toMatchObject({ deviation: "adverse", milestoneState: "overdue" });
    expect(ms(false, null, "2026-06-30")).toMatchObject({ deviation: "within", milestoneState: "not_yet_due" });
    expect(ms(false, null, "2026-01-01")).toMatchObject({ deviation: "within" });
  });
  it("no accepted actual → unknown, not within", () => {
    expect(ms(null, null, "2026-07-01")).toMatchObject({ deviation: "unknown", unknownInput: "actual" });
  });
  it("achieved without a date → unknown (on time cannot be assumed)", () => {
    expect(ms(true, null, "2026-07-01")).toMatchObject({ deviation: "unknown", unknownInput: "achieved_on" });
  });
  it("a date without achieved is a caller error (CHECK kpi_actual_value_achieved_on)", () => {
    expect(() => ms(false, "2026-05-01", "2026-07-01")).toThrow(KpiInputError);
  });
  it("an invalid business date is a caller error, never a guess", () => {
    expect(() => ms(false, null, "2026-02-30")).toThrow(KpiInputError);
  });
});

describe("Unknown inputs never become 0", () => {
  it("no actual → unknown with shortfall null", () => {
    expect(evaluateMeasure({ measureType: "higher_is_better", actual: null, expected: "90" })).toEqual({
      deviation: "unknown",
      shortfall: null,
      bandPosition: null,
      milestoneState: null,
      unknownInput: "actual",
    });
    expect(
      evaluateMeasure({ measureType: "acceptable_band", actual: null, bandLower: "1", bandUpper: "2" }).shortfall,
    ).toBeNull();
  });
  it("no expectation → unknown", () => {
    expect(evaluateMeasure({ measureType: "lower_is_better", actual: "80", expected: null })).toMatchObject({
      deviation: "unknown",
      shortfall: null,
      unknownInput: "expected",
    });
  });
  it("malformed numbers are refused", () => {
    expect(() => evaluateMeasure({ measureType: "higher_is_better", actual: "80%", expected: "90" })).toThrow(
      KpiInputError,
    );
  });
});

describe("helpers", () => {
  it("deviationOfShortfall", () => {
    expect(deviationOfShortfall(new KD("0.000001"))).toBe("adverse");
    expect(deviationOfShortfall(new KD("-0"))).toBe("within");
    expect(deviationOfShortfall(new KD("-0.000001"))).toBe("favourable");
  });
  it("bandShortfall inside is exactly zero", () => {
    expect(bandShortfall(new KD(7), new KD(5), new KD(10)).shortfall.isZero()).toBe(true);
  });
});
