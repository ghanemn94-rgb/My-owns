// Roll-ups across scopes (ADR-0028 §7, REQ-S07-010; T-DG4-KBE-A). Synthetic fixtures.
import { describe, expect, it } from "vitest";
import { KpiInputError, RULE_FOR_NATURE, rollUp, ruleFitsNature, type RollUpInput, type ScopeValue } from "./index.ts";

const unit = { unitKind: "count" as const, unitLabel: "orders", currency: null };
const sv = (scopeId: string, entry: ScopeValue["entry"], over: Partial<ScopeValue> = {}): ScopeValue => ({
  scopeId,
  periodId: "2026-09",
  basis: "period",
  ...unit,
  entry,
  ...over,
});
const input = (inputs: ScopeValue[], over: Partial<RollUpInput> = {}): RollUpInput => ({
  rule: "sum",
  valueNature: "flow",
  stockAdditiveAcrossScopes: false,
  ...unit,
  periodId: "2026-09",
  basis: "period",
  previouslyReportingScopes: [],
  inputs,
  ...over,
});
const val = (value: string) => ({ kind: "value" as const, value });

describe("rules per value nature (no averaging rule exists)", () => {
  it("the allowed rule per nature mirrors CHECK kpi_version_aggregation_fits_nature", () => {
    expect(RULE_FOR_NATURE).toEqual({ flow: "sum", stock: "last_value", ratio: "weighted_ratio", milestone: "none" });
    expect(ruleFitsNature("custom_formula", "ratio")).toBe(true);
    expect(ruleFitsNature("sum", "ratio")).toBe(false); // summing (or averaging) ratios is refused
  });
  it("a rule that does not fit the nature is a caller error", () => {
    expect(() => rollUp(input([], { rule: "sum", valueNature: "ratio" }))).toThrow(KpiInputError);
    expect(() => rollUp(input([], { rule: "average" as never }))).toThrow(KpiInputError);
  });
});

describe("sum (flows)", () => {
  it("Σ values, currency preserved, oldest data_as_of reported", () => {
    const sar = { unitKind: "currency" as const, unitLabel: null, currency: "SAR" };
    const out = rollUp(
      input(
        [
          sv("bu-a", val("1500000.25"), { ...sar, dataAsOf: "2026-10-02" }),
          sv("bu-b", val("250000"), { ...sar, dataAsOf: "2026-09-28" }),
        ],
        { ...sar },
      ),
    );
    expect(out).toEqual({
      ok: true,
      kind: "value",
      result: { status: "ok", value: "1750000.25", reason: null },
      expectedScopes: ["bu-a", "bu-b"],
      missingScopes: [],
      dataAsOf: "2026-09-28",
      currency: "SAR",
    });
  });
  it("a known zero is summed as zero (it is a value, not a missing scope)", () => {
    const out = rollUp(input([sv("bu-a", val("0")), sv("bu-b", val("7"))]));
    expect(out.ok && out.kind === "value" && out.result.value).toBe("7");
  });
});

describe("last_value (stocks)", () => {
  it("additive across scopes → Σ", () => {
    const out = rollUp(
      input([sv("a", val("100")), sv("b", val("50"))], {
        rule: "last_value",
        valueNature: "stock",
        stockAdditiveAcrossScopes: true,
      }),
    );
    expect(out.ok && out.kind === "value" && out.result.value).toBe("150");
  });
  it("not additive → Not computable (kpi.stock_not_additive), whatever the inputs", () => {
    const out = rollUp(input([sv("a", val("100"))], { rule: "last_value", valueNature: "stock" }));
    expect(out.ok && out.kind === "value" && out.result).toEqual({
      status: "not_computable",
      value: null,
      reason: "kpi.stock_not_additive",
    });
  });
});

describe("weighted_ratio (ratios)", () => {
  const pct = { unitKind: "percentage" as const, unitLabel: null, currency: null };
  const r = (n: string, d: string) => ({ kind: "ratio" as const, numerator: n, denominator: d });
  it("Σ numerators / Σ denominators", () => {
    const out = rollUp(
      input([sv("a", r("30", "40"), pct), sv("b", r("10", "60"), pct), sv("c", r("0", "0"), pct)], {
        rule: "weighted_ratio",
        valueNature: "ratio",
        ...pct,
      }),
    );
    expect(out.ok && out.kind === "value" && out.result.value).toBe("0.4");
  });
  it("Σ denominators 0 → Not computable (kpi.zero_denominator)", () => {
    const out = rollUp(input([sv("a", r("0", "0"), pct)], { rule: "weighted_ratio", valueNature: "ratio", ...pct }));
    expect(out.ok && out.kind === "value" && out.result.reason).toBe("kpi.zero_denominator");
  });
  it("a plain value for a ratio is a caller error", () => {
    expect(() =>
      rollUp(input([sv("a", val("0.5"), pct)], { rule: "weighted_ratio", valueNature: "ratio", ...pct })),
    ).toThrow(KpiInputError);
  });
});

describe("none (milestones) and custom_formula", () => {
  it("none → Not computable (kpi.no_rollup)", () => {
    const out = rollUp(input([], { rule: "none", valueNature: "milestone" }));
    expect(out.ok && out.kind === "value" && out.result).toEqual({
      status: "not_computable",
      value: null,
      reason: "kpi.no_rollup",
    });
  });
  it("custom_formula → evaluate the KPI's approved formula at the target scope", () => {
    expect(rollUp(input([sv("a", val("1"))], { rule: "custom_formula" }))).toEqual({
      ok: true,
      kind: "custom_formula",
    });
  });
});

describe("expected scopes: a missing scope contributes no zero (REQ-S07-006)", () => {
  it("a scope that reported before but not now → Unknown (kpi.scope_missing), naming it", () => {
    const out = rollUp(input([sv("bu-a", val("70"))], { previouslyReportingScopes: ["bu-b", "bu-a"] }));
    expect(out).toMatchObject({ ok: true, kind: "value", expectedScopes: ["bu-a", "bu-b"], missingScopes: ["bu-b"] });
    expect(out.ok && out.kind === "value" && out.result).toEqual({
      status: "unknown",
      value: null,
      reason: "kpi.scope_missing",
    });
  });
  it("a 'not available' or null entry is missing too", () => {
    const out = rollUp(
      input([sv("a", val("1")), sv("b", { kind: "not_available" }), sv("c", null)], {
        previouslyReportingScopes: ["c"],
      }),
    );
    expect(out.ok && out.kind === "value" && out.missingScopes).toEqual(["b", "c"]);
  });
  it("a new scope reporting for the first time joins the expected set", () => {
    const out = rollUp(input([sv("a", val("1")), sv("new", val("2"))], { previouslyReportingScopes: ["a"] }));
    expect(out.ok && out.kind === "value" && out.result.value).toBe("3");
  });
  it("no scope has ever reported → Unknown (kpi.no_accepted_actual), not 0", () => {
    const out = rollUp(input([]));
    expect(out.ok && out.kind === "value" && out.result).toEqual({
      status: "unknown",
      value: null,
      reason: "kpi.no_accepted_actual",
    });
  });
});

describe("refusals: never a conversion, never mixed periods", () => {
  it("another currency → kpi.aggregation_unit_mismatch", () => {
    const sar = { unitKind: "currency" as const, unitLabel: null, currency: "SAR" };
    const out = rollUp(input([sv("a", val("1"), sar), sv("b", val("1"), { ...sar, currency: "USD" })], sar));
    expect(out).toEqual({
      ok: false,
      code: "kpi.aggregation_unit_mismatch",
      message: "Roll-up refused: scope b is in USD, but the KPI is measured in SAR; values are never converted.",
      params: { scopeId: "b", given: "USD", kpiUnit: "SAR" },
    });
  });
  it("another unit kind or unit label → refused", () => {
    expect(rollUp(input([sv("a", val("1"), { unitKind: "duration", unitLabel: "orders" })]))).toMatchObject({
      ok: false,
      code: "kpi.aggregation_unit_mismatch",
    });
    expect(rollUp(input([sv("a", val("1"), { unitLabel: "tickets" })]))).toMatchObject({
      ok: false,
      params: { given: "count (tickets)", kpiUnit: "count (orders)" },
    });
  });
  it("a unit mismatch is refused even if the scope has no value", () => {
    expect(rollUp(input([sv("a", null, { unitLabel: "tickets" })]))).toMatchObject({ ok: false });
  });
  it("another period or basis → kpi.aggregation_period_mismatch", () => {
    expect(rollUp(input([sv("a", val("1"), { periodId: "2026-08" })]))).toMatchObject({
      ok: false,
      code: "kpi.aggregation_period_mismatch",
    });
    expect(rollUp(input([sv("a", val("1"), { basis: "cumulative" })]))).toMatchObject({
      ok: false,
      code: "kpi.aggregation_period_mismatch",
    });
  });
  it("a duplicate scope is a caller error", () => {
    expect(() => rollUp(input([sv("a", val("1")), sv("a", val("2"))]))).toThrow(KpiInputError);
  });
});
