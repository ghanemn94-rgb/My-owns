// Pure helpers of the launch plan (T-DG5-BE-P; ADR-0048 §1-§3; D-142 Q6): calendar-day arithmetic (day d = start date
// + d calendar days, never a working-day shift) and the loop check of putLaunchTaskPredecessors.
import { describe, expect, it } from "vitest";
import { addCalendarDays, calendarDaysBetween } from "./plan.ts";
import { reaches } from "./predecessors.ts";

describe("launch plan dates (calendar days, D-142 Q6)", () => {
  it("day d of a plan starting 2026-10-01 is start + d calendar days", () => {
    expect(addCalendarDays("2026-10-01", 0)).toBe("2026-10-01");
    expect(addCalendarDays("2026-10-01", 30)).toBe("2026-10-31");
    expect(addCalendarDays("2026-10-01", 31)).toBe("2026-11-01");
    expect(addCalendarDays("2026-10-01", 60)).toBe("2026-11-30");
    expect(addCalendarDays("2026-10-01", 90)).toBe("2026-12-30");
  });
  it("crosses month, year and leap-day boundaries and goes backwards", () => {
    expect(addCalendarDays("2027-12-25", 7)).toBe("2028-01-01");
    expect(addCalendarDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addCalendarDays("2026-11-01", -7)).toBe("2026-10-25");
  });
  it("counts the days between two dates, signed", () => {
    expect(calendarDaysBetween("2026-10-01", "2026-10-08")).toBe(7);
    expect(calendarDaysBetween("2026-10-08", "2026-10-01")).toBe(-7);
    expect(calendarDaysBetween("2026-10-01", "2026-10-01")).toBe(0);
    expect(calendarDaysBetween("2026-12-30", "2027-03-01")).toBe(61);
  });
});

describe("predecessor loop check", () => {
  const edges = new Map<string, string[]>([
    ["b", ["a"]],
    ["c", ["b"]],
  ]);
  it("finds a loop through a chain of predecessors", () => {
    expect(reaches(edges, ["c"], "a")).toBe(true); // a needs c, c needs b, b needs a
    expect(reaches(edges, ["a"], "c")).toBe(false);
    expect(reaches(edges, [], "a")).toBe(false);
  });
  it("terminates on an existing cycle in the data", () => {
    const cyclic = new Map<string, string[]>([
      ["x", ["y"]],
      ["y", ["x"]],
    ]);
    expect(reaches(cyclic, ["x"], "z")).toBe(false);
  });
});
