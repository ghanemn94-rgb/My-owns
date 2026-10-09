// The forecast slip of a milestone against its approved date, in WORKING days on a business calendar (ADR-0031 §7;
// REQ-S09-007 "forecast slip vs approved date is shown in working days"; T-DG4-BE-E). Pure: no clock, no I/O, no
// locale dependence, no hard-coded holiday (holidays are administered calendar data, ADR-0025 §1).
//
// Definition (ADR-0031 §7), with "working day" as in ADR-0025 §1 (weekday in the workweek and no active holiday):
//  - forecast > approved: the number of working days d with approved < d <= forecast (positive: late);
//  - forecast < approved: minus the number of working days d with forecast < d <= approved (negative: early);
//  - forecast = approved: 0.
// Unknown, never a calendar-day guess: `approved_date_missing`, `forecast_date_missing`, `calendar_not_configured`
// (no active default calendar), or `range_too_long` (more than MAX_SLIP_RANGE_DAYS calendar days apart). The DG3
// `Milestone.varianceDays` stays in calendar days and is shown beside this value (ADR-0023 §8).
import { epochDayOf, type WorkingCalendar } from "../time/working-days.ts";

/** The largest distance between the two dates, in calendar days, for which a slip is computed (ADR-0031 §7). */
export const MAX_SLIP_RANGE_DAYS = 3660;

export type SlipUnknownReason =
  | "approved_date_missing"
  | "forecast_date_missing"
  | "calendar_not_configured"
  | "range_too_long";

/** OpenAPI `WorkingDaySlip`. */
export type WorkingDaySlipResult =
  | { readonly status: "known"; readonly value: number; readonly reason: null }
  | { readonly status: "unknown"; readonly value: null; readonly reason: SlipUnknownReason };

const unknown = (reason: SlipUnknownReason): WorkingDaySlipResult => ({ status: "unknown", value: null, reason });

const DAY_MS = 86_400_000;

function requireDay(date: string, what: string): number {
  const day = epochDayOf(date);
  if (day === null) throw new RangeError(`${what} must be a business date YYYY-MM-DD, got ${JSON.stringify(date)}`);
  return day;
}

/** The number of working days d with fromExclusive < d <= toInclusive (both epoch days, from < to). */
function countWorkingDays(fromExclusive: number, toInclusive: number, calendar: WorkingCalendar): number {
  const workdays = new Set(calendar.workweek.map(Number));
  const holidays = calendar.holidays
    .filter((h) => (h.status ?? "active") === "active")
    .map((h) => ({ from: requireDay(h.dateFrom, "holiday dateFrom"), to: requireDay(h.dateTo, "holiday dateTo") }))
    .filter((h) => h.to > fromExclusive && h.from <= toInclusive);
  let count = 0;
  for (let day = fromExclusive + 1; day <= toInclusive; day += 1) {
    const js = new Date(day * DAY_MS).getUTCDay(); // 0 = Sunday
    if (!workdays.has(js === 0 ? 7 : js)) continue;
    if (holidays.some((h) => h.from <= day && day <= h.to)) continue;
    count += 1;
  }
  return count;
}

/**
 * The working-day slip of `forecast` against `approved` (ADR-0031 §7). `calendar` null means the organization has no
 * active default calendar. Dates are ISO business dates; an invalid date string is a programming error (RangeError).
 */
export function computeWorkingDaySlip(
  approved: string | null,
  forecast: string | null,
  calendar: WorkingCalendar | null,
): WorkingDaySlipResult {
  if (approved === null) return unknown("approved_date_missing");
  if (forecast === null) return unknown("forecast_date_missing");
  const a = requireDay(approved, "approved");
  const f = requireDay(forecast, "forecast");
  if (calendar === null) return unknown("calendar_not_configured");
  if (Math.abs(f - a) > MAX_SLIP_RANGE_DAYS) return unknown("range_too_long");
  if (f === a) return { status: "known", value: 0, reason: null };
  const value = f > a ? countWorkingDays(a, f, calendar) : -countWorkingDays(f, a, calendar);
  return { status: "known", value, reason: null };
}
