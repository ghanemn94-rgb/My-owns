// Fuzz and no-dynamic-code tests of the T09 formula engine (ADR-0024 §6 "No dynamic code"; T-DG3-KBE-A).
//  1. Random byte strings and random grammar-alphabet strings never make validateFormula/evaluateFormula throw, and
//     every outcome is well formed (a known code, or a decimal/null result).
//  2. Code never runs: global eval/Function are replaced by tripwires during the fuzz, code-shaped payloads are syntax
//     errors, and a source scan proves the engine has no eval/Function/vm/dynamic import/with/timer-string.
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { evaluateFormula, validateFormula, type FormulaErrorCode, type FormulaVariable } from "./index.ts";

/** Deterministic PRNG (mulberry32), so a failure reproduces from its seed. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CODES: readonly FormulaErrorCode[] = [
  "formula.syntax",
  "formula.undefined_variable",
  "formula.kind_mismatch",
  "formula.currency_product",
  "formula.currency_mismatch",
  "formula.period_mismatch",
  "formula.invalid_variable",
  "formula.division_by_zero",
  "formula.missing_input",
  "formula.result_out_of_range",
];

const VARS: FormulaVariable[] = [
  { name: "a", kind: "number", period: "none", value: "2" },
  { name: "b", kind: "number", period: "none", value: "0" },
  { name: "c", kind: "count", period: "year", value: "100000" },
  { name: "f", kind: "fraction", period: "none", value: "0.12" },
  { name: "m", kind: "currency", currency: "SAR", period: "month", value: "50" },
  { name: "s", kind: "currency", currency: "SAR", period: "none", value: "12.50" },
  { name: "u", kind: "currency", currency: "USD", period: "none", value: null },
];

const DECIMAL_OR_NULL = /^-?[0-9]{1,18}(\.[0-9]{1,6})?$/;

function checkOutcome(expr: string) {
  const v = validateFormula(expr, VARS);
  if (v.ok) {
    expect(v.resultType.kind).toBeTypeOf("string");
  } else {
    expect(v.errors.length).toBeGreaterThan(0);
    for (const e of v.errors) {
      expect(CODES).toContain(e.code);
      expect(e.message).toBeTypeOf("string");
    }
  }
  const e = evaluateFormula(expr, VARS);
  if (e.result !== null) {
    expect(e.result).toMatch(DECIMAL_OR_NULL);
    expect(e.ok).toBe(true);
  } else {
    expect(e.ok).toBe(false);
    expect(CODES).toContain(e.errorCode);
  }
  return v.ok;
}

describe("fuzz: no uncaught exception, no code execution", () => {
  const tripped: string[] = [];
  // eslint-disable-next-line no-eval -- tripwire: saves the global eval to restore it; never calls it
  const realEval = globalThis.eval;
  const realFunction = globalThis.Function;
  beforeEach(() => {
    tripped.length = 0;
    // eslint-disable-next-line no-eval -- tripwire: replaces global eval with a recorder; never calls eval
    globalThis.eval = ((..._args: unknown[]) => {
      tripped.push("eval");
      return undefined;
    }) as typeof eval; // eslint-disable-line no-eval -- type position only; never calls eval
    globalThis.Function = new Proxy(realFunction, {
      apply() {
        tripped.push("Function()");
        return () => undefined;
      },
      construct() {
        tripped.push("new Function");
        return () => undefined;
      },
    });
  });
  afterEach(() => {
    // eslint-disable-next-line no-eval -- tripwire: restores the original global eval; never calls it
    globalThis.eval = realEval;
    globalThis.Function = realFunction;
  });

  it("10 000 random byte strings (0–255, up to 80 bytes)", { timeout: 60_000 }, () => {
    const r = rng(0x5eed_f00d);
    for (let i = 0; i < 10_000; i++) {
      const len = Math.floor(r() * 81);
      let s = "";
      for (let j = 0; j < len; j++) s += String.fromCharCode(Math.floor(r() * 256));
      expect(() => checkOutcome(s)).not.toThrow();
    }
    expect(tripped).toEqual([]);
  });

  it("10 000 random UTF-16 strings including astral code points and lone surrogates", { timeout: 60_000 }, () => {
    const r = rng(0xc0ffee);
    for (let i = 0; i < 10_000; i++) {
      const len = Math.floor(r() * 40);
      let s = "";
      for (let j = 0; j < len; j++) {
        const pick = r();
        s +=
          pick < 0.1
            ? String.fromCodePoint(0x10000 + Math.floor(r() * 0xfffff))
            : String.fromCharCode(Math.floor(r() * 0x10000));
      }
      expect(() => checkOutcome(s)).not.toThrow();
    }
    expect(tripped).toEqual([]);
  });

  it(
    "20 000 random strings over the grammar alphabet reach parser, type checker and evaluator",
    { timeout: 60_000 },
    () => {
      const atoms = [
        "a",
        "b",
        "c",
        "f",
        "m",
        "s",
        "u",
        "x",
        "0",
        "1",
        "2.5",
        "0.000",
        "+",
        "-",
        "*",
        "/",
        "×",
        "÷",
        "(",
        ")",
        ",",
        " ",
        "min",
        "max",
        "abs",
        "to_period",
        "year",
        "month",
        "quarter",
        "**",
        ";",
        "'",
        "\n",
      ];
      const r = rng(42);
      let valid = 0;
      for (let i = 0; i < 20_000; i++) {
        const len = 1 + Math.floor(r() * 16);
        let s = "";
        for (let j = 0; j < len; j++) s += atoms[Math.floor(r() * atoms.length)]!;
        let ok = false;
        expect(() => {
          ok = checkOutcome(s);
        }).not.toThrow();
        if (ok) valid++;
      }
      expect(valid).toBeGreaterThan(100); // the generator does reach well-typed formulas
      expect(tripped).toEqual([]);
    },
  );

  it("code-shaped payloads are syntax errors and run nothing", { timeout: 10_000 }, () => {
    const g = globalThis as Record<string, unknown>;
    delete g["__mth_pwned"];
    const payloads = [
      "globalThis.__mth_pwned = 1",
      "this.constructor.constructor('globalThis.__mth_pwned=1')()",
      'constructor.constructor("return process")()',
      "a; globalThis.__mth_pwned = 1",
      "import('node:child_process')",
      "require('fs')",
      "process.exit(1)",
      "`${globalThis.__mth_pwned = 1}`",
      "with (globalThis) { __mth_pwned = 1 }",
      "eval('1')",
      "new Function('return 1')()",
      "a\n__mth_pwned = 1",
      "__proto__",
      "a /* */ + b",
      "a // b",
    ];
    for (const p of payloads) {
      const v = validateFormula(p, VARS);
      expect(v.ok, p).toBe(false);
      if (!v.ok) expect(["formula.syntax", "formula.undefined_variable"]).toContain(v.errors[0]!.code);
      expect(evaluateFormula(p, VARS).result).toBeNull();
    }
    expect(g["__mth_pwned"]).toBeUndefined();
    expect(tripped).toEqual([]);
  });
});

describe("source scan: no dynamic code in packages/shared/src/formula (ADR-0024 §6)", () => {
  it(
    "engine sources contain no eval, Function constructor, vm, dynamic import, with, or string timers",
    { timeout: 10_000 },
    () => {
      const dir = fileURLToPath(new URL(".", import.meta.url));
      const files = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
      expect(files.sort()).toEqual(["evaluate.ts", "index.ts", "parse.ts", "tokenize.ts", "typecheck.ts", "types.ts"]);
      const forbidden: [string, RegExp][] = [
        ["eval(", /\beval\s*\(/],
        ["new Function", /\bnew\s+Function\b/],
        ["Function(", /(^|[^.\w])Function\s*\(/m],
        ["vm import", /from\s+["'](node:)?vm["']/],
        ["vm require", /require\s*\(\s*["'](node:)?vm["']/],
        ["dynamic import", /\bimport\s*\(/],
        ["with statement", /\bwith\s*\(/],
        ["timers", /\b(setTimeout|setInterval|setImmediate)\b/],
        ["globalThis", /\bglobalThis\b/],
      ];
      for (const f of files) {
        const text = readFileSync(`${dir}${f}`, "utf8");
        for (const [what, re] of forbidden) expect(re.test(text), `${f}: ${what}`).toBe(false);
      }
    },
  );
});
