'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { useState } from 'react';
import { jvRoutes } from '@hub/contracts';
import { ActivityHistory } from '@/components/ActivityHistory';
import { DataTable } from '@/components/DataTable';
import { DemoBadge } from '@/components/DemoBadge';
import { ErrorState } from '@/components/ErrorState';
import { TextField } from '@/components/Field';
import { LoadingState } from '@/components/LoadingState';
import { PageHeader } from '@/components/PageHeader';
import { RestrictedState } from '@/components/RestrictedState';
import { StatusBadge } from '@/components/StatusBadge';
import { useToast } from '@/components/Toast';
import { EM_DASH, useI18n } from '@/i18n/provider';
import { api, isApiError } from '@/lib/api';
import { jvHref, useJvRefresh, usePartnerNames, useScenario, type ScenarioDetail } from '@/lib/jv';
import { useProjectContext } from '@/lib/project-context';
import { ButtonRow, Callout, CmdButton, Facts, JvCommandDialog, Money, Panel, Person, UText } from '../../_components/jv';
import { ContributionEditor, OwnershipEditor, OwnershipSummary, TermsFields, contributionBody, ownershipBody, type ContributionDraft, type OwnershipDraft } from '../../_components/scenario-form';

function AddVersionDialog({ s, onClose }: { s: ScenarioDetail; onClose: () => void }) {
  const { t } = useI18n();
  const { projectId } = useProjectContext();
  const refresh = useJvRefresh();
  const toast = useToast();
  // Starts from the CURRENT entered values (a copy for editing) — never from defaults.
  const [ownership, setOwnership] = useState<OwnershipDraft[]>(s.ownership.map((o) => ({ party: o.party, percent: o.percent ?? '', note: o.note ?? '' })));
  const [contributions, setContributions] = useState<ContributionDraft[]>(
    s.contributions.map((c) => ({ party: c.party, description: c.description, amount: c.amount?.amount ?? '', currency: c.amount?.currency ?? '', unitScale: c.amount ? (String(c.amount.unitScale) as ContributionDraft['unitScale']) : '' })),
  );
  const [governance, setGovernance] = useState(s.governanceTerms ?? '');
  const [assumptions, setAssumptions] = useState(s.assumptions ?? '');
  const [label, setLabel] = useState('');
  return (
    <JvCommandDialog
      open
      onClose={onClose}
      title={t('jv.scenarios.addVersion.title')}
      confirmLabel={t('jv.scenarios.addVersion.confirm')}
      noteMode="required"
      noteLabel={t('jv.scenarios.addVersion.changeNote')}
      expectedVersion={s.version}
      consequences={[t('jv.scenarios.addVersion.effect'), t('jv.scenarios.noDefaults'), t('common.command.audited')]}
      onConfirm={async ({ note }) => {
        const r = await api(jvRoutes.addScenarioVersion, {
          params: { projectId, scenarioId: s.id },
          body: {
            expectedVersion: s.version,
            ownership: ownershipBody(ownership),
            contributions: contributionBody(contributions),
            governanceTerms: governance.trim() || null,
            assumptions: assumptions.trim() || null,
            changeNote: note,
            ...(label.trim() ? { versionLabel: label.trim() } : {}),
          },
        });
        await refresh();
        toast.show('success', t('jv.scenarios.addVersion.done', { no: r.versionNo }));
        onClose();
      }}
    >
      <TextField label={t('jv.scenarios.fields.versionLabel')} value={label} maxLength={32} onChange={(e) => setLabel(e.target.value)} />
      <OwnershipEditor rows={ownership} onChange={setOwnership} />
      <ContributionEditor rows={contributions} onChange={setContributions} />
      <TermsFields governance={governance} assumptions={assumptions} onGovernance={setGovernance} onAssumptions={setAssumptions} />
    </JvCommandDialog>
  );
}

/** A scenario with its immutable version history: every version keeps its entered values; nothing is assumed. */
export default function ScenarioPage() {
  const { scenarioId } = useParams<{ scenarioId: string }>();
  const { t, tStatus, formatDateTime } = useI18n();
  const { projectId, can } = useProjectContext();
  const partners = usePartnerNames();
  const [open, setOpen] = useState(false);
  const q = useScenario(scenarioId);
  const base = jvHref(projectId);
  if (q.isLoading) return <LoadingState />;
  if (q.error) return isApiError(q.error) && (q.error.status === 404 || q.error.status === 403) ? <RestrictedState /> : <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const s = q.data!;
  return (
    <>
      <PageHeader
        eyebrow={
          <Link href={`${base}/scenarios`} className="inline-flex items-center gap-1 hover:underline">
            <ChevronLeft aria-hidden="true" className="size-4 rtl:rotate-180" />
            {t('jv.scenarios.title')}
          </Link>
        }
        title={<span dir="auto">{s.name}</span>}
        documentTitle={s.name}
        badges={
          <>
            <StatusBadge enumName="approvalStates" value={s.approvalState} size="md" />
            <span className="text-xs text-muted">{t('jv.scenarios.versionValue', { no: s.versionNo, label: s.versionLabel })}</span>
            <span className="text-xs text-muted">{tStatus('classifications', s.classification)}</span>
            {s.isDemo ? <DemoBadge /> : null}
          </>
        }
      />
      <div className="space-y-6" data-testid="scenario-detail" data-version-no={s.versionNo}>
        <Callout tone="warning" testId="scenario-proposed">
          {s.ownershipComplete ? t('jv.scenarios.completeButProposed') : t('jv.scenarios.incomplete')}
        </Callout>
        <Panel
          title={t('jv.scenarios.currentTitle')}
          testId="scenario-current"
          actions={can('jv.scenario.manage') ? <ButtonRow><CmdButton label={t('jv.scenarios.addVersion.action')} onClick={() => setOpen(true)} testId="cmd-add-version" variant="primary" /></ButtonRow> : null}
        >
          <Facts
            items={[
              { label: t('jv.common.partner'), value: <span dir="auto">{partners.label(s.partnerId) ?? t('jv.common.none')}</span> },
              { label: t('jv.scenarios.ownership'), value: <OwnershipSummary s={s} />, testId: 'scenario-ownership' },
              { label: t('jv.scenarios.enteredTotal'), value: s.ownershipTotal ? <span dir="ltr">{t('jv.scenarios.percentValue', { percent: s.ownershipTotal })}</span> : t('jv.scenarios.tbd') },
              {
                label: t('jv.scenarios.contributions'),
                value:
                  s.contributions.length === 0 ? (
                    EM_DASH
                  ) : (
                    <ul className="space-y-1">
                      {s.contributions.map((c, i) => (
                        <li key={i}>
                          <span dir="auto" className="font-medium">
                            {c.party}
                          </span>
                          : <span dir="auto">{c.description}</span> — {c.amount ? <Money value={c.amount} /> : <span className="text-warning">{t('jv.scenarios.tbd')}</span>}
                        </li>
                      ))}
                    </ul>
                  ),
                wide: true,
              },
              { label: t('jv.scenarios.governanceTerms'), value: <UText value={s.governanceTerms} multiline />, wide: true },
              { label: t('jv.scenarios.assumptions'), value: <UText value={s.assumptions} multiline />, wide: true },
            ]}
          />
        </Panel>
        <section className="space-y-2" data-testid="scenario-versions">
          <h2 className="text-lg font-semibold text-ink">{t('jv.scenarios.versionsTitle')}</h2>
          <p className="text-sm text-muted">{t('jv.scenarios.versionsHint')}</p>
          <DataTable
            caption={t('jv.scenarios.versionsTitle')}
            columns={[
              { key: 'no', header: t('jv.scenarios.fields.version'), isRowHeader: true, cell: (v) => <span dir="auto">{t('jv.scenarios.versionValue', { no: v.versionNo, label: v.versionLabel })}</span> },
              { key: 'ownership', header: t('jv.scenarios.ownership'), cell: (v) => <OwnershipSummary s={{ ownership: v.ownership, ownershipComplete: v.ownership.every((o) => o.percent !== null), ownershipTotal: null }} /> },
              { key: 'change', header: t('jv.scenarios.addVersion.changeNote'), cell: (v) => <UText value={v.changeNote} /> },
              { key: 'by', header: t('jv.common.recordedBy'), cell: (v) => <Person id={v.createdBy} people={s.people} /> },
              { key: 'at', header: t('jv.common.recordedAt'), cell: (v) => <span className="tabular">{formatDateTime(v.createdAt)}</span> },
            ]}
            rows={[...s.versions].sort((a, b) => b.versionNo - a.versionNo)}
            rowKey={(v) => String(v.versionNo)}
            emptyTitle={t('jv.scenarios.empty')}
          />
        </section>
        <ActivityHistory projectId={projectId} entityType="deal_scenario" entityId={s.id} />
      </div>
      {open ? <AddVersionDialog key={s.version} s={s} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
