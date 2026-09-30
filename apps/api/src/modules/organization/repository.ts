// organization module data access: the only writer of organization and business_unit.
import type { BusinessUnitRow, DbOrTx, OrganizationRow } from "@mth/db";
import type { BusinessUnit, Organization } from "@mth/shared/schemas";
import { iso } from "../platform/index.ts";

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
