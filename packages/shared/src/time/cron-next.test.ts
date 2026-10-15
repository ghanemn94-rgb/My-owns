// nextCronRun (ADR-0043 §6; REQ-S12-022 "next run"; T-DG5-BE-I2). Property tests against the seeded schedule crons
// (DG4 0028/0050/0054/0060 and P5 0074/0075/0080/0086), checked with an independent minute-by-minute oracle written
// here (its own Intl formatter and its own day rule), at deterministic pseudo-random instants (a fixed-seed LCG, so a
// run never depends on the clock or the load). Never a guessed time: an invalid cron, an unknown zone or no match
// within 366 days is null.
import { describe, expect, it } from "vitest";
import { nextCronRun, parseCron } from "./cron-next.ts";

/** Every cron seeded in job_schedule (DG4 and P5 migrations). */
const SEEDED_CRONS = [
  "*/15 * * * *",
  "7 * * * *",
  "20 0 * * *",
  "0 1 * * *",
  "30 0 * * *",
  "45 0 * * *",
  "40 0 * * *",
  "35 0 * * *",
  "5 0 * * *",
  "50 0 * * *",
  "25 0 * * *",
] as const;

const ZONES = ["Asia/Riyadh", "UTC", "Asia/Kolkata", "Asia/Kathmandu", "Europe/London", "America/New_York"] as const;

const MINUTE = 60_000;

// The oracle: its own formatter and day rule (cron-parser 4.9: a full day-of-week means only day of month counts; a
// day of month covering the month's days (February 29) means only day of week counts; otherwise either one).
const oracleFormatters = new Map<string, Intl.DateTimeFormat>();
function oracleParts(ms: number, tz: string) {
  let f = oracleFormatters.get(tz);
  if (f === undefined) {
    f = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "long",
    });
    oracleFormatters.set(tz, f);
  }
  const p = new Map<string, string>(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  const n = (k: string) => Number(p.get(k));
  const weekday = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].indexOf(
    p.get("weekday") ?? "",
  );
  return { month: n("month"), day: n("day"), hour: n("hour"), minute: n("minute"), weekday };
}
function expand(field: string, lo: number, hi: number): number[] {
  const out: number[] = [];
  for (const item of field.split(",")) {
    const [range, stepText] = item.split("/");
    const step = stepText === undefined ? 1 : +stepText;
    let a = lo;
    let b = hi;
    if (range !== "*") {
      const [x, y] = range!.split("-");
      a = +x!;
      b = y !== undefined ? +y : stepText !== undefined ? hi : a;
    }
    for (let v = a; v <= b; v += step) out.push(v);
  }
  return out;
}
function oracleMatches(cron: string, ms: number, tz: string): boolean {
  const [mi, ho, dom, mo, dow] = cron.split(" ");
  const p = oracleParts(ms, tz);
  const doms = new Set(expand(dom!, 1, 31));
  const dows = new Set(expand(dow!, 0, 7).map((d) => d % 7));
  const monthDays = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][p.month - 1]!;
  const domOk = doms.has(p.day);
  const dowOk = dows.has(p.weekday);
  const dayOk = dows.size === 7 ? domOk : doms.size >= monthDays ? dowOk : domOk || dowOk;
  return (
    expand(mi!, 0, 59).includes(p.minute) &&
    expand(ho!, 0, 23).includes(p.hour) &&
    expand(mo!, 1, 12).includes(p.month) &&
    dayOk
  );
}

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe("nextCronRun (ADR-0043 §6)", () => {
  it("every seeded cron parses", () => {
    for (const cron of SEEDED_CRONS) expect(parseCron(cron), cron).not.toBeNull();
  });

  it("property: for each seeded cron and zone, the result is the FIRST matching whole minute strictly after now", () => {
    const rand = lcg(20261015);
    const from = Date.UTC(2026, 0, 1);
    const span = Date.UTC(2028, 0, 1) - from;
    for (const cron of SEEDED_CRONS)
      for (const tz of ZONES)
        for (let i = 0; i < 3; i++) {
          // Random instant with seconds and milliseconds (never on a whole minute by construction of the check).
          const after = new Date(from + Math.floor(rand() * span));
          const next = nextCronRun(cron, tz, after);
          expect(next, `${cron} ${tz} ${after.toISOString()}`).not.toBeNull();
          const n = next!.getTime();
          expect(n % MINUTE).toBe(0);
          expect(n).toBeGreaterThan(after.getTime());
          expect(oracleMatches(cron, n, tz), `${cron} ${tz} ${next!.toISOString()}`).toBe(true);
          // No earlier whole minute in (after, next) matches (every seeded cron fires at least daily).
          expect(n - after.getTime()).toBeLessThanOrEqual(25 * 60 * MINUTE);
          for (let t = Math.floor(after.getTime() / MINUTE) * MINUTE + MINUTE; t < n; t += MINUTE)
            if (oracleMatches(cron, t, tz))
              throw new Error(`${cron} ${tz}: ${new Date(t).toISOString()} matched first`);
        }
  }, 120_000);

  it("Asia/Riyadh (UTC+3): daily 00:20 and hourly minute 7, exact instants", () => {
    const after = new Date("2026-10-15T02:45:42.123Z"); // 05:45 in Riyadh
    expect(nextCronRun("20 0 * * *", "Asia/Riyadh", after)?.toISOString()).toBe("2026-10-15T21:20:00.000Z");
    expect(nextCronRun("7 * * * *", "Asia/Riyadh", after)?.toISOString()).toBe("2026-10-15T03:07:00.000Z");
    expect(nextCronRun("*/15 * * * *", "Asia/Riyadh", after)?.toISOString()).toBe("2026-10-15T03:00:00.000Z");
  });

  it("is strictly after: a run exactly on a firing minute returns the following one", () => {
    const at = new Date("2026-10-15T21:20:00.000Z"); // 00:20 Riyadh
    expect(nextCronRun("20 0 * * *", "Asia/Riyadh", at)?.toISOString()).toBe("2026-10-16T21:20:00.000Z");
  });

  it("a half-hour and a 45-minute offset zone (Asia/Kolkata, Asia/Kathmandu)", () => {
    const after = new Date("2026-10-15T00:00:00.000Z");
    expect(nextCronRun("0 9 * * *", "Asia/Kolkata", after)?.toISOString()).toBe("2026-10-15T03:30:00.000Z");
    expect(nextCronRun("0 9 * * *", "Asia/Kathmandu", after)?.toISOString()).toBe("2026-10-15T03:15:00.000Z");
  });

  it("lists, ranges, steps, n/step, Sunday as 0 or 7, and the day-of-month OR day-of-week rule", () => {
    const after = new Date("2026-10-15T00:00:00.000Z"); // a Thursday
    // Weekdays 1-5 at 08:00 UTC.
    expect(nextCronRun("0 8 * * 1-5", "UTC", after)?.toISOString()).toBe("2026-10-15T08:00:00.000Z");
    // Sunday written 7 and 0.
    expect(nextCronRun("0 8 * * 7", "UTC", after)?.toISOString()).toBe("2026-10-18T08:00:00.000Z");
    expect(nextCronRun("0 8 * * 0", "UTC", after)?.toISOString()).toBe("2026-10-18T08:00:00.000Z");
    // 5/20 = minutes 5, 25, 45.
    expect(nextCronRun("5/20 3 * * *", "UTC", new Date("2026-10-15T03:06:00Z"))?.toISOString()).toBe(
      "2026-10-15T03:25:00.000Z",
    );
    // Lists and ranges with steps.
    expect(nextCronRun("0 1,13-17/2 * * *", "UTC", new Date("2026-10-15T13:30:00Z"))?.toISOString()).toBe(
      "2026-10-15T15:00:00.000Z",
    );
    // Day 20 OR Friday: Friday 16 comes first.
    expect(nextCronRun("0 0 20 * 5", "UTC", after)?.toISOString()).toBe("2026-10-16T00:00:00.000Z");
    // Day of month only (day of week *).
    expect(nextCronRun("0 0 1 * *", "UTC", after)?.toISOString()).toBe("2026-11-01T00:00:00.000Z");
    // Month restriction.
    expect(nextCronRun("0 0 1 3 *", "UTC", after)?.toISOString()).toBe("2027-03-01T00:00:00.000Z");
  });

  it("a DST zone: the result is a real local minute matching the cron", () => {
    // 2027-03-14 is the US spring-forward day: 02:30 does not exist in New York that day.
    const next = nextCronRun("30 2 * * *", "America/New_York", new Date("2027-03-14T05:00:00Z"));
    expect(next).not.toBeNull();
    expect(oracleMatches("30 2 * * *", next!.getTime(), "America/New_York")).toBe(true);
    expect(next!.toISOString()).toBe("2027-03-15T06:30:00.000Z");
  });

  it(
    "never a guessed time: no match in 366 days, an invalid cron or an unknown zone is null",
    { timeout: 60_000 },
    () => {
      const after = new Date("2026-10-15T00:00:00.000Z");
      expect(nextCronRun("0 0 30 2 *", "UTC", after)).toBeNull(); // 30 February
      expect(nextCronRun("0 0 31 4 *", "Asia/Riyadh", after)).toBeNull(); // 31 April
      for (const bad of ["61 * * * *", "* * * * * *", "a b c d e", "5-1 * * * *", "*/0 * * * *", "", "* * * *"])
        expect(nextCronRun(bad, "UTC", after), bad).toBeNull();
      expect(nextCronRun("0 0 * * *", "Mars/Olympus", after)).toBeNull();
      expect(nextCronRun("0 0 * * *", "UTC", new Date(Number.NaN))).toBeNull();
    },
  );

  it("29 February is found within the 366-day window from a leap-year eve", { timeout: 60_000 }, () => {
    expect(nextCronRun("0 0 29 2 *", "UTC", new Date("2027-03-01T00:00:00Z"))?.toISOString()).toBe(
      "2028-02-29T00:00:00.000Z",
    );
  });
});
