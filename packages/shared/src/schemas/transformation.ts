import { z } from "zod";
import {
  code,
  currency,
  name,
  phase,
  standaloneDeliverableType,
  timestamp,
  timeZone,
  transformationMode,
  transformationStatus,
  uuid,
  version,
} from "./common.ts";

const description = z.string().max(4000);

export const transformation = z.strictObject({
  id: uuid,
  organizationId: uuid,
  businessUnitId: uuid,
  code,
  name,
  description: description.nullable(),
  mode: transformationMode,
  entryPhase: phase.nullable(),
  standaloneDeliverableType: standaloneDeliverableType.nullable(),
  status: transformationStatus,
  currentPhase: phase,
  sponsorUserId: uuid.nullable(),
  leadUserId: uuid.nullable(),
  timezone: timeZone,
  currency,
  archivedAt: timestamp.nullable(),
  archiveReason: z.string().nullable(),
  version,
  createdAt: timestamp,
  createdBy: uuid,
  updatedAt: timestamp,
  updatedBy: uuid,
});

/** Modular requires entryPhase; end_to_end forbids entryPhase and standaloneDeliverableType (B0009, REQ-PB-003). */
export const transformationCreate = z
  .strictObject({
    businessUnitId: uuid,
    code: code.optional(),
    name,
    description: description.optional(),
    mode: transformationMode,
    entryPhase: phase.optional(),
    standaloneDeliverableType: standaloneDeliverableType.optional(),
    sponsorUserId: uuid.optional(),
    leadUserId: uuid.optional(),
    timezone: timeZone.optional(),
    currency: currency.optional(),
  })
  .superRefine((t, ctx) => {
    if (t.mode === "modular" && t.entryPhase === undefined) {
      ctx.addIssue({ code: "custom", path: ["entryPhase"], message: "validation.required" });
    }
    if (t.mode === "end_to_end") {
      for (const key of ["entryPhase", "standaloneDeliverableType"] as const) {
        if (t[key] !== undefined) ctx.addIssue({ code: "custom", path: [key], message: "validation.not_allowed_for_mode" });
      }
    }
  });

export const transformationUpdate = z
  .strictObject({
    name,
    description: description.nullable(),
    status: transformationStatus,
    sponsorUserId: uuid.nullable(),
    leadUserId: uuid.nullable(),
    timezone: timeZone,
    currency,
  })
  .partial()
  .refine((o) => Object.keys(o).length > 0, "validation.empty_update");

export const transformationListQuery = z.object({
  organizationId: uuid.optional(),
  businessUnitId: uuid.optional(),
  status: z.union([transformationStatus, z.array(transformationStatus).max(4)]).optional(),
  mode: transformationMode.optional(),
  phase: phase.optional(),
  q: z.string().min(1).max(200).optional(),
  includeArchived: z.stringbool().default(false),
  sort: z.enum(["updatedAt:desc", "updatedAt:asc", "name:asc", "name:desc", "code:asc", "code:desc"]).default("updatedAt:desc"),
});

export type Transformation = z.infer<typeof transformation>;
export type TransformationCreate = z.infer<typeof transformationCreate>;
export type TransformationUpdate = z.infer<typeof transformationUpdate>;
export type TransformationListQuery = z.infer<typeof transformationListQuery>;
