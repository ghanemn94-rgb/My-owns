import { invalid } from './errors';

/**
 * Working calendars. Business dates are ISO `YYYY-MM-DD` strings interpreted in the project timezone
 * (default Asia/Riyadh). Instants are stored as UTC timestamps; only due dates / plan dates use this module.
 * Default working week is Sunday–Thursday (proposed, editable per project) — spec §9.
 */
export interface WorkingCalendar {
  timezone: string; // IANA, e.g. 'Asia/Riyadh'
  /** 0 = Sunday … 6 = Saturday */
  workingDays: number[];
  /** ISO dates that are non-working (corporate holidays). */
  holidays: string[];
}

export const DEFAULT_CALENDAR: WorkingCalendar = {
  timezone: 'Asia/Riyadh',
  workingDays: [0, 1, 2, 3, 4],
  holidays: [],
};

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function assertIsoDate(d: string): void {
  if (!ISO_DATE_RE.test(d)) throw invalid('calendar.invalid_date', `Expected YYYY-MM-DD, got ${d}`);
  const t = Date.parse(`${d}T00:00:00Z`);
  if (Number.isNaN(t) || toIso(new Date(t)) !== d) throw invalid('calendar.invalid_date', `Invalid date ${d}`);
}

function toDate(d: string): Date {
  assertIsoDate(d);
  return new Date(`${d}T00:00:00Z`);
}

function toIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addCalendarDays(d: string, n: number): string {
  const x = toDate(d);
  x.setUTCDate(x.getUTCDate() + n);
  return toIso(x);
}

export function dayOfWeek(d: string): number {
  return toDate(d).getUTCDay();
}

export function isWorkingDay(d: string, cal: WorkingCalendar = DEFAULT_CALENDAR): boolean {
  return cal.workingDays.includes(dayOfWeek(d)) && !cal.holidays.includes(d);
}

function guardCalendar(cal: WorkingCalendar) {
  if (cal.workingDays.length === 0) throw invalid('calendar.no_working_days', 'Calendar has no working days');
}

/** First working day on or after `d`. */
export function onOrNextWorkingDay(d: string, cal: WorkingCalendar = DEFAULT_CALENDAR): string {
  guardCalendar(cal);
  let x = d;
  for (let i = 0; i < 3660 && !isWorkingDay(x, cal); i++) x = addCalendarDays(x, 1);
  return x;
}

/** First working day strictly after `d`. */
export function nextWorkingDay(d: string, cal: WorkingCalendar = DEFAULT_CALENDAR): string {
  return onOrNextWorkingDay(addCalendarDays(d, 1), cal);
}

/** First working day strictly before `d`. */
export function previousWorkingDay(d: string, cal: WorkingCalendar = DEFAULT_CALENDAR): string {
  guardCalendar(cal);
  let x = addCalendarDays(d, -1);
  for (let i = 0; i < 3660 && !isWorkingDay(x, cal); i++) x = addCalendarDays(x, -1);
  return x;
}

/**
 * Move `n` working days from `d` (n may be negative). `d` itself is not counted.
 * addWorkingDays('2026-10-01' (Thu), 1) → '2026-10-04' (Sun) with the default calendar.
 */
export function addWorkingDays(d: string, n: number, cal: WorkingCalendar = DEFAULT_CALENDAR): string {
  if (!Number.isInteger(n)) throw invalid('calendar.non_integer_days', 'Working-day offsets must be integers');
  let x = d;
  if (n >= 0) for (let i = 0; i < n; i++) x = nextWorkingDay(x, cal);
  else for (let i = 0; i < -n; i++) x = previousWorkingDay(x, cal);
  return x;
}

/**
 * Finish date of an activity that starts on working day `start` and lasts `durationDays` working days
 * (duration 0 = milestone: finish = start).
 */
export function finishFromStart(start: string, durationDays: number, cal: WorkingCalendar = DEFAULT_CALENDAR): string {
  const s = onOrNextWorkingDay(start, cal);
  return durationDays <= 0 ? s : addWorkingDays(s, durationDays - 1, cal);
}

/** Number of working days in the inclusive range [a, b]; negative if b < a. */
export function workingDaysBetweenInclusive(a: string, b: string, cal: WorkingCalendar = DEFAULT_CALENDAR): number {
  if (a === b) return isWorkingDay(a, cal) ? 1 : 0;
  const forward = a < b;
  const [from, to] = forward ? [a, b] : [b, a];
  let count = 0;
  let x = from;
  for (let i = 0; i < 36600 && x <= to; i++) {
    if (isWorkingDay(x, cal)) count++;
    x = addCalendarDays(x, 1);
  }
  return forward ? count : -count;
}

/** Working-day slip from `planned` to `actual` (positive = late). */
export function workingDaySlip(planned: string, actual: string, cal: WorkingCalendar = DEFAULT_CALENDAR): number {
  if (planned === actual) return 0;
  if (actual > planned) return workingDaysBetweenInclusive(addCalendarDays(planned, 1), actual, cal);
  return -workingDaysBetweenInclusive(addCalendarDays(actual, 1), planned, cal);
}

/** The local business date for an instant in a timezone (e.g. "today in Riyadh"). */
export function localDate(instant: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Local hour (0–23) of an instant in a timezone — used for quiet hours. */
export function localHour(instant: Date, timezone: string): number {
  const h = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', hour12: false }).format(instant);
  return Number(h) % 24;
}
