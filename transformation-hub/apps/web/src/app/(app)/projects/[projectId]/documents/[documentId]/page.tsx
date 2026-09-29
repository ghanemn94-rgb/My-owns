'use client';

import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, ChevronLeft, Download, FolderLock, Link2, ShieldAlert, ShieldOff, Tag, Timer, Trash2 } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { documentsRoutes } from '@hub/contracts';
import { classificationRank, type Classification } from '@hub/domain';
import { ActivityHistory } from '@/components/ActivityHistory';
import { ConfirmCommandDialog } from '@/components/ConfirmCommandDialog';
import { DataTable, type Column } from '@/components/DataTable';
import { DemoBadge } from '@/components/DemoBadge';
import { ErrorState } from '@/components/ErrorState';
import { LinkEvidenceDialog } from '@/components/EvidencePanel';
import { SelectField, TextField } from '@/components/Field';
import { LoadingState } from '@/components/LoadingState';
import { PageHeader } from '@/components/PageHeader';
import { RestrictedState } from '@/components/RestrictedState';
import { SectionGuard } from '@/components/SectionGuard';
import { StatusBadge } from '@/components/StatusBadge';
import { useToast } from '@/components/Toast';
import { btn, card, cx } from '@/components/ui';
import { EM_DASH, useI18n } from '@/i18n/provider';
import { api, isApiError } from '@/lib/api';
import { assignableClassifications, dqk, downloadHref, formatBytes, shortRoom, useUploadPolicy, type DocumentDetail, type DocumentVersion } from '@/lib/documents';
import { useProjectContext } from '@/lib/project-context';
import { projectAccess } from '@/lib/queries';
import { ClassificationBadge, HoldBadge, RoomBadge } from '../_components/bits';
import { UploadPanel } from '../_components/UploadPanel';

type Dialog = 'classify' | 'room' | 'hold' | 'retention' | 'requestDisposal' | 'dispose' | 'evidence' | null;

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

function Actions({ doc, open }: { doc: DocumentDetail; open: (d: Dialog) => void }) {
  const { t } = useI18n();
  const { can } = useProjectContext();
  const current = doc.versions.find((v) => v.id === doc.currentVersion?.id);
  const items: { key: Dialog; label: string; icon: ReactNode; show: boolean; testId: string }[] = [
    { key: 'evidence', label: t('documents.detail.linkAsEvidence'), icon: <Link2 aria-hidden="true" className="size-4" />, show: can('documents.evidence.link') && !!current?.downloadable, testId: 'doc-link-evidence' },
    { key: 'classify', label: t('documents.classify.action'), icon: <Tag aria-hidden="true" className="size-4" />, show: can(['documents.document.classify', 'documents.document.declassify']), testId: 'doc-classify' },
    { key: 'room', label: t('documents.room.action'), icon: <FolderLock aria-hidden="true" className="size-4" />, show: can('documents.document.classify'), testId: 'doc-room' },
    { key: 'hold', label: doc.legalHold ? t('documents.hold.release') : t('documents.hold.place'), icon: doc.legalHold ? <ShieldOff aria-hidden="true" className="size-4" /> : <ShieldAlert aria-hidden="true" className="size-4" />, show: can('documents.legal_hold.manage'), testId: 'doc-hold' },
    { key: 'retention', label: t('documents.retention.action'), icon: <Timer aria-hidden="true" className="size-4" />, show: can('documents.legal_hold.manage'), testId: 'doc-retention' },
    { key: 'requestDisposal', label: t('documents.disposal.request'), icon: <Archive aria-hidden="true" className="size-4" />, show: can('documents.document.archive') && !doc.pendingDisposalRequest, testId: 'doc-request-disposal' },
    { key: 'dispose', label: t('documents.disposal.execute'), icon: <Trash2 aria-hidden="true" className="size-4" />, show: can('documents.document.dispose') && !!doc.pendingDisposalRequest, testId: 'doc-dispose' },
  ];
  return (
    <>
      {items
        .filter((i) => i.show)
        .map((i) => (
          <button key={i.key} type="button" className={i.key === 'dispose' ? btn.danger : btn.secondary} onClick={() => open(i.key)} data-testid={i.testId}>
            {i.icon}
            {i.label}
          </button>
        ))}
    </>
  );
}

function DocumentDetailView({ doc }: { doc: DocumentDetail }) {
  const { t, tStatus, formatDate, formatDateTime, formatNumber, locale } = useI18n();
  const { projectId, can, me } = useProjectContext();
  const queryClient = useQueryClient();
  const toast = useToast();
  const policy = useUploadPolicy(projectId);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [target, setTarget] = useState<Classification>(doc.classification as Classification);
  const [room, setRoom] = useState<string>(doc.roomId ?? '');
  const [retention, setRetention] = useState<string>(doc.retentionUntil ?? '');
  const refresh = () => queryClient.invalidateQueries({ queryKey: dqk.all(projectId) });
  const close = () => setDialog(null);
  const openDialog = (d: Dialog) => {
    // Start every dialog from the record as currently loaded.
    setTarget(doc.classification as Classification);
    setRoom(doc.roomId ?? '');
    setRetention(doc.retentionUntil ?? '');
    setDialog(d);
  };
  const current = doc.versions.find((v) => v.id === doc.currentVersion?.id) ?? null;
  const mine = (id: string | null) => !!id && id === me.user.id;
  const rooms = projectAccess(me, projectId)?.roomIds ?? [];

  // Classification options: raising needs classify, lowering needs declassify; never above the user's clearance.
  const curRank = classificationRank(doc.classification as Classification);
  const classOptions = assignableClassifications(me.user.clearance as Classification).filter((c) => {
    const r = classificationRank(c);
    if (r === curRank) return false;
    return r > curRank ? can('documents.document.classify') : can('documents.document.declassify');
  });
  const lowering = classificationRank(target) < curRank;

  const columns: Column<DocumentVersion>[] = [
    {
      key: 'version',
      header: t('documents.versions.columns.version'),
      isRowHeader: true,
      cell: (v) => (
        <span className="flex items-center gap-1.5 whitespace-nowrap">
          {t('documents.versions.label', { version: v.versionNo })}
          {v.id === current?.id ? <span className="rounded bg-primary-soft px-1.5 text-xs font-medium text-primary">{t('documents.versions.current')}</span> : null}
        </span>
      ),
    },
    {
      key: 'file',
      header: t('documents.versions.columns.file'),
      className: 'min-w-44',
      cell: (v) => (
        <span className="flex flex-col">
          <span dir="auto" className="wrap-anywhere">
            {v.filename}
          </span>
          {v.note ? (
            <span className="text-xs text-muted" dir="auto">
              {v.note}
            </span>
          ) : null}
        </span>
      ),
    },
    { key: 'type', header: t('documents.versions.columns.type'), cell: (v) => <span dir="ltr">{v.detectedType ?? EM_DASH}</span> },
    { key: 'size', header: t('documents.versions.columns.size'), cell: (v) => <span className="tabular whitespace-nowrap">{formatBytes(v.sizeBytes, locale)}</span> },
    {
      key: 'scan',
      header: t('documents.versions.columns.scan'),
      cell: (v) => (
        <span className="flex flex-col gap-1">
          <StatusBadge enumName="scanStatuses" value={v.scanStatus} />
          {v.scanStatus === 'quarantined' ? <span className="text-xs text-danger">{t('documents.versions.quarantinedHint')}</span> : null}
        </span>
      ),
    },
    { key: 'extraction', header: t('documents.versions.columns.extraction'), cell: (v) => <StatusBadge enumName="extractionStatuses" value={v.extractionStatus} /> },
    {
      key: 'uploaded',
      header: t('documents.versions.columns.uploaded'),
      cell: (v) => (
        <span className="tabular whitespace-nowrap">
          {formatDateTime(v.uploadedAt)}
          {mine(v.uploadedBy) ? <span className="text-muted"> · {t('documents.versions.uploadedByYou')}</span> : null}
        </span>
      ),
    },
    {
      key: 'actions',
      header: t('documents.versions.columns.actions'),
      cell: (v) =>
        v.downloadable && can('documents.document.download') ? (
          <a
            href={downloadHref(projectId, doc.id, v.id)}
            className="inline-flex min-h-9 items-center gap-1 rounded-md px-2 text-sm font-medium text-primary hover:bg-primary-soft"
            aria-label={t('documents.versions.downloadFor', { version: v.versionNo })}
            data-testid="version-download"
          >
            <Download aria-hidden="true" className="size-4" />
            {t('documents.versions.download')}
          </a>
        ) : (
          <span className="text-xs text-muted">{t('documents.versions.notDownloadable')}</span>
        ),
    },
  ];

  return (
    <>
      <Link href={`/projects/${projectId}/documents`} className={cx(btn.link, 'mb-3 inline-flex items-center gap-1 text-sm')}>
        <ChevronLeft aria-hidden="true" className="size-4 rtl:rotate-180" />
        {t('documents.detail.back')}
      </Link>
      <PageHeader
        eyebrow={tStatus('documentKinds', doc.kind)}
        title={<span dir="auto">{doc.title}</span>}
        documentTitle={doc.title}
        badges={
          <>
            {doc.isDemo ? <DemoBadge /> : null}
            <ClassificationBadge value={doc.classification} />
            <RoomBadge roomId={doc.roomId} />
            {doc.legalHold ? <HoldBadge /> : null}
          </>
        }
        actions={<Actions doc={doc} open={openDialog} />}
      />

      <div className="space-y-6">
        <section aria-labelledby="doc-meta" className={cx(card, 'p-4')}>
          <h2 id="doc-meta" className="mb-3 text-lg font-semibold">
            {t('documents.detail.metadata')}
          </h2>
          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Row label={t('documents.list.columns.kind')}>{tStatus('documentKinds', doc.kind)}</Row>
            <Row label={t('documents.list.columns.classification')}>{tStatus('classifications', doc.classification)}</Row>
            <Row label={t('documents.detail.room')}>{doc.roomId ? t('documents.detail.roomRestricted', { room: shortRoom(doc.roomId) }) : t('documents.detail.roomProject')}</Row>
            <Row label={t('documents.detail.owner')}>{mine(doc.ownerUserId) || mine(doc.createdBy) ? t('documents.detail.you') : t('documents.detail.ownerOther')}</Row>
            <Row label={t('documents.detail.createdAt')}>{formatDateTime(doc.createdAt)}</Row>
            <Row label={t('documents.detail.updatedAt')}>{formatDateTime(doc.updatedAt)}</Row>
            <Row label={t('documents.detail.retention')}>{doc.retentionUntil ? formatDate(doc.retentionUntil) : t('documents.detail.noRetention')}</Row>
            <Row label={t('documents.detail.legalHold')}>
              {doc.legalHold ? (
                <span className="text-danger" dir="auto">
                  {t('documents.detail.legalHoldOn')}
                  {doc.legalHoldReason ? ` — ${doc.legalHoldReason}` : ''}
                </span>
              ) : (
                t('documents.detail.legalHoldOff')
              )}
            </Row>
            <Row label={t('documents.detail.evidenceUse')}>
              <span data-testid="doc-evidence-counts">{t('documents.detail.evidenceCounts', { active: formatNumber(doc.evidence.active), conflicting: formatNumber(doc.evidence.conflicting) })}</span>
            </Row>
          </dl>
        </section>

        {doc.pendingDisposalRequest ? (
          <section className="rounded-lg border border-warning/40 bg-warning-soft p-4 text-sm" data-testid="pending-disposal">
            <p className="font-semibold">{t('documents.disposal.pending', { who: mine(doc.pendingDisposalRequest.requestedBy) ? t('documents.detail.you') : t('documents.detail.ownerOther'), date: formatDateTime(doc.pendingDisposalRequest.createdAt) })}</p>
            {doc.pendingDisposalRequest.reason ? (
              <p className="mt-1" dir="auto">
                {t('documents.disposal.reason')}: {doc.pendingDisposalRequest.reason}
              </p>
            ) : null}
            <p className="mt-1 text-muted">{t('documents.disposal.executeSod')}</p>
          </section>
        ) : null}

        {can('documents.document.upload') ? (
          <UploadPanel documentId={doc.id} policy={policy.data} disabledReason={doc.legalHold ? t('documents.upload.legalHold') : null} />
        ) : null}

        <section aria-labelledby="doc-versions">
          <h2 id="doc-versions" className="mb-1 text-lg font-semibold">
            {t('documents.versions.title')}
          </h2>
          <p className="mb-3 text-sm text-muted">{t('documents.extraction.hint')}</p>
          <DataTable caption={t('documents.versions.title')} columns={columns} rows={doc.versions} rowKey={(v) => v.id} emptyTitle={t('documents.versions.empty')} testId="versions-table" />
        </section>

        {can('audit.event.read') ? <ActivityHistory projectId={projectId} entityType="document" entityId={doc.id} /> : null}
      </div>

      {/* ---- dialogs ---- */}
      {current ? <LinkEvidenceDialog open={dialog === 'evidence'} onClose={close} document={{ id: doc.id, versionId: current.id, title: doc.title }} /> : null}

      <ConfirmCommandDialog
        open={dialog === 'classify'}
        onClose={close}
        title={t('documents.classify.title')}
        confirmLabel={t('documents.classify.confirm')}
        noteMode="required"
        noteLabel={t('documents.hold.reason')}
        expectedVersion={doc.version}
        onReload={refresh}
        confirmDisabled={target === doc.classification}
        consequences={[
          lowering ? t('documents.classify.effectLower', { classification: tStatus('classifications', target) }) : t('documents.classify.effectRaise', { classification: tStatus('classifications', target) }),
          t('documents.classify.effectIndex'),
          lowering ? t('documents.classify.sod') : t('common.command.audited'),
        ]}
        onConfirm={async ({ note }) => {
          const route = lowering ? documentsRoutes.declassifyDocument : documentsRoutes.classifyDocument;
          await api(route, { params: { projectId, documentId: doc.id }, body: { expectedVersion: doc.version, classification: target, reason: note } });
          await refresh();
          toast.show('success', t('documents.classify.done'));
          close();
        }}
      >
        <SelectField label={t('documents.classify.new')} required value={target} onChange={(e) => setTarget(e.target.value as Classification)}>
          <option value={doc.classification}>{tStatus('classifications', doc.classification)} ({t('documents.classify.currentValue')})</option>
          {classOptions.map((c) => (
            <option key={c} value={c}>
              {tStatus('classifications', c)}
            </option>
          ))}
        </SelectField>
      </ConfirmCommandDialog>

      <ConfirmCommandDialog
        open={dialog === 'room'}
        onClose={close}
        title={t('documents.room.title')}
        confirmLabel={t('documents.room.confirm')}
        noteMode="required"
        noteLabel={t('documents.hold.reason')}
        expectedVersion={doc.version}
        onReload={refresh}
        confirmDisabled={(doc.roomId ?? '') === room}
        consequences={[t('documents.room.effect'), t('documents.classify.effectIndex'), t('documents.room.cleanTeamLocked')]}
        onConfirm={async ({ note }) => {
          await api(documentsRoutes.moveDocumentRoom, { params: { projectId, documentId: doc.id }, body: { expectedVersion: doc.version, roomId: room || null, reason: note } });
          await refresh();
          toast.show('success', t('documents.room.done'));
          close();
        }}
      >
        <SelectField label={t('documents.room.target')} required value={room} onChange={(e) => setRoom(e.target.value)} hint={t('documents.create.roomHint')}>
          <option value="">{t('documents.create.noRoom')}</option>
          {[...new Set([...(doc.roomId ? [doc.roomId] : []), ...rooms])].map((r) => (
            <option key={r} value={r}>
              {t('documents.create.roomOption', { room: shortRoom(r) })}
            </option>
          ))}
        </SelectField>
      </ConfirmCommandDialog>

      <ConfirmCommandDialog
        open={dialog === 'hold'}
        onClose={close}
        title={doc.legalHold ? t('documents.hold.releaseTitle') : t('documents.hold.placeTitle')}
        confirmLabel={doc.legalHold ? t('documents.hold.release') : t('documents.hold.place')}
        danger={!doc.legalHold}
        noteMode="required"
        noteLabel={t('documents.hold.reason')}
        expectedVersion={doc.version}
        onReload={refresh}
        consequences={[doc.legalHold ? t('documents.hold.effectRelease') : t('documents.hold.effectPlace'), t('common.command.audited')]}
        onConfirm={async ({ note }) => {
          await api(documentsRoutes.setLegalHold, { params: { projectId, documentId: doc.id }, body: { expectedVersion: doc.version, hold: !doc.legalHold, reason: note } });
          await refresh();
          toast.show('success', doc.legalHold ? t('documents.hold.doneRelease') : t('documents.hold.donePlace'));
          close();
        }}
      />

      <ConfirmCommandDialog
        open={dialog === 'retention'}
        onClose={close}
        title={t('documents.retention.title')}
        confirmLabel={t('documents.retention.confirm')}
        noteMode="required"
        noteLabel={t('documents.hold.reason')}
        expectedVersion={doc.version}
        onReload={refresh}
        consequences={[t('documents.retention.effect'), t('common.command.audited')]}
        onConfirm={async ({ note }) => {
          await api(documentsRoutes.setRetention, { params: { projectId, documentId: doc.id }, body: { expectedVersion: doc.version, retentionUntil: retention || null, reason: note } });
          await refresh();
          toast.show('success', t('documents.retention.done'));
          close();
        }}
      >
        <TextField label={t('documents.retention.date')} type="date" dir="ltr" value={retention} onChange={(e) => setRetention(e.target.value)} hint={t('documents.retention.clearHint')} />
      </ConfirmCommandDialog>

      <ConfirmCommandDialog
        open={dialog === 'requestDisposal'}
        onClose={close}
        title={t('documents.disposal.requestTitle')}
        confirmLabel={t('documents.disposal.request')}
        noteMode="required"
        noteLabel={t('documents.disposal.reason')}
        expectedVersion={doc.version}
        onReload={refresh}
        consequences={[t('documents.disposal.requestEffect'), t('documents.disposal.requestRefused'), t('common.command.audited')]}
        onConfirm={async ({ note }) => {
          await api(documentsRoutes.requestDisposal, { params: { projectId, documentId: doc.id }, body: { expectedVersion: doc.version, reason: note } });
          await refresh();
          toast.show('success', t('documents.disposal.requested'));
          close();
        }}
      />

      {doc.pendingDisposalRequest ? (
        <ConfirmCommandDialog
          open={dialog === 'dispose'}
          onClose={close}
          title={t('documents.disposal.executeTitle')}
          confirmLabel={t('documents.disposal.execute')}
          danger
          noteMode="required"
          noteLabel={t('documents.disposal.reason')}
          expectedVersion={doc.version}
          onReload={refresh}
          consequences={[t('documents.disposal.executeEffect'), t('documents.disposal.executeEvidence'), t('documents.disposal.executeSod'), t('common.command.audited')]}
          onConfirm={async ({ note }) => {
            await api(documentsRoutes.disposeDocument, { params: { projectId, documentId: doc.id }, body: { expectedVersion: doc.version, requestId: doc.pendingDisposalRequest!.id, reason: note } });
            await refresh();
            toast.show('success', t('documents.disposal.done'));
            close();
          }}
        />
      ) : null}
    </>
  );
}

export default function DocumentDetailPage() {
  const { documentId } = useParams<{ documentId: string }>();
  const { projectId } = useProjectContext();
  const detail = useQuery({
    queryKey: dqk.detail(projectId, documentId),
    queryFn: ({ signal }) => api(documentsRoutes.getDocument, { params: { projectId, documentId }, signal }),
    retry: (n, e) => !(isApiError(e) && e.status < 500) && n < 2,
  });
  return (
    <SectionGuard section="documents">
      {detail.isLoading ? <LoadingState /> : detail.error ? isApiError(detail.error) && (detail.error.isHidden || detail.error.isForbidden) ? <RestrictedState /> : <ErrorState error={detail.error} onRetry={() => detail.refetch()} /> : detail.data ? <DocumentDetailView doc={detail.data} /> : null}
    </SectionGuard>
  );
}
