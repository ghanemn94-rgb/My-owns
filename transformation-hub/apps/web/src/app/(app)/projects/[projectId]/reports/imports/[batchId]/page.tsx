'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { importsRoutes, type ServerMessageDto } from '@hub/contracts';
import { IMPORT_ROW_ACTIONS } from '@hub/domain';
import { ApiErrorNotice } from '@/components/ApiErrorNotice';
import { ConfirmCommandDialog } from '@/components/ConfirmCommandDialog';
import { DemoBadge } from '@/components/DemoBadge';
import { ErrorState } from '@/components/ErrorState';
import { LoadingState } from '@/components/LoadingState';
import { PageHeader } from '@/components/PageHeader';
import { Pagination } from '@/components/Pagination';
import { ScrollRegion } from '@/components/ScrollRegion';
import { StatusBadge } from '@/components/StatusBadge';
import { useToast } from '@/components/Toast';
import { btn, card, cx, hint, input, label as labelCls } from '@/components/ui';
import { useI18n, type MessageKey } from '@/i18n/provider';
import { api } from '@/lib/api';
import { formatBytes } from '@/lib/documents';
import { importsHref, useImport, useImportMessages, useImportRows, useImportsRefresh, type ImportDetail, type ImportRow } from '@/lib/imports';
import { useProjectContext } from '@/lib/project-context';
import { Callout, Facts, Panel } from '../../_components/rp';
import { ImportStepper, importTone } from '../_components/imp';

const ROW_PAGE = 50;

/**
 * One import batch through the wizard (REQ-INT-001..003, REQ-INT-015, REQ-SRC-009): file identity and findings → column
 * mapping → preview / comparison with the current records → submission → item-by-item approval by a second person →
 * records produced (rollback where feasible). Every command is re-checked by the API.
 */
export default function ImportBatchPage() {
  const { batchId } = useParams<{ batchId: string }>();
  const { t, tStatus, formatDateTime, locale } = useI18n();
  const { projectId } = useProjectContext();
  const q = useImport(batchId);
  const msg = useImportMessages();
  if (q.isLoading) return <LoadingState />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const b = q.data;
  const isDocument = b.target === 'document_claims';
  return (
    <>
      <PageHeader
        eyebrow={
          <Link href={importsHref(projectId)} className={btn.link}>
            {t('imports.detail.back')}
          </Link>
        }
        title={
          <span>
            {b.code} — <bdi data-user-text>{b.filename}</bdi>
          </span>
        }
        documentTitle={`${b.code} — ${t('imports.title')}`}
        badges={
          <>
            <StatusBadge enumName="importStatuses" value={b.status} tone={importTone(b.status)} size="md" />
            <StatusBadge enumName="classifications" value={b.classification} tone="neutral" />
            <span className="text-sm text-muted">{t(`imports.targets.${b.target}` as MessageKey)}</span>
            {b.isDemo ? <DemoBadge /> : null}
          </>
        }
      />
      <ImportStepper status={b.status} document={isDocument} />
      <StatusCallout b={b} />
      <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
        <div className="min-w-0 space-y-4">
          {b.canMap ? <MappingPanel b={b} /> : null}
          {['validated', 'submitted', 'applied', 'rolled_back', 'rejected', 'cancelled'].includes(b.status) ? <PreviewPanel b={b} /> : null}
          {b.outputs.length ? <OutputsPanel b={b} /> : null}
        </div>
        <div className="space-y-4">
          <Panel title={t('imports.detail.file')} testId="import-file-panel">
            <Facts
              items={[
                { label: t('imports.detail.filename'), value: <bdi className="break-all" data-user-text>{b.filename}</bdi> },
                { label: t('imports.detail.type'), value: b.fileType === 'unknown' ? t('imports.detail.typeUnknown') : b.fileType.toUpperCase() },
                { label: t('imports.detail.size'), value: formatBytes(b.sizeBytes, locale) },
                { label: t('imports.detail.sha256'), value: <code className="text-xs break-all" dir="ltr">{b.sha256}</code>, wide: true, testId: 'import-sha256' },
                {
                  label: t('imports.detail.source'),
                  value: b.sourceId ? (
                    <Link className={btn.link} href={`/projects/${projectId}/documents/sources/${b.sourceId}`} data-testid="import-source-link">
                      {b.sourceCode}
                    </Link>
                  ) : (
                    t('imports.detail.noSource')
                  ),
                },
                { label: t('imports.detail.uploaded'), value: `${b.createdByName ?? '—'} · ${formatDateTime(b.createdAt)}` },
                ...(b.approvedAt ? [{ label: t('imports.detail.approved'), value: `${b.approvedByName ?? '—'} · ${formatDateTime(b.approvedAt)}` }] : []),
              ]}
            />
            {b.findings.length ? (
              <div className="mt-3">
                <h3 className="text-sm font-semibold">{t('imports.detail.findings')}</h3>
                <ul className="mt-1 list-disc space-y-1 ps-5 text-sm" data-testid="import-findings">
                  {b.findings.map((f, i) => (
                    <li key={i} data-code={f.code}>
                      {msg(f)}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </Panel>
          <ActionsPanel b={b} />
        </div>
      </div>
      <span className="sr-only">{tStatus('importStatuses', b.status)}</span>
    </>
  );
}

function StatusCallout({ b }: { b: ImportDetail }) {
  const { t } = useI18n();
  if (b.status === 'uploaded')
    return (
      <div className="mb-4">
        <Callout testId="import-checking">{t('imports.detail.checking')}</Callout>
      </div>
    );
  if (b.status === 'failed')
    return (
      <div className="mb-4">
        <Callout tone="danger" testId="import-failed">
          {t('imports.detail.failed', { reason: t(`imports.failures.${(b.failureCode ?? 'imports.parse.malformed').replace(/^imports\.(parse|upload)\./, '')}` as MessageKey) })}
        </Callout>
      </div>
    );
  if (b.status === 'quarantined')
    return (
      <div className="mb-4">
        <Callout tone="danger" testId="import-quarantined">
          {t('imports.detail.quarantined')}
        </Callout>
      </div>
    );
  if (b.status === 'rejected')
    return (
      <div className="mb-4">
        <Callout tone="warning">
          {t('imports.detail.rejected')} <bdi data-user-text>{b.decisionNote}</bdi>
        </Callout>
      </div>
    );
  if (b.status === 'rolled_back')
    return (
      <div className="mb-4">
        <Callout tone="warning">
          {t('imports.detail.rolledBack')} <bdi data-user-text>{b.rollbackReason}</bdi>
        </Callout>
      </div>
    );
  if (b.status === 'submitted' && !b.canApprove)
    return (
      <div className="mb-4">
        <Callout testId="import-awaiting">{b.canReject ? t('imports.detail.noAuthority') : t('imports.detail.awaitingApproval')}</Callout>
      </div>
    );
  return null;
}

// --------------------------------------------------------------------------------------------------------------- mapping

function MappingPanel({ b }: { b: ImportDetail }) {
  const { t } = useI18n();
  const { projectId } = useProjectContext();
  const refresh = useImportsRefresh();
  const toast = useToast();
  const sheetNames = b.sheets.map((s) => s.name);
  const [sheet, setSheet] = useState(b.sheet ?? sheetNames.find((n) => (b.sheetPreview[n]?.length ?? 0) > 0) ?? sheetNames[0] ?? '');
  const [headerRow, setHeaderRow] = useState(b.headerRow ?? 1);
  const headers = b.sheetPreview[sheet]?.[headerRow - 1] ?? [];
  const [mapping, setMapping] = useState<Record<string, string>>(b.mapping ?? b.suggestedMapping ?? {});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  // A different sheet / header row: keep only the mapped columns that still exist there.
  useEffect(() => {
    setMapping((m) => Object.fromEntries(Object.entries(m).filter(([, h]) => headers.includes(h))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheet, headerRow]);
  const missing = b.fields.filter((f) => f.required && !mapping[f.key]);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api(importsRoutes.mapImport, { params: { projectId, batchId: b.id }, body: { expectedVersion: b.version, sheet, headerRow, mapping } });
      await refresh();
      toast.show('success', t('imports.mapping.done'));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Panel title={t('imports.mapping.title')} testId="import-mapping">
      <p className="mb-3 text-sm text-muted">{t('imports.mapping.description')}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={labelCls} htmlFor="import-sheet">
            {t('imports.mapping.sheet')}
          </label>
          <select id="import-sheet" className={cx(input, 'mt-1')} value={sheet} onChange={(e) => setSheet(e.target.value)} data-testid="import-sheet">
            {b.sheets.map((s) => (
              <option key={s.name} value={s.name}>
                {t('imports.mapping.sheetOption', { name: s.name, rows: s.rows, columns: s.columns })}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls} htmlFor="import-header-row">
            {t('imports.mapping.headerRow')}
          </label>
          <select id="import-header-row" className={cx(input, 'mt-1')} value={headerRow} onChange={(e) => setHeaderRow(Number(e.target.value))} data-testid="import-header-row">
            {(b.sheetPreview[sheet] ?? []).map((_, i) => (
              <option key={i} value={i + 1}>
                {t('imports.mapping.rowOption', { row: i + 1 })}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {b.fields.map((f) => (
          <div key={f.key}>
            <label className={labelCls} htmlFor={`map-${f.key}`}>
              {t(`imports.fields.${f.key}` as MessageKey)} {f.required ? <span className="text-danger">*</span> : <span className="font-normal text-muted">({t('common.optional')})</span>}
            </label>
            <select
              id={`map-${f.key}`}
              className={cx(input, 'mt-1')}
              value={mapping[f.key] ?? ''}
              onChange={(e) => setMapping((m) => (e.target.value ? { ...m, [f.key]: e.target.value } : Object.fromEntries(Object.entries(m).filter(([k]) => k !== f.key))))}
              aria-invalid={f.required && !mapping[f.key]}
              data-testid={`map-${f.key}`}
            >
              <option value="">{t('imports.mapping.notMapped')}</option>
              {headers.map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>
      {missing.length ? (
        <p className={cx(hint, 'text-warning')} role="status">
          {t('imports.mapping.missing', { fields: missing.map((f) => t(`imports.fields.${f.key}` as MessageKey)).join(', ') })}
        </p>
      ) : null}
      <div className="mt-4">
        <button type="button" className={btn.primary} onClick={submit} disabled={busy || missing.length > 0 || !sheet} data-testid="import-validate">
          {busy ? t('common.actions.working') : t('imports.mapping.validate')}
        </button>
      </div>
      <ApiErrorNotice error={error} />
    </Panel>
  );
}

// --------------------------------------------------------------------------------------------------------------- preview

function Messages({ items, tone }: { items: ServerMessageDto[]; tone: 'danger' | 'warning' | 'muted' }) {
  const msg = useImportMessages();
  if (!items.length) return null;
  return (
    <ul className={cx('space-y-0.5 text-xs', tone === 'danger' ? 'text-danger' : tone === 'warning' ? 'text-warning' : 'text-muted')}>
      {items.map((m, i) => (
        <li key={i} data-code={m.code}>
          {msg(m)}
        </li>
      ))}
    </ul>
  );
}

function PreviewPanel({ b }: { b: ImportDetail }) {
  const { t, tStatus, formatNumber } = useI18n();
  const [page, setPage] = useState(1);
  const [action, setAction] = useState<string>('');
  const rows = useImportRows(b.id, { page, pageSize: ROW_PAGE, action: (action || undefined) as ImportRow['action'] | undefined }, true);
  const fields = b.fields.filter((f) => (b.mapping ? f.key in b.mapping : true)).slice(0, 4);
  const s = b.summary;
  return (
    <Panel title={t('imports.preview.title')} testId="import-preview">
      <p className="mb-3 text-sm text-muted">{t(b.target === 'document_claims' ? 'imports.preview.descriptionDocument' : 'imports.preview.description')}</p>
      <dl className="mb-3 flex flex-wrap gap-2" data-testid="import-summary">
        {(['create', 'update', 'conflict', 'skip', 'error'] as const).map((k) => (
          <div key={k} className="rounded-md border border-line px-3 py-1.5 text-sm">
            <dt className="text-xs text-muted">{t(`imports.preview.counts.${k}` as MessageKey)}</dt>
            <dd className="tabular font-semibold" data-testid={`import-count-${k}`}>
              {formatNumber(s[k] ?? 0)}
            </dd>
          </div>
        ))}
      </dl>
      <label className="mb-3 flex max-w-xs flex-col gap-1 text-sm font-medium">
        {t('imports.preview.filter')}
        <select
          className={input}
          value={action}
          onChange={(e) => {
            setAction(e.target.value);
            setPage(1);
          }}
          data-testid="import-row-filter"
        >
          <option value="">{t('imports.preview.allRows')}</option>
          {IMPORT_ROW_ACTIONS.map((a) => (
            <option key={a} value={a}>
              {tStatus('importRowActions', a)}
            </option>
          ))}
        </select>
      </label>
      {rows.isLoading ? <LoadingState /> : null}
      {rows.error ? <ErrorState error={rows.error} onRetry={() => rows.refetch()} /> : null}
      {rows.data ? (
        rows.data.items.length === 0 ? (
          <p className="text-sm text-muted">{t('imports.preview.empty')}</p>
        ) : (
          <ScrollRegion label={t('imports.preview.caption')}>
            <table className="w-full min-w-[40rem] text-sm" data-testid="import-rows">
              <caption className="sr-only">{t('imports.preview.caption')}</caption>
              <thead>
                <tr className="border-b border-line text-start text-xs text-muted">
                  <th scope="col" className="px-2 py-2 text-start">
                    {t('imports.preview.columns.row')}
                  </th>
                  <th scope="col" className="px-2 py-2 text-start">
                    {t('imports.preview.columns.action')}
                  </th>
                  {fields.map((f) => (
                    <th key={f.key} scope="col" className="px-2 py-2 text-start">
                      {t(`imports.fields.${f.key}` as MessageKey)}
                    </th>
                  ))}
                  <th scope="col" className="px-2 py-2 text-start">
                    {t('imports.preview.columns.comparison')}
                  </th>
                  <th scope="col" className="px-2 py-2 text-start">
                    {t('imports.preview.columns.messages')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.data.items.map((r) => (
                  <tr key={r.rowNo} className="border-b border-line align-top" data-testid="import-row" data-row={r.rowNo} data-action={r.action}>
                    <th scope="row" className="tabular px-2 py-2 text-start font-medium">
                      {r.rowNo}
                    </th>
                    <td className="px-2 py-2">
                      <StatusBadge enumName="importRowActions" value={r.action} tone={r.action === 'error' ? 'danger' : r.action === 'conflict' ? 'warning' : r.action === 'skip' ? 'neutral' : 'info'} />
                      {r.decision ? <div className="mt-1 text-xs text-muted">{t(`imports.preview.decision.${r.decision}` as MessageKey)}</div> : null}
                    </td>
                    {fields.map((f) => {
                      const v = r.values[f.key];
                      return (
                        <td key={f.key} className="max-w-[16rem] px-2 py-2 break-words">
                          {v === null || v === undefined ? <span className="text-muted">—</span> : <bdi data-user-text>{String(v)}</bdi>}
                          {r.formulaFields.includes(f.key) ? <span className="ms-1 rounded bg-warning-soft px-1 text-xs text-warning">{t('imports.preview.formula')}</span> : null}
                        </td>
                      );
                    })}
                    <td className="px-2 py-2 text-xs">
                      {r.match ? (
                        <div className="mb-1">
                          {t(`imports.recordTypes.${r.match.type}` as MessageKey)} {r.match.code ? <bdi>{r.match.code}</bdi> : null}
                        </div>
                      ) : null}
                      {r.diff.length ? (
                        <ul className="space-y-0.5" data-testid="import-diff">
                          {r.diff.map((d) => (
                            <li key={d.field}>
                              {t('imports.preview.diff', { field: t(`imports.fields.${d.field}` as MessageKey), from: d.from === null ? '—' : String(d.from), to: d.to === null ? '—' : String(d.to) })}
                            </li>
                          ))}
                        </ul>
                      ) : !r.match ? (
                        <span className="text-muted">—</span>
                      ) : null}
                    </td>
                    <td className="max-w-[22rem] px-2 py-2">
                      <Messages items={r.errors} tone="danger" />
                      <Messages items={r.warnings} tone="warning" />
                      <Messages items={r.notes} tone="muted" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>
        )
      ) : null}
      {rows.data && rows.data.total > ROW_PAGE ? <Pagination page={page} pageSize={ROW_PAGE} total={rows.data.total} onPageChange={setPage} /> : null}
    </Panel>
  );
}

// --------------------------------------------------------------------------------------------------------------- actions

function ActionsPanel({ b }: { b: ImportDetail }) {
  const { t, formatNumber } = useI18n();
  const { projectId } = useProjectContext();
  const refresh = useImportsRefresh();
  const toast = useToast();
  const [dialog, setDialog] = useState<null | 'submit' | 'approve' | 'reject' | 'cancel' | 'rollback'>(null);
  const [declined, setDeclined] = useState<string>('');
  const declinedRows = useMemo(
    () =>
      new Set(
        declined
          .split(/[\s,،]+/)
          .map((x) => Number(x))
          .filter((n) => Number.isInteger(n) && n > 0),
      ),
    [declined],
  );
  const accepted = b.applicableRows.filter((n) => !declinedRows.has(n));
  if (!b.canSubmit && !b.canApprove && !b.canReject && !b.canCancel && !b.canRollback) return null;
  const done = async (key: MessageKey) => {
    await refresh();
    toast.show('success', t(key));
    setDialog(null);
  };
  return (
    <Panel title={t('imports.actions.title')} testId="import-actions">
      <div className="flex flex-col gap-2">
        {b.canSubmit ? (
          <button type="button" className={btn.primary} onClick={() => setDialog('submit')} data-testid="import-submit">
            {t('imports.actions.submit')}
          </button>
        ) : null}
        {b.canApprove ? (
          <button type="button" className={btn.primary} onClick={() => setDialog('approve')} data-testid="import-approve">
            {t('imports.actions.approve')}
          </button>
        ) : null}
        {b.canReject ? (
          <button type="button" className={btn.secondary} onClick={() => setDialog('reject')} data-testid="import-reject">
            {t('imports.actions.reject')}
          </button>
        ) : null}
        {b.canRollback ? (
          <button type="button" className={btn.secondary} onClick={() => setDialog('rollback')} data-testid="import-rollback">
            {t('imports.actions.rollback')}
          </button>
        ) : null}
        {b.canCancel ? (
          <button type="button" className={btn.ghost} onClick={() => setDialog('cancel')} data-testid="import-cancel">
            {t('imports.actions.cancel')}
          </button>
        ) : null}
      </div>
      <ConfirmCommandDialog
        open={dialog === 'submit'}
        onClose={() => setDialog(null)}
        title={t('imports.actions.submitTitle')}
        consequences={[t('imports.actions.submitC1'), t('imports.actions.submitC2')]}
        confirmLabel={t('imports.actions.submit')}
        expectedVersion={b.version}
        onConfirm={async ({ note }) => {
          await api(importsRoutes.submitImport, { params: { projectId, batchId: b.id }, body: { expectedVersion: b.version, note: note || undefined } });
          await done('imports.actions.submitted');
        }}
      />
      <ConfirmCommandDialog
        open={dialog === 'approve'}
        onClose={() => setDialog(null)}
        title={t('imports.actions.approveTitle')}
        consequences={[t('imports.actions.approveC1', { count: accepted.length }), t('imports.actions.approveC2'), t('imports.actions.approveC3')]}
        confirmLabel={t('imports.actions.approve')}
        expectedVersion={b.version}
        confirmDisabled={accepted.length === 0}
        onConfirm={async ({ note }) => {
          await api(importsRoutes.approveImport, { params: { projectId, batchId: b.id }, body: { expectedVersion: b.version, acceptedRows: accepted, note: note || undefined } });
          await done('imports.actions.approved');
        }}
      >
        <div>
          <label className={labelCls} htmlFor="import-declined">
            {t('imports.actions.declinedRows')}
          </label>
          <input id="import-declined" className={cx(input, 'mt-1')} dir="ltr" value={declined} onChange={(e) => setDeclined(e.target.value)} data-testid="import-declined" />
          <p className={hint}>{t('imports.actions.declinedHint', { applicable: formatNumber(b.applicableRows.length), accepted: formatNumber(accepted.length) })}</p>
        </div>
      </ConfirmCommandDialog>
      <ConfirmCommandDialog
        open={dialog === 'reject'}
        onClose={() => setDialog(null)}
        title={t('imports.actions.rejectTitle')}
        consequences={[t('imports.actions.rejectC1')]}
        confirmLabel={t('imports.actions.reject')}
        noteMode="required"
        noteLabel={t('imports.actions.reason')}
        expectedVersion={b.version}
        danger
        onConfirm={async ({ note }) => {
          await api(importsRoutes.rejectImport, { params: { projectId, batchId: b.id }, body: { expectedVersion: b.version, reason: note } });
          await done('imports.actions.rejected');
        }}
      />
      <ConfirmCommandDialog
        open={dialog === 'rollback'}
        onClose={() => setDialog(null)}
        title={t('imports.actions.rollbackTitle')}
        consequences={[t('imports.actions.rollbackC1'), t('imports.actions.rollbackC2'), t('imports.actions.rollbackC3')]}
        confirmLabel={t('imports.actions.rollback')}
        noteMode="required"
        noteLabel={t('imports.actions.reason')}
        expectedVersion={b.version}
        danger
        onConfirm={async ({ note }) => {
          await api(importsRoutes.rollbackImport, { params: { projectId, batchId: b.id }, body: { expectedVersion: b.version, reason: note } });
          await done('imports.actions.rolledBack');
        }}
      />
      <ConfirmCommandDialog
        open={dialog === 'cancel'}
        onClose={() => setDialog(null)}
        title={t('imports.actions.cancelTitle')}
        consequences={[t('imports.actions.cancelC1')]}
        confirmLabel={t('imports.actions.cancel')}
        expectedVersion={b.version}
        onConfirm={async ({ note }) => {
          await api(importsRoutes.cancelImport, { params: { projectId, batchId: b.id }, body: { expectedVersion: b.version, reason: note || undefined } });
          await done('imports.actions.cancelled');
        }}
      />
    </Panel>
  );
}

// --------------------------------------------------------------------------------------------------------------- outputs

function OutputsPanel({ b }: { b: ImportDetail }) {
  const { t } = useI18n();
  const { projectId } = useProjectContext();
  const href = (o: ImportDetail['outputs'][number]) => {
    if (o.recordType === 'risk') return `/projects/${projectId}/raid/risks/${o.recordId}`;
    if (o.recordType === 'task') return `/projects/${projectId}/plan/tasks/${o.recordId}`;
    if (o.recordType === 'change_request') return `/projects/${projectId}/raid/changes/${o.recordId}`;
    return b.sourceId ? `/projects/${projectId}/documents/sources/${b.sourceId}` : null;
  };
  return (
    <Panel title={t('imports.outputs.title')} testId="import-outputs">
      <p className="mb-2 text-sm text-muted">{t('imports.outputs.description')}</p>
      <ul className={cx(card, 'divide-y divide-line')}>
        {b.outputs.map((o, i) => {
          const link = href(o);
          return (
            <li key={`${o.recordId}-${i}`} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm" data-testid="import-output" data-type={o.recordType}>
              <span>
                {t('imports.outputs.row', { row: o.rowNo })} · {t(`imports.recordTypes.${o.recordType}` as MessageKey)}{' '}
                {link ? (
                  <Link className={btn.link} href={link}>
                    {o.recordCode ?? t('imports.outputs.open')}
                  </Link>
                ) : null}
              </span>
              {o.rolledBack ? <span className="text-xs text-warning">{t('imports.outputs.rolledBack')}</span> : null}
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
