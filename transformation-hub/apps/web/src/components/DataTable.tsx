'use client';

import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { useI18n } from '@/i18n/provider';
import { EmptyState } from './EmptyState';
import { ErrorState } from './ErrorState';
import { LoadingState } from './LoadingState';
import { Pagination } from './Pagination';
import { card, cx } from './ui';

export interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  /** Provide to make the column sortable (client-side, within the rows given). */
  sortValue?: (row: T) => string | number | null | undefined;
  className?: string;
  /** Row header cell for screen readers (usually the name/code column). */
  isRowHeader?: boolean;
}

type SortState = { key: string; dir: 'asc' | 'desc' } | null;

/**
 * Accessible data table: real <table> semantics, sortable headers exposed via aria-sort, loading / empty /
 * error states, and either server pagination (`pagination`) or client pagination (`clientPageSize`).
 */
export function DataTable<T>({
  caption,
  columns,
  rows,
  rowKey,
  isLoading,
  error,
  onRetry,
  emptyTitle,
  emptyHint,
  pagination,
  clientPageSize,
  initialSort = null,
  className,
  testId,
}: {
  caption: string;
  columns: Column<T>[];
  rows: T[] | undefined;
  rowKey: (row: T) => string;
  isLoading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  emptyTitle: string;
  emptyHint?: string;
  pagination?: { page: number; pageSize: number; total: number; onPageChange: (p: number) => void };
  clientPageSize?: number;
  initialSort?: SortState;
  className?: string;
  testId?: string;
}) {
  const { t, locale } = useI18n();
  const [sort, setSort] = useState<SortState>(initialSort);
  const [clientPage, setClientPage] = useState(1);

  const sorted = useMemo(() => {
    const list = rows ?? [];
    if (!sort) return list;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sortValue) return list;
    const collator = new Intl.Collator(locale, { numeric: true, sensitivity: 'base' });
    const factor = sort.dir === 'asc' ? 1 : -1;
    return [...list].sort((a, b) => {
      const va = col.sortValue!(a);
      const vb = col.sortValue!(b);
      if (va === vb) return 0;
      if (va === null || va === undefined) return 1; // nulls last in both directions
      if (vb === null || vb === undefined) return -1;
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * factor;
      return collator.compare(String(va), String(vb)) * factor;
    });
  }, [rows, sort, columns, locale]);

  const visible = useMemo(() => {
    if (!clientPageSize) return sorted;
    const maxPage = Math.max(1, Math.ceil(sorted.length / clientPageSize));
    const p = Math.min(clientPage, maxPage);
    return sorted.slice((p - 1) * clientPageSize, p * clientPageSize);
  }, [sorted, clientPage, clientPageSize]);

  const toggleSort = (key: string) => {
    setSort((s) => (s?.key !== key ? { key, dir: 'asc' } : s.dir === 'asc' ? { key, dir: 'desc' } : null));
    setClientPage(1);
  };

  let body: ReactNode;
  if (isLoading && !rows) body = <LoadingState compact />;
  else if (error) body = <ErrorState error={error} onRetry={onRetry} />;
  else if (sorted.length === 0) body = <EmptyState title={emptyTitle} hint={emptyHint} />;

  return (
    <div className={cx(card, 'overflow-hidden', className)} data-testid={testId}>
      {body ?? (
        <div className="relative overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">{caption}</caption>
            <thead className="bg-surface-muted">
              <tr>
                {columns.map((c) => {
                  const active = sort?.key === c.key;
                  const ariaSort = active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : c.sortValue ? 'none' : undefined;
                  return (
                    <th
                      key={c.key}
                      scope="col"
                      aria-sort={ariaSort}
                      className={cx('whitespace-nowrap border-b border-line px-3 py-2 text-start font-semibold text-ink', c.className)}
                    >
                      {c.sortValue ? (
                        <button
                          type="button"
                          onClick={() => toggleSort(c.key)}
                          className="inline-flex items-center gap-1 rounded hover:text-primary"
                        >
                          {c.header}
                          {active ? (
                            sort!.dir === 'asc' ? (
                              <ArrowUp aria-hidden="true" className="size-3.5" />
                            ) : (
                              <ArrowDown aria-hidden="true" className="size-3.5" />
                            )
                          ) : (
                            <ArrowUpDown aria-hidden="true" className="size-3.5 text-muted" />
                          )}
                          <span className="sr-only">{t('common.table.sortHint')}</span>
                        </button>
                      ) : (
                        c.header
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <tr key={rowKey(row)} className="border-b border-line last:border-b-0 hover:bg-surface-muted/60">
                  {columns.map((c) =>
                    c.isRowHeader ? (
                      <th key={c.key} scope="row" className={cx('px-3 py-2 text-start align-top font-medium', c.className)}>
                        {c.cell(row)}
                      </th>
                    ) : (
                      <td key={c.key} className={cx('px-3 py-2 align-top', c.className)}>
                        {c.cell(row)}
                      </td>
                    ),
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!body && pagination ? (
        <div className="border-t border-line px-3 py-2">
          <Pagination {...pagination} />
        </div>
      ) : null}
      {!body && !pagination && clientPageSize && sorted.length > clientPageSize ? (
        <div className="border-t border-line px-3 py-2">
          <Pagination page={clientPage} pageSize={clientPageSize} total={sorted.length} onPageChange={setClientPage} />
        </div>
      ) : null}
    </div>
  );
}
