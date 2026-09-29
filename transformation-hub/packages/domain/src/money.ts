import Decimal from 'decimal.js';
import { ruleViolation, invalid } from './errors';

/**
 * Money is stored as a decimal string with an ISO 4217 currency and an explicit unit scale
 * (1 = units, 1000 = thousands, 1_000_000 = millions). Never floats (spec §14).
 */
export interface Money {
  amount: string; // decimal string, e.g. "1250000.00"
  currency: string; // ISO 4217, e.g. "SAR"
  unitScale: number; // 1 | 1000 | 1000000
}

export const UNIT_SCALES = [1, 1000, 1_000_000] as const;
const DECIMAL_RE = /^-?\d{1,16}(\.\d{1,4})?$/;
const CURRENCY_RE = /^[A-Z]{3}$/;
const RATE_RE = /^\d{1,10}(\.\d{1,10})?$/;

export function parseMoney(input: { amount: string; currency: string; unitScale?: number }): Money {
  const amount = input.amount.trim();
  if (!DECIMAL_RE.test(amount)) throw invalid('money.invalid_amount', `Invalid decimal amount: ${input.amount}`);
  if (!CURRENCY_RE.test(input.currency)) throw invalid('money.invalid_currency', `Invalid ISO 4217 currency: ${input.currency}`);
  const unitScale = input.unitScale ?? 1;
  if (!(UNIT_SCALES as readonly number[]).includes(unitScale)) {
    throw invalid('money.invalid_unit_scale', `Unit scale must be one of ${UNIT_SCALES.join(', ')}`);
  }
  return { amount: new Decimal(amount).toFixed(4), currency: input.currency, unitScale };
}

/** Value in base units (unitScale applied). */
export function toBaseUnits(m: Money): Decimal {
  return new Decimal(m.amount).mul(m.unitScale);
}

export interface ConversionBasis {
  /** e.g. { from: 'USD', to: 'SAR', rate: '3.75', source: 'Finance-approved rate table 2026-Q3', asOf: '2026-09-30' } */
  from: string;
  to: string;
  rate: string;
  source: string;
  asOf: string;
}

export interface AggregateResult {
  total: Money;
  count: number;
  conversions: ConversionBasis[];
  /** Unit scales that were normalized (disclosed so reports can show the basis). */
  normalizedUnitScales: number[];
}

/**
 * Sums amounts (AT-29). Mixed currencies are rejected unless an explicit conversion basis is provided for each
 * foreign currency. Mixed unit scales (units / thousands / millions) are rejected unless the caller explicitly opts in
 * with `normalizeUnits: true`; when normalized, the scales involved are disclosed in `normalizedUnitScales`.
 */
export function sumMoney(
  items: Money[],
  opts: { targetCurrency?: string; targetUnitScale?: number; conversions?: ConversionBasis[]; normalizeUnits?: boolean } = {},
): AggregateResult {
  if (items.length === 0) {
    const currency = opts.targetCurrency ?? 'SAR';
    return { total: { amount: '0.0000', currency, unitScale: opts.targetUnitScale ?? 1 }, count: 0, conversions: [], normalizedUnitScales: [] };
  }
  const targetCurrency = opts.targetCurrency ?? items[0]!.currency;
  const targetUnitScale = opts.targetUnitScale ?? items[0]!.unitScale;
  const scales = [...new Set([...items.map((i) => i.unitScale), targetUnitScale])];
  if (scales.length > 1 && !opts.normalizeUnits) {
    throw ruleViolation('money.mixed_unit_scale', `Cannot aggregate amounts expressed in different units (${scales.join(', ')}) without explicit normalization`, { scales });
  }
  const used = new Map<string, ConversionBasis>();
  let total = new Decimal(0);
  for (const item of items) {
    let base = toBaseUnits(item);
    if (item.currency !== targetCurrency) {
      const basis = opts.conversions?.find((c) => c.from === item.currency && c.to === targetCurrency);
      if (!basis) {
        throw ruleViolation(
          'money.mixed_currency',
          `Cannot aggregate ${item.currency} with ${targetCurrency} without an explicit conversion basis`,
          { from: item.currency, to: targetCurrency },
        );
      }
      if (!RATE_RE.test(basis.rate) || new Decimal(basis.rate).lte(0)) {
        throw invalid('money.invalid_rate', `Invalid conversion rate ${basis.rate}`);
      }
      base = base.mul(basis.rate);
      used.set(`${basis.from}->${basis.to}`, basis);
    }
    total = total.add(base);
  }
  return {
    total: { amount: total.div(targetUnitScale).toFixed(4), currency: targetCurrency, unitScale: targetUnitScale },
    count: items.length,
    conversions: [...used.values()],
    normalizedUnitScales: scales.length > 1 ? scales.sort((a, b) => a - b) : [],
  };
}

/** Compare two amounts in the same currency (unit scales normalized). */
export function compareMoney(a: Money, b: Money): -1 | 0 | 1 {
  if (a.currency !== b.currency) {
    throw ruleViolation('money.mixed_currency', `Cannot compare ${a.currency} with ${b.currency}`);
  }
  return toBaseUnits(a).comparedTo(toBaseUnits(b)) as -1 | 0 | 1;
}

export function formatMoney(m: Money, locale = 'en'): string {
  const scaleLabel = m.unitScale === 1000 ? (locale === 'ar' ? ' ألف' : 'K') : m.unitScale === 1_000_000 ? (locale === 'ar' ? ' مليون' : 'M') : '';
  const n = new Decimal(m.amount).toFixed(2);
  return `${m.currency} ${n}${scaleLabel}`;
}

/**
 * Heuristic warning (not a professional valuation): flags when EV and equity value are presented as if
 * interchangeable, or when currency/unit differ between compared values (spec §7.5).
 */
export function detectValueBasisConfusion(
  values: { label: string; basis: 'enterprise_value' | 'equity_value' | 'other'; money: Money }[],
): string[] {
  const warnings: string[] = [];
  const bases = new Set(values.map((v) => v.basis));
  if (bases.has('enterprise_value') && bases.has('equity_value')) {
    warnings.push('Values mix enterprise value and equity value; confirm the bridge (net debt, adjustments) with Finance before comparing.');
  }
  const currencies = new Set(values.map((v) => v.money.currency));
  if (currencies.size > 1) warnings.push(`Values use different currencies (${[...currencies].join(', ')}); conversion basis required.`);
  const scales = new Set(values.map((v) => v.money.unitScale));
  if (scales.size > 1) warnings.push('Values use different unit scales; confirm units before comparing.');
  return warnings;
}
