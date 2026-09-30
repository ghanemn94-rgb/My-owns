'use client';

import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { carveoutRoutes as C, newcoRoutes as N } from '@hub/contracts';
import { CONTRACT_TRANSFER_CLASSES, PERIMETER_DISPOSITIONS, type ContractTransferClass, type PerimeterDisposition } from '@hub/domain';
import { EM_DASH, useI18n } from '@/i18n/provider';
import { api } from '@/lib/api';
import { ck, localToday, useRefreshCarveout, type PerimeterDetail, type TransferAspect, type TransferCmd, type TransferRecord } from '@/lib/carveout';
import { useProjectContext } from '@/lib/project-context';
import { ConfirmCommandDialog } from '../ConfirmCommandDialog';
import { SelectField, TextAreaField, TextField } from '../Field';
import { StatusBadge } from '../StatusBadge';
import { useToast } from '../Toast';
import { UserPicker, type PickedUser } from '../UserPicker';
import { btn, hint } from '../ui';
import { DateText, Section } from '../planning/bits';
import { FormDialog } from '../planning/dialogs';
import { TransferView } from './bits';
import { CommandLabel } from './panels';

type Item = PerimeterDetail;
const opt = (s: string) => (s.trim() ? s.trim() : undefined);

// =========================================================================================================
// Transfers: one set of commands per aspect (legal / economic) — D-05

const ASPECT_CMDS: readonly TransferCmd[] = ['plan', 'start', 'report_transferred', 'block', 'unblock', 'mark_not_applicable'];

export function TransferSection({ item }: { item: Item }) {
  const { t } = useI18n();
  const { can, me } = useProjectContext();
  const [cmd, setCmd] = useState<{ aspect: TransferAspect; command: TransferCmd } | null>(null);
  const [review, setReview] = useState<{ record: TransferRecord; kind: 'verify' | 'reject' } | null>(null);
  const [determine, setDetermine] = useState<TransferAspect | null>(null);
  const canManage = can('carveout.transfer.manage');
  const canVerify = can('carveout.transfer.verify');
  const inScope = item.disposition === 'included' || item.disposition === 'shared';
  // Only the latest report of each aspect can be reviewed, and only while that aspect awaits evidence review.
  const latestReport = (aspect: TransferAspect) => item.transfers.find((r) => r.aspect === aspect && r.command === 'report_transferred');
  return (
    <Section id="transfers" title={t('carveout.transfer.title')} hint={t('carveout.transfer.hint')}>
      <TransferView transfer={item.transfer} />
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {(['legal', 'economic'] as const).map((aspect) => {
          const other = aspect === 'legal' ? item.transfer.economic : item.transfer.legal;
          const machine = item.allowedTransferCommands[aspect].filter((c) => (ASPECT_CMDS as readonly string[]).includes(c)) as TransferCmd[];
          // DOM-P3-05: on an included / shared item "not applicable" is never offered on both aspects; it is a change request
          // (transfer manager) once the item is in the approved baseline, before that a specialist determination.
          const naPossible = machine.includes('mark_not_applicable') && !(inScope && other === 'not_applicable');
          const allowed = machine.filter((c) => c !== 'mark_not_applicable' || (naPossible && (!inScope || item.inApprovedBaseline)));
          const specialistNa = naPossible && inScope && !item.inApprovedBaseline && canVerify;
          const report = latestReport(aspect);
          const status = aspect === 'legal' ? item.transfer.legal : item.transfer.economic;
          const reviewable = report && (status === 'transferred_pending_evidence' || status === 'transferred_verified');
          const dates = aspect === 'legal' ? item.legalDates : item.economicDates;
          return (
            <div key={aspect} className="rounded-md border border-line p-3" data-testid={`aspect-${aspect}`} data-status={status}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">{t(`carveout.aspect.${aspect}`)}</h3>
                <StatusBadge enumName="transferStatuses" value={status} />
              </div>
              <dl className="mt-2 grid grid-cols-2 gap-2 text-sm">
                <div>
                  <dt className="text-xs text-muted">{t('carveout.transfer.planned')}</dt>
                  <dd>
                    <DateText value={dates.planned} />
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">{t('carveout.transfer.actual')}</dt>
                  <dd>
                    <DateText value={dates.actual} />
                  </dd>
                </div>
              </dl>
              <div className="mt-3 flex flex-wrap gap-2">
                {canManage
                  ? allowed.map((c) => (
                      <button key={c} type="button" className={c === 'block' || c === 'mark_not_applicable' ? btn.secondary : btn.primary} data-command={`${aspect}:${c}`} onClick={() => setCmd({ aspect, command: c })}>
                        <CommandLabel command={c} />
                      </button>
                    ))
                  : null}
                {specialistNa ? (
                  <button type="button" className={btn.secondary} data-command={`${aspect}:determine_not_applicable`} onClick={() => setDetermine(aspect)}>
                    {t('carveout.transfer.cmd.determine_not_applicable')}
                  </button>
                ) : null}
                {reviewable && canVerify && report.recordedBy !== me.user.id ? (
                  <>
                    {status === 'transferred_pending_evidence' ? (
                      <button type="button" className={btn.primary} data-command={`${aspect}:verify`} onClick={() => setReview({ record: report, kind: 'verify' })}>
                        <CommandLabel command="verify" />
                      </button>
                    ) : null}
                    <button type="button" className={btn.secondary} data-command={`${aspect}:reject_evidence`} onClick={() => setReview({ record: report, kind: 'reject' })}>
                      <CommandLabel command="reject_evidence" />
                    </button>
                  </>
                ) : null}
                {reviewable && canVerify && report.recordedBy === me.user.id && status === 'transferred_pending_evidence' ? <p className="text-xs text-muted">{t('carveout.transfer.notSelf')}</p> : null}
              </div>
            </div>
          );
        })}
      </div>
      {cmd ? <TransferCommandDialog item={item} aspect={cmd.aspect} command={cmd.command} onClose={() => setCmd(null)} /> : null}
      {review ? <TransferReviewDialog item={item} record={review.record} kind={review.kind} onClose={() => setReview(null)} /> : null}
      {determine ? <DetermineNotApplicableDialog item={item} aspect={determine} onClose={() => setDetermine(null)} /> : null}
    </Section>
  );
}

/** DOM-P3-05: specialist determination that one aspect of an included / shared item (not yet in a baseline) does not transfer. */
function DetermineNotApplicableDialog({ item, aspect, onClose }: { item: Item; aspect: TransferAspect; onClose: () => void }) {
  const { t } = useI18n();
  const { projectId } = useProjectContext();
  const refresh = useRefreshCarveout(projectId);
  const toast = useToast();
  return (
    <ConfirmCommandDialog
      open
      onClose={onClose}
      title={t('carveout.transfer.dialogTitle', { aspect: t(`carveout.aspect.${aspect}`), code: item.code })}
      confirmLabel={t('carveout.transfer.cmd.determine_not_applicable')}
      expectedVersion={item.version}
      noteMode="required"
      noteLabel={t('carveout.transfer.basis')}
      consequences={[t('carveout.transfer.effect.determine_not_applicable', { aspect: t(`carveout.aspect.${aspect}`) }), t('carveout.transfer.notApplicableSpecialist'), t('common.command.audited')]}
      onReload={() => void refresh()}
      onConfirm={async ({ note }) => {
        await api(C.determineTransferNotApplicable, { params: { projectId, itemId: item.id }, body: { expectedVersion: item.version, aspect, basis: note ?? '' } });
        await refresh();
        toast.show('success', t('carveout.transfer.done'));
        onClose();
      }}
    />
  );
}

function TransferCommandDialog({ item, aspect, command, onClose }: { item: Item; aspect: TransferAspect; command: TransferCmd; onClose: () => void }) {
  const { t } = useI18n();
  const { projectId } = useProjectContext();
  const refresh = useRefreshCarveout(projectId);
  const toast = useToast();
  const needsDate = command === 'plan' || command === 'report_transferred';
  const needsMechanism = needsDate;
  const noteRequired = command === 'block' || command === 'mark_not_applicable';
  // DOM-P3-05: on an included / shared item in the approved baseline, "not applicable" raises a change request.
  const viaChangeRequest = command === 'mark_not_applicable' && (item.disposition === 'included' || item.disposition === 'shared') && item.inApprovedBaseline;
  const [mechanism, setMechanism] = useState(item.transferMechanism ?? '');
  const [date, setDate] = useState(command === 'report_transferred' ? localToday() : '');
  return (
    <ConfirmCommandDialog
      open
      onClose={onClose}
      title={t('carveout.transfer.dialogTitle', { aspect: t(`carveout.aspect.${aspect}`), code: item.code })}
      confirmLabel={t(`carveout.transfer.cmd.${command}`)}
      expectedVersion={item.version}
      noteMode={noteRequired ? 'required' : 'optional'}
      noteLabel={noteRequired ? t('carveout.common.reason') : undefined}
      danger={command === 'block'}
      confirmDisabled={(needsDate && !date) || (needsMechanism && !mechanism.trim())}
      consequences={[
        viaChangeRequest ? t('carveout.transfer.effect.mark_not_applicable_change_request', { aspect: t(`carveout.aspect.${aspect}`) }) : t(`carveout.transfer.effect.${command}`, { aspect: t(`carveout.aspect.${aspect}`) }),
        t('carveout.transfer.otherAspectUnchanged'),
        t('common.command.audited'),
      ]}
      onReload={() => void refresh()}
      onConfirm={async ({ note }) => {
        const r = await api(C.recordTransfer, {
          params: { projectId },
          body: { perimeterItemId: item.id, aspect, command, expectedVersion: item.version, ...(needsMechanism ? { mechanism: mechanism.trim() } : {}), ...(needsDate ? { effectiveDate: date } : {}), ...(note ? { note } : {}) },
        });
        await refresh();
        toast.show('success', r.changeRequest ? t('carveout.transfer.changeRequested', { code: r.changeRequest.code }) : t('carveout.transfer.done'));
        onClose();
      }}
    >
      {needsMechanism ? <TextField label={t('carveout.item.mechanism')} required value={mechanism} maxLength={1000} onChange={(e) => setMechanism(e.target.value)} /> : null}
      {needsDate ? (
        <TextField
          label={command === 'plan' ? t('carveout.transfer.plannedDate', { aspect: t(`carveout.aspect.${aspect}`) }) : t('carveout.transfer.actualDate', { aspect: t(`carveout.aspect.${aspect}`) })}
          type="date"
          dir="ltr"
          required
          max={command === 'report_transferred' ? localToday() : undefined}
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
      ) : null}
    </ConfirmCommandDialog>
  );
}

function TransferReviewDialog({ item, record, kind, onClose }: { item: Item; record: TransferRecord; kind: 'verify' | 'reject'; onClose: () => void }) {
  const { t, formatNumber } = useI18n();
  const { projectId } = useProjectContext();
  const refresh = useRefreshCarveout(projectId);
  const toast = useToast();
  return (
    <ConfirmCommandDialog
      open
      onClose={onClose}
      title={kind === 'verify' ? t('carveout.transfer.verifyTitle', { aspect: t(`carveout.aspect.${record.aspect}`), code: item.code }) : t('carveout.transfer.rejectTitle', { aspect: t(`carveout.aspect.${record.aspect}`), code: item.code })}
      confirmLabel={kind === 'verify' ? t('carveout.transfer.cmd.verify') : t('carveout.transfer.cmd.reject_evidence')}
      expectedVersion={item.version}
      noteMode={kind === 'reject' ? 'required' : 'optional'}
      noteLabel={kind === 'reject' ? t('carveout.common.reason') : undefined}
      danger={kind === 'reject'}
      consequences={
        kind === 'verify'
          ? [t('carveout.transfer.verifyEffect'), t('carveout.transfer.evidenceNow', { count: formatNumber(item.evidence.transfer.active) }), t('carveout.transfer.notSelf')]
          : [t('carveout.transfer.rejectEffect')]
      }
      onReload={() => void refresh()}
      onConfirm={async ({ note }) => {
        if (kind === 'verify') await api(C.verifyTransfer, { params: { projectId, transferId: record.id }, body: { expectedVersion: item.version, ...(note ? { note } : {}) } });
        else await api(C.rejectTransferEvidence, { params: { projectId, transferId: record.id }, body: { expectedVersion: item.version, reason: note } });
        await refresh();
        toast.show('success', t('carveout.transfer.done'));
        onClose();
      }}
    />
  );
}

export function TransferHistory({ item }: { item: Item }) {
  const { t, formatDateTime } = useI18n();
  return (
    <Section id="transfer-history" title={t('carveout.transfer.historyTitle')} hint={t('carveout.transfer.historyExplain')}>
      {item.transfers.length === 0 ? (
        <p className="text-sm text-muted">{t('carveout.transfer.empty')}</p>
      ) : (
        <ol className="space-y-2" data-testid="transfer-history">
          {item.transfers.map((r) => (
            <li key={r.id} className="rounded-md border border-line p-2 text-sm" data-aspect={r.aspect} data-command={r.command}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{t(`carveout.aspect.${r.aspect}`)}</span>
                <span>
                  <CommandLabel command={r.command} />
                </span>
                <StatusBadge enumName="transferStatuses" value={r.toStatus} />
                {r.effectiveDate ? (
                  <span className="text-muted">
                    {t('carveout.transfer.effectiveDate')}: <DateText value={r.effectiveDate} />
                  </span>
                ) : null}
              </div>
              <p className="mt-1 text-xs text-muted">
                <span dir="auto">{r.recordedByName ?? EM_DASH}</span> · {formatDateTime(r.recordedAt)} · {t('carveout.transfer.evidenceCount', { count: r.evidenceCount })}
                {r.mechanism ? (
                  <>
                    {' '}· <span dir="auto">{r.mechanism}</span>
                  </>
                ) : null}
              </p>
              {r.note ? (
                <p className="mt-1 text-xs" dir="auto">
                  {r.note}
                </p>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </Section>
  );
}

// =========================================================================================================
// Scope change (classify) and applying a decided change request — AT-07

export function ScopeChangeDialog({ item, open, onClose }: { item: Item; open: boolean; onClose: () => void }) {
  const { t, tStatus } = useI18n();
  const { projectId, can } = useProjectContext();
  const refresh = useRefreshCarveout(projectId);
  const toast = useToast();
  const sites = useQuery({ queryKey: ck.sites(projectId), enabled: open, queryFn: ({ signal }) => api(C.listSites, { params: { projectId }, signal }) });
  const canEntities = can('newco.register.read');
  const entities = useQuery({ queryKey: ck.entities(projectId), enabled: open && canEntities, queryFn: ({ signal }) => api(N.listLegalEntities, { params: { projectId }, signal }) });
  const [f, setF] = useState({ disposition: item.disposition as PerimeterDisposition, siteId: item.siteId ?? '', targetEntityId: item.targetEntity?.id ?? '', justification: '' });
  const [narrative, setNarrative] = useState({ financial_statements: '', tsa: '', readiness: '', transaction: '' });
  useEffect(() => {
    if (open) {
      setF({ disposition: item.disposition, siteId: item.siteId ?? '', targetEntityId: item.targetEntity?.id ?? '', justification: '' });
      setNarrative({ financial_statements: '', tsa: '', readiness: '', transaction: '' });
    }
  }, [open, item]);
  const unchanged = f.disposition === item.disposition && (f.siteId || null) === item.siteId && (f.targetEntityId || null) === (item.targetEntity?.id ?? null);
  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title={t('carveout.scope.title', { code: item.code })}
      submitLabel={t('carveout.scope.submit')}
      size="lg"
      disabled={unchanged || !f.justification.trim()}
      testId="scope-form"
      onReload={() => void refresh()}
      onSubmit={async () => {
        const n = Object.fromEntries(Object.entries(narrative).filter(([, v]) => v.trim())) as Record<string, string>;
        const r = await api(C.classifyPerimeterItem, {
          params: { projectId, itemId: item.id },
          body: {
            expectedVersion: item.version,
            disposition: f.disposition,
            siteId: f.siteId || null,
            ...(canEntities ? { targetEntityId: f.targetEntityId || null } : {}),
            justification: f.justification.trim(),
            ...(Object.keys(n).length ? { impactNarrative: n } : {}),
          },
        });
        await refresh();
        toast.show('success', r.changeRequest ? t('carveout.scope.heldForChange', { code: r.changeRequest.code }) : t('carveout.scope.applied'));
        onClose();
      }}
    >
      <p className={hint}>{item.inApprovedBaseline ? t('carveout.scope.baselinedHint') : t('carveout.scope.hint')}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField label={t('carveout.item.disposition')} required value={f.disposition} onChange={(e) => setF({ ...f, disposition: e.target.value as PerimeterDisposition })} data-testid="scope-disposition">
          {PERIMETER_DISPOSITIONS.map((d) => (
            <option key={d} value={d}>
              {tStatus('perimeterDispositions', d)}
            </option>
          ))}
        </SelectField>
        <SelectField label={t('carveout.item.site')} value={f.siteId} onChange={(e) => setF({ ...f, siteId: e.target.value })}>
          <option value="">{EM_DASH}</option>
          {sites.data?.items.map((s) => (
            <option key={s.id} value={s.id}>
              {s.code} — {s.name}
            </option>
          ))}
        </SelectField>
      </div>
      {canEntities ? (
        <SelectField label={t('carveout.item.targetEntity')} value={f.targetEntityId} onChange={(e) => setF({ ...f, targetEntityId: e.target.value })}>
          <option value="">{EM_DASH}</option>
          {entities.data?.items.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </SelectField>
      ) : null}
      <TextAreaField label={t('carveout.scope.justification')} required rows={2} value={f.justification} maxLength={2000} onChange={(e) => setF({ ...f, justification: e.target.value })} />
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{t('carveout.scope.narrativeTitle')}</legend>
        <p className={hint}>{t('carveout.scope.narrativeHint')}</p>
        {(['financial_statements', 'tsa', 'readiness', 'transaction'] as const).map((k) => (
          <TextField key={k} label={t(`carveout.impact.area.${k}`)} value={narrative[k]} maxLength={2000} onChange={(e) => setNarrative({ ...narrative, [k]: e.target.value })} />
        ))}
      </fieldset>
    </FormDialog>
  );
}

export function ApplyChangeDialog({ item, open, onClose }: { item: Item; open: boolean; onClose: () => void }) {
  const { t, tStatus } = useI18n();
  const { projectId } = useProjectContext();
  const refresh = useRefreshCarveout(projectId);
  const toast = useToast();
  if (!item.pendingChange) return null;
  const pc = item.pendingChange;
  return (
    <ConfirmCommandDialog
      open={open}
      onClose={onClose}
      title={t('carveout.scope.applyTitle', { code: pc.code })}
      confirmLabel={t('carveout.scope.apply')}
      expectedVersion={item.version}
      consequences={[t('carveout.scope.applyEffect1', { status: tStatus('changeRequestStatuses', pc.status) }), t('carveout.scope.applyEffect2'), t('carveout.scope.applyEffect3'), t('common.command.audited')]}
      onReload={() => void refresh()}
      onConfirm={async ({ note }) => {
        const r = await api(C.applyPerimeterChange, { params: { projectId, itemId: item.id }, body: { expectedVersion: item.version, changeRequestId: pc.id, ...(note ? { note } : {}) } });
        await refresh();
        toast.show('success', r.outcome === 'applied' ? t('carveout.scope.appliedChange', { code: pc.code }) : t('carveout.scope.closedChange', { code: pc.code }));
        onClose();
      }}
    />
  );
}

// =========================================================================================================
// Transferability (specialist) and the Day-1 interim position (AT-08)

export function TransferabilityDialog({ item, open, onClose }: { item: Item; open: boolean; onClose: () => void }) {
  const { t, tStatus } = useI18n();
  const { projectId } = useProjectContext();
  const refresh = useRefreshCarveout(projectId);
  const toast = useToast();
  const [cls, setCls] = useState<ContractTransferClass>(item.transferClass);
  const [basis, setBasis] = useState('');
  useEffect(() => {
    if (open) {
      setCls(item.transferClass);
      setBasis('');
    }
  }, [open, item]);
  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title={t('carveout.contract.classifyTitle', { code: item.code })}
      submitLabel={t('carveout.contract.classify')}
      disabled={!basis.trim()}
      testId="transferability-form"
      onReload={() => void refresh()}
      onSubmit={async () => {
        await api(C.setTransferability, { params: { projectId, itemId: item.id }, body: { expectedVersion: item.version, transferClass: cls, basis: basis.trim() } });
        await refresh();
        toast.show('success', t('carveout.contract.classified'));
        onClose();
      }}
    >
      <p className={hint}>{t('carveout.contract.classifyHint')}</p>
      <SelectField label={t('carveout.contract.class')} required value={cls} onChange={(e) => setCls(e.target.value as ContractTransferClass)}>
        {CONTRACT_TRANSFER_CLASSES.map((c) => (
          <option key={c} value={c}>
            {tStatus('contractTransferClasses', c)}
          </option>
        ))}
      </SelectField>
      <TextAreaField label={t('carveout.contract.basis')} required rows={3} value={basis} maxLength={2000} onChange={(e) => setBasis(e.target.value)} />
    </FormDialog>
  );
}

const toPicked = (p: { userId: string; name: string | null } | null): PickedUser | null => (p ? { id: p.userId, displayName: p.name ?? '', email: '' } : null);

export function InterimArrangementDialog({ item, open, onClose }: { item: Item; open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const { projectId } = useProjectContext();
  const refresh = useRefreshCarveout(projectId);
  const toast = useToast();
  const d = item.day1;
  const [interim, setInterim] = useState('');
  const [remediation, setRemediation] = useState('');
  const [service, setService] = useState<PickedUser | null>(null);
  const [billing, setBilling] = useState<PickedUser | null>(null);
  const [sla, setSla] = useState<PickedUser | null>(null);
  useEffect(() => {
    if (!open) return;
    setInterim(d.interimArrangement ?? '');
    setRemediation(d.remediationPlan ?? '');
    setService(toPicked(d.serviceAccountable));
    setBilling(toPicked(d.billingAccountable));
    setSla(toPicked(d.slaAccountable));
  }, [open, d]);
  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title={t('carveout.contract.interimTitle', { code: item.code })}
      submitLabel={t('common.actions.save')}
      size="lg"
      testId="interim-form"
      onReload={() => void refresh()}
      onSubmit={async () => {
        await api(C.setInterimArrangement, {
          params: { projectId, itemId: item.id },
          body: {
            expectedVersion: item.version,
            interimArrangement: interim.trim() || null,
            remediationPlan: remediation.trim() || null,
            serviceAccountableUserId: service?.id ?? null,
            billingAccountableUserId: billing?.id ?? null,
            slaAccountableUserId: sla?.id ?? null,
          },
        });
        await refresh();
        toast.show('success', t('carveout.common.saved'));
        onClose();
      }}
    >
      <p className={hint}>{t('carveout.contract.interimHint')}</p>
      <TextAreaField label={t('carveout.day1.missing.interimArrangement')} rows={3} value={interim} maxLength={4000} onChange={(e) => setInterim(e.target.value)} />
      <div className="grid gap-3 md:grid-cols-3">
        <UserPicker label={t('carveout.day1.missing.serviceAccountableOwner')} value={service} onChange={setService} />
        <UserPicker label={t('carveout.day1.missing.billingAccountableOwner')} value={billing} onChange={setBilling} />
        <UserPicker label={t('carveout.day1.missing.slaAccountableOwner')} value={sla} onChange={setSla} />
      </div>
      <TextAreaField label={t('carveout.day1.missing.remediationPlan')} rows={3} value={remediation} maxLength={4000} onChange={(e) => setRemediation(e.target.value)} />
    </FormDialog>
  );
}

// =========================================================================================================
// Impact assessment (REQ-PER-004) and descriptive edit

export function ImpactAssessmentDialog({ item, open, onClose }: { item: Item; open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const { projectId } = useProjectContext();
  const refresh = useRefreshCarveout(projectId);
  const toast = useToast();
  const AREAS = ['financial_statements', 'valuation', 'agreements', 'tsa', 'readiness', 'schedule', 'budget', 'transaction'] as const;
  const [n, setN] = useState<Record<string, string>>({});
  useEffect(() => {
    if (open) setN({});
  }, [open]);
  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title={t('carveout.impact.recordTitle', { code: item.code })}
      submitLabel={t('carveout.impact.record')}
      size="lg"
      testId="impact-form"
      onSubmit={async () => {
        const narrative = Object.fromEntries(Object.entries(n).filter(([, v]) => v.trim()).map(([k, v]) => [k, v.trim()]));
        await api(C.assessPerimeterImpact, { params: { projectId, itemId: item.id }, body: Object.keys(narrative).length ? { narrative } : {} });
        await refresh();
        toast.show('success', t('carveout.impact.recorded'));
        onClose();
      }}
    >
      <p className={hint}>{t('carveout.impact.recordHint')}</p>
      <div className="grid gap-3 md:grid-cols-2">
        {AREAS.map((a) => (
          <TextField key={a} label={t(`carveout.impact.area.${a}`)} value={n[a] ?? ''} maxLength={2000} onChange={(e) => setN({ ...n, [a]: e.target.value })} />
        ))}
      </div>
    </FormDialog>
  );
}

export function EditItemDialog({ item, open, onClose }: { item: Item; open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const { projectId } = useProjectContext();
  const refresh = useRefreshCarveout(projectId);
  const toast = useToast();
  const init = () => ({
    name: item.name,
    description: item.description ?? '',
    legalOwner: item.legalOwner ?? '',
    operator: item.operator ?? '',
    economicBeneficiary: item.economicBeneficiary ?? '',
    transferMechanism: item.transferMechanism ?? '',
    plannedEffectiveDate: item.legalDates.planned ?? '',
    economicPlannedEffectiveDate: item.economicDates.planned ?? '',
    dependencies: item.dependencies ?? '',
    risks: item.risks ?? '',
    resolutionPath: item.resolutionPath ?? '',
    targetGateKey: item.targetGateKey ?? '',
    consentRequired: item.consentRequired,
  });
  const [f, setF] = useState(init);
  const [owner, setOwner] = useState<PickedUser | null>(null);
  useEffect(() => {
    if (open) {
      setF(init());
      setOwner(toPicked(item.owner));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, item]);
  const s = (k: keyof ReturnType<typeof init>) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const nn = (v: string) => (v.trim() ? v.trim() : null);
  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title={t('carveout.item.editTitle', { code: item.code })}
      submitLabel={t('common.actions.save')}
      size="lg"
      disabled={!f.name.trim()}
      onReload={() => void refresh()}
      onSubmit={async () => {
        // Only changed fields are sent (an unchanged save is not a new version).
        const body: Record<string, unknown> = {};
        const put = (k: string, next: unknown, prev: unknown) => {
          if (next !== prev) body[k] = next;
        };
        put('name', f.name.trim(), item.name);
        put('description', nn(f.description), item.description);
        put('ownerUserId', owner?.id ?? null, item.owner?.userId ?? null);
        put('legalOwner', nn(f.legalOwner), item.legalOwner);
        put('operator', nn(f.operator), item.operator);
        put('economicBeneficiary', nn(f.economicBeneficiary), item.economicBeneficiary);
        put('transferMechanism', nn(f.transferMechanism), item.transferMechanism);
        put('plannedEffectiveDate', f.plannedEffectiveDate || null, item.legalDates.planned);
        put('economicPlannedEffectiveDate', f.economicPlannedEffectiveDate || null, item.economicDates.planned);
        put('dependencies', nn(f.dependencies), item.dependencies);
        put('risks', nn(f.risks), item.risks);
        put('resolutionPath', nn(f.resolutionPath), item.resolutionPath);
        put('targetGateKey', nn(f.targetGateKey), item.targetGateKey);
        put('consentRequired', f.consentRequired, item.consentRequired);
        if (Object.keys(body).length === 0) return onClose();
        await api(C.updatePerimeterItem, { params: { projectId, itemId: item.id }, body: { expectedVersion: item.version, ...body } });
        await refresh();
        toast.show('success', t('carveout.common.saved'));
        onClose();
      }}
    >
      <p className={hint}>{t('carveout.item.editHint')}</p>
      <TextField label={t('carveout.item.name')} required value={f.name} maxLength={300} onChange={s('name')} />
      <TextAreaField label={t('carveout.item.description')} rows={2} value={f.description} maxLength={4000} onChange={s('description')} />
      <UserPicker label={t('carveout.item.accountableOwner')} value={owner} onChange={setOwner} />
      <div className="grid gap-3 sm:grid-cols-3">
        <TextField label={t('carveout.item.legalOwner')} value={f.legalOwner} maxLength={300} onChange={s('legalOwner')} />
        <TextField label={t('carveout.item.operator')} value={f.operator} maxLength={300} onChange={s('operator')} />
        <TextField label={t('carveout.item.economicBeneficiary')} value={f.economicBeneficiary} maxLength={300} onChange={s('economicBeneficiary')} />
      </div>
      <TextField label={t('carveout.item.mechanism')} value={f.transferMechanism} maxLength={1000} onChange={s('transferMechanism')} />
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label={t('carveout.item.plannedLegal')} type="date" dir="ltr" value={f.plannedEffectiveDate} onChange={s('plannedEffectiveDate')} />
        <TextField label={t('carveout.item.plannedEconomic')} type="date" dir="ltr" value={f.economicPlannedEffectiveDate} onChange={s('economicPlannedEffectiveDate')} />
      </div>
      <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
        <TextField label={t('carveout.item.resolutionPath')} value={f.resolutionPath} maxLength={2000} onChange={s('resolutionPath')} />
        <TextField label={t('carveout.item.targetGate')} dir="ltr" value={f.targetGateKey} maxLength={3} onChange={s('targetGateKey')} />
      </div>
      <TextAreaField label={t('carveout.item.dependencies')} rows={2} value={f.dependencies} maxLength={2000} onChange={s('dependencies')} />
      <TextAreaField label={t('carveout.item.risks')} rows={2} value={f.risks} maxLength={2000} onChange={s('risks')} />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="size-4" checked={f.consentRequired} onChange={(e) => setF((x) => ({ ...x, consentRequired: e.target.checked }))} />
        {t('carveout.item.consentRequired')}
      </label>
    </FormDialog>
  );
}


