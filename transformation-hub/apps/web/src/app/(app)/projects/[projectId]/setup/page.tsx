'use client';

import Link from 'next/link';
import { Check, CircleAlert } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, type ReactNode } from 'react';
import { LoadingState } from '@/components/LoadingState';
import { PageHeader } from '@/components/PageHeader';
import { ProjectBadges } from '@/components/ProjectBadges';
import { StatusBadge } from '@/components/StatusBadge';
import { btn, card, cx } from '@/components/ui';
import { useI18n } from '@/i18n/provider';
import { useProjectContext } from '@/lib/project-context';
import { sectionAppliesTo, sectionByKey, sectionHref, type SectionKey } from '@/lib/sections';
import { StepBaseline } from './_components/StepBaseline';
import { StepCommittee } from './_components/StepCommittee';

/** The eight steps of the actual-project setup wizard (spec §21). Steps 5 and 6 are run here; the others link to the
 * screen where that step is done today (no state is claimed for them unless the server's setup gaps say so). */
const STEPS = ['program', 'newco', 'sources', 'perimeter', 'committee', 'baseline', 'settings', 'launch'] as const;
type Step = (typeof STEPS)[number];
const IN_PAGE: readonly Step[] = ['committee', 'baseline'];
/** Server setup gaps (portfolio setupGaps, computed from current records) that belong to each step. */
const STEP_GAPS: Partial<Record<Step, readonly string[]>> = {
  perimeter: ['perimeter', 'owners'],
  committee: ['committee', 'authority_matrix'],
  baseline: ['baseline'],
};
/** Where a step is done today (section + path suffix). */
const STEP_SCREEN: Partial<Record<Step, { section: SectionKey; suffix: string }>> = {
  program: { section: 'charter', suffix: '' },
  newco: { section: 'newco', suffix: '' },
  sources: { section: 'documents', suffix: '?tab=sources' },
  perimeter: { section: 'perimeter', suffix: '' },
};

function SetupScreen() {
  const { t } = useI18n();
  const { project, projectId, can } = useProjectContext();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const raw = params.get('step') as Step | null;
  const step: Step = raw && IN_PAGE.includes(raw) ? raw : 'committee';
  const gaps = Array.isArray(project.setupState.gaps) ? (project.setupState.gaps as unknown[]).filter((g): g is string => typeof g === 'string') : [];

  const screenHref = (s: Step): string | null => {
    const screen = STEP_SCREEN[s];
    if (!screen) return null;
    const def = sectionByKey(screen.section);
    if (!sectionAppliesTo(def, project.templateKind) || !can(def.permissions)) return null;
    return `${sectionHref(projectId, screen.section)}${screen.suffix}`;
  };
  const stepGaps = (s: Step) => (STEP_GAPS[s] ?? []).filter((g) => gaps.includes(g));
  const go = (s: Step) => router.replace(`${pathname}?step=${s}`, { scroll: false });

  let body: ReactNode = null;
  if (step === 'committee') body = <StepCommittee />;
  if (step === 'baseline') body = <StepBaseline />;

  return (
    <>
      <PageHeader
        eyebrow={t('project.setupWizard.eyebrow')}
        title={<span dir="auto">{project.name}</span>}
        documentTitle={`${project.code} — ${t('project.setupWizard.eyebrow')}`}
        badges={<ProjectBadges project={project} />}
        description={t('project.setupWizard.subtitle')}
      />
      <p className="mb-4 rounded-md border border-info/40 bg-info-soft p-3 text-sm text-ink" data-testid="setup-never-approves">
        {t('project.setupWizard.neverApproves')}
      </p>
      <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
        <nav aria-label={t('project.setupWizard.stepsLabel')}>
          <ol className="space-y-2" data-testid="setup-steps">
            {STEPS.map((s, i) => {
              const inPage = IN_PAGE.includes(s);
              const current = s === step;
              const open = stepGaps(s);
              const href = inPage ? null : screenHref(s);
              const label = (
                <span className="flex min-w-0 items-start gap-2.5">
                  <span className="tabular flex size-6 shrink-0 items-center justify-center rounded-full border border-current text-xs">{i + 1}</span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{t(`project.setupWizard.steps.${s}`)}</span>
                    {STEP_GAPS[s] ? (
                      open.length > 0 ? (
                        <span className="mt-0.5 flex items-center gap-1 text-xs text-warning">
                          <CircleAlert aria-hidden="true" className="size-3.5 shrink-0" />
                          {t('project.setupWizard.gapsOpen', { count: open.length })}
                        </span>
                      ) : (
                        <span className="mt-0.5 flex items-center gap-1 text-xs text-success">
                          <Check aria-hidden="true" className="size-3.5 shrink-0" />
                          {t('project.setupWizard.noGap')}
                        </span>
                      )
                    ) : !inPage ? (
                      <span className="mt-0.5 block text-xs text-muted">{href ? t('project.setupWizard.doneElsewhere') : t('project.setupWizard.notHere')}</span>
                    ) : null}
                  </span>
                </span>
              );
              return (
                <li key={s} data-testid="setup-step" data-step={s} data-gaps={open.join(',')} aria-current={current ? 'step' : undefined}>
                  {inPage ? (
                    <button
                      type="button"
                      onClick={() => go(s)}
                      className={cx('w-full rounded-md border px-3 py-2 text-start', current ? 'border-primary bg-primary-soft text-primary' : 'border-line text-ink hover:bg-surface-muted')}
                      data-testid={`setup-step-${s}`}
                    >
                      {label}
                    </button>
                  ) : href ? (
                    <Link href={href} className="block rounded-md border border-line px-3 py-2 text-ink hover:bg-surface-muted">
                      {label}
                    </Link>
                  ) : (
                    <div className="rounded-md border border-dashed border-line px-3 py-2 text-muted">{label}</div>
                  )}
                </li>
              );
            })}
          </ol>
          {gaps.length > 0 ? (
            <div className={cx(card, 'mt-4 p-3')} data-testid="setup-gap-list">
              <p className="text-sm font-semibold">{t('project.setup.gapsTitle')}</p>
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {gaps.map((g) => (
                  <li key={g}>
                    <StatusBadge enumName="setupGaps" value={g} tone="warning" />
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <Link href={`/projects/${projectId}`} className={cx(btn.link, 'mt-4 inline-block text-sm')}>
            {t('project.setupWizard.backToProject')}
          </Link>
        </nav>
        <div className="min-w-0">{body}</div>
      </div>
    </>
  );
}

/**
 * Project setup wizard (spec §21): steps 5 (committee, delegation and quorum — REQ-SET-013) and 6 (baseline and gates —
 * REQ-SET-014) run here through the existing, audited commands. The wizard records drafts and proposals only; every
 * approval stays with the authorized approvers on the Committee Hub and the Integrated Plan.
 */
export default function SetupPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <SetupScreen />
    </Suspense>
  );
}
