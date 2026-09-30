'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { jvRoutes } from '@hub/contracts';
import { DataTable } from '@/components/DataTable';
import { DemoBadge } from '@/components/DemoBadge';
import { TextField } from '@/components/Field';
import { PageHeader } from '@/components/PageHeader';
import { StatusBadge } from '@/components/StatusBadge';
import { useToast } from '@/components/Toast';
import { btn } from '@/components/ui';
import { EM_DASH, useI18n } from '@/i18n/provider';
import { api } from '@/lib/api';
import { jvHref, useEvents, useFlows, useJvRefresh, useMemberNames, type FundsFlow } from '@/lib/jv';
import { useProjectContext } from '@/lib/project-context';
import { ButtonRow, CmdButton, JvCommandDialog, Money, Person, RecordOnlyNotice, UText, useUrlState } from '../_components/jv';

type FlowCommand = 'confirm' | 'report_settled' | 'cancel';
const FLOW_ALLOWED: Record<string, readonly FlowCommand[]> = { planned: ['confirm', 'cancel'], confirmed_by_finance: ['report_settled', 'cancel'] };

function CreateFlowDialog({ closingId, onClose }: { closingId: string; onClose: () => void }) {
  const { t } = useI18n();
  const { projectId } = useProjectContext();
  const refresh = useJvRefresh();
  const toast = useToast();
  const [description, setDescription] = useState('');
  const [payer, setPayer] = useState('');
  const [payee, setPayee] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('');
  const [unitScale, setUnitScale] = useState<'' | '1' | '1000' | '1000000'>('');
  const [valueDate, setValueDate] = useState('');
  const moneyPartial = !!(amount.trim() || currency.trim() || unitScale) && !(amount.trim() && currency.trim() && unitScale);
  return (
    <JvCommandDialog
      open
      onClose={onClose}
      title={t('jv.funds.create.title')}
      confirmLabel={t('jv.funds.create.confirm')}
      noteMode="none"
      confirmDisabled={!description.trim() || !payer.trim() || !payee.trim() || moneyPartial}
      consequences={[t('jv.funds.create.effect'), t('jv.funds.recordOnly'), t('common.command.audited')]}
      onConfirm={async () => {
        const r = await api(jvRoutes.createFundsFlow, {
          params: { projectId, eventId: closingId },
          body: {
            description: description.trim(),
            payer: payer.trim(),
            payee: payee.trim(),
            ...(amount.trim() && currency.trim() && unitScale ? { amount: { amount: amount.trim(), currency: currency.trim().toUpperCase(), unitScale: Number(unitScale) as 1 | 1000 | 1000000 } } : {}),
            ...(valueDate ? { valueDate } : {}),
          },
        });
        await refresh();
        toast.show('success', t('jv.funds.create.done', { code: r.code ?? '' }));
        onClose();
      }}
    >
      <TextField label={t('jv.funds.fields.description')} required value={description} maxLength={1000} onChange={(e) => setDescription(e.target.value)} data-testid="flow-description" />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label={t('jv.funds.fields.payer')} required value={payer} maxLength={200} onChange={(e) => setPayer(e.target.value)} />
        <TextField label={t('jv.funds.fields.payee')} required value={payee} maxLength={200} onChange={(e) => setPayee(e.target.value)} />
        <TextField label={t('jv.common.amount')} placeholder={t('jv.scenarios.tbd')} hint={t('jv.funds.fields.amountHint')} inputMode="decimal" value={amount} maxLength={24} onChange={(e) => setAmount(e.target.value)} dir="ltr" />
        <div className="grid grid-cols-2 gap-2">
          <TextField label={t('jv.common.currency')} value={currency} maxLength={3} onChange={(e) => setCurrency(e.target.value)} dir="ltr" />
          <label className="flex flex-col gap-1 text-sm font-medium text-ink">
            {t('jv.common.unitScale')}
            <select className="block min-h-10 w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-sm" value={unitScale} onChange={(e) => setUnitScale(e.target.value as typeof unitScale)}>
              <option value="">{t('jv.common.none')}</option>
              <option value="1">{t('jv.common.units.1')}</option>
              <option value="1000">{t('jv.common.units.1000')}</option>
              <option value="1000000">{t('jv.common.units.1000000')}</option>
            </select>
          </label>
        </div>
        <TextField label={t('jv.funds.fields.valueDate')} type="date" value={valueDate} onChange={(e) => setValueDate(e.target.value)} />
      </div>
      {moneyPartial ? <p className="text-sm text-danger">{t('jv.funds.fields.moneyIncomplete')}</p> : null}
    </JvCommandDialog>
  );
}

function FlowDialog({ f, command, onClose }: { f: FundsFlow; command: FlowCommand; onClose: () => void }) {
  const { t, tStatus } = useI18n();
  const { projectId } = useProjectContext();
  const refresh = useJvRefresh();
  const toast = useToast();
  const [reference, setReference] = useState('');
  return (
    <JvCommandDialog
      open
      onClose={onClose}
      title={t(`jv.funds.cmd.${command}.title`)}
      confirmLabel={t(`jv.funds.cmd.${command}.confirm`)}
      danger={command === 'cancel'}
      noteMode={command === 'cancel' ? 'required' : 'optional'}
      noteLabel={command === 'cancel' ? t('jv.common.reason') : undefined}
      expectedVersion={f.version}
      confirmDisabled={command === 'report_settled' && !reference.trim()}
      consequences={[t(`jv.funds.cmd.${command}.effect`), t('jv.funds.recordOnly'), t('common.command.audited')]}
      onConfirm={async ({ note }) => {
        const r = await api(jvRoutes.transitionFundsFlow, {
          params: { projectId, flowId: f.id },
          body: { expectedVersion: f.version, command, ...(command === 'report_settled' ? { settlementReference: reference.trim() } : {}), ...(note ? { note } : {}) },
        });
        await refresh();
        toast.show('success', t('jv.common.statusNow', { status: tStatus('fundsFlowStatuses', r.status) }));
        onClose();
      }}
    >
      {command === 'report_settled' ? <TextField label={t('jv.funds.fields.settlementReference')} required hint={t('jv.funds.fields.settlementHint')} value={reference} maxLength={500} onChange={(e) => setReference(e.target.value)} data-testid="settlement-reference" /> : null}
    </JvCommandDialog>
  );
}

/**
 * Funds flow of a closing — RECORD ONLY (REQ-JV-015). The platform tracks the planned lines, Finance's confirmation and
 * the settlement REPORTED with its external reference. There is no payment, transfer or instruction action anywhere.
 */
export default function FundsFlowPage() {
  const { t, tStatus, formatDate, formatDateTime } = useI18n();
  const { projectId, can } = useProjectContext();
  const { values, set } = useUrlState(['closingId'] as const);
  const closings = useEvents('closing', { page: 1, pageSize: 100 });
  const closingId = values.closingId || closings.data?.items[0]?.id || null;
  const flows = useFlows(closingId);
  const members = useMemberNames();
  const [createOpen, setCreateOpen] = useState(false);
  const [pending, setPending] = useState<{ f: FundsFlow; command: FlowCommand } | null>(null);
  const base = jvHref(projectId);
  const canManage = can('jv.funds_flow.manage');
  const selected = closings.data?.items.find((c) => c.id === closingId);
  return (
    <>
      <PageHeader title={t('jv.funds.title')} description={t('jv.funds.subtitle')} />
      <div className="space-y-4">
        <RecordOnlyNotice testId="funds-record-only" />
        <div className="flex flex-wrap items-end justify-between gap-3">
          <label className="flex min-w-64 flex-col gap-1 text-sm font-medium text-ink">
            {t('jv.funds.closing')}
            <select className="block min-h-10 w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-sm" value={closingId ?? ''} onChange={(e) => set({ closingId: e.target.value })} data-testid="funds-closing">
              {(closings.data?.items ?? []).length === 0 ? <option value="">{t('jv.closing.emptyClosings')}</option> : null}
              {(closings.data?.items ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} — {c.name} ({tStatus('closingStatuses', c.status)})
                </option>
              ))}
            </select>
          </label>
          <ButtonRow>
            {selected ? (
              <Link className={btn.secondary} href={`${base}/closing/closings/${selected.id}`}>
                {t('jv.funds.openClosing')}
              </Link>
            ) : null}
            {canManage && closingId && selected?.status !== 'aborted' ? (
              <button type="button" className={btn.primary} onClick={() => setCreateOpen(true)} data-testid="create-flow">
                <Plus aria-hidden="true" className="size-4" />
                {t('jv.funds.create.action')}
              </button>
            ) : null}
          </ButtonRow>
        </div>
        <DataTable
          caption={t('jv.funds.title')}
          columns={[
            {
              key: 'code',
              header: t('jv.funds.fields.code'),
              isRowHeader: true,
              cell: (f) => (
                <span className="flex flex-wrap items-center gap-1">
                  <span dir="ltr">{f.code ?? EM_DASH}</span>
                  {f.isDemo ? <DemoBadge /> : null}
                </span>
              ),
            },
            { key: 'description', header: t('jv.funds.fields.description'), cell: (f) => <UText value={f.description} /> },
            {
              key: 'parties',
              header: t('jv.funds.fields.parties'),
              cell: (f) => (
                <span className="flex flex-col text-xs">
                  <span>
                    {t('jv.funds.fields.payer')}: <UText value={f.payer} />
                  </span>
                  <span>
                    {t('jv.funds.fields.payee')}: <UText value={f.payee} />
                  </span>
                </span>
              ),
            },
            { key: 'amount', header: t('jv.common.amount'), cell: (f) => (f.amount ? <Money value={f.amount} /> : <span className="text-warning">{t('jv.scenarios.tbd')}</span>) },
            { key: 'valueDate', header: t('jv.funds.fields.valueDate'), cell: (f) => <span className="tabular">{formatDate(f.valueDate)}</span> },
            {
              key: 'status',
              header: t('jv.common.status'),
              cell: (f) => (
                <span className="flex flex-col items-start gap-1 text-xs">
                  <StatusBadge enumName="fundsFlowStatuses" value={f.status} />
                  {f.confirmedBy ? <span>{t('jv.funds.confirmedBy')} <Person id={f.confirmedBy} people={members} /> · <span className="tabular">{formatDateTime(f.confirmedAt)}</span></span> : null}
                  {f.settlementReference ? <span>{t('jv.funds.fields.settlementReference')}: <UText value={f.settlementReference} /></span> : null}
                  {f.statusNote ? <UText value={f.statusNote} /> : null}
                </span>
              ),
            },
            {
              key: 'cmd',
              header: t('jv.common.commands'),
              cell: (f) =>
                canManage && FLOW_ALLOWED[f.status]?.length ? (
                  <ButtonRow>
                    {FLOW_ALLOWED[f.status]!.map((c) => (
                      <CmdButton key={c} label={t(`jv.funds.cmd.${c}.action`)} onClick={() => setPending({ f, command: c })} testId={`cmd-flow-${c}`} />
                    ))}
                  </ButtonRow>
                ) : (
                  <span className="text-muted">{EM_DASH}</span>
                ),
            },
          ]}
          rows={closingId ? flows.data?.items : []}
          rowKey={(f) => f.id}
          isLoading={flows.isLoading}
          error={flows.error}
          onRetry={() => flows.refetch()}
          emptyTitle={closingId ? t('jv.funds.empty') : t('jv.closing.emptyClosings')}
          testId="flows-table"
        />
      </div>
      {createOpen && closingId ? <CreateFlowDialog closingId={closingId} onClose={() => setCreateOpen(false)} /> : null}
      {pending ? <FlowDialog key={`${pending.f.id}-${pending.command}`} f={pending.f} command={pending.command} onClose={() => setPending(null)} /> : null}
    </>
  );
}
