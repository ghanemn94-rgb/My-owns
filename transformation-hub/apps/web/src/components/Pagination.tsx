'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useI18n } from '@/i18n/provider';
import { btn, cx } from './ui';

export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  className,
  label,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  className?: string;
  /** What is paginated (e.g. the table caption): keeps navigation landmarks unique when a page has several lists. */
  label?: string;
}) {
  const { t, formatNumber } = useI18n();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <nav aria-label={label ? t('common.pagination.labelFor', { name: label }) : t('common.pagination.label')} className={cx('flex flex-wrap items-center justify-between gap-3 text-sm', className)}>
      <p className="text-muted" aria-live="polite">
        {t('common.pagination.range', { from: formatNumber(from), to: formatNumber(to), total: formatNumber(total) })}
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className={btn.secondary}
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          aria-label={t('common.pagination.previous')}
        >
          <ChevronLeft aria-hidden="true" className="size-4 rtl:rotate-180" />
          <span className="hidden sm:inline">{t('common.pagination.previous')}</span>
        </button>
        <span className="tabular text-muted">{t('common.pagination.pageOf', { page: formatNumber(page), pages: formatNumber(pages) })}</span>
        <button
          type="button"
          className={btn.secondary}
          onClick={() => onPageChange(page + 1)}
          disabled={page >= pages}
          aria-label={t('common.pagination.next')}
        >
          <span className="hidden sm:inline">{t('common.pagination.next')}</span>
          <ChevronRight aria-hidden="true" className="size-4 rtl:rotate-180" />
        </button>
      </div>
    </nav>
  );
}
