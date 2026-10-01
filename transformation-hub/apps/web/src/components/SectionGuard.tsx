'use client';

import type { ReactNode } from 'react';
import { useProjectContext } from '@/lib/project-context';
import { sectionAppliesTo, sectionByKey, type SectionKey } from '@/lib/sections';
import { useI18n } from '@/i18n/provider';
import { NotImplementedYet } from './NotImplementedYet';
import { PageHeader } from './PageHeader';
import { RestrictedState } from './RestrictedState';

/** Renders children only when the caller holds one of the section's permissions (UI hint; API decides). */
export function SectionGuard({ section, children }: { section: SectionKey; children: ReactNode }) {
  const { can, project } = useProjectContext();
  const def = sectionByKey(section);
  if (!sectionAppliesTo(def, project.templateKind) || !can(def.permissions)) return <RestrictedState />;
  return <>{children}</>;
}

/** Screen scheduled for a later phase: honest placeholder, no sample data. */
export function PlaceholderSection({ section }: { section: Exclude<SectionKey, 'overview' | 'charter' | 'workstreams' | 'members' | 'gates' | 'settings'> }) {
  const { t } = useI18n();
  const def = sectionByKey(section);
  const title = t(`project.screens.${section}.title`);
  return (
    <SectionGuard section={section}>
      <PageHeader title={title} description={t(`project.screens.${section}.purpose`)} />
      <NotImplementedYet phase={def.phase ?? ''} feature={title} />
    </SectionGuard>
  );
}
