'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { readinessRoutes } from '@hub/contracts';
import { TSA_DECISION_TYPE_KEYS, TSA_ESCALATION_OPTIONS, TSA_SIMPLE_COMMANDS, type TsaEscalationOptionKey, type TsaSimpleCommand } from '@hub/domain';
import { ActivityHistory } from '@/components/ActivityHistory';
import { DemoBadge } from '@/components/DemoBadge';
import { ErrorState } from '@/components/ErrorState';
import { EvidencePanel } from '@/components/EvidencePanel';
import { SelectField, TextAreaField, TextField } from '@/components/Field';
import { LoadingState } from '@/components/LoadingState';
import { PageHeader } from '@/components/PageHeader';
import { RestrictedState } from '@/components/RestrictedState';
import { StatusBadge } from '@/components/StatusBadge';
import { useToast } from '@/components/Toast';
import { btn } from '@/components/ui';
import { EM_DASH, useI18n } from '@/i18n/provider';
import { api, isApiError } from '@/lib/api';
import { useProjectContext } from '@/lib/project-context';
import { rdHref, rk, useReadinessRefresh, type TsaServiceDetail } from '@/lib/readiness';
import { ButtonRow, Callout, CmdButton, DecisionIssue, DecisionSelect, Facts, Money, Panel, Person, RdCommandDialog, UText, useScopeLabels } from '../../_components/rd';
import { ExpiryBadge, TsaFields, tsaBody, tsaFormOf, type TsaForm } from '../../_components/tsa-form';

type Cmd = 'edit' | 'transition' | 'approve' | 'acceptReplacement' | 'failure' | 'requestExtension' | 'recordExtension' | 'requestExit' | 'approveExit' | 'rejectExit' | null;
const REPLACEMENT_STATUSES = ['active', 'extended', 'exit_in_progress', 'expired_unresolved', 'breached'];
const FAILURE_STATUSES = ['approved', 'active', 'extended', 'exit_in_progress', 'expired_unresolved', 'breached'];
const EXTENSION_STATUSES = ['active', 'extended', 'exit_in_progress', 'expired_unresolved', 'breached'];
const EXIT_STATUSES = ['exit_in_progress', 'expired_unresolved'];
/** Server-generated escalation option titles → translation keys (anything else is shown as recorded). */
const STANDARD_OPTION: Partial<Record<string, TsaEscalationOptionKey>> = Object.fromEntries(TSA_ESCALATION_OPTIONS.map((o) => [o.title, o.key]));

function TsaDialogs({ x, cmd, onClose }: { x: TsaServiceDetail; cmd: Cmd; onClose: () => void }) {
  const { t, tStatus } = useI18n();
  const { projectId } = useProjectContext();
  const refresh = useReadinessRefresh();
  const toast = useToast();
  const simple = x.allowedCommands.filter((c): c is TsaSimpleCommand => (TSA_SIMPLE_COMMANDS as readonly string[]).includes(c));
  const [form, setForm] = useState<TsaForm>(tsaFormOf(x));
  const [command, setCommand] = useState<TsaSimpleCommand | ''>(simple[0] ?? '');
  const [decisionId, setDecisionId] = useState('');
  const [date, setDate] = useState('');
  const [summary, setSummary] = useState('');
  const [continuity, setContinuity] = useState(x.continuityPlan ?? '');
  const params = { projectId, tsaServiceId: x.id };
  const v = x.version;
  const done = async (msg: string) => {
    await refresh();
    toast.show('success', msg);
    onClose();
  };
  const common = { open: true, onClose, expectedVersion: v };
  switch (cmd) {
    case 'edit':
      return (
        <RdCommandDialog
          {...common}
          title={t('readiness.tsaDetail.edit.title')}
          confirmLabel={t('readiness.common.save')}
          noteMode="none"
          confirmDisabled={!form.name.trim()}
          consequences={[t('readiness.tsaDetail.edit.effect'), t('common.command.audited')]}
          onConfirm={async () => {
            const r = await api(readinessRoutes.updateTsaService, { params, body: { expectedVersion: v, name: form.name.trim(), ...tsaBody(form, x) } });
            await done(r.version === v ? t('readiness.common.noChanges') : t('readiness.common.saved'));
          }}
        >
          <TsaFields form={form} onChange={setForm} datesLocked={!['proposed', 'negotiating'].includes(x.status)} chargeRedacted={x.chargeRedacted} />
        </RdCommandDialog>
      );
    case 'transition':
      return (
        <RdCommandDialog
          {...common}
          title={t('readiness.tsaDetail.transition.title')}
          confirmLabel={t('readiness.tsaDetail.transition.confirm')}
          noteMode={command === 'record_breach' || command === 'remedy_breach' ? 'required' : 'optional'}
          confirmDisabled={!command}
          consequences={[t('readiness.tsaDetail.transition.effect'), t('common.command.audited')]}
          onConfirm={async ({ note }) => {
            const r = await api(readinessRoutes.transitionTsaService, { params, body: { expectedVersion: v, command: command as TsaSimpleCommand, ...(note ? { note } : {}) } });
            await done(t('readiness.tsaDetail.transition.done', { status: tStatus('tsaStatuses', r.status) }));
          }}
        >
          <SelectField label={t('readiness.tsaDetail.transition.command')} required value={command} onChange={(e) => setCommand(e.target.value as TsaSimpleCommand)} data-testid="tsa-command">
            {simple.map((c) => (
              <option key={c} value={c}>
                {t(`readiness.tsaDetail.transition.commands.${c}`)}
              </option>
            ))}
          </SelectField>
        </RdCommandDialog>
      );
    case 'approve':
      return (
        <RdCommandDialog
          {...common}
          title={t('readiness.tsaDetail.approve.title')}
          confirmLabel={t('readiness.tsaDetail.approve.confirm')}
          confirmDisabled={!decisionId}
          consequences={[t('readiness.tsaDetail.approve.effect'), t('common.command.audited')]}
          onConfirm={async ({ note }) => {
            await api(readinessRoutes.approveTsaTerms, { params, body: { expectedVersion: v, decisionId, ...(note ? { note } : {}) } });
            await done(t('readiness.tsaDetail.approve.done'));
          }}
        >
          <DecisionSelect typeKeys={TSA_DECISION_TYPE_KEYS} value={decisionId} onChange={setDecisionId} open />
        </RdCommandDialog>
      );
    case 'acceptReplacement':
      return (
        <RdCommandDialog
          {...common}
          title={t('readiness.tsaDetail.acceptReplacement.title')}
          confirmLabel={t('readiness.tsaDetail.acceptReplacement.confirm')}
          noteMode="required"
          noteLabel={t('readiness.common.reason')}
          consequences={[t('readiness.tsaDetail.acceptReplacement.effect'), t('common.command.audited')]}
          onConfirm={async ({ note }) => {
            await api(readinessRoutes.acceptTsaReplacement, { params, body: { expectedVersion: v, note } });
            await done(t('readiness.tsaDetail.acceptReplacement.done'));
          }}
        />
      );
    case 'failure':
      return (
        <RdCommandDialog
          {...common}
          title={t('readiness.tsaDetail.failure.title')}
          confirmLabel={t('readiness.tsaDetail.failure.confirm')}
          noteMode="none"
          danger
          confirmDisabled={!summary.trim() || !continuity.trim() || !date}
          consequences={[t('readiness.tsaDetail.failure.effect'), t('common.command.audited')]}
          onConfirm={async () => {
            await api(readinessRoutes.reportTsaReplacementFailure, { params, body: { expectedVersion: v, failureSummary: summary.trim(), continuityPlan: continuity.trim(), decisionDeadline: date } });
            await done(t('readiness.tsaDetail.failure.done'));
          }}
        >
          <TextAreaField label={t('readiness.tsaDetail.failure.summary')} required value={summary} maxLength={4000} onChange={(e) => setSummary(e.target.value)} data-testid="failure-summary" />
          <TextAreaField label={t('readiness.tsaDetail.failure.continuity')} required value={continuity} maxLength={8000} onChange={(e) => setContinuity(e.target.value)} data-testid="failure-continuity" />
          <TextField label={t('readiness.tsaDetail.failure.deadline')} required type="date" value={date} onChange={(e) => setDate(e.target.value)} data-testid="failure-deadline" />
        </RdCommandDialog>
      );
    case 'requestExtension':
      return (
        <RdCommandDialog
          {...common}
          title={t('readiness.tsaDetail.requestExtension.title')}
          confirmLabel={t('readiness.tsaDetail.requestExtension.confirm')}
          confirmDisabled={!decisionId || !date || !continuity.trim()}
          consequences={[t('readiness.tsaDetail.requestExtension.effect'), t('common.command.audited')]}
          onConfirm={async ({ note }) => {
            await api(readinessRoutes.requestTsaExtension, { params, body: { expectedVersion: v, decisionId, proposedEndDate: date, continuityPlan: continuity.trim(), ...(note ? { note } : {}) } });
            await done(t('readiness.tsaDetail.requestExtension.done'));
          }}
        >
          <DecisionSelect typeKeys={TSA_DECISION_TYPE_KEYS} value={decisionId} onChange={setDecisionId} open />
          <TextField label={t('readiness.tsaDetail.requestExtension.proposedEnd')} required type="date" value={date} onChange={(e) => setDate(e.target.value)} data-testid="extension-end" />
          <TextAreaField label={t('readiness.tsaDetail.requestExtension.continuity')} required value={continuity} maxLength={8000} onChange={(e) => setContinuity(e.target.value)} data-testid="extension-continuity" />
        </RdCommandDialog>
      );
    case 'recordExtension':
      return (
        <RdCommandDialog
          {...common}
          title={t('readiness.tsaDetail.recordExtension.title')}
          confirmLabel={t('readiness.tsaDetail.recordExtension.confirm')}
          consequences={[t('readiness.tsaDetail.recordExtension.effect'), t('common.command.audited')]}
          onConfirm={async ({ note }) => {
            await api(readinessRoutes.recordTsaExtension, { params, body: { expectedVersion: v, ...(note ? { note } : {}) } });
            await done(t('readiness.tsaDetail.recordExtension.done'));
          }}
        />
      );
    case 'requestExit':
      return (
        <RdCommandDialog
          {...common}
          title={t('readiness.tsaDetail.requestExit.title')}
          confirmLabel={t('readiness.tsaDetail.requestExit.confirm')}
          consequences={[t('readiness.tsaDetail.requestExit.effect'), t('common.command.audited')]}
          onConfirm={async ({ note }) => {
            await api(readinessRoutes.requestTsaExitApproval, { params, body: { expectedVersion: v, ...(note ? { note } : {}) } });
            await done(t('readiness.tsaDetail.requestExit.done'));
          }}
        />
      );
    case 'approveExit':
      return (
        <RdCommandDialog
          {...common}
          title={t('readiness.tsaDetail.approveExit.title')}
          confirmLabel={t('readiness.tsaDetail.approveExit.confirm')}
          consequences={[t('readiness.tsaDetail.approveExit.effect'), t('readiness.tsaDetail.approveExit.sod'), t('common.command.audited')]}
          onConfirm={async ({ note }) => {
            await api(readinessRoutes.approveTsaExit, { params, body: { expectedVersion: v, ...(note ? { note } : {}) } });
            await done(t('readiness.tsaDetail.approveExit.done'));
          }}
        />
      );
    case 'rejectExit':
      return (
        <RdCommandDialog
          {...common}
          title={t('readiness.tsaDetail.rejectExit.title')}
          confirmLabel={t('readiness.tsaDetail.rejectExit.confirm')}
          noteMode="required"
          noteLabel={t('readiness.common.reason')}
          danger
          consequences={[t('readiness.tsaDetail.rejectExit.effect'), t('common.command.audited')]}
          onConfirm={async ({ note }) => {
            await api(readinessRoutes.rejectTsaExit, { params, body: { expectedVersion: v, note } });
            await done(t('readiness.tsaDetail.rejectExit.done'));
          }}
        />
      );
    default:
      return null;
  }
}

export default function TsaServicePage() {
  const { tsaServiceId } = useParams<{ tsaServiceId: string }>();
  const { t, tStatus, formatDate, formatDateTime } = useI18n();
  const { projectId, can, me } = useProjectContext();
  const { wsName } = useScopeLabels();
  const [cmd, setCmd] = useState<Cmd>(null);
  const q = useQuery({ queryKey: rk.tsa(projectId, tsaServiceId), queryFn: ({ signal }) => api(readinessRoutes.getTsaService, { params: { projectId, tsaServiceId }, signal }) });
  const base = rdHref(projectId);
  if (q.isLoading) return <LoadingState />;
  if (q.error) return isApiError(q.error) && (q.error.status === 404 || q.error.status === 403) ? <RestrictedState /> : <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const x = q.data!;
  const st = x.status;
  const manage = can('readiness.tsa.manage');
  const approver = can('readiness.tsa.approve_exit');
  const simple = x.allowedCommands.filter((c) => (TSA_SIMPLE_COMMANDS as readonly string[]).includes(c));
  const pendingExit = x.exitApprovalStatus === 'pending';
  const independent = x.exitApprovalRequestedBy !== me.user.id && x.ownerUserId !== me.user.id && x.replacementAcceptedBy !== me.user.id;
  const buttons: ReactNode[] = [];
  const add = (show: boolean, key: Exclude<Cmd, null>, label: string, variant: 'primary' | 'secondary' | 'danger' = 'secondary') => {
    if (show) buttons.push(<CmdButton key={key} label={label} onClick={() => setCmd(key)} testId={`cmd-${key}`} variant={variant} />);
  };
  add(approver && pendingExit && independent, 'approveExit', t('readiness.tsaDetail.approveExit.action'), 'primary');
  add(approver && pendingExit && independent, 'rejectExit', t('readiness.tsaDetail.rejectExit.action'), 'danger');
  add(manage && st === 'negotiating', 'approve', t('readiness.tsaDetail.approve.action'), 'primary');
  add(manage && simple.length > 0, 'transition', t('readiness.tsaDetail.transition.action'));
  add(manage && REPLACEMENT_STATUSES.includes(st) && !x.replacementAccepted, 'acceptReplacement', t('readiness.tsaDetail.acceptReplacement.action'));
  add(manage && FAILURE_STATUSES.includes(st), 'failure', t('readiness.tsaDetail.failure.action'), 'danger');
  add(manage && EXTENSION_STATUSES.includes(st), 'requestExtension', t('readiness.tsaDetail.requestExtension.action'));
  add(manage && !!x.proposedEndDate, 'recordExtension', t('readiness.tsaDetail.recordExtension.action'));
  add(manage && EXIT_STATUSES.includes(st) && x.replacementAccepted && !pendingExit, 'requestExit', t('readiness.tsaDetail.requestExit.action'), 'primary');
  add(manage && st !== 'exit_accepted', 'edit', t('readiness.common.edit'));
  return (
    <>
      <PageHeader
        eyebrow={
          <Link href={`${base}/tsa`} className="inline-flex items-center gap-1 hover:underline">
            <ChevronLeft aria-hidden="true" className="size-4 rtl:rotate-180" />
            {t('readiness.tsa.title')}
          </Link>
        }
        title={
          <span>
            <span dir="ltr">{x.code}</span> — <span dir="auto">{x.name}</span>
          </span>
        }
        documentTitle={`${x.code} — ${x.name}`}
        badges={
          <>
            <StatusBadge enumName="tsaStatuses" value={x.status} size="md" />
            <ExpiryBadge expiry={x.expiry} />
            {x.isDemo ? <DemoBadge /> : null}
          </>
        }
      />
      <div className="space-y-6" data-testid="tsa-detail" data-status={x.status}>
        <Callout tone={st === 'expired_unresolved' || st === 'breached' ? 'danger' : 'info'} testId="end-not-exit">
          {t('readiness.tsaDetail.endNotExit')}
        </Callout>
        <Panel title={t('readiness.common.commands')} testId="tsa-commands" actions={<ButtonRow>{buttons}</ButtonRow>}>
          <p className="text-sm text-muted">{buttons.length === 0 ? t('readiness.common.noCommands') : t('readiness.tsaDetail.approveExit.sod')}</p>
        </Panel>
        <div className="grid gap-6 lg:grid-cols-2">
          <Panel title={t('readiness.tsaDetail.escalation.title')} testId="tsa-escalation">
            {x.escalation ? (
              <div className="space-y-2 text-sm">
                <p className="flex flex-wrap items-center gap-2">
                  <Link className={btn.link} href={`/projects/${projectId}/committee/escalations?sourceId=${x.id}`} dir="ltr">
                    {x.escalation.code}
                  </Link>
                  <StatusBadge enumName="escalationStatuses" value={x.escalation.status} />
                </p>
                <p dir="auto" className="whitespace-pre-wrap">
                  {x.escalation.requestedAction}
                </p>
                <Facts
                  items={[
                    { label: t('readiness.tsaDetail.escalation.target'), value: <UText value={x.escalation.target} />, wide: true },
                    { label: t('readiness.tsaDetail.escalation.deadline'), value: <span className="tabular">{formatDate(x.escalation.decisionDeadline)}</span> },
                  ]}
                />
                <div>
                  <p className="font-semibold">{t('readiness.tsaDetail.escalation.options')}</p>
                  <ol className="list-decimal space-y-0.5 ps-5">
                    {x.escalation.options.map((o, i) => {
                      // The three standard options are generated by the server in English; show them translated.
                      const std = STANDARD_OPTION[o.title];
                      const impact = std ? t(`readiness.tsaDetail.escalation.std.${std}.impact`) : o.impact;
                      return (
                        <li key={i}>
                          <span dir="auto" className="font-medium">
                            {std ? t(`readiness.tsaDetail.escalation.std.${std}.title`) : o.title}
                          </span>
                          {impact ? (
                            <>
                              {' — '}
                              <span dir="auto">{impact}</span>
                            </>
                          ) : null}
                        </li>
                      );
                    })}
                  </ol>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted">{x.escalationId ? t('readiness.tsaDetail.escalation.hidden') : t('readiness.tsaDetail.escalation.none')}</p>
            )}
          </Panel>
          <Panel title={t('readiness.tsaDetail.replacement.title')} testId="tsa-replacement">
            <Facts
              items={[
                { label: t('readiness.tsaDetail.replacement.service'), value: <UText value={x.replacementService} /> },
                { label: t('readiness.tsaDetail.replacement.due'), value: <span className="tabular">{formatDate(x.replacementDueDate)}</span> },
                { label: t('readiness.tsaDetail.replacement.plan'), value: <UText value={x.replacementPlan} multiline />, wide: true },
                {
                  label: t('readiness.tsaDetail.replacement.acceptance'),
                  value: x.replacementAccepted ? (
                    <span className="text-success">
                      {t('readiness.tsaDetail.replacement.accepted')} · <span className="tabular">{formatDateTime(x.replacementAcceptedAt)}</span> · <Person id={x.replacementAcceptedBy} people={x.people} />
                    </span>
                  ) : (
                    <span className="text-muted">{t('readiness.tsaDetail.replacement.notAccepted')}</span>
                  ),
                  wide: true,
                  testId: 'replacement-state',
                },
                {
                  label: t('readiness.tsaDetail.replacement.failed'),
                  value: x.replacementFailedAt ? (
                    <span>
                      <span className="tabular">{formatDateTime(x.replacementFailedAt)}</span> · <UText value={x.replacementFailureNote} />
                    </span>
                  ) : (
                    EM_DASH
                  ),
                  wide: true,
                },
                { label: t('readiness.tsaDetail.replacement.continuity'), value: <UText value={x.continuityPlan} multiline />, wide: true },
              ]}
            />
          </Panel>
          <Panel title={t('readiness.tsaDetail.extension.title')} testId="tsa-extension">
            {x.extensionDecisionId || x.proposedEndDate ? (
              <Facts
                items={[
                  {
                    label: t('readiness.tsaDetail.extension.decision'),
                    value: x.extensionDecision ? (
                      <span className="flex flex-wrap items-center gap-2">
                        <Link className={btn.link} href={`/projects/${projectId}/committee/decisions/${x.extensionDecision.id}`} dir="ltr">
                          {x.extensionDecision.code}
                        </Link>
                        <StatusBadge enumName="decisionStatuses" value={x.extensionDecision.status} />
                        <DecisionIssue d={x.extensionDecision} okKey="readiness.tsaDetail.extension.ok" />
                      </span>
                    ) : (
                      EM_DASH
                    ),
                    wide: true,
                    testId: 'extension-decision',
                  },
                  { label: t('readiness.tsaDetail.extension.proposedEnd'), value: <span className="tabular">{formatDate(x.proposedEndDate)}</span> },
                  {
                    label: t('readiness.tsaDetail.extension.requested'),
                    value: x.extensionRequestedAt ? (
                      <span>
                        <span className="tabular">{formatDateTime(x.extensionRequestedAt)}</span> · <Person id={x.extensionRequestedBy} people={x.people} />
                      </span>
                    ) : (
                      EM_DASH
                    ),
                  },
                ]}
              />
            ) : (
              <p className="text-sm text-muted">{t('readiness.tsaDetail.extension.none')}</p>
            )}
          </Panel>
          <Panel title={t('readiness.tsaDetail.exit.title')} testId="tsa-exit">
            {x.exitApprovalRequestId ? (
              <Facts
                items={[
                  { label: t('readiness.tsaDetail.exit.status'), value: x.exitApprovalStatus ? <StatusBadge enumName="approvalRequestStatuses" value={x.exitApprovalStatus} /> : EM_DASH },
                  { label: t('readiness.tsaDetail.exit.requestedBy'), value: <Person id={x.exitApprovalRequestedBy} people={x.people} /> },
                  {
                    label: t('readiness.tsaDetail.exit.approved'),
                    value: x.exitApprovedAt ? (
                      <span data-testid="exit-approved">
                        <span className="tabular">{formatDateTime(x.exitApprovedAt)}</span> · <Person id={x.exitApprovedBy} people={x.people} />
                      </span>
                    ) : (
                      EM_DASH
                    ),
                    wide: true,
                  },
                ]}
              />
            ) : (
              <p className="text-sm text-muted">{t('readiness.tsaDetail.exit.none')}</p>
            )}
          </Panel>
        </div>
        <Panel title={t('readiness.common.details')}>
          <Facts
            items={[
              { label: t('readiness.tsaDetail.facts.type'), value: x.isEnduringArrangement ? t('readiness.tsa.enduring') : t('readiness.tsa.transitional') },
              { label: t('readiness.tsaDetail.facts.owner'), value: <Person id={x.ownerUserId} people={x.people} /> },
              { label: t('readiness.tsaDetail.facts.workstream'), value: x.workstreamId ? wsName(x.workstreamId) : EM_DASH },
              { label: t('readiness.tsaDetail.facts.classification'), value: tStatus('classifications', x.classification) },
              {
                label: t('readiness.tsaDetail.facts.dates'),
                value: (
                  <span className="tabular" data-testid="tsa-dates">
                    {formatDate(x.startDate)} – {formatDate(x.endDate)}
                  </span>
                ),
              },
              { label: t('readiness.tsaDetail.facts.approvalDecision'), value: x.approvalDecisionId ? <Link className={btn.link} href={`/projects/${projectId}/committee/decisions/${x.approvalDecisionId}`}>{t('readiness.tsaDetail.facts.openDecision')}</Link> : EM_DASH },
              { label: t('readiness.tsaDetail.facts.scope'), value: <UText value={x.scope} multiline />, wide: true },
              { label: t('readiness.tsaDetail.facts.dependent'), value: <UText value={x.dependentServices} multiline />, wide: true },
              { label: t('readiness.tsaDetail.facts.sla'), value: <UText value={x.sla} /> },
              { label: t('readiness.tsaDetail.facts.metric'), value: <UText value={x.metricMethod} /> },
              { label: t('readiness.tsaDetail.facts.chargeBasis'), value: x.chargeRedacted ? <span className="text-muted">{t('readiness.tsaDetail.chargeRedacted')}</span> : <UText value={x.chargeBasis} /> },
              { label: t('readiness.tsaDetail.facts.charge'), value: x.chargeRedacted ? <span className="text-muted">{t('readiness.tsaDetail.chargeRedacted')}</span> : <Money value={x.charge} /> },
              { label: t('readiness.tsaDetail.facts.extensionTerms'), value: <UText value={x.extensionTerms} multiline />, wide: true },
              { label: t('readiness.tsaDetail.facts.terminationTerms'), value: <UText value={x.terminationTerms} multiline />, wide: true },
              { label: t('readiness.tsaDetail.facts.residualRisks'), value: <UText value={x.residualRisks} multiline />, wide: true },
            ]}
          />
          <h3 className="mt-4 text-sm font-semibold text-ink">{t('readiness.tsaDetail.milestones')}</h3>
          {x.exitMilestones.length ? (
            <ul className="mt-1 list-disc space-y-0.5 ps-5 text-sm" data-testid="tsa-milestones">
              {x.exitMilestones.map((m, i) => (
                <li key={i}>
                  <span dir="auto">{m.title}</span>
                  {m.dueDate ? <span className="tabular text-muted"> · {formatDate(m.dueDate)}</span> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-sm text-muted">{t('readiness.tsaDetail.milestonesEmpty')}</p>
          )}
        </Panel>
        <EvidencePanel targetType="tsa_service" targetId={x.id} title={t('readiness.tsaDetail.evidenceTitle')} />
        <ActivityHistory projectId={projectId} entityType="tsa_service" entityId={x.id} />
      </div>
      {cmd ? <TsaDialogs key={`${cmd}-${x.version}`} x={x} cmd={cmd} onClose={() => setCmd(null)} /> : null}
    </>
  );
}
