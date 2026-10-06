// P2 Design mirrors (backend-workflow-engineer; ADR-0016 §1, ADR-0015 §3): T03 TOM gap matrix, capability heatmap,
// journeys/processes with steps and pain points, TOM canvas, TOM workshops (workshop mode), dependencies and actions.
// Mirrors docs/api/openapi.yaml TomGap*, CapabilityHeatmapEntry*, Journey*, JourneyStep, JourneyPainPoint*,
// TomCanvas*, TomWorkshop*, Dependency*, ActionItem*.
import { z } from "zod";
import { freeText, timestamp, uuid, version } from "./common.ts";
import { p2ArchiveFields, p2RecordStamps } from "./direction.ts";
import { businessDate, decimal } from "./kpi.ts";

// F-DG2-150: blank (whitespace-only) free text is rejected with `validation.blank`; stored exactly as entered.
const text = freeText;
const nullableUuid = uuid.nullable();
const minOne = <T extends z.ZodRawShape>(shape: T) =>
  z
    .strictObject(shape)
    .partial()
    .refine((v) => Object.keys(v).length >= 1, "validation.min_properties");
const page = <T extends z.ZodType>(item: T) =>
  z.strictObject({ items: z.array(item), nextCursor: z.string().nullable() });
const durationUnit = z.enum(["minutes", "hours", "days", "weeks"]);
/** A cycle time fits numeric(14,4) without rounding (ADR-0019 §4: no silent rounding): <= 10 integer, <= 4 fraction digits. */
export const cycleTimeDecimal = decimal.refine(
  (v) => /^[0-9]{1,10}(\.[0-9]{1,4})?$/.test(v),
  "validation.decimal_cycle_time",
);

// ------------------------------------------------------------------------------------------------ T03

const tomGapFields = {
  dimensionCode: z.string(),
  currentState: text(1, 20000).nullable(),
  targetState: text(1, 20000).nullable(),
  gap: text(1, 20000).nullable(),
  designDecisionId: nullableUuid,
  ownerUserId: nullableUuid,
};
export const TOM_GAP_STATUSES = ["open", "resolved", "archived"] as const;
export const tomGap = z.strictObject({
  ...p2RecordStamps,
  ...tomGapFields,
  status: z.enum(TOM_GAP_STATUSES),
  ...p2ArchiveFields,
});
export type TomGap = z.infer<typeof tomGap>;
/** A T03 row without a TOM dimension is rejected (B0058). */
export const tomGapCreate = z.strictObject(tomGapFields).partial().required({ dimensionCode: true });
export const tomGapUpdate = minOne({ ...tomGapFields, status: z.enum(TOM_GAP_STATUSES) });
export const tomGapPage = page(tomGap);

// ------------------------------------------------------------------------------------------------ capability heatmap

export const SOURCING_NEEDS = ["build", "buy", "partner", "undecided"] as const;
const level = z.number().int().min(1).max(5).nullable();
const capabilityFields = {
  name: text(1, 300),
  description: text(1, 4000).nullable(),
  dimensionCode: z.string().nullable(),
  currentLevel: level,
  targetLevel: level,
  sourcingNeed: z.enum(SOURCING_NEEDS).nullable(),
  ownerUserId: nullableUuid,
  tomGapId: nullableUuid,
};
export const capabilityHeatmapEntry = z.strictObject({
  ...p2RecordStamps,
  ...capabilityFields,
  status: z.enum(["active", "archived"]),
  ...p2ArchiveFields,
});
export type CapabilityHeatmapEntry = z.infer<typeof capabilityHeatmapEntry>;
export const capabilityHeatmapEntryCreate = z.strictObject(capabilityFields).partial().required({ name: true });
export const capabilityHeatmapEntryUpdate = minOne(capabilityFields);
export const capabilityHeatmapEntryPage = page(capabilityHeatmapEntry);

// ------------------------------------------------------------------------------------------------ journeys

/** One step of a journey/process map; `key` is stable across edits so pain points can point at it (REQ-PB-025). */
export const journeyStep = z.strictObject({
  key: uuid,
  ordinal: z.number().int().min(1).max(200),
  name: text(1, 300),
  actor: freeText(0, 200).nullable().optional(),
  handoffTo: freeText(0, 200).nullable().optional(),
  systems: z.array(text(1, 200)).max(20).optional(),
  controls: z.array(text(1, 300)).max(20).optional(),
  cycleTimeValue: cycleTimeDecimal.nullable().optional(),
  cycleTimeUnit: durationUnit.nullable().optional(),
});
export type JourneyStep = z.infer<typeof journeyStep>;
const journeySteps = z
  .array(journeyStep)
  .max(200)
  .refine((steps) => new Set(steps.map((s) => s.key)).size === steps.length, "validation.unique_step_key");

export const JOURNEY_STATUSES = ["draft", "active", "archived"] as const;
const journeyFields = {
  name: text(1, 300),
  kind: z.enum(["journey", "process"]),
  state: z.enum(["current", "future"]),
  description: text(1, 20000).nullable(),
  dimensionCode: z.string().nullable(),
  steps: journeySteps,
  cycleTimeValue: cycleTimeDecimal.nullable(),
  cycleTimeUnit: durationUnit.nullable(),
  failureDemand: text(1, 4000).nullable(),
  ownerUserId: nullableUuid,
};
export const journey = z.strictObject({
  ...p2RecordStamps,
  ...journeyFields,
  steps: z.array(journeyStep).max(200),
  cycleTimeValue: decimal.nullable(),
  status: z.enum(JOURNEY_STATUSES),
  ...p2ArchiveFields,
});
export type Journey = z.infer<typeof journey>;
export const journeyCreate = z
  .strictObject({ ...journeyFields, status: z.enum(JOURNEY_STATUSES) })
  .partial()
  .required({ name: true, kind: true, state: true });
export const journeyUpdate = minOne({ ...journeyFields, status: z.enum(JOURNEY_STATUSES) });
export const journeyPage = page(journey);

const painPointFields = {
  stepKey: nullableUuid,
  description: text(1, 2000),
  diagnosticItemId: nullableUuid,
};
export const journeyPainPoint = z.strictObject({
  ...p2RecordStamps,
  journeyId: uuid,
  ...painPointFields,
  status: z.enum(["active", "archived"]),
  ...p2ArchiveFields,
});
export type JourneyPainPoint = z.infer<typeof journeyPainPoint>;
export const journeyPainPointCreate = z.strictObject(painPointFields).partial().required({ description: true });
export const journeyPainPointUpdate = minOne(painPointFields);
export const journeyPainPointPage = page(journeyPainPoint);

// ------------------------------------------------------------------------------------------------ TOM canvas

export const tomCanvasCell = z.strictObject({
  id: uuid,
  organizationId: uuid,
  transformationId: uuid,
  dimensionCode: z.string(),
  currentDesign: text(1, 20000).nullable(),
  targetDesign: text(1, 20000).nullable(),
  ownerUserId: nullableUuid,
  status: z.enum(["draft", "ready"]),
  version,
  createdAt: timestamp,
  createdBy: uuid,
  updatedAt: timestamp,
  updatedBy: uuid,
});
export type TomCanvasCell = z.infer<typeof tomCanvasCell>;
export const tomCanvasCellUpdate = minOne({
  currentDesign: text(1, 20000).nullable(),
  targetDesign: text(1, 20000).nullable(),
  ownerUserId: nullableUuid,
  status: z.enum(["draft", "ready"]),
});

// ------------------------------------------------------------------------------------------------ workshops

export const WORKSHOP_STATUSES = ["planned", "in_progress", "closed"] as const;
const workshopFields = {
  title: text(1, 300),
  workshopDate: businessDate,
  durationMinutes: z.number().int().min(15).max(480),
  agenda: text(1, 20000).nullable(),
  facilitatorUserId: uuid,
};
export const tomWorkshop = z.strictObject({
  id: uuid,
  organizationId: uuid,
  transformationId: uuid,
  ...workshopFields,
  status: z.enum(WORKSHOP_STATUSES),
  closedAt: timestamp.nullable(),
  closedBy: nullableUuid,
  version,
  createdAt: timestamp,
  createdBy: uuid,
  updatedAt: timestamp,
  updatedBy: uuid,
});
export type TomWorkshop = z.infer<typeof tomWorkshop>;
export const tomWorkshopCreate = z
  .strictObject(workshopFields)
  .partial()
  .required({ title: true, workshopDate: true, durationMinutes: true, facilitatorUserId: true });
export const tomWorkshopUpdate = minOne({ ...workshopFields, status: z.enum(WORKSHOP_STATUSES) });
export const tomWorkshopPage = page(tomWorkshop);

export const tomWorkshopParticipant = z.strictObject({
  id: uuid,
  organizationId: uuid,
  transformationId: uuid,
  workshopId: uuid,
  userId: uuid,
  isBusinessOwner: z.boolean(),
  status: z.enum(["active", "removed"]),
  version,
  createdAt: timestamp,
  createdBy: uuid,
  updatedAt: timestamp,
  updatedBy: uuid,
});
export type TomWorkshopParticipant = z.infer<typeof tomWorkshopParticipant>;
export const tomWorkshopParticipantCreate = z.strictObject({ userId: uuid, isBusinessOwner: z.boolean().optional() });
export const tomWorkshopParticipantList = z.strictObject({ items: z.array(tomWorkshopParticipant) });

export const tomWorkshopItem = z.strictObject({
  id: uuid,
  organizationId: uuid,
  transformationId: uuid,
  workshopId: uuid,
  dimensionCode: z.string().nullable(),
  kind: z.enum(["contribution", "unresolved"]),
  body: text(1, 4000),
  ownerUserId: nullableUuid,
  status: z.enum(["recorded", "open", "converted"]),
  convertedDecisionId: nullableUuid,
  convertedActionId: nullableUuid,
  convertedAt: timestamp.nullable(),
  convertedBy: nullableUuid,
  version,
  createdAt: timestamp,
  createdBy: uuid,
  updatedAt: timestamp,
  updatedBy: uuid,
});
export type TomWorkshopItem = z.infer<typeof tomWorkshopItem>;
export const tomWorkshopItemCreate = z.strictObject({
  dimensionCode: z.string().nullable().optional(),
  kind: z.enum(["contribution", "unresolved"]),
  body: text(1, 4000),
  ownerUserId: nullableUuid.optional(),
});
export const tomWorkshopItemPage = page(tomWorkshopItem);
export const tomWorkshopItemConversion = z.strictObject({
  target: z.enum(["design_decision", "action"]),
  title: text(1, 500),
  ownerUserId: uuid,
  dueDate: businessDate.optional(),
});

// ------------------------------------------------------------------------------------------------ dependencies

export const DEPENDENCY_ENDPOINT_KINDS = ["initiative", "external", "tom_dimension", "decision", "other"] as const;
export const DEPENDENCY_TYPES = ["decision", "tech", "data", "vendor", "other"] as const;
export const DEPENDENCY_STATUSES = ["open", "at_risk", "resolved", "archived"] as const;
const dependencyFields = {
  description: text(1, 2000),
  fromKind: z.enum(DEPENDENCY_ENDPOINT_KINDS),
  fromLabel: text(1, 300).nullable(),
  toKind: z.enum(DEPENDENCY_ENDPOINT_KINDS),
  toLabel: text(1, 300).nullable(),
  dependencyType: z.enum(DEPENDENCY_TYPES),
  neededBy: businessDate.nullable(),
  ownerUserId: nullableUuid,
  mitigation: text(1, 4000).nullable(),
  tomDimensionCode: z.string().nullable(),
  decisionId: nullableUuid,
};
export const dependency = z.strictObject({
  ...p2RecordStamps,
  code: z.string().regex(/^DEP-[0-9]{2,6}$/),
  ...dependencyFields,
  status: z.enum(DEPENDENCY_STATUSES),
  ...p2ArchiveFields,
});
export type Dependency = z.infer<typeof dependency>;
export const dependencyCreate = z
  .strictObject(dependencyFields)
  .partial()
  .required({ description: true, fromKind: true, toKind: true, dependencyType: true });
export const dependencyUpdate = minOne({ ...dependencyFields, status: z.enum(DEPENDENCY_STATUSES) });
export const dependencyPage = page(dependency);

// ------------------------------------------------------------------------------------------------ actions

export const ACTION_STATUSES = ["open", "in_progress", "done", "cancelled"] as const;
const actionFields = {
  title: text(1, 500),
  description: text(1, 4000).nullable(),
  ownerUserId: uuid,
  dueDate: businessDate.nullable(),
};
export const actionItem = z.strictObject({
  id: uuid,
  organizationId: uuid,
  transformationId: uuid,
  ...actionFields,
  status: z.enum(ACTION_STATUSES),
  sourceWorkshopItemId: nullableUuid,
  version,
  createdAt: timestamp,
  createdBy: uuid,
  updatedAt: timestamp,
  updatedBy: uuid,
});
export type ActionItem = z.infer<typeof actionItem>;
export const actionItemCreate = z.strictObject(actionFields).partial().required({ title: true, ownerUserId: true });
export const actionItemUpdate = minOne({ ...actionFields, status: z.enum(ACTION_STATUSES) });
export const actionItemPage = page(actionItem);
