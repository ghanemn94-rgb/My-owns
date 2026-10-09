// P4 slice F mirrors of the adoption indicators (kpi-benefits-engineer, T-DG4-KBE-F; p4-work-split §F+G FG.3; ADR-0033
// §2, §3, §6, §12; OpenAPI 1.3.0-p4 AdoptionIndicatorTemplate*, AdoptionMetricLink*, AdoptionMeasureValue,
// AdoptionIndicatorReport). REQ-PB-071 (the seven indicators by name, as KPI templates), REQ-PB-072 (training completion
// and observed proficiency as two separate measures), REQ-S16-020 (AdoptionMetricLink).
//
// Values are decimal strings and percentages are fractions (0.75 = 75 %; ADR-0028 §3), never JSON numbers. A measure
// without data is `valueStatus: "unknown"` with `value: null` and a reason code, never 0 or green (M0159). Nothing here
// is a business approval.
import { z } from "zod";
import { page, timestamp, uuid, version } from "./common.ts";
import { decimal } from "./kpi.ts";
import { kpiRag } from "./kpi-actuals.ts";

const nullableUuid = uuid.nullable();
const nullableTimestamp = timestamp.nullable();

export const ADOPTION_TARGET_KINDS = ["transformation", "outcome", "initiative", "stakeholder_group"] as const;
export const ADOPTION_METRIC_LINK_STATUSES = ["active", "removed"] as const;
export const ADOPTION_VALUE_SOURCES = ["kpi_actuals", "training_records", "assessment_records"] as const;
export const ADOPTION_MEASURE_VALUE_STATUSES = ["ok", "unknown", "stale", "not_computable"] as const;

export const adoptionTargetKind = z.enum(ADOPTION_TARGET_KINDS);

/** One measure of a seeded leading adoption indicator (B0109-B0115 verbatim in sourceIndicatorEn). */
export const adoptionIndicatorTemplate = z.strictObject({
  key: z.string(),
  indicatorKey: z.string(),
  indicatorOrdinal: z.number().int().min(1).max(7),
  measureOrdinal: z.number().int().min(1).max(2),
  sourceIndicatorEn: z.string(),
  indicatorAr: z.string(),
  measureEn: z.string(),
  measureAr: z.string(),
  arProvisional: z.boolean(),
  unitKind: z.enum(["percentage", "duration"]),
  polarity: z.enum(["higher_is_better", "lower_is_better"]),
  valueNature: z.enum(["ratio", "stock"]),
  aggregationRule: z.enum(["weighted_ratio", "last_value"]),
  valueSource: z.enum(ADOPTION_VALUE_SOURCES),
  sourceRef: z.string(),
});
export type AdoptionIndicatorTemplate = z.infer<typeof adoptionIndicatorTemplate>;

export const adoptionIndicatorTemplateList = z.strictObject({ items: z.array(adoptionIndicatorTemplate) });
export type AdoptionIndicatorTemplateList = z.infer<typeof adoptionIndicatorTemplateList>;

/** An indicator measure attached to a target (REQ-S16-020 AdoptionMetricLink). */
export const adoptionMetricLink = z.strictObject({
  id: uuid,
  transformationId: uuid,
  templateKey: z.string(),
  kpiDefinitionId: nullableUuid,
  targetKind: adoptionTargetKind,
  targetId: uuid,
  status: z.enum(ADOPTION_METRIC_LINK_STATUSES),
  removedAt: nullableTimestamp,
  removedBy: nullableUuid,
  version,
  createdAt: timestamp,
  createdBy: nullableUuid,
  updatedAt: timestamp,
  updatedBy: nullableUuid,
});
export type AdoptionMetricLink = z.infer<typeof adoptionMetricLink>;

export const adoptionMetricLinkPage = page(adoptionMetricLink);
export type AdoptionMetricLinkPage = z.infer<typeof adoptionMetricLinkPage>;

/**
 * createAdoptionMetricLink. A KPI-fed measure names `kpiDefinitionId` or sets `createKpi` with `kpiOwnerUserId`; a
 * record-fed measure names neither (the API answers the ADR-0033 §10 422s). `targetId` is required unless the target
 * is the transformation itself (400 at /targetId).
 */
export const adoptionMetricLinkCreate = z
  .strictObject({
    templateKey: z.string().regex(/^[a-z_]+$/),
    targetKind: adoptionTargetKind,
    targetId: uuid.optional(),
    kpiDefinitionId: uuid.optional(),
    createKpi: z.boolean().optional(),
    kpiOwnerUserId: uuid.optional(),
  })
  .superRefine((b, ctx) => {
    if (b.targetKind !== "transformation" && b.targetId === undefined)
      ctx.addIssue({ code: "custom", path: ["targetId"], message: "validation.required" });
    if (b.createKpi === true && b.kpiOwnerUserId === undefined)
      ctx.addIssue({ code: "custom", path: ["kpiOwnerUserId"], message: "validation.required" });
    if (b.createKpi === true && b.kpiDefinitionId !== undefined)
      ctx.addIssue({ code: "custom", path: ["createKpi"], message: "validation.conflict" });
    if (b.createKpi !== true && b.kpiOwnerUserId !== undefined)
      ctx.addIssue({ code: "custom", path: ["kpiOwnerUserId"], message: "validation.not_applicable" });
  });
export type AdoptionMetricLinkCreate = z.infer<typeof adoptionMetricLinkCreate>;

/** One measure's value (ADR-0033 §12): a decimal fraction or null when Unknown (never 0). */
export const adoptionMeasureValue = z.strictObject({
  templateKey: z.string(),
  metricLinkId: nullableUuid,
  kpiDefinitionId: nullableUuid,
  value: decimal.nullable(),
  valueStatus: z.enum(ADOPTION_MEASURE_VALUE_STATUSES),
  valueReason: z.string().nullable(),
  calculatedRag: kpiRag.nullable(),
  trajectoryValue: decimal.nullable(),
  numerator: z.number().int().min(0).nullable(),
  denominator: z.number().int().min(0).nullable(),
});
export type AdoptionMeasureValue = z.infer<typeof adoptionMeasureValue>;

export const adoptionIndicatorReport = z.strictObject({
  targetKind: adoptionTargetKind,
  targetId: uuid,
  reportingPeriodId: uuid,
  measures: z.array(adoptionMeasureValue),
});
export type AdoptionIndicatorReport = z.infer<typeof adoptionIndicatorReport>;
