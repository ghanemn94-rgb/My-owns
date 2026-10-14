// zod mirrors of the P5 slice B form-framework components of BE-E (docs/api/openapi.yaml tag `forms`:
// FormRecordVersion(Page), FormRecordComment(Page), FormRecordCommentCreate, FormRecordAttachment(Page),
// FormRecordAttachmentCreate, FormRecordAttachmentRemove; ADR-0041 §5, §6, §10; T-DG5-BE-E, p5-work-split §B.3).
// The OpenAPI file is the source of truth; the contract test parses every success body with these.
// Comments and attachments approve nothing: no G1-G6 business approval is granted or recorded here.
import { z } from "zod";
import { freeText, page, reason, timestamp, uuid } from "./common.ts";
import { formRecordTypeCode } from "./forms.ts";

/** The filter of listFormRecordAttachments beside Cursor and Limit (IncludeRemovedQuery, default false). */
export const formRecordAttachmentFilter = z.strictObject({
  includeRemoved: z.stringbool({ truthy: ["true"], falsy: ["false"] }).default(false),
});

/** One entry of a record's version history, read from the audit trail (ADR-0041 §5 "Version history"). */
export const formRecordVersion = z.strictObject({
  version: z.number().int().min(1).nullable(),
  action: z.string(),
  actorUserId: uuid.nullable(),
  actorDisplayName: z.string().nullable(),
  occurredAt: timestamp,
  changedFields: z.array(z.string()),
});
export type FormRecordVersion = z.infer<typeof formRecordVersion>;
export const formRecordVersionPage = page(formRecordVersion);

/** Comment bodies follow the shared free-text rules (p5-work-split §2 rule 1): 1-4000, not blank, storable. */
export const formRecordCommentBody = freeText(1, 4000);
export const formRecordCommentCreate = z.strictObject({
  body: formRecordCommentBody,
  parentCommentId: uuid.nullable().optional(),
});
export const formRecordComment = z.strictObject({
  id: uuid,
  recordType: formRecordTypeCode,
  recordId: uuid,
  parentCommentId: uuid.nullable(),
  body: z.string().min(1).max(4000),
  createdAt: timestamp,
  createdBy: uuid,
  createdByDisplayName: z.string().nullable(),
});
export type FormRecordComment = z.infer<typeof formRecordComment>;
export const formRecordCommentPage = page(formRecordComment);

export const FORM_ATTACHMENT_STORES = ["evidence_link", "form_record_attachment"] as const;
export const formRecordAttachmentCreate = z.strictObject({ evidenceId: uuid });
export const formRecordAttachmentRemove = z.strictObject({ reason });
export const formRecordAttachment = z.strictObject({
  id: uuid,
  store: z.enum(FORM_ATTACHMENT_STORES),
  recordType: formRecordTypeCode,
  recordId: uuid,
  evidenceId: uuid,
  evidenceTitle: z.string().nullable(),
  status: z.enum(["active", "removed"]),
  removedAt: timestamp.nullable(),
  removeReason: z.string().min(3).max(1000).nullable(),
  version: z.number().int().min(1),
  createdAt: timestamp,
  createdBy: uuid,
});
export type FormRecordAttachment = z.infer<typeof formRecordAttachment>;
export const formRecordAttachmentPage = page(formRecordAttachment);
