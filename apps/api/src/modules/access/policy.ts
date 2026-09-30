// THE single authorization decision point (ADR-0006). Every route, list, export, search and (later) AI retrieval
// calls `authorize` for one record or `scopeFilter` for SQL-filtered lists. Nothing else decides access.
//  - Grants are loaded once per request from scoped_assignment (active, effective now) and never cached across
//    requests, so a revocation applies to the very next request.
//  - Targets are resolved through the read models scope_node and business_unit_closure (migrations 0001/0002).
//  - Response rule: no read permission on a record -> 404 (existence not disclosed); read allowed but the action
//    denied -> 403 (see requireRead / requireAction).
import { sql, type DbOrTx, type Expression, type SqlBool } from "@mth/db";
import { PERMISSION_CODES, type Permission, type ScopeType } from "@mth/shared";
import { problems, type AuthzTracker } from "../platform/index.ts";
import {
  decide,
  scopeSets,
  type Decision,
  type DecisionContext,
  type Grant,
  type ResolvedTarget,
  type TargetLevel,
} from "./rules.ts";

export interface Principal {
  readonly kind: "user" | "service";
  readonly userId: string | null;
  /** Home organization of a user principal. */
  readonly organizationId: string | null;
  readonly grants: readonly Grant[];
  /** Request-bound counter read by the platform's fail-closed guard. */
  readonly tracker: AuthzTracker;
}

export interface TargetRef {
  readonly type: TargetLevel;
  readonly id: string;
}

const KNOWN = new Set<string>(PERMISSION_CODES);

/** Active grants of a user: not revoked, effective_from <= now < effective_to, joined with the role's permissions. */
export async function loadGrants(db: DbOrTx, userId: string): Promise<Grant[]> {
  const rows = await db
    .selectFrom("scoped_assignment as a")
    .innerJoin("role as r", "r.id", "a.role_id")
    .leftJoin("role_permission as rp", "rp.role_id", "r.id")
    .select([
      "a.id",
      "a.scope_type",
      "a.scope_id",
      "a.organization_id",
      "r.code",
      "r.inherits_downward",
      "rp.permission_code",
    ])
    .where("a.user_id", "=", userId)
    .where("a.revoked_at", "is", null)
    .where("a.effective_from", "<=", sql<Date>`now()`)
    .where((eb) => eb.or([eb("a.effective_to", "is", null), eb("a.effective_to", ">", sql<Date>`now()`)]))
    .execute();
  const byAssignment = new Map<string, { grant: Omit<Grant, "permissions">; permissions: Set<Permission> }>();
  for (const r of rows) {
    let entry = byAssignment.get(r.id);
    if (!entry) {
      entry = {
        grant: {
          assignmentId: r.id,
          roleCode: r.code,
          inheritsDownward: r.inherits_downward,
          scopeType: r.scope_type as ScopeType,
          scopeId: r.scope_id,
          organizationId: r.organization_id,
        },
        permissions: new Set(),
      };
      byAssignment.set(r.id, entry);
    }
    if (r.permission_code && KNOWN.has(r.permission_code)) entry.permissions.add(r.permission_code as Permission);
  }
  return [...byAssignment.values()].map((e) => ({ ...e.grant, permissions: e.permissions }));
}

/** Resolve a scope reference to its place in the hierarchy; null when it does not exist. */
export async function resolveTarget(db: DbOrTx, ref: TargetRef): Promise<ResolvedTarget | null> {
  const node = await db
    .selectFrom("scope_node")
    .select(["organization_id", "business_unit_id", "transformation_id"])
    .where("scope_type", "=", ref.type)
    .where("scope_id", "=", ref.id)
    .executeTakeFirst();
  if (!node) return null;
  return {
    level: ref.type,
    organizationId: node.organization_id,
    businessUnitId: node.business_unit_id,
    transformationId: node.transformation_id,
    businessUnitAncestry: node.business_unit_id ? await businessUnitAncestry(db, node.business_unit_id) : [],
  };
}

/** The BU itself followed by its ancestors (nearest first). */
export async function businessUnitAncestry(db: DbOrTx, businessUnitId: string): Promise<string[]> {
  const rows = await db
    .selectFrom("business_unit_closure")
    .select(["ancestor_id", "depth"])
    .where("descendant_id", "=", businessUnitId)
    .orderBy("depth")
    .execute();
  return rows.map((r) => r.ancestor_id);
}

/** Build a resolved target from a record the caller already loaded (saves a query). */
export async function targetFor(
  db: DbOrTx,
  level: TargetLevel,
  ids: { organizationId: string; businessUnitId?: string | null; transformationId?: string | null },
): Promise<ResolvedTarget> {
  const bu = ids.businessUnitId ?? null;
  return {
    level,
    organizationId: ids.organizationId,
    businessUnitId: bu,
    transformationId: ids.transformationId ?? null,
    businessUnitAncestry: bu ? await businessUnitAncestry(db, bu) : [],
  };
}

/** The policy function: may `principal` do `permission` on `target`? */
export async function authorize(
  db: DbOrTx,
  principal: Principal,
  permission: Permission,
  target: TargetRef | ResolvedTarget,
  context: DecisionContext = {},
): Promise<Decision & { target: ResolvedTarget | null }> {
  principal.tracker.decisions += 1;
  const resolved = "level" in target ? target : await resolveTarget(db, target);
  if (!resolved) return { allowed: false, reason: "target_not_found", viaAssignmentIds: [], target: null };
  return { ...decide(principal, permission, resolved, context), target: resolved };
}

/** Read gate: denied or missing -> 404 (never disclose existence). Returns the resolved target. */
export async function requireRead(
  db: DbOrTx,
  principal: Principal,
  permission: Permission,
  target: TargetRef | ResolvedTarget,
): Promise<ResolvedTarget> {
  const d = await authorize(db, principal, permission, target);
  if (!d.target) throw problems.notFound();
  if (!d.allowed) throw problems.notFound().withDenial(denialOf(permission, d.target));
  return d.target;
}

function denialOf(permission: Permission, t: ResolvedTarget) {
  const recordId =
    t.level === "organization"
      ? t.organizationId
      : t.level === "business_unit"
        ? t.businessUnitId!
        : t.transformationId!;
  return {
    permission,
    recordType: t.level,
    recordId,
    organizationId: t.organizationId,
    transformationId: t.transformationId,
  };
}

/** Action gate after a successful read: denied -> 403. */
export async function requireAction(
  db: DbOrTx,
  principal: Principal,
  permission: Permission,
  target: ResolvedTarget,
  context: DecisionContext = {},
): Promise<void> {
  const d = await authorize(db, principal, permission, target, context);
  if (!d.allowed) throw problems.forbidden().withDenial(denialOf(permission, target));
}

/** True when some grant of the principal holds `permission` anywhere (catalogue reads, creating organizations). */
export function holdsAnywhere(principal: Principal, permission: Permission): boolean {
  principal.tracker.decisions += 1;
  return principal.grants.some((g) => g.permissions.has(permission));
}

/**
 * SQL scope filter for lists and search (ADR-0006): the same rules as `decide`, compiled into a WHERE expression
 * so filtering happens in the database, never after fetching. `cols` name the target row's level and hierarchy
 * columns (SQL expressions). An empty grant set yields FALSE.
 */
export function scopeFilter(
  principal: Principal,
  permission: Permission,
  cols: {
    level: Expression<string> | TargetLevel;
    organizationId: Expression<string>;
    businessUnitId?: Expression<string | null>;
    transformationId?: Expression<string | null>;
  },
): Expression<SqlBool> {
  principal.tracker.decisions += 1;
  const s = scopeSets(principal.grants, permission);
  const level = typeof cols.level === "string" ? sql<string>`${cols.level}::text` : cols.level;
  const uuids = (ids: string[]) => sql`${ids}::uuid[]`;
  const parts = [];
  if (s.orgDown.length > 0) parts.push(sql<boolean>`${cols.organizationId} = ANY(${uuids(s.orgDown)})`);
  if (s.orgExact.length > 0)
    parts.push(sql<boolean>`(${level} = 'organization' AND ${cols.organizationId} = ANY(${uuids(s.orgExact)}))`);
  if (cols.businessUnitId) {
    if (s.buExact.length > 0)
      parts.push(sql<boolean>`(${level} = 'business_unit' AND ${cols.businessUnitId} = ANY(${uuids(s.buExact)}))`);
    if (s.buDown.length > 0) {
      parts.push(
        sql<boolean>`(${level} <> 'organization' AND ${cols.businessUnitId} IN (SELECT descendant_id FROM business_unit_closure WHERE ancestor_id = ANY(${uuids(s.buDown)})))`,
      );
    }
  }
  if (cols.transformationId && s.trExact.length > 0) {
    parts.push(sql<boolean>`(${level} = 'transformation' AND ${cols.transformationId} = ANY(${uuids(s.trExact)}))`);
  }
  if (parts.length === 0) return sql<SqlBool>`FALSE`;
  return sql<SqlBool>`(${sql.join(parts, sql` OR `)})`;
}

/** Organizations in which the principal holds `permission` at any scope (listOrganizations). */
export function organizationsWith(principal: Principal, permission: Permission): string[] {
  principal.tracker.decisions += 1;
  return [...new Set(principal.grants.filter((g) => g.permissions.has(permission)).map((g) => g.organizationId))];
}
