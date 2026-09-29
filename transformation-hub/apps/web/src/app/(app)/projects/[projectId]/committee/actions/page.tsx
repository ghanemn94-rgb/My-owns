'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { governanceRoutes } from '@hub/contracts';
import { ACTION_ITEM_STATUSES } from '@hub/domain';
import { DataTable, type Column } from '@/components/DataTable';
import { DemoBadge } from '@/components/DemoBadge';
import { TextField } from '@/components/Field';
import { PageHeader } from '@/components/PageHeader';
import { SearchInput } from '@/components/SearchInput';
import { StatusBadge } from '@/components/StatusBadge';
import { useToast } from '@/components/Toast';
import { UserPicker, type PickedUser } from '@/components/UserPicker';
import { btn, cx } from '@/components/ui';
import { EM_DASH, useI18n, type MessageKey } from '@/i18n/provider';
import { api } from '@/lib/api';
import { useProjectContext } from '@/lib/project-context';
import { CreateActionDialog } from '../_components/dialogs';
import { FilterBar, FilterSelect, GovCommandDialog, UText, gk, hubHref, useGovRefresh, useUrlState, type ActionItem } from '../_components/gov';

const PAGE_SIZE = 20;
const FILTERS = ['q', 'status', 'overdue', 'mine', 'decisionId', 'meetingId'] as const;
type Status = (typeof ACTION_ITEM_STATUSES)[number];
type Cmd = 'start' | 'reportDone' | 'verify' | 'reject' | 'cancel' | 'edit';

export default function ActionsPage() {
  const { t, tStatus, formatDate } = useI18n();
  const { projectId, can, me } = useProjectContext();
  const refresh = useGovRefresh();
  const toast = useToast();
  const { values, page, set, clear, active } = useUrlState(FILTERS);
  const [createOpen, setCreateOpen] = useState(false);
  const [target, setTarget] = useState<{ a: ActionItem; cmd: Cmd } | null>(null);
  const [owner, setOwner] = useState<PickedUser | null>(null);
  const [due, setDue] = useState('');
  const base = hubHref(projectId);

  const query = {
    page,
    pageSize: PAGE_SIZE,
    q: values.q || undefined,
    status: (values.status || undefined) as Status | undefined,
    overdue: values.overdue === 'true' ? ('true' as const) : undefined,
    ownerUserId: values.mine === 'true' ? me.user.id : undefined,
    decisionId: values.decisionId || undefined,
    meetingId: values.meetingId || undefined,
  };
  const list = useQuery({
    queryKey: gk.actions(projectId, query),
    queryFn: ({ signal }) => api(governanceRoutes.listActions, { params: { projectId }, query, signal }),
    enabled: can('governance.decision.read'),
    placeholderData: (prev) => prev,
  });

  const commandsFor = (a: ActionItem): { cmd: Cmd; label: string }[] => {
    const out: { cmd: Cmd; label: string }[] = [];
    const isOwner = a.ownerUserId === me.user.id;
    const openish = a.status === 'open' || a.status === 'in_progress';
    if (isOwner && can('governance.action.update') && a.status === 'open') out.push({ cmd: 'start', label: t('governance.actions.cmd.start.label') });
    if (isOwner && can('governance.action.update') && openish) out.push({ cmd: 'reportDone', label: t('governance.actions.cmd.reportDone.label') });
    if (can('governance.action.verify_closure') && a.status === 'done_pending_verification') {
      out.push({ cmd: 'verify', label: t('governance.actions.cmd.verify.label') });
      out.push({ cmd: 'reject', label: t('governance.actions.cmd.reject.label') });
    }
    if (can('governance.action.manage') && openish) {
      out.push({ cmd: 'edit', label: t('governance.actions.cmd.edit.label') });
      out.push({ cmd: 'cancel', label: t('governance.actions.cmd.cancel.label') });
    }
    return out;
  };

  const columns: Column<ActionItem>[] = [
    {
      key: 'code',
      header: t('governance.actions.columns.code'),
      isRowHeader: true,
      sortValue: (a) => a.code,
      cell: (a) => (
        <span className="flex flex-wrap items-center gap-1">
          <span dir="ltr" className="font-medium">
            {a.code}
          </span>
          {a.isDemo ? <DemoBadge /> : null}
        </span>
      ),
    },
    {
      key: 'title',
      header: t('governance.actions.columns.title'),
      sortValue: (a) => a.title,
      cell: (a) => (
        <span className="flex flex-col gap-1">
          <UText value={a.title} />
          {a.closureEvidenceNote ? (
            <span className="text-xs text-muted">
              {t('governance.actions.evidence')}: <span dir="auto">{a.closureEvidenceNote}</span>
            </span>
          ) : null}
        </span>
      ),
    },
    { key: 'owner', header: t('governance.actions.columns.owner'), sortValue: (a) => a.ownerName ?? '', cell: (a) => <UText value={a.ownerName} /> },
    {
      key: 'due',
      header: t('governance.actions.columns.dueDate'),
      sortValue: (a) => a.dueDate ?? '',
      cell: (a) => (
        <span className="flex flex-wrap items-center gap-1">
          <span className="tabular">{formatDate(a.dueDate)}</span>
          {a.overdue ? <StatusBadge enumName="actionItemStatuses" value="overdue" tone="danger" label={t('governance.actions.overdue')} /> : null}
        </span>
      ),
    },
    { key: 'status', header: t('governance.actions.columns.status'), sortValue: (a) => a.status, cell: (a) => <StatusBadge enumName="actionItemStatuses" value={a.status} /> },
    {
      key: 'linked',
      header: t('governance.actions.columns.linked'),
      cell: (a) => (
        <span className="flex flex-col gap-1">
          {a.decisionId ? (
            <Link href={`${base}/decisions/${a.decisionId}`} className={btn.link}>
              {t('governance.common.decision')}
            </Link>
          ) : null}
          {a.meetingId ? (
            <Link href={`${base}/meetings/${a.meetingId}`} className={btn.link}>
              {t('governance.common.meeting')}
            </Link>
          ) : null}
          {!a.decisionId && !a.meetingId ? <span className="text-muted">{EM_DASH}</span> : null}
        </span>
      ),
    },
    {
      key: 'commands',
      header: t('governance.actions.columns.commands'),
      cell: (a) => (
        <span className="flex flex-wrap gap-1">
          {commandsFor(a).map((c) => (
            <button
              key={c.cmd}
              type="button"
              className={cx(btn.secondary, 'min-h-9 px-2.5 py-1')}
              onClick={() => {
                setOwner(null);
                setDue(a.dueDate ?? '');
                setTarget({ a, cmd: c.cmd });
              }}
              data-command={c.cmd}
              aria-label={`${c.label} — ${a.code}`}
            >
              {c.label}
            </button>
          ))}
        </span>
      ),
    },
  ];

  const dialog = target
    ? ((): { consequences: ReactNode[]; noteMode: 'none' | 'optional' | 'required'; noteLabel?: string; disabled?: boolean; run: (note: string) => Promise<void>; children?: ReactNode } => {
        const { a, cmd } = target;
        const params = { projectId, actionId: a.id };
        const finish = async (key: MessageKey) => {
          await refresh();
          toast.show('success', t(key));
          setTarget(null);
        };
        switch (cmd) {
          case 'start':
            return { consequences: [t('governance.actions.cmd.start.effect')], noteMode: 'optional', run: async (note) => { await api(governanceRoutes.startAction, { params, body: { expectedVersion: a.version, ...(note ? { note } : {}) } }); await finish('governance.actions.cmd.start.done'); } };
          case 'reportDone':
            return {
              consequences: [t('governance.actions.cmd.reportDone.effect')],
              noteMode: 'required',
              noteLabel: t('governance.actions.cmd.reportDone.evidence'),
              run: async (note) => {
                await api(governanceRoutes.reportActionDone, { params, body: { expectedVersion: a.version, closureEvidenceNote: note } });
                await finish('governance.actions.cmd.reportDone.done');
              },
            };
          case 'verify':
            return { consequences: [t('governance.actions.cmd.verify.effect')], noteMode: 'optional', run: async (note) => { await api(governanceRoutes.verifyActionClosure, { params, body: { expectedVersion: a.version, ...(note ? { note } : {}) } }); await finish('governance.actions.cmd.verify.done'); } };
          case 'reject':
            return { consequences: [t('governance.actions.cmd.reject.effect')], noteMode: 'required', noteLabel: t('governance.common.reason'), run: async (note) => { await api(governanceRoutes.rejectActionClosure, { params, body: { expectedVersion: a.version, note } }); await finish('governance.actions.cmd.reject.done'); } };
          case 'cancel':
            return { consequences: [t('governance.actions.cmd.cancel.effect')], noteMode: 'required', noteLabel: t('governance.common.reason'), run: async (note) => { await api(governanceRoutes.cancelAction, { params, body: { expectedVersion: a.version, note } }); await finish('governance.actions.cmd.cancel.done'); } };
          case 'edit':
            return {
              consequences: [t('governance.actions.cmd.edit.effect')],
              noteMode: 'optional',
              noteLabel: t('governance.common.reason'),
              disabled: !owner && (!due || due === a.dueDate),
              run: async (note) => {
                await api(governanceRoutes.updateAction, {
                  params,
                  body: { expectedVersion: a.version, ...(owner ? { ownerUserId: owner.id } : {}), ...(due && due !== a.dueDate ? { dueDate: due } : {}), ...(note ? { reason: note } : {}) },
                });
                await finish('governance.actions.cmd.edit.done');
              },
              children: (
                <div className="space-y-4">
                  <UserPicker label={t('governance.actions.create.owner')} value={owner} onChange={setOwner} />
                  <TextField label={t('governance.actions.create.dueDate')} type="date" dir="ltr" value={due} onChange={(e) => setDue(e.target.value)} />
                </div>
              ),
            };
        }
      })()
    : null;

  return (
    <>
      <PageHeader
        title={t('governance.actions.title')}
        description={t('governance.actions.subtitle')}
        actions={
          can('governance.action.manage') ? (
            <button type="button" className={btn.primary} onClick={() => setCreateOpen(true)} data-testid="new-action">
              <Plus aria-hidden="true" className="size-4" />
              {t('governance.actions.create.action')}
            </button>
          ) : null
        }
      />
      <FilterBar onClear={clear} active={active}>
        <SearchInput className="w-full sm:w-72" label={t('governance.actions.search')} value={values.q} onChange={(v) => set({ q: v })} />
        <FilterSelect label={t('governance.common.status')} value={values.status} onChange={(v) => set({ status: v })} options={ACTION_ITEM_STATUSES.map((s) => ({ value: s, label: tStatus('actionItemStatuses', s) }))} />
        <label className="flex min-h-10 items-center gap-2 self-end text-sm text-ink">
          <input type="checkbox" checked={values.overdue === 'true'} onChange={(e) => set({ overdue: e.target.checked ? 'true' : null })} />
          {t('governance.actions.overdueOnly')}
        </label>
        <label className="flex min-h-10 items-center gap-2 self-end text-sm text-ink">
          <input type="checkbox" checked={values.mine === 'true'} onChange={(e) => set({ mine: e.target.checked ? 'true' : null })} />
          {t('governance.common.mine')}
        </label>
      </FilterBar>
      <DataTable
        caption={t('governance.actions.title')}
        columns={columns}
        rows={list.data?.items}
        rowKey={(a) => a.id}
        isLoading={list.isLoading}
        error={list.error}
        onRetry={() => list.refetch()}
        emptyTitle={active ? t('governance.actions.emptySearch') : t('governance.actions.empty')}
        pagination={list.data ? { page, pageSize: PAGE_SIZE, total: list.data.total, onPageChange: (p) => set({ page: p }) } : undefined}
        testId="actions-table"
      />
      {target && dialog ? (
        <GovCommandDialog
          open
          onClose={() => setTarget(null)}
          title={t(`governance.actions.cmd.${target.cmd}.title` as MessageKey, { code: target.a.code })}
          confirmLabel={t(`governance.actions.cmd.${target.cmd}.label` as MessageKey)}
          consequences={[...dialog.consequences, t('common.command.audited')]}
          noteMode={dialog.noteMode}
          noteLabel={dialog.noteLabel}
          expectedVersion={target.a.version}
          danger={target.cmd === 'cancel' || target.cmd === 'reject'}
          confirmDisabled={dialog.disabled}
          onReload={() => {
            void refresh();
            setTarget(null);
          }}
          onConfirm={({ note }) => dialog.run(note)}
        >
          {dialog.children}
        </GovCommandDialog>
      ) : null}
      {can('governance.action.manage') ? <CreateActionDialog open={createOpen} onClose={() => setCreateOpen(false)} decisionId={values.decisionId || undefined} meetingId={values.meetingId || undefined} /> : null}
    </>
  );
}
