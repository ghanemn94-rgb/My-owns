'use client';

import { EM_DASH, useI18n } from '@/i18n/provider';
import { SelectField, TextField } from '../Field';

/**
 * Structured money for change control (DOM-P2-03): decimal string + ISO 4217 currency + unit scale, never a float.
 * `0` records "no cost impact". Nothing is pre-filled from assumptions: the amount stays empty until someone enters it.
 */
export interface MoneyInput {
  amount: string;
  currency: string;
  unitScale: '1' | '1000' | '1000000';
}
export interface MoneyValue {
  amount: string;
  currency: string;
  unitScale: 1 | 1000 | 1000000;
}

const DECIMAL = /^\d{1,16}(\.\d{1,4})?$/;
const CURRENCY = /^[A-Z]{3}$/;

export function moneyInputOf(v: MoneyValue | null | undefined): MoneyInput {
  return { amount: v ? normalizeDecimal(v.amount) : '', currency: v?.currency ?? 'SAR', unitScale: String(v?.unitScale ?? 1) as MoneyInput['unitScale'] };
}

/** "1500000.0000" → "1500000"; "12.5000" → "12.5" (display / edit only; the server stores numeric(20,4)). */
export function normalizeDecimal(amount: string): string {
  const m = /^(-?\d+)(?:\.(\d+))?$/.exec(amount.trim());
  if (!m) return amount;
  const fraction = (m[2] ?? '').replace(/0+$/, '');
  return fraction ? `${m[1]}.${fraction}` : (m[1] ?? amount);
}

/** Validation: `null` = nothing entered (no money), `'invalid'` = incomplete / malformed, otherwise the money value. */
export function parseMoney(i: MoneyInput): MoneyValue | null | 'invalid' {
  const amount = i.amount.trim();
  if (!amount) return null;
  const currency = i.currency.trim().toUpperCase();
  if (!DECIMAL.test(amount) || !CURRENCY.test(currency)) return 'invalid';
  return { amount, currency, unitScale: Number(i.unitScale) as MoneyValue['unitScale'] };
}

export function MoneyFields({ legend, hint, value, onChange, testId }: { legend: string; hint?: string; value: MoneyInput; onChange: (v: MoneyInput) => void; testId?: string }) {
  const { t } = useI18n();
  const amount = value.amount.trim();
  const amountBad = amount !== '' && !DECIMAL.test(amount);
  const currencyBad = amount !== '' && !CURRENCY.test(value.currency.trim().toUpperCase());
  return (
    <fieldset className="space-y-2" data-testid={testId}>
      <legend className="text-sm font-medium text-ink">{legend}</legend>
      {hint ? <p className="text-xs text-muted">{hint}</p> : null}
      <div className="grid gap-3 sm:grid-cols-3">
        <TextField
          label={t('planning.money.amount')}
          dir="ltr"
          inputMode="decimal"
          value={value.amount}
          onChange={(e) => onChange({ ...value, amount: e.target.value })}
          error={amountBad ? t('planning.money.amountInvalid') : null}
          data-testid={testId ? `${testId}-amount` : undefined}
        />
        <TextField
          label={t('planning.money.currency')}
          dir="ltr"
          maxLength={3}
          value={value.currency}
          onChange={(e) => onChange({ ...value, currency: e.target.value.toUpperCase() })}
          error={currencyBad ? t('planning.money.currencyInvalid') : null}
          data-testid={testId ? `${testId}-currency` : undefined}
        />
        <SelectField label={t('planning.money.unitScale')} value={value.unitScale} onChange={(e) => onChange({ ...value, unitScale: e.target.value as MoneyInput['unitScale'] })} data-testid={testId ? `${testId}-unit` : undefined}>
          {(['1', '1000', '1000000'] as const).map((u) => (
            <option key={u} value={u}>
              {t(`planning.money.units.${u}`)}
            </option>
          ))}
        </SelectField>
      </div>
    </fieldset>
  );
}

/** Groups a decimal string for display without going through a float ("1500000.0000" → "1,500,000"). */
export function groupDecimal(amount: string): string {
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(amount.trim());
  if (!m) return amount;
  const fraction = (m[3] ?? '').replace(/0+$/, '');
  const whole = (m[2] ?? '').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${m[1] ?? ''}${whole}${fraction ? `.${fraction}` : ''}`;
}

export function MoneyText({ value, testId }: { value: MoneyValue | { amount: string; currency: string; unitScale: number } | null | undefined; testId?: string }) {
  const { t } = useI18n();
  if (!value) return <span className="text-muted">{EM_DASH}</span>;
  const zero = /^0+(\.0+)?$/.test(value.amount.trim());
  const unit = value.unitScale === 1000 || value.unitScale === 1000000 ? ` × ${t(`planning.money.units.${value.unitScale === 1000 ? '1000' : '1000000'}`)}` : '';
  return (
    <span className="inline-flex flex-wrap items-center gap-2" data-testid={testId}>
      <span dir="ltr" className="tabular">
        {groupDecimal(value.amount)} {value.currency}
        {unit}
      </span>
      {zero ? <span className="text-xs text-muted">{t('planning.money.none')}</span> : null}
    </span>
  );
}
