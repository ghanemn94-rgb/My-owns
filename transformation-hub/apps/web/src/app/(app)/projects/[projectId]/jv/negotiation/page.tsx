'use client';

import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { jvRoutes } from '@hub/contracts';
import { NEGOTIATION_ISSUE_STATUSES, type Classification } from '@hub/domain';
import { DataTable, type Column } from '@/components/DataTable';
import { DemoBadge } from '@/components/DemoBadge';
import { SelectField, TextAreaField, TextField } from '@/components/Field';
import { PageHeader } from '@/components/PageHeader';
import { SearchInput } from '@/components/SearchInput';
import { StatusBadge } from '@/components/StatusBadge';
import { useToast } from '@/components/Toast';
import { btn } from '@/components/ui';
import { EM_DASH, useI18n } from '@/i18n/provider';
import { api } from '@/lib/api';
import { assignableClassifications } from '@/lib/documents';
import { useIssues, useJvRefresh, usePartnerNames, type NegotiationIssue } from '@/lib/jv';
import { useProjectContext } from '@/lib/project-context';
import { ButtonRow, CmdButton, DecisionSelect, DocumentLink, FilterBar, FilterSelect, JvCommandDialog, LinkedDecision, UText, useUrlState } from '../_components/jv';

const PAGE_SIZE = 25;
const FILTERS = ['q', 'status', 'partnerId'] as const;
type IssueCommand = 'propose_resolution' | 'agree' | 'escalate' | 'close' | 'reopen';
const ISSUE_COMMANDS: readonly IssueCommand[] = ['propose_resolution', 'agree', 'escalate', 'close', 'reopen'];

function CreateIssueDialog({ onClose }: { onClose: () => void }) {
  const { t, tStatus } = useI18n();
  const { projectId, me } = useProjectContext();
  const refresh = useJvRefresh();
  const toast = useToast();
  const partners = usePartnerNames();
  const options = assignableClassifications(me.user.clearance as Classification);
  const [issue, setIssue] = useState('');
  const [partnerId, setPartnerId] = useState('');
  const [positions, setPositions] = useState<{ party: string; position: string }[]>([{ party: '', position: '' }]);
  const [alternatives, setAlternatives] = useState('');
  const [requiredApproval, setRequiredApproval] = useState('');
  const [requiresApproval, setRequiresApproval] = useState(false);
  const [decisionId, setDecisionId] = useState('');
  const [documentRef, setDocumentRef] = useState('');
  const [classification, setClassification] = useState<Classification>(options.includes('confidential') ? 'confidential' : options[options.length - 1]!);
  return (
    <JvCommandDialog
      open
      onClose={onClose}
      title={t('jv.negotiation.create.title')}
      confirmLabel={t('jv.negotiation.create.confirm')}
      noteMode="none"
      confirmDisabled={!issue.trim() || (requiresApproval && !decisionId)}
      consequences={[t('jv.negotiation.create.effect'), t('jv.negotiation.approvalRule'), t('common.command.audited')]}
      onConfirm={async () => {
        const r = await api(jvRoutes.createNegotiationIssue, {
          params: { projectId },
          body: {
            issue: issue.trim(),
            classification,
            requiresApproval,
            positions: positions.filter((p) => p.party.trim() && p.position.trim()).map((p) => ({ party: p.party.trim(), position: p.position.trim() })),
            ...(partnerId ? { partnerId } : {}),
            ...(alternatives.trim() ? { alternatives: alternatives.trim() } : {}),
            ...(requiredApproval.trim() ? { requiredApproval: requiredApproval.trim() } : {}),
            ...(decisionId ? { decisionId } : {}),
            ...(documentRef.trim() ? { documentRef: documentRef.trim() } : {}),
          },
        });
        await refresh();
        toast.show('success', t('jv.negotiation.create.done', { code: r.code ?? '' }));
        onClose();
      }}
    >
      <TextAreaField label={t('jv.negotiation.fields.issue')} required value={issue} maxLength={4000} onChange={(e) => setIssue(e.target.value)} data-testid="issue-text" />
      <SelectField label={t('jv.common.partner')} value={partnerId} onChange={(e) => setPartnerId(e.target.value)}>
        <option value="">{t('jv.common.none')}</option>
        {partners.items.map((p) => (
          <option key={p.id} value={p.id}>
            {p.code} — {p.name}
          </option>
        ))}
      </SelectField>
      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold text-ink">{t('jv.negotiation.fields.positions')}</legend>
        {positions.map((p, i) => (
          <div key={i} className="grid gap-2 rounded-md border border-line p-3 sm:grid-cols-[12rem_1fr_auto] sm:items-end">
            <TextField label={t('jv.negotiation.fields.party')} value={p.party} maxLength={200} onChange={(e) => setPositions((xs) => xs.map((x, j) => (j === i ? { ...x, party: e.target.value } : x)))} />
            <TextField label={t('jv.negotiation.fields.position')} value={p.position} maxLength={4000} onChange={(e) => setPositions((xs) => xs.map((x, j) => (j === i ? { ...x, position: e.target.value } : x)))} />
            <button type="button" className={btn.ghost} onClick={() => setPositions((xs) => xs.filter((_, j) => j !== i))} aria-label={t('jv.scenarios.removeLine', { n: i + 1 })}>
              <Trash2 aria-hidden="true" className="size-4" />
            </button>
          </div>
        ))}
        <button type="button" className={btn.secondary} onClick={() => setPositions((xs) => [...xs, { party: '', position: '' }])}>
          <Plus aria-hidden="true" className="size-4" />
          {t('jv.negotiation.fields.addPosition')}
        </button>
      </fieldset>
      <TextAreaField label={t('jv.negotiation.fields.alternatives')} value={alternatives} maxLength={4000} onChange={(e) => setAlternatives(e.target.value)} />
      <TextField label={t('jv.negotiation.fields.requiredApproval')} value={requiredApproval} maxLength={1000} onChange={(e) => setRequiredApproval(e.target.value)} />
      <label className="inline-flex items-center gap-2 text-sm">
        <input type="checkbox" checked={requiresApproval} onChange={(e) => setRequiresApproval(e.target.checked)} data-testid="issue-requires-approval" />
        {t('jv.negotiation.fields.requiresApproval')}
      </label>
      <DecisionSelect typeKeys={null} value={decisionId} onChange={setDecisionId} required={requiresApproval} testId="issue-decision" />
      <TextField label={t('jv.negotiation.fields.documentRef')} value={documentRef} maxLength={500} onChange={(e) => setDocumentRef(e.target.value)} />
      <SelectField label={t('jv.common.classification')} required value={classification} onChange={(e) => setClassification(e.target.value as Classification)}>
        {options.map((c) => (
          <option key={c} value={c}>
            {tStatus('classifications', c)}
          </option>
        ))}
      </SelectField>
    </JvCommandDialog>
  );
}

function TransitionDialog({ issue, command, onClose }: { issue: NegotiationIssue; command: IssueCommand; onClose: () => void }) {
  const { t, tStatus } = useI18n();
  const { projectId } = useProjectContext();
  const refresh = useJvRefresh();
  const toast = useToast();
  return (
    <JvCommandDialog
      open
      onClose={onClose}
      title={t(`jv.negotiation.cmd.${command}`)}
      confirmLabel={t(`jv.negotiation.cmd.${command}`)}
      expectedVersion={issue.version}
      consequences={[t(`jv.negotiation.effect.${command}`), ...(command === 'agree' || command === 'close' ? [t('jv.negotiation.approvalRule')] : []), t('common.command.audited')]}
      onConfirm={async ({ note }) => {
        const r = await api(jvRoutes.transitionNegotiationIssue, { params: { projectId, issueId: issue.id }, body: { expectedVersion: issue.version, command, ...(note ? { note } : {}) } });
        await refresh();
        toast.show('success', t('jv.common.statusNow', { status: tStatus('negotiationIssueStatuses', r.status) }));
        onClose();
      }}
    />
  );
}

/** Terms & negotiation issues (REQ-JV-008): parties' positions, alternatives, required approval and linked decision. */
export default function NegotiationPage() {
  const { t, tStatus, formatDateTime } = useI18n();
  const { can } = useProjectContext();
  const { values, page, set, clear, active } = useUrlState(FILTERS);
  const partners = usePartnerNames();
  const [createOpen, setCreateOpen] = useState(false);
  const [pending, setPending] = useState<{ issue: NegotiationIssue; command: IssueCommand } | null>(null);
  const list = useIssues({ page, pageSize: PAGE_SIZE, q: values.q || undefined, status: (values.status || undefined) as NegotiationIssue['status'] | undefined, partnerId: values.partnerId || undefined });
  const canManage = can('jv.negotiation.manage');
  const columns: Column<NegotiationIssue>[] = [
    {
      key: 'code',
      header: t('jv.negotiation.columns.code'),
      isRowHeader: true,
      sortValue: (i) => i.code,
      cell: (i) => (
        <span className="flex flex-wrap items-center gap-1">
          <span dir="ltr" className="font-medium">
            {i.code}
          </span>
          {i.isDemo ? <DemoBadge /> : null}
        </span>
      ),
    },
    {
      key: 'issue',
      header: t('jv.negotiation.fields.issue'),
      cell: (i) => (
        <span className="flex flex-col gap-1">
          <UText value={i.issue} multiline />
          {i.partnerId ? <span className="text-xs text-muted" dir="auto">{partners.label(i.partnerId)}</span> : null}
        </span>
      ),
    },
    {
      key: 'positions',
      header: t('jv.negotiation.fields.positions'),
      cell: (i) =>
        i.positions.length === 0 ? (
          EM_DASH
        ) : (
          <ul className="space-y-1 text-xs">
            {i.positions.map((p, k) => (
              <li key={k}>
                <span dir="auto" className="font-semibold">
                  {p.party}
                </span>
                : <span dir="auto">{p.position}</span>
              </li>
            ))}
          </ul>
        ),
    },
    { key: 'alternatives', header: t('jv.negotiation.fields.alternatives'), cell: (i) => <UText value={i.alternatives} multiline /> },
    {
      key: 'approval',
      header: t('jv.negotiation.fields.approval'),
      cell: (i) => (
        <span className="flex flex-col gap-1 text-xs">
          <span>{i.requiresApproval ? t('jv.negotiation.requiresApproval') : t('jv.negotiation.noApprovalNeeded')}</span>
          {i.requiredApproval ? <UText value={i.requiredApproval} /> : null}
          {i.decisionId ? <LinkedDecision d={i.decision} testId="issue-decision-link" /> : null}
        </span>
      ),
    },
    {
      key: 'doc',
      header: t('jv.negotiation.fields.document'),
      cell: (i) => (
        <span className="flex flex-col gap-0.5 text-xs">
          {i.documentId ? <DocumentLink id={i.documentId} /> : null}
          <UText value={i.documentRef} />
        </span>
      ),
    },
    {
      key: 'status',
      header: t('jv.common.status'),
      sortValue: (i) => i.status,
      cell: (i) => (
        <span className="flex flex-col items-start gap-1">
          <StatusBadge enumName="negotiationIssueStatuses" value={i.status} />
          <span className="text-xs text-muted">{formatDateTime(i.updatedAt)}</span>
        </span>
      ),
    },
    {
      key: 'cmd',
      header: t('jv.common.commands'),
      cell: (i) =>
        canManage && i.allowedCommands.length ? (
          <ButtonRow>
            {ISSUE_COMMANDS.filter((c) => i.allowedCommands.includes(c)).map((c) => (
              <CmdButton key={c} label={t(`jv.negotiation.cmd.${c}`)} onClick={() => setPending({ issue: i, command: c })} testId={`cmd-issue-${c}`} />
            ))}
          </ButtonRow>
        ) : (
          <span className="text-muted">{EM_DASH}</span>
        ),
    },
  ];
  return (
    <>
      <PageHeader
        title={t('jv.negotiation.title')}
        description={t('jv.negotiation.subtitle')}
        actions={
          canManage ? (
            <button type="button" className={btn.primary} onClick={() => setCreateOpen(true)} data-testid="create-issue">
              <Plus aria-hidden="true" className="size-4" />
              {t('jv.negotiation.create.action')}
            </button>
          ) : null
        }
      />
      <FilterBar onClear={clear} active={active}>
        <SearchInput className="w-full sm:w-64" label={t('jv.negotiation.search')} value={values.q} onChange={(v) => set({ q: v })} />
        <FilterSelect label={t('jv.common.status')} value={values.status} onChange={(v) => set({ status: v })} options={NEGOTIATION_ISSUE_STATUSES.map((s) => ({ value: s, label: tStatus('negotiationIssueStatuses', s) }))} />
        <FilterSelect label={t('jv.common.partner')} value={values.partnerId} onChange={(v) => set({ partnerId: v })} options={partners.items.map((p) => ({ value: p.id, label: `${p.code} — ${p.name}` }))} />
      </FilterBar>
      <DataTable
        caption={t('jv.negotiation.title')}
        columns={columns}
        rows={list.data?.items}
        rowKey={(i) => i.id}
        isLoading={list.isLoading}
        error={list.error}
        onRetry={() => list.refetch()}
        emptyTitle={active ? t('jv.common.emptySearch') : t('jv.negotiation.empty')}
        pagination={list.data ? { page, pageSize: PAGE_SIZE, total: list.data.total, onPageChange: (p) => set({ page: p }) } : undefined}
        testId="issues-table"
      />
      {createOpen ? <CreateIssueDialog onClose={() => setCreateOpen(false)} /> : null}
      {pending ? <TransitionDialog key={`${pending.issue.id}-${pending.command}`} issue={pending.issue} command={pending.command} onClose={() => setPending(null)} /> : null}
    </>
  );
}
