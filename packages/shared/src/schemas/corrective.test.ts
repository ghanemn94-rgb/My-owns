// Unit tests of the shared corrective-action rule parts (T-DG4-BE-D2; ADR-0031 §5.2, §5.4): the defaults, the KPI
// off-track reading under a severity, and the consecutive count (an Unknown or on-track period ends a run).
import { describe, expect, it } from "vitest";
import {
  checkFailedPayload,
  consecutiveOffTrack,
  CORRECTIVE_RULE_DEFAULTS,
  correctiveActionRuleCreate,
  correctiveCaseUpdate,
  kpiOffTrack,
  type SeriesSignal,
} from "./corrective.ts";

const s = (periodKey: string, periodStart: string | null, receivedOrder: number, offTrack: boolean | null) =>
  ({ periodKey, periodStart, receivedOrder, offTrack }) satisfies SeriesSignal;

describe("ADR-0031 §5.2 defaults", () => {
  it("KPI: red for 2 consecutive periods, 5 working days; the other kinds: 1 cycle, 5 working days", () => {
    expect(CORRECTIVE_RULE_DEFAULTS.kpi_deviation).toEqual({
      sourceKind: "kpi_deviation",
      minKpiRag: "red",
      persistenceCycles: 2,
      followUpWorkingDays: 5,
      enabled: true,
    });
    for (const k of ["benefit_variance", "adoption_check", "control_check"] as const)
      expect(CORRECTIVE_RULE_DEFAULTS[k]).toMatchObject({
        minKpiRag: null,
        persistenceCycles: 1,
        followUpWorkingDays: 5,
      });
  });
});

describe("kpiOffTrack (ADR-0031 §5.4)", () => {
  it("severity red: only red is off track; amber and green are not; unknown, stale, not_computable are Unknown", () => {
    expect(["red", "amber", "green", "unknown", "stale", "not_computable"].map((r) => kpiOffTrack(r, "red"))).toEqual([
      true,
      false,
      false,
      null,
      null,
      null,
    ]);
  });
  it("severity amber: amber and red are off track", () => {
    expect(["red", "amber", "green", "unknown"].map((r) => kpiOffTrack(r, "amber"))).toEqual([true, true, false, null]);
  });
});

describe("consecutiveOffTrack (ADR-0031 §5.4 step 3)", () => {
  it("counts the leading off-track periods, newest period first", () => {
    expect(consecutiveOffTrack([s("p1", "2026-01-01", 1, true)])).toBe(1);
    expect(consecutiveOffTrack([s("p1", "2026-01-01", 1, true), s("p2", "2026-02-01", 2, true)])).toBe(2);
    expect(
      consecutiveOffTrack([
        s("p1", "2026-01-01", 1, true),
        s("p2", "2026-02-01", 2, true),
        s("p3", "2026-03-01", 3, true),
      ]),
    ).toBe(3);
  });
  it("an on-track or Unknown period ends the run (never counted as off track, never skipped)", () => {
    expect(consecutiveOffTrack([s("p1", "2026-01-01", 1, true), s("p2", "2026-02-01", 2, false)])).toBe(0);
    expect(consecutiveOffTrack([s("p1", "2026-01-01", 1, true), s("p2", "2026-02-01", 2, null)])).toBe(0);
    expect(
      consecutiveOffTrack([
        s("p1", "2026-01-01", 1, true),
        s("p2", "2026-02-01", 2, null),
        s("p3", "2026-03-01", 3, true),
      ]),
    ).toBe(1);
  });
  it("uses the latest-received signal of a period (a re-evaluation replaces the earlier reading)", () => {
    expect(consecutiveOffTrack([s("p1", "2026-01-01", 1, true), s("p1", "2026-01-01", 5, false)])).toBe(0);
    expect(consecutiveOffTrack([s("p1", "2026-01-01", 1, false), s("p1", "2026-01-01", 5, true)])).toBe(1);
  });
  it("orders by period start, not by receipt: a late older period does not end the newer run", () => {
    expect(consecutiveOffTrack([s("p2", "2026-02-01", 1, true), s("p1", "2026-01-01", 2, false)])).toBe(1);
  });
  it("is 0 for no signals", () => {
    expect(consecutiveOffTrack([])).toBe(0);
  });
});

describe("mirrors", () => {
  it("a rule create needs persistence and follow-up within range; an update needs a property", () => {
    expect(
      correctiveActionRuleCreate.safeParse({
        sourceKind: "control_check",
        persistenceCycles: 1,
        followUpWorkingDays: 61,
      }).success,
    ).toBe(false);
    expect(correctiveCaseUpdate.safeParse({}).success).toBe(false);
    expect(correctiveCaseUpdate.safeParse({ status: "closed" }).success).toBe(false);
  });
  it("the check payload is the ADR-0031 §5.4 producer contract (strict)", () => {
    const ok = {
      checkId: "0190a8a0-0000-7000-8000-000000000001",
      checkRecordType: "control_check",
      transformationId: "0190a8a0-0000-7000-8000-000000000002",
      ownerUserId: null,
      subjectLabel: "Synthetic control",
      failedAt: "2026-10-08T09:00:00Z",
      businessDate: "2026-10-08",
    };
    expect(checkFailedPayload.safeParse(ok).success).toBe(true);
    expect(checkFailedPayload.safeParse({ ...ok, extra: 1 }).success).toBe(false);
    expect(checkFailedPayload.safeParse({ ...ok, checkRecordType: "Bad-Name" }).success).toBe(false);
  });
});
