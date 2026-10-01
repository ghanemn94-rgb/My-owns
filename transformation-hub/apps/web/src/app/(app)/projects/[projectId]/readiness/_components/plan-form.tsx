'use client';

import { SelectField, TextAreaField, TextField } from '@/components/Field';
import { UserPicker, type PickedUser } from '@/components/UserPicker';
import { useI18n } from '@/i18n/provider';
import type { CutoverPlanDetail } from '@/lib/readiness';
import { useScopeLabels } from './rd';

/** Form state of a cutover plan (create and edit share it). Window inputs are local date-times, sent as UTC instants. */
export interface PlanForm {
  title: string;
  siteId: string;
  workstreamId: string;
  accountable: PickedUser | null;
  runbookSummary: string;
  windowStart: string;
  windowEnd: string;
  serviceImpact: string;
  testingSummary: string;
  contingencyPlan: string;
  rollbackPlan: string;
}

export function emptyPlanForm(): PlanForm {
  return { title: '', siteId: '', workstreamId: '', accountable: null, runbookSummary: '', windowStart: '', windowEnd: '', serviceImpact: '', testingSummary: '', contingencyPlan: '', rollbackPlan: '' };
}

const pad = (n: number) => String(n).padStart(2, '0');
function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function planFormOf(p: CutoverPlanDetail): PlanForm {
  const name = p.accountableUserId ? p.people[p.accountableUserId] : undefined;
  return {
    title: p.title,
    siteId: p.siteId ?? '',
    workstreamId: p.workstreamId ?? '',
    accountable: p.accountableUserId ? { id: p.accountableUserId, displayName: name ?? p.accountableUserId, email: '' } : null,
    runbookSummary: p.runbookSummary ?? '',
    windowStart: toLocalInput(p.windowStart),
    windowEnd: toLocalInput(p.windowEnd),
    serviceImpact: p.serviceImpact ?? '',
    testingSummary: p.testingSummary ?? '',
    contingencyPlan: p.contingencyPlan ?? '',
    rollbackPlan: p.rollbackPlan ?? '',
  };
}

const orNull = (s: string) => (s.trim() ? s.trim() : null);

/** Request body fields (create omits empty values; edit sends explicit nulls so a field can be cleared). */
export function planBody(f: PlanForm, mode: 'edit' | null) {
  const v = {
    siteId: f.siteId || null,
    workstreamId: f.workstreamId || null,
    accountableUserId: f.accountable?.id ?? null,
    runbookSummary: orNull(f.runbookSummary),
    windowStart: f.windowStart ? new Date(f.windowStart).toISOString() : null,
    windowEnd: f.windowEnd ? new Date(f.windowEnd).toISOString() : null,
    serviceImpact: orNull(f.serviceImpact),
    testingSummary: orNull(f.testingSummary),
    contingencyPlan: orNull(f.contingencyPlan),
    rollbackPlan: orNull(f.rollbackPlan),
  };
  if (mode === 'edit') return v;
  return Object.fromEntries(Object.entries(v).filter(([, x]) => x !== null)) as Partial<typeof v>;
}

export function PlanFields({ form, onChange }: { form: PlanForm; onChange: (f: PlanForm) => void }) {
  const { t } = useI18n();
  const { sites, workstreams, siteName, wsName } = useScopeLabels();
  const set = <K extends keyof PlanForm>(k: K, v: PlanForm[K]) => onChange({ ...form, [k]: v });
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <TextField className="sm:col-span-2" label={t('readiness.cutover.fields.title')} required value={form.title} maxLength={300} onChange={(e) => set('title', e.target.value)} data-testid="plan-title" />
      <SelectField label={t('readiness.cutover.fields.site')} value={form.siteId} onChange={(e) => set('siteId', e.target.value)} data-testid="plan-site">
        <option value="">{t('readiness.cutover.projectWide')}</option>
        {sites.map((s) => (
          <option key={s.id} value={s.id}>
            {siteName(s.id)}
          </option>
        ))}
      </SelectField>
      <SelectField label={t('readiness.cutover.fields.workstream')} value={form.workstreamId} onChange={(e) => set('workstreamId', e.target.value)}>
        <option value="">{t('readiness.common.notSet')}</option>
        {workstreams.map((w) => (
          <option key={w.id} value={w.id}>
            {wsName(w.id)}
          </option>
        ))}
      </SelectField>
      <div className="sm:col-span-2">
        <UserPicker label={t('readiness.cutover.fields.accountable')} value={form.accountable} onChange={(u) => set('accountable', u)} />
      </div>
      <TextAreaField className="sm:col-span-2" label={t('readiness.cutover.fields.runbook')} value={form.runbookSummary} maxLength={8000} onChange={(e) => set('runbookSummary', e.target.value)} data-testid="plan-runbook" />
      <TextField label={t('readiness.cutover.fields.windowStart')} type="datetime-local" value={form.windowStart} onChange={(e) => set('windowStart', e.target.value)} data-testid="plan-window-start" />
      <TextField label={t('readiness.cutover.fields.windowEnd')} type="datetime-local" value={form.windowEnd} onChange={(e) => set('windowEnd', e.target.value)} data-testid="plan-window-end" />
      <TextAreaField className="sm:col-span-2" label={t('readiness.cutover.fields.serviceImpact')} value={form.serviceImpact} maxLength={8000} onChange={(e) => set('serviceImpact', e.target.value)} data-testid="plan-impact" />
      <TextAreaField className="sm:col-span-2" label={t('readiness.cutover.fields.contingency')} value={form.contingencyPlan} maxLength={8000} onChange={(e) => set('contingencyPlan', e.target.value)} data-testid="plan-contingency" />
      <TextAreaField className="sm:col-span-2" label={t('readiness.cutover.fields.rollback')} value={form.rollbackPlan} maxLength={8000} onChange={(e) => set('rollbackPlan', e.target.value)} data-testid="plan-rollback" />
    </div>
  );
}
