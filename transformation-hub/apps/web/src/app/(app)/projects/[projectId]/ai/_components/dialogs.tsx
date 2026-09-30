'use client';

import { useEffect, useId, useState, type ReactNode } from 'react';
import { Dialog } from '@/components/Dialog';
import { btn, hint, input, label as labelCls } from '@/components/ui';
import { useI18n } from '@/i18n/provider';
import { AiErrorNotice, type ErrorContext } from './bits';

/**
 * Confirmation for an AI command (approve / reject / revise / emergency stop / policy). States what will happen, collects
 * the reason, shows the version the command is bound to, and keeps the dialog open with the server's refusal translated
 * into the active language (409 → "reload and review").
 */
export function AiCommandDialog({
  open,
  onClose,
  title,
  description,
  consequences,
  confirmLabel,
  onConfirm,
  reasonMode = 'optional',
  reasonLabel,
  danger = false,
  errorContext = 'generic',
  onReload,
  confirmDisabled = false,
  basedOn,
  children,
  testId,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  consequences: ReactNode[];
  confirmLabel: string;
  onConfirm: (input: { reason: string }) => Promise<unknown>;
  reasonMode?: 'none' | 'optional' | 'required';
  reasonLabel?: string;
  danger?: boolean;
  errorContext?: ErrorContext;
  onReload?: () => void;
  confirmDisabled?: boolean;
  /** "Bound to version …" line (the command carries exactly this version; a different current version is refused). */
  basedOn?: ReactNode;
  children?: ReactNode;
  testId?: string;
}) {
  const { t } = useI18n();
  const reasonId = useId();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (open) {
      setReason('');
      setError(null);
      setTouched(false);
    }
  }, [open]);

  const missing = reasonMode === 'required' && reason.trim().length === 0;

  const submit = async () => {
    setTouched(true);
    if (missing) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm({ reason: reason.trim() });
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
      description={description}
      busy={busy}
      size="lg"
      footer={
        <>
          <button type="button" className={btn.secondary} onClick={onClose} disabled={busy}>
            {t('common.actions.cancel')}
          </button>
          <button type="button" className={danger ? btn.danger : btn.primary} onClick={submit} disabled={busy || confirmDisabled} aria-busy={busy} data-testid="dialog-confirm">
            {busy ? t('common.actions.working') : confirmLabel}
          </button>
        </>
      }
    >
      <div className="space-y-4" data-testid={testId}>
        <div>
          <h3 className="text-sm font-semibold text-ink">{t('common.command.whatWillHappen')}</h3>
          <ul className="mt-2 list-disc space-y-1 ps-5 text-sm text-ink">
            {consequences.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </div>
        {children}
        {reasonMode !== 'none' ? (
          <div>
            <label htmlFor={reasonId} className={labelCls}>
              {reasonLabel ?? t('ai.common.reason')}
              {reasonMode === 'required' ? (
                <span className="text-danger" aria-hidden="true">
                  {' '}
                  *
                </span>
              ) : (
                <span className="font-normal text-muted"> ({t('common.optional')})</span>
              )}
            </label>
            <textarea
              id={reasonId}
              dir="auto"
              rows={3}
              className={input}
              value={reason}
              maxLength={1000}
              onChange={(e) => setReason(e.target.value)}
              aria-invalid={touched && missing}
              aria-required={reasonMode === 'required'}
              data-testid="dialog-reason"
            />
            {touched && missing ? <p className="mt-1 text-xs font-medium text-danger">{t('common.validation.required')}</p> : null}
          </div>
        ) : null}
        {basedOn ? (
          <p className={hint} data-testid="dialog-based-on">
            {basedOn}
          </p>
        ) : null}
        <AiErrorNotice error={error} context={errorContext} onReload={onReload} testId="dialog-error" />
      </div>
    </Dialog>
  );
}
