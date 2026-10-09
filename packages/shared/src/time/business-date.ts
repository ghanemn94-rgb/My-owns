// Time semantics (ADR-0025 §2; REQ-S15-008; master prompt M0302): an event INSTANT is an absolute timestamp; its
// BUSINESS DATE is the calendar date of that instant in the organization's calendar timezone; an OBSERVATION PERIOD is
// chosen by the user or a schedule and is never derived from the entry instant. `businessDateOf` is the TypeScript twin
// of the SQL function `p4_business_date(at, timezone)` = `(at AT TIME ZONE timezone)::date` (migration 0028).
// Pure and locale-independent: digits are always Latin and the calendar Gregorian, whatever the process locale.

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    // Throws RangeError for an unknown zone, which callers surface as calendar.timezone_unknown.
    f = new Intl.DateTimeFormat("en-US-u-ca-gregory-nu-latn", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hourCycle: "h23",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** True when the runtime's zone database knows `timeZone` (the API's check; the database re-checks it). */
export function isKnownTimeZone(timeZone: string): boolean {
  try {
    formatterFor(timeZone);
    return true;
  } catch {
    return false;
  }
}

/**
 * The business date (`YYYY-MM-DD`) of the instant `at` in `timeZone`. Example (ADR-0025 §2): 2026-11-02T20:30:00Z in
 * Asia/Riyadh (UTC+3) is 2026-11-02 (23:30 local); 2026-11-01T21:30:00Z is 2026-11-02 (00:30 local), not the UTC date.
 */
export function businessDateOf(at: Date | string, timeZone: string): string {
  const instant = typeof at === "string" ? new Date(at) : at;
  if (Number.isNaN(instant.getTime())) throw new RangeError(`not a valid instant: ${String(at)}`);
  const parts = formatterFor(timeZone).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes): string => parts.find((p) => p.type === type)?.value ?? "";
  const year = get("year");
  if (!/^\d{4}$/.test(year))
    throw new RangeError(`instant outside the four-digit year range: ${instant.toISOString()}`);
  return `${year}-${get("month")}-${get("day")}`;
}
