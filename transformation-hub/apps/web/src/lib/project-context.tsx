'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { Me, RouteResponse, portfolioRoutes } from '@hub/contracts';
import { canInProject } from './queries';

export type ProjectDetail = RouteResponse<typeof portfolioRoutes.getProject>;

interface ProjectContextValue {
  projectId: string;
  project: ProjectDetail;
  me: Me;
  can: (permission: string | readonly string[]) => boolean;
}

const ProjectContext = createContext<ProjectContextValue | null>(null);

export function ProjectContextProvider({ project, me, children }: { project: ProjectDetail; me: Me; children: ReactNode }) {
  const value: ProjectContextValue = {
    projectId: project.id,
    project,
    me,
    can: (permission) => canInProject(me, project.id, permission),
  };
  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
}

/** Available inside /projects/[projectId]/** once the project has loaded and is visible to the caller. */
export function useProjectContext(): ProjectContextValue {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error('useProjectContext must be used inside the project layout');
  return ctx;
}
