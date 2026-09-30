'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Plus, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { planningRoutes as P, type RouteResponse } from '@hub/contracts';
import { RAID_STATUSES } from '@hub/domain';
import { EM_DASH, useI18n } from '@/i18n/provider';
import { api } from '@/lib/api';
import { localized, useLocalized } from '@/lib/i18n-data';
import { nodeHref, pk, useRefreshPlanning, useSchedule } from '@/lib/planning';
import { useProjectContext } from '@/lib/project-context';
import { canInProject, useProjects } from '@/lib/queries';
import { ConfirmCommandDialog } from '../../ConfirmCommandDialog';
import { DataTable, type Column } from '../../DataTable';
import { SelectField, TextAreaField, TextField } from '../../Field';
import { Pagination } from '../../Pagination';
import { SearchInput } from '../../SearchInput';
import { StatusBadge } from '../../StatusBadge';
import { useToast } from '../../Toast';
import { btn, cx } from '../../ui';
import { CodeLink, DateText, FilterSelect } from '../bits';
import { FormDialog } from '../dialogs';

type XDep = RouteResponse<typeof P.listCrossProjectDependencies>['items'][number];
type ItemRef = XDep['other'];
type Direction = '' | 'outgoing' | 'incoming';

const PAGE = 100;

const itemHref = (projectId: string, i: ItemRef) => nodeHref(projectId, i.type, i.id);

/**
 * Integrated Plan — cross-project dependencies (spec §5, REQ-ENT-010, DOM-P2-17). The API lists a dependency only when the
 * caller can read BOTH ends (minimum disclosure): nothing about a project the caller cannot read is shown or counted.
 * Outgoing = this project depends on another project's item; incoming = another project depends on an item of this one.
 * Closing is done by the dependent project (the owner of the dependency), with a reason.
 */
export function CrossProjectTab() {
  const { t, tStatus } = useI18n();
  const loc = useLocalized();
  const { projectId, can, me } = useProjectContext();
  const [status, setStatus] = useState('');
  const [direction, setDirection] = useState<Direction>('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [closing, setClosing] = useState<XDep | null>(null);
  const refresh = useRefreshPlanning(projectId);
  const toast = useToast();
  useEffect(() => setPage(1), [status]);
  const query = { page, pageSize: PAGE, status: (status || undefined) as (typeof RAID_STATUSES)[number] | undefined };
  const list = useQuery({
    queryKey: [...pk.all(projectId), 'cross-project', query],
    queryFn: ({ signal }) => api(P.listCrossProjectDependencies, { params: { projectId }, query, signal }),
    placeholderData: keepPreviousData,
  });
  const needle = q.trim().toLowerCase();
  const rows = (list.data?.items ?? []).filter((d) => {
    if (direction && d.direction !== direction) return false;
    if (!needle) return true;
    return [d.description, d.projectCode, d.otherProjectCode, d.other.code, d.other.title, d.local?.code ?? '', d.local?.title ?? ''].some((x) => x.toLowerCase().includes(needle));
  });
  const outgoing = rows.filter((d) => d.direction === 'outgoing');
  const incoming = rows.filter((d) => d.direction === 'incoming');
  const canCreate = can('planning.dependency.manage');
  const canClose = (d: XDep) => d.status !== 'closed' && canInProject(me, d.projectId, 'planning.dependency.manage');

  const item = (pid: string, i: ItemRef | null, testId?: string) =>
    i ? (
      <span className="flex flex-col gap-0.5">
        <CodeLink href={itemHref(pid, i)} code={i.code} title={loc(i.title, i.titleAr)} testId={testId} />
        <span className="text-xs text-muted">{t(`planning.xproj.itemTypes.${i.type}`)}</span>
      </span>
    ) : (
      <span className="text-muted">{t('planning.xproj.wholeProject')}</span>
    );
  const risk = (d: XDep) =>
    d.status === 'closed' ? (
      <span className="text-muted">{EM_DASH}</span>
    ) : d.atRisk ? (
      <StatusBadge enumName="ragStatuses" value="at_risk" tone="danger" label={t('planning.xproj.atRisk')} />
    ) : d.neededBy ? (
      <StatusBadge enumName="ragStatuses" value="on_track" tone="success" label={t('planning.xproj.onTrack')} />
    ) : (
      <span className="text-xs text-muted">{t('planning.xproj.noNeededBy')}</span>
    );
  const closeCell = (d: XDep) =>
    canClose(d) ? (
      <button type="button" className={cx(btn.ghost, 'min-h-8 whitespace-nowrap px-2 py-1')} onClick={() => setClosing(d)} data-testid="xproj-close" aria-label={t('planning.xproj.closeLabel', { code: d.other.code })}>
        <X aria-hidden="true" className="size-4" />
        {t('planning.xproj.close')}
      </button>
    ) : d.status === 'closed' && d.closedReason ? (
      <span className="text-xs text-muted" dir="auto">
        {d.closedReason}
      </span>
    ) : null;

  const common: Column<XDep>[] = [
    { key: 'needed', header: t('planning.xproj.neededBy'), sortValue: (d) => d.neededBy, cell: (d) => <DateText value={d.neededBy} /> },
    { key: 'risk', header: t('planning.xproj.risk'), sortValue: (d) => (d.atRisk ? 0 : 1), cell: risk },
    { key: 'status', header: t('planning.common.status'), sortValue: (d) => d.status, cell: (d) => <StatusBadge enumName="raidStatuses" value={d.status} /> },
    { key: 'desc', header: t('planning.xproj.description'), cell: (d) => <span dir="auto">{d.description}</span> },
    { key: 'actions', header: t('planning.common.actions'), cell: closeCell },
  ];
  const outgoingColumns: Column<XDep>[] = [
    { key: 'local', header: t('planning.xproj.ourItem'), isRowHeader: true, cell: (d) => item(d.projectId, d.local) },
    {
      key: 'other',
      header: t('planning.xproj.dependsOn'),
      cell: (d) => (
        <span className="flex flex-col gap-0.5">
          <span className="text-xs font-semibold text-muted" dir="ltr">
            {d.otherProjectCode}
          </span>
          {item(d.otherProjectId, d.other, 'xproj-other-item')}
        </span>
      ),
    },
    { key: 'finish', header: t('planning.xproj.theirFinish'), sortValue: (d) => d.other.finish, cell: (d) => <DateText value={d.other.finish} /> },
    ...common,
  ];
  const incomingColumns: Column<XDep>[] = [
    {
      key: 'dependent',
      header: t('planning.xproj.dependentItem'),
      isRowHeader: true,
      cell: (d) => (
        <span className="flex flex-col gap-0.5">
          <span className="text-xs font-semibold text-muted" dir="ltr">
            {d.projectCode}
          </span>
          {item(d.projectId, d.local)}
        </span>
      ),
    },
    { key: 'ours', header: t('planning.xproj.ourItemDependedOn'), cell: (d) => item(d.otherProjectId, d.other) },
    { key: 'finish', header: t('planning.xproj.ourFinish'), sortValue: (d) => d.other.finish, cell: (d) => <DateText value={d.other.finish} /> },
    ...common,
  ];

  return (
    <div className="space-y-4" data-testid="xproj-tab">
      <div className="flex flex-wrap items-end gap-3">
        <SearchInput className="w-full sm:w-64" label={t('planning.xproj.search')} value={q} onChange={setQ} />
        <FilterSelect label={t('planning.xproj.direction')} value={direction} onChange={(v) => setDirection(v as Direction)} className="w-full sm:w-56" testId="xproj-direction">
          <option value="">{t('planning.common.all')}</option>
          <option value="outgoing">{t('planning.xproj.outgoingShort')}</option>
          <option value="incoming">{t('planning.xproj.incomingShort')}</option>
        </FilterSelect>
        <FilterSelect label={t('planning.common.status')} value={status} onChange={setStatus} className="w-full sm:w-48">
          <option value="">{t('planning.common.allStatuses')}</option>
          {RAID_STATUSES.map((s) => (
            <option key={s} value={s}>
              {tStatus('raidStatuses', s)}
            </option>
          ))}
        </FilterSelect>
        {canCreate ? (
          <button type="button" className={cx(btn.primary, 'ms-auto')} onClick={() => setCreateOpen(true)} data-testid="xproj-create">
            <Plus aria-hidden="true" className="size-4" />
            {t('planning.xproj.create')}
          </button>
        ) : null}
      </div>
      <p className="text-xs text-muted">{t('planning.xproj.disclosure')}</p>

      {direction !== 'incoming' ? (
        <section aria-labelledby="xproj-outgoing" className="space-y-2">
          <h2 id="xproj-outgoing" className="text-lg font-semibold">
            {t('planning.xproj.outgoing')}
          </h2>
          <DataTable
            caption={t('planning.xproj.outgoing')}
            columns={outgoingColumns}
            rows={list.data ? outgoing : undefined}
            rowKey={(d) => d.id}
            isLoading={list.isLoading}
            error={list.error}
            onRetry={() => list.refetch()}
            emptyTitle={t('planning.xproj.emptyOutgoing')}
            emptyHint={t('planning.xproj.emptyHint')}
            clientPageSize={10}
            testId="xproj-outgoing"
          />
        </section>
      ) : null}
      {direction !== 'outgoing' ? (
        <section aria-labelledby="xproj-incoming" className="space-y-2">
          <h2 id="xproj-incoming" className="text-lg font-semibold">
            {t('planning.xproj.incoming')}
          </h2>
          <DataTable
            caption={t('planning.xproj.incoming')}
            columns={incomingColumns}
            rows={list.data ? incoming : undefined}
            rowKey={(d) => d.id}
            isLoading={list.isLoading}
            error={list.error}
            onRetry={() => list.refetch()}
            emptyTitle={t('planning.xproj.emptyIncoming')}
            emptyHint={t('planning.xproj.emptyHint')}
            clientPageSize={10}
            testId="xproj-incoming"
          />
        </section>
      ) : null}
      {list.data && list.data.total > PAGE ? <Pagination page={page} pageSize={PAGE} total={list.data.total} onPageChange={setPage} /> : null}

      {canCreate ? <CreateCrossProjectDialog open={createOpen} onClose={() => setCreateOpen(false)} /> : null}
      {closing ? (
        <ConfirmCommandDialog
          open
          onClose={() => setClosing(null)}
          title={t('planning.xproj.closeTitle', { code: closing.other.code })}
          confirmLabel={t('planning.xproj.close')}
          noteMode="required"
          noteLabel={t('planning.common.reason')}
          expectedVersion={closing.version}
          consequences={[t('planning.xproj.closeEffect'), t('common.command.audited')]}
          onReload={() => {
            void refresh();
            setClosing(null);
          }}
          onConfirm={async ({ note }) => {
            await api(P.closeCrossProjectDependency, { params: { projectId: closing.projectId, dependencyId: closing.id }, body: { expectedVersion: closing.version, reason: note } });
            await refresh();
            toast.show('success', t('planning.xproj.closed'));
            setClosing(null);
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * Record that this project depends on a task / milestone of ANOTHER project. Only projects whose plan the caller can read
 * are offered (the API re-checks and answers 404 otherwise); the item list comes from that project's own plan API.
 */
function CreateCrossProjectDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, locale } = useI18n();
  const { projectId, me } = useProjectContext();
  const refresh = useRefreshPlanning(projectId);
  const toast = useToast();
  const [f, setF] = useState({ otherProjectId: '', otherType: 'milestone' as 'task' | 'milestone', otherItemId: '', otherQ: '', localId: '', description: '', neededBy: '' });
  useEffect(() => {
    if (open) setF({ otherProjectId: '', otherType: 'milestone', otherItemId: '', otherQ: '', localId: '', description: '', neededBy: '' });
  }, [open]);
  const projects = useProjects({ page: 1, pageSize: 100 });
  const others = (projects.data?.items ?? []).filter((p) => p.id !== projectId && canInProject(me, p.id, 'planning.plan.read'));
  const sched = useSchedule(projectId, undefined, open);
  const localNodes = sched.data?.nodes ?? [];
  const otherQ = f.otherQ.trim();
  const otherItems = useQuery({
    queryKey: [...pk.all(projectId), 'xproj-other-items', f.otherProjectId, f.otherType, otherQ],
    enabled: open && !!f.otherProjectId,
    placeholderData: keepPreviousData,
    queryFn: async ({ signal }) => {
      if (f.otherType === 'task') {
        const r = await api(P.listTasks, { params: { projectId: f.otherProjectId }, query: { page: 1, pageSize: 50, q: otherQ || undefined }, signal });
        return r.items.map((x) => ({ id: x.id, code: x.wbsCode, title: x.title, titleAr: x.titleAr }));
      }
      const r = await api(P.listMilestones, { params: { projectId: f.otherProjectId }, query: { page: 1, pageSize: 50, q: otherQ || undefined }, signal });
      return r.items.map((x) => ({ id: x.id, code: x.code, title: x.title, titleAr: x.titleAr }));
    },
  });
  const local = localNodes.find((n) => n.id === f.localId);
  const otherLabel = useMemo(() => new Map((otherItems.data ?? []).map((i) => [i.id, `${i.code} — ${localized(locale, i.title, i.titleAr)}`])), [otherItems.data, locale]);
  return (
    <FormDialog
      open={open}
      onClose={onClose}
      size="lg"
      testId="xproj-form"
      title={t('planning.xproj.create')}
      submitLabel={t('planning.common.create')}
      disabled={!f.otherProjectId || !f.otherItemId || !f.description.trim()}
      onSubmit={async () => {
        await api(P.createCrossProjectDependency, {
          params: { projectId },
          body: {
            otherProjectId: f.otherProjectId,
            otherItemType: f.otherType,
            otherItemId: f.otherItemId,
            ...(local ? { localItemType: local.type, localItemId: local.id } : {}),
            description: f.description.trim(),
            ...(f.neededBy ? { neededBy: f.neededBy } : {}),
          },
        });
        toast.show('success', t('planning.xproj.created'));
        await refresh();
        onClose();
      }}
    >
      <p className="text-sm text-muted">{t('planning.xproj.createHint')}</p>
      {!projects.isLoading && others.length === 0 ? (
        <p role="note" className="rounded-md border border-warning/40 bg-warning-soft p-3 text-sm text-ink" data-testid="xproj-no-projects">
          {t('planning.xproj.noOtherProjects')}
        </p>
      ) : null}
      <SelectField label={t('planning.xproj.otherProject')} required value={f.otherProjectId} onChange={(e) => setF({ ...f, otherProjectId: e.target.value, otherItemId: '' })} data-testid="xproj-other-project">
        <option value="">{projects.isLoading ? t('planning.xproj.loading') : t('planning.common.choose')}</option>
        {others.map((p) => (
          <option key={p.id} value={p.id}>
            {p.code} — {p.name}
          </option>
        ))}
      </SelectField>
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField label={t('planning.xproj.otherItemType')} required value={f.otherType} onChange={(e) => setF({ ...f, otherType: e.target.value as 'task' | 'milestone', otherItemId: '' })} data-testid="xproj-other-type">
          <option value="milestone">{t('planning.xproj.itemTypes.milestone')}</option>
          <option value="task">{t('planning.xproj.itemTypes.task')}</option>
        </SelectField>
        <TextField label={t('planning.xproj.otherItemSearch')} value={f.otherQ} onChange={(e) => setF({ ...f, otherQ: e.target.value })} disabled={!f.otherProjectId} maxLength={200} />
      </div>
      <SelectField
        label={t('planning.xproj.otherItem')}
        required
        value={f.otherItemId}
        onChange={(e) => setF({ ...f, otherItemId: e.target.value })}
        disabled={!f.otherProjectId}
        hint={otherItems.error ? t('planning.xproj.otherItemsRestricted') : undefined}
        data-testid="xproj-other-item"
      >
        <option value="">{otherItems.isLoading ? t('planning.xproj.loading') : t('planning.common.choose')}</option>
        {(otherItems.data ?? []).map((i) => (
          <option key={i.id} value={i.id}>
            {otherLabel.get(i.id)}
          </option>
        ))}
      </SelectField>
      <SelectField label={t('planning.xproj.localItem')} value={f.localId} onChange={(e) => setF({ ...f, localId: e.target.value })} hint={t('planning.xproj.localItemHint')} data-testid="xproj-local-item">
        <option value="">{t('planning.xproj.wholeProject')}</option>
        {localNodes.map((n) => (
          <option key={n.id} value={n.id}>
            {n.code} — {localized(locale, n.title, n.titleAr)}
          </option>
        ))}
      </SelectField>
      <TextAreaField label={t('planning.xproj.description')} required value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} rows={2} maxLength={2000} />
      <TextField label={t('planning.xproj.neededBy')} type="date" value={f.neededBy} onChange={(e) => setF({ ...f, neededBy: e.target.value })} dir="ltr" hint={t('planning.xproj.neededByHint')} />
    </FormDialog>
  );
}
