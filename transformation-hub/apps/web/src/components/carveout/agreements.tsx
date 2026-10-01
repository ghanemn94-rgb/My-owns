'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { carveoutRoutes as C } from '@hub/contracts';
import { AGREEMENT_LABEL_SUGGESTIONS, AGREEMENT_STAGES, type AgreementStage } from '@hub/domain';
import { EM_DASH, useI18n } from '@/i18n/provider';
import { api } from '@/lib/api';
import { agreementHref, ck, useRefreshCarveout, type AgreementSummary } from '@/lib/carveout';
import { useProjectContext } from '@/lib/project-context';
import { DataTable, type Column } from '../DataTable';
import { DemoBadge } from '../DemoBadge';
import { TextAreaField, TextField } from '../Field';
import { SearchInput } from '../SearchInput';
import { StatusBadge } from '../StatusBadge';
import { useToast } from '../Toast';
import { UserPicker, type PickedUser } from '../UserPicker';
import { btn, cx, hint } from '../ui';
import { CodeLink, DateText, FilterSelect } from '../planning/bits';
import { FormDialog } from '../planning/dialogs';
import { PersonText } from './bits';

/** REQ-AGR-001/002: agreements registered under the label found in the source; the expansion shows "Unconfirmed". */
export function AgreementsRegister() {
  const { t, tStatus } = useI18n();
  const { projectId, can } = useProjectContext();
  const [q, setQ] = useState('');
  const [stage, setStage] = useState('');
  const [page, setPage] = useState(1);
  const [create, setCreate] = useState(false);
  useEffect(() => setPage(1), [q, stage]);
  const query = { page, pageSize: 20, q: q || undefined, stage: (stage || undefined) as AgreementStage | undefined };
  const list = useQuery({ queryKey: ck.agreements(projectId, query), queryFn: ({ signal }) => api(C.listAgreements, { params: { projectId }, query, signal }), placeholderData: keepPreviousData });
  const columns: Column<AgreementSummary>[] = [
    { key: 'code', header: t('carveout.agreements.agreement'), isRowHeader: true, cell: (a) => <CodeLink href={agreementHref(projectId, a.id)} code={a.code} title={a.title} testId="agreement-link" /> },
    {
      key: 'label',
      header: t('carveout.agreements.label'),
      cell: (a) => (
        <span className="inline-flex flex-col">
          <span className="font-medium" dir="ltr">
            {a.kindLabel}
          </span>
          <span className={cx('text-xs', a.kindExpansionConfirmed ? 'text-ink' : 'text-warning')} dir="auto" data-testid="agreement-expansion">
            {a.kindExpansionConfirmed ? a.kindExpansionDisplay : t('carveout.agreements.unconfirmed')}
          </span>
        </span>
      ),
    },
    { key: 'stage', header: t('carveout.agreements.stage'), cell: (a) => <StatusBadge enumName="agreementStages" value={a.stage} /> },
    { key: 'owner', header: t('carveout.common.owner'), cell: (a) => <PersonText person={a.owner} /> },
    { key: 'reviewer', header: t('carveout.agreements.legalReviewer'), cell: (a) => <PersonText person={a.legalReviewer} /> },
    { key: 'draft', header: t('carveout.agreements.draft'), cell: (a) => <span dir="ltr">{a.currentDraftVersion ?? EM_DASH}</span> },
    { key: 'signed', header: t('carveout.agreements.signingDate'), cell: (a) => <DateText value={a.signingDate} /> },
    { key: 'cls', header: t('carveout.common.classification'), cell: (a) => tStatus('classifications', a.classification) },
    { key: 'demo', header: t('common.table.demoColumn'), headerHidden: true, cell: (a) => (a.isDemo ? <DemoBadge /> : null) },
  ];
  return (
    <div className="space-y-3" data-testid="agreements">
      <div className="flex flex-wrap items-end gap-3">
        <SearchInput className="w-full sm:w-64" label={t('carveout.agreements.search')} value={q} onChange={setQ} />
        <FilterSelect label={t('carveout.agreements.stage')} value={stage} onChange={setStage} className="w-full sm:w-48">
          <option value="">{t('carveout.common.all')}</option>
          {AGREEMENT_STAGES.map((s) => (
            <option key={s} value={s}>
              {tStatus('agreementStages', s)}
            </option>
          ))}
        </FilterSelect>
        {can('carveout.agreement.manage') ? (
          <button type="button" className={cx(btn.primary, 'ms-auto')} onClick={() => setCreate(true)} data-testid="agreement-create">
            <Plus aria-hidden="true" className="size-4" />
            {t('carveout.agreements.add')}
          </button>
        ) : null}
      </div>
      <p className="text-sm text-muted">{t('carveout.agreements.explain')}</p>
      <DataTable
        caption={t('carveout.tabs.agreements')}
        columns={columns}
        rows={list.data?.items}
        rowKey={(a) => a.id}
        isLoading={list.isLoading}
        error={list.error}
        onRetry={() => list.refetch()}
        emptyTitle={t('carveout.agreements.empty')}
        pagination={list.data && list.data.total > 20 ? { page, pageSize: 20, total: list.data.total, onPageChange: setPage } : undefined}
      />
      <CreateAgreementDialog open={create} onClose={() => setCreate(false)} />
    </div>
  );
}

function CreateAgreementDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const { projectId } = useProjectContext();
  const router = useRouter();
  const refresh = useRefreshCarveout(projectId);
  const toast = useToast();
  const [f, setF] = useState({ kindLabel: '', kindExpansionProposed: '', title: '', scope: '', parties: '' });
  const [owner, setOwner] = useState<PickedUser | null>(null);
  const [reviewer, setReviewer] = useState<PickedUser | null>(null);
  useEffect(() => {
    if (open) {
      setF({ kindLabel: '', kindExpansionProposed: '', title: '', scope: '', parties: '' });
      setOwner(null);
      setReviewer(null);
    }
  }, [open]);
  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title={t('carveout.agreements.add')}
      submitLabel={t('carveout.agreements.add')}
      disabled={!f.kindLabel.trim() || !f.title.trim()}
      testId="agreement-form"
      onSubmit={async () => {
        const parties = f.parties
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean)
          .map((name) => ({ name }));
        const r = await api(C.createAgreement, {
          params: { projectId },
          body: { kindLabel: f.kindLabel.trim(), kindExpansionProposed: f.kindExpansionProposed.trim() || undefined, title: f.title.trim(), scope: f.scope.trim() || undefined, parties, ownerUserId: owner?.id, legalReviewerUserId: reviewer?.id },
        });
        await refresh();
        toast.show('success', t('carveout.agreements.created', { code: r.code }));
        onClose();
        router.push(agreementHref(projectId, r.id));
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <TextField label={t('carveout.agreements.label')} required list="agreement-labels" dir="ltr" value={f.kindLabel} maxLength={64} onChange={(e) => setF({ ...f, kindLabel: e.target.value })} />
          <datalist id="agreement-labels">
            {AGREEMENT_LABEL_SUGGESTIONS.map((l) => (
              <option key={l} value={l} />
            ))}
          </datalist>
        </div>
        <TextField label={t('carveout.agreements.expansionProposed')} hint={t('carveout.agreements.expansionHint')} value={f.kindExpansionProposed} maxLength={300} onChange={(e) => setF({ ...f, kindExpansionProposed: e.target.value })} />
      </div>
      <TextField label={t('carveout.agreements.title')} required value={f.title} maxLength={300} onChange={(e) => setF({ ...f, title: e.target.value })} />
      <TextAreaField label={t('carveout.agreements.scope')} rows={2} value={f.scope} maxLength={4000} onChange={(e) => setF({ ...f, scope: e.target.value })} />
      <TextAreaField label={t('carveout.agreements.parties')} hint={t('carveout.agreements.partiesHint')} rows={3} value={f.parties} onChange={(e) => setF({ ...f, parties: e.target.value })} />
      <div className="grid gap-3 sm:grid-cols-2">
        <UserPicker label={t('carveout.common.owner')} value={owner} onChange={setOwner} />
        <UserPicker label={t('carveout.agreements.legalReviewer')} value={reviewer} onChange={setReviewer} />
      </div>
      <p className={hint}>{t('carveout.agreements.createHint')}</p>
    </FormDialog>
  );
}
