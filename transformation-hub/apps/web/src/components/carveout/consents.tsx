'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { MessageSquareReply, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { carveoutRoutes as C, CONSENT_KINDS } from '@hub/contracts';
import { CONSENT_STATUSES, type ConsentStatus } from '@hub/domain';
import { EM_DASH, useI18n, type MessageKey } from '@/i18n/provider';
import { api } from '@/lib/api';
import { ck, itemHref, localToday, useRefreshCarveout, type Consent } from '@/lib/carveout';
import { useProjectContext } from '@/lib/project-context';
import { ConfirmCommandDialog } from '../ConfirmCommandDialog';
import { DataTable, type Column } from '../DataTable';
import { DemoBadge } from '../DemoBadge';
import { SelectField, TextAreaField, TextField } from '../Field';
import { SearchInput } from '../SearchInput';
import { StatusBadge } from '../StatusBadge';
import { useToast } from '../Toast';
import { UserPicker, type PickedUser } from '../UserPicker';
import { btn, cx } from '../ui';
import { CodeLink, DateText, FilterSelect } from '../planning/bits';
import { FormDialog } from '../planning/dialogs';
import { PersonText } from './bits';

type ConsentKind = (typeof CONSENT_KINDS)[number];
/** `other` is a reserved plural key in the catalogue, so that label lives under `otherKind`. */
const consentKindLabel = (t: (k: MessageKey) => string, k: ConsentKind) => t(`carveout.consents.kinds.${k === 'other' ? 'otherKind' : k}`);
type Response = 'requested' | 'granted' | 'conditional' | 'refused' | 'not_required';
/** Responses the state machine allows from each status (the server re-checks; "not required" needs a specialist). */
const NEXT: Record<ConsentStatus, Response[]> = {
  not_requested: ['requested', 'not_required'],
  requested: ['granted', 'conditional', 'refused', 'not_required'],
  conditional: ['granted', 'refused'],
  refused: ['requested'],
  granted: [],
  not_required: [],
};

export function ConsentsRegister({ perimeterItemId }: { perimeterItemId?: string }) {
  const { t, tStatus } = useI18n();
  const { projectId, can } = useProjectContext();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [create, setCreate] = useState(false);
  const [respond, setRespond] = useState<Consent | null>(null);
  useEffect(() => setPage(1), [q, status]);
  const query = { page, pageSize: 20, q: q || undefined, status: (status || undefined) as ConsentStatus | undefined, perimeterItemId };
  const list = useQuery({ queryKey: ck.consents(projectId, query), queryFn: ({ signal }) => api(C.listConsents, { params: { projectId }, query, signal }), placeholderData: keepPreviousData });
  const canManage = can('carveout.consent.manage');
  const columns: Column<Consent>[] = [
    { key: 'code', header: t('carveout.consents.code'), isRowHeader: true, cell: (c) => <span className="font-medium" dir="ltr">{c.code}</span> },
    { key: 'cp', header: t('carveout.consents.counterparty'), cell: (c) => <span dir="auto">{c.counterparty}</span> },
    { key: 'kind', header: t('carveout.consents.kind'), cell: (c) => (CONSENT_KINDS.includes(c.kind as ConsentKind) ? consentKindLabel(t, c.kind as ConsentKind) : c.kind) },
    ...(perimeterItemId ? [] : [{ key: 'item', header: t('carveout.common.item'), cell: (c: Consent) => (c.perimeterItem ? <CodeLink href={itemHref(projectId, c.perimeterItem.id)} code={c.perimeterItem.code} /> : <span dir="ltr">{c.agreement?.code ?? EM_DASH}</span>) }]),
    { key: 'status', header: t('carveout.common.status'), cell: (c) => <StatusBadge enumName="consentStatuses" value={c.status} /> },
    { key: 'due', header: t('carveout.consents.due'), cell: (c) => <DateText value={c.dueDate} overdue={c.overdue} /> },
    { key: 'resp', header: t('carveout.consents.response'), cell: (c) => (c.respondedOn ? <span className="text-sm"><DateText value={c.respondedOn} /> · <PersonText person={c.responseRecordedBy} /></span> : c.requestedOn ? <span className="text-sm text-muted">{t('carveout.consents.requestedOn')} <DateText value={c.requestedOn} /></span> : EM_DASH) },
    { key: 'owner', header: t('carveout.common.owner'), cell: (c) => <PersonText person={c.owner} /> },
    { key: 'demo', header: '', cell: (c) => (c.isDemo ? <DemoBadge /> : null) },
    {
      key: 'act',
      header: '',
      cell: (c) =>
        canManage && NEXT[c.status].length ? (
          <button type="button" className={btn.ghost} onClick={() => setRespond(c)} data-testid="consent-respond">
            <MessageSquareReply aria-hidden="true" className="size-4" />
            {t('carveout.consents.record')}
          </button>
        ) : null,
    },
  ];
  return (
    <div className="space-y-3" data-testid="consents">
      <div className="flex flex-wrap items-end gap-3">
        {!perimeterItemId ? <SearchInput className="w-full sm:w-64" label={t('carveout.consents.search')} value={q} onChange={setQ} /> : null}
        <FilterSelect label={t('carveout.common.status')} value={status} onChange={setStatus} className="w-full sm:w-44">
          <option value="">{t('carveout.common.all')}</option>
          {CONSENT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {tStatus('consentStatuses', s)}
            </option>
          ))}
        </FilterSelect>
        {canManage ? (
          <button type="button" className={cx(btn.primary, 'ms-auto')} onClick={() => setCreate(true)} data-testid="consent-create">
            <Plus aria-hidden="true" className="size-4" />
            {t('carveout.consents.add')}
          </button>
        ) : null}
      </div>
      <DataTable
        caption={t('carveout.tabs.consents')}
        columns={columns}
        rows={list.data?.items}
        rowKey={(c) => c.id}
        isLoading={list.isLoading}
        error={list.error}
        onRetry={() => list.refetch()}
        emptyTitle={t('carveout.consents.empty')}
        pagination={list.data && list.data.total > 20 ? { page, pageSize: 20, total: list.data.total, onPageChange: setPage } : undefined}
      />
      <CreateConsentDialog open={create} onClose={() => setCreate(false)} perimeterItemId={perimeterItemId} />
      {respond ? <ConsentResponseDialog consent={respond} onClose={() => setRespond(null)} /> : null}
    </div>
  );
}

function CreateConsentDialog({ open, onClose, perimeterItemId }: { open: boolean; onClose: () => void; perimeterItemId?: string }) {
  const { t } = useI18n();
  const { projectId } = useProjectContext();
  const refresh = useRefreshCarveout(projectId);
  const toast = useToast();
  const agreements = useQuery({ queryKey: ck.agreements(projectId, { picker: true }), enabled: open, queryFn: ({ signal }) => api(C.listAgreements, { params: { projectId }, query: { page: 1, pageSize: 100 }, signal }) });
  const items = useQuery({ queryKey: ck.items(projectId, { picker: true }), enabled: open && !perimeterItemId, queryFn: ({ signal }) => api(C.listPerimeterItems, { params: { projectId }, query: { page: 1, pageSize: 100 }, signal }) });
  const [f, setF] = useState({ itemId: '', agreementId: '', kind: 'consent' as ConsentKind, counterparty: '', contractRef: '', dueDate: '' });
  const [owner, setOwner] = useState<PickedUser | null>(null);
  useEffect(() => {
    if (open) {
      setF({ itemId: perimeterItemId ?? '', agreementId: '', kind: 'consent', counterparty: '', contractRef: '', dueDate: '' });
      setOwner(null);
    }
  }, [open, perimeterItemId]);
  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title={t('carveout.consents.add')}
      submitLabel={t('carveout.consents.add')}
      disabled={!f.counterparty.trim() || (!f.itemId && !f.agreementId)}
      testId="consent-form"
      onSubmit={async () => {
        const r = await api(C.createConsent, {
          params: { projectId },
          body: { perimeterItemId: f.itemId || undefined, agreementId: f.agreementId || undefined, kind: f.kind, counterparty: f.counterparty.trim(), contractRef: f.contractRef.trim() || undefined, ownerUserId: owner?.id, dueDate: f.dueDate || undefined },
        });
        await refresh();
        toast.show('success', t('carveout.consents.created', { code: r.code }));
        onClose();
      }}
    >
      {!perimeterItemId ? (
        <SelectField label={t('carveout.common.item')} value={f.itemId} onChange={(e) => setF({ ...f, itemId: e.target.value })}>
          <option value="">{EM_DASH}</option>
          {items.data?.items.map((i) => (
            <option key={i.id} value={i.id}>
              {i.code} — {i.name}
            </option>
          ))}
        </SelectField>
      ) : null}
      <SelectField label={t('carveout.consents.agreement')} value={f.agreementId} onChange={(e) => setF({ ...f, agreementId: e.target.value })}>
        <option value="">{EM_DASH}</option>
        {agreements.data?.items.map((a) => (
          <option key={a.id} value={a.id}>
            {a.code} — {a.title}
          </option>
        ))}
      </SelectField>
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField label={t('carveout.consents.kind')} required value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as ConsentKind })}>
          {CONSENT_KINDS.map((k) => (
            <option key={k} value={k}>
              {consentKindLabel(t, k)}
            </option>
          ))}
        </SelectField>
        <TextField label={t('carveout.consents.due')} type="date" dir="ltr" value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} />
      </div>
      <TextField label={t('carveout.consents.counterparty')} required value={f.counterparty} maxLength={300} onChange={(e) => setF({ ...f, counterparty: e.target.value })} />
      <TextField label={t('carveout.consents.contractRef')} value={f.contractRef} maxLength={300} onChange={(e) => setF({ ...f, contractRef: e.target.value })} />
      <UserPicker label={t('carveout.common.owner')} value={owner} onChange={setOwner} />
    </FormDialog>
  );
}

/** REQ-AGR-008: request / response with a date and evidence; conditional needs conditions; "not required" is a specialist call. */
export function ConsentResponseDialog({ consent, onClose }: { consent: Consent; onClose: () => void }) {
  const { t, tStatus } = useI18n();
  const { projectId } = useProjectContext();
  const refresh = useRefreshCarveout(projectId);
  const toast = useToast();
  const options = NEXT[consent.status];
  const [to, setTo] = useState<Response>(options[0] ?? 'requested');
  const [date, setDate] = useState(localToday());
  const [evidenceNote, setEvidenceNote] = useState('');
  const [conditions, setConditions] = useState('');
  const needsEvidence = to !== 'requested';
  return (
    <ConfirmCommandDialog
      open
      onClose={onClose}
      title={t('carveout.consents.recordTitle', { code: consent.code })}
      confirmLabel={t('carveout.consents.record')}
      expectedVersion={consent.version}
      confirmDisabled={!date || (needsEvidence && !evidenceNote.trim()) || (to === 'conditional' && !conditions.trim())}
      consequences={[t('carveout.consents.recordEffect', { status: tStatus('consentStatuses', to) }), ...(to === 'not_required' ? [t('carveout.consents.specialistOnly')] : []), t('carveout.consents.day1Effect')]}
      onReload={() => void refresh()}
      onConfirm={async ({ note }) => {
        await api(C.recordConsentResponse, {
          params: { projectId, consentId: consent.id },
          body: { expectedVersion: consent.version, status: to, date, ...(needsEvidence ? { evidenceNote: evidenceNote.trim() } : {}), ...(conditions.trim() ? { conditions: conditions.trim() } : {}), ...(note ? { note } : {}) },
        });
        await refresh();
        toast.show('success', t('carveout.consents.recorded'));
        onClose();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField label={t('carveout.consents.newStatus')} required value={to} onChange={(e) => setTo(e.target.value as Response)} data-testid="consent-status">
          {options.map((o) => (
            <option key={o} value={o}>
              {tStatus('consentStatuses', o)}
            </option>
          ))}
        </SelectField>
        <TextField label={to === 'requested' ? t('carveout.consents.requestDate') : t('carveout.consents.responseDate')} type="date" dir="ltr" required value={date} onChange={(e) => setDate(e.target.value)} />
      </div>
      {needsEvidence ? <TextAreaField label={t('carveout.consents.evidenceNote')} hint={t('carveout.consents.evidenceHint')} required rows={2} value={evidenceNote} maxLength={2000} onChange={(e) => setEvidenceNote(e.target.value)} /> : null}
      {to === 'conditional' || to === 'granted' ? <TextAreaField label={t('carveout.consents.conditions')} required={to === 'conditional'} rows={2} value={conditions} maxLength={4000} onChange={(e) => setConditions(e.target.value)} /> : null}
    </ConfirmCommandDialog>
  );
}
