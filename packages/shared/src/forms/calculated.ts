// Calculated fields (REQ-S06-005 "calculated fields use the safe formula engine"; ADR-0041 §3, §7). Owner:
// kpi-benefits-engineer (T-DG5-KBE-B). A thin wrapper over the DG3 restricted formula engine, which is reused UNCHANGED
// (`validateFormula`, `evaluateFormula`, `parseFormula` from ../formula; p5-work-split §2 rule 9): no eval, no
// arbitrary code, decimal.js only.
//
//  - Allowed variables = the record type's resolved NUMERIC fields (number, currency, percentage), by field key. A
//    number field is a `number` variable, a percentage field a `fraction` (its stored value is the fraction), a
//    currency field a `currency` variable in the field's currency; period `none`. Calculated fields are never
//    variables, so a calculated field cannot reference another one and no circular reference can form.
//  - Only the fields the expression references are declared (the engine allows at most 30 declared variables; a
//    record type may have more numeric fields). A name the record type does not have is therefore undeclared and the
//    engine refuses it (`formula.undefined_variable`) → 422 `form_schema.calculated_formula_invalid`.
//  - The result's kind must agree with the field's `resultUnitKind` (ADR-0037 N5): a currency result is `currency` and
//    only a currency result is; a `percentage` result is fraction-like (fraction, fraction_delta, percent_change).
//  - At read, a referenced field with no value (null, absent, or not a valid stored value) is MISSING: the result is
//    `not_computable` with the missing field keys, never 0 and never green (ADR-0041 §7). Division by zero and an
//    out-of-range result are `not_computable` too, with the engine's code.
import {
  evaluateFormula,
  parseFormula,
  RESERVED_WORDS,
  validateFormula,
  type FormulaErrorCode,
  type FormulaProblem,
  type FormulaType,
  type FormulaVariable,
} from "../formula/index.ts";
import {
  FIELD_DECIMAL_PATTERN,
  FORM_SCHEMA_MESSAGES,
  type CalculatedSettings,
  type FieldDefinition,
  type NumericFieldType,
  type ResultUnitKind,
} from "./field-types.ts";

/** A numeric field a calculated field may read. `currencyCode` is required for a currency field. */
export interface NumericField {
  readonly key: string;
  readonly fieldType: NumericFieldType;
  readonly currencyCode?: string;
}

/** The numeric fields of a resolved field list (source columns and extension fields alike; calculated ones excluded). */
export function numericFieldsOf(fields: readonly FieldDefinition[]): NumericField[] {
  const out: NumericField[] = [];
  for (const f of fields) {
    if (f.fieldType === "number" || f.fieldType === "percentage") out.push({ key: f.key, fieldType: f.fieldType });
    else if (f.fieldType === "currency") {
      out.push({ key: f.key, fieldType: "currency", currencyCode: f.settings.currencyCode });
    }
  }
  return out;
}

function variableOf(field: NumericField, value?: string | null): FormulaVariable {
  const base = { name: field.key, period: "none" as const, ...(value !== undefined ? { value } : {}) };
  if (field.fieldType === "currency") return { ...base, kind: "currency", currency: field.currencyCode ?? null };
  return { ...base, kind: field.fieldType === "percentage" ? "fraction" : "number" };
}

/** The field keys an expression references, in order of first appearance ([] when it does not parse). */
export function referencedFields(expression: string): readonly string[] {
  const parsed = parseFormula(expression);
  return parsed.ok ? parsed.ast.variables : [];
}

function declaredFor(expression: string, fields: readonly NumericField[]): NumericField[] {
  const referenced = new Set(referencedFields(expression));
  return fields.filter((f) => referenced.has(f.key) && !RESERVED_WORDS.includes(f.key));
}

const FRACTION_KINDS = new Set(["fraction", "fraction_delta", "percent_change"]);

function unitKindAgrees(resultType: FormulaType, unitKind: ResultUnitKind): boolean {
  if ((resultType.kind === "currency") !== (unitKind === "currency")) return false;
  if (unitKind === "percentage" && !FRACTION_KINDS.has(resultType.kind)) return false;
  return true;
}

export type CalculatedDefinitionResult =
  | { readonly ok: true; readonly resultType: FormulaType; readonly variables: readonly string[] }
  | {
      readonly ok: false;
      readonly code: "form_schema.calculated_formula_invalid";
      readonly message: string;
      /** The engine's problems (codes are i18n keys; `formula.undefined_variable` names the unknown field). */
      readonly errors: readonly FormulaProblem[];
      readonly params: Readonly<Record<string, string>>;
    };

function invalid(errors: readonly FormulaProblem[], reason: string): CalculatedDefinitionResult {
  return {
    ok: false,
    code: "form_schema.calculated_formula_invalid",
    message: FORM_SCHEMA_MESSAGES["form_schema.calculated_formula_invalid"],
    errors,
    params: { reason },
  };
}

/**
 * Definition-time check of a calculated field (the forms provider calls it at element write and compatibility
 * `fail`; ADR-0041 §2-§3). `numericFields` are the record type's resolved numeric fields in the draft version.
 */
export function validateCalculatedField(
  settings: CalculatedSettings,
  numericFields: readonly NumericField[],
): CalculatedDefinitionResult {
  const v = validateFormula(
    settings.expression,
    declaredFor(settings.expression, numericFields).map((f) => variableOf(f)),
  );
  if (!v.ok) return invalid(v.errors, v.errors[0]?.code ?? "formula.syntax");
  if (!unitKindAgrees(v.resultType, settings.resultUnitKind)) {
    return invalid([], "result_unit_kind");
  }
  return { ok: true, resultType: v.resultType, variables: v.variables };
}

/** The read-time value of a calculated field. */
export interface CalculatedFieldResult {
  readonly status: "computed" | "not_computable";
  /** The decimal string (numeric(24,6) canonical form) or null: Not computable is never 0. */
  readonly value: string | null;
  /** Referenced fields with no usable value, in order of first appearance. */
  readonly missingFields: readonly string[];
  /** Why it is not computable: `formula.missing_input`, `formula.division_by_zero`, ... (null when computed). */
  readonly errorCode: FormulaErrorCode | null;
  readonly resultType: FormulaType | null;
}

/** The stored value of a numeric field as a formula input, or null when it is missing or not a valid stored value. */
function inputOf(field: NumericField, raw: unknown): string | null {
  if (field.fieldType === "currency") {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
    const amount = (raw as Record<string, unknown>)["amount"];
    const code = (raw as Record<string, unknown>)["currencyCode"];
    if (typeof amount !== "string" || !FIELD_DECIMAL_PATTERN.test(amount)) return null;
    // A value in another currency is not an input of this field (no FX): treated as missing.
    return code === field.currencyCode ? amount : null;
  }
  return typeof raw === "string" && FIELD_DECIMAL_PATTERN.test(raw) ? raw : null;
}

/**
 * Evaluates a calculated field over a record's stored values (`values`: field key → stored JSON value; source columns
 * are passed by the caller under their field keys). Missing inputs → `not_computable` with their names.
 */
export function evaluateCalculatedField(
  settings: CalculatedSettings,
  numericFields: readonly NumericField[],
  values: Readonly<Record<string, unknown>>,
): CalculatedFieldResult {
  const referenced = referencedFields(settings.expression);
  const declared = declaredFor(settings.expression, numericFields);
  const def = validateCalculatedField(settings, numericFields);
  if (!def.ok) {
    const known = new Set(declared.map((f) => f.key));
    return {
      status: "not_computable",
      value: null,
      missingFields: referenced.filter((name) => !known.has(name)),
      errorCode: (def.errors[0]?.code ?? "formula.syntax") as FormulaErrorCode,
      resultType: null,
    };
  }
  const own = (k: string) => Object.prototype.hasOwnProperty.call(values, k);
  const inputs = new Map(declared.map((f) => [f.key, own(f.key) ? inputOf(f, values[f.key]) : null] as const));
  const missing = referenced.filter((name) => inputs.get(name) === null);
  if (missing.length > 0) {
    return {
      status: "not_computable",
      value: null,
      missingFields: missing,
      errorCode: "formula.missing_input",
      resultType: def.resultType,
    };
  }
  const r = evaluateFormula(
    settings.expression,
    declared.map((f) => variableOf(f, inputs.get(f.key) ?? null)),
  );
  if (!r.ok || r.result === null) {
    return {
      status: "not_computable",
      value: null,
      missingFields: [],
      errorCode: r.errorCode ?? "formula.syntax",
      resultType: r.resultType,
    };
  }
  return { status: "computed", value: r.result, missingFields: [], errorCode: null, resultType: r.resultType };
}

/** The OpenAPI `FormCustomValues.calculated` entry: exactly `{status, value, missingFields}`. */
export function toCalculatedEntry(r: CalculatedFieldResult): {
  status: "computed" | "not_computable";
  value: string | null;
  missingFields: string[];
} {
  return { status: r.status, value: r.value, missingFields: [...r.missingFields] };
}
