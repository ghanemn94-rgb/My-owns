// F-DG6-181 (ADR-0052 amendment of 2026-11-04 §A rule 4, §B; D-209; T-DG6-BE-Z2): the organization code a SecretRef
// binding names. `organization.code` is immutable in the product (OrganizationUpdate has no `code`; nothing updates it),
// so a per-process cache of id -> code is safe. An unknown id answers null, which binds nothing.
import type { DbOrTx } from "@mth/db";
import type { OrganizationCodeOf } from "./secrets.ts";

/** A cached `organization.code` lookup over `db` (the API composition and the write-time check). */
export function organizationCodeLookup(db: DbOrTx): OrganizationCodeOf {
  const cache = new Map<string, string>();
  return async (organizationId) => {
    const hit = cache.get(organizationId);
    if (hit !== undefined) return hit;
    const row = await db.selectFrom("organization").select("code").where("id", "=", organizationId).executeTakeFirst();
    if (row === undefined) return null;
    cache.set(organizationId, row.code);
    return row.code;
  };
}
