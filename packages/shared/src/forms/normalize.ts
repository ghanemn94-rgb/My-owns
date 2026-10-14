// Normalizers of the Studio field types (REQ-S06-005; ADR-0041 §3, §7). Owner: kpi-benefits-engineer (T-DG5-KBE-B).
// Pure: no I/O, no float. Every number stays a decimal STRING; decimal.js does the only arithmetic (the × 1/100 of a
// percentage), and nothing is ever rounded: a value that does not fit is refused, never cut.
//
//  - Percentage: "12%" and "12 %" (and the Arabic percent sign "12٪") are PERCENT; a bare "12" is percent when typed
//    by a user (`bareAs: "percent"`, the web entry) and a FRACTION in an API body (`bareAs: "fraction"`, the default:
//    "the API body carries the fraction", ADR-0041 §3). Both store the fraction string: 12% → "0.12" (percentage
//    points are never involved: this is a level, not a change).
//  - Currency: `{amount, currencyCode}`; a bare amount string takes the field's currency. The amount string is kept
//    EXACTLY as entered ("1500000.10" stays "1500000.10"; no float on any path).
//  - Date: a calendar date `YYYY-MM-DD`; an instant becomes the calendar date in the transformation timezone
//    (default Asia/Riyadh), with the same rule as `businessDateOf` (ADR-0025 §2).
import { businessDateOf, isKnownTimeZone } from "../time/business-date.ts";
import { isBusinessDate } from "../time/working-days.ts";
import { CURRENCY_CODE_PATTERN, FD, FIELD_DECIMAL_PATTERN, FIELD_LIMITS, significantScale } from "./field-types.ts";

/** The default transformation timezone (CLAUDE.md; configurable per organization). */
export const DEFAULT_TIME_ZONE = "Asia/Riyadh";

export type NormalizeResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: string };

/** A body of ASCII digits, optional sign and point; Arabic-Indic, Persian and full-width digits never match. */
const PERCENT_BODY = /^-?[0-9]{1,17}(\.[0-9]{1,8})?$/;
const PERCENT_SIGNS = ["%", "٪"]; // "%" and ARABIC PERCENT SIGN "٪"

/** Canonical decimal text of a decimal.js value: no exponent, no trailing zeros, "-0" → "0". */
function canonical(d: InstanceType<typeof FD>): string {
  return d.isZero() ? "0" : d.toFixed();
}

/** True when `value` fits a stored field decimal: at most 15 integer and 6 fraction digits. */
export function fitsFieldDecimal(value: string): boolean {
  return FIELD_DECIMAL_PATTERN.test(value);
}

export interface PercentageInputOptions {
  /** How to read a value with no percent sign: "fraction" (API body, default) or "percent" (typed by a user). */
  readonly bareAs?: "fraction" | "percent";
}

/**
 * Normalizes a percentage input to its FRACTION string (ADR-0041 §3): "12%" → "0.12", "12" (bareAs percent) →
 * "0.12", "0.12" (bareAs fraction) → "0.12", "12.5 %" → "0.125". Surrounding ASCII spaces and one space before the
 * sign are allowed. A JavaScript number is refused (a float may already have lost precision), as are exponents,
 * thousands separators, non-ASCII digits and a fraction with more than 6 decimals (never rounded).
 */
export function normalizePercentage(input: unknown, options: PercentageInputOptions = {}): NormalizeResult<string> {
  if (typeof input !== "string") return { ok: false, reason: "not_a_string" };
  let body = input.replace(/^ +| +$/g, "");
  let percent = (options.bareAs ?? "fraction") === "percent";
  const sign = PERCENT_SIGNS.find((s) => body.endsWith(s));
  if (sign !== undefined) {
    percent = true;
    body = body.slice(0, -sign.length).replace(/ $/, "");
  }
  if (!PERCENT_BODY.test(body)) return { ok: false, reason: "format" };
  const d = new FD(body);
  const fraction = canonical(percent ? d.div(100) : d);
  if (!fitsFieldDecimal(fraction)) return { ok: false, reason: "out_of_range" };
  return { ok: true, value: fraction };
}

/** The percent number of a stored fraction, for display and for pre-filling an input: "0.12" → "12". */
export function fractionToPercent(fraction: string): string | null {
  if (!fitsFieldDecimal(fraction)) return null;
  return canonical(new FD(fraction).times(100));
}

export interface CurrencyValue {
  readonly amount: string;
  readonly currencyCode: string;
}

/**
 * Normalizes a currency input to `{amount, currencyCode}` (ADR-0041 §3). Accepts the object (exactly `amount` and an
 * optional `currencyCode`) or a bare amount string; an absent code takes `fieldCurrency`. The amount is returned
 * verbatim. Reasons: `amount` (not a decimal string within 15 integer digits and `scale` significant decimals),
 * `currency_code` (not three capital letters), `shape` (anything else).
 */
export function normalizeCurrency(
  input: unknown,
  fieldCurrency: string,
  scale: number = FIELD_LIMITS.currencyMaxScale,
):
  | { readonly ok: true; readonly value: CurrencyValue }
  | { readonly ok: false; readonly reason: "amount" | "currency_code" | "shape" } {
  let amount: unknown;
  let code: unknown = fieldCurrency;
  if (typeof input === "string") {
    amount = input;
  } else if (typeof input === "object" && input !== null && !Array.isArray(input)) {
    const keys = Object.keys(input);
    if (!keys.includes("amount") || keys.some((k) => k !== "amount" && k !== "currencyCode")) {
      return { ok: false, reason: "shape" };
    }
    amount = (input as Record<string, unknown>)["amount"];
    if (keys.includes("currencyCode")) code = (input as Record<string, unknown>)["currencyCode"];
  } else {
    return { ok: false, reason: typeof input === "number" ? "amount" : "shape" };
  }
  if (typeof amount !== "string" || !FIELD_DECIMAL_PATTERN.test(amount) || significantScale(amount) > scale) {
    return { ok: false, reason: "amount" };
  }
  if (typeof code !== "string" || !CURRENCY_CODE_PATTERN.test(code)) return { ok: false, reason: "currency_code" };
  return { ok: true, value: { amount, currencyCode: code } };
}

/** A calendar date `YYYY-MM-DD` that exists (2026-02-30 does not). */
export function normalizeDate(input: unknown): NormalizeResult<string> {
  if (typeof input !== "string") return { ok: false, reason: "not_a_string" };
  if (!isBusinessDate(input)) return { ok: false, reason: "format" };
  return { ok: true, value: input };
}

/**
 * The field date of an instant in the transformation timezone (default Asia/Riyadh): 2026-11-01T21:30:00Z is
 * 2026-11-02 in Riyadh (00:30 local), not the UTC date. Used for "today" defaults and for date inputs the web takes
 * as an instant. An unknown zone or an invalid instant is refused, never replaced by UTC.
 */
export function fieldDateOf(at: Date | string, timeZone: string = DEFAULT_TIME_ZONE): NormalizeResult<string> {
  if (!isKnownTimeZone(timeZone)) return { ok: false, reason: "time_zone" };
  try {
    return { ok: true, value: businessDateOf(at, timeZone) };
  } catch {
    return { ok: false, reason: "instant" };
  }
}
