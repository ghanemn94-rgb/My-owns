// P4 slice A zod mirrors of KBE-B (kpi-benefits-engineer, T-DG4-KBE-B; p4-work-split §A.2): the KPI dictionary v2
// (definition + active version), KPI versions and their formula inputs, versioned RAG thresholds, target trajectories
// and data-quality findings, mirroring docs/api/openapi.yaml 1.3.0-p4 (ADR-0027 §1-§5, §9, §12; ADR-0028 §5, §8).
// Values are decimal strings (ADR-0019) and percentages are fractions (0.12 = 12 %), never JSON numbers. Request
// bodies are as strict as the contract (additionalProperties: false, minProperties: 1 on the update) and refuse a
// decimal that does not fit its numeric(24,6) column (no silent rounding). Free text goes through `freeText` (S-1).
//
// Also the internal outbox payloads (ADR-0008) of the three slice A change events KBE-B writes in the same transaction
// as their change: kpi.threshold_changed, kpi.trajectory_approved and kpi.version_activated (ADR-0027 §8 step 5). They
// are not part of the HTTP contract; events.ts registers them.
import { z } from "zod";
import { currency, freeText, timestamp, uuid, version } from "./common.ts";
import { businessDate, decimal, kpiDefinition, measureDecimal } from "./kpi.ts";

const nullableUuid = uuid.nullable();
const nullableTimestamp = timestamp.nullable();
const nullableDecimal = decimal.nullable();
const nullableMeasure = measureDecimal.nullable();
const nullableDate = businessDate.nullable();
const page = <T extends z.ZodType>(item: T) =>
  z.strictObject({ items: z.array(item), nextCursor: z.string().nullable() });

// ------------------------------------------------------------------------------------------------ enums

export const KPI_MEASURE_TYPES = [
  "higher_is_better",
  "lower_is_better",
  "acceptable_band",
  "binary_milestone",
] as const;
export const KPI_VALUE_NATURES = ["flow", "stock", "ratio", "milestone"] as const;
export const KPI_SCOPE_KINDS = ["transformation", "business_unit", "initiative"] as const;
export const KPI_AGGREGATION_RULES = ["sum", "last_value", "weighted_ratio", "custom_formula", "none"] as const;
export const KPI_VERSION_STATUSES = ["draft", "active", "superseded", "withdrawn"] as const;
export const KPI_SUBMISSION_ROUTES = ["review", "direct_accept"] as const;
export const KPI_DEFINITION_APPROVALS = ["direct", "business_approval"] as const;
export const KPI_CALCULATION_METHODS = ["entered", "formula"] as const;
export const KPI_INPUT_BASES = ["period", "cumulative"] as const;
export const KPI_TOLERANCE_MODES = ["relative", "absolute"] as const;
export const TARGET_TRAJECTORY_STATUSES = ["draft", "approved", "superseded", "withdrawn"] as const;
export const TARGET_TRAJECTORY_SOURCES = ["api", "outcome_kpi_import", "outcome_kpi_backfill"] as const;
export const TARGET_TRAJECTORY_INTERPOLATIONS = ["linear", "step"] as const;
export const DATA_QUALITY_RULE_CODES = [
  "missing_actual",
  "stale",
  "out_of_range",
  "evidence_missing",
  "zero_denominator",
  "not_comparable",
  "negative_baseline",
  "scope_missing",
] as const;
export const DATA_QUALITY_STATUSES = ["open", "resolved", "dismissed"] as const;
export const KPI_MISSING_FOR_USE = [
  "definition_active",
  "active_version",
  "aggregation_rule",
  "approved_trajectory",
] as const;

export const kpiMeasureType = z.enum(KPI_MEASURE_TYPES);
export const kpiValueNature = z.enum(KPI_VALUE_NATURES);
export const kpiScopeKind = z.enum(KPI_SCOPE_KINDS);
export const kpiAggregationRule = z.enum(KPI_AGGREGATION_RULES);
export const kpiSubmissionRoute = z.enum(KPI_SUBMISSION_ROUTES);
export const kpiDefinitionApproval = z.enum(KPI_DEFINITION_APPROVALS);
export const kpiInputBasis = z.enum(KPI_INPUT_BASES);
export const kpiToleranceMode = z.enum(KPI_TOLERANCE_MODES);
/** OpenAPI `PartyCode` (governance_party.code), e.g. SP, BO, STEERCO. */
export const partyCode = z.string().regex(/^[A-Z][A-Z0-9_]{0,31}$/, "validation.party_code");

// ------------------------------------------------------------------------------------------------ KPI versions

export const kpiDataQualityRule = z.strictObject({
  staleAfterDays: z.number().int().min(1).max(3660),
  validMin: nullableMeasure,
  validMax: nullableMeasure,
  evidenceRequired: z.boolean(),
});
/** The request form: every member has its contract default. */
export const kpiDataQualityRuleInput = z.strictObject({
  staleAfterDays: z.number().int().min(1).max(3660).default(45),
  validMin: nullableMeasure.default(null),
  validMax: nullableMeasure.default(null),
  evidenceRequired: z.boolean().default(false),
});
export type KpiDataQualityRule = z.infer<typeof kpiDataQualityRule>;

export const kpiFormulaInput = z.strictObject({
  variableName: z.string().regex(/^[a-z][a-z0-9_]{0,47}$/, "validation.variable_name"),
  sourceKpiDefinitionId: uuid,
  inputBasis: kpiInputBasis,
});
export type KpiFormulaInput = z.output<typeof kpiFormulaInput>;

/** The members KpiVersionUpdate shares with KpiVersionCreate (everything except the formula). */
const versionContentFields = {
  measureType: kpiMeasureType,
  valueNature: kpiValueNature,
  entryScopeKind: kpiScopeKind,
  unitLabel: freeText(1, 50).nullable(),
  numeratorLabel: freeText(1, 200).nullable(),
  denominatorLabel: freeText(1, 200).nullable(),
  calculationDescription: freeText(1, 4000).nullable(),
  aggregationRule: kpiAggregationRule.nullable(),
  stockAdditiveAcrossScopes: z.boolean(),
  ytdStartMonth: z.number().int().min(1).max(12),
  baselineId: nullableUuid,
  baselineValue: nullableMeasure,
  baselineDate: nullableDate,
  targetValue: nullableMeasure,
  targetDate: nullableDate,
  bandLower: nullableMeasure,
  bandUpper: nullableMeasure,
  milestoneDueDate: nullableDate,
  dataQuality: kpiDataQualityRuleInput,
  submissionRoute: kpiSubmissionRoute,
  reviewerPartyCode: partyCode.nullable(),
  definitionApproval: kpiDefinitionApproval,
  changeReason: freeText(3, 2000).nullable(),
};

export const kpiVersionCreate = z.strictObject({
  measureType: kpiMeasureType,
  valueNature: kpiValueNature,
  entryScopeKind: kpiScopeKind.default("transformation"),
  unitLabel: versionContentFields.unitLabel.optional(),
  numeratorLabel: versionContentFields.numeratorLabel.default(null),
  denominatorLabel: versionContentFields.denominatorLabel.default(null),
  calculationMethod: z.enum(KPI_CALCULATION_METHODS).default("entered"),
  calculationDescription: versionContentFields.calculationDescription.default(null),
  formulaExpression: freeText(1, 2000).nullable().default(null),
  formulaInputs: z.array(kpiFormulaInput).max(30).default([]),
  aggregationRule: kpiAggregationRule.nullable().default(null),
  stockAdditiveAcrossScopes: z.boolean().default(false),
  ytdStartMonth: z.number().int().min(1).max(12).default(1),
  baselineId: nullableUuid.default(null),
  baselineValue: nullableMeasure.default(null),
  baselineDate: nullableDate.default(null),
  targetValue: nullableMeasure.default(null),
  targetDate: nullableDate.default(null),
  bandLower: nullableMeasure.default(null),
  bandUpper: nullableMeasure.default(null),
  milestoneDueDate: nullableDate.default(null),
  dataQuality: kpiDataQualityRuleInput.default({
    staleAfterDays: 45,
    validMin: null,
    validMax: null,
    evidenceRequired: false,
  }),
  submissionRoute: kpiSubmissionRoute.default("review"),
  reviewerPartyCode: partyCode.nullable().default(null),
  definitionApproval: kpiDefinitionApproval.default("direct"),
  changeReason: versionContentFields.changeReason.default(null),
});
export type KpiVersionCreate = z.output<typeof kpiVersionCreate>;

/** KpiVersionUpdate: any KpiVersionCreate member except the formula (a different formula is a new draft). */
export const kpiVersionUpdate = z
  .strictObject(
    Object.fromEntries(Object.entries(versionContentFields).map(([k, v]) => [k, v.optional()])) as {
      [K in keyof typeof versionContentFields]: z.ZodOptional<(typeof versionContentFields)[K]>;
    },
  )
  .refine((v) => Object.keys(v).length >= 1, "validation.min_properties");
export type KpiVersionUpdate = z.output<typeof kpiVersionUpdate>;

export const kpiVersion = z.strictObject({
  id: uuid,
  transformationId: uuid,
  kpiDefinitionId: uuid,
  versionNo: z.number().int().min(1),
  status: z.enum(KPI_VERSION_STATUSES),
  measureType: kpiMeasureType,
  valueNature: kpiValueNature,
  entryScopeKind: kpiScopeKind,
  unitKind: z.enum(["currency", "percentage", "count", "ratio", "duration", "score", "other"]),
  unitLabel: z.string().nullable(),
  currency: currency.nullable(),
  frequency: z.enum(["daily", "weekly", "monthly", "quarterly", "annual", "ad_hoc"]),
  numeratorLabel: z.string().nullable(),
  denominatorLabel: z.string().nullable(),
  calculationMethod: z.enum(KPI_CALCULATION_METHODS),
  calculationDescription: z.string().nullable(),
  formulaExpression: z.string().nullable(),
  formulaEngineVersion: z.string().nullable(),
  formulaInputs: z.array(
    z.strictObject({ variableName: z.string(), sourceKpiDefinitionId: uuid, inputBasis: kpiInputBasis }),
  ),
  aggregationRule: kpiAggregationRule.nullable(),
  stockAdditiveAcrossScopes: z.boolean(),
  ytdStartMonth: z.number().int().min(1).max(12),
  baselineId: nullableUuid,
  baselineValue: nullableDecimal,
  baselineDate: nullableDate,
  targetValue: nullableDecimal,
  targetDate: nullableDate,
  bandLower: nullableDecimal,
  bandUpper: nullableDecimal,
  milestoneDueDate: nullableDate,
  dataQuality: kpiDataQualityRule.extend({ validMin: nullableDecimal, validMax: nullableDecimal }),
  submissionRoute: kpiSubmissionRoute,
  reviewerPartyCode: partyCode.nullable(),
  definitionApproval: kpiDefinitionApproval,
  approvalId: nullableUuid,
  changeReason: z.string().nullable(),
  activatedAt: nullableTimestamp,
  activatedBy: nullableUuid,
  supersededAt: nullableTimestamp,
  withdrawnAt: nullableTimestamp,
  withdrawnBy: nullableUuid,
  withdrawReason: z.string().nullable(),
  version,
  createdAt: timestamp,
  createdBy: uuid,
  updatedAt: timestamp,
});
export type KpiVersion = z.infer<typeof kpiVersion>;
export const kpiVersionPage = page(kpiVersion);

export const kpiDictionaryEntry = z.strictObject({
  definition: kpiDefinition,
  activeVersion: kpiVersion.nullable(),
  draftVersionId: nullableUuid,
  missingForUse: z.array(z.enum(KPI_MISSING_FOR_USE)),
});
export type KpiDictionaryEntry = z.infer<typeof kpiDictionaryEntry>;
export const kpiDictionaryPage = page(kpiDictionaryEntry);

export const kpiVersionApprovalRequest = z.strictObject({ requestNote: freeText(1, 4000).nullable().optional() });
/** ReasonRequest (withdraw a draft version or trajectory). */
export const kpiReasonRequest = z.strictObject({ reason: freeText(3, 1000) });

// ------------------------------------------------------------------------------------------------ RAG thresholds

export const kpiRagThresholdCreate = z.strictObject({
  toleranceMode: kpiToleranceMode,
  amberThreshold: measureDecimal,
  redThreshold: measureDecimal,
  reason: freeText(3, 2000),
});
export type KpiRagThresholdCreate = z.output<typeof kpiRagThresholdCreate>;

export const kpiRagThreshold = z.strictObject({
  id: uuid,
  kpiDefinitionId: uuid,
  versionNo: z.number().int().min(1),
  toleranceMode: kpiToleranceMode,
  amberThreshold: decimal,
  redThreshold: decimal,
  reason: z.string(),
  status: z.enum(["active", "superseded"]),
  supersededAt: nullableTimestamp,
  version,
  createdAt: timestamp,
  createdBy: uuid,
});
export type KpiRagThreshold = z.infer<typeof kpiRagThreshold>;
export const kpiRagThresholdPage = page(kpiRagThreshold);

// ------------------------------------------------------------------------------------------------ target trajectories

export const kpiTrajectoryPoint = z.strictObject({ pointDate: businessDate, expectedValue: decimal });
const kpiTrajectoryPointInput = z.strictObject({ pointDate: businessDate, expectedValue: measureDecimal });

export const targetTrajectoryCreate = z
  .strictObject({
    scopeKind: kpiScopeKind,
    scopeId: uuid,
    basis: kpiInputBasis.default("period"),
    interpolation: z.enum(TARGET_TRAJECTORY_INTERPOLATIONS).default("linear"),
    points: z.array(kpiTrajectoryPointInput).min(1).max(120).optional(),
    sourceOutcomeKpiId: uuid.optional(),
  })
  .refine((v) => (v.points === undefined) !== (v.sourceOutcomeKpiId === undefined), {
    message: "validation.trajectory_points_or_source",
    path: ["points"],
  })
  .refine((v) => v.points === undefined || new Set(v.points.map((p) => p.pointDate)).size === v.points.length, {
    message: "validation.trajectory_point_dates_distinct",
    path: ["points"],
  });
export type TargetTrajectoryCreate = z.output<typeof targetTrajectoryCreate>;

export const targetTrajectoryApproval = z.strictObject({ comment: freeText(1, 2000).nullable().optional() });

export const targetTrajectory = z.strictObject({
  id: uuid,
  transformationId: uuid,
  kpiDefinitionId: uuid,
  scopeKind: kpiScopeKind,
  scopeId: uuid,
  versionNo: z.number().int().min(1),
  basis: kpiInputBasis,
  interpolation: z.enum(TARGET_TRAJECTORY_INTERPOLATIONS),
  source: z.enum(TARGET_TRAJECTORY_SOURCES),
  sourceOutcomeKpiId: nullableUuid,
  status: z.enum(TARGET_TRAJECTORY_STATUSES),
  points: z.array(kpiTrajectoryPoint),
  approvedBy: nullableUuid,
  approvedAt: nullableTimestamp,
  supersededAt: nullableTimestamp,
  withdrawnAt: nullableTimestamp,
  withdrawReason: z.string().nullable(),
  version,
  createdAt: timestamp,
  createdBy: uuid,
  updatedAt: timestamp,
});
export type TargetTrajectory = z.infer<typeof targetTrajectory>;
export const targetTrajectoryPage = page(targetTrajectory);

export const targetTrajectoryListQuery = z.strictObject({
  scopeKind: kpiScopeKind.optional(),
  scopeId: uuid.optional(),
});

// ------------------------------------------------------------------------------------------------ data-quality findings

export const dataQualityResolution = z.strictObject({
  outcome: z.enum(["resolved", "dismissed"]),
  note: freeText(3, 2000),
});
export type DataQualityResolution = z.output<typeof dataQualityResolution>;

export const dataQualityFinding = z.strictObject({
  id: uuid,
  transformationId: uuid,
  kpiDefinitionId: uuid,
  scopeKind: kpiScopeKind,
  scopeId: uuid,
  reportingPeriodId: uuid,
  kpiActualId: nullableUuid,
  valueNo: z.number().int().min(1).nullable(),
  ruleCode: z.enum(DATA_QUALITY_RULE_CODES),
  severity: z.enum(["info", "warning"]),
  detailParams: z.record(z.string(), z.unknown()),
  detectedByRunId: uuid,
  detectedAt: timestamp,
  status: z.enum(DATA_QUALITY_STATUSES),
  resolutionNote: z.string().nullable(),
  resolvedBy: nullableUuid,
  resolvedAt: nullableTimestamp,
  version,
  updatedAt: timestamp,
});
export type DataQualityFinding = z.infer<typeof dataQualityFinding>;
export const dataQualityFindingPage = page(dataQualityFinding);

export const dataQualityFindingListQuery = z.strictObject({
  kpiDefinitionId: uuid.optional(),
  status: z.enum(DATA_QUALITY_STATUSES).optional(),
});

// ------------------------------------------------------------------------------------------------ outbox payloads

/** kpi.threshold_changed v1: a new RAG threshold version is in force (key kpi.threshold_changed:<id>:<versionNo>). */
export const kpiThresholdChangedV1 = z.strictObject({
  kpiRagThresholdId: uuid,
  kpiDefinitionId: uuid,
  transformationId: uuid,
  versionNo: z.number().int().min(1),
  occurredAt: timestamp,
});
/** kpi.trajectory_approved v1: an approved trajectory is in force for a KPI and scope. */
export const kpiTrajectoryApprovedV1 = z.strictObject({
  targetTrajectoryId: uuid,
  kpiDefinitionId: uuid,
  transformationId: uuid,
  scopeKind: kpiScopeKind,
  scopeId: uuid,
  versionNo: z.number().int().min(1),
  occurredAt: timestamp,
});
/** kpi.version_activated v1: a KPI version became the active one (the previous one, if any, is superseded). */
export const kpiVersionActivatedV1 = z.strictObject({
  kpiVersionId: uuid,
  kpiDefinitionId: uuid,
  transformationId: uuid,
  versionNo: z.number().int().min(1),
  supersededKpiVersionId: nullableUuid,
  occurredAt: timestamp,
});
