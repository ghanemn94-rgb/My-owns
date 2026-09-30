'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { planningRoutes as P } from '@hub/contracts';
import { useI18n } from '@/i18n/provider';
import { api } from '@/lib/api';
import { localToday, pk, useProgress, useRefreshPlanning, workstreamHref, type Progress, type RagOverride, type WorkstreamHealth } from '@/lib/planning';
import { useProjectContext } from '@/lib/project-context';
import { ConfirmCommandDialog } from '../../ConfirmCommandDialog';
import { DataTable, type Column } from '../../DataTable';
import { DemoBadge } from '../../DemoBadge';
import { ErrorState } from '../../ErrorState';
import { SelectField, TextAreaField, TextField } from '../../Field';
import { LoadingState } from '../../LoadingState';
import { StatusBadge } from '../../StatusBadge';
import { useToast } from '../../Toast';
import { btn, cx } from '../../ui';
import { DateText, ProgressBar, RagBadge, Section } from '../bits';
import { FormDialog } from '../dialogs';
import { useLocalized } from '@/lib/i18n-data';

type Weighted = Progress['project']['progress'];

/** Weighted progress with its denominator and every exclusion + reason (measurement rules 1–2). */
export function WeightedProgressBlock({ p, label }: { p: Weighted; label: string }) {
  const { t, formatNumber } = useI18n();
  return (
    <div className="space-y-2" data-testid="weighted-progress">
      <ProgressBar percent={p.percent} label={label} />
      <p className="text-sm">
        {t('planning.health.basis', { num: formatNumber(p.numeratorWeight), den: formatNumber(p.denominatorWeight), count: formatNumber(p.includedCount) })}
      </p>
      {p.exclusions.length ? (
        <details>
          <summary className="cursor-pointer text-sm text-primary">{t('planning.health.exclusions', { count: formatNumber(p.exclusions.length) })}</summary>
          <ul className="mt-1 max-h-48 list-disc space-y-0.5 overflow-y-auto ps-5 text-xs text-muted">
            {p.exclusions.map((e) => (
              <li key={e.id}>
                <span dir="auto">{e.label ?? e.id}</span> — <span dir="ltr">{e.reason}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

/** Calculated vs effective (override) vs reported RAG, with the explanation (rules 4–6). */
export function RagTriple({ rag }: { rag: WorkstreamHealth['rag'] }) {
  const { t } = useI18n();
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-1.5">
        <RagBadge value={rag.effective} />
        {rag.overridden ? <span className="text-xs text-muted">{t('planning.health.calculatedWas')}</span> : null}
        {rag.overridden ? <RagBadge value={rag.calculated.status} /> : null}
      </div>
      <p className="text-xs text-muted" lang="en" dir="ltr">
        {rag.calculated.explanation}
      </p>
    </div>
  );
}

export function HealthTab() {
  const { t, formatNumber } = useI18n();
  const loc = useLocalized();
  const { projectId, project } = useProjectContext();
  const prog = useProgress(projectId);
  if (prog.isLoading) return <LoadingState />;
  if (prog.error) return <ErrorState error={prog.error} onRetry={() => prog.refetch()} />;
  const d = prog.data!;

  const columns: Column<WorkstreamHealth>[] = [
    { key: 'ws', header: t('planning.common.workstream'), isRowHeader: true, sortValue: (w) => w.code, cell: (w) => <Link href={workstreamHref(projectId, w.id, 'progress')} className={btn.link}><span dir="ltr">{w.code}</span> <span dir="auto" className="text-ink">{loc(w.name, w.nameAr)}</span></Link> },
    { key: 'progress', header: t('planning.health.progress'), sortValue: (w) => w.progress.percent ?? -1, cell: (w) => <div className="w-36"><ProgressBar percent={w.progress.percent} label={`${w.code} ${t('planning.health.progress')}`} /><span className="text-xs text-muted">{t('planning.health.basisShort', { num: formatNumber(w.progress.numeratorWeight), den: formatNumber(w.progress.denominatorWeight) })}</span></div> },
    { key: 'rag', header: t('planning.health.calculated'), sortValue: (w) => w.rag.calculated.status, cell: (w) => <RagTriple rag={w.rag} /> },
    { key: 'reported', header: t('planning.health.reported'), cell: (w) => (w.rag.reported ? <RagBadge value={w.rag.reported} /> : <span className="text-muted">—</span>) },
    { key: 'finish', header: t('planning.health.finish'), cell: (w) => <span className="text-xs">{t('planning.health.baselineVsForecast')}<br /><DateText value={w.baselineFinish} /> → <DateText value={w.forecastFinish} /></span> },
    { key: 'updated', header: t('planning.health.lastUpdate'), cell: (w) => (w.lastAcceptedUpdate ? <DateText value={w.lastAcceptedUpdate.periodEnd} /> : <StatusBadge enumName="ragStatuses" value="not_updated" tone="warning" />) },
    { key: 'blockers', header: t('planning.health.blockers'), sortValue: (w) => w.openBlockers.length, cell: (w) => <span className={cx('tabular', w.openBlockers.length > 0 && 'font-semibold text-danger')}>{formatNumber(w.openBlockers.length)}</span> },
    { key: 'dq', header: t('planning.health.dataQuality'), cell: (w) => (w.dataQuality.length ? <ul className="list-disc ps-4 text-xs text-muted" lang="en" dir="ltr">{w.dataQuality.map((x) => <li key={x}>{x}</li>)}</ul> : <span className="text-xs text-success">{t('planning.health.noGaps')}</span>) },
  ];

  return (
    <div className="space-y-6" data-testid="health-tab">
      <div className="grid gap-4 lg:grid-cols-3">
        <Section id="h-progress" title={t('planning.health.projectProgress')} hint={t('planning.health.progressHint')}>
          <WeightedProgressBlock p={d.project.progress} label={t('planning.health.projectProgress')} />
        </Section>
        <Section id="h-rag" title={t('planning.health.projectRag')} hint={t('planning.health.worstOf')}>
          <div className="space-y-2" data-testid="project-rag">
            <RagBadge value={d.project.rag.effective} size="md" />
            {d.project.rag.overridden ? (
              <p className="text-sm">
                {t('planning.health.calculated')}: <RagBadge value={d.project.rag.calculated.status} />
              </p>
            ) : null}
            <p className="text-xs text-muted" lang="en" dir="ltr">
              {d.project.aggregate.explanation}
            </p>
            <p className="text-xs text-muted">
              {t('planning.health.thresholds', { green: d.thresholds.greenMaxSlipDays, amber: d.thresholds.amberMaxSlipDays, stale: d.thresholds.staleAfterDays })}
            </p>
            {d.baseline ? <p className="text-xs">{t('planning.health.baselineRef', { version: d.baseline.versionNo })}</p> : <p className="text-xs text-warning">{t('planning.health.noBaseline')}</p>}
          </div>
        </Section>
        <Section id="h-red" title={t('planning.health.redCritical')} hint={t('planning.health.redCriticalHint')}>
          {d.project.redCritical.length === 0 ? (
            <p className="text-sm text-muted">{t('planning.health.noRedCritical')}</p>
          ) : (
            <ul className="space-y-2 text-sm" data-testid="red-critical">
              {d.project.redCritical.map((r) => (
                <li key={r.id} className="rounded-md border border-danger/30 bg-danger-soft p-2">
                  <p className="font-medium text-danger" dir="auto">
                    {r.type === 'workstream' ? <Link href={workstreamHref(projectId, r.id, 'progress')} className="hover:underline">{r.label}</Link> : r.label}
                  </p>
                  <p className="text-xs text-ink" lang="en" dir="ltr">
                    {r.reason}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      {d.project.dataQualityIssues.length ? (
        <Section id="h-dq" title={t('planning.health.dataQualityTitle')} hint={t('planning.health.dataQualityHint')}>
          <ul className="list-disc space-y-0.5 ps-5 text-sm" data-testid="data-quality">
            {d.project.dataQualityIssues.map((i, k) => (
              <li key={`${i.id}-${k}`}>
                <span dir="auto">{i.label}</span>: <span className="text-muted" lang="en" dir="ltr">{i.issue}</span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <DataTable caption={t('planning.health.workstreams')} columns={columns} rows={d.workstreams} rowKey={(w) => w.id} emptyTitle={t('planning.health.noWorkstreams')} testId="health-table" />
      <OverridesSection progress={d} />
      <p className="text-xs text-muted">{t('planning.health.asOf', { date: d.today, tz: project.timezone })}</p>
    </div>
  );
}

function OverridesSection({ progress }: { progress: Progress }) {
  const { t, formatDateTime } = useI18n();
  const { projectId, can, me } = useProjectContext();
  const refresh = useRefreshPlanning(projectId);
  const toast = useToast();
  const list = useQuery({ queryKey: pk.overrides(projectId), queryFn: ({ signal }) => api(P.listRagOverrides, { params: { projectId }, query: {}, signal }) });
  const [open, setOpen] = useState(false);
  const [review, setReview] = useState<{ o: RagOverride; approve: boolean } | null>(null);

  const columns: Column<RagOverride>[] = [
    { key: 'entity', header: t('planning.override.item'), isRowHeader: true, cell: (o) => <span dir="auto">{o.entityLabel}</span> },
    { key: 'state', header: t('planning.common.status'), cell: (o) => <StatusBadge enumName="approvalRequestStatuses" value={o.state} label={t(`planning.override.state_${o.state}`)} /> },
    { key: 'change', header: t('planning.override.change'), cell: (o) => <span className="inline-flex flex-wrap items-center gap-1"><RagBadge value={o.calculatedAtRequest} /> → <RagBadge value={o.overrideStatus} /></span> },
    { key: 'reason', header: t('planning.common.reason'), cell: (o) => <span dir="auto" className="text-sm">{o.reason}</span> },
    { key: 'expires', header: t('planning.override.expires'), cell: (o) => <DateText value={o.expiresOn} /> },
    { key: 'by', header: t('planning.override.requestedBy'), cell: (o) => <span dir="auto">{o.requestedByName ?? '—'}</span> },
    { key: 'reviewed', header: t('planning.override.reviewedBy'), cell: (o) => (o.reviewerName ? <span dir="auto">{o.reviewerName} · {formatDateTime(o.reviewedAt)}</span> : '—') },
    { key: 'demo', header: '', cell: (o) => (o.isDemo ? <DemoBadge /> : null) },
    {
      key: 'actions',
      header: t('planning.common.actions'),
      cell: (o) =>
        o.state === 'pending' && can('planning.rag_override.review') && o.requestedBy !== me.user.id ? (
          <span className="flex gap-1">
            <button type="button" className={cx(btn.primary, 'min-h-8 px-2 py-1 text-xs')} onClick={() => setReview({ o, approve: true })}>
              {t('planning.override.approve')}
            </button>
            <button type="button" className={cx(btn.secondary, 'min-h-8 px-2 py-1 text-xs')} onClick={() => setReview({ o, approve: false })}>
              {t('planning.override.reject')}
            </button>
          </span>
        ) : null,
    },
  ];

  return (
    <Section
      id="h-overrides"
      title={t('planning.override.title')}
      hint={t('planning.override.hint')}
      actions={
        can('planning.rag_override.set') ? (
          <button type="button" className={btn.secondary} onClick={() => setOpen(true)} data-testid="override-request">
            {t('planning.override.request')}
          </button>
        ) : null
      }
    >
      <DataTable caption={t('planning.override.title')} columns={columns} rows={list.data?.items} rowKey={(o) => o.id} isLoading={list.isLoading} error={list.error} onRetry={() => list.refetch()} emptyTitle={t('planning.override.empty')} className="border-0" />
      <RequestOverrideDialog open={open} onClose={() => setOpen(false)} progress={progress} />
      {review ? (
        <ConfirmCommandDialog
          open
          onClose={() => setReview(null)}
          title={review.approve ? t('planning.override.approve') : t('planning.override.reject')}
          confirmLabel={review.approve ? t('planning.override.approve') : t('planning.override.reject')}
          noteMode={review.approve ? 'optional' : 'required'}
          noteLabel={review.approve ? undefined : t('planning.common.reason')}
          expectedVersion={review.o.version}
          consequences={[review.approve ? t('planning.override.approveEffect', { status: review.o.overrideStatus, date: review.o.expiresOn }) : t('planning.override.rejectEffect'), t('planning.commands.notSelf'), t('common.command.audited')]}
          onReload={() => void refresh()}
          onConfirm={async ({ note }) => {
            const params = { projectId, overrideId: review.o.id };
            if (review.approve) await api(P.approveRagOverride, { params, body: { expectedVersion: review.o.version, note: note || undefined } });
            else await api(P.rejectRagOverride, { params, body: { expectedVersion: review.o.version, reason: note } });
            await refresh();
            toast.show('success', t('planning.common.commandDone', { action: review.approve ? t('planning.override.approve') : t('planning.override.reject') }));
            setReview(null);
          }}
        />
      ) : null}
    </Section>
  );
}

function RequestOverrideDialog({ open, onClose, progress }: { open: boolean; onClose: () => void; progress: Progress }) {
  const { t } = useI18n();
  const loc = useLocalized();
  const { projectId, project } = useProjectContext();
  const refresh = useRefreshPlanning(projectId);
  const toast = useToast();
  const [f, setF] = useState({ entity: '', status: 'amber', reason: '', expires: '' });
  useEffect(() => {
    if (open) setF({ entity: '', status: 'amber', reason: '', expires: '' });
  }, [open]);
  const today = localToday(project.timezone);
  const valid = !!f.entity && f.reason.trim().length > 0 && !!f.expires && f.expires > today;
  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title={t('planning.override.request')}
      submitLabel={t('planning.override.request')}
      disabled={!valid}
      onSubmit={async () => {
        const isProject = f.entity === projectId;
        await api(P.requestRagOverride, { params: { projectId }, body: { entityType: isProject ? 'project' : 'workstream', entityId: f.entity, overrideStatus: f.status as 'amber', reason: f.reason.trim(), expiresOn: f.expires } });
        toast.show('success', t('planning.override.requested'));
        await refresh();
        onClose();
      }}
    >
      <p className="text-sm text-muted">{t('planning.override.rules')}</p>
      <SelectField label={t('planning.override.item')} required value={f.entity} onChange={(e) => setF({ ...f, entity: e.target.value })}>
        <option value="">{t('planning.common.choose')}</option>
        <option value={projectId}>{t('planning.override.projectItem', { code: project.code })}</option>
        {progress.workstreams.map((w) => (
          <option key={w.id} value={w.id}>
            {w.code} — {loc(w.name, w.nameAr)}
          </option>
        ))}
      </SelectField>
      <SelectField label={t('planning.override.to')} required value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
        {(['green', 'amber', 'red'] as const).map((s) => (
          <option key={s} value={s}>
            {t(`planning.override.rag_${s}`)}
          </option>
        ))}
      </SelectField>
      <TextAreaField label={t('planning.common.reason')} required value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} rows={3} maxLength={2000} />
      <TextField label={t('planning.override.expires')} type="date" required min={today} value={f.expires} onChange={(e) => setF({ ...f, expires: e.target.value })} dir="ltr" hint={t('planning.override.expiresHint')} />
    </FormDialog>
  );
}

