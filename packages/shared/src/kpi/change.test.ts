// pp vs %, zero base, negative baseline, variance (ADR-0028 §3, REQ-S07-004/005; T-DG4-KBE-A). Synthetic fixtures.
import { describe, expect, it } from "vitest";
import {
  computeChange,
  computeVariance,
  formatPointChange,
  formatRelativeChange,
  KpiInputError,
  unknown,
} from "./index.ts";

describe("computeChange", () => {
  it("percentage KPI: point change ×100 labelled pp, relative change labelled percent", () => {
    expect(computeChange({ from: "0.10", to: "0.12", unitKind: "percentage" })).toEqual({
      absolute: { value: "2", label: "pp" },
      relative: { result: { status: "ok", value: "0.2", reason: null }, label: "percent", flag: null },
    });
  });
  it("percentage decrease 0.25 → 0.20 is −5 pp and −20 %", () => {
    const c = computeChange({ from: "0.25", to: "0.20", unitKind: "percentage" });
    expect(c.absolute).toEqual({ value: "-5", label: "pp" });
    expect(c.relative.result.value).toBe("-0.2");
  });
  it.each(["currency", "count", "ratio", "duration", "score", "other"] as const)(
    "%s KPI: absolute difference in its unit (label unit), never pp",
    (unitKind) => {
      const c = computeChange({ from: "200", to: "250", unitKind });
      expect(c.absolute).toEqual({ value: "50", label: "unit" });
      expect(c.relative.result.value).toBe("0.25");
    },
  );
  it("zero base: relative change is Not computable (kpi.zero_base), not 0 and not an error", () => {
    const c = computeChange({ from: "0", to: "5", unitKind: "count" });
    expect(c.relative).toEqual({
      result: { status: "not_computable", value: null, reason: "kpi.zero_base" },
      label: "percent",
      flag: "zero_base",
    });
    expect(c.absolute.value).toBe("5"); // the absolute difference is still known
  });
  it("zero base to zero is still Not computable (0/0)", () => {
    expect(computeChange({ from: "0", to: "0", unitKind: "count" }).relative.result.status).toBe("not_computable");
  });
  it("negative baseline: computed with |x₀| and flagged", () => {
    const up = computeChange({ from: "-200", to: "-150", unitKind: "currency" });
    expect(up.relative).toEqual({
      result: { status: "ok", value: "0.25", reason: null },
      label: "percent",
      flag: "negative_baseline",
    });
    const down = computeChange({ from: "-100", to: "-150", unitKind: "currency" });
    expect(down.relative.result.value).toBe("-0.5");
    // Crossing zero from a negative base: −50 → 50 is +200 % (|−50| base), flagged.
    expect(computeChange({ from: "-50", to: "50", unitKind: "currency" }).relative).toMatchObject({
      result: { value: "2" },
      flag: "negative_baseline",
    });
  });
  it("no change → 0 relative (a known zero, x₀ ≠ 0)", () => {
    expect(computeChange({ from: "7", to: "7", unitKind: "count" }).relative.result).toEqual({
      status: "ok",
      value: "0",
      reason: null,
    });
  });
  it("non-terminating relative change keeps precision 80 (rounded once at storage elsewhere)", () => {
    const v = computeChange({ from: "3", to: "4", unitKind: "count" }).relative.result.value!;
    expect(v.startsWith("0.3333333333")).toBe(true);
    expect(v.length).toBeGreaterThan(70);
  });
  it("refuses malformed inputs", () => {
    expect(() => computeChange({ from: "10%", to: "12%", unitKind: "percentage" })).toThrow(KpiInputError);
  });
});

describe("computeVariance: variance = a − e, variance_ratio = (a − e) / |e|", () => {
  it("currency KPI", () => {
    expect(computeVariance({ actual: "1200000", expected: "1500000", unitKind: "currency" })).toEqual({
      variance: "-300000",
      variancePoints: null,
      varianceRatio: { status: "ok", value: "-0.2", reason: null },
      changeLabel: "unit",
      flag: null,
    });
  });
  it("percentage KPI: point variance labelled pp", () => {
    expect(computeVariance({ actual: "0.31", expected: "0.35", unitKind: "percentage" })).toMatchObject({
      variance: "-0.04",
      variancePoints: "-4",
      changeLabel: "pp",
      varianceRatio: { value: "-0.11428571428571428571428571428571428571428571428571428571428571428571428571428571" },
    });
  });
  it("e = 0 → variance known, ratio Not computable with flag zero_base", () => {
    expect(computeVariance({ actual: "5", expected: "0", unitKind: "count" })).toMatchObject({
      variance: "5",
      varianceRatio: { status: "not_computable", value: null, reason: "kpi.zero_base" },
      flag: "zero_base",
    });
  });
  it("e < 0 → flagged negative_baseline", () => {
    expect(computeVariance({ actual: "-80", expected: "-100", unitKind: "currency" })).toMatchObject({
      variance: "20",
      varianceRatio: { value: "0.2" },
      flag: "negative_baseline",
    });
  });
});

describe("display labels (en and ar)", () => {
  it("point changes: one decimal by default, sign always shown except for zero", () => {
    expect(formatPointChange("2")).toBe("+2.0 pp");
    expect(formatPointChange("-5")).toBe("-5.0 pp");
    expect(formatPointChange("0")).toBe("0.0 pp");
    expect(formatPointChange("0.04")).toBe("0.0 pp"); // rounds to zero at 1 digit: no sign
    expect(formatPointChange("2.25", { fractionDigits: 2 })).toBe("+2.25 pp");
    expect(formatPointChange("2", { locale: "ar" })).toBe("+2.0 نقطة مئوية");
    expect(formatPointChange("2", { locale: "ar", digits: "arab" })).toBe("+٢٫٠ نقطة مئوية");
  });
  it("relative changes: fraction ×100 with %", () => {
    expect(formatRelativeChange({ status: "ok", value: "0.2", reason: null })).toBe("+20%");
    expect(formatRelativeChange({ status: "ok", value: "-0.125", reason: null }, { fractionDigits: 1 })).toBe("-12.5%");
    expect(formatRelativeChange({ status: "ok", value: "0.2", reason: null }, { locale: "ar" })).toBe("+20٪");
  });
  it("Not computable / Unknown has no number to show: null, never 0%", () => {
    expect(formatRelativeChange({ status: "not_computable", value: null, reason: "kpi.zero_base" })).toBeNull();
    expect(formatRelativeChange(unknown("kpi.no_accepted_actual"))).toBeNull();
  });
  it("pp and % are never interchanged", () => {
    expect(formatPointChange("2")).not.toContain("%");
    expect(formatRelativeChange({ status: "ok", value: "0.02", reason: null })).not.toContain("pp");
  });
});
