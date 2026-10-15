// The notification delivery decision (ADR-0044 §5; REQ-S12-025, M0241; D-142 Q11; p5-work-split §E.3, T-DG5-BE-L).
// Pure: no clock (the caller passes `now`), no I/O, no locale dependence, no hard-coded holiday. Called by both
// createWorkItemOnce twins (apps/api tasks/service.ts and apps/worker kit.ts; parity test) and re-used by the digest
// job to know whether a user's digest is on.
//
// Four separate settings (ADR-0044 §5):
//  - urgent escalation: an urgent notification (work_item_kind.urgency = 'urgent') is delivered at once, always (the
//    database refuses holding it: inbox_notification_urgent_immediate);
//  - quiet hours (the user's, else the organization's default; `HH:MM` in the user's time zone, may span midnight):
//    a non-urgent notification created inside them is held until they end;
//  - digest (off / daily / twice daily at `digestTime` and 12 hours later): a non-urgent notification is held until
//    the next digest time that is outside quiet hours, then delivered inside one digest notification;
//  - business-day timing (organization policy): on a non-working day of the organization's default calendar a
//    non-urgent notification is held until 08:00 of the next working day (calendar time zone; when quiet hours or a
//    digest apply, until that day's first instant they allow). Working days come only
//    from the administered calendar; with no calendar the rule cannot be applied and holds nothing (never guessed).
// With no preference and no policy nothing is held: the DG4 behaviour (every notification delivered at once).
// The release instant is the earliest instant at or after `now` that satisfies every applicable rule; the search is
// bounded, and a combination that can never be satisfied (every digest time inside quiet hours) falls back to the end
// of the quiet hours, so a notification is never held forever.
import { businessDateOf } from "../time/business-date.ts";
import { dateOfEpochDay, epochDayOf, isWorkingDay, type WorkingCalendar } from "../time/working-days.ts";

export type DigestMode = "off" | "daily" | "twice_daily";
export type NotificationUrgency = "normal" | "urgent";

/** The effective settings of one user: own row, else the organization defaults, else none. */
export interface DeliverySettings {
  /** `HH:MM`, or null (no quiet hours; then `quietHoursEnd` is null too). */
  readonly quietHoursStart: string | null;
  readonly quietHoursEnd: string | null;
  /** IANA time zone of the quiet hours and digest times. */
  readonly timezone: string;
  readonly digestMode: DigestMode;
  /** `HH:MM`; twice daily adds the time 12 hours later. */
  readonly digestTime: string;
}

/** Business-day timing of the organization (policy) with its default calendar. */
export interface WorkingDayRule {
  readonly enabled: boolean;
  /** The organization's active default calendar, or null (none configured: the rule holds nothing). */
  readonly calendar: WorkingCalendar | null;
  /** The calendar's time zone (business dates and the 08:00 release are read in it). */
  readonly timezone: string;
}

export interface DeliveryInput {
  readonly urgency: NotificationUrgency;
  readonly settings: DeliverySettings;
  readonly workingDays: WorkingDayRule;
}

export type HoldReason = "quiet_hours" | "digest" | "non_working_day";

export type DeliveryDecision =
  | { readonly state: "delivered"; readonly deliverAfter: null; readonly reason: "urgent" | "immediate" }
  | { readonly state: "held"; readonly deliverAfter: Date; readonly reason: HoldReason };

/** The settings that hold nothing (no row and no policy): DG4 behaviour. */
export const NO_DELIVERY_SETTINGS = (timezone: string): DeliverySettings => ({
  quietHoursStart: null,
  quietHoursEnd: null,
  timezone,
  digestMode: "off",
  digestTime: "08:00",
});

/** 08:00 of the next working day (ADR-0044 §5). */
export const WORKING_DAY_RELEASE_MINUTES = 8 * 60;

const HHMM = /^([01][0-9]|2[0-3]):([0-5][0-9])$/;
const DAY_MINUTES = 24 * 60;
/** Steps of the release search; each step moves the candidate forward, so the bound only stops pathological input. */
const MAX_STEPS = 64;
/** How many calendar days ahead the next working day is searched (as working-days.ts MAX_LOOKAHEAD_DAYS). */
const MAX_WORKING_LOOKAHEAD = 3660;

/** Minutes after midnight of an `HH:MM` text (also accepts `HH:MM:SS` as PostgreSQL's `time` prints it). */
export function minutesOfTime(text: string): number {
  const m = HHMM.exec(text.length === 8 && text.endsWith(":00") ? text.slice(0, 5) : text);
  if (!m) throw new RangeError(`not an HH:MM time: ${text}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

/** `HH:MM` of a PostgreSQL `time` text (`HH:MM:SS`) or of an `HH:MM` text. */
export const hhmm = (text: string): string => text.slice(0, 5);

/** True when quiet hours are configured and valid: both set and different (NP09). */
export function quietHoursValid(start: string | null, end: string | null): boolean {
  if (start === null && end === null) return true;
  if (start === null || end === null) return false;
  return minutesOfTime(start) !== minutesOfTime(end);
}

const wallFormatters = new Map<string, Intl.DateTimeFormat>();

function wallFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = wallFormatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US-u-ca-gregory-nu-latn", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    wallFormatters.set(timeZone, f);
  }
  return f;
}

/** The wall clock of `at` in `timeZone`: its business date and the minutes after local midnight (with seconds). */
export function wallClockOf(at: Date, timeZone: string): { date: string; minutes: number } {
  const parts = wallFormatter(timeZone).formatToParts(at);
  const get = (type: Intl.DateTimeFormatPartTypes): number => Number(parts.find((p) => p.type === type)?.value);
  const hour = get("hour") % 24;
  return {
    date: businessDateOf(at, timeZone),
    minutes: hour * 60 + get("minute") + (get("second") + at.getUTCMilliseconds() / 1000) / 60,
  };
}

/** Offset of `timeZone` from UTC at the instant `ms`, in milliseconds (wall clock minus UTC). */
function offsetAt(ms: number, timeZone: string): number {
  const parts = wallFormatter(timeZone).formatToParts(new Date(ms));
  const get = (type: Intl.DateTimeFormatPartTypes): number => Number(parts.find((p) => p.type === type)?.value);
  const wall = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  return wall - Math.floor(ms / 1000) * 1000;
}

/**
 * The instant whose wall clock in `timeZone` is `date` at `minutes` after midnight. A wall time skipped by a daylight
 * saving change resolves to the instant just after the gap; a repeated one to its first occurrence.
 */
export function instantOfWallClock(date: string, minutes: number, timeZone: string): Date {
  const day = epochDayOf(date);
  if (day === null) throw new RangeError(`not a business date: ${date}`);
  const guess = day * 86_400_000 + minutes * 60_000;
  const first = guess - offsetAt(guess, timeZone);
  const second = guess - offsetAt(first, timeZone);
  // Prefer the earlier occurrence when both map back to the wall time (a repeated hour).
  const candidates = [first, second].sort((a, b) => a - b);
  for (const c of candidates) if (c + offsetAt(c, timeZone) === guess) return new Date(c);
  return new Date(Math.max(first, second));
}

const nextDate = (date: string): string => dateOfEpochDay(epochDayOf(date)! + 1);

/** True when `minutes` (after local midnight) is inside the quiet hours [start, end), which may span midnight. */
function insideQuiet(minutes: number, start: number, end: number): boolean {
  return start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
}

/** The digest slots of a day, in minutes after midnight, ascending. */
function digestSlots(settings: DeliverySettings): number[] {
  const first = minutesOfTime(settings.digestTime);
  if (settings.digestMode === "daily") return [first];
  if (settings.digestMode === "twice_daily") return [first, (first + 12 * 60) % DAY_MINUTES].sort((a, b) => a - b);
  return [];
}

/** The first digest slot at or after `at` (in the settings' time zone). */
export function nextDigestTime(at: Date, settings: DeliverySettings): Date | null {
  const slots = digestSlots(settings);
  if (slots.length === 0) return null;
  let date = wallClockOf(at, settings.timezone).date;
  for (let d = 0; d < 3; d += 1) {
    for (const slot of slots) {
      const t = instantOfWallClock(date, slot, settings.timezone);
      if (t.getTime() >= at.getTime()) return t;
    }
    date = nextDate(date);
  }
  return null;
}

/** When `at` is inside the quiet hours: the instant they end; otherwise null. */
function quietEndAfter(at: Date, settings: DeliverySettings): Date | null {
  if (settings.quietHoursStart === null || settings.quietHoursEnd === null) return null;
  const start = minutesOfTime(settings.quietHoursStart);
  const end = minutesOfTime(settings.quietHoursEnd);
  if (start === end) return null;
  const wall = wallClockOf(at, settings.timezone);
  if (!insideQuiet(wall.minutes, start, end)) return null;
  const endDate = wall.minutes < end ? wall.date : nextDate(wall.date);
  const t = instantOfWallClock(endDate, end, settings.timezone);
  // A daylight-saving gap can put the local end before `at`; never move backwards.
  return t.getTime() > at.getTime() ? t : new Date(at.getTime() + 60_000);
}

/**
 * When `at` falls on a non-working day of the rule's calendar: 08:00 of the next working day, or its midnight when
 * quiet hours or a digest apply (they then decide the time of day: the first instant after the quiet hours, or the
 * first digest time); otherwise null.
 */
function nextWorkingStartAfter(at: Date, rule: WorkingDayRule, releaseMinutes: number): Date | null {
  if (!rule.enabled || rule.calendar === null) return null;
  const today = businessDateOf(at, rule.timezone);
  if (isWorkingDay(today, rule.calendar)) return null;
  let date = today;
  for (let i = 0; i < MAX_WORKING_LOOKAHEAD; i += 1) {
    date = nextDate(date);
    if (isWorkingDay(date, rule.calendar)) return instantOfWallClock(date, releaseMinutes, rule.timezone);
  }
  return null; // No working day in reach: Unknown, so the rule holds nothing (never a guessed date).
}

/**
 * The delivery decision for one notification created at `now` (ADR-0044 §5). Urgent: delivered at once. Otherwise
 * the earliest instant at or after `now` outside quiet hours, on a working day when the policy says so, and at a
 * digest time when a digest is on; `delivered` when that is `now` and no digest is on, else `held` until it.
 */
export function decideDelivery(now: Date, input: DeliveryInput): DeliveryDecision {
  if (input.urgency === "urgent") return { state: "delivered", deliverAfter: null, reason: "urgent" };
  const s = input.settings;
  const digestOn = s.digestMode !== "off";
  const quietOn = s.quietHoursStart !== null && s.quietHoursEnd !== null;
  let t = now;
  let reason: HoldReason | null = null;
  let quietFallback: Date | null = null;
  for (let step = 0; step < MAX_STEPS; step += 1) {
    const quietEnd = quietEndAfter(t, s);
    if (quietEnd !== null) {
      reason ??= "quiet_hours";
      quietFallback ??= quietEnd;
      t = quietEnd;
      continue;
    }
    const working = nextWorkingStartAfter(t, input.workingDays, digestOn || quietOn ? 0 : WORKING_DAY_RELEASE_MINUTES);
    if (working !== null) {
      reason ??= "non_working_day";
      t = working;
      continue;
    }
    if (digestOn) {
      const digest = nextDigestTime(t, s);
      if (digest !== null && digest.getTime() !== t.getTime()) {
        reason ??= "digest";
        t = digest;
        continue;
      }
    }
    if (reason === null && !digestOn) return { state: "delivered", deliverAfter: null, reason: "immediate" };
    return { state: "held", deliverAfter: t, reason: reason ?? "digest" };
  }
  // Never satisfiable (e.g. every digest time inside quiet hours): released when the first quiet hours end.
  return { state: "held", deliverAfter: quietFallback ?? t, reason: reason ?? "digest" };
}

/** True when a held notification is released by a digest (digest on), false when it is simply delivered. */
export const releasesIntoDigest = (settings: DeliverySettings): boolean => settings.digestMode !== "off";

/**
 * The 15-minute window of the digest job (`notification.digest` runs every 15 minutes) containing `at`, aligned on
 * UTC quarter hours. One user gets at most one digest per window (lock 730261, UNIQUE notification_digest_window_key).
 */
export function digestWindowOf(at: Date): { start: Date; end: Date } {
  const slot = 15 * 60_000;
  const start = Math.floor(at.getTime() / slot) * slot;
  return { start: new Date(start), end: new Date(start + slot) };
}
