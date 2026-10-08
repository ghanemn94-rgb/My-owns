// code-security-reviewer DG3 round-1 probe C (T-DG3-REV-SEC-R1). NOT product code; runs only in a disposable clone,
// copied to packages/shared/src/formula/zz-sec-r1-fuzz.test.ts (unit-node project).
// Hostile-input and correctness probe of the T09 formula engine (ADR-0024 §6):
//  C1 injection strings (JS code, prototype names, template literals, unicode look-alikes) never evaluate and never throw;
//  C2 limits under hostile size: 1e5-deep parentheses, 1e6-char input, 10k-term sums, 25-digit literals, 31 variables;
//  C3 division by zero anywhere in the tree -> result null (Unknown), never 0 / Infinity / NaN;
//  C4 random-input fuzz (20k strings over the token alphabet + raw bytes): never throws, every call < 250 ms;
//  C5 an independent exact oracle (BigInt rationals) for random + - * / trees: the stored result equals the oracle
//     rounded half-up to 6 decimals, and `rounded`/`exact` are consistent;
//  C6 inputs object hostile keys (__proto__, constructor, toString) cannot inject a value for an undeclared variable.
import { describe, expect, it } from "vitest";
import { evaluateFormula, validateFormula, FORMULA_LIMITS, type FormulaVariable } from "./index.ts";

const num = (name: string, value: string | null = "1"): FormulaVariable => ({ name, kind: "number", period: "none", value });

function timed<T>(f: () => T): { v: T; ms: number } {
  const t = performance.now();
  const v = f();
  return { v, ms: performance.now() - t };
}

describe("C1 injection strings", () => {
  const hostile = [
    "constructor.constructor('return process')()",
    "__proto__",
    "a.constructor",
    "`${process.exit(1)}`",
    "this",
    "globalThis",
    "process.exit(1)",
    "require('fs')",
    "import('fs')",
    "1;process.exit(1)",
    "eval('1')",
    "Function('return 1')()",
    "a[0]",
    "a = 1",
    "a == 1",
    "1 ** 2",
    "1 % 2",
    "1e400",
    "0x10",
    "١٢٣", // Arabic-Indic digits
    "１２３", // full-width digits
    "a\u0000b",
    "a‮b",
    "toString",
    "valueOf",
    "hasOwnProperty",
    "min",
    "to_period(a)",
    "to_period(a, decade)",
    "max()",
    "abs(a, a)",
    "-".repeat(5000) + "1",
    "((((((((((1",
    "1)))))",
    "'1'",
    '"1"',
    "1 /* c */ + 1",
    "1 // c",
    "NaN",
    "Infinity",
    "-0",
  ];
  it.each(hostile)("%s: never throws; nothing outside the grammar evaluates", (expr) => {
    const vars = [num("a", "5")];
    const { v, ms } = timed(() => evaluateFormula(expr, vars));
    console.log(`[probe-C1] ${JSON.stringify(expr.slice(0, 60))} -> ok=${v.ok} result=${v.result} code=${v.errorCode ?? ""} ${ms.toFixed(1)}ms`);
    expect(ms).toBeLessThan(250);
    if (v.result !== null) {
      // The only things that may evaluate are grammar-valid numeric expressions.
      expect(v.result).toMatch(/^-?[0-9]+(\.[0-9]+)?$/);
    }
  });
  it("identifiers that are Object.prototype names are just undeclared variables", () => {
    for (const n of ["constructor", "__proto__", "toString", "valueOf", "hasOwnProperty", "prototype"]) {
      const v = evaluateFormula(`${n} + 1`, []);
      expect([v.ok, v.result]).toEqual([false, null]);
    }
  });
});

describe("C2 limits under hostile size", () => {
  const cases: [string, string][] = [
    ["1e5 nested parentheses", "(".repeat(100_000) + "1" + ")".repeat(100_000)],
    ["1e6 characters", "1+".repeat(500_000) + "1"],
    ["10k-term sum", Array.from({ length: 10_000 }, () => "1").join("+")],
    ["deep unary", "-".repeat(100_000) + "1"],
    ["25-digit literal", "1234567890123456789012345 + 1"],
    ["deep right-nested", Array.from({ length: 5000 }, () => "(1+").join("") + "1" + ")".repeat(5000)],
    ["deep calls", "abs(".repeat(10_000) + "1" + ")".repeat(10_000)],
    // Inside the 2000-character limit, so the depth and node limits (not the length) must refuse them.
    ["900 nested parentheses (1801 chars)", "(".repeat(900) + "1" + ")".repeat(900)],
    ["40 nested abs() (201 chars)", "abs(".repeat(40) + "1" + ")".repeat(40)],
    ["150-term sum (301 nodes, 299 chars)", Array.from({ length: 150 }, () => "1").join("+")],
    ["33-deep unary", "-".repeat(33) + "1"],
  ];
  it.each(cases)("%s: refused as formula.syntax, no throw, < 250 ms", (_n, expr) => {
    const { v, ms } = timed(() => evaluateFormula(expr, []));
    console.log(`[probe-C2] ${_n}: ok=${v.ok} code=${v.errorCode} reason=${v.errors[0]?.params["reason"]} ${ms.toFixed(1)}ms`);
    expect(v.ok).toBe(false);
    expect(v.errorCode).toBe("formula.syntax");
    expect(ms).toBeLessThan(250);
  });
  it("31 distinct variables is refused (maxVariables 30); 30 is accepted", () => {
    const names = Array.from({ length: 31 }, (_, i) => `v${i}`);
    const vars = names.map((n) => num(n));
    expect(evaluateFormula(names.join("+"), vars).ok).toBe(false);
    expect(evaluateFormula(names.slice(0, 30).join("+"), vars.slice(0, 30)).result).toBe("30");
    expect(FORMULA_LIMITS.maxVariables).toBe(30);
  });
  it("worst-case growth inside the limits stays fast (199 nodes of 24-digit products)", () => {
    const vars = [num("a", "999999999999999999.999999")];
    const expr = Array.from({ length: 100 }, () => "a").join("*");
    const { v, ms } = timed(() => evaluateFormula(expr, vars));
    console.log(`[probe-C2] product of 100 x 24-digit: ok=${v.ok} code=${v.errorCode} ${ms.toFixed(1)}ms`);
    expect(v.result).toBeNull();
    expect(v.errorCode).toBe("formula.result_out_of_range");
    expect(ms).toBeLessThan(250);
    const div = Array.from({ length: 100 }, () => "a").join("/");
    const d = timed(() => evaluateFormula(div, [num("a", "3.000001")]));
    console.log(`[probe-C2] chain of 99 divisions: ok=${d.v.ok} result=${d.v.result} inexact=${d.v.rounding.inexactIntermediate} ${d.ms.toFixed(1)}ms`);
    expect(d.ms).toBeLessThan(250);
  });
});

describe("C3 division by zero is Unknown", () => {
  const exprs = ["a / z", "(a + 1) / (z * 5)", "abs(a / (a - a))", "min(1, a / z) + 2", "1 / (0)", "1 / 0.000000", "0 / 0"];
  it.each(exprs)("%s -> null, formula.division_by_zero", (e) => {
    const v = evaluateFormula(e, [num("a", "7"), num("z", "0")]);
    expect([v.result, v.errorCode]).toEqual([null, "formula.division_by_zero"]);
  });
});

// ---------------------------------------------------------------- C4 / C5
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe("C4 random fuzz never throws and stays fast", () => {
  it("20000 random strings", () => {
    const r = rng(20261008);
    const atoms = ["a", "b", "1", "0", ".", "5", "+", "-", "*", "/", "×", "÷", "(", ")", ",", " ", "min", "max", "abs", "to_period", "year", "month", "e", "__proto__", "\u0000", "\uD800", "😀"];
    let slowest = 0;
    let evaluated = 0;
    for (let i = 0; i < 20_000; i++) {
      let s = "";
      const len = 1 + Math.floor(r() * 40);
      for (let j = 0; j < len; j++) s += r() < 0.1 ? String.fromCharCode(Math.floor(r() * 0x10000)) : atoms[Math.floor(r() * atoms.length)];
      const t = performance.now();
      let v;
      try {
        v = evaluateFormula(s, [num("a", "3"), num("b", "0")]);
      } catch (e) {
        throw new Error(`threw on ${JSON.stringify(s)}: ${String(e)}`);
      }
      slowest = Math.max(slowest, performance.now() - t);
      if (v.result !== null) {
        evaluated++;
        expect(v.result).toMatch(/^-?[0-9]+(\.[0-9]+)?$/);
      }
    }
    console.log(`[probe-C4] 20000 strings, ${evaluated} evaluated to a value, slowest ${slowest.toFixed(1)}ms`);
    expect(slowest).toBeLessThan(250);
  });
});

// Exact rationals with BigInt.
type Q = { n: bigint; d: bigint };
const gcd = (a: bigint, b: bigint): bigint => {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b) [a, b] = [b, a % b];
  return a;
};
const q = (n: bigint, d: bigint): Q => {
  if (d < 0n) [n, d] = [-n, -d];
  const g = gcd(n, d) || 1n;
  return { n: n / g, d: d / g };
};
const parseQ = (s: string): Q => {
  const neg = s.startsWith("-");
  const [i, f = ""] = s.replace("-", "").split(".");
  const v = q(BigInt(i + f), 10n ** BigInt(f.length));
  return neg ? q(-v.n, v.d) : v;
};
/** Round half-up (away from zero on .5, like decimal.js ROUND_HALF_UP) to 6 decimals, as a fixed string. */
function round6(x: Q): string {
  const scaled = x.n * 10n ** 6n;
  const neg = scaled < 0n;
  const a = neg ? -scaled : scaled;
  let int = a / x.d;
  const rem = a % x.d;
  if (rem * 2n >= x.d) int += 1n;
  const s = int.toString().padStart(7, "0");
  const out = `${s.slice(0, -6)}.${s.slice(-6)}`;
  return (neg && int !== 0n ? "-" : "") + out;
}

describe("C5 exact oracle for random arithmetic trees", () => {
  it("3000 random trees: stored result = oracle rounded half-up to 6 dp", () => {
    const r = rng(42);
    const lit = () => {
      const i = Math.floor(r() * 100000);
      const f = Math.floor(r() * 1000);
      return r() < 0.5 ? `${i}` : `${i}.${String(f).padStart(3, "0")}`;
    };
    let checked = 0;
    let unknown = 0;
    let roundedCount = 0;
    for (let k = 0; k < 3000; k++) {
      const build = (depth: number): { s: string; v: Q | null } => {
        if (depth === 0 || r() < 0.3) {
          const l = lit();
          return { s: l, v: parseQ(l) };
        }
        const op = ["+", "-", "*", "/"][Math.floor(r() * 4)]!;
        const a = build(depth - 1);
        const b = build(depth - 1);
        let v: Q | null = null;
        if (a.v && b.v) {
          if (op === "+") v = q(a.v.n * b.v.d + b.v.n * a.v.d, a.v.d * b.v.d);
          if (op === "-") v = q(a.v.n * b.v.d - b.v.n * a.v.d, a.v.d * b.v.d);
          if (op === "*") v = q(a.v.n * b.v.n, a.v.d * b.v.d);
          if (op === "/") v = b.v.n === 0n ? null : q(a.v.n * b.v.d, a.v.d * b.v.n);
        }
        return { s: `(${a.s} ${op} ${b.s})`, v };
      };
      const t = build(4);
      const ev = evaluateFormula(t.s, []);
      if (t.v === null) {
        expect(ev.result, t.s).toBeNull();
        unknown++;
        continue;
      }
      const absQ = t.v.n < 0n ? -t.v.n : t.v.n;
      if (absQ / t.v.d >= 10n ** 18n) {
        expect(ev.errorCode, t.s).toBe("formula.result_out_of_range");
        continue;
      }
      const want = round6(t.v);
      expect(ev.rounding.stored, t.s).toBe(want === "-0.000000" ? "0.000000" : want);
      const exactIs6 = (t.v.d === 1n || (10n ** 6n) % t.v.d === 0n);
      if (ev.rounding.rounded) roundedCount++;
      if (exactIs6) expect(ev.rounding.rounded, t.s).toBe(false);
      checked++;
    }
    console.log(`[probe-C5] oracle-checked ${checked}, unknown (div by 0) ${unknown}, rounded ${roundedCount}`);
    expect(checked).toBeGreaterThan(2000);
  });
});

describe("C6 hostile inputs objects", () => {
  it("an inputs object with __proto__/constructor keys cannot satisfy an undeclared or missing variable", () => {
    const inputs = JSON.parse('{"__proto__": {"a": "999"}, "constructor": "5"}') as Record<string, string>;
    const v = evaluateFormula("a + 1", [num("a", null)], inputs);
    expect([v.result, v.errorCode]).toEqual([null, "formula.missing_input"]);
    const w = validateFormula("constructor + 1", [num("a")]);
    expect(w.ok).toBe(false);
  });
});
