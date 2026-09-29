'use client';

import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, FileSearch, GitCompareArrows, History, Plus, Send, ShieldCheck } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { documentsRoutes } from '@hub/contracts';
import { CLAIM_INITIAL_STATUSES, CLAIM_TARGET_FIELDS, EXTRACTION_STATUSES, VERIFICATION_STATUSES, type ClaimTargetType, type VerificationStatus } from '@hub/domain';
import { ConfirmCommandDialog } from '@/components/ConfirmCommandDialog';
import { DataTable, type Column } from '@/components/DataTable';
import { DemoBadge } from '@/components/DemoBadge';
import { ErrorState } from '@/components/ErrorState';
import { EvidenceTargetPicker, type PickedTarget } from '@/components/EvidenceTargetPicker';
import { SelectField, TextAreaField, TextField } from '@/components/Field';
import { LoadingState } from '@/components/LoadingState';
import { PageHeader } from '@/components/PageHeader';
import { RestrictedState } from '@/components/RestrictedState';
import { SectionGuard } from '@/components/SectionGuard';
import { StatusBadge } from '@/components/StatusBadge';
import { useToast } from '@/components/Toast';
import { btn, card, cx } from '@/components/ui';
import { VerificationBadge } from '@/components/VerificationBadge';
import { EM_DASH, useI18n } from '@/i18n/provider';
import { api, isApiError } from '@/lib/api';
import { dqk, type Claim, type CompareRow, type SourceDetail } from '@/lib/documents';
import { useProjectContext } from '@/lib/project-context';
import { ClassificationBadge } from '../../_components/bits';

type InitialStatus = (typeof CLAIM_INITIAL_STATUSES)[number];
type ExtractionStatus = (typeof EXTRACTION_STATUSES)[number];
type ClaimTarget = 'none' | 'project' | 'record';

function Row({ label, children, wide = false }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? 'sm:col-span-2 lg:col-span-3' : undefined}>
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

function AddClaimDialog({ open, onClose, source }: { open: boolean; onClose: () => void; source: SourceDetail }) {
  const { t, tStatus } = useI18n();
  const { projectId } = useProjectContext();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState({ location: '', subject: '', extractedValue: '', sourceReportedValue: '', confidence: '', status: 'unknown' as InitialStatus });
  const [mapping, setMapping] = useState<ClaimTarget>('none');
  const [record, setRecord] = useState<PickedTarget | null>(null);
  const [field, setField] = useState('');
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const targetType: ClaimTargetType | null = mapping === 'project' ? 'project' : mapping === 'record' && record ? (record.type as ClaimTargetType) : null;
  const fields = targetType ? CLAIM_TARGET_FIELDS[targetType] : [];
  const reset = () => {
    setF({ location: '', subject: '', extractedValue: '', sourceReportedValue: '', confidence: '', status: 'unknown' });
    setMapping('none');
    setRecord(null);
    setField('');
  };
  const incomplete = !f.location.trim() || !f.subject.trim() || !f.extractedValue.trim() || (mapping !== 'none' && (!targetType || !field));

  return (
    <ConfirmCommandDialog
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title={t('documents.claims.addTitle')}
      confirmLabel={t('documents.claims.addConfirm')}
      noteMode="none"
      confirmDisabled={incomplete}
      consequences={[t('documents.claims.addEffect', { code: source.code }), t('documents.claims.neverConfirmed'), t('common.command.audited')]}
      onConfirm={async () => {
        await api(documentsRoutes.createClaim, {
          params: { projectId, sourceId: source.id },
          body: {
            location: f.location.trim(),
            subject: f.subject.trim(),
            extractedValue: f.extractedValue.trim(),
            verificationStatus: f.status,
            ...(f.sourceReportedValue.trim() ? { sourceReportedValue: f.sourceReportedValue.trim() } : {}),
            ...(f.confidence.trim() ? { confidence: f.confidence.trim() } : {}),
            ...(targetType ? { targetType, targetId: targetType === 'project' ? projectId : record!.id, field } : {}),
          },
        });
        await queryClient.invalidateQueries({ queryKey: dqk.sourcesAll(projectId) });
        toast.show('success', t('documents.claims.added'));
        reset();
        onClose();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label={t('documents.claims.columns.subject')} required value={f.subject} maxLength={500} onChange={(e) => set('subject', e.target.value)} className="sm:col-span-2" />
        <TextField label={t('documents.claims.columns.location')} required value={f.location} maxLength={500} onChange={(e) => set('location', e.target.value)} hint={t('documents.claims.locationHint')} className="sm:col-span-2" />
        <TextAreaField label={t('documents.claims.columns.extracted')} required value={f.extractedValue} maxLength={4000} onChange={(e) => set('extractedValue', e.target.value)} />
        <TextAreaField label={t('documents.claims.columns.sourceReported')} value={f.sourceReportedValue} maxLength={4000} onChange={(e) => set('sourceReportedValue', e.target.value)} />
        <TextField label={t('documents.claims.columns.confidence')} dir="ltr" inputMode="decimal" value={f.confidence} placeholder="0.5" onChange={(e) => set('confidence', e.target.value)} hint={t('documents.claims.confidenceHint')} />
        <SelectField label={t('documents.claims.initialStatus')} required value={f.status} onChange={(e) => set('status', e.target.value as InitialStatus)} hint={t('documents.claims.initialStatusHint')}>
          {CLAIM_INITIAL_STATUSES.map((s) => (
            <option key={s} value={s}>
              {tStatus('verificationStatuses', s)}
            </option>
          ))}
        </SelectField>
        <SelectField label={t('documents.claims.mapping')} value={mapping} onChange={(e) => { setMapping(e.target.value as ClaimTarget); setRecord(null); setField(''); }} hint={t('documents.claims.mappingHint')} className="sm:col-span-2">
          <option value="none">{t('documents.claims.mappingNone')}</option>
          <option value="project">{t('documents.targetTypes.project')}</option>
          <option value="record">{t('documents.claims.mappingRecord')}</option>
        </SelectField>
        {mapping === 'record' ? (
          <div className="sm:col-span-2">
            <EvidenceTargetPicker value={record} onChange={(r) => { setRecord(r); setField(''); }} only={['task', 'milestone', 'deliverable']} />
          </div>
        ) : null}
        {targetType ? (
          <SelectField label={t('documents.claims.field')} required value={field} onChange={(e) => setField(e.target.value)} className="sm:col-span-2">
            <option value="">{t('documents.claims.chooseField')}</option>
            {fields.map((fl) => (
              <option key={fl} value={fl}>
                {t(`documents.fields.${fl}`)}
              </option>
            ))}
          </SelectField>
        ) : null}
      </div>
    </ConfirmCommandDialog>
  );
}

type Pending = { kind: 'review' | 'propose'; claim: Claim } | null;

function SourceView({ source }: { source: SourceDetail }) {
  const { t, tStatus, formatDate, formatDateTime } = useI18n();
  const { projectId, can, me } = useProjectContext();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [addOpen, setAddOpen] = useState(false);
  const [extractionOpen, setExtractionOpen] = useState(false);
  const [pending, setPending] = useState<Pending>(null);
  const [review, setReview] = useState<{ status: VerificationStatus; confirmedValue: string }>({ status: 'proposed', confirmedValue: '' });
  const [ex, setEx] = useState<{ status: ExtractionStatus; date: string; note: string }>({ status: source.extractionStatus, date: source.extractionDate ?? '', note: '' });
  const refresh = () => queryClient.invalidateQueries({ queryKey: dqk.sourcesAll(projectId) });
  const compare = useQuery({
    queryKey: dqk.compare(projectId, source.id),
    queryFn: ({ signal }) => api(documentsRoutes.compareSource, { params: { projectId, sourceId: source.id }, signal }),
  });
  const canManage = can('documents.source.manage');
  const canVerify = can('documents.claim.verify');
  const hasHistorical = source.claims.some((c) => c.verificationStatus === 'historical_unverified');
  const targetLabel = (type: string | null, field: string | null) =>
    type ? `${t(`documents.targetTypes.${type as ClaimTargetType}`)}${field ? ` · ${t(`documents.fields.${field as 'status'}`)}` : ''}` : EM_DASH;

  const claimColumns: Column<Claim>[] = [
    {
      key: 'subject',
      header: t('documents.claims.columns.subject'),
      isRowHeader: true,
      cell: (c) => (
        <span className="flex flex-col gap-0.5">
          <span dir="auto">{c.subject}</span>
          <span className="text-xs text-muted" dir="auto">
            {c.location}
          </span>
        </span>
      ),
    },
    {
      key: 'values',
      header: t('documents.claims.columns.values'),
      cell: (c) => (
        <dl className="space-y-0.5 text-xs">
          <div>
            <dt className="inline text-muted">{t('documents.claims.columns.extracted')}: </dt>
            <dd className="inline" dir="auto">
              {c.extractedValue}
            </dd>
          </div>
          <div>
            <dt className="inline text-muted">{t('documents.claims.columns.sourceReported')}: </dt>
            <dd className="inline" dir="auto">
              {c.sourceReportedValue ?? EM_DASH}
            </dd>
          </div>
          <div>
            <dt className="inline text-muted">{t('documents.claims.columns.confirmed')}: </dt>
            <dd className="inline font-semibold" dir="auto">
              {c.confirmedValue ?? EM_DASH}
            </dd>
          </div>
        </dl>
      ),
    },
    { key: 'confidence', header: t('documents.claims.columns.confidence'), cell: (c) => <span dir="ltr">{c.confidence ?? EM_DASH}</span> },
    {
      key: 'verification',
      header: t('documents.claims.columns.verification'),
      cell: (c) => (
        <span className="flex flex-col gap-1" data-testid="claim-verification" data-claim-subject={c.subject}>
          <VerificationBadge value={c.verificationStatus} />
          {c.verificationStatus === 'historical_unverified' ? <span className="text-xs text-warning">{t('documents.claims.historicalOnly')}</span> : null}
          {c.reviewedAt ? <span className="text-xs text-muted">{t('documents.claims.reviewedAt', { date: formatDateTime(c.reviewedAt) })}</span> : null}
        </span>
      ),
    },
    { key: 'target', header: t('documents.claims.columns.target'), cell: (c) => <span className="text-xs">{targetLabel(c.targetType, c.field)}</span> },
    {
      key: 'actions',
      header: t('documents.claims.columns.actions'),
      cell: (c) => (
        <span className="flex flex-col items-start gap-1">
          {c.pendingProposalId ? <span className="text-xs font-medium text-info">{t('documents.claims.proposalPending')}</span> : null}
          {canVerify && c.createdBy !== me.user.id && c.verificationStatus !== 'confirmed' ? (
            <button
              type="button"
              className="inline-flex min-h-9 items-center gap-1 rounded-md px-2 text-sm font-medium text-primary hover:bg-primary-soft"
              onClick={() => {
                setReview({ status: c.verificationStatus === 'historical_unverified' ? 'historical_unverified' : 'confirmed', confirmedValue: c.extractedValue });
                setPending({ kind: 'review', claim: c });
              }}
              data-testid="claim-review"
            >
              <ShieldCheck aria-hidden="true" className="size-4" />
              {t('documents.claims.review')}
            </button>
          ) : null}
          {canManage && c.verificationStatus === 'confirmed' && c.targetType && !c.pendingProposalId && !c.appliedToRecord ? (
            <button type="button" className="inline-flex min-h-9 items-center gap-1 rounded-md px-2 text-sm font-medium text-primary hover:bg-primary-soft" onClick={() => setPending({ kind: 'propose', claim: c })}>
              <Send aria-hidden="true" className="size-4" />
              {t('documents.claims.propose')}
            </button>
          ) : null}
        </span>
      ),
    },
  ];

  const compareColumns: Column<CompareRow>[] = [
    { key: 'subject', header: t('documents.claims.columns.subject'), isRowHeader: true, cell: (r) => <span dir="auto">{r.subject}</span> },
    { key: 'target', header: t('documents.claims.columns.target'), cell: (r) => <span className="text-xs">{targetLabel(r.targetType, r.field)}</span> },
    { key: 'current', header: t('documents.compare.current'), cell: (r) => <span dir="auto">{r.currentValue ?? EM_DASH}</span> },
    { key: 'claim', header: t('documents.compare.claim'), cell: (r) => <span dir="auto">{r.claimValue}</span> },
    { key: 'previous', header: t('documents.compare.previous'), cell: (r) => <span dir="auto">{r.previousSourceValue ?? EM_DASH}</span> },
    { key: 'verification', header: t('documents.claims.columns.verification'), cell: (r) => <VerificationBadge value={r.verificationStatus} /> },
    {
      key: 'outcome',
      header: t('documents.compare.outcome'),
      cell: (r) => (
        <span className="flex flex-col gap-0.5 text-xs" data-applicable={String(r.applicable)}>
          <span className={cx('font-semibold', r.applicable ? 'text-success' : 'text-muted')}>{r.applicable ? t('documents.compare.canPropose') : t('documents.compare.notApplied')}</span>
          <span className="text-muted">{r.differs === null ? t('documents.compare.notMapped') : r.differs ? t('documents.compare.differs') : t('documents.compare.same')}</span>
          <span className="text-muted" dir="auto">
            {r.reason}
          </span>
        </span>
      ),
    },
  ];

  return (
    <>
      <Link href={`/projects/${projectId}/documents?tab=sources`} className={cx(btn.link, 'mb-3 inline-flex items-center gap-1 text-sm')}>
        <ChevronLeft aria-hidden="true" className="size-4 rtl:rotate-180" />
        {t('documents.sources.back')}
      </Link>
      <PageHeader
        eyebrow={tStatus('sourceTypes', source.sourceType)}
        title={<span dir="ltr">{source.code}</span>}
        documentTitle={source.code}
        description={source.filename ? <span dir="auto" className="break-all">{source.filename}</span> : null}
        badges={
          <>
            {source.isDemo ? <DemoBadge /> : null}
            <StatusBadge enumName="extractionStatuses" value={source.extractionStatus} />
            <ClassificationBadge value={source.classification} />
            {source.supersededBySourceId ? <span className="text-xs text-muted">{t('documents.sources.superseded')}</span> : null}
          </>
        }
        actions={
          canManage ? (
            <>
              <button type="button" className={btn.secondary} onClick={() => { setEx({ status: source.extractionStatus, date: source.extractionDate ?? '', note: '' }); setExtractionOpen(true); }}>
                <FileSearch aria-hidden="true" className="size-4" />
                {t('documents.sources.recordExtraction')}
              </button>
              <button type="button" className={btn.primary} onClick={() => setAddOpen(true)} data-testid="claim-add">
                <Plus aria-hidden="true" className="size-4" />
                {t('documents.claims.add')}
              </button>
            </>
          ) : null
        }
      />
      <div className="space-y-6">
        <section aria-labelledby="src-meta" className={cx(card, 'p-4')}>
          <h2 id="src-meta" className="mb-3 text-lg font-semibold">
            {t('documents.sources.register')}
          </h2>
          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Row label={t('documents.sources.columns.type')}>{tStatus('sourceTypes', source.sourceType)}</Row>
            <Row label={t('documents.sources.fields.sourceVersion')}>{source.sourceVersion ?? EM_DASH}</Row>
            <Row label={t('documents.sources.fields.owner')}>
              <span dir="auto">{source.ownerLabel ?? EM_DASH}</span>
            </Row>
            <Row label={t('documents.sources.fields.uploadedAt')}>{formatDateTime(source.uploadedAt)}</Row>
            <Row label={t('documents.sources.columns.reportDate')}>{formatDate(source.reportDate)}</Row>
            <Row label={t('documents.sources.columns.asOfDate')}>{formatDate(source.asOfDate)}</Row>
            <Row label={t('documents.sources.columns.extractionDate')}>{formatDate(source.extractionDate)}</Row>
            <Row label={t('documents.sources.columns.extraction')}>
              <StatusBadge enumName="extractionStatuses" value={source.extractionStatus} />
            </Row>
            <Row label={t('documents.sources.fields.checksum')}>
              <code dir="ltr" className="break-all text-xs">
                {source.checksum ?? EM_DASH}
              </code>
            </Row>
            <Row label={t('documents.sources.fields.extractionNote')} wide>
              <span dir="auto" data-testid="source-extraction-note">
                {source.extractionNote ?? EM_DASH}
              </span>
            </Row>
            {source.supersedesSourceId ? (
              <Row label={t('documents.sources.fields.supersedes')}>
                <Link className={btn.link} href={`/projects/${projectId}/documents/sources/${source.supersedesSourceId}`}>
                  {t('documents.sources.previous')}
                </Link>
              </Row>
            ) : null}
            {source.supersededBySourceId ? (
              <Row label={t('documents.sources.supersededBy')}>
                <Link className={btn.link} href={`/projects/${projectId}/documents/sources/${source.supersededBySourceId}`}>
                  {t('documents.sources.newer')}
                </Link>
              </Row>
            ) : null}
          </dl>
        </section>

        {hasHistorical ? (
          <p role="note" className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning-soft p-3 text-sm text-ink" data-testid="historical-notice">
            <History aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning" />
            {t('documents.claims.historicalNotice')}
          </p>
        ) : null}

        <section aria-labelledby="src-claims">
          <h2 id="src-claims" className="mb-3 text-lg font-semibold">
            {t('documents.claims.title')}
          </h2>
          <DataTable caption={t('documents.claims.title')} columns={claimColumns} rows={source.claims} rowKey={(c) => c.id} emptyTitle={t('documents.claims.empty')} clientPageSize={25} testId="claims-table" />
        </section>

        <section aria-labelledby="src-compare">
          <h2 id="src-compare" className="mb-1 flex items-center gap-2 text-lg font-semibold">
            <GitCompareArrows aria-hidden="true" className="size-5 text-muted" />
            {t('documents.compare.title')}
          </h2>
          <p className="mb-3 text-sm text-muted">{t('documents.compare.hint')}</p>
          <DataTable
            caption={t('documents.compare.title')}
            columns={compareColumns}
            rows={compare.data?.rows}
            rowKey={(r) => r.claimId}
            isLoading={compare.isLoading}
            error={compare.error}
            onRetry={() => compare.refetch()}
            emptyTitle={t('documents.claims.empty')}
            clientPageSize={25}
            testId="compare-table"
          />
        </section>
      </div>

      {canManage ? <AddClaimDialog open={addOpen} onClose={() => setAddOpen(false)} source={source} /> : null}

      {canManage ? (
        <ConfirmCommandDialog
          open={extractionOpen}
          onClose={() => setExtractionOpen(false)}
          title={t('documents.sources.recordExtraction')}
          confirmLabel={t('common.actions.save')}
          noteMode="none"
          expectedVersion={source.version}
          onReload={refresh}
          consequences={[t('documents.sources.extractionEffect'), t('common.command.audited')]}
          onConfirm={async () => {
            await api(documentsRoutes.recordExtraction, {
              params: { projectId, sourceId: source.id },
              body: { expectedVersion: source.version, extractionStatus: ex.status, extractionDate: ex.date || null, ...(ex.note.trim() ? { extractionNote: ex.note.trim() } : {}) },
            });
            await refresh();
            toast.show('success', t('documents.sources.extractionSaved'));
            setExtractionOpen(false);
          }}
        >
          <div className="space-y-4">
            <SelectField label={t('documents.sources.columns.extraction')} required value={ex.status} onChange={(e) => setEx((x) => ({ ...x, status: e.target.value as ExtractionStatus }))}>
              {EXTRACTION_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {tStatus('extractionStatuses', s)}
                </option>
              ))}
            </SelectField>
            <TextField label={t('documents.sources.columns.extractionDate')} type="date" dir="ltr" value={ex.date} onChange={(e) => setEx((x) => ({ ...x, date: e.target.value }))} />
            <TextAreaField label={t('documents.sources.fields.extractionNote')} value={ex.note} maxLength={2000} onChange={(e) => setEx((x) => ({ ...x, note: e.target.value }))} />
          </div>
        </ConfirmCommandDialog>
      ) : null}

      <ConfirmCommandDialog
        open={pending !== null}
        onClose={() => setPending(null)}
        title={pending?.kind === 'review' ? t('documents.claims.reviewTitle') : t('documents.claims.proposeTitle')}
        confirmLabel={pending?.kind === 'review' ? t('documents.claims.review') : t('documents.claims.propose')}
        noteMode="optional"
        expectedVersion={pending?.claim.version}
        onReload={refresh}
        confirmDisabled={pending?.kind === 'review' && review.status === 'confirmed' && !review.confirmedValue.trim()}
        consequences={
          pending?.kind === 'review'
            ? [t('documents.claims.reviewEffect'), t('documents.claims.sod'), ...(pending.claim.verificationStatus === 'historical_unverified' ? [t('documents.claims.historicalCannotConfirm')] : []), t('common.command.audited')]
            : [
                t('documents.claims.proposeEffect', { value: pending?.claim.confirmedValue ?? '' }),
                t('documents.claims.proposeNoChange'),
                t('common.command.audited'),
              ]
        }
        onConfirm={async ({ note }) => {
          if (!pending) return;
          const params = { projectId, claimId: pending.claim.id };
          if (pending.kind === 'review') {
            await api(documentsRoutes.reviewClaim, {
              params,
              body: { expectedVersion: pending.claim.version, verificationStatus: review.status, ...(review.status === 'confirmed' ? { confirmedValue: review.confirmedValue.trim() } : {}), ...(note ? { note } : {}) },
            });
            toast.show('success', t('documents.claims.reviewed'));
          } else {
            await api(documentsRoutes.proposeClaimChange, { params, body: { expectedVersion: pending.claim.version, ...(note ? { note } : {}) } });
            toast.show('success', t('documents.claims.proposed'));
          }
          await refresh();
          setPending(null);
        }}
      >
        {pending?.kind === 'review' ? (
          <div className="space-y-4">
            <SelectField label={t('documents.claims.columns.verification')} required value={review.status} onChange={(e) => setReview((r) => ({ ...r, status: e.target.value as VerificationStatus }))}>
              {VERIFICATION_STATUSES.filter((s) => !(pending.claim.verificationStatus === 'historical_unverified' && s === 'confirmed')).map((s) => (
                <option key={s} value={s}>
                  {tStatus('verificationStatuses', s)}
                </option>
              ))}
            </SelectField>
            {review.status === 'confirmed' ? (
              <TextField label={t('documents.claims.columns.confirmed')} required value={review.confirmedValue} maxLength={4000} onChange={(e) => setReview((r) => ({ ...r, confirmedValue: e.target.value }))} />
            ) : null}
          </div>
        ) : null}
      </ConfirmCommandDialog>
    </>
  );
}

export default function SourceDetailPage() {
  const { sourceId } = useParams<{ sourceId: string }>();
  const { projectId } = useProjectContext();
  const source = useQuery({
    queryKey: dqk.source(projectId, sourceId),
    queryFn: ({ signal }) => api(documentsRoutes.getSource, { params: { projectId, sourceId }, signal }),
    retry: (n, e) => !(isApiError(e) && e.status < 500) && n < 2,
  });
  return (
    <SectionGuard section="documents">
      {source.isLoading ? <LoadingState /> : source.error ? isApiError(source.error) && (source.error.isHidden || source.error.isForbidden) ? <RestrictedState /> : <ErrorState error={source.error} onRetry={() => source.refetch()} /> : source.data ? <SourceView source={source.data} /> : null}
    </SectionGuard>
  );
}
