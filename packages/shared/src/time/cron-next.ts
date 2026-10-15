// The next run of a five-field cron in a time zone (ADR-0043 §6; REQ-S12-022 "next run"; p5-work-split §D.4; T-DG5-BE-I2).
// Pure: no clock, no I/O, no dependency. The caller passes `after` (the API passes the request time).
//
// Syntax: what `isFiveFieldCron` (schemas/jobs.ts) accepts and the API stores: minute hour day-of-month month
// day-of-week, each a comma list of `*`, `n`, `a-b`, with an optional `/step`; `n/step` means n to the field's maximum
// every step; day of week 0 and 7 are Sunday. The day rule follows cron-parser 4.9, which pg-boss 11 uses to fire the
// schedules, so the shown next run is the instant pg-boss starts the job: when day of week covers every day, only day
// of month counts; when day of month covers every day of the month (cron-parser's table, February = 29 days), only day
// of week counts; when both are restricted, either one matching is enough.
//
// Search: minute by minute, from the first whole minute after `after` up to 366 days ahead (ADR-0043 §6). Local fields
// are read with Intl in the schedule's time zone. For speed the minutes are visited in aligned 15-minute blocks whose
// local hour, day, month and weekday are read once: every time-zone offset in use today is a multiple of 15 minutes,
// so such a block never crosses a local hour; a block whose offset is not a multiple of 15 is checked minute by minute.
// A cron that cannot be parsed, an unknown time zone, or no match within 366 days returns null (shown "Unknown";
// never a guessed time).

const MINUTE_MS = 60_000;
const BLOCK_MINUTES = 15;
const BLOCK_MS = BLOCK_MINUTES * MINUTE_MS;
/** How far ahead the search looks (ADR-0043 §6). */
export const CRON_LOOKAHEAD_DAYS = 366;

const FIELD_RANGES: readonly (readonly [number, number])[] = [
  [0, 59],
  [0, 23],
  [1, 31],
  [1, 12],
  [0, 7],
];
const ITEM = /^(\*|(\d{1,2})(-(\d{1,2}))?)(\/(\d{1,2}))?$/;
/** cron-parser 4.9's month lengths for its "day of month is a wildcard" test (February counted as 29). */
const CRON_PARSER_MONTH_DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

/** A parsed five-field cron: the allowed values of each field. */
export interface CronSchedule {
  readonly minutes: ReadonlySet<number>;
  readonly hours: ReadonlySet<number>;
  readonly daysOfMonth: ReadonlySet<number>;
  readonly months: ReadonlySet<number>;
  /** 0-6, Sunday = 0 (a 7 in the expression is stored as 0). */
  readonly daysOfWeek: ReadonlySet<number>;
}

function parseField(field: string, lo: number, hi: number): Set<number> | null {
  const out = new Set<number>();
  for (const item of field.split(",")) {
    const m = ITEM.exec(item);
    if (!m) return null;
    const step = m[6] === undefined ? 1 : Number(m[6]);
    if (step < 1) return null;
    let from: number;
    let to: number;
    if (m[1] === "*") {
      from = lo;
      to = hi;
    } else {
      from = Number(m[2]);
      to = m[4] !== undefined ? Number(m[4]) : m[6] !== undefined ? hi : from;
    }
    if (from < lo || to > hi || from > to) return null;
    for (let v = from; v <= to; v += step) out.add(v);
  }
  return out;
}

/** Parses a five-field cron; null when it is not one `isFiveFieldCron` accepts. */
export function parseCron(cron: string): CronSchedule | null {
  const fields = cron.split(" ");
  if (fields.length !== 5) return null;
  const sets: Set<number>[] = [];
  for (let i = 0; i < 5; i++) {
    const [lo, hi] = FIELD_RANGES[i]!;
    const set = parseField(fields[i]!, lo, hi);
    if (set === null) return null;
    sets.push(set);
  }
  const dow = new Set([...sets[4]!].map((d) => (d === 7 ? 0 : d)));
  return { minutes: sets[0]!, hours: sets[1]!, daysOfMonth: sets[2]!, months: sets[3]!, daysOfWeek: dow };
}

interface LocalParts {
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly weekday: number;
}

const WEEKDAYS: Readonly<Record<string, number>> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat | null {
  const cached = formatters.get(timeZone);
  if (cached) return cached;
  try {
    const f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      weekday: "short",
    });
    formatters.set(timeZone, f);
    return f;
  } catch {
    return null;
  }
}

function localParts(f: Intl.DateTimeFormat, epochMs: number): LocalParts {
  const parts = new Map(f.formatToParts(new Date(epochMs)).map((p) => [p.type, p.value]));
  return {
    month: Number(parts.get("month")),
    day: Number(parts.get("day")),
    hour: Number(parts.get("hour")),
    minute: Number(parts.get("minute")),
    weekday: WEEKDAYS[parts.get("weekday") ?? ""] ?? -1,
  };
}

/** The day rule of cron-parser 4.9 (see the header). */
function dayMatches(s: CronSchedule, p: LocalParts): boolean {
  const domMatch = s.daysOfMonth.has(p.day);
  const dowMatch = s.daysOfWeek.has(p.weekday);
  const dowWildcard = s.daysOfWeek.size === 7;
  const domWildcard = s.daysOfMonth.size >= CRON_PARSER_MONTH_DAYS[p.month - 1]!;
  if (dowWildcard) return domMatch;
  if (domWildcard) return dowMatch;
  return domMatch || dowMatch;
}

/** True when the local minute `p` is one the schedule fires at. */
export function cronMatchesLocal(s: CronSchedule, p: LocalParts): boolean {
  return s.minutes.has(p.minute) && s.hours.has(p.hour) && s.months.has(p.month) && dayMatches(s, p);
}

/** The local fields of an instant in a time zone (null for an unknown zone); exported for the tests' oracle. */
export function cronLocalParts(epochMs: number, timeZone: string): LocalParts | null {
  const f = formatterFor(timeZone);
  return f === null ? null : localParts(f, epochMs);
}

/**
 * The first instant strictly after `after`, on a whole minute, at which `cron` fires in `timeZone`, searched up to
 * 366 days ahead; null when the cron or the zone is not valid or nothing matches in that window.
 */
export function nextCronRun(cron: string, timeZone: string, after: Date): Date | null {
  const s = parseCron(cron);
  const f = formatterFor(timeZone);
  const afterMs = after.getTime();
  if (s === null || f === null || !Number.isFinite(afterMs)) return null;
  const start = Math.floor(afterMs / MINUTE_MS) * MINUTE_MS + MINUTE_MS;
  const end = start + CRON_LOOKAHEAD_DAYS * 24 * 60 * MINUTE_MS;
  for (let block = Math.floor(start / BLOCK_MS) * BLOCK_MS; block < end; block += BLOCK_MS) {
    const p = localParts(f, block);
    const aligned = p.minute % BLOCK_MINUTES === new Date(block).getUTCMinutes() % BLOCK_MINUTES;
    if (aligned) {
      // One local hour, day, month and weekday for the whole block.
      if (!s.hours.has(p.hour) || !s.months.has(p.month) || !dayMatches(s, p)) continue;
      for (let i = 0; i < BLOCK_MINUTES; i++) {
        const t = block + i * MINUTE_MS;
        if (t < start || t >= end) continue;
        if (s.minutes.has(p.minute + i)) return new Date(t);
      }
      continue;
    }
    for (let i = 0; i < BLOCK_MINUTES; i++) {
      const t = block + i * MINUTE_MS;
      if (t < start || t >= end) continue;
      if (cronMatchesLocal(s, localParts(f, t))) return new Date(t);
    }
  }
  return null;
}
