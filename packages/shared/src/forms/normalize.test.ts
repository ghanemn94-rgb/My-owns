// Normalizers (ADR-0041 §3, §7). T-DG5-KBE-B.
import { describe, expect, it } from "vitest";
import { fieldDateOf, fractionToPercent, normalizeCurrency, normalizeDate, normalizePercentage } from "./normalize.ts";

describe("normalizePercentage", () => {
  it('12%, 12 (typed) and 0.12 (API body) all normalize to the fraction "0.12"', () => {
    expect(normalizePercentage("12%")).toEqual({ ok: true, value: "0.12" });
    expect(normalizePercentage("12", { bareAs: "percent" })).toEqual({ ok: true, value: "0.12" });
    expect(normalizePercentage("0.12")).toEqual({ ok: true, value: "0.12" });
    expect(normalizePercentage("0.12", { bareAs: "fraction" })).toEqual({ ok: true, value: "0.12" });
  });
  it("is a level, not percentage points: 12% is never 12", () => {
    expect(normalizePercentage("12%")).not.toEqual({ ok: true, value: "12" });
  });
  it("canonicalizes without rounding", () => {
    expect(normalizePercentage("-0%")).toEqual({ ok: true, value: "0" });
    expect(normalizePercentage("33.3333%")).toEqual({ ok: true, value: "0.333333" });
    expect(normalizePercentage("33.33333%")).toEqual({ ok: false, reason: "out_of_range" });
    expect(normalizePercentage("12.000%")).toEqual({ ok: true, value: "0.12" });
  });
  it.each([12, null, "", "%", "١٢%", "12 %%", "12 pp", "12e0%", "0x10"])("refuses %j", (raw) => {
    expect(normalizePercentage(raw).ok).toBe(false);
  });
  it("fractionToPercent reverses it for display", () => {
    expect(fractionToPercent("0.12")).toBe("12");
    expect(fractionToPercent("0.125")).toBe("12.5");
    expect(fractionToPercent("-0.000001")).toBe("-0.0001");
    expect(fractionToPercent("12%")).toBeNull();
  });
});

describe("normalizeCurrency", () => {
  it("keeps the amount verbatim and defaults the code", () => {
    expect(normalizeCurrency({ amount: "1500000.10", currencyCode: "SAR" }, "SAR")).toEqual({
      ok: true,
      value: { amount: "1500000.10", currencyCode: "SAR" },
    });
    expect(normalizeCurrency("1500000.10", "SAR")).toEqual({
      ok: true,
      value: { amount: "1500000.10", currencyCode: "SAR" },
    });
  });
  it("says which part is wrong", () => {
    expect(normalizeCurrency({ amount: "1.001" }, "SAR")).toEqual({ ok: false, reason: "amount" });
    expect(normalizeCurrency({ amount: "1.001" }, "SAR", 4)).toMatchObject({ ok: true });
    expect(normalizeCurrency({ amount: "1", currencyCode: "Sar" }, "SAR")).toEqual({
      ok: false,
      reason: "currency_code",
    });
    expect(normalizeCurrency({ value: "1" }, "SAR")).toEqual({ ok: false, reason: "shape" });
    expect(normalizeCurrency(1.5, "SAR")).toEqual({ ok: false, reason: "amount" });
  });
});

describe("dates in the transformation timezone", () => {
  it("normalizeDate accepts only real calendar dates", () => {
    expect(normalizeDate("2028-02-29")).toEqual({ ok: true, value: "2028-02-29" });
    expect(normalizeDate("2026-02-29")).toEqual({ ok: false, reason: "format" });
  });
  it("fieldDateOf takes the calendar date in Asia/Riyadh by default, not UTC", () => {
    expect(fieldDateOf("2026-11-01T21:30:00Z")).toEqual({ ok: true, value: "2026-11-02" });
    expect(fieldDateOf("2026-11-01T21:30:00Z", "UTC")).toEqual({ ok: true, value: "2026-11-01" });
    expect(fieldDateOf(new Date("2026-11-02T20:30:00Z"))).toEqual({ ok: true, value: "2026-11-02" });
  });
  it("refuses an unknown zone or an invalid instant (never silently UTC)", () => {
    expect(fieldDateOf("2026-11-01T21:30:00Z", "Mars/Olympus")).toEqual({ ok: false, reason: "time_zone" });
    expect(fieldDateOf("not a date")).toEqual({ ok: false, reason: "instant" });
  });
});
