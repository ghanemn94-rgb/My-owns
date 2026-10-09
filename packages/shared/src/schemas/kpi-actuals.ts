// P4 slice A zod mirrors of KBE-C (kpi-benefits-engineer, T-DG4-KBE-C; p4-work-split §A.3): reporting periods, KPI
// actual slots with their value versions, reviews and evidence, the routine-update submission and its downstream list,
// calculation runs and KPI evaluations, the KPI status panel (seven elements) and RAG overrides, mirroring
// docs/api/openapi.yaml 1.3.0-p4 (ADR-0027 §3, §6-§8, §10, §12; ADR-0028 §6). Values are decimal strings (ADR-0019) and
// percentages are fractions (0.12 = 12 %), never JSON numbers. Unknown, Stale and Not computable are statuses with a
// reason code, never 0 or green. Free text goes through `freeText` (S-1).
//
// Also the internal outbox payloads (ADR-0008) of the pipeline events: kpi.actual_accepted (API, the accept
// transaction), kpi.values_recalculated and kpi.deviation_evaluated (worker, the run's transaction). They are not part
// of the HTTP contract; events.ts registers them.
import { z } from "zod";
import { currency, freeText, timestamp, uuid, version } from "./common.ts";
import { businessDate, decimal, kpiFrequency, kpiUnitKind, measureDecimal } from "./kpi.ts";
import { kpiScopeKind, kpiSubmissionRoute, kpiToleranceMode } from "./kpi-versions.ts";

const nullableUuid = uuid.nullable();
const nullableTimestamp = timestamp.nullable();
const nullableDecimal = decimal.nullable();
const nullableMeasure = measureDecimal.nullable();
const nullableDate = businessDate.nullable();
const page = <T extends z.ZodType>(item: T) =>
  z.strictObject({ items: z.array(item), nextCursor: z.string().nullable() });

// ------------------------------------------------------------------------------------------------ enums

export const REPORTING_PERIOD_STATUSES = ["scheduled", "open", "closed"] as const;
export const REPORTING_PERIOD_BASES = ["calendar", "weeks"] as const;
export const KPI_ACTUAL_STATUSES = ["draft", "submitted", "accepted", "rejected"] as const;
export const KPI_ACTUAL_ACTIONS = ["save_draft", "submit"] as const;
export const KPI_REVIEW_OUTCOMES = ["accept", "reject", "direct_accept"] as const;
export const KPI_DOWNSTREAM_KINDS = [
  "kpi_panel",
  "formula_kpi",
  "outcome_kpi",
  "executive_overview_outcomes",
  "dashboard",
  "benefit",
] as const;
export const KPI_FINANCE_REVIEW = ["pending", "not_applicable", "unknown"] as const;
export const KPI_RAGS = ["green", "amber", "red", "unknown", "stale", "not_computable"] as const;
export const KPI_OVERRIDE_RAGS = ["green", "amber", "red"] as const;
export const KPI_VALUE_STATUSES = ["ok", "unknown", "stale", "not_computable"] as const;
export const KPI_TRENDS = ["improving", "worsening", "flat", "not_comparable", "unknown"] as const;
export const CALCULATION_TRIGGER_KINDS = [
  "actual_accepted",
  "threshold_changed",
  "trajectory_approved",
  "version_activated",
] as const;
export const CALCULATION_TRIGGER_RECORD_TYPES = [
  "kpi_actual",
  "kpi_rag_threshold",
  "target_trajectory",
  "kpi_version",
] as const;

export const reportingPeriodStatus = z.enum(REPORTING_PERIOD_STATUSES);
export const kpiActualStatus = z.enum(KPI_ACTUAL_STATUSES);
export const kpiRag = z.enum(KPI_RAGS);
export const kpiOverrideRag = z.enum(KPI_OVERRIDE_RAGS);
export const kpiValueStatus = z.enum(KPI_VALUE_STATUSES);
export const kpiTrend = z.enum(KPI_TRENDS);
/** OpenAPI `KpiReasonCode`: the i18n key of an Unknown / Stale / Not computable reason. */
export const kpiReasonCode = z.string().regex(/^kpi\.[a-z_]{1,60}$/);
const explanationKey = z.string().regex(/^kpi\.rag\.[a-z_]{1,60}$/);
const periodLabel = z.string().regex(/^[0-9A-Za-z][0-9A-Za-z_.-]{0,31}$/, "validation.period_label");

// ------------------------------------------------------------------------------------------------ reporting periods

export const reportingPeriodCreate = z.strictObject({
  frequency: kpiFrequency,
  periodLabel,
  periodStart: businessDate,
  periodEnd: businessDate,
  basis: z.enum(REPORTING_PERIOD_BASES).default("calendar"),
  weekCount: z.number().int().min(1).max(53).nullable().optional(),
  updateDueDate: nullableDate.optional(),
});
export type ReportingPeriodCreate = z.infer<typeof reportingPeriodCreate>;

export const reportingPeriod = z.strictObject({
  id: uuid,
  organizationId: uuid,
  frequency: kpiFrequency,
  periodLabel: z.string(),
  periodStart: businessDate,
  periodEnd: businessDate,
  lengthDays: z.number().int().min(1),
  basis: z.enum(REPORTING_PERIOD_BASES),
  weekCount: z.number().int().min(1).max(53).nullable(),
  updateDueDate: nullableDate,
  status: reportingPeriodStatus,
  openedAt: nullableTimestamp,
  closedAt: nullableTimestamp,
  version,
  createdAt: timestamp,
  updatedAt: timestamp,
});
export type ReportingPeriod = z.infer<typeof reportingPeriod>;
export const reportingPeriodPage = page(reportingPeriod);

// ------------------------------------------------------------------------------------------------ actuals

const valueEntryFields = {
  action: z.enum(KPI_ACTUAL_ACTIONS),
  value: nullableMeasure.optional(),
  numerator: nullableMeasure.optional(),
  denominator: nullableMeasure.optional(),
  milestoneAchieved: z.boolean().nullable().optional(),
  achievedOn: nullableDate.optional(),
  currency: currency.nullable().optional(),
  missingReason: freeText(1, 1000).nullable().optional(),
  dataAsOf: businessDate,
  comment: freeText(1, 4000).nullable().optional(),
  evidenceIds: z
    .array(uuid)
    .max(20)
    .refine((ids) => new Set(ids).size === ids.length, "validation.unique_items")
    .optional(),
};

/** KpiActualValueEntry: a new value version of an existing slot. */
export const kpiActualValueEntry = z.strictObject(valueEntryFields);
export type KpiActualValueEntry = z.infer<typeof kpiActualValueEntry>;

/** KpiActualEntry: the first value of a slot (the value entry plus the slot). */
export const kpiActualEntry = z.strictObject({
  scopeKind: kpiScopeKind,
  scopeId: uuid,
  reportingPeriodId: uuid,
  ...valueEntryFields,
});
export type KpiActualEntry = z.infer<typeof kpiActualEntry>;

export const kpiActualDecision = z.strictObject({ comment: freeText(1, 2000).nullable().optional() });

export const kpiActualValue = z.strictObject({
  valueNo: z.number().int().min(1),
  kpiVersionId: uuid,
  value: nullableDecimal,
  numerator: nullableDecimal,
  denominator: nullableDecimal,
  milestoneAchieved: z.boolean().nullable(),
  achievedOn: nullableDate,
  currency: currency.nullable(),
  missingReason: z.string().nullable(),
  dataAsOf: businessDate,
  comment: z.string().nullable(),
  evidenceIds: z.array(uuid),
  enteredAt: timestamp,
  enteredBy: uuid,
  businessDate,
});

export const kpiActualReview = z.strictObject({
  valueNo: z.number().int().min(1),
  outcome: z.enum(KPI_REVIEW_OUTCOMES),
  reason: z.string().nullable(),
  decidedBy: uuid,
  onBehalfOfUserId: nullableUuid,
  decidedAt: timestamp,
});

export const kpiActual = z.strictObject({
  id: uuid,
  transformationId: uuid,
  kpiDefinitionId: uuid,
  scopeKind: kpiScopeKind,
  scopeId: uuid,
  reportingPeriodId: uuid,
  periodStart: businessDate,
  periodEnd: businessDate,
  periodLabel: z.string(),
  currentValueNo: z.number().int().min(1),
  acceptedValueNo: z.number().int().min(1).nullable(),
  status: kpiActualStatus,
  route: kpiSubmissionRoute,
  submittedBy: nullableUuid,
  submittedAt: nullableTimestamp,
  decidedBy: nullableUuid,
  decidedAt: nullableTimestamp,
  decisionReason: z.string().nullable(),
  values: z.array(kpiActualValue),
  reviews: z.array(kpiActualReview),
  version,
  createdAt: timestamp,
  createdBy: uuid,
  updatedAt: timestamp,
});
export type KpiActual = z.infer<typeof kpiActual>;
export const kpiActualPage = page(kpiActual);

export const kpiDownstreamItem = z.strictObject({
  kind: z.enum(KPI_DOWNSTREAM_KINDS),
  id: nullableUuid,
  labelKey: z.string(),
});
export type KpiDownstreamItem = z.infer<typeof kpiDownstreamItem>;

export const kpiActualSubmission = z.strictObject({
  actual: kpiActual,
  reviewPending: z.boolean(),
  downstream: z.array(kpiDownstreamItem),
  financeReview: z.enum(KPI_FINANCE_REVIEW),
});
export type KpiActualSubmission = z.infer<typeof kpiActualSubmission>;

export const kpiActualListQuery = z.strictObject({
  cursor: z.string().optional(),
  limit: z.string().optional(),
  scopeKind: kpiScopeKind.optional(),
  scopeId: uuid.optional(),
  reportingPeriodId: uuid.optional(),
  status: kpiActualStatus.optional(),
});

// ------------------------------------------------------------------------------------------------ runs and evaluations

export const kpiEvaluation = z.strictObject({
  id: uuid,
  kpiDefinitionId: uuid,
  kpiVersionId: uuid,
  scopeKind: kpiScopeKind,
  scopeId: uuid,
  reportingPeriodId: uuid,
  periodLabel: z.string(),
  valueBasis: z.enum(["period", "cumulative"]),
  value: nullableDecimal,
  valueStatus: kpiValueStatus,
  valueReason: kpiReasonCode.nullable(),
  valueSource: z.enum(["entered", "rolled_up", "formula", "none"]),
  currency: currency.nullable(),
  inputs: z.record(z.string(), z.unknown()),
  rounding: z.record(z.string(), z.unknown()).nullable(),
  expectedValue: nullableDecimal,
  finalTarget: nullableDecimal,
  variance: nullableDecimal,
  varianceRatio: nullableDecimal,
  comparisonFlag: z.enum(["negative_baseline", "not_comparable", "zero_base"]).nullable(),
  trend: kpiTrend,
  dataAsOf: nullableDate,
  calculatedRag: kpiRag,
  deviation: z.enum(["favourable", "within", "adverse", "unknown"]),
  thresholdId: nullableUuid,
  thresholdSource: z.enum(["configured", "default", "none"]),
  targetTrajectoryId: nullableUuid,
  explanationKey,
  explanationParams: z.record(z.string(), z.unknown()),
  evaluatedAt: timestamp,
});
export type KpiEvaluation = z.infer<typeof kpiEvaluation>;

export const calculationRun = z.strictObject({
  id: uuid,
  seq: z.string().regex(/^[0-9]{1,19}$/),
  transformationId: uuid,
  triggerKind: z.enum(CALCULATION_TRIGGER_KINDS),
  triggerRecordType: z.enum(CALCULATION_TRIGGER_RECORD_TYPES),
  triggerRecordId: uuid,
  triggerSlot: z.number().int().min(1),
  status: z.enum(["completed", "failed"]),
  errorCode: z.string().nullable(),
  evaluationCount: z.number().int().min(0),
  findingCount: z.number().int().min(0),
  formulaEngineVersion: z.string(),
  kpiRulesVersion: z.string(),
  startedAt: timestamp,
  completedAt: timestamp,
  evaluations: z.array(kpiEvaluation),
});
export type CalculationRun = z.infer<typeof calculationRun>;
export const calculationRunPage = page(calculationRun);

// ------------------------------------------------------------------------------------------------ status panel

export const ragOverrideInForce = z.strictObject({
  id: uuid,
  rag: kpiOverrideRag,
  reason: z.string(),
  evidenceId: uuid,
  expiresAt: timestamp,
  createdBy: uuid,
});

export const kpiStatusExplanation = z.strictObject({
  key: explanationKey,
  params: z.record(z.string(), z.unknown()),
  thresholdSource: z.enum(["configured", "default", "none"]),
  thresholdVersion: z.number().int().min(1).nullable(),
  toleranceMode: kpiToleranceMode.nullable(),
  amberThreshold: nullableDecimal,
  redThreshold: nullableDecimal,
  trajectoryVersion: z.number().int().min(1).nullable(),
});

export const kpiStatus = z.strictObject({
  kpiDefinitionId: uuid,
  kpiName: z.string(),
  kpiVersionId: nullableUuid,
  unitKind: kpiUnitKind,
  currency: currency.nullable(),
  scopeKind: kpiScopeKind,
  scopeId: uuid,
  reportingPeriodId: nullableUuid,
  periodLabel: z.string().nullable(),
  actual: nullableDecimal,
  actualStatus: kpiValueStatus,
  actualReason: kpiReasonCode.nullable(),
  expectedToDate: nullableDecimal,
  expectedReason: kpiReasonCode.nullable(),
  finalTarget: nullableDecimal,
  finalTargetDate: nullableDate,
  variance: nullableDecimal,
  varianceRatio: nullableDecimal,
  changeLabel: z.enum(["pp", "percent", "unit"]),
  trend: kpiTrend,
  freshness: z.strictObject({
    status: z.enum(["fresh", "stale", "unknown"]),
    dataAsOf: nullableDate,
    staleAfterDays: z.number().int().min(1).nullable(),
  }),
  explanation: kpiStatusExplanation,
  calculatedRag: kpiRag,
  displayedRag: kpiRag,
  override: ragOverrideInForce.nullable(),
  evaluationId: nullableUuid,
  calculationRunId: nullableUuid,
});
export type KpiStatus = z.infer<typeof kpiStatus>;
export const kpiStatusPage = page(kpiStatus);

// ------------------------------------------------------------------------------------------------ RAG overrides

/** reason, evidenceId and expiresAt are required by the business rule (their own 422s), not by the schema. */
export const ragOverrideCreate = z.strictObject({
  scopeKind: kpiScopeKind,
  scopeId: uuid,
  reportingPeriodId: uuid,
  overrideRag: kpiOverrideRag,
  reason: freeText(1, 2000).nullable().optional(),
  evidenceId: nullableUuid.optional(),
  expiresAt: nullableTimestamp.optional(),
});
export type RagOverrideCreate = z.infer<typeof ragOverrideCreate>;

export const ragOverride = z.strictObject({
  id: uuid,
  transformationId: uuid,
  kpiDefinitionId: uuid,
  scopeKind: kpiScopeKind,
  scopeId: uuid,
  reportingPeriodId: uuid,
  overrideRag: kpiOverrideRag,
  calculatedRag: kpiRag,
  kpiEvaluationId: nullableUuid,
  reason: z.string(),
  evidenceId: uuid,
  expiresAt: timestamp,
  inForce: z.boolean(),
  status: z.enum(["active", "revoked"]),
  revokedBy: nullableUuid,
  revokedAt: nullableTimestamp,
  revokeReason: z.string().nullable(),
  version,
  createdAt: timestamp,
  createdBy: uuid,
  updatedAt: timestamp,
});
export type RagOverride = z.infer<typeof ragOverride>;
export const ragOverridePage = page(ragOverride);

// ------------------------------------------------------------------------------------------------ outbox payloads

/** kpi.actual_accepted v1: one accepted value of a slot (the accept transaction; consumer kpi.recalculate). */
export const kpiActualAcceptedV1 = z.strictObject({
  kpiActualId: uuid,
  valueNo: z.number().int().min(1),
  kpiDefinitionId: uuid,
  transformationId: uuid,
  scopeKind: kpiScopeKind,
  scopeId: uuid,
  reportingPeriodId: uuid,
});

/** kpi.values_recalculated v1: exactly one per calculation run (slice B flags benefit validation; slice J views). */
export const kpiValuesRecalculatedV1 = z.strictObject({
  runId: uuid,
  transformationId: uuid,
  kpiDefinitionIds: z.array(uuid),
  reportingPeriodId: uuid.nullable(),
});

/** kpi.deviation_evaluated v1: one per evaluation of basis `period` (slice E's corrective-action rule, M0227). */
export const kpiDeviationEvaluatedV1 = z.strictObject({
  evaluationId: uuid,
  transformationId: uuid,
  kpiDefinitionId: uuid,
  scopeKind: kpiScopeKind,
  scopeId: uuid,
  reportingPeriodId: uuid,
  calculatedRag: kpiRag,
  deviation: z.enum(["favourable", "within", "adverse", "unknown"]),
  previousCalculatedRag: kpiRag.nullable(),
});
