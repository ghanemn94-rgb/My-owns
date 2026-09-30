import { Injectable } from '@nestjs/common';
import { POLICY_MATRIX, permissionsOf, evaluateConditions, isKnownPermission, forbidden, notFound, clearanceAllows, AbacAttributes, AbacCondition, Classification, RoleKey } from '@hub/domain';
import { sql, SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { CLASSIFICATIONS } from '@hub/domain';
import { isFullScope, Principal, RequestContext } from './context';

/** Conditions that depend on the concrete subject (who requested it; what authority it needs) — see assertGranted. */
const SUBJECT_CONDITIONS: readonly AbacCondition[] = ['not_self', 'authority'];

export interface ResourceAttrs {
  projectId: string;
  classification?: Classification | null;
  roomId?: string | null;
  roomIsCleanTeam?: boolean;
  /** For `not_self` (separation of duties): REQUIRED — missing / null fails closed with 403 policy.sod_subject_unknown (I-R3). */
  requesterUserId?: string | null;
  workstreamId?: string | null;
  /** For `authority`: REQUIRED — undefined fails closed with 403 policy.authority_unknown (I-R3). */
  withinAuthority?: boolean;
  /** Owner / assignee / creator ids of the resource (for `own_workstream`); for a CREATE, the actor is the creator. */
  ownerUserIds?: (string | null | undefined)[];
  /** Role(s) that own the resource (e.g. a gate criterion's `owner_role`): holding one in the project counts as owning it. */
  ownerRoles?: (RoleKey | null | undefined)[];
}

/**
 * Deny-by-default authorization (ADR-0006). RBAC from the policy matrix + ABAC conditions from the permission
 * definition. Visibility failures (classification/room/clean team) surface as 404 so existence is not leaked;
 * separation-of-duty/authority failures on visible records surface as 403.
 */
@Injectable()
export class PolicyService {
  /** Permissions granted in a project by project-wide roles (workstream roles returned separately). */
  projectPermissions(p: Principal, projectId: string): Set<string> {
    const scope = p.projects.get(projectId);
    if (!scope) return new Set();
    return permissionsOf(POLICY_MATRIX, scope.roles);
  }

  /** Permissions granted by workstream-scoped roles, with the workstreams they apply to. */
  workstreamPermissions(p: Principal, projectId: string): Map<string, Set<string>> {
    const scope = p.projects.get(projectId);
    const out = new Map<string, Set<string>>();
    if (!scope) return out;
    for (const wr of scope.workstreamRoles) {
      for (const perm of POLICY_MATRIX.roles[wr.role]?.permissions ?? []) {
        (out.get(perm) ?? out.set(perm, new Set()).get(perm)!).add(wr.workstreamId);
      }
    }
    return out;
  }

  /** Permissions granted by room-scoped roles, with the rooms they apply to. */
  roomPermissions(p: Principal, projectId: string): Map<string, Set<string>> {
    const scope = p.projects.get(projectId);
    const out = new Map<string, Set<string>>();
    if (!scope) return out;
    for (const rr of scope.roomRoles) {
      for (const perm of POLICY_MATRIX.roles[rr.role]?.permissions ?? []) {
        (out.get(perm) ?? out.set(perm, new Set()).get(perm)!).add(rr.roomId);
      }
    }
    return out;
  }

  orgPermissions(p: Principal): Set<string> {
    return permissionsOf(POLICY_MATRIX, p.orgRoles);
  }

  /** Effective permission list for the UI (project-wide + any workstream grant). */
  effectivePermissions(p: Principal, projectId: string): string[] {
    const s = new Set(this.projectPermissions(p, projectId));
    for (const k of this.workstreamPermissions(p, projectId).keys()) s.add(k);
    for (const k of this.roomPermissions(p, projectId).keys()) s.add(k);
    return [...s].sort();
  }

  inScope(ctx: RequestContext, projectId: string): boolean {
    return ctx.principal.projects.has(projectId);
  }

  /** True when the principal only holds room-scoped roles in this project (clean team / external partner). */
  isRoomOnly(p: Principal, projectId: string): boolean {
    const s = p.projects.get(projectId);
    return !!s && p.kind !== 'service' && !isFullScope(s);
  }

  /** RBAC-only check: does the principal hold `permission` anywhere in the project? */
  canInProject(ctx: RequestContext, permission: string, projectId: string): boolean {
    if (ctx.principal.kind === 'service') return ctx.principal.projects.has(projectId) && (ctx.principal.servicePermissions?.has(permission) ?? false);
    return (
      this.projectPermissions(ctx.principal, projectId).has(permission) ||
      this.workstreamPermissions(ctx.principal, projectId).has(permission) ||
      this.roomPermissions(ctx.principal, projectId).has(permission)
    );
  }

  /**
   * Where a permission applies inside a project (ARCH-14): everywhere (project-wide role or service allowlist), or only
   * in the workstreams of workstream-scoped roles. Room grants never extend to workstream-structured data.
   */
  permissionReach(ctx: RequestContext, permission: string, projectId: string): { all: true } | { all: false; workstreamIds: string[] } {
    if (ctx.principal.kind === 'service') return this.canInProject(ctx, permission, projectId) ? { all: true } : { all: false, workstreamIds: [] };
    if (this.projectPermissions(ctx.principal, projectId).has(permission)) return { all: true };
    return { all: false, workstreamIds: [...(this.workstreamPermissions(ctx.principal, projectId).get(permission) ?? [])] };
  }

  /** SQL predicate restricting a workstream column to the permission's reach (use in lists AND counts). */
  reachSql(ctx: RequestContext, permission: string, projectId: string, workstreamCol: PgColumn | SQL): SQL {
    const r = this.permissionReach(ctx, permission, projectId);
    if (r.all) return sql`true`;
    if (!r.workstreamIds.length) return sql`false`;
    return sql`${workstreamCol} in (${sql.join(r.workstreamIds.map((w) => sql`${w}::uuid`), sql`, `)})`;
  }

  canOrg(ctx: RequestContext, permission: string): boolean {
    return this.orgPermissions(ctx.principal).has(permission);
  }

  assertOrg(ctx: RequestContext, permission: string) {
    this.assertKnown(permission);
    if (!this.canOrg(ctx, permission)) throw forbidden('policy.forbidden', `Missing organization permission ${permission}`);
  }

  /** Full RBAC + ABAC check for a concrete resource. */
  assert(ctx: RequestContext, permission: string, res: ResourceAttrs): void {
    const r = this.check(ctx, permission, res);
    if (!r.allowed) {
      if (r.hide) throw notFound();
      throw forbidden(r.code, r.reason);
    }
  }

  can(ctx: RequestContext, permission: string, res: ResourceAttrs): boolean {
    return this.check(ctx, permission, res).allowed;
  }

  /**
   * Role-level PRE-check (I-R3): RBAC, visibility and every condition EXCEPT the subject-specific `not_self` / `authority`.
   * Use it only before a loop / flow that then calls `assert(...)` per subject with its requester and authority — it never
   * authorizes an approval on its own. (Calling `assert` without those inputs fails closed.)
   */
  assertGranted(ctx: RequestContext, permission: string, res: Omit<ResourceAttrs, 'requesterUserId' | 'withinAuthority'>): void {
    const r = this.check(ctx, permission, res, SUBJECT_CONDITIONS);
    if (!r.allowed) {
      if (r.hide) throw notFound();
      throw forbidden(r.code, r.reason);
    }
  }

  /**
   * Visibility-only check used to filter lists (classification/room/clean team). Room-only principals see ONLY
   * resources inside their rooms (ARCH-02); resources without a room are invisible to them.
   */
  canSee(ctx: RequestContext, res: Omit<ResourceAttrs, 'requesterUserId' | 'withinAuthority'>): boolean {
    const p = ctx.principal;
    const scope = p.projects.get(res.projectId);
    if (!scope) return false;
    if (p.kind === 'service') return true;
    if (!isFullScope(scope)) {
      const rooms = new Set([...scope.roomIds, ...scope.roomRoles.map((r) => r.roomId)]);
      if (!res.roomId || !rooms.has(res.roomId)) return false;
    }
    const r = evaluateConditions(['classification', 'room', 'clean_team'], {
      clearance: p.clearance,
      classification: res.classification ?? null,
      roomId: res.roomId ?? null,
      userRoomIds: scope.roomIds,
      roomIsCleanTeam: res.roomIsCleanTeam,
      userCleanTeamRoomIds: scope.cleanTeamRoomIds,
    });
    return r.allowed;
  }

  private assertKnown(permission: string) {
    if (!isKnownPermission(permission)) throw new Error(`Unknown permission key ${permission} (not in policy matrix)`);
  }

  private check(ctx: RequestContext, permission: string, res: ResourceAttrs, skip: readonly AbacCondition[] = []): { allowed: boolean; hide: boolean; reason: string; code: string } {
    this.assertKnown(permission);
    const p = ctx.principal;
    const scope = p.projects.get(res.projectId);
    if (!scope) return { allowed: false, hide: true, reason: 'out of scope', code: 'not_found' };

    // Visibility first → 404
    if (p.kind !== 'service' && !this.canSee(ctx, res)) return { allowed: false, hide: true, reason: 'not visible', code: 'not_found' };

    // Service principals: explicit permission allowlist only (deny by default — ARCH-09).
    if (p.kind === 'service') {
      return p.servicePermissions?.has(permission)
        ? { allowed: true, hide: false, reason: '', code: '' }
        : { allowed: false, hide: false, reason: `Service identity ${p.serviceIdentity} is not allowed ${permission}`, code: 'policy.forbidden' };
    }

    const projectWide = this.projectPermissions(p, res.projectId).has(permission);
    const wsGrants = this.workstreamPermissions(p, res.projectId).get(permission);
    let viaWorkstream = false;
    if (!projectWide && wsGrants) {
      // Workstream-scoped grants apply only to resources of those workstreams.
      viaWorkstream = !!res.workstreamId && wsGrants.has(res.workstreamId);
    }
    // Room-scoped grants (clean team / external partner) apply only to resources inside those rooms.
    const roomGrants = this.roomPermissions(p, res.projectId).get(permission);
    const viaRoom = !projectWide && !viaWorkstream && !!roomGrants && !!res.roomId && roomGrants.has(res.roomId);
    if (!projectWide && !viaWorkstream && !viaRoom) {
      // A room-only principal must not learn that out-of-room resources exist.
      const roomOnly = scope.roles.size === 0 && scope.workstreamRoles.length === 0;
      return { allowed: false, hide: roomOnly, reason: `Missing permission ${permission}`, code: 'policy.forbidden' };
    }

    const conds = POLICY_MATRIX.permissions[permission]!.conditions.filter((c) => !skip.includes(c));
    const attrs: AbacAttributes = {
      clearance: p.clearance,
      classification: res.classification ?? null,
      roomId: res.roomId ?? null,
      userRoomIds: scope.roomIds,
      roomIsCleanTeam: res.roomIsCleanTeam,
      userCleanTeamRoomIds: scope.cleanTeamRoomIds,
      actorUserId: p.userId,
      subjectRequesterId: res.requesterUserId ?? null,
      workstreamId: res.workstreamId ?? null,
      userWorkstreamIds: viaWorkstream ? wsGrants : undefined,
      withinAuthority: res.withinAuthority,
      // access-matrix §2.4: owner/assignee/creator, OR a workstream-scoped grant on the resource's workstream, OR PM.
      ownWorkstreamSatisfied:
        scope.roles.has('project_manager') ||
        (!!res.workstreamId && !!wsGrants?.has(res.workstreamId)) ||
        (!!p.userId && (res.ownerUserIds ?? []).includes(p.userId)) ||
        (res.ownerRoles ?? []).some((r) => !!r && (scope.roles.has(r) || scope.workstreamRoles.some((w) => w.role === r && (!res.workstreamId || w.workstreamId === res.workstreamId)))),
    };
    const r = evaluateConditions(conds, attrs);
    if (!r.allowed) {
      // Missing inputs fail CLOSED with their own code (I-R3): a programming or data gap is never read as "allowed".
      if (r.missing.includes('not_self')) {
        return { allowed: false, hide: false, code: 'policy.sod_subject_unknown', reason: 'Separation of duties cannot be established: the requester / recorder of this record is unknown, so nobody may approve or verify it' };
      }
      if (r.missing.includes('authority')) {
        return { allowed: false, hide: false, code: 'policy.authority_unknown', reason: 'Approval authority could not be established for this action' };
      }
      const reason =
        r.failed.includes('not_self')
          ? 'Separation of duties: you cannot approve/verify your own request'
          : r.failed.includes('authority')
            ? 'Outside delegated authority'
            : `Condition(s) not met: ${r.failed.join(', ')}`;
      return { allowed: false, hide: false, reason, code: 'policy.forbidden' };
    }
    return { allowed: true, hide: false, reason: '', code: '' };
  }

  /**
   * SQL visibility predicate for lists and counts (ARCH-02/ARCH-14): classification ≤ clearance, room grants, and
   * room-only restriction — applied INSIDE the query so totals never include invisible rows.
   * Pass the table's columns; omit `room` for tables without a room column.
   */
  visibilitySql(ctx: RequestContext, projectId: string, cols: { classification?: PgColumn; room?: PgColumn }): SQL {
    const p = ctx.principal;
    const scope = p.projects.get(projectId);
    if (!scope) return sql`false`;
    if (p.kind === 'service') return sql`true`;
    const parts: SQL[] = [];
    if (cols.classification) {
      const allowed = CLASSIFICATIONS.filter((c) => clearanceAllows(p.clearance, c));
      parts.push(sql`${cols.classification} in (${sql.join(allowed.map((c) => sql`${c}`), sql`, `)})`);
    }
    const rooms = [...new Set([...scope.roomIds, ...scope.roomRoles.map((r) => r.roomId)])];
    const cleanTeamRooms = [...scope.cleanTeamRoomIds];
    if (cols.room) {
      const roomList = rooms.length ? sql`${cols.room} in (${sql.join(rooms.map((r) => sql`${r}::uuid`), sql`, `)})` : sql`false`;
      if (!isFullScope(scope)) parts.push(roomList);
      else parts.push(sql`(${cols.room} is null or ${roomList})`);
      void cleanTeamRooms; // clean-team rooms are a subset of granted rooms; grants are the gate.
    } else if (!isFullScope(scope)) {
      parts.push(sql`false`);
    }
    return parts.length ? sql.join(parts, sql` and `) : sql`true`;
  }

  static roleSummary(roles: Iterable<RoleKey>): string {
    return [...roles].join(', ');
  }
}
