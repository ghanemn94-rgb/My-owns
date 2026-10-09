// P4 slice B zod mirrors of the KBE-E operations (kpi-benefits-engineer, T-DG4-KBE-E; ADR-0030; p4-work-split §B.3).
// Mirrors docs/api/openapi.yaml 1.3.0-p4: BenefitBaselineDecision, BenefitValueState, BenefitValueLine, BenefitValues,
// BenefitPlanValue(+Create, Update), BenefitMeasurementInput, BenefitMeasurement(+Create, Update, Page),
// FinanceValidationItemDecision, FinanceValidationContent (the six-key Finance snapshot), FinanceValidation(+Page,
// Decision, Amendment), BenefitTotalLine, BenefitTotalsCurrency and BenefitTotals; plus the slice B outbox payloads
// (benefit.evidence_submitted, benefit.value_validated, benefit.value_rejected, benefit.variance_evaluated).
//
// Rules carried here (pure, no I/O):
//  - amounts are decimal strings, never JSON numbers; money fits numeric(20,4), KPI values numeric(24,6) (S-5);
//  - a value state is ONE of planned, forecast, measured, submitted, validated, sustained, rejected; states are never
//    added together (REQ-S08-001);
//  - a Finance decision covers all six items (REQ-S08-015): the API reports the missing ones with
//    `missingFinanceItems` before it looks at anything else;
//  - free text through `freeText` (S-1).
// A Finance validation is a human decision inside the product; nothing here validates anything by itself, and nothing
// relates to the engineering gates DG0-DG7.
import { z } from "zod";
import { currency, freeText, page, reason, timestamp, uuid, version } from "./common.ts";
import { businessDate, decimal, measureDecimal, moneyDecimal } from "./kpi.ts";
import { benefitAmount, benefitExclusionReason } from "./benefits.ts";

const nullableUuid = uuid.nullable();
const nullableTimestamp = timestamp.nullable();
const nullableDate = businessDate.nullable();
const atLeastOne = <T extends z.ZodRawShape>(shape: T) =>
  z.strictObject(shape).refine((v) => Object.keys(v).length >= 1, "validation.min_properties");

// ------------------------------------------------------------------------------------------------ vocabularies

export const BENEFIT_VALUE_STATES = [
  "planned",
  "forecast",
  "measured",
  "submitted",
  "validated",
  "sustained",
  "rejected",
] as const;
export const benefitValueState = z.enum(BENEFIT_VALUE_STATES);
export type BenefitValueState = z.infer<typeof benefitValueState>;

export const BENEFIT_MEASUREMENT_STATUSES = ["draft", "submitted", "validated", "rejected", "superseded"] as const;
export const BENEFIT_MEASUREMENT_KINDS = ["measurement", "amendment", "reversal"] as const;
export const BENEFIT_MEASUREMENT_SOURCES = ["manual", "kpi_recalculation", "correction"] as const;
export const FINANCE_VALIDATION_STATUSES = ["queued", "approved", "rejected", "withdrawn"] as const;
export const FINANCE_VALIDATION_KINDS = ["validation", "amendment", "reversal"] as const;

/** The six items of a Finance decision (REQ-S08-015; M0174), in the order the validator sees them. */
export const FINANCE_ITEMS = [
  "baseline",
  "attribution",
  "calculation",
  "evidence",
  "measurementPeriod",
  "assumptions",
] as const;
export type FinanceItem = (typeof FINANCE_ITEMS)[number];

/** The total value classes (ADR-0030 §7): the five financial classes and valued non-financial benefits. */
export const BENEFIT_TOTAL_CLASSES = [
  "revenue_uplift",
  "margin_uplift",
  "cash_saving",
  "avoided_cost",
  "working_capital_release",
  "non_financial_valued",
] as const;
export type BenefitTotalClass = (typeof BENEFIT_TOTAL_CLASSES)[number];

// ------------------------------------------------------------------------------------------------ requests

export const benefitBaselineDecision = z.strictObject({
  decision: z.enum(["validated", "rejected"]),
  note: freeText(1, 2000).optional(),
});
export type BenefitBaselineDecision = z.infer<typeof benefitBaselineDecision>;

export const benefitPlanValueCreate = z.strictObject({
  valueKind: z.enum(["planned", "forecast"]),
  periodStart: businessDate,
  periodEnd: businessDate,
  amount: moneyDecimal.nullable().optional(),
  kpiValue: measureDecimal.nullable().optional(),
  note: freeText(1, 2000).optional(),
});
export type BenefitPlanValueCreate = z.infer<typeof benefitPlanValueCreate>;

export const benefitPlanValueUpdate = atLeastOne({
  periodStart: businessDate.optional(),
  periodEnd: businessDate.optional(),
  amount: moneyDecimal.nullable().optional(),
  kpiValue: measureDecimal.nullable().optional(),
  note: freeText(1, 2000).nullable().optional(),
});
export type BenefitPlanValueUpdate = z.infer<typeof benefitPlanValueUpdate>;

/** A formula variable name (the benefit_measurement_input CHECK and the OpenAPI propertyNames pattern). */
export const VARIABLE_NAME = /^[a-z][a-z0-9_]{0,47}$/;

const variables = z
  .record(z.string().regex(VARIABLE_NAME, "validation.variable_name"), decimal)
  .refine((v) => Object.keys(v).length <= 30, "validation.max_properties");
const evidenceIds = z
  .array(uuid)
  .max(50)
  .refine((ids) => new Set(ids).size === ids.length, "validation.unique_items");

export const benefitMeasurementCreate = z.strictObject({
  periodStart: businessDate.optional(),
  periodEnd: businessDate.optional(),
  amount: moneyDecimal.nullable().optional(),
  kpiValue: measureDecimal.nullable().optional(),
  missingReason: freeText(3, 1000).optional(),
  attribution: freeText(1, 4000).optional(),
  assumptions: freeText(1, 8000).optional(),
  formulaVersionId: uuid.optional(),
  variables: variables.optional(),
  evidenceIds: evidenceIds.optional(),
  submit: z.boolean().optional(),
});
export type BenefitMeasurementCreate = z.infer<typeof benefitMeasurementCreate>;

export const benefitMeasurementUpdate = atLeastOne({
  periodStart: nullableDate.optional(),
  periodEnd: nullableDate.optional(),
  amount: moneyDecimal.nullable().optional(),
  kpiValue: measureDecimal.nullable().optional(),
  missingReason: freeText(3, 1000).nullable().optional(),
  attribution: freeText(1, 4000).nullable().optional(),
  assumptions: freeText(1, 8000).nullable().optional(),
  evidenceIds: evidenceIds.optional(),
});
export type BenefitMeasurementUpdate = z.infer<typeof benefitMeasurementUpdate>;

export const financeValidationItemDecision = z.strictObject({
  decision: z.enum(["accepted", "rejected"]),
  note: freeText(1, 2000).optional(),
});
export type FinanceValidationItemDecision = z.infer<typeof financeValidationItemDecision>;

/**
 * The decision body. `items` is a strict object whose six members are OPTIONAL at the schema level, so a decision that
 * leaves one out (e.g. the measurement period) reaches the API's 422 finance_validation.content_incomplete with the
 * missing items named (REQ-S08-015), not a generic 400.
 */
export const financeValidationDecision = z.strictObject({
  decision: z.enum(["approved", "rejected"]),
  items: z.strictObject({
    baseline: financeValidationItemDecision.optional(),
    attribution: financeValidationItemDecision.optional(),
    calculation: financeValidationItemDecision.optional(),
    evidence: financeValidationItemDecision.optional(),
    measurementPeriod: financeValidationItemDecision.optional(),
    assumptions: financeValidationItemDecision.optional(),
  }),
  approvedAmount: moneyDecimal.nullable().optional(),
  note: freeText(1, 2000).optional(),
});
export type FinanceValidationDecision = z.infer<typeof financeValidationDecision>;

/** The items a decision leaves out, in FINANCE_ITEMS order (empty when all six are decided). */
export function missingFinanceItems(items: Partial<Record<FinanceItem, unknown>>): FinanceItem[] {
  const given = new Map(Object.entries(items));
  return FINANCE_ITEMS.filter((k) => given.get(k) === undefined);
}

/** The English list of missing items for the content_incomplete detail ("measurement period, assumptions"). */
export function financeItemsText(missing: readonly FinanceItem[]): string {
  const words: Readonly<Record<FinanceItem, string>> = {
    baseline: "baseline",
    attribution: "attribution/counterfactual",
    calculation: "calculation",
    evidence: "evidence",
    measurementPeriod: "measurement period",
    assumptions: "assumptions",
  };
  return missing.map((m) => words[m]).join(", ");
}

export const financeValidationAmendment = z.strictObject({ correctedAmount: moneyDecimal, reason });
export type FinanceValidationAmendment = z.infer<typeof financeValidationAmendment>;

export const financeValidationListQuery = z.strictObject({ status: z.enum(FINANCE_VALIDATION_STATUSES).optional() });
export const benefitTotalsQuery = z.strictObject({ initiativeId: uuid.optional() });

// ------------------------------------------------------------------------------------------------ responses

export const benefitValueLine = z.strictObject({
  periodStart: nullableDate,
  periodEnd: nullableDate,
  amount: decimal.nullable(),
  kpiValue: decimal.nullable(),
  recordType: z.enum(["benefit_plan_value", "benefit_measurement"]),
  recordId: uuid,
  basis: z.enum(["validated", "provisional"]).nullable(),
});
export type BenefitValueLine = z.infer<typeof benefitValueLine>;

export const benefitValueSeries = z.strictObject({
  state: benefitValueState,
  total: benefitAmount,
  count: z.number().int().min(0),
  lines: z.array(benefitValueLine),
});
export type BenefitValueSeries = z.infer<typeof benefitValueSeries>;

export const benefitValues = z.strictObject({
  benefitId: uuid,
  currency,
  series: z.array(benefitValueSeries).length(7),
});
export type BenefitValues = z.infer<typeof benefitValues>;

export const benefitPlanValue = z.strictObject({
  id: uuid,
  benefitId: uuid,
  valueKind: z.enum(["planned", "forecast"]),
  periodStart: businessDate,
  periodEnd: businessDate,
  amount: decimal.nullable(),
  kpiValue: decimal.nullable(),
  currency,
  note: z.string().nullable(),
  version,
  createdAt: timestamp,
  createdBy: uuid,
  updatedAt: timestamp,
});
export type BenefitPlanValue = z.infer<typeof benefitPlanValue>;

export const benefitMeasurementInput = z.strictObject({
  variableName: z.string(),
  kpiActualId: nullableUuid,
  kpiValueNo: z.number().int().min(1).nullable(),
  value: decimal,
  periodStart: businessDate,
  periodEnd: businessDate,
});
export type BenefitMeasurementInput = z.infer<typeof benefitMeasurementInput>;

export const benefitMeasurement = z.strictObject({
  id: uuid,
  benefitId: uuid,
  measurementNo: z.number().int().min(1),
  kind: z.enum(BENEFIT_MEASUREMENT_KINDS),
  correctsMeasurementId: nullableUuid,
  source: z.enum(BENEFIT_MEASUREMENT_SOURCES),
  calculationRunId: nullableUuid,
  benefitCalculationId: nullableUuid,
  formulaVersionId: nullableUuid,
  periodStart: nullableDate,
  periodEnd: nullableDate,
  amount: decimal.nullable(),
  kpiValue: decimal.nullable(),
  currency,
  missingReason: z.string().nullable(),
  attribution: z.string().nullable(),
  assumptions: z.string().nullable(),
  status: z.enum(BENEFIT_MEASUREMENT_STATUSES),
  sustainPhase: z.boolean(),
  validatedAmount: decimal.nullable(),
  basis: z.enum(["validated", "provisional"]),
  inputs: z.array(benefitMeasurementInput),
  evidenceIds: z.array(uuid),
  financeValidationId: nullableUuid,
  submittedBy: nullableUuid,
  submittedAt: nullableTimestamp,
  decidedBy: nullableUuid,
  decidedAt: nullableTimestamp,
  reason: z.string().nullable(),
  version,
  createdAt: timestamp,
  createdBy: uuid,
  updatedAt: timestamp,
});
export type BenefitMeasurement = z.infer<typeof benefitMeasurement>;
export const benefitMeasurementPage = page(benefitMeasurement);

/** The immutable snapshot presented to the validator: exactly the six keys (finance_validation_content_complete). */
export const financeValidationContent = z.strictObject({
  baseline: z.strictObject({
    value: decimal.nullable(),
    unit: z.string().nullable(),
    date: nullableDate,
    baselineId: nullableUuid,
    counterfactual: z.string().nullable(),
    validationStatus: z.enum(["unvalidated", "validated", "rejected"]),
  }),
  attribution: z.string().nullable(),
  calculation: z.strictObject({
    formulaVersionId: nullableUuid,
    benefitCalculationId: nullableUuid,
    amount: decimal.nullable(),
    kpiValue: decimal.nullable(),
    currency,
    inputs: z.array(benefitMeasurementInput),
  }),
  evidence: z.array(uuid),
  measurementPeriod: z.strictObject({ start: businessDate, end: businessDate }),
  assumptions: z.string().nullable(),
});
export type FinanceValidationContent = z.infer<typeof financeValidationContent>;

const itemOrNull = financeValidationItemDecision.nullable();
export const financeValidation = z.strictObject({
  id: uuid,
  benefitId: uuid,
  benefitMeasurementId: uuid,
  kind: z.enum(FINANCE_VALIDATION_KINDS),
  correctsValidationId: nullableUuid,
  assigneeUserId: nullableUuid,
  status: z.enum(FINANCE_VALIDATION_STATUSES),
  content: financeValidationContent,
  items: z.strictObject({
    baseline: itemOrNull,
    attribution: itemOrNull,
    calculation: itemOrNull,
    evidence: itemOrNull,
    measurementPeriod: itemOrNull,
    assumptions: itemOrNull,
  }),
  approvedAmount: decimal.nullable(),
  decisionNote: z.string().nullable(),
  decidedBy: nullableUuid,
  decidedAt: nullableTimestamp,
  reason: z.string().nullable(),
  version,
  createdAt: timestamp,
  createdBy: uuid,
  updatedAt: timestamp,
});
export type FinanceValidation = z.infer<typeof financeValidation>;
export const financeValidationPage = page(financeValidation);

export const benefitTotalLine = z.strictObject({
  valueClass: z.enum(BENEFIT_TOTAL_CLASSES),
  state: benefitValueState,
  total: benefitAmount,
  count: z.number().int().min(0),
});
export type BenefitTotalLine = z.infer<typeof benefitTotalLine>;

export const benefitTotalsCurrency = z.strictObject({
  currency,
  lines: z.array(benefitTotalLine),
  pendingOverlap: z.array(benefitTotalLine),
  gross: z.strictObject({ planned: benefitAmount, validated: benefitAmount }),
  implementationCost: z.strictObject({ cash: benefitAmount, nonCash: benefitAmount, total: benefitAmount }),
  net: z.strictObject({ planned: benefitAmount, validated: benefitAmount }),
});
export type BenefitTotalsCurrency = z.infer<typeof benefitTotalsCurrency>;

export const benefitTotals = z.strictObject({
  scope: z.enum(["transformation", "initiative", "organization"]),
  scopeId: uuid,
  allocated: z.boolean(),
  transformationIds: z.array(uuid),
  currencies: z.array(benefitTotalsCurrency),
  nonFinancialCount: z.number().int().min(0),
  excluded: z.array(z.strictObject({ benefitId: uuid, code: z.string(), reason: benefitExclusionReason })),
  computedAt: timestamp,
});
export type BenefitTotals = z.infer<typeof benefitTotals>;

// ------------------------------------------------------------------------------------------------ outbox payloads

/** benefit.evidence_submitted v1: one per submitted measurement (the submit transaction; consumer benefits.finance_queue). */
export const benefitEvidenceSubmittedV1 = z.strictObject({
  benefitId: uuid,
  measurementId: uuid,
  transformationId: uuid,
});

/** benefit.value_validated / benefit.value_rejected v1: one per Finance decision (the decision transaction). */
export const benefitValueDecidedV1 = z.strictObject({
  benefitId: uuid,
  measurementId: uuid,
  financeValidationId: uuid,
  transformationId: uuid,
  approvedAmount: decimal.nullable(),
  decidedBy: uuid,
});

/**
 * benefit.variance_evaluated v1: after a value is validated or a pending value is created (slice E's corrective-action
 * rule, REQ-PB-085). `offTrack` is null (Unknown) when the period has no planned value, never false.
 */
export const benefitVarianceEvaluatedV1 = z.strictObject({
  benefitId: uuid,
  measurementId: uuid,
  periodStart: businessDate,
  periodEnd: businessDate,
  plannedAmount: decimal.nullable(),
  measuredAmount: decimal.nullable(),
  variance: decimal.nullable(),
  offTrack: z.boolean().nullable(),
});

// ------------------------------------------------------------------------------------------------ the Finance snapshot

/** The plain facts the six-key snapshot is built from (database rows, snake_case as stored). */
export interface FinanceSnapshotFacts {
  readonly benefit: {
    readonly baseline_value: string | null;
    readonly baseline_unit: string | null;
    readonly baseline_date: string | null;
    readonly baseline_id: string | null;
    readonly counterfactual: string | null;
    readonly baseline_validation_status: string;
  };
  readonly measurement: {
    readonly formula_version_id: string | null;
    readonly benefit_calculation_id: string | null;
    readonly amount: string | null;
    readonly kpi_value: string | null;
    readonly currency: string;
    readonly attribution: string | null;
    readonly assumptions: string | null;
    readonly period_start: string | null;
    readonly period_end: string | null;
  };
  readonly inputs: readonly BenefitMeasurementInput[];
  readonly evidenceIds: readonly string[];
}

/**
 * The immutable content snapshot of a Finance queue item or correction (ADR-0030 §4): exactly the six keys baseline,
 * attribution, calculation, evidence, measurementPeriod, assumptions, parsed with the strict schema before insert (so
 * the stored jsonb is validated JSON, not a free blob). Throws when the measurement has no period: a validation
 * without a measurement period is refused (REQ-S08-015).
 */
export function buildFinanceContent(f: FinanceSnapshotFacts): FinanceValidationContent {
  return financeValidationContent.parse({
    baseline: {
      value: f.benefit.baseline_value,
      unit: f.benefit.baseline_unit,
      date: f.benefit.baseline_date,
      baselineId: f.benefit.baseline_id,
      counterfactual: f.benefit.counterfactual,
      validationStatus: f.benefit.baseline_validation_status,
    },
    attribution: f.measurement.attribution,
    calculation: {
      formulaVersionId: f.measurement.formula_version_id,
      benefitCalculationId: f.measurement.benefit_calculation_id,
      amount: f.measurement.amount,
      kpiValue: f.measurement.kpi_value,
      currency: f.measurement.currency.trim(),
      inputs: f.inputs,
    },
    evidence: f.evidenceIds,
    measurementPeriod: { start: f.measurement.period_start, end: f.measurement.period_end },
    assumptions: f.measurement.assumptions,
  });
}
