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
  // eslint-disable-next-line no-restricted-syntax -- tripwire (F-DG3-100 rule): saves/replaces/restores globalThis.Function; never calls it
  const realFunction = globalThis.Function;
  beforeEach(() => {
    tripped.length = 0;
    // eslint-disable-next-line no-eval -- tripwire: replaces global eval with a recorder; never calls eval
    globalThis.eval = ((..._args: unknown[]) => {
      tripped.push("eval");
      return undefined;
    }) as typeof eval; // eslint-disable-line no-eval -- type position only; never calls eval
    // eslint-disable-next-line no-restricted-syntax -- tripwire (F-DG3-100 rule): saves/replaces/restores globalThis.Function; never calls it
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
    // eslint-disable-next-line no-restricted-syntax -- tripwire (F-DG3-100 rule): saves/replaces/restores globalThis.Function; never calls it
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

/**
 * The source-scan patterns (ADR-0024 §6; extended for F-DG3-100). Applied to engine source with comments removed, so
 * prose such as "eval, Function, vm … are forbidden" in a header comment is not a hit. String literals are not removed:
 * the engine needs none of these words in a string either.
 */
const FORBIDDEN: readonly (readonly [string, RegExp])[] = [
  ["eval(", /\beval\s*\(/],
  ["eval identifier", /\beval\b/],
  ["new Function", /\bnew\s+Function\b/],
  ["Function(", /(^|[^.\w])Function\s*\(/m],
  ["Function identifier", /(^|[^\w$])Function(?![\w$])/m],
  ["Reflect.construct", /\bReflect\s*(\.\s*construct\b|\[)/],
  ["Reflect.apply", /\bReflect\s*\.\s*apply\b/],
  ["Reflect", /\bReflect\b/],
  ['["constructor"]', /\[\s*(["'`])constructor\1\s*\]/],
  [".constructor access", /\.\s*constructor\b/],
  ["constructor key", /\bconstructor\s*:/],
  ["createRequire", /\bcreateRequire\b/],
  ["require(", /(^|[^\w$])require\s*\(/m],
  ["node:module", /["'`](node:)?module["'`]/],
  ["vm import", /from\s+["'](node:)?vm["']/],
  ["vm require", /require\s*\(\s*["'](node:)?vm["']/],
  ["worker_threads/child_process", /["'`](node:)?(worker_threads|child_process)["'`]/],
  ["dynamic import", /\bimport\s*\(/],
  ["with statement", /\bwith\s*\(/],
  ["timers", /\b(setTimeout|setInterval|setImmediate)\b/],
  ["globalThis", /\bglobalThis\b/],
];

/** Removes block and line comments (a line comment starts at `//` not preceded by `:`, so "https://" in a string stays). */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:\\])\/\/.*$/gm, "$1");
}

/** The names of the forbidden forms found in `text` (empty when clean). */
function scanSource(text: string): string[] {
  const code = stripComments(text);
  return FORBIDDEN.filter(([, re]) => re.test(code)).map(([what]) => what);
}

describe("source scan: no dynamic code in packages/shared/src/formula (ADR-0024 §6)", () => {
  it(
    "engine sources contain no eval, Function constructor, Reflect, ['constructor'], require/createRequire, vm, dynamic import, with, or string timers",
    { timeout: 10_000 },
    () => {
      const dir = fileURLToPath(new URL(".", import.meta.url));
      const files = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
      expect(files.sort()).toEqual(["evaluate.ts", "index.ts", "parse.ts", "tokenize.ts", "typecheck.ts", "types.ts"]);
      for (const f of files) expect(scanSource(readFileSync(`${dir}${f}`, "utf8")), f).toEqual([]);
    },
  );

  // F-DG3-100: every bypass form from the finding, and the forms the scan already caught, are hits. Each probe is a
  // string handed to the scan; nothing here is executed.
  const PROBES: readonly (readonly [string, string])[] = [
    ['Reflect.construct(Function, ["return 1"])', "Reflect.construct"],
    ['Reflect.apply(Function, null, ["return 1"])', "Reflect.apply"],
    ['const F = Function; F("return 1")', "Function identifier"],
    ['const __F = Function;\n__F("return 1")', "Function identifier"],
    ['Object.getPrototypeOf(function* () {})["constructor"]("yield 1")', '["constructor"]'],
    ["Object.getPrototypeOf(function* () {})['constructor']('yield 1')", '["constructor"]'],
    ["const C = (async () => {}).constructor; C('return 1')", ".constructor access"],
    ["const { constructor: D } = function* () {}; D('yield 1')", "constructor key"],
    ['import { createRequire } from "node:module"', "createRequire"],
    ['import { createRequire } from "node:module"', "node:module"],
    ['createRequire(import.meta.url)("vm")', "createRequire"],
    ['const fs = require("fs")', "require("],
    ['import m from "module"', "node:module"],
    ['import { Worker } from "node:worker_threads"', "worker_threads/child_process"],
    ['eval("1")', "eval("],
    ['new Function("return 1")', "new Function"],
    ['import("node:fs")', "dynamic import"],
    ['import vm from "node:vm"', "vm import"],
    ['setTimeout("x()", 0)', "timers"],
    ["globalThis.x = 1", "globalThis"],
  ];
  it.each(PROBES)("flags %s as %s", (probe, what) => {
    expect(scanSource(probe)).toContain(what);
  });

  it("does not flag the engine's own names, comments or the word 'required'", () => {
    const clean = [
      "// eval, Function, vm and Reflect are forbidden here",
      "/* new Function(...) and require('vm') are banned */",
      "type FormulaFunction = string; const isFunctionName = (s: string) => s.length > 0;",
      "class FormulaError extends Error { constructor(p: string) { super(p); } }",
      'const note = "ISO 4217 code; required for kind currency";',
      'const url = "https://example.invalid/a"; // trailing comment with Function(',
    ].join("\n");
    expect(scanSource(clean)).toEqual([]);
  });
});
