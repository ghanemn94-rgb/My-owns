'use client';

import { useQuery } from '@tanstack/react-query';
import { CircleCheck, FileText, Info, StickyNote } from 'lucide-react';
import { useId, useState } from 'react';
import { documentsRoutes } from '@hub/contracts';
import { ErrorState } from '@/components/ErrorState';
import { LoadingState } from '@/components/LoadingState';
import { SearchInput } from '@/components/SearchInput';
import { StatusBadge } from '@/components/StatusBadge';
import { btn, cx } from '@/components/ui';
import { EM_DASH, useI18n } from '@/i18n/provider';
import { api } from '@/lib/api';
import { dqk, type EvidenceLink } from '@/lib/documents';
import { useProjectContext } from '@/lib/project-context';

const shortId = (id: string) => `#${id.slice(-6)}`;

/** Evidence links on a decision (same query as the decision's EvidencePanel, so linking / verifying refreshes both). */
export function useDecisionEvidence(decisionId: string, enabled = true) {
  const { projectId, can } = useProjectContext();
  return useQuery({
    queryKey: dqk.evidence(projectId, 'decision', decisionId),
    queryFn: ({ signal }) => api(documentsRoutes.listEvidence, { params: { projectId }, query: { targetType: 'decision', targetId: decisionId, includeInactive: 'true' }, signal }),
    enabled: enabled && can('documents.document.read'),
  });
}

/** Usable for recording an external decision (DOM-P2-12): active and verified by a second person. */
export function isVerifiedActive(l: EvidenceLink): boolean {
  return l.status === 'active' && !!l.reviewedBy;
}

function linkLabel(l: EvidenceLink, t: ReturnType<typeof useI18n>['t']): string {
  return l.documentId ? (l.documentTitle ?? EM_DASH) : t('documents.evidence.kindNote');
}

/**
 * Picker for `evidenceLinkId` of `record-external-approval`: only the decision's ACTIVE evidence links that a second
 * person VERIFIED are offered; links the current user verified are shown but cannot be chosen (the verifier may not also
 * record the decision it evidences — the API refuses with 403). When none qualifies, the dialog explains the path:
 * link the resolution / record as evidence on this decision, then have another person verify it.
 */
export function ExternalEvidencePicker({ decisionId, value, onChange, evidenceAnchor }: { decisionId: string; value: string; onChange: (id: string) => void; evidenceAnchor: string }) {
  const { t, formatDateTime, formatNumber } = useI18n();
  const { can, me } = useProjectContext();
  const name = useId();
  const readable = can('documents.document.read');
  const q = useDecisionEvidence(decisionId);
  const all = q.data?.items ?? [];
  const verified = all.filter(isVerifiedActive);
  const awaiting = all.filter((l) => l.status === 'active' && !l.reviewedBy).length;
  return (
    <fieldset className="space-y-2" data-testid="external-evidence-picker">
      <legend className="text-sm font-medium text-ink">
        {t('governance.external.evidence.legend')}
        <span className="text-danger" aria-hidden="true">
          {' '}
          *
        </span>
      </legend>
      <p className="text-xs text-muted">{t('governance.external.evidence.hint')}</p>
      {!readable ? (
        <p role="note" className="rounded-md border border-warning/40 bg-warning-soft p-3 text-sm text-ink" data-testid="external-evidence-restricted">
          {t('governance.external.evidence.noAccess')}
        </p>
      ) : q.isLoading ? (
        <LoadingState compact />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : verified.length === 0 ? (
        <div role="note" className="space-y-2 rounded-md border border-warning/40 bg-warning-soft p-3 text-sm text-ink" data-testid="external-evidence-none">
          <p className="flex items-start gap-2 font-semibold">
            <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning" />
            {t('governance.external.evidence.noneTitle')}
          </p>
          <ol className="list-decimal space-y-1 ps-5">
            <li>{t('governance.external.evidence.step1')}</li>
            <li>{t('governance.external.evidence.step2')}</li>
            <li>{t('governance.external.evidence.step3')}</li>
          </ol>
          {awaiting > 0 ? <p data-testid="external-evidence-awaiting">{t('governance.external.evidence.awaiting', { count: formatNumber(awaiting) })}</p> : null}
          <a href={`#${evidenceAnchor}`} className={cx(btn.link, 'text-sm')}>
            {t('governance.external.evidence.goToEvidence')}
          </a>
        </div>
      ) : (
        <ul className="space-y-2">
          {verified.map((l) => {
            const mine = l.reviewedBy === me.user.id;
            const id = `${name}-${l.id}`;
            return (
              <li key={l.id} className={cx('rounded-md border p-3', value === l.id ? 'border-primary bg-primary-soft' : 'border-line')} data-testid="external-evidence-option" data-link-id={l.id}>
                <label htmlFor={id} className={cx('flex items-start gap-2 text-sm', mine ? 'cursor-not-allowed' : 'cursor-pointer')}>
                  <input id={id} type="radio" name={name} className="mt-1" value={l.id} checked={value === l.id} disabled={mine} onChange={() => onChange(l.id)} aria-describedby={mine ? `${id}-mine` : undefined} />
                  <span className="min-w-0 space-y-0.5">
                    <span className="flex flex-wrap items-center gap-2">
                      {l.documentId ? <FileText aria-hidden="true" className="size-4 text-muted" /> : <StickyNote aria-hidden="true" className="size-4 text-muted" />}
                      <span dir="auto" className="font-medium">
                        {linkLabel(l, t)}
                      </span>
                      {l.versionNo !== null ? <span className="text-muted">· {t('documents.versions.label', { version: l.versionNo })}</span> : null}
                      <span className="text-xs text-muted" dir="ltr">
                        {shortId(l.id)}
                      </span>
                    </span>
                    {l.note ? (
                      <span className="block" dir="auto">
                        {l.note}
                      </span>
                    ) : null}
                    {l.purpose ? (
                      <span className="block text-muted" dir="auto">
                        {t('documents.evidence.purpose')}: {l.purpose}
                      </span>
                    ) : null}
                    <span className="flex items-center gap-1 text-xs text-success">
                      <CircleCheck aria-hidden="true" className="size-3.5" />
                      {t('governance.external.evidence.verifiedAt', { date: formatDateTime(l.reviewedAt) })}
                    </span>
                    {mine ? (
                      <span id={`${id}-mine`} className="block text-xs text-warning" data-testid="external-evidence-mine">
                        {t('governance.external.evidence.verifiedByYou')}
                      </span>
                    ) : null}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
      {readable && verified.length > 0 && awaiting > 0 ? <p className="text-xs text-muted">{t('governance.external.evidence.awaiting', { count: formatNumber(awaiting) })}</p> : null}
    </fieldset>
  );
}

/** The evidence link that backs a recorded external decision (title when the caller can read it). */
export function ExternalEvidenceFact({ decisionId, linkId, evidenceAnchor }: { decisionId: string; linkId: string; evidenceAnchor: string }) {
  const { t } = useI18n();
  const q = useDecisionEvidence(decisionId);
  const l = q.data?.items.find((x) => x.id === linkId) ?? null;
  return (
    <span className="inline-flex flex-wrap items-center gap-2" data-testid="external-evidence-fact">
      {l ? (
        <>
          <span dir="auto">{linkLabel(l, t)}</span>
          <StatusBadge enumName="evidenceLinkStatuses" value={l.status} />
        </>
      ) : null}
      <a href={`#${evidenceAnchor}`} className={btn.link}>
        <span dir="ltr">{shortId(linkId)}</span>
      </a>
    </span>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Approval document picker (authority matrix approval, DOM-P2-12)

/**
 * Search the project's documents the caller may read and pick the approval record (the API binds its CURRENT version and
 * re-checks visibility, disposal and that a version exists). Documents without an uploaded version cannot be chosen.
 */
export function ApprovalDocumentPicker({ value, onChange }: { value: { id: string; title: string } | null; onChange: (v: { id: string; title: string } | null) => void }) {
  const { t, formatDateTime } = useI18n();
  const { projectId, can } = useProjectContext();
  const [q, setQ] = useState('');
  const readable = can('documents.document.read');
  const docs = useQuery({
    queryKey: dqk.list(projectId, { approvalPicker: true, q }),
    queryFn: ({ signal }) => api(documentsRoutes.listDocuments, { params: { projectId }, query: { q: q || undefined, page: 1, pageSize: 20 }, signal }),
    enabled: readable,
  });
  if (!readable) {
    return (
      <p role="note" className="rounded-md border border-warning/40 bg-warning-soft p-3 text-sm text-ink" data-testid="approval-document-restricted">
        {t('governance.committee.matrix.approve.documentNoAccess')}
      </p>
    );
  }
  const items = docs.data?.items ?? [];
  return (
    <div className="space-y-2" data-testid="approval-document-picker">
      <SearchInput label={t('governance.committee.matrix.approve.documentSearch')} value={q} onChange={setQ} />
      {/* Toggle buttons (aria-pressed) rather than a listbox: each entry is a single action. */}
      <ul className="max-h-56 overflow-y-auto rounded-md border border-line" aria-label={t('governance.committee.matrix.approve.document')}>
        {docs.isLoading ? <li className="px-3 py-2 text-sm text-muted">{t('states.loading')}</li> : null}
        {docs.error ? (
          <li className="p-2">
            <ErrorState error={docs.error} onRetry={() => docs.refetch()} />
          </li>
        ) : null}
        {!docs.isLoading && !docs.error && items.length === 0 ? <li className="px-3 py-2 text-sm text-muted">{t('governance.committee.matrix.approve.documentNone')}</li> : null}
        {items.map((d) => {
          const usable = !!d.currentVersion;
          const on = value?.id === d.id;
          return (
            <li key={d.id}>
              <button
                type="button"
                aria-pressed={on}
                disabled={!usable}
                data-testid="approval-document-option"
                className={cx('flex w-full items-start gap-2 px-3 py-2 text-start text-sm hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-60', on && 'bg-primary-soft font-semibold text-primary')}
                onClick={() => onChange(on ? null : { id: d.id, title: d.title })}
              >
                <FileText aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted" />
                <span className="min-w-0">
                  <span dir="auto" className="block truncate">
                    {d.title}
                  </span>
                  <span className="block text-xs font-normal text-muted">
                    {d.currentVersion
                      ? `${t('documents.versions.label', { version: d.currentVersion.versionNo })} · ${formatDateTime(d.currentVersion.uploadedAt)}`
                      : t('governance.committee.matrix.approve.documentNoVersion')}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {value ? (
        <p className="text-sm text-ink" data-testid="approval-document-selected">
          {t('governance.committee.matrix.approve.documentSelected')}{' '}
          <span dir="auto" className="font-medium">
            {value.title}
          </span>
        </p>
      ) : null}
    </div>
  );
}
