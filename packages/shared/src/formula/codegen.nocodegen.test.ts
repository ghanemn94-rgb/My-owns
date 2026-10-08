// Canary of the ADR-0024 §6 run-time guard (F-DG3-100). This file runs ONLY in the Vitest project
// `unit-formula-nocodegen` (vitest.config.ts), whose forked Node processes start with
// --disallow-code-generation-from-strings. It proves the flag is active in the very process that runs the formula
// engine's tests, so the spelling-independent guard cannot silently disappear (a config edit dropping execArgv, a pool
// change or a Vitest upgrade that ignores execArgv makes these tests fail). Each attempt below would return 1 in a
// normal process; here every one must throw EvalError before any code runs.
import { describe, expect, it } from "vitest";
import { formatDecimal } from "../value.ts";
import { evaluateAst, evaluateFormula, validateFormula, type CheckedFormula } from "./index.ts";

describe("no-codegen canary: string code generation is disabled in this process", () => {
  it("the process was started with --disallow-code-generation-from-strings", () => {
    expect(process.execArgv).toContain("--disallow-code-generation-from-strings");
  });

  it('new Function("return 1") throws EvalError', () => {
    // eslint-disable-next-line no-new-func, no-restricted-globals, no-restricted-syntax -- canary: must throw EvalError under the flag; never runs code
    expect(() => new Function("return 1")).toThrow(EvalError);
  });

  it('eval("1") throws EvalError (direct and indirect)', () => {
    // eslint-disable-next-line no-eval, no-restricted-globals -- canary: must throw EvalError under the flag; never runs code
    expect(() => eval("1")).toThrow(EvalError);
    // eslint-disable-next-line no-eval, no-restricted-globals -- canary: indirect eval, must throw EvalError under the flag
    const indirect = eval;
    expect(() => indirect("1")).toThrow(EvalError);
  });

  it("the AsyncFunction constructor reached through Object.getPrototypeOf(async () => {}).constructor throws EvalError", async () => {
    // eslint-disable-next-line no-restricted-syntax -- canary: reaches the AsyncFunction constructor without its name, as the F-DG3-100 forms do
    const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (
      body: string,
    ) => () => Promise<unknown>;
    expect(() => new AsyncFunction("return 1")).toThrow(EvalError);
  });

  it("a key assembled at run time does not help: the GeneratorFunction constructor still throws EvalError", () => {
    const key = ["con", "struc", "tor"].join("");
    const proto = Object.getPrototypeOf(function* () {}) as Record<string, (body: string) => unknown>;
    expect(() => proto[key]!("yield 1")).toThrow(EvalError);
  });

  it("the engine itself still evaluates in this process (it never generates code)", () => {
    const r = evaluateFormula("a * b", [
      { name: "a", kind: "number", period: "none", value: "6" },
      { name: "b", kind: "number", period: "none", value: "7" },
    ]);
    expect(r.ok).toBe(true);
    expect(r.result).toBe("42");
  });
});

// F-DG3-100 (round 4) regression. An engine path that generates code from a string, and that a test exercises, must FAIL
// here. Round 3 showed the engine's own catch-all turning the EvalError into an ordinary formula.syntax "internal"
// problem, which the tests accepted. Each case below runs a real code generation (the GeneratorFunction constructor,
// reached by a key assembled at run time, as in the reviewer's S1/S3 forms) INSIDE one of the engine's catches, through
// the public entry points, and requires the EvalError to come out. Before round 4 every one of them returned a problem
// (or null) instead.
describe("no-codegen regression: an exercised code generation inside the engine surfaces as EvalError", () => {
  /** Generates code from a string: throws EvalError in this process, before any code runs. */
  const generateCode = (): never => {
    const key = ["con", "struc", "tor"].join("");
    const proto = Object.getPrototypeOf(function* () {}) as Record<string, (body: string) => unknown>;
    proto[key]!("yield 1");
    throw new Error("unreachable: code generation was not refused");
  };

  it("validateFormula (parse/type-check catch): code generated while the variables are read", () => {
    const variables = [
      Object.defineProperty({ kind: "number", period: "none", value: "1" }, "name", {
        enumerable: true,
        get: generateCode,
      }),
    ];
    expect(() => validateFormula("a", variables)).toThrow(EvalError);
  });

  it("evaluateFormula (evaluation catch): code generated while an input is read", () => {
    const inputs = Object.defineProperty({}, "a", { enumerable: true, get: generateCode });
    expect(() =>
      evaluateFormula(
        "a",
        [{ name: "a", kind: "number", period: "none", value: "1" }],
        inputs as Record<string, string>,
      ),
    ).toThrow(EvalError);
  });

  it("evaluateAst (tree-walk catch): code generated while a node is walked", () => {
    const v = validateFormula("1", []);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    const root = Object.defineProperty({ type: "number", start: 0, end: 1 }, "value", { get: generateCode });
    const checked = { ...v.checked, ast: { ...v.checked.ast, root } as CheckedFormula["ast"] };
    expect(() => evaluateAst(checked)).toThrow(EvalError);
  });

  it("../value.ts formatDecimal (the engine's one import outside formula/): code generated while a value is read", () => {
    const value = { toString: generateCode } as unknown as string;
    expect(() => formatDecimal(value, { locale: "en" })).toThrow(EvalError);
  });
});
