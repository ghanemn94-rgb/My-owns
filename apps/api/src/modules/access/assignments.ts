// Scoped role assignments and the role/permission catalogue (ADR-0006). The only writer of scoped_assignment.
// Every mutation: authorization (access.assign on the scope), validation, optimistic concurrency (revoke needs
// If-Match), and exactly one audit event, all in the caller's transaction.
import { sql, type DbOrTx, type Tx } from "@mth/db";
import { P1_SCOPE_TYPES, type Permission, type ScopeType } from "@mth/shared";
import type { RoleAssignment, RoleAssignmentCreate } from "@mth/shared/schemas";
import { v7 as uuidv7 } from "uuid";
import { record, type AuditContext } from "../audit/index.ts";
import { decodeCursor, filterHash, iso, isoOrNull, paginate, problems } from "../platform/index.ts";
import { authorize, requireAction, requireRead, resolveTarget, scopeFilter, type Principal } from "./policy.ts";
import type { TargetLevel } from "./rules.ts";

const selectAssignment = (db: DbOrTx) =>
  db
    .selectFrom("scoped_assignment as a")
    .innerJoin("role as r", "r.id", "a.role_id")
    .select([
      "a.id",
      "a.organization_id",
      "a.user_id",
      "r.code as role_code",
      "a.scope_type",
      "a.scope_id",
      "a.effective_from",
      "a.effective_to",
      "a.reason",
      "a.granted_by",
      "a.revoked_at",
      "a.revoked_by",
      "a.revoke_reason",
      "a.version",
      "a.created_at",
    ]);

type AssignmentRow = Awaited<ReturnType<ReturnType<typeof selectAssignment>["executeTakeFirstOrThrow"]>>;

export function toRoleAssignment(r: AssignmentRow): RoleAssignment {
  return {
    id: r.id,
    organizationId: r.organization_id,
    userId: r.user_id,
    roleCode: r.role_code,
    scope: { type: r.scope_type as ScopeType, id: r.scope_id },
    effectiveFrom: iso(r.effective_from),
    effectiveTo: isoOrNull(r.effective_to),
    reason: r.reason,
    grantedBy: r.granted_by,
    revokedAt: isoOrNull(r.revoked_at),
    revokedBy: r.revoked_by,
    revokeReason: r.revoke_reason,
    version: r.version,
    createdAt: iso(r.created_at),
  };
}

const isP1Scope = (t: ScopeType): t is TargetLevel => (P1_SCOPE_TYPES as readonly string[]).includes(t);

/** Active (non-revoked, currently effective) assignments of one user, for GET /me. */
export async function activeAssignmentsOf(db: DbOrTx, userId: string): Promise<RoleAssignment[]> {
  const rows = await selectAssignment(db)
    .where("a.user_id", "=", userId)
    .where("a.revoked_at", "is", null)
    .where("a.effective_from", "<=", sql<Date>`now()`)
    .where((eb) => eb.or([eb("a.effective_to", "is", null), eb("a.effective_to", ">", sql<Date>`now()`)]))
    .orderBy("a.id")
    .execute();
  return rows.map(toRoleAssignment);
}

export async function createAssignment(
  tx: Tx,
  principal: Principal,
  audit: AuditContext,
  input: RoleAssignmentCreate,
): Promise<RoleAssignment> {
  if (!isP1Scope(input.scope.type)) {
    throw problems.businessRule(
      "access.scope_type_reserved",
      `Scope type ${input.scope.type} is reserved for a later stage.`,
    );
  }
  const target = await resolveTarget(tx, { type: input.scope.type, id: input.scope.id });
  // Not found and not permitted look the same to the caller (no existence disclosure through this endpoint).
  const decision = target ? await authorize(tx, principal, "access.assign", target) : null;
  if (!target) {
    if (principal.grants.some((g) => g.permissions.has("access.assign"))) {
      throw problems.businessRule("access.scope_not_found", "The scope does not exist.");
    }
    throw problems.forbidden();
  }
  if (!decision?.allowed) {
    throw problems.forbidden().withDenial({
      permission: "access.assign",
      recordType: input.scope.type,
      recordId: input.scope.id,
      organizationId: target.organizationId,
      transformationId: target.transformationId,
    });
  }
  if (input.userId === principal.userId) {
    throw problems.businessRule(
      "access.self_grant",
      "You cannot grant a role to yourself; another access administrator must do it.",
    );
  }
  const user = await tx
    .selectFrom("app_user")
    .select(["id", "status"])
    .where("id", "=", input.userId)
    .executeTakeFirst();
  if (!user) throw problems.businessRule("access.user_not_found", "The user does not exist.");
  if (user.status !== "active") throw problems.businessRule("access.user_disabled", "The user is disabled.");

  const role = await tx
    .selectFrom("role")
    .select(["id", "code", "kind"])
    .where("code", "=", input.roleCode)
    .executeTakeFirst();
  if (!role) throw problems.businessRule("access.role_not_found", "The role does not exist.");
  if (role.kind === "technical_admin") {
    // Defence in depth behind the role_permission trigger: a technical admin grant can never carry an approval.
    const approval = await tx
      .selectFrom("role_permission as rp")
      .innerJoin("permission as p", "p.code", "rp.permission_code")
      .select("p.code")
      .where("rp.role_id", "=", role.id)
      .where("p.category", "in", ["business_approval", "finance_validation"])
      .executeTakeFirst();
    if (approval)
      throw problems.businessRule(
        "sod.admin_approver",
        "A technical administrator role cannot carry an approval permission.",
      );
  }

  const id = uuidv7();
  try {
    await tx
      .insertInto("scoped_assignment")
      .values({
        id,
        organization_id: target.organizationId,
        user_id: input.userId,
        role_id: role.id,
        scope_type: input.scope.type,
        scope_id: input.scope.id,
        ...(input.effectiveFrom !== undefined ? { effective_from: input.effectiveFrom } : {}),
        effective_to: input.effectiveTo ?? null,
        reason: input.reason,
        granted_by: principal.userId!,
        created_by: principal.userId,
        updated_by: principal.userId,
      })
      .execute();
  } catch (e) {
    const err = e as { code?: string; constraint?: string };
    if (err.code === "23505")
      throw problems.duplicate("access.duplicate_assignment", "The user already holds this role at this scope.");
    if (err.code === "23514" && err.constraint === "scoped_assignment_effective_range") {
      throw problems.businessRule("validation.effective_range", "effectiveTo must be after effectiveFrom.");
    }
    throw e;
  }
  await record(tx, audit, {
    action: "scoped_assignment.create",
    recordType: "scoped_assignment",
    recordId: id,
    organizationId: target.organizationId,
    transformationId: target.transformationId,
    newVersion: 1,
    reason: input.reason,
    changes: {
      userId: { from: null, to: input.userId },
      roleCode: { from: null, to: role.code },
      scope: { from: null, to: input.scope },
      effectiveFrom: { from: null, to: input.effectiveFrom ?? null },
      effectiveTo: { from: null, to: input.effectiveTo ?? null },
    },
  });
  return toRoleAssignment(await selectAssignment(tx).where("a.id", "=", id).executeTakeFirstOrThrow());
}

/** Load for reading: 404 unless the principal holds access.read on the assignment's scope. */
export async function getAssignment(db: DbOrTx, principal: Principal, id: string, opts: { forUpdate?: boolean } = {}) {
  let q = selectAssignment(db).where("a.id", "=", id);
  if (opts.forUpdate) q = q.forUpdate("a");
  const row = await q.executeTakeFirst();
  if (!row || !isP1Scope(row.scope_type as ScopeType)) {
    principal.tracker.decisions += 1;
    throw problems.notFound();
  }
  const target = await requireRead(db, principal, "access.read", {
    type: row.scope_type as TargetLevel,
    id: row.scope_id,
  });
  return { row, target };
}

export async function revokeAssignment(
  tx: Tx,
  principal: Principal,
  audit: AuditContext,
  id: string,
  expectedVersion: () => number,
  reason: string,
): Promise<RoleAssignment> {
  const { row, target } = await getAssignment(tx, principal, id, { forUpdate: true });
  await requireAction(tx, principal, "access.assign", target);
  const expected = expectedVersion();
  if (row.version !== expected) throw problems.versionConflict(row.version);
  if (row.revoked_at !== null)
    throw problems.businessRule("access.already_revoked", "The assignment is already revoked.");
  const updated = await tx
    .updateTable("scoped_assignment")
    .set({
      revoked_at: sql<Date>`now()`,
      revoked_by: principal.userId,
      revoke_reason: reason,
      version: sql<number>`version + 1`,
      updated_at: sql<Date>`now()`,
      updated_by: principal.userId,
    })
    .where("id", "=", id)
    .where("version", "=", expected)
    .returning(["version"])
    .executeTakeFirst();
  if (!updated) throw problems.versionConflict(row.version);
  await record(tx, audit, {
    action: "scoped_assignment.revoke",
    recordType: "scoped_assignment",
    recordId: id,
    organizationId: row.organization_id,
    transformationId: target.transformationId,
    priorVersion: row.version,
    newVersion: updated.version,
    reason,
    changes: { revokedAt: { from: null, to: "now" } },
  });
  return toRoleAssignment(await selectAssignment(tx).where("a.id", "=", id).executeTakeFirstOrThrow());
}

export interface AssignmentListQuery {
  organizationId: string;
  userId?: string | undefined;
  scopeType?: ScopeType | undefined;
  scopeId?: string | undefined;
  includeRevoked: boolean;
  cursor?: string | undefined;
  limit: number;
}

export async function listAssignments(db: DbOrTx, principal: Principal, query: AssignmentListQuery) {
  if (!principal.grants.some((g) => g.organizationId === query.organizationId && g.permissions.has("access.read"))) {
    principal.tracker.decisions += 1;
    throw problems.forbidden();
  }
  const hash = filterHash({ ...query });
  const after = decodeCursor(query.cursor, hash, 1);
  let q = selectAssignment(db)
    .innerJoin("scope_node as sn", (j) =>
      j.onRef("sn.scope_type", "=", "a.scope_type").onRef("sn.scope_id", "=", "a.scope_id"),
    )
    .where("a.organization_id", "=", query.organizationId)
    .where(
      scopeFilter(principal, "access.read", {
        level: sql.ref("a.scope_type"),
        organizationId: sql.ref("a.organization_id"),
        businessUnitId: sql.ref("sn.business_unit_id"),
        transformationId: sql.ref("sn.transformation_id"),
      }),
    );
  if (query.userId) q = q.where("a.user_id", "=", query.userId);
  if (query.scopeType) q = q.where("a.scope_type", "=", query.scopeType);
  if (query.scopeId) q = q.where("a.scope_id", "=", query.scopeId);
  if (!query.includeRevoked) q = q.where("a.revoked_at", "is", null);
  if (after) q = q.where("a.id", "<", String(after[0]));
  const rows = await q
    .orderBy("a.id", "desc")
    .limit(query.limit + 1)
    .execute();
  const page = paginate(rows, query.limit, (r) => [r.id], hash);
  return { items: page.items.map(toRoleAssignment), nextCursor: page.nextCursor };
}

export async function listRoles(db: DbOrTx) {
  const rows = await db
    .selectFrom("role as r")
    .leftJoin("role_permission as rp", "rp.role_id", "r.id")
    .select(["r.id", "r.code", "r.name_en", "r.name_ar", "r.kind", "r.inherits_downward", "rp.permission_code"])
    .orderBy("r.id")
    .execute();
  const roles = new Map<
    string,
    {
      id: string;
      code: string;
      nameEn: string;
      nameAr: string;
      kind: "source" | "implementation" | "technical_admin";
      inheritsDownward: boolean;
      permissions: Permission[];
    }
  >();
  for (const r of rows) {
    let role = roles.get(r.id);
    if (!role) {
      role = {
        id: r.id,
        code: r.code,
        nameEn: r.name_en,
        nameAr: r.name_ar,
        kind: r.kind as "source",
        inheritsDownward: r.inherits_downward,
        permissions: [],
      };
      roles.set(r.id, role);
    }
    if (r.permission_code) role.permissions.push(r.permission_code as Permission);
  }
  for (const role of roles.values()) role.permissions.sort();
  return [...roles.values()];
}

export async function listPermissions(db: DbOrTx) {
  const rows = await db.selectFrom("permission").select(["code", "category"]).orderBy("code").execute();
  return rows.map((r) => ({ code: r.code as Permission, category: r.category as "read" }));
}

/**
 * When a user creates a NEW organization, nobody holds any grant in it yet, so nobody could administer it.
 * The creator therefore receives, in the new organization, the TECHNICAL ADMINISTRATOR roles they hold at organization
 * scope in organizations where they hold organization.manage. Explicit rows, one audit event each, reason recorded.
 * Never a business role (so never business-record access or an approval right; ADR-0006).
 */
export async function grantCreatorAdminRoles(
  tx: Tx,
  principal: Principal,
  audit: AuditContext,
  newOrganizationId: string,
  newOrganizationCode: string,
): Promise<void> {
  const sourceOrgs = new Set(
    principal.grants
      .filter((g) => g.scopeType === "organization" && g.permissions.has("organization.manage"))
      .map((g) => g.organizationId),
  );
  const roleCodes = new Set(
    principal.grants
      .filter((g) => g.scopeType === "organization" && sourceOrgs.has(g.organizationId))
      .map((g) => g.roleCode),
  );
  if (roleCodes.size === 0 || !principal.userId) return;
  const roles = await tx
    .selectFrom("role")
    .select(["id", "code"])
    .where("code", "in", [...roleCodes])
    .where("kind", "=", "technical_admin")
    .execute();
  const reason = `Creator of organization ${newOrganizationCode}: technical administration roles carried over`;
  for (const role of roles) {
    const id = uuidv7();
    await tx
      .insertInto("scoped_assignment")
      .values({
        id,
        organization_id: newOrganizationId,
        user_id: principal.userId,
        role_id: role.id,
        scope_type: "organization",
        scope_id: newOrganizationId,
        reason,
        granted_by: principal.userId,
        created_by: principal.userId,
        updated_by: principal.userId,
      })
      .execute();
    await record(tx, audit, {
      action: "scoped_assignment.create",
      recordType: "scoped_assignment",
      recordId: id,
      organizationId: newOrganizationId,
      newVersion: 1,
      reason,
      changes: {
        userId: { from: null, to: principal.userId },
        roleCode: { from: null, to: role.code },
        scope: { from: null, to: { type: "organization", id: newOrganizationId } },
      },
    });
  }
}
