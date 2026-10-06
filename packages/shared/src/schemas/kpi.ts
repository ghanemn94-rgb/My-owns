// P2 kpi-module zod mirrors (kpi-benefits-engineer; T-DG2-ARCH-01B seam): KpiDefinition, Baseline, OutcomeKpi,
// ValuePool and their Create/Update bodies, ValidationDecision, TrajectoryApproval, TrajectoryPoint, Decimal and
// BusinessDate, mirroring docs/api/openapi.yaml. Amounts are decimal strings (ADR-0019), never JSON numbers.
// Exported through ./index.ts (already wired, so no other agent needs to edit the barrel for kpi schemas).
//
// Request bodies are as strict as the contract (additionalProperties: false, minProperties: 1 on updates) and, in
// addition, refuse decimal values that do not fit their target column (no silent rounding; ADR-0019 §4):
// money numeric(20,4) for value-pool amounts, measure numeric(24,6) for baselines, targets and trajectory points.
// The decimal helpers and the value-pool total live in ../value.ts and are re-exported here, because this subpath is
// the one both the API and the web import (`@mth/shared/schemas`).
import { z } from "zod";
import { checkDecimal, DECIMAL_PATTERN, MEASURE_COLUMN, MONEY_COLUMN, type DecimalColumn } from "../value.ts";
import { currency, freeText, timestamp, uuid, version } from "./common.ts";

export * from "../value.ts";

// ------------------------------------------------------------------------------------------------ scalars

/** OpenAPI `Decimal`: exact decimal string, never a number. */
export const decimal = z.string().regex(DECIMAL_PATTERN, "validation.decimal");

/** A request decimal that must also fit its column without rounding. */
export function columnDecimal(column: DecimalColumn) {
  return decimal.refine((v) => checkDecimal(v, column).ok, `validation.decimal_${column.name}_scale`);
}
export const moneyDecimal = columnDecimal(MONEY_COLUMN);
export const measureDecimal = columnDecimal(MEASURE_COLUMN);

const ISO_DATE = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/;

/** True for a real calendar date "YYYY-MM-DD" (2026-02-30 is false). Pure string/integer arithmetic. */
export function isCalendarDate(value: string): boolean {
  const m = ISO_DATE.exec(value);
  if (!m) return false;
  const y = Number.parseInt(m[1]!, 10);
  const mo = Number.parseInt(m[2]!, 10);
  const d = Number.parseInt(m[3]!, 10);
  if (y < 1 || mo < 1 || mo > 12 || d < 1) return false;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1]!;
  return d <= days;
}

/** OpenAPI `BusinessDate`: calendar date in the transformation's time zone; an impossible date is a 400. */
export const businessDate = z.string().refine(isCalendarDate, "validation.business_date");

const nullableUuid = uuid.nullable();
// F-DG2-150: blank (whitespace-only) free text is rejected with `validation.blank`; stored exactly as entered.
const text = freeText;
const archiveReason = text(3, 1000).nullable();
const atLeastOne = <T extends z.ZodRawShape>(shape: T) =>
  z.strictObject(shape).refine((v) => Object.keys(v).length >= 1, "validation.min_properties");

// ------------------------------------------------------------------------------------------------ KPI definition

export const KPI_UNIT_KINDS = ["currency", "percentage", "count", "ratio", "duration", "score", "other"] as const;
export const KPI_POLARITIES = ["higher_is_better", "lower_is_better", "within_band"] as const;
export const KPI_FREQUENCIES = ["daily", "weekly", "monthly", "quarterly", "annual", "ad_hoc"] as const;
export const KPI_DEFINITION_STATUSES = ["draft", "active", "archived"] as const;
export const kpiUnitKind = z.enum(KPI_UNIT_KINDS);
export const kpiPolarity = z.enum(KPI_POLARITIES);
export const kpiFrequency = z.enum(KPI_FREQUENCIES);

const kpiDefinitionFields = {
  name: text(1, 200),
  description: text(1, 4000).nullable(),
  businessPurpose: text(1, 4000).nullable(),
  unitKind: kpiUnitKind,
  unitLabel: text(1, 50).nullable(),
  currency: currency.nullable(),
  polarity: kpiPolarity,
  frequency: kpiFrequency,
  isLeading: z.boolean(),
  dataSource: text(1, 500).nullable(),
  ownerUserId: nullableUuid,
  stewardUserId: nullableUuid,
};

export const kpiDefinition = z.strictObject({
  id: uuid,
  organizationId: uuid,
  transformationId: uuid,
  ...kpiDefinitionFields,
  status: z.enum(KPI_DEFINITION_STATUSES),
  archivedAt: timestamp.nullable(),
  archivedBy: nullableUuid,
  archiveReason,
  version,
  createdAt: timestamp,
  createdBy: uuid,
  updatedAt: timestamp,
  updatedBy: uuid,
});
export type KpiDefinition = z.infer<typeof kpiDefinition>;

export const kpiDefinitionCreate = z.strictObject({
  name: kpiDefinitionFields.name,
  unitKind: kpiDefinitionFields.unitKind,
  polarity: kpiDefinitionFields.polarity,
  description: kpiDefinitionFields.description.optional(),
  businessPurpose: kpiDefinitionFields.businessPurpose.optional(),
  unitLabel: kpiDefinitionFields.unitLabel.optional(),
  currency: kpiDefinitionFields.currency.optional(),
  frequency: kpiDefinitionFields.frequency.optional(),
  isLeading: kpiDefinitionFields.isLeading.optional(),
  dataSource: kpiDefinitionFields.dataSource.optional(),
  ownerUserId: kpiDefinitionFields.ownerUserId.optional(),
  stewardUserId: kpiDefinitionFields.stewardUserId.optional(),
});
export type KpiDefinitionCreate = z.infer<typeof kpiDefinitionCreate>;

export const kpiDefinitionUpdate = atLeastOne(z.object(kpiDefinitionFields).partial().shape);
export type KpiDefinitionUpdate = z.infer<typeof kpiDefinitionUpdate>;

// ------------------------------------------------------------------------------------------------ Baseline

export const BASELINE_SCOPES = ["revenue", "cost", "customer", "operational", "capability"] as const;
export const VALIDATION_STATUSES = ["unvalidated", "validated", "rejected"] as const;
export const RECORD_STATUSES = ["active", "archived"] as const;
export const baselineScope = z.enum(BASELINE_SCOPES);
export const validationStatus = z.enum(VALIDATION_STATUSES);

const validationFields = {
  validationStatus,
  validatedBy: nullableUuid,
  validatedAt: timestamp.nullable(),
  validationNote: text(1, 2000).nullable(),
  validatedRecordVersion: z.number().int().min(1).nullable(),
};
const recordTail = {
  status: z.enum(RECORD_STATUSES),
  archivedAt: timestamp.nullable(),
  archivedBy: nullableUuid,
  archiveReason,
  version,
  createdAt: timestamp,
  createdBy: uuid,
  updatedAt: timestamp,
  updatedBy: uuid,
};

const baselineFields = {
  metric: text(1, 300),
  kpiDefinitionId: nullableUuid,
  value: decimal.nullable(),
  unit: text(1, 50),
  currency: currency.nullable(),
  source: text(1, 1000).nullable(),
  baselineDate: businessDate.nullable(),
  scope: baselineScope,
  ownerUserId: nullableUuid,
};
const baselineRequestFields = { ...baselineFields, value: measureDecimal.nullable() };

export const baseline = z.strictObject({
  id: uuid,
  organizationId: uuid,
  transformationId: uuid,
  ...baselineFields,
  ...validationFields,
  ...recordTail,
});
export type Baseline = z.infer<typeof baseline>;

export const baselineCreate = z.strictObject({
  metric: baselineRequestFields.metric,
  unit: baselineRequestFields.unit,
  scope: baselineRequestFields.scope,
  kpiDefinitionId: baselineRequestFields.kpiDefinitionId.optional(),
  value: baselineRequestFields.value.optional(),
  currency: baselineRequestFields.currency.optional(),
  source: baselineRequestFields.source.optional(),
  baselineDate: baselineRequestFields.baselineDate.optional(),
  ownerUserId: baselineRequestFields.ownerUserId.optional(),
});
export type BaselineCreate = z.infer<typeof baselineCreate>;

export const baselineUpdate = atLeastOne(z.object(baselineRequestFields).partial().shape);
export type BaselineUpdate = z.infer<typeof baselineUpdate>;

// ------------------------------------------------------------------------------------------------ T02 Outcome KPI

export const trajectoryPoint = z.strictObject({ date: businessDate, value: decimal });
export type TrajectoryPoint = z.infer<typeof trajectoryPoint>;
const trajectoryPointRequest = z.strictObject({ date: businessDate, value: measureDecimal });
export const TRAJECTORY_MAX_POINTS = 120;
export const TRAJECTORY_STATUSES = ["draft", "approved"] as const;

const outcomeKpiFields = {
  outcomeId: uuid,
  kpiDefinitionId: uuid,
  baselineId: nullableUuid,
  baselineValue: decimal.nullable(),
  targetValue: decimal.nullable(),
  targetDate: businessDate,
  ownerUserId: nullableUuid,
  leadingIndicatorText: text(1, 1000).nullable(),
  leadingKpiDefinitionId: nullableUuid,
  ordinal: z.number().int().min(1),
  trajectoryPoints: z.array(trajectoryPoint).max(TRAJECTORY_MAX_POINTS),
};
const outcomeKpiRequestFields = {
  ...outcomeKpiFields,
  baselineValue: measureDecimal.nullable(),
  targetValue: measureDecimal.nullable(),
  trajectoryPoints: z.array(trajectoryPointRequest).max(TRAJECTORY_MAX_POINTS),
};

export const outcomeKpi = z.strictObject({
  id: uuid,
  organizationId: uuid,
  transformationId: uuid,
  ...outcomeKpiFields,
  trajectoryStatus: z.enum(TRAJECTORY_STATUSES),
  trajectoryApprovedBy: nullableUuid,
  trajectoryApprovedAt: timestamp.nullable(),
  trajectoryApprovedVersion: z.number().int().min(1).nullable(),
  ...recordTail,
});
export type OutcomeKpi = z.infer<typeof outcomeKpi>;

/** targetDate is REQUIRED: T02 targets are time-bound (REQ-PB-034). The API answers a missing one with 422. */
export const outcomeKpiCreate = z.strictObject({
  outcomeId: outcomeKpiRequestFields.outcomeId,
  kpiDefinitionId: outcomeKpiRequestFields.kpiDefinitionId,
  targetDate: outcomeKpiRequestFields.targetDate,
  baselineId: outcomeKpiRequestFields.baselineId.optional(),
  baselineValue: outcomeKpiRequestFields.baselineValue.optional(),
  targetValue: outcomeKpiRequestFields.targetValue.optional(),
  ownerUserId: outcomeKpiRequestFields.ownerUserId.optional(),
  leadingIndicatorText: outcomeKpiRequestFields.leadingIndicatorText.optional(),
  leadingKpiDefinitionId: outcomeKpiRequestFields.leadingKpiDefinitionId.optional(),
  ordinal: outcomeKpiRequestFields.ordinal.optional(),
  trajectoryPoints: outcomeKpiRequestFields.trajectoryPoints.optional(),
});
export type OutcomeKpiCreate = z.infer<typeof outcomeKpiCreate>;

export const outcomeKpiUpdate = atLeastOne(z.object(outcomeKpiRequestFields).partial().shape);
export type OutcomeKpiUpdate = z.infer<typeof outcomeKpiUpdate>;

// ------------------------------------------------------------------------------------------------ Value pool

export const QUANTIFICATION_STATUSES = ["quantified", "unquantified"] as const;
export const MATERIALITIES = ["material", "not_material", "not_assessed"] as const;
export const CONFIDENCES = ["H", "M", "L"] as const;
export const quantificationStatus = z.enum(QUANTIFICATION_STATUSES);

const valuePoolFields = {
  name: text(1, 300),
  driver: text(1, 1000).nullable(),
  workstreamCode: z.string().nullable(),
  quantificationStatus,
  upsideAmount: decimal.nullable(),
  downsideAmount: decimal.nullable(),
  currency,
  unquantifiedReason: text(1, 2000).nullable(),
  materiality: z.enum(MATERIALITIES),
  confidence: z.enum(CONFIDENCES).nullable(),
  ownerUserId: nullableUuid,
};
const valuePoolRequestFields = {
  ...valuePoolFields,
  upsideAmount: moneyDecimal.nullable(),
  downsideAmount: moneyDecimal.nullable(),
};

export const valuePool = z.strictObject({
  id: uuid,
  organizationId: uuid,
  transformationId: uuid,
  ...valuePoolFields,
  ...validationFields,
  ...recordTail,
});
export type ValuePool = z.infer<typeof valuePool>;

/** `currency` defaults to the transformation's currency (SAR by default); `quantificationStatus` to unquantified. */
export const valuePoolCreate = z.strictObject({
  name: valuePoolRequestFields.name,
  driver: valuePoolRequestFields.driver.optional(),
  workstreamCode: valuePoolRequestFields.workstreamCode.optional(),
  quantificationStatus: valuePoolRequestFields.quantificationStatus.optional(),
  upsideAmount: valuePoolRequestFields.upsideAmount.optional(),
  downsideAmount: valuePoolRequestFields.downsideAmount.optional(),
  currency: valuePoolRequestFields.currency.optional(),
  unquantifiedReason: valuePoolRequestFields.unquantifiedReason.optional(),
  materiality: valuePoolRequestFields.materiality.optional(),
  confidence: valuePoolRequestFields.confidence.optional(),
  ownerUserId: valuePoolRequestFields.ownerUserId.optional(),
});
export type ValuePoolCreate = z.infer<typeof valuePoolCreate>;

export const valuePoolUpdate = atLeastOne(z.object(valuePoolRequestFields).partial().shape);
export type ValuePoolUpdate = z.infer<typeof valuePoolUpdate>;

// ------------------------------------------------------------------------------------------------ decisions + pages

export const validationDecision = z.strictObject({
  result: z.enum(["validated", "rejected"]),
  note: text(1, 2000),
});
export type ValidationDecision = z.infer<typeof validationDecision>;

export const trajectoryApproval = z.strictObject({ note: text(1, 2000).optional() });
export type TrajectoryApproval = z.infer<typeof trajectoryApproval>;

const pageOf = <T extends z.ZodType>(item: T) =>
  z.strictObject({ items: z.array(item), nextCursor: z.string().nullable() });
export const kpiDefinitionPage = pageOf(kpiDefinition);
export const baselinePage = pageOf(baseline);
export const outcomeKpiPage = pageOf(outcomeKpi);
export const valuePoolPage = pageOf(valuePool);

/** List query shared by the four kpi lists (`includeArchived`, cursor, limit). */
export const kpiListQuery = z.strictObject({ includeArchived: z.stringbool().default(false) });
