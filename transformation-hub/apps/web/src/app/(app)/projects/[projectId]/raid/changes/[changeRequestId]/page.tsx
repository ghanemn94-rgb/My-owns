'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ClipboardCheck, Gavel, Pencil } from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { planningRoutes as P } from '@hub/contracts';
import { ActivityHistory } from '@/components/ActivityHistory';
import { DemoBadge } from '@/components/DemoBadge';
import { ErrorState } from '@/components/ErrorState';
import { TextAreaField } from '@/components/Field';
import { LoadingState } from '@/components/LoadingState';
import { PageHeader } from '@/components/PageHeader';
import { ScrollRegion } from '@/components/ScrollRegion';
import { SectionGuard } from '@/components/SectionGuard';
import { StatusBadge } from '@/components/StatusBadge';
import { useToast } from '@/components/Toast';
import { btn } from '@/components/ui';
import { CommandBar } from '@/components/planning/CommandBar';
import { useChangeRequestCommands } from '@/components/planning/commands';
import { BackLink, Notice } from '@/components/planning/DetailShell';
import { Fact, Section } from '@/components/planning/bits';
import { FormDialog } from '@/components/planning/dialogs';
import { ChangeRequestFormDialog, IMPACT_KEYS, type ImpactKey } from '@/components/planning/raid';
import { MoneyFields, MoneyText, moneyInputOf, parseMoney, type MoneyInput } from '@/components/planning/money';
import { EM_DASH, useI18n } from '@/i18n/provider';
import { api } from '@/lib/api';
import { baselineHref, pk, raidHref, useRefreshPlanning, type ChangeRequest } from '@/lib/planning';
import { useProjectContext } from '@/lib/project-context';
import { DecisionPaperDialog } from '../../../committee/_components/dialogs';

function AssessDialog({ open, onClose, cr }: { open: boolean; onClose: () => void; cr: ChangeRequest }) {
  const { t } = useI18n();
  const { projectId } = useProjectContext();
  const refresh = useRefreshPlanning(projectId);
  const toast = useToast();
  const [impacts, setImpacts] = useState<Partial<Record<ImpactKey, string>>>({});
  const [note, setNote] = useState('');
  const [cost, setCost] = useState<MoneyInput>(() => moneyInputOf(cr.costImpact));
  useEffect(() => {
    if (open) {
      setImpacts({ ...cr.impacts });
      setNote('');
      setCost(moneyInputOf(cr.costImpact));
    }
  }, [open, cr]);
  const clean = Object.fromEntries(Object.entries(impacts).filter(([, v]) => v && v.trim()).map(([k, v]) => [k, v!.trim()]));
  const money = parseMoney(cost);
  const costTextOnly = !!clean['cost'] && money === null;
  return (
    <FormDialog
      open={open}
      onClose={onClose}
      size="lg"
      testId="cr-assess"
      title={t('planning.cr.assessTitle', { code: cr.code })}
      submitLabel={t('planning.cr.assess')}
      disabled={Object.keys(clean).length === 0 || money === 'invalid'}
      onReload={() => void refresh()}
      onSubmit={async () => {
        // Omitted = unchanged; an emptied amount clears a previously recorded cost impact (null).
        const costImpact = money === 'invalid' ? undefined : money === null ? (cr.costImpact ? null : undefined) : money;
        await api(P.assessChangeRequest, {
          params: { projectId, changeRequestId: cr.id },
          body: { expectedVersion: cr.version, impacts: clean, ...(costImpact !== undefined ? { costImpact } : {}), note: note.trim() || undefined },
        });
        toast.show('success', t('planning.cr.assessed'));
        await refresh();
        onClose();
      }}
    >
      <p className="text-sm text-muted">{t('planning.cr.assessHint')}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {IMPACT_KEYS.map((k) => (
          <TextAreaField key={k} label={t(`planning.cr.impact_${k}`)} value={impacts[k] ?? ''} onChange={(e) => setImpacts({ ...impacts, [k]: e.target.value })} rows={2} maxLength={2000} />
        ))}
      </div>
      <MoneyFields legend={t('planning.cr.costImpact')} hint={t('planning.cr.costImpactHint')} value={cost} onChange={setCost} testId="cr-cost-impact" />
      {costTextOnly ? (
        <p role="note" className="rounded-md border border-warning/40 bg-warning-soft p-2 text-sm text-ink" data-testid="cr-cost-text-only">
          {t('planning.cr.costTextOnly')}
        </p>
      ) : null}
      <TextAreaField label={t('common.command.note')} value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={4000} />
    </FormDialog>
  );
}

export default function ChangeRequestPage() {
  const { t, formatDateTime } = useI18n();
  const { changeRequestId } = useParams<{ changeRequestId: string }>();
  const { projectId, can, me } = useProjectContext();
  const refresh = useRefreshPlanning(projectId);
  const q = useQuery({ queryKey: pk.changeRequest(projectId, changeRequestId), queryFn: ({ signal }) => api(P.getChangeRequest, { params: { projectId, changeRequestId }, signal }) });
  const commands = useChangeRequestCommands(q.data);
  const [edit, setEdit] = useState(false);
  const [assess, setAssess] = useState(false);
  const [paper, setPaper] = useState(false);
  const router = useRouter();
  const paperSubject = useMemo(() => ({ type: 'change_request' as const, id: changeRequestId }), [changeRequestId]);
  if (q.isLoading) return <LoadingState />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const c = q.data;
  const recorded = IMPACT_KEYS.filter((k) => c.impacts[k]);
  return (
    <SectionGuard section="raid">
      <BackLink href={`/projects/${projectId}/raid?tab=changes`} label={t('planning.cr.back')} />
      <PageHeader
        eyebrow={<span dir="ltr">{c.code}</span>}
        title={<span dir="auto">{c.title}</span>}
        documentTitle={`${c.code} — ${c.title}`}
        badges={
          <>
            <StatusBadge enumName="changeRequestStatuses" value={c.status} size="md" />
            {c.rebaseline ? <StatusBadge enumName="baselineStatuses" value="proposed" tone="info" label={t('planning.cr.rebaseline')} /> : null}
            {c.isDemo ? <DemoBadge /> : null}
          </>
        }
        actions={
          <>
            {c.status === 'under_review' && can('planning.change_request.assess') ? (
              <button type="button" className={btn.secondary} onClick={() => setAssess(true)} data-testid="cr-assess-open">
                <ClipboardCheck aria-hidden="true" className="size-4" />
                {t('planning.cr.assess')}
              </button>
            ) : null}
            {c.status === 'draft' && can('planning.change_request.create') ? (
              <button type="button" className={btn.secondary} onClick={() => setEdit(true)}>
                <Pencil aria-hidden="true" className="size-4" />
                {t('planning.common.edit')}
              </button>
            ) : null}
            {['draft', 'submitted', 'under_review'].includes(c.status) && can('governance.decision.draft') ? (
              // DOM-P2R-03: a committee paper raised FOR this change request (its subject is pre-selected).
              <button type="button" className={btn.secondary} onClick={() => setPaper(true)} data-testid="cr-raise-paper">
                <Gavel aria-hidden="true" className="size-4" />
                {t('planning.cr.raisePaper')}
              </button>
            ) : null}
          </>
        }
      />
      <DecisionPaperDialog
        open={paper}
        onClose={() => setPaper(false)}
        decision={null}
        defaultSubject={paperSubject}
        onCreated={(id) => router.push(`/projects/${projectId}/committee/decisions/${id}`)}
      />
      {c.status === 'under_review' && c.requestedBy === me.user.id ? <Notice tone="info">{t('planning.cr.selfNotice')}</Notice> : null}
      {c.status === 'approved' && c.rebaseline && !c.linkedBaselineId ? (
        <Notice tone="warning">
          {t('planning.cr.rebaselineNext')}{' '}
          <Link className={btn.link} href={`/projects/${projectId}/plan?tab=baselines`}>
            {t('planning.cr.goBaselines')}
          </Link>
        </Notice>
      ) : null}
      <CommandBar className="mb-6" commands={commands} allowed={c.allowedCommands} expectedVersion={c.version} onDone={refresh} onReload={() => void q.refetch()} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Section id="cr-case" title={t('planning.cr.case')}>
          <dl className="grid gap-3">
            <Fact label={t('planning.cr.rationale')} wide>
              <span dir="auto" className="whitespace-pre-line">{c.rationale}</span>
            </Fact>
            <Fact label={t('planning.cr.alternatives')} wide>
              {c.alternatives.length ? (
                <ul className="list-disc ps-5">
                  {c.alternatives.map((a) => (
                    <li key={a} dir="auto">
                      {a}
                    </li>
                  ))}
                </ul>
              ) : (
                EM_DASH
              )}
            </Fact>
            <Fact label={t('planning.cr.subject')}>
              {c.subjectType === 'perimeter_item' && c.subjectId ? (
                // Perimeter changes (AT-07): the decided outcome is applied from the item page.
                <Link className={btn.link} href={`/projects/${projectId}/perimeter/items/${c.subjectId}`} data-testid="cr-subject-link" dir="ltr">
                  {c.subjectType}
                </Link>
              ) : c.subjectType === 'risk' && c.subjectId ? (
                // Raised from a risk (REQ-UX-015).
                <Link className={btn.link} href={raidHref(projectId, 'risks', c.subjectId)} data-testid="cr-subject-link" data-subject-type="risk">
                  {t('planning.cr.openSourceRisk')}
                </Link>
              ) : c.subjectType ? (
                <span dir="ltr">{c.subjectType}</span>
              ) : (
                EM_DASH
              )}
            </Fact>
            <Fact label={t('planning.cr.linkedBaseline')}>
              {c.linkedBaselineId ? (
                <Link className={btn.link} href={baselineHref(projectId, c.linkedBaselineId)}>
                  {t('planning.cr.openBaseline')}
                </Link>
              ) : (
                EM_DASH
              )}
            </Fact>
            {c.proposedChange ? (
              <Fact label={t('planning.cr.proposedChange')} wide>
                <ScrollRegion as="pre" label={t('planning.cr.proposedChange')} className="max-h-48 overflow-auto rounded bg-surface-muted p-2 text-xs" dir="ltr">
                  {JSON.stringify(c.proposedChange, null, 2)}
                </ScrollRegion>
              </Fact>
            ) : null}
          </dl>
        </Section>
        <Section id="cr-impacts" title={t('planning.cr.impacts')} hint={t('planning.cr.impactsHint')}>
          <dl className="mb-3 grid gap-3" data-testid="cr-cost-impact-fact">
            <Fact label={t('planning.cr.costImpact')}>
              {c.costImpact ? (
                <span className="flex flex-col gap-1">
                  <MoneyText value={c.costImpact} testId="cr-cost-impact-value" />
                  {/* DOM-P2R-02: a requester-stated amount decides authority only once an assessor other than the requester confirms it. */}
                  <span className={c.costImpactConfirmed ? 'text-xs text-muted' : 'text-xs text-warning'} data-testid="cr-cost-impact-confirmation" data-confirmed={c.costImpactConfirmed ? 'true' : 'false'}>
                    {c.costImpactConfirmed ? t('planning.cr.costConfirmed') : t('planning.cr.costUnconfirmed')}
                  </span>
                </span>
              ) : c.impacts.cost ? (
                <span className="text-warning">{t('planning.cr.costNotQuantified')}</span>
              ) : (
                <span className="text-muted">{t('planning.cr.costNotRecorded')}</span>
              )}
            </Fact>
          </dl>
          {recorded.length === 0 ? (
            <p className="text-sm text-warning">{t('planning.cr.noImpacts')}</p>
          ) : (
            <dl className="grid gap-3 sm:grid-cols-2" data-testid="cr-impacts">
              {IMPACT_KEYS.map((k) => (
                <Fact key={k} label={t(`planning.cr.impact_${k}`)}>
                  {c.impacts[k] ? <span dir="auto">{c.impacts[k]}</span> : <span className="text-muted">{t('planning.cr.notAssessed')}</span>}
                </Fact>
              ))}
            </dl>
          )}
        </Section>
        <Section id="cr-decision" title={t('planning.cr.decision')}>
          <dl className="grid gap-3 sm:grid-cols-2">
            <Fact label={t('planning.cr.requestedBy')}>
              <span dir="auto">{c.requestedByName ?? EM_DASH}</span>
            </Fact>
            <Fact label={t('planning.baseline.createdAt')}>{formatDateTime(c.createdAt)}</Fact>
            <Fact label={t('planning.cr.decidedAt')}>{formatDateTime(c.decidedAt)}</Fact>
            <Fact label={t('planning.baseline.decisionNote')}>
              <span dir="auto">{c.decisionNote ?? EM_DASH}</span>
            </Fact>
            <Fact label={t('planning.approvalDecision.backedBy')}>
              {c.decisionId ? (
                <Link className={btn.link} href={`/projects/${projectId}/committee/decisions/${c.decisionId}`} data-testid="cr-decision-link">
                  {t('planning.approvalDecision.open')}
                </Link>
              ) : c.decidedAt && c.status !== 'rejected' && c.status !== 'withdrawn' ? (
                <span className="text-muted">{t('planning.approvalDecision.delegated')}</span>
              ) : (
                EM_DASH
              )}
            </Fact>
          </dl>
        </Section>
      </div>
      <ActivityHistory className="mt-6" projectId={projectId} entityType="change_request" entityId={c.id} />
      <ChangeRequestFormDialog open={edit} onClose={() => setEdit(false)} cr={c} />
      <AssessDialog open={assess} onClose={() => setAssess(false)} cr={c} />
    </SectionGuard>
  );
}
