// @mth/shared/time (ADR-0025 §1-§2; T-DG4-BE-A): business dates and working-day arithmetic. Pure functions shared by
// the API, the worker and the web; no clock, no I/O, no hard-coded holiday.
export { businessDateOf, isKnownTimeZone } from "./business-date.ts";
export {
  addWorkingDays,
  dateOfEpochDay,
  epochDayOf,
  isBusinessDate,
  isoWeekdayOf,
  isValidWorkweek,
  isWorkingDay,
  MAX_LOOKAHEAD_DAYS,
  MAX_WORKING_DAYS_QUERY,
  type CalendarHolidayRange,
  type IsoWeekday,
  type SkippedDate,
  type UnknownDueReason,
  type WorkingCalendar,
  type WorkingDayResult,
} from "./working-days.ts";
