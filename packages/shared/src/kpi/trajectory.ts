// Expected-to-date from the approved trajectory (ADR-0028 §4, REQ-S07-007). Owner: kpi-benefits-engineer (T-DG4-KBE-A).
//
// Known points = the approved trajectory's points, plus the version's baseline point when its date is earlier than the
// first trajectory point. At the period's end date p:
//   linear: a point's value on its date; straight-line interpolation by day count between two consecutive points; the
//           last point's value after the last point.
//   step:   the value of the latest point on or before p.
//   before the first known point → Unknown (kpi.before_trajectory; explanation kpi.rag.before_trajectory).
//   no approved trajectory → Unknown (kpi.no_approved_trajectory; explanation kpi.rag.no_approved_trajectory).
// The inputs are the trajectory, the baseline and the date only: nothing about tasks or activity is read.
import { dayNumber, dec, divisionIsExact, KD, KpiInputError, ok, unknown, type Dec, type KpiResult } from "./types.ts";

export interface TrajectoryPoint {
  /** ISO date of the point (target_trajectory_point.point_date). */
  readonly date: string;
  /** Decimal string; a percentage KPI's points are fractions. */
  readonly value: string;
}

/** The approved target_trajectory of the KPI and scope (ADR-0027 §5). */
export interface ApprovedTrajectory {
  readonly id?: string | null;
  readonly versionNo?: number | null;
  readonly basis: "period" | "cumulative";
  readonly interpolation: "linear" | "step";
  readonly points: readonly TrajectoryPoint[];
}

export interface ExpectedToDate {
  readonly result: KpiResult;
  /** The point(s) the value came from (lineage); empty when Unknown. */
  readonly from: readonly TrajectoryPoint[];
  /** True when the baseline point was used. */
  readonly usedBaseline: boolean;
  /** True when a linear interpolation division was not exact at precision 80 (rounding record). */
  readonly inexact: boolean;
}

interface Known {
  readonly day: number;
  readonly value: Dec;
  readonly point: TrajectoryPoint;
  readonly baseline: boolean;
}

/**
 * The expected value at `at` (the period's end date). `trajectory` null = no approved trajectory. `baseline` is the
 * active version's baseline_value / baseline_date, if both are set.
 */
export function expectedToDate(input: {
  readonly trajectory: ApprovedTrajectory | null;
  readonly baseline?: TrajectoryPoint | null;
  readonly at: string;
}): ExpectedToDate {
  const none = (reason: "kpi.no_approved_trajectory" | "kpi.before_trajectory"): ExpectedToDate =>
    Object.freeze({ result: unknown(reason), from: Object.freeze([]), usedBaseline: false, inexact: false });
  const at = dayNumber(input.at, "at");
  if (input.trajectory === null) return none("kpi.no_approved_trajectory");
  const t = input.trajectory;
  if (t.points.length === 0)
    throw new KpiInputError("trajectory.points", "an approved trajectory has at least one point");
  const known: Known[] = t.points.map((p, i) => ({
    day: dayNumber(p.date, `trajectory.points[${i}].date`),
    value: dec(p.value, `trajectory.points[${i}].value`),
    point: p,
    baseline: false,
  }));
  known.sort((a, b) => a.day - b.day);
  for (let i = 1; i < known.length; i++) {
    if (known[i]!.day === known[i - 1]!.day) {
      throw new KpiInputError("trajectory.points", `two points share the date ${known[i]!.point.date}`);
    }
  }
  const b = input.baseline ?? null;
  if (b !== null) {
    const bd = dayNumber(b.date, "baseline.date");
    const bv = dec(b.value, "baseline.value");
    if (bd < known[0]!.day) known.unshift({ day: bd, value: bv, point: b, baseline: true });
  }

  if (at < known[0]!.day) return none("kpi.before_trajectory");
  // The latest known point on or before `at`.
  let i = 0;
  while (i + 1 < known.length && known[i + 1]!.day <= at) i++;
  const k0 = known[i]!;
  const exactHit = k0.day === at;
  const last = i === known.length - 1;
  if (t.interpolation === "step" || exactHit || last) {
    return Object.freeze({
      result: ok(k0.value),
      from: Object.freeze([k0.point]),
      usedBaseline: k0.baseline,
      inexact: false,
    });
  }
  const k1 = known[i + 1]!;
  const span = k1.value.minus(k0.value).times(at - k0.day);
  const days = new KD(k1.day - k0.day); // an integer day count: exact in decimal.js
  const value = k0.value.plus(span.div(days));
  return Object.freeze({
    result: ok(value),
    from: Object.freeze([k0.point, k1.point]),
    usedBaseline: k0.baseline,
    inexact: !divisionIsExact(span, days),
  });
}
