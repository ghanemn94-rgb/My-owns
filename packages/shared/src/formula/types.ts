// Shared types of the T09 restricted formula engine (ADR-0024 §6). Owner: kpi-benefits-engineer (T-DG3-KBE-A).
//
// Everything here is data: the engine is a hand-written tokenizer, recursive-descent parser and AST walker. No
// expression text is ever handed to a JavaScript evaluator (eval, Function, vm, dynamic import are forbidden in this
// directory by ESLint and by a source scan in the tests).

/** Version of the language and its evaluation rules, recorded with every formula version and calculation. */
export const ENGINE_VERSION = "mth-formula/1.0.0";

/** ADR-0024 §6 limits. */
export const FORMULA_LIMITS = Object.freeze({
  /** Characters (Unicode code points, the JSON Schema `maxLength` unit) of the expression. */
  maxLength: 2000,
  /** AST nodes (numbers, variables, period arguments, unary, binary and call nodes). */
  maxNodes: 200,
  /** Nesting depth: levels of parentheses, function calls and unary minus (the top level is depth 1). */
  maxDepth: 32,
  /** Distinct variables referenced by the expression, and variables declared with it. */
  maxVariables: 30,
  /** Significant digits of a numeric literal. */
  maxLiteralDigits: 24,
  /** Characters of an identifier. */
  maxIdentifierLength: 48,
});

export const FORMULA_KINDS = [
  "fraction",
  "fraction_delta",
  "percent_change",
  "count",
  "currency",
  "quantity",
  "number",
] as const;
export type FormulaKind = (typeof FORMULA_KINDS)[number];

export const FORMULA_PERIODS = ["none", "month", "quarter", "year"] as const;
export type FormulaPeriod = (typeof FORMULA_PERIODS)[number];
/** A period that can be named in to_period(x, <period>). */
export type PeriodName = Exclude<FormulaPeriod, "none">;

export const FORMULA_FUNCTIONS = ["to_period", "min", "max", "abs"] as const;
export type FormulaFunction = (typeof FORMULA_FUNCTIONS)[number];

/** Kinds that carry no unit; in × they take the other operand's kind (ADR-0024 §6). */
export const DIMENSIONLESS_KINDS: readonly FormulaKind[] = ["fraction", "fraction_delta", "percent_change", "number"];

/** A typed variable (`benefit_formula_variable`; contract `FormulaVariable`). */
export interface FormulaVariable {
  readonly name: string;
  readonly kind: FormulaKind;
  readonly period: FormulaPeriod;
  /** Unit label, e.g. "customers" or "minutes". */
  readonly unit?: string | null | undefined;
  /** ISO 4217 code; required for kind `currency`, refused for other kinds. */
  readonly currency?: string | null | undefined;
  /** Decimal string value; null/absent = no value (evaluation gives Unknown with formula.missing_input). */
  readonly value?: string | null | undefined;
  readonly source?: string | null | undefined;
  readonly description?: string | null | undefined;
}

/** The type of an expression or of the formula result. */
export interface FormulaType {
  readonly kind: FormulaKind;
  readonly currency: string | null;
  readonly period: FormulaPeriod;
  readonly unit: string | null;
}

/**
 * Problem codes (i18n keys). Parse errors and limit violations are `formula.syntax` (with `params.reason`);
 * type-rule violations are 422 with the ADR-0024 §6 codes; evaluation errors leave the result Unknown (null).
 * `formula.invalid_variable` is a defensive check of the variable declarations (the API's schema refuses these first).
 */
export type FormulaErrorCode =
  | "formula.syntax"
  | "formula.undefined_variable"
  | "formula.kind_mismatch"
  | "formula.currency_product"
  | "formula.currency_mismatch"
  | "formula.period_mismatch"
  | "formula.invalid_variable"
  | "formula.division_by_zero"
  | "formula.missing_input"
  | "formula.result_out_of_range";

export interface FormulaProblem {
  readonly code: FormulaErrorCode;
  /** English text (the API's problem `detail`); the web translates `code` with `params`. */
  readonly message: string;
  /** Character offset (code points, 0-based) into the expression, when the problem has a position. */
  readonly offset?: number;
  /** Interpolation parameters for the translated message (names, kinds, periods, currencies, limits). */
  readonly params: Readonly<Record<string, string>>;
}

// ------------------------------------------------------------------------------------------------ AST

interface NodeBase {
  /** Code-point offset of the node's first character. */
  readonly start: number;
  /** Code-point offset just after the node's last character. */
  readonly end: number;
}

export interface NumberNode extends NodeBase {
  readonly type: "number";
  /** The literal digits exactly as written, e.g. "12.50". */
  readonly value: string;
}
export interface VariableNode extends NodeBase {
  readonly type: "variable";
  readonly name: string;
}
export interface PeriodNode extends NodeBase {
  readonly type: "period";
  readonly period: PeriodName;
}
export interface UnaryNode extends NodeBase {
  readonly type: "unary";
  readonly op: "-";
  readonly operand: ExprNode;
}
export interface BinaryNode extends NodeBase {
  readonly type: "binary";
  /** × is normalised to "*" and ÷ to "/". */
  readonly op: "+" | "-" | "*" | "/";
  readonly left: ExprNode;
  readonly right: ExprNode;
}
export interface CallNode extends NodeBase {
  readonly type: "call";
  readonly fn: FormulaFunction;
  readonly args: readonly (ExprNode | PeriodNode)[];
}
export type ExprNode = NumberNode | VariableNode | UnaryNode | BinaryNode | CallNode;
export type FormulaNode = ExprNode | PeriodNode;

/** A parsed formula. */
export interface FormulaAst {
  readonly root: ExprNode;
  /** The expression as code points, so messages can quote sub-expressions by offset. */
  readonly source: string;
  readonly nodeCount: number;
  readonly maxDepth: number;
  /** Distinct variable names in order of first appearance. */
  readonly variables: readonly string[];
}

export function isFormulaKind(v: unknown): v is FormulaKind {
  return typeof v === "string" && (FORMULA_KINDS as readonly string[]).includes(v);
}
export function isFormulaPeriod(v: unknown): v is FormulaPeriod {
  return typeof v === "string" && (FORMULA_PERIODS as readonly string[]).includes(v);
}
