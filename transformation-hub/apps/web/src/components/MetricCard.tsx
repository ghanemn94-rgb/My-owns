'use client';

import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { useI18n } from '@/i18n/provider';
import { card, cx } from './ui';

/**
 * A number that always links to the records that make it up (spec §10: clicking a metric opens its
 * contributing records — REQ-UX-024: `href` is the list filtered so its total equals the number). `null` means
 * "not visible to you" and renders an em dash — never 0. `data-value` carries the number for tests and tools.
 */
export function MetricCard({
  label,
  value,
  href,
  hint,
  className,
  metric,
}: {
  label: string;
  value: number | null | undefined;
  href: string;
  hint?: string;
  className?: string;
  /** Stable key of the metric (`data-metric`), e.g. `openRisks`. */
  metric?: string;
}) {
  const { t, formatNumber } = useI18n();
  const hidden = value === null || value === undefined;
  return (
    <Link
      href={href}
      className={cx(card, 'group flex flex-col gap-1 p-4 transition-colors hover:border-primary hover:bg-primary-soft', className)}
      data-testid="metric-card"
      data-metric={metric}
      data-value={hidden ? undefined : value}
      aria-label={`${label}: ${hidden ? t('common.notAvailable') : formatNumber(value)} — ${t('common.actions.viewRecords')}`}
    >
      <span className="text-sm text-muted">{label}</span>
      <span className="tabular text-2xl font-semibold text-ink">{formatNumber(value)}</span>
      {hint ? <span className="text-xs text-muted">{hint}</span> : null}
      <span className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-primary">
        {t('common.actions.viewRecords')}
        <ChevronRight aria-hidden="true" className="size-3.5 rtl:rotate-180" />
      </span>
    </Link>
  );
}
