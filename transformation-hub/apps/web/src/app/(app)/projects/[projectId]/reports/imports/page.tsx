'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Upload } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { IMPORT_STATUSES, IMPORT_TARGETS, CLASSIFICATIONS, clearanceAllows, type Classification } from '@hub/domain';
import { ApiErrorNotice } from '@/components/ApiErrorNotice';
import { DataTable, type Column } from '@/components/DataTable';
import { DemoBadge } from '@/components/DemoBadge';
import { PageHeader } from '@/components/PageHeader';
import { RestrictedState } from '@/components/RestrictedState';
import { StatusBadge } from '@/components/StatusBadge';
import { useToast } from '@/components/Toast';
import { btn, card, cx, hint, input, label as labelCls } from '@/components/ui';
import { useI18n, type MessageKey } from '@/i18n/provider';
import { formatBytes } from '@/lib/documents';
import { importsHref, uploadImport, useImportPolicy, useImports, useImportsRefresh, type ImportSummary, type ImportTarget } from '@/lib/imports';
import { useProjectContext } from '@/lib/project-context';
import { FilterBar, FilterSelect, useUrlState } from '../_components/rp';
import { HonestyPanel, importTone } from './_components/imp';

const PAGE_SIZE = 25;
const FILTERS = ['status', 'target'] as const;

/**
 * Import wizard — batch history and a new upload (spec §17, screen 16b imports part; REQ-INT-001/002). The file goes
 * through the safe file path and is kept as a source with its checksum; parsing runs in an isolated process; nothing is
 * created before a second person approves the preview.
 */
export default function ImportsPage() {
  const { t, tStatus, formatDateTime, formatNumber } = useI18n();
  const { projectId, can } = useProjectContext();
  const { values, page, set, clear, active } = useUrlState(FILTERS);
  const list = useImports({ page, pageSize: PAGE_SIZE, status: (values.status || undefined) as ImportSummary['status'] | undefined, target: (values.target || undefined) as ImportTarget | undefined });
  const policy = useImportPolicy();
  const canRead = can('imports.batch.read');
  const canCreate = can('imports.batch.create');
  const columns: Column<ImportSummary>[] = [
    {
      key: 'code',
      header: t('imports.history.columns.code'),
      isRowHeader: true,
      cell: (b) => (
        <span className="flex flex-wrap items-center gap-1.5">
          <Link href={importsHref(projectId, b.id)} className={btn.link} data-testid="import-link" aria-label={t('imports.history.open', { code: b.code })}>
            {b.code}
          </Link>
          {b.isDemo ? <DemoBadge /> : null}
        </span>
      ),
    },
    { key: 'target', header: t('imports.history.columns.target'), cell: (b) => t(`imports.targets.${b.target}` as MessageKey) },
    { key: 'file', header: t('imports.history.columns.file'), cell: (b) => <bdi className="break-all" data-user-text>{b.filename}</bdi> },
    { key: 'status', header: t('imports.history.columns.status'), cell: (b) => <StatusBadge enumName="importStatuses" value={b.status} tone={importTone(b.status)} /> },
    { key: 'rows', header: t('imports.history.columns.rows'), cell: (b) => <span className="tabular">{b.summary['rows'] !== undefined ? formatNumber(b.summary['rows']) : '—'}</span> },
    { key: 'classification', header: t('imports.history.columns.classification'), cell: (b) => <StatusBadge enumName="classifications" value={b.classification} tone="neutral" /> },
    { key: 'uploadedBy', header: t('imports.history.columns.uploadedBy'), cell: (b) => <span dir="auto">{b.createdByName ?? '—'}</span> },
    { key: 'uploadedAt', header: t('imports.history.columns.uploadedAt'), cell: (b) => <span className="whitespace-nowrap">{formatDateTime(b.createdAt)}</span> },
  ];
  if (!canRead) return <RestrictedState showHomeLink={false} />;
  return (
    <>
      <PageHeader title={t('imports.title')} description={t('imports.subtitle')} />
      <div className="mb-6 grid gap-4 lg:grid-cols-[1fr_22rem]">
        {canCreate ? <NewImport /> : <p className="text-sm text-muted">{t('imports.upload.notAllowed')}</p>}
        <HonestyPanel policy={policy.data} />
      </div>
      <h2 className="mb-3 text-lg font-semibold">{t('imports.history.title')}</h2>
      <FilterBar onClear={clear} active={active}>
        <FilterSelect label={t('imports.history.filterStatus')} value={values.status} onChange={(v) => set({ status: v })} options={IMPORT_STATUSES.map((s) => ({ value: s, label: tStatus('importStatuses', s) }))} testId="filter-import-status" />
        <FilterSelect label={t('imports.history.filterTarget')} value={values.target} onChange={(v) => set({ target: v })} options={IMPORT_TARGETS.map((x) => ({ value: x, label: t(`imports.targets.${x}` as MessageKey) }))} testId="filter-import-target" />
      </FilterBar>
      <DataTable
        caption={t('imports.history.caption')}
        columns={columns}
        rows={list.data?.items}
        rowKey={(b) => b.id}
        isLoading={list.isLoading}
        error={list.error}
        onRetry={() => list.refetch()}
        emptyTitle={active ? t('imports.history.emptyFiltered') : t('imports.history.empty')}
        emptyHint={!active && canCreate ? t('imports.history.emptyHint') : undefined}
        pagination={list.data ? { page, pageSize: PAGE_SIZE, total: list.data.total, onPageChange: (p) => set({ page: p }) } : undefined}
        className={cx(list.isFetching && list.data && 'opacity-80')}
        testId="imports-table"
      />
    </>
  );
}

function NewImport() {
  const { t, tStatus, locale } = useI18n();
  const { projectId, me } = useProjectContext();
  const router = useRouter();
  const toast = useToast();
  const refresh = useImportsRefresh();
  const policy = useImportPolicy();
  const id = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [target, setTarget] = useState<ImportTarget>('risk');
  const allowedClassifications = CLASSIFICATIONS.filter((c) => clearanceAllows(me.user.clearance as Classification, c));
  // Default: Confidential when within the uploader's clearance, otherwise the highest classification they hold.
  const [classification, setClassification] = useState<string>(() => (allowedClassifications.includes('confidential') ? 'confidential' : (allowedClassifications[allowedClassifications.length - 1] ?? 'internal')));
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<unknown>(null);
  const types = policy.data?.targets.find((x) => x.target === target)?.fileTypes ?? [];
  const tooLarge = !!file && !!policy.data && file.size > policy.data.maxUploadBytes;
  const start = async () => {
    if (!file || tooLarge) return;
    setError(null);
    setProgress(0);
    try {
      const b = await uploadImport(projectId, file, { target, classification }, { onProgress: setProgress });
      await refresh();
      if (b.status === 'quarantined') toast.show('error', t('imports.upload.quarantined'));
      else toast.show('success', t('imports.upload.done', { code: b.code }));
      router.push(importsHref(projectId, b.id));
    } catch (e) {
      setError(e);
    } finally {
      setProgress(null);
    }
  };
  return (
    <section aria-labelledby={`${id}-h`} className={cx(card, 'space-y-4 p-4')} data-testid="new-import">
      <h2 id={`${id}-h`} className="text-lg font-semibold">
        {t('imports.upload.title')}
      </h2>
      <fieldset>
        <legend className={labelCls}>{t('imports.upload.target')}</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {(policy.data?.targets ?? []).map((x) => (
            <label key={x.target} className={cx('flex cursor-pointer gap-3 rounded-md border p-3', target === x.target ? 'border-primary bg-primary-soft' : 'border-line hover:bg-surface-muted')}>
              <input type="radio" name="import-target" className="mt-1 size-4 accent-[var(--hub-primary)]" checked={target === x.target} onChange={() => setTarget(x.target)} data-testid={`import-target-${x.target}`} />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-ink">{t(`imports.targets.${x.target}` as MessageKey)}</span>
                <span className="block text-xs text-muted">{t(`imports.targetHints.${x.target}` as MessageKey)}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor={`${id}-c`} className={labelCls}>
            {t('imports.upload.classification')}
          </label>
          <select id={`${id}-c`} className={cx(input, 'mt-1')} value={classification} onChange={(e) => setClassification(e.target.value)} data-testid="import-classification">
            {allowedClassifications.map((c) => (
              <option key={c} value={c}>
                {tStatus('classifications', c)}
              </option>
            ))}
          </select>
          <p className={hint}>{t('imports.upload.classificationHint')}</p>
        </div>
        <div>
          <label htmlFor={`${id}-f`} className={labelCls}>
            {t('imports.upload.file')}
          </label>
          <input
            ref={fileRef}
            id={`${id}-f`}
            type="file"
            accept={types.map((x) => (x === 'jpeg' ? '.jpg,.jpeg' : `.${x}`)).join(',')}
            className={cx(input, 'mt-1 file:me-3 file:rounded file:border-0 file:bg-primary-soft file:px-2 file:py-1 file:text-primary')}
            onChange={(e) => {
              setError(null);
              setFile(e.target.files?.[0] ?? null);
            }}
            aria-invalid={tooLarge}
            aria-describedby={`${id}-fh`}
            data-testid="import-file"
          />
          <p id={`${id}-fh`} className={hint}>
            {policy.data ? t('imports.upload.accepted', { types: types.map((x) => x.toUpperCase()).join(', '), size: formatBytes(policy.data.maxUploadBytes, locale) }) : null}
          </p>
          {tooLarge ? (
            <p role="alert" className="mt-1 text-xs font-medium text-danger">
              {t('imports.upload.tooLarge', { limit: formatBytes(policy.data!.maxUploadBytes, locale) })}
            </p>
          ) : null}
        </div>
      </div>
      {progress !== null ? (
        <div className="h-2 w-full overflow-hidden rounded bg-surface-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)} aria-label={t('imports.upload.title')}>
          <div className="h-full bg-primary transition-all" style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
      ) : null}
      <button type="button" className={btn.primary} onClick={start} disabled={!file || tooLarge || progress !== null} data-testid="import-upload">
        <Upload aria-hidden="true" className="size-4" />
        {progress !== null ? t('common.actions.working') : t('imports.upload.start')}
      </button>
      <ApiErrorNotice error={error} />
    </section>
  );
}
