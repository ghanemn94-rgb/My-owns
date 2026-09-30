'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Plus, TriangleAlert } from 'lucide-react';
import { jvRoutes } from '@hub/contracts';
import { POST_CLOSE_KINDS, POST_CLOSE_STATUSES } from '@hub/domain';
import { ActivityHistory } from '@/components/ActivityHistory';
import { DataTable, type Column } from '@/components/DataTable';
import { DemoBadge } from '@/components/DemoBadge';
import { EvidencePanel } from '@/components/EvidencePanel';
import { SelectField, TextAreaField, TextField } from '@/components/Field';
import { PageHeader } from '@/components/PageHeader';
import { SearchInput } from '@/components/SearchInput';
import { StatusBadge } from '@/components/StatusBadge';
import { useToast } from '@/components/Toast';
import { btn, cx } from '@/components/ui';
import { UserPicker, type PickedUser } from '@/components/UserPicker';
import { EM_DASH, useI18n } from '@/i18n/provider';
import { api } from '@/lib/api';
import { jk, jvHref, useEvents, useJvRefresh, useMemberNames, useObligations, type Obligation, type People } from '@/lib/jv';
import { useProjectContext } from '@/lib/project-context';
import { ButtonRow, Callout, CmdButton, Facts, FilterBar, FilterSelect, JvCommandDialog, Panel, Person, UText, useUrlState } from '../_components/jv';

const PAGE_SIZE = 25;
const FILTERS = ['q', 'status', 'kind', 'selected'] as const;
type ObligationCommand = 'start' | 'report_complete' | 'cancel';

function CreateObligationDialog({ onClose }: { onClose: () => void }) {
  const { t, tStatus } = useI18n();
  const { projectId } = useProjectContext();
  const refresh = useJvRefresh();
  const toast = useToast();
  const closings = useEvents('closing', { page: 1, pageSize: 100 });
  const [kind, setKind] = useState<(typeof POST_CLOSE_KINDS)[number]>('condition_subsequent');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [party, setParty] = useState('');
  const [owner, setOwner] = useState<PickedUser | null>(null);
  const [dueDate, setDueDate] = useState('');
  const [closingId, setClosingId] = useState('');
  return (
    <JvCommandDialog
      open
      onClose={onClose}
      title={t('jv.obligations.create.title')}
      confirmLabel={t('jv.obligations.create.confirm')}
      noteMode="none"
      confirmDisabled={!title.trim()}
      consequences={[t('jv.obligations.create.effect'), t('jv.obligations.overdueRule'), t('common.command.audited')]}
      onConfirm={async () => {
        const r = await api(jvRoutes.createObligation, {
          params: { projectId },
          body: {
            kind,
            title: title.trim(),
            ...(description.trim() ? { description: description.trim() } : {}),
            ...(party.trim() ? { responsibleParty: party.trim() } : {}),
            ...(owner ? { ownerUserId: owner.id } : {}),
            ...(dueDate ? { dueDate } : {}),
            ...(closingId ? { closingId } : {}),
          },
        });
        await refresh();
        toast.show('success', t('jv.obligations.create.done', { code: r.code ?? '' }));
        onClose();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField label={t('jv.obligations.fields.kind')} required value={kind} onChange={(e) => setKind(e.target.value as (typeof POST_CLOSE_KINDS)[number])}>
          {POST_CLOSE_KINDS.map((k) => (
            <option key={k} value={k}>
              {tStatus('postCloseKinds', k)}
            </option>
          ))}
        </SelectField>
        <SelectField label={t('jv.obligations.fields.closing')} value={closingId} onChange={(e) => setClosingId(e.target.value)}>
          <option value="">{t('jv.common.none')}</option>
          {(closings.data?.items ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.code} — {c.name}
            </option>
          ))}
        </SelectField>
        <TextField className="sm:col-span-2" label={t('jv.obligations.fields.title')} required value={title} maxLength={300} onChange={(e) => setTitle(e.target.value)} data-testid="obligation-title" />
        <TextAreaField className="sm:col-span-2" label={t('jv.obligations.fields.description')} value={description} maxLength={4000} onChange={(e) => setDescription(e.target.value)} />
        <TextField label={t('jv.obligations.fields.party')} value={party} maxLength={200} onChange={(e) => setParty(e.target.value)} />
        <TextField label={t('jv.obligations.fields.dueDate')} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        <div className="sm:col-span-2">
          <UserPicker label={t('jv.obligations.fields.owner')} value={owner} onChange={setOwner} />
        </div>
      </div>
    </JvCommandDialog>
  );
}

function OverdueBadge({ o }: { o: Obligation }) {
  const { t, formatNumber } = useI18n();
  if (!o.overdue && o.status !== 'overdue') return null;
  return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold text-danger" data-testid="obligation-overdue">
      <TriangleAlert aria-hidden="true" className="size-3.5" />
      {o.escalationId ? t('jv.obligations.overdueEscalated', { days: formatNumber(o.daysOverdue) }) : t('jv.obligations.overdueDays', { days: formatNumber(o.daysOverdue) })}
    </span>
  );
}

function ObligationPanel({ o, people, onClose }: { o: Obligation; people: People | undefined; onClose: () => void }) {
  const { t, tStatus, formatDate, formatDateTime } = useI18n();
  const { projectId, can, me } = useProjectContext();
  const refresh = useJvRefresh();
  const toast = useToast();
  const [pending, setPending] = useState<ObligationCommand | 'verify' | null>(null);
  const [outcome, setOutcome] = useState<'verify' | 'reject_completion'>('verify');
  const canManage = can('jv.closing_checklist.manage');
  const transitions = canManage ? (['start', 'report_complete', 'cancel'] as const).filter((c) => o.allowedCommands.includes(c)) : [];
  const sod = o.ownerUserId === me.user.id || o.completionReportedBy === me.user.id;
  const canVerify = can('jv.cp.verify') && o.status === 'completed_pending_evidence' && !sod;
  return (
    <Panel
      title={t('jv.obligations.detailTitle', { code: o.code })}
      testId="obligation-detail"
      actions={
        <ButtonRow>
          {transitions.map((c) => (
            <CmdButton key={c} label={t(`jv.obligations.cmd.${c}`)} onClick={() => setPending(c)} testId={`cmd-obligation-${c}`} />
          ))}
          {canVerify ? <CmdButton label={t('jv.obligations.cmd.verify')} onClick={() => setPending('verify')} testId="cmd-obligation-verify" variant="primary" /> : null}
          <button type="button" className={btn.ghost} onClick={onClose}>
            {t('jv.obligations.closePanel')}
          </button>
        </ButtonRow>
      }
    >
      <div className="space-y-4" data-status={o.status}>
        <p className="text-base font-semibold text-ink" dir="auto">
          {o.title}
        </p>
        <OverdueBadge o={o} />
        {sod && o.status === 'completed_pending_evidence' && can('jv.cp.verify') ? <p className="text-sm text-muted">{t('jv.obligations.sodNote')}</p> : null}
        <Facts
          items={[
            { label: t('jv.obligations.fields.kind'), value: tStatus('postCloseKinds', o.kind) },
            { label: t('jv.common.status'), value: <StatusBadge enumName="postCloseStatuses" value={o.status} /> },
            { label: t('jv.obligations.fields.owner'), value: <Person id={o.ownerUserId} people={people} /> },
            { label: t('jv.obligations.fields.party'), value: <UText value={o.responsibleParty} /> },
            { label: t('jv.obligations.fields.dueDate'), value: <span className="tabular">{formatDate(o.dueDate)}</span> },
            { label: t('jv.obligations.fields.overdueSince'), value: <span className="tabular">{formatDate(o.overdueSince)}</span> },
            { label: t('jv.obligations.fields.reportedBy'), value: <Person id={o.completionReportedBy} people={people} /> },
            { label: t('jv.obligations.fields.verifiedBy'), value: o.verifiedBy ? <span><Person id={o.verifiedBy} people={people} /> · <span className="tabular">{formatDateTime(o.verifiedAt)}</span></span> : EM_DASH },
            { label: t('jv.obligations.fields.description'), value: <UText value={o.description} multiline />, wide: true },
            { label: t('jv.common.note'), value: <UText value={o.statusNote} />, wide: true },
          ]}
        />
        {o.closingId ? (
          <p className="text-sm">
            <Link className={btn.link} href={`${jvHref(projectId)}/closing/closings/${o.closingId}`}>
              {t('jv.obligations.openClosing')}
            </Link>
          </p>
        ) : null}
        <EvidencePanel targetType="post_close_obligation" targetId={o.id} title={t('jv.obligations.evidenceTitle')} />
        <ActivityHistory projectId={projectId} entityType="post_close_obligation" entityId={o.id} />
      </div>
      {pending && pending !== 'verify' ? (
        <JvCommandDialog
          open
          onClose={() => setPending(null)}
          title={t(`jv.obligations.cmd.${pending}`)}
          confirmLabel={t(`jv.obligations.cmd.${pending}`)}
          danger={pending === 'cancel'}
          noteMode={pending === 'cancel' ? 'required' : 'optional'}
          noteLabel={pending === 'cancel' ? t('jv.common.reason') : undefined}
          expectedVersion={o.version}
          consequences={[t(`jv.obligations.effect.${pending}`), t('common.command.audited')]}
          onConfirm={async ({ note }) => {
            const r = await api(jvRoutes.transitionObligation, { params: { projectId, obligationId: o.id }, body: { expectedVersion: o.version, command: pending, ...(note ? { note } : {}) } });
            await refresh();
            toast.show('success', t('jv.common.statusNow', { status: tStatus('postCloseStatuses', r.status) }));
            setPending(null);
          }}
        />
      ) : null}
      {pending === 'verify' ? (
        <JvCommandDialog
          open
          onClose={() => setPending(null)}
          title={t('jv.obligations.cmd.verify')}
          confirmLabel={outcome === 'verify' ? t('jv.obligations.cmd.verify') : t('jv.obligations.cmd.rejectCompletion')}
          danger={outcome === 'reject_completion'}
          expectedVersion={o.version}
          consequences={[outcome === 'verify' ? t('jv.obligations.effect.verify') : t('jv.obligations.effect.reject_completion'), t('jv.obligations.sodRule'), t('common.command.audited')]}
          onConfirm={async ({ note }) => {
            const r = await api(jvRoutes.verifyObligation, { params: { projectId, obligationId: o.id }, body: { expectedVersion: o.version, outcome, ...(note ? { note } : {}) } });
            await refresh();
            toast.show('success', t('jv.common.statusNow', { status: tStatus('postCloseStatuses', r.status) }));
            setPending(null);
          }}
        >
          <SelectField label={t('jv.common.outcome')} required value={outcome} onChange={(e) => setOutcome(e.target.value as typeof outcome)}>
            <option value="verify">{t('jv.obligations.cmd.verify')}</option>
            <option value="reject_completion">{t('jv.obligations.cmd.rejectCompletion')}</option>
          </SelectField>
        </JvCommandDialog>
      ) : null}
    </Panel>
  );
}

function ProgramClosurePanel() {
  const { t, tStatus, formatDateTime } = useI18n();
  const { projectId, can, me } = useProjectContext();
  const refresh = useJvRefresh();
  const toast = useToast();
  const [pending, setPending] = useState<'request' | 'confirm' | null>(null);
  const [outcome, setOutcome] = useState<'confirm' | 'reject'>('confirm');
  const members = useMemberNames();
  const q = useQuery({ queryKey: jk.programClosure(projectId), queryFn: ({ signal }) => api(jvRoutes.getProgramClosure, { params: { projectId }, signal }) });
  const pc = q.data;
  const closure = pc?.closure ?? null;
  const canRequest = can('jv.closing_checklist.manage') && !!pc?.g7Passed && (!closure || closure.status === 'rejected');
  const canConfirm = can('portfolio.project.archive') && closure?.status === 'requested' && closure.requestedBy !== me.user.id;
  return (
    <Panel
      title={t('jv.programClosure.title')}
      description={t('jv.programClosure.hint')}
      testId="program-closure"
      actions={
        <ButtonRow>
          {canRequest ? <CmdButton label={t('jv.programClosure.request')} onClick={() => setPending('request')} testId="cmd-request-program-closure" /> : null}
          {canConfirm ? <CmdButton label={t('jv.programClosure.decide')} onClick={() => setPending('confirm')} testId="cmd-confirm-program-closure" variant="primary" /> : null}
        </ButtonRow>
      }
    >
      {pc ? (
        <Facts
          items={[
            { label: t('jv.programClosure.g7'), value: pc.g7.status ? <StatusBadge enumName="gateAssessmentStatuses" value={pc.g7.status} /> : t('jv.programClosure.g7NotAssessed'), testId: 'g7-status' },
            { label: t('jv.programClosure.allowed'), value: pc.g7Passed ? t('jv.programClosure.allowedYes') : t('jv.programClosure.allowedNo') },
            { label: t('jv.common.status'), value: closure ? <StatusBadge enumName="programClosureStatuses" value={closure.status} /> : t('jv.programClosure.none') },
            { label: t('jv.common.requestedBy'), value: closure ? <span><Person id={closure.requestedBy} people={members} /> · <span className="tabular">{formatDateTime(closure.requestedAt)}</span></span> : EM_DASH },
            { label: t('jv.programClosure.handover'), value: <UText value={closure?.handoverNote} multiline />, wide: true },
          ]}
        />
      ) : null}
      {pending === 'request' ? (
        <JvCommandDialog
          open
          onClose={() => setPending(null)}
          title={t('jv.programClosure.request')}
          confirmLabel={t('jv.programClosure.request')}
          noteMode="required"
          noteLabel={t('jv.programClosure.handover')}
          consequences={[t('jv.programClosure.requestEffect'), t('common.command.audited')]}
          onConfirm={async ({ note }) => {
            await api(jvRoutes.requestProgramClosure, { params: { projectId }, body: { handoverNote: note } });
            await refresh();
            toast.show('success', t('jv.common.saved'));
            setPending(null);
          }}
        />
      ) : null}
      {pending === 'confirm' && closure ? (
        <JvCommandDialog
          open
          onClose={() => setPending(null)}
          title={t('jv.programClosure.decide')}
          confirmLabel={outcome === 'confirm' ? t('jv.programClosure.confirm') : t('jv.programClosure.reject')}
          danger={outcome === 'reject'}
          expectedVersion={closure.version}
          consequences={[t('jv.programClosure.confirmEffect'), t('common.command.audited')]}
          onConfirm={async ({ note }) => {
            await api(jvRoutes.confirmProgramClosure, { params: { projectId }, body: { expectedVersion: closure.version, outcome, ...(note ? { note } : {}) } });
            await refresh();
            toast.show('success', t('jv.common.statusNow', { status: tStatus('programClosureStatuses', outcome === 'confirm' ? 'confirmed' : 'rejected') }));
            setPending(null);
          }}
        >
          <SelectField label={t('jv.common.outcome')} required value={outcome} onChange={(e) => setOutcome(e.target.value as typeof outcome)}>
            <option value="confirm">{t('jv.programClosure.confirm')}</option>
            <option value="reject">{t('jv.programClosure.reject')}</option>
          </SelectField>
        </JvCommandDialog>
      ) : null}
    </Panel>
  );
}

/** Conditions subsequent and post-close obligations (REQ-JV-016): overdue in the project timezone, escalated, verified with evidence. */
export default function ObligationsPage() {
  const { t, tStatus, formatDate, formatNumber } = useI18n();
  const { can } = useProjectContext();
  const { values, page, set, active } = useUrlState(FILTERS);
  const [createOpen, setCreateOpen] = useState(false);
  const list = useObligations({
    page,
    pageSize: PAGE_SIZE,
    q: values.q || undefined,
    status: (values.status || undefined) as Obligation['status'] | undefined,
    kind: (values.kind || undefined) as Obligation['kind'] | undefined,
  });
  const people = list.data?.people;
  const selected = list.data?.items.find((o) => o.id === values.selected) ?? null;
  const filterActive = active && !!(values.q || values.status || values.kind);
  const columns: Column<Obligation>[] = [
    {
      key: 'code',
      header: t('jv.obligations.columns.code'),
      isRowHeader: true,
      sortValue: (o) => o.code,
      cell: (o) => (
        <span className="flex flex-wrap items-center gap-1">
          <button type="button" className={cx(btn.link, 'text-start')} onClick={() => set({ selected: o.id, page })} aria-pressed={values.selected === o.id} data-testid="obligation-open">
            <span dir="ltr">{o.code}</span>
          </button>
          {o.isDemo ? <DemoBadge /> : null}
        </span>
      ),
    },
    {
      key: 'title',
      header: t('jv.obligations.fields.title'),
      cell: (o) => (
        <span className="flex flex-col gap-0.5">
          <span dir="auto">{o.title}</span>
          <span className="text-xs text-muted">{tStatus('postCloseKinds', o.kind)}</span>
        </span>
      ),
    },
    { key: 'owner', header: t('jv.obligations.fields.owner'), cell: (o) => <Person id={o.ownerUserId} people={people} /> },
    { key: 'due', header: t('jv.obligations.fields.dueDate'), sortValue: (o) => o.dueDate, cell: (o) => <span className="tabular">{formatDate(o.dueDate)}</span> },
    {
      key: 'status',
      header: t('jv.common.status'),
      sortValue: (o) => o.status,
      cell: (o) => (
        <span className="flex flex-col items-start gap-1">
          <StatusBadge enumName="postCloseStatuses" value={o.status} />
          <OverdueBadge o={o} />
        </span>
      ),
    },
    { key: 'evidence', header: t('jv.cp.fields.evidence'), cell: (o) => <span className="tabular text-xs">{t('jv.cp.evidenceCount', { active: formatNumber(o.evidence.active), conflicting: formatNumber(o.evidence.conflicting) })}</span> },
  ];
  return (
    <>
      <PageHeader
        title={t('jv.obligations.title')}
        description={t('jv.obligations.subtitle')}
        actions={
          can('jv.closing_checklist.manage') ? (
            <button type="button" className={btn.primary} onClick={() => setCreateOpen(true)} data-testid="create-obligation">
              <Plus aria-hidden="true" className="size-4" />
              {t('jv.obligations.create.action')}
            </button>
          ) : null
        }
      />
      <div className="space-y-4">
        <Callout testId="overdue-rule">{t('jv.obligations.overdueRule')}</Callout>
        <FilterBar onClear={() => set({ q: null, status: null, kind: null })} active={filterActive}>
          <SearchInput className="w-full sm:w-64" label={t('jv.obligations.search')} value={values.q} onChange={(v) => set({ q: v })} />
          <FilterSelect label={t('jv.common.status')} value={values.status} onChange={(v) => set({ status: v })} options={POST_CLOSE_STATUSES.map((s) => ({ value: s, label: tStatus('postCloseStatuses', s) }))} testId="filter-obligation-status" />
          <FilterSelect label={t('jv.obligations.fields.kind')} value={values.kind} onChange={(v) => set({ kind: v })} options={POST_CLOSE_KINDS.map((k) => ({ value: k, label: tStatus('postCloseKinds', k) }))} />
        </FilterBar>
        <DataTable
          caption={t('jv.obligations.title')}
          columns={columns}
          rows={list.data?.items}
          rowKey={(o) => o.id}
          isLoading={list.isLoading}
          error={list.error}
          onRetry={() => list.refetch()}
          emptyTitle={filterActive ? t('jv.common.emptySearch') : t('jv.obligations.empty')}
          pagination={list.data ? { page, pageSize: PAGE_SIZE, total: list.data.total, onPageChange: (p) => set({ page: p }) } : undefined}
          testId="obligations-table"
        />
        {selected ? <ObligationPanel key={`${selected.id}-${selected.version}`} o={selected} people={people} onClose={() => set({ selected: null, page })} /> : null}
        <ProgramClosurePanel />
      </div>
      {createOpen ? <CreateObligationDialog onClose={() => setCreateOpen(false)} /> : null}
    </>
  );
}
