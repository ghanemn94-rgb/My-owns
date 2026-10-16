// P5 slice F (T-DG5-FE-E, promoted from apps/api/test/integration/contract/p5-exercises-be-o.ts of T-DG5-BE-O; D-159 e;
// ADR-0045 §8; REQ-S13-010): the mirrors of the OpenAPI schemas EvidenceRegisterPage and EvidenceVersionPage.
//  - `source`, `observationStart` and `observationEnd` are null when not stated (shown as "Not stated", never blank).
//  - `sha256` and `currentRevision` exist for files only; a note or link has no checksum and shows its record version.
//  - `reviewStatus` is the DG2 review state of the evidence; it is not a business approval.
import { z } from "zod";
import { EVIDENCE_TYPES } from "./evidence.ts";

const uuid = z.uuid();
const timestamp = z.iso.datetime({ offset: true });
const businessDate = z.iso.date();
const sha256 = z.string().regex(/^[0-9a-f]{64}$/);

export const EVIDENCE_REGISTER_KINDS = ["file", "note", "external_link", "file_reference"] as const;
export const EVIDENCE_REVIEW_STATUSES = ["unverified", "verified", "rejected"] as const;
export const EVIDENCE_ACCESSIBILITY_STATUSES = ["unchecked", "accessible", "inaccessible"] as const;

export const evidenceRegisterLink = z.strictObject({ recordType: z.string(), recordId: uuid, via: z.string() });
export type EvidenceRegisterLink = z.infer<typeof evidenceRegisterLink>;

export const evidenceRegisterItem = z.strictObject({
  evidenceId: uuid,
  title: z.string(),
  kind: z.enum(EVIDENCE_REGISTER_KINDS),
  evidenceType: z.enum(EVIDENCE_TYPES),
  source: z.string().nullable(),
  ownerUserId: uuid,
  observationStart: businessDate.nullable(),
  observationEnd: businessDate.nullable(),
  uploadedAt: timestamp,
  currentRevision: z.number().int().min(1).nullable(),
  recordVersion: z.number().int().min(1),
  sha256: sha256.nullable(),
  reviewStatus: z.enum(EVIDENCE_REVIEW_STATUSES),
  accessibilityStatus: z.enum(EVIDENCE_ACCESSIBILITY_STATUSES),
  status: z.enum(["active", "archived"]),
  links: z.array(evidenceRegisterLink),
});
export type EvidenceRegisterItem = z.infer<typeof evidenceRegisterItem>;

/** OpenAPI `EvidenceRegisterPage`. */
export const evidenceRegisterPage = z.strictObject({
  items: z.array(evidenceRegisterItem),
  nextCursor: z.string().nullable(),
});
export type EvidenceRegisterPage = z.infer<typeof evidenceRegisterPage>;

export const evidenceVersion = z.strictObject({
  contentId: uuid,
  revision: z.number().int().min(1),
  sha256,
  sizeBytes: z.number().int().min(0),
  contentType: z.string(),
  fileName: z.string(),
  uploadedBy: uuid,
  uploadedAt: timestamp,
});
export type EvidenceVersion = z.infer<typeof evidenceVersion>;

/** OpenAPI `EvidenceVersionPage`. */
export const evidenceVersionPage = z.strictObject({
  items: z.array(evidenceVersion),
  nextCursor: z.string().nullable(),
});
export type EvidenceVersionPage = z.infer<typeof evidenceVersionPage>;
