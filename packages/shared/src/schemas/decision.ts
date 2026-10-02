// P2 decision mirrors (backend-workflow-engineer; ADR-0015 §1): THE canonical decision record (kind design = T04
// Design Decision Log, B0065; kind gate = product-gate decisions), its options A/B/C, plus the TOM canvas view that
// aggregates gaps, decisions, dependencies and evidence per dimension. Mirrors docs/api/openapi.yaml Decision*,
// TomCanvasCellView, TomCanvas.
import { z } from "zod";
import { timestamp, uuid, version } from "./common.ts";
import { dependency, tomCanvasCell, tomGap } from "./design.ts";
import { evidence } from "./evidence.ts";
import { businessDate } from "./kpi.ts";
import { tomDimension, tomDimensionCode } from "./methodology.ts";

const text = (min: number, max: number) => z.string().min(min).max(max);
const nullableUuid = uuid.nullable();

export const DECISION_KINDS = ["design", "executive", "gate"] as const;
export const DECISION_STATUSES = ["open", "decided", "deferred", "cancelled"] as const;
export const decisionKind = z.enum(DECISION_KINDS);
export const decisionStatus = z.enum(DECISION_STATUSES);

export const decisionOption = z.strictObject({
  id: uuid,
  organizationId: uuid,
  transformationId: uuid,
  decisionId: uuid,
  label: z.string().regex(/^[A-Z]$/),
  title: text(1, 300),
  description: text(1, 4000).nullable(),
  ordinal: z.number().int().min(1).max(26),
  status: z.enum(["active", "withdrawn"]),
  version,
  createdAt: timestamp,
  createdBy: uuid,
  updatedAt: timestamp,
  updatedBy: uuid,
});
export type DecisionOption = z.infer<typeof decisionOption>;

export const decision = z.strictObject({
  id: uuid,
  organizationId: uuid,
  transformationId: uuid,
  kind: decisionKind,
  code: z.string(),
  title: text(1, 500),
  context: text(1, 20000).nullable(),
  ownerUserId: nullableUuid,
  dueDate: businessDate.nullable(),
  status: decisionStatus,
  recommendationOptionId: nullableUuid,
  recommendationText: text(1, 4000).nullable(),
  chosenOptionId: nullableUuid,
  outcomeText: text(1, 8000).nullable(),
  decidedBy: nullableUuid,
  decidedAt: timestamp.nullable(),
  tomDimensionCode: z.string().nullable(),
  sourceWorkshopItemId: nullableUuid,
  version,
  createdAt: timestamp,
  createdBy: uuid,
  updatedAt: timestamp,
  updatedBy: uuid,
  options: z.array(decisionOption).max(26),
});
export type Decision = z.infer<typeof decision>;
export const decisionPage = z.strictObject({ items: z.array(decision), nextCursor: z.string().nullable() });

export const decisionOptionCreate = z.strictObject({
  title: text(1, 300),
  description: text(1, 4000).nullable().optional(),
});
export const decisionOptionUpdate = z
  .strictObject({
    title: text(1, 300),
    description: text(1, 4000).nullable(),
    status: z.enum(["active", "withdrawn"]),
  })
  .partial()
  .refine((v) => Object.keys(v).length >= 1, "validation.min_properties");

/** Creates a design decision (kind design, status open, code D-nn generated); gate decisions come from the gates. */
export const decisionCreate = z.strictObject({
  transformationId: uuid,
  kind: z.enum(["design"]).optional(),
  title: text(1, 500),
  context: text(1, 20000).nullable().optional(),
  ownerUserId: nullableUuid.optional(),
  dueDate: businessDate.nullable().optional(),
  tomDimensionCode: tomDimensionCode.nullable().optional(),
  recommendationText: text(1, 4000).nullable().optional(),
  options: z.array(decisionOptionCreate).max(26).optional(),
});
export const decisionUpdate = z
  .strictObject({
    title: text(1, 500),
    context: text(1, 20000).nullable(),
    ownerUserId: nullableUuid,
    dueDate: businessDate.nullable(),
    tomDimensionCode: tomDimensionCode.nullable(),
    recommendationOptionId: nullableUuid,
    recommendationText: text(1, 4000).nullable(),
    status: z.enum(["open", "deferred", "cancelled"]),
  })
  .partial()
  .refine((v) => Object.keys(v).length >= 1, "validation.min_properties");
/** The decision owner records the choice (decision.decide); a delegate names the owner in onBehalfOfUserId. */
export const decisionDecide = z.strictObject({
  chosenOptionId: uuid,
  outcomeText: text(1, 8000),
  onBehalfOfUserId: uuid.optional(),
});
export const decisionListQuery = z.strictObject({
  transformationId: uuid,
  kind: decisionKind.optional(),
  status: decisionStatus.optional(),
  tomDimensionCode: tomDimensionCode.optional(),
});

// ------------------------------------------------------------------------------------------------ TOM canvas view

/** One canvas box with its linked records (REQ-PB-041). */
export const tomCanvasCellView = z.strictObject({
  cell: tomCanvasCell,
  dimension: tomDimension,
  gaps: z.array(tomGap),
  decisions: z.array(decision),
  dependencies: z.array(dependency),
  evidence: z.array(evidence),
});
export const tomCanvas = z.strictObject({ cells: z.array(tomCanvasCellView).length(10) });
