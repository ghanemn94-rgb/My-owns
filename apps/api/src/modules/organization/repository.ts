// organization module data access: the only writer of organization and business_unit.
import { sql, type BusinessUnitRow, type DbOrTx, type OrganizationRow } from "@mth/db";
import type { BusinessUnit, Organization } from "@mth/shared/schemas";
import { ADVISORY_LOCK_CLASSES, iso } from "../platform/index.ts";

export function toOrganization(r: OrganizationRow): Organization {
  return {
    id: r.id,
    code: r.code,
    nameEn: r.name_en,
    nameAr: r.name_ar,
    defaultTimezone: r.default_timezone,
    defaultCurrency: r.default_currency,
    defaultLocale: r.default_locale as "ar" | "en",
    status: r.status as "active" | "inactive",
    version: r.version,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

export function toBusinessUnit(r: BusinessUnitRow): BusinessUnit {
  return {
    id: r.id,
    organizationId: r.organization_id,
    parentBusinessUnitId: r.parent_business_unit_id,
    code: r.code,
    nameEn: r.name_en,
    nameAr: r.name_ar,
    status: r.status as "active" | "inactive",
    version: r.version,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

export function findOrganization(db: DbOrTx, id: string, forUpdate = false): Promise<OrganizationRow | undefined> {
  let q = db.selectFrom("organization").selectAll().where("id", "=", id);
  if (forUpdate) q = q.forUpdate();
  return q.executeTakeFirst();
}

export function findBusinessUnit(db: DbOrTx, id: string, forUpdate = false): Promise<BusinessUnitRow | undefined> {
  let q = db.selectFrom("business_unit").selectAll().where("id", "=", id);
  if (forUpdate) q = q.forUpdate();
  return q.executeTakeFirst();
}

/** Deepest level below `id` (0 when it has no children), from the closure read model. */
export async function subtreeHeight(db: DbOrTx, id: string): Promise<number> {
  const r = await db
    .selectFrom("business_unit_closure")
    .select((eb) => eb.fn.max("depth").as("h"))
    .where("ancestor_id", "=", id)
    .executeTakeFirst();
  return Number(r?.h ?? 0);
}

export async function isDescendant(db: DbOrTx, ancestorId: string, candidateId: string): Promise<boolean> {
  const r = await db
    .selectFrom("business_unit_closure")
    .select("depth")
    .where("ancestor_id", "=", ancestorId)
    .where("descendant_id", "=", candidateId)
    .executeTakeFirst();
  return r !== undefined;
}

/**
 * Advisory-lock class of the business-unit hierarchy, shared with the database trigger business_unit_hierarchy_guard
 * (migration 0009, F-DG1-140). Same (class, hashtext(organization_id)) key on both sides. The number lives in the
 * platform registry (ADVISORY_LOCK_CLASSES, ADR-0016).
 */
export const HIERARCHY_LOCK_CLASS = ADVISORY_LOCK_CLASSES.businessUnitHierarchy;

/**
 * Serialize hierarchy changes of one organization for the rest of the transaction (F-DG1-140). Taken BEFORE the
 * friendly cycle/depth checks so that, under READ COMMITTED, they read what the previous holder committed. The
 * trigger takes the same lock again (re-entrant) and re-checks the invariant, so it holds even without this call.
 */
export async function lockBusinessUnitHierarchy(db: DbOrTx, organizationId: string): Promise<void> {
  await sql`SELECT pg_advisory_xact_lock(${HIERARCHY_LOCK_CLASS}::integer, hashtext(${organizationId}::text))`.execute(
    db,
  );
}

/** Which hierarchy invariant the database trigger refused (SQLSTATE 23514 + constraint name), if any. */
export function hierarchyViolation(e: unknown): "cycle" | "depth" | null {
  const err = e as { code?: string; constraint?: string };
  if (err.code !== "23514") return null;
  if (err.constraint === "business_unit_acyclic") return "cycle";
  if (err.constraint === "business_unit_max_depth") return "depth";
  return null;
}
