// Working-day arithmetic over a configurable business calendar (ADR-0025 §1; REQ-S10-006; master prompt M0196). Pure:
// no clock, no I/O, no locale dependence. Dates are ISO business dates `YYYY-MM-DD` (calendar dates, not instants).
//
// Rules (ADR-0025 §1):
//  - a date is a working day of a calendar if and only if its ISO weekday is in `workweek` AND no active holiday of
//    that calendar covers it;
//  - `addWorkingDays(raisedOn, n, calendar)` is the n-th working day STRICTLY AFTER `raisedOn`; the raise day itself
//    never counts, whether or not it is a working day;
//  - the search looks at most MAX_LOOKAHEAD_DAYS calendar days ahead; finding fewer than n working days there, or
//    having no calendar at all, gives Unknown (`dueDate: null`, `unknownReason: "calendar_not_configured"`), never a
//    guessed date and never a date counted in elapsed calendar days.
// No holiday is hard-coded anywhere: holidays exist only as administered calendar data.

/** ISO weekday: 1 = Monday ... 7 = Sunday. */
export type IsoWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** An administered holiday: an inclusive range of business dates. Removed holidays are ignored. */
export interface CalendarHolidayRange {
  readonly id?: string | null;
  readonly dateFrom: string;
  readonly dateTo: string;
  readonly status?: "active" | "removed";
}

/** The parts of a business calendar the arithmetic needs. */
export interface WorkingCalendar {
  readonly workweek: readonly number[];
  readonly holidays: readonly CalendarHolidayRange[];
}

export type UnknownDueReason = "calendar_not_configured";

export interface SkippedDate {
  readonly date: string;
  readonly reason: "weekend" | "holiday";
  readonly holidayId: string | null;
}

export interface WorkingDayResult {
  /** The due date, or null (Unknown) when it cannot be computed. */
  readonly dueDate: string | null;
  readonly unknownReason: UnknownDueReason | null;
  /** Non-working dates passed over before the due date, in order (empty when Unknown). */
  readonly skippedDates: readonly SkippedDate[];
}

/** How far ahead the search looks, in calendar days (ADR-0025 §1: about ten years). */
export const MAX_LOOKAHEAD_DAYS = 3660;

/** The largest n the API accepts (OpenAPI `WorkingDays` maximum). The function itself accepts any n >= 1. */
export const MAX_WORKING_DAYS_QUERY = 250;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

/** Days since 1970-01-01 of a valid ISO business date, or null when the string is not a real calendar date. */
export function epochDayOf(date: string): number | null {
  const m = ISO_DATE.exec(date);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const ms = Date.UTC(y, mo - 1, d);
  const back = new Date(ms);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  return ms / DAY_MS;
}

/** True for a real calendar date written `YYYY-MM-DD`. */
export function isBusinessDate(date: string): boolean {
  return epochDayOf(date) !== null;
}

function requireEpochDay(date: string, what: string): number {
  const day = epochDayOf(date);
  if (day === null) throw new RangeError(`${what} must be a business date YYYY-MM-DD, got ${JSON.stringify(date)}`);
  return day;
}

/** The ISO business date of a day number (inverse of epochDayOf). */
export function dateOfEpochDay(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

/** ISO weekday (1 = Monday ... 7 = Sunday) of a business date. */
export function isoWeekdayOf(date: string): IsoWeekday {
  const js = new Date(requireEpochDay(date, "date") * DAY_MS).getUTCDay(); // 0 = Sunday
  return (js === 0 ? 7 : js) as IsoWeekday;
}

/** True when `workweek` is one to seven distinct ISO weekdays (the `business_calendar_workweek_valid` rule). */
export function isValidWorkweek(workweek: readonly unknown[]): workweek is readonly IsoWeekday[] {
  return (
    workweek.length >= 1 &&
    workweek.length <= 7 &&
    workweek.every((d) => Number.isInteger(d) && (d as number) >= 1 && (d as number) <= 7) &&
    new Set(workweek).size === workweek.length
  );
}

interface PreparedCalendar {
  readonly workdays: ReadonlySet<number>;
  readonly holidays: readonly { readonly from: number; readonly to: number; readonly id: string | null }[];
}

function prepare(calendar: WorkingCalendar): PreparedCalendar {
  if (!isValidWorkweek(calendar.workweek))
    throw new RangeError("workweek must list one to seven different ISO weekdays (1 = Monday ... 7 = Sunday)");
  const holidays = calendar.holidays
    .filter((h) => (h.status ?? "active") === "active")
    .map((h) => ({
      from: requireEpochDay(h.dateFrom, "holiday dateFrom"),
      to: requireEpochDay(h.dateTo, "holiday dateTo"),
      id: h.id ?? null,
    }));
  return { workdays: new Set(calendar.workweek), holidays };
}

function classify(day: number, cal: PreparedCalendar): SkippedDate | null {
  const date = dateOfEpochDay(day);
  const js = new Date(day * DAY_MS).getUTCDay();
  if (!cal.workdays.has(js === 0 ? 7 : js)) return { date, reason: "weekend", holidayId: null };
  const holiday = cal.holidays.find((h) => h.from <= day && day <= h.to);
  if (holiday) return { date, reason: "holiday", holidayId: holiday.id };
  return null;
}

/** True when `date` is a working day of `calendar` (weekday in the workweek and no active holiday covers it). */
export function isWorkingDay(date: string, calendar: WorkingCalendar): boolean {
  return classify(requireEpochDay(date, "date"), prepare(calendar)) === null;
}

const UNKNOWN: WorkingDayResult = Object.freeze({
  dueDate: null,
  unknownReason: "calendar_not_configured",
  skippedDates: Object.freeze([]) as readonly SkippedDate[],
});

/**
 * The n-th working day strictly after the business date `raisedOn` (ADR-0025 §1). `calendar` null (the organization
 * has no active default calendar) gives Unknown with reason `calendar_not_configured`, as does a calendar with fewer
 * than n working days in the next MAX_LOOKAHEAD_DAYS calendar days.
 */
export function addWorkingDays(raisedOn: string, n: number, calendar: WorkingCalendar | null): WorkingDayResult {
  const start = requireEpochDay(raisedOn, "raisedOn");
  if (!Number.isInteger(n) || n < 1) throw new RangeError(`n must be an integer >= 1, got ${String(n)}`);
  if (calendar === null) return UNKNOWN;
  const cal = prepare(calendar);
  const skipped: SkippedDate[] = [];
  let found = 0;
  for (let offset = 1; offset <= MAX_LOOKAHEAD_DAYS; offset += 1) {
    const day = start + offset;
    const nonWorking = classify(day, cal);
    if (nonWorking) {
      skipped.push(nonWorking);
      continue;
    }
    found += 1;
    if (found === n) return { dueDate: dateOfEpochDay(day), unknownReason: null, skippedDates: skipped };
  }
  return UNKNOWN;
}
