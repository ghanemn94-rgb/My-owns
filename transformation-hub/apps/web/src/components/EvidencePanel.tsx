'use client';

import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, CheckCheck, FileText, Link2, Plus, Replace, ShieldAlert, StickyNote } from 'lucide-react';
import { useId, useState } from 'react';
import { documentsRoutes } from '@hub/contracts';
import type { EvidenceTargetType } from '@hub/domain';
import { EM_DASH, useI18n } from '@/i18n/provider';
import { api } from '@/lib/api';
import { dqk, type EvidenceLink } from '@/lib/documents';
import { useProjectContext } from '@/lib/project-context';
import { ConfirmCommandDialog } from './ConfirmCommandDialog';
import { EmptyState } from './EmptyState';
import { ErrorState } from './ErrorState';
import { EvidenceTargetPicker, type PickedTarget } from './EvidenceTargetPicker';
import { SelectField, TextAreaField, TextField } from './Field';
import { LoadingState } from './LoadingState';
import { SearchInput } from './SearchInput';
import { StatusBadge } from './StatusBadge';
import { useToast } from './Toast';
import { btn, card, cx } from './ui';

const shortId = (id: string) => `#${id.slice(-6)}`;

/** Search visible documents and pick one of their usable versions (the server re-checks everything). */
function DocumentVersionPicker({
  value,
  onChange,
}: {
  value: { documentId: string; versionId: string | null } | null;
  onChange: (v: { documentId: string; versionId: string | null; title: string } | null) => void;
}) {
  const { t } = useI18n();
  const { projectId } = useProjectContext();
  const [q, setQ] = useState('');
  const versionSel = useId();
  const docs = useQuery({
    queryKey: dqk.list(projectId, { picker: true, q }),
    queryFn: ({ signal }) => api(documentsRoutes.listDocuments, { params: { projectId }, query: { q: q || undefined, page: 1, pageSize: 20 }, signal }),
  });
  const detail = useQuery({
    queryKey: dqk.detail(projectId, value?.documentId ?? ''),
    enabled: !!value?.documentId,
    queryFn: ({ signal }) => api(documentsRoutes.getDocument, { params: { projectId, documentId: value!.documentId }, signal }),
  });
  const usable = (detail.data?.versions ?? []).filter((v) => v.downloadable);
  return (
    <div className="space-y-2" data-testid="evidence-document-picker">
      <SearchInput label={t('documents.evidence.searchDocuments')} value={q} onChange={setQ} />
      <ul className="max-h-48 overflow-y-auto rounded-md border border-line" role="listbox" aria-label={t('documents.evidence.document')}>
        {docs.isLoading ? <li className="px-3 py-2 text-sm text-muted">{t('states.loading')}</li> : null}
        {(docs.data?.items ?? []).length === 0 && !docs.isLoading ? <li className="px-3 py-2 text-sm text-muted">{t('documents.list.emptySearch')}</li> : null}
        {(docs.data?.items ?? []).map((d) => (
          <li key={d.id} role="option" aria-selected={value?.documentId === d.id}>
            <button
              type="button"
              className={cx('flex w-full items-center gap-2 px-3 py-2 text-start text-sm hover:bg-surface-muted', value?.documentId === d.id && 'bg-primary-soft font-semibold text-primary')}
              onClick={() => onChange({ documentId: d.id, versionId: d.currentVersion?.id ?? null, title: d.title })}
            >
              <FileText aria-hidden="true" className="size-4 shrink-0 text-muted" />
              <span dir="auto" className="min-w-0 truncate">
                {d.title}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {value?.documentId ? (
        <div>
          <label htmlFor={versionSel} className="text-xs text-muted">
            {t('documents.evidence.version')}
          </label>
          <select
            id={versionSel}
            className="block min-h-10 w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-sm"
            value={value.versionId ?? ''}
            onChange={(e) => onChange({ documentId: value.documentId, versionId: e.target.value || null, title: detail.data?.title ?? '' })}
          >
            {usable.length === 0 ? <option value="">{t('documents.evidence.noUsableVersion')}</option> : null}
            {usable.map((v) => (
              <option key={v.id} value={v.id}>
                {t('documents.versions.label', { version: v.versionNo })} — {v.filename}
              </option>
            ))}
          </select>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Link evidence: either to a FIXED record (EvidencePanel) choosing a document, or from a FIXED document version
 * (document detail) choosing the record. Optionally marks the new link as contradicting earlier evidence (AT-14).
 */
export function LinkEvidenceDialog({
  open,
  onClose,
  target,
  document,
  existing = [],
}: {
  open: boolean;
  onClose: () => void;
  target?: { type: EvidenceTargetType; id: string };
  document?: { id: string; versionId: string; title: string };
  existing?: EvidenceLink[];
}) {
  const { t } = useI18n();
  const { projectId } = useProjectContext();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [picked, setPicked] = useState<PickedTarget | null>(null);
  const [doc, setDoc] = useState<{ documentId: string; versionId: string | null; title: string } | null>(null);
  const [noteOnly, setNoteOnly] = useState(false);
  const [note, setNote] = useState('');
  const [purpose, setPurpose] = useState('');
  const [contradicts, setContradicts] = useState('');
  const [conflictNote, setConflictNote] = useState('');
  const reset = () => {
    setPicked(null);
    setDoc(null);
    setNoteOnly(false);
    setNote('');
    setPurpose('');
    setContradicts('');
    setConflictNote('');
  };
  const effectiveTarget = target ?? (picked ? { type: picked.type as EvidenceTargetType, id: picked.id } : null);
  const effectiveDoc = document ? { documentId: document.id, versionId: document.versionId, title: document.title } : doc;
  const hasEvidence = noteOnly ? note.trim().length > 0 : !!effectiveDoc?.versionId;
  const reliedUpon = existing.filter((l) => l.status === 'active' || l.status === 'conflicting');

  return (
    <ConfirmCommandDialog
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title={t('documents.evidence.linkTitle')}
      confirmLabel={t('documents.evidence.linkConfirm')}
      noteMode="none"
      confirmDisabled={!effectiveTarget || !hasEvidence || (!!contradicts && !conflictNote.trim())}
      consequences={[
        effectiveTarget
          ? picked
            ? t('documents.evidence.linkEffect', { record: picked.label })
            : t('documents.evidence.linkEffectThis')
          : t('documents.evidence.pickRecord'),
        t('documents.evidence.linkUnverified'),
        ...(contradicts ? [t('documents.evidence.conflictEffect')] : []),
        t('common.command.audited'),
      ]}
      onConfirm={async () => {
        if (!effectiveTarget) return;
        const res = await api(documentsRoutes.linkEvidence, {
          params: { projectId },
          body: {
            targetType: effectiveTarget.type,
            targetId: effectiveTarget.id,
            ...(noteOnly ? { note: note.trim() } : { documentId: effectiveDoc!.documentId, documentVersionId: effectiveDoc!.versionId! }),
            ...(purpose.trim() ? { purpose: purpose.trim() } : {}),
            ...(contradicts ? { conflictsWithLinkId: contradicts, conflictNote: conflictNote.trim() } : {}),
          },
        });
        await queryClient.invalidateQueries({ queryKey: dqk.evidenceAll(projectId) });
        await queryClient.invalidateQueries({ queryKey: dqk.all(projectId) });
        toast.show('success', res.status === 'conflicting' ? t('documents.evidence.linkedConflicting') : t('documents.evidence.linked'));
        reset();
        onClose();
      }}
    >
      <div className="space-y-4">
        {!target ? <EvidenceTargetPicker value={picked} onChange={setPicked} /> : null}
        {!document ? (
          <>
            <fieldset className="flex flex-wrap gap-4 text-sm">
              <legend className="sr-only">{t('documents.evidence.kind')}</legend>
              <label className="inline-flex items-center gap-2">
                <input type="radio" name="evidence-kind" checked={!noteOnly} onChange={() => setNoteOnly(false)} />
                {t('documents.evidence.kindDocument')}
              </label>
              <label className="inline-flex items-center gap-2">
                <input type="radio" name="evidence-kind" checked={noteOnly} onChange={() => setNoteOnly(true)} />
                {t('documents.evidence.kindNote')}
              </label>
            </fieldset>
            {noteOnly ? (
              <TextAreaField label={t('documents.evidence.note')} required value={note} maxLength={4000} onChange={(e) => setNote(e.target.value)} />
            ) : (
              <DocumentVersionPicker value={doc} onChange={setDoc} />
            )}
          </>
        ) : (
          <p className="text-sm">
            {t('documents.evidence.document')}: <span dir="auto" className="font-medium">{document.title}</span>
          </p>
        )}
        <TextField label={t('documents.evidence.purpose')} value={purpose} maxLength={500} onChange={(e) => setPurpose(e.target.value)} />
        {target && reliedUpon.length > 0 ? (
          <>
            <SelectField label={t('documents.evidence.contradicts')} hint={t('documents.evidence.contradictsHint')} value={contradicts} onChange={(e) => setContradicts(e.target.value)}>
              <option value="">{t('documents.evidence.contradictsNone')}</option>
              {reliedUpon.map((l) => (
                <option key={l.id} value={l.id}>
                  {shortId(l.id)} — {l.documentTitle ?? l.note ?? EM_DASH}
                </option>
              ))}
            </SelectField>
            {contradicts ? (
              <TextAreaField label={t('documents.evidence.conflictNote')} required value={conflictNote} maxLength={2000} onChange={(e) => setConflictNote(e.target.value)} />
            ) : null}
          </>
        ) : null}
      </div>
    </ConfirmCommandDialog>
  );
}

type Pending = { kind: 'accept' | 'reject' | 'supersede' | 'conflict'; link: EvidenceLink } | null;

/**
 * Evidence attached to one record (gate criterion, CP, task, …). Shared by every screen that shows evidence.
 * Links to documents the caller may not read are omitted by the API — including from the count.
 * Verification is hidden for the person who linked the evidence (separation of duties; the API enforces it).
 */
export function EvidencePanel({
  targetType,
  targetId,
  title,
  className,
}: {
  targetType: EvidenceTargetType;
  targetId: string;
  title?: string;
  className?: string;
}) {
  const { t, formatDateTime, formatNumber } = useI18n();
  const { projectId, can, me } = useProjectContext();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [showInactive, setShowInactive] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [pending, setPending] = useState<Pending>(null);
  const [conflictWith, setConflictWith] = useState('');
  const headingId = useId();

  const links = useQuery({
    queryKey: dqk.evidence(projectId, targetType, targetId),
    queryFn: ({ signal }) => api(documentsRoutes.listEvidence, { params: { projectId }, query: { targetType, targetId, includeInactive: 'true' }, signal }),
  });
  const all = links.data?.items ?? [];
  const visible = showInactive ? all : all.filter((l) => l.status === 'active' || l.status === 'conflicting');
  const canLink = can('documents.evidence.link');
  const canVerify = can('documents.evidence.verify');
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: dqk.evidenceAll(projectId) });
    await queryClient.invalidateQueries({ queryKey: dqk.all(projectId) });
  };
  const active = all.filter((l) => l.status === 'active').length;
  const conflicting = all.filter((l) => l.status === 'conflicting').length;

  return (
    <section aria-labelledby={headingId} className={cx(card, 'p-4', className)} data-testid="evidence-panel" data-target-type={targetType} data-target-id={targetId}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id={headingId} className="text-lg font-semibold">
            {title ?? t('documents.evidence.title')}
          </h2>
          <p className="text-sm text-muted">
            {links.data ? t('documents.evidence.counts', { active: formatNumber(active), conflicting: formatNumber(conflicting) }) : EM_DASH}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
            {t('documents.evidence.showInactive')}
          </label>
          {canLink ? (
            <button type="button" className={btn.primary} onClick={() => setLinkOpen(true)} data-testid="evidence-add">
              <Plus aria-hidden="true" className="size-4" />
              {t('documents.evidence.add')}
            </button>
          ) : null}
        </div>
      </div>
      {conflicting > 0 ? (
        <p role="note" className="mb-3 flex items-start gap-2 rounded-md border border-danger/40 bg-danger-soft p-3 text-sm text-danger">
          <ShieldAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {t('documents.evidence.conflictBanner')}
        </p>
      ) : null}
      {links.isLoading ? <LoadingState compact /> : null}
      {links.error ? <ErrorState error={links.error} onRetry={() => links.refetch()} /> : null}
      {links.data && visible.length === 0 ? <EmptyState title={t('documents.evidence.empty')} hint={t('documents.evidence.emptyHint')} /> : null}
      <ul className="space-y-2">
        {visible.map((l) => {
          const mine = l.addedBy === me.user.id;
          const open = l.status === 'active' || l.status === 'conflicting';
          return (
            <li key={l.id} className="rounded-md border border-line p-3" data-testid="evidence-link" data-link-id={l.id} data-status={l.status}>
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge enumName="evidenceLinkStatuses" value={l.status} />
                <span className="text-xs text-muted" dir="ltr">
                  {shortId(l.id)}
                </span>
                {l.documentId ? (
                  <Link href={`/projects/${projectId}/documents/${l.documentId}`} className={cx(btn.link, 'inline-flex items-center gap-1 text-sm')}>
                    <FileText aria-hidden="true" className="size-4" />
                    <span dir="auto">{l.documentTitle ?? EM_DASH}</span>
                    {l.versionNo !== null ? <span className="text-muted">· {t('documents.versions.label', { version: l.versionNo })}</span> : null}
                  </Link>
                ) : (
                  <span className="inline-flex items-center gap-1 text-sm">
                    <StickyNote aria-hidden="true" className="size-4 text-muted" />
                    {t('documents.evidence.kindNote')}
                  </span>
                )}
              </div>
              {l.note ? (
                <p className="mt-1 text-sm" dir="auto">
                  {l.note}
                </p>
              ) : null}
              {l.purpose ? (
                <p className="mt-1 text-sm text-muted" dir="auto">
                  {t('documents.evidence.purpose')}: {l.purpose}
                </p>
              ) : null}
              <p className="mt-1 text-xs text-muted">
                {l.reviewedAt ? t('documents.evidence.reviewedAt', { date: formatDateTime(l.reviewedAt) }) : t('documents.evidence.notReviewed')} ·{' '}
                {t('documents.evidence.addedAt', { date: formatDateTime(l.createdAt) })}
                {mine ? ` · ${t('documents.evidence.addedByYou')}` : ''}
              </p>
              {l.conflictWithLinkId ? (
                <p className="mt-1 text-xs text-danger" dir="auto">
                  {t('documents.evidence.conflictsWith', { link: shortId(l.conflictWithLinkId) })}
                  {l.conflictNote ? ` — ${l.conflictNote}` : ''}
                </p>
              ) : null}
              {open ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {canVerify && !mine ? (
                    <>
                      <button type="button" className={btn.secondary} onClick={() => setPending({ kind: 'accept', link: l })} data-testid="evidence-verify">
                        <CheckCheck aria-hidden="true" className="size-4" />
                        {t('documents.evidence.verify')}
                      </button>
                      <button type="button" className={btn.secondary} onClick={() => setPending({ kind: 'reject', link: l })}>
                        <Ban aria-hidden="true" className="size-4" />
                        {t('documents.evidence.reject')}
                      </button>
                    </>
                  ) : null}
                  {canLink ? (
                    <>
                      <button type="button" className={btn.ghost} onClick={() => setPending({ kind: 'conflict', link: l })}>
                        <Link2 aria-hidden="true" className="size-4" />
                        {t('documents.evidence.flagConflict')}
                      </button>
                      <button type="button" className={btn.ghost} onClick={() => setPending({ kind: 'supersede', link: l })}>
                        <Replace aria-hidden="true" className="size-4" />
                        {t('documents.evidence.supersede')}
                      </button>
                    </>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      {canLink ? <LinkEvidenceDialog open={linkOpen} onClose={() => setLinkOpen(false)} target={{ type: targetType, id: targetId }} existing={all} /> : null}

      <ConfirmCommandDialog
        open={pending !== null}
        onClose={() => {
          setPending(null);
          setConflictWith('');
        }}
        title={
          pending?.kind === 'accept'
            ? t('documents.evidence.verifyTitle')
            : pending?.kind === 'reject'
              ? t('documents.evidence.rejectTitle')
              : pending?.kind === 'conflict'
                ? t('documents.evidence.flagConflictTitle')
                : t('documents.evidence.supersedeTitle')
        }
        confirmLabel={
          pending?.kind === 'accept'
            ? t('documents.evidence.verify')
            : pending?.kind === 'reject'
              ? t('documents.evidence.reject')
              : pending?.kind === 'conflict'
                ? t('documents.evidence.flagConflict')
                : t('documents.evidence.supersede')
        }
        danger={pending?.kind === 'reject' || pending?.kind === 'conflict'}
        noteMode={pending?.kind === 'accept' || pending?.kind === 'reject' ? 'optional' : 'required'}
        expectedVersion={pending?.link.version}
        confirmDisabled={pending?.kind === 'conflict' && !conflictWith}
        onReload={refresh}
        consequences={
          pending?.kind === 'accept'
            ? [t('documents.evidence.verifyEffect'), t('documents.evidence.verifyIntegrity'), t('documents.evidence.sod'), t('common.command.audited')]
            : pending?.kind === 'reject'
              ? [t('documents.evidence.rejectEffect'), t('documents.evidence.reassess'), t('common.command.audited')]
              : pending?.kind === 'conflict'
                ? [t('documents.evidence.conflictEffect'), t('documents.evidence.reassess'), t('common.command.audited')]
                : [t('documents.evidence.supersedeEffect'), t('documents.evidence.reassess'), t('common.command.audited')]
        }
        onConfirm={async ({ note }) => {
          if (!pending) return;
          const params = { projectId, linkId: pending.link.id };
          const expectedVersion = pending.link.version;
          if (pending.kind === 'accept' || pending.kind === 'reject') {
            await api(documentsRoutes.verifyEvidence, { params, body: { expectedVersion, decision: pending.kind, ...(note ? { note } : {}) } });
            toast.show('success', pending.kind === 'accept' ? t('documents.evidence.verified') : t('documents.evidence.rejected'));
          } else if (pending.kind === 'conflict') {
            await api(documentsRoutes.flagEvidenceConflict, { params, body: { expectedVersion, withLinkId: conflictWith, note } });
            toast.show('success', t('documents.evidence.flagged'));
          } else {
            await api(documentsRoutes.supersedeEvidence, { params, body: { expectedVersion, note } });
            toast.show('success', t('documents.evidence.superseded'));
          }
          await refresh();
          setPending(null);
          setConflictWith('');
        }}
      >
        {pending?.kind === 'conflict' ? (
          <SelectField label={t('documents.evidence.conflictWith')} required value={conflictWith} onChange={(e) => setConflictWith(e.target.value)}>
            <option value="">{t('documents.evidence.chooseLink')}</option>
            {all
              .filter((l) => l.id !== pending.link.id && (l.status === 'active' || l.status === 'conflicting'))
              .map((l) => (
                <option key={l.id} value={l.id}>
                  {shortId(l.id)} — {l.documentTitle ?? l.note ?? EM_DASH}
                </option>
              ))}
          </SelectField>
        ) : null}
      </ConfirmCommandDialog>
    </section>
  );
}
