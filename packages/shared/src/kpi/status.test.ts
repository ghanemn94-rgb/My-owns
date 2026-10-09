// Value statuses, staleness, overrides, displayed vs calculated RAG, trend (ADR-0028 §6; T-DG4-KBE-A). Synthetic.
import { describe, expect, it } from "vitest";
import {
  applyFreshness,
  computeTrend,
  displayedRag,
  freshness,
  isGreyRag,
  KPI_RAGS,
  KpiInputError,
  overrideInForce,
  slotValue,
  withReadTimeStaleness,
  type ReportingPeriodInfo,
  type StoredEvaluation,
} from "./index.ts";

describe("freshness against a business date (parameter, no clock)", () => {
  it("exactly staleAfterDays old is fresh; one day more is stale", () => {
    expect(freshness({ dataAsOf: "2026-08-25", staleAfterDays: 45, businessDate: "2026-10-09" })).toEqual({
      status: "fresh",
      dataAsOf: "2026-08-25",
      staleAfterDays: 45,
    });
    expect(freshness({ dataAsOf: "2026-08-24", staleAfterDays: 45, businessDate: "2026-10-09" }).status).toBe("stale");
  });
  it("no data_as_of → unknown (never fresh)", () => {
    expect(freshness({ dataAsOf: null, staleAfterDays: 45, businessDate: "2026-10-09" }).status).toBe("unknown");
  });
  it("a future data_as_of is fresh (not stale)", () => {
    expect(freshness({ dataAsOf: "2026-10-10", staleAfterDays: 1, businessDate: "2026-10-09" }).status).toBe("fresh");
  });
  it("refuses an out-of-range window (0033: 1–3660) and invalid dates", () => {
    expect(() => freshness({ dataAsOf: null, staleAfterDays: 0, businessDate: "2026-10-09" })).toThrow(KpiInputError);
    expect(() => freshness({ dataAsOf: null, staleAfterDays: 1.5, businessDate: "2026-10-09" })).toThrow(KpiInputError);
    expect(() => freshness({ dataAsOf: "2026-02-30", staleAfterDays: 5, businessDate: "2026-10-09" })).toThrow(
      KpiInputError,
    );
  });
  it("applyFreshness keeps the number and labels it Stale", () => {
    const stale = { status: "stale" as const, dataAsOf: "2026-01-01", staleAfterDays: 1 };
    expect(applyFreshness({ status: "ok", value: "42", reason: null }, stale)).toEqual({
      status: "stale",
      value: "42",
      reason: "kpi.stale",
    });
    expect(applyFreshness({ status: "unknown", value: null, reason: "kpi.no_accepted_actual" }, stale).status).toBe(
      "unknown",
    );
  });
});

describe("slotValue: every §6 status", () => {
  const base = { valueNature: "flow" as const, staleAfterDays: 30, businessDate: "2026-10-09", dataAsOf: "2026-10-01" };
  it("no active version → Unknown (kpi.no_active_version), even with a value", () => {
    expect(slotValue({ ...base, hasActiveVersion: false, entry: { kind: "value", value: "5" } })).toEqual({
      status: "unknown",
      value: null,
      reason: "kpi.no_active_version",
    });
  });
  it("no accepted actual → Unknown; not available → Unknown", () => {
    expect(slotValue({ ...base, hasActiveVersion: true, entry: null }).reason).toBe("kpi.no_accepted_actual");
    expect(slotValue({ ...base, hasActiveVersion: true, entry: { kind: "not_available" } }).reason).toBe(
      "kpi.value_not_available",
    );
  });
  it("fresh value → ok; old value → Stale with its number", () => {
    expect(slotValue({ ...base, hasActiveVersion: true, entry: { kind: "value", value: "5" } })).toEqual({
      status: "ok",
      value: "5",
      reason: null,
    });
    expect(
      slotValue({ ...base, hasActiveVersion: true, dataAsOf: "2026-08-01", entry: { kind: "value", value: "5" } }),
    ).toEqual({
      status: "stale",
      value: "5",
      reason: "kpi.stale",
    });
  });
  it("zero denominator → Not computable (not Stale even when old)", () => {
    expect(
      slotValue({
        ...base,
        valueNature: "ratio",
        hasActiveVersion: true,
        dataAsOf: "2020-01-01",
        entry: { kind: "ratio", numerator: "1", denominator: "0" },
      }),
    ).toEqual({ status: "not_computable", value: null, reason: "kpi.zero_denominator" });
  });
});

describe("read-time staleness (never stored)", () => {
  const stored: StoredEvaluation = {
    value: "120",
    valueStatus: "ok",
    valueReason: null,
    calculatedRag: "green",
    explanationKey: "kpi.rag.on_or_better_than_trajectory",
    dataAsOf: "2026-09-01",
  };
  it("a stored ok evaluation reads as Stale once the data has aged past the window", () => {
    expect(withReadTimeStaleness(stored, 30, "2026-10-09")).toEqual({
      value: "120",
      valueStatus: "stale",
      valueReason: "kpi.stale",
      calculatedRag: "stale",
      explanationKey: "kpi.rag.stale",
      dataAsOf: "2026-09-01",
      freshness: { status: "stale", dataAsOf: "2026-09-01", staleAfterDays: 30 },
    });
  });
  it("…and stays as stored while fresh", () => {
    expect(withReadTimeStaleness(stored, 60, "2026-10-09")).toMatchObject({
      valueStatus: "ok",
      calculatedRag: "green",
    });
  });
  it("Unknown / Not computable are not turned into Stale", () => {
    const u: StoredEvaluation = {
      ...stored,
      value: null,
      valueStatus: "unknown",
      valueReason: "kpi.no_accepted_actual",
      calculatedRag: "unknown",
      explanationKey: "kpi.rag.no_actual",
      dataAsOf: null,
    };
    expect(withReadTimeStaleness(u, 1, "2030-01-01")).toMatchObject({
      valueStatus: "unknown",
      calculatedRag: "unknown",
    });
  });
});

describe("overrides: in force while active and now < expiresAt", () => {
  const ov = { id: "ov-1", rag: "green" as const, status: "active" as const, expiresAt: "2026-10-31T21:00:00Z" };
  it("in force before expiry; not at or after it; never when revoked", () => {
    expect(overrideInForce(ov, "2026-10-31T20:59:59Z")).toBe(true);
    expect(overrideInForce(ov, "2026-10-31T21:00:00Z")).toBe(false);
    expect(overrideInForce(ov, "2026-11-01T00:00:00+03:00")).toBe(false); // = 2026-10-31T21:00:00Z
    expect(overrideInForce({ ...ov, status: "revoked" }, "2026-10-01T00:00:00Z")).toBe(false);
    expect(overrideInForce(null, "2026-10-01T00:00:00Z")).toBe(false);
  });
  it("displayedRag is the override while in force; calculatedRag is always returned", () => {
    expect(displayedRag("red", ov, "2026-10-15T08:00:00Z")).toEqual({
      calculatedRag: "red",
      displayedRag: "green",
      override: ov,
    });
  });
  it("after expiry the calculated RAG displays and no override is shown as in force", () => {
    expect(displayedRag("red", ov, "2026-11-02T08:00:00Z")).toEqual({
      calculatedRag: "red",
      displayedRag: "red",
      override: null,
    });
  });
  it("an override can display over a grey RAG while in force, but calculatedRag stays grey", () => {
    const d = displayedRag("unknown", ov, "2026-10-15T08:00:00Z");
    expect(d.calculatedRag).toBe("unknown");
    expect(d.displayedRag).toBe("green");
  });
  it("refuses a zoneless 'now'", () => {
    expect(() => overrideInForce(ov, "2026-10-15T08:00:00")).toThrow(KpiInputError);
  });
});

describe("grey RAGs", () => {
  it("unknown, stale, not_computable are grey; green/amber/red are not", () => {
    expect(KPI_RAGS.filter(isGreyRag)).toEqual(["unknown", "stale", "not_computable"]);
  });
});

describe("computeTrend (judged by the measure type)", () => {
  const m = (id: string, start: string, end: string): ReportingPeriodInfo => ({
    id,
    frequency: "monthly",
    periodStart: start,
    periodEnd: end,
    basis: "calendar",
    weekCount: null,
  });
  const sep = m("sep", "2026-09-01", "2026-09-30");
  const aug = m("aug", "2026-08-01", "2026-08-31");
  const v = (value: string) => ({ status: "ok" as const, value, reason: null });
  it("higher-is-better: up improving, down worsening, equal flat", () => {
    const t = (c: string, p: string) =>
      computeTrend({
        measureType: "higher_is_better",
        current: v(c),
        previous: v(p),
        currentPeriod: sep,
        previousPeriod: aug,
      }).trend;
    expect([t("11", "10"), t("9", "10"), t("10", "10.000")]).toEqual(["improving", "worsening", "flat"]);
  });
  it("lower-is-better: down improving", () => {
    const t = (c: string, p: string) =>
      computeTrend({
        measureType: "lower_is_better",
        current: v(c),
        previous: v(p),
        currentPeriod: sep,
        previousPeriod: aug,
      }).trend;
    expect([t("9", "10"), t("11", "10")]).toEqual(["improving", "worsening"]);
  });
  it("band: closer to the band improving, inside both flat", () => {
    const t = (c: string, p: string) =>
      computeTrend({
        measureType: "acceptable_band",
        bandLower: "5",
        bandUpper: "10",
        current: v(c),
        previous: v(p),
        currentPeriod: sep,
        previousPeriod: aug,
      }).trend;
    expect([t("11", "13"), t("3", "4"), t("6", "9"), t("12", "2")]).toEqual([
      "improving",
      "worsening",
      "flat",
      "improving",
    ]);
  });
  it("milestone: becoming achieved improving", () => {
    const t = (c: boolean | null, p: boolean | null) =>
      computeTrend({
        measureType: "binary_milestone",
        current: c,
        previous: p,
        currentPeriod: sep,
        previousPeriod: aug,
      }).trend;
    expect([t(true, false), t(false, true), t(false, false), t(true, null)]).toEqual([
      "improving",
      "worsening",
      "flat",
      "unknown",
    ]);
  });
  it("missing value or previous period → unknown", () => {
    expect(
      computeTrend({
        measureType: "higher_is_better",
        current: v("1"),
        previous: null,
        currentPeriod: sep,
        previousPeriod: aug,
      }).trend,
    ).toBe("unknown");
    expect(
      computeTrend({
        measureType: "higher_is_better",
        current: { status: "unknown", value: null, reason: "kpi.no_accepted_actual" },
        previous: v("1"),
        currentPeriod: sep,
        previousPeriod: aug,
      }).trend,
    ).toBe("unknown");
    expect(
      computeTrend({
        measureType: "higher_is_better",
        current: v("1"),
        previous: v("1"),
        currentPeriod: sep,
        previousPeriod: null,
      }),
    ).toEqual({ trend: "unknown", comparisonFlag: null });
  });
  it("incomparable periods → not_comparable with the flag, before looking at values", () => {
    const q = { ...sep, id: "q3", frequency: "quarterly" as const, periodStart: "2026-07-01" };
    expect(
      computeTrend({
        measureType: "higher_is_better",
        current: v("1"),
        previous: { status: "unknown", value: null, reason: "kpi.no_accepted_actual" },
        currentPeriod: q,
        previousPeriod: aug,
      }),
    ).toEqual({
      trend: "not_comparable",
      comparisonFlag: "not_comparable",
    });
  });
  it("stale values still give a trend (their numbers are known)", () => {
    expect(
      computeTrend({
        measureType: "higher_is_better",
        current: { status: "stale", value: "5", reason: "kpi.stale" },
        previous: v("4"),
        currentPeriod: sep,
        previousPeriod: aug,
      }).trend,
    ).toBe("improving");
  });
});
