'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { jvRoutes } from '@hub/contracts';
import { CONDITION_STATUSES } from '@hub/domain';
import { DataTable, type Column } from '@/components/DataTable';
import { DemoBadge } from '@/components/DemoBadge';
import { SelectField, TextAreaField, TextField } from '@/components/Field';
import { PageHeader } from '@/components/PageHeader';
import { SearchInput } from '@/components/SearchInput';
import { StatusBadge } from '@/components/StatusBadge';
import { useToast } from '@/components/Toast';
import { btn, cx } from '@/components/ui';
import { Tabs, useTabParam } from '@/components/planning/Tabs';
import { EM_DASH, useI18n } from '@/i18n/provider';
import { api } from '@/lib/api';
import { jvHref, useConditions, useEvents, useJvRefresh, usePartnerNames, type Condition, type EventKind, type TxEvent } from '@/lib/jv';
import { useProjectContext } from '@/lib/project-context';
import { Callout, FilterBar, FilterSelect, Flag, JvCommandDialog, Person, WaivabilityBadge, useUrlState } from '../_components/jv';

const PAGE_SIZE = 25;
const TAB_KEYS = ['closings', 'signings', 'conditions'] as const;
type TabKey = (typeof TAB_KEYS)[number];

function CreateEventDialog({ kind, onClose }: { kind: EventKind; onClose: () => void }) {
  const { t } = useI18n();
  const { projectId } = useProjectContext();
  const refresh = useJvRefresh();
  const toast = useToast();
  const partners = usePartnerNames();
  const signings = useEvents('signing', { page: 1, pageSize: 100 });
  const [name, setName] = useState('');
  const [partnerId, setPartnerId] = useState('');
  const [signingId, setSigningId] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [description, setDescription] = useState('');
  return (
    <JvCommandDialog
      open
      onClose={onClose}
      title={t(`jv.closing.create.${kind}.title`)}
      confirmLabel={t(`jv.closing.create.${kind}.confirm`)}
      noteMode="none"
      confirmDisabled={!name.trim() || (kind === 'closing' && !signingId)}
      consequences={[t(`jv.closing.create.${kind}.effect`), t('jv.closing.separate'), t('common.command.audited')]}
      onConfirm={async () => {
        const common = { name: name.trim(), ...(partnerId ? { partnerId } : {}), ...(targetDate ? { targetDate } : {}), ...(description.trim() ? { description: description.trim() } : {}) };
        const r = kind === 'closing' ? await api(jvRoutes.createClosing, { params: { projectId }, body: { ...common, signingId } }) : await api(jvRoutes.createSigning, { params: { projectId }, body: common });
        await refresh();
        toast.show('success', t('jv.closing.create.done', { code: r.code ?? '' }));
        onClose();
      }}
    >
      <TextField label={t('jv.closing.fields.name')} required value={name} maxLength={300} onChange={(e) => setName(e.target.value)} data-testid="event-name" />
      {kind === 'closing' ? (
        <SelectField label={t('jv.closing.fields.signing')} required value={signingId} onChange={(e) => setSigningId(e.target.value)} hint={t('jv.closing.fields.signingHint')} data-testid="event-signing">
          <option value="">{t('jv.common.select')}</option>
          {(signings.data?.items ?? [])
            .filter((s) => s.status !== 'aborted')
            .map((s) => (
              <option key={s.id} value={s.id}>
                {s.code} — {s.name}
              </option>
            ))}
        </SelectField>
      ) : null}
      <SelectField label={t('jv.common.partner')} value={partnerId} onChange={(e) => setPartnerId(e.target.value)}>
        <option value="">{kind === 'closing' ? t('jv.closing.fields.partnerOfSigning') : t('jv.common.none')}</option>
        {partners.items.map((p) => (
          <option key={p.id} value={p.id}>
            {p.code} — {p.name}
          </option>
        ))}
      </SelectField>
      <TextField label={t('jv.closing.fields.targetDate')} type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
      <TextAreaField label={t('jv.closing.fields.description')} value={description} maxLength={4000} onChange={(e) => setDescription(e.target.value)} />
    </JvCommandDialog>
  );
}

function EventsTab({ kind }: { kind: EventKind }) {
  const { t, formatDate, formatDateTime } = useI18n();
  const { projectId, can } = useProjectContext();
  const partners = usePartnerNames();
  const { values, page, set, active } = useUrlState(['q'] as const);
  const [createOpen, setCreateOpen] = useState(false);
  const base = jvHref(projectId);
  const list = useEvents(kind, { page, pageSize: PAGE_SIZE, q: values.q || undefined });
  const signings = useEvents('signing', { page: 1, pageSize: 100 }, kind === 'closing');
  const signingLabel = (id: string | null) => {
    if (!id) return EM_DASH;
    const s = signings.data?.items.find((x) => x.id === id);
    return s ? `${s.code} — ${s.name}` : `#${id.slice(-6)}`;
  };
  const columns: Column<TxEvent>[] = [
    {
      key: 'code',
      header: t('jv.closing.columns.code'),
      isRowHeader: true,
      sortValue: (e) => e.sequence,
      cell: (e) => (
        <span className="flex flex-wrap items-center gap-1">
          <Link className={cx(btn.link, 'whitespace-nowrap')} href={`${base}/closing/${kind === 'signing' ? 'signings' : 'closings'}/${e.id}`} dir="ltr" data-testid={`${kind}-link`}>
            {e.code}
          </Link>
          {e.isDemo ? <DemoBadge /> : null}
        </span>
      ),
    },
    { key: 'name', header: t('jv.closing.fields.name'), sortValue: (e) => e.name, cell: (e) => <span dir="auto">{e.name}</span> },
    ...(kind === 'closing' ? [{ key: 'signing', header: t('jv.closing.fields.signing'), cell: (e: TxEvent) => <span dir="auto" className="text-xs">{signingLabel(e.signingId)}</span> }] : []),
    { key: 'partner', header: t('jv.common.partner'), cell: (e) => <span dir="auto" className="text-xs">{partners.label(e.partnerId) ?? EM_DASH}</span> },
    { key: 'target', header: t('jv.closing.fields.targetDate'), sortValue: (e) => e.targetDate, cell: (e) => <span className="tabular">{formatDate(e.targetDate)}</span> },
    { key: 'status', header: t('jv.common.status'), sortValue: (e) => e.status, cell: (e) => <StatusBadge enumName="closingStatuses" value={e.status} /> },
    { key: 'confirmed', header: t('jv.closing.fields.confirmed'), cell: (e) => (e.confirmedAt ? <span className="tabular text-xs">{formatDateTime(e.confirmedAt)}</span> : <span className="text-muted">{EM_DASH}</span>) },
  ];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <FilterBar onClear={() => set({ q: null })} active={active}>
          <SearchInput className="w-full sm:w-64" label={t('jv.closing.search')} value={values.q} onChange={(v) => set({ q: v })} />
        </FilterBar>
        {can('jv.closing_checklist.manage') ? (
          <button type="button" className={btn.primary} onClick={() => setCreateOpen(true)} data-testid={`create-${kind}`}>
            <Plus aria-hidden="true" className="size-4" />
            {t(`jv.closing.create.${kind}.action`)}
          </button>
        ) : null}
      </div>
      <DataTable
        caption={t(`jv.closing.tabs.${kind === 'signing' ? 'signings' : 'closings'}`)}
        columns={columns}
        rows={list.data?.items}
        rowKey={(e) => e.id}
        isLoading={list.isLoading}
        error={list.error}
        onRetry={() => list.refetch()}
        emptyTitle={active ? t('jv.common.emptySearch') : t(`jv.closing.empty${kind === 'signing' ? 'Signings' : 'Closings'}`)}
        pagination={list.data ? { page, pageSize: PAGE_SIZE, total: list.data.total, onPageChange: (p) => set({ page: p }) } : undefined}
        testId={`${kind}s-table`}
      />
      {createOpen ? <CreateEventDialog kind={kind} onClose={() => setCreateOpen(false)} /> : null}
    </div>
  );
}

function ConditionsTab() {
  const { t, tStatus, formatDate, formatNumber } = useI18n();
  const { projectId } = useProjectContext();
  const { values, page, set, active } = useUrlState(['q', 'closingId', 'status', 'blocking'] as const);
  const closings = useEvents('closing', { page: 1, pageSize: 100 });
  const base = jvHref(projectId);
  const list = useConditions({
    page,
    pageSize: PAGE_SIZE,
    q: values.q || undefined,
    closingId: values.closingId || undefined,
    status: (values.status || undefined) as Condition['status'] | undefined,
    blocking: (values.blocking || undefined) as 'true' | 'false' | undefined,
  });
  const people = list.data?.people;
  const closingLabel = (id: string | null) => {
    if (!id) return EM_DASH;
    const c = closings.data?.items.find((x) => x.id === id);
    return c ? c.code ?? c.name : `#${id.slice(-6)}`;
  };
  const columns: Column<Condition>[] = [
    {
      key: 'reference',
      header: t('jv.cp.fields.reference'),
      isRowHeader: true,
      sortValue: (c) => c.reference,
      cell: (c) => (
        <span className="flex flex-wrap items-center gap-1">
          <Link className={cx(btn.link, 'whitespace-nowrap')} href={`${base}/closing/conditions/${c.id}`} dir="ltr" data-testid="cp-link">
            {c.reference}
          </Link>
          {c.isDemo ? <DemoBadge /> : null}
        </span>
      ),
    },
    { key: 'title', header: t('jv.cp.fields.title'), cell: (c) => <span dir="auto">{c.title}</span> },
    {
      key: 'closing',
      header: t('jv.cp.fields.closing'),
      cell: (c) =>
        c.closingId ? (
          <Link className={btn.link} href={`${base}/closing/closings/${c.closingId}`} dir="ltr">
            {closingLabel(c.closingId)}
          </Link>
        ) : (
          EM_DASH
        ),
    },
    { key: 'owner', header: t('jv.cp.fields.owner'), cell: (c) => <Person id={c.ownerUserId} people={people} /> },
    {
      key: 'flags',
      header: t('jv.cp.fields.flags'),
      cell: (c) => (
        <span className="flex flex-wrap gap-1">
          <Flag on={c.blocking} danger onLabel={t('jv.cp.blocking')} offLabel={t('jv.cp.nonBlocking')} />
          <WaivabilityBadge c={c} />
        </span>
      ),
    },
    { key: 'longStop', header: t('jv.cp.fields.longStop'), sortValue: (c) => c.longStopDate, cell: (c) => <span className="tabular">{formatDate(c.longStopDate)}</span> },
    {
      key: 'status',
      header: t('jv.common.status'),
      sortValue: (c) => c.status,
      cell: (c) => (
        <span className="flex flex-col items-start gap-1">
          <StatusBadge enumName="conditionStatuses" value={c.status} />
          {c.status === 'waived' && !c.waiverEffective ? <span className="text-xs text-danger">{t('jv.cp.waiverNotEffective')}</span> : null}
        </span>
      ),
    },
    { key: 'evidence', header: t('jv.cp.fields.evidence'), cell: (c) => <span className="tabular text-xs">{t('jv.cp.evidenceCount', { active: formatNumber(c.evidence.active), conflicting: formatNumber(c.evidence.conflicting) })}</span> },
  ];
  return (
    <div className="space-y-3">
      <FilterBar onClear={() => set({ q: null, closingId: null, status: null, blocking: null })} active={active}>
        <SearchInput className="w-full sm:w-64" label={t('jv.cp.search')} value={values.q} onChange={(v) => set({ q: v })} />
        <FilterSelect label={t('jv.cp.fields.closing')} value={values.closingId} onChange={(v) => set({ closingId: v })} options={(closings.data?.items ?? []).map((c) => ({ value: c.id, label: `${c.code ?? ''} — ${c.name}` }))} />
        <FilterSelect label={t('jv.common.status')} value={values.status} onChange={(v) => set({ status: v })} options={CONDITION_STATUSES.map((s) => ({ value: s, label: tStatus('conditionStatuses', s) }))} testId="filter-cp-status" />
        <FilterSelect
          label={t('jv.cp.fields.blocking')}
          value={values.blocking}
          onChange={(v) => set({ blocking: v })}
          options={[
            { value: 'true', label: t('jv.cp.blocking') },
            { value: 'false', label: t('jv.cp.nonBlocking') },
          ]}
        />
      </FilterBar>
      <DataTable
        caption={t('jv.closing.tabs.conditions')}
        columns={columns}
        rows={list.data?.items}
        rowKey={(c) => c.id}
        isLoading={list.isLoading}
        error={list.error}
        onRetry={() => list.refetch()}
        emptyTitle={active ? t('jv.common.emptySearch') : t('jv.cp.empty')}
        pagination={list.data ? { page, pageSize: PAGE_SIZE, total: list.data.total, onPageChange: (p) => set({ page: p }) } : undefined}
        testId="conditions-table"
      />
    </div>
  );
}

/** Signing & closing (REQ-LCY-009, REQ-JV-012..018): separate events, checklists and confirmations; the CP register. */
export default function ClosingPage() {
  const { t } = useI18n();
  const [tab, setTab] = useTabParam<TabKey>(TAB_KEYS, 'closings');
  return (
    <>
      <PageHeader title={t('jv.closing.title')} description={t('jv.closing.subtitle')} />
      <div className="mb-4 grid gap-3 md:grid-cols-2">
        <Callout testId="signing-closing-separate">{t('jv.closing.separate')}</Callout>
        <Callout tone="warning" testId="tasks-never-close">
          {t('jv.closing.tasksNeverClose')}
        </Callout>
      </div>
      <Tabs tabs={TAB_KEYS.map((k) => ({ key: k, label: t(`jv.closing.tabs.${k}`) }))} value={tab} onChange={setTab} label={t('jv.closing.tabs.label')} testId="closing-tabs">
        {tab === 'closings' ? <EventsTab key="closing" kind="closing" /> : tab === 'signings' ? <EventsTab key="signing" kind="signing" /> : <ConditionsTab />}
      </Tabs>
    </>
  );
}
