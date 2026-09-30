'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { jvRoutes } from '@hub/contracts';
import type { Classification } from '@hub/domain';
import { DataTable, type Column } from '@/components/DataTable';
import { DemoBadge } from '@/components/DemoBadge';
import { SelectField, TextField } from '@/components/Field';
import { PageHeader } from '@/components/PageHeader';
import { SearchInput } from '@/components/SearchInput';
import { StatusBadge } from '@/components/StatusBadge';
import { useToast } from '@/components/Toast';
import { btn } from '@/components/ui';
import { useI18n } from '@/i18n/provider';
import { api } from '@/lib/api';
import { assignableClassifications } from '@/lib/documents';
import { jvHref, useJvRefresh, usePartnerNames, useScenarios, type Scenario } from '@/lib/jv';
import { useProjectContext } from '@/lib/project-context';
import { Callout, FilterBar, FilterSelect, JvCommandDialog, useUrlState } from '../_components/jv';
import { ContributionEditor, OwnershipEditor, OwnershipSummary, TermsFields, VersionText, contributionBody, emptyOwnership, ownershipBody, type ContributionDraft, type OwnershipDraft } from '../_components/scenario-form';

const PAGE_SIZE = 25;
const FILTERS = ['q', 'partnerId'] as const;

function CreateScenarioDialog({ onClose }: { onClose: () => void }) {
  const { t, tStatus } = useI18n();
  const { projectId, me } = useProjectContext();
  const refresh = useJvRefresh();
  const toast = useToast();
  const partners = usePartnerNames();
  const options = assignableClassifications(me.user.clearance as Classification);
  const [name, setName] = useState('');
  const [partnerId, setPartnerId] = useState('');
  const [label, setLabel] = useState('');
  const [ownership, setOwnership] = useState<OwnershipDraft[]>([emptyOwnership()]);
  const [contributions, setContributions] = useState<ContributionDraft[]>([]);
  const [governance, setGovernance] = useState('');
  const [assumptions, setAssumptions] = useState('');
  const [classification, setClassification] = useState<Classification>(options.includes('confidential') ? 'confidential' : options[options.length - 1]!);
  return (
    <JvCommandDialog
      open
      onClose={onClose}
      title={t('jv.scenarios.create.title')}
      confirmLabel={t('jv.scenarios.create.confirm')}
      noteMode="none"
      confirmDisabled={!name.trim()}
      consequences={[t('jv.scenarios.create.effect'), t('jv.scenarios.noDefaults'), t('common.command.audited')]}
      onConfirm={async () => {
        const r = await api(jvRoutes.createScenario, {
          params: { projectId },
          body: {
            name: name.trim(),
            classification,
            ownership: ownershipBody(ownership),
            contributions: contributionBody(contributions),
            ...(partnerId ? { partnerId } : {}),
            ...(label.trim() ? { versionLabel: label.trim() } : {}),
            ...(governance.trim() ? { governanceTerms: governance.trim() } : {}),
            ...(assumptions.trim() ? { assumptions: assumptions.trim() } : {}),
          },
        });
        await refresh();
        toast.show('success', t('jv.scenarios.create.done', { code: r.code ?? '' }));
        onClose();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField className="sm:col-span-2" label={t('jv.scenarios.fields.name')} required value={name} maxLength={200} onChange={(e) => setName(e.target.value)} data-testid="scenario-name" />
        <SelectField label={t('jv.common.partner')} value={partnerId} onChange={(e) => setPartnerId(e.target.value)}>
          <option value="">{t('jv.common.none')}</option>
          {partners.items.map((p) => (
            <option key={p.id} value={p.id}>
              {p.code} — {p.name}
            </option>
          ))}
        </SelectField>
        <TextField label={t('jv.scenarios.fields.versionLabel')} value={label} maxLength={32} onChange={(e) => setLabel(e.target.value)} />
        <SelectField label={t('jv.common.classification')} required value={classification} onChange={(e) => setClassification(e.target.value as Classification)}>
          {options.map((c) => (
            <option key={c} value={c}>
              {tStatus('classifications', c)}
            </option>
          ))}
        </SelectField>
      </div>
      <OwnershipEditor rows={ownership} onChange={setOwnership} />
      <ContributionEditor rows={contributions} onChange={setContributions} />
      <TermsFields governance={governance} assumptions={assumptions} onGovernance={setGovernance} onAssumptions={setAssumptions} />
    </JvCommandDialog>
  );
}

/** Ownership / contribution / governance scenarios (REQ-JV-007): versioned, proposed, and never pre-filled. */
export default function ScenariosPage() {
  const { t, formatDateTime } = useI18n();
  const { projectId, can } = useProjectContext();
  const { values, page, set, clear, active } = useUrlState(FILTERS);
  const partners = usePartnerNames();
  const [createOpen, setCreateOpen] = useState(false);
  const base = jvHref(projectId);
  const list = useScenarios({ page, pageSize: PAGE_SIZE, q: values.q || undefined, partnerId: values.partnerId || undefined });
  const columns: Column<Scenario>[] = [
    {
      key: 'name',
      header: t('jv.scenarios.fields.name'),
      isRowHeader: true,
      sortValue: (s) => s.name,
      cell: (s) => (
        <span className="flex flex-wrap items-center gap-1">
          {s.code ? <span className="text-xs text-muted" dir="ltr">{s.code}</span> : null}
          <Link className={btn.link} href={`${base}/scenarios/${s.id}`} data-testid="scenario-link">
            <span dir="auto">{s.name}</span>
          </Link>
          {s.isDemo ? <DemoBadge /> : null}
        </span>
      ),
    },
    { key: 'partner', header: t('jv.common.partner'), cell: (s) => <span dir="auto">{partners.label(s.partnerId) ?? t('jv.common.none')}</span> },
    { key: 'version', header: t('jv.scenarios.fields.version'), sortValue: (s) => s.versionNo, cell: (s) => <VersionText no={s.versionNo} label={s.versionLabel} /> },
    { key: 'ownership', header: t('jv.scenarios.ownership'), cell: (s) => <OwnershipSummary s={s} /> },
    { key: 'state', header: t('jv.scenarios.fields.state'), cell: (s) => <StatusBadge enumName="approvalStates" value={s.approvalState} /> },
    { key: 'updated', header: t('jv.common.updated'), sortValue: (s) => s.updatedAt, cell: (s) => <span className="tabular">{formatDateTime(s.updatedAt)}</span> },
  ];
  return (
    <>
      <PageHeader
        title={t('jv.scenarios.title')}
        description={t('jv.scenarios.subtitle')}
        actions={
          can('jv.scenario.manage') ? (
            <button type="button" className={btn.primary} onClick={() => setCreateOpen(true)} data-testid="create-scenario">
              <Plus aria-hidden="true" className="size-4" />
              {t('jv.scenarios.create.action')}
            </button>
          ) : null
        }
      />
      <div className="space-y-4">
        <Callout tone="warning" testId="no-default-percentages">
          {t('jv.scenarios.noDefaults')}
        </Callout>
        <FilterBar onClear={clear} active={active}>
          <SearchInput className="w-full sm:w-64" label={t('jv.scenarios.search')} value={values.q} onChange={(v) => set({ q: v })} />
          <FilterSelect label={t('jv.common.partner')} value={values.partnerId} onChange={(v) => set({ partnerId: v })} options={partners.items.map((p) => ({ value: p.id, label: `${p.code} — ${p.name}` }))} />
        </FilterBar>
        <DataTable
          caption={t('jv.scenarios.title')}
          columns={columns}
          rows={list.data?.items}
          rowKey={(s) => s.id}
          isLoading={list.isLoading}
          error={list.error}
          onRetry={() => list.refetch()}
          emptyTitle={active ? t('jv.common.emptySearch') : t('jv.scenarios.empty')}
          pagination={list.data ? { page, pageSize: PAGE_SIZE, total: list.data.total, onPageChange: (p) => set({ page: p }) } : undefined}
          testId="scenarios-table"
        />
      </div>
      {createOpen ? <CreateScenarioDialog onClose={() => setCreateOpen(false)} /> : null}
    </>
  );
}
