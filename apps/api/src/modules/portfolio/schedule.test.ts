// Unit tests of the pure schedule flags (ADR-0023 §5; REQ-S09-008, REQ-S09-004; T-DG3-BE-C). No database.
// Needed-by conflict, sequenced before the predecessor (by date and by wave), and Unknown (never "no conflict").
import { describe, expect, it } from "vitest";
import {
  computeScheduleFlags,
  dependencyFlags,
  predecessorFinish,
  SCHEDULE_FLAG_CODES,
  type ScheduleDependency,
  type ScheduleInitiative,
  type ScheduleMilestone,
} from "./schedule.ts";

const A = "01920000-0000-7000-8000-0000000000a1";
const B = "01920000-0000-7000-8000-0000000000b1";
const DEP = "01920000-0000-7000-8000-0000000000d1";

const ini = (id: string, code: string, over: Partial<ScheduleInitiative> = {}): ScheduleInitiative => ({
  id,
  code,
  plannedStart: null,
  plannedEnd: null,
  waveOrdinal: null,
  ...over,
});
const ms = (initiativeId: string, over: Partial<ScheduleMilestone> = {}): ScheduleMilestone => ({
  initiativeId,
  status: "planned",
  approvedDate: null,
  forecastDate: null,
  ...over,
});
const dep = (over: Partial<ScheduleDependency> = {}): ScheduleDependency => ({
  id: DEP,
  fromKind: "initiative",
  fromLabel: null,
  fromInitiativeId: A,
  toInitiativeId: B,
  neededBy: "2026-06-01",
  status: "open",
  ...over,
});
const codes = (flags: readonly { code: string }[]) => flags.map((f) => f.code);

describe("predecessorFinish", () => {
  it("is the latest forecast (else approved) date of non-cancelled milestones", { timeout: 5_000 }, () => {
    const a = ini(A, "INI-01", { plannedEnd: "2026-01-01" });
    expect(
      predecessorFinish(a, [
        ms(A, { forecastDate: "2026-05-01", approvedDate: "2026-04-01" }),
        ms(A, { approvedDate: "2026-07-01" }),
        ms(A, { forecastDate: "2026-12-31", status: "cancelled" }),
        ms(B, { forecastDate: "2027-01-01" }),
      ]),
    ).toBe("2026-07-01");
  });
  it("falls back to the planned end, then Unknown (null)", { timeout: 5_000 }, () => {
    expect(predecessorFinish(ini(A, "INI-01", { plannedEnd: "2026-03-01" }), [])).toBe("2026-03-01");
    expect(predecessorFinish(ini(A, "INI-01", { plannedEnd: "2026-03-01" }), [ms(A)])).toBe("2026-03-01");
    expect(predecessorFinish(ini(A, "INI-01"), [ms(A, { status: "cancelled", forecastDate: "2026-01-01" })])).toBe(
      null,
    );
  });
});

describe("schedule.needed_by_conflict", () => {
  it("flags a predecessor finishing after the needed-by date, with the ADR text", { timeout: 5_000 }, () => {
    const flags = dependencyFlags(
      dep({ neededBy: "2026-06-01" }),
      ini(A, "INI-01", { plannedEnd: "2026-07-15" }),
      ini(B, "INI-02", { plannedStart: "2026-08-01" }),
      [],
    );
    expect(flags).toEqual([
      {
        code: SCHEDULE_FLAG_CODES.neededByConflict,
        message: "INI-01 finishes after INI-02 needs it (2026-06-01)",
        dependencyId: DEP,
        initiativeId: B,
      },
    ]);
  });
  it("finishing ON the needed-by date is no conflict", { timeout: 5_000 }, () => {
    const flags = dependencyFlags(
      dep({ neededBy: "2026-06-01" }),
      ini(A, "INI-01", { plannedEnd: "2026-06-01" }),
      ini(B, "INI-02", { plannedStart: "2026-06-02" }),
      [],
    );
    expect(flags).toEqual([]);
  });
  it("a milestone forecast moved past the needed-by date raises the flag", { timeout: 5_000 }, () => {
    const a = ini(A, "INI-01", { plannedEnd: "2026-05-01" });
    const b = ini(B, "INI-02", { plannedStart: "2026-09-01" });
    expect(codes(dependencyFlags(dep(), a, b, [ms(A, { forecastDate: "2026-05-15" })]))).toEqual([]);
    expect(codes(dependencyFlags(dep(), a, b, [ms(A, { forecastDate: "2026-06-15" })]))).toEqual([
      SCHEDULE_FLAG_CODES.neededByConflict,
    ]);
  });
});

describe("schedule.before_predecessor", () => {
  it("flags a successor that starts before the predecessor finishes", { timeout: 5_000 }, () => {
    const flags = dependencyFlags(
      dep({ neededBy: "2026-12-31" }),
      ini(A, "INI-01", { plannedEnd: "2026-06-30" }),
      ini(B, "INI-02", { plannedStart: "2026-06-01" }),
      [],
    );
    expect(flags).toEqual([
      {
        code: SCHEDULE_FLAG_CODES.beforePredecessor,
        message: "INI-02 is sequenced before its predecessor INI-01",
        dependencyId: DEP,
        initiativeId: B,
      },
    ]);
  });
  it("flags a successor in an earlier wave than its predecessor", { timeout: 5_000 }, () => {
    const flags = dependencyFlags(
      dep({ neededBy: "2026-12-31" }),
      ini(A, "INI-01", { plannedEnd: "2026-01-31", waveOrdinal: 2 }),
      ini(B, "INI-02", { plannedStart: "2026-03-01", waveOrdinal: 1 }),
      [],
    );
    expect(codes(flags)).toEqual([SCHEDULE_FLAG_CODES.beforePredecessor]);
  });
  it("same wave and starting after the finish: no flag", { timeout: 5_000 }, () => {
    const flags = dependencyFlags(
      dep({ neededBy: "2026-12-31" }),
      ini(A, "INI-01", { plannedEnd: "2026-01-31", waveOrdinal: 1 }),
      ini(B, "INI-02", { plannedStart: "2026-03-01", waveOrdinal: 1 }),
      [],
    );
    expect(flags).toEqual([]);
  });
});

describe("schedule.unknown (never 'no conflict')", () => {
  it("no needed-by date: Unknown", { timeout: 5_000 }, () => {
    const flags = dependencyFlags(
      dep({ neededBy: null }),
      ini(A, "INI-01", { plannedEnd: "2026-01-31" }),
      ini(B, "INI-02", { plannedStart: "2026-03-01" }),
      [],
    );
    expect(codes(flags)).toEqual([SCHEDULE_FLAG_CODES.unknown]);
    expect(flags[0]!.message).toBe("Schedule unknown for INI-01 → INI-02: needed-by date missing");
  });
  it("no predecessor finish at all: Unknown, and no conflict is claimed", { timeout: 5_000 }, () => {
    const flags = dependencyFlags(dep(), ini(A, "INI-01"), ini(B, "INI-02", { plannedStart: "2026-03-01" }), []);
    expect(codes(flags)).toEqual([SCHEDULE_FLAG_CODES.unknown]);
    expect(flags[0]!.message).toContain("INI-01 finish date");
  });
  it("no successor start: Unknown even when the waves are in order", { timeout: 5_000 }, () => {
    const flags = dependencyFlags(
      dep({ neededBy: "2026-12-31" }),
      ini(A, "INI-01", { plannedEnd: "2026-01-31", waveOrdinal: 0 }),
      ini(B, "INI-02", { waveOrdinal: 1 }),
      [],
    );
    expect(codes(flags)).toEqual([SCHEDULE_FLAG_CODES.unknown]);
    expect(flags[0]!.message).toContain("INI-02 planned start");
  });
  it("an external predecessor's finish is Unknown", { timeout: 5_000 }, () => {
    const flags = dependencyFlags(
      dep({ fromKind: "external", fromLabel: "Synthetic vendor", fromInitiativeId: null }),
      undefined,
      ini(B, "INI-02", { plannedStart: "2026-03-01" }),
      [],
    );
    expect(codes(flags)).toEqual([SCHEDULE_FLAG_CODES.unknown]);
    expect(flags[0]!.message).toBe(
      "Schedule unknown for Synthetic vendor → INI-02: Synthetic vendor finish date (external) missing",
    );
  });
  it("a known conflict is still reported alongside an Unknown part", { timeout: 5_000 }, () => {
    const flags = dependencyFlags(
      dep({ neededBy: "2026-06-01" }),
      ini(A, "INI-01", { plannedEnd: "2026-07-01" }),
      ini(B, "INI-02"),
      [],
    );
    expect(codes(flags)).toEqual([SCHEDULE_FLAG_CODES.neededByConflict, SCHEDULE_FLAG_CODES.unknown]);
  });
});

describe("computeScheduleFlags", () => {
  it(
    "indexes flags by dependency and by successor; archived and resolved dependencies are skipped",
    {
      timeout: 5_000,
    },
    () => {
      const initiatives = [
        ini(A, "INI-01", { plannedEnd: "2026-07-01" }),
        ini(B, "INI-02", { plannedStart: "2026-08-01" }),
      ];
      const out = computeScheduleFlags({
        initiatives,
        milestones: [],
        dependencies: [
          dep(),
          dep({ id: "01920000-0000-7000-8000-0000000000d2", status: "archived" }),
          dep({ id: "01920000-0000-7000-8000-0000000000d3", status: "resolved" }),
        ],
      });
      expect([...out.byDependency.keys()]).toEqual([DEP]);
      expect(codes(out.byDependency.get(DEP)!)).toEqual([SCHEDULE_FLAG_CODES.neededByConflict]);
      expect(codes(out.byInitiative.get(B)!)).toEqual([SCHEDULE_FLAG_CODES.neededByConflict]);
      expect(out.byInitiative.has(A)).toBe(false);
    },
  );
});
