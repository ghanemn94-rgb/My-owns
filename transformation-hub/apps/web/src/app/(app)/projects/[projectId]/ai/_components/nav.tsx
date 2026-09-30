'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { RestrictedState } from '@/components/RestrictedState';
import { cx } from '@/components/ui';
import { useI18n, type MessageKey } from '@/i18n/provider';
import { AI_TABS, aiHref, tabPermissions, type AiTabKey } from '@/lib/ai';
import { useProjectContext } from '@/lib/project-context';

/** Sub-navigation of the AI PM Center; a tab is offered only when the caller holds one of its read permissions. */
export function AiTabs() {
  const { t } = useI18n();
  const { projectId, can } = useProjectContext();
  const pathname = usePathname() ?? '';
  const base = aiHref(projectId);
  const active = (segment: string) => (segment === '' ? pathname === base : pathname === `${base}${segment}` || pathname.startsWith(`${base}${segment}/`));
  return (
    <nav aria-label={t('ai.tabs.label')} className="mb-5 border-b border-line" data-testid="ai-tabs">
      <ul className="flex flex-wrap gap-x-1">
        {AI_TABS.filter((tab) => tab.permissions.length === 0 || can(tab.permissions)).map((tab) => {
          const on = active(tab.segment);
          return (
            <li key={tab.key}>
              <Link
                href={`${base}${tab.segment}`}
                aria-current={on ? 'page' : undefined}
                data-tab={tab.key}
                className={cx('inline-flex min-h-10 items-center border-b-2 px-3 text-sm font-medium', on ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-ink')}
              >
                {t(`ai.tabs.${tab.key}` as MessageKey)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** A tab opened by URL without its read permission shows the neutral restricted state (the API would refuse anyway). */
export function TabGuard({ tab, children }: { tab: AiTabKey; children: ReactNode }) {
  const { can } = useProjectContext();
  const perms = tabPermissions(tab);
  if (perms.length > 0 && !can(perms)) return <RestrictedState />;
  return <>{children}</>;
}
