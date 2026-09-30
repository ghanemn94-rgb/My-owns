'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Plus, Scale, Trash2 } from 'lucide-react';
import { jvRoutes } from '@hub/contracts';
import { PARTNER_STAGES, type Classification, type PartnerStage } from '@hub/domain';
import { DataTable, type Column } from '@/components/DataTable';
import { DemoBadge } from '@/components/DemoBadge';
import { SelectField, TextAreaField, TextField } from '@/components/Field';
import { PageHeader } from '@/components/PageHeader';
import { SearchInput } from '@/components/SearchInput';
import { StatusBadge } from '@/components/StatusBadge';
import { useToast } from '@/components/Toast';
import { btn, cx } from '@/components/ui';
import { useI18n } from '@/i18n/provider';
import { api } from '@/lib/api';
import { assignableClassifications } from '@/lib/documents';
import { useLocalized } from '@/lib/i18n-data';
import { jvHref, useCriteria, useJvRefresh, usePartners, type CriteriaSet, type Partner } from '@/lib/jv';
import { useProjectContext } from '@/lib/project-context';
import { FilterBar, FilterSelect, JvCommandDialog, NdaNoAccessNotice, Panel, useUrlState } from '../_components/jv';

const PAGE_SIZE = 25;
const FILTERS = ['q', 'stage', 'shortlisted'] as const;

function CreatePartnerDialog({ onClose }: { onClose: () => void }) {
  const { t, tStatus } = useI18n();
  const { projectId, me } = useProjectContext();
  const refresh = useJvRefresh();
  const toast = useToast();
  const options = assignableClassifications(me.user.clearance as Classification);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [classification, setClassification] = useState<Classification>(options.includes('confidential') ? 'confidential' : options[options.length - 1]!);
  return (
    <JvCommandDialog
      open
      onClose={onClose}
      title={t('jv.partners.create.title')}
      confirmLabel={t('jv.partners.create.confirm')}
      noteMode="none"
      confirmDisabled={!name.trim()}
      consequences={[t('jv.partners.create.effect'), t('jv.partners.create.noRealNames'), t('common.command.audited')]}
      onConfirm={async () => {
        const r = await api(jvRoutes.createPartner, {
          params: { projectId },
          body: { name: name.trim(), classification, ...(code.trim() ? { code: code.trim().toUpperCase() } : {}), ...(description.trim() ? { description: description.trim() } : {}) },
        });
        await refresh();
        toast.show('success', t('jv.partners.create.done', { code: r.code ?? '' }));
        onClose();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label={t('jv.partners.create.name')} required value={name} maxLength={200} onChange={(e) => setName(e.target.value)} data-testid="partner-name" />
        <TextField label={t('jv.partners.create.code')} hint={t('jv.partners.create.codeHint')} value={code} maxLength={32} onChange={(e) => setCode(e.target.value)} data-testid="partner-code" />
        <TextAreaField className="sm:col-span-2" label={t('jv.partners.create.description')} value={description} maxLength={4000} onChange={(e) => setDescription(e.target.value)} />
        <SelectField label={t('jv.common.classification')} required value={classification} onChange={(e) => setClassification(e.target.value as Classification)}>
          {options.map((c) => (
            <option key={c} value={c}>
              {tStatus('classifications', c)}
            </option>
          ))}
        </SelectField>
      </div>
    </JvCommandDialog>
  );
}

interface CriterionDraft {
  key: string;
  name: string;
  nameAr: string;
  weight: string;
}

/** Replace the screening criteria. Weights must sum to exactly 100 — the server validates; the sum shown here is a hint. */
function CriteriaDialog({ current, onClose }: { current: CriteriaSet | null; onClose: () => void }) {
  const { t, formatNumber } = useI18n();
  const { projectId } = useProjectContext();
  const refresh = useJvRefresh();
  const toast = useToast();
  const [rows, setRows] = useState<CriterionDraft[]>(
    current?.criteria.length ? current.criteria.map((c) => ({ key: c.key, name: c.name, nameAr: c.nameAr ?? '', weight: c.weight })) : [{ key: '', name: '', nameAr: '', weight: '' }],
  );
  const [note, setNote] = useState(current?.note ?? '');
  const sum = rows.reduce((acc, r) => acc + (Number.isFinite(Number(r.weight)) ? Number(r.weight) : 0), 0);
  const set = (i: number, patch: Partial<CriterionDraft>) => setRows((xs) => xs.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const complete = rows.length > 0 && rows.every((r) => r.key.trim() && r.name.trim() && r.weight.trim());
  return (
    <JvCommandDialog
      open
      onClose={onClose}
      title={t('jv.criteria.edit.title')}
      confirmLabel={t('jv.criteria.edit.confirm')}
      noteMode="none"
      expectedVersion={current?.version ?? 0}
      confirmDisabled={!complete}
      consequences={[t('jv.criteria.edit.effect'), t('jv.criteria.edit.sumRule'), t('common.command.audited')]}
      onConfirm={async () => {
        await api(jvRoutes.setCriteria, {
          params: { projectId },
          body: {
            expectedVersion: current?.version ?? 0,
            criteria: rows.map((r) => ({ key: r.key.trim(), name: r.name.trim(), nameAr: r.nameAr.trim() || null, weight: r.weight.trim() })),
            ...(note.trim() ? { note: note.trim() } : {}),
          },
        });
        await refresh();
        toast.show('success', t('jv.criteria.edit.done'));
        onClose();
      }}
    >
      <div className="space-y-3">
        {rows.map((r, i) => (
          <fieldset key={i} className="grid gap-2 rounded-md border border-line p-3 sm:grid-cols-[8rem_1fr_1fr_6rem_auto] sm:items-end">
            <legend className="px-1 text-xs font-semibold text-muted">{t('jv.criteria.edit.row', { n: i + 1 })}</legend>
            <TextField label={t('jv.criteria.key')} required value={r.key} maxLength={32} onChange={(e) => set(i, { key: e.target.value })} dir="ltr" />
            <TextField label={t('jv.criteria.name')} required value={r.name} maxLength={200} onChange={(e) => set(i, { name: e.target.value })} />
            <TextField label={t('jv.criteria.nameAr')} value={r.nameAr} maxLength={200} onChange={(e) => set(i, { nameAr: e.target.value })} />
            <TextField label={t('jv.criteria.weight')} required inputMode="decimal" value={r.weight} maxLength={6} onChange={(e) => set(i, { weight: e.target.value })} dir="ltr" />
            <button type="button" className={btn.ghost} onClick={() => setRows((xs) => xs.filter((_, j) => j !== i))} disabled={rows.length === 1} aria-label={t('jv.criteria.edit.remove', { n: i + 1 })}>
              <Trash2 aria-hidden="true" className="size-4" />
            </button>
          </fieldset>
        ))}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button type="button" className={btn.secondary} onClick={() => setRows((xs) => [...xs, { key: '', name: '', nameAr: '', weight: '' }])}>
            <Plus aria-hidden="true" className="size-4" />
            {t('jv.criteria.edit.add')}
          </button>
          <p className={sum === 100 ? 'text-sm text-success' : 'text-sm text-danger'} aria-live="polite" data-testid="criteria-sum">
            {t('jv.criteria.edit.sum', { sum: formatNumber(sum) })}
          </p>
        </div>
        <TextAreaField label={t('jv.criteria.note')} value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} />
      </div>
    </JvCommandDialog>
  );
}

function CriteriaPanel() {
  const { t, formatDateTime } = useI18n();
  const { can } = useProjectContext();
  const loc = useLocalized();
  const criteria = useCriteria();
  const [open, setOpen] = useState(false);
  const set = criteria.data?.criteriaSet ?? null;
  return (
    <Panel
      title={t('jv.criteria.title')}
      description={t('jv.criteria.hint')}
      testId="criteria-panel"
      actions={
        can('jv.partner.manage') ? (
          <button type="button" className={btn.secondary} onClick={() => setOpen(true)} data-testid="edit-criteria">
            <Scale aria-hidden="true" className="size-4" />
            {set ? t('jv.criteria.edit.action') : t('jv.criteria.edit.define')}
          </button>
        ) : null
      }
    >
      {criteria.isLoading ? null : !set ? (
        <p className="text-sm text-muted">{t('jv.criteria.none')}</p>
      ) : (
        <>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {set.criteria.map((c) => (
              <li key={c.key} className="flex items-center justify-between gap-2 rounded-md border border-line px-3 py-2 text-sm">
                <span dir="auto">{loc(c.name, c.nameAr)}</span>
                <span className="tabular shrink-0 font-semibold" dir="ltr">
                  {t('jv.criteria.weightValue', { weight: c.weight })}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted">
            {t('jv.criteria.total', { total: set.totalWeight })} · {t('jv.common.updatedAt', { at: formatDateTime(set.updatedAt) })}
          </p>
          {set.note ? (
            <p className="mt-1 text-xs text-muted" dir="auto">
              {set.note}
            </p>
          ) : null}
        </>
      )}
      {open ? <CriteriaDialog current={set} onClose={() => setOpen(false)} /> : null}
    </Panel>
  );
}

/** Partner longlist / shortlist (REQ-JV-002): no default names; stages move only through the engagement commands. */
export default function PartnersPage() {
  const { t, tStatus } = useI18n();
  const { projectId, can } = useProjectContext();
  const { values, page, set, clear, active } = useUrlState(FILTERS);
  const [createOpen, setCreateOpen] = useState(false);
  const base = jvHref(projectId);
  const list = usePartners({
    page,
    pageSize: PAGE_SIZE,
    q: values.q || undefined,
    stage: (values.stage || undefined) as PartnerStage | undefined,
    shortlisted: (values.shortlisted || undefined) as 'true' | 'false' | undefined,
  });

  const columns: Column<Partner>[] = [
    {
      key: 'code',
      header: t('jv.partners.columns.code'),
      isRowHeader: true,
      sortValue: (p) => p.code,
      cell: (p) => (
        <span className="flex flex-wrap items-center gap-1">
          <Link href={`${base}/partners/${p.id}`} className={cx(btn.link, 'whitespace-nowrap')} dir="ltr" data-testid="partner-link">
            {p.code}
          </Link>
          {p.isDemo ? <DemoBadge /> : null}
        </span>
      ),
    },
    { key: 'name', header: t('jv.partners.columns.name'), sortValue: (p) => p.name, className: 'min-w-48', cell: (p) => <span dir="auto">{p.name}</span> },
    { key: 'stage', header: t('jv.partners.columns.stage'), sortValue: (p) => PARTNER_STAGES.indexOf(p.stage), cell: (p) => <StatusBadge enumName="partnerStages" value={p.stage} /> },
    {
      key: 'list',
      header: t('jv.partners.columns.list'),
      sortValue: (p) => (p.shortlisted ? 0 : 1),
      cell: (p) => <StatusBadge enumName="partnerStages" value={p.shortlisted ? 'shortlisted' : 'longlist'} tone={p.shortlisted ? 'info' : 'neutral'} label={p.shortlisted ? t('jv.partners.shortlisted') : t('jv.partners.longlist')} />,
    },
    {
      key: 'outreach',
      header: t('jv.partners.columns.outreach'),
      cell: (p) => <StatusBadge enumName="approvalRequestStatuses" value={p.outreachApproved ? 'approved' : 'none'} tone={p.outreachApproved ? 'success' : 'neutral'} label={p.outreachApproved ? t('jv.partners.outreachApproved') : t('jv.partners.outreachNotApproved')} />,
    },
    { key: 'nda', header: t('jv.partners.columns.nda'), cell: (p) => <StatusBadge enumName="ndaStatuses" value={p.ndaStatus} tone={p.ndaStatus === 'executed' ? 'success' : 'neutral'} /> },
    {
      key: 'score',
      header: t('jv.partners.columns.score'),
      sortValue: (p) => (p.weightedScore === null ? null : Number(p.weightedScore)),
      cell: (p) => (p.weightedScore === null ? <span className="text-xs text-muted">{t('jv.partners.notScored')}</span> : <span className="tabular" dir="ltr">{p.weightedScore}</span>),
    },
    { key: 'classification', header: t('jv.common.classification'), cell: (p) => <span className="text-xs">{tStatus('classifications', p.classification)}</span> },
  ];

  return (
    <>
      <PageHeader
        title={t('jv.partners.title')}
        description={t('jv.partners.subtitle')}
        actions={
          can('jv.partner.manage') ? (
            <button type="button" className={btn.primary} onClick={() => setCreateOpen(true)} data-testid="create-partner">
              <Plus aria-hidden="true" className="size-4" />
              {t('jv.partners.create.action')}
            </button>
          ) : null
        }
      />
      <div className="space-y-4">
        <NdaNoAccessNotice />
        <FilterBar onClear={clear} active={active}>
          <SearchInput className="w-full sm:w-64" label={t('jv.partners.search')} value={values.q} onChange={(v) => set({ q: v })} />
          <FilterSelect label={t('jv.partners.filterStage')} value={values.stage} onChange={(v) => set({ stage: v })} options={PARTNER_STAGES.map((s) => ({ value: s, label: tStatus('partnerStages', s) }))} testId="filter-stage" />
          <FilterSelect
            label={t('jv.partners.filterList')}
            value={values.shortlisted}
            onChange={(v) => set({ shortlisted: v })}
            options={[
              { value: 'true', label: t('jv.partners.shortlisted') },
              { value: 'false', label: t('jv.partners.longlistOnly') },
            ]}
            testId="filter-shortlisted"
          />
        </FilterBar>
        <DataTable
          caption={t('jv.partners.title')}
          columns={columns}
          rows={list.data?.items}
          rowKey={(p) => p.id}
          isLoading={list.isLoading}
          error={list.error}
          onRetry={() => list.refetch()}
          emptyTitle={active ? t('jv.partners.emptySearch') : t('jv.partners.empty')}
          emptyHint={active ? undefined : t('jv.partners.emptyHint')}
          pagination={list.data ? { page, pageSize: PAGE_SIZE, total: list.data.total, onPageChange: (p) => set({ page: p }) } : undefined}
          testId="partners-table"
        />
        <CriteriaPanel />
      </div>
      {createOpen ? <CreatePartnerDialog onClose={() => setCreateOpen(false)} /> : null}
    </>
  );
}
