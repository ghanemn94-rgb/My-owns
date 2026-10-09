// KPI formulas on the DG3 engine (ADR-0028 §8, REQ-S07-011 units half; T-DG4-KBE-A). Synthetic fixtures, including the
// playbook worked examples "Δ attach × customers × ARPU" and "volume × Δ unit cost".
import { describe, expect, it } from "vitest";
import {
  bindFormulaVariables,
  describeFormulaType,
  ENGINE_VERSION,
  evaluateKpiFormula,
  KpiInputError,
  kpiFormulaType,
  validateKpiFormula,
  type KpiFormulaInputValue,
  type KpiTypeSource,
} from "../calc.ts";

const SAR_M: KpiTypeSource = { unitKind: "currency", unitLabel: null, currency: "SAR", frequency: "monthly" };
const PCT_M: KpiTypeSource = { unitKind: "percentage", unitLabel: null, currency: null, frequency: "monthly" };
const CUST_M: KpiTypeSource = { unitKind: "count", unitLabel: "customers", currency: null, frequency: "monthly" };
const okv = (value: string) => ({ status: "ok" as const, value, reason: null });

describe("kpiFormulaType: the ADR-0028 §8 table", () => {
  it.each([
    [
      { unitKind: "currency", unitLabel: null, currency: "SAR", frequency: "monthly" },
      { kind: "currency", currency: "SAR", unit: null, period: "month" },
    ],
    [
      { unitKind: "percentage", unitLabel: null, currency: null, frequency: "quarterly" },
      { kind: "fraction", currency: null, unit: null, period: "quarter" },
    ],
    [
      { unitKind: "count", unitLabel: "subscribers", currency: null, frequency: "annual" },
      { kind: "count", currency: null, unit: "subscribers", period: "year" },
    ],
    [
      { unitKind: "ratio", unitLabel: null, currency: null, frequency: "weekly" },
      { kind: "number", currency: null, unit: null, period: "none" },
    ],
    [
      { unitKind: "score", unitLabel: null, currency: null, frequency: "daily" },
      { kind: "number", currency: null, unit: null, period: "none" },
    ],
    [
      { unitKind: "duration", unitLabel: "minutes", currency: null, frequency: "ad_hoc" },
      { kind: "quantity", currency: null, unit: "minutes", period: "none" },
    ],
    [
      { unitKind: "other", unitLabel: "sites", currency: null, frequency: "monthly" },
      { kind: "quantity", currency: null, unit: "sites", period: "month" },
    ],
  ] as const)("%o → %o", (src, type) => {
    expect(kpiFormulaType(src)).toEqual(type);
  });
  it("currency is set exactly for currency KPIs (kpi_version_currency_unit)", () => {
    expect(() => kpiFormulaType({ ...SAR_M, currency: null })).toThrow(KpiInputError);
    expect(() => kpiFormulaType({ ...CUST_M, currency: "SAR" })).toThrow(KpiInputError);
  });
  it("bindFormulaVariables gives engine declarations", () => {
    expect(bindFormulaVariables([{ variableName: "arpu", source: SAR_M, sourceKpiDefinitionId: "kpi-1" }])).toEqual([
      { name: "arpu", kind: "currency", period: "month", unit: null, currency: "SAR", source: "kpi-1" },
    ]);
  });
});

describe("validateKpiFormula", () => {
  const inputs = [
    { variableName: "attach_delta", source: PCT_M },
    { variableName: "customers", source: CUST_M },
    { variableName: "arpu", source: SAR_M },
  ];
  it("Δ attach × customers × ARPU types as SAR per month and matches a SAR KPI", () => {
    const v = validateKpiFormula("attach_delta * customers * arpu", inputs, SAR_M);
    expect(v).toMatchObject({
      ok: true,
      resultType: { kind: "currency", currency: "SAR", period: "month" },
      engineVersion: ENGINE_VERSION,
    });
  });
  it("SAR + count → the engine's formula.kind_mismatch, text passed through", () => {
    const v = validateKpiFormula("arpu + customers", inputs, SAR_M);
    expect(v).toEqual({
      ok: false,
      engineVersion: ENGINE_VERSION,
      errors: [
        expect.objectContaining({
          code: "formula.kind_mismatch",
          message: "Kind mismatch: arpu (currency) + customers (count) is not allowed",
        }),
      ],
    });
  });
  it("SAR + USD → the engine's formula.currency_mismatch (no FX)", () => {
    const v = validateKpiFormula(
      "arpu + arpu_usd",
      [...inputs, { variableName: "arpu_usd", source: { ...SAR_M, currency: "USD" } }],
      SAR_M,
    );
    expect(!v.ok && v.errors[0]!.code).toBe("formula.currency_mismatch");
  });
  it("a result of another kind than the KPI → kpi_formula.unit_mismatch with the ADR-0027 §13 text", () => {
    const v = validateKpiFormula("customers * 2", inputs, SAR_M);
    expect(v).toEqual({
      ok: false,
      engineVersion: ENGINE_VERSION,
      errors: [
        {
          code: "kpi_formula.unit_mismatch",
          message: "The formula gives count (customers), but the KPI is measured in SAR.",
          params: { resultUnit: "count (customers)", kpiUnit: "SAR" },
        },
      ],
    });
  });
  it("a result in another currency than the KPI → kpi_formula.unit_mismatch", () => {
    const v = validateKpiFormula(
      "arpu_usd * 2",
      [{ variableName: "arpu_usd", source: { ...SAR_M, currency: "USD" } }],
      SAR_M,
    );
    expect(!v.ok && v.errors[0]).toMatchObject({
      code: "kpi_formula.unit_mismatch",
      params: { resultUnit: "USD", kpiUnit: "SAR" },
    });
  });
  it("a percentage KPI needs a fraction result: a difference of fractions (fraction_delta) is refused", () => {
    const v = validateKpiFormula(
      "a - b",
      [
        { variableName: "a", source: PCT_M },
        { variableName: "b", source: PCT_M },
      ],
      PCT_M,
    );
    expect(!v.ok && v.errors[0]).toMatchObject({
      code: "kpi_formula.unit_mismatch",
      params: { resultUnit: "fraction_delta", kpiUnit: "fraction" },
    });
  });
  it("a syntax error and an undefined variable pass through with their engine codes", () => {
    expect(validateKpiFormula("arpu +", inputs, SAR_M)).toMatchObject({
      ok: false,
      errors: [{ code: "formula.syntax" }],
    });
    expect(validateKpiFormula("arpu + nope", inputs, SAR_M)).toMatchObject({
      ok: false,
      errors: [{ code: "formula.undefined_variable" }],
    });
  });
  it("describeFormulaType", () => {
    expect(describeFormulaType({ kind: "currency", currency: "SAR", unit: null })).toBe("SAR");
    expect(describeFormulaType({ kind: "number", currency: null, unit: null })).toBe("number");
  });
});

describe("evaluateKpiFormula", () => {
  const playbookAttach = (values: [string, string, string] | null[]): KpiFormulaInputValue[] => [
    {
      variableName: "attach_delta",
      source: PCT_M,
      value:
        values[0] === null ? { status: "unknown", value: null, reason: "kpi.no_accepted_actual" } : okv(values[0]!),
    },
    {
      variableName: "customers",
      source: CUST_M,
      value:
        values[1] === null ? { status: "unknown", value: null, reason: "kpi.no_accepted_actual" } : okv(values[1]!),
    },
    {
      variableName: "arpu",
      source: SAR_M,
      value:
        values[2] === null ? { status: "unknown", value: null, reason: "kpi.no_accepted_actual" } : okv(values[2]!),
    },
  ];
  it("playbook example: Δ attach 2 pp × 500 000 customers × SAR 45.50 ARPU = SAR 455 000 per month", () => {
    const e = evaluateKpiFormula("attach_delta * customers * arpu", playbookAttach(["0.02", "500000", "45.50"]), SAR_M);
    expect(e).toEqual({
      ok: true,
      result: { status: "ok", value: "455000", reason: null },
      rounding: {
        column: "numeric(24,6)",
        scale: 6,
        mode: "ROUND_HALF_UP",
        precision: 80,
        exact: "455000",
        stored: "455000.000000",
        rounded: false,
        inexactIntermediate: false,
      },
      inputs: { attach_delta: "0.02", customers: "500000", arpu: "45.50" },
      unknownInputs: [],
      staleInputs: [],
      engineVersion: ENGINE_VERSION,
    });
  });
  it("playbook example: volume × Δ unit cost (120 000 tickets × SAR 3.75 saving) = SAR 450 000", () => {
    const tickets: KpiTypeSource = { unitKind: "count", unitLabel: "tickets", currency: null, frequency: "monthly" };
    const e = evaluateKpiFormula(
      "volume * unit_cost_delta",
      [
        { variableName: "volume", source: tickets, value: okv("120000") },
        { variableName: "unit_cost_delta", source: SAR_M, value: okv("3.75") },
      ],
      SAR_M,
    );
    expect(e.ok && e.result).toEqual({ status: "ok", value: "450000", reason: null });
  });
  it("an Unknown input → Unknown (kpi.formula_input_unknown), never 0, and names the input", () => {
    const e = evaluateKpiFormula(
      "attach_delta * customers * arpu",
      playbookAttach(["0.02", null, "45.50"] as never),
      SAR_M,
    );
    expect(e).toMatchObject({
      ok: true,
      result: { status: "unknown", value: null, reason: "kpi.formula_input_unknown" },
      unknownInputs: ["customers"],
      inputs: { customers: null },
      rounding: { exact: null, stored: null },
    });
  });
  it("a Not computable input is Unknown for the formula too", () => {
    const e = evaluateKpiFormula(
      "a * 2",
      [
        {
          variableName: "a",
          source: SAR_M,
          value: { status: "not_computable", value: null, reason: "kpi.zero_denominator" },
        },
      ],
      SAR_M,
    );
    expect(e.ok && e.result.reason).toBe("kpi.formula_input_unknown");
  });
  it("a division by zero → Not computable (kpi.formula_division_by_zero)", () => {
    const e = evaluateKpiFormula(
      "revenue / customers",
      [
        { variableName: "revenue", source: SAR_M, value: okv("1000") },
        { variableName: "customers", source: CUST_M, value: okv("0") },
      ],
      SAR_M,
    );
    expect(e.ok && e.result).toEqual({ status: "not_computable", value: null, reason: "kpi.formula_division_by_zero" });
  });
  it("a result outside numeric(24,6) → Not computable (kpi.value_out_of_range), never truncated", () => {
    const e = evaluateKpiFormula(
      "a * a",
      [{ variableName: "a", source: { ...CUST_M, unitLabel: null, unitKind: "ratio" }, value: okv("1000000000000") }],
      {
        ...CUST_M,
        unitKind: "ratio",
        unitLabel: null,
      },
    );
    expect(e.ok && e.result).toEqual({ status: "not_computable", value: null, reason: "kpi.value_out_of_range" });
  });
  it("a non-terminating division is rounded once, half-up, and the record says so", () => {
    const e = evaluateKpiFormula("revenue / 3", [{ variableName: "revenue", source: SAR_M, value: okv("100") }], SAR_M);
    expect(e.ok && e.result.value).toBe("33.333333");
    expect(e.ok && e.rounding).toMatchObject({ rounded: true, inexactIntermediate: true });
  });
  it("stale inputs are used and listed", () => {
    const e = evaluateKpiFormula(
      "a * 2",
      [{ variableName: "a", source: SAR_M, value: { status: "stale", value: "5", reason: "kpi.stale" } }],
      SAR_M,
    );
    expect(e).toMatchObject({ ok: true, result: { value: "10" }, staleInputs: ["a"] });
  });
  it("an invalid formula at evaluation → ok: false with the problems (the run records a failure)", () => {
    const e = evaluateKpiFormula("customers * 2", playbookAttach(["0.02", "1", "1"]), SAR_M);
    expect(e).toMatchObject({ ok: false, errors: [{ code: "kpi_formula.unit_mismatch" }] });
  });
});
