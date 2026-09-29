'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { EM_DASH, useI18n } from '@/i18n/provider';
import { ragTone } from '@/lib/planning';
import { StatusBadge } from '../StatusBadge';
import { card, cx, input } from '../ui';

/** RAG as text + icon + colour (never colour alone); unknown/stale/not updated are never shown green. */
export function RagBadge({ value, size = 'sm', label }: { value: string | null | undefined; size?: 'sm' | 'md'; label?: string }) {
  return <StatusBadge enumName="ragStatuses" value={value} tone={ragTone(value)} size={size} label={label} />;
}

/** Weighted progress bar with the number and its basis in text. `null` = cannot be calculated (no denominator). */
export function ProgressBar({ percent, label, className }: { percent: number | null | undefined; label: string; className?: string }) {
  const { formatNumber } = useI18n();
  const v = percent === null || percent === undefined ? null : Math.max(0, Math.min(100, percent));
  return (
    <div className={cx('flex items-center gap-2', className)}>
      <div
        className="h-2 w-full min-w-16 overflow-hidden rounded-full bg-surface-muted"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={v ?? undefined}
        aria-valuetext={v === null ? EM_DASH : `${formatNumber(v)}%`}
      >
        {v !== null ? <div className="h-full rounded-full bg-primary" style={{ inlineSize: `${v}%` }} /> : null}
      </div>
      <span className="tabular w-12 shrink-0 text-end text-sm">{v === null ? EM_DASH : `${formatNumber(v)}%`}</span>
    </div>
  );
}

/** Compact labelled select for filter bars. */
export function FilterSelect({
  label,
  value,
  onChange,
  children,
  className,
  testId,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  children: ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <label className={cx('flex min-w-0 flex-col gap-1 text-xs font-medium text-muted', className)}>
      {label}
      <select className={cx(input, 'pe-8 text-ink')} value={value} onChange={(e) => onChange(e.target.value)} data-testid={testId}>
        {children}
      </select>
    </label>
  );
}

export function FilterToggle({ label, checked, onChange, testId }: { label: string; checked: boolean; onChange: (v: boolean) => void; testId?: string }) {
  return (
    <label className="inline-flex min-h-10 items-center gap-2 text-sm text-ink">
      <input type="checkbox" className="size-4 accent-[var(--hub-primary)]" checked={checked} onChange={(e) => onChange(e.target.checked)} data-testid={testId} />
      {label}
    </label>
  );
}

/** Definition-list item. */
export function Fact({ label, children, wide = false }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? 'sm:col-span-2' : undefined}>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 text-sm break-words text-ink">{children ?? EM_DASH}</dd>
    </div>
  );
}

export function Section({ id, title, hint, actions, children, className }: { id: string; title: string; hint?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section aria-labelledby={id} className={cx(card, 'p-4', className)}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 id={id} className="text-lg font-semibold">
            {title}
          </h2>
          {hint ? <p className="mt-0.5 text-sm text-muted">{hint}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

/** Business date (YYYY-MM-DD) — never shifted by time zone. */
export function DateText({ value, overdue = false }: { value: string | null | undefined; overdue?: boolean }) {
  const { formatDate, t } = useI18n();
  if (!value) return <span className="text-muted">{EM_DASH}</span>;
  return (
    <span className={cx('tabular whitespace-nowrap', overdue && 'font-semibold text-danger')}>
      {formatDate(value)}
      {overdue ? <span className="sr-only"> ({t('planning.common.overdue')})</span> : null}
    </span>
  );
}

export function CodeLink({ href, code, title, testId }: { href: string; code: string; title?: string; testId?: string }) {
  return (
    <Link href={href} className="group inline-flex min-w-0 flex-col" data-testid={testId}>
      <span className="font-medium text-primary group-hover:underline" dir="ltr">
        {code}
      </span>
      {title ? (
        <span className="text-sm text-ink group-hover:text-primary" dir="auto">
          {title}
        </span>
      ) : null}
    </Link>
  );
}

/** Label marking plan-derived predictions as schedule-based forecasts (measurement rule 8). */
export function ForecastLabel({ className }: { className?: string }) {
  const { t } = useI18n();
  return (
    <span className={cx('inline-flex items-center gap-1 rounded-md border border-info/30 bg-info-soft px-2 py-0.5 text-xs font-semibold text-info', className)} data-testid="forecast-label">
      {t('planning.common.scheduleLabel')}
    </span>
  );
}
