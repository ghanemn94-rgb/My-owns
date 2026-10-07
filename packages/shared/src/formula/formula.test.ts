// T09 formula engine unit tests (ADR-0024 §6 "Verification"; T-DG3-KBE-A). Worked fixtures are the two seeded
// playbook examples (B0087): Δ attach × customers × ARPU and volume × Δ unit cost. Synthetic, illustrative values.
import { describe, expect, it } from "vitest";
import { compareDecimal } from "../value.ts";
import {
  ENGINE_VERSION,
  evaluateAst,
  evaluateFormula,
  FORMULA_LIMITS,
  formatFormulaValue,
  displayNumber,
  parseFormula,
  tokenize,
  validateFormula,
  type FormulaVariable,
} from "./index.ts";

const T = { timeout: 10_000 };

const REVENUE_EXPR = "(target_attach_rate - baseline_attach_rate) * eligible_customers * arpu";
const revenueVars = (arpuPeriod: FormulaVariable["period"] = "year", arpu = "50"): FormulaVariable[] => [
  { name: "baseline_attach_rate", kind: "fraction", period: "none", value: "0.10" },
  { name: "target_attach_rate", kind: "fraction", period: "none", value: "0.12" },
  { name: "eligible_customers", kind: "count", period: "year", unit: "customers", value: "100000" },
  { name: "arpu", kind: "currency", currency: "SAR", period: arpuPeriod, value: arpu },
];
const COST_EXPR = "eligible_volume * (baseline_unit_cost - target_unit_cost)";
const costVars: FormulaVariable[] = [
  { name: "eligible_volume", kind: "count", period: "year", unit: "transactions", value: "200000" },
  { name: "baseline_unit_cost", kind: "currency", currency: "SAR", period: "none", value: "12.50" },
  { name: "target_unit_cost", kind: "currency", currency: "SAR", period: "none", value: "10.00" },
];

/** Variables a..z (and any other listed name) as dimensionless numbers with value 1. */
function numbers(...names: string[]): FormulaVariable[] {
  return names.map((name) => ({ name, kind: "number", period: "none", value: "1" }));
}
const ABC = numbers("a", "b", "c", "m", "a_1_b2");

describe("grammar table (ADR-0024 §6 EBNF)", () => {
  const accepted = [
    "a",
    "a + b",
    "a+b",
    "a - b - c",
    "a * b",
    "a × b",
    "a / b",
    "a ÷ b",
    "-a",
    "a - -b",
    "a * -b",
    "-(a + b)",
    "(a)",
    "(((a)))",
    "  a  ",
    "\ta\t*\tb",
    "12.50 * a",
    "0.1 + 0.2",
    "007",
    "0",
    "123456789012345678901234",
    "0000000000000000000000000001",
    "a_1_b2 * 2",
    "min(a, b)",
    "min (a,b)",
    "max(a, b, c)",
    "abs(a)",
    "abs(-a)",
    "abs(min(a, b) - max(b, c))",
    "to_period(m, year)",
    "to_period( m , quarter )",
  ];
  it.each(accepted)(
    "accepts %j",
    (expr) => {
      const vars = [
        ...ABC.filter((v) => v.name !== "m"),
        { name: "m", kind: "count", period: "month", value: "1" } as FormulaVariable,
      ];
      const r = validateFormula(expr, vars);
      expect(r.ok, JSON.stringify(r)).toBe(true);
    },
    10_000,
  );

  const rejected: [string, number][] = [
    ["", 0],
    ["   ", 3],
    ["a ** b", 3],
    ["a; b", 1],
    ["'a'", 0],
    ['"a"', 0],
    ["`a`", 0],
    ["a\nb", 1],
    ["a\r\nb", 1],
    ["foo(a)", 0],
    ["sqrt(a)", 0],
    ["exp(a)", 0],
    ["1e3", 1],
    ["1E3", 1],
    ["1.5e-3", 3],
    [".5", 0],
    ["1.", 2],
    ["1..2", 2],
    ["a +", 3],
    ["(a", 2],
    ["a)", 1],
    ["[a]", 0],
    ["{a}", 0],
    ["A", 0],
    ["aB", 1],
    ["a.b", 1],
    ["a, b", 1],
    ["min(a)", 0],
    ["max()", 0],
    ["abs(a, b)", 0],
    ["abs()", 0],
    ["to_period(a)", 0],
    ["to_period(a, b)", 0],
    ["to_period(a, year, month)", 0],
    ["to_period(year, a)", 10],
    ["year * 2", 0],
    ["min(a, year)", 0],
    ["abs", 3],
    ["abs + 1", 4],
    ["--a", 1],
    ["- -a", 2],
    ["a b", 2],
    ["2a", 1],
    ["a $ b", 2],
    ["a % b", 2],
    ["a ^ b", 2],
    ["a == b", 2],
    ["a = b", 2],
    ["a || b", 2],
    ["x => x", 2],
    ["this.constructor", 4],
    ["process.exit()", 7],
    ["constructor.constructor('return process')()", 11],
    ["−a", 0],
    ["a⋅b", 1],
    ["１", 0],
    ["a # comment", 2],
    ["1,000", 1],
    ["1234567890123456789012345", 0],
    ["_a", 0],
    ["été", 0],
    ["\u{1F600} + a", 0],
    ["a + \u{1F600}", 4],
    ["a + b", 1],
    ["a\u0000", 1],
  ];
  it.each(rejected)(
    "rejects %j with formula.syntax at offset %i",
    (expr, offset) => {
      const r = validateFormula(expr, ABC);
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.errors).toHaveLength(1);
      expect(r.errors[0]!.code).toBe("formula.syntax");
      expect(r.errors[0]!.offset).toBe(offset);
      expect(r.errors[0]!.message).toMatch(new RegExp(`^Syntax error at offset ${offset}: `));
    },
    10_000,
  );

  it("names over 48 characters and literals over 24 significant digits are refused", T, () => {
    const n48 = "a".repeat(48);
    expect(validateFormula(n48, numbers(n48)).ok).toBe(true);
    const r = validateFormula("a".repeat(49), []);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]!.params["reason"]).toBe("identifier_length");
  });

  it("normalises × and ÷, keeps literal text exactly and records code-point offsets", T, () => {
    const p = parseFormula("\u{1F600}".length === 2 ? "a × 12.50 ÷ b" : "");
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.ast.root).toMatchObject({
      type: "binary",
      op: "/",
      left: {
        type: "binary",
        op: "*",
        left: { type: "variable", name: "a" },
        right: { type: "number", value: "12.50" },
      },
      right: { type: "variable", name: "b", start: 12, end: 13 },
    });
    // The AST is plain data (no functions, no prototypes beyond Object): it survives a JSON round trip unchanged.
    expect(JSON.parse(JSON.stringify(p.ast))).toEqual(p.ast);
    const t = tokenize("a\t+ b");
    expect(t.ok && t.tokens.map((x) => [x.type, x.text, x.start])).toEqual([
      ["identifier", "a", 0],
      ["op", "+", 2],
      ["identifier", "b", 4],
      ["end", "", 5],
    ]);
  });

  it("a non-string expression is a syntax error, never an exception", T, () => {
    for (const bad of [undefined, null, 42, {}, [], Symbol("x")]) {
      const r = validateFormula(bad, ABC);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors[0]!.code).toBe("formula.syntax");
    }
  });
});

describe("limits (ADR-0024 §6)", () => {
  it(
    `length: ${FORMULA_LIMITS.maxLength} characters accepted, ${FORMULA_LIMITS.maxLength + 1} refused (code points)`,
    T,
    () => {
      const ok = "a" + " ".repeat(FORMULA_LIMITS.maxLength - 1);
      expect(Array.from(ok)).toHaveLength(2000);
      expect(validateFormula(ok, ABC).ok).toBe(true);
      const r = validateFormula(ok + " ", ABC);
      expect(r.ok).toBe(false);
      if (!r.ok)
        expect(r.errors[0]).toMatchObject({ code: "formula.syntax", params: { reason: "too_long", limit: "2000" } });
      // 1000 astral characters are 2000 UTF-16 units but only 1000 characters: the length limit is not what refuses them.
      const astral = validateFormula("\u{1F600}".repeat(1000), ABC);
      expect(astral.ok).toBe(false);
      if (!astral.ok) expect(astral.errors[0]!.params["reason"]).toBe("character");
      const huge = validateFormula("a+".repeat(500_000) + "a", ABC);
      expect(huge.ok).toBe(false);
      if (!huge.ok) expect(huge.errors[0]!.params["reason"]).toBe("too_long");
    },
  );

  it(`nodes: ${FORMULA_LIMITS.maxNodes} accepted, ${FORMULA_LIMITS.maxNodes + 1} refused`, T, () => {
    const sum = (n: number) => Array.from({ length: n }, () => "1").join("+"); // 2n − 1 nodes
    const exactly200 = `-(${sum(100)})`; // 199 + unary
    const p = parseFormula(exactly200);
    expect(p.ok && p.ast.nodeCount).toBe(200);
    expect(validateFormula(exactly200, []).ok).toBe(true);
    const r = validateFormula(`${sum(101)}`, []); // 201
    expect(r.ok).toBe(false);
    if (!r.ok)
      expect(r.errors[0]).toMatchObject({ code: "formula.syntax", params: { reason: "too_many_nodes", limit: "200" } });
  });

  it(
    `depth: ${FORMULA_LIMITS.maxDepth} levels accepted, ${FORMULA_LIMITS.maxDepth + 1} refused (no stack exhaustion at 1000)`,
    T,
    () => {
      const nest = (n: number) => "(".repeat(n) + "a" + ")".repeat(n);
      const p = parseFormula(nest(31));
      expect(p.ok && p.ast.maxDepth).toBe(32);
      expect(validateFormula(nest(31), ABC).ok).toBe(true);
      const r = validateFormula(nest(32), ABC);
      expect(r.ok).toBe(false);
      if (!r.ok)
        expect(r.errors[0]).toMatchObject({
          code: "formula.syntax",
          offset: 31,
          params: { reason: "too_deep", limit: "32" },
        });
      const calls = validateFormula("abs(".repeat(32) + "a" + ")".repeat(32), ABC);
      expect(calls.ok).toBe(false);
      const deep = validateFormula(nest(999), ABC);
      expect(deep.ok).toBe(false);
      // A long flat chain is not deep: 30 terms are depth 1.
      expect(validateFormula(Array.from({ length: 30 }, () => "a").join(" + "), ABC).ok).toBe(true);
    },
  );

  it(`variables: ${FORMULA_LIMITS.maxVariables} accepted, ${FORMULA_LIMITS.maxVariables + 1} refused`, T, () => {
    const names = (n: number) => Array.from({ length: n }, (_, i) => `v${i}`);
    const thirty = names(30);
    expect(validateFormula(thirty.join(" + "), numbers(...thirty)).ok).toBe(true);
    const used31 = validateFormula(names(31).join(" + "), numbers(...thirty));
    expect(used31.ok).toBe(false);
    if (!used31.ok)
      expect(used31.errors[0]).toMatchObject({ code: "formula.syntax", params: { reason: "too_many_variables" } });
    const declared31 = validateFormula("v0", numbers(...names(31)));
    expect(declared31.ok).toBe(false);
    if (!declared31.ok)
      expect(declared31.errors[0]).toMatchObject({
        code: "formula.invalid_variable",
        params: { reason: "too_many_variables" },
      });
  });
});

describe("type rules (ADR-0024 §6)", () => {
  it("undefined variable → formula.undefined_variable 'Undefined variable: {name}', each name once", T, () => {
    const r = validateFormula("a + ghost * ghost + phantom", numbers("a"));
    expect(r).toMatchObject({
      ok: false,
      errors: [
        {
          code: "formula.undefined_variable",
          message: "Undefined variable: ghost",
          offset: 4,
          params: { name: "ghost" },
        },
        {
          code: "formula.undefined_variable",
          message: "Undefined variable: phantom",
          offset: 20,
          params: { name: "phantom" },
        },
      ],
    });
  });

  it("names that exist on Object.prototype are not variables unless declared", T, () => {
    for (const name of ["constructor", "tostring", "valueof", "hasownproperty", "proto"]) {
      const r = validateFormula(`${name} + 1`, []);
      expect(r.ok).toBe(false);
      if (!r.ok)
        expect(r.errors[0]).toMatchObject({
          code: "formula.undefined_variable",
          message: `Undefined variable: ${name}`,
        });
    }
    const declared = evaluateFormula("constructor * 2", numbers("constructor"));
    expect(declared.result).toBe("2");
  });

  it("monthly ARPU × annual population → formula.period_mismatch with the ADR message", T, () => {
    const r = validateFormula(REVENUE_EXPR, revenueVars("month"));
    expect(r).toMatchObject({
      ok: false,
      errors: [
        {
          code: "formula.period_mismatch",
          message:
            "Period mismatch: arpu is per month but eligible_customers is per year; convert with to_period(arpu, year)",
          params: { left: "arpu", leftPeriod: "month", right: "eligible_customers", rightPeriod: "year" },
        },
      ],
    });
    // Operand order does not change which side is named for conversion.
    const swapped = validateFormula("arpu * eligible_customers", revenueVars("month"));
    expect(!swapped.ok && swapped.errors[0]!.message).toBe(
      "Period mismatch: arpu is per month but eligible_customers is per year; convert with to_period(arpu, year)",
    );
  });

  it("to_period(arpu, year) is accepted and converts month → year ×12", T, () => {
    const expr = "(target_attach_rate - baseline_attach_rate) * eligible_customers * to_period(arpu, year)";
    const v = validateFormula(expr, revenueVars("month", "5"));
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.resultType).toEqual({ kind: "currency", currency: "SAR", period: "year", unit: null });
    const e = evaluateFormula(expr, revenueVars("month", "5"));
    expect(e.result).toBe("120000"); // 0.02 × 100000 × (5 × 12)
    expect(e.rounding).toMatchObject({ rounded: false, inexactIntermediate: false });
  });

  it("to_period inverse conversion divides (year → month ÷12) and records the inexact rounding", T, () => {
    const expr = "(target_attach_rate - baseline_attach_rate) * to_period(eligible_customers, month) * arpu";
    const e = evaluateFormula(expr, revenueVars("month", "5"));
    expect(e.resultType).toMatchObject({ kind: "currency", period: "month" });
    // 0.02 × (100000 ÷ 12) × 5 = 833.3333… → stored once, half-up, at 6 decimals
    expect(e.result).toBe("833.333333");
    expect(e.rounding).toMatchObject({ stored: "833.333333", rounded: true, inexactIntermediate: true });
    expect(e.rounding.exact!.startsWith("833.33333333333333333333")).toBe(true);
  });

  it.each([
    ["month", "quarter", "3", "9"],
    ["month", "year", "3", "36"],
    ["quarter", "year", "3", "12"],
    ["quarter", "month", "3", "1"],
    ["year", "quarter", "3", "0.75"],
    ["year", "month", "3", "0.25"],
    ["year", "year", "3", "3"],
  ])(
    "to_period %s → %s: %s → %s",
    (from, to, value, expected) => {
      const vars: FormulaVariable[] = [{ name: "x", kind: "count", period: from as FormulaVariable["period"], value }];
      const e = evaluateFormula(`to_period(x, ${to})`, vars);
      expect(e.result).toBe(expected);
      expect(e.resultType?.period).toBe(to);
    },
    10_000,
  );

  it("to_period needs a value with a period", T, () => {
    const r = validateFormula("to_period(a, year)", numbers("a"));
    expect(r).toMatchObject({ ok: false, errors: [{ code: "formula.period_mismatch" }] });
  });

  it("+ and − need the same period; a period against no period is refused", T, () => {
    const vars: FormulaVariable[] = [
      { name: "y", kind: "count", period: "year" },
      { name: "q", kind: "count", period: "quarter" },
      { name: "n", kind: "count", period: "none" },
    ];
    expect(validateFormula("y + q", vars)).toMatchObject({
      ok: false,
      errors: [
        {
          code: "formula.period_mismatch",
          message: "Period mismatch: q is per quarter but y is per year; convert with to_period(q, year)",
        },
      ],
    });
    expect(validateFormula("y - n", vars)).toMatchObject({
      ok: false,
      errors: [{ code: "formula.period_mismatch", message: "Period mismatch: y is per year but n has no period" }],
    });
    expect(validateFormula("y + to_period(q, year)", vars).ok).toBe(true);
  });

  it("fraction − fraction → fraction_delta; fraction ± fraction_delta → fraction", T, () => {
    const vars: FormulaVariable[] = [
      { name: "f", kind: "fraction", period: "none" },
      { name: "g", kind: "fraction", period: "none" },
      { name: "d", kind: "fraction_delta", period: "none" },
    ];
    const kind = (e: string) => {
      const r = validateFormula(e, vars);
      return r.ok ? r.resultType.kind : r.errors[0]!.code;
    };
    expect(kind("f - g")).toBe("fraction_delta");
    expect(kind("f + g")).toBe("fraction");
    expect(kind("f + d")).toBe("fraction");
    expect(kind("d + f")).toBe("fraction");
    expect(kind("f - d")).toBe("fraction");
    expect(kind("d - f")).toBe("formula.kind_mismatch");
    expect(kind("d + d")).toBe("fraction_delta");
    expect(kind("f * 2")).toBe("fraction");
  });

  it(
    "× rules: dimensionless takes the other kind; count × currency; count × count/quantity; currency × currency refused",
    T,
    () => {
      const vars: FormulaVariable[] = [
        { name: "f", kind: "fraction", period: "none" },
        { name: "p", kind: "percent_change", period: "none" },
        { name: "c", kind: "count", period: "none", unit: "customers" },
        { name: "k", kind: "count", period: "none" },
        { name: "q", kind: "quantity", period: "none", unit: "minutes" },
        { name: "h", kind: "quantity", period: "none", unit: "hours" },
        { name: "s", kind: "currency", currency: "SAR", period: "none" },
        { name: "t", kind: "currency", currency: "SAR", period: "none" },
        { name: "n", kind: "number", period: "none" },
      ];
      const r = (e: string) => {
        const x = validateFormula(e, vars);
        return x.ok
          ? `${x.resultType.kind}${x.resultType.currency ? ":" + x.resultType.currency : ""}`
          : x.errors[0]!.code;
      };
      expect(r("f * c")).toBe("count");
      expect(r("c * f")).toBe("count");
      expect(r("p * s")).toBe("currency:SAR");
      expect(r("n * q")).toBe("quantity");
      expect(r("f * n")).toBe("fraction");
      expect(r("f * f")).toBe("fraction");
      expect(r("f * p")).toBe("number");
      expect(r("c * s")).toBe("currency:SAR");
      expect(r("s * c")).toBe("currency:SAR");
      expect(r("c * k")).toBe("quantity");
      expect(r("c * q")).toBe("quantity");
      expect(r("q * c")).toBe("quantity");
      expect(r("s * t")).toBe("formula.currency_product");
      expect(r("q * s")).toBe("formula.kind_mismatch");
      expect(r("q * h")).toBe("formula.kind_mismatch");
      expect(r("q + h")).toBe("formula.kind_mismatch");
      expect(r("c + s")).toBe("formula.kind_mismatch");
      expect(r("f + c")).toBe("formula.kind_mismatch");
      const prod = validateFormula("s * t", vars);
      expect(!prod.ok && prod.errors[0]!.message).toBe(
        "Currency product: s and t are both currency amounts and cannot be multiplied",
      );
      const km = validateFormula("f + c", vars);
      expect(!km.ok && km.errors[0]!.message).toBe("Kind mismatch: f (fraction) + c (count) is not allowed");
    },
  );

  it(
    "÷ rules: X ÷ number → X; currency ÷ currency → number; currency ÷ count → currency; else kind_mismatch",
    T,
    () => {
      const vars: FormulaVariable[] = [
        { name: "f", kind: "fraction", period: "none" },
        { name: "c", kind: "count", period: "year" },
        { name: "s", kind: "currency", currency: "SAR", period: "year" },
        { name: "t", kind: "currency", currency: "SAR", period: "year" },
        { name: "n", kind: "number", period: "none" },
      ];
      const r = (e: string) => {
        const x = validateFormula(e, vars);
        return x.ok ? `${x.resultType.kind}/${x.resultType.period}` : x.errors[0]!.code;
      };
      expect(r("s / n")).toBe("currency/year");
      expect(r("f ÷ 2")).toBe("fraction/none");
      expect(r("s / t")).toBe("number/none");
      expect(r("s / c")).toBe("currency/year");
      expect(r("c / s")).toBe("formula.kind_mismatch");
      expect(r("f / f")).toBe("formula.kind_mismatch");
      expect(r("n / f")).toBe("formula.kind_mismatch");
    },
  );

  it("currencies: one currency per formula (formula.currency_mismatch), no FX", T, () => {
    const vars: FormulaVariable[] = [
      { name: "sar", kind: "currency", currency: "SAR", period: "none" },
      { name: "sar_b", kind: "currency", currency: "SAR", period: "none" },
      { name: "usd", kind: "currency", currency: "USD", period: "none" },
    ];
    expect(validateFormula("sar + usd", vars)).toMatchObject({
      ok: false,
      errors: [
        {
          code: "formula.currency_mismatch",
          message: "Currency mismatch: sar is in SAR but usd is in USD; there is no FX conversion",
        },
      ],
    });
    expect(validateFormula("sar / usd", vars)).toMatchObject({
      ok: false,
      errors: [{ code: "formula.currency_mismatch" }],
    });
    expect(validateFormula("max(sar, usd)", vars)).toMatchObject({
      ok: false,
      errors: [{ code: "formula.currency_mismatch" }],
    });
    // each operation is well typed, but the formula mixes SAR and USD
    expect(validateFormula("sar / sar_b * usd", vars)).toMatchObject({
      ok: false,
      errors: [{ code: "formula.currency_mismatch" }],
    });
    expect(validateFormula("sar - sar_b", vars).ok).toBe(true);
  });

  it("min/max need the same kind; abs keeps the type", T, () => {
    const vars: FormulaVariable[] = [
      { name: "f", kind: "fraction", period: "none", value: "0.2" },
      { name: "g", kind: "fraction", period: "none", value: "0.3" },
      { name: "c", kind: "count", period: "none", value: "-4" },
    ];
    expect(validateFormula("min(f, c)", vars)).toMatchObject({
      ok: false,
      errors: [{ code: "formula.kind_mismatch" }],
    });
    expect(evaluateFormula("min(f, g)", vars)).toMatchObject({ result: "0.2", resultType: { kind: "fraction" } });
    expect(evaluateFormula("max(f, g, f)", vars).result).toBe("0.3");
    expect(evaluateFormula("abs(c)", vars)).toMatchObject({ result: "4", resultType: { kind: "count" } });
  });

  it("independent problems are all reported in one call", T, () => {
    const vars: FormulaVariable[] = [
      { name: "s", kind: "currency", currency: "SAR", period: "none" },
      { name: "c", kind: "count", period: "none" },
    ];
    const r = validateFormula("(s * s) + (c + s) + nope", vars);
    expect(!r.ok && r.errors.map((e) => e.code)).toEqual([
      "formula.currency_product",
      "formula.kind_mismatch",
      "formula.undefined_variable",
    ]);
    // quoted sub-expressions keep their brackets
    expect(!r.ok && r.errors[0]!.params["left"]).toBe("s");
  });

  it("variable declarations are checked (defensive; the API schema refuses them first)", T, () => {
    const bad: unknown[] = [
      "nope",
      [{ name: "Bad", kind: "count", period: "none" }],
      [{ name: "year", kind: "count", period: "none" }],
      [{ name: "min", kind: "count", period: "none" }],
      [
        { name: "a", kind: "count", period: "none" },
        { name: "a", kind: "count", period: "none" },
      ],
      [{ name: "a", kind: "money", period: "none" }],
      [{ name: "a", kind: "count", period: "week" }],
      [{ name: "a", kind: "currency", period: "none" }],
      [{ name: "a", kind: "currency", currency: "sar", period: "none" }],
      [{ name: "a", kind: "count", currency: "SAR", period: "none" }],
      [{ name: "a", kind: "count", period: "none", value: 5 }],
      [{ name: "a", kind: "count", period: "none", value: "1e5" }],
      [{ name: "a", kind: "count", period: "none", value: "1.0000001" }],
      [null],
    ];
    for (const vars of bad) {
      const r = validateFormula("1", vars);
      expect(r.ok, JSON.stringify(vars)).toBe(false);
      if (!r.ok) expect(r.errors[0]!.code).toBe("formula.invalid_variable");
    }
  });
});

describe("evaluation (ADR-0024 §6)", () => {
  it("revenue example: (0.12 − 0.10) × 100000 × 50 SAR → exactly 100000 SAR per year", T, () => {
    const e = evaluateFormula(REVENUE_EXPR, revenueVars());
    expect(e).toMatchObject({
      ok: true,
      result: "100000",
      resultType: { kind: "currency", currency: "SAR", period: "year" },
      errors: [],
      engineVersion: ENGINE_VERSION,
      rounding: {
        column: "numeric(24,6)",
        mode: "ROUND_HALF_UP",
        precision: 80,
        exact: "100000",
        stored: "100000.000000",
        rounded: false,
        inexactIntermediate: false,
      },
      inputs: { target_attach_rate: "0.12", baseline_attach_rate: "0.10", eligible_customers: "100000", arpu: "50" },
    });
    expect(e.errorCode).toBeUndefined();
    // the Δ attach rate is a fraction_delta, shown as percentage points
    const delta = evaluateFormula("target_attach_rate - baseline_attach_rate", revenueVars());
    expect(delta).toMatchObject({ result: "0.02", resultType: { kind: "fraction_delta" } });
    expect(formatFormulaValue(delta.result, "fraction_delta")).toBe("2 pp");
    expect(formatFormulaValue(e.result, "currency", { currency: "SAR" })).toBe("SAR 100,000.00");
  });

  it("cost example: 200000 × (12.50 − 10.00) → exactly 500000.00 SAR per year", T, () => {
    const e = evaluateFormula(COST_EXPR, costVars);
    expect(e).toMatchObject({
      ok: true,
      result: "500000",
      resultType: { kind: "currency", currency: "SAR", period: "year" },
      rounding: { exact: "500000", stored: "500000.000000", rounded: false, inexactIntermediate: false },
    });
    expect(compareDecimal(e.result!, "500000.00")).toBe(0);
    expect(formatFormulaValue(e.result, "currency", { currency: "SAR" })).toBe("SAR 500,000.00");
    expect(formatFormulaValue(e.result, "currency", { currency: "SAR", locale: "ar" })).toBe("500,000.00 SAR");
  });

  it("0.1 + 0.2 = 0.3 exactly (never a binary float)", T, () => {
    const e = evaluateFormula("0.1 + 0.2", []);
    expect(e.result).toBe("0.3");
    expect(e.rounding.exact).toBe("0.3");
  });

  it("division by zero → Unknown (null) with formula.division_by_zero, never 0 or Infinity", T, () => {
    const vars: FormulaVariable[] = [
      { name: "a", kind: "currency", currency: "SAR", period: "none", value: "10" },
      { name: "b", kind: "currency", currency: "SAR", period: "none", value: "0" },
      { name: "c", kind: "currency", currency: "SAR", period: "none", value: "3" },
    ];
    for (const expr of ["a / b", "a / (c - c)", "a ÷ 0", "a / 0.000"]) {
      const e = evaluateFormula(expr, vars);
      expect(e.ok, expr).toBe(false);
      expect(e.result).toBeNull();
      expect(e.errorCode).toBe("formula.division_by_zero");
      expect(e.errors[0]!.message).toMatch(/^Division by zero: .+ is 0; the result is Unknown$/);
      expect(e.rounding.stored).toBeNull();
      expect(e.resultType).not.toBeNull(); // the formula is valid; only the value is Unknown
    }
  });

  it(
    "missing input → Unknown (null) with formula.missing_input listing every missing name; inputs override values",
    T,
    () => {
      const vars = revenueVars().map((v) =>
        v.name === "arpu" || v.name === "eligible_customers" ? { ...v, value: null } : v,
      );
      const e = evaluateFormula(REVENUE_EXPR, vars);
      expect(e).toMatchObject({
        ok: false,
        result: null,
        errorCode: "formula.missing_input",
        errors: [
          { code: "formula.missing_input", message: "Missing input: eligible_customers, arpu; the result is Unknown" },
        ],
      });
      const filled = evaluateFormula(REVENUE_EXPR, vars, { arpu: "50", eligible_customers: "100000" });
      expect(filled.result).toBe("100000");
      const cleared = evaluateFormula(REVENUE_EXPR, revenueVars(), { arpu: null });
      expect(cleared.errorCode).toBe("formula.missing_input");
      // inherited properties of the inputs object are ignored
      const inherited = evaluateFormula(
        REVENUE_EXPR,
        vars,
        Object.create({ arpu: "50", eligible_customers: "1" }) as Record<string, string>,
      );
      expect(inherited.errorCode).toBe("formula.missing_input");
      const invalid = evaluateFormula(REVENUE_EXPR, revenueVars(), { arpu: "50.5.5" });
      expect(invalid).toMatchObject({ result: null, errorCode: "formula.invalid_variable" });
    },
  );

  it("result outside numeric(24,6) → formula.result_out_of_range, null", T, () => {
    const vars: FormulaVariable[] = [{ name: "a", kind: "number", period: "none", value: "999999999999999999" }];
    expect(evaluateFormula("a", vars).result).toBe("999999999999999999");
    const e = evaluateFormula("a * 10", vars);
    expect(e).toMatchObject({ ok: false, result: null, errorCode: "formula.result_out_of_range" });
    expect(evaluateFormula("-a * 10", vars).errorCode).toBe("formula.result_out_of_range");
    // half-up storage rounding that carries over the limit is out of range too
    const edge: FormulaVariable[] = [{ name: "a", kind: "number", period: "none", value: "999999999999999999.999999" }];
    expect(evaluateFormula("a + 0.0000005", edge).errorCode).toBe("formula.result_out_of_range");
  });

  it("rounds once at storage to 6 decimals, half-up (away from zero for negatives)", T, () => {
    const vars: FormulaVariable[] = [{ name: "a", kind: "number", period: "none", value: "1" }];
    expect(evaluateFormula("a / 3", vars)).toMatchObject({
      result: "0.333333",
      rounding: { rounded: true, inexactIntermediate: true },
    });
    expect(evaluateFormula("a / 8", vars)).toMatchObject({
      result: "0.125",
      rounding: { stored: "0.125000", rounded: false, inexactIntermediate: false },
    });
    expect(evaluateFormula("0.0000005", []).result).toBe("0.000001");
    expect(evaluateFormula("-0.0000005", []).result).toBe("-0.000001");
    expect(evaluateFormula("0.0000004", []).result).toBe("0");
    expect(evaluateFormula("-0.0000004", []).result).toBe("0");
    expect(evaluateFormula("-0.0000004", []).rounding.stored).toBe("0.000000");
    expect(evaluateFormula("2 / 3 * 3", []).result).toBe("2"); // 80-digit intermediate, single storage rounding
  });

  it("an invalid formula evaluates to ok:false with the validation errors and no result type", T, () => {
    const e = evaluateFormula("a ** 2", ABC);
    expect(e).toMatchObject({ ok: false, result: null, resultType: null, errorCode: "formula.syntax" });
    expect(evaluateFormula(REVENUE_EXPR, revenueVars("month")).errorCode).toBe("formula.period_mismatch");
  });

  it("evaluateAst reuses a validated formula without re-parsing", T, () => {
    const v = validateFormula(COST_EXPR, costVars);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(evaluateAst(v.checked).result).toBe("500000");
    expect(evaluateAst(v.checked, { target_unit_cost: "12.50" }).result).toBe("0");
    expect(evaluateAst(v.checked, { target_unit_cost: "13.50" }).result).toBe("-200000");
  });

  it("is deterministic: the same inputs always give the same lineage", T, () => {
    const a = evaluateFormula(REVENUE_EXPR, revenueVars());
    const b = evaluateFormula(REVENUE_EXPR, revenueVars());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("display by kind (ADR-0024 §6 table)", () => {
  it("fraction 0.02 → '2%' but fraction_delta 0.02 → '2 pp' (percentage points)", T, () => {
    expect(formatFormulaValue("0.02", "fraction")).toBe("2%");
    expect(formatFormulaValue("0.02", "fraction_delta")).toBe("2 pp");
    expect(formatFormulaValue("0.12", "fraction")).toBe("12%");
    expect(formatFormulaValue("-0.10", "percent_change")).toBe("-10%");
    expect(formatFormulaValue("0.125", "fraction")).toBe("12.5%");
    expect(formatFormulaValue("0.02", "fraction_delta", { locale: "ar" })).toBe("2 نقطة مئوية");
    expect(formatFormulaValue("100000", "count", { unit: "customers" })).toBe("100,000 customers");
    expect(formatFormulaValue("1.5", "number")).toBe("1.5");
    expect(displayNumber("0.02", "fraction_delta")).toEqual({ value: "2", suffix: "percentage_points" });
    expect(displayNumber("0.02", "fraction")).toEqual({ value: "2", suffix: "percent" });
  });

  it("Unknown stays Unknown: null in, null out (never 0)", T, () => {
    expect(formatFormulaValue(null, "currency", { currency: "SAR" })).toBeNull();
    expect(formatFormulaValue(null, "fraction_delta")).toBeNull();
    expect(displayNumber(null, "fraction")).toBeNull();
    expect(displayNumber("garbage", "fraction")).toBeNull();
  });
});
