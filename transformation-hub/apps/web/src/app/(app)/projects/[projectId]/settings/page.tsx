'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { ActivityHistory } from '@/components/ActivityHistory';
import { LoadingState } from '@/components/LoadingState';
import { PageHeader } from '@/components/PageHeader';
import { ProjectBadges } from '@/components/ProjectBadges';
import { RestrictedState } from '@/components/RestrictedState';
import { SectionGuard } from '@/components/SectionGuard';
import { cx } from '@/components/ui';
import { useI18n } from '@/i18n/provider';
import { useProjectContext } from '@/lib/project-context';
import { RagThresholdsPanel } from './_components/RagThresholdsPanel';
import { TemplateUpgradePanel } from './_components/TemplateUpgradePanel';

const TABS = ['rag', 'template'] as const;
type Tab = (typeof TABS)[number];

function SettingsScreen() {
  const { t } = useI18n();
  const { project, projectId, can } = useProjectContext();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const raw = params.get('tab') as Tab | null;
  const tab: Tab = raw && TABS.includes(raw) ? raw : 'rag';
  const go = (x: Tab) => router.replace(`${pathname}?tab=${x}`, { scroll: false });
  const label = (x: Tab) => (x === 'rag' ? t('config.settings.tabs.rag') : t('config.settings.tabs.template'));
  return (
    <>
      <PageHeader
        eyebrow={t('config.settings.eyebrow')}
        title={t('config.settings.title')}
        documentTitle={`${project.code} — ${t('config.settings.title')}`}
        badges={<ProjectBadges project={project} />}
        description={t('config.settings.subtitle')}
      />
      <div role="tablist" aria-label={t('config.settings.title')} className="mb-4 flex flex-wrap gap-1 border-b border-line">
        {TABS.map((x) => (
          <button
            key={x}
            type="button"
            role="tab"
            id={`settings-tab-${x}`}
            aria-selected={tab === x}
            aria-controls={tab === x ? `settings-panel-${x}` : undefined}
            tabIndex={tab === x ? 0 : -1}
            onClick={() => go(x)}
            onKeyDown={(e) => {
              const forward = document.dir === 'rtl' ? 'ArrowLeft' : 'ArrowRight';
              const backward = document.dir === 'rtl' ? 'ArrowRight' : 'ArrowLeft';
              if (e.key !== forward && e.key !== backward) return;
              e.preventDefault();
              const next = TABS[(TABS.indexOf(tab) + (e.key === forward ? 1 : TABS.length - 1)) % TABS.length]!;
              go(next);
              document.getElementById(`settings-tab-${next}`)?.focus();
            }}
            className={cx('-mb-px inline-flex min-h-10 items-center border-b-2 px-3 py-2 text-sm font-medium', tab === x ? 'border-primary text-primary' : 'border-transparent text-ink hover:text-primary')}
            data-testid={`settings-tab-${x}`}
          >
            {label(x)}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`settings-panel-${tab}`} aria-labelledby={`settings-tab-${tab}`} className="space-y-6">
        {tab === 'rag' ? <RagThresholdsPanel /> : can('config.template.read') ? <TemplateUpgradePanel /> : <RestrictedState showHomeLink={false} />}
        <ActivityHistory projectId={projectId} entityType={tab === 'rag' ? 'project' : 'project_template_migration'} />
      </div>
    </>
  );
}

/**
 * Project configuration (REQ module project-config): RAG thresholds (REQ-PLN-019) and the template version with its
 * upgrades (REQ-ENT-009, AT-26). Every change is a proposal decided by another person, audited, and never retroactive.
 */
export default function SettingsPage() {
  return (
    <SectionGuard section="settings">
      <Suspense fallback={<LoadingState />}>
        <SettingsScreen />
      </Suspense>
    </SectionGuard>
  );
}
