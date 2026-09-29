'use client';

import Link from 'next/link';
import { LayoutGrid, Plus, Table2 } from 'lucide-react';
import { useState } from 'react';
import type { ProjectSummary } from '@hub/contracts';
import { DataTable, type Column } from '@/components/DataTable';
import { DemoBadge } from '@/components/DemoBadge';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { LoadingState } from '@/components/LoadingState';
import { Main } from '@/components/Main';
import { NotImplementedYet } from '@/components/NotImplementedYet';
import { PageHeader } from '@/components/PageHeader';
import { Pagination } from '@/components/Pagination';
import { DimensionList } from '@/components/ProjectDimensions';
import { SearchInput } from '@/components/SearchInput';
import { StatusBadge } from '@/components/StatusBadge';
import { btn, card, cx } from '@/components/ui';
import { EM_DASH, useI18n } from '@/i18n/provider';
import { canInOrg, useMe, useProjects } from '@/lib/queries';

const PAGE_SIZE = 12;

/** A count the caller may not be allowed to see: null renders "—" (with an explanation), never 0. */
function Count({ value }: { value: number | null }) {
  const { t, formatNumber } = useI18n();
  if (value === null) {
    return (
      <span title={t('portfolio.notVisible')}>
        <span aria-hidden="true">{EM_DASH}</span>
        <span className="sr-only">{t('portfolio.notVisible')}</span>
      </span>
    );
  }
  return <span className="tabular">{formatNumber(value)}</span>;
}

function NextGate({ gate }: { gate: ProjectSummary['nextGate'] }) {
  const { t } = useI18n();
  if (!gate) {
    return (
      <span title={t('portfolio.notVisible')}>
        <span aria-hidden="true">{EM_DASH}</span>
        <span className="sr-only">{t('portfolio.notVisible')}</span>
      </span>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span className="font-medium" dir="auto">
        <span dir="ltr">{gate.key}</span> — {gate.name}
      </span>
      <StatusBadge enumName="gateAssessmentStatuses" value={gate.status} />
    </span>
  );
}

function ProjectCard({ p }: { p: ProjectSummary }) {
  const { t, tStatus, formatList } = useI18n();
  return (
    <li className={cx(card, 'flex flex-col gap-4 p-4')} data-testid="project-card" data-project-code={p.code}>
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-muted" dir="ltr">
            {p.code}
          </span>
          {p.isDemo ? <DemoBadge /> : null}
          <StatusBadge enumName="projectStatuses" value={p.status} />
        </div>
        <h2 className="mt-1 text-lg font-semibold">
          <Link href={`/projects/${p.id}`} className="text-ink hover:text-primary hover:underline" dir="auto">
            {p.name}
          </Link>
        </h2>
        <p className="mt-1 text-sm text-muted">
          {tStatus('templateKinds', p.templateKind)} · {t('portfolio.templateVersion', { version: p.templateVersionNo })}
          {p.programName ? (
            <>
              {' · '}
              <span dir="auto">{p.programName}</span>
            </>
          ) : null}
        </p>
        <p className="mt-1 text-sm">
          <span className="text-muted">{t('portfolio.myRoles')}: </span>
          {p.myRoles.length ? formatList(p.myRoles.map((r) => tStatus('roleKeys', r))) : EM_DASH}
        </p>
      </div>
      <section aria-label={t('portfolio.dimensions')}>
        <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">{t('portfolio.dimensions')}</h3>
        <DimensionList dimensions={p.dimensions} />
      </section>
      <dl className="grid grid-cols-1 gap-2 border-t border-line pt-3 text-sm sm:grid-cols-3">
        <div className="sm:col-span-3">
          <dt className="text-muted">{t('portfolio.nextGate')}</dt>
          <dd className="mt-0.5">
            <NextGate gate={p.nextGate} />
          </dd>
        </div>
        <div>
          <dt className="text-muted">{t('portfolio.openRisks')}</dt>
          <dd className="font-semibold">
            <Count value={p.openRisks} />
          </dd>
        </div>
        <div>
          <dt className="text-muted">{t('portfolio.overdueActions')}</dt>
          <dd className="font-semibold">
            <Count value={p.overdueActions} />
          </dd>
        </div>
        <div className="flex items-end sm:justify-end">
          <Link href={`/projects/${p.id}`} className={btn.link}>
            {t('portfolio.openProject')}
          </Link>
        </div>
      </dl>
    </li>
  );
}

export default function PortfolioHomePage() {
  const { t, tStatus, formatList } = useI18n();
  const me = useMe();
  const [q, setQ] = useState('');
  const [includeDemo, setIncludeDemo] = useState(true);
  const [page, setPage] = useState(1);
  const [view, setView] = useState<'cards' | 'table'>('cards');
  const projects = useProjects({ page, pageSize: PAGE_SIZE, q: q || undefined, includeDemo: includeDemo ? 'true' : 'false' });
  const canCreate = canInOrg(me.data, 'portfolio.project.create');

  const columns: Column<ProjectSummary>[] = [
    {
      key: 'code',
      header: t('portfolio.columns.code'),
      sortValue: (p) => p.code,
      isRowHeader: true,
      cell: (p) => (
        <Link href={`/projects/${p.id}`} className={btn.link} dir="ltr">
          {p.code}
        </Link>
      ),
    },
    {
      key: 'name',
      header: t('portfolio.columns.name'),
      sortValue: (p) => p.name,
      cell: (p) => (
        <div className="flex flex-col gap-1">
          <span dir="auto">{p.name}</span>
          {p.isDemo ? <DemoBadge className="self-start" /> : null}
        </div>
      ),
    },
    {
      key: 'template',
      header: t('portfolio.columns.template'),
      sortValue: (p) => p.templateKind,
      cell: (p) => (
        <span>
          {tStatus('templateKinds', p.templateKind)} · {t('portfolio.templateVersion', { version: p.templateVersionNo })}
        </span>
      ),
    },
    { key: 'roles', header: t('portfolio.myRoles'), cell: (p) => (p.myRoles.length ? formatList(p.myRoles.map((r) => tStatus('roleKeys', r))) : EM_DASH) },
    { key: 'dims', header: t('portfolio.dimensions'), cell: (p) => <DimensionList dimensions={p.dimensions} className="min-w-64" /> },
    { key: 'gate', header: t('portfolio.nextGate'), cell: (p) => <NextGate gate={p.nextGate} /> },
    { key: 'risks', header: t('portfolio.openRisks'), sortValue: (p) => p.openRisks, cell: (p) => <Count value={p.openRisks} /> },
    { key: 'actions', header: t('portfolio.overdueActions'), sortValue: (p) => p.overdueActions, cell: (p) => <Count value={p.overdueActions} /> },
  ];

  const data = projects.data;

  return (
    <Main>
      <PageHeader
        title={t('portfolio.title')}
        description={t('portfolio.subtitle')}
        actions={
          canCreate ? (
            <Link href="/projects/new" className={btn.primary} data-testid="create-project">
              <Plus aria-hidden="true" className="size-4" />
              {t('portfolio.createProject')}
            </Link>
          ) : null
        }
      />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <SearchInput
          className="sm:w-80"
          label={t('portfolio.searchLabel')}
          placeholder={t('portfolio.searchPlaceholder')}
          value={q}
          onChange={(v) => {
            setQ(v);
            setPage(1);
          }}
        />
        <label className="inline-flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            className="size-4 accent-[var(--hub-primary)]"
            checked={includeDemo}
            onChange={(e) => {
              setIncludeDemo(e.target.checked);
              setPage(1);
            }}
            data-testid="include-demo"
          />
          {t('portfolio.includeDemo')}
        </label>
        <div role="group" aria-label={t('portfolio.viewLabel')} className="inline-flex rounded-md border border-line-strong sm:ms-auto">
          <button
            type="button"
            aria-pressed={view === 'cards'}
            onClick={() => setView('cards')}
            className={cx('inline-flex min-h-10 items-center gap-1.5 px-3 text-sm', view === 'cards' ? 'bg-primary-soft font-medium text-primary' : 'text-ink')}
          >
            <LayoutGrid aria-hidden="true" className="size-4" />
            {t('portfolio.viewCards')}
          </button>
          <button
            type="button"
            aria-pressed={view === 'table'}
            onClick={() => setView('table')}
            className={cx(
              'inline-flex min-h-10 items-center gap-1.5 border-s border-line-strong px-3 text-sm',
              view === 'table' ? 'bg-primary-soft font-medium text-primary' : 'text-ink',
            )}
          >
            <Table2 aria-hidden="true" className="size-4" />
            {t('portfolio.viewTable')}
          </button>
        </div>
      </div>

      {view === 'table' ? (
        <DataTable
          caption={t('portfolio.title')}
          columns={columns}
          rows={data?.items}
          rowKey={(p) => p.id}
          isLoading={projects.isLoading}
          error={projects.error}
          onRetry={() => projects.refetch()}
          emptyTitle={q ? t('portfolio.emptySearch') : t('portfolio.empty')}
          emptyHint={q ? undefined : t('portfolio.emptyHint')}
          pagination={data ? { page, pageSize: PAGE_SIZE, total: data.total, onPageChange: setPage } : undefined}
          testId="projects-table"
        />
      ) : projects.isLoading ? (
        <LoadingState />
      ) : projects.error ? (
        <div className={card}>
          <ErrorState error={projects.error} onRetry={() => projects.refetch()} />
        </div>
      ) : !data || data.items.length === 0 ? (
        <div className={card}>
          <EmptyState title={q ? t('portfolio.emptySearch') : t('portfolio.empty')} hint={q ? undefined : t('portfolio.emptyHint')} />
        </div>
      ) : (
        <>
          <ul className="grid gap-4 lg:grid-cols-2" aria-label={t('portfolio.projectList')} data-testid="project-cards">
            {data.items.map((p) => (
              <ProjectCard key={p.id} p={p} />
            ))}
          </ul>
          <Pagination className="mt-4" page={page} pageSize={PAGE_SIZE} total={data.total} onPageChange={setPage} />
        </>
      )}

      <NotImplementedYet
        className="mt-6"
        compact
        phase="P2/P4"
        feature={t('portfolio.laterTitle')}
        description={t('portfolio.laterBody')}
      />
    </Main>
  );
}
