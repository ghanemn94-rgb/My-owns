'use client';

import Link from 'next/link';
import { Bell } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useI18n } from '@/i18n/provider';
import { useUnreadCount } from '@/lib/notifications';
import { cx } from './ui';

/**
 * Header bell (REQ-PLT-008): the number of the reader's unread in-app notifications (re-authorised by the API at read time)
 * and a link to the notifications inbox. The count is announced in the link's accessible name, not by colour alone.
 */
export function NotificationBell() {
  const { t, formatNumber } = useI18n();
  const pathname = usePathname() ?? '';
  const unread = useUnreadCount();
  const n = unread.data?.count ?? 0;
  const label = n > 0 ? t('notifications.bell.unread', { count: n }) : t('notifications.bell.none');
  return (
    <Link
      href="/notifications"
      aria-label={label}
      title={label}
      aria-current={pathname.startsWith('/notifications') ? 'page' : undefined}
      className={cx('relative inline-flex min-h-10 min-w-10 items-center justify-center rounded-md text-ink hover:bg-surface-muted', pathname.startsWith('/notifications') && 'bg-primary-soft text-primary')}
      data-testid="notification-bell"
      data-unread={n}
    >
      <Bell aria-hidden="true" className="size-5" />
      {n > 0 ? (
        <span aria-hidden="true" className="absolute -top-0.5 -end-0.5 min-w-5 rounded-full bg-danger px-1 text-center text-[11px] leading-5 font-semibold text-white tabular">
          {n > 99 ? '99+' : formatNumber(n)}
        </span>
      ) : null}
    </Link>
  );
}
