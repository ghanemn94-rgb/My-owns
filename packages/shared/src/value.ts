// Decimal value helpers and the value-pool total (ADR-0019, ADR-0003). Owner: kpi-benefits-engineer.
//
// Rules this module enforces, so API and web cannot drift:
//  - Amounts, KPI values and rates are DECIMAL STRINGS on the wire and decimal.js values in code. Nothing here ever
//    turns an amount into a JavaScript number (no parseFloat, Number() or unary +): binary floats cannot represent
//    0.1 exactly, and money must be exact.
//  - A value must FIT its target column. A value that does not fit is refused; it is never silently rounded:
//      money   numeric(20,4)  at most 16 integer digits and 4 fraction digits (value_pool amounts);
//      measure numeric(24,6)  at most 18 integer digits and 6 fraction digits (baselines, KPI values, targets).
//  - Unknown is not zero. A null amount means Unknown, and a total with no quantified pool is null (Unknown), never
//    "0". An unquantified value pool is counted (`unquantifiedCount`) and never added as 0.
//  - Mixed currencies are never summed: totals are split per currency, and there is no FX conversion in P2.
//  - A validation decision applies to the version it was recorded on. A later edit makes it STALE, and a stale (or
//    rejected, or missing) validation never counts towards a validated total.
import { Decimal } from "decimal.js";

/** decimal.js clone used by every helper: enough significant digits for exact sums of numeric(24,6) values. */
const D = Decimal.clone({ precision: 80, rounding: Decimal.ROUND_HALF_UP, toExpNeg: -80, toExpPos: 80 });
type Dec = InstanceType<typeof D>;

/** The OpenAPI `Decimal` transport pattern (docs/api/openapi.yaml `components.schemas.Decimal`). */
export const DECIMAL_PATTERN = /^-?[0-9]{1,18}(\.[0-9]{1,6})?$/;

export interface DecimalColumn {
  readonly name: "money" | "measure";
  /** PostgreSQL numeric precision (total significant digits). */
  readonly precision: number;
  /** PostgreSQL numeric scale (fraction digits). */
  readonly scale: number;
}

/** numeric(20,4): value-pool upside/downside amounts and other money columns. */
export const MONEY_COLUMN: DecimalColumn = Object.freeze({ name: "money", precision: 20, scale: 4 });
/** numeric(24,6): baseline values, T02 baseline/target values and trajectory points. */
export const MEASURE_COLUMN: DecimalColumn = Object.freeze({ name: "measure", precision: 24, scale: 6 });

export type DecimalProblem = "not_a_string" | "format" | "integer_digits" | "fraction_digits";
export type DecimalCheck = { readonly ok: true } | { readonly ok: false; readonly reason: DecimalProblem };

/**
 * Checks a transport value: it must be a string matching DECIMAL_PATTERN and, when a column is given, fit that column
 * without rounding. A JavaScript number is refused ("not_a_string"): a float may already have lost precision.
 */
export function checkDecimal(input: unknown, column?: DecimalColumn): DecimalCheck {
  if (typeof input !== "string") return { ok: false, reason: "not_a_string" };
  if (!DECIMAL_PATTERN.test(input)) return { ok: false, reason: "format" };
  if (column === undefined) return { ok: true };
  const unsigned = input.startsWith("-") ? input.slice(1) : input;
  const dot = unsigned.indexOf(".");
  const intPart = (dot === -1 ? unsigned : unsigned.slice(0, dot)).replace(/^0+(?=[0-9])/, "");
  const fracPart = dot === -1 ? "" : unsigned.slice(dot + 1).replace(/0+$/, "");
  const maxInt = column.precision - column.scale;
  // "0" and "000" have no significant integer digit.
  const intDigits = intPart === "0" ? 0 : intPart.length;
  if (intDigits > maxInt) return { ok: false, reason: "integer_digits" };
  if (fracPart.length > column.scale) return { ok: false, reason: "fraction_digits" };
  return { ok: true };
}

export function isDecimalString(input: unknown): input is string {
  return checkDecimal(input).ok;
}

export function fitsColumn(input: string, column: DecimalColumn): boolean {
  return checkDecimal(input, column).ok;
}

export class DecimalError extends Error {
  readonly reason: DecimalProblem;
  constructor(reason: DecimalProblem, input: unknown) {
    super(`not a valid decimal (${reason}): ${typeof input === "string" ? JSON.stringify(input) : typeof input}`);
    this.name = "DecimalError";
    this.reason = reason;
  }
}

/** Parses a transport decimal string (optionally checked against a column). Throws DecimalError; never rounds. */
export function parseDecimal(input: string, column?: DecimalColumn): Dec {
  const check = checkDecimal(input, column);
  if (!check.ok) throw new DecimalError(check.reason, input);
  return new D(input);
}

/** Lenient reader for values coming back from PostgreSQL (`numeric` is a string such as "100.0000"). */
function fromStored(value: string): Dec {
  if (!/^-?[0-9]+(\.[0-9]+)?$/.test(value)) throw new DecimalError("format", value);
  return new D(value);
}

/**
 * The value as a string with exactly `column.scale` fraction digits ("100" -> "100.0000" for money). Throws when the
 * value would need rounding or does not fit the column: silent rounding is never acceptable for money.
 */
export function toColumnString(value: string, column: DecimalColumn): string {
  const d = fromStored(value);
  const canonical = canonicalOf(d);
  if (!checkDecimal(canonical, column).ok) {
    throw new DecimalError(d.decimalPlaces() > column.scale ? "fraction_digits" : "integer_digits", value);
  }
  return d.toFixed(column.scale);
}

function canonicalOf(d: Dec): string {
  // toFixed() without an argument prints every significant fraction digit and never uses exponent notation.
  return d.isZero() ? "0" : d.toFixed();
}

/** Canonical form: no trailing fraction zeros, no "-0" ("100.5000" -> "100.5", "-0.00" -> "0"). */
export function canonicalDecimal(value: string): string {
  return canonicalOf(fromStored(value));
}

/** Exact comparison of two decimal strings: -1, 0 or 1. */
export function compareDecimal(a: string, b: string): -1 | 0 | 1 {
  const c = fromStored(a).comparedTo(fromStored(b));
  return c < 0 ? -1 : c > 0 ? 1 : 0;
}

/** Exact sum of decimal strings, as a canonical decimal string. The empty sum is "0" (callers decide Unknown). */
export function sumDecimals(values: readonly string[]): string {
  let total = new D(0);
  for (const v of values) total = total.plus(fromStored(v));
  return canonicalOf(total);
}

// ------------------------------------------------------------------------------------------------ display

export type DisplayLocale = "ar" | "en";

/** Same locale convention as apps/web/src/lib/format.ts: Arabic with Gregorian calendar and Latin digits by default. */
export function intlNumberLocale(locale: DisplayLocale, digits: "latn" | "arab" = "latn"): string {
  return locale === "ar" ? `ar-u-nu-${digits}` : "en-GB";
}

export interface FormatDecimalOptions {
  readonly locale: DisplayLocale;
  /** ISO 4217 code shown with the amount (the code, not a symbol, so SAR is never confused with another riyal). */
  readonly currency?: string | null;
  readonly minFractionDigits?: number;
  /** Display rounding (half-up). Defaults to 2. Stored values are never rounded by this function. */
  readonly maxFractionDigits?: number;
  readonly digits?: "latn" | "arab";
}

/**
 * Formats a decimal string for display without binary floating point (Intl receives the exact decimal string).
 * Returns null for a null/undefined/invalid value: the caller renders "Unknown", never 0.
 */
export function formatDecimal(value: string | null | undefined, options: FormatDecimalOptions): string | null {
  if (value === null || value === undefined) return null;
  let d: Dec;
  try {
    d = fromStored(value);
  } catch (e) {
    // ADR-0024 §6 (F-DG3-100 round 4): this module is in the formula engine's import closure, and the engine rethrows a
    // refused code generation (EvalError) instead of converting it. It cannot occur: nothing here generates code.
    if (e instanceof EvalError) throw e;
    return null;
  }
  const max = options.maxFractionDigits ?? 2;
  const min = Math.min(options.minFractionDigits ?? 0, max);
  const fixed = d.toDecimalPlaces(max, D.ROUND_HALF_UP).toFixed() as Intl.StringNumericLiteral;
  const nf = new Intl.NumberFormat(intlNumberLocale(options.locale, options.digits), {
    minimumFractionDigits: min,
    maximumFractionDigits: max,
    useGrouping: true,
  });
  const text = nf.format(fixed);
  if (!options.currency) return text;
  return options.locale === "ar" ? `${text} ${options.currency}` : `${options.currency} ${text}`;
}

// ------------------------------------------------------------------------------------------------ validation state

export type ValidationState = "unvalidated" | "validated" | "rejected" | "stale";

/**
 * Finance validation as the UI and the gate criteria must read it (ADR-0019 §3). A decision recorded on an earlier
 * version than the record's current one is STALE: the record changed after Finance looked at it.
 */
export function validationState(r: {
  readonly validationStatus: string;
  readonly validatedRecordVersion: number | null;
  readonly version: number;
}): ValidationState {
  if (r.validationStatus === "unvalidated" || r.validatedRecordVersion === null) return "unvalidated";
  if (r.validatedRecordVersion < r.version) return "stale";
  return r.validationStatus === "validated" ? "validated" : "rejected";
}

// ------------------------------------------------------------------------------------------------ value-pool totals

export interface ValuePoolForTotal {
  readonly quantificationStatus: "quantified" | "unquantified" | string;
  readonly upsideAmount: string | null;
  readonly downsideAmount: string | null;
  readonly currency: string;
  /** Archived pools are excluded from totals. */
  readonly status?: string;
  readonly validationStatus?: string;
  readonly validatedRecordVersion?: number | null;
  readonly version?: number;
}

export type ValuePoolTotalBasis = "all" | "validated";

export interface ValuePoolTotal {
  readonly currency: string;
  /** Sum of the quantified pools of this currency, or null (Unknown) when none is quantified. Never "0" for none. */
  readonly quantifiedTotal: { readonly downside: string; readonly upside: string } | null;
  /** Pools of this currency that are explicitly unquantified. When > 0 the total is "partial: N unquantified". */
  readonly unquantifiedCount: number;
  readonly quantifiedCount: number;
  readonly basis: ValuePoolTotalBasis;
  /**
   * Basis "validated" only: quantified pools left out because Finance has not validated their current version
   * (unvalidated, rejected or stale). Always 0 for basis "all".
   */
  readonly notValidatedCount: number;
}

/**
 * The value-pool total of ADR-0019 §5, one entry per currency (sorted by currency code). Amounts are money-scale
 * decimal strings ("100.0000"). With `basis: "validated"` only pools whose CURRENT version Finance validated are
 * summed, so a submission or an edit never raises a validated total before Finance approves it.
 */
export function totalValuePools(
  pools: readonly ValuePoolForTotal[],
  options: { readonly basis?: ValuePoolTotalBasis } = {},
): ValuePoolTotal[] {
  const basis = options.basis ?? "all";
  const groups = new Map<string, { down: Dec; up: Dec; q: number; u: number; nv: number }>();
  for (const p of pools) {
    if (p.status === "archived") continue;
    let g = groups.get(p.currency);
    if (!g) {
      g = { down: new D(0), up: new D(0), q: 0, u: 0, nv: 0 };
      groups.set(p.currency, g);
    }
    if (p.quantificationStatus !== "quantified") {
      g.u += 1;
      continue;
    }
    if (p.upsideAmount === null || p.downsideAmount === null) {
      // The database refuses this (CHECK value_pool_quantification); treat a malformed row as Unknown, never 0.
      g.u += 1;
      continue;
    }
    if (basis === "validated") {
      const state = validationState({
        validationStatus: p.validationStatus ?? "unvalidated",
        validatedRecordVersion: p.validatedRecordVersion ?? null,
        version: p.version ?? Number.MAX_SAFE_INTEGER,
      });
      if (state !== "validated") {
        g.nv += 1;
        continue;
      }
    }
    g.q += 1;
    g.down = g.down.plus(fromStored(p.downsideAmount));
    g.up = g.up.plus(fromStored(p.upsideAmount));
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([currency, g]) => ({
      currency,
      quantifiedTotal:
        g.q === 0 ? null : { downside: g.down.toFixed(MONEY_COLUMN.scale), upside: g.up.toFixed(MONEY_COLUMN.scale) },
      unquantifiedCount: g.u,
      quantifiedCount: g.q,
      basis,
      notValidatedCount: g.nv,
    }));
}

/** The total for one currency; a currency with no pool at all is `{ quantifiedTotal: null, unquantifiedCount: 0 }`. */
export function totalValuePoolsIn(
  pools: readonly ValuePoolForTotal[],
  currency: string,
  options: { readonly basis?: ValuePoolTotalBasis } = {},
): ValuePoolTotal {
  const basis = options.basis ?? "all";
  return (
    totalValuePools(
      pools.filter((p) => p.currency === currency),
      options,
    )[0] ?? { currency, quantifiedTotal: null, unquantifiedCount: 0, quantifiedCount: 0, basis, notValidatedCount: 0 }
  );
}

/** True when the UI must label the total "partial: N unquantified" (ADR-0019 §5). */
export function isPartialTotal(total: ValuePoolTotal): boolean {
  return total.unquantifiedCount > 0;
}
