// transformations data access: the only writer of the transformation table.
import { sql, type DbOrTx, type TransformationRow, type Tx } from "@mth/db";
import type { Transformation } from "@mth/shared/schemas";
import { iso, isoOrNull } from "../platform/index.ts";

export const TRANSFORMATION_AUDIT_FIELDS = [
  "code",
  "name",
  "description",
  "mode",
  "entry_phase",
  "standalone_deliverable_type",
  "status",
  "current_phase",
  "sponsor_user_id",
  "lead_user_id",
  "timezone",
  "currency",
  "business_unit_id",
] as const;
export const UPDATABLE_AUDIT_FIELDS = [
  "name",
  "description",
  "status",
  "sponsor_user_id",
  "lead_user_id",
  "timezone",
  "currency",
] as const;

export function toTransformation(r: TransformationRow): Transformation {
  return {
    id: r.id,
    organizationId: r.organization_id,
    businessUnitId: r.business_unit_id,
    code: r.code,
    name: r.name,
    description: r.description,
    mode: r.mode as Transformation["mode"],
    entryPhase: r.entry_phase as Transformation["entryPhase"],
    standaloneDeliverableType: r.standalone_deliverable_type as Transformation["standaloneDeliverableType"],
    status: r.status as Transformation["status"],
    currentPhase: r.current_phase as Transformation["currentPhase"],
    sponsorUserId: r.sponsor_user_id,
    leadUserId: r.lead_user_id,
    timezone: r.timezone,
    currency: r.currency,
    archivedAt: isoOrNull(r.archived_at),
    archiveReason: r.archive_reason,
    version: r.version,
    createdAt: iso(r.created_at),
    createdBy: r.created_by,
    updatedAt: iso(r.updated_at),
    updatedBy: r.updated_by,
  };
}

export function findTransformation(db: DbOrTx, id: string, forUpdate = false): Promise<TransformationRow | undefined> {
  let q = db.selectFrom("transformation").selectAll().where("id", "=", id);
  if (forUpdate) q = q.forUpdate();
  return q.executeTakeFirst();
}

/** Next readable code TR-0001, TR-0002, ... per organization, serialized by an advisory lock. */
export async function nextTransformationCode(tx: Tx, organizationId: string): Promise<string> {
  await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`trcode:${organizationId}`}, 0))`.execute(tx);
  const r = await tx
    .selectFrom("transformation")
    .select(sql<number | null>`max((substring(code from '^TR-([0-9]+)$'))::int)`.as("n"))
    .where("organization_id", "=", organizationId)
    .executeTakeFirst();
  return `TR-${String((r?.n ?? 0) + 1).padStart(4, "0")}`;
}

/** Users named as sponsor/lead must exist and be active (naming them grants NO access; ADR-0006). */
export async function activeUsersExist(db: DbOrTx, ids: readonly string[]): Promise<boolean> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return true;
  const rows = await db
    .selectFrom("app_user")
    .select("id")
    .where("id", "in", unique)
    .where("status", "=", "active")
    .execute();
  return rows.length === unique.length;
}
