'use client';

import { useEffect, useId, useState, type ReactNode } from 'react';
import { useI18n } from '@/i18n/provider';
import { ApiErrorNotice } from './ApiErrorNotice';
import { Dialog } from './Dialog';
import { btn, hint, input, label as labelCls } from './ui';

/**
 * Confirmation for a domain command (a state-changing POST). It states what will happen, collects an
 * optional/required note, shows the record version the command is based on (`expectedVersion`), and keeps
 * the dialog open with the server's answer if the command is refused (409/422/403/404).
 */
export function ConfirmCommandDialog({
  open,
  onClose,
  title,
  consequences,
  confirmLabel,
  onConfirm,
  noteMode = 'optional',
  noteLabel,
  expectedVersion,
  danger = false,
  onReload,
  confirmDisabled = false,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Plain-language list of effects shown before confirming. */
  consequences: ReactNode[];
  confirmLabel: string;
  onConfirm: (input: { note: string }) => Promise<unknown>;
  noteMode?: 'none' | 'optional' | 'required';
  noteLabel?: string;
  expectedVersion?: number;
  danger?: boolean;
  onReload?: () => void;
  /** Keep the confirm button disabled until the dialog's own inputs are complete. */
  confirmDisabled?: boolean;
  children?: ReactNode;
}) {
  const { t, formatNumber } = useI18n();
  const noteId = useId();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (open) {
      setNote('');
      setError(null);
      setTouched(false);
    }
  }, [open]);

  const noteMissing = noteMode === 'required' && note.trim().length === 0;

  const submit = async () => {
    setTouched(true);
    if (noteMissing) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm({ note: note.trim() });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      busy={busy}
      footer={
        <>
          <button type="button" className={btn.secondary} onClick={onClose} disabled={busy}>
            {t('common.actions.cancel')}
          </button>
          <button type="button" className={danger ? btn.danger : btn.primary} onClick={submit} disabled={busy || confirmDisabled} aria-busy={busy}>
            {busy ? t('common.actions.working') : confirmLabel}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-ink">{t('common.command.whatWillHappen')}</h3>
          <ul className="mt-2 list-disc space-y-1 ps-5 text-sm text-ink">
            {consequences.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </div>
        {children}
        {noteMode !== 'none' ? (
          <div>
            <label htmlFor={noteId} className={labelCls}>
              {noteLabel ?? t('common.command.note')}
              {noteMode === 'required' ? <span className="text-danger"> *</span> : <span className="text-muted"> ({t('common.optional')})</span>}
            </label>
            <textarea
              id={noteId}
              dir="auto"
              rows={3}
              className={input}
              value={note}
              maxLength={noteMode === 'required' ? 500 : 4000}
              onChange={(e) => setNote(e.target.value)}
              aria-invalid={touched && noteMissing}
              aria-required={noteMode === 'required'}
            />
            {touched && noteMissing ? <p className="mt-1 text-xs text-danger">{t('common.validation.required')}</p> : null}
          </div>
        ) : null}
        {expectedVersion !== undefined ? (
          <p className={hint}>{t('common.command.basedOnVersion', { version: formatNumber(expectedVersion) })}</p>
        ) : null}
        <ApiErrorNotice error={error} onReload={onReload} />
      </div>
    </Dialog>
  );
}
