'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { identityRoutes, type RouteResponse } from '@hub/contracts';
import { DataTable, type Column } from '@/components/DataTable';
import { DemoBadge } from '@/components/DemoBadge';
import { Main } from '@/components/Main';
import { NotImplementedYet } from '@/components/NotImplementedYet';
import { PageHeader } from '@/components/PageHeader';
import { RestrictedState } from '@/components/RestrictedState';
import { SearchInput } from '@/components/SearchInput';
import { StatusBadge } from '@/components/StatusBadge';
import { cx } from '@/components/ui';
import { useI18n, type MessageKey } from '@/i18n/provider';
import { api } from '@/lib/api';
import { canInOrg, qk, useMe } from '@/lib/queries';

type AdminUser = RouteResponse<typeof identityRoutes.listUsers>['items'][number];
const PAGE_SIZE = 25;

const TABS: { key: string; label: MessageKey; phase: string | null }[] = [
  { key: 'users', label: 'admin.tabs.users', phase: null },
  { key: 'permissions', label: 'admin.tabs.permissions', phase: 'P7' },
  { key: 'templates', label: 'admin.tabs.templates', phase: 'P6' },
  { key: 'integrations', label: 'admin.tabs.integrations', phase: 'P7' },
  { key: 'identity', label: 'admin.tabs.identity', phase: 'P7' },
  { key: 'deployment', label: 'admin.tabs.deployment', phase: 'P7' },
];

function UsersTab() {
  const { t, tStatus, formatDateTime } = useI18n();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const query = { page, pageSize: PAGE_SIZE, q: q || undefined };
  const users = useQuery({
    queryKey: qk.adminUsers(query),
    queryFn: ({ signal }) => api(identityRoutes.listUsers, { query, signal }),
    placeholderData: (prev) => prev,
  });

  const columns: Column<AdminUser>[] = [
    {
      key: 'name',
      header: t('admin.users.name'),
      isRowHeader: true,
      sortValue: (u) => u.displayName,
      cell: (u) => (
        <span className="flex flex-col gap-0.5">
          <span className="inline-flex flex-wrap items-center gap-2">
            <span dir="auto">{u.displayName}</span>
            {u.isDemo ? <DemoBadge /> : null}
          </span>
          {u.title ? (
            <span className="text-xs font-normal text-muted" dir="auto">
              {u.title}
            </span>
          ) : null}
        </span>
      ),
    },
    { key: 'email', header: t('admin.users.email'), sortValue: (u) => u.email, cell: (u) => <span dir="ltr">{u.email}</span> },
    { key: 'clearance', header: t('admin.users.clearance'), sortValue: (u) => u.clearance, cell: (u) => tStatus('classifications', u.clearance) },
    {
      key: 'active',
      header: t('admin.users.status'),
      sortValue: (u) => (u.isActive ? 1 : 0),
      cell: (u) => <StatusBadge enumName="userStates" value={u.isActive ? 'active' : 'inactive'} tone={u.isActive ? 'success' : 'neutral'} />,
    },
    { key: 'login', header: t('admin.users.lastLogin'), sortValue: (u) => u.lastLoginAt ?? '', cell: (u) => <span className="tabular">{formatDateTime(u.lastLoginAt)}</span> },
  ];

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">{t('admin.users.hint')}</p>
      <div className="sm:w-80">
        <SearchInput
          label={t('admin.users.search')}
          value={q}
          onChange={(v) => {
            setQ(v);
            setPage(1);
          }}
        />
      </div>
      <DataTable
        caption={t('admin.tabs.users')}
        columns={columns}
        rows={users.data?.items}
        rowKey={(u) => u.id}
        isLoading={users.isLoading}
        error={users.error}
        onRetry={() => users.refetch()}
        emptyTitle={t('admin.users.empty')}
        pagination={users.data ? { page, pageSize: PAGE_SIZE, total: users.data.total, onPageChange: setPage } : undefined}
        testId="admin-users"
      />
      <NotImplementedYet compact phase="P7" feature={t('admin.users.provisioningTitle')} description={t('admin.users.provisioningBody')} />
    </div>
  );
}

export default function AdminPage() {
  const { t } = useI18n();
  const me = useMe();
  const [tab, setTab] = useState('users');
  const canUsers = canInOrg(me.data, 'admin.users.read');
  const current = TABS.find((x) => x.key === tab) ?? TABS[0]!;

  return (
    <Main>
      <PageHeader title={t('admin.title')} description={t('admin.subtitle')} />
      <div role="tablist" aria-label={t('admin.title')} className="mb-4 flex flex-wrap gap-1 border-b border-line">
        {TABS.map((x) => (
          <button
            key={x.key}
            type="button"
            role="tab"
            id={`tab-${x.key}`}
            aria-selected={tab === x.key}
            aria-controls={`panel-${x.key}`}
            tabIndex={tab === x.key ? 0 : -1}
            onClick={() => setTab(x.key)}
            onKeyDown={(e) => {
              const i = TABS.findIndex((y) => y.key === tab);
              const forward = document.dir === 'rtl' ? 'ArrowLeft' : 'ArrowRight';
              const backward = document.dir === 'rtl' ? 'ArrowRight' : 'ArrowLeft';
              let nextIdx: number | null = null;
              if (e.key === forward) nextIdx = (i + 1) % TABS.length;
              if (e.key === backward) nextIdx = (i - 1 + TABS.length) % TABS.length;
              if (nextIdx !== null) {
                e.preventDefault();
                const nk = TABS[nextIdx]!.key;
                setTab(nk);
                document.getElementById(`tab-${nk}`)?.focus();
              }
            }}
            className={cx(
              '-mb-px inline-flex min-h-10 items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium',
              tab === x.key ? 'border-primary text-primary' : 'border-transparent text-ink hover:text-primary',
            )}
          >
            {t(x.label)}
            {x.phase ? <span className="rounded bg-surface-muted px-1 text-[11px] text-muted">{x.phase}</span> : null}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${current.key}`} aria-labelledby={`tab-${current.key}`}>
        {current.key === 'users' ? (
          canUsers ? (
            <UsersTab />
          ) : (
            <RestrictedState showHomeLink={false} />
          )
        ) : (
          <NotImplementedYet phase={current.phase ?? ''} feature={t(current.label)} />
        )}
      </div>
    </Main>
  );
}
