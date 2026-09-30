// Pure scope-resolution rules of the policy function (ADR-0006). No I/O: unit-tested exhaustively.
//
// A grant (role at scope S) applies to a target T iff
//   - S = T (same scope level and id), or
//   - S is an ancestor of T (organization -> business unit -> parent BU chain -> transformation) AND the grant
//     "applies downward" for this permission.
// A grant applies downward when its role inherits downward (TO, AUD by default) OR the permission is an
// organization-STRUCTURE permission (organization.*, business_unit.*, user.*, access.*, role.read): administering an
// organization's structure is an organization-level action, so an organization-scope grant of such a permission covers
// the organization's units, users and assignments. Business-record permissions (transformation.*, audit.read, and
// every approval permission) never cross scope boundaries without inheritance. Grants never apply across siblings,
// and a job title never implies access (grants come only from scoped_assignment).
import { APPROVAL_CATEGORIES, PERMISSIONS, type Permission, type ScopeType } from "@mth/shared";

export interface Grant {
  readonly assignmentId: string;
  readonly roleCode: string;
  readonly inheritsDownward: boolean;
  readonly scopeType: ScopeType;
  readonly scopeId: string;
  readonly organizationId: string;
  readonly permissions: ReadonlySet<Permission>;
}

export type TargetLevel = "organization" | "business_unit" | "transformation";

/** A target with its position in the hierarchy. `businessUnitAncestry` = the BU itself then its ancestors. */
export interface ResolvedTarget {
  readonly level: TargetLevel;
  readonly organizationId: string;
  readonly businessUnitId: string | null;
  readonly transformationId: string | null;
  readonly businessUnitAncestry: readonly string[];
}

export const STRUCTURAL_PERMISSIONS: ReadonlySet<Permission> = new Set<Permission>([
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

export function isApprovalPermission(permission: Permission): boolean {
  return APPROVAL_CATEGORIES.includes(PERMISSIONS[permission]);
}

export function appliesDownward(grant: Grant, permission: Permission): boolean {
  return grant.inheritsDownward || STRUCTURAL_PERMISSIONS.has(permission);
}

export function grantApplies(grant: Grant, permission: Permission, target: ResolvedTarget): boolean {
  if (!grant.permissions.has(permission)) return false;
  const down = appliesDownward(grant, permission);
  switch (grant.scopeType) {
    case "organization":
      if (grant.scopeId !== target.organizationId) return false;
      return target.level === "organization" || down;
    case "business_unit":
      if (target.level === "business_unit" && target.businessUnitId === grant.scopeId) return true;
      return down && target.level !== "organization" && target.businessUnitAncestry.includes(grant.scopeId);
    case "transformation":
      return target.level === "transformation" && target.transformationId === grant.scopeId;
    default:
      // Reserved scope types (portfolio, workstream, ...) grant nothing until their stage implements them.
      return false;
  }
}

export interface Decision {
  readonly allowed: boolean;
  readonly reason: string;
  readonly viaAssignmentIds: readonly string[];
}

export interface DecisionContext {
  /** Separation-of-duties hook (ADR-0006): the requester of the item being approved. */
  readonly requesterId?: string;
}

export interface PrincipalLike {
  readonly kind: "user" | "service";
  readonly userId: string | null;
  readonly grants: readonly Grant[];
}

export function decide(
  principal: PrincipalLike,
  permission: Permission,
  target: ResolvedTarget,
  context: DecisionContext = {},
): Decision {
  if (isApprovalPermission(permission)) {
    // Automation never approves (ADR-0006, ADR-0008): a service principal cannot hold approval permissions.
    if (principal.kind === "service")
      return { allowed: false, reason: "sod.service_cannot_approve", viaAssignmentIds: [] };
    // Requester != approver.
    if (context.requesterId !== undefined && context.requesterId === principal.userId) {
      return { allowed: false, reason: "sod.requester_is_approver", viaAssignmentIds: [] };
    }
  }
  const via = principal.grants.filter((g) => grantApplies(g, permission, target)).map((g) => g.assignmentId);
  return via.length > 0
    ? { allowed: true, reason: "granted", viaAssignmentIds: via }
    : { allowed: false, reason: "no_applicable_grant", viaAssignmentIds: [] };
}

/** Grants that hold `permission`, split by how they can match in SQL (see policy.ts scopeFilter). */
export function scopeSets(grants: readonly Grant[], permission: Permission) {
  const orgExact: string[] = [];
  const orgDown: string[] = [];
  const buExact: string[] = [];
  const buDown: string[] = [];
  const trExact: string[] = [];
  for (const g of grants) {
    if (!g.permissions.has(permission)) continue;
    const down = appliesDownward(g, permission);
    if (g.scopeType === "organization") (down ? orgDown : orgExact).push(g.scopeId);
    else if (g.scopeType === "business_unit") (down ? buDown : buExact).push(g.scopeId);
    else if (g.scopeType === "transformation") trExact.push(g.scopeId);
  }
  return { orgExact, orgDown, buExact, buDown, trExact };
}
