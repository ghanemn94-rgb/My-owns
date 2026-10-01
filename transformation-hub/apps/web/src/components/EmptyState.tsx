'use client';

import { Inbox, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cx } from './ui';

export function EmptyState({
  title,
  hint,
  action,
  icon: Icon = Inbox,
  className,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
  icon?: LucideIcon;
  className?: string;
}) {
  return (
    <div className={cx('flex flex-col items-center gap-2 px-4 py-10 text-center', className)} data-testid="empty-state">
      <Icon aria-hidden="true" className="size-8 text-muted" />
      <p className="font-medium text-ink">{title}</p>
      {hint ? <p className="max-w-prose text-sm text-muted">{hint}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
