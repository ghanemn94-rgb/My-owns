// Unit tests of the working-day arithmetic and business dates (ADR-0025 §1-§2; REQ-S10-006, REQ-S15-008). The three
// ADR-0025 §1 worked examples are pinned literally. Run with the locale unset and with LANG=C.UTF-8 (S-8): nothing here
// may depend on the process locale or timezone.
import { describe, expect, it } from "vitest";
import {
  addWorkingDays,
  businessDateOf,
  isBusinessDate,
  isKnownTimeZone,
  isoWeekdayOf,
  isValidWorkweek,
  isWorkingDay,
  MAX_LOOKAHEAD_DAYS,
  type WorkingCalendar,
} from "./index.ts";

/** The default calendar of migration 0028: Sunday-Thursday, no holiday. */
const SUN_THU = [7, 1, 2, 3, 4];
const plain: WorkingCalendar = { workweek: SUN_THU, holidays: [] };
const holiday = (dateFrom: string, dateTo = dateFrom, id = "h-1") => ({
  id,
  dateFrom,
  dateTo,
  status: "active" as const,
});

describe("ADR-0025 §1 worked examples (pinned)", () => {
  it("REQ-PB-066 / A09: raised Thursday 2026-10-08, n = 5, Sunday-Thursday, no holiday -> Thursday 2026-10-15", () => {
    const r = addWorkingDays("2026-10-08", 5, plain);
    expect(r).toEqual({
      dueDate: "2026-10-15",
      unknownReason: null,
      skippedDates: [
        { date: "2026-10-09", reason: "weekend", holidayId: null },
        { date: "2026-10-10", reason: "weekend", holidayId: null },
      ],
    });
    expect(isoWeekdayOf("2026-10-08")).toBe(4);
    expect(isoWeekdayOf("2026-10-15")).toBe(4);
  });

  it("the same with a configured holiday on Sunday 2026-10-11 -> Sunday 2026-10-18", () => {
    const r = addWorkingDays("2026-10-08", 5, { workweek: SUN_THU, holidays: [holiday("2026-10-11")] });
    expect(r.dueDate).toBe("2026-10-18");
    expect(r.skippedDates).toEqual([
      { date: "2026-10-09", reason: "weekend", holidayId: null },
      { date: "2026-10-10", reason: "weekend", holidayId: null },
      { date: "2026-10-11", reason: "holiday", holidayId: "h-1" },
      { date: "2026-10-16", reason: "weekend", holidayId: null },
      { date: "2026-10-17", reason: "weekend", holidayId: null },
    ]);
  });

  it("REQ-S10-006: raised Wednesday 2026-10-14, holiday Thursday 2026-10-15, n = 5 -> Thursday 2026-10-22", () => {
    const r = addWorkingDays("2026-10-14", 5, { workweek: SUN_THU, holidays: [holiday("2026-10-15")] });
    expect(r.dueDate).toBe("2026-10-22");
    // Thursday 15 skipped as a holiday, Friday and Saturday as weekend days.
    expect(r.skippedDates.slice(0, 3)).toEqual([
      { date: "2026-10-15", reason: "holiday", holidayId: "h-1" },
      { date: "2026-10-16", reason: "weekend", holidayId: null },
      { date: "2026-10-17", reason: "weekend", holidayId: null },
    ]);
    // Without the holiday it is Wednesday 2026-10-21.
    expect(addWorkingDays("2026-10-14", 5, plain).dueDate).toBe("2026-10-21");
  });
});

describe("addWorkingDays rules", () => {
  it("never counts the raise day, even when it is a working day", () => {
    expect(addWorkingDays("2026-10-11", 1, plain).dueDate).toBe("2026-10-12"); // Sunday -> Monday
  });

  it("raised on a non-working day: the count starts on the next working day", () => {
    expect(addWorkingDays("2026-10-09", 1, plain).dueDate).toBe("2026-10-11"); // Friday -> Sunday
    expect(addWorkingDays("2026-10-10", 1, plain).dueDate).toBe("2026-10-11"); // Saturday -> Sunday
  });

  it("is never elapsed calendar days: 5 working days across a weekend are 7 calendar days", () => {
    const r = addWorkingDays("2026-10-08", 5, plain);
    expect(r.dueDate).not.toBe("2026-10-13"); // 5 elapsed days
  });

  it("ignores removed holidays and honours multi-day ranges", () => {
    const removed = { id: "gone", dateFrom: "2026-10-11", dateTo: "2026-10-11", status: "removed" as const };
    expect(addWorkingDays("2026-10-08", 5, { workweek: SUN_THU, holidays: [removed] }).dueDate).toBe("2026-10-15");
    const eid = holiday("2026-10-11", "2026-10-14", "eid");
    expect(addWorkingDays("2026-10-08", 1, { workweek: SUN_THU, holidays: [eid] }).dueDate).toBe("2026-10-15");
  });

  it("uses a configured workweek (Monday-Friday) instead of the default", () => {
    expect(addWorkingDays("2026-10-08", 5, { workweek: [1, 2, 3, 4, 5], holidays: [] }).dueDate).toBe("2026-10-15");
    expect(addWorkingDays("2026-10-09", 1, { workweek: [1, 2, 3, 4, 5], holidays: [] }).dueDate).toBe("2026-10-12");
  });

  it("crosses month, year and leap-day boundaries", () => {
    expect(addWorkingDays("2026-12-31", 1, plain).dueDate).toBe("2027-01-03"); // Thu -> Sun
    expect(addWorkingDays("2028-02-28", 1, { workweek: [1, 2, 3, 4, 5, 6, 7], holidays: [] }).dueDate).toBe(
      "2028-02-29",
    );
  });

  it("no calendar -> Unknown with reason calendar_not_configured (never a guessed date)", () => {
    expect(addWorkingDays("2026-10-08", 5, null)).toEqual({
      dueDate: null,
      unknownReason: "calendar_not_configured",
      skippedDates: [],
    });
  });

  it("fewer than n working days within the look-ahead window -> Unknown", () => {
    // Every Sunday of the next ten years a holiday: a Sunday-only workweek finds no working day.
    const r = addWorkingDays("2026-10-08", 1, {
      workweek: [7],
      holidays: Array.from({ length: Math.ceil(MAX_LOOKAHEAD_DAYS / 7) + 1 }, (_, i) => {
        const d = new Date(Date.UTC(2026, 9, 11 + 7 * i)).toISOString().slice(0, 10);
        return holiday(d, d, `s${i}`);
      }),
    });
    expect([r.dueDate, r.unknownReason]).toEqual([null, "calendar_not_configured"]);
  });

  it("refuses malformed input instead of guessing", () => {
    expect(() => addWorkingDays("2026-02-30", 1, plain)).toThrow(RangeError);
    expect(() => addWorkingDays("2026-10-08", 0, plain)).toThrow(RangeError);
    expect(() => addWorkingDays("2026-10-08", 1.5, plain)).toThrow(RangeError);
    expect(() => addWorkingDays("2026-10-08", 1, { workweek: [], holidays: [] })).toThrow(RangeError);
    expect(() => addWorkingDays("2026-10-08", 1, { workweek: [1, 1], holidays: [] })).toThrow(RangeError);
  });
});

describe("isWorkingDay / isValidWorkweek / isBusinessDate", () => {
  it("a working day is in the workweek and not covered by an active holiday", () => {
    expect(isWorkingDay("2026-10-11", plain)).toBe(true); // Sunday
    expect(isWorkingDay("2026-10-09", plain)).toBe(false); // Friday
    expect(isWorkingDay("2026-10-15", { workweek: SUN_THU, holidays: [holiday("2026-10-15")] })).toBe(false);
  });
  it("workweek validity mirrors business_calendar_workweek_valid", () => {
    expect(isValidWorkweek([7, 1, 2, 3, 4])).toBe(true);
    expect(isValidWorkweek([1, 2, 3, 4, 5, 6, 7])).toBe(true);
    expect(isValidWorkweek([])).toBe(false);
    expect(isValidWorkweek([0])).toBe(false);
    expect(isValidWorkweek([8])).toBe(false);
    expect(isValidWorkweek([1, 1])).toBe(false);
    expect(isValidWorkweek([1, 2, 3, 4, 5, 6, 7, 1])).toBe(false);
    expect(isValidWorkweek([1.5])).toBe(false);
  });
  it("business dates are real calendar dates", () => {
    expect(isBusinessDate("2026-10-08")).toBe(true);
    expect(isBusinessDate("2026-02-29")).toBe(false);
    expect(isBusinessDate("2026-10-8")).toBe(false);
    expect(isBusinessDate("2026-10-08T00:00:00Z")).toBe(false);
  });
});

describe("businessDateOf (REQ-S15-008; ADR-0025 §2, probe G09 twin)", () => {
  it("an entry at 23:30 Riyadh on 2026-11-02 has business date 2026-11-02", () => {
    expect(businessDateOf("2026-11-02T20:30:00Z", "Asia/Riyadh")).toBe("2026-11-02");
    expect(businessDateOf(new Date("2026-11-02T20:30:00Z"), "Asia/Riyadh")).toBe("2026-11-02");
  });
  it("an entry at 00:30 Riyadh on 2026-11-02 (2026-11-01T21:30Z) is 2026-11-02, not the UTC date", () => {
    expect(businessDateOf("2026-11-01T21:30:00Z", "Asia/Riyadh")).toBe("2026-11-02");
    expect(businessDateOf("2026-11-01T21:30:00Z", "UTC")).toBe("2026-11-01");
  });
  it("honours another configured timezone", () => {
    expect(businessDateOf("2026-11-02T03:00:00Z", "America/New_York")).toBe("2026-11-01");
  });
  it("unknown zones and invalid instants are refused", () => {
    expect(isKnownTimeZone("Asia/Riyadh")).toBe(true);
    expect(isKnownTimeZone("Mars/Olympus")).toBe(false);
    expect(() => businessDateOf("2026-11-02T20:30:00Z", "Mars/Olympus")).toThrow(RangeError);
    expect(() => businessDateOf("not a date", "Asia/Riyadh")).toThrow(RangeError);
  });
});
