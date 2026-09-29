'use client';

import { CircleAlert, CircleCheck, Info, X } from 'lucide-react';
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { useT } from '@/i18n/provider';
import { cx } from './ui';

type ToastKind = 'success' | 'error' | 'info';
interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
  correlationId?: string;
}

interface ToastApi {
  show: (kind: ToastKind, message: string, correlationId?: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

/** Announces results politely (success/info) or assertively (errors) via aria-live regions. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const t = useT();
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);

  const dismiss = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);
  const show = useCallback(
    (kind: ToastKind, message: string, correlationId?: string) => {
      const id = ++seq.current;
      setItems((xs) => [...xs.slice(-3), { id, kind, message, correlationId }]);
      setTimeout(() => dismiss(id), kind === 'error' ? 10_000 : 6_000);
    },
    [dismiss],
  );
  const api = useMemo(() => ({ show }), [show]);

  const render = (kinds: ToastKind[]) =>
    items
      .filter((i) => kinds.includes(i.kind))
      .map((i) => {
        const Icon = i.kind === 'success' ? CircleCheck : i.kind === 'error' ? CircleAlert : Info;
        return (
          <div
            key={i.id}
            className={cx(
              'pointer-events-auto flex items-start gap-3 rounded-lg border bg-surface p-3 text-sm shadow-lg',
              i.kind === 'success' && 'border-success/40',
              i.kind === 'error' && 'border-danger/40',
              i.kind === 'info' && 'border-info/40',
            )}
          >
            <Icon
              aria-hidden="true"
              className={cx('mt-0.5 size-5 shrink-0', i.kind === 'success' ? 'text-success' : i.kind === 'error' ? 'text-danger' : 'text-info')}
            />
            <div className="min-w-0 flex-1">
              <p className="text-ink">{i.message}</p>
              {i.correlationId ? (
                <p className="mt-1 text-xs text-muted">
                  {t('states.error.correlation')} <code dir="ltr">{i.correlationId}</code>
                </p>
              ) : null}
            </div>
            <button type="button" onClick={() => dismiss(i.id)} className="rounded p-0.5 text-muted hover:text-ink" aria-label={t('common.actions.dismiss')}>
              <X aria-hidden="true" className="size-4" />
            </button>
          </div>
        );
      });

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed bottom-4 end-4 z-50 flex w-[min(24rem,calc(100%-2rem))] flex-col gap-2">
        <div role="status" aria-live="polite" className="flex flex-col gap-2">
          {render(['success', 'info'])}
        </div>
        <div role="alert" aria-live="assertive" className="flex flex-col gap-2">
          {render(['error'])}
        </div>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}
