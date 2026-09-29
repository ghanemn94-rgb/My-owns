'use client';

import { useQuery } from '@tanstack/react-query';
import { History } from 'lucide-react';
import { useState } from 'react';
import { portfolioRoutes } from '@hub/contracts';
import { api } from '@/lib/api';
import { qk } from '@/lib/queries';
import { useI18n } from '@/i18n/provider';
import { EmptyState } from './EmptyState';
import { ErrorState } from './ErrorState';
import { LoadingState } from './LoadingState';
import { Pagination } from './Pagination';
import { StatusBadge } from './StatusBadge';
import { card, cx } from './ui';

const PAGE_SIZE = 10;

/**
 * Collapsible activity history for a record (entityType + entityId) or the whole project. Loads only when
 * opened. The API filters entries the caller may not see.
 */
export function ActivityHistory({
  projectId,
  entityType,
  entityId,
  defaultOpen = false,
  className,
}: {
  projectId: string;
  entityType?: string;
  entityId?: string;
  defaultOpen?: boolean;
  className?: string;
}) {
  const { t, formatDateTime, hasStatus, tStatus } = useI18n();
  const [open, setOpen] = useState(defaultOpen);
  const [page, setPage] = useState(1);
  const query = { page, pageSize: PAGE_SIZE, entityType, entityId };
  const q = useQuery({
    queryKey: qk.activity(projectId, query),
    queryFn: ({ signal }) => api(portfolioRoutes.auditTrail, { params: { projectId }, query, signal }),
    enabled: open,
    placeholderData: (prev) => prev,
  });

  return (
    <details
      className={cx(card, 'group', className)}
      open={open}
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
      data-testid="activity-history"
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 font-semibold text-ink">
        <History aria-hidden="true" className="size-4 text-muted" />
        {t('common.activity.title')}
        <span className="ms-auto text-xs font-normal text-muted group-open:hidden">{t('common.activity.show')}</span>
        <span className="ms-auto hidden text-xs font-normal text-muted group-open:inline">{t('common.activity.hide')}</span>
      </summary>
      <div className="border-t border-line">
        {q.isLoading ? (
          <LoadingState compact />
        ) : q.error ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : !q.data || q.data.items.length === 0 ? (
          <EmptyState title={t('common.activity.empty')} />
        ) : (
          <>
            <ol className="divide-y divide-line">
              {q.data.items.map((e) => (
                <li key={e.id} className="flex flex-col gap-1 px-4 py-3 text-sm sm:flex-row sm:items-start sm:gap-4">
                  <time dateTime={e.at} className="tabular shrink-0 text-muted sm:w-44">
                    {formatDateTime(e.at)}
                  </time>
                  <div className="min-w-0 flex-1">
                    <p className="text-ink">
                      <span className="font-medium" dir="auto">
                        {e.actor ?? tStatus('actorKinds', e.actorKind)}
                      </span>{' '}
                      — {hasStatus('auditActions', e.action) ? tStatus('auditActions', e.action) : <code dir="ltr">{e.action}</code>}
                    </p>
                    {e.reason ? (
                      <p className="mt-0.5 text-muted">
                        {t('common.activity.reason')}: <span dir="auto">{e.reason}</span>
                      </p>
                    ) : null}
                  </div>
                  <StatusBadge enumName="auditOutcomes" value={e.outcome} />
                </li>
              ))}
            </ol>
            <div className="border-t border-line px-4 py-2">
              <Pagination page={page} pageSize={PAGE_SIZE} total={q.data.total} onPageChange={setPage} />
            </div>
          </>
        )}
      </div>
    </details>
  );
}
