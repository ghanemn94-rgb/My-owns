// P4 slice G mirrors of BE-I (backend-workflow-engineer, T-DG4-BE-I; p4-work-split §F+G FG.4; ADR-0034 §4, §5, §9, §12;
// OpenAPI 1.3.0-p4 PerformanceArea*, BauHandover*, AdoptionReason, StatusNote). REQ-PB-083, REQ-S11-005, REQ-S11-009,
// REQ-S03-002 (areas).
//
// - A performance area outlives its (origin) transformation; `cycles` is its append-only history: each reopening's
//   prior accepted handover and the closure it followed, as they were (REQ-S11-009).
// - A BAU handover carries the M0217 content; `missingItems` lists what submission still needs, in the order of the
//   ADR-0034 §12 text. Acceptance by the receiving owner is a business approval inside the product (never DG0-DG7).
import { z } from "zod";
import { freeText, page, timestamp, uuid, version } from "./common.ts";
import { businessDate } from "./kpi.ts";

const nullableUuid = uuid.nullable();
const nullableTimestamp = timestamp.nullable();

/** The recurrence vocabulary of reviews, controls and monitoring (`p4_sustain_frequency_valid`, 0048). */
export const SUSTAIN_FREQUENCIES = ["weekly", "monthly", "quarterly", "semi_annual", "annual"] as const;
export type SustainFrequency = (typeof SUSTAIN_FREQUENCIES)[number];
export const sustainFrequency = z.enum(SUSTAIN_FREQUENCIES);

export const PERFORMANCE_AREA_STATUSES = ["establishing", "bau", "reopened", "retired"] as const;
export const BAU_HANDOVER_STATUSES = ["draft", "submitted", "accepted", "returned"] as const;

/**
 * The M0217 items a submission checks, in the order of the `bau_handover.incomplete` text (ADR-0034 §12), with the
 * English label the text names and the JSON pointer of the error. Controls and evidence are counted, not fields.
 */
export const BAU_HANDOVER_ITEMS = [
  { item: "kpi_owner", label: "KPI owner", pointer: "/kpiOwnerUserId" },
  { item: "operating_procedures", label: "operating procedures", pointer: "/operatingProcedures" },
  { item: "controls", label: "controls", pointer: "/controlIds" },
  { item: "evidence", label: "evidence", pointer: "/evidenceIds" },
  { item: "capability_readiness", label: "capability readiness", pointer: "/capabilityReadiness" },
  { item: "unresolved_accepted_risks", label: "unresolved accepted risks", pointer: "/unresolvedAcceptedRisks" },
  { item: "benefit_monitoring_cadence", label: "benefit monitoring cadence", pointer: "/benefitMonitoringCadence" },
  { item: "data_access", label: "data access", pointer: "/dataAccess" },
  { item: "improvement_backlog", label: "improvement backlog", pointer: "/improvementBacklogSummary" },
] as const;
export type BauHandoverItem = (typeof BAU_HANDOVER_ITEMS)[number]["item"];
export const bauHandoverItem = z.enum(BAU_HANDOVER_ITEMS.map((i) => i.item) as [BauHandoverItem, ...BauHandoverItem[]]);

/** OpenAPI `AdoptionReason` as used by the slice G area and handover actions (reopen, retire, return). */
export const sustainmentReason = z.strictObject({ reason: freeText(3, 1000) });
export type SustainmentReason = z.infer<typeof sustainmentReason>;

/** OpenAPI `StatusNote` as used by acceptBauHandover (an optional note). */
export const sustainmentStatusNote = z.strictObject({ note: freeText(1, 2000).optional() });
export type SustainmentStatusNote = z.infer<typeof sustainmentStatusNote>;

/** OpenAPI `PerformanceAreaCycle` (append-only). */
export const performanceAreaCycle = z.strictObject({
  cycleNo: z.number().int().min(1),
  openedAt: timestamp,
  openedBy: uuid,
  reopenReason: z.string().min(1).max(2000).nullable(),
  priorHandoverId: nullableUuid,
  priorHandoverAcceptedAt: nullableTimestamp,
  priorHandoverAcceptedBy: nullableUuid,
  priorClosureRecordId: nullableUuid,
  priorClosedAt: nullableTimestamp,
});
export type PerformanceAreaCycle = z.infer<typeof performanceAreaCycle>;

/** OpenAPI `PerformanceArea`. `transformationId` is the origin transformation. */
export const performanceArea = z.strictObject({
  id: uuid,
  transformationId: uuid,
  code: z.string().regex(/^PA-[0-9]{2,6}$/),
  name: z.string().min(1).max(200),
  description: z.string().min(1).max(4000).nullable(),
  businessUnitId: nullableUuid,
  sponsorUserId: nullableUuid,
  reviewFrequency: sustainFrequency,
  reviewInterval: z.number().int().min(1).max(12),
  bauOwnerUserId: nullableUuid,
  kpiOwnerUserId: nullableUuid,
  nextReviewDate: businessDate.nullable(),
  cycleNo: z.number().int().min(1),
  status: z.enum(PERFORMANCE_AREA_STATUSES),
  currentHandoverId: nullableUuid,
  cycles: z.array(performanceAreaCycle),
  retiredAt: nullableTimestamp,
  retireReason: z.string().min(1).max(1000).nullable(),
  version,
  createdAt: timestamp,
  createdBy: nullableUuid,
  updatedAt: timestamp,
  updatedBy: nullableUuid,
});
export type PerformanceArea = z.infer<typeof performanceArea>;
export const performanceAreaPage = page(performanceArea);

/** OpenAPI `PerformanceAreaCreate`. */
export const performanceAreaCreate = z.strictObject({
  name: freeText(1, 200),
  description: freeText(1, 4000).nullable().optional(),
  businessUnitId: nullableUuid.optional(),
  sponsorUserId: nullableUuid.optional(),
  reviewFrequency: sustainFrequency.optional(),
  reviewInterval: z.number().int().min(1).max(12).optional(),
});
export type PerformanceAreaCreate = z.infer<typeof performanceAreaCreate>;

/** OpenAPI `PerformanceAreaUpdate` (minProperties 1). */
export const performanceAreaUpdate = performanceAreaCreate
  .partial()
  .refine((v) => Object.keys(v).length >= 1, "validation.min_properties");
export type PerformanceAreaUpdate = z.infer<typeof performanceAreaUpdate>;

/** OpenAPI `PerformanceAreaLink`. */
export const performanceAreaLink = z.strictObject({
  id: uuid,
  transformationId: uuid,
  performanceAreaId: uuid,
  linkKind: z.enum(["kpi", "benefit"]),
  kpiDefinitionId: nullableUuid,
  benefitId: nullableUuid,
  status: z.enum(["active", "removed"]),
  removedAt: nullableTimestamp,
  removedBy: nullableUuid,
  version,
  createdAt: timestamp,
  createdBy: nullableUuid,
  updatedAt: timestamp,
  updatedBy: nullableUuid,
});
export type PerformanceAreaLink = z.infer<typeof performanceAreaLink>;
export const performanceAreaLinkPage = page(performanceAreaLink);

/** OpenAPI `PerformanceAreaLinkCreate`: exactly one of kpiDefinitionId and benefitId, matching linkKind. */
export const performanceAreaLinkCreate = z
  .strictObject({
    linkKind: z.enum(["kpi", "benefit"]),
    kpiDefinitionId: uuid.optional(),
    benefitId: uuid.optional(),
  })
  .superRefine((v, ctx) => {
    if (v.linkKind === "kpi" && v.kpiDefinitionId === undefined)
      ctx.addIssue({ code: "custom", path: ["kpiDefinitionId"], message: "validation.required" });
    if (v.linkKind === "benefit" && v.benefitId === undefined)
      ctx.addIssue({ code: "custom", path: ["benefitId"], message: "validation.required" });
    if (v.linkKind === "kpi" && v.benefitId !== undefined)
      ctx.addIssue({ code: "custom", path: ["benefitId"], message: "validation.not_applicable" });
    if (v.linkKind === "benefit" && v.kpiDefinitionId !== undefined)
      ctx.addIssue({ code: "custom", path: ["kpiDefinitionId"], message: "validation.not_applicable" });
  });
export type PerformanceAreaLinkCreate = z.infer<typeof performanceAreaLinkCreate>;

const handoverText = freeText(1, 8000);

/** OpenAPI `BauHandover`. */
export const bauHandover = z.strictObject({
  id: uuid,
  transformationId: uuid,
  performanceAreaId: uuid,
  cycleNo: z.number().int().min(1),
  code: z.string().regex(/^HO-[0-9]{2,6}$/),
  receivingOwnerUserId: uuid,
  kpiOwnerUserId: nullableUuid,
  operatingProcedures: z.string().min(1).max(8000).nullable(),
  capabilityReadiness: z.string().min(1).max(8000).nullable(),
  unresolvedAcceptedRisks: z.string().min(1).max(8000).nullable(),
  benefitMonitoringCadence: sustainFrequency.nullable(),
  dataAccess: z.string().min(1).max(8000).nullable(),
  improvementBacklogSummary: z.string().min(1).max(8000).nullable(),
  controlIds: z.array(uuid),
  evidenceIds: z.array(uuid),
  openImprovementItemIds: z.array(uuid),
  missingItems: z.array(bauHandoverItem),
  status: z.enum(BAU_HANDOVER_STATUSES),
  submittedAt: nullableTimestamp,
  submittedBy: nullableUuid,
  acceptedAt: nullableTimestamp,
  acceptedBy: nullableUuid,
  acceptanceNote: z.string().min(1).max(2000).nullable(),
  returnedAt: nullableTimestamp,
  returnedBy: nullableUuid,
  returnReason: z.string().min(1).max(2000).nullable(),
  version,
  createdAt: timestamp,
  createdBy: nullableUuid,
  updatedAt: timestamp,
  updatedBy: nullableUuid,
});
export type BauHandover = z.infer<typeof bauHandover>;
export const bauHandoverPage = page(bauHandover);

const handoverContent = {
  kpiOwnerUserId: nullableUuid.optional(),
  operatingProcedures: handoverText.nullable().optional(),
  capabilityReadiness: handoverText.nullable().optional(),
  unresolvedAcceptedRisks: handoverText.nullable().optional(),
  benefitMonitoringCadence: sustainFrequency.nullable().optional(),
  dataAccess: handoverText.nullable().optional(),
  improvementBacklogSummary: handoverText.nullable().optional(),
};

/** OpenAPI `BauHandoverCreate`. */
export const bauHandoverCreate = z.strictObject({
  performanceAreaId: uuid,
  receivingOwnerUserId: uuid,
  ...handoverContent,
});
export type BauHandoverCreate = z.infer<typeof bauHandoverCreate>;

/** OpenAPI `BauHandoverUpdate` (minProperties 1). */
export const bauHandoverUpdate = z
  .strictObject({ receivingOwnerUserId: uuid.optional(), ...handoverContent })
  .refine((v) => Object.keys(v).length >= 1, "validation.min_properties");
export type BauHandoverUpdate = z.infer<typeof bauHandoverUpdate>;

/** OpenAPI `BauHandoverEvidenceAdd`. */
export const bauHandoverEvidenceAdd = z.strictObject({ evidenceId: uuid });
