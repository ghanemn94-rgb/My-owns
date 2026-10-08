// Fuzz and no-dynamic-code tests of the T09 formula engine (ADR-0024 §6 "No dynamic code"; T-DG3-KBE-A).
//  1. Random byte strings and random grammar-alphabet strings never make validateFormula/evaluateFormula throw, and
//     every outcome is well formed (a known code, or a decimal/null result).
//  2. Code never runs: global eval/Function are replaced by tripwires during the fuzz, code-shaped payloads are syntax
//     errors, and a source scan proves the engine has no eval/Function/vm/dynamic import/with/timer-string, imports
//     only allowlisted modules, and names no global object, process, 'constructor' or prototype reflection.
//  This file also runs in the Vitest project unit-formula-nocodegen (node --disallow-code-generation-from-strings), the
//  spelling-independent run-time layer of ADR-0024 §6 (F-DG3-100).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ESLint } from "eslint";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  evaluateFormula,
  validateFormula,
  type FormulaErrorCode,
  type FormulaProblem,
  type FormulaVariable,
} from "./index.ts";

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

const T10 = { timeout: 10_000 };
const DECIMAL_OR_NULL = /^-?[0-9]{1,18}(\.[0-9]{1,6})?$/;

/**
 * F-DG3-100 (round 4): the problems that report an internal engine failure (params.reason "internal"; index.ts
 * internalProblem and evaluate.ts internal). No input, however random, may produce one: an internal failure is an
 * engine defect, never an acceptable outcome. The same helper is in formula.test.ts.
 */
function internalProblems(problems: readonly FormulaProblem[]): string[] {
  return problems.filter((p) => p.params["reason"] === "internal").map((p) => `${p.code}: ${p.message}`);
}

function checkOutcome(expr: string) {
  const v = validateFormula(expr, VARS);
  if (v.ok) {
    expect(v.resultType.kind).toBeTypeOf("string");
  } else {
    expect(v.errors.length).toBeGreaterThan(0);
    expect(internalProblems(v.errors), JSON.stringify(expr)).toEqual([]);
    for (const e of v.errors) {
      expect(CODES).toContain(e.code);
      expect(e.message).toBeTypeOf("string");
    }
  }
  const e = evaluateFormula(expr, VARS);
  expect(internalProblems(e.errors), JSON.stringify(expr)).toEqual([]);
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
      if (!v.ok) {
        expect(["formula.syntax", "formula.undefined_variable"]).toContain(v.errors[0]!.code);
        expect(internalProblems(v.errors), p).toEqual([]);
      }
      const e = evaluateFormula(p, VARS);
      expect(e.result).toBeNull();
      expect(internalProblems(e.errors), p).toEqual([]);
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
  // F-DG3-100 (round 3). The global object under any name, and the host process: global["ev" + "al"], self[…],
  // process.getBuiltinModule("node:vm"). The engine uses none of these words outside comments.
  ["host global", /\b(process|global|globalThis|self|window|frames|parent|top|opener|document)\b/],
  // The word constructor in any position (string, template, identifier, key) except a class constructor declaration,
  // which scanSource masks first.
  ["constructor word", /\bconstructor\b/],
  [
    "prototype reflection",
    /\b(getPrototypeOf|setPrototypeOf|getOwnPropertyDescriptors?|defineProperty|defineProperties|__proto__|__lookupGetter__|__lookupSetter__|__defineGetter__|__defineSetter__)\b/,
  ],
  // A computed key assembled from a string literal: ["con" + k], [k + "structor"].
  ["string-assembled key", /\[\s*(["'`])[^"'`\]]*\1\s*\+|\+\s*(["'`])[^"'`\]]*\2\s*\]/],
  ["import.meta", /\bimport\s*\.\s*meta\b/],
  // A hex or Unicode escape spells a name without its letters ("\x63onstructor", "\u0065val"); the engine needs none.
  ["escape sequence", /\\(x[0-9a-fA-F]{2}|u[0-9a-fA-F{])/],
  // F-DG3-100 (round 5): the engine is synchronous (mirrors eslint.config.js). A promise reaction, an async function or a
  // microtask moves a refused code generation (EvalError) off the exercising test's call stack, where it can be swallowed.
  ["Promise", /\b(Promise|queueMicrotask)\b/],
  ["async", /\basync\b/],
  ["await", /\bawait\b/],
  [".then/.catch/.finally", /\.\s*(then|catch|finally)\b|\[\s*(["'`])(then|catch|finally)\2\s*\]/],
  // F-DG3-100 (round 6; the reviewer's G1, G2 and A1). No generators: a `function*`, a generator method (`*name(` after
  // `{`, `}`, `,`, `;`, `static` or `async`) or a `yield`. The word then in any position (a key, a member, a destructured
  // name, a string), and the asynchronous sources fromAsync and asyncIterator. The words catch and finally outside a
  // try statement are refused by rethrowRuleHits below.
  ["generator", /\bfunction\s*\*|(?:^|[{},;]|\bstatic|\basync)\s*\*\s*[\w$#[]|\byield\b/m],
  ["then", /\bthen\b/],
  ["fromAsync/asyncIterator", /\b(fromAsync|asyncIterator)\b/],
];

/**
 * F-DG3-100 (round 5): the one allowed catch shape, `catch (e) { if (e instanceof EvalError) throw e; …` with no else
 * (mirrors CATCH_RETHROWS_EVAL_ERROR in eslint.config.js). Matched at every `catch` keyword of the comment-free code.
 */
const CATCH_RETHROW =
  /^catch\s*\(\s*e\s*\)\s*\{\s*if\s*\(\s*e\s+instanceof\s+EvalError\s*\)\s*throw\s+e\s*;(?!\s*else\b)/;

/**
 * F-DG3-100 (round 6): the brace pairs of comment-free code (open → close and close → open). A brace inside a string
 * literal, a template literal (outside its `${…}` substitutions) or a regular-expression literal is not counted, so a
 * `}` in a string does not end a block (the reviewer's F1). A `/` starts a regular-expression literal when the previous
 * significant character is an operator or punctuator (a heuristic; a real parser is ESLint, layer 1). Returns null when
 * the braces, quotes or templates do not balance; the scan then reports a hit, so it fails closed.
 */
function bracePairs(code: string): Map<number, number> | null {
  const pairs = new Map<number, number>();
  const opens: { at: number; substitution: boolean }[] = [];
  let inTemplate = false;
  let prev = "";
  for (let i = 0; i < code.length; i++) {
    const c = code[i]!;
    if (inTemplate) {
      if (c === "\\") i++;
      else if (c === "`") {
        inTemplate = false;
        prev = c;
      } else if (c === "$" && code[i + 1] === "{") {
        opens.push({ at: ++i, substitution: true });
        inTemplate = false;
        prev = "{";
      }
      continue;
    }
    if (/\s/.test(c)) continue;
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < code.length && code[j] !== c && code[j] !== "\n") j += code[j] === "\\" ? 2 : 1;
      if (code[j] !== c) return null;
      i = j;
      prev = c;
      continue;
    }
    if (c === "`") {
      inTemplate = true;
      continue;
    }
    if (c === "/" && (prev === "" || /[(,=:[!&|?{};+\-*%<>~^]/.test(prev))) {
      let j = i + 1;
      let inClass = false;
      while (j < code.length && code[j] !== "\n" && (inClass || code[j] !== "/")) {
        if (code[j] === "\\") j++;
        else if (code[j] === "[") inClass = true;
        else if (code[j] === "]") inClass = false;
        j++;
      }
      if (code[j] !== "/") return null;
      i = j;
      prev = "/";
      continue;
    }
    if (c === "{") opens.push({ at: i, substitution: false });
    else if (c === "}") {
      const open = opens.pop();
      if (!open) return null;
      pairs.set(open.at, i).set(i, open.at);
      if (open.substitution) {
        inTemplate = true;
        continue;
      }
    }
    prev = c;
  }
  return opens.length === 0 && !inTemplate ? pairs : null;
}

/**
 * F-DG3-100 (round 5, extended in round 6): the EvalError-rethrow rule of ADR-0024 §6 (mirrors eslint.config.js).
 * - Every `catch` word is the catch clause of a try statement (it follows the `}` of a block that follows `try`) and
 *   starts with the rethrow. A `catch` anywhere else (a key, a member, a destructured name, a method, a string) is a hit.
 * - Every `finally` word is the finally clause of a try statement (it follows the `}` of a try or catch block and opens
 *   a block), and that block contains no return, throw, break or continue, also not inside a nested function (lint's
 *   no-unsafe-finally does not count those). A `finally` anywhere else is a hit.
 * - EvalError appears only after instanceof.
 * - The braces balance (bracePairs); otherwise the scan cannot place a block and reports a hit.
 */
function rethrowRuleHits(code: string): string[] {
  const hits: string[] = [];
  const pairs = bracePairs(code);
  if (!pairs) return ["unbalanced braces, quotes or templates"];
  /** The text before the `{` that the `}` ending just before `at` closes, or null if no `}` ends there. */
  const beforeBlock = (at: number): string | null => {
    const close = code.slice(0, at).trimEnd().length - 1;
    const open = code[close] === "}" ? pairs.get(close) : undefined;
    return open === undefined ? null : code.slice(0, open).trimEnd();
  };
  for (const m of code.matchAll(/\bcatch\b/g)) {
    const before = beforeBlock(m.index);
    if (before === null || !/\btry$/.test(before)) hits.push("catch outside a try statement");
    else if (!CATCH_RETHROW.test(code.slice(m.index))) hits.push("catch without EvalError rethrow");
  }
  for (const m of code.matchAll(/\bfinally\b/g)) {
    const before = beforeBlock(m.index);
    const open = m.index + m[0].length + (/^\s*/.exec(code.slice(m.index + m[0].length))?.[0].length ?? 0);
    const close = pairs.get(open);
    if (
      before === null ||
      !/(\btry|\bcatch\s*(\([^()]*\))?)$/.test(before) ||
      code[open] !== "{" ||
      close === undefined
    )
      hits.push("finally outside a try statement");
    else if (/\b(return|throw|break|continue)\b/.test(code.slice(open, close + 1)))
      hits.push("finally with return/throw/break/continue");
  }
  const evalErrors = code.match(/\bEvalError\b/g)?.length ?? 0;
  if (evalErrors !== (code.match(/\binstanceof\s+EvalError\b/g)?.length ?? 0))
    hits.push("EvalError outside instanceof");
  return [...new Set(hits)];
}

/**
 * F-DG3-100 (round 3): module loading is an ALLOWLIST, mirroring the ESLint override. An engine source may import or
 * re-export only a sibling module (./x.ts), the shared value helpers (../value.ts) and decimal.js.
 */
const IMPORT_ALLOWLIST = /^(?:\.\/[A-Za-z0-9_-]+\.ts|\.\.\/value\.ts|decimal\.js)$/;
/** F-DG3-100 (round 4): ../value.ts, in the closure but outside formula/, may import decimal.js only (eslint.config.js). */
const CLOSURE_OUTSIDE_IMPORT_ALLOWLIST = /^decimal\.js$/;
/**
 * Static import/export-from specifiers, including multi-line braces, type-only imports, side-effect imports and (F-DG3-100
 * round 5) string-named specifiers: `export { "x" as y } from "…"`, `import { "x" as y } from "…"`, `export * as "n" from "…"`.
 */
const IMPORT_SPECIFIER =
  /\b(?:import|export)\s+(?:type\s+)?(?:(?:[\w*$\s{},]|"[^"\n]*"|'[^'\n]*')+?\s+from\s+)?(["'`])([^"'`]*)\1/g;
/** A class constructor declaration (constructor(params) { on one line), the only allowed use of the word. */
const CLASS_CONSTRUCTOR = /(^|[{};])(\s*)constructor(\s*\([^)]*\)[ \t]*\{)/gm;

/** Removes block and line comments (a line comment starts at `//` not preceded by `:`, so "https://" in a string stays). */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:\\])\/\/.*$/gm, "$1");
}

/** The names of the forbidden forms found in `text` (empty when clean). */
function scanSource(text: string, allowlist: RegExp = IMPORT_ALLOWLIST): string[] {
  const code = stripComments(text).replace(CLASS_CONSTRUCTOR, "$1$2__class_ctor__$3");
  const hits = FORBIDDEN.filter(([, re]) => re.test(code)).map(([what]) => what);
  hits.push(...rethrowRuleHits(code));
  if (staticImports(text).some((spec) => !allowlist.test(spec))) hits.push("non-allowlisted import");
  return hits;
}

/** The static import/export-from specifiers of a source (comments removed). */
function staticImports(text: string): string[] {
  return [...stripComments(text).matchAll(IMPORT_SPECIFIER)].map((m) => m[2]!);
}

/** packages/shared/src/ (absolute, with a trailing separator); engine files are named relative to it. */
const SRC_DIR = fileURLToPath(new URL("../", import.meta.url));
const FORMULA_DIR = fileURLToPath(new URL(".", import.meta.url));
/** The files of the engine's import closure that live outside formula/ (mirrors FORMULA_CLOSURE_OUTSIDE in eslint.config.js). */
const CLOSURE_OUTSIDE = ["value.ts"];

/**
 * F-DG3-100 (round 4): the file set the source scan reads, relative to packages/shared/src: every engine source in
 * formula/ (not tests, not test-support/) and the closure files outside formula/, each with the allowlist that applies.
 */
function scannedFiles(): { readonly file: string; readonly allowlist: RegExp }[] {
  const engine = readdirSync(FORMULA_DIR)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .map((f) => ({ file: `formula/${f}`, allowlist: IMPORT_ALLOWLIST }));
  return [...engine, ...CLOSURE_OUTSIDE.map((file) => ({ file, allowlist: CLOSURE_OUTSIDE_IMPORT_ALLOWLIST }))];
}

/**
 * F-DG3-100 (round 4): the engine's transitive STATIC import closure from formula/index.ts (import and export-from,
 * type-only included). Relative specifiers are followed (files named relative to packages/shared/src); a bare specifier
 * is a package and is recorded, not followed. A relative specifier that does not resolve to an existing file is
 * recorded as unresolved, so the test fails rather than silently missing a file.
 */
function engineImportClosure(): { files: string[]; packages: string[]; unresolved: string[] } {
  const files = new Set<string>();
  const packages = new Set<string>();
  const unresolved: string[] = [];
  const queue = ["formula/index.ts"];
  while (queue.length > 0) {
    const file = queue.shift()!;
    if (files.has(file)) continue;
    files.add(file);
    const from = pathToFileURL(`${SRC_DIR}${file}`);
    for (const spec of staticImports(readFileSync(from, "utf8"))) {
      if (!spec.startsWith(".")) {
        packages.add(spec);
        continue;
      }
      const target = fileURLToPath(new URL(spec, from));
      if (!target.startsWith(SRC_DIR) || !existsSync(target)) {
        unresolved.push(`${file} -> ${spec}`);
        continue;
      }
      queue.push(target.slice(SRC_DIR.length).split("\\").join("/"));
    }
  }
  return { files: [...files].sort(), packages: [...packages].sort(), unresolved };
}

/** True in the unit-formula-nocodegen project (vitest.config.ts). */
const NOCODEGEN = process.execArgv.includes("--disallow-code-generation-from-strings");

/**
 * F-DG3-100 (round 6): the code-security reviewer's round-5 self-handling forms, built exactly as its probes build them
 * (docs/delivery/test-evidence/DG3/code-security/round-5/probes/rethrow-rule-attack-probe.mjs and -2.mjs): the helper
 * text that the probe appends to tokenize.ts, with the same code-generation line. Each passed every layer in round 5
 * (A2 was refused at run time only). Entries: id, helper text, the scan hit, the lint rule.
 */
const PROBE_KEY = "String.fromCharCode(99, 111, 110, 115, 116, 114, 117, 99, 116, 111, 114)";
const PROBE_R = "as unknown as Record<string, (s: string) => () => unknown>";
const probeGen = (fn: string) => `void (${fn} ${PROBE_R})[${PROBE_KEY}]!("return 1")()`;
const PROBE_T = "(this: unknown, f?: (v: unknown) => unknown, r?: (e: unknown) => unknown) => object";
const ROUND5_HANDLER_FORMS: readonly (readonly [string, string, string, string])[] = [
  [
    "G1",
    `function* __g(): Generator<number> {\n  try {\n    ${probeGen("__w")};\n  } finally {\n    yield 0;\n  }\n}\nfunction __w(): void {\n  void __g().next();\n}`,
    "generator",
    "no-restricted-syntax",
  ],
  [
    "G2",
    `function* __g(): Generator<number> {\n  try {\n    ${probeGen("__w")};\n  } finally {\n    yield 0;\n  }\n}\nfunction __w(): void {\n  const it = __g();\n  it.next();\n  it.return(0);\n}`,
    "generator",
    "no-restricted-syntax",
  ],
  [
    "A1",
    `function __w(): void {\n  const p = Array.fromAsync([0]) as unknown as { then: ${PROBE_T} };\n  const { then: t } = p;\n  const d = t.call(p, () => {\n    ${probeGen("__w")};\n  });\n  t.call(d, undefined, () => undefined);\n}`,
    "then",
    "no-restricted-syntax",
  ],
  [
    "A1",
    `function __w(): void {\n  const p = Array.fromAsync([0]) as unknown as { then: ${PROBE_T} };\n  const { then: t } = p;\n  const d = t.call(p, () => {\n    ${probeGen("__w")};\n  });\n  t.call(d, undefined, () => undefined);\n}`,
    "fromAsync/asyncIterator",
    "no-restricted-syntax",
  ],
  [
    "A2",
    `function __w(): void {\n  const p = Array.fromAsync([0]) as unknown as { then: ${PROBE_T} };\n  const { then: t } = p;\n  t.call(p, () => {\n    ${probeGen("__w")};\n  });\n}`,
    "then",
    "no-restricted-syntax",
  ],
];
/** F1 and its relatives: a `}` inside a string, a template, a substitution or a regular expression in a finally block. */
const F1_FORMS: readonly string[] = [
  `function __w(): void {\n  try {\n    ${probeGen("__w")};\n  } finally {\n    const s = "}";\n    void s;\n    return;\n  }\n}`,
  "function f(): void {\n  try {\n    a();\n  } finally {\n    const s = '}';\n    return;\n  }\n}",
  "function f(): void {\n  try {\n    a();\n  } finally {\n    const s = `}`;\n    return;\n  }\n}",
  'function f(): void {\n  try {\n    a();\n  } finally {\n    const s = `${"}"}`;\n    return;\n  }\n}',
  "function f(): void {\n  try {\n    a();\n  } finally {\n    const r = /}/;\n    return;\n  }\n}",
];

describe("source scan: no dynamic code in packages/shared/src/formula (ADR-0024 §6)", () => {
  it(
    "engine sources contain no eval, Function constructor, Reflect, ['constructor'], require/createRequire, vm, dynamic import, with, or string timers, and import only allowlisted modules",
    { timeout: 10_000 },
    () => {
      const files = scannedFiles();
      expect(files.map((f) => f.file).sort()).toEqual([
        "formula/evaluate.ts",
        "formula/index.ts",
        "formula/parse.ts",
        "formula/tokenize.ts",
        "formula/typecheck.ts",
        "formula/types.ts",
        "value.ts",
      ]);
      for (const { file, allowlist } of files) {
        expect(scanSource(readFileSync(`${SRC_DIR}${file}`, "utf8"), allowlist), file).toEqual([]);
      }
    },
  );

  // F-DG3-100 (round 4): a new import can never escape the guard. The closure is computed from formula/index.ts, so a
  // file the engine starts to import (directly or through another file) fails here until it is added to the scan's file
  // set and to the engine-source lint blocks (FORMULA_CLOSURE_OUTSIDE in eslint.config.js).
  it(
    "the engine's whole static import closure is in the source scan's file set and imports only decimal.js from outside",
    T10,
    () => {
      const closure = engineImportClosure();
      expect(closure.unresolved).toEqual([]);
      expect(closure.packages).toEqual(["decimal.js"]);
      expect(closure.files).toContain("value.ts"); // the closure does leave formula/: the test is not vacuous
      const scanned = new Set(scannedFiles().map((f) => f.file));
      expect(closure.files.filter((f) => !scanned.has(f))).toEqual([]);
    },
  );

  // ESLint validates rule options with ajv, which compiles each schema with new Function, so ESLint itself cannot run
  // in the no-codegen process (EvalError, "Code generation from strings disallowed"). Lint coverage is a property of
  // eslint.config.js, not of the process, so this one assertion runs in unit-node only; the closure test above runs in
  // both projects.
  it.skipIf(NOCODEGEN)(
    "every file of the engine's import closure gets the engine-source lint rules (eslint.config.js)",
    { timeout: 60_000 },
    async () => {
      const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
      const eslint = new ESLint({ cwd: repoRoot });
      const severity = (rule: unknown) => (Array.isArray(rule) ? rule[0] : rule);
      const files = engineImportClosure().files;
      expect(files.length).toBeGreaterThan(6);
      for (const file of files) {
        const config = (await eslint.calculateConfigForFile(`${SRC_DIR}${file}`)) as {
          rules: Record<string, unknown[]>;
        };
        const rules = config.rules;
        for (const r of ["no-eval", "no-implied-eval", "no-new-func"])
          expect(severity(rules[r]), `${file} ${r}`).toBe(2);
        const globals = (rules["no-restricted-globals"] ?? []).slice(1).map((g) => (g as { name: string }).name);
        for (const g of [
          "Function",
          "eval",
          "Reflect",
          "process",
          "global",
          "globalThis",
          "self",
          "window",
          "document",
        ]) {
          expect(globals, `${file} no-restricted-globals`).toContain(g);
        }
        const patterns = (rules["no-restricted-imports"] ?? [])
          .slice(1)
          .flatMap((o) => (o as { patterns?: { regex?: string }[] }).patterns ?? [])
          .map((p) => new RegExp(p.regex ?? "^$"));
        const refused = (spec: string) => patterns.some((re) => re.test(spec));
        expect(patterns.length, `${file} import allowlist`).toBeGreaterThan(0);
        for (const spec of ["node:vm", "vm", "node:module", "node:inspector", "node:fs", "zod", "@mth/shared"]) {
          expect(refused(spec), `${file} refuses ${spec}`).toBe(true);
        }
        expect(refused("decimal.js"), `${file} allows decimal.js`).toBe(false);
        if (!file.startsWith("formula/")) expect(refused("./other.ts"), `${file} refuses ./other.ts`).toBe(true);
        const selectors = (rules["no-restricted-syntax"] ?? [])
          .slice(1)
          .map((o) => (typeof o === "string" ? o : (o as { selector: string }).selector))
          .join("\n");
        for (const sel of [
          "CallExpression[callee.name='parseFloat']",
          "ImportExpression",
          "WithStatement",
          "Identifier[name='Function']",
          "MemberExpression[object.name='Reflect']",
          "MemberExpression[property.name='constructor']",
          "Literal[value='constructor']",
          "Identifier[name=/^(process|",
          "getPrototypeOf",
          "MetaProperty[meta.name='import']",
          // F-DG3-100 (round 5): the EvalError-rethrow rule and the synchronous-engine rule.
          "CatchClause:not([param.type='Identifier'][param.name='e']",
          "[body.body.0.test.right.name='EvalError']",
          "Identifier[name='EvalError']:not(BinaryExpression[operator='instanceof'] > Identifier.right)",
          "Identifier[name=/^(Promise|queueMicrotask)$/], :function[async=true], AwaitExpression",
          "MemberExpression[property.name=/^(then|catch|finally)$/]",
          // F-DG3-100 (round 6): generators, then/catch/finally in any position, fromAsync and asyncIterator.
          ":function[generator=true], YieldExpression",
          "Identifier[name=/^(then|catch|finally|fromAsync|asyncIterator)$/]",
          "Literal[value=/^(then|catch|finally|fromAsync|asyncIterator)$/]",
          "TemplateElement[value.cooked=/^(then|catch|finally|fromAsync|asyncIterator)$/]",
        ]) {
          expect(selectors, `${file} no-restricted-syntax`).toContain(sel);
        }
        expect(severity(rules["no-unsafe-finally"]), `${file} no-unsafe-finally`).toBe(2);
      }
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
    // F-DG3-100 round 2 (code-security-reviewer, guard-bypass-probe.mjs): O2 and N1-N12, verbatim minus the type casts
    // that do not change the form. N2 and N5 assemble the key at run time; the scan still refuses their carriers.
    ['(globalThis as unknown as Record<string, (s: string) => unknown>)["ev" + "al"]!("1")', "globalThis"],
    ['(globalThis as unknown as Record<string, (s: string) => unknown>)["ev" + "al"]!("1")', "string-assembled key"],
    ['const __k1 = "constructor";\n((() => 0) as R)[__k1]!("return 6*7")()', "constructor word"],
    ['((() => 0) as R)["con" + "structor"]!("return 6*7")()', "string-assembled key"],
    ['Object.getOwnPropertyDescriptor(Object.getPrototypeOf(() => 0), "constructor")!.value', "prototype reflection"],
    ['Object.getOwnPropertyDescriptor(Object.getPrototypeOf(() => 0), "constructor")!.value', "constructor word"],
    [
      'const __k4 = "constructor";\nconst { [__k4]: __C4 } = Object.getPrototypeOf(function* () {})',
      "constructor word",
    ],
    [
      'const __k5 = ["con", "structor"].join("");\n(Object.getPrototypeOf(async () => 0) as R)[__k5]!("return 6*7")()',
      "prototype reflection",
    ],
    ['const __k6 = "constructor";\n((() => 0) as R)[__k6]!`return 6*7`()', "constructor word"],
    ['declare const global: Record<string, (s: string) => unknown>;\nglobal["ev" + "al"]!("6*7")', "host global"],
    ['declare const self: Record<string, (s: string) => unknown>;\nself["ev" + "al"]!("6*7")', "host global"],
    ['process.getBuiltinModule("node:vm").runInThisContext("6*7")', "host global"],
    [
      'import { Session } from "node:inspector";\nnew Session().post("Runtime.evaluate", { expression: "6*7" })',
      "non-allowlisted import",
    ],
    ['import * as __repl from "node:repl";', "non-allowlisted import"],
    ['import.meta.resolve("node:vm")', "import.meta"],
    // The allowlist refuses any other module, not only the ones named in a denylist.
    ['import { readFileSync } from "node:fs";', "non-allowlisted import"],
    ['export * from "@mth/shared";', "non-allowlisted import"],
    ['import type { X } from "../../db/index.ts";', "non-allowlisted import"],
    ['import "./side-effect.js";', "non-allowlisted import"],
    ['import {\n  a,\n  type B,\n} from "zod";', "non-allowlisted import"],
    ['const k = "\\x63onstructor";', "escape sequence"],
    ["window.eval", "host global"],
    // F-DG3-100 round 4 (code-security-reviewer, swallow-probe.mjs): W1, W2 and W4 handle their own refused code
    // generation, so an exercised path no longer fails the no-codegen run. The helpers are verbatim; `codegen` stands for
    // the probe's generation line, which the rules here do not depend on.
    [
      "function __w(): void {\n  try {\n    codegen();\n  } catch {\n    // refused: carry on\n  }\n}",
      "catch without EvalError rethrow",
    ],
    [
      "function __w(): void {\n  try {\n    codegen();\n  } finally {\n    // no-unsafe-finally is not enabled\n    return;\n  }\n}",
      "finally with return/throw/break/continue",
    ],
    [
      "function __w(): void {\n  void Promise.resolve()\n    .then(() => {\n      codegen();\n    })\n    .catch(() => undefined);\n}",
      "Promise",
    ],
    [
      "function __w(): void {\n  void Promise.resolve()\n    .then(() => {\n      codegen();\n    })\n    .catch(() => undefined);\n}",
      ".then/.catch/.finally",
    ],
    // W5 (wrapped EvalError) stays refused at run time by the internal-failure rule; statically, it is a non-rethrowing catch.
    [
      'try {\n  codegen();\n} catch (e) {\n  throw new Error("wrapped", { cause: e });\n}',
      "catch without EvalError rethrow",
    ],
    // The other spellings the lint selector refuses.
    ["try { a(); } catch (err) { if (err instanceof EvalError) throw err; }", "catch without EvalError rethrow"],
    ["try { a(); } catch (e) { if (e instanceof EvalError) throw e; else b(); }", "catch without EvalError rethrow"],
    ["try { a(); } catch (e) { if (e instanceof EvalError) { throw e; } }", "catch without EvalError rethrow"],
    ["try { a(); } catch (e) { b(); if (e instanceof EvalError) throw e; }", "catch without EvalError rethrow"],
    ["try { a(); } catch ({ message }) { b(message); }", "catch without EvalError rethrow"],
    ["for (;;) { try { a(); } finally { break; } }", "finally with return/throw/break/continue"],
    ["try { a(); } finally { throw new RangeError(); }", "finally with return/throw/break/continue"],
    ["const EvalError = RangeError;", "EvalError outside instanceof"],
    ["async function f(): Promise<void> {}", "async"],
    ["await a();", "await"],
    ["queueMicrotask(a);", "Promise"],
    ["p.finally(a);", ".then/.catch/.finally"],
    ['p["then"](a);', ".then/.catch/.finally"],
    // F-DG3-100 round 4 X1 (closure-parser-probe.log): a string-named specifier is now followed, so it is a module import.
    ['export { "weightedScore" as zzX } from "../scoring.ts";', "non-allowlisted import"],
    ["import { 'x' as y } from 'node:vm';", "non-allowlisted import"],
    ['export * as "ns" from "../scoring.ts";', "non-allowlisted import"],
    // F-DG3-100 round 6: the reviewer's round-5 forms (rethrow-rule-attack-probe.mjs, -2.mjs), built as there.
    ...ROUND5_HANDLER_FORMS.map(([, text, what]) => [text, what] as const),
    // F1 (rethrow-rule-attack-probe-2.mjs): a "}" in a string no longer ends the finally block for the scan.
    ...F1_FORMS.map((text) => [text, "finally with return/throw/break/continue"] as const),
    // The other spellings of the round-6 rules.
    ["function* g() {}", "generator"],
    ["const g = function* () {};", "generator"],
    ["class C {\n  *g() {}\n}", "generator"],
    ["const o = { a: 1, *g() {} };", "generator"],
    ["class C {\n  static *g() {}\n}", "generator"],
    ["const o = { *[k]() {} };", "generator"],
    ["const o = { async *g() {} };", "generator"],
    ["function* g() {\n  const x = yield 1;\n}", "generator"],
    ["x = yield 1;", "generator"],
    ["const { then: t } = p;", "then"],
    ["const { then } = p;", "then"],
    ['const { ["then"]: t } = p;', "then"],
    ["const o = { then() {} };", "then"],
    ['const k = "then";', "then"],
    ["const { catch: c } = p;", "catch outside a try statement"],
    ["const { finally: f } = p;", "finally outside a try statement"],
    ["const o = { catch: 1, finally: 2 };", "catch outside a try statement"],
    ["const o = { catch: 1, finally: 2 };", "finally outside a try statement"],
    [
      "class C {\n  m() {}\n  catch(e) {\n    if (e instanceof EvalError) throw e;\n  }\n}",
      "catch outside a try statement",
    ],
    ["class C {\n  m() {}\n  finally() {}\n}", "finally outside a try statement"],
    ["const k = `catch`;", "catch outside a try statement"],
    ["void Array.fromAsync([0]);", "fromAsync/asyncIterator"],
    ["const i = o[Symbol.asyncIterator];", "fromAsync/asyncIterator"],
    ["for await (const x of xs) a(x);", "await"],
    ['const s = "unclosed;', "unbalanced braces, quotes or templates"],
    ["function f() {", "unbalanced braces, quotes or templates"],
  ];
  it.each(PROBES)("flags %s as %s", (probe, what) => {
    expect(scanSource(probe)).toContain(what);
  });

  // F-DG3-100 round 6: layer 1 refuses the same forms. ESLint lints each probe as if it were an engine source, so the
  // test proves the rule fires, not only that it is configured. unit-node only (ESLint cannot run without codegen).
  it.skipIf(NOCODEGEN)(
    "ESLint refuses the round-5 handler forms (G1, G2, A1, A2), F1 and the round-4 forms (W1, W2, W4) in an engine source",
    { timeout: 60_000 },
    async () => {
      const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
      const eslint = new ESLint({ cwd: repoRoot });
      const lint = async (text: string) => {
        const [result] = await eslint.lintText(text, { filePath: `${SRC_DIR}formula/tokenize.ts` });
        return result!.messages.filter((m) => m.severity === 2).map((m) => m.ruleId);
      };
      for (const [id, text, , rule] of ROUND5_HANDLER_FORMS) {
        expect(await lint(text), id).toContain(rule);
      }
      for (const text of F1_FORMS) expect(await lint(text), text).toContain("no-unsafe-finally");
      for (const [text] of PROBES.filter(([, what]) =>
        /^(catch|finally|\.then|Promise|generator|then|fromAsync)/.test(what),
      )) {
        // A rule refuses it (a parse error, ruleId null, does not count).
        expect((await lint(text)).filter((r) => r !== null).length, text).toBeGreaterThan(0);
      }
      // The engine's own shapes stay allowed.
      expect(
        await lint(
          "export function f(a: () => void): void {\n  try {\n    a();\n  } catch (e) {\n    if (e instanceof EvalError) throw e;\n  } finally {\n    a();\n  }\n}\n",
        ),
      ).toEqual([]);
    },
  );

  it("does not flag the engine's own names, comments or the word 'required'", () => {
    const clean = [
      "// eval, Function, vm and Reflect are forbidden here",
      "/* new Function(...) and require('vm') are banned */",
      "type FormulaFunction = string; const isFunctionName = (s: string) => s.length > 0;",
      "class FormulaError extends Error { constructor(p: string) { super(p); } }",
      "class P {\n  private readonly tokens: readonly Token[];\n  constructor(tokens: readonly Token[]) {\n    this.tokens = tokens;\n  }\n}",
      'import { Decimal } from "decimal.js";',
      'import { checkDecimal, MEASURE_COLUMN } from "../value.ts";',
      'import {\n  FORMULA_LIMITS,\n  type FormulaProblem,\n} from "./types.ts";',
      'export * from "./types.ts";',
      'export { tokenize, type Token } from "./tokenize.ts";',
      "const after = this.tokens[this.pos + 1];",
      "// the parent expression at the top level; a global constructor",
      'const note = "ISO 4217 code; required for kind currency";',
      'const url = "https://example.invalid/a"; // trailing comment with Function(',
      // F-DG3-100 (round 5): the allowed catch shape, a finally without control flow, and comments naming the banned forms.
      "try {\n  x = walk();\n} catch (e) {\n  if (e instanceof EvalError) throw e; // rethrow first\n  return null;\n}",
      "try { a(); } finally { b(); }",
      // F-DG3-100 (round 6): the full try/catch/finally shape, braces in strings, templates and regular expressions.
      "try {\n  a();\n} catch (e) {\n  if (e instanceof EvalError) throw e;\n} finally {\n  b();\n}",
      'const NAME = /^[a-z][a-z0-9_]{0,47}$/; const s = "{"; const t = `}${"{"}`; const q = a / b / c;',
      "const r = x.filter((v) => /[{}]/.test(v));",
      "// a Promise, async/await or .then(...) is banned; so is catch { } and finally { return; }",
    ].join("\n");
    expect(scanSource(clean)).toEqual([]);
  });
});
