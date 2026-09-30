'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ClipboardCheck, Pencil, Plus } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { carveoutRoutes as C, governanceRoutes as G } from '@hub/contracts';
import type { PerimeterItemType } from '@hub/domain';
import { EM_DASH, useI18n, type MessageKey } from '@/i18n/provider';
import { api, isApiError } from '@/lib/api';
import { ck, itemHref, useRefreshCarveout, type Day1Positions, type PerimeterVersion, type Reconciliation, type Site, type TransferRecord } from '@/lib/carveout';
import { useProjectContext } from '@/lib/project-context';
import { ConfirmCommandDialog } from '../ConfirmCommandDialog';
import { DataTable, type Column } from '../DataTable';
import { DemoBadge } from '../DemoBadge';
import { ErrorState } from '../ErrorState';
import { SelectField, TextAreaField, TextField } from '../Field';
import { LoadingState } from '../LoadingState';
import { MetricCard } from '../MetricCard';
import { StatusBadge, type Tone } from '../StatusBadge';
import { useToast } from '../Toast';
import { btn } from '../ui';
import { CodeLink, DateText, FilterSelect, Section } from '../planning/bits';
import { FormDialog } from '../planning/dialogs';
import { Day1Badge, useMissingLabel } from './bits';

const perimeterHref = (pid: string, q: string) => `/projects/${pid}/perimeter?${q}`;

// =========================================================================================================
// Reconciliation (REQ-PER-003, REQ-PER-006)

type Issue = Reconciliation['findings'][number]['issue'];
const ISSUES = ['no_transfer_plan', 'no_evidence', 'pending_disposition', 'consent_outstanding', 'transfer_not_applicable', 'pending_without_resolution', 'day1_position_incomplete', 'change_request_pending'] as const;
const CATEGORY_TONE: Record<Reconciliation['categories'][number]['status'], Tone> = { items_registered: 'success', reviewed_none_in_perimeter: 'info', unassessed: 'danger' };

export function ReconciliationPanel() {
  const { t, tStatus } = useI18n();
  const { projectId, can } = useProjectContext();
  const q = useQuery({ queryKey: ck.reconciliation(projectId), queryFn: ({ signal }) => api(C.reconciliation, { params: { projectId }, signal }) });
  const [review, setReview] = useState<Reconciliation['categories'][number] | null>(null);
  if (q.isLoading) return <LoadingState />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const r = q.data;
  const issueLabel = (i: Issue) => ((ISSUES as readonly string[]).includes(i) ? t(`carveout.recon.issue.${i as (typeof ISSUES)[number]}`) : i);
  const s = r.summary;
  return (
    <div className="space-y-6" data-testid="reconciliation">
      <p className="text-sm text-muted">{t('carveout.recon.scopeNote')}</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label={t('carveout.recon.metric.items')} value={s.items} href={perimeterHref(projectId, 'tab=register')} />
        <MetricCard label={t('carveout.recon.metric.inScope')} value={s.inScope} href={perimeterHref(projectId, 'tab=register&disposition=included')} hint={t('carveout.recon.metric.inScopeHint')} />
        <MetricCard label={t('carveout.recon.metric.pending')} value={s.pending} href={perimeterHref(projectId, 'tab=register&disposition=pending')} />
        <MetricCard label={t('carveout.recon.metric.excluded')} value={s.excluded} href={perimeterHref(projectId, 'tab=register&disposition=excluded')} />
        <MetricCard label={t('carveout.recon.metric.legalVerified')} value={s.legalVerified} href={perimeterHref(projectId, 'tab=transfers&aspect=legal')} />
        <MetricCard label={t('carveout.recon.metric.economicVerified')} value={s.economicVerified} href={perimeterHref(projectId, 'tab=transfers&aspect=economic')} />
        <MetricCard label={t('carveout.recon.metric.fullyVerified')} value={s.fullyVerified} href={perimeterHref(projectId, 'tab=transfers')} hint={t('carveout.recon.metric.fullyVerifiedHint')} />
        <MetricCard label={t('carveout.recon.metric.categoriesUnassessed')} value={s.categoriesUnassessed} href="#categories" />
      </div>
      <Section id="recon-findings" title={t('carveout.recon.findingsTitle')} hint={t('carveout.recon.findingsHint')}>
        <DataTable
          caption={t('carveout.recon.findingsTitle')}
          columns={[
            { key: 'code', header: t('carveout.common.item'), isRowHeader: true, sortValue: (f) => f.code, cell: (f) => <CodeLink href={itemHref(projectId, f.itemId)} code={f.code} /> },
            { key: 'issue', header: t('carveout.recon.issueCol'), sortValue: (f) => f.issue, cell: (f) => <span data-issue={f.issue}>{issueLabel(f.issue)}</span> },
            { key: 'msg', header: t('carveout.recon.detail'), cell: (f) => <span className="text-muted" dir="ltr">{f.message}</span> },
          ]}
          rows={r.findings}
          rowKey={(f) => `${f.itemId}-${f.issue}`}
          emptyTitle={t('carveout.recon.noFindings')}
          clientPageSize={20}
          testId="recon-findings"
        />
      </Section>
      <Section id="categories" title={t('carveout.recon.categoriesTitle')} hint={t('carveout.recon.categoriesHint')}>
        <DataTable
          caption={t('carveout.recon.categoriesTitle')}
          columns={[
            { key: 'cat', header: t('carveout.recon.category'), isRowHeader: true, cell: (c) => tStatus('perimeterItemTypes', c.category) },
            { key: 'status', header: t('carveout.common.status'), cell: (c) => <StatusBadge enumName="perimeterItemTypes" value={c.status} tone={CATEGORY_TONE[c.status]} label={t(`carveout.recon.categoryStatus.${c.status}`)} /> },
            { key: 'items', header: t('carveout.recon.itemsCol'), cell: (c) => <span className="tabular">{c.items}</span> },
            { key: 'conclusion', header: t('carveout.recon.conclusion'), cell: (c) => <span dir="auto">{c.conclusion ?? EM_DASH}</span> },
            {
              key: 'act',
              header: '',
              cell: (c) =>
                can('carveout.perimeter.manage') && c.items === 0 ? (
                  <button type="button" className={btn.ghost} onClick={() => setReview(c)} data-testid={`review-${c.category}`}>
                    <ClipboardCheck aria-hidden="true" className="size-4" />
                    {c.reviewed ? t('carveout.recon.updateReview') : t('carveout.recon.recordReview')}
                  </button>
                ) : null,
            },
          ]}
          rows={r.categories}
          rowKey={(c) => c.category}
          emptyTitle={EM_DASH}
          testId="recon-categories"
        />
      </Section>
      <CategoryReviewDialog category={review} onClose={() => setReview(null)} />
    </div>
  );
}

function CategoryReviewDialog({ category, onClose }: { category: Reconciliation['categories'][number] | null; onClose: () => void }) {
  const { t, tStatus } = useI18n();
  const { projectId } = useProjectContext();
  const refresh = useRefreshCarveout(projectId);
  const toast = useToast();
  const [conclusion, setConclusion] = useState('');
  useEffect(() => {
    setConclusion(category?.conclusion ?? '');
  }, [category]);
  if (!category) return null;
  return (
    <FormDialog
      open
      onClose={onClose}
      title={t('carveout.recon.reviewTitle', { category: tStatus('perimeterItemTypes', category.category) })}
      submitLabel={t('carveout.recon.recordReview')}
      disabled={!conclusion.trim()}
      onReload={() => void refresh()}
      onSubmit={async () => {
        await api(C.reviewCategory, { params: { projectId, category: category.category as PerimeterItemType }, body: { conclusion: conclusion.trim(), ...(category.reviewVersion !== null ? { expectedVersion: category.reviewVersion } : {}) } });
        await refresh();
        toast.show('success', t('carveout.recon.reviewed'));
        onClose();
      }}
    >
      <p className="text-sm text-muted">{t('carveout.recon.reviewHint')}</p>
      <TextAreaField label={t('carveout.recon.conclusion')} required rows={3} value={conclusion} maxLength={2000} onChange={(e) => setConclusion(e.target.value)} />
    </FormDialog>
  );
}

// =========================================================================================================
// Day-1 contract positions (AT-08)

export function Day1PositionsPanel() {
  const { t, tStatus } = useI18n();
  const { projectId } = useProjectContext();
  const label = useMissingLabel();
  const q = useQuery({ queryKey: ck.day1(projectId), queryFn: ({ signal }) => api(C.day1Positions, { params: { projectId }, signal }) });
  const rows = q.data?.items;
  type Row = Day1Positions['items'][number];
  const columns: Column<Row>[] = [
    { key: 'code', header: t('carveout.day1.contract'), isRowHeader: true, sortValue: (r) => r.code, cell: (r) => <CodeLink href={itemHref(projectId, r.id)} code={r.code} title={r.name} /> },
    {
      key: 'class',
      header: t('carveout.day1.transferClass'),
      cell: (r) => (
        <span className="inline-flex flex-col gap-1">
          <StatusBadge enumName="contractTransferClasses" value={r.transferClass} />
          {!r.classAssessed ? <span className="text-xs text-warning">{t('carveout.day1.assessmentPending')}</span> : null}
        </span>
      ),
    },
    {
      key: 'consents',
      header: t('carveout.day1.consents'),
      cell: (r) =>
        r.consents.length ? (
          <ul className="space-y-1">
            {r.consents.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-1 text-xs">
                <span dir="ltr">{c.code}</span>
                <StatusBadge enumName="consentStatuses" value={c.status} />
              </li>
            ))}
          </ul>
        ) : (
          <span className="text-xs text-muted">{t('carveout.day1.noConsent')}</span>
        ),
    },
    {
      key: 'position',
      header: t('carveout.day1.position'),
      cell: (r) => (
        <span className="inline-flex flex-col gap-1" data-testid="day1-row" data-ok={r.position.ok ? 'true' : 'false'}>
          <Day1Badge position={r.position} />
          {r.position.missing.length ? <span className="text-xs text-muted">{r.position.missing.map(label).join(' · ')}</span> : null}
        </span>
      ),
    },
    { key: 'owners', header: t('carveout.day1.owners'), cell: (r) => <span className="text-xs" dir="auto">{[r.position.serviceAccountable?.name, r.position.billingAccountable?.name, r.position.slaAccountable?.name].map((n) => n ?? EM_DASH).join(' / ')}</span> },
    { key: 'disp', header: t('carveout.item.disposition'), cell: (r) => tStatus('perimeterDispositions', r.disposition) },
  ];
  return (
    <div className="space-y-3" data-testid="day1-positions">
      <p className="text-sm text-muted">{t('carveout.day1.explain')}</p>
      {q.data ? (
        <p className="text-sm" data-testid="day1-summary">
          {t('carveout.day1.summary', { total: q.data.summary.total, ok: q.data.summary.ok, incomplete: q.data.summary.incomplete })}
        </p>
      ) : null}
      <DataTable caption={t('carveout.tabs.day1')} columns={columns} rows={rows} rowKey={(r) => r.id} isLoading={q.isLoading} error={q.error} onRetry={() => q.refetch()} emptyTitle={t('carveout.day1.empty')} clientPageSize={20} />
    </div>
  );
}

// =========================================================================================================
// Transfer history (legal vs economic)

export function TransfersPanel({ initialAspect }: { initialAspect?: string }) {
  const { t, formatDateTime } = useI18n();
  const { projectId } = useProjectContext();
  const [aspect, setAspect] = useState(initialAspect === 'legal' || initialAspect === 'economic' ? initialAspect : '');
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [aspect]);
  const query = { page, pageSize: 25, aspect: (aspect || undefined) as 'legal' | 'economic' | undefined };
  const q = useQuery({ queryKey: ck.transfers(projectId, query), queryFn: ({ signal }) => api(C.listTransfers, { params: { projectId }, query, signal }), placeholderData: keepPreviousData });
  const columns: Column<TransferRecord>[] = [
    { key: 'at', header: t('carveout.transfer.recordedAt'), cell: (r) => <span className="tabular whitespace-nowrap">{formatDateTime(r.recordedAt)}</span> },
    { key: 'item', header: t('carveout.common.item'), isRowHeader: true, cell: (r) => <CodeLink href={itemHref(projectId, r.perimeterItemId)} code={r.itemCode} /> },
    { key: 'aspect', header: t('carveout.transfer.aspect'), cell: (r) => <span data-aspect={r.aspect}>{t(`carveout.aspect.${r.aspect}`)}</span> },
    { key: 'cmd', header: t('carveout.transfer.command'), cell: (r) => <CommandLabel command={r.command} /> },
    {
      key: 'status',
      header: t('carveout.transfer.statusChange'),
      cell: (r) => (
        <span className="inline-flex flex-wrap items-center gap-1">
          <StatusBadge enumName="transferStatuses" value={r.fromStatus} />
          <span aria-hidden="true" className="rtl:rotate-180">
            →
          </span>
          <StatusBadge enumName="transferStatuses" value={r.toStatus} />
        </span>
      ),
    },
    { key: 'date', header: t('carveout.transfer.effectiveDate'), cell: (r) => <DateText value={r.effectiveDate} /> },
    { key: 'ev', header: t('carveout.transfer.evidenceAtTime'), cell: (r) => <span className="tabular">{r.evidenceCount}</span> },
    { key: 'by', header: t('carveout.transfer.recordedBy'), cell: (r) => <span dir="auto">{r.recordedByName ?? EM_DASH}</span> },
  ];
  return (
    <div className="space-y-3" data-testid="transfers-history">
      <p className="text-sm text-muted">{t('carveout.transfer.historyExplain')}</p>
      <FilterSelect label={t('carveout.transfer.aspect')} value={aspect} onChange={setAspect} className="w-full sm:w-44">
        <option value="">{t('carveout.common.all')}</option>
        <option value="legal">{t('carveout.aspect.legal')}</option>
        <option value="economic">{t('carveout.aspect.economic')}</option>
      </FilterSelect>
      <DataTable
        caption={t('carveout.tabs.transfers')}
        columns={columns}
        rows={q.data?.items}
        rowKey={(r) => r.id}
        isLoading={q.isLoading}
        error={q.error}
        onRetry={() => q.refetch()}
        emptyTitle={t('carveout.transfer.empty')}
        pagination={q.data ? { page, pageSize: 25, total: q.data.total, onPageChange: setPage } : undefined}
      />
    </div>
  );
}

const COMMANDS = ['plan', 'start', 'report_transferred', 'verify', 'reject_evidence', 'block', 'unblock', 'mark_not_applicable'] as const;
export function CommandLabel({ command }: { command: string }) {
  const { t } = useI18n();
  return <>{(COMMANDS as readonly string[]).includes(command) ? t(`carveout.transfer.cmd.${command as (typeof COMMANDS)[number]}`) : command}</>;
}

// =========================================================================================================
// Perimeter versions (setup wizard step 4 — REQ-SET-012)

const VERSION_TONE: Record<PerimeterVersion['status'], Tone> = { proposed: 'info', approved: 'success', rejected: 'danger', superseded: 'neutral' };

export function PerimeterVersionsPanel() {
  const { t, formatDateTime } = useI18n();
  const { projectId, can, me } = useProjectContext();
  const q = useQuery({ queryKey: ck.versions(projectId), queryFn: ({ signal }) => api(C.listPerimeterVersions, { params: { projectId }, signal }) });
  const [propose, setPropose] = useState(false);
  const [decide, setDecide] = useState<{ v: PerimeterVersion; kind: 'approve' | 'reject' } | null>(null);
  const columns: Column<PerimeterVersion>[] = [
    { key: 'no', header: t('carveout.versions.version'), isRowHeader: true, cell: (v) => <span className="tabular font-medium">{t('documents.versions.label', { version: v.versionNo })}</span> },
    { key: 'status', header: t('carveout.common.status'), cell: (v) => <StatusBadge enumName="baselineStatuses" value={v.status} tone={VERSION_TONE[v.status]} label={t(`carveout.versions.status.${v.status}`)} /> },
    { key: 'items', header: t('carveout.versions.items'), cell: (v) => <span className="tabular">{v.itemCount}</span> },
    { key: 'proposed', header: t('carveout.versions.proposed'), cell: (v) => <span className="text-sm"><span dir="auto">{v.proposedByName ?? EM_DASH}</span> · {formatDateTime(v.createdAt)}</span> },
    { key: 'decided', header: t('carveout.versions.decided'), cell: (v) => (v.decidedAt ? <span className="text-sm"><span dir="auto">{v.decidedByName ?? EM_DASH}</span> · {formatDateTime(v.decidedAt)}</span> : EM_DASH) },
    { key: 'warn', header: t('carveout.versions.warnings'), cell: (v) => (v.warnings.length ? <span className="text-xs text-warning">{t('carveout.versions.warningCount', { count: v.warnings.length })}</span> : EM_DASH) },
    {
      key: 'act',
      header: '',
      cell: (v) =>
        v.status === 'proposed' && can('carveout.perimeter.approve') && v.proposedBy !== me.user.id ? (
          <span className="flex flex-wrap gap-2">
            <button type="button" className={btn.primary} onClick={() => setDecide({ v, kind: 'approve' })} data-testid="version-approve">
              {t('carveout.versions.approve')}
            </button>
            <button type="button" className={btn.secondary} onClick={() => setDecide({ v, kind: 'reject' })}>
              {t('carveout.versions.reject')}
            </button>
          </span>
        ) : null,
    },
  ];
  return (
    <div className="space-y-3" data-testid="perimeter-versions">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="max-w-3xl text-sm text-muted">{t('carveout.versions.explain')}</p>
        {can('carveout.perimeter.manage') ? (
          <button type="button" className={btn.primary} onClick={() => setPropose(true)} data-testid="version-propose">
            <Plus aria-hidden="true" className="size-4" />
            {t('carveout.versions.propose')}
          </button>
        ) : null}
      </div>
      <DataTable caption={t('carveout.tabs.versions')} columns={columns} rows={q.data?.items} rowKey={(v) => v.id} isLoading={q.isLoading} error={q.error} onRetry={() => q.refetch()} emptyTitle={t('carveout.versions.empty')} />
      <ProposeVersionDialog open={propose} onClose={() => setPropose(false)} />
      {decide ? <DecideVersionDialog version={decide.v} kind={decide.kind} onClose={() => setDecide(null)} /> : null}
    </div>
  );
}

function ProposeVersionDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const { projectId } = useProjectContext();
  const refresh = useRefreshCarveout(projectId);
  const toast = useToast();
  const [blockers, setBlockers] = useState<{ code: string; issue: string }[]>([]);
  useEffect(() => {
    if (open) setBlockers([]);
  }, [open]);
  return (
    <ConfirmCommandDialog
      open={open}
      onClose={onClose}
      title={t('carveout.versions.proposeTitle')}
      confirmLabel={t('carveout.versions.propose')}
      consequences={[t('carveout.versions.proposeEffect1'), t('carveout.versions.proposeEffect2'), t('common.command.audited')]}
      onConfirm={async ({ note }) => {
        try {
          const v = await api(C.setupPerimeterStep, { params: { projectId }, body: note ? { note } : {} });
          await refresh();
          toast.show('success', t('carveout.versions.proposedToast', { version: v.versionNo }));
          onClose();
        } catch (e) {
          const b = isApiError(e) ? (e.details?.blockers as { code: string; issue: string }[] | undefined) : undefined;
          setBlockers(b ?? []);
          throw e;
        }
      }}
    >
      {blockers.length ? (
        <div className="rounded-md border border-danger/40 bg-danger-soft p-3 text-sm" data-testid="version-blockers">
          <p className="font-semibold text-danger">{t('carveout.versions.blockers')}</p>
          <ul className="mt-1 list-disc ps-5">
            {blockers.map((b, i) => (
              <li key={i}>
                <span dir="ltr">{b.code}</span> — <span dir="ltr">{b.issue}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </ConfirmCommandDialog>
  );
}

function DecideVersionDialog({ version, kind, onClose }: { version: PerimeterVersion; kind: 'approve' | 'reject'; onClose: () => void }) {
  const { t, tStatus } = useI18n();
  const { projectId } = useProjectContext();
  const refresh = useRefreshCarveout(projectId);
  const toast = useToast();
  const [decisionId, setDecisionId] = useState('');
  const decisions = useQuery({
    queryKey: ['project', projectId, 'governance', 'decisions', 'final-for-perimeter'],
    enabled: kind === 'approve',
    // G1 decisions only (the perimeter belongs to gate G1 — DOM-P2-01).
    queryFn: ({ signal }) => api(G.listDecisions, { params: { projectId }, query: { page: 1, pageSize: 100, gateKey: 'G1' }, signal }),
  });
  const versions = useQuery({ queryKey: ck.versions(projectId), enabled: kind === 'approve', queryFn: ({ signal }) => api(C.listPerimeterVersions, { params: { projectId }, signal }) });
  // DOM-P2R-05: a decision that already backs another version is not offered; DOM-P2R-03 / DOM-P2F-08: only a G1 paper
  // raised FOR this version is offered (a paper raised for no record approves no version). The server re-checks both.
  const used = new Set((versions.data?.items ?? []).filter((x) => x.id !== version.id && x.decisionId && (x.status === 'approved' || x.status === 'superseded')).map((x) => x.decisionId!));
  const final = (decisions.data?.items ?? []).filter(
    (d) => ['approved', 'implementation_pending', 'implemented_verified'].includes(d.status) && !used.has(d.id) && d.subjectType === 'perimeter_version' && d.subjectId === version.id,
  );
  return (
    <ConfirmCommandDialog
      open
      onClose={onClose}
      title={kind === 'approve' ? t('carveout.versions.approveTitle', { version: version.versionNo }) : t('carveout.versions.rejectTitle', { version: version.versionNo })}
      confirmLabel={kind === 'approve' ? t('carveout.versions.approve') : t('carveout.versions.reject')}
      danger={kind === 'reject'}
      noteMode={kind === 'reject' ? 'required' : 'optional'}
      noteLabel={kind === 'reject' ? t('carveout.common.reason') : undefined}
      expectedVersion={version.version}
      confirmDisabled={kind === 'approve' && !decisionId}
      consequences={kind === 'approve' ? [t('carveout.versions.approveEffect1'), t('carveout.versions.approveEffect2'), t('carveout.versions.notSelf')] : [t('carveout.versions.rejectEffect')]}
      onReload={() => void refresh()}
      onConfirm={async ({ note }) => {
        if (kind === 'approve') await api(C.approvePerimeterVersion, { params: { projectId, versionId: version.id }, body: { expectedVersion: version.version, decisionId, ...(note ? { note } : {}) } });
        else await api(C.rejectPerimeterVersion, { params: { projectId, versionId: version.id }, body: { expectedVersion: version.version, reason: note } });
        await refresh();
        toast.show('success', kind === 'approve' ? t('carveout.versions.approved') : t('carveout.versions.rejected'));
        onClose();
      }}
    >
      {kind === 'approve' ? (
        <SelectField label={t('carveout.versions.decision')} hint={t('carveout.versions.decisionHint')} required value={decisionId} onChange={(e) => setDecisionId(e.target.value)}>
          <option value="">{final.length ? t('carveout.versions.pickDecision') : t('carveout.versions.noFinalDecision')}</option>
          {final.map((d) => (
            <option key={d.id} value={d.id}>
              {d.code} — {d.title} ({tStatus('decisionStatuses', d.status)})
            </option>
          ))}
        </SelectField>
      ) : null}
    </ConfirmCommandDialog>
  );
}

// =========================================================================================================
// Sites

export function SitesPanel() {
  const { t } = useI18n();
  const { projectId, can } = useProjectContext();
  const q = useQuery({ queryKey: ck.sites(projectId), queryFn: ({ signal }) => api(C.listSites, { params: { projectId }, signal }) });
  const [edit, setEdit] = useState<Site | 'new' | null>(null);
  const columns: Column<Site>[] = [
    { key: 'code', header: t('carveout.sites.code'), isRowHeader: true, sortValue: (s) => s.code, cell: (s) => <span dir="ltr" className="font-medium">{s.code}</span> },
    { key: 'name', header: t('carveout.sites.name'), sortValue: (s) => s.name, cell: (s) => <span dir="auto">{s.name}</span> },
    { key: 'city', header: t('carveout.sites.city'), cell: (s) => <span dir="auto">{s.city ?? EM_DASH}</span> },
    { key: 'kind', header: t('carveout.sites.kind'), cell: (s) => (SITE_KINDS.includes(s.kind as SiteKind) ? siteKindLabel(t, s.kind as SiteKind) : s.kind) },
    { key: 'items', header: '', cell: (s) => <Link className={btn.link} href={perimeterHref(projectId, `tab=register&siteId=${s.id}`)}>{t('carveout.sites.items')}</Link> },
    { key: 'demo', header: '', cell: (s) => (s.isDemo ? <DemoBadge /> : null) },
    {
      key: 'edit',
      header: '',
      cell: (s) =>
        can('carveout.perimeter.manage') ? (
          <button type="button" className={btn.ghost} onClick={() => setEdit(s)} aria-label={t('carveout.sites.editTitle', { code: s.code })}>
            <Pencil aria-hidden="true" className="size-4" />
          </button>
        ) : null,
    },
  ];
  return (
    <div className="space-y-3" data-testid="sites">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="max-w-3xl text-sm text-muted">{t('carveout.sites.explain')}</p>
        {can('carveout.perimeter.manage') ? (
          <button type="button" className={btn.primary} onClick={() => setEdit('new')}>
            <Plus aria-hidden="true" className="size-4" />
            {t('carveout.sites.add')}
          </button>
        ) : null}
      </div>
      <DataTable caption={t('carveout.tabs.sites')} columns={columns} rows={q.data?.items} rowKey={(s) => s.id} isLoading={q.isLoading} error={q.error} onRetry={() => q.refetch()} emptyTitle={t('carveout.sites.empty')} />
      <SiteDialog site={edit} onClose={() => setEdit(null)} />
    </div>
  );
}

const SITE_KINDS = ['data_center', 'technical_room', 'office', 'warehouse', 'land', 'other'] as const;
type SiteKind = (typeof SITE_KINDS)[number];
/** `other` is a reserved plural key in the catalogue, so that label lives under `otherKind`. */
const siteKindLabel = (t: (k: MessageKey) => string, k: SiteKind) => t(`carveout.sites.kinds.${k === 'other' ? 'otherKind' : k}`);

function SiteDialog({ site, onClose }: { site: Site | 'new' | null; onClose: () => void }) {
  const { t } = useI18n();
  const { projectId } = useProjectContext();
  const refresh = useRefreshCarveout(projectId);
  const toast = useToast();
  const [f, setF] = useState({ name: '', city: '', kind: 'data_center' as SiteKind, notes: '' });
  useEffect(() => {
    if (site === 'new') setF({ name: '', city: '', kind: 'data_center', notes: '' });
    else if (site) setF({ name: site.name, city: site.city ?? '', kind: (SITE_KINDS.includes(site.kind as SiteKind) ? site.kind : 'other') as SiteKind, notes: site.notes ?? '' });
  }, [site]);
  if (!site) return null;
  return (
    <FormDialog
      open
      onClose={onClose}
      title={site === 'new' ? t('carveout.sites.add') : t('carveout.sites.editTitle', { code: site.code })}
      submitLabel={t('common.actions.save')}
      disabled={!f.name.trim()}
      onReload={() => void refresh()}
      onSubmit={async () => {
        if (site === 'new') await api(C.createSite, { params: { projectId }, body: { name: f.name.trim(), city: f.city.trim() || undefined, kind: f.kind, notes: f.notes.trim() || undefined } });
        else await api(C.updateSite, { params: { projectId, siteId: site.id }, body: { expectedVersion: site.version, name: f.name.trim(), city: f.city.trim() || null, kind: f.kind, notes: f.notes.trim() || null } });
        await refresh();
        toast.show('success', t('carveout.common.saved'));
        onClose();
      }}
    >
      <TextField label={t('carveout.sites.name')} required value={f.name} maxLength={300} onChange={(e) => setF({ ...f, name: e.target.value })} />
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label={t('carveout.sites.city')} value={f.city} maxLength={200} onChange={(e) => setF({ ...f, city: e.target.value })} />
        <SelectField label={t('carveout.sites.kind')} required value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as SiteKind })}>
          {SITE_KINDS.map((k) => (
            <option key={k} value={k}>
              {siteKindLabel(t, k)}
            </option>
          ))}
        </SelectField>
      </div>
      <TextAreaField label={t('carveout.sites.notes')} rows={2} value={f.notes} maxLength={2000} onChange={(e) => setF({ ...f, notes: e.target.value })} />
    </FormDialog>
  );
}

