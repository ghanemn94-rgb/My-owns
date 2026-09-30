// UI permission hints from GET /me `effectivePermissions` (ADR-0006). These only decide what the UI OFFERS; the
// server's policy function re-checks every request, and a 403/404 renders the no-permission state.
// Mirrors apps/api/src/modules/access/rules.ts: a grant applies to its own scope, and to narrower scopes when the
// role inherits downward or the permission is an organization-structure permission.
import type { Permission } from "@mth/shared";
import type { Me } from "../api/types.ts";

const STRUCTURAL = new Set<Permission>([
  "organization.read",
  "organization.manage",
  "business_unit.read",
  "business_unit.manage",
  "user.read",
  "user.manage",
  "role.read",
  "access.read",
  "access.assign",
]);

export interface PermissionTarget {
  readonly level: "organization" | "business_unit" | "transformation";
  readonly organizationId: string;
  readonly businessUnitId?: string | null;
  readonly transformationId?: string | null;
  /** The business unit itself followed by its ancestors, when known. */
  readonly businessUnitAncestry?: readonly string[];
}

type Entry = Me["effectivePermissions"][number];

function holds(entry: Entry, permission: Permission): boolean {
  return (entry.permissions as readonly string[]).includes(permission);
}

/** True if the caller holds `permission` at any scope (e.g. to show a navigation area or a "New" button). */
export function canAnywhere(me: Me | undefined, permission: Permission): boolean {
  return Boolean(me?.effectivePermissions.some((e) => holds(e, permission)));
}

export function canAny(me: Me | undefined, permissions: readonly Permission[]): boolean {
  return permissions.some((p) => canAnywhere(me, p));
}

/**
 * Hint for one target. `me.organization` is the caller's home organization: organization-scope grants in P1 are in
 * the home organization (cross-organization grants are shown only after the server says so).
 */
export function canOn(me: Me | undefined, permission: Permission, target: PermissionTarget): boolean {
  if (!me) return false;
  const ancestry = target.businessUnitAncestry ?? (target.businessUnitId ? [target.businessUnitId] : []);
  return me.effectivePermissions.some((e) => {
    if (!holds(e, permission)) return false;
    const down = e.inheritsDownward || STRUCTURAL.has(permission);
    switch (e.scope.type) {
      case "organization":
        return e.scope.id === target.organizationId && (target.level === "organization" || down);
      case "business_unit":
        if (target.level === "business_unit" && target.businessUnitId === e.scope.id) return true;
        return down && target.level !== "organization" && ancestry.includes(e.scope.id);
      case "transformation":
        return target.level === "transformation" && target.transformationId === e.scope.id;
      default:
        return false;
    }
  });
}

/** Business unit ids from `id` up to the root, using a loaded business-unit list. Cycles are cut defensively. */
export function ancestryOf(
  id: string | null | undefined,
  units: readonly { id: string; parentBusinessUnitId: string | null }[],
): string[] {
  const byId = new Map(units.map((u) => [u.id, u]));
  const out: string[] = [];
  let current = id ?? null;
  while (current && !out.includes(current)) {
    out.push(current);
    current = byId.get(current)?.parentBusinessUnitId ?? null;
  }
  return out;
}

/** Permissions that make the Administration area relevant (a Workstream Lead does not see it; A01). */
export const ADMIN_PERMISSIONS: readonly Permission[] = [
  "organization.manage",
  "business_unit.manage",
  "user.read",
  "user.manage",
  "access.read",
  "access.assign",
];
