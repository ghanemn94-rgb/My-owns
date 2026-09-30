'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { jvRoutes } from '@hub/contracts';
import { DD_DOMAINS, DD_RELEASE_STATUSES, FINDING_STATUSES, MATERIALITY, type Classification, type DdReleaseStatus } from '@hub/domain';
import { DataTable, type Column } from '@/components/DataTable';
import { DemoBadge } from '@/components/DemoBadge';
import { SelectField, TextAreaField, TextField } from '@/components/Field';
import { PageHeader } from '@/components/PageHeader';
import { SearchInput } from '@/components/SearchInput';
import { StatusBadge } from '@/components/StatusBadge';
import { useToast } from '@/components/Toast';
import { btn, cx } from '@/components/ui';
import { UserPicker, type PickedUser } from '@/components/UserPicker';
import { Tabs, useTabParam } from '@/components/planning/Tabs';
import { EM_DASH, useI18n } from '@/i18n/provider';
import { api } from '@/lib/api';
import { assignableClassifications } from '@/lib/documents';
import { jvHref, useDdRequests, useFindings, useJvRefresh, useRoomNames, type DdRequest, type Finding } from '@/lib/jv';
import { useProjectContext } from '@/lib/project-context';
import { Callout, FilterBar, FilterSelect, JvCommandDialog, Person, UText, useUrlState } from '../_components/jv';

const PAGE_SIZE = 25;
const TAB_KEYS = ['requests', 'findings'] as const;
type TabKey = (typeof TAB_KEYS)[number];

function useClassificationOptions() {
  const { me } = useProjectContext();
  const options = assignableClassifications(me.user.clearance as Classification);
  return { options, initial: (options.includes('confidential') ? 'confidential' : options[options.length - 1]!) as Classification };
}

function CreateRequestDialog({ onClose, defaultRoomId }: { onClose: () => void; defaultRoomId: string }) {
  const { t, tStatus } = useI18n();
  const { projectId } = useProjectContext();
  const refresh = useJvRefresh();
  const toast = useToast();
  const rooms = useRoomNames();
  const cls = useClassificationOptions();
  const [roomId, setRoomId] = useState(defaultRoomId);
  const [question, setQuestion] = useState('');
  const [domain, setDomain] = useState<(typeof DD_DOMAINS)[number]>('technical');
  const [requesterLabel, setRequesterLabel] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [classification, setClassification] = useState<Classification>(cls.initial);
  const openable = rooms.items.filter((r) => r.canOpen && r.myAccessLevel && r.myAccessLevel !== 'read' && !r.locked);
  return (
    <JvCommandDialog
      open
      onClose={onClose}
      title={t('jv.dd.create.title')}
      confirmLabel={t('jv.dd.create.confirm')}
      noteMode="none"
      confirmDisabled={!roomId || !question.trim()}
      consequences={[t('jv.dd.create.effect'), t('jv.dd.releaseRule'), t('common.command.audited')]}
      onConfirm={async () => {
        const r = await api(jvRoutes.createDdRequest, {
          params: { projectId },
          body: { roomId, question: question.trim(), domain, classification, ...(requesterLabel.trim() ? { requesterLabel: requesterLabel.trim() } : {}), ...(dueDate ? { dueDate } : {}) },
        });
        await refresh();
        toast.show('success', t('jv.dd.create.done', { number: r.number }));
        onClose();
      }}
    >
      <SelectField label={t('jv.dd.fields.room')} required value={roomId} onChange={(e) => setRoomId(e.target.value)} hint={t('jv.dd.fields.roomHint')} data-testid="dd-room">
        <option value="">{t('jv.common.select')}</option>
        {openable.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      </SelectField>
      <TextAreaField label={t('jv.dd.fields.question')} required value={question} maxLength={4000} onChange={(e) => setQuestion(e.target.value)} data-testid="dd-question" />
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField label={t('jv.dd.fields.domain')} required value={domain} onChange={(e) => setDomain(e.target.value as (typeof DD_DOMAINS)[number])} data-testid="dd-domain">
          {DD_DOMAINS.map((d) => (
            <option key={d} value={d}>
              {tStatus('ddDomains', d)}
            </option>
          ))}
        </SelectField>
        <TextField label={t('jv.dd.fields.dueDate')} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        <TextField label={t('jv.dd.fields.requesterLabel')} value={requesterLabel} maxLength={200} onChange={(e) => setRequesterLabel(e.target.value)} />
        <SelectField label={t('jv.common.classification')} required value={classification} onChange={(e) => setClassification(e.target.value as Classification)}>
          {cls.options.map((c) => (
            <option key={c} value={c}>
              {tStatus('classifications', c)}
            </option>
          ))}
        </SelectField>
      </div>
    </JvCommandDialog>
  );
}

function CreateFindingDialog({ onClose, defaultRoomId }: { onClose: () => void; defaultRoomId: string }) {
  const { t, tStatus } = useI18n();
  const { projectId } = useProjectContext();
  const refresh = useJvRefresh();
  const toast = useToast();
  const rooms = useRoomNames();
  const requests = useDdRequests({ page: 1, pageSize: 100 });
  const cls = useClassificationOptions();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [materiality, setMateriality] = useState<(typeof MATERIALITY)[number]>('medium');
  const [roomId, setRoomId] = useState(defaultRoomId);
  const [requestId, setRequestId] = useState('');
  const [remediation, setRemediation] = useState('');
  const [owner, setOwner] = useState<PickedUser | null>(null);
  const [dueDate, setDueDate] = useState('');
  const [valuation, setValuation] = useState('');
  const [documentImpl, setDocumentImpl] = useState('');
  const [cpImpl, setCpImpl] = useState('');
  const [classification, setClassification] = useState<Classification>(cls.initial);
  const material = materiality === 'high' || materiality === 'critical';
  return (
    <JvCommandDialog
      open
      onClose={onClose}
      title={t('jv.findings.create.title')}
      confirmLabel={t('jv.findings.create.confirm')}
      noteMode="none"
      confirmDisabled={!title.trim() || (material && (!owner || !remediation.trim()))}
      consequences={[t('jv.findings.create.effect'), t('jv.findings.materialRule'), t('common.command.audited')]}
      onConfirm={async () => {
        const r = await api(jvRoutes.createFinding, {
          params: { projectId },
          body: {
            title: title.trim(),
            materiality,
            classification,
            ...(description.trim() ? { description: description.trim() } : {}),
            ...(roomId ? { roomId } : {}),
            ...(requestId ? { diligenceRequestId: requestId } : {}),
            ...(remediation.trim() ? { remediation: remediation.trim() } : {}),
            ...(owner ? { remediationOwnerUserId: owner.id } : {}),
            ...(dueDate ? { remediationDueDate: dueDate } : {}),
            ...(valuation.trim() ? { valuationImplication: valuation.trim() } : {}),
            ...(documentImpl.trim() ? { documentImplication: documentImpl.trim() } : {}),
            ...(cpImpl.trim() ? { cpImplication: cpImpl.trim() } : {}),
          },
        });
        await refresh();
        toast.show('success', t('jv.findings.create.done', { code: r.code ?? '' }));
        onClose();
      }}
    >
      <TextField label={t('jv.findings.fields.title')} required value={title} maxLength={300} onChange={(e) => setTitle(e.target.value)} data-testid="finding-title" />
      <TextAreaField label={t('jv.findings.fields.description')} value={description} maxLength={8000} onChange={(e) => setDescription(e.target.value)} />
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField label={t('jv.findings.fields.materiality')} required value={materiality} onChange={(e) => setMateriality(e.target.value as (typeof MATERIALITY)[number])} data-testid="finding-materiality">
          {MATERIALITY.map((m) => (
            <option key={m} value={m}>
              {tStatus('materiality', m)}
            </option>
          ))}
        </SelectField>
        <SelectField label={t('jv.dd.fields.room')} value={roomId} onChange={(e) => setRoomId(e.target.value)} hint={t('jv.findings.fields.roomHint')}>
          <option value="">{t('jv.common.none')}</option>
          {rooms.items.filter((r) => r.canOpen).map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </SelectField>
        <SelectField className="sm:col-span-2" label={t('jv.findings.fields.request')} value={requestId} onChange={(e) => setRequestId(e.target.value)}>
          <option value="">{t('jv.common.none')}</option>
          {(requests.data?.items ?? []).map((r) => (
            <option key={r.id} value={r.id}>
              {t('jv.dd.numberValue', { number: r.number })} — {r.question.slice(0, 80)}
            </option>
          ))}
        </SelectField>
      </div>
      <TextAreaField label={t('jv.findings.fields.remediation')} required={material} value={remediation} maxLength={4000} onChange={(e) => setRemediation(e.target.value)} />
      <div className="grid gap-4 sm:grid-cols-2">
        <UserPicker label={t('jv.findings.fields.owner')} required={material} value={owner} onChange={setOwner} />
        <TextField label={t('jv.findings.fields.dueDate')} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
      </div>
      <TextAreaField label={t('jv.findings.fields.valuation')} value={valuation} maxLength={4000} onChange={(e) => setValuation(e.target.value)} />
      <TextAreaField label={t('jv.findings.fields.documentImpl')} value={documentImpl} maxLength={4000} onChange={(e) => setDocumentImpl(e.target.value)} />
      <TextAreaField label={t('jv.findings.fields.cpImpl')} value={cpImpl} maxLength={4000} onChange={(e) => setCpImpl(e.target.value)} />
      <SelectField label={t('jv.common.classification')} required value={classification} onChange={(e) => setClassification(e.target.value as Classification)}>
        {cls.options.map((c) => (
          <option key={c} value={c}>
            {tStatus('classifications', c)}
          </option>
        ))}
      </SelectField>
    </JvCommandDialog>
  );
}

function RequestsTab() {
  const { t, tStatus, formatDate } = useI18n();
  const { projectId, can } = useProjectContext();
  const rooms = useRoomNames();
  const { values, page, set, active } = useUrlState(['q', 'roomId', 'releaseStatus'] as const);
  const clear = () => set({ q: null, roomId: null, releaseStatus: null });
  const [createOpen, setCreateOpen] = useState(false);
  const base = jvHref(projectId);
  const list = useDdRequests({ page, pageSize: PAGE_SIZE, q: values.q || undefined, roomId: values.roomId || undefined, releaseStatus: (values.releaseStatus || undefined) as DdReleaseStatus | undefined });
  const people = list.data?.people;
  const columns: Column<DdRequest>[] = [
    {
      key: 'number',
      header: t('jv.dd.columns.number'),
      isRowHeader: true,
      sortValue: (r) => r.number,
      cell: (r) => (
        <span className="flex flex-wrap items-center gap-1">
          <Link className={btn.link} href={`${base}/diligence/requests/${r.id}`} data-testid="dd-link">
            {t('jv.dd.numberValue', { number: r.number })}
          </Link>
          {r.isDemo ? <DemoBadge /> : null}
        </span>
      ),
    },
    { key: 'question', header: t('jv.dd.fields.question'), cell: (r) => <UText value={r.question} multiline /> },
    {
      key: 'domain',
      header: t('jv.dd.fields.domain'),
      cell: (r) => (
        <span className="flex flex-col text-xs">
          <span>{tStatus('ddDomains', r.domain)}</span>
          <span className="text-muted">{tStatus('ddRequestOrigins', r.origin)}</span>
        </span>
      ),
    },
    { key: 'room', header: t('jv.dd.fields.room'), cell: (r) => <span dir="auto" className="text-xs">{rooms.label(r.roomId) ?? EM_DASH}</span> },
    { key: 'assignee', header: t('jv.dd.fields.assignee'), cell: (r) => <Person id={r.assigneeUserId} people={people} /> },
    { key: 'reviewer', header: t('jv.dd.fields.reviewer'), cell: (r) => <Person id={r.reviewerUserId} people={people} /> },
    { key: 'due', header: t('jv.dd.fields.dueDate'), sortValue: (r) => r.dueDate, cell: (r) => <span className="tabular">{formatDate(r.dueDate)}</span> },
    { key: 'status', header: t('jv.dd.fields.releaseStatus'), sortValue: (r) => r.releaseStatus, cell: (r) => <StatusBadge enumName="ddReleaseStatuses" value={r.releaseStatus} /> },
  ];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">{t('jv.dd.releaseRule')}</p>
        {can('jv.dd_request.create') ? (
          <button type="button" className={btn.primary} onClick={() => setCreateOpen(true)} data-testid="create-dd-request">
            <Plus aria-hidden="true" className="size-4" />
            {t('jv.dd.create.action')}
          </button>
        ) : null}
      </div>
      <FilterBar onClear={clear} active={active}>
        <SearchInput className="w-full sm:w-64" label={t('jv.dd.search')} value={values.q} onChange={(v) => set({ q: v })} />
        <FilterSelect label={t('jv.dd.fields.room')} value={values.roomId} onChange={(v) => set({ roomId: v })} options={rooms.items.filter((r) => r.canOpen).map((r) => ({ value: r.id, label: r.name }))} testId="filter-dd-room" />
        <FilterSelect label={t('jv.dd.fields.releaseStatus')} value={values.releaseStatus} onChange={(v) => set({ releaseStatus: v })} options={DD_RELEASE_STATUSES.map((s) => ({ value: s, label: tStatus('ddReleaseStatuses', s) }))} />
      </FilterBar>
      <DataTable
        caption={t('jv.dd.title')}
        columns={columns}
        rows={list.data?.items}
        rowKey={(r) => r.id}
        isLoading={list.isLoading}
        error={list.error}
        onRetry={() => list.refetch()}
        emptyTitle={active ? t('jv.common.emptySearch') : t('jv.dd.empty')}
        pagination={list.data ? { page, pageSize: PAGE_SIZE, total: list.data.total, onPageChange: (p) => set({ page: p }) } : undefined}
        testId="dd-table"
      />
      {createOpen ? <CreateRequestDialog defaultRoomId={values.roomId} onClose={() => setCreateOpen(false)} /> : null}
    </div>
  );
}

function FindingsTab() {
  const { t, tStatus, formatDate } = useI18n();
  const { projectId, can } = useProjectContext();
  const rooms = useRoomNames();
  const { values, page, set, active } = useUrlState(['q', 'materiality', 'status', 'roomId'] as const);
  const clear = () => set({ q: null, materiality: null, status: null, roomId: null });
  const [createOpen, setCreateOpen] = useState(false);
  const base = jvHref(projectId);
  const list = useFindings({
    page,
    pageSize: PAGE_SIZE,
    q: values.q || undefined,
    roomId: values.roomId || undefined,
    materiality: (values.materiality || undefined) as Finding['materiality'] | undefined,
    status: (values.status || undefined) as Finding['status'] | undefined,
  });
  const columns: Column<Finding>[] = [
    {
      key: 'code',
      header: t('jv.findings.columns.code'),
      isRowHeader: true,
      sortValue: (f) => f.code,
      cell: (f) => (
        <span className="flex flex-wrap items-center gap-1">
          <Link className={cx(btn.link, 'whitespace-nowrap')} href={`${base}/diligence/findings/${f.id}`} dir="ltr" data-testid="finding-link">
            {f.code}
          </Link>
          {f.isDemo ? <DemoBadge /> : null}
        </span>
      ),
    },
    { key: 'title', header: t('jv.findings.fields.title'), cell: (f) => <UText value={f.title} /> },
    {
      key: 'materiality',
      header: t('jv.findings.fields.materiality'),
      sortValue: (f) => MATERIALITY.indexOf(f.materiality),
      cell: (f) => (
        <span className="flex flex-col items-start gap-1">
          <StatusBadge enumName="materiality" value={f.materiality} />
          {f.material ? <span className="text-xs font-semibold text-danger">{t('jv.findings.material')}</span> : null}
        </span>
      ),
    },
    { key: 'room', header: t('jv.dd.fields.room'), cell: (f) => <span dir="auto" className="text-xs">{rooms.label(f.roomId) ?? t('jv.findings.projectLevel')}</span> },
    {
      key: 'remediation',
      header: t('jv.findings.fields.remediation'),
      cell: (f) => (
        <span className="flex flex-col gap-0.5 text-xs">
          <UText value={f.remediation} />
          {f.remediationDueDate ? <span className="text-muted">{t('jv.findings.dueOn', { date: formatDate(f.remediationDueDate) })}</span> : null}
        </span>
      ),
    },
    {
      key: 'implications',
      header: t('jv.findings.fields.implications'),
      cell: (f) => (
        <span className="flex flex-wrap gap-1 text-xs">
          {f.valuationImplication ? <span className="rounded bg-surface-muted px-1.5 py-0.5">{t('jv.findings.implValuation')}</span> : null}
          {f.documentImplication ? <span className="rounded bg-surface-muted px-1.5 py-0.5">{t('jv.findings.implDocument')}</span> : null}
          {f.cpImplication ? <span className="rounded bg-surface-muted px-1.5 py-0.5">{t('jv.findings.implCp')}</span> : null}
          {!f.valuationImplication && !f.documentImplication && !f.cpImplication ? EM_DASH : null}
        </span>
      ),
    },
    { key: 'status', header: t('jv.common.status'), sortValue: (f) => f.status, cell: (f) => <StatusBadge enumName="findingStatuses" value={f.status} /> },
  ];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">{t('jv.findings.roomScoped')}</p>
        {can('jv.finding.manage') ? (
          <button type="button" className={btn.primary} onClick={() => setCreateOpen(true)} data-testid="create-finding">
            <Plus aria-hidden="true" className="size-4" />
            {t('jv.findings.create.action')}
          </button>
        ) : null}
      </div>
      <FilterBar onClear={clear} active={active}>
        <SearchInput className="w-full sm:w-64" label={t('jv.findings.search')} value={values.q} onChange={(v) => set({ q: v })} />
        <FilterSelect label={t('jv.findings.fields.materiality')} value={values.materiality} onChange={(v) => set({ materiality: v })} options={MATERIALITY.map((m) => ({ value: m, label: tStatus('materiality', m) }))} />
        <FilterSelect label={t('jv.common.status')} value={values.status} onChange={(v) => set({ status: v })} options={FINDING_STATUSES.map((s) => ({ value: s, label: tStatus('findingStatuses', s) }))} />
        <FilterSelect label={t('jv.dd.fields.room')} value={values.roomId} onChange={(v) => set({ roomId: v })} options={rooms.items.filter((r) => r.canOpen).map((r) => ({ value: r.id, label: r.name }))} />
      </FilterBar>
      <DataTable
        caption={t('jv.findings.title')}
        columns={columns}
        rows={list.data?.items}
        rowKey={(f) => f.id}
        isLoading={list.isLoading}
        error={list.error}
        onRetry={() => list.refetch()}
        emptyTitle={active ? t('jv.common.emptySearch') : t('jv.findings.empty')}
        pagination={list.data ? { page, pageSize: PAGE_SIZE, total: list.data.total, onPageChange: (p) => set({ page: p }) } : undefined}
        testId="findings-table"
      />
      {createOpen ? <CreateFindingDialog defaultRoomId={values.roomId} onClose={() => setCreateOpen(false)} /> : null}
    </div>
  );
}

/** Due diligence (REQ-JV-010/011): requests & Q&A with release approval, and findings — both scoped to room grants. */
export default function DiligencePage() {
  const { t } = useI18n();
  const [tab, setTab] = useTabParam<TabKey>(TAB_KEYS, 'requests');
  return (
    <>
      <PageHeader title={t('jv.dd.title')} description={t('jv.dd.subtitle')} />
      <Callout testId="dd-room-scoped" className="mb-4">
        {t('jv.dd.roomScoped')}
      </Callout>
      <Tabs tabs={TAB_KEYS.map((k) => ({ key: k, label: t(`jv.dd.tabs.${k}`) }))} value={tab} onChange={setTab} label={t('jv.dd.tabs.label')} testId="dd-tabs">
        {tab === 'requests' ? <RequestsTab /> : <FindingsTab />}
      </Tabs>
    </>
  );
}
