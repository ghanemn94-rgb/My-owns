// Unit tests of the working-day slip (ADR-0031 §7; REQ-S09-007 A05 "forecast slip vs approved date is shown in working
// days"; T-DG4-BE-E). The worked examples of ADR-0031 §7 on a Sunday-Thursday workweek (the default calendar's), with
// and without an administered holiday. All dates and holidays are SYNTHETIC test data, not a real holiday list.
import { describe, expect, it } from "vitest";
import { computeWorkingDaySlip, MAX_SLIP_RANGE_DAYS } from "./working-day-slip.ts";

const SUN_THU = [7, 1, 2, 3, 4];
const noHoliday = { workweek: SUN_THU, holidays: [] };
const holidaySun11 = { workweek: SUN_THU, holidays: [{ dateFrom: "2026-10-11", dateTo: "2026-10-11" }] };

describe("computeWorkingDaySlip: the ADR-0031 §7 examples", () => {
  it("approved Thu 2026-10-08, forecast Thu 2026-10-15, no holiday -> +5 working days (7 calendar days)", () => {
    expect(computeWorkingDaySlip("2026-10-08", "2026-10-15", noHoliday)).toEqual({
      status: "known",
      value: 5,
      reason: null,
    });
  });
  it("the same with a holiday on Sun 2026-10-11 -> +4", () => {
    expect(computeWorkingDaySlip("2026-10-08", "2026-10-15", holidaySun11)).toEqual({
      status: "known",
      value: 4,
      reason: null,
    });
  });
  it("approved Thu 2026-10-15, forecast Thu 2026-10-08 -> -5", () => {
    expect(computeWorkingDaySlip("2026-10-15", "2026-10-08", noHoliday)).toEqual({
      status: "known",
      value: -5,
      reason: null,
    });
  });
  it("approved = forecast -> 0", () => {
    expect(computeWorkingDaySlip("2026-10-08", "2026-10-08", noHoliday)).toEqual({
      status: "known",
      value: 0,
      reason: null,
    });
  });
});

describe("computeWorkingDaySlip: edges and Unknown", () => {
  it("a forecast moved from Thursday to the following Friday or Saturday (weekend) slips 0 working days", () => {
    expect(computeWorkingDaySlip("2026-10-08", "2026-10-09", noHoliday).value).toBe(0);
    expect(computeWorkingDaySlip("2026-10-08", "2026-10-10", noHoliday).value).toBe(0);
    expect(computeWorkingDaySlip("2026-10-08", "2026-10-11", noHoliday).value).toBe(1);
  });
  it("an early forecast on the same holiday is symmetric (-4)", () => {
    expect(computeWorkingDaySlip("2026-10-15", "2026-10-08", holidaySun11).value).toBe(-4);
  });
  it("a removed holiday is ignored; a multi-day holiday covers every day of its range", () => {
    expect(
      computeWorkingDaySlip("2026-10-08", "2026-10-15", {
        workweek: SUN_THU,
        holidays: [{ dateFrom: "2026-10-11", dateTo: "2026-10-11", status: "removed" }],
      }).value,
    ).toBe(5);
    expect(
      computeWorkingDaySlip("2026-10-08", "2026-10-15", {
        workweek: SUN_THU,
        holidays: [{ dateFrom: "2026-10-11", dateTo: "2026-10-13" }],
      }).value,
    ).toBe(2);
  });
  it("another configured workweek (Monday-Friday) gives another count: no hard-coded weekend", () => {
    expect(computeWorkingDaySlip("2026-10-08", "2026-10-15", { workweek: [1, 2, 3, 4, 5], holidays: [] }).value).toBe(
      5,
    );
    expect(computeWorkingDaySlip("2026-10-09", "2026-10-11", { workweek: [1, 2, 3, 4, 5], holidays: [] }).value).toBe(
      0,
    );
    expect(computeWorkingDaySlip("2026-10-09", "2026-10-11", noHoliday).value).toBe(1);
  });
  it("a missing date or calendar is Unknown with its reason, never 0 and never calendar days", () => {
    expect(computeWorkingDaySlip(null, "2026-10-15", noHoliday)).toEqual({
      status: "unknown",
      value: null,
      reason: "approved_date_missing",
    });
    expect(computeWorkingDaySlip("2026-10-08", null, noHoliday)).toEqual({
      status: "unknown",
      value: null,
      reason: "forecast_date_missing",
    });
    expect(computeWorkingDaySlip("2026-10-08", "2026-10-15", null)).toEqual({
      status: "unknown",
      value: null,
      reason: "calendar_not_configured",
    });
    expect(computeWorkingDaySlip(null, null, null).reason).toBe("approved_date_missing");
  });
  it("more than 3,660 calendar days apart is Unknown (range_too_long); exactly 3,660 is computed", () => {
    expect(MAX_SLIP_RANGE_DAYS).toBe(3660);
    expect(computeWorkingDaySlip("2020-01-01", "2030-12-31", noHoliday)).toEqual({
      status: "unknown",
      value: null,
      reason: "range_too_long",
    });
    const edge = computeWorkingDaySlip("2020-01-01", "2030-01-08", noHoliday); // 3,660 days
    expect(edge.status).toBe("known");
    expect(edge.value).toBeGreaterThan(2500);
  });
  it("an invalid date string is a programming error", () => {
    expect(() => computeWorkingDaySlip("2026-02-30", "2026-03-01", noHoliday)).toThrow(RangeError);
  });
});
