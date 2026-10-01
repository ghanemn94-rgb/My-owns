'use client';

import Link from 'next/link';
import { useState } from 'react';
import { notificationsRoutes } from '@hub/contracts';
import { ApiErrorNotice } from '@/components/ApiErrorNotice';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { LoadingState } from '@/components/LoadingState';
import { Main } from '@/components/Main';
import { PageHeader } from '@/components/PageHeader';
import { Pagination } from '@/components/Pagination';
import { StatusBadge } from '@/components/StatusBadge';
import { btn, card, cx } from '@/components/ui';
import { useI18n, type MessageKey } from '@/i18n/provider';
import { api } from '@/lib/api';
import { useChannels, useNotificationText, useNotifications, useNotificationsRefresh, type NotificationItem } from '@/lib/notifications';

const PAGE_SIZE = 25;

/** Kinds with a label; anything else (a future producer) is shown as a generic notification rather than a raw code. */
const KINDS = new Set(['agenda_request_screened', 'change_request_decided', 'decision_outcome', 'import_awaiting_approval', 'import_decided', 'integration_alert', 'ai_action', 'ai_briefing', 'gate_reassessment_requested']);
const kindKey = (kind: string) => {
  const k = kind.replace(/\./g, '_');
  return KINDS.has(k) ? k : 'other';
};

/**
 * Notifications inbox (REQ-PLT-008, REQ-INT-012): the reader's in-app notifications, newest first. The API lists only
 * notifications whose source the reader can still see (re-checked now); the text of module notifications is composed from
 * codes in the active language, and every item links to the record, where its content is read with a fresh check.
 */
export default function NotificationsPage() {
  const { t, formatDateTime } = useI18n();
  const [page, setPage] = useState(1);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const list = useNotifications({ page, pageSize: PAGE_SIZE, unread: unreadOnly ? 'true' : undefined });
  const channels = useChannels();
  const refresh = useNotificationsRefresh();
  const text = useNotificationText();
  const [error, setError] = useState<unknown>(null);
  const markRead = async (n: NotificationItem) => {
    if (n.readAt) return;
    try {
      await api(notificationsRoutes.markRead, { params: { notificationId: n.id } });
      await refresh();
    } catch (e) {
      setError(e);
    }
  };
  const markAll = async () => {
    setError(null);
    try {
      await api(notificationsRoutes.markAllRead, {});
      await refresh();
    } catch (e) {
      setError(e);
    }
  };
  return (
    <Main>
      <PageHeader
        title={t('notifications.title')}
        description={t('notifications.subtitle')}
        actions={
          <button type="button" className={btn.secondary} onClick={markAll} data-testid="notifications-read-all">
            {t('notifications.markAllRead')}
          </button>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
        <section aria-labelledby="notif-list" className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="notif-list" className="text-lg font-semibold">
              {t('notifications.listTitle')}
            </h2>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4"
                checked={unreadOnly}
                onChange={(e) => {
                  setUnreadOnly(e.target.checked);
                  setPage(1);
                }}
                data-testid="notifications-unread-only"
              />
              {t('notifications.unreadOnly')}
            </label>
          </div>
          <ApiErrorNotice error={error} />
          {list.isLoading ? (
            <LoadingState />
          ) : list.error || !list.data ? (
            <ErrorState error={list.error} onRetry={() => list.refetch()} />
          ) : list.data.items.length === 0 ? (
            <EmptyState title={unreadOnly ? t('notifications.emptyUnread') : t('notifications.empty')} hint={t('notifications.emptyHint')} />
          ) : (
            <>
              <ul className={cx(card, 'divide-y divide-line')} data-testid="notifications-list">
                {list.data.items.map((n) => (
                  <li key={n.id} className={cx('flex flex-col gap-1 p-3 sm:flex-row sm:items-start sm:justify-between', !n.readAt && 'bg-primary-soft/40')} data-testid="notification" data-kind={n.kind} data-read={n.readAt ? 'true' : 'false'}>
                    <div className="min-w-0">
                      <p className={cx('text-sm', !n.readAt && 'font-semibold')}>
                        {n.messageCode ? text(n) : <bdi data-user-text>{text(n)}</bdi>}
                      </p>
                      <p className="mt-0.5 text-xs text-muted">
                        {n.projectCode ? <span className="me-2">{n.projectCode}</span> : null}
                        {t(`notifications.kinds.${kindKey(n.kind)}` as MessageKey)} · {formatDateTime(n.createdAt)}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      {n.readAt ? <StatusBadge enumName="notificationReadStates" value="read" tone="neutral" /> : <StatusBadge enumName="notificationReadStates" value="unread" tone="info" />}
                      {n.link ? (
                        <Link href={n.link} className={btn.link} onClick={() => void markRead(n)} data-testid="notification-open">
                          {t('notifications.open')}
                        </Link>
                      ) : null}
                      {!n.readAt ? (
                        <button type="button" className={btn.ghost} onClick={() => void markRead(n)} data-testid="notification-mark-read">
                          {t('notifications.markRead')}
                        </button>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
              {list.data.total > PAGE_SIZE ? <Pagination page={page} pageSize={PAGE_SIZE} total={list.data.total} onPageChange={setPage} /> : null}
            </>
          )}
        </section>
        <aside aria-labelledby="notif-channels" className={cx(card, 'h-fit space-y-2 p-4')} data-testid="notification-channels">
          <h2 id="notif-channels" className="text-base font-semibold">
            {t('notifications.channels.title')}
          </h2>
          <ul className="space-y-2 text-sm">
            {(channels.data?.items ?? []).map((c) => (
              <li key={c.channel} className="flex items-center justify-between gap-2" data-channel={c.channel} data-status={c.status}>
                <span>{t(`notifications.channels.${c.channel}` as MessageKey)}</span>
                <StatusBadge enumName="notificationChannelStatuses" value={c.status} tone={c.status === 'enabled' || c.status === 'verified' ? 'success' : 'neutral'} />
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted">{t('notifications.channels.hint')}</p>
        </aside>
      </div>
    </Main>
  );
}
