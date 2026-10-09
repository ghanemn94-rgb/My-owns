// Roll-ups across scopes (ADR-0028 §7, REQ-S07-010, REQ-S07-006 "no zero in roll-ups"). Owner: kpi-benefits-engineer
// (T-DG4-KBE-A).
//
//   sum            (flows)       Σ values
//   last_value     (stocks)      Σ values when stock_additive_across_scopes, else Not computable (kpi.stock_not_additive)
//   weighted_ratio (ratios)      Σ numerators / Σ denominators: 1/10 and 9/10 → 0.50, never the mean of percentages
//   custom_formula               the KPI's approved formula at the target scope (formula-binding.ts evaluateKpiFormula)
//   none           (milestones)  Not computable (kpi.no_rollup)
//
// There is no averaging rule. A rule that does not fit the value nature (CHECK kpi_version_aggregation_fits_nature) is a
// caller error. Expected scopes = the scopes with an accepted value in an earlier period or in this one (an accepted
// "not available" counts as reported); one of them
// without an accepted value for this period makes the roll-up Unknown (kpi.scope_missing): a missing scope contributes
// no zero. Inputs in another unit, unit label or currency than the KPI's, or of another period or basis, are REFUSED
// (kpi.aggregation_unit_mismatch / kpi.aggregation_period_mismatch), never converted.
import type { PeriodEntry } from "./periods.ts";
import {
  dayNumber,
  dec,
  KD,
  KpiInputError,
  notComputable,
  ok,
  unknown,
  type AggregationRule,
  type Dec,
  type KpiResult,
  type UnitKind,
  type ValueBasis,
  type ValueNature,
} from "./types.ts";

/** The rule each value nature allows besides custom_formula (0033 kpi_version_aggregation_fits_nature). */
export const RULE_FOR_NATURE: Readonly<Record<ValueNature, AggregationRule>> = Object.freeze({
  flow: "sum",
  stock: "last_value",
  ratio: "weighted_ratio",
  milestone: "none",
});

/** True when the rule fits the value nature. */
export function ruleFitsNature(rule: AggregationRule, nature: ValueNature): boolean {
  return rule === "custom_formula" || RULE_FOR_NATURE[nature] === rule;
}

/** The KPI's measure: unit kind, unit label and currency (kpi_version). */
export interface KpiMeasureUnit {
  readonly unitKind: UnitKind;
  readonly unitLabel: string | null;
  /** ISO 4217, set exactly when unitKind = currency (CHECK kpi_version_currency_unit). */
  readonly currency: string | null;
}

/** One scope's accepted value for the period and basis being rolled up. */
export interface ScopeValue extends KpiMeasureUnit {
  readonly scopeId: string;
  readonly periodId: string;
  readonly basis: ValueBasis;
  /** null = no accepted value for this period. For a cumulative ratio: the scope's Σ numerators / Σ denominators. */
  readonly entry: PeriodEntry | null;
  /** The entry's data_as_of (ISO date), for the roll-up's freshness. */
  readonly dataAsOf?: string | null;
}

export interface RollUpInput extends KpiMeasureUnit {
  readonly rule: AggregationRule;
  readonly valueNature: ValueNature;
  /** kpi_version.stock_additive_across_scopes. */
  readonly stockAdditiveAcrossScopes: boolean;
  readonly periodId: string;
  readonly basis: ValueBasis;
  /** Scope ids that had an accepted value of this KPI in an earlier period. */
  readonly previouslyReportingScopes: readonly string[];
  readonly inputs: readonly ScopeValue[];
}

export type RollUpRefusalCode = "kpi.aggregation_unit_mismatch" | "kpi.aggregation_period_mismatch";

export type RollUpOutcome =
  | {
      readonly ok: true;
      readonly kind: "value";
      readonly result: KpiResult;
      /** The expected scopes, sorted (lineage). */
      readonly expectedScopes: readonly string[];
      /** Expected scopes without an accepted value (kpi.scope_missing; data-quality finding scope_missing). */
      readonly missingScopes: readonly string[];
      /** The oldest data_as_of of the inputs used, or null. */
      readonly dataAsOf: string | null;
      /** The preserved currency (the KPI's), or null. */
      readonly currency: string | null;
    }
  | {
      /** custom_formula: evaluate the KPI's approved formula at the target scope (ADR-0027 §2). */
      readonly ok: true;
      readonly kind: "custom_formula";
    }
  | {
      readonly ok: false;
      readonly code: RollUpRefusalCode;
      /** English text (problem detail); the web translates `code` with `params`. */
      readonly message: string;
      readonly params: Readonly<Record<string, string>>;
    };

function unitText(u: KpiMeasureUnit): string {
  if (u.unitKind === "currency") return u.currency ?? "currency";
  return u.unitLabel ? `${u.unitKind} (${u.unitLabel})` : u.unitKind;
}

function refuse(code: RollUpRefusalCode, message: string, params: Record<string, string>): RollUpOutcome {
  return Object.freeze({ ok: false, code, message, params: Object.freeze(params) });
}

/** Rolls the scope values of one period and basis up to the target scope (ADR-0028 §7). */
export function rollUp(input: RollUpInput): RollUpOutcome {
  if (!ruleFitsNature(input.rule, input.valueNature)) {
    throw new KpiInputError(
      "rule",
      `${input.rule} does not fit a ${input.valueNature} KPI (no averaging, no mixed rules)`,
    );
  }
  // 1. Refuse mixed units, currencies, periods (an error, never a conversion).
  const seen = new Set<string>();
  for (const v of input.inputs) {
    if (seen.has(v.scopeId)) throw new KpiInputError("inputs", `scope ${v.scopeId} appears twice`);
    seen.add(v.scopeId);
    if (v.unitKind !== input.unitKind || v.currency !== input.currency || v.unitLabel !== input.unitLabel) {
      const given = unitText(v);
      const kpi = unitText(input);
      return refuse(
        "kpi.aggregation_unit_mismatch",
        `Roll-up refused: scope ${v.scopeId} is in ${given}, but the KPI is measured in ${kpi}; values are never converted.`,
        { scopeId: v.scopeId, given, kpiUnit: kpi },
      );
    }
    if (v.periodId !== input.periodId || v.basis !== input.basis) {
      return refuse(
        "kpi.aggregation_period_mismatch",
        `Roll-up refused: scope ${v.scopeId} is for period ${v.periodId} (${v.basis}), not ${input.periodId} (${input.basis}); a roll-up never mixes periods.`,
        { scopeId: v.scopeId, periodId: v.periodId, expectedPeriodId: input.periodId },
      );
    }
  }
  const valueOutcome = (
    result: KpiResult,
    expected: readonly string[],
    missing: readonly string[],
    dataAsOf: string | null,
  ) =>
    Object.freeze({
      ok: true as const,
      kind: "value" as const,
      result,
      expectedScopes: Object.freeze([...expected]),
      missingScopes: Object.freeze([...missing]),
      dataAsOf,
      currency: input.currency,
    });

  // 2. Structural rules first: they do not depend on which scopes reported.
  if (input.rule === "custom_formula") return Object.freeze({ ok: true, kind: "custom_formula" });
  if (input.rule === "none") return valueOutcome(notComputable("kpi.no_rollup"), [], [], null);
  if (input.rule === "last_value" && !input.stockAdditiveAcrossScopes) {
    return valueOutcome(notComputable("kpi.stock_not_additive"), [], [], null);
  }

  // 3. Expected scopes; a missing one makes the roll-up Unknown (no zero contribution).
  // A scope whose accepted entry for this period is an explicit "not available" has reported (an accepted actual with
  // no value), so it is expected, and its missing value makes the roll-up Unknown rather than a partial sum.
  const usable = new Map<string, ScopeValue>();
  const reportedNow: string[] = [];
  for (const v of input.inputs) {
    if (v.entry === null) continue;
    reportedNow.push(v.scopeId);
    if (v.entry.kind !== "not_available") usable.set(v.scopeId, v);
  }
  const expected = [...new Set([...input.previouslyReportingScopes, ...reportedNow])].sort();
  const missing = expected.filter((s) => !usable.has(s));
  if (expected.length === 0) return valueOutcome(unknown("kpi.no_accepted_actual"), expected, missing, null);
  if (missing.length > 0) return valueOutcome(unknown("kpi.scope_missing"), expected, missing, null);

  const used = expected.map((s) => usable.get(s)!);
  let oldest: string | null = null;
  for (const v of used) {
    if (v.dataAsOf === undefined || v.dataAsOf === null) continue;
    if (oldest === null || dayNumber(v.dataAsOf, "dataAsOf") < dayNumber(oldest, "dataAsOf")) oldest = v.dataAsOf;
  }

  // 4. Compute.
  if (input.rule === "weighted_ratio") {
    let num: Dec = new KD(0);
    let den: Dec = new KD(0);
    for (const v of used) {
      const e = v.entry!;
      if (e.kind !== "ratio")
        throw new KpiInputError(`inputs.${v.scopeId}`, "a weighted ratio needs a numerator and a denominator");
      num = num.plus(dec(e.numerator, `inputs.${v.scopeId}.numerator`));
      den = den.plus(dec(e.denominator, `inputs.${v.scopeId}.denominator`));
    }
    const result = den.isZero() ? notComputable("kpi.zero_denominator") : ok(num.div(den));
    return valueOutcome(result, expected, [], oldest);
  }
  // sum (flows) and additive last_value (stocks): Σ values.
  let total: Dec = new KD(0);
  for (const v of used) {
    const e = v.entry!;
    if (e.kind !== "value") throw new KpiInputError(`inputs.${v.scopeId}`, `a ${input.rule} roll-up needs a value`);
    total = total.plus(dec(e.value, `inputs.${v.scopeId}.value`));
  }
  return valueOutcome(ok(total), expected, [], oldest);
}
