// The ADR-0045 §5 validation rules: one pure function per source kind (REQ-S13-008; p5-work-split §F.1; T-DG5-KBE-C).
// Every assembler sets each value's `validation` through these functions only, so a value's label is decided in one
// place and unit-tested here (provisional.test.ts). The source states are the existing DG2-DG4 columns; this file reads
// no database and changes no state. The column each rule reads, per assembler, is listed in the KBE-C handback.
//
//   1. A benefit value whose measurement is not validated by Finance (ADR-0030) is provisional.
//   2. A business-case value or benefit formula whose formula version is not validated (ADR-0024, ADR-0030) is
//      provisional.
//   3. A baseline whose validation status is not validated (ADR-0019, ADR-0029) is provisional.
//   4. A KPI actual that is not accepted (ADR-0027) is provisional; a KPI whose latest actual is stale (ADR-0028) is
//      stale.
//   5. A value the source does not have, or cannot compute, is unknown with no number.
//   6. Every other value is validated when its source has a validated state, and not_applicable when it has none.
//
// Unknown and Stale are never 0 and never green (shared rule 5): the builders in assembler.ts null the number whenever
// the label is unknown or stale.
import type { ReportValidation, ReportValueReason } from "@mth/shared/schemas";

/** A label with the reason a value has no number (null when it has one). */
export interface ValueState {
  readonly validation: ReportValidation;
  readonly reason: ReportValueReason | null;
}

export const NOT_APPLICABLE: ValueState = Object.freeze({ validation: "not_applicable", reason: null });
export const VALIDATED: ValueState = Object.freeze({ validation: "validated", reason: null });
export const PROVISIONAL: ValueState = Object.freeze({ validation: "provisional", reason: null });
export const UNKNOWN_MISSING: ValueState = Object.freeze({ validation: "unknown", reason: "missing" });
export const UNKNOWN_NOT_COMPUTABLE: ValueState = Object.freeze({ validation: "unknown", reason: "not_computable" });
export const STALE: ValueState = Object.freeze({ validation: "stale", reason: "stale" });

/**
 * Rule 1: a benefit value line by its `benefit_value_line.value_state` (ADR-0030). `validated` and `sustained` are
 * Finance-validated; `submitted` (pending), `forecast` and `measured` are not. `planned` is a plan figure, not a
 * measurement, so it carries no validation (rule 6). A `rejected` line is never reported as value (unknown).
 */
export function benefitValueState(valueState: string): ValueState {
  switch (valueState) {
    case "validated":
    case "sustained":
      return VALIDATED;
    case "submitted":
    case "forecast":
    case "measured":
      return PROVISIONAL;
    case "planned":
      return NOT_APPLICABLE;
    default:
      return UNKNOWN_NOT_COMPUTABLE;
  }
}

/** Rule 2: a formula version (`formula_version.status`, ADR-0024): only `validated` is validated. */
export function formulaVersionState(status: string | null): ValueState {
  if (status === null) return UNKNOWN_MISSING;
  return status === "validated" ? VALIDATED : PROVISIONAL;
}

/**
 * Rule 3: a baseline by its validation (`baseline.validation_status` with `validated_record_version`; ADR-0019): a
 * validation recorded on an earlier version of the row is stale and does not count (value.ts `validationState`), so
 * only a current `validated` is validated.
 */
export function baselineState(b: {
  readonly validationStatus: string;
  readonly validatedRecordVersion: number | null;
  readonly version: number;
}): ValueState {
  return b.validationStatus === "validated" && b.validatedRecordVersion === b.version ? VALIDATED : PROVISIONAL;
}

/**
 * Rule 4: the latest KPI actual of a KPI (`kpi_actual.status` and its value's `data_as_of`; ADR-0027, ADR-0028).
 * No actual -> unknown (missing); a value recorded as missing -> unknown (missing); not accepted -> provisional;
 * accepted but older than the version's `dq_stale_after_days` at the as-of date -> stale; else validated.
 */
export function kpiActualState(a: {
  readonly status: string | null;
  readonly hasValue: boolean;
  readonly dataAsOf: string | null;
  readonly staleAfterDays: number | null;
  readonly asOfDate: string;
}): ValueState {
  if (a.status === null || !a.hasValue) return UNKNOWN_MISSING;
  if (a.status !== "accepted") return PROVISIONAL;
  if (a.dataAsOf !== null && a.staleAfterDays !== null && isStale(a.dataAsOf, a.staleAfterDays, a.asOfDate))
    return STALE;
  return VALIDATED;
}

/** True when `dataAsOf` + `days` calendar days is before `asOfDate` (business dates, 'YYYY-MM-DD'). */
export function isStale(dataAsOf: string, days: number, asOfDate: string): boolean {
  const limit = new Date(`${dataAsOf.slice(0, 10)}T00:00:00Z`);
  limit.setUTCDate(limit.getUTCDate() + days);
  return limit.toISOString().slice(0, 10) < asOfDate.slice(0, 10);
}

/**
 * The benefit register's amount states (benefits/register.ts `BenefitAmount.status`): `known` with the label of its
 * value state, `unknown` with no number, `not_applicable` for an unmonetised non-financial benefit.
 */
export function benefitAmountState(status: "known" | "unknown" | "not_applicable", valueState: string): ValueState {
  if (status === "unknown") return UNKNOWN_MISSING;
  if (status === "not_applicable") return NOT_APPLICABLE;
  return benefitValueState(valueState);
}

/** Rule 5 and 6 for a field without a validation state of its own: present -> not_applicable, absent -> unknown. */
export function plainState(present: boolean): ValueState {
  return present ? NOT_APPLICABLE : UNKNOWN_MISSING;
}

/** Rule 6 for a record that carries a business approval: approved -> validated, otherwise provisional. */
export function approvalBackedState(approvalState: string | null): ValueState {
  if (approvalState === null || approvalState === "not_applicable") return NOT_APPLICABLE;
  return approvalState === "approved" ? VALIDATED : PROVISIONAL;
}

/**
 * Rule 3 for the benefit register's baseline copy (`benefit.baseline_validation_status`, ADR-0029): only `validated`
 * is validated; `unvalidated` and `rejected` are provisional.
 */
export function benefitBaselineState(status: string): ValueState {
  return status === "validated" ? VALIDATED : PROVISIONAL;
}
