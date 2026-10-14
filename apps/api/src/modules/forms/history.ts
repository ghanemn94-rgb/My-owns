// Version history of one record (OpenAPI tag "forms"; ADR-0041 §5 "Version history"; REQ-S05-001; p5-work-split §B.3;
// T-DG5-BE-E):
//   GET /transformations/{t}/form-records/{recordType}/{recordId}/versions   listFormRecordVersions
// Read model only, from the existing audit trail (ADR-0004): every register write already writes one `audit_event`
// for (record_type = the register's table, record_id) with `new_version` and a `changes` object, so a new version
// appears here as soon as the register commits it. No back-fill and no new table (p5-plan §3 row 6). Each entry gives
// the version, the action, the actor (id and display name), the time and the CHANGED FIELD NAMES only, never the
// values (a reader of a form is not an auditor: `audit.read` stays the only way to see before/after values).
// Authorization: `transformation.read` in scope (404 outside it, as for every record of the transformation); an
// unknown record type, a planned one (no table) or a record not in this transformation is 404. Oldest first; the
// cursor is the audit sequence number.
import { type Db } from "@mth/db";
import { formRecordTypeCode, uuid, type FormRecordVersion } from "@mth/shared/schemas";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
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
  type ModuleDeps,
} from "../platform/index.ts";
import { loadRecordType, recordExists, requireTransformationRead } from "./record-types.ts";

export const FORM_RECORD = "/api/v1/transformations/:transformationId/form-records/:recordType/:recordId";
export const VERSIONS = `${FORM_RECORD}/versions`;
export const recordParams = z.strictObject({ transformationId: uuid, recordType: formRecordTypeCode, recordId: uuid });
export type RecordParams = z.infer<typeof recordParams>;
const listQuery = z.strictObject({ cursor: cursorSchema, limit: limitSchema });

/**
 * The read gate shared by the BE-E read operations: the transformation in the caller's read scope (404 outside it),
 * then a stored record of the registered type in that transformation (404 otherwise; a planned type has no records).
 * Returns the record type row (with its table).
 */
export async function requireRecordRead(
  db: Db,
  request: Parameters<typeof requireTransformationRead>[1],
  p: RecordParams,
) {
  await requireTransformationRead(db, request, p.transformationId);
  const rt = await loadRecordType(db, p.recordType);
  if (rt.table_name === null || !(await recordExists(db, rt, p.transformationId, p.recordId)))
    throw problems.notFound();
  return rt as typeof rt & { table_name: string };
}

const UUID_KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SEQ_KEY = /^[1-9][0-9]{0,18}$/;

/**
 * The single key of a decoded cursor, checked against its shape (`uuid` row id or audit `seq`): a well-formed cursor
 * whose key was altered is 400 validation.cursor, never a database cast error.
 */
export function cursorKey(after: readonly (string | number | null)[] | null, kind: "uuid" | "seq"): string | null {
  if (after === null) return null;
  const key = String(after[0]);
  if (!(kind === "uuid" ? UUID_KEY : SEQ_KEY).test(key))
    throw problems.badRequest(
      "validation.cursor",
      "The cursor is invalid or belongs to other filters.",
      "/query/cursor",
    );
  return key;
}

/** The top-level keys of an audit `changes` object, sorted (field names only; never the values). */
export function changedFieldsOf(changes: unknown): string[] {
  if (changes === null || typeof changes !== "object" || Array.isArray(changes)) return [];
  return Object.keys(changes).sort();
}

export function registerFormHistoryRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  app.get(VERSIONS, { config: { access: { permission: "transformation.read" } } }, async (request) => {
    const p = parse(recordParams, request.params, "params");
    const query = parseQuery(listQuery, request.query);
    const rt = await requireRecordRead(db, request, p);
    const hash = filterHash({ list: "versions", recordType: p.recordType, recordId: p.recordId });
    const after = cursorKey(decodeCursor(query.cursor, hash, 1), "seq");
    let q = db
      .selectFrom("audit_event as e")
      .leftJoin("app_user as u", "u.id", "e.actor_user_id")
      .select(["e.seq", "e.new_version", "e.action", "e.actor_user_id", "u.display_name", "e.occurred_at", "e.changes"])
      // The table name comes from the read-only registry (0068 seed), never from input.
      .where("e.record_type", "=", rt.table_name)
      .where("e.record_id", "=", p.recordId);
    if (after !== null) q = q.where("e.seq", ">", after);
    const rows = await q
      .orderBy("e.seq", "asc")
      .limit(query.limit + 1)
      .execute();
    const pageOf = paginate(rows, query.limit, (r) => [String(r.seq)], hash);
    const items: FormRecordVersion[] = pageOf.items.map((r) => ({
      version: r.new_version !== null && r.new_version >= 1 ? r.new_version : null,
      action: r.action,
      actorUserId: r.actor_user_id,
      actorDisplayName: r.display_name ?? null,
      occurredAt: iso(r.occurred_at),
      changedFields: changedFieldsOf(r.changes),
    }));
    return { items, nextCursor: pageOf.nextCursor };
  });
  return [`GET ${VERSIONS}`];
}
