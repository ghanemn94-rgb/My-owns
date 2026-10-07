// AST evaluator of the T09 formula language (ADR-0024 §6 "Evaluation"). Owner: kpi-benefits-engineer.
//
//  - decimal.js only, through a clone with precision 80 and ROUND_HALF_UP; no JavaScript number ever holds a value.
//  - + − × are exact within 80 significant digits. Every operation is re-checked against an unbounded-precision
//    computation; if precision 80 ever had to round an intermediate (or a division / inverse period conversion is
//    inexact), `rounding.inexactIntermediate` is true, so the lineage never claims an exact result it does not have.
//  - The result is rounded ONCE, at storage, to numeric(24,6) with ROUND_HALF_UP, and the rounding is reported.
//  - Division by zero → formula.division_by_zero, result Unknown (null): never 0, never Infinity.
//  - A referenced variable without a value → formula.missing_input, result Unknown (null). Never 0.
//  - A result outside numeric(24,6) (more than 18 integer digits) → formula.result_out_of_range, result null.
import { Decimal } from "decimal.js";
import { checkDecimal, MEASURE_COLUMN } from "../value.ts";
import {
  ENGINE_VERSION,
  type CallNode,
  type ExprNode,
  type FormulaAst,
  type FormulaErrorCode,
  type FormulaProblem,
  type FormulaType,
  type FormulaVariable,
  type PeriodName,
} from "./types.ts";

/** The evaluation clone (ADR-0024 §6). */
export const FORMULA_DECIMAL = Decimal.clone({
  precision: 80,
  rounding: Decimal.ROUND_HALF_UP,
  toExpNeg: -9_000_000_000_000_000,
  toExpPos: 9_000_000_000_000_000,
});
type Dec = InstanceType<typeof FORMULA_DECIMAL>;
/** Exactness oracle: the same operations without a practical precision bound (operand sizes are capped by limits). */
const EXACT = Decimal.clone({ precision: 1_000_000_000, rounding: Decimal.ROUND_HALF_UP });

/** Storage column of a formula result. */
export const RESULT_COLUMN = Object.freeze({ name: "numeric(24,6)" as const, precision: 24, scale: 6 });

export interface FormulaRounding {
  readonly column: "numeric(24,6)";
  readonly scale: 6;
  readonly mode: "ROUND_HALF_UP";
  readonly precision: 80;
  /** The value before storage rounding (plain notation), or null when Unknown. */
  readonly exact: string | null;
  /** The stored value with exactly 6 fraction digits ("100000.000000"), or null when Unknown. */
  readonly stored: string | null;
  /** True when storage rounding changed the value. */
  readonly rounded: boolean;
  /** True when precision 80 rounded an intermediate (a division or inverse period conversion that is not exact). */
  readonly inexactIntermediate: boolean;
}

export interface FormulaEvaluation {
  /** True when a result was computed (it may still be Unknown: see `result`). */
  readonly ok: boolean;
  /** The stored value in canonical form ("100000", "0.333333"), or null = Unknown. Never "0" for Unknown. */
  readonly result: string | null;
  readonly resultType: FormulaType | null;
  /** The first problem's code when the result is Unknown or the formula is invalid. */
  readonly errorCode?: FormulaErrorCode;
  readonly errors: readonly FormulaProblem[];
  readonly rounding: FormulaRounding;
  /** The input values actually used, by variable name (lineage `inputs`). */
  readonly inputs: Readonly<Record<string, string | null>>;
  readonly engineVersion: typeof ENGINE_VERSION;
}

export type FormulaInputs = Readonly<Record<string, string | null | undefined>>;

const PERIOD_MONTHS: Readonly<Record<PeriodName, number>> = { month: 1, quarter: 3, year: 12 };

/** A parsed and type-checked formula: what evaluateAst needs (validateFormula returns it). */
export interface CheckedFormula {
  readonly ast: FormulaAst;
  readonly resultType: FormulaType;
  readonly variables: ReadonlyMap<string, FormulaVariable>;
  readonly conversions: ReadonlyMap<CallNode, PeriodName>;
}

/** Defensive: an AST that did not come from validateFormula. Reported, never thrown. */
function internal(detail: string): FormulaProblem {
  return {
    code: "formula.syntax",
    message: `Syntax error at offset 0: ${detail}`,
    offset: 0,
    params: { reason: "internal", detail },
  };
}

class EvalFailure {
  readonly problem: FormulaProblem;
  constructor(problem: FormulaProblem) {
    this.problem = problem;
  }
}

export function unknownRounding(inexact = false): FormulaRounding {
  return {
    column: "numeric(24,6)",
    scale: 6,
    mode: "ROUND_HALF_UP",
    precision: 80,
    exact: null,
    stored: null,
    rounded: false,
    inexactIntermediate: inexact,
  };
}

const plain = (d: Dec): string => (d.isZero() ? "0" : d.toFixed());

/**
 * Evaluates a checked formula (from validateFormula). `inputs` (own properties only) override the declared values.
 * Never throws: every failure is a problem with a null (Unknown) result.
 */
export function evaluateAst(checked: CheckedFormula, inputs: FormulaInputs = {}): FormulaEvaluation {
  const { ast, resultType, variables, conversions } = checked;
  const chars = Array.from(ast.source);
  const label = (n: ExprNode): string => (n.type === "variable" ? n.name : chars.slice(n.start, n.end).join(""));

  // 1. Resolve every referenced value; list all missing ones at once.
  const values = new Map<string, Dec>();
  const used: Record<string, string | null> = Object.create(null) as Record<string, string | null>;
  const missing: string[] = [];
  const invalid: FormulaProblem[] = [];
  for (const name of ast.variables) {
    const declared = variables.get(name);
    const raw: unknown = Object.prototype.hasOwnProperty.call(inputs, name) ? inputs[name] : declared?.value;
    if (raw === null || raw === undefined) {
      used[name] = null;
      missing.push(name);
      continue;
    }
    if (!checkDecimal(raw, MEASURE_COLUMN).ok) {
      invalid.push({
        code: "formula.invalid_variable",
        message: `Invalid variable ${name}: a value is a decimal string that fits numeric(24,6)`,
        params: { name, reason: "value", detail: "a value is a decimal string that fits numeric(24,6)" },
      });
      continue;
    }
    used[name] = raw as string;
    values.set(name, new FORMULA_DECIMAL(raw as string));
  }
  const frozenInputs = Object.freeze({ ...used });
  const fail = (problems: FormulaProblem[], inexact = false): FormulaEvaluation => ({
    ok: false,
    result: null,
    resultType,
    errorCode: problems[0]!.code,
    errors: problems,
    rounding: unknownRounding(inexact),
    inputs: frozenInputs,
    engineVersion: ENGINE_VERSION,
  });
  if (invalid.length > 0) return fail(invalid);
  if (missing.length > 0) {
    const names = missing.join(", ");
    return fail([
      {
        code: "formula.missing_input",
        message: `Missing input: ${names}; the result is Unknown`,
        params: { names },
      },
    ]);
  }

  // 2. Walk the tree.
  let inexact = false;
  const exactCheck = (approx: Dec, exact: InstanceType<typeof EXACT>) => {
    if (!exact.eq(approx.toString())) inexact = true;
  };
  const asExact = (d: Dec) => new EXACT(d.toString());

  const walk = (node: ExprNode): Dec => {
    switch (node.type) {
      case "number":
        return new FORMULA_DECIMAL(node.value);
      case "variable":
        return values.get(node.name)!;
      case "unary":
        return walk(node.operand).neg();
      case "binary": {
        const a = walk(node.left);
        const b = walk(node.right);
        switch (node.op) {
          case "+": {
            const r = a.plus(b);
            exactCheck(r, asExact(a).plus(asExact(b)));
            return r;
          }
          case "-": {
            const r = a.minus(b);
            exactCheck(r, asExact(a).minus(asExact(b)));
            return r;
          }
          case "*": {
            const r = a.times(b);
            exactCheck(r, asExact(a).times(asExact(b)));
            return r;
          }
          case "/": {
            if (b.isZero()) {
              throw new EvalFailure({
                code: "formula.division_by_zero",
                message: `Division by zero: ${label(node.right)} is 0; the result is Unknown`,
                offset: node.start,
                params: { offset: String(node.start), divisor: label(node.right) },
              });
            }
            const r = a.div(b);
            // Exact iff quotient × divisor gives the dividend back with unbounded precision.
            if (!asExact(r).times(asExact(b)).eq(asExact(a))) inexact = true;
            return r;
          }
        }
        break;
      }
      case "call": {
        if (node.fn === "to_period") {
          const x = walk(node.args[0] as ExprNode);
          const target = node.args[1];
          const from = conversions.get(node);
          if (!target || target.type !== "period" || from === undefined) {
            throw new EvalFailure(internal("to_period without a type-checked source period"));
          }
          const f = PERIOD_MONTHS[from];
          const t = PERIOD_MONTHS[target.period];
          if (t >= f) return x.times(t / f); // month→year ×12, quarter→year ×4, month→quarter ×3 (small integers)
          const r = x.div(f / t); // inverse: year→month ÷12, year→quarter ÷4, quarter→month ÷3
          if (
            !asExact(r)
              .times(f / t)
              .eq(asExact(x))
          )
            inexact = true;
          return r;
        }
        const args = (node.args as readonly ExprNode[]).map(walk);
        if (node.fn === "abs") return args[0]!.abs();
        let best = args[0]!;
        for (const v of args.slice(1)) {
          if (node.fn === "min" ? v.lt(best) : v.gt(best)) best = v;
        }
        return best;
      }
    }
    throw new EvalFailure(internal("unsupported node"));
  };

  let exactValue: Dec;
  try {
    exactValue = walk(ast.root);
  } catch (e) {
    if (e instanceof EvalFailure) return fail([e.problem], inexact);
    return fail([internal(e instanceof Error ? e.name : "error")], inexact);
  }

  // 3. Round once, at storage, to numeric(24,6).
  const stored = exactValue.toDecimalPlaces(RESULT_COLUMN.scale, FORMULA_DECIMAL.ROUND_HALF_UP);
  if (stored.abs().gte(new FORMULA_DECIMAL(10).pow(RESULT_COLUMN.precision - RESULT_COLUMN.scale))) {
    const shown = exactValue.toSignificantDigits(12).toExponential();
    return fail(
      [
        {
          code: "formula.result_out_of_range",
          message: `Result out of range: ${shown} does not fit numeric(24,6)`,
          params: { value: shown, column: "numeric(24,6)" },
        },
      ],
      inexact,
    );
  }
  return {
    ok: true,
    result: plain(stored),
    resultType,
    errors: [],
    rounding: {
      column: "numeric(24,6)",
      scale: 6,
      mode: "ROUND_HALF_UP",
      precision: 80,
      exact: plain(exactValue),
      stored: stored.isZero() ? "0.000000" : stored.toFixed(RESULT_COLUMN.scale),
      rounded: !stored.eq(exactValue),
      inexactIntermediate: inexact,
    },
    inputs: frozenInputs,
    engineVersion: ENGINE_VERSION,
  };
}
