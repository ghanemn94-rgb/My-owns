// P2 evidence mirrors (backend-workflow-engineer; ADR-0018): evidence items (stored file, native note, external link or
// bare filename reference), the review body and evidence links. Only `verified` evidence counts toward a product-gate
// criterion; a bare filename or an inaccessible link never does (REQ-S13-012). Mirrors docs/api/openapi.yaml Evidence*,
// EvidenceReview, EvidenceLink*.
import { z } from "zod";
import { reason, timestamp, uuid, version } from "./common.ts";
import { p2ArchiveFields, p2RecordStamps } from "./direction.ts";
import { businessDate } from "./kpi.ts";
import { linkableRecordType } from "./methodology.ts";

const text = (min: number, max: number) => z.string().min(min).max(max);
const nullableUuid = uuid.nullable();

export const EVIDENCE_KINDS = ["file", "note", "external_link", "file_reference"] as const;
export const EVIDENCE_TYPES = [
  "document",
  "data_extract",
  "analysis",
  "interview",
  "observation",
  "system_report",
  "other",
] as const;
/** http(s) only; never javascript:, data: or file: (ADR-0018 §1). */
export const evidenceUrl = z
  .string()
  .max(2000)
  .regex(/^https?:\/\//, "validation.url_scheme");

const evidenceFields = {
  title: text(1, 300),
  description: text(1, 4000).nullable(),
  evidenceType: z.enum(EVIDENCE_TYPES),
  source: text(1, 500).nullable(),
  ownerUserId: uuid,
  observationStart: businessDate.nullable(),
  observationEnd: businessDate.nullable(),
  noteBody: text(1, 20000).nullable(),
  url: evidenceUrl.nullable(),
  fileName: text(1, 255).nullable(),
};

export const evidence = z.strictObject({
  ...p2RecordStamps,
  kind: z.enum(EVIDENCE_KINDS),
  ...evidenceFields,
  currentContentId: nullableUuid,
  reviewStatus: z.enum(["unverified", "verified", "rejected"]),
  accessibilityStatus: z.enum(["unchecked", "accessible", "inaccessible"]),
  reviewedContentId: nullableUuid,
  reviewedBy: nullableUuid,
  reviewedAt: timestamp.nullable(),
  reviewNote: text(1, 2000).nullable(),
  status: z.enum(["active", "archived"]),
  ...p2ArchiveFields,
});
export type Evidence = z.infer<typeof evidence>;

const observationRange = (v: {
  observationStart?: string | null | undefined;
  observationEnd?: string | null | undefined;
}) =>
  (v.observationStart ?? null) === null ||
  (v.observationEnd ?? null) === null ||
  v.observationEnd! >= v.observationStart!;

/** The payload must match the kind: a note needs noteBody, a link needs url, a filename reference needs fileName. */
export const evidenceCreate = z
  .strictObject({ kind: z.enum(EVIDENCE_KINDS), ...evidenceFields })
  .partial()
  .required({ kind: true, title: true, ownerUserId: true })
  .superRefine((v, ctx) => {
    const has = (x: unknown) => x !== undefined && x !== null;
    const need = (ok: boolean, path: string, message: string) => {
      if (!ok) ctx.addIssue({ code: "custom", path: [path], message });
    };
    if (v.kind === "note") need(has(v.noteBody), "noteBody", "validation.required");
    if (v.kind === "external_link") need(has(v.url), "url", "validation.required");
    if (v.kind === "file_reference") need(has(v.fileName), "fileName", "validation.required");
    if (v.kind !== "note") need(!has(v.noteBody), "noteBody", "validation.not_allowed_for_kind");
    if (v.kind !== "external_link") need(!has(v.url), "url", "validation.not_allowed_for_kind");
    need(observationRange(v), "observationEnd", "validation.observation_range");
  });
export const evidenceUpdate = z
  .strictObject(evidenceFields)
  .partial()
  .refine((v) => Object.keys(v).length >= 1, "validation.min_properties");
export const evidencePage = z.strictObject({ items: z.array(evidence), nextCursor: z.string().nullable() });

/** Reviewer's verdict; the reviewer explicitly confirms accessibility (never inferred from a URL; no SSRF). */
export const evidenceReview = z.strictObject({
  result: z.enum(["verified", "rejected"]),
  accessibilityStatus: z.enum(["accessible", "inaccessible"]),
  note: text(1, 2000),
});

export const evidenceLink = z.strictObject({
  id: uuid,
  organizationId: uuid,
  transformationId: uuid,
  evidenceId: uuid,
  recordType: linkableRecordType,
  recordId: uuid,
  status: z.enum(["active", "removed"]),
  removedAt: timestamp.nullable(),
  removedBy: nullableUuid,
  removeReason: reason.nullable(),
  version,
  createdAt: timestamp,
  createdBy: uuid,
  updatedAt: timestamp,
  updatedBy: uuid,
});
export type EvidenceLink = z.infer<typeof evidenceLink>;
export const evidenceLinkCreate = z.strictObject({ evidenceId: uuid, recordType: linkableRecordType, recordId: uuid });
export const evidenceLinkPage = z.strictObject({ items: z.array(evidenceLink), nextCursor: z.string().nullable() });
export const evidenceLinkListQuery = z.strictObject({
  recordType: linkableRecordType.optional(),
  recordId: uuid.optional(),
});
