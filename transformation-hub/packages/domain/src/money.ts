import Decimal from 'decimal.js';
import { ruleViolation, invalid } from './errors';
import { assertIsoDate } from './calendar';
import { renderMessagesEn, serverMessage, ServerMessage } from './messages';

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
export type UnitScale = (typeof UNIT_SCALES)[number];
const DECIMAL_RE = /^-?\d{1,16}(\.\d{1,4})?$/;
const CURRENCY_RE = /^[A-Z]{3}$/;
const RATE_RE = /^\d{1,10}(\.\d{1,10})?$/;

export function isUnitScale(n: number): n is UnitScale {
  return (UNIT_SCALES as readonly number[]).includes(n);
}

export function parseMoney(input: { amount: string; currency: string; unitScale?: number }): Money {
  const amount = input.amount.trim();
  if (!DECIMAL_RE.test(amount)) throw invalid('money.invalid_amount', `Invalid decimal amount: ${input.amount}`);
  if (!CURRENCY_RE.test(input.currency)) throw invalid('money.invalid_currency', `Invalid ISO 4217 currency: ${input.currency}`);
  const unitScale = input.unitScale ?? 1;
  if (!isUnitScale(unitScale)) {
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

/**
 * A conversion basis is supplied by a person (never invented by the platform): ISO currencies, a positive decimal rate
 * (1 `from` = rate `to`), a named source and the business date the rate applies to.
 */
export function assertConversionBasis(b: ConversionBasis): void {
  if (!CURRENCY_RE.test(b.from) || !CURRENCY_RE.test(b.to)) throw invalid('money.invalid_currency', `Invalid conversion currencies ${b.from} → ${b.to}`);
  if (b.from === b.to) throw invalid('money.invalid_conversion', `A conversion basis must convert between two different currencies (${b.from})`);
  if (!RATE_RE.test(b.rate) || new Decimal(b.rate).lte(0)) throw invalid('money.invalid_rate', `Invalid conversion rate ${b.rate}`);
  if (!b.source || b.source.trim().length < 3) throw invalid('money.conversion_source_required', `The conversion basis ${b.from} → ${b.to} must name its source`);
  try {
    assertIsoDate(b.asOf);
  } catch {
    throw invalid('money.conversion_date_required', `The conversion basis ${b.from} → ${b.to} must give the date of the rate (YYYY-MM-DD)`);
  }
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
 * An empty sum needs an explicit target currency (the platform never assumes one).
 */
export function sumMoney(
  items: Money[],
  opts: { targetCurrency?: string; targetUnitScale?: number; conversions?: ConversionBasis[]; normalizeUnits?: boolean } = {},
): AggregateResult {
  for (const c of opts.conversions ?? []) assertConversionBasis(c);
  if (opts.targetCurrency !== undefined && !CURRENCY_RE.test(opts.targetCurrency)) throw invalid('money.invalid_currency', `Invalid ISO 4217 currency: ${opts.targetCurrency}`);
  if (opts.targetUnitScale !== undefined && !isUnitScale(opts.targetUnitScale)) throw invalid('money.invalid_unit_scale', `Unit scale must be one of ${UNIT_SCALES.join(', ')}`);
  if (items.length === 0) {
    if (!opts.targetCurrency) throw invalid('money.currency_required', 'An empty sum needs an explicit target currency');
    return { total: { amount: '0.0000', currency: opts.targetCurrency, unitScale: opts.targetUnitScale ?? 1 }, count: 0, conversions: [], normalizedUnitScales: [] };
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

/**
 * Two amounts that are combined as-is (booked into the same line, reconciled against each other) must be expressed in the
 * same currency AND unit scale: 1.2 (millions) booked into a line kept in thousands is a unit confusion, not a number.
 */
export function assertSameUnit(a: Pick<Money, 'currency' | 'unitScale'>, b: Pick<Money, 'currency' | 'unitScale'>, what: string): void {
  if (a.currency !== b.currency) {
    throw ruleViolation('money.mixed_currency', `${what}: ${b.currency} cannot be combined with ${a.currency} (no conversion is applied here)`, { expected: a.currency, got: b.currency });
  }
  if (a.unitScale !== b.unitScale) {
    throw ruleViolation('money.mixed_unit_scale', `${what}: an amount in unit scale ${b.unitScale} cannot be combined with unit scale ${a.unitScale}`, { expected: a.unitScale, got: b.unitScale });
  }
}

/** a − b in the same currency and unit scale. */
export function subtractMoney(a: Money, b: Money): Money {
  assertSameUnit(a, b, 'Difference');
  return { amount: new Decimal(a.amount).sub(b.amount).toFixed(4), currency: a.currency, unitScale: a.unitScale };
}

export function isZeroMoney(m: Money): boolean {
  return new Decimal(m.amount).isZero();
}

export function isNegativeMoney(m: Money): boolean {
  return new Decimal(m.amount).isNegative() && !new Decimal(m.amount).isZero();
}

export function formatMoney(m: Money, locale = 'en'): string {
  const scaleLabel = m.unitScale === 1000 ? (locale === 'ar' ? ' ألف' : 'K') : m.unitScale === 1_000_000 ? (locale === 'ar' ? ' مليون' : 'M') : '';
  const n = new Decimal(m.amount).toFixed(2);
  return `${m.currency} ${n}${scaleLabel}`;
}

// ---------------------------------------------------------------------------------------------------------
// Value basis (EV vs equity) and unit/currency confusion — heuristics, never a professional valuation (spec §7.5)

export type ValueBasis = 'enterprise_value' | 'equity_value' | 'other';

/** Code → English template of the value-basis findings (the web translates the codes; module guide §2). */
export const VALUE_BASIS_MESSAGES_EN: Readonly<Record<string, string>> = {
  'finance.value.ev_equity_mix':
    'Values mix enterprise value and equity value ({evCount} EV, {equityCount} equity); confirm the bridge (net debt, adjustments) with Finance before comparing. This is a consistency check, not a professional valuation.',
  'finance.value.currency_mix': 'Values use different currencies ({currencies}); a conversion basis (rate, source, date) is required before combining them.',
  'finance.value.unit_mix': 'Values use different unit scales ({scales}); confirm the units before comparing them.',
};

/** Findings (codes + parameters) for a set of values presented together. */
export function valueBasisFindings(values: { label: string; basis: ValueBasis; money: Money }[]): ServerMessage[] {
  const out: ServerMessage[] = [];
  const ev = values.filter((v) => v.basis === 'enterprise_value').length;
  const eq = values.filter((v) => v.basis === 'equity_value').length;
  if (ev > 0 && eq > 0) out.push(serverMessage('finance.value.ev_equity_mix', { evCount: ev, equityCount: eq }));
  const currencies = [...new Set(values.map((v) => v.money.currency))].sort();
  if (currencies.length > 1) out.push(serverMessage('finance.value.currency_mix', { currencies: currencies.join(', ') }));
  const scales = [...new Set(values.map((v) => v.money.unitScale))].sort((a, b) => a - b);
  if (scales.length > 1) out.push(serverMessage('finance.value.unit_mix', { scales: scales.join(', ') }));
  return out;
}

/**
 * Heuristic warning (not a professional valuation): flags when EV and equity value are presented as if
 * interchangeable, or when currency/unit differ between compared values (spec §7.5). English rendering of
 * {@link valueBasisFindings}.
 */
export function detectValueBasisConfusion(values: { label: string; basis: ValueBasis; money: Money }[]): string[] {
  return valueBasisFindings(values).map((m) => renderMessagesEn([m], VALUE_BASIS_MESSAGES_EN));
}
