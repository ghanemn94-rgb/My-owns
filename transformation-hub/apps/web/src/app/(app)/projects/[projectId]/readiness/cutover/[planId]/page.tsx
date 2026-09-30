'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { readinessRoutes } from '@hub/contracts';
import { GO_DECISION_TYPE_KEYS } from '@hub/domain';
import { ActivityHistory } from '@/components/ActivityHistory';
import { DataTable } from '@/components/DataTable';
import { DemoBadge } from '@/components/DemoBadge';
import { ErrorState } from '@/components/ErrorState';
import { EvidencePanel } from '@/components/EvidencePanel';
import { SelectField, TextAreaField, TextField } from '@/components/Field';
import { LoadingState } from '@/components/LoadingState';
import { PageHeader } from '@/components/PageHeader';
import { RestrictedState } from '@/components/RestrictedState';
import { StatusBadge } from '@/components/StatusBadge';
import { useToast } from '@/components/Toast';
import { btn, card, cx } from '@/components/ui';
import { EM_DASH, useI18n, type MessageKey } from '@/i18n/provider';
import { api, isApiError } from '@/lib/api';
import { useProjectContext } from '@/lib/project-context';
import { rdHref, rk, useReadinessRefresh, type CutoverPlanDetail } from '@/lib/readiness';
import { ButtonRow, Callout, CmdButton, DecisionIssue, DecisionSelect, Facts, Panel, Person, RdCommandDialog, Tick, UText, useScopeLabels } from '../../_components/rd';
import { PlanFields, planBody, planFormOf, type PlanForm } from '../../_components/plan-form';

type Cmd = 'edit' | 'rehearsal' | 'comms' | 'link' | 'submit' | 'back' | 'decide' | 'execute' | 'rollback' | 'accept' | null;
const EDITABLE = ['planning', 'rehearsal'];
const PREREQ_KEYS = ['hasRunbook', 'hasRollbackPlan', 'communicationsApproved', 'hasWindow', 'hasServiceImpact', 'hasAccountableOwner', 'testingDone', 'hasApprovedGoDecision'] as const;
const HISTORY_KINDS = ['submitted', 'returned_to_planning', 'rehearsal', 'go', 'no_go', 'go_blocked', 'executed', 'rolled_back', 'accepted', 'go_flagged', 'execution_blocked', 'check_bound', 'check_unbound'];
/** History entries that report a refusal or a flag (shown in the danger tone). */
const DANGER_KINDS = ['go_blocked', 'no_go', 'rolled_back', 'go_flagged', 'execution_blocked'];
/** Server labels of missing §7.4 prerequisites (domain `missingCutoverPrerequisites`) → translated prerequisite names. */
const MISSING_KEY: Record<string, (typeof PREREQ_KEYS)[number]> = {
  runbook: 'hasRunbook',
  'contingency/rollback plan': 'hasRollbackPlan',
  'approved communications': 'communicationsApproved',
  'transition window': 'hasWindow',
  'service-impact assessment': 'hasServiceImpact',
  'accountable owner': 'hasAccountableOwner',
  'testing / rehearsal': 'testingDone',
  'approved go/no-go decision': 'hasApprovedGoDecision',
};
function useMissingLabel() {
  const { t } = useI18n();
  return (m: string) => (MISSING_KEY[m] ? t(`readiness.plan.prereq.${MISSING_KEY[m]}`) : m);
}

function PlanDialogs({ p, cmd, onClose }: { p: CutoverPlanDetail; cmd: Cmd; onClose: () => void }) {
  const { t } = useI18n();
  const { projectId } = useProjectContext();
  const refresh = useReadinessRefresh();
  const toast = useToast();
  const [form, setForm] = useState<PlanForm>(planFormOf(p));
  const [text, setText] = useState('');
  const [decisionId, setDecisionId] = useState(p.goDecisionId ?? '');
  const [outcome, setOutcome] = useState<'go' | 'no_go'>('go');
  const params = { projectId, planId: p.id };
  const done = async (msg: string) => {
    await refresh();
    toast.show('success', msg);
    onClose();
  };
  const simple = (key: 'back' | 'execute' | 'rollback' | 'accept', route: typeof readinessRoutes.returnCutoverToPlanning | typeof readinessRoutes.recordCutoverExecution | typeof readinessRoutes.recordCutoverRollback | typeof readinessRoutes.acceptCutover) => (
    <RdCommandDialog
      open
      onClose={onClose}
      title={t(`readiness.plan.${key}.title`)}
      confirmLabel={t(`readiness.plan.${key}.confirm`)}
      noteMode="required"
      noteLabel={t('readiness.common.reason')}
      expectedVersion={p.version}
      danger={key === 'rollback'}
      consequences={[t(`readiness.plan.${key}.effect`), ...(key === 'back' && p.status === 'approved_go' ? [t('readiness.plan.back.goEffect')] : []), t('common.command.audited')]}
      onConfirm={async ({ note }) => {
        await api(route, { params, body: { expectedVersion: p.version, note } });
        await done(t(`readiness.plan.${key}.done`));
      }}
    />
  );
  switch (cmd) {
    case 'edit':
      return (
        <RdCommandDialog
          open
          onClose={onClose}
          title={t('readiness.plan.edit.title')}
          confirmLabel={t('readiness.common.save')}
          noteMode="none"
          expectedVersion={p.version}
          confirmDisabled={!form.title.trim()}
          consequences={[t('readiness.plan.edit.effect'), t('common.command.audited')]}
          onConfirm={async () => {
            const r = await api(readinessRoutes.updateCutoverPlan, { params, body: { expectedVersion: p.version, title: form.title.trim(), ...planBody(form, 'edit') } });
            await done(r.version === p.version ? t('readiness.common.noChanges') : t('readiness.common.saved'));
          }}
        >
          <PlanFields form={form} onChange={setForm} />
        </RdCommandDialog>
      );
    case 'rehearsal':
      return (
        <RdCommandDialog
          open
          onClose={onClose}
          title={t('readiness.plan.rehearsal.title')}
          confirmLabel={t('readiness.plan.rehearsal.confirm')}
          noteMode="optional"
          expectedVersion={p.version}
          confirmDisabled={!text.trim()}
          consequences={[t('readiness.plan.rehearsal.effect'), t('common.command.audited')]}
          onConfirm={async ({ note }) => {
            await api(readinessRoutes.recordCutoverRehearsal, { params, body: { expectedVersion: p.version, testingSummary: text.trim(), ...(note ? { note } : {}) } });
            await done(t('readiness.plan.rehearsal.done'));
          }}
        >
          <TextAreaField label={t('readiness.plan.rehearsal.testing')} required value={text} maxLength={8000} onChange={(e) => setText(e.target.value)} data-testid="rehearsal-summary" />
        </RdCommandDialog>
      );
    case 'comms':
      return (
        <RdCommandDialog
          open
          onClose={onClose}
          title={t('readiness.plan.comms.title')}
          confirmLabel={t('readiness.plan.comms.confirm')}
          noteMode="optional"
          expectedVersion={p.version}
          confirmDisabled={!text.trim()}
          consequences={[t('readiness.plan.comms.effect'), t('common.command.audited')]}
          onConfirm={async ({ note }) => {
            await api(readinessRoutes.recordCommunicationsApproval, { params, body: { expectedVersion: p.version, approvalReference: text.trim(), ...(note ? { note } : {}) } });
            await done(t('readiness.plan.comms.done'));
          }}
        >
          <TextField label={t('readiness.plan.comms.ref')} required value={text} maxLength={500} onChange={(e) => setText(e.target.value)} data-testid="comms-ref" />
        </RdCommandDialog>
      );
    case 'link':
      return (
        <RdCommandDialog
          open
          onClose={onClose}
          title={t('readiness.plan.decision.linkTitle')}
          confirmLabel={t('readiness.plan.decision.linkConfirm')}
          noteMode="none"
          expectedVersion={p.version}
          confirmDisabled={!decisionId}
          consequences={[t('readiness.plan.decision.linkEffect'), t('common.command.audited')]}
          onConfirm={async () => {
            await api(readinessRoutes.linkGoDecision, { params, body: { expectedVersion: p.version, decisionId } });
            await done(t('readiness.plan.decision.done'));
          }}
        >
          <DecisionSelect typeKeys={GO_DECISION_TYPE_KEYS} value={decisionId} onChange={setDecisionId} open />
        </RdCommandDialog>
      );
    case 'submit':
      return (
        <RdCommandDialog
          open
          onClose={onClose}
          title={t('readiness.plan.submit.title')}
          confirmLabel={t('readiness.plan.submit.confirm')}
          expectedVersion={p.version}
          consequences={[t('readiness.plan.submit.effect'), t('common.command.audited')]}
          onConfirm={async ({ note }) => {
            await api(readinessRoutes.submitCutoverForDecision, { params, body: { expectedVersion: p.version, ...(note ? { note } : {}) } });
            await done(t('readiness.plan.submit.done'));
          }}
        />
      );
    case 'decide':
      return (
        <RdCommandDialog
          open
          onClose={onClose}
          title={t('readiness.plan.decide.title')}
          confirmLabel={t('readiness.plan.decide.confirm')}
          noteMode="required"
          noteLabel={t('readiness.plan.decide.rationale')}
          expectedVersion={p.version}
          danger={outcome === 'no_go'}
          consequences={[t('readiness.plan.decide.effect'), t('readiness.plan.decide.sod'), t('common.command.audited')]}
          onConfirm={async ({ note }) => {
            try {
              await api(readinessRoutes.decideGoNoGo, { params, body: { expectedVersion: p.version, outcome, rationale: note } });
            } catch (e) {
              await refresh(); // a refused GO is recorded in the decision history — show it
              throw e;
            }
            await done(t('readiness.plan.decide.done', { outcome: outcome === 'go' ? t('readiness.plan.decide.go') : t('readiness.plan.decide.noGo') }));
          }}
        >
          <SelectField label={t('readiness.plan.decide.outcome')} required value={outcome} onChange={(e) => setOutcome(e.target.value as 'go' | 'no_go')} data-testid="decide-outcome">
            <option value="go">{t('readiness.plan.decide.go')}</option>
            <option value="no_go">{t('readiness.plan.decide.noGo')}</option>
          </SelectField>
        </RdCommandDialog>
      );
    case 'back':
      return simple('back', readinessRoutes.returnCutoverToPlanning);
    case 'execute':
      return simple('execute', readinessRoutes.recordCutoverExecution);
    case 'rollback':
      return simple('rollback', readinessRoutes.recordCutoverRollback);
    case 'accept':
      return simple('accept', readinessRoutes.acceptCutover);
    default:
      return null;
  }
}

function GoEvaluation({ p }: { p: CutoverPlanDetail }) {
  const { t, tStatus } = useI18n();
  const missingLabel = useMissingLabel();
  const { projectId } = useProjectContext();
  const ev = p.goEvaluation;
  return (
    <section className={cx(card, 'p-4', ev.allowed ? 'border-success/40' : 'border-danger/50')} data-testid="go-evaluation" data-allowed={ev.allowed ? 'true' : 'false'}>
      <h2 className="mb-2 text-lg font-semibold text-ink">{t('readiness.plan.go.title')}</h2>
      <Callout tone={ev.allowed ? 'info' : 'danger'}>{ev.allowed ? t('readiness.plan.go.allowed') : t('readiness.plan.go.blocked')}</Callout>
      {p.status === 'approved_go' && ev.blockers.length ? (
        <div className="mt-2" data-testid="go-flagged">
          <Callout tone="danger">{t('readiness.plan.go.flagged')}</Callout>
        </div>
      ) : null}
      {ev.blockers.length ? (
        <div className="mt-3">
          <h3 className="text-sm font-semibold text-ink">{t('readiness.plan.go.blockers')}</h3>
          <ul className="mt-1 divide-y divide-line" data-testid="go-blockers">
            {ev.blockers.map((b) => (
              <li key={b.id} className="flex items-start gap-2 py-1.5 text-sm">
                <span className="shrink-0">
                  <StatusBadge enumName="readinessStatuses" value={b.status} />
                </span>
                <span className="min-w-0">
                  <Link className={cx(btn.link, 'break-words')} href={`${rdHref(projectId)}/checks/${b.id}`} dir="auto">
                    {b.title}
                  </Link>
                  <span className="block text-xs text-muted">{b.blocker ? t('readiness.plan.go.blockerLabel') : t('readiness.plan.go.mandatoryLabel')}</span>
                  {b.evidenceInvalid ? (
                    <span className="block text-xs text-danger" data-testid="go-blocker-evidence-invalid">
                      {t('readiness.plan.go.evidenceInvalid')}
                    </span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {ev.missing.length ? (
        <div className="mt-3">
          <h3 className="text-sm font-semibold text-ink">{t('readiness.plan.go.missing')}</h3>
          <ul className="mt-1 list-disc ps-5 text-sm text-danger" data-testid="go-missing">
            {ev.missing.map((m) => (
              <li key={m}>{missingLabel(m)}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <span hidden>{tStatus('cutoverStatuses', p.status)}</span>
    </section>
  );
}

function DecisionHistory({ p }: { p: CutoverPlanDetail }) {
  const { t, tStatus, formatDateTime } = useI18n();
  const missingLabel = useMissingLabel();
  return (
    <Panel title={t('readiness.plan.history.title')} testId="decision-history">
      <p className="mb-3 text-sm text-muted">{t('readiness.plan.history.hint')}</p>
      {p.decisionHistory.length === 0 ? <p className="text-sm text-muted">{t('readiness.plan.history.empty')}</p> : null}
      <ol className="space-y-3 border-s border-line ps-4">
        {p.decisionHistory.map((h) => {
          const known = HISTORY_KINDS.includes(h.kind);
          const tone = h.kind === 'go' || h.kind === 'accepted' ? 'text-success' : DANGER_KINDS.includes(h.kind) ? 'text-danger' : 'text-ink';
          return (
            <li key={h.id} data-testid="history-entry" data-kind={h.kind} className="text-sm">
              <p className={cx('font-semibold', tone)}>{known ? t(`readiness.plan.history.kinds.${h.kind}` as MessageKey) : h.kind}</p>
              <p className="text-xs text-muted">
                <span className="tabular">{formatDateTime(h.createdAt)}</span> ·{' '}
                {h.actorUserId ? <Person id={h.actorUserId} people={p.people} /> : <span>{t('readiness.plan.history.system')}</span>}
                {h.toStatus ? <> · {tStatus('cutoverStatuses', h.toStatus)}</> : null}
              </p>
              {h.rationale ? (
                <p className="mt-1 whitespace-pre-wrap" dir="auto">
                  {h.rationale}
                </p>
              ) : null}
              {h.evaluation && (h.evaluation.blockers.length || h.evaluation.missing.length) ? (
                <div className="mt-1 rounded-md bg-surface-muted p-2 text-xs">
                  {h.evaluation.blockers.length ? (
                    <div>
                      <p className="font-semibold">{t('readiness.plan.history.blockersAtTime')}</p>
                      <ul className="list-disc ps-4">
                        {h.evaluation.blockers.map((b, i) => (
                          <li key={i}>
                            <span dir="auto">{b.title}</span> ({tStatus('readinessStatuses', b.status)})
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {h.evaluation.missing.length ? (
                    <p>
                      <span className="font-semibold">{t('readiness.plan.history.missingAtTime')}: </span>
                      {h.evaluation.missing.map(missingLabel).join(' · ')}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
    </Panel>
  );
}

export default function CutoverPlanPage() {
  const { planId } = useParams<{ planId: string }>();
  const { t, tStatus, formatDateTime } = useI18n();
  const { projectId, can, me } = useProjectContext();
  const { siteName, wsName } = useScopeLabels();
  const [cmd, setCmd] = useState<Cmd>(null);
  const q = useQuery({ queryKey: rk.plan(projectId, planId), queryFn: ({ signal }) => api(readinessRoutes.getCutoverPlan, { params: { projectId, planId }, signal }) });
  const base = rdHref(projectId);
  if (q.isLoading) return <LoadingState />;
  if (q.error) return isApiError(q.error) && (q.error.status === 404 || q.error.status === 403) ? <RestrictedState /> : <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const p = q.data!;
  const manage = can('readiness.cutover.manage');
  const decide = can('readiness.go_no_go.decide');
  const st = p.status;
  const buttons: ReactNode[] = [];
  const add = (show: boolean, key: Exclude<Cmd, null>, label: string, variant: 'primary' | 'secondary' | 'danger' = 'secondary') => {
    if (show) buttons.push(<CmdButton key={key} label={label} onClick={() => setCmd(key)} testId={`cmd-${key}`} variant={variant} />);
  };
  add(decide && st === 'ready_for_decision' && p.submittedForDecisionBy !== me.user.id, 'decide', t('readiness.plan.decide.action'), 'primary');
  add(manage && EDITABLE.includes(st), 'submit', t('readiness.plan.submit.action'), 'primary');
  add(manage && EDITABLE.includes(st), 'rehearsal', t('readiness.plan.rehearsal.action'));
  add(manage && EDITABLE.includes(st), 'comms', t('readiness.plan.comms.action'));
  add(manage && ['planning', 'rehearsal', 'ready_for_decision'].includes(st), 'link', t('readiness.plan.decision.link'));
  // DOM-P3-04: a GO (e.g. one flagged because a gating check is open again) can be withdrawn for a new decision.
  add(manage && ['ready_for_decision', 'no_go', 'rolled_back', 'approved_go'].includes(st), 'back', t('readiness.plan.back.action'));
  add(manage && st === 'approved_go', 'execute', t('readiness.plan.execute.action'), 'primary');
  add(manage && (st === 'approved_go' || st === 'executed'), 'rollback', t('readiness.plan.rollback.action'), 'danger');
  add(manage && st === 'executed', 'accept', t('readiness.plan.accept.action'), 'primary');
  add(manage && EDITABLE.includes(st), 'edit', t('readiness.common.edit'));
  const whenBy = (at: string | null, by: string | null) =>
    at ? (
      <span>
        <span className="tabular">{formatDateTime(at)}</span> — <Person id={by} people={p.people} />
      </span>
    ) : (
      EM_DASH
    );
  return (
    <>
      <PageHeader
        eyebrow={
          <Link href={`${base}/cutover`} className="inline-flex items-center gap-1 hover:underline">
            <ChevronLeft aria-hidden="true" className="size-4 rtl:rotate-180" />
            {t('readiness.cutover.title')}
          </Link>
        }
        title={
          <span>
            <span dir="ltr">{p.code}</span> — <span dir="auto">{p.title}</span>
          </span>
        }
        documentTitle={`${p.code} — ${p.title}`}
        badges={
          <>
            <StatusBadge enumName="cutoverStatuses" value={p.status} size="md" />
            {p.goNoGo !== p.status ? <StatusBadge enumName="goNoGo" value={p.goNoGo} size="md" label={t('readiness.plan.goNoGoBadge', { value: tStatus('goNoGo', p.goNoGo) })} /> : null}
            {p.isDemo ? <DemoBadge /> : null}
          </>
        }
      />
      <div className="space-y-6" data-testid="plan-detail" data-status={p.status}>
        <Panel title={t('readiness.common.commands')} testId="plan-commands" actions={<ButtonRow>{buttons}</ButtonRow>}>
          {buttons.length === 0 ? <p className="text-sm text-muted">{t('readiness.common.noCommands')}</p> : <p className="text-sm text-muted">{t('readiness.plan.decide.sod')}</p>}
          {manage && !EDITABLE.includes(st) ? <p className="mt-1 text-sm text-muted">{t('readiness.plan.edit.locked')}</p> : null}
        </Panel>
        <div className="grid gap-6 lg:grid-cols-2">
          <GoEvaluation p={p} />
          <Panel title={t('readiness.plan.prereq.title')} testId="prerequisites">
            <p className="mb-2 text-sm text-muted">{t('readiness.plan.prereq.hint')}</p>
            <ul className="space-y-1.5">
              {PREREQ_KEYS.map((k) => (
                <Tick key={k} ok={p.prerequisites[k]} label={t(`readiness.plan.prereq.${k}`)} testId={`prereq-${k}`} />
              ))}
            </ul>
          </Panel>
        </div>
        <Panel title={t('readiness.plan.decision.title')} testId="go-decision">
          {p.goDecision ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Link className={btn.link} href={`/projects/${projectId}/committee/decisions/${p.goDecision.id}`} dir="ltr">
                {p.goDecision.code}
              </Link>
              <StatusBadge enumName="decisionStatuses" value={p.goDecision.status} />
              <DecisionIssue d={p.goDecision} okKey="readiness.plan.decision.ok" />
            </div>
          ) : (
            <p className="text-sm text-muted">{p.goDecisionId ? t('readiness.plan.decision.hidden') : t('readiness.plan.decision.none')}</p>
          )}
        </Panel>
        <section className="space-y-2" data-testid="gating-checks">
          <h2 className="text-lg font-semibold text-ink">{t('readiness.plan.checks.title')}</h2>
          <p className="text-sm text-muted">{t('readiness.plan.checks.hint')}</p>
          <DataTable
            caption={t('readiness.plan.checks.title')}
            clientPageSize={20}
            columns={[
              {
                key: 'code',
                header: t('readiness.checks.columns.code'),
                isRowHeader: true,
                sortValue: (c) => c.code,
                cell: (c) => (
                  <Link className={cx(btn.link, 'whitespace-nowrap')} href={`${base}/checks/${c.id}`} dir="ltr">
                    {c.code}
                  </Link>
                ),
              },
              {
                key: 'title',
                header: t('readiness.checks.columns.title'),
                cell: (c) => (
                  <span className="flex flex-col">
                    <span dir="auto">{c.title}</span>
                    <span className="text-xs text-muted">{tStatus('readinessAreas', c.area)}</span>
                  </span>
                ),
              },
              { key: 'status', header: t('readiness.checks.columns.status'), sortValue: (c) => (c.status === 'failed' ? 0 : 1), cell: (c) => <StatusBadge enumName="readinessStatuses" value={c.status} /> },
              { key: 'latest', header: t('readiness.checks.columns.latestTest'), cell: (c) => (c.latestTest ? <StatusBadge enumName="readinessStatuses" value={c.latestTest.result} /> : <span className="text-xs text-muted">{t('readiness.checks.noTest')}</span>) },
              { key: 'crit', header: t('readiness.checks.columns.criticality'), cell: (c) => <span className="text-xs">{c.blocker ? t('readiness.checks.blocker') : c.mandatory ? t('readiness.checks.mandatory') : t('readiness.checks.optional')}</span> },
              { key: 'contingency', header: t('readiness.plan.checks.contingency'), cell: (c) => <UText value={c.failureContingency} multiline /> },
            ]}
            rows={p.checks}
            rowKey={(c) => c.id}
            initialSort={{ key: 'status', dir: 'asc' }}
            emptyTitle={t('readiness.plan.checks.empty')}
            testId="plan-checks"
          />
        </section>
        <DecisionHistory p={p} />
        <Panel title={t('readiness.common.details')}>
          <Facts
            items={[
              { label: t('readiness.plan.facts.scope'), value: p.siteId ? siteName(p.siteId) : t('readiness.cutover.projectWide') },
              { label: t('readiness.plan.facts.workstream'), value: p.workstreamId ? wsName(p.workstreamId) : EM_DASH },
              { label: t('readiness.plan.facts.accountable'), value: <Person id={p.accountableUserId} people={p.people} /> },
              {
                label: t('readiness.plan.facts.window'),
                value: (
                  <span className="tabular">
                    {formatDateTime(p.windowStart)} – {formatDateTime(p.windowEnd)}
                  </span>
                ),
              },
              { label: t('readiness.plan.facts.runbook'), value: p.runbookDocumentId ? t('readiness.plan.runbookDocument') : <UText value={p.runbookSummary} multiline />, wide: true },
              { label: t('readiness.plan.facts.serviceImpact'), value: <UText value={p.serviceImpact} multiline />, wide: true },
              { label: t('readiness.plan.facts.communications'), value: p.communicationsApproved ? <UText value={p.communicationsApprovalRef} /> : t('readiness.plan.prereq.missing') },
              { label: t('readiness.plan.facts.testing'), value: <span>{p.rehearsalDone ? t('readiness.plan.rehearsed') : t('readiness.plan.notRehearsed')} — <UText value={p.testingSummary} /></span> },
              { label: t('readiness.plan.facts.contingency'), value: <UText value={p.contingencyPlan} multiline />, wide: true, testId: 'plan-contingency' },
              { label: t('readiness.plan.facts.rollback'), value: <UText value={p.rollbackPlan} multiline />, wide: true },
              { label: t('readiness.plan.facts.submitted'), value: whenBy(p.submittedForDecisionAt, p.submittedForDecisionBy) },
              { label: t('readiness.plan.facts.decided'), value: whenBy(p.goNoGoDecidedAt, p.goNoGoDecidedBy) },
              { label: t('readiness.plan.facts.rationale'), value: <UText value={p.goNoGoRationale} multiline />, wide: true },
              { label: t('readiness.plan.facts.executed'), value: p.executedAt ? <span>{whenBy(p.executedAt, p.executedBy)} <UText value={p.executionNote} /></span> : EM_DASH, wide: true },
              { label: t('readiness.plan.facts.accepted'), value: p.postTransitionAccepted ? <span>{whenBy(p.postTransitionAcceptedAt, p.postTransitionAcceptedBy)} <UText value={p.postTransitionAcceptanceNote} /></span> : EM_DASH, wide: true },
            ]}
          />
        </Panel>
        <EvidencePanel targetType="cutover_plan" targetId={p.id} title={t('readiness.plan.acceptanceEvidence')} />
        <ActivityHistory projectId={projectId} entityType="cutover_plan" entityId={p.id} />
      </div>
      {cmd ? <PlanDialogs key={`${cmd}-${p.version}`} p={p} cmd={cmd} onClose={() => setCmd(null)} /> : null}
    </>
  );
}
