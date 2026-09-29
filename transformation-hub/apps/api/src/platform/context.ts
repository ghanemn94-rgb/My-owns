import type { Classification, RoleKey } from '@hub/domain';

/** Resolved access scope of a principal (computed fresh per request / per job execution). */
export interface ProjectScope {
  projectId: string;
  roles: Set<RoleKey>; // project-wide roles
  workstreamRoles: { workstreamId: string; role: RoleKey }[];
  roomIds: Set<string>; // partner/clean-team rooms with an active grant
  cleanTeamRoomIds: Set<string>;
  /** Room-scoped roles (clean_team, external_partner_limited): permissions apply ONLY to resources in these rooms. */
  roomRoles: { roomId: string; role: RoleKey }[];
}

export interface Principal {
  kind: 'user' | 'service';
  userId: string | null; // null for pure service context
  orgId: string;
  displayName: string;
  email: string | null;
  clearance: Classification;
  isDemo: boolean;
  orgRoles: Set<RoleKey>;
  projects: Map<string, ProjectScope>;
  serviceIdentity?: string; // e.g. 'svc-worker', 'svc-ai-pm'
}

export interface RequestContext {
  principal: Principal;
  correlationId: string;
  sessionId: string | null;
  ip: string | null;
  authMethod: string | null;
  /** Project ids placed in the DB session (app.project_ids) for RLS. */
  projectIds: string[];
  locale: 'en' | 'ar';
}

export function projectIdsOf(p: Principal): string[] {
  return [...p.projects.keys()];
}
