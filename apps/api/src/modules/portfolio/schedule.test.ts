// Unit tests of the pure schedule flags (ADR-0023 §5; REQ-S09-008, REQ-S09-004; T-DG3-BE-C). No database.
// Needed-by conflict, sequenced before the predecessor (by date and by wave), and Unknown (never "no conflict").
import { describe, expect, it } from "vitest";
import {
  computeScheduleFlags,
  dependencyFlags,
  forwardFinish,
  forwardFinishes,
  predecessorFinish,
  type ForwardFacts,
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

// D-166 Rule B (T-DG5-BE-T4; REQ-S12-012): the finish-to-start forward pass over planned starts. A dependent with no
// slack moves by the slip; one with enough slack does not; partial slack absorbs part of it; Unknown is null, never 0
// and never the unshifted date.
describe("forwardFinish (D-166 Rule B)", () => {
  const P = "01920000-0000-7000-8000-0000000000f1";
  const P2 = "01920000-0000-7000-8000-0000000000f2";
  const S = "01920000-0000-7000-8000-0000000000f3";
  const C = "01920000-0000-7000-8000-0000000000f4";
  const fs = (from: string, to: string, status = "open") => ({ fromInitiativeId: from, toInitiativeId: to, status });
  const at = (initiativeId: string, forecastDate: string) => ms(initiativeId, { forecastDate });
  /** A slip of P from 2026-11-01 to 2026-11-06 (5 days); S finishes 2026-12-01 on its own milestones. */
  const pair = (sStart: string | null): [ForwardFacts, ForwardFacts] => {
    const initiatives = [ini(P, "INI-P"), ini(S, "INI-S", { plannedStart: sStart })];
    const dependencies = [fs(P, S)];
    return [
      { initiatives, dependencies, milestones: [at(P, "2026-11-01"), at(S, "2026-12-01")] },
      { initiatives, dependencies, milestones: [at(P, "2026-11-06"), at(S, "2026-12-01")] },
    ];
  };

  it("no slack: the dependent moves by the slip (5 days)", () => {
    const [before, after] = pair("2026-11-01");
    expect([forwardFinish(S, before), forwardFinish(S, after)]).toEqual(["2026-12-01", "2026-12-06"]);
  });

  it("enough slack: the dependent does not move", () => {
    const [before, after] = pair("2026-11-10");
    expect([forwardFinish(S, before), forwardFinish(S, after)]).toEqual(["2026-12-01", "2026-12-01"]);
  });

  it("partial slack: 2 of the 5 days are absorbed, it moves by 3", () => {
    const [before, after] = pair("2026-11-03");
    expect([forwardFinish(S, before), forwardFinish(S, after)]).toEqual(["2026-12-01", "2026-12-04"]);
  });

  it("a starting date on the predecessor's finish is allowed (ADR-0023 §5): no shift", () => {
    const [, after] = pair("2026-11-06");
    expect(forwardFinish(S, after)).toBe("2026-12-01");
  });

  it("a chain of two: P -> S -> C, both without slack, both move by 5 (across a month end)", () => {
    const initiatives = [
      ini(P, "INI-P"),
      ini(S, "INI-S", { plannedStart: "2026-11-01" }),
      ini(C, "INI-C", { plannedStart: "2026-12-01" }),
    ];
    const dependencies = [fs(P, S), fs(S, C)];
    const facts = (pFinish: string): ForwardFacts => ({
      initiatives,
      dependencies,
      milestones: [at(P, pFinish), at(S, "2026-12-01"), at(C, "2027-01-29")],
    });
    const before = forwardFinishes(facts("2026-11-01"));
    const after = forwardFinishes(facts("2026-11-06"));
    expect([before(P), before(S), before(C)]).toEqual(["2026-11-01", "2026-12-01", "2027-01-29"]);
    expect([after(P), after(S), after(C)]).toEqual(["2026-11-06", "2026-12-06", "2027-02-03"]);
  });

  it("two predecessors: the latest one decides", () => {
    const initiatives = [ini(P, "INI-P"), ini(P2, "INI-P2"), ini(S, "INI-S", { plannedStart: "2026-11-01" })];
    const facts: ForwardFacts = {
      initiatives,
      dependencies: [fs(P, S), fs(P2, S)],
      milestones: [at(P, "2026-11-06"), at(P2, "2026-11-08"), at(S, "2026-12-01")],
    };
    expect(forwardFinish(S, facts)).toBe("2026-12-08");
  });

  it("a scheduled predecessor and no planned start: Unknown (null), never 0 nor the unshifted date", () => {
    const [before, after] = pair(null);
    expect([forwardFinish(S, before), forwardFinish(S, after)]).toEqual([null, null]);
  });

  it("any input date missing is Unknown: the predecessor's finish, or the initiative's own", () => {
    const initiatives = [ini(P, "INI-P"), ini(S, "INI-S", { plannedStart: "2026-11-01" })];
    expect(forwardFinish(S, { initiatives, dependencies: [fs(P, S)], milestones: [at(S, "2026-12-01")] })).toBeNull();
    expect(forwardFinish(S, { initiatives, dependencies: [fs(P, S)], milestones: [at(P, "2026-11-06")] })).toBeNull();
  });

  it("without a scheduled predecessor it is predecessorFinish (archived and resolved dependencies do not count)", () => {
    const initiatives = [ini(P, "INI-P"), ini(S, "INI-S", { plannedStart: null, plannedEnd: "2026-12-20" })];
    for (const status of ["archived", "resolved"]) {
      const facts: ForwardFacts = { initiatives, dependencies: [fs(P, S, status)], milestones: [at(P, "2026-11-30")] };
      expect(forwardFinish(S, facts), status).toBe("2026-12-20");
      expect(forwardFinish(S, facts)).toBe(predecessorFinish(initiatives[1]!, facts.milestones));
    }
    expect(
      forwardFinish("01920000-0000-7000-8000-0000000000ff", { initiatives, dependencies: [], milestones: [] }),
    ).toBeNull();
  });
});
