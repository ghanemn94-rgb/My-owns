'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { aiRoutes } from '@hub/contracts';
import { ActivityHistory } from '@/components/ActivityHistory';
import { DemoBadge } from '@/components/DemoBadge';
import { ErrorState } from '@/components/ErrorState';
import { TextAreaField, TextField } from '@/components/Field';
import { LoadingState } from '@/components/LoadingState';
import { PageHeader } from '@/components/PageHeader';
import { RestrictedState } from '@/components/RestrictedState';
import { StatusBadge } from '@/components/StatusBadge';
import { useToast } from '@/components/Toast';
import { btn } from '@/components/ui';
import { EM_DASH, useI18n, type MessageKey } from '@/i18n/provider';
import { api } from '@/lib/api';
import { aiHref, citationHref, REVISABLE_FIELDS, underlyingPermission, useAiProposal, useAiRefresh, useAiStatus, useMemberNames, type AiProposal, type People } from '@/lib/ai';
import { useProjectContext } from '@/lib/project-context';
import { Callout, CitationLinks, Code, Facts, Panel, Person, SimulatedBadge, UText } from '../../_components/bits';
import { AiCommandDialog } from '../../_components/dialogs';
import { TabGuard } from '../../_components/nav';

type Dialog = 'approve' | 'reject' | 'revise' | null;
type Field = 'title' | 'body' | 'content' | 'description' | 'dueDate';

export default function AiProposalDetailPage() {
  return (
    <TabGuard tab="proposals">
      <ProposalDetail />
    </TabGuard>
  );
}

function ProposalDetail() {
  const { t, tStatus, formatDateTime, formatNumber } = useI18n();
  const { projectId, project, me, can } = useProjectContext();
  const { proposalId } = useParams<{ proposalId: string }>();
  const q = useAiProposal(proposalId);
  const status = useAiStatus();
  const people = useMemberNames();
  const refresh = useAiRefresh();
  const toast = useToast();
  const [dialog, setDialog] = useState<Dialog>(null);

  if (q.isLoading) return <LoadingState />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <RestrictedState />;
  const p = q.data;
  const myId = me.user.id;
  const perm = underlyingPermission(p.actionType);
  const mode = status.data?.mode ?? null;
  const killSwitch = status.data?.killSwitch ?? null;
  const isRequester = !!p.requestedBy && p.requestedBy === myId;
  const shortHash = p.payloadHash.slice(0, 12);
  const targetHref = p.targetType && p.targetId ? citationHref(projectId, { type: p.targetType, id: p.targetId }) : null;
  const targetLabel = p.targetType ? t(`ai.citationTypes.${p.targetType}` as MessageKey) : null;

  // ---- which commands to offer: mirrors the server's rules (the server still decides) ----
  let approveBlock: { reason: string; values?: Record<string, string> } | null = null;
  if (!can('ai.proposal.approve')) approveBlock = { reason: 'noPermission' };
  else if (!perm) approveBlock = { reason: 'notExecutable' };
  else if (isRequester) approveBlock = { reason: 'selfApproval' };
  else if (!can(perm)) approveBlock = { reason: 'noAuthority', values: { permission: perm } };
  else if (p.status !== 'proposed') approveBlock = { reason: 'notPending', values: { status: tStatus('aiProposalStatuses', p.status) } };
  else if (killSwitch === true) approveBlock = { reason: 'killSwitch' };
  else if (mode !== null && mode !== 'assisted' && mode !== 'autopilot') approveBlock = { reason: 'mode', values: { mode: tStatus('aiModes', mode) } };
  const canReject = can('ai.proposal.reject') && (p.status === 'proposed' || p.status === 'approved');
  const revisable = (REVISABLE_FIELDS as Record<string, readonly Field[] | undefined>)[p.actionType];
  const canRevise = can('ai.assistant.use') && isRequester && !!revisable && ['proposed', 'approved', 'invalidated'].includes(p.status);

  const done = async (message: string) => {
    setDialog(null);
    toast.show('success', message);
    await refresh();
  };
  const reload = async () => {
    setDialog(null);
    await refresh();
  };

  return (
    <>
      <PageHeader
        title={t(`ai.actions.${p.actionType}` as MessageKey)}
        eyebrow={
          <Link className={btn.link} href={aiHref(projectId, '/proposals')}>
            {t('ai.proposal.back')}
          </Link>
        }
        badges={
          <>
            <span data-testid="proposal-status" data-status={p.status}>
              <StatusBadge enumName="aiProposalStatuses" value={p.status} size="md" />
            </span>
            {p.simulated ? <SimulatedBadge /> : null}
            {project.isDemo ? <DemoBadge /> : null}
          </>
        }
      />
      <div className="space-y-6" data-testid="proposal-detail" data-version={p.version}>
        {p.simulated ? (
          <Callout tone="warning" testId="proposal-simulated">
            <p>{t('ai.proposal.simulatedNote')}</p>
          </Callout>
        ) : null}

        <Panel title={t('ai.proposal.bindingTitle')} testId="proposal-binding">
          <Facts
            items={[
              { label: t('ai.proposal.versionShown'), value: <span data-testid="binding-version">{t('ai.common.versionShort', { version: formatNumber(p.version) })}</span> },
              { label: t('ai.proposal.payloadHash'), value: <Code title={p.payloadHash}>{shortHash}</Code> },
              {
                label: t('ai.proposal.target'),
                value: p.targetType ? (
                  <span className="flex flex-wrap items-center gap-2">
                    {targetHref ? (
                      <Link className={btn.link} href={targetHref} data-testid="proposal-target-link">
                        {targetLabel}
                      </Link>
                    ) : (
                      <span>{targetLabel}</span>
                    )}
                    {p.targetVersion !== null ? <span className="text-xs text-muted">{t('ai.common.versionShort', { version: formatNumber(p.targetVersion) })}</span> : null}
                  </span>
                ) : (
                  <span className="text-muted">{t('ai.proposals.noTarget')}</span>
                ),
              },
              { label: t('ai.proposal.policyVersion'), value: <Code>{p.policyVersion}</Code> },
            ]}
          />
          <p className="mt-3 text-sm text-ink" data-testid="binding-explainer">
            {t('ai.proposal.bindingExplainer', { version: formatNumber(p.version), hash: shortHash })}
          </p>
        </Panel>

        <Panel title={t('ai.proposal.changeTitle')} testId="proposal-change">
          <PayloadView p={p} people={people} />
        </Panel>

        <Panel title={t('ai.proposal.whyTitle')} testId="proposal-why">
          <div className="space-y-3">
            <div>
              <h3 className="text-sm font-semibold text-ink">{t('ai.proposal.rationale')}</h3>
              <p className="text-sm text-ink">{p.rationale ? <UText value={p.rationale} multiline /> : <span className="text-muted">{t('ai.proposal.noRationale')}</span>}</p>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-ink">{t('ai.answer.sources')}</h3>
              <CitationLinks citations={p.citations} testId="proposal-sources" />
            </div>
            <Facts
              items={[
                { label: t('ai.proposals.requestedBy'), value: <Person id={p.requestedBy} people={people} />, testId: 'proposal-requester' },
                {
                  label: t('ai.proposal.run'),
                  value: p.runId && isRequester ? (
                    <Link className={btn.link} href={aiHref(projectId, `/runs/${p.runId}`)}>
                      <Code>{p.runId}</Code>
                    </Link>
                  ) : p.runId ? (
                    <Code>{p.runId}</Code>
                  ) : (
                    EM_DASH
                  ),
                },
                { label: t('ai.proposals.created'), value: formatDateTime(p.createdAt) },
                { label: t('ai.proposal.underlying'), value: perm ? <Code>{perm}</Code> : <span className="text-muted">{t('ai.proposal.noUnderlying')}</span> },
              ]}
            />
          </div>
        </Panel>

        <Panel title={t('ai.proposal.reviewTitle')} testId="proposal-actions" description={t('ai.proposal.sodNote')}>
          <div className="space-y-3">
            {killSwitch ? (
              <Callout tone="danger" icon="stop" testId="proposal-kill-switch">
                <p>{t('ai.proposals.killSwitch')}</p>
              </Callout>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {!approveBlock ? (
                <button type="button" className={btn.primary} onClick={() => setDialog('approve')} data-testid="cmd-approve">
                  {t('ai.proposal.approve')}
                </button>
              ) : null}
              {canReject ? (
                <button type="button" className={btn.danger} onClick={() => setDialog('reject')} data-testid="cmd-reject">
                  {t('ai.proposal.reject')}
                </button>
              ) : null}
              {canRevise ? (
                <button type="button" className={btn.secondary} onClick={() => setDialog('revise')} data-testid="cmd-revise">
                  {t('ai.proposal.revise')}
                </button>
              ) : null}
            </div>
            {approveBlock ? (
              <p className="text-sm text-muted" data-testid="approve-unavailable" data-reason={approveBlock.reason}>
                {t(`ai.proposal.approveBlocked.${approveBlock.reason}` as MessageKey, approveBlock.values)}
              </p>
            ) : null}
            {p.invalidatedReason ? (
              <p className="text-sm text-ink" data-testid="proposal-reason">
                <span className="text-muted">{t('ai.proposal.reasonLabel')} </span>
                <ReasonText reason={p.invalidatedReason} />
              </p>
            ) : null}
          </div>
        </Panel>

        <Panel title={t('ai.proposal.approvalsTitle')} testId="proposal-approvals">
          {p.approvals.length === 0 ? (
            <p className="text-sm text-muted">{t('ai.proposal.noApprovals')}</p>
          ) : (
            <ul className="space-y-2">
              {p.approvals.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center gap-2 text-sm" data-testid="approval-row" data-status={a.status}>
                  <Person id={a.approverUserId} people={people} />
                  <StatusBadge enumName="aiModes" value={a.status} tone={a.status === 'valid' || a.status === 'consumed' ? 'success' : 'danger'} label={t(`ai.approvalStatuses.${a.status}` as MessageKey)} />
                  <span className="text-xs text-muted">{t('ai.proposal.approvalLine', { at: formatDateTime(a.createdAt), expires: formatDateTime(a.expiresAt), version: a.targetVersion === null ? EM_DASH : formatNumber(a.targetVersion) })}</span>
                  {a.invalidatedReason ? (
                    <span className="text-xs text-danger">
                      <ReasonText reason={a.invalidatedReason} />
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {p.executionResult || p.executedAt ? (
          <Panel title={t('ai.proposal.executionTitle')} testId="proposal-execution">
            <ExecutionView result={p.executionResult} executedAt={p.executedAt} />
          </Panel>
        ) : null}

        <ActivityHistory projectId={projectId} entityType="ai_proposal" entityId={p.id} />
      </div>

      <AiCommandDialog
        open={dialog === 'approve'}
        onClose={() => setDialog(null)}
        title={t('ai.proposal.approveTitle')}
        confirmLabel={t('ai.proposal.approveConfirm', { version: formatNumber(p.version) })}
        consequences={[
          t('ai.proposal.approveC1', { version: formatNumber(p.version), hash: shortHash }),
          p.targetType ? t('ai.proposal.approveC2', { target: targetLabel ?? '', version: p.targetVersion === null ? EM_DASH : formatNumber(p.targetVersion) }) : t('ai.proposal.approveC2none'),
          t('ai.proposal.approveC3'),
          t('ai.proposal.approveC4'),
        ]}
        basedOn={t('ai.proposal.boundTo', { version: formatNumber(p.version) })}
        errorContext="proposal"
        onReload={reload}
        testId="approve-dialog"
        onConfirm={async ({ reason }) => {
          await api(aiRoutes.approveProposal, { params: { projectId, proposalId: p.id }, body: { expectedVersion: p.version, ...(reason ? { note: reason } : {}) } });
          await done(t('ai.proposal.approved'));
        }}
      />
      <AiCommandDialog
        open={dialog === 'reject'}
        onClose={() => setDialog(null)}
        title={t('ai.proposal.rejectTitle')}
        confirmLabel={t('ai.proposal.reject')}
        danger
        reasonMode="required"
        consequences={[t('ai.proposal.rejectC1'), t('ai.proposal.rejectC2')]}
        basedOn={t('ai.proposal.boundTo', { version: formatNumber(p.version) })}
        errorContext="proposal"
        onReload={reload}
        testId="reject-dialog"
        onConfirm={async ({ reason }) => {
          await api(aiRoutes.rejectProposal, { params: { projectId, proposalId: p.id }, body: { expectedVersion: p.version, note: reason } });
          await done(t('ai.proposal.rejected'));
        }}
      />
      {canRevise && revisable ? <ReviseDialog open={dialog === 'revise'} onClose={() => setDialog(null)} p={p} fields={revisable} onDone={() => done(t('ai.proposal.revised'))} onReload={reload} /> : null}
    </>
  );
}

function ReasonText({ reason }: { reason: string }) {
  const { t } = useI18n();
  const [code, ...rest] = reason.split(':');
  const key = `ai.reasons.${code!.trim()}` as MessageKey;
  const text = t(key);
  if (text === key) return <UText value={reason} />;
  const extra = rest.join(':').trim();
  return (
    <span>
      {text}
      {extra ? (
        <>
          {' — '}
          <UText value={extra} />
        </>
      ) : null}
    </span>
  );
}

/** The proposed change, field by field (payload exactly as stored; the hash above binds it). */
function PayloadView({ p, people }: { p: AiProposal; people: People }) {
  const { t, formatDate } = useI18n();
  const payload = p.payload as Record<string, unknown>;
  const str = (k: string) => (typeof payload[k] === 'string' ? (payload[k] as string) : null);
  const items: { label: string; value: ReactNode; wide?: boolean; testId?: string }[] = [];
  if (str('recipientUserId')) items.push({ label: t('ai.payload.recipient'), value: <Person id={str('recipientUserId')} people={people} />, testId: 'payload-recipient' });
  if (str('channel')) items.push({ label: t('ai.payload.channel'), value: t(`ai.payload.channels.${str('channel')}` as MessageKey) });
  if (str('title')) items.push({ label: t('ai.payload.title'), value: <UText value={str('title')} />, wide: true, testId: 'payload-title' });
  if (str('body')) items.push({ label: t('ai.payload.body'), value: <UText value={str('body')} multiline />, wide: true, testId: 'payload-body' });
  if (str('content')) items.push({ label: t('ai.payload.content'), value: <UText value={str('content')} multiline />, wide: true, testId: 'payload-content' });
  if (str('description')) items.push({ label: t('ai.payload.description'), value: <UText value={str('description')} multiline />, wide: true });
  if (str('dueDate')) items.push({ label: t('ai.payload.dueDate'), value: formatDate(str('dueDate')) });
  if (typeof payload.probability === 'number') items.push({ label: t('ai.payload.probability'), value: String(payload.probability) });
  if (typeof payload.impact === 'number') items.push({ label: t('ai.payload.impact'), value: String(payload.impact) });
  if (items.length === 0) return <p className="text-sm text-muted">{t('ai.payload.empty')}</p>;
  return (
    <div className="space-y-3">
      <Facts items={items} testId="proposal-payload" />
      {str('channel') && str('channel') !== 'in_app' ? <p className="text-xs text-muted">{t('ai.payload.externalDisabled')}</p> : null}
    </div>
  );
}

function ExecutionView({ result, executedAt }: { result: Record<string, unknown> | null; executedAt: string | null }) {
  const { t, formatDateTime } = useI18n();
  const r = result ?? {};
  const items: { label: string; value: ReactNode; wide?: boolean }[] = [{ label: t('ai.execution.at'), value: formatDateTime(executedAt) }];
  if (typeof r.mode === 'string') items.push({ label: t('ai.execution.mode'), value: t(`ai.execution.modes.${r.mode}` as MessageKey) });
  if ('notificationId' in r) items.push({ label: t('ai.execution.notification'), value: r.notificationId ? t('ai.execution.notificationCreated') : t('ai.execution.notificationDeduplicated') });
  if (r.externalChannel && typeof r.externalChannel === 'object') items.push({ label: t('ai.execution.external'), value: t('ai.execution.externalDisabled') });
  if (typeof r.artifactId === 'string') items.push({ label: t('ai.execution.artifact'), value: <Code>{r.artifactId}</Code> });
  return <Facts items={items} testId="execution-facts" />;
}

function ReviseDialog({ open, onClose, p, fields, onDone, onReload }: { open: boolean; onClose: () => void; p: AiProposal; fields: readonly Field[]; onDone: () => Promise<void>; onReload: () => void }) {
  const { t, formatNumber } = useI18n();
  const { projectId } = useProjectContext();
  const payload = p.payload as Record<string, unknown>;
  const initial = Object.fromEntries(fields.map((f) => [f, typeof payload[f] === 'string' ? (payload[f] as string) : ''])) as Record<Field, string>;
  const [values, setValues] = useState<Record<Field, string>>(initial);
  const [lastOpen, setLastOpen] = useState(false);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) setValues(initial);
  }
  const titleMissing = fields.includes('title') && values.title.trim() === '';
  const contentMissing = fields.includes('content') && values.content.trim() === '';
  return (
    <AiCommandDialog
      open={open}
      onClose={onClose}
      title={t('ai.proposal.reviseTitle')}
      confirmLabel={t('ai.proposal.reviseConfirm')}
      consequences={[t('ai.proposal.reviseC1'), t('ai.proposal.reviseC2'), t('ai.proposal.reviseC3')]}
      basedOn={t('ai.proposal.boundTo', { version: formatNumber(p.version) })}
      errorContext="proposal"
      onReload={onReload}
      confirmDisabled={titleMissing || contentMissing}
      testId="revise-dialog"
      onConfirm={async ({ reason }) => {
        const { action: _a, ...rest } = payload;
        void _a;
        const next: Record<string, unknown> = { ...rest };
        for (const f of fields) {
          const v = values[f].trim();
          if (v) next[f] = v;
          else delete next[f];
        }
        await api(aiRoutes.reviseProposal, { params: { projectId, proposalId: p.id }, body: { expectedVersion: p.version, payload: next, ...(reason ? { note: reason } : {}) } });
        await onDone();
      }}
    >
      <div className="space-y-3">
        {fields.map((f) =>
          f === 'body' || f === 'content' || f === 'description' ? (
            <TextAreaField key={f} label={t(`ai.payload.${f}`)} required={f === 'content'} value={values[f]} maxLength={f === 'body' ? 500 : f === 'content' ? 8000 : 2000} onChange={(e) => setValues((v) => ({ ...v, [f]: e.target.value }))} data-testid={`revise-${f}`} />
          ) : (
            <TextField key={f} label={t(`ai.payload.${f}`)} required={f === 'title'} type={f === 'dueDate' ? 'date' : 'text'} value={values[f]} maxLength={200} onChange={(e) => setValues((v) => ({ ...v, [f]: e.target.value }))} data-testid={`revise-${f}`} />
          ),
        )}
      </div>
    </AiCommandDialog>
  );
}
