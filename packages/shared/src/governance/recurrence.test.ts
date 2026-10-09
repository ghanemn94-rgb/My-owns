// Unit tests of the meeting-series recurrence (ADR-0032 §2-§3.1; REQ-PB-060, REQ-S10-005; T-DG4-BE-F): weekly ->
// fortnightly, monthly day 28, daily on a Sunday-Thursday week with a holiday, the three non-working-day rules over an
// injected predicate, Unknown without a calendar, and the working-day agenda cut-off. All dates and holidays are
// SYNTHETIC test data, not a real holiday list.
import { describe, expect, it } from "vitest";
import { isWorkingDay } from "../time/working-days.ts";
import {
  addCalendarDays,
  cutoffDateOf,
  nominalOccurrences,
  nextWorkingDay,
  ruleNeedsCalendar,
  seriesOccurrences,
  type RecurrenceRule,
} from "./recurrence.ts";

const SUN_THU = [7, 1, 2, 3, 4];
/** Sunday-Thursday workweek with a synthetic one-day holiday on Tuesday 2026-10-13. */
const withHoliday = (d: string) =>
  isWorkingDay(d, { workweek: SUN_THU, holidays: [{ dateFrom: "2026-10-13", dateTo: "2026-10-13" }] });
const sunThu = (d: string) => isWorkingDay(d, { workweek: SUN_THU, holidays: [] });

const rule = (r: Partial<RecurrenceRule>): RecurrenceRule => ({
  frequency: "weekly",
  intervalCount: 1,
  weekdays: [1],
  monthDay: null,
  startDate: "2026-10-01",
  endDate: null,
  nonWorkingDayRule: "next_working_day",
  ...r,
});

describe("nominalOccurrences", () => {
  it("weekly on Monday: one date per week", () => {
    expect(nominalOccurrences(rule({}), "2026-10-01", "2026-11-02")).toEqual([
      "2026-10-05",
      "2026-10-12",
      "2026-10-19",
      "2026-10-26",
      "2026-11-02",
    ]);
  });
  it("weekly -> fortnightly (intervalCount 2): every second ISO week counted from the start date's week", () => {
    // 2026-10-01 is a Thursday in the ISO week starting Monday 2026-09-28; weeks 0, 2, 4 ... hold a meeting.
    expect(nominalOccurrences(rule({ intervalCount: 2 }), "2026-10-01", "2026-11-09")).toEqual([
      "2026-10-12",
      "2026-10-26",
      "2026-11-09",
    ]);
  });
  it("weekly on two weekdays", () => {
    expect(nominalOccurrences(rule({ weekdays: [7, 3] }), "2026-10-04", "2026-10-14")).toEqual([
      "2026-10-04",
      "2026-10-07",
      "2026-10-11",
      "2026-10-14",
    ]);
  });
  it("monthly day 28, every month, also in February", () => {
    expect(
      nominalOccurrences(rule({ frequency: "monthly", weekdays: null, monthDay: 28 }), "2026-10-01", "2027-03-31"),
    ).toEqual(["2026-10-28", "2026-11-28", "2026-12-28", "2027-01-28", "2027-02-28", "2027-03-28"]);
  });
  it("monthly every 2nd month counts from the start month", () => {
    expect(
      nominalOccurrences(
        rule({ frequency: "monthly", weekdays: null, monthDay: 28, intervalCount: 2, startDate: "2026-11-15" }),
        "2026-10-01",
        "2027-05-31",
      ),
    ).toEqual(["2026-11-28", "2027-01-28", "2027-03-28", "2027-05-28"]);
  });
  it("monthly: a day before the start date in the start month is not an occurrence", () => {
    expect(
      nominalOccurrences(
        rule({ frequency: "monthly", weekdays: null, monthDay: 5, startDate: "2026-10-09" }),
        "2026-10-01",
        "2026-11-30",
      ),
    ).toEqual(["2026-11-05"]);
  });
  it("daily every 2nd calendar day counted from the start date", () => {
    expect(
      nominalOccurrences(
        rule({ frequency: "daily", weekdays: null, intervalCount: 2, startDate: "2026-10-04" }),
        "2026-10-05",
        "2026-10-12",
      ),
    ).toEqual(["2026-10-06", "2026-10-08", "2026-10-10", "2026-10-12"]);
  });
  it("clips to the end date and returns nothing for an empty window", () => {
    expect(nominalOccurrences(rule({ endDate: "2026-10-12" }), "2026-10-01", "2026-12-31")).toEqual([
      "2026-10-05",
      "2026-10-12",
    ]);
    expect(nominalOccurrences(rule({}), "2026-10-20", "2026-10-10")).toEqual([]);
  });
  it("rejects an invalid interval and month day", () => {
    expect(() => nominalOccurrences(rule({ intervalCount: 0 }), "2026-10-01", "2026-10-31")).toThrow(RangeError);
    expect(() =>
      nominalOccurrences(rule({ frequency: "monthly", weekdays: null, monthDay: 31 }), "2026-10-01", "2026-10-31"),
    ).toThrow(RangeError);
  });
});

describe("seriesOccurrences: working days from the business calendar", () => {
  it("daily on a Sunday-Thursday week with a holiday: no Friday, Saturday or holiday meeting", () => {
    const r = seriesOccurrences(
      rule({ frequency: "daily", weekdays: null, startDate: "2026-10-09" }),
      "2026-10-09",
      "2026-10-18",
      withHoliday,
    );
    expect(r).toEqual({
      status: "known",
      occurrences: ["2026-10-11", "2026-10-12", "2026-10-14", "2026-10-15", "2026-10-18"].map((d) => ({
        occurrenceDate: d,
        scheduledDate: d,
      })),
    });
  });
  it("a daily series ignores next_working_day and keep: it meets on working days only", () => {
    for (const nonWorkingDayRule of ["keep", "next_working_day", "skip"] as const) {
      const r = seriesOccurrences(
        rule({ frequency: "daily", weekdays: null, startDate: "2026-10-09", nonWorkingDayRule }),
        "2026-10-09",
        "2026-10-11",
        sunThu,
      );
      expect(r).toEqual({
        status: "known",
        occurrences: [{ occurrenceDate: "2026-10-11", scheduledDate: "2026-10-11" }],
      });
    }
  });
  it("weekly on Tuesday with the holiday: next_working_day moves the meeting, the occurrence date stays", () => {
    const r = seriesOccurrences(rule({ weekdays: [2] }), "2026-10-12", "2026-10-21", withHoliday);
    expect(r).toEqual({
      status: "known",
      occurrences: [
        { occurrenceDate: "2026-10-13", scheduledDate: "2026-10-14" },
        { occurrenceDate: "2026-10-20", scheduledDate: "2026-10-20" },
      ],
    });
  });
  it("skip drops the non-working date; keep holds it", () => {
    const skip = seriesOccurrences(
      rule({ weekdays: [2], nonWorkingDayRule: "skip" }),
      "2026-10-12",
      "2026-10-21",
      withHoliday,
    );
    expect(skip).toEqual({
      status: "known",
      occurrences: [{ occurrenceDate: "2026-10-20", scheduledDate: "2026-10-20" }],
    });
    const keep = seriesOccurrences(
      rule({ weekdays: [2], nonWorkingDayRule: "keep" }),
      "2026-10-12",
      "2026-10-14",
      withHoliday,
    );
    expect(keep).toEqual({
      status: "known",
      occurrences: [{ occurrenceDate: "2026-10-13", scheduledDate: "2026-10-13" }],
    });
  });
  it("without a calendar: Unknown for daily and for next_working_day/skip; keep needs no calendar", () => {
    expect(ruleNeedsCalendar({ frequency: "weekly", nonWorkingDayRule: "keep" })).toBe(false);
    expect(seriesOccurrences(rule({ frequency: "daily", weekdays: null }), "2026-10-01", "2026-10-31", null)).toEqual({
      status: "unknown",
      reason: "calendar_not_configured",
    });
    expect(seriesOccurrences(rule({}), "2026-10-01", "2026-10-31", null)).toEqual({
      status: "unknown",
      reason: "calendar_not_configured",
    });
    const keep = seriesOccurrences(rule({ nonWorkingDayRule: "keep" }), "2026-10-01", "2026-10-06", null);
    expect(keep).toEqual({
      status: "known",
      occurrences: [{ occurrenceDate: "2026-10-05", scheduledDate: "2026-10-05" }],
    });
  });
  it("next_working_day gives up (no meeting) when no working day exists within a year", () => {
    expect(nextWorkingDay("2026-10-09", () => false)).toBeNull();
    expect(seriesOccurrences(rule({}), "2026-10-05", "2026-10-05", () => false)).toEqual({
      status: "known",
      occurrences: [],
    });
  });
});

describe("cutoffDateOf: working days before the meeting", () => {
  it("2 working days before Thursday 2026-10-15 skip the holiday on Tuesday 2026-10-13", () => {
    expect(cutoffDateOf("2026-10-15", 2, withHoliday)).toBe("2026-10-12");
    expect(cutoffDateOf("2026-10-15", 2, sunThu)).toBe("2026-10-13");
  });
  it("2 working days before Sunday 2026-10-11 skip the Friday-Saturday weekend", () => {
    expect(cutoffDateOf("2026-10-11", 2, sunThu)).toBe("2026-10-07");
  });
  it("0 working days is the meeting date; no calendar is Unknown (null)", () => {
    expect(cutoffDateOf("2026-10-11", 0, sunThu)).toBe("2026-10-11");
    expect(cutoffDateOf("2026-10-11", 2, null)).toBeNull();
    expect(cutoffDateOf("2026-10-11", 2, () => false)).toBeNull();
    expect(() => cutoffDateOf("2026-10-11", -1, sunThu)).toThrow(RangeError);
  });
  it("addCalendarDays is plain date arithmetic for windows", () => {
    expect(addCalendarDays("2026-10-09", 90)).toBe("2027-01-07");
    expect(addCalendarDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});
