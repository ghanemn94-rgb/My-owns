// P5 slice F (T-DG5-KBE-D; ADR-0045 §6, §11; p5-work-split §F.3; REQ-S09-011): structured owner updates, their
// revisions and the exact refusal texts. Mirrors of the OpenAPI schemas OwnerUpdate, OwnerUpdatePage,
// OwnerUpdateCreate, OwnerUpdatePatch, OwnerUpdateReopen, OwnerUpdateRevision and OwnerUpdateRevisionPage.
//
// - The eight M0185 fields ("achievements, next steps, milestones, outcomes, adoption, risks, dependencies and asks")
//   are each null or 1-2000 characters of free text through the shared rule (`freeText`: never blank, no U+0000 or lone
//   surrogate, stored as entered).
// - An update is written only by its subject's owner (the workstream lead; for the transformation, a holder of the TL
//   role in it). Submitting an update is not a business approval; product gates G1-G6 are business approvals inside the
//   product and nothing here touches the engineering gates DG0-DG7.
import { z } from "zod";
import { freeText, timestamp, uuid, version } from "./common.ts";

/** The eight structured fields in M0185 order (API names). */
export const OWNER_UPDATE_FIELDS = [
  "achievements",
  "nextSteps",
  "milestones",
  "outcomes",
  "adoption",
  "risks",
  "dependencies",
  "asks",
] as const;
export type OwnerUpdateField = (typeof OWNER_UPDATE_FIELDS)[number];

export const OWNER_UPDATE_SUBJECT_TYPES = ["transformation", "workstream"] as const;
export const ownerUpdateSubjectType = z.enum(OWNER_UPDATE_SUBJECT_TYPES);
export type OwnerUpdateSubjectType = z.infer<typeof ownerUpdateSubjectType>;

export const OWNER_UPDATE_STATUSES = ["draft", "submitted"] as const;
export const ownerUpdateStatus = z.enum(OWNER_UPDATE_STATUSES);
export type OwnerUpdateStatus = z.infer<typeof ownerUpdateStatus>;

/** One structured field: null clears it; otherwise 1-2000 characters of non-blank free text. */
const field = freeText(1, 2000).nullable();
/** The stored value of a field in a response (already validated when written). */
const storedField = z.string().min(1).max(2000).nullable();

/** The eight fields of a create or patch body: each optional. */
const optionalFieldShape = {
  achievements: field.optional(),
  nextSteps: field.optional(),
  milestones: field.optional(),
  outcomes: field.optional(),
  adoption: field.optional(),
  risks: field.optional(),
  dependencies: field.optional(),
  asks: field.optional(),
};
const storedFieldShape = {
  achievements: storedField,
  nextSteps: storedField,
  milestones: storedField,
  outcomes: storedField,
  adoption: storedField,
  risks: storedField,
  dependencies: storedField,
  asks: storedField,
};

/** OpenAPI `OwnerUpdateCreate`: the subject, the period and any of the eight fields. */
export const ownerUpdateCreate = z.strictObject({
  subjectType: ownerUpdateSubjectType,
  subjectId: uuid,
  reportingPeriodId: uuid,
  ...optionalFieldShape,
});
export type OwnerUpdateCreate = z.infer<typeof ownerUpdateCreate>;

/** OpenAPI `OwnerUpdatePatch`: at least one of the eight fields; null clears a field. */
export const ownerUpdatePatch = z
  .strictObject(optionalFieldShape)
  .refine((b) => Object.keys(b).length >= 1, { message: "validation.min_properties" });
export type OwnerUpdatePatch = z.infer<typeof ownerUpdatePatch>;

/** OpenAPI `OwnerUpdateReopen`: the reason (3-1000 characters, shared free-text rule). */
export const ownerUpdateReopen = z.strictObject({ reason: freeText(3, 1000) });
export type OwnerUpdateReopen = z.infer<typeof ownerUpdateReopen>;

/** OpenAPI `OwnerUpdate`. */
export const ownerUpdate = z.strictObject({
  id: uuid,
  transformationId: uuid,
  subjectType: ownerUpdateSubjectType,
  subjectId: uuid,
  reportingPeriodId: uuid,
  periodLabel: z.string(),
  ownerUserId: uuid,
  ...storedFieldShape,
  status: ownerUpdateStatus,
  revisionNo: z.number().int().min(0),
  submittedAt: timestamp.nullable(),
  submittedBy: uuid.nullable(),
  reopenReason: z.string().min(3).max(1000).nullable(),
  version,
  createdAt: timestamp,
  updatedAt: timestamp,
});
export type OwnerUpdate = z.infer<typeof ownerUpdate>;

export const ownerUpdatePage = z.strictObject({ items: z.array(ownerUpdate), nextCursor: z.string().nullable() });
export type OwnerUpdatePage = z.infer<typeof ownerUpdatePage>;

/** OpenAPI `OwnerUpdateRevision`: the eight fields as submitted. */
export const ownerUpdateRevision = z.strictObject({
  revisionNo: z.number().int().min(1),
  ...storedFieldShape,
  submittedAt: timestamp,
  submittedBy: uuid,
});
export type OwnerUpdateRevision = z.infer<typeof ownerUpdateRevision>;

export const ownerUpdateRevisionPage = z.strictObject({
  items: z.array(ownerUpdateRevision),
  nextCursor: z.string().nullable(),
});
export type OwnerUpdateRevisionPage = z.infer<typeof ownerUpdateRevisionPage>;

/** ADR-0045 §11: the owner-update refusals and their exact English texts (the code is the i18n key). */
export const OWNER_UPDATE_REFUSALS = {
  "owner_update.not_owner":
    "Only the workstream lead, or for the transformation its Transformation Lead, can write this update.",
  "owner_update.exists": "An update for this subject and reporting period already exists.",
  "owner_update.period_not_open": "Updates can be written only while their reporting period is open.",
  "owner_update.not_draft": "Only a draft update can be changed or submitted.",
  "owner_update.empty": "Write at least one of the eight fields before submitting.",
  "owner_update.not_submitted": "Only a submitted update can be reopened.",
} as const;
export type OwnerUpdateRefusalCode = keyof typeof OWNER_UPDATE_REFUSALS;
