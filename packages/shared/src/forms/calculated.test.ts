// Calculated fields over the DG3 formula engine (REQ-S06-005 "calculated fields use the safe formula engine";
// ADR-0041 §3, §7). T-DG5-KBE-B. Worked fixtures include the playbook examples (T09, B0084-B0086 pattern):
// Δ attach × customers × ARPU, and volume × Δ unit cost.
import { describe, expect, it } from "vitest";
import { defineField, type FieldDefinition } from "./field-types.ts";
import {
  evaluateCalculatedField,
  numericFieldsOf,
  referencedFields,
  toCalculatedEntry,
  validateCalculatedField,
  type NumericField,
} from "./calculated.ts";

function field(key: string, type: string, attrs: Record<string, unknown> = {}): FieldDefinition {
  const r = defineField(key, type, attrs);
  if (!r.ok) throw new Error(`fixture ${key}: ${r.code}`);
  return r.field;
}

const FIELDS = [
  field("delta_attach", "percentage", { min: "-1", max: "1" }),
  field("customers", "number", { scale: 0 }),
  field("arpu", "currency", { currencyCode: "SAR" }),
  field("volume", "number"),
  field("delta_unit_cost", "currency", { currencyCode: "SAR" }),
  field("notes", "text"),
  field("usd_cost", "currency", { currencyCode: "USD" }),
  field("earlier", "calculated", { expression: "volume * 2", resultUnitKind: "other" }),
];
const NUMERIC: NumericField[] = numericFieldsOf(FIELDS);

describe("numericFieldsOf", () => {
  it("keeps number, currency and percentage fields only (calculated and text are never variables)", () => {
    expect(NUMERIC).toEqual([
      { key: "delta_attach", fieldType: "percentage" },
      { key: "customers", fieldType: "number" },
      { key: "arpu", fieldType: "currency", currencyCode: "SAR" },
      { key: "volume", fieldType: "number" },
      { key: "delta_unit_cost", fieldType: "currency", currencyCode: "SAR" },
      { key: "usd_cost", fieldType: "currency", currencyCode: "USD" },
    ]);
  });
});

describe("validateCalculatedField (definition time)", () => {
  it("accepts the playbook formulas with their result kinds", () => {
    const attach = validateCalculatedField(
      { expression: "delta_attach * customers * arpu", resultUnitKind: "currency" },
      NUMERIC,
    );
    expect(attach).toMatchObject({ ok: true, resultType: { kind: "currency", currency: "SAR" } });
    const cost = validateCalculatedField(
      { expression: "volume × delta_unit_cost", resultUnitKind: "currency" },
      NUMERIC,
    );
    expect(cost).toMatchObject({ ok: true, variables: ["volume", "delta_unit_cost"] });
  });

  it("refuses a calculated field referencing an unknown field (REQ-S06-005 acceptance)", () => {
    const r = validateCalculatedField({ expression: "volume * unknown_field", resultUnitKind: "other" }, NUMERIC);
    expect(r).toMatchObject({
      ok: false,
      code: "form_schema.calculated_formula_invalid",
      message: "The calculated field's formula is invalid or refers to an unknown field.",
      params: { reason: "formula.undefined_variable" },
    });
    if (!r.ok) expect(r.errors[0]).toMatchObject({ code: "formula.undefined_variable" });
  });

  it.each([
    ["notes * 2", "a text field is not a variable"],
    ["earlier * 2", "a calculated field is not a variable (no chain, no cycle)"],
    ["volume +", "syntax"],
    ["arpu * delta_unit_cost", "currency × currency"],
    ["arpu + usd_cost", "mixed currencies"],
    ["arpu + volume", "currency + number"],
    ["eval(volume)", "not a function of the language"],
  ])("refuses %j (%s)", (expression) => {
    expect(validateCalculatedField({ expression, resultUnitKind: "other" }, NUMERIC)).toMatchObject({
      ok: false,
      code: "form_schema.calculated_formula_invalid",
    });
  });

  it("checks the result unit kind (ADR-0037 N5)", () => {
    const money = { expression: "volume * delta_unit_cost" };
    expect(validateCalculatedField({ ...money, resultUnitKind: "count" }, NUMERIC)).toMatchObject({
      ok: false,
      params: { reason: "result_unit_kind" },
    });
    expect(validateCalculatedField({ expression: "volume * 2", resultUnitKind: "currency" }, NUMERIC)).toMatchObject({
      ok: false,
      params: { reason: "result_unit_kind" },
    });
    expect(validateCalculatedField({ expression: "volume * 2", resultUnitKind: "percentage" }, NUMERIC)).toMatchObject({
      ok: false,
      params: { reason: "result_unit_kind" },
    });
    expect(
      validateCalculatedField({ expression: "delta_attach * 2", resultUnitKind: "percentage" }, NUMERIC),
    ).toMatchObject({ ok: true, resultType: { kind: "fraction" } });
  });

  it("declares only the referenced fields, so a record type with more than 30 numeric fields still works", () => {
    const many: NumericField[] = Array.from({ length: 45 }, (_, i) => ({ key: `n${i}`, fieldType: "number" }));
    expect(validateCalculatedField({ expression: "n0 + n44", resultUnitKind: "other" }, many)).toMatchObject({
      ok: true,
    });
  });

  it("ignores a field whose key is a reserved word of the language", () => {
    const fields: NumericField[] = [
      { key: "month", fieldType: "number" },
      { key: "volume", fieldType: "number" },
    ];
    expect(validateCalculatedField({ expression: "volume * 2", resultUnitKind: "other" }, fields)).toMatchObject({
      ok: true,
    });
  });
});

describe("evaluateCalculatedField (read time)", () => {
  it("playbook example 1: Δ attach × customers × ARPU", () => {
    // +3 percentage points of attach on 250000 customers at SAR 85.50 ARPU = SAR 641250 a period.
    const r = evaluateCalculatedField(
      { expression: "delta_attach * customers * arpu", resultUnitKind: "currency" },
      NUMERIC,
      { delta_attach: "0.03", customers: "250000", arpu: { amount: "85.50", currencyCode: "SAR" } },
    );
    expect(r).toMatchObject({ status: "computed", value: "641250", missingFields: [], errorCode: null });
    expect(r.resultType).toMatchObject({ kind: "currency", currency: "SAR" });
  });

  it("playbook example 2: volume × Δ unit cost", () => {
    // 1200000 transactions × SAR 0.35 saved per transaction = SAR 420000.
    const r = evaluateCalculatedField({ expression: "volume * delta_unit_cost", resultUnitKind: "currency" }, NUMERIC, {
      volume: "1200000",
      delta_unit_cost: { amount: "0.35", currencyCode: "SAR" },
    });
    expect(r).toMatchObject({ status: "computed", value: "420000" });
  });

  it("is exact where a float is not (0.1 + 0.2)", () => {
    const r = evaluateCalculatedField({ expression: "volume + customers", resultUnitKind: "other" }, NUMERIC, {
      volume: "0.1",
      customers: "0.2",
    });
    expect(r.value).toBe("0.3");
  });

  it("a missing input is Not computable with the missing field named, never 0", () => {
    for (const values of [
      { delta_attach: "0.03", customers: null, arpu: { amount: "85.50", currencyCode: "SAR" } },
      { delta_attach: "0.03", arpu: { amount: "85.50", currencyCode: "SAR" } },
      { delta_attach: "0.03", customers: "abc", arpu: { amount: "85.50", currencyCode: "SAR" } },
    ]) {
      const r = evaluateCalculatedField(
        { expression: "delta_attach * customers * arpu", resultUnitKind: "currency" },
        NUMERIC,
        values,
      );
      expect(r).toMatchObject({
        status: "not_computable",
        value: null,
        missingFields: ["customers"],
        errorCode: "formula.missing_input",
      });
    }
    const all = evaluateCalculatedField(
      { expression: "delta_attach * customers * arpu", resultUnitKind: "currency" },
      NUMERIC,
      {},
    );
    expect(all.missingFields).toEqual(["delta_attach", "customers", "arpu"]);
  });

  it("a currency input in another currency is not used (no FX)", () => {
    const r = evaluateCalculatedField({ expression: "volume * arpu", resultUnitKind: "currency" }, NUMERIC, {
      volume: "2",
      arpu: { amount: "10", currencyCode: "USD" },
    });
    expect(r).toMatchObject({ status: "not_computable", missingFields: ["arpu"] });
  });

  it("division by zero is Not computable, never 0", () => {
    const r = evaluateCalculatedField({ expression: "volume / customers", resultUnitKind: "ratio" }, NUMERIC, {
      volume: "10",
      customers: "0",
    });
    expect(r).toMatchObject({
      status: "not_computable",
      value: null,
      missingFields: [],
      errorCode: "formula.division_by_zero",
    });
  });

  it("an invalid definition at read names its unknown fields and computes nothing", () => {
    const r = evaluateCalculatedField({ expression: "volume * removed_field", resultUnitKind: "other" }, NUMERIC, {
      volume: "1",
      removed_field: "2",
    });
    expect(r).toMatchObject({
      status: "not_computable",
      value: null,
      missingFields: ["removed_field"],
      errorCode: "formula.undefined_variable",
    });
  });

  it("toCalculatedEntry gives exactly the OpenAPI shape", () => {
    const r = evaluateCalculatedField({ expression: "volume * 2", resultUnitKind: "other" }, NUMERIC, {
      volume: "1.5",
    });
    expect(toCalculatedEntry(r)).toEqual({ status: "computed", value: "3", missingFields: [] });
  });

  it("referencedFields lists names in order of first appearance", () => {
    expect(referencedFields("b + a * b")).toEqual(["b", "a"]);
    expect(referencedFields("(")).toEqual([]);
  });
});
