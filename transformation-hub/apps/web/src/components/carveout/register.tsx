'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { GitPullRequestArrow, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { carveoutRoutes as C, newcoRoutes as N } from '@hub/contracts';
import { PERIMETER_DISPOSITIONS, PERIMETER_ITEM_TYPES, type PerimeterDisposition, type PerimeterItemType } from '@hub/domain';
import { EM_DASH, useI18n } from '@/i18n/provider';
import { api } from '@/lib/api';
import { changeRequestHref, ck, itemHref, useRefreshCarveout, type PerimeterItem } from '@/lib/carveout';
import { useProjectContext } from '@/lib/project-context';
import { useWorkstreams } from '@/lib/queries';
import { workstreamName } from '@/lib/workstreams';
import { DataTable, type Column } from '../DataTable';
import { DemoBadge } from '../DemoBadge';
import { SelectField, TextAreaField, TextField } from '../Field';
import { SearchInput } from '../SearchInput';
import { StatusBadge } from '../StatusBadge';
import { useToast } from '../Toast';
import { UserPicker, type PickedUser } from '../UserPicker';
import { btn, cx, hint } from '../ui';
import { CodeLink, FilterSelect } from '../planning/bits';
import { FormDialog } from '../planning/dialogs';
import { PersonText, TransferView } from './bits';

const PAGE = 20;

/** Initial filters come from the URL (reconciliation metrics and the sites tab deep-link into the register). */
export function PerimeterRegister({ initial = {} }: { initial?: { type?: string; disposition?: string; siteId?: string } }) {
  const { t, tStatus, locale } = useI18n();
  const { projectId, can } = useProjectContext();
  const ws = useWorkstreams(projectId);
  const sites = useQuery({ queryKey: ck.sites(projectId), queryFn: ({ signal }) => api(C.listSites, { params: { projectId }, signal }) });
  const [q, setQ] = useState('');
  const [type, setType] = useState((PERIMETER_ITEM_TYPES as readonly string[]).includes(initial.type ?? '') ? initial.type! : '');
  const [disposition, setDisposition] = useState((PERIMETER_DISPOSITIONS as readonly string[]).includes(initial.disposition ?? '') ? initial.disposition! : '');
  const [siteId, setSiteId] = useState(initial.siteId ?? '');
  const [wsId, setWsId] = useState('');
  const [page, setPage] = useState(1);
  const [create, setCreate] = useState(false);
  useEffect(() => setPage(1), [q, type, disposition, siteId, wsId]);
  const query = {
    page,
    pageSize: PAGE,
    q: q || undefined,
    type: (type || undefined) as PerimeterItemType | undefined,
    disposition: (disposition || undefined) as PerimeterDisposition | undefined,
    siteId: siteId || undefined,
    workstreamId: wsId || undefined,
  };
  const list = useQuery({ queryKey: ck.items(projectId, query), queryFn: ({ signal }) => api(C.listPerimeterItems, { params: { projectId }, query, signal }), placeholderData: keepPreviousData });

  const columns: Column<PerimeterItem>[] = [
    { key: 'code', header: t('carveout.common.item'), isRowHeader: true, sortValue: (r) => r.code, cell: (r) => <CodeLink href={itemHref(projectId, r.id)} code={r.code} title={r.name} testId="perimeter-item-link" /> },
    { key: 'type', header: t('carveout.item.type'), sortValue: (r) => tStatus('perimeterItemTypes', r.type), cell: (r) => tStatus('perimeterItemTypes', r.type) },
    { key: 'disposition', header: t('carveout.item.disposition'), cell: (r) => <StatusBadge enumName="perimeterDispositions" value={r.disposition} /> },
    { key: 'transfer', header: t('carveout.item.transfer'), cell: (r) => <TransferView transfer={r.transfer} compact /> },
    { key: 'site', header: t('carveout.item.site'), cell: (r) => <span dir="ltr">{r.siteCode ?? EM_DASH}</span> },
    { key: 'ws', header: t('carveout.common.workstream'), cell: (r) => <span dir="ltr">{r.workstreamCode ?? EM_DASH}</span> },
    { key: 'owner', header: t('carveout.common.owner'), cell: (r) => <PersonText person={r.owner} /> },
    {
      key: 'change',
      header: t('carveout.item.changeControl'),
      cell: (r) =>
        r.pendingChange ? (
          <Link href={changeRequestHref(projectId, r.pendingChange.id)} className={cx(btn.link, 'inline-flex items-center gap-1 text-sm')} data-testid="pending-change-link">
            <GitPullRequestArrow aria-hidden="true" className="size-4" />
            <span dir="ltr">{r.pendingChange.code}</span>
            <StatusBadge enumName="changeRequestStatuses" value={r.pendingChange.status} />
          </Link>
        ) : r.inApprovedBaseline ? (
          <span className="text-xs text-muted">{t('carveout.item.inBaseline')}</span>
        ) : (
          <span className="text-xs text-muted">{EM_DASH}</span>
        ),
    },
    { key: 'demo', header: '', cell: (r) => (r.isDemo ? <DemoBadge /> : null) },
  ];

  return (
    <div className="space-y-3" data-testid="perimeter-register">
      <div className="flex flex-wrap items-end gap-3">
        <SearchInput className="w-full sm:w-64" label={t('carveout.register.search')} value={q} onChange={setQ} />
        <FilterSelect label={t('carveout.item.type')} value={type} onChange={setType} className="w-full sm:w-44" testId="filter-type">
          <option value="">{t('carveout.common.all')}</option>
          {PERIMETER_ITEM_TYPES.map((v) => (
            <option key={v} value={v}>
              {tStatus('perimeterItemTypes', v)}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect label={t('carveout.item.disposition')} value={disposition} onChange={setDisposition} className="w-full sm:w-40" testId="filter-disposition">
          <option value="">{t('carveout.common.all')}</option>
          {PERIMETER_DISPOSITIONS.map((v) => (
            <option key={v} value={v}>
              {tStatus('perimeterDispositions', v)}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect label={t('carveout.item.site')} value={siteId} onChange={setSiteId} className="w-full sm:w-44" testId="filter-site">
          <option value="">{t('carveout.common.all')}</option>
          {sites.data?.items.map((s) => (
            <option key={s.id} value={s.id}>
              {s.code} — {s.name}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect label={t('carveout.common.workstream')} value={wsId} onChange={setWsId} className="w-full sm:w-52">
          <option value="">{t('carveout.common.all')}</option>
          {ws.data?.items.map((w) => (
            <option key={w.id} value={w.id}>
              {w.code} — {workstreamName(w, locale)}
            </option>
          ))}
        </FilterSelect>
        {can('carveout.perimeter.manage') ? (
          <button type="button" className={cx(btn.primary, 'ms-auto')} onClick={() => setCreate(true)} data-testid="perimeter-create">
            <Plus aria-hidden="true" className="size-4" />
            {t('carveout.register.add')}
          </button>
        ) : null}
      </div>
      <DataTable
        caption={t('carveout.tabs.register')}
        columns={columns}
        rows={list.data?.items}
        rowKey={(r) => r.id}
        isLoading={list.isLoading}
        error={list.error}
        onRetry={() => list.refetch()}
        emptyTitle={t('carveout.register.empty')}
        emptyHint={t('carveout.register.emptyHint')}
        pagination={list.data ? { page, pageSize: PAGE, total: list.data.total, onPageChange: setPage } : undefined}
        testId="perimeter-table"
      />
      <CreateItemDialog open={create} onClose={() => setCreate(false)} />
    </div>
  );
}

/** Add a perimeter item. After baseline approval the server holds it Pending and raises a change request (AT-07). */
function CreateItemDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, tStatus, locale } = useI18n();
  const { projectId, can } = useProjectContext();
  const router = useRouter();
  const toast = useToast();
  const refresh = useRefreshCarveout(projectId);
  const ws = useWorkstreams(projectId, open);
  const sites = useQuery({ queryKey: ck.sites(projectId), enabled: open, queryFn: ({ signal }) => api(C.listSites, { params: { projectId }, signal }) });
  const canEntities = can('newco.register.read');
  const entities = useQuery({ queryKey: ck.entities(projectId), enabled: open && canEntities, queryFn: ({ signal }) => api(N.listLegalEntities, { params: { projectId }, signal }) });
  const blank = { type: 'asset' as PerimeterItemType, name: '', description: '', disposition: 'pending' as PerimeterDisposition, siteId: '', workstreamId: '', currentEntityId: '', targetEntityId: '', legalOwner: '', operator: '', economicBeneficiary: '', transferMechanism: '', plannedEffectiveDate: '', economicPlannedEffectiveDate: '', consentRequired: false, justification: '', resolutionPath: '', targetGateKey: '' };
  const [f, setF] = useState(blank);
  const [owner, setOwner] = useState<PickedUser | null>(null);
  useEffect(() => {
    if (open) {
      setF(blank);
      setOwner(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const set = (k: keyof typeof blank) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const opt = (s: string) => (s.trim() ? s.trim() : undefined);
  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title={t('carveout.register.addTitle')}
      submitLabel={t('carveout.register.addSubmit')}
      disabled={!f.name.trim()}
      size="lg"
      testId="perimeter-create-form"
      onSubmit={async () => {
        const r = await api(C.createPerimeterItem, {
          params: { projectId },
          body: {
            type: f.type,
            name: f.name.trim(),
            description: opt(f.description),
            disposition: f.disposition,
            siteId: opt(f.siteId),
            workstreamId: opt(f.workstreamId),
            ownerUserId: owner?.id,
            currentEntityId: opt(f.currentEntityId),
            targetEntityId: opt(f.targetEntityId),
            legalOwner: opt(f.legalOwner),
            operator: opt(f.operator),
            economicBeneficiary: opt(f.economicBeneficiary),
            transferMechanism: opt(f.transferMechanism),
            plannedEffectiveDate: opt(f.plannedEffectiveDate),
            economicPlannedEffectiveDate: opt(f.economicPlannedEffectiveDate),
            consentRequired: f.consentRequired,
            resolutionPath: opt(f.resolutionPath),
            targetGateKey: opt(f.targetGateKey),
            justification: opt(f.justification),
          },
        });
        await refresh();
        toast.show('success', r.changeRequest ? t('carveout.scope.heldForChange', { code: r.changeRequest.code }) : t('carveout.register.added', { code: r.code }));
        onClose();
        router.push(itemHref(projectId, r.id));
      }}
    >
      <p className={hint}>{t('carveout.register.addHint')}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField label={t('carveout.item.type')} required value={f.type} onChange={set('type')}>
          {PERIMETER_ITEM_TYPES.map((v) => (
            <option key={v} value={v}>
              {tStatus('perimeterItemTypes', v)}
            </option>
          ))}
        </SelectField>
        <SelectField label={t('carveout.item.requestedDisposition')} required value={f.disposition} onChange={set('disposition')}>
          {PERIMETER_DISPOSITIONS.map((v) => (
            <option key={v} value={v}>
              {tStatus('perimeterDispositions', v)}
            </option>
          ))}
        </SelectField>
      </div>
      <TextField label={t('carveout.item.name')} required value={f.name} maxLength={300} onChange={set('name')} />
      <TextAreaField label={t('carveout.item.description')} rows={2} value={f.description} maxLength={4000} onChange={set('description')} />
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField label={t('carveout.item.site')} value={f.siteId} onChange={set('siteId')}>
          <option value="">{EM_DASH}</option>
          {sites.data?.items.map((s) => (
            <option key={s.id} value={s.id}>
              {s.code} — {s.name}
            </option>
          ))}
        </SelectField>
        <SelectField label={t('carveout.common.workstream')} value={f.workstreamId} onChange={set('workstreamId')}>
          <option value="">{EM_DASH}</option>
          {ws.data?.items.map((w) => (
            <option key={w.id} value={w.id}>
              {w.code} — {workstreamName(w, locale)}
            </option>
          ))}
        </SelectField>
      </div>
      <UserPicker label={t('carveout.item.accountableOwner')} value={owner} onChange={setOwner} />
      {canEntities ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField label={t('carveout.item.currentEntity')} value={f.currentEntityId} onChange={set('currentEntityId')}>
            <option value="">{EM_DASH}</option>
            {entities.data?.items.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </SelectField>
          <SelectField label={t('carveout.item.targetEntity')} value={f.targetEntityId} onChange={set('targetEntityId')}>
            <option value="">{EM_DASH}</option>
            {entities.data?.items.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </SelectField>
        </div>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-3">
        <TextField label={t('carveout.item.legalOwner')} value={f.legalOwner} maxLength={300} onChange={set('legalOwner')} />
        <TextField label={t('carveout.item.operator')} value={f.operator} maxLength={300} onChange={set('operator')} />
        <TextField label={t('carveout.item.economicBeneficiary')} value={f.economicBeneficiary} maxLength={300} onChange={set('economicBeneficiary')} />
      </div>
      <TextField label={t('carveout.item.mechanism')} value={f.transferMechanism} maxLength={1000} onChange={set('transferMechanism')} />
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label={t('carveout.item.plannedLegal')} type="date" dir="ltr" value={f.plannedEffectiveDate} onChange={set('plannedEffectiveDate')} />
        <TextField label={t('carveout.item.plannedEconomic')} type="date" dir="ltr" value={f.economicPlannedEffectiveDate} onChange={set('economicPlannedEffectiveDate')} />
      </div>
      {f.disposition === 'pending' ? (
        <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
          <TextField label={t('carveout.item.resolutionPath')} value={f.resolutionPath} maxLength={2000} onChange={set('resolutionPath')} />
          <TextField label={t('carveout.item.targetGate')} dir="ltr" placeholder="G1" value={f.targetGateKey} maxLength={3} onChange={set('targetGateKey')} />
        </div>
      ) : null}
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="size-4" checked={f.consentRequired} onChange={(e) => setF((x) => ({ ...x, consentRequired: e.target.checked }))} />
        {t('carveout.item.consentRequired')}
      </label>
      <TextAreaField label={t('carveout.scope.justification')} hint={t('carveout.scope.justificationAddHint')} rows={2} value={f.justification} maxLength={2000} onChange={set('justification')} />
    </FormDialog>
  );
}
