'use client';

import { useQuery } from '@tanstack/react-query';
import { identityRoutes, portfolioRoutes, type Me, type RouteQuery } from '@hub/contracts';
import { api } from './api';

export const qk = {
  me: ['me'] as const,
  authConfig: ['auth', 'config'] as const,
  demoUsers: ['auth', 'demo-users'] as const,
  projects: (q: object) => ['projects', q] as const,
  project: (projectId: string) => ['project', projectId] as const,
  workstreams: (projectId: string) => ['project', projectId, 'workstreams'] as const,
  members: (projectId: string) => ['project', projectId, 'members'] as const,
  activity: (projectId: string, q: object) => ['project', projectId, 'activity', q] as const,
  templates: ['templates'] as const,
  programs: ['programs'] as const,
  directory: (q: string) => ['directory', q] as const,
  adminUsers: (q: object) => ['admin', 'users', q] as const,
};

export function useMe() {
  return useQuery({ queryKey: qk.me, queryFn: ({ signal }) => api(identityRoutes.me, { signal }), staleTime: 60_000 });
}

export function useProject(projectId: string) {
  return useQuery({
    queryKey: qk.project(projectId),
    queryFn: ({ signal }) => api(portfolioRoutes.getProject, { params: { projectId }, signal }),
  });
}

export function useWorkstreams(projectId: string, enabled = true) {
  return useQuery({
    queryKey: qk.workstreams(projectId),
    queryFn: ({ signal }) => api(portfolioRoutes.listWorkstreams, { params: { projectId }, signal }),
    enabled,
  });
}

export function useProjects(query: RouteQuery<typeof portfolioRoutes.listProjects>) {
  return useQuery({
    queryKey: qk.projects(query),
    queryFn: ({ signal }) => api(portfolioRoutes.listProjects, { query, signal }),
    placeholderData: (prev) => prev,
  });
}

// ---------------------------------------------------------------------------------------------------------
// Permission helpers — UI hints only; the API remains the authority for every read and mutation.

export function projectAccess(me: Me | undefined, projectId: string) {
  return me?.projects.find((p) => p.projectId === projectId);
}

export function canInProject(me: Me | undefined, projectId: string, permission: string | readonly string[]): boolean {
  const access = projectAccess(me, projectId);
  if (!access) return false;
  const wanted = typeof permission === 'string' ? [permission] : permission;
  return wanted.some((p) => access.permissions.includes(p));
}

export function canInOrg(me: Me | undefined, permission: string): boolean {
  return Boolean(me?.orgPermissions.includes(permission));
}
