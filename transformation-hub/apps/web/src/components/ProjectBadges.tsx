'use client';

import type { ProjectSummary } from '@hub/contracts';
import { useI18n } from '@/i18n/provider';
import { DemoBadge } from './DemoBadge';
import { StatusBadge } from './StatusBadge';

/** Code, Demo flag, lifecycle status, classification and template of a project. */
export function ProjectBadges({ project }: { project: ProjectSummary }) {
  const { t, tStatus } = useI18n();
  return (
    <>
      <span className="rounded bg-surface-muted px-1.5 py-0.5 text-xs font-semibold text-ink" dir="ltr">
        {project.code}
      </span>
      {project.isDemo ? <DemoBadge /> : null}
      <StatusBadge enumName="projectStatuses" value={project.status} />
      <span className="rounded border border-line px-1.5 py-0.5 text-xs text-ink">
        {t('project.fields.classification')}: {tStatus('classifications', project.classification)}
      </span>
      <span className="text-xs text-muted">
        {tStatus('templateKinds', project.templateKind)} · {t('portfolio.templateVersion', { version: project.templateVersionNo })}
      </span>
    </>
  );
}
