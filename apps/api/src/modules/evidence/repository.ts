// evidence data access: API shapes and the facts the product-gate evaluators read (ADR-0018 §6).
import type { DbOrTx, EvidenceLinkTable, EvidenceRow } from "@mth/db";
import type { Evidence, EvidenceLink } from "@mth/shared/schemas";
import type { Selectable } from "kysely";
import { iso, isoOrNull } from "../platform/index.ts";

export function toEvidence(r: EvidenceRow): Evidence {
  return {
    id: r.id,
    organizationId: r.organization_id,
    transformationId: r.transformation_id,
    kind: r.kind as Evidence["kind"],
    title: r.title,
    description: r.description,
    evidenceType: r.evidence_type as Evidence["evidenceType"],
    source: r.source,
    ownerUserId: r.owner_user_id,
    observationStart: r.observation_start,
    observationEnd: r.observation_end,
    noteBody: r.note_body,
    url: r.url,
    fileName: r.file_name,
    currentContentId: r.current_content_id,
    reviewStatus: r.review_status as Evidence["reviewStatus"],
    accessibilityStatus: r.accessibility_status as Evidence["accessibilityStatus"],
    reviewedContentId: r.reviewed_content_id,
    reviewedBy: r.reviewed_by,
    reviewedAt: isoOrNull(r.reviewed_at),
    reviewNote: r.review_note,
    status: r.status as Evidence["status"],
    archivedAt: isoOrNull(r.archived_at),
    archivedBy: r.archived_by,
    archiveReason: r.archive_reason,
    version: r.version,
    createdAt: iso(r.created_at),
    createdBy: r.created_by,
    updatedAt: iso(r.updated_at),
    updatedBy: r.updated_by,
  };
}

export function toEvidenceLink(r: Selectable<EvidenceLinkTable>): EvidenceLink {
  return {
    id: r.id,
    organizationId: r.organization_id,
    transformationId: r.transformation_id,
    evidenceId: r.evidence_id,
    recordType: r.record_type as EvidenceLink["recordType"],
    recordId: r.record_id,
    status: r.status as EvidenceLink["status"],
    removedAt: isoOrNull(r.removed_at),
    removedBy: r.removed_by,
    removeReason: r.remove_reason,
    version: r.version,
    createdAt: iso(r.created_at),
    createdBy: r.created_by,
    updatedAt: iso(r.updated_at),
    updatedBy: r.updated_by,
  };
}

/** One active evidence item linked to a record, with whether it counts as verified evidence. */
export interface EvidenceFact {
  readonly evidenceId: string;
  readonly recordType: string;
  readonly recordId: string;
  readonly kind: string;
  /**
   * True only for an ACTIVE item a reviewer (not its creator) verified with accessible content (and, for a file, the
   * current revision). A bare filename (`file_reference`), an inaccessible link, a rejected or unreviewed item never
   * counts (REQ-S13-012; CHECKs evidence_verified_rule and evidence_filename_never_verified).
   */
  readonly verified: boolean;
}

/** Active evidence links of the given records (in one transformation) with their verification state. */
export async function loadVerifiedEvidenceFacts(
  db: DbOrTx,
  transformationId: string,
  records: ReadonlyArray<{ readonly recordType: string; readonly recordId: string }>,
): Promise<EvidenceFact[]> {
  if (records.length === 0) return [];
  const rows = await db
    .selectFrom("evidence_link as l")
    .innerJoin("evidence as e", "e.id", "l.evidence_id")
    .select([
      "l.evidence_id",
      "l.record_type",
      "l.record_id",
      "e.kind",
      "e.status",
      "e.review_status",
      "e.accessibility_status",
      "e.current_content_id",
      "e.reviewed_content_id",
    ])
    .where("l.transformation_id", "=", transformationId)
    .where("l.status", "=", "active")
    .where(
      "l.record_id",
      "in",
      records.map((r) => r.recordId),
    )
    .execute();
  const wanted = new Set(records.map((r) => `${r.recordType}:${r.recordId}`));
  return rows
    .filter((r) => wanted.has(`${r.record_type}:${r.record_id}`))
    .map((r) => ({
      evidenceId: r.evidence_id,
      recordType: r.record_type,
      recordId: r.record_id,
      kind: r.kind,
      verified:
        r.status === "active" &&
        r.review_status === "verified" &&
        r.accessibility_status === "accessible" &&
        r.kind !== "file_reference" &&
        (r.kind !== "file" || (r.current_content_id !== null && r.current_content_id === r.reviewed_content_id)),
    }));
}
