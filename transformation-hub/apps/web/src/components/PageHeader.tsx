'use client';

import { useEffect, type ReactNode } from 'react';
import { useI18n } from '@/i18n/provider';
import { cx } from './ui';

/** Page title block. `title` is rendered as the page's single <h1> and mirrored into document.title. */
export function PageHeader({
  title,
  documentTitle,
  eyebrow,
  description,
  badges,
  actions,
  className,
}: {
  title: ReactNode;
  documentTitle?: string;
  eyebrow?: ReactNode;
  description?: ReactNode;
  badges?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  const { appName } = useI18n();
  const docTitle = documentTitle ?? (typeof title === 'string' ? title : undefined);
  useEffect(() => {
    if (docTitle) document.title = `${docTitle} · ${appName}`;
  }, [docTitle, appName]);

  return (
    <header className={cx('mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between', className)}>
      <div className="min-w-0">
        {eyebrow ? <div className="mb-1 text-sm text-muted">{eyebrow}</div> : null}
        <h1 className="text-2xl font-semibold break-words text-ink">{title}</h1>
        {badges ? <div className="mt-2 flex flex-wrap items-center gap-2">{badges}</div> : null}
        {description ? <div className="mt-2 max-w-3xl text-sm text-muted">{description}</div> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
