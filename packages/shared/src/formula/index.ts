// Public API of the T09 restricted formula engine (ADR-0024 §6). Owner: kpi-benefits-engineer (T-DG3-KBE-A).
//
// The API (`kpi` module: POST /benefit-formulas/validate, versions, previews, calculations; KBE-C) and the web formula
// builder (live parse/type-check/preview; FE-C) call these same functions, so both always agree.
//
//   validateFormula(expression, variables) → { ok: true, ast, resultType, variables, checked } | { ok: false, errors }
//   evaluateFormula(expression, variables, inputs?) → { ok, result | null, resultType, errorCode?, errors, rounding, … }
//
// Problem `code`s are i18n keys; `message` is the English text the API puts in a problem `detail`.
import { Decimal } from "decimal.js";
import { formatDecimal, type DisplayLocale } from "../value.ts";
import {
  evaluateAst,
  unknownRounding,
  type CheckedFormula,
  type FormulaEvaluation,
  type FormulaInputs,
} from "./evaluate.ts";
import { parseFormula } from "./parse.ts";
import { checkVariables, typecheckFormula } from "./typecheck.ts";
import {
  ENGINE_VERSION,
  FORMULA_LIMITS,
  type FormulaAst,
  type FormulaKind,
  type FormulaProblem,
  type FormulaType,
  type FormulaVariable,
} from "./types.ts";

export * from "./types.ts";
export { tokenize, type Token, type TokenType, type TokenizeResult } from "./tokenize.ts";
export { parseFormula, RESERVED_WORDS, type ParseResult } from "./parse.ts";
export { checkVariables, typecheckFormula, type TypeCheckResult, type VariableCheck } from "./typecheck.ts";
export {
  evaluateAst,
  FORMULA_DECIMAL,
  RESULT_COLUMN,
  type CheckedFormula,
  type FormulaEvaluation,
  type FormulaInputs,
  type FormulaRounding,
} from "./evaluate.ts";

export type FormulaValidation =
  | {
      readonly ok: true;
      readonly ast: FormulaAst;
      readonly resultType: FormulaType;
      /** Distinct variable names referenced, in order of first appearance. */
      readonly variables: readonly string[];
      /** Pass to evaluateAst to evaluate without re-parsing. */
      readonly checked: CheckedFormula;
      readonly engineVersion: typeof ENGINE_VERSION;
    }
  | { readonly ok: false; readonly errors: readonly FormulaProblem[]; readonly engineVersion: typeof ENGINE_VERSION };

/**
 * Parses and type-checks an expression against its typed variables (ADR-0024 §6). Never runs code, and never throws
 * except EvalError (a refused code generation, which cannot occur; see internalProblem):
 * a syntax error or limit is `formula.syntax` with an offset; type-rule violations carry their ADR codes.
 */
export function validateFormula(
  expression: unknown,
  variables: readonly FormulaVariable[] | unknown,
): FormulaValidation {
  try {
    const parsed = parseFormula(expression);
    if (!parsed.ok) return { ok: false, errors: [parsed.error], engineVersion: ENGINE_VERSION };
    const { ast } = parsed;
    if (ast.variables.length > FORMULA_LIMITS.maxVariables) {
      return {
        ok: false,
        errors: [
          {
            code: "formula.syntax",
            message: `Syntax error at offset 0: the formula uses more than ${FORMULA_LIMITS.maxVariables} variables`,
            offset: 0,
            params: { offset: "0", reason: "too_many_variables", limit: String(FORMULA_LIMITS.maxVariables) },
          },
        ],
        engineVersion: ENGINE_VERSION,
      };
    }
    const vars = checkVariables(variables);
    if (!vars.ok) return { ok: false, errors: vars.errors, engineVersion: ENGINE_VERSION };
    const typed = typecheckFormula(ast, vars.variables);
    if (!typed.ok) return { ok: false, errors: typed.errors, engineVersion: ENGINE_VERSION };
    return {
      ok: true,
      ast,
      resultType: typed.resultType,
      variables: ast.variables,
      checked: Object.freeze({
        ast,
        resultType: typed.resultType,
        variables: vars.variables,
        conversions: typed.conversions,
      }),
      engineVersion: ENGINE_VERSION,
    };
  } catch (e) {
    if (e instanceof EvalError) throw e; // ADR-0024 §6: a refused code generation is never a formula problem
    return { ok: false, errors: [internalProblem(e)], engineVersion: ENGINE_VERSION };
  }
}

/**
 * Validates, then evaluates (ADR-0024 §6 "Evaluation"). Values come from `variables[].value`, overridden by `inputs`.
 * An invalid formula returns `ok: false`, `resultType: null` and the validation errors. Division by zero and missing
 * inputs return `result: null` (Unknown) with `errorCode`; a result outside numeric(24,6) is
 * `formula.result_out_of_range`. `rounding` records the single storage rounding to numeric(24,6).
 */
export function evaluateFormula(
  expression: unknown,
  variables: readonly FormulaVariable[] | unknown,
  inputs: FormulaInputs = {},
): FormulaEvaluation {
  const v = validateFormula(expression, variables);
  if (!v.ok) {
    return {
      ok: false,
      result: null,
      resultType: null,
      errorCode: v.errors[0]!.code,
      errors: v.errors,
      rounding: unknownRounding(),
      inputs: Object.freeze({}),
      engineVersion: ENGINE_VERSION,
    };
  }
  try {
    return evaluateAst(v.checked, typeof inputs === "object" && inputs !== null ? inputs : {});
  } catch (e) {
    if (e instanceof EvalError) throw e; // ADR-0024 §6: see internalProblem
    const problem = internalProblem(e);
    return {
      ok: false,
      result: null,
      resultType: v.resultType,
      errorCode: problem.code,
      errors: [problem],
      rounding: unknownRounding(),
      inputs: Object.freeze({}),
      engineVersion: ENGINE_VERSION,
    };
  }
}

/**
 * A defect inside the engine is reported as a problem (never an uncaught exception, never a value): the API answers 422
 * `formula.syntax` with `reason: "internal"`, never 500.
 *
 * The one exception is EvalError (ADR-0024 §6 "No dynamic code", F-DG3-100 round 4). The host throws it when code is
 * generated from a string and code generation is refused: Node under --disallow-code-generation-from-strings, a
 * browser under a CSP without 'unsafe-eval'. The engine never generates code, so in production it cannot occur; if it
 * ever did, the engine would have broken its "never runs code" guarantee. Every catch in the engine's import closure
 * (here, in evaluateAst, in parseFormula and in ../value.ts formatDecimal) therefore RETHROWS EvalError as its first
 * statement instead of converting it (enforced by lint and the source scan since round 5), so an exercised
 * code-generating path fails every test that reaches it in the unit-formula-nocodegen project, whatever that test
 * asserts. Reporting it as a user's syntax error at offset 0 would hide a security defect.
 */
function internalProblem(e: unknown): FormulaProblem {
  const detail = e instanceof Error ? e.name : "error";
  return {
    code: "formula.syntax",
    message: `Syntax error at offset 0: the formula could not be processed (${detail})`,
    offset: 0,
    params: { offset: "0", reason: "internal", detail },
  };
}

// ------------------------------------------------------------------------------------------------ display

const DD = Decimal.clone({ precision: 80, rounding: Decimal.ROUND_HALF_UP, toExpNeg: -80, toExpPos: 80 });

export interface FormulaDisplayOptions {
  readonly locale?: DisplayLocale;
  readonly digits?: "latn" | "arab";
  /** Display rounding (half-up); defaults to 2. Stored values are never rounded here. */
  readonly maxFractionDigits?: number;
  readonly currency?: string | null;
  readonly unit?: string | null;
}

/** Suffix codes for fraction-like kinds; the web may translate them, the defaults below are the en/ar texts. */
export const PERCENT_SUFFIX = Object.freeze({
  percent: { en: "%", ar: "٪" },
  percentage_points: { en: "pp", ar: "نقطة مئوية" },
});

/**
 * The number a fraction-like value shows (ADR-0024 §6 table): fraction 0.12 → "12" (%), fraction_delta 0.02 → "2"
 * (percentage points), percent_change −0.10 → "-10" (%). Other kinds are returned unchanged. null stays null.
 */
export function displayNumber(
  value: string | null,
  kind: FormulaKind,
): { value: string; suffix: "percent" | "percentage_points" | null } | null {
  if (value === null || !/^-?[0-9]+(\.[0-9]+)?$/.test(value)) return null;
  const d = new DD(value);
  if (kind === "fraction" || kind === "percent_change") {
    const v = d.times(100);
    return { value: v.isZero() ? "0" : v.toFixed(), suffix: "percent" };
  }
  if (kind === "fraction_delta") {
    const v = d.times(100);
    return { value: v.isZero() ? "0" : v.toFixed(), suffix: "percentage_points" };
  }
  return { value: d.isZero() ? "0" : d.toFixed(), suffix: null };
}

/**
 * Formats a formula value for display by kind: fraction "12%", fraction_delta "2 pp" (percentage points, never "2%"),
 * percent_change "-10%", currency "SAR 100,000.00", count/quantity with the unit, number plain. null → null: the caller
 * shows "Unknown", never 0.
 */
export function formatFormulaValue(
  value: string | null,
  kind: FormulaKind,
  options: FormulaDisplayOptions = {},
): string | null {
  const n = displayNumber(value, kind);
  if (n === null) return null;
  const locale = options.locale ?? "en";
  const digits = options.digits ? { digits: options.digits } : {};
  if (kind === "currency") {
    return formatDecimal(n.value, {
      locale,
      currency: options.currency ?? null,
      minFractionDigits: 2,
      maxFractionDigits: options.maxFractionDigits ?? 2,
      ...digits,
    });
  }
  const text = formatDecimal(n.value, { locale, maxFractionDigits: options.maxFractionDigits ?? 2, ...digits });
  if (text === null) return null;
  if (n.suffix === "percent") return `${text}${PERCENT_SUFFIX.percent[locale]}`;
  if (n.suffix === "percentage_points") return `${text} ${PERCENT_SUFFIX.percentage_points[locale]}`;
  return options.unit ? `${text} ${options.unit}` : text;
}
