'use client';

import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { documentsRoutes } from '@hub/contracts';
import { EXTRACTION_STATUSES, SOURCE_TYPES, type Classification } from '@hub/domain';
import { ConfirmCommandDialog } from '@/components/ConfirmCommandDialog';
import { DataTable, type Column } from '@/components/DataTable';
import { DemoBadge } from '@/components/DemoBadge';
import { SelectField, TextAreaField, TextField } from '@/components/Field';
import { SearchInput } from '@/components/SearchInput';
import { StatusBadge } from '@/components/StatusBadge';
import { useToast } from '@/components/Toast';
import { btn } from '@/components/ui';
import { EM_DASH, useI18n } from '@/i18n/provider';
import { api } from '@/lib/api';
import { assignableClassifications, dqk, type Source } from '@/lib/documents';
import { useProjectContext } from '@/lib/project-context';
import { ClassificationBadge } from './bits';

const PAGE_SIZE = 25;
type SourceType = (typeof SOURCE_TYPES)[number];
type ExtractionStatus = (typeof EXTRACTION_STATUSES)[number];

function CreateSourceDialog({ open, onClose, sources }: { open: boolean; onClose: () => void; sources: Source[] }) {
  const { t, tStatus } = useI18n();
  const { projectId, me } = useProjectContext();
  const router = useRouter();
  const queryClient = useQueryClient();
  const toast = useToast();
  const classes = assignableClassifications(me.user.clearance as Classification);
  const [f, setF] = useState({
    sourceType: 'excel' as SourceType,
    filename: '',
    sourceVersion: '',
    ownerLabel: '',
    reportDate: '',
    asOfDate: '',
    extractionDate: '',
    extractionStatus: 'not_performed' as ExtractionStatus,
    extractionNote: '',
    supersedesSourceId: '',
    classification: (classes.includes('confidential') ? 'confidential' : classes[classes.length - 1]) as Classification,
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const opt = (v: string) => (v.trim() ? v.trim() : undefined);
  const superseded = sources.find((s) => s.id === f.supersedesSourceId);

  return (
    <ConfirmCommandDialog
      open={open}
      onClose={onClose}
      title={t('documents.sources.createTitle')}
      confirmLabel={t('documents.sources.createConfirm')}
      noteMode="none"
      consequences={[
        t('documents.sources.createEffect'),
        superseded ? t('documents.sources.supersedesEffect', { code: superseded.code }) : t('documents.sources.newEffect'),
        t('common.command.audited'),
      ]}
      onConfirm={async () => {
        const res = await api(documentsRoutes.createSource, {
          params: { projectId },
          body: {
            sourceType: f.sourceType,
            extractionStatus: f.extractionStatus,
            classification: f.classification,
            filename: opt(f.filename),
            sourceVersion: opt(f.sourceVersion),
            ownerLabel: opt(f.ownerLabel),
            reportDate: opt(f.reportDate),
            asOfDate: opt(f.asOfDate),
            extractionDate: opt(f.extractionDate),
            extractionNote: opt(f.extractionNote),
            supersedesSourceId: opt(f.supersedesSourceId),
          },
        });
        await queryClient.invalidateQueries({ queryKey: dqk.sourcesAll(projectId) });
        toast.show('success', t('documents.sources.created', { code: res.code }));
        onClose();
        router.push(`/projects/${projectId}/documents/sources/${res.id}`);
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField label={t('documents.sources.columns.type')} required value={f.sourceType} onChange={(e) => set('sourceType', e.target.value as SourceType)}>
          {SOURCE_TYPES.map((s) => (
            <option key={s} value={s}>
              {tStatus('sourceTypes', s)}
            </option>
          ))}
        </SelectField>
        <SelectField label={t('documents.create.classification')} required value={f.classification} onChange={(e) => set('classification', e.target.value as Classification)}>
          {classes.map((c) => (
            <option key={c} value={c}>
              {tStatus('classifications', c)}
            </option>
          ))}
        </SelectField>
        <TextField label={t('documents.sources.columns.filename')} value={f.filename} maxLength={300} onChange={(e) => set('filename', e.target.value)} className="sm:col-span-2" />
        <TextField label={t('documents.sources.fields.sourceVersion')} value={f.sourceVersion} maxLength={32} onChange={(e) => set('sourceVersion', e.target.value)} />
        <TextField label={t('documents.sources.fields.owner')} value={f.ownerLabel} maxLength={200} onChange={(e) => set('ownerLabel', e.target.value)} hint={t('documents.sources.fields.ownerHint')} />
        <TextField label={t('documents.sources.columns.reportDate')} type="date" dir="ltr" value={f.reportDate} onChange={(e) => set('reportDate', e.target.value)} hint={t('documents.sources.fields.reportDateHint')} />
        <TextField label={t('documents.sources.columns.asOfDate')} type="date" dir="ltr" value={f.asOfDate} onChange={(e) => set('asOfDate', e.target.value)} hint={t('documents.sources.fields.asOfDateHint')} />
        <TextField label={t('documents.sources.columns.extractionDate')} type="date" dir="ltr" value={f.extractionDate} onChange={(e) => set('extractionDate', e.target.value)} />
        <SelectField label={t('documents.sources.columns.extraction')} required value={f.extractionStatus} onChange={(e) => set('extractionStatus', e.target.value as ExtractionStatus)}>
          {EXTRACTION_STATUSES.map((s) => (
            <option key={s} value={s}>
              {tStatus('extractionStatuses', s)}
            </option>
          ))}
        </SelectField>
        <TextAreaField label={t('documents.sources.fields.extractionNote')} value={f.extractionNote} maxLength={2000} onChange={(e) => set('extractionNote', e.target.value)} className="sm:col-span-2" />
        <SelectField label={t('documents.sources.fields.supersedes')} value={f.supersedesSourceId} onChange={(e) => set('supersedesSourceId', e.target.value)} hint={t('documents.sources.fields.supersedesHint')} className="sm:col-span-2">
          <option value="">{t('documents.sources.fields.supersedesNone')}</option>
          {sources
            .filter((s) => !s.supersededBySourceId)
            .map((s) => (
              <option key={s.id} value={s.id}>
                {s.code} — {s.filename ?? tStatus('sourceTypes', s.sourceType)}
              </option>
            ))}
        </SelectField>
      </div>
    </ConfirmCommandDialog>
  );
}

export function SourcesTab() {
  const { t, tStatus, formatDate, formatNumber } = useI18n();
  const { projectId, can } = useProjectContext();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const sources = useQuery({
    queryKey: dqk.sources(projectId, { q, page }),
    queryFn: ({ signal }) => api(documentsRoutes.listSources, { params: { projectId }, query: { q: q || undefined, page, pageSize: PAGE_SIZE }, signal }),
    placeholderData: (prev) => prev,
  });
  const href = (id: string) => `/projects/${projectId}/documents/sources/${id}`;
  const columns: Column<Source>[] = [
    {
      key: 'code',
      header: t('documents.sources.columns.code'),
      isRowHeader: true,
      cell: (s) => (
        <span className="flex flex-wrap items-center gap-1.5">
          <Link href={href(s.id)} className={btn.link} dir="ltr" data-testid="source-link">
            {s.code}
          </Link>
          {s.isDemo ? <DemoBadge /> : null}
        </span>
      ),
    },
    { key: 'type', header: t('documents.sources.columns.type'), cell: (s) => tStatus('sourceTypes', s.sourceType) },
    {
      key: 'filename',
      header: t('documents.sources.columns.filename'),
      cell: (s) => (
        <span dir="auto" className="break-all">
          {s.filename ?? EM_DASH}
        </span>
      ),
    },
    { key: 'reportDate', header: t('documents.sources.columns.reportDate'), cell: (s) => formatDate(s.reportDate) },
    { key: 'asOfDate', header: t('documents.sources.columns.asOfDate'), cell: (s) => formatDate(s.asOfDate) },
    { key: 'extractionDate', header: t('documents.sources.columns.extractionDate'), cell: (s) => formatDate(s.extractionDate) },
    { key: 'extraction', header: t('documents.sources.columns.extraction'), cell: (s) => <StatusBadge enumName="extractionStatuses" value={s.extractionStatus} /> },
    { key: 'classification', header: t('documents.list.columns.classification'), cell: (s) => <ClassificationBadge value={s.classification} /> },
    { key: 'claims', header: t('documents.sources.columns.claims'), cell: (s) => <span className="tabular">{formatNumber(s.claimCount)}</span> },
    {
      key: 'superseded',
      header: t('documents.sources.columns.status'),
      cell: (s) => (s.supersededBySourceId ? <span className="text-xs text-muted">{t('documents.sources.superseded')}</span> : <span className="text-xs">{t('documents.sources.current')}</span>),
    },
  ];
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">{t('documents.sources.intro')}</p>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <SearchInput className="sm:flex-1" label={t('documents.sources.search')} value={q} onChange={(v) => { setQ(v); setPage(1); }} />
        {can('documents.source.manage') ? (
          <button type="button" className={btn.primary} onClick={() => setCreateOpen(true)} data-testid="source-create">
            <Plus aria-hidden="true" className="size-4" />
            {t('documents.sources.create')}
          </button>
        ) : null}
      </div>
      <DataTable
        caption={t('documents.tabs.sources')}
        columns={columns}
        rows={sources.data?.items}
        rowKey={(s) => s.id}
        isLoading={sources.isLoading}
        error={sources.error}
        onRetry={() => sources.refetch()}
        emptyTitle={t('documents.sources.empty')}
        pagination={sources.data ? { page, pageSize: PAGE_SIZE, total: sources.data.total, onPageChange: setPage } : undefined}
        testId="sources-table"
      />
      {can('documents.source.manage') ? <CreateSourceDialog open={createOpen} onClose={() => setCreateOpen(false)} sources={sources.data?.items ?? []} /> : null}
    </div>
  );
}
