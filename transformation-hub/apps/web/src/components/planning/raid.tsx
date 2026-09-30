'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { planningRoutes as P } from '@hub/contracts';
import { CHANGE_REQUEST_STATUSES, RAID_STATUSES } from '@hub/domain';
import { useI18n } from '@/i18n/provider';
import { api } from '@/lib/api';
import { changeRequestHref, pk, raidHref, useRefreshPlanning, type ChangeRequest, type RaidItem, type RaidKindPath } from '@/lib/planning';
import { useProjectContext } from '@/lib/project-context';
import { useWorkstreams } from '@/lib/queries';
import { workstreamName } from '@/lib/workstreams';
import { DataTable, type Column } from '../DataTable';
import { DemoBadge } from '../DemoBadge';
import { SelectField, TextAreaField, TextField } from '../Field';
import { SearchInput } from '../SearchInput';
import { StatusBadge } from '../StatusBadge';
import { useToast } from '../Toast';
import { btn, card, cx } from '../ui';
import { CodeLink, DateText, FilterSelect, FilterToggle } from './bits';
import { FormDialog } from './dialogs';
import { MoneyFields, MoneyText, moneyInputOf, parseMoney, type MoneyInput } from './money';

const PAGE = 20;
const KIND_OF: Record<RaidKindPath, 'risk' | 'issue' | 'assumption' | 'dependency'> = { risks: 'risk', issues: 'issue', assumptions: 'assumption', dependencies: 'dependency' };

function ratingTone(r: string | null): 'danger' | 'warning' | 'neutral' {
  return r === 'high' ? 'danger' : r === 'medium' ? 'warning' : 'neutral';
}

/** Risk heat map (probability × impact) over open risks — counts only, each cell labelled for screen readers. */
export function RiskHeatMap({ workstreamId }: { workstreamId?: string }) {
  const { t, formatNumber } = useI18n();
  const { projectId } = useProjectContext();
  const q = { page: 1, pageSize: 100, status: 'open,monitoring,escalated', workstreamId };
  const risks = useQuery({ queryKey: pk.raid(projectId, 'risks', { heat: true, ...q }), queryFn: ({ signal }) => api(P.listRaid, { params: { projectId, kind: 'risks' }, query: q, signal }) });
  const grid = useMemo(() => {
    const g = new Map<string, number>();
    for (const r of risks.data?.items ?? []) if (r.probability && r.impact) g.set(`${r.probability}-${r.impact}`, (g.get(`${r.probability}-${r.impact}`) ?? 0) + 1);
    return g;
  }, [risks.data]);
  const cls = (p: number, i: number) => (p * i >= 15 ? 'bg-danger-soft text-danger' : p * i >= 8 ? 'bg-warning-soft text-warning' : 'bg-success-soft text-success');
  return (
    <div className={cx(card, 'p-3')} data-testid="risk-heatmap">
      <p className="mb-2 text-sm font-semibold">{t('planning.raid.heatTitle')}</p>
      <table className="text-xs">
        <caption className="sr-only">{t('planning.raid.heatTitle')}</caption>
        <tbody>
          {[5, 4, 3, 2, 1].map((p) => (
            <tr key={p}>
              <th scope="row" className="pe-1 text-end font-normal text-muted">
                {p}
              </th>
              {[1, 2, 3, 4, 5].map((i) => {
                const n = grid.get(`${p}-${i}`) ?? 0;
                return (
                  <td key={i} className="p-0.5">
                    {/* aria-label is not allowed on a generic <span>: the visible count is hidden from assistive technology
                        and the full cell description is given as screen-reader text instead. */}
                    <span className={cx('flex size-8 items-center justify-center rounded font-semibold', cls(p, i), n === 0 && 'opacity-50')} aria-hidden="true">
                      {n ? formatNumber(n) : ''}
                    </span>
                    <span className="sr-only">{t('planning.raid.heatCell', { p, i, count: n })}</span>
                  </td>
                );
              })}
            </tr>
          ))}
          <tr>
            <td />
            {[1, 2, 3, 4, 5].map((i) => (
              <th key={i} scope="col" className="text-center font-normal text-muted">
                {i}
              </th>
            ))}
          </tr>
        </tbody>
      </table>
      <p className="mt-1 text-xs text-muted">{t('planning.raid.heatAxes')}</p>
    </div>
  );
}

export function RaidRegister({ kind, workstreamId: fixedWs }: { kind: RaidKindPath; workstreamId?: string }) {
  const { t, tStatus, locale } = useI18n();
  const { projectId, can } = useProjectContext();
  const ws = useWorkstreams(projectId);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [wsId, setWsId] = useState(fixedWs ?? '');
  const [overdue, setOverdue] = useState(false);
  const [mine, setMine] = useState(false);
  const [minScore, setMinScore] = useState('');
  const [page, setPage] = useState(1);
  const [create, setCreate] = useState(false);
  useEffect(() => setPage(1), [q, status, wsId, overdue, mine, minScore, kind]);
  const query = {
    page,
    pageSize: PAGE,
    q: q || undefined,
    status: status || undefined,
    workstreamId: wsId || undefined,
    overdue: overdue ? ('true' as const) : undefined,
    ownerUserId: mine ? 'me' : undefined,
    minScore: kind === 'risks' && minScore ? Number(minScore) : undefined,
    sort: kind === 'risks' ? ('-score' as const) : ('code' as const),
  };
  const list = useQuery({ queryKey: pk.raid(projectId, kind, query), queryFn: ({ signal }) => api(P.listRaid, { params: { projectId, kind }, query, signal }), placeholderData: keepPreviousData });
  const k = KIND_OF[kind];

  const columns: Column<RaidItem>[] = [
    { key: 'code', header: t('planning.common.code'), isRowHeader: true, cell: (r) => <CodeLink href={raidHref(projectId, kind, r.id)} code={r.code} title={r.title} /> },
    { key: 'status', header: t('planning.common.status'), cell: (r) => <span className="inline-flex flex-col gap-1"><StatusBadge enumName="raidStatuses" value={r.status} />{r.escalationLevel > 0 ? <span className="text-xs text-danger">{t('planning.raid.levelShort', { level: r.escalationLevel })}</span> : null}</span> },
    ...(k === 'risk'
      ? [{ key: 'score', header: t('planning.raid.score'), cell: (r: RaidItem) => <span className="inline-flex items-center gap-1.5"><span className="tabular text-xs text-muted">{r.probability}×{r.impact}=</span><StatusBadge enumName="ragStatuses" value={r.rating} tone={ratingTone(r.rating)} label={`${r.score} · ${t(`planning.raid.rating_${(r.rating ?? 'low') as 'low'}`)}`} /></span> }]
      : k === 'issue'
        ? [{ key: 'sev', header: t('planning.raid.severity'), cell: (r: RaidItem) => <span className={cx('tabular', r.blocking && 'font-semibold text-danger')}>{r.severity}{r.blocking ? ` · ${t('planning.raid.blocking')}` : ''}</span> }]
        : k === 'dependency'
          ? [{ key: 'on', header: t('planning.raid.dependsOn'), cell: (r: RaidItem) => <span dir="auto">{r.dependsOn}</span> }]
          : [{ key: 'ver', header: t('planning.raid.verification'), cell: (r: RaidItem) => <StatusBadge enumName="verificationStatuses" value={r.verificationStatus} /> }]),
    { key: 'ws', header: t('planning.common.workstream'), cell: (r) => <span dir="ltr">{r.workstreamCode ?? '—'}</span> },
    { key: 'owner', header: t('planning.common.owner'), cell: (r) => (r.ownerName ? <span dir="auto">{r.ownerName}</span> : <span className="text-muted">{t('planning.common.unassigned')}</span>) },
    { key: 'due', header: k === 'dependency' ? t('planning.raid.neededBy') : t('planning.common.due'), cell: (r) => <DateText value={k === 'dependency' ? (r.neededBy ?? r.dueDate) : r.dueDate} overdue={r.overdue} /> },
    { key: 'demo', header: t('common.table.demoColumn'), headerHidden: true, cell: (r) => (r.isDemo ? <DemoBadge /> : null) },
  ];

  return (
    <div className="space-y-3" data-testid={`raid-${kind}`}>
      <div className="flex flex-wrap items-end gap-3">
        <SearchInput className="w-full sm:w-64" label={t('planning.raid.search')} value={q} onChange={setQ} />
        <FilterSelect label={t('planning.common.status')} value={status} onChange={setStatus} className="w-full sm:w-44">
          <option value="">{t('planning.common.allStatuses')}</option>
          {RAID_STATUSES.map((s) => (
            <option key={s} value={s}>
              {tStatus('raidStatuses', s)}
            </option>
          ))}
        </FilterSelect>
        {!fixedWs ? (
          <FilterSelect label={t('planning.common.workstream')} value={wsId} onChange={setWsId} className="w-full sm:w-52">
            <option value="">{t('planning.common.allWorkstreams')}</option>
            {ws.data?.items.map((w) => (
              <option key={w.id} value={w.id}>
                {w.code} — {workstreamName(w, locale)}
              </option>
            ))}
          </FilterSelect>
        ) : null}
        {kind === 'risks' ? (
          <FilterSelect label={t('planning.raid.minScore')} value={minScore} onChange={setMinScore} className="w-full sm:w-40">
            <option value="">{t('planning.common.all')}</option>
            <option value="8">{t('planning.raid.minMedium')}</option>
            <option value="15">{t('planning.raid.minHigh')}</option>
          </FilterSelect>
        ) : null}
        <FilterToggle label={t('planning.common.onlyOverdue')} checked={overdue} onChange={setOverdue} />
        <FilterToggle label={t('planning.common.onlyMine')} checked={mine} onChange={setMine} />
        {can('planning.raid.manage') ? (
          <button type="button" className={cx(btn.primary, 'ms-auto')} onClick={() => setCreate(true)} data-testid={`raid-create-${kind}`}>
            <Plus aria-hidden="true" className="size-4" />
            {t(`planning.raid.create_${k}`)}
          </button>
        ) : null}
      </div>
      <DataTable
        caption={t(`planning.raid.tab_${kind}`)}
        columns={columns}
        rows={list.data?.items}
        rowKey={(r) => r.id}
        isLoading={list.isLoading}
        error={list.error}
        onRetry={() => list.refetch()}
        emptyTitle={t('planning.raid.empty')}
        pagination={list.data ? { page, pageSize: PAGE, total: list.data.total, onPageChange: setPage } : undefined}
        testId={`raid-table-${kind}`}
      />
      <RaidFormDialog open={create} onClose={() => setCreate(false)} kind={kind} defaultWs={wsId} />
    </div>
  );
}

/** Create or edit (descriptive fields only — status changes are commands) a RAID item of one kind. */
export function RaidFormDialog({ open, onClose, kind, item, defaultWs }: { open: boolean; onClose: () => void; kind: RaidKindPath; item?: RaidItem; defaultWs?: string }) {
  const { t, locale } = useI18n();
  const { projectId } = useProjectContext();
  const refresh = useRefreshPlanning(projectId);
  const toast = useToast();
  const ws = useWorkstreams(projectId, open && !item);
  const k = KIND_OF[kind];
  const blank = { workstreamId: '', title: '', description: '', dueDate: '', gateKey: '', probability: '3', impact: '3', trigger: '', response: '', responseStrategy: '', severity: '3', resolution: '', basis: '', validationPlan: '', dependsOn: '', neededBy: '' };
  const [f, setF] = useState(blank);
  useEffect(() => {
    if (!open) return;
    if (!item) return setF({ ...blank, workstreamId: defaultWs ?? '' });
    setF({
      workstreamId: item.workstreamId ?? '',
      title: item.title,
      description: item.description ?? '',
      dueDate: item.dueDate ?? '',
      gateKey: item.gateKey ?? '',
      probability: String(item.probability ?? 3),
      impact: String(item.impact ?? 3),
      trigger: item.trigger ?? '',
      response: item.response ?? '',
      responseStrategy: item.responseStrategy ?? '',
      severity: String(item.severity ?? 3),
      resolution: item.resolution ?? '',
      basis: item.basis ?? '',
      validationPlan: item.validationPlan ?? '',
      dependsOn: item.dependsOn ?? '',
      neededBy: item.neededBy ?? '',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, item, defaultWs]);
  const set = (key: keyof typeof blank) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [key]: e.target.value }));
  const nn = (s: string) => (s.trim() ? s.trim() : null);
  const valid = f.title.trim().length > 0 && (k !== 'dependency' || f.dependsOn.trim().length > 0);

  const submit = async () => {
    const common = { title: f.title.trim(), description: nn(f.description), dueDate: f.dueDate || null, gateKey: nn(f.gateKey) };
    if (item) {
      const params = { projectId, itemId: item.id };
      const v = { expectedVersion: item.version, ...common };
      if (k === 'risk') await api(P.updateRisk, { params, body: { ...v, probability: Number(f.probability), impact: Number(f.impact), trigger: nn(f.trigger), response: nn(f.response), responseStrategy: (f.responseStrategy || null) as 'mitigate' | null } });
      else if (k === 'issue') await api(P.updateIssue, { params, body: { ...v, severity: Number(f.severity), resolution: nn(f.resolution) } });
      else if (k === 'assumption') await api(P.updateAssumption, { params, body: { ...v, basis: nn(f.basis), validationPlan: nn(f.validationPlan) } });
      else await api(P.updateRaidDependency, { params, body: { ...v, dependsOn: f.dependsOn.trim(), neededBy: f.neededBy || null } });
      toast.show('success', t('planning.common.saved'));
    } else {
      const params = { projectId };
      const c = { workstreamId: f.workstreamId || undefined, title: f.title.trim(), description: f.description.trim() || undefined, dueDate: f.dueDate || undefined, gateKey: f.gateKey.trim() || undefined };
      let r: { code?: string };
      if (k === 'risk') r = await api(P.createRisk, { params, body: { ...c, probability: Number(f.probability), impact: Number(f.impact), trigger: f.trigger.trim() || undefined, response: f.response.trim() || undefined, responseStrategy: (f.responseStrategy || undefined) as 'mitigate' | undefined } });
      else if (k === 'issue') r = await api(P.createIssue, { params, body: { ...c, severity: Number(f.severity), resolution: f.resolution.trim() || undefined } });
      else if (k === 'assumption') r = await api(P.createAssumption, { params, body: { ...c, basis: f.basis.trim() || undefined, validationPlan: f.validationPlan.trim() || undefined } });
      else r = await api(P.createRaidDependency, { params, body: { ...c, dependsOn: f.dependsOn.trim(), neededBy: f.neededBy || undefined } });
      toast.show('success', t('planning.common.createdCode', { code: r.code ?? '' }));
    }
    await refresh();
    onClose();
  };

  const scale = (label: string, key: 'probability' | 'impact' | 'severity') => (
    <SelectField label={label} required value={f[key]} onChange={set(key)}>
      {[1, 2, 3, 4, 5].map((n) => (
        <option key={n} value={String(n)}>
          {n} — {t(`planning.raid.scale_${n as 1}`)}
        </option>
      ))}
    </SelectField>
  );

  return (
    <FormDialog open={open} onClose={onClose} size="lg" testId="raid-form" title={item ? t('planning.raid.editTitle', { code: item.code }) : t(`planning.raid.create_${k}`)} submitLabel={item ? t('common.actions.save') : t('planning.common.create')} disabled={!valid} onReload={() => void refresh()} onSubmit={submit}>
      {!item ? (
        <SelectField label={t('planning.common.workstream')} value={f.workstreamId} onChange={set('workstreamId')}>
          <option value="">{t('planning.common.none')}</option>
          {ws.data?.items.map((w) => (
            <option key={w.id} value={w.id}>
              {w.code} — {workstreamName(w, locale)}
            </option>
          ))}
        </SelectField>
      ) : null}
      <TextField label={t('planning.common.title')} required value={f.title} onChange={set('title')} maxLength={300} />
      <TextAreaField label={t('planning.task.description')} value={f.description} onChange={set('description')} rows={2} maxLength={4000} />
      {k === 'risk' ? (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            {scale(t('planning.raid.probability'), 'probability')}
            {scale(t('planning.raid.impact'), 'impact')}
            <SelectField label={t('planning.raid.strategy')} value={f.responseStrategy} onChange={set('responseStrategy')}>
              <option value="">{t('planning.common.none')}</option>
              {(['avoid', 'mitigate', 'transfer', 'accept'] as const).map((s) => (
                <option key={s} value={s}>
                  {t(`planning.raid.strategy_${s}`)}
                </option>
              ))}
            </SelectField>
          </div>
          <p className="text-xs text-muted">{t('planning.raid.scoreHint', { score: Number(f.probability) * Number(f.impact) })}</p>
          <TextAreaField label={t('planning.raid.trigger')} value={f.trigger} onChange={set('trigger')} rows={2} maxLength={2000} />
          <TextAreaField label={t('planning.raid.response')} value={f.response} onChange={set('response')} rows={2} maxLength={4000} />
        </>
      ) : null}
      {k === 'issue' ? (
        <>
          {scale(t('planning.raid.severity'), 'severity')}
          <p className="text-xs text-muted">{t('planning.raid.blockingRule')}</p>
          <TextAreaField label={t('planning.raid.resolution')} value={f.resolution} onChange={set('resolution')} rows={2} maxLength={4000} />
        </>
      ) : null}
      {k === 'assumption' ? (
        <>
          <TextAreaField label={t('planning.raid.basis')} value={f.basis} onChange={set('basis')} rows={2} maxLength={4000} />
          <TextAreaField label={t('planning.raid.validationPlan')} value={f.validationPlan} onChange={set('validationPlan')} rows={2} maxLength={4000} />
        </>
      ) : null}
      {k === 'dependency' ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label={t('planning.raid.dependsOn')} required value={f.dependsOn} onChange={set('dependsOn')} maxLength={1000} />
          <TextField label={t('planning.raid.neededBy')} type="date" value={f.neededBy} onChange={set('neededBy')} dir="ltr" />
        </div>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label={t('planning.common.due')} type="date" value={f.dueDate} onChange={set('dueDate')} dir="ltr" />
        <TextField label={t('planning.common.gate')} value={f.gateKey} onChange={set('gateKey')} dir="ltr" maxLength={16} />
      </div>
    </FormDialog>
  );
}

// =============================================================================================================
// Change requests

export function ChangeRequestsPanel() {
  const { t, tStatus, formatDateTime } = useI18n();
  const { projectId, can } = useProjectContext();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [create, setCreate] = useState(false);
  useEffect(() => setPage(1), [q, status]);
  const query = { page, pageSize: PAGE, q: q || undefined, status: status || undefined };
  const list = useQuery({ queryKey: pk.changeRequests(projectId, query), queryFn: ({ signal }) => api(P.listChangeRequests, { params: { projectId }, query, signal }), placeholderData: keepPreviousData });
  const columns: Column<ChangeRequest>[] = [
    { key: 'code', header: t('planning.common.code'), isRowHeader: true, cell: (c) => <CodeLink href={changeRequestHref(projectId, c.id)} code={c.code} title={c.title} /> },
    { key: 'status', header: t('planning.common.status'), cell: (c) => <StatusBadge enumName="changeRequestStatuses" value={c.status} /> },
    { key: 'rebaseline', header: t('planning.cr.rebaseline'), cell: (c) => (c.rebaseline ? t('planning.common.yes') : t('planning.common.no')) },
    { key: 'cost', header: t('planning.cr.costImpact'), cell: (c) => (c.costImpact ? <MoneyText value={c.costImpact} /> : c.impacts.cost ? <span className="text-xs text-warning">{t('planning.cr.costNotQuantifiedShort')}</span> : <span className="text-muted">—</span>) },
    { key: 'subject', header: t('planning.cr.subject'), cell: (c) => (c.subjectType ? <span dir="ltr" className="text-xs">{c.subjectType}</span> : '—') },
    { key: 'by', header: t('planning.cr.requestedBy'), cell: (c) => <span dir="auto">{c.requestedByName ?? '—'}</span> },
    { key: 'created', header: t('planning.baseline.createdAt'), cell: (c) => formatDateTime(c.createdAt) },
    { key: 'demo', header: t('common.table.demoColumn'), headerHidden: true, cell: (c) => (c.isDemo ? <DemoBadge /> : null) },
  ];
  return (
    <div className="space-y-3" data-testid="cr-panel">
      <div className="flex flex-wrap items-end gap-3">
        <SearchInput className="w-full sm:w-64" label={t('planning.cr.search')} value={q} onChange={setQ} />
        <FilterSelect label={t('planning.common.status')} value={status} onChange={setStatus} className="w-full sm:w-48">
          <option value="">{t('planning.common.allStatuses')}</option>
          {CHANGE_REQUEST_STATUSES.map((s) => (
            <option key={s} value={s}>
              {tStatus('changeRequestStatuses', s)}
            </option>
          ))}
        </FilterSelect>
        {can('planning.change_request.create') ? (
          <button type="button" className={cx(btn.primary, 'ms-auto')} onClick={() => setCreate(true)} data-testid="cr-create">
            <Plus aria-hidden="true" className="size-4" />
            {t('planning.cr.create')}
          </button>
        ) : null}
      </div>
      <p className="text-xs text-muted">{t('planning.cr.hint')}</p>
      <DataTable
        caption={t('planning.raid.tab_changes')}
        columns={columns}
        rows={list.data?.items}
        rowKey={(c) => c.id}
        isLoading={list.isLoading}
        error={list.error}
        onRetry={() => list.refetch()}
        emptyTitle={t('planning.cr.empty')}
        pagination={list.data ? { page, pageSize: PAGE, total: list.data.total, onPageChange: setPage } : undefined}
        testId="cr-table"
      />
      <ChangeRequestFormDialog open={create} onClose={() => setCreate(false)} />
    </div>
  );
}

export const IMPACT_KEYS = ['time', 'cost', 'scope', 'readiness', 'transaction', 'financial', 'tsa'] as const;
export type ImpactKey = (typeof IMPACT_KEYS)[number];

/** Create a change request (Draft) or edit a Draft: rationale, alternatives, impacts, re-baselining flag. */
export function ChangeRequestFormDialog({ open, onClose, cr }: { open: boolean; onClose: () => void; cr?: ChangeRequest }) {
  const { t } = useI18n();
  const { projectId } = useProjectContext();
  const refresh = useRefreshPlanning(projectId);
  const toast = useToast();
  const [f, setF] = useState({ title: '', rationale: '', alternatives: '', rebaseline: false, impacts: {} as Partial<Record<ImpactKey, string>> });
  const [cost, setCost] = useState<MoneyInput>(() => moneyInputOf(cr?.costImpact));
  useEffect(() => {
    if (!open) return;
    setF({ title: cr?.title ?? '', rationale: cr?.rationale ?? '', alternatives: (cr?.alternatives ?? []).join('\n'), rebaseline: cr?.rebaseline ?? false, impacts: { ...(cr?.impacts ?? {}) } });
    setCost(moneyInputOf(cr?.costImpact));
  }, [open, cr]);
  const money = parseMoney(cost);
  // Omitted = unchanged (edit) / none (create); emptying a recorded amount clears it.
  const costImpact = money === 'invalid' ? undefined : money === null ? (cr?.costImpact ? null : undefined) : money;
  const alts = f.alternatives.split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 10);
  const impacts = Object.fromEntries(Object.entries(f.impacts).filter(([, v]) => v && v.trim()).map(([k, v]) => [k, v!.trim()]));
  return (
    <FormDialog
      open={open}
      onClose={onClose}
      size="lg"
      testId="cr-form"
      title={cr ? t('planning.cr.editTitle', { code: cr.code }) : t('planning.cr.create')}
      submitLabel={cr ? t('common.actions.save') : t('planning.cr.saveDraft')}
      disabled={!f.title.trim() || !f.rationale.trim() || money === 'invalid'}
      onReload={() => void refresh()}
      onSubmit={async () => {
        if (cr) {
          await api(P.updateChangeRequest, {
            params: { projectId, changeRequestId: cr.id },
            body: { expectedVersion: cr.version, title: f.title.trim(), rationale: f.rationale.trim(), alternatives: alts, impacts, ...(costImpact !== undefined ? { costImpact } : {}), rebaseline: f.rebaseline },
          });
          toast.show('success', t('planning.common.saved'));
        } else {
          const r = await api(P.createChangeRequest, { params: { projectId }, body: { title: f.title.trim(), rationale: f.rationale.trim(), alternatives: alts, impacts, ...(costImpact ? { costImpact } : {}), rebaseline: f.rebaseline } });
          toast.show('success', t('planning.common.createdCode', { code: r.code ?? '' }));
        }
        await refresh();
        onClose();
      }}
    >
      <TextField label={t('planning.common.title')} required value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} maxLength={300} />
      <TextAreaField label={t('planning.cr.rationale')} required value={f.rationale} onChange={(e) => setF({ ...f, rationale: e.target.value })} rows={3} maxLength={4000} />
      <TextAreaField label={t('planning.cr.alternatives')} value={f.alternatives} onChange={(e) => setF({ ...f, alternatives: e.target.value })} rows={3} hint={t('planning.cr.alternativesHint')} />
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{t('planning.cr.impacts')}</legend>
        <p className="text-xs text-muted">{t('planning.cr.impactsHint')}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {IMPACT_KEYS.map((k) => (
            <TextAreaField key={k} label={t(`planning.cr.impact_${k}`)} value={f.impacts[k] ?? ''} onChange={(e) => setF({ ...f, impacts: { ...f.impacts, [k]: e.target.value } })} rows={2} maxLength={2000} />
          ))}
        </div>
      </fieldset>
      <MoneyFields legend={t('planning.cr.costImpact')} hint={t('planning.cr.costImpactHint')} value={cost} onChange={setCost} testId="cr-form-cost-impact" />
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-0.5 size-4" checked={f.rebaseline} onChange={(e) => setF({ ...f, rebaseline: e.target.checked })} />
        <span>
          {t('planning.cr.rebaseline')} — <span className="text-muted">{t('planning.cr.rebaselineHint')}</span>
        </span>
      </label>
    </FormDialog>
  );
}
