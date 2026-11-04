// F-DG6-181 (ADR-0052 amendment of 2026-11-04 §A rule 4, §B; D-209; T-DG6-BE-Z2): the worker's organization code lookup
// for SecretRef bindings (ADR-0002 rule 5: the worker imports no API code; the API's is platform/organization-code.ts).
// `organization.code` is immutable in the product, so a per-process cache of id -> code is safe. Unknown id: null.
import type { DbOrTx } from "@mth/db";
import type { OrganizationCodeOf } from "./secrets.ts";

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
