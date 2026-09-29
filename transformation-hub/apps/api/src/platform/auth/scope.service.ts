import { Injectable } from '@nestjs/common';
import type { Classification, RoleKey } from '@hub/domain';
import { DbService } from '../db.service';
import type { Principal, ProjectScope } from '../context';

/**
 * Computes a principal's effective scope fresh from the database (no caching → revocations apply immediately,
 * including for queued jobs that re-resolve before executing — AT-19).
 */
@Injectable()
export class ScopeService {
  constructor(private readonly db: DbService) {}

  async resolveUser(input: {
    userId: string;
    orgId: string;
    displayName: string;
    email: string | null;
    clearance: Classification;
    isDemo: boolean;
  }): Promise<Principal> {
    const { rows } = await this.db.pool.query<{
      kind: string;
      project_id: string | null;
      role: RoleKey | null;
      workstream_id: string | null;
      room_id: string | null;
      is_clean_team: boolean;
    }>(`select * from hub_auth_user_scope($1)`, [input.userId]);
    const projects = new Map<string, ProjectScope>();
    const orgRoles = new Set<RoleKey>();
    const scopeFor = (pid: string) => {
      let s = projects.get(pid);
      if (!s) {
        s = { projectId: pid, roles: new Set(), workstreamRoles: [], roomIds: new Set(), cleanTeamRoomIds: new Set(), roomRoles: [] };
        projects.set(pid, s);
      }
      return s;
    };
    for (const r of rows) {
      switch (r.kind) {
        case 'org_role':
          if (r.role) orgRoles.add(r.role);
          break;
        case 'membership':
          if (!r.project_id || !r.role) break;
          if (r.workstream_id) scopeFor(r.project_id).workstreamRoles.push({ workstreamId: r.workstream_id, role: r.role });
          else scopeFor(r.project_id).roles.add(r.role);
          break;
        case 'portfolio_role':
        case 'org_expansion':
          if (r.project_id && r.role) scopeFor(r.project_id).roles.add(r.role);
          break;
        case 'room_grant':
          break; // handled in the second pass (needs to know project scope)
      }
    }
    // Room grants: a grant WITH a room-scoped role (clean_team / external_partner_limited) brings the project into
    // scope but its permissions apply only inside that room. A grant WITHOUT a role only matters inside projects the
    // user already belongs to (it narrows nothing and grants no project membership).
    for (const r of rows) {
      if (r.kind !== 'room_grant' || !r.project_id || !r.room_id) continue;
      if (r.role) {
        const s = scopeFor(r.project_id);
        s.roomRoles.push({ roomId: r.room_id, role: r.role });
      }
      const s = projects.get(r.project_id);
      if (!s) continue;
      s.roomIds.add(r.room_id);
      if (r.is_clean_team) s.cleanTeamRoomIds.add(r.room_id);
    }
    return {
      kind: 'user',
      userId: input.userId,
      orgId: input.orgId,
      displayName: input.displayName,
      email: input.email,
      clearance: input.clearance,
      isDemo: input.isDemo,
      orgRoles,
      projects,
    };
  }

  /**
   * Service principal for worker jobs: scoped to exactly one project, no human roles, and an explicit permission
   * allowlist (deny by default — ARCH-09). User-facing output must instead use JobContextFactory.forUser().
   */
  servicePrincipal(orgId: string, projectId: string | null, serviceIdentity: string, permissions: string[] = []): Principal {
    const projects = new Map<string, ProjectScope>();
    if (projectId) projects.set(projectId, { projectId, roles: new Set(), workstreamRoles: [], roomIds: new Set(), cleanTeamRoomIds: new Set(), roomRoles: [] });
    return {
      kind: 'service',
      userId: null,
      orgId,
      displayName: serviceIdentity,
      email: null,
      clearance: 'strictly_confidential',
      isDemo: false,
      orgRoles: new Set(),
      projects,
      serviceIdentity,
      servicePermissions: new Set(permissions),
    };
  }
}
