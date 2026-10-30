// P6 slice F (T-DG6-BE-D; ADR-0052 §1, §2; REQ-S13-011): zod mirrors of the contract's UploadType, UploadPolicy and
// UploadPolicyUpdate (docs/api/openapi.yaml 1.5.0-p6), the read and write models of getUploadPolicy and putUploadPolicy
// (Administration > Security > Upload policy). The one free-text field (`reason`) uses the shared `reason` rule
// (trimmed, 3-1000 characters, not blank, no invalid character; p6-work-split §2 rule 1). Changing a policy approves
// nothing; it narrows which files a new upload may carry.
import { z } from "zod";
import { reason, timestamp, uuid } from "./common.ts";

/** The closed set of ADR-0052 §1 (D-195 Q4), in the contract's order. */
export const UPLOAD_TYPES = ["pdf", "docx", "xlsx", "pptx", "csv", "txt", "png", "jpeg", "gif", "svg"] as const;
export type UploadType = (typeof UPLOAD_TYPES)[number];
export const uploadType = z.enum(UPLOAD_TYPES);

/** The only types ever served inline (ADR-0052 §2); SVG is never previewed. */
export const INLINE_PREVIEW_TYPES = ["png", "jpeg", "gif"] as const;
export type InlinePreviewType = (typeof INLINE_PREVIEW_TYPES)[number];

/** The `upload_policy_max_bytes` ceiling (25 MiB, the DG2 EVIDENCE_MAX_BYTES). */
export const UPLOAD_POLICY_MAX_BYTES = 26214400;

const allowedTypes = z
  .array(uploadType)
  .min(1)
  .max(UPLOAD_TYPES.length)
  .refine((v) => new Set(v).size === v.length, "validation.unique_items");
const maxBytes = z.number().int().min(1).max(UPLOAD_POLICY_MAX_BYTES);

export const uploadPolicy = z.strictObject({
  organizationId: uuid,
  allowedTypes,
  maxBytes,
  isDefault: z.boolean(),
  inlinePreviewTypes: z.array(z.enum(INLINE_PREVIEW_TYPES)),
  reason: z.string().max(1000).nullable(),
  version: z.number().int().min(0),
  updatedAt: timestamp.nullable(),
});
export type UploadPolicy = z.infer<typeof uploadPolicy>;

export const uploadPolicyUpdate = z.strictObject({ allowedTypes, maxBytes, reason });
export type UploadPolicyUpdate = z.infer<typeof uploadPolicyUpdate>;
