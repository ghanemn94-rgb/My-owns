// Reporting periods: comparability, YTD, period and cumulative values (ADR-0028 §2, §6; T-DG4-KBE-A). Synthetic.
import { describe, expect, it } from "vitest";
import {
  checkPeriod,
  comparePeriods,
  cumulativeValue,
  KpiInputError,
  periodValue,
  ytdStart,
  ytdWindow,
  type ReportingPeriodInfo,
} from "./index.ts";

const P = (
  id: string,
  frequency: ReportingPeriodInfo["frequency"],
  start: string,
  end: string,
  weekCount: number | null = null,
) =>
  ({
    id,
    frequency,
    periodStart: start,
    periodEnd: end,
    basis: weekCount === null ? "calendar" : "weeks",
    weekCount,
  }) as const;

const months2026 = [
  P("2025-11", "monthly", "2025-11-01", "2025-11-30"),
  P("2025-12", "monthly", "2025-12-01", "2025-12-31"),
  P("2026-01", "monthly", "2026-01-01", "2026-01-31"),
  P("2026-02", "monthly", "2026-02-01", "2026-02-28"),
  P("2026-03", "monthly", "2026-03-01", "2026-03-31"),
  P("2026-04", "monthly", "2026-04-01", "2026-04-30"),
];
const q1 = P("2026-Q1", "quarterly", "2026-01-01", "2026-03-31");

describe("comparePeriods (ADR-0028 §6)", () => {
  it("same frequency, calendar basis → comparable", () => {
    expect(comparePeriods(months2026[2]!, months2026[3]!)).toEqual({ comparable: true, reason: null });
  });
  it("calendar months of different lengths (31 vs 28 days) are comparable: only week-based periods compare week counts", () => {
    expect(comparePeriods(months2026[2]!, months2026[3]!).comparable).toBe(true);
  });
  it("4-week vs 5-week → not comparable (week_count)", () => {
    const w4 = P("w4", "monthly", "2026-01-04", "2026-01-31", 4);
    const w5 = P("w5", "monthly", "2026-02-01", "2026-03-07", 5);
    expect(comparePeriods(w4, w5)).toEqual({ comparable: false, reason: "week_count" });
  });
  it("4-week vs 4-week → comparable", () => {
    const a = P("a", "monthly", "2026-01-04", "2026-01-31", 4);
    const b = P("b", "monthly", "2026-02-01", "2026-02-28", 4);
    expect(comparePeriods(a, b).comparable).toBe(true);
  });
  it("different frequency → not comparable", () => {
    expect(comparePeriods(months2026[2]!, q1)).toEqual({ comparable: false, reason: "frequency" });
  });
  it("calendar vs week-based → not comparable (period_basis)", () => {
    const w = P("w", "monthly", "2026-02-01", "2026-02-28", 4);
    expect(comparePeriods(months2026[2]!, w)).toEqual({ comparable: false, reason: "period_basis" });
  });
  it("period value vs cumulative value → not comparable (value_basis)", () => {
    expect(comparePeriods(months2026[2]!, months2026[3]!, { a: "period", b: "cumulative" })).toEqual({
      comparable: false,
      reason: "value_basis",
    });
  });
});

describe("checkPeriod: the 0033 invariants", () => {
  it("refuses a week-based period whose length is not weekCount × 7", () => {
    expect(() => checkPeriod(P("w", "monthly", "2026-01-01", "2026-01-31", 4), "p")).toThrow(KpiInputError);
  });
  it("refuses end before start, and a calendar period with a week count", () => {
    expect(() => checkPeriod(P("x", "monthly", "2026-02-01", "2026-01-31"), "p")).toThrow(KpiInputError);
    expect(() => checkPeriod({ ...months2026[0]!, weekCount: 4 }, "p")).toThrow(KpiInputError);
    expect(() => checkPeriod(P("w", "monthly", "2026-01-04", "2026-01-31", 0), "p")).toThrow(KpiInputError);
  });
});

describe("periodValue (§2, §6)", () => {
  it("flow / stock: the entered value", () => {
    expect(periodValue("flow", { kind: "value", value: "1250.75" })).toEqual({
      status: "ok",
      value: "1250.75",
      reason: null,
    });
    expect(periodValue("stock", { kind: "value", value: "0" })).toEqual({ status: "ok", value: "0", reason: null });
  });
  it("ratio: numerator / denominator", () => {
    expect(periodValue("ratio", { kind: "ratio", numerator: "45", denominator: "60" }).value).toBe("0.75");
  });
  it("ratio with denominator 0 → Not computable (kpi.zero_denominator)", () => {
    expect(periodValue("ratio", { kind: "ratio", numerator: "0", denominator: "0" })).toEqual({
      status: "not_computable",
      value: null,
      reason: "kpi.zero_denominator",
    });
  });
  it("no accepted actual → Unknown (kpi.no_accepted_actual); not available → Unknown (kpi.value_not_available)", () => {
    expect(periodValue("flow", null)).toEqual({ status: "unknown", value: null, reason: "kpi.no_accepted_actual" });
    expect(periodValue("flow", undefined).reason).toBe("kpi.no_accepted_actual");
    expect(periodValue("flow", { kind: "not_available", missingReason: "source system outage" })).toEqual({
      status: "unknown",
      value: null,
      reason: "kpi.value_not_available",
    });
  });
  it("shape errors are caller errors", () => {
    expect(() => periodValue("ratio", { kind: "value", value: "0.5" })).toThrow(KpiInputError);
    expect(() => periodValue("flow", { kind: "ratio", numerator: "1", denominator: "2" })).toThrow(KpiInputError);
    expect(() => periodValue("milestone", { kind: "value", value: "1" })).toThrow(KpiInputError);
  });
});

describe("YTD window", () => {
  it("ytdStart: calendar year and a fiscal year from April", () => {
    expect(ytdStart("2026-03-15", 1)).toBe("2026-01-01");
    expect(ytdStart("2026-03-15", 4)).toBe("2025-04-01");
    expect(ytdStart("2026-04-01", 4)).toBe("2026-04-01");
    expect(ytdStart("2026-12-31", 12)).toBe("2026-12-01");
    expect(() => ytdStart("2026-01-01", 13)).toThrow(KpiInputError);
    expect(() => ytdStart("2026-01-01", 0)).toThrow(KpiInputError);
  });
  it("window = same-frequency periods from the YTD start up to and including the current one, in order", () => {
    const shuffled = [
      months2026[4]!,
      months2026[0]!,
      q1,
      months2026[2]!,
      months2026[5]!,
      months2026[3]!,
      months2026[1]!,
    ];
    expect(ytdWindow(shuffled, months2026[4]!, 1).map((p) => p.id)).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(ytdWindow(shuffled, months2026[4]!, 11).map((p) => p.id)).toEqual([
      "2025-11",
      "2025-12",
      "2026-01",
      "2026-02",
      "2026-03",
    ]);
  });
  it("the current period is always included, even if absent from the list", () => {
    expect(ytdWindow([], months2026[2]!, 1).map((p) => p.id)).toEqual(["2026-01"]);
  });
});

describe("cumulativeValue (§2)", () => {
  const values = {
    "2026-01": { kind: "value", value: "100" },
    "2026-02": { kind: "value", value: "120.5" },
    "2026-03": { kind: "value", value: "90" },
  } as const;
  it("flow: Σ period values", () => {
    const c = cumulativeValue({
      valueNature: "flow",
      current: months2026[4]!,
      periods: months2026,
      values,
      ytdStartMonth: 1,
    });
    expect(c).toEqual({
      result: { status: "ok", value: "310.5", reason: null },
      window: ["2026-01", "2026-02", "2026-03"],
      missing: [],
    });
  });
  it("stock: the latest period value (last value), not a sum", () => {
    const c = cumulativeValue({
      valueNature: "stock",
      current: months2026[4]!,
      periods: months2026,
      values,
      ytdStartMonth: 1,
    });
    expect(c?.result.value).toBe("90");
  });
  it("ratio: Σ numerators / Σ denominators, not the mean of the period ratios", () => {
    const c = cumulativeValue({
      valueNature: "ratio",
      current: months2026[3]!,
      periods: months2026,
      values: {
        "2026-01": { kind: "ratio", numerator: "1", denominator: "10" }, // 10 %
        "2026-02": { kind: "ratio", numerator: "90", denominator: "100" }, // 90 %
      },
      ytdStartMonth: 1,
    });
    expect(c?.result.value?.slice(0, 12)).toBe("0.8272727272"); // 91/110, the mean would be 0.5
  });
  it("ratio with Σ denominators 0 → Not computable", () => {
    const c = cumulativeValue({
      valueNature: "ratio",
      current: months2026[2]!,
      periods: months2026,
      values: { "2026-01": { kind: "ratio", numerator: "0", denominator: "0" } },
      ytdStartMonth: 1,
    });
    expect(c?.result).toEqual({ status: "not_computable", value: null, reason: "kpi.zero_denominator" });
  });
  it("a single period's zero denominator does not poison the cumulative ratio when the window total is non-zero", () => {
    const c = cumulativeValue({
      valueNature: "ratio",
      current: months2026[3]!,
      periods: months2026,
      values: {
        "2026-01": { kind: "ratio", numerator: "0", denominator: "0" },
        "2026-02": { kind: "ratio", numerator: "3", denominator: "4" },
      },
      ytdStartMonth: 1,
    });
    expect(c?.result.value).toBe("0.75");
  });
  it("any missing period → Unknown (kpi.cumulative_incomplete), never a partial sum; names the gaps", () => {
    const c = cumulativeValue({
      valueNature: "flow",
      current: months2026[4]!,
      periods: months2026,
      values: { "2026-01": values["2026-01"], "2026-03": values["2026-03"] },
      ytdStartMonth: 1,
    });
    expect(c).toEqual({
      result: { status: "unknown", value: null, reason: "kpi.cumulative_incomplete" },
      window: ["2026-01", "2026-02", "2026-03"],
      missing: ["2026-02"],
    });
  });
  it("a 'not available' period also makes the cumulative Unknown; stock included", () => {
    const c = cumulativeValue({
      valueNature: "stock",
      current: months2026[3]!,
      periods: months2026,
      values: { "2026-01": { kind: "not_available" }, "2026-02": { kind: "value", value: "5" } },
      ytdStartMonth: 1,
    });
    expect(c?.result.reason).toBe("kpi.cumulative_incomplete");
    expect(c?.missing).toEqual(["2026-01"]);
  });
  it("milestone: not evaluated (null)", () => {
    expect(
      cumulativeValue({
        valueNature: "milestone",
        current: months2026[2]!,
        periods: months2026,
        values: {},
        ytdStartMonth: 1,
      }),
    ).toBeNull();
  });
  it("ignores inherited properties of the values map", () => {
    const proto = { "2026-01": { kind: "value", value: "1" } };
    const v = Object.create(proto) as Record<string, never>;
    const c = cumulativeValue({
      valueNature: "flow",
      current: months2026[2]!,
      periods: months2026,
      values: v,
      ytdStartMonth: 1,
    });
    expect(c?.result.reason).toBe("kpi.cumulative_incomplete");
  });
});
