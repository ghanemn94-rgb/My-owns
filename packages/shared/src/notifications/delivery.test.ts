// Unit and property tests of the notification delivery decision (ADR-0044 §5; REQ-S12-025; T-DG5-BE-L). Pure: no
// clock, no locale, no process time zone (run with the locale unset and with C.UTF-8). The property tests draw inputs
// from a seeded generator (deterministic; no dependency) in Asia/Riyadh (the default, no daylight saving), and in
// America/New_York (daylight saving) and Asia/Kolkata (a half-hour offset). Every value is synthetic.
import { describe, expect, it } from "vitest";
import type { WorkingCalendar } from "../time/working-days.ts";
import { businessDateOf, isWorkingDay } from "../time/index.ts";
import {
  decideDelivery,
  digestWindowOf,
  instantOfWallClock,
  minutesOfTime,
  NO_DELIVERY_SETTINGS,
  nextDigestTime,
  quietHoursValid,
  wallClockOf,
  type DeliveryInput,
  type DeliverySettings,
  type DigestMode,
} from "./delivery.ts";

const RIYADH = "Asia/Riyadh";
const SUN_THU: WorkingCalendar = { workweek: [7, 1, 2, 3, 4], holidays: [] };
const OFF = { enabled: false, calendar: null, timezone: RIYADH } as const;
const settings = (over: Partial<DeliverySettings> = {}): DeliverySettings => ({
  ...NO_DELIVERY_SETTINGS(RIYADH),
  ...over,
});
const input = (over: Partial<DeliveryInput> = {}): DeliveryInput => ({
  urgency: "normal",
  settings: settings(),
  workingDays: OFF,
  ...over,
});
const at = (iso: string) => new Date(iso);

describe("ADR-0044 §5 worked cases (Asia/Riyadh, UTC+3)", () => {
  it("no preference and no policy: delivered at once (the DG4 behaviour)", () => {
    expect(decideDelivery(at("2026-10-15T20:30:00Z"), input())).toEqual({
      state: "delivered",
      deliverAfter: null,
      reason: "immediate",
    });
  });

  it("REQ-S12-025: a non-urgent reminder inside quiet hours with a daily digest waits for the next digest after them", () => {
    // 23:30 local on Thursday 2026-10-15; quiet 22:00-07:00; digest daily 08:00 -> Friday 08:00 local = 05:00Z.
    const d = decideDelivery(
      at("2026-10-15T20:30:00Z"),
      input({ settings: settings({ quietHoursStart: "22:00", quietHoursEnd: "07:00", digestMode: "daily" }) }),
    );
    expect(d).toEqual({ state: "held", deliverAfter: at("2026-10-16T05:00:00Z"), reason: "quiet_hours" });
  });

  it("REQ-S12-025: an urgent escalation inside quiet hours is delivered immediately", () => {
    const d = decideDelivery(
      at("2026-10-15T20:30:00Z"),
      input({
        urgency: "urgent",
        settings: settings({ quietHoursStart: "22:00", quietHoursEnd: "07:00", digestMode: "daily" }),
        workingDays: { enabled: true, calendar: SUN_THU, timezone: RIYADH },
      }),
    );
    expect(d).toEqual({ state: "delivered", deliverAfter: null, reason: "urgent" });
  });

  it("quiet hours without a digest hold until they end; they span midnight; the end itself is outside", () => {
    const quiet = settings({ quietHoursStart: "22:00", quietHoursEnd: "07:00" });
    expect(decideDelivery(at("2026-10-15T20:30:00Z"), input({ settings: quiet }))).toEqual({
      state: "held",
      deliverAfter: at("2026-10-16T04:00:00Z"),
      reason: "quiet_hours",
    });
    // 06:59 local is inside, 07:00 local is outside, 21:59 outside, 22:00 inside.
    expect(decideDelivery(at("2026-10-16T03:59:00Z"), input({ settings: quiet })).state).toBe("held");
    expect(decideDelivery(at("2026-10-16T04:00:00Z"), input({ settings: quiet })).state).toBe("delivered");
    expect(decideDelivery(at("2026-10-16T18:59:00Z"), input({ settings: quiet })).state).toBe("delivered");
    expect(decideDelivery(at("2026-10-16T19:00:00Z"), input({ settings: quiet })).state).toBe("held");
  });

  it("quiet hours inside one day (13:00-14:00)", () => {
    const quiet = settings({ quietHoursStart: "13:00", quietHoursEnd: "14:00" });
    expect(decideDelivery(at("2026-10-15T10:30:00Z"), input({ settings: quiet }))).toEqual({
      state: "held",
      deliverAfter: at("2026-10-15T11:00:00Z"),
      reason: "quiet_hours",
    });
    expect(decideDelivery(at("2026-10-15T11:00:00Z"), input({ settings: quiet })).state).toBe("delivered");
  });

  it("a digest outside quiet hours holds until the next digest time; twice daily adds +12 h", () => {
    // 10:00 local; daily 08:00 -> next day 08:00; twice daily -> 20:00 today.
    const now = at("2026-10-15T07:00:00Z");
    expect(decideDelivery(now, input({ settings: settings({ digestMode: "daily" }) }))).toEqual({
      state: "held",
      deliverAfter: at("2026-10-16T05:00:00Z"),
      reason: "digest",
    });
    expect(decideDelivery(now, input({ settings: settings({ digestMode: "twice_daily" }) }))).toEqual({
      state: "held",
      deliverAfter: at("2026-10-15T17:00:00Z"),
      reason: "digest",
    });
  });

  it("business-day timing: on a non-working day (Friday) held until 08:00 of the next working day (Sunday)", () => {
    const rule = { enabled: true, calendar: SUN_THU, timezone: RIYADH };
    expect(decideDelivery(at("2026-10-16T07:00:00Z"), input({ workingDays: rule }))).toEqual({
      state: "held",
      deliverAfter: at("2026-10-18T05:00:00Z"),
      reason: "non_working_day",
    });
    // A working day: delivered; an administered holiday is a non-working day; no calendar: nothing held (Unknown).
    expect(decideDelivery(at("2026-10-15T07:00:00Z"), input({ workingDays: rule })).state).toBe("delivered");
    const withHoliday = {
      ...rule,
      calendar: { ...SUN_THU, holidays: [{ dateFrom: "2026-10-18", dateTo: "2026-10-18", status: "active" as const }] },
    };
    expect(decideDelivery(at("2026-10-16T07:00:00Z"), input({ workingDays: withHoliday })).deliverAfter).toEqual(
      at("2026-10-19T05:00:00Z"),
    );
    expect(decideDelivery(at("2026-10-16T07:00:00Z"), input({ workingDays: { ...rule, calendar: null } })).state).toBe(
      "delivered",
    );
    // The policy off: Friday is not special.
    expect(decideDelivery(at("2026-10-16T07:00:00Z"), input()).state).toBe("delivered");
  });

  it("every digest time inside quiet hours: never held forever, released when the quiet hours end", () => {
    const s = settings({ quietHoursStart: "00:00", quietHoursEnd: "23:59", digestMode: "daily", digestTime: "12:00" });
    const d = decideDelivery(at("2026-10-15T09:00:00Z"), input({ settings: s }));
    expect(d.state).toBe("held");
    expect(d.deliverAfter).toEqual(at("2026-10-15T20:59:00Z"));
  });

  it("time helpers: HH:MM parsing, quiet-hours validity (NP09), the digest window", () => {
    expect(minutesOfTime("07:30")).toBe(450);
    expect(minutesOfTime("07:30:00")).toBe(450);
    expect(() => minutesOfTime("24:00")).toThrow(RangeError);
    expect(quietHoursValid(null, null)).toBe(true);
    expect(quietHoursValid("22:00", "07:00")).toBe(true);
    expect(quietHoursValid("22:00", "22:00")).toBe(false);
    expect(quietHoursValid("22:00", null)).toBe(false);
    expect(digestWindowOf(at("2026-10-15T05:07:31Z"))).toEqual({
      start: at("2026-10-15T05:00:00Z"),
      end: at("2026-10-15T05:15:00Z"),
    });
    expect(instantOfWallClock("2026-10-15", 8 * 60, RIYADH)).toEqual(at("2026-10-15T05:00:00Z"));
    expect(wallClockOf(at("2026-10-15T21:30:00Z"), RIYADH)).toEqual({ date: "2026-10-16", minutes: 30 });
  });

  it("daylight saving (America/New_York): wall clocks across the March and November changes", () => {
    const NY = "America/New_York";
    expect(instantOfWallClock("2026-03-07", 8 * 60, NY)).toEqual(at("2026-03-07T13:00:00Z")); // EST
    expect(instantOfWallClock("2026-03-09", 8 * 60, NY)).toEqual(at("2026-03-09T12:00:00Z")); // EDT
    expect(instantOfWallClock("2026-11-02", 8 * 60, NY)).toEqual(at("2026-11-02T13:00:00Z")); // EST again
    // 02:30 does not exist on 2026-03-08: resolved after the gap, never before it.
    expect(instantOfWallClock("2026-03-08", 150, NY).getTime()).toBeGreaterThanOrEqual(
      at("2026-03-08T07:00:00Z").getTime(),
    );
    const s: DeliverySettings = { ...NO_DELIVERY_SETTINGS(NY), digestMode: "daily", digestTime: "08:00" };
    // Saturday 2026-03-07 10:00 EST -> Sunday 08:00 EDT (12:00Z).
    expect(nextDigestTime(at("2026-03-07T15:00:00Z"), s)).toEqual(at("2026-03-08T12:00:00Z"));
  });
});

// ------------------------------------------------------------------------------------------------ properties

/** Mulberry32: a small seeded generator, so every run draws the same cases. */
function generator(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ZONES = [RIYADH, "America/New_York", "Asia/Kolkata"] as const;
const MODES: readonly DigestMode[] = ["off", "daily", "twice_daily"];
const pad = (n: number) => String(n).padStart(2, "0");
const timeOf = (minutes: number) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;

// Generous timeouts: the cases are fixed, only the machine load varies (F-DG4-143 to F-DG4-148).
describe("properties (seeded; Asia/Riyadh, America/New_York, Asia/Kolkata)", { timeout: 60_000 }, () => {
  const rnd = generator(0x5125);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;
  const CASES = 2000;
  // 2026-01-01 .. 2027-12-31, minute resolution with seconds.
  const from = Date.UTC(2026, 0, 1);
  const span = Date.UTC(2028, 0, 1) - from;

  const cases = Array.from({ length: CASES }, () => {
    const timezone = pick(ZONES);
    const quiet = rnd() < 0.6;
    const start = Math.floor(rnd() * 1440);
    let end = Math.floor(rnd() * 1440);
    if (end === start) end = (end + 1) % 1440;
    const s: DeliverySettings = {
      quietHoursStart: quiet ? timeOf(start) : null,
      quietHoursEnd: quiet ? timeOf(end) : null,
      timezone,
      digestMode: pick(MODES),
      digestTime: timeOf(Math.floor(rnd() * 1440)),
    };
    const workweeks = [[7, 1, 2, 3, 4], [1, 2, 3, 4, 5], [6]];
    const rule = { enabled: rnd() < 0.5, calendar: { workweek: pick(workweeks), holidays: [] }, timezone };
    const now = new Date(from + Math.floor(rnd() * span));
    const urgency = rnd() < 0.15 ? ("urgent" as const) : ("normal" as const);
    return { now, input: { urgency, settings: s, workingDays: rule } satisfies DeliveryInput };
  });

  const inQuiet = (t: Date, s: DeliverySettings): boolean => {
    if (s.quietHoursStart === null || s.quietHoursEnd === null) return false;
    const m = wallClockOf(t, s.timezone).minutes;
    const a = minutesOfTime(s.quietHoursStart);
    const b = minutesOfTime(s.quietHoursEnd);
    return a < b ? m >= a && m < b : m >= a || m < b;
  };

  /** Outside quiet hours, on a working day when the policy says so, and at a digest time when a digest is on. */
  const satisfies = (t: Date, i: DeliveryInput): boolean => {
    const s = i.settings;
    if (inQuiet(t, s)) return false;
    if (i.workingDays.enabled && !isWorkingDay(businessDateOf(t, i.workingDays.timezone), i.workingDays.calendar!))
      return false;
    return s.digestMode === "off" || nextDigestTime(t, s)!.getTime() === t.getTime();
  };

  /** `now` and, for each of the next eight local days, its midnight, quiet-hours end and digest times. */
  const candidatesAfter = (now: Date, s: DeliverySettings): Date[] => {
    const out = [now];
    let date = wallClockOf(now, s.timezone).date;
    for (let d = 0; d <= 8; d += 1) {
      const minutes = [0, minutesOfTime(s.digestTime), (minutesOfTime(s.digestTime) + 720) % 1440];
      if (s.quietHoursEnd !== null) minutes.push(minutesOfTime(s.quietHoursEnd));
      for (const m of minutes) out.push(instantOfWallClock(date, m, s.timezone));
      date = wallClockOf(new Date(instantOfWallClock(date, 0, s.timezone).getTime() + 36 * 3_600_000), s.timezone).date;
    }
    return out.filter((t) => t.getTime() >= now.getTime());
  };

  it("urgent is always delivered at once; a held notification is never released before it was created", () => {
    for (const c of cases) {
      const d = decideDelivery(c.now, c.input);
      if (c.input.urgency === "urgent") expect(d).toEqual({ state: "delivered", deliverAfter: null, reason: "urgent" });
      if (d.state === "held") expect(d.deliverAfter.getTime()).toBeGreaterThanOrEqual(c.now.getTime());
    }
  });

  it("a release is outside quiet hours, on a working day when the policy says so, and at a digest time when one is on", () => {
    let held = 0;
    let unsatisfiable = 0;
    for (const c of cases) {
      const d = decideDelivery(c.now, c.input);
      if (d.state !== "held") continue;
      held += 1;
      const t = d.deliverAfter;
      if (satisfies(t, c.input)) continue;
      // The only allowed exception is the bounded fallback for a combination that cannot be satisfied: then no
      // instant of the next eight days satisfies it either. The earliest satisfying instant of any allowed stretch is
      // `now`, a quiet-hours end, a local midnight or a digest time, so checking those candidates is exhaustive.
      unsatisfiable += 1;
      for (const candidate of candidatesAfter(c.now, c.input.settings))
        expect(satisfies(candidate, c.input)).toBe(false);
    }
    expect(held).toBeGreaterThan(CASES / 3);
    // The generator deliberately draws harsh combinations (a one-day workweek, long quiet hours, digest times inside
    // them), so both branches are exercised: most held cases are satisfied, some can never be.
    expect(unsatisfiable).toBeGreaterThan(0);
    expect(unsatisfiable).toBeLessThan(held / 2);
  });

  it("nothing configured (no quiet hours, digest off, no working-day rule): every notification is delivered at once", () => {
    for (const c of cases) {
      const d = decideDelivery(c.now, {
        urgency: c.input.urgency,
        settings: NO_DELIVERY_SETTINGS(c.input.settings.timezone),
        workingDays: { ...c.input.workingDays, enabled: false },
      });
      expect(d.state).toBe("delivered");
    }
  });

  it("delivered at once only when no rule applies at that instant", () => {
    for (const c of cases) {
      const d = decideDelivery(c.now, c.input);
      if (d.state !== "delivered" || d.reason === "urgent") continue;
      const s = c.input.settings;
      expect(s.digestMode).toBe("off");
      expect(inQuiet(c.now, s)).toBe(false);
      if (c.input.workingDays.enabled)
        expect(isWorkingDay(businessDateOf(c.now, s.timezone), c.input.workingDays.calendar)).toBe(true);
    }
  });

  it("wall clocks round-trip at minute resolution in each zone (a repeated hour resolves to an instant with that wall clock)", () => {
    for (const c of cases.slice(0, 1000)) {
      const tz = c.input.settings.timezone;
      const minuteStart = new Date(Math.floor(c.now.getTime() / 60_000) * 60_000);
      const wall = wallClockOf(minuteStart, tz);
      const back = instantOfWallClock(wall.date, Math.round(wall.minutes), tz);
      expect(wallClockOf(back, tz)).toEqual(wall);
      expect(Math.abs(back.getTime() - minuteStart.getTime())).toBeLessThanOrEqual(3_600_000);
    }
  });
});
