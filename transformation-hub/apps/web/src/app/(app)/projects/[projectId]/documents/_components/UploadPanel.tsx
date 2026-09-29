'use client';

import { useQueryClient } from '@tanstack/react-query';
import { Upload, X } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { ApiErrorNotice } from '@/components/ApiErrorNotice';
import { btn, card, cx, hint as hintCls, input, label as labelCls } from '@/components/ui';
import { useToast } from '@/components/Toast';
import { useI18n } from '@/i18n/provider';
import { isApiError } from '@/lib/api';
import { acceptAttribute, dqk, formatBytes, preCheckFile, uploadVersion, type UploadPolicy } from '@/lib/documents';
import { useProjectContext } from '@/lib/project-context';
import { ScanNotice } from './bits';

/**
 * Upload a new version with a progress bar. The client pre-checks size and extension against the server's
 * policy for fast feedback; the server re-checks content (magic bytes), signatures and size and may quarantine.
 */
export function UploadPanel({ documentId, policy, disabledReason }: { documentId: string; policy: UploadPolicy | undefined; disabledReason?: string | null }) {
  const { t, tStatus, locale } = useI18n();
  const { projectId } = useProjectContext();
  const queryClient = useQueryClient();
  const toast = useToast();
  const fileId = useId();
  const noteId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState('');
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  const types = policy ? policy.acceptedTypes.flatMap((x) => x.extensions.map((e) => `.${e}`)).join(', ') : '';

  const choose = (f: File | null) => {
    setError(null);
    setFile(f);
    if (!f) {
      setLocalError(null);
      return;
    }
    const c = preCheckFile(f, policy);
    setLocalError(
      c.ok
        ? null
        : c.reason === 'too_large'
          ? t('documents.upload.tooLarge', { size: formatBytes(f.size, locale), limit: formatBytes(c.limit ?? 0, locale) })
          : c.reason === 'empty'
            ? t('documents.upload.empty')
            : t('documents.upload.badType'),
    );
  };

  const start = async () => {
    if (!file || localError) return;
    setError(null);
    setProgress(0);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const res = await uploadVersion(projectId, documentId, file, { note: note.trim() || undefined, onProgress: setProgress, signal: ctrl.signal });
      await queryClient.invalidateQueries({ queryKey: dqk.all(projectId) });
      if (res.scanStatus === 'quarantined') toast.show('error', t('documents.upload.quarantined', { detail: res.scanDetail ?? '' }));
      else toast.show('success', t('documents.upload.done', { version: res.versionNo, scan: tStatus('scanStatuses', res.scanStatus) }));
      setFile(null);
      setNote('');
      if (inputRef.current) inputRef.current.value = '';
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError') setError(e);
    } finally {
      setProgress(null);
      abortRef.current = null;
    }
  };

  const busy = progress !== null;
  return (
    <section aria-labelledby={`${fileId}-h`} className={cx(card, 'p-4')} data-testid="upload-panel">
      <h2 id={`${fileId}-h`} className="mb-2 text-lg font-semibold">
        {t('documents.upload.title')}
      </h2>
      {disabledReason ? (
        <p className="text-sm text-muted">{disabledReason}</p>
      ) : (
        <div className="space-y-3">
          <ScanNotice policy={policy} />
          <div>
            <label htmlFor={fileId} className={labelCls}>
              {t('documents.upload.choose')}
            </label>
            <input
              ref={inputRef}
              id={fileId}
              type="file"
              accept={acceptAttribute(policy)}
              className={cx(input, 'mt-1 file:me-3 file:rounded file:border-0 file:bg-primary-soft file:px-2 file:py-1 file:text-primary')}
              onChange={(e) => choose(e.target.files?.[0] ?? null)}
              disabled={busy}
              aria-invalid={Boolean(localError)}
              aria-describedby={`${fileId}-hint`}
              data-testid="upload-input"
            />
            <p id={`${fileId}-hint`} className={hintCls}>
              {policy ? t('documents.upload.accepted', { types, size: formatBytes(policy.maxUploadBytes, locale) }) : null} {t('documents.upload.serverChecks')}
            </p>
            {localError ? (
              <p className="mt-1 text-xs font-medium text-danger" role="alert" data-testid="upload-precheck-error">
                {localError}
              </p>
            ) : null}
          </div>
          <div>
            <label htmlFor={noteId} className={labelCls}>
              {t('documents.upload.note')} <span className="font-normal text-muted">({t('common.optional')})</span>
            </label>
            <input id={noteId} dir="auto" className={cx(input, 'mt-1')} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} disabled={busy} />
          </div>
          {busy ? (
            <div>
              <div className="h-2 w-full overflow-hidden rounded bg-surface-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((progress ?? 0) * 100)} aria-label={t('documents.upload.title')}>
                <div className="h-full bg-primary transition-all" style={{ width: `${Math.round((progress ?? 0) * 100)}%` }} />
              </div>
              <p className="mt-1 text-xs text-muted" aria-live="polite">
                {t('documents.upload.progress', { percent: Math.round((progress ?? 0) * 100) })}
              </p>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btn.primary} onClick={start} disabled={!file || Boolean(localError) || busy} data-testid="upload-start">
              <Upload aria-hidden="true" className="size-4" />
              {busy ? t('common.actions.working') : t('documents.upload.start')}
            </button>
            {busy ? (
              <button type="button" className={btn.secondary} onClick={() => abortRef.current?.abort()}>
                <X aria-hidden="true" className="size-4" />
                {t('documents.upload.cancel')}
              </button>
            ) : null}
          </div>
          {isApiError(error) && error.status === 413 ? (
            <p role="alert" className="rounded-md border border-danger/40 bg-danger-soft p-3 text-sm text-danger" data-testid="upload-too-large">
              {t('documents.upload.tooLargeServer', { limit: policy ? formatBytes(policy.maxUploadBytes, locale) : '—' })}
            </p>
          ) : (
            <ApiErrorNotice error={error} />
          )}
        </div>
      )}
    </section>
  );
}
