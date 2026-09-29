'use client';

import { useParams } from 'next/navigation';
import type { ReactNode } from 'react';
import { ErrorState } from '@/components/ErrorState';
import { LoadingState } from '@/components/LoadingState';
import { Main } from '@/components/Main';
import { ProjectNav } from '@/components/ProjectNav';
import { RestrictedState } from '@/components/RestrictedState';
import { isApiError } from '@/lib/api';
import { ProjectContextProvider } from '@/lib/project-context';
import { useMe, useProject } from '@/lib/queries';

export default function ProjectLayout({ children }: { children: ReactNode }) {
  const { projectId } = useParams<{ projectId: string }>();
  const me = useMe();
  const project = useProject(projectId);

  if (project.isLoading || me.isLoading) {
    return (
      <Main>
        <LoadingState />
      </Main>
    );
  }
  if (project.error || !project.data || !me.data) {
    const hidden = isApiError(project.error) && (project.error.isHidden || project.error.isForbidden);
    return <Main>{hidden ? <RestrictedState /> : <ErrorState error={project.error ?? me.error} onRetry={() => project.refetch()} />}</Main>;
  }

  return (
    <ProjectContextProvider project={project.data} me={me.data}>
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-4 md:flex-row md:gap-6 md:py-6">
        <ProjectNav me={me.data} project={project.data} />
        <main id="main-content" tabIndex={-1} className="min-w-0 flex-1 focus:outline-none">
          {children}
        </main>
      </div>
    </ProjectContextProvider>
  );
}
