'use client';

import { Check } from 'lucide-react';
import type { ImportStatus } from '@hub/domain';
import { card, cx } from '@/components/ui';
import { useI18n, type MessageKey } from '@/i18n/provider';
import { importStep, type ImportPolicy } from '@/lib/imports';

/** Tone of a batch status (applied = success; failed / quarantined / rejected = danger; in-flight = info). */
export function importTone(s: ImportStatus): 'success' | 'warning' | 'danger' | 'info' | 'neutral' {
  if (s === 'applied') return 'success';
  if (s === 'failed' || s === 'quarantined' || s === 'rejected') return 'danger';
  if (s === 'rolled_back' || s === 'cancelled') return 'neutral';
  if (s === 'submitted') return 'warning';
  return 'info';
}

/** What the pipeline does and does not do — stated honestly (no OCR, no PDF text, no OS-level network isolation here). */
export function HonestyPanel({ policy }: { policy: ImportPolicy | undefined }) {
  const { t } = useI18n();
  return (
    <aside className={cx(card, 'space-y-2 p-4 text-sm')} aria-labelledby="import-honesty" data-testid="import-honesty">
      <h2 id="import-honesty" className="text-base font-semibold">
        {t('imports.honesty.title')}
      </h2>
      <ul className="list-disc space-y-1.5 ps-5 text-ink">
        <li>{t('imports.honesty.parser')}</li>
        <li>{t('imports.honesty.values')}</li>
        <li>
          {policy?.scanner.enterprise ? t('imports.honesty.scannerEnterprise', { engine: policy.scanner.engine }) : t('imports.honesty.scannerBuiltin')}
        </li>
        <li data-testid="honesty-ocr">{t('imports.honesty.ocr')}</li>
        <li>{t('imports.honesty.osIsolation')}</li>
        <li>{t('imports.honesty.approval')}</li>
      </ul>
    </aside>
  );
}

const STEPS = ['upload', 'check', 'map', 'review', 'approve', 'done'] as const;

/** Wizard stepper (current step announced with aria-current). */
export function ImportStepper({ status, document }: { status: ImportStatus; document: boolean }) {
  const { t } = useI18n();
  const current = importStep(status);
  const steps = document ? STEPS.filter((s) => s !== 'map') : STEPS;
  const index = (s: (typeof STEPS)[number]) => STEPS.indexOf(s);
  return (
    <ol className="mb-6 flex flex-wrap gap-2" aria-label={t('imports.steps.label')} data-testid="import-steps">
      {steps.map((s, i) => {
        const done = index(s) < current || (status === 'applied' && s === 'done') || (status === 'rolled_back' && s === 'done');
        const isCurrent = index(s) === current && !done;
        return (
          <li
            key={s}
            aria-current={isCurrent ? 'step' : undefined}
            className={cx('flex items-center gap-2 rounded-full border px-3 py-1 text-sm', isCurrent ? 'border-primary bg-primary-soft text-primary' : done ? 'border-success/40 text-success' : 'border-line text-muted')}
          >
            <span className="tabular flex size-5 items-center justify-center rounded-full border border-current text-xs">{done ? <Check aria-hidden="true" className="size-3" /> : i + 1}</span>
            {t(`imports.steps.${s}` as MessageKey)}
          </li>
        );
      })}
    </ol>
  );
}
