// KPI formulas on the DG3 engine: variable typing, result-type match, evaluation (ADR-0028 §8, REQ-S07-011 units
// half; seam 5). Owner: kpi-benefits-engineer (T-DG4-KBE-A).
//
// The engine (packages/shared/src/formula/**) is used UNCHANGED, through its public API only.
//
//   Source unit_kind      Engine kind   Unit / currency
//   currency              currency      the KPI's currency
//   percentage            fraction      —
//   count                 count         unit_label
//   ratio, score          number        —
//   duration, other       quantity      unit_label
//   Period: monthly → month, quarterly → quarter, annual → year, otherwise none.
//
// validateKpiFormula: validateFormula must succeed (the engine's own refusals pass through with their ADR-0024 §6 codes
// and texts: SAR + count is formula.kind_mismatch, SAR + USD formula.currency_mismatch), and the result's kind and
// currency must equal the KPI's own mapped type, else kpi_formula.unit_mismatch (ADR-0027 §13 text).
// evaluateKpiFormula: an Unknown input gives Unknown (kpi.formula_input_unknown); a division by zero gives Not computable
// (kpi.formula_division_by_zero); the engine's rounding record is returned for kpi_evaluation.rounding.
// Cycle detection is NOT here: it is the graph walk of the API's kpi-formulas service under lock 730228 (ADR-0027 §4).
import {
  ENGINE_VERSION,
  evaluateFormula,
  validateFormula,
  type FormulaPeriod,
  type FormulaProblem,
  type FormulaType,
  type FormulaVariable,
} from "../formula/index.ts";
import {
  KpiInputError,
  notComputable,
  unknown,
  type Frequency,
  type KpiResult,
  type KpiRounding,
  type UnitKind,
  type ValueBasis,
} from "./types.ts";

/** The typing fields of a KPI version (the formula's own KPI, or a source KPI). */
export interface KpiTypeSource {
  readonly unitKind: UnitKind;
  readonly unitLabel: string | null;
  readonly currency: string | null;
  readonly frequency: Frequency;
}

const PERIOD_OF_FREQUENCY: Readonly<Record<Frequency, FormulaPeriod>> = Object.freeze({
  daily: "none",
  weekly: "none",
  monthly: "month",
  quarterly: "quarter",
  annual: "year",
  ad_hoc: "none",
});

/** The engine type of a KPI (ADR-0028 §8 table). */
export function kpiFormulaType(src: KpiTypeSource): FormulaType {
  if ((src.unitKind === "currency") !== (src.currency !== null)) {
    throw new KpiInputError("currency", "is set exactly when unitKind is currency (kpi_version_currency_unit)");
  }
  const period = PERIOD_OF_FREQUENCY[src.frequency];
  if (period === undefined) throw new KpiInputError("frequency", `unknown frequency ${JSON.stringify(src.frequency)}`);
  switch (src.unitKind) {
    case "currency":
      return Object.freeze({ kind: "currency", currency: src.currency, unit: null, period });
    case "percentage":
      return Object.freeze({ kind: "fraction", currency: null, unit: null, period });
    case "count":
      return Object.freeze({ kind: "count", currency: null, unit: src.unitLabel, period });
    case "ratio":
    case "score":
      return Object.freeze({ kind: "number", currency: null, unit: null, period });
    case "duration":
    case "other":
      return Object.freeze({ kind: "quantity", currency: null, unit: src.unitLabel, period });
    default:
      throw new KpiInputError("unitKind", `unknown unit kind ${JSON.stringify(src.unitKind as string)}`);
  }
}

/** A formula input (kpi_formula_input): a variable bound to a source KPI. */
export interface KpiFormulaInputBinding {
  readonly variableName: string;
  readonly source: KpiTypeSource;
  readonly inputBasis?: ValueBasis;
  readonly sourceKpiDefinitionId?: string;
}

/** The engine variable declarations of a formula's inputs. */
export function bindFormulaVariables(inputs: readonly KpiFormulaInputBinding[]): FormulaVariable[] {
  return inputs.map((b) => {
    const t = kpiFormulaType(b.source);
    return Object.freeze({
      name: b.variableName,
      kind: t.kind,
      period: t.period,
      unit: t.unit,
      currency: t.currency,
      ...(b.sourceKpiDefinitionId ? { source: b.sourceKpiDefinitionId } : {}),
    });
  });
}

/** kpi_formula.unit_mismatch (ADR-0027 §13): "The formula gives {resultUnit}, but the KPI is measured in {kpiUnit}." */
export interface KpiFormulaUnitMismatch {
  readonly code: "kpi_formula.unit_mismatch";
  readonly message: string;
  readonly params: Readonly<{ resultUnit: string; kpiUnit: string }>;
}
export type KpiFormulaProblem = FormulaProblem | KpiFormulaUnitMismatch;

/** A short unit text for messages: the currency code, or the engine kind with its unit label. */
export function describeFormulaType(t: Pick<FormulaType, "kind" | "currency" | "unit">): string {
  if (t.kind === "currency") return t.currency ?? "currency";
  return t.unit ? `${t.kind} (${t.unit})` : t.kind;
}

export type KpiFormulaValidation =
  | {
      readonly ok: true;
      readonly resultType: FormulaType;
      readonly kpiType: FormulaType;
      readonly variables: readonly FormulaVariable[];
      readonly engineVersion: typeof ENGINE_VERSION;
    }
  | {
      readonly ok: false;
      readonly errors: readonly KpiFormulaProblem[];
      readonly engineVersion: typeof ENGINE_VERSION;
    };

/** Validates a KPI formula against its typed inputs and the KPI's own type (ADR-0028 §8). */
export function validateKpiFormula(
  expression: string,
  inputs: readonly KpiFormulaInputBinding[],
  kpi: KpiTypeSource,
): KpiFormulaValidation {
  const kpiType = kpiFormulaType(kpi);
  const variables = bindFormulaVariables(inputs);
  const v = validateFormula(expression, variables);
  if (!v.ok) return Object.freeze({ ok: false, errors: v.errors, engineVersion: ENGINE_VERSION });
  if (v.resultType.kind !== kpiType.kind || v.resultType.currency !== kpiType.currency) {
    const resultUnit = describeFormulaType(v.resultType);
    const kpiUnit = describeFormulaType(kpiType);
    return Object.freeze({
      ok: false,
      errors: Object.freeze([
        Object.freeze({
          code: "kpi_formula.unit_mismatch" as const,
          message: `The formula gives ${resultUnit}, but the KPI is measured in ${kpiUnit}.`,
          params: Object.freeze({ resultUnit, kpiUnit }),
        }),
      ]),
      engineVersion: ENGINE_VERSION,
    });
  }
  return Object.freeze({
    ok: true,
    resultType: v.resultType,
    kpiType,
    variables: Object.freeze(variables),
    engineVersion: ENGINE_VERSION,
  });
}

// ------------------------------------------------------------------------------------------------ evaluation

export interface KpiFormulaInputValue extends KpiFormulaInputBinding {
  /** The source KPI's evaluated value of the same scope, period and input basis. Stale values are used, and listed. */
  readonly value: KpiResult;
}

export type KpiFormulaEvaluation =
  | {
      readonly ok: true;
      /** ok (storage-rounded by the engine), Unknown (kpi.formula_input_unknown) or Not computable. */
      readonly result: KpiResult;
      readonly rounding: KpiRounding;
      /** Input values used, by variable name (lineage; null = Unknown). */
      readonly inputs: Readonly<Record<string, string | null>>;
      /** Variables whose value was Unknown or Not computable. */
      readonly unknownInputs: readonly string[];
      /** Variables whose value was Stale (the caller decides the result's freshness from their data_as_of). */
      readonly staleInputs: readonly string[];
      readonly engineVersion: typeof ENGINE_VERSION;
    }
  | {
      /** The formula is invalid against its inputs or the KPI (validated at creation, so a data or caller error). */
      readonly ok: false;
      readonly errors: readonly KpiFormulaProblem[];
      readonly engineVersion: typeof ENGINE_VERSION;
    };

function noRounding(): KpiRounding {
  return Object.freeze({
    column: "numeric(24,6)",
    scale: 6,
    mode: "ROUND_HALF_UP",
    precision: 80,
    exact: null,
    stored: null,
    rounded: false,
    inexactIntermediate: false,
  });
}

/** Evaluates a KPI formula for one scope, period and basis (ADR-0028 §8). */
export function evaluateKpiFormula(
  expression: string,
  inputs: readonly KpiFormulaInputValue[],
  kpi: KpiTypeSource,
): KpiFormulaEvaluation {
  const v = validateKpiFormula(expression, inputs, kpi);
  if (!v.ok) return v;
  const values: Record<string, string | null> = {};
  const unknownInputs: string[] = [];
  const staleInputs: string[] = [];
  for (const i of inputs) {
    values[i.variableName] = i.value.value;
    if (i.value.value === null) unknownInputs.push(i.variableName);
    else if (i.value.status === "stale") staleInputs.push(i.variableName);
  }
  const lineage = Object.freeze({ ...values });
  const done = (result: KpiResult, rounding: KpiRounding): KpiFormulaEvaluation =>
    Object.freeze({
      ok: true,
      result,
      rounding,
      inputs: lineage,
      unknownInputs: Object.freeze(unknownInputs),
      staleInputs: Object.freeze(staleInputs),
      engineVersion: ENGINE_VERSION,
    });
  if (unknownInputs.length > 0) return done(unknown("kpi.formula_input_unknown"), noRounding());

  const e = evaluateFormula(expression, v.variables, values);
  if (e.ok && e.result !== null) {
    return done(Object.freeze({ status: "ok", value: e.result, reason: null }), e.rounding);
  }
  switch (e.errorCode) {
    case "formula.division_by_zero":
      return done(notComputable("kpi.formula_division_by_zero"), e.rounding);
    case "formula.result_out_of_range":
      return done(notComputable("kpi.value_out_of_range"), e.rounding);
    case "formula.missing_input":
      return done(unknown("kpi.formula_input_unknown"), e.rounding);
    default:
      return Object.freeze({ ok: false, errors: e.errors, engineVersion: ENGINE_VERSION });
  }
}
