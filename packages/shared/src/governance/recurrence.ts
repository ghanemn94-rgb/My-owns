// Meeting-series recurrence (ADR-0032 §2; REQ-PB-060, REQ-S10-005; T-DG4-BE-F). Pure functions shared by the API
// (governance/meeting-series.ts) and the worker (handlers/meetings.ts): no clock, no I/O, no hard-coded holiday. Working
// days come from an injected `isWorkingDay` built over the organization's business calendar (ADR-0025 §1); without a
// calendar the caller passes null, and every rule that needs working days answers Unknown (`calendar_not_configured`),
// never a guessed date.
//
// Nominal occurrences of a rule (ADR-0032 §2 "Occurrences"):
//   daily    every `intervalCount`-th calendar day counted from `startDate`, WORKING DAYS ONLY (a nominal day that is
//            not a working day produces no meeting), so "Daily" never produces a weekend or holiday meeting;
//   weekly   the listed ISO weekdays (1 = Monday ... 7 = Sunday) of every `intervalCount`-th week, weeks counted from the
//            Monday-based ISO week of `startDate`;
//   monthly  day `monthDay` (1-28) of every `intervalCount`-th month counted from the month of `startDate`.
// A weekly or monthly nominal date that is not a working day follows `nonWorkingDayRule`: `next_working_day` moves the
// scheduled date to the next working day (the nominal date stays the occurrence date), `skip` creates nothing, `keep`
// keeps the date.
import { dateOfEpochDay, epochDayOf, isoWeekdayOf } from "../time/working-days.ts";

export type RecurrenceFrequency = "daily" | "weekly" | "monthly";
export type NonWorkingDayRule = "next_working_day" | "skip" | "keep";

export interface RecurrenceRule {
  readonly frequency: RecurrenceFrequency;
  readonly intervalCount: number;
  /** ISO weekdays, weekly only. */
  readonly weekdays: readonly number[] | null;
  /** 1-28, monthly only. */
  readonly monthDay: number | null;
  readonly startDate: string;
  readonly endDate: string | null;
  readonly nonWorkingDayRule: NonWorkingDayRule;
}

/** A working-day predicate over the business calendar, or null when no calendar is configured (Unknown). */
export type WorkingDayPredicate = ((date: string) => boolean) | null;

export interface Occurrence {
  /** The nominal date of the rule (the series key: one meeting per series and occurrence date). */
  readonly occurrenceDate: string;
  /** The date the meeting is held (differs from the occurrence date only under `next_working_day`). */
  readonly scheduledDate: string;
}

export type OccurrencesResult =
  | { readonly status: "known"; readonly occurrences: readonly Occurrence[] }
  | { readonly status: "unknown"; readonly reason: "calendar_not_configured" };

/** How far `next_working_day` looks ahead before it gives up (a calendar with no working day in a year). */
const NEXT_WORKING_DAY_LOOKAHEAD = 366;

function day(date: string, what: string): number {
  const d = epochDayOf(date);
  if (d === null) throw new RangeError(`${what} is not a valid business date: ${date}`);
  return d;
}

function monthIndex(date: string): number {
  return Number(date.slice(0, 4)) * 12 + (Number(date.slice(5, 7)) - 1);
}

function dateOfMonth(index: number, monthDay: number): string {
  const y = Math.floor(index / 12);
  const m = (index % 12) + 1;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(monthDay).padStart(2, "0")}`;
}

/** True when the rule needs the business calendar to be evaluated (daily, or a moving/skipping non-working-day rule). */
export function ruleNeedsCalendar(rule: Pick<RecurrenceRule, "frequency" | "nonWorkingDayRule">): boolean {
  return rule.frequency === "daily" || rule.nonWorkingDayRule !== "keep";
}

/**
 * The nominal dates of `rule` in the inclusive window [from, to], clipped to the rule's start and end dates, in order.
 * Pure calendar arithmetic: no working-day rule is applied here.
 */
export function nominalOccurrences(rule: RecurrenceRule, from: string, to: string): string[] {
  if (!Number.isInteger(rule.intervalCount) || rule.intervalCount < 1)
    throw new RangeError(`intervalCount must be an integer >= 1, got ${String(rule.intervalCount)}`);
  const start = day(rule.startDate, "startDate");
  const lo = Math.max(day(from, "from"), start);
  let hi = day(to, "to");
  if (rule.endDate !== null) hi = Math.min(hi, day(rule.endDate, "endDate"));
  const out: string[] = [];
  if (lo > hi) return out;
  const n = rule.intervalCount;
  if (rule.frequency === "daily") {
    for (let d = lo; d <= hi; d += 1) if ((d - start) % n === 0) out.push(dateOfEpochDay(d));
    return out;
  }
  if (rule.frequency === "weekly") {
    const days = new Set((rule.weekdays ?? []).map(Number));
    // Monday of the ISO week of the start date.
    const week0 = start - (isoWeekdayOf(rule.startDate) - 1);
    for (let d = lo; d <= hi; d += 1) {
      const date = dateOfEpochDay(d);
      if (!days.has(isoWeekdayOf(date))) continue;
      if (Math.floor((d - week0) / 7) % n === 0) out.push(date);
    }
    return out;
  }
  const md = rule.monthDay;
  if (md === null || !Number.isInteger(md) || md < 1 || md > 28)
    throw new RangeError(`monthDay must be an integer 1-28, got ${String(md)}`);
  const m0 = monthIndex(rule.startDate);
  for (let m = monthIndex(dateOfEpochDay(lo)); m <= monthIndex(dateOfEpochDay(hi)); m += 1) {
    if ((m - m0) % n !== 0) continue;
    const date = dateOfMonth(m, md);
    const d = day(date, "occurrence");
    if (d >= lo && d <= hi) out.push(date);
  }
  return out;
}

/** The first working day strictly after `date`, or null when none exists within a year. */
export function nextWorkingDay(date: string, isWorkingDay: (date: string) => boolean): string | null {
  const d = day(date, "date");
  for (let i = 1; i <= NEXT_WORKING_DAY_LOOKAHEAD; i += 1) {
    const candidate = dateOfEpochDay(d + i);
    if (isWorkingDay(candidate)) return candidate;
  }
  return null;
}

/**
 * The occurrences of `rule` in [from, to] with the non-working-day rule applied over `isWorkingDay`. Unknown
 * (`calendar_not_configured`) when the rule needs working days and no calendar is configured.
 */
export function seriesOccurrences(
  rule: RecurrenceRule,
  from: string,
  to: string,
  isWorkingDay: WorkingDayPredicate,
): OccurrencesResult {
  if (isWorkingDay === null && ruleNeedsCalendar(rule)) return { status: "unknown", reason: "calendar_not_configured" };
  const out: Occurrence[] = [];
  for (const nominal of nominalOccurrences(rule, from, to)) {
    if (isWorkingDay === null || isWorkingDay(nominal)) {
      out.push({ occurrenceDate: nominal, scheduledDate: nominal });
      continue;
    }
    // A daily series meets on working days only, whatever its non-working-day rule says.
    if (rule.frequency === "daily" || rule.nonWorkingDayRule === "skip") continue;
    if (rule.nonWorkingDayRule === "keep") {
      out.push({ occurrenceDate: nominal, scheduledDate: nominal });
      continue;
    }
    const moved = nextWorkingDay(nominal, isWorkingDay);
    if (moved !== null) out.push({ occurrenceDate: nominal, scheduledDate: moved });
  }
  return { status: "known", occurrences: out };
}

/**
 * The agenda cut-off of a meeting (ADR-0032 §3.1): `scheduledDate` minus `workingDays` working days on the business
 * calendar (0 = the meeting date itself). Null (Unknown, `calendar_not_configured`) without a calendar, or when fewer
 * than `workingDays` working days exist in the year before the meeting.
 */
export function cutoffDateOf(
  scheduledDate: string,
  workingDays: number,
  isWorkingDay: WorkingDayPredicate,
): string | null {
  if (!Number.isInteger(workingDays) || workingDays < 0)
    throw new RangeError(`workingDays must be an integer >= 0, got ${String(workingDays)}`);
  if (isWorkingDay === null) return null;
  const d = day(scheduledDate, "scheduledDate");
  if (workingDays === 0) return scheduledDate;
  let found = 0;
  for (let i = 1; i <= NEXT_WORKING_DAY_LOOKAHEAD; i += 1) {
    const candidate = dateOfEpochDay(d - i);
    if (!isWorkingDay(candidate)) continue;
    found += 1;
    if (found === workingDays) return candidate;
  }
  return null;
}

/** `date` plus `days` calendar days (window arithmetic only; never used for a working-day period). */
export function addCalendarDays(date: string, days: number): string {
  return dateOfEpochDay(day(date, "date") + days);
}
