// The evidence register and evidence versions (ADR-0045 §8; REQ-S13-010, M0255; p5-work-split §F.7; T-DG5-BE-O):
//   GET /transformations/{id}/evidence-register                       listEvidenceRegister  (transformation.read)
//   GET /transformations/{id}/evidence/{evidenceId}/versions          listEvidenceVersions  (transformation.read)
//
// Read paths only: every M0255 field already exists in the DG2 tables (0012/0019); no evidence column is added and
// the DG2 upload, review and download paths are unchanged. Per item the register shows its record linkage, evidence
// type, source, owner, observation period, upload date, version, checksum and review status:
//  - source and observation period are returned as stored; NULL is "Not stated" in every view (never blank, never
//    invented here);
//  - upload date: the current content revision's uploaded_at for a file, else the item's created_at (a note or link
//    has no content revision);
//  - version: the current content revision (files) and, for every item, the record version;
//  - checksum: the current content's SHA-256 (files only; a note or link has none);
//  - links: every ACTIVE link of the item, across the DG2 `evidence_link` table and the domain link tables that
//    reference an evidence item, including the DG4 agenda materials array (`via` names the table;
//    EVIDENCE_LINK_SOURCES, checked against the catalogue by the integration test). Removed, revoked, withdrawn and
//    archived link rows are not shown; the evidence item itself is listed whatever its own status (the register shows
//    `status`). Snapshot citations (`report_snapshot_evidence`) are not links; listReportSnapshotEvidence lists them.
// The versions list is every content revision of an item, newest first (DG2 append-only `evidence_content`); a second
// upload is revision 2 beside revision 1, each with its own checksum and upload time.
//
// Authorization equals the parent record's (M0255): transformation.read in the transformation. A caller who holds
// transformation.read nowhere gets 403; one who holds it, but not in this transformation, gets 404 (no existence
// leak; the DG1 read rule). AUD reads. Each list reads in one read-only REPEATABLE READ transaction, so an item and
// its links come from the same database state.
import { sql, type Db, type Tx } from "@mth/db";
import { EVIDENCE_TYPES } from "@mth/shared/schemas";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { holdsAnywhere, principalOf, requireTransformationRead } from "../access/index.ts";
import {
  cursorSchema,
  decodeCursor,
  filterHash,
  iso,
  limitSchema,
  paginate,
  parse,
  parseQuery,
  problems,
} from "../platform/index.ts";

const T = "/api/v1/transformations/:transformationId";
const REGISTER = `${T}/evidence-register`;
const VERSIONS = `${T}/evidence/:evidenceId/versions`;
const tParams = z.strictObject({ transformationId: z.uuid() });
const itemParams = z.strictObject({ transformationId: z.uuid(), evidenceId: z.uuid() });
export const REVIEW_STATUSES = ["unverified", "verified", "rejected"] as const;
const registerQuery = z.strictObject({
  cursor: cursorSchema,
  limit: limitSchema,
  reviewStatus: z.enum(REVIEW_STATUSES).optional(),
  evidenceType: z.enum(EVIDENCE_TYPES).optional(),
  recordType: z
    .string()
    .regex(/^[a-z][a-z0-9_]{1,63}$/)
    .optional(),
});
const pageQuery = z.strictObject({ cursor: cursorSchema, limit: limitSchema });

export interface EvidenceRegisterLink {
  readonly recordType: string;
  readonly recordId: string;
  /** The table that holds the link (`evidence_link` or a domain link table). */
  readonly via: string;
}

export interface EvidenceRegisterItem {
  readonly evidenceId: string;
  readonly title: string;
  readonly kind: "file" | "note" | "external_link" | "file_reference";
  readonly evidenceType: (typeof EVIDENCE_TYPES)[number];
  readonly source: string | null;
  readonly ownerUserId: string;
  readonly observationStart: string | null;
  readonly observationEnd: string | null;
  readonly uploadedAt: string;
  readonly currentRevision: number | null;
  readonly recordVersion: number;
  readonly sha256: string | null;
  readonly reviewStatus: (typeof REVIEW_STATUSES)[number];
  readonly accessibilityStatus: "unchecked" | "accessible" | "inaccessible";
  readonly status: "active" | "archived";
  readonly links: EvidenceRegisterLink[];
}

export interface EvidenceVersion {
  readonly contentId: string;
  readonly revision: number;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly contentType: string;
  readonly fileName: string;
  readonly uploadedBy: string;
  readonly uploadedAt: string;
}

/**
 * The link sources of an evidence item: the DG2 `evidence_link` table and every domain table that references an
 * evidence item, each with the record it links and the rule that makes a row active. One row per (item, record,
 * table); `recordType` is the linked record's type as the owning module names it.
 */
export const EVIDENCE_LINK_SOURCES: readonly {
  readonly via: string;
  readonly recordType: string | null; // null: the table's own record_type column
  readonly recordIdColumn: string;
  readonly active: string | null; // a SQL predicate on the table's columns, or null (append-only rows)
  readonly evidenceArray?: string; // the uuid[] column listing the evidence items, when not one evidence_id column
}[] = [
  { via: "evidence_link", recordType: null, recordIdColumn: "record_id", active: "status = 'active'" },
  { via: "form_record_attachment", recordType: null, recordIdColumn: "record_id", active: "status = 'active'" },
  { via: "benefit_evidence", recordType: "benefit", recordIdColumn: "benefit_id", active: null },
  { via: "benefit_evidence", recordType: "benefit_measurement", recordIdColumn: "measurement_id", active: null },
  { via: "kpi_actual_evidence", recordType: "kpi_actual", recordIdColumn: "kpi_actual_id", active: null },
  { via: "bau_handover_evidence", recordType: "bau_handover", recordIdColumn: "handover_id", active: null },
  {
    via: "phase_step_evidence",
    recordType: "phase_step",
    recordIdColumn: "phase_step_id",
    active: "status = 'active'",
  },
  {
    via: "diagnostic_workstream_output",
    recordType: "diagnostic_workstream_output",
    recordIdColumn: "id",
    active: "status = 'active'",
  },
  {
    via: "gate_dispensation",
    recordType: "gate_dispensation",
    recordIdColumn: "id",
    active: "status IN ('pending', 'accepted')",
  },
  { via: "rag_override", recordType: "rag_override", recordIdColumn: "id", active: "status = 'active'" },
  { via: "inherited_record", recordType: "inherited_record", recordIdColumn: "id", active: "status = 'active'" },
  {
    via: "gate_condition_closure",
    recordType: "gate_decision_condition",
    recordIdColumn: "gate_decision_condition_id",
    active: null,
  },
  { via: "day_ninety_response", recordType: "day_ninety_response", recordIdColumn: "id", active: null },
  { via: "health_assessment_answer", recordType: "health_assessment_answer", recordIdColumn: "id", active: null },
  // DG4 agenda materials (0044): an agenda item lists up to 20 evidence items; a withdrawn item links none.
  {
    via: "agenda_item",
    recordType: "agenda_item",
    recordIdColumn: "id",
    active: "status <> 'withdrawn'",
    evidenceArray: "materials_evidence_ids",
  },
];

/** The active links of the transformation's evidence, as one derived table (evidence_id, record_type, record_id, via). */
function activeLinks(transformationId: string) {
  const parts = EVIDENCE_LINK_SOURCES.map((s) => {
    // Table, column and predicate names are the constants above (never request input); the id is a bound parameter.
    if (s.evidenceArray !== undefined)
      return sql`SELECT m.evidence_id, ${sql.lit(s.recordType ?? s.via)}::text AS record_type, ${sql.ref(
        s.recordIdColumn,
      )} AS record_id, ${sql.lit(s.via)}::text AS via FROM ${sql.table(s.via)} CROSS JOIN LATERAL unnest(${sql.ref(
        s.evidenceArray,
      )}) AS m(evidence_id) WHERE transformation_id = ${transformationId}::uuid${
        s.active === null ? sql`` : sql` AND ${sql.raw(s.active)}`
      }`;
    const recordType = s.recordType === null ? sql.ref("record_type") : sql.lit(s.recordType);
    const conditions = [
      sql`transformation_id = ${transformationId}::uuid`,
      sql`evidence_id IS NOT NULL`,
      sql`${sql.ref(s.recordIdColumn)} IS NOT NULL`,
      ...(s.active === null ? [] : [sql.raw(s.active)]),
    ];
    return sql`SELECT evidence_id, ${recordType}::text AS record_type, ${sql.ref(s.recordIdColumn)} AS record_id, ${sql.lit(
      s.via,
    )}::text AS via FROM ${sql.table(s.via)} WHERE ${sql.join(conditions, sql` AND `)}`;
  });
  return sql.join(parts, sql` UNION ALL `);
}

/** Denies a caller who holds transformation.read nowhere (403), then scopes it to the transformation (404). */
async function requireRegisterRead(db: Db | Tx, request: FastifyRequest, transformationId: string): Promise<void> {
  const principal = principalOf(request);
  if (!holdsAnywhere(principal, "transformation.read")) throw problems.forbidden();
  await requireTransformationRead(db, principal, transformationId);
}

function readOnly<R>(db: Db, fn: (tx: Tx) => Promise<R>): Promise<R> {
  return db.transaction().setIsolationLevel("repeatable read").setAccessMode("read only").execute(fn);
}

const dateOrNull = (d: unknown): string | null => (d === null || d === undefined ? null : String(d).slice(0, 10));

/** One page of the evidence register, newest item first (ids are UUIDv7). */
export async function listEvidenceRegister(
  tx: Tx,
  transformationId: string,
  query: z.infer<typeof registerQuery>,
): Promise<{ items: EvidenceRegisterItem[]; nextCursor: string | null }> {
  const hash = filterHash({
    table: "evidence_register",
    transformationId,
    reviewStatus: query.reviewStatus,
    evidenceType: query.evidenceType,
    recordType: query.recordType,
  });
  const after = decodeCursor(query.cursor, hash, 1);
  let q = tx
    .selectFrom("evidence as e")
    .leftJoin("evidence_content as c", (j) =>
      j.onRef("c.id", "=", "e.current_content_id").onRef("c.evidence_id", "=", "e.id"),
    )
    .select([
      "e.id",
      "e.title",
      "e.kind",
      "e.evidence_type",
      "e.source",
      "e.owner_user_id",
      "e.observation_start",
      "e.observation_end",
      "e.created_at",
      "e.version",
      "e.review_status",
      "e.accessibility_status",
      "e.status",
      "c.revision",
      "c.sha256",
      "c.uploaded_at",
    ])
    .where("e.transformation_id", "=", transformationId);
  if (query.reviewStatus !== undefined) q = q.where("e.review_status", "=", query.reviewStatus);
  if (query.evidenceType !== undefined) q = q.where("e.evidence_type", "=", query.evidenceType);
  if (query.recordType !== undefined)
    q = q.where(
      sql<boolean>`e.id IN (SELECT l.evidence_id FROM (${activeLinks(transformationId)}) l WHERE l.record_type = ${query.recordType})`,
    );
  if (after) q = q.where("e.id", "<", String(after[0]));
  const rows = await q
    .orderBy("e.id", "desc")
    .limit(query.limit + 1)
    .execute();
  const page = paginate(rows, query.limit, (r) => [r.id], hash);
  const ids = page.items.map((r) => r.id);
  const links = new Map<string, EvidenceRegisterLink[]>();
  if (ids.length > 0) {
    const linkRows = await sql<{ evidence_id: string; record_type: string; record_id: string; via: string }>`
      SELECT DISTINCT l.evidence_id, l.record_type, l.record_id, l.via FROM (${activeLinks(transformationId)}) l
       WHERE l.evidence_id = ANY(${ids}::uuid[])
       ORDER BY l.evidence_id, l.via, l.record_type, l.record_id`.execute(tx);
    for (const l of linkRows.rows) {
      const list = links.get(l.evidence_id) ?? [];
      list.push({ recordType: l.record_type, recordId: l.record_id, via: l.via });
      links.set(l.evidence_id, list);
    }
  }
  return {
    items: page.items.map(
      (r): EvidenceRegisterItem => ({
        evidenceId: r.id,
        title: r.title,
        kind: r.kind as EvidenceRegisterItem["kind"],
        evidenceType: r.evidence_type as EvidenceRegisterItem["evidenceType"],
        source: r.source,
        ownerUserId: r.owner_user_id,
        observationStart: dateOrNull(r.observation_start),
        observationEnd: dateOrNull(r.observation_end),
        uploadedAt: iso(r.uploaded_at ?? r.created_at),
        currentRevision: r.revision ?? null,
        recordVersion: r.version,
        sha256: r.sha256 === null ? null : r.sha256.trim(),
        reviewStatus: r.review_status as EvidenceRegisterItem["reviewStatus"],
        accessibilityStatus: r.accessibility_status as EvidenceRegisterItem["accessibilityStatus"],
        status: r.status as EvidenceRegisterItem["status"],
        links: links.get(r.id) ?? [],
      }),
    ),
    nextCursor: page.nextCursor,
  };
}

/** One page of an item's content revisions, newest first; 404 when the item is not one of the transformation's. */
export async function listEvidenceVersions(
  tx: Tx,
  transformationId: string,
  evidenceId: string,
  query: z.infer<typeof pageQuery>,
): Promise<{ items: EvidenceVersion[]; nextCursor: string | null }> {
  const item = await tx
    .selectFrom("evidence")
    .select("id")
    .where("id", "=", evidenceId)
    .where("transformation_id", "=", transformationId)
    .executeTakeFirst();
  if (item === undefined) throw problems.notFound();
  const hash = filterHash({ table: "evidence_content", evidenceId });
  const after = decodeCursor(query.cursor, hash, 1);
  let q = tx
    .selectFrom("evidence_content")
    .selectAll()
    .where("evidence_id", "=", evidenceId)
    .where("transformation_id", "=", transformationId);
  if (after) q = q.where("revision", "<", Number(after[0]));
  const rows = await q
    .orderBy("revision", "desc")
    .limit(query.limit + 1)
    .execute();
  const page = paginate(rows, query.limit, (r) => [r.revision], hash);
  return {
    items: page.items.map(
      (r): EvidenceVersion => ({
        contentId: r.id,
        revision: r.revision,
        sha256: r.sha256.trim(),
        sizeBytes: Number(r.size_bytes),
        contentType: r.content_type,
        fileName: r.file_name,
        uploadedBy: r.uploaded_by,
        uploadedAt: iso(r.uploaded_at),
      }),
    ),
    nextCursor: page.nextCursor,
  };
}

/** Registers this file's routes and returns them as "METHOD /path". */
export function registerEvidenceRegisterRoutes(app: FastifyInstance, db: Db): string[] {
  const read = { access: { permission: "transformation.read" as const } };

  app.get(REGISTER, { config: read }, async (request) => {
    const { transformationId } = parse(tParams, request.params, "params");
    const query = parseQuery(registerQuery, request.query);
    return readOnly(db, async (tx) => {
      await requireRegisterRead(tx, request, transformationId);
      return listEvidenceRegister(tx, transformationId, query);
    });
  });

  app.get(VERSIONS, { config: read }, async (request) => {
    const { transformationId, evidenceId } = parse(itemParams, request.params, "params");
    const query = parseQuery(pageQuery, request.query);
    return readOnly(db, async (tx) => {
      await requireRegisterRead(tx, request, transformationId);
      return listEvidenceVersions(tx, transformationId, evidenceId, query);
    });
  });

  return [`GET ${REGISTER}`, `GET ${VERSIONS}`];
}
