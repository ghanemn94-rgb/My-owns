// T09 formula API boundary (T-DG3-KBE-C; ADR-0024 §6), unit level without a database: the 400/422 boundary of the
// check route, the two B0087 worked examples through the shared engine, Unknown never 0, the lineage variable mapping
// and the ADR-0002 import guard (the engine is on `@mth/shared/calc`, never on the dependency-free `@mth/shared`).
// All values are SYNTHETIC illustrative values.
import { describe, expect, it } from "vitest";
import { HttpProblem } from "../platform/index.ts";
import { expressionSha256 } from "./benefit-formulas.ts";
import { checkFormula, engineVariables } from "./calculations.ts";

const TIMEOUT = 10_000;

const REVENUE = {
  expression: "(target_attach_rate - baseline_attach_rate) * eligible_customers * arpu",
  variables: [
    { name: "baseline_attach_rate", kind: "fraction", period: "none", value: "0.10" },
    { name: "target_attach_rate", kind: "fraction", period: "none", value: "0.12" },
    { name: "eligible_customers", kind: "count", unit: "customers", period: "year", value: "100000" },
    { name: "arpu", kind: "currency", currency: "SAR", unit: "per customer", period: "year", value: "50" },
  ],
};
const COST = {
  expression: "eligible_volume * (baseline_unit_cost - target_unit_cost)",
  variables: [
    { name: "eligible_volume", kind: "count", unit: "transactions", period: "year", value: "200000" },
    { name: "baseline_unit_cost", kind: "currency", currency: "SAR", period: "none", value: "12.50" },
    { name: "target_unit_cost", kind: "currency", currency: "SAR", period: "none", value: "10.00" },
  ],
};

/** The problem a call throws (or a failure when it does not throw one). */
function problemOf(fn: () => unknown): HttpProblem {
  try {
    fn();
  } catch (e) {
    if (e instanceof HttpProblem) return e;
    throw e;
  }
  throw new Error("expected an HttpProblem");
}

describe("ADR-0002 guard: the engine is exported from @mth/shared/calc only", () => {
  it(
    "the top-level @mth/shared has no validateFormula; the calc subpath has validateFormula and evaluateFormula",
    async () => {
      expect("validateFormula" in (await import("@mth/shared"))).toBe(false);
      expect("evaluateFormula" in (await import("@mth/shared"))).toBe(false);
      const calc = await import("@mth/shared/calc");
      expect(typeof calc.validateFormula).toBe("function");
      expect(typeof calc.evaluateFormula).toBe("function");
    },
    TIMEOUT,
  );
});

describe("POST /benefit-formulas/validate (checkFormula): schema 400, engine 422, preview", () => {
  it(
    "revenue uplift: (0.12 - 0.10) x 100000 x 50 = exactly 100000 SAR per year (REQ-PB-057, REQ-S08-007)",
    () => {
      expect(checkFormula(REVENUE)).toEqual({
        valid: true,
        resultKind: "currency",
        resultUnit: "per customer", // the engine carries the currency operand's unit label
        resultCurrency: "SAR",
        resultPeriod: "year",
        result: "100000",
        errors: [],
      });
    },
    TIMEOUT,
  );

  it(
    "cost reduction: 200000 x (12.50 - 10.00) = exactly 500000 SAR per year",
    () => {
      expect(checkFormula(COST)).toMatchObject({
        valid: true,
        resultCurrency: "SAR",
        resultPeriod: "year",
        result: "500000",
      });
    },
    TIMEOUT,
  );

  it(
    "monthly ARPU x annual customers -> 422 formula.period_mismatch with the ADR text; to_period converts",
    () => {
      const monthly = {
        ...REVENUE,
        variables: REVENUE.variables.map((v) => (v.name === "arpu" ? { ...v, period: "month" } : v)),
      };
      const p = problemOf(() => checkFormula(monthly));
      expect([p.status, p.code, p.detail]).toEqual([
        422,
        "formula.period_mismatch",
        "Period mismatch: arpu is per month but eligible_customers is per year; convert with to_period(arpu, year)",
      ]);
      expect(p.errors).toEqual([expect.objectContaining({ pointer: "/expression", code: "formula.period_mismatch" })]);
      // Monthly ARPU 50 converted explicitly to a year (x 12): 0.02 x 100000 x 600 = 1200000.
      const converted = checkFormula({
        ...monthly,
        expression: "(target_attach_rate - baseline_attach_rate) * eligible_customers * to_period(arpu, year)",
      });
      expect([converted.result, converted.resultPeriod]).toEqual(["1200000", "year"]);
    },
    TIMEOUT,
  );

  it(
    "an undefined variable -> 422 'Undefined variable: {name}' (REQ-PB-056)",
    () => {
      const p = problemOf(() => checkFormula({ ...COST, expression: "eligible_volume * unit_saving" }));
      expect([p.status, p.code, p.detail]).toEqual([
        422,
        "formula.undefined_variable",
        "Undefined variable: unit_saving",
      ]);
    },
    TIMEOUT,
  );

  it(
    "schema refusals are 400 (bad variable name, unknown kind, a JSON number value, 31 variables, 2001 code points)",
    () => {
      const bad: unknown[] = [
        { ...COST, variables: [{ name: "Volume", kind: "count", period: "year" }] },
        { ...COST, variables: [{ name: "v", kind: "percent", period: "year" }] },
        { ...COST, variables: [{ name: "v", kind: "count", period: "year", value: 12 }] },
        {
          ...COST,
          variables: Array.from({ length: 31 }, (_, i) => ({ name: `v${i}`, kind: "number", period: "none" })),
        },
        { expression: "a".repeat(2001), variables: [] },
        { expression: "", variables: [] },
        { expression: "a", variables: [], extra: true },
      ];
      for (const body of bad)
        expect(problemOf(() => checkFormula(body)).status, JSON.stringify(body).slice(0, 80)).toBe(400);
      // 2000 astral code points pass the schema (code points, not UTF-16 units) and are refused by the engine: 422.
      const astral = problemOf(() => checkFormula({ expression: "😀".repeat(2000), variables: [] }));
      expect([astral.status, astral.code]).toEqual([422, "formula.syntax"]);
    },
    TIMEOUT,
  );

  it(
    "a reserved or duplicate name and a currency on a count pass the schema and are 422 formula.invalid_variable",
    () => {
      for (const variables of [
        [{ name: "year", kind: "number", period: "none" }],
        [
          { name: "a", kind: "number", period: "none" },
          { name: "a", kind: "number", period: "none" },
        ],
        [{ name: "a", kind: "count", currency: "SAR", period: "none" }],
      ]) {
        const p = problemOf(() => checkFormula({ expression: "a", variables }));
        expect([p.status, p.code], JSON.stringify(variables)).toEqual([422, "formula.invalid_variable"]);
        expect(p.errors?.[0]?.pointer).toBe("/variables");
      }
    },
    TIMEOUT,
  );

  it(
    "division by zero and a missing value give an Unknown result (null) with the warning, never 0",
    () => {
      const div = checkFormula({
        expression: "saving / volume",
        variables: [
          { name: "saving", kind: "currency", currency: "SAR", period: "year", value: "1000" },
          { name: "volume", kind: "number", period: "none", value: "0" },
        ],
      });
      expect([div.valid, div.result, div.errors.map((e) => e.code)]).toEqual([
        true,
        null,
        ["formula.division_by_zero"],
      ]);
      const missing = checkFormula({
        ...COST,
        variables: COST.variables.map((v) => (v.name === "eligible_volume" ? { ...v, value: null } : v)),
      });
      expect([missing.result, missing.errors.map((e) => e.code)]).toEqual([null, ["formula.missing_input"]]);
      expect(missing.result).not.toBe("0");
    },
    TIMEOUT,
  );
});

describe("lineage helpers", () => {
  it(
    "engineVariables maps stored rows in ordinal order with canonical decimal values and trimmed char(3) currency",
    () => {
      const base = {
        organization_id: "o",
        transformation_id: "t",
        formula_version_id: "v",
        description: null,
        source: "Synthetic source",
        created_at: new Date(0),
        created_by: "u",
      };
      const vars = engineVariables([
        {
          ...base,
          id: "2",
          ordinal: 2,
          name: "unit_cost",
          kind: "currency",
          unit: null,
          currency: "SAR",
          period: "none",
          value: "12.500000",
        },
        {
          ...base,
          id: "1",
          ordinal: 1,
          name: "volume",
          kind: "count",
          unit: "tx",
          currency: null,
          period: "year",
          value: null,
        },
      ]);
      expect(vars).toEqual([
        {
          name: "volume",
          kind: "count",
          period: "year",
          unit: "tx",
          currency: null,
          value: null,
          source: "Synthetic source",
          description: null,
        },
        {
          name: "unit_cost",
          kind: "currency",
          period: "none",
          unit: null,
          currency: "SAR",
          value: "12.5",
          source: "Synthetic source",
          description: null,
        },
      ]);
    },
    TIMEOUT,
  );

  it(
    "expression_sha256 is the SHA-256 of the UTF-8 expression",
    () => {
      expect(expressionSha256("a")).toBe("ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb");
      expect(expressionSha256(REVENUE.expression)).toMatch(/^[0-9a-f]{64}$/);
    },
    TIMEOUT,
  );
});
