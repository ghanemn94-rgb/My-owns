// P4 slice G mirrors of BE-J (backend-workflow-engineer, T-DG4-BE-J; p4-work-split §F+G FG.6; ADR-0034 §1-§3, §7, §9,
// §12; OpenAPI 1.3.0-p4 InitiativeStatusModel, InitiativeAdoptionStatusSet, TransformationStatusModel, ClosureRecord*,
// TransitionDecision*, StatusNote). REQ-PB-009, REQ-S03-003, REQ-S11-006, REQ-S11-007.
//
// - Delivery, adoption, validated value and closure are four separate statuses; none is derived from another
//   (REQ-S03-003, M0092). The labels are the exact English texts of ADR-0034 §2; no label says "successful" (M0218).
// - A transition decision documents residual benefit ownership and monitoring for value still to be realized; the
//   benefit's forecast stays forecast (REQ-S11-007). It is decided through the canonical business approval inside the
//   product (never DG0-DG7).
import { z } from "zod";
import { freeText, page, timestamp, uuid, version } from "./common.ts";
import { businessDate } from "./kpi.ts";
import { sustainFrequency } from "./sustainment-areas.ts";

const nullableUuid = uuid.nullable();
const nullableTimestamp = timestamp.nullable();

export const ADOPTION_STATUSES = ["not_assessed", "on_track", "at_risk", "adopted"] as const;
export type AdoptionStatus = (typeof ADOPTION_STATUSES)[number];
/** The values an owner may set (`not_assessed` is only the default). */
export const SETTABLE_ADOPTION_STATUSES = ["on_track", "at_risk", "adopted"] as const;
export const SUBJECT_VALUE_STATUSES = [
  "no_benefit",
  "validation_pending",
  "validated",
  "validated_with_transition",
] as const;
export type SubjectValueStatus = (typeof SUBJECT_VALUE_STATUSES)[number];
export const INITIATIVE_STATUS_LABELS = [
  "Closed",
  "Delivered — value validation pending",
  "Delivered — value validated",
  "In delivery",
] as const;
export type InitiativeStatusLabel = (typeof INITIATIVE_STATUS_LABELS)[number];
export const TRANSFORMATION_STATUS_LABELS = [
  "Closed",
  "Delivery complete - value validation pending",
  "Value validated - BAU acceptance pending",
  "Value validated - BAU accepted",
  "In delivery",
] as const;
export type TransformationStatusLabel = (typeof TRANSFORMATION_STATUS_LABELS)[number];
export const CLOSURE_BASES = [
  "validated_value",
  "transition_decision",
  "validated_value_and_transition_decision",
] as const;
export type ClosureBasis = (typeof CLOSURE_BASES)[number];
export const TRANSITION_DECISION_STATUSES = ["draft", "submitted", "approved", "rejected", "withdrawn"] as const;
export type TransitionDecisionStatus = (typeof TRANSITION_DECISION_STATUSES)[number];

/**
 * OpenAPI `StatusNote` for the status actions of this slice (complete delivery, close). The `closure_record` column
 * holds 3-2000 characters, so the close services check the stricter lower bound themselves (400 at /note).
 */
export const statusNote = z.strictObject({ note: freeText(1, 2000).optional() });
export type StatusNote = z.infer<typeof statusNote>;

/** OpenAPI `InitiativeAdoptionStatusSet`. */
export const initiativeAdoptionStatusSet = z.strictObject({
  adoptionStatus: z.enum(SETTABLE_ADOPTION_STATUSES),
  note: freeText(1, 2000).optional(),
});
export type InitiativeAdoptionStatusSet = z.infer<typeof initiativeAdoptionStatusSet>;

/** OpenAPI `InitiativeStatusModel`: the four separate statuses and the label. */
export const initiativeStatusModel = z.strictObject({
  initiativeId: uuid,
  version,
  delivery: z.string(),
  deliveryCompletedAt: nullableTimestamp,
  deliveryCompletedBy: nullableUuid,
  adoption: z.enum(ADOPTION_STATUSES),
  adoptionSource: z.enum(["owner", "indicator"]),
  value: z.enum(SUBJECT_VALUE_STATUSES),
  closure: z.enum(["open", "closed"]),
  closureRecordId: nullableUuid,
  label: z.enum(INITIATIVE_STATUS_LABELS),
});
export type InitiativeStatusModel = z.infer<typeof initiativeStatusModel>;

const count = z.number().int().min(0);

/** OpenAPI `TransformationStatusModel`. */
export const transformationStatusModel = z.strictObject({
  transformationId: uuid,
  deliveryState: z.enum(["in_delivery", "delivery_complete"]),
  valueState: z.enum(SUBJECT_VALUE_STATUSES),
  bauState: z.enum(["no_performance_area", "bau_pending", "bau_accepted"]),
  closureState: z.enum(["open", "closed"]),
  label: z.enum(TRANSFORMATION_STATUS_LABELS),
  initiatives: z.strictObject({ total: count, completed: count }),
  performanceAreas: z.strictObject({ total: count, bau: count }),
});
export type TransformationStatusModel = z.infer<typeof transformationStatusModel>;

/** OpenAPI `ClosureRecord` (append-only). */
export const closureRecord = z.strictObject({
  id: uuid,
  transformationId: uuid,
  subjectKind: z.enum(["initiative", "transformation"]),
  initiativeId: nullableUuid,
  basis: z.enum(CLOSURE_BASES),
  snapshot: z.record(z.string(), z.unknown()),
  closureNote: z.string().min(1).max(2000).nullable(),
  closedAt: timestamp,
  closedBy: uuid,
});
export type ClosureRecord = z.infer<typeof closureRecord>;
export const closureRecordPage = page(closureRecord);

/** OpenAPI `TransitionDecision`. */
export const transitionDecision = z.strictObject({
  id: uuid,
  transformationId: uuid,
  code: z.string().regex(/^TD-[0-9]{2,6}$/),
  benefitId: uuid,
  residualOwnerUserId: uuid,
  rationale: z.string().min(3).max(4000),
  expectedRealizationEnd: businessDate,
  monitoringFrequency: sustainFrequency,
  monitoringInterval: z.number().int().min(1).max(12),
  firstMonitoringDate: businessDate,
  nextMonitoringDate: businessDate.nullable(),
  status: z.enum(TRANSITION_DECISION_STATUSES),
  approvalId: nullableUuid,
  decidedAt: nullableTimestamp,
  decidedBy: nullableUuid,
  version,
  createdAt: timestamp,
  createdBy: nullableUuid,
  updatedAt: timestamp,
  updatedBy: nullableUuid,
});
export type TransitionDecision = z.infer<typeof transitionDecision>;
export const transitionDecisionPage = page(transitionDecision);

/** OpenAPI `TransitionDecisionCreate`. */
export const transitionDecisionCreate = z.strictObject({
  benefitId: uuid,
  residualOwnerUserId: uuid,
  rationale: freeText(3, 4000),
  expectedRealizationEnd: businessDate,
  monitoringFrequency: sustainFrequency,
  monitoringInterval: z.number().int().min(1).max(12).optional(),
  firstMonitoringDate: businessDate,
});
export type TransitionDecisionCreate = z.infer<typeof transitionDecisionCreate>;

/** OpenAPI `TransitionDecisionUpdate`: every member optional, at least one; `status: withdrawn` withdraws. */
export const transitionDecisionUpdate = z
  .strictObject({
    residualOwnerUserId: uuid.optional(),
    rationale: freeText(3, 4000).optional(),
    expectedRealizationEnd: businessDate.optional(),
    monitoringFrequency: sustainFrequency.optional(),
    monitoringInterval: z.number().int().min(1).max(12).optional(),
    firstMonitoringDate: businessDate.optional(),
    status: z.literal("withdrawn").optional(),
  })
  .superRefine((v, ctx) => {
    if (Object.keys(v).length < 1) ctx.addIssue({ code: "custom", message: "validation.min_properties", path: [] });
  });
export type TransitionDecisionUpdate = z.infer<typeof transitionDecisionUpdate>;
