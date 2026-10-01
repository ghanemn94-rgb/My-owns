'use client';

import { SelectField, TextAreaField, TextField } from '@/components/Field';
import { StatusBadge, type Tone } from '@/components/StatusBadge';
import { UserPicker, type PickedUser } from '@/components/UserPicker';
import { useI18n } from '@/i18n/provider';
import type { TsaService, TsaServiceDetail } from '@/lib/readiness';
import { useScopeLabels } from './rd';

export interface TsaForm {
  name: string;
  scope: string;
  dependentServices: string;
  sla: string;
  metricMethod: string;
  chargeBasis: string;
  startDate: string;
  endDate: string;
  extensionTerms: string;
  terminationTerms: string;
  owner: PickedUser | null;
  workstreamId: string;
  replacementService: string;
  replacementPlan: string;
  replacementDueDate: string;
  milestones: string;
  residualRisks: string;
  isEnduringArrangement: boolean;
}

export function emptyTsaForm(): TsaForm {
  return {
    name: '',
    scope: '',
    dependentServices: '',
    sla: '',
    metricMethod: '',
    chargeBasis: '',
    startDate: '',
    endDate: '',
    extensionTerms: '',
    terminationTerms: '',
    owner: null,
    workstreamId: '',
    replacementService: '',
    replacementPlan: '',
    replacementDueDate: '',
    milestones: '',
    residualRisks: '',
    isEnduringArrangement: false,
  };
}

export function tsaFormOf(t: TsaServiceDetail): TsaForm {
  return {
    name: t.name,
    scope: t.scope ?? '',
    dependentServices: t.dependentServices ?? '',
    sla: t.sla ?? '',
    metricMethod: t.metricMethod ?? '',
    chargeBasis: t.chargeBasis ?? '',
    startDate: t.startDate ?? '',
    endDate: t.endDate ?? '',
    extensionTerms: t.extensionTerms ?? '',
    terminationTerms: t.terminationTerms ?? '',
    owner: t.ownerUserId ? { id: t.ownerUserId, displayName: t.people[t.ownerUserId] ?? t.ownerUserId, email: '' } : null,
    workstreamId: t.workstreamId ?? '',
    replacementService: t.replacementService ?? '',
    replacementPlan: t.replacementPlan ?? '',
    replacementDueDate: t.replacementDueDate ?? '',
    milestones: t.exitMilestones.map((m) => m.title).join('\n'),
    residualRisks: t.residualRisks ?? '',
    isEnduringArrangement: t.isEnduringArrangement,
  };
}

const orNull = (s: string) => (s.trim() ? s.trim() : null);

/**
 * Body of create / edit. `original` keeps the milestone "done" flags of unchanged titles; the charge basis is sent only
 * when the caller may see it (a redacted value is never overwritten with an empty one).
 */
export function tsaBody(f: TsaForm, original: TsaServiceDetail | null) {
  const milestones = f.milestones
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((title) => {
      const prev = original?.exitMilestones.find((m) => m.title === title);
      return prev?.done ? { title, done: true } : { title };
    });
  const v = {
    scope: orNull(f.scope),
    dependentServices: orNull(f.dependentServices),
    sla: orNull(f.sla),
    metricMethod: orNull(f.metricMethod),
    ...(original?.chargeRedacted ? {} : { chargeBasis: orNull(f.chargeBasis) }),
    startDate: f.startDate || null,
    endDate: f.endDate || null,
    extensionTerms: orNull(f.extensionTerms),
    terminationTerms: orNull(f.terminationTerms),
    ownerUserId: f.owner?.id ?? null,
    workstreamId: f.workstreamId || null,
    replacementService: orNull(f.replacementService),
    replacementPlan: orNull(f.replacementPlan),
    replacementDueDate: f.replacementDueDate || null,
    exitMilestones: milestones,
    residualRisks: orNull(f.residualRisks),
    isEnduringArrangement: f.isEnduringArrangement,
  };
  if (original) {
    // Approved TSAs: dates change only through an approved extension — do not resend them.
    if (!['proposed', 'negotiating'].includes(original.status)) {
      delete (v as Partial<typeof v>).startDate;
      delete (v as Partial<typeof v>).endDate;
    }
    return v;
  }
  return Object.fromEntries(Object.entries(v).filter(([, x]) => x !== null && !(Array.isArray(x) && x.length === 0))) as Partial<typeof v>;
}

export function TsaFields({ form, onChange, datesLocked = false, chargeRedacted = false }: { form: TsaForm; onChange: (f: TsaForm) => void; datesLocked?: boolean; chargeRedacted?: boolean }) {
  const { t } = useI18n();
  const { workstreams } = useScopeLabels();
  const set = <K extends keyof TsaForm>(k: K, v: TsaForm[K]) => onChange({ ...form, [k]: v });
  const text = (k: keyof TsaForm, label: string, area = false, testId?: string) =>
    area ? (
      <TextAreaField className="sm:col-span-2" label={label} value={form[k] as string} maxLength={8000} rows={2} onChange={(e) => set(k, e.target.value as never)} data-testid={testId} />
    ) : (
      <TextField label={label} value={form[k] as string} maxLength={4000} onChange={(e) => set(k, e.target.value as never)} data-testid={testId} />
    );
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <TextField className="sm:col-span-2" label={t('readiness.tsa.fields.name')} required value={form.name} maxLength={300} onChange={(e) => set('name', e.target.value)} data-testid="tsa-name" />
      {text('scope', t('readiness.tsa.fields.scope'), true, 'tsa-scope')}
      {text('dependentServices', t('readiness.tsa.fields.dependentServices'), true)}
      {text('sla', t('readiness.tsa.fields.sla'))}
      {text('metricMethod', t('readiness.tsa.fields.metricMethod'))}
      {chargeRedacted ? null : text('chargeBasis', t('readiness.tsa.fields.chargeBasis'))}
      <SelectField label={t('readiness.tsa.fields.workstream')} value={form.workstreamId} onChange={(e) => set('workstreamId', e.target.value)}>
        <option value="">{t('readiness.common.notSet')}</option>
        {workstreams.map((w) => (
          <option key={w.id} value={w.id}>
            {w.code} — {w.name}
          </option>
        ))}
      </SelectField>
      <TextField label={t('readiness.tsa.fields.startDate')} type="date" disabled={datesLocked} value={form.startDate} onChange={(e) => set('startDate', e.target.value)} data-testid="tsa-start" />
      <TextField label={t('readiness.tsa.fields.endDate')} type="date" disabled={datesLocked} value={form.endDate} onChange={(e) => set('endDate', e.target.value)} data-testid="tsa-end" />
      <div className="sm:col-span-2">
        <UserPicker label={t('readiness.tsa.fields.owner')} value={form.owner} onChange={(u) => set('owner', u)} />
      </div>
      {text('replacementService', t('readiness.tsa.fields.replacementService'), false, 'tsa-replacement')}
      <TextField label={t('readiness.tsa.fields.replacementDueDate')} type="date" value={form.replacementDueDate} onChange={(e) => set('replacementDueDate', e.target.value)} />
      {text('replacementPlan', t('readiness.tsa.fields.replacementPlan'), true)}
      <TextAreaField className="sm:col-span-2" label={t('readiness.tsa.fields.milestones')} value={form.milestones} rows={3} maxLength={8000} onChange={(e) => set('milestones', e.target.value)} data-testid="tsa-milestones" />
      {text('extensionTerms', t('readiness.tsa.fields.extensionTerms'), true)}
      {text('terminationTerms', t('readiness.tsa.fields.terminationTerms'), true)}
      {text('residualRisks', t('readiness.tsa.fields.residualRisks'), true)}
      <label className="inline-flex items-center gap-2 text-sm sm:col-span-2">
        {/* DOM-P3-15: part of the approved terms — locked with the dates once the terms are approved. */}
        <input type="checkbox" checked={form.isEnduringArrangement} disabled={datesLocked} onChange={(e) => set('isEnduringArrangement', e.target.checked)} />
        {t('readiness.tsa.fields.enduring')}
      </label>
      {datesLocked ? <p className="text-xs text-muted sm:col-span-2">{t('readiness.tsa.fields.enduringLocked')}</p> : null}
    </div>
  );
}

const EXPIRY_TONE: Record<TsaService['expiry']['kind'], Tone> = { ok: 'neutral', expiring: 'warning', expired_unresolved: 'danger', exit_acceptance_pending: 'warning' };

/** End-date check (AT-10): reaching the end date is never shown as an exit. */
export function ExpiryBadge({ expiry }: { expiry: TsaService['expiry'] }) {
  const { t } = useI18n();
  return (
    <StatusBadge
      enumName="tsaStatuses"
      value={expiry.kind === 'ok' ? null : expiry.kind}
      tone={EXPIRY_TONE[expiry.kind]}
      label={t(`readiness.tsa.expiry.${expiry.kind}`, { days: expiry.days ?? 0 })}
    />
  );
}

