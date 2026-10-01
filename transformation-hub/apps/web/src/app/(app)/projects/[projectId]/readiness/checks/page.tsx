'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ListChecks, Plus } from 'lucide-react';
import { readinessRoutes } from '@hub/contracts';
import { READINESS_AREAS, READINESS_STATUSES, ROLE_KEYS, type ReadinessArea, type ReadinessStatus, type RoleKey } from '@hub/domain';
import { DataTable, type Column } from '@/components/DataTable';
import { DemoBadge } from '@/components/DemoBadge';
import { SelectField, TextAreaField, TextField } from '@/components/Field';
import { PageHeader } from '@/components/PageHeader';
import { SearchInput } from '@/components/SearchInput';
import { StatusBadge } from '@/components/StatusBadge';
import { useToast } from '@/components/Toast';
import { btn } from '@/components/ui';
import { UserPicker, type PickedUser } from '@/components/UserPicker';
import { useI18n } from '@/i18n/provider';
import { api } from '@/lib/api';
import { useLocalized } from '@/lib/i18n-data';
import { useProjectContext } from '@/lib/project-context';
import { rdHref, useChecks, usePlans, useReadinessRefresh, type ReadinessCheck } from '@/lib/readiness';
import { CriticalityBadges, FilterBar, FilterSelect, RdCommandDialog, useScopeLabels, useUrlState } from '../_components/rd';

const PAGE_SIZE = 25;
const FILTERS = ['q', 'area', 'status', 'blocker', 'siteId', 'workstreamId'] as const;

function CreateCheckDialog({ onClose }: { onClose: () => void }) {
  const { t, tStatus } = useI18n();
  const { projectId } = useProjectContext();
  const refresh = useReadinessRefresh();
  const toast = useToast();
  const { sites, workstreams, siteName, wsName } = useScopeLabels();
  const plans = usePlans({ page: 1, pageSize: 100 });
  const [area, setArea] = useState<ReadinessArea>('connectivity');
  const [title, setTitle] = useState('');
  const [titleAr, setTitleAr] = useState('');
  const [mandatory, setMandatory] = useState(true);
  const [blocker, setBlocker] = useState(false);
  const [signoffRole, setSignoffRole] = useState<RoleKey | ''>('functional_approver');
  const [siteId, setSiteId] = useState('');
  const [workstreamId, setWorkstreamId] = useState('');
  const [planId, setPlanId] = useState('');
  const [owner, setOwner] = useState<PickedUser | null>(null);
  const [contingency, setContingency] = useState('');
  const [dueDate, setDueDate] = useState('');
  return (
    <RdCommandDialog
      open
      onClose={onClose}
      title={t('readiness.checks.create.title')}
      confirmLabel={t('readiness.checks.create.confirm')}
      noteMode="none"
      confirmDisabled={!title.trim()}
      consequences={[t('readiness.checks.create.effect'), t('common.command.audited')]}
      onConfirm={async () => {
        const r = await api(readinessRoutes.createReadinessCheck, {
          params: { projectId },
          body: {
            area,
            title: title.trim(),
            ...(titleAr.trim() ? { titleAr: titleAr.trim() } : {}),
            mandatory,
            blocker,
            ...(signoffRole ? { signoffRole } : {}),
            ...(siteId ? { siteId } : {}),
            ...(workstreamId ? { workstreamId } : {}),
            ...(planId ? { cutoverPlanId: planId } : {}),
            ...(owner ? { ownerUserId: owner.id } : {}),
            ...(contingency.trim() ? { failureContingency: contingency.trim() } : {}),
            ...(dueDate ? { dueDate } : {}),
          },
        });
        await refresh();
        toast.show('success', t('readiness.checks.create.done', { code: r.code }));
        onClose();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField label={t('readiness.checks.create.area')} required value={area} onChange={(e) => setArea(e.target.value as ReadinessArea)} data-testid="check-area">
          {READINESS_AREAS.map((a) => (
            <option key={a} value={a}>
              {tStatus('readinessAreas', a)}
            </option>
          ))}
        </SelectField>
        <SelectField label={t('readiness.checks.create.signoffRole')} hint={t('readiness.checks.create.signoffHint')} value={signoffRole} onChange={(e) => setSignoffRole(e.target.value as RoleKey | '')}>
          <option value="">{t('readiness.common.notSet')}</option>
          {ROLE_KEYS.map((r) => (
            <option key={r} value={r}>
              {tStatus('roleKeys', r)}
            </option>
          ))}
        </SelectField>
        <TextField className="sm:col-span-2" label={t('readiness.checks.create.titleField')} required value={title} maxLength={300} onChange={(e) => setTitle(e.target.value)} data-testid="check-title" />
        <TextField className="sm:col-span-2" label={t('readiness.checks.create.titleAr')} value={titleAr} maxLength={300} onChange={(e) => setTitleAr(e.target.value)} />
        <label className="inline-flex items-center gap-2 text-sm">
          <input type="checkbox" checked={mandatory} onChange={(e) => setMandatory(e.target.checked)} />
          {t('readiness.checks.create.mandatory')}
        </label>
        <label className="inline-flex items-center gap-2 text-sm">
          <input type="checkbox" checked={blocker} onChange={(e) => setBlocker(e.target.checked)} data-testid="check-blocker" />
          {t('readiness.checks.create.blocker')}
        </label>
        <SelectField label={t('readiness.checks.create.site')} value={siteId} onChange={(e) => setSiteId(e.target.value)}>
          <option value="">{t('readiness.common.projectLevel')}</option>
          {sites.map((s) => (
            <option key={s.id} value={s.id}>
              {siteName(s.id)}
            </option>
          ))}
        </SelectField>
        <SelectField label={t('readiness.checks.create.workstream')} value={workstreamId} onChange={(e) => setWorkstreamId(e.target.value)}>
          <option value="">{t('readiness.common.notSet')}</option>
          {workstreams.map((w) => (
            <option key={w.id} value={w.id}>
              {wsName(w.id)}
            </option>
          ))}
        </SelectField>
        <SelectField className="sm:col-span-2" label={t('readiness.checks.create.plan')} value={planId} onChange={(e) => setPlanId(e.target.value)} data-testid="check-plan">
          <option value="">{t('readiness.common.notSet')}</option>
          {(plans.data?.items ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.code} — {p.title}
            </option>
          ))}
        </SelectField>
        <div className="sm:col-span-2">
          <UserPicker label={t('readiness.checks.create.owner')} value={owner} onChange={setOwner} />
        </div>
        <TextAreaField className="sm:col-span-2" label={t('readiness.checks.create.contingency')} value={contingency} maxLength={8000} onChange={(e) => setContingency(e.target.value)} data-testid="check-contingency" />
        <TextField label={t('readiness.checks.create.dueDate')} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
      </div>
    </RdCommandDialog>
  );
}

function InstantiateDialog({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const { projectId } = useProjectContext();
  const refresh = useReadinessRefresh();
  const toast = useToast();
  const { sites, siteName } = useScopeLabels();
  const [siteId, setSiteId] = useState('');
  return (
    <RdCommandDialog
      open
      onClose={onClose}
      title={t('readiness.checks.instantiate.title')}
      confirmLabel={t('readiness.checks.instantiate.confirm')}
      noteMode="none"
      consequences={[t('readiness.checks.instantiate.effect'), t('common.command.audited')]}
      onConfirm={async () => {
        const r = await api(readinessRoutes.instantiateChecklist, { params: { projectId }, body: siteId ? { siteId } : {} });
        await refresh();
        toast.show('success', t('readiness.checks.instantiate.done', { created: r.created, existing: r.existing }));
        onClose();
      }}
    >
      <SelectField label={t('readiness.checks.instantiate.site')} value={siteId} onChange={(e) => setSiteId(e.target.value)}>
        <option value="">{t('readiness.common.projectLevel')}</option>
        {sites.map((s) => (
          <option key={s.id} value={s.id}>
            {siteName(s.id)}
          </option>
        ))}
      </SelectField>
    </RdCommandDialog>
  );
}

export default function ReadinessChecksPage() {
  const { t, tStatus, formatNumber } = useI18n();
  const { projectId, can } = useProjectContext();
  const { values, page, set, clear, active } = useUrlState(FILTERS);
  const { sites, workstreams, siteName, wsName, projectLevel } = useScopeLabels();
  const localized = useLocalized();
  const [createOpen, setCreateOpen] = useState(false);
  const [instOpen, setInstOpen] = useState(false);
  const base = rdHref(projectId);
  const query = {
    page,
    pageSize: PAGE_SIZE,
    q: values.q || undefined,
    area: (values.area || undefined) as ReadinessArea | undefined,
    status: (values.status || undefined) as ReadinessStatus | undefined,
    blocker: (values.blocker || undefined) as 'true' | 'false' | undefined,
    siteId: values.siteId || undefined,
    workstreamId: values.workstreamId || undefined,
  };
  const list = useChecks(query);
  const canManage = can('readiness.check.manage');

  const columns: Column<ReadinessCheck>[] = [
    {
      key: 'code',
      header: t('readiness.checks.columns.code'),
      isRowHeader: true,
      sortValue: (c) => c.code,
      cell: (c) => (
        <span className="flex flex-wrap items-center gap-1">
          <Link href={`${base}/checks/${c.id}`} className={btn.link} dir="ltr">
            {c.code}
          </Link>
          {c.isDemo ? <DemoBadge /> : null}
        </span>
      ),
    },
    {
      key: 'title',
      header: t('readiness.checks.columns.title'),
      sortValue: (c) => localized(c.title, c.titleAr),
      cell: (c) => (
        <span className="flex flex-col gap-0.5">
          {/* QA-P34-01d: template checks carry their Arabic title; a check without one was typed by a person (data-user-text). */}
          <span dir="auto" data-user-text={c.titleAr ? undefined : true}>
            {localized(c.title, c.titleAr)}
          </span>
          <span className="text-xs text-muted">{tStatus('readinessAreas', c.area)}</span>
        </span>
      ),
    },
    {
      key: 'scope',
      header: t('readiness.checks.columns.scope'),
      cell: (c) => (
        <span className="flex flex-col gap-0.5 text-xs">
          <span>{c.siteId ? t('readiness.checks.scopeSite', { site: siteName(c.siteId) ?? '' }) : projectLevel}</span>
          {c.workstreamId ? <span className="text-muted">{wsName(c.workstreamId)}</span> : null}
          {c.cutoverPlanId ? (
            <Link className={btn.link} href={`${base}/cutover/${c.cutoverPlanId}`}>
              {t('readiness.checks.scopePlan', { plan: `#${c.cutoverPlanId.slice(-6)}` })}
            </Link>
          ) : null}
        </span>
      ),
    },
    { key: 'criticality', header: t('readiness.checks.columns.criticality'), sortValue: (c) => (c.blocker ? 0 : c.mandatory ? 1 : 2), cell: (c) => <CriticalityBadges mandatory={c.mandatory} blocker={c.blocker} /> },
    {
      key: 'status',
      header: t('readiness.checks.columns.status'),
      sortValue: (c) => c.status,
      cell: (c) => (
        <span className="flex flex-col items-start gap-1">
          <StatusBadge enumName="readinessStatuses" value={c.status} />
          {c.status === 'waived' && !c.waiverEffective ? <span className="text-xs text-danger">{t('readiness.waivers.notEffective')}</span> : null}
        </span>
      ),
    },
    {
      key: 'latest',
      header: t('readiness.checks.columns.latestTest'),
      cell: (c) => (c.latestTest ? <StatusBadge enumName="readinessStatuses" value={c.latestTest.result} /> : <span className="text-xs text-muted">{t('readiness.checks.noTest')}</span>),
    },
    {
      key: 'evidence',
      header: t('readiness.checks.columns.evidence'),
      cell: (c) => <span className="tabular text-xs">{t('readiness.checks.evidenceCount', { active: formatNumber(c.evidence.active), conflicting: formatNumber(c.evidence.conflicting) })}</span>,
    },
  ];

  return (
    <>
      <PageHeader
        title={t('readiness.checks.title')}
        description={t('readiness.checks.subtitle')}
        actions={
          canManage ? (
            <>
              <button type="button" className={btn.secondary} onClick={() => setInstOpen(true)} data-testid="instantiate-checklist">
                <ListChecks aria-hidden="true" className="size-4" />
                {t('readiness.checks.instantiate.action')}
              </button>
              <button type="button" className={btn.primary} onClick={() => setCreateOpen(true)} data-testid="create-check">
                <Plus aria-hidden="true" className="size-4" />
                {t('readiness.checks.create.action')}
              </button>
            </>
          ) : null
        }
      />
      <FilterBar onClear={clear} active={active}>
        <SearchInput className="w-full sm:w-64" label={t('readiness.checks.search')} value={values.q} onChange={(v) => set({ q: v })} />
        <FilterSelect label={t('readiness.checks.filterArea')} value={values.area} onChange={(v) => set({ area: v })} options={READINESS_AREAS.map((a) => ({ value: a, label: tStatus('readinessAreas', a) }))} testId="filter-area" />
        <FilterSelect label={t('readiness.checks.filterStatus')} value={values.status} onChange={(v) => set({ status: v })} options={READINESS_STATUSES.map((s) => ({ value: s, label: tStatus('readinessStatuses', s) }))} testId="filter-status" />
        <FilterSelect
          label={t('readiness.checks.filterCriticality')}
          value={values.blocker}
          onChange={(v) => set({ blocker: v })}
          options={[
            { value: 'true', label: t('readiness.checks.blockersOnly') },
            { value: 'false', label: t('readiness.checks.nonBlockers') },
          ]}
          testId="filter-blocker"
        />
        {sites.length ? <FilterSelect label={t('readiness.checks.filterSite')} value={values.siteId} onChange={(v) => set({ siteId: v })} options={sites.map((s) => ({ value: s.id, label: siteName(s.id) ?? s.code }))} /> : null}
        {workstreams.length ? (
          <FilterSelect label={t('readiness.checks.filterWorkstream')} value={values.workstreamId} onChange={(v) => set({ workstreamId: v })} options={workstreams.map((w) => ({ value: w.id, label: wsName(w.id) ?? w.code }))} />
        ) : null}
      </FilterBar>
      <DataTable
        caption={t('readiness.checks.title')}
        columns={columns}
        rows={list.data?.items}
        rowKey={(c) => c.id}
        isLoading={list.isLoading}
        error={list.error}
        onRetry={() => list.refetch()}
        emptyTitle={active ? t('readiness.checks.emptySearch') : t('readiness.checks.empty')}
        pagination={list.data ? { page, pageSize: PAGE_SIZE, total: list.data.total, onPageChange: (p) => set({ page: p }) } : undefined}
        testId="checks-table"
      />
      {createOpen ? <CreateCheckDialog onClose={() => setCreateOpen(false)} /> : null}
      {instOpen ? <InstantiateDialog onClose={() => setInstOpen(false)} /> : null}
    </>
  );
}
