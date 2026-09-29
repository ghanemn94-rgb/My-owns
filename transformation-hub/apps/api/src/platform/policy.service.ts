import { Injectable } from '@nestjs/common';
import { POLICY_MATRIX, permissionsOf, evaluateConditions, isKnownPermission, forbidden, notFound, AbacAttributes, Classification, RoleKey } from '@hub/domain';
import type { Principal, RequestContext } from './context';

export interface ResourceAttrs {
  projectId: string;
  classification?: Classification | null;
  roomId?: string | null;
  roomIsCleanTeam?: boolean;
  requesterUserId?: string | null; // for not_self (separation of duties)
  workstreamId?: string | null;
  withinAuthority?: boolean;
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

  /** RBAC-only check: does the principal hold `permission` anywhere in the project? */
  canInProject(ctx: RequestContext, permission: string, projectId: string): boolean {
    if (ctx.principal.kind === 'service') return ctx.principal.projects.has(projectId);
    return (
      this.projectPermissions(ctx.principal, projectId).has(permission) ||
      this.workstreamPermissions(ctx.principal, projectId).has(permission) ||
      this.roomPermissions(ctx.principal, projectId).has(permission)
    );
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
      throw forbidden('policy.forbidden', r.reason);
    }
  }

  can(ctx: RequestContext, permission: string, res: ResourceAttrs): boolean {
    return this.check(ctx, permission, res).allowed;
  }

  /** Visibility-only check used to filter lists (classification/room/clean team). */
  canSee(ctx: RequestContext, res: Omit<ResourceAttrs, 'requesterUserId' | 'withinAuthority'>): boolean {
    const p = ctx.principal;
    const scope = p.projects.get(res.projectId);
    if (!scope) return false;
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

  private check(ctx: RequestContext, permission: string, res: ResourceAttrs): { allowed: boolean; hide: boolean; reason: string } {
    this.assertKnown(permission);
    const p = ctx.principal;
    const scope = p.projects.get(res.projectId);
    if (!scope) return { allowed: false, hide: true, reason: 'out of scope' };

    // Visibility first → 404
    if (p.kind !== 'service' && !this.canSee(ctx, res)) return { allowed: false, hide: true, reason: 'not visible' };

    if (p.kind === 'service') return { allowed: true, hide: false, reason: '' };

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
      return { allowed: false, hide: roomOnly, reason: `Missing permission ${permission}` };
    }

    const conds = POLICY_MATRIX.permissions[permission]!.conditions;
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
    };
    const r = evaluateConditions(conds, attrs);
    if (!r.allowed) {
      const reason =
        r.failed.includes('not_self')
          ? 'Separation of duties: you cannot approve/verify your own request'
          : r.failed.includes('authority')
            ? 'Outside delegated authority'
            : `Condition(s) not met: ${r.failed.join(', ')}`;
      return { allowed: false, hide: false, reason };
    }
    return { allowed: true, hide: false, reason: '' };
  }

  static roleSummary(roles: Iterable<RoleKey>): string {
    return [...roles].join(', ');
  }
}
