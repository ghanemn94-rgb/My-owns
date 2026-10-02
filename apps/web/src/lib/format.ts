// Locale-aware formatting (ADR-0009 §2, REQ-S15-007/008). All output goes through Intl.
//  - Arabic uses the Gregorian calendar and Latin digits so identifiers, dates and numbers stay readable next to
//    technical codes ("TR-0001", "12.5%"); English uses en-GB (day month year, 24-hour clock).
//  - Dates are shown in the RECORD's time zone (default Asia/Riyadh), with the zone named.
//  - Money and rates are decimal strings formatted without binary floating point (decimal.js + Intl string input).
import Decimal from "decimal.js";
import { DEFAULTS, type Locale } from "@mth/shared";

export function intlLocale(locale: Locale): string {
  return locale === "ar" ? "ar-u-ca-gregory-nu-latn" : "en-GB";
}

/** "30 Sept 2026, 22:10" in the given zone; null/invalid input yields null (the caller renders Unknown). */
export function formatDateTime(
  iso: string | null | undefined,
  locale: Locale,
  timeZone: string = DEFAULTS.timezone,
): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(intlLocale(locale), {
    dateStyle: "medium",
    timeStyle: "short",
    hourCycle: "h23",
    timeZone,
  }).format(date);
}

export function formatDate(
  iso: string | null | undefined,
  locale: Locale,
  timeZone: string = DEFAULTS.timezone,
): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: "medium", timeZone }).format(date);
}

/**
 * Formats a decimal string exactly (no float rounding: "0.1" + "0.2" artefacts cannot occur because the value is never
 * a JS number). Rounds half-up to `maxFractionDigits`. Returns null for null/invalid input so the UI shows Unknown,
 * never 0.
 */
export function formatDecimal(
  value: string | null | undefined,
  locale: Locale,
  options: { minFractionDigits?: number; maxFractionDigits?: number } = {},
): string | null {
  const d = toDecimal(value);
  if (!d) return null;
  const max = options.maxFractionDigits ?? 2;
  const min = Math.min(options.minFractionDigits ?? 0, max);
  const fixed = d.toDecimalPlaces(max, Decimal.ROUND_HALF_UP).toFixed();
  return new Intl.NumberFormat(intlLocale(locale), {
    minimumFractionDigits: min,
    maximumFractionDigits: max,
  }).format(fixed as Intl.StringNumericLiteral);
}

/** Money as a decimal string in an ISO 4217 currency (default SAR). */
export function formatMoney(
  value: string | null | undefined,
  currency: string = DEFAULTS.currency,
  locale: Locale,
): string | null {
  const d = toDecimal(value);
  if (!d) return null;
  const nf = new Intl.NumberFormat(intlLocale(locale), { style: "currency", currency });
  const digits = nf.resolvedOptions().maximumFractionDigits ?? 2;
  return nf.format(d.toDecimalPlaces(digits, Decimal.ROUND_HALF_UP).toFixed() as Intl.StringNumericLiteral);
}

function toDecimal(value: string | null | undefined): Decimal | null {
  if (value === null || value === undefined || value.trim() === "") return null;
  try {
    const d = new Decimal(value);
    return d.isFinite() ? d : null;
  } catch {
    return null;
  }
}

/**
 * Converts a wall-clock "YYYY-MM-DDTHH:mm" in `timeZone` to a UTC RFC 3339 instant (used for assignment effective
 * dates entered in the organization's zone, not the browser's).
 */
export function zonedLocalToUtcIso(local: string, timeZone: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(local);
  if (!m) return null;
  const [y, mo, d, h, mi] = [m[1], m[2], m[3], m[4] ?? "00", m[5] ?? "00"].map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ];
  const asUtc = Date.UTC(y, mo - 1, d, h, mi);
  // Offset of the zone at that instant; iterate once more to settle around DST changes.
  let guess = asUtc - offsetMs(asUtc, timeZone);
  guess = asUtc - offsetMs(guess, timeZone);
  return new Date(guess).toISOString();
}

function offsetMs(epoch: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(epoch));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const wall = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return wall - Math.floor(epoch / 1000) * 1000;
}

/**
 * A business date "YYYY-MM-DD" (a calendar date in the transformation's zone, no time). Formatted as that calendar
 * date, never shifted by the browser's or the server's offset. Null/invalid input yields null (the caller renders
 * Unknown).
 */
export function formatBusinessDate(value: string | null | undefined, locale: Locale): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: "medium", timeZone: "UTC" }).format(date);
}
