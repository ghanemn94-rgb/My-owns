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
  /** Service principals only: explicit allowlist of permission keys (deny by default — ARCH-09). */
  servicePermissions?: Set<string>;
}

export interface RequestContext {
  principal: Principal;
  correlationId: string;
  sessionId: string | null;
  ip: string | null;
  authMethod: string | null;
  /** All project ids in scope (app.project_ids) — includes room-only projects (RLS). */
  projectIds: string[];
  /** Projects where the principal is a full (project/workstream) member (app.full_project_ids). */
  fullProjectIds?: string[];
  /** Partner / clean-team rooms with an active grant (app.room_ids). */
  roomIds?: string[];
  locale: 'en' | 'ar';
}

export function projectIdsOf(p: Principal): string[] {
  return [...p.projects.keys()];
}

/** A scope is "full" when it carries at least one project-wide or workstream role (not merely a room role). */
export function isFullScope(s: ProjectScope): boolean {
  return s.roles.size > 0 || s.workstreamRoles.length > 0;
}

export function fullProjectIdsOf(p: Principal): string[] {
  return [...p.projects.values()].filter((s) => p.kind === 'service' || isFullScope(s)).map((s) => s.projectId);
}

export function roomIdsOf(p: Principal): string[] {
  const out = new Set<string>();
  for (const s of p.projects.values()) {
    for (const r of s.roomIds) out.add(r);
    for (const r of s.roomRoles) out.add(r.roomId);
  }
  return [...out];
}

/** Build a context's DB scope fields from its principal (always call after changing principal.projects). */
export function withDbScope(ctx: RequestContext): RequestContext {
  ctx.projectIds = projectIdsOf(ctx.principal);
  ctx.fullProjectIds = fullProjectIdsOf(ctx.principal);
  ctx.roomIds = roomIdsOf(ctx.principal);
  return ctx;
}
