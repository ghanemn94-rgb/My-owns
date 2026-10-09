// Core helpers of the KPI library: strict decimals and dates, results, storage rounding (T-DG4-KBE-A).
import { describe, expect, it } from "vitest";
import {
  dayNumber,
  dec,
  divisionIsExact,
  hasValue,
  instant,
  isoOfDay,
  KD,
  KPI_REASON_CODES,
  KPI_EXPLANATION_KEYS,
  KpiInputError,
  notComputable,
  ok,
  plain,
  roundForStorage,
  unknown,
  yearMonth,
} from "./index.ts";

describe("dec: strict decimal strings only", () => {
  it.each(["0", "-0", "12", "-12.5", "0.000001", "123456789012345678.123456"])("accepts %s", (s) => {
    expect(() => dec(s, "x")).not.toThrow();
  });
  it.each([
    ["a number", 12],
    ["empty", ""],
    ["exponent", "1e3"],
    ["plus sign", "+1"],
    ["leading space", " 1"],
    ["NaN", "NaN"],
    ["Infinity", "Infinity"],
    ["trailing dot", "1."],
    ["leading dot", ".5"],
    ["comma", "1,5"],
    ["Arabic digits", "١٢"],
    ["null", null],
    ["too long", "1".repeat(201)],
  ])("refuses %s with KpiInputError naming the field", (_, v) => {
    expect(() => dec(v, "actual")).toThrow(KpiInputError);
    expect(() => dec(v, "actual")).toThrow(/^actual: /);
  });
  it("plain() never prints -0, an exponent or trailing zeros", () => {
    expect(plain(new KD("-0"))).toBe("0");
    expect(plain(new KD("80.000000"))).toBe("80");
    expect(plain(new KD("0.0000001"))).toBe("0.0000001");
    expect(plain(new KD("123456789012345678901234567890"))).toBe("123456789012345678901234567890");
  });
});

describe("results", () => {
  it("Unknown and Not computable carry null and a reason, never 0", () => {
    expect(unknown("kpi.no_accepted_actual")).toEqual({
      status: "unknown",
      value: null,
      reason: "kpi.no_accepted_actual",
    });
    expect(notComputable("kpi.zero_base")).toEqual({ status: "not_computable", value: null, reason: "kpi.zero_base" });
    expect(hasValue(unknown("kpi.stale"))).toBe(false);
    expect(hasValue(ok(new KD(0)))).toBe(true);
    expect(ok(new KD(0)).value).toBe("0"); // a known zero is a value, distinct from Unknown
  });
  it("results are frozen", () => {
    expect(Object.isFrozen(ok(new KD(1)))).toBe(true);
    expect(Object.isFrozen(unknown("kpi.scope_missing"))).toBe(true);
  });
  it("every reason code matches the contract pattern ^kpi\\.[a-z_]{1,60}$ (kpi_evaluation.value_reason)", () => {
    for (const r of KPI_REASON_CODES) expect(r).toMatch(/^kpi\.[a-z_]{1,60}$/);
  });
  it("every explanation key matches ^kpi\\.rag\\.[a-z_]{1,60}$ and the ADR-0028 §6 list has 13 keys", () => {
    for (const k of KPI_EXPLANATION_KEYS) expect(k).toMatch(/^kpi\.rag\.[a-z_]{1,60}$/);
    expect(KPI_EXPLANATION_KEYS).toHaveLength(13);
  });
});

describe("roundForStorage: once, half-up, numeric(24,6)", () => {
  it("records an exact value as not rounded", () => {
    const r = roundForStorage("150");
    expect(r).toEqual({
      ok: true,
      stored: "150",
      rounding: {
        column: "numeric(24,6)",
        scale: 6,
        mode: "ROUND_HALF_UP",
        precision: 80,
        exact: "150",
        stored: "150.000000",
        rounded: false,
        inexactIntermediate: false,
      },
    });
  });
  it("rounds 1/3 to 0.333333 and 2/3 to 0.666667 and says so", () => {
    const third = plain(new KD(1).div(3));
    const r1 = roundForStorage(third, true);
    expect(r1.ok && r1.stored).toBe("0.333333");
    expect(r1.rounding).toMatchObject({ rounded: true, inexactIntermediate: true });
    const r2 = roundForStorage(plain(new KD(2).div(3)), true);
    expect(r2.ok && r2.stored).toBe("0.666667");
  });
  it("half-up at the 7th digit: 0.0000005 → 0.000001, -0.0000005 → -0.000001", () => {
    expect(roundForStorage("0.0000005")).toMatchObject({ ok: true, stored: "0.000001" });
    expect(roundForStorage("-0.0000005")).toMatchObject({ ok: true, stored: "-0.000001" });
  });
  it("zero is stored as 0.000000", () => {
    expect(roundForStorage("0").rounding.stored).toBe("0.000000");
  });
  it("refuses a value that does not fit numeric(24,6) instead of truncating", () => {
    expect(roundForStorage("999999999999999999.999999")).toMatchObject({ ok: true });
    expect(roundForStorage("1000000000000000000")).toMatchObject({ ok: false, reason: "kpi.value_out_of_range" });
    expect(roundForStorage("999999999999999999.9999995")).toMatchObject({ ok: false });
  });
  it("divisionIsExact", () => {
    expect(divisionIsExact(new KD(1), new KD(4))).toBe(true);
    expect(divisionIsExact(new KD(1), new KD(3))).toBe(false);
    // Regression (found by trajectory.test.ts): 900/91 multiplied back at precision 80 rounds to 900 exactly.
    expect(divisionIsExact(new KD(900), new KD(91))).toBe(false);
    expect(divisionIsExact(new KD(2), new KD(3))).toBe(false);
    expect(divisionIsExact(new KD("0.75"), new KD("0.25"))).toBe(true);
  });
});

describe("dates", () => {
  it("dayNumber counts days and round-trips", () => {
    expect(dayNumber("1970-01-02", "d")).toBe(1);
    expect(dayNumber("2026-03-01", "d") - dayNumber("2026-02-28", "d")).toBe(1);
    expect(dayNumber("2028-03-01", "d") - dayNumber("2028-02-28", "d")).toBe(2); // leap year
    expect(isoOfDay(dayNumber("2026-10-09", "d"))).toBe("2026-10-09");
  });
  it.each(["2026-02-30", "2026-13-01", "26-10-09", "2026-10-09T00:00:00Z", "", "2026/10/09"])("refuses %s", (d) => {
    expect(() => dayNumber(d, "businessDate")).toThrow(KpiInputError);
  });
  it("refuses a non-string date", () => {
    expect(() => dayNumber(20261009, "d")).toThrow(KpiInputError);
  });
  it("yearMonth", () => {
    expect(yearMonth("2026-07-15", "d")).toEqual({ year: 2026, month: 7 });
  });
  it("instant requires a zone and a valid timestamp", () => {
    expect(instant("2026-10-09T00:00:00Z", "t")).toBe(Date.UTC(2026, 9, 9));
    expect(instant("2026-10-09T03:00:00+03:00", "t")).toBe(Date.UTC(2026, 9, 9));
    expect(() => instant("2026-10-09T00:00:00", "t")).toThrow(KpiInputError); // no zone: ambiguous
    expect(() => instant("2026-10-09", "t")).toThrow(KpiInputError);
    expect(() => instant("2026-02-30T99:00:00Z", "t")).toThrow(KpiInputError);
  });
});
