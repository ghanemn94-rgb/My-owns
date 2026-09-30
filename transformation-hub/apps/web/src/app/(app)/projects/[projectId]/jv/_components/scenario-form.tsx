'use client';

import { Plus, Trash2 } from 'lucide-react';
import { TextField, TextAreaField } from '@/components/Field';
import { btn } from '@/components/ui';
import { useI18n } from '@/i18n/provider';
import type { Scenario } from '@/lib/jv';

export interface OwnershipDraft {
  party: string;
  /** Empty = not determined (TBD). Never pre-filled by the platform. */
  percent: string;
  note: string;
}
export interface ContributionDraft {
  party: string;
  description: string;
  amount: string;
  currency: string;
  unitScale: '' | '1' | '1000' | '1000000';
}

export const emptyOwnership = (): OwnershipDraft => ({ party: '', percent: '', note: '' });
export const emptyContribution = (): ContributionDraft => ({ party: '', description: '', amount: '', currency: '', unitScale: '' });

export function ownershipBody(rows: OwnershipDraft[]) {
  return rows.filter((r) => r.party.trim()).map((r) => ({ party: r.party.trim(), percent: r.percent.trim() || null, note: r.note.trim() || null }));
}

export function contributionBody(rows: ContributionDraft[]) {
  return rows
    .filter((r) => r.party.trim() && r.description.trim())
    .map((r) => ({
      party: r.party.trim(),
      description: r.description.trim(),
      ...(r.amount.trim() && r.currency.trim() && r.unitScale ? { amount: r.amount.trim(), currency: r.currency.trim().toUpperCase(), unitScale: Number(r.unitScale) as 1 | 1000 | 1000000 } : {}),
    }));
}

/**
 * Ownership lines: parties and — only when a person enters them — percentages. An empty percentage stays "TBD"; the
 * platform never proposes, defaults or derives a split or a controlling party (REQ-JV-007).
 */
export function OwnershipEditor({ rows, onChange }: { rows: OwnershipDraft[]; onChange: (rows: OwnershipDraft[]) => void }) {
  const { t } = useI18n();
  const set = (i: number, patch: Partial<OwnershipDraft>) => onChange(rows.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <fieldset className="space-y-2" data-testid="ownership-editor">
      <legend className="text-sm font-semibold text-ink">{t('jv.scenarios.ownership')}</legend>
      <p className="text-xs text-muted">{t('jv.scenarios.ownershipHint')}</p>
      {rows.map((r, i) => (
        <div key={i} className="grid gap-2 rounded-md border border-line p-3 sm:grid-cols-[1fr_7rem_1fr_auto] sm:items-end">
          <TextField label={t('jv.scenarios.party')} value={r.party} maxLength={200} onChange={(e) => set(i, { party: e.target.value })} data-testid="ownership-party" />
          <TextField label={t('jv.scenarios.percent')} placeholder={t('jv.scenarios.tbd')} inputMode="decimal" value={r.percent} maxLength={8} onChange={(e) => set(i, { percent: e.target.value })} dir="ltr" data-testid="ownership-percent" />
          <TextField label={t('jv.common.note')} value={r.note} maxLength={1000} onChange={(e) => set(i, { note: e.target.value })} />
          <button type="button" className={btn.ghost} onClick={() => onChange(rows.filter((_, j) => j !== i))} aria-label={t('jv.scenarios.removeLine', { n: i + 1 })}>
            <Trash2 aria-hidden="true" className="size-4" />
          </button>
        </div>
      ))}
      <button type="button" className={btn.secondary} onClick={() => onChange([...rows, emptyOwnership()])} data-testid="add-ownership">
        <Plus aria-hidden="true" className="size-4" />
        {t('jv.scenarios.addParty')}
      </button>
    </fieldset>
  );
}

export function ContributionEditor({ rows, onChange }: { rows: ContributionDraft[]; onChange: (rows: ContributionDraft[]) => void }) {
  const { t } = useI18n();
  const set = (i: number, patch: Partial<ContributionDraft>) => onChange(rows.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-semibold text-ink">{t('jv.scenarios.contributions')}</legend>
      <p className="text-xs text-muted">{t('jv.scenarios.contributionsHint')}</p>
      {rows.map((r, i) => (
        <div key={i} className="grid gap-2 rounded-md border border-line p-3 sm:grid-cols-2">
          <TextField label={t('jv.scenarios.party')} value={r.party} maxLength={200} onChange={(e) => set(i, { party: e.target.value })} />
          <TextField label={t('jv.scenarios.contribution')} value={r.description} maxLength={2000} onChange={(e) => set(i, { description: e.target.value })} />
          <TextField label={t('jv.common.amount')} placeholder={t('jv.scenarios.tbd')} inputMode="decimal" value={r.amount} maxLength={24} onChange={(e) => set(i, { amount: e.target.value })} dir="ltr" />
          <div className="grid grid-cols-2 gap-2">
            <TextField label={t('jv.common.currency')} value={r.currency} maxLength={3} onChange={(e) => set(i, { currency: e.target.value })} dir="ltr" />
            <label className="flex flex-col gap-1 text-sm font-medium text-ink">
              {t('jv.common.unitScale')}
              <select className="block min-h-10 w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-sm" value={r.unitScale} onChange={(e) => set(i, { unitScale: e.target.value as ContributionDraft['unitScale'] })}>
                <option value="">{t('jv.common.none')}</option>
                <option value="1">{t('jv.common.units.1')}</option>
                <option value="1000">{t('jv.common.units.1000')}</option>
                <option value="1000000">{t('jv.common.units.1000000')}</option>
              </select>
            </label>
          </div>
          <div className="sm:col-span-2">
            <button type="button" className={btn.ghost} onClick={() => onChange(rows.filter((_, j) => j !== i))}>
              <Trash2 aria-hidden="true" className="size-4" />
              {t('jv.scenarios.removeLine', { n: i + 1 })}
            </button>
          </div>
        </div>
      ))}
      <button type="button" className={btn.secondary} onClick={() => onChange([...rows, emptyContribution()])}>
        <Plus aria-hidden="true" className="size-4" />
        {t('jv.scenarios.addContribution')}
      </button>
    </fieldset>
  );
}

export function TermsFields({ governance, assumptions, onGovernance, onAssumptions }: { governance: string; assumptions: string; onGovernance: (v: string) => void; onAssumptions: (v: string) => void }) {
  const { t } = useI18n();
  return (
    <>
      <TextAreaField label={t('jv.scenarios.governanceTerms')} value={governance} maxLength={8000} onChange={(e) => onGovernance(e.target.value)} />
      <TextAreaField label={t('jv.scenarios.assumptions')} value={assumptions} maxLength={8000} onChange={(e) => onAssumptions(e.target.value)} />
    </>
  );
}

/** The entered percentages per party — or "TBD" markers; never a computed or assumed split. */
export function OwnershipSummary({ s }: { s: Pick<Scenario, 'ownership' | 'ownershipComplete' | 'ownershipTotal'> }) {
  const { t } = useI18n();
  if (s.ownership.length === 0) return <span className="text-xs text-muted">{t('jv.scenarios.noParties')}</span>;
  return (
    <span className="flex flex-col gap-0.5 text-xs" data-testid="ownership-summary" data-complete={s.ownershipComplete ? 'true' : 'false'}>
      {s.ownership.map((o, i) => (
        <span key={i}>
          <span dir="auto">{o.party}</span>:{' '}
          {o.percent === null ? <span className="font-medium text-warning">{t('jv.scenarios.tbd')}</span> : <span className="tabular font-medium" dir="ltr">{t('jv.scenarios.percentValue', { percent: o.percent })}</span>}
        </span>
      ))}
    </span>
  );
}


/** "Version 2" when the label is the default "v2"; otherwise "v2 · <label>" (labels are free text entered by people). */
export function VersionText({ no, label }: { no: number; label: string }) {
  const { t } = useI18n();
  return <span dir="auto">{label.trim() === `v${no}` || !label.trim() ? t('jv.scenarios.versionOnly', { no }) : t('jv.scenarios.versionValue', { no, label })}</span>;
}
