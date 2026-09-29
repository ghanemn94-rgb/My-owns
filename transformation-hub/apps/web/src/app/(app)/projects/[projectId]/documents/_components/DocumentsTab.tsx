'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { FilePlus2 } from 'lucide-react';
import { useState } from 'react';
import { documentsRoutes } from '@hub/contracts';
import { CLASSIFICATIONS, DOCUMENT_KINDS } from '@hub/domain';
import { DataTable, type Column } from '@/components/DataTable';
import { DemoBadge } from '@/components/DemoBadge';
import { SearchInput } from '@/components/SearchInput';
import { StatusBadge } from '@/components/StatusBadge';
import { btn, cx, input } from '@/components/ui';
import { EM_DASH, useI18n } from '@/i18n/provider';
import { api } from '@/lib/api';
import { dqk, formatBytes, useUploadPolicy, type DocumentSummary, type SearchHit } from '@/lib/documents';
import { useProjectContext } from '@/lib/project-context';
import { ClassificationBadge, HoldBadge, RoomBadge, ScanNotice, Snippet } from './bits';
import { CreateDocumentDialog } from './CreateDocumentDialog';

const PAGE_SIZE = 25;

export function DocumentsTab() {
  const { t, tStatus, formatDateTime, formatNumber, locale } = useI18n();
  const { projectId, can } = useProjectContext();
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('');
  const [classification, setClassification] = useState('');
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const policy = useUploadPolicy(projectId);
  const filters = { kind: (kind || undefined) as (typeof DOCUMENT_KINDS)[number] | undefined, classification: (classification || undefined) as (typeof CLASSIFICATIONS)[number] | undefined };

  const list = useQuery({
    queryKey: dqk.list(projectId, { page, ...filters }),
    enabled: !q,
    queryFn: ({ signal }) => api(documentsRoutes.listDocuments, { params: { projectId }, query: { page, pageSize: PAGE_SIZE, ...filters }, signal }),
    placeholderData: (prev) => prev,
  });
  const search = useQuery({
    queryKey: dqk.search(projectId, { q, page, ...filters }),
    enabled: !!q,
    queryFn: ({ signal }) => api(documentsRoutes.searchDocuments, { params: { projectId }, query: { q, page, pageSize: PAGE_SIZE, ...filters }, signal }),
    placeholderData: (prev) => prev,
  });
  const reset = (fn: () => void) => {
    fn();
    setPage(1);
  };
  const href = (id: string) => `/projects/${projectId}/documents/${id}`;

  const listColumns: Column<DocumentSummary>[] = [
    {
      key: 'title',
      header: t('documents.list.columns.title'),
      isRowHeader: true,
      cell: (d) => (
        <span className="flex flex-wrap items-center gap-1.5">
          <Link href={href(d.id)} className={btn.link} dir="auto" data-testid="document-link">
            {d.title}
          </Link>
          {d.isDemo ? <DemoBadge /> : null}
          {d.legalHold ? <HoldBadge /> : null}
          <RoomBadge roomId={d.roomId} />
        </span>
      ),
    },
    { key: 'kind', header: t('documents.list.columns.kind'), cell: (d) => tStatus('documentKinds', d.kind) },
    { key: 'classification', header: t('documents.list.columns.classification'), cell: (d) => <ClassificationBadge value={d.classification} /> },
    {
      key: 'version',
      header: t('documents.list.columns.version'),
      cell: (d) =>
        d.currentVersion ? (
          <span className="flex flex-col">
            <span>{t('documents.versions.label', { version: d.currentVersion.versionNo })}</span>
            <span className="text-xs text-muted" dir="auto">
              {d.currentVersion.filename} · {formatBytes(d.currentVersion.sizeBytes, locale)}
            </span>
          </span>
        ) : (
          <span className="text-muted">{t('documents.list.noVersion')}</span>
        ),
    },
    { key: 'scan', header: t('documents.list.columns.scan'), cell: (d) => (d.currentVersion ? <StatusBadge enumName="scanStatuses" value={d.currentVersion.scanStatus} /> : EM_DASH) },
    { key: 'extraction', header: t('documents.list.columns.extraction'), cell: (d) => (d.currentVersion ? <StatusBadge enumName="extractionStatuses" value={d.currentVersion.extractionStatus} /> : EM_DASH) },
    { key: 'updated', header: t('documents.list.columns.updated'), cell: (d) => <span className="tabular whitespace-nowrap">{formatDateTime(d.updatedAt)}</span> },
  ];

  const searchColumns: Column<SearchHit>[] = [
    {
      key: 'title',
      header: t('documents.list.columns.title'),
      isRowHeader: true,
      cell: (h) => (
        <span className="flex flex-col gap-1">
          <Link href={href(h.documentId)} className={btn.link} dir="auto" data-testid="search-hit">
            {h.title}
          </Link>
          {h.section ? (
            <span className="text-xs text-muted" dir="auto">
              {t('documents.list.section', { section: h.section })}
            </span>
          ) : null}
          <Snippet text={h.snippet} />
        </span>
      ),
    },
    { key: 'match', header: t('documents.list.columns.match'), cell: (h) => (
        <span className="inline-flex rounded-full border border-info/30 bg-info-soft px-2 py-0.5 text-xs font-medium text-info" data-matched-in={h.matchedIn}>
          {t(`documents.list.matchedIn.${h.matchedIn}`)}
        </span>
      ),
    },
    { key: 'kind', header: t('documents.list.columns.kind'), cell: (h) => tStatus('documentKinds', h.kind) },
    { key: 'classification', header: t('documents.list.columns.classification'), cell: (h) => <ClassificationBadge value={h.classification} /> },
  ];

  const active = q ? search : list;
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
        <SearchInput className="lg:flex-1" label={t('documents.list.search')} value={q} onChange={(v) => reset(() => setQ(v))} />
        <div className="grid grid-cols-2 gap-3 lg:w-96">
          <select aria-label={t('documents.list.kindFilter')} className={input} value={kind} onChange={(e) => reset(() => setKind(e.target.value))} data-testid="filter-kind">
            <option value="">{t('documents.list.anyKind')}</option>
            {DOCUMENT_KINDS.map((k) => (
              <option key={k} value={k}>
                {tStatus('documentKinds', k)}
              </option>
            ))}
          </select>
          <select aria-label={t('documents.list.classificationFilter')} className={input} value={classification} onChange={(e) => reset(() => setClassification(e.target.value))}>
            <option value="">{t('documents.list.anyClassification')}</option>
            {CLASSIFICATIONS.map((c) => (
              <option key={c} value={c}>
                {tStatus('classifications', c)}
              </option>
            ))}
          </select>
        </div>
        {can('documents.document.upload') ? (
          <button type="button" className={cx(btn.primary, 'shrink-0')} onClick={() => setCreateOpen(true)} data-testid="document-create">
            <FilePlus2 aria-hidden="true" className="size-4" />
            {t('documents.create.action')}
          </button>
        ) : null}
      </div>
      <p className="text-xs text-muted">{t('documents.list.searchNote')}</p>
      <ScanNotice policy={policy.data} />
      {q ? (
        <DataTable
          caption={t('documents.list.searchCaption')}
          columns={searchColumns}
          rows={search.data?.items}
          rowKey={(h) => h.documentId}
          isLoading={search.isLoading}
          error={search.error}
          onRetry={() => search.refetch()}
          emptyTitle={t('documents.list.emptySearch')}
          pagination={search.data ? { page, pageSize: PAGE_SIZE, total: search.data.total, onPageChange: setPage } : undefined}
          testId="documents-search-table"
        />
      ) : (
        <DataTable
          caption={t('documents.title')}
          columns={listColumns}
          rows={list.data?.items}
          rowKey={(d) => d.id}
          isLoading={list.isLoading}
          error={list.error}
          onRetry={() => list.refetch()}
          emptyTitle={kind || classification ? t('documents.list.emptyFiltered') : t('documents.list.empty')}
          emptyHint={t('documents.list.emptyHint')}
          pagination={list.data ? { page, pageSize: PAGE_SIZE, total: list.data.total, onPageChange: setPage } : undefined}
          testId="documents-table"
        />
      )}
      {active.data ? (
        <p className="text-xs text-muted" data-testid="documents-total">
          {t('documents.list.total', { count: formatNumber(active.data.total) })}
        </p>
      ) : null}
      {can('documents.document.upload') ? <CreateDocumentDialog open={createOpen} onClose={() => setCreateOpen(false)} /> : null}
    </div>
  );
}
