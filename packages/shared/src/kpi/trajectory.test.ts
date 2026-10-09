// Expected-to-date from the approved trajectory (ADR-0028 §4; T-DG4-KBE-A). Synthetic fixtures.
import { describe, expect, it } from "vitest";
import { expectedToDate, KpiInputError, roundForStorage, type ApprovedTrajectory } from "./index.ts";

const linear: ApprovedTrajectory = {
  id: "traj-1",
  versionNo: 1,
  basis: "period",
  interpolation: "linear",
  points: [
    { date: "2026-03-31", value: "100" },
    { date: "2026-06-30", value: "130" },
    { date: "2026-12-31", value: "200" },
  ],
};
const step: ApprovedTrajectory = { ...linear, interpolation: "step" };

describe("no approved trajectory / before the first point", () => {
  it("no approved trajectory → Unknown (kpi.no_approved_trajectory)", () => {
    expect(expectedToDate({ trajectory: null, at: "2026-06-30" })).toEqual({
      result: { status: "unknown", value: null, reason: "kpi.no_approved_trajectory" },
      from: [],
      usedBaseline: false,
      inexact: false,
    });
  });
  it("before the first known point → Unknown (kpi.before_trajectory), never 0", () => {
    expect(expectedToDate({ trajectory: linear, at: "2026-03-30" }).result).toEqual({
      status: "unknown",
      value: null,
      reason: "kpi.before_trajectory",
    });
    expect(expectedToDate({ trajectory: step, at: "2026-01-31" }).result.reason).toBe("kpi.before_trajectory");
  });
});

describe("linear", () => {
  it("on a point's date: its value", () => {
    expect(expectedToDate({ trajectory: linear, at: "2026-06-30" }).result.value).toBe("130");
    expect(expectedToDate({ trajectory: linear, at: "2026-03-31" }).result.value).toBe("100");
  });
  it("between points: straight line by day count (Mar 31 → Jun 30 is 91 days; Apr 30 is day 30)", () => {
    const e = expectedToDate({ trajectory: linear, at: "2026-04-30" });
    // 100 + 30 × 30/91 = 100 + 900/91
    expect(e.result.value?.slice(0, 20)).toBe("109.8901098901098901");
    expect(e.inexact).toBe(true);
    expect(e.from.map((p) => p.date)).toEqual(["2026-03-31", "2026-06-30"]);
    const stored = roundForStorage(e.result.value!, e.inexact);
    expect(stored).toMatchObject({
      ok: true,
      stored: "109.89011",
      rounding: { rounded: true, inexactIntermediate: true },
    });
  });
  it("exact interpolation is reported exact", () => {
    const t: ApprovedTrajectory = {
      ...linear,
      points: [
        { date: "2026-01-01", value: "0" },
        { date: "2026-01-11", value: "50" },
      ],
    };
    const e = expectedToDate({ trajectory: t, at: "2026-01-03" });
    expect(e.result.value).toBe("10");
    expect(e.inexact).toBe(false);
  });
  it("decreasing trajectories (lower-is-better) interpolate downward", () => {
    const t: ApprovedTrajectory = {
      ...linear,
      points: [
        { date: "2026-01-01", value: "0.20" },
        { date: "2026-01-11", value: "0.10" },
      ],
    };
    expect(expectedToDate({ trajectory: t, at: "2026-01-06" }).result.value).toBe("0.15");
  });
  it("after the last point: the last point's value", () => {
    expect(expectedToDate({ trajectory: linear, at: "2027-03-31" }).result.value).toBe("200");
  });
  it("points may be given in any order", () => {
    const shuffled: ApprovedTrajectory = {
      ...linear,
      points: [linear.points[2]!, linear.points[0]!, linear.points[1]!],
    };
    expect(expectedToDate({ trajectory: shuffled, at: "2026-06-30" }).result.value).toBe("130");
  });
});

describe("step", () => {
  it("the latest point on or before the date", () => {
    expect(expectedToDate({ trajectory: step, at: "2026-04-30" }).result.value).toBe("100");
    expect(expectedToDate({ trajectory: step, at: "2026-06-30" }).result.value).toBe("130");
    expect(expectedToDate({ trajectory: step, at: "2026-12-30" }).result.value).toBe("130");
    expect(expectedToDate({ trajectory: step, at: "2027-01-01" }).result.value).toBe("200");
  });
});

describe("baseline point", () => {
  const baseline = { date: "2025-12-31", value: "80" };
  it("is used when earlier than the first trajectory point (linear from the baseline)", () => {
    const e = expectedToDate({ trajectory: linear, baseline, at: "2026-02-14" });
    // Dec 31 → Mar 31 is 90 days; Feb 14 is day 45 → 80 + 20 × 45/90 = 90
    expect(e.result.value).toBe("90");
    expect(e.usedBaseline).toBe(true);
    expect(e.inexact).toBe(false);
  });
  it("makes a date between the baseline and the first point known (otherwise Unknown)", () => {
    expect(expectedToDate({ trajectory: linear, at: "2026-02-14" }).result.status).toBe("unknown");
    expect(expectedToDate({ trajectory: step, baseline, at: "2026-02-14" }).result.value).toBe("80");
  });
  it("is ignored when on or after the first point", () => {
    const e = expectedToDate({ trajectory: linear, baseline: { date: "2026-03-31", value: "1" }, at: "2026-03-31" });
    expect(e.result.value).toBe("100");
    expect(e.usedBaseline).toBe(false);
  });
  it("before the baseline is still Unknown (before_trajectory)", () => {
    expect(expectedToDate({ trajectory: linear, baseline, at: "2025-12-30" }).result.reason).toBe(
      "kpi.before_trajectory",
    );
  });
});

describe("caller errors", () => {
  it("duplicate point dates, empty points, malformed values or dates", () => {
    expect(() =>
      expectedToDate({
        trajectory: { ...linear, points: [linear.points[0]!, { ...linear.points[0]!, value: "5" }] },
        at: "2026-06-30",
      }),
    ).toThrow(KpiInputError);
    expect(() => expectedToDate({ trajectory: { ...linear, points: [] }, at: "2026-06-30" })).toThrow(KpiInputError);
    expect(() =>
      expectedToDate({ trajectory: { ...linear, points: [{ date: "2026-06-31", value: "1" }] }, at: "2026-06-30" }),
    ).toThrow(KpiInputError);
    expect(() => expectedToDate({ trajectory: linear, at: "30/06/2026" })).toThrow(KpiInputError);
  });
});
