// The International Roaming dataset's KPI actuals and their calculated values (ADR-0050 §4; p5-work-split §J.3;
// T-DG5-KBE-H): one accepted actual per chain KPI and month (June to August 2026), each with the calculation run the
// worker writes for an accepted actual (ADR-0027 §8: trigger actual_accepted) and its two evaluations: period basis
// (against the approved trajectory) and cumulative basis (year to date; no cumulative trajectory is approved, so its
// RAG is Unknown, never green). And the ONE stale KPI of M0348: the August partner cost per MB was entered from the
// latest partner settlement available, as of 2026-06-30, 63 days before its business date (more than its 45 days), so
// its value is kept and labelled Stale, its calculated RAG is Stale (never green), and the run records a `stale`
// data-quality finding.
//
// Every evaluated number (value, expected-to-date, variance, variance ratio, RAG, deviation, trend) and its lineage
// (the exact value before storage rounding, the explanation parameters naming the threshold) is a LITERAL here. This
// package may not import the calculation engine (ADR-0002 rule 5: packages/db imports only @mth/config and
// @mth/shared), so the tests recompute every one of them with the DG4 KPI engine (@mth/shared/calc) and assert
// equality: packages/db/test/integration/demo-numbers-spec.test.ts from the dataset's inputs, and demo-numbers.test.ts
// from the stored rows.
//
// EVERY NUMBER IS SYNTHETIC (B0144, M0339): an illustrative example, not Mobily actual performance. Decimal strings
// only; percentages are fractions. Calculation runs and evaluations are system lineage: in the product they carry no
// audit event (0035); the seed's single insert path (ctx.insert) writes one event per registered row regardless.
import { sql } from "kysely";
import type { Tx } from "../../pool.ts";
import type { DemoDatasetModule, DemoSeedContext } from "../seed.ts";
import {
  DEMO_ANCHORS,
  DEMO_KPIS,
  demoKpi,
  demoPeriod,
  FORMULA_ENGINE_VERSION,
  ID_BLOCK,
  KBE_H_FIRST_ORDER,
  kbeId,
  KPI_RULES_VERSION,
  scoped,
  seedUpdate,
  stamps,
  when,
  type DemoKpi,
} from "./kpis.ts";

export interface DemoEvaluation {
  readonly valueStatus: "ok" | "stale";
  /** numeric(24,6) as stored, canonical (no trailing zeros). */
  readonly value: string;
  readonly expected: string;
  readonly variance: string;
  readonly varianceRatio: string;
  readonly calculatedRag: "green" | "amber" | "red" | "stale";
  readonly deviation: "favourable" | "within" | "adverse" | "unknown";
  readonly trend: "improving" | "worsening" | "flat" | "unknown";
  readonly explanationKey: string;
}

export interface DemoActual {
  readonly key: string;
  readonly no: number;
  readonly kpi: DemoKpi["key"];
  readonly period: string;
  readonly numerator: string;
  readonly denominator: string;
  readonly dataAsOf: string;
  /** The business date of the entry and of its calculation run (Asia/Riyadh). */
  readonly businessDate: string;
  readonly enteredAt: string;
  readonly comment: string;
  /** The period-basis evaluation (against the approved period trajectory). */
  readonly evaluation: DemoEvaluation;
  /** The cumulative-basis (year-to-date) evaluation the same run writes. */
  readonly cumulative: DemoCumulative;
  /** Literal lineage of the two evaluations, exactly as the KPI engine records it (see the file header). */
  readonly lineage: { readonly period: DemoLineage; readonly cumulative: DemoLineage };
}

/** What kpi_evaluation records beside the value: the exact value before storage rounding and the RAG explanation. */
export interface DemoLineage {
  /** The value at calculation precision (80 significant digits) before the one storage rounding. */
  readonly exact: string;
  readonly thresholdSource: "configured" | "default" | "none";
  /** kpi_evaluation.explanation_params: always names the threshold used (ADR-0028 §5). */
  readonly explanationParams: Readonly<Record<string, unknown>>;
}

/**
 * The cumulative (YTD, ytd_start_month 1) evaluation of the same slot: the weighted ratio Σ numerators / Σ denominators
 * over the reporting periods of the year so far (June to the slot's month; the dataset has no earlier period). No
 * cumulative trajectory is approved, so its expected value is Unknown and its RAG is Unknown (never green); variance
 * and expected stay NULL (never 0).
 */
export interface DemoCumulative {
  readonly valueStatus: "ok" | "stale";
  readonly value: string;
  readonly calculatedRag: "unknown" | "stale";
  readonly deviation: "unknown";
  readonly trend: "improving" | "worsening" | "flat" | "unknown";
  readonly explanationKey: string;
}

const ENTRY = "Synthetic demonstration actual (illustrative example; not Mobily actual performance).";

/** Every accepted actual, in seeding order (by KPI, then period). Literal evaluations: see the file header. */
export const DEMO_ACTUALS: readonly DemoActual[] = [
  // K1 attach rate (higher is better; configured relative thresholds 0.05 / 0.10).
  {
    key: "attach_rate.2026-06",
    no: 1,
    kpi: "attach_rate",
    period: "2026-06",
    numerator: "39000",
    denominator: "200000",
    dataAsOf: "2026-06-30",
    businessDate: "2026-07-03",
    enteredAt: "2026-07-03T07:00:00Z",
    comment: ENTRY,
    evaluation: {
      valueStatus: "ok",
      value: "0.195",
      expected: "0.19",
      variance: "0.005",
      varianceRatio: "0.026316",
      calculatedRag: "green",
      deviation: "favourable",
      trend: "unknown",
      explanationKey: "kpi.rag.on_or_better_than_trajectory",
    },
    cumulative: {
      valueStatus: "ok",
      value: "0.195",
      calculatedRag: "unknown",
      deviation: "unknown",
      trend: "unknown",
      explanationKey: "kpi.rag.no_approved_trajectory",
    },
    lineage: {
      period: {
        exact: "0.195",
        thresholdSource: "configured",
        explanationParams: {
          thresholdSource: "configured",
          thresholdVersion: 1,
          toleranceMode: "relative",
          amberThreshold: "0.050000",
          redThreshold: "0.100000",
          trajectoryVersion: 1,
          expected: "0.19",
          actual: "0.195",
          deviationValue: "-0.026315789473684210526315789473684210526315789473684210526315789473684210526315789",
        },
      },
      cumulative: {
        exact: "0.195",
        thresholdSource: "none",
        explanationParams: {
          thresholdSource: "none",
          thresholdVersion: null,
          toleranceMode: null,
          amberThreshold: null,
          redThreshold: null,
          trajectoryVersion: null,
          expected: null,
          actual: "0.195",
          deviationValue: null,
          reason: "kpi.no_approved_trajectory",
        },
      },
    },
  },
  {
    key: "attach_rate.2026-07",
    no: 2,
    kpi: "attach_rate",
    period: "2026-07",
    numerator: "43740",
    denominator: "216000",
    dataAsOf: "2026-07-31",
    businessDate: "2026-08-03",
    enteredAt: "2026-08-03T07:00:00Z",
    comment: ENTRY,
    evaluation: {
      valueStatus: "ok",
      value: "0.2025",
      expected: "0.2",
      variance: "0.0025",
      varianceRatio: "0.0125",
      calculatedRag: "green",
      deviation: "favourable",
      trend: "improving",
      explanationKey: "kpi.rag.on_or_better_than_trajectory",
    },
    cumulative: {
      valueStatus: "ok",
      value: "0.198894",
      calculatedRag: "unknown",
      deviation: "unknown",
      trend: "improving",
      explanationKey: "kpi.rag.no_approved_trajectory",
    },
    lineage: {
      period: {
        exact: "0.2025",
        thresholdSource: "configured",
        explanationParams: {
          thresholdSource: "configured",
          thresholdVersion: 1,
          toleranceMode: "relative",
          amberThreshold: "0.050000",
          redThreshold: "0.100000",
          trajectoryVersion: 1,
          expected: "0.2",
          actual: "0.2025",
          deviationValue: "-0.0125",
        },
      },
      cumulative: {
        exact: "0.19889423076923076923076923076923076923076923076923076923076923076923076923076923",
        thresholdSource: "none",
        explanationParams: {
          thresholdSource: "none",
          thresholdVersion: null,
          toleranceMode: null,
          amberThreshold: null,
          redThreshold: null,
          trajectoryVersion: null,
          expected: null,
          actual: "0.198894",
          deviationValue: null,
          reason: "kpi.no_approved_trajectory",
        },
      },
    },
  },
  {
    key: "attach_rate.2026-08",
    no: 3,
    kpi: "attach_rate",
    period: "2026-08",
    numerator: "41800",
    denominator: "220000",
    dataAsOf: "2026-08-31",
    businessDate: "2026-09-01",
    enteredAt: "2026-09-01T05:30:00Z",
    comment: ENTRY,
    evaluation: {
      valueStatus: "ok",
      value: "0.19",
      expected: "0.21",
      variance: "-0.02",
      varianceRatio: "-0.095238",
      calculatedRag: "amber",
      deviation: "adverse",
      trend: "worsening",
      explanationKey: "kpi.rag.amber_band",
    },
    cumulative: {
      valueStatus: "ok",
      value: "0.195818",
      calculatedRag: "unknown",
      deviation: "unknown",
      trend: "worsening",
      explanationKey: "kpi.rag.no_approved_trajectory",
    },
    lineage: {
      period: {
        exact: "0.19",
        thresholdSource: "configured",
        explanationParams: {
          thresholdSource: "configured",
          thresholdVersion: 1,
          toleranceMode: "relative",
          amberThreshold: "0.050000",
          redThreshold: "0.100000",
          trajectoryVersion: 1,
          expected: "0.21",
          actual: "0.19",
          deviationValue: "0.095238095238095238095238095238095238095238095238095238095238095238095238095238095",
        },
      },
      cumulative: {
        exact: "0.19581761006289308176100628930817610062893081761006289308176100628930817610062893",
        thresholdSource: "none",
        explanationParams: {
          thresholdSource: "none",
          thresholdVersion: null,
          toleranceMode: null,
          amberThreshold: null,
          redThreshold: null,
          trajectoryVersion: null,
          expected: null,
          actual: "0.195818",
          deviationValue: null,
          reason: "kpi.no_approved_trajectory",
        },
      },
    },
  },
  // K2 complaint rate (lower is better; no configured threshold: the documented defaults 0.05 / 0.10 apply).
  {
    key: "complaint_rate.2026-06",
    no: 4,
    kpi: "complaint_rate",
    period: "2026-06",
    numerator: "6600",
    denominator: "200000",
    dataAsOf: "2026-06-30",
    businessDate: "2026-07-03",
    enteredAt: "2026-07-03T07:10:00Z",
    comment: ENTRY,
    evaluation: {
      valueStatus: "ok",
      value: "0.033",
      expected: "0.034",
      variance: "-0.001",
      varianceRatio: "-0.029412",
      calculatedRag: "green",
      deviation: "favourable",
      trend: "unknown",
      explanationKey: "kpi.rag.on_or_better_than_trajectory",
    },
    cumulative: {
      valueStatus: "ok",
      value: "0.033",
      calculatedRag: "unknown",
      deviation: "unknown",
      trend: "unknown",
      explanationKey: "kpi.rag.no_approved_trajectory",
    },
    lineage: {
      period: {
        exact: "0.033",
        thresholdSource: "default",
        explanationParams: {
          thresholdSource: "default",
          thresholdVersion: null,
          toleranceMode: "relative",
          amberThreshold: "0.05",
          redThreshold: "0.10",
          trajectoryVersion: 1,
          expected: "0.034",
          actual: "0.033",
          deviationValue: "-0.029411764705882352941176470588235294117647058823529411764705882352941176470588235",
        },
      },
      cumulative: {
        exact: "0.033",
        thresholdSource: "none",
        explanationParams: {
          thresholdSource: "none",
          thresholdVersion: null,
          toleranceMode: null,
          amberThreshold: null,
          redThreshold: null,
          trajectoryVersion: null,
          expected: null,
          actual: "0.033",
          deviationValue: null,
          reason: "kpi.no_approved_trajectory",
        },
      },
    },
  },
  {
    key: "complaint_rate.2026-07",
    no: 5,
    kpi: "complaint_rate",
    period: "2026-07",
    numerator: "7128",
    denominator: "216000",
    dataAsOf: "2026-07-31",
    businessDate: "2026-08-03",
    enteredAt: "2026-08-03T07:10:00Z",
    comment: ENTRY,
    evaluation: {
      valueStatus: "ok",
      value: "0.033",
      expected: "0.032",
      variance: "0.001",
      varianceRatio: "0.03125",
      calculatedRag: "green",
      deviation: "adverse",
      trend: "flat",
      explanationKey: "kpi.rag.on_or_better_than_trajectory",
    },
    cumulative: {
      valueStatus: "ok",
      value: "0.033",
      calculatedRag: "unknown",
      deviation: "unknown",
      trend: "flat",
      explanationKey: "kpi.rag.no_approved_trajectory",
    },
    lineage: {
      period: {
        exact: "0.033",
        thresholdSource: "default",
        explanationParams: {
          thresholdSource: "default",
          thresholdVersion: null,
          toleranceMode: "relative",
          amberThreshold: "0.05",
          redThreshold: "0.10",
          trajectoryVersion: 1,
          expected: "0.032",
          actual: "0.033",
          deviationValue: "0.03125",
        },
      },
      cumulative: {
        exact: "0.033",
        thresholdSource: "none",
        explanationParams: {
          thresholdSource: "none",
          thresholdVersion: null,
          toleranceMode: null,
          amberThreshold: null,
          redThreshold: null,
          trajectoryVersion: null,
          expected: null,
          actual: "0.033",
          deviationValue: null,
          reason: "kpi.no_approved_trajectory",
        },
      },
    },
  },
  {
    key: "complaint_rate.2026-08",
    no: 6,
    kpi: "complaint_rate",
    period: "2026-08",
    numerator: "7700",
    denominator: "220000",
    dataAsOf: "2026-08-31",
    businessDate: "2026-09-01",
    enteredAt: "2026-09-01T05:40:00Z",
    comment: ENTRY,
    evaluation: {
      valueStatus: "ok",
      value: "0.035",
      expected: "0.03",
      variance: "0.005",
      varianceRatio: "0.166667",
      calculatedRag: "red",
      deviation: "adverse",
      trend: "worsening",
      explanationKey: "kpi.rag.red_threshold",
    },
    cumulative: {
      valueStatus: "ok",
      value: "0.033692",
      calculatedRag: "unknown",
      deviation: "unknown",
      trend: "worsening",
      explanationKey: "kpi.rag.no_approved_trajectory",
    },
    lineage: {
      period: {
        exact: "0.035",
        thresholdSource: "default",
        explanationParams: {
          thresholdSource: "default",
          thresholdVersion: null,
          toleranceMode: "relative",
          amberThreshold: "0.05",
          redThreshold: "0.10",
          trajectoryVersion: 1,
          expected: "0.03",
          actual: "0.035",
          deviationValue: "0.16666666666666666666666666666666666666666666666666666666666666666666666666666667",
        },
      },
      cumulative: {
        exact: "0.033691823899371069182389937106918238993710691823899371069182389937106918238993711",
        thresholdSource: "none",
        explanationParams: {
          thresholdSource: "none",
          thresholdVersion: null,
          toleranceMode: null,
          amberThreshold: null,
          redThreshold: null,
          trajectoryVersion: null,
          expected: null,
          actual: "0.033692",
          deviationValue: null,
          reason: "kpi.no_approved_trajectory",
        },
      },
    },
  },
  // K3 partner cost per MB (lower is better; configured absolute thresholds 0.0003 / 0.0008 SAR per MB).
  {
    key: "cost_per_mb.2026-06",
    no: 7,
    kpi: "cost_per_mb",
    period: "2026-06",
    numerator: "900000",
    denominator: "75000000",
    dataAsOf: "2026-06-30",
    businessDate: "2026-07-03",
    enteredAt: "2026-07-03T07:20:00Z",
    comment: ENTRY,
    evaluation: {
      valueStatus: "ok",
      value: "0.012",
      expected: "0.012",
      variance: "0",
      varianceRatio: "0",
      calculatedRag: "green",
      deviation: "within",
      trend: "unknown",
      explanationKey: "kpi.rag.on_or_better_than_trajectory",
    },
    cumulative: {
      valueStatus: "ok",
      value: "0.012",
      calculatedRag: "unknown",
      deviation: "unknown",
      trend: "unknown",
      explanationKey: "kpi.rag.no_approved_trajectory",
    },
    lineage: {
      period: {
        exact: "0.012",
        thresholdSource: "configured",
        explanationParams: {
          thresholdSource: "configured",
          thresholdVersion: 1,
          toleranceMode: "absolute",
          amberThreshold: "0.000300",
          redThreshold: "0.000800",
          trajectoryVersion: 1,
          expected: "0.012",
          actual: "0.012",
          deviationValue: "0",
        },
      },
      cumulative: {
        exact: "0.012",
        thresholdSource: "none",
        explanationParams: {
          thresholdSource: "none",
          thresholdVersion: null,
          toleranceMode: null,
          amberThreshold: null,
          redThreshold: null,
          trajectoryVersion: null,
          expected: null,
          actual: "0.012",
          deviationValue: null,
          reason: "kpi.no_approved_trajectory",
        },
      },
    },
  },
  {
    key: "cost_per_mb.2026-07",
    no: 8,
    kpi: "cost_per_mb",
    period: "2026-07",
    numerator: "897600",
    denominator: "81600000",
    dataAsOf: "2026-07-31",
    businessDate: "2026-08-03",
    enteredAt: "2026-08-03T07:20:00Z",
    comment: ENTRY,
    evaluation: {
      valueStatus: "ok",
      value: "0.011",
      expected: "0.0115",
      variance: "-0.0005",
      varianceRatio: "-0.043478",
      calculatedRag: "green",
      deviation: "favourable",
      trend: "improving",
      explanationKey: "kpi.rag.on_or_better_than_trajectory",
    },
    cumulative: {
      valueStatus: "ok",
      value: "0.011479",
      calculatedRag: "unknown",
      deviation: "unknown",
      trend: "improving",
      explanationKey: "kpi.rag.no_approved_trajectory",
    },
    lineage: {
      period: {
        exact: "0.011",
        thresholdSource: "configured",
        explanationParams: {
          thresholdSource: "configured",
          thresholdVersion: 1,
          toleranceMode: "absolute",
          amberThreshold: "0.000300",
          redThreshold: "0.000800",
          trajectoryVersion: 1,
          expected: "0.0115",
          actual: "0.011",
          deviationValue: "-0.0005",
        },
      },
      cumulative: {
        exact: "0.011478927203065134099616858237547892720306513409961685823754789272030651340996169",
        thresholdSource: "none",
        explanationParams: {
          thresholdSource: "none",
          thresholdVersion: null,
          toleranceMode: null,
          amberThreshold: null,
          redThreshold: null,
          trajectoryVersion: null,
          expected: null,
          actual: "0.011479",
          deviationValue: null,
          reason: "kpi.no_approved_trajectory",
        },
      },
    },
  },
  {
    // THE STALE KPI (M0348): data as of 2026-06-30 on business date 2026-09-01 is 63 days old (> 45).
    key: "cost_per_mb.2026-08",
    no: 9,
    kpi: "cost_per_mb",
    period: "2026-08",
    numerator: "852000",
    denominator: "80000000",
    dataAsOf: "2026-06-30",
    businessDate: "2026-09-01",
    enteredAt: "2026-09-01T05:50:00Z",
    comment:
      "Synthetic demonstration actual: the August partner settlement is not yet received, so the latest settlement " +
      "available (data as of 2026-06-30) was entered. Illustrative example; not Mobily actual performance.",
    evaluation: {
      valueStatus: "stale",
      value: "0.01065",
      expected: "0.011",
      variance: "-0.00035",
      varianceRatio: "-0.031818",
      calculatedRag: "stale",
      deviation: "unknown",
      trend: "improving",
      explanationKey: "kpi.rag.stale",
    },
    cumulative: {
      valueStatus: "stale",
      value: "0.011199",
      calculatedRag: "stale",
      deviation: "unknown",
      trend: "improving",
      explanationKey: "kpi.rag.stale",
    },
    lineage: {
      period: {
        exact: "0.01065",
        thresholdSource: "none",
        explanationParams: {
          thresholdSource: "none",
          thresholdVersion: null,
          toleranceMode: null,
          amberThreshold: null,
          redThreshold: null,
          trajectoryVersion: 1,
          expected: null,
          actual: "0.01065",
          deviationValue: null,
          reason: "kpi.stale",
        },
      },
      cumulative: {
        exact: "0.011198647506339814032121724429416737109044801352493660185967878275570583262890955",
        thresholdSource: "none",
        explanationParams: {
          thresholdSource: "none",
          thresholdVersion: null,
          toleranceMode: null,
          amberThreshold: null,
          redThreshold: null,
          trajectoryVersion: null,
          expected: null,
          actual: "0.011199",
          deviationValue: null,
          reason: "kpi.stale",
        },
      },
    },
  },
];

/** The fixed ids of one actual's rows. */
export function actualIds(a: DemoActual): {
  actual: string;
  value: string;
  review: string;
  run: string;
  evaluation: string;
  cumulativeEvaluation: string;
  finding: string;
} {
  return {
    actual: kbeId(ID_BLOCK.kpiActual, a.no),
    value: kbeId(ID_BLOCK.kpiActualValue, a.no),
    review: kbeId(ID_BLOCK.kpiActualReview, a.no),
    run: kbeId(ID_BLOCK.calculationRun, a.no),
    evaluation: kbeId(ID_BLOCK.kpiEvaluation, a.no),
    cumulativeEvaluation: kbeId(ID_BLOCK.kpiEvaluation, 0x100 + a.no),
    finding: kbeId(ID_BLOCK.dataQualityFinding, a.no),
  };
}

export function demoActual(key: string): DemoActual {
  const a = DEMO_ACTUALS.find((x) => x.key === key);
  if (a === undefined) throw new Error(`demo seed: no actual ${key}`);
  return a;
}

/** The previous accepted actual of the same KPI (the previous monthly period), or null. */
export function previousActual(a: DemoActual): DemoActual | null {
  const same = DEMO_ACTUALS.filter((x) => x.kpi === a.kpi && x.period < a.period);
  return same.length === 0 ? null : same[same.length - 1]!;
}

/**
 * The year-to-date window of a slot (ytd_start_month 1): the KPI's actuals from the first reporting period of the year
 * known to the organization (June 2026: the dataset has no earlier period) to the slot's own, in period order.
 */
export function ytdWindow(a: DemoActual): readonly DemoActual[] {
  return DEMO_ACTUALS.filter(
    (x) => x.kpi === a.kpi && x.period.slice(0, 4) === a.period.slice(0, 4) && x.period <= a.period,
  );
}

/** The numeric(24,6) text of a canonical decimal (the rounding record's `stored`), by string padding only. */
export function fixed6(v: string): string {
  if (!/^-?\d+(\.\d{1,6})?$/.test(v)) throw new Error(`demo seed: ${v} is not a 6-place decimal`);
  const [int, frac = ""] = v.split(".");
  return `${int}.${frac.padEnd(6, "0")}`;
}

/** The KPI engine's storage-rounding record (roundForStorage, ADR-0028 §2) of a stored value and its exact value. */
export function roundingRecord(exact: string, stored: string): Record<string, unknown> {
  return {
    column: "numeric(24,6)",
    scale: 6,
    mode: "ROUND_HALF_UP",
    precision: 80,
    inexactIntermediate: false,
    exact,
    stored: fixed6(stored),
    rounded: exact !== stored,
  };
}

/** kpi_evaluation.threshold_id: the configured threshold version when it was the one used, else NULL. */
function thresholdId(k: DemoKpi, l: DemoLineage): string | null {
  if (l.thresholdSource !== "configured") return null;
  if (k.threshold === null) throw new Error(`demo seed: ${k.key} has no configured threshold`);
  return k.threshold.id;
}

async function seedActual(ctx: DemoSeedContext, a: DemoActual): Promise<void> {
  const k = demoKpi(a.kpi);
  const p = demoPeriod(a.period);
  const ids = actualIds(a);
  const kds = DEMO_ANCHORS.users.kds;
  const entered = when(ctx, a.enteredAt);
  // The direct-accept route: the slot is created accepted with its value 1 and its direct_accept review (0034).
  await ctx.insert("kpi_actual", `kbe.actual.${a.key}`, {
    id: ids.actual,
    ...scoped(),
    kpi_definition_id: k.definitionId,
    scope_kind: "transformation",
    scope_id: DEMO_ANCHORS.transformationId,
    reporting_period_id: p.id,
    period_start: p.start,
    period_end: p.end,
    period_label: p.label,
    current_value_no: 1,
    accepted_value_no: 1,
    status: "accepted",
    route: "direct_accept",
    submitted_by: kds,
    submitted_at: entered,
    decided_by: kds,
    decided_at: entered,
    decision_reason: null,
    version: 1,
    ...stamps(entered, kds),
  });
  await ctx.insert("kpi_actual_value", `kbe.actual.${a.key}.v1`, {
    id: ids.value,
    ...scoped(),
    kpi_actual_id: ids.actual,
    value_no: 1,
    kpi_version_id: k.versionId,
    value: null,
    numerator: a.numerator,
    denominator: a.denominator,
    milestone_achieved: null,
    achieved_on: null,
    currency: k.currency,
    missing_reason: null,
    data_as_of: a.dataAsOf,
    comment: a.comment,
    entered_at: entered,
    entered_by: kds,
    business_date: a.businessDate,
  });
  await ctx.insert("kpi_actual_review", `kbe.actual.${a.key}.v1.review`, {
    id: ids.review,
    ...scoped(),
    kpi_actual_id: ids.actual,
    value_no: 1,
    outcome: "direct_accept",
    reason: null,
    decided_by: kds,
    on_behalf_of_user_id: null,
    decided_at: entered,
    business_date: a.businessDate,
  });
  // The worker's run for this accepted value (trigger actual_accepted, slot = value number 1).
  const started = new Date(entered.getTime() + 60_000);
  const stale = a.evaluation.valueStatus === "stale";
  await ctx.insert("calculation_run", `kbe.actual.${a.key}.run`, {
    id: ids.run,
    ...scoped(),
    trigger_kind: "actual_accepted",
    trigger_record_type: "kpi_actual",
    trigger_record_id: ids.actual,
    trigger_slot: 1,
    idempotency_key: `demo:kpi.actual_accepted:${ids.actual}:1`,
    status: "completed",
    error_code: null,
    evaluation_count: 2,
    finding_count: stale ? 1 : 0,
    formula_engine_version: FORMULA_ENGINE_VERSION,
    kpi_rules_version: KPI_RULES_VERSION,
    started_at: started,
    completed_at: new Date(started.getTime() + 2_000),
  });
  const prev = previousActual(a);
  const e = a.evaluation;
  await ctx.insert("kpi_evaluation", `kbe.actual.${a.key}.evaluation`, {
    id: ids.evaluation,
    ...scoped(),
    calculation_run_id: ids.run,
    kpi_definition_id: k.definitionId,
    kpi_version_id: k.versionId,
    scope_kind: "transformation",
    scope_id: DEMO_ANCHORS.transformationId,
    reporting_period_id: p.id,
    period_label: p.label,
    value_basis: "period",
    value: e.value,
    value_status: e.valueStatus,
    value_reason: stale ? "kpi.stale" : null,
    value_source: "entered",
    currency: k.currency,
    inputs: JSON.stringify({ kpiActualId: ids.actual, valueNo: 1 }),
    rounding: JSON.stringify(roundingRecord(a.lineage.period.exact, e.value)),
    expected_value: e.expected,
    final_target: k.targetValue,
    variance: e.variance,
    variance_ratio: e.varianceRatio,
    comparison_flag: null,
    trend: e.trend,
    previous_period_id: prev === null ? null : demoPeriod(prev.period).id,
    data_as_of: a.dataAsOf,
    calculated_rag: e.calculatedRag,
    deviation: e.deviation,
    threshold_id: thresholdId(k, a.lineage.period),
    threshold_source: a.lineage.period.thresholdSource,
    target_trajectory_id: k.trajectory.id,
    explanation_key: e.explanationKey,
    explanation_params: JSON.stringify(a.lineage.period.explanationParams),
    evaluated_at: new Date(started.getTime() + 1_000),
  });
  // The same run's cumulative-basis (YTD) evaluation of the slot, with the window's actual versions (ADR-0027 C5).
  const c = a.cumulative;
  const window = ytdWindow(a);
  const windowValues = window.map((w) => ({
    reportingPeriodId: demoPeriod(w.period).id,
    kpiActualId: actualIds(w).actual,
    valueNo: 1,
  }));
  await ctx.insert("kpi_evaluation", `kbe.actual.${a.key}.evaluation.cumulative`, {
    id: ids.cumulativeEvaluation,
    ...scoped(),
    calculation_run_id: ids.run,
    kpi_definition_id: k.definitionId,
    kpi_version_id: k.versionId,
    scope_kind: "transformation",
    scope_id: DEMO_ANCHORS.transformationId,
    reporting_period_id: p.id,
    period_label: p.label,
    value_basis: "cumulative",
    value: c.value,
    value_status: c.valueStatus,
    value_reason: c.valueStatus === "stale" ? "kpi.stale" : null,
    value_source: "entered",
    currency: k.currency,
    inputs: JSON.stringify({
      kpiActualId: ids.actual,
      valueNo: 1,
      window: windowValues.map((w) => w.reportingPeriodId),
      windowValues,
    }),
    rounding: JSON.stringify(roundingRecord(a.lineage.cumulative.exact, c.value)),
    expected_value: null,
    final_target: k.targetValue,
    variance: null,
    variance_ratio: null,
    comparison_flag: null,
    trend: c.trend,
    previous_period_id: prev === null ? null : demoPeriod(prev.period).id,
    data_as_of: a.dataAsOf,
    calculated_rag: c.calculatedRag,
    deviation: c.deviation,
    threshold_id: thresholdId(k, a.lineage.cumulative),
    threshold_source: a.lineage.cumulative.thresholdSource,
    target_trajectory_id: null,
    explanation_key: c.explanationKey,
    explanation_params: JSON.stringify(a.lineage.cumulative.explanationParams),
    evaluated_at: new Date(started.getTime() + 1_000),
  });
  if (stale)
    await ctx.insert("data_quality_finding", `kbe.actual.${a.key}.finding.stale`, {
      id: ids.finding,
      ...scoped(),
      kpi_definition_id: k.definitionId,
      scope_kind: "transformation",
      scope_id: DEMO_ANCHORS.transformationId,
      reporting_period_id: p.id,
      kpi_actual_id: ids.actual,
      value_no: 1,
      rule_code: "stale",
      severity: "warning",
      detail_params: JSON.stringify({ dataAsOf: a.dataAsOf, staleAfterDays: k.staleAfterDays }),
      detected_by_run_id: ids.run,
      detected_at: new Date(started.getTime() + 1_000),
      status: "open",
      version: 1,
      created_at: new Date(started.getTime() + 1_000),
      created_by: null,
      updated_at: new Date(started.getTime() + 1_000),
      updated_by: null,
    });
}

/** Module: the actuals in order (each with its run and evaluation), then June and July close. */
export const ACTUALS_MODULE: DemoDatasetModule = {
  key: "kbe.actuals",
  order: KBE_H_FIRST_ORDER + 10,
  async seed(ctx) {
    for (const k of DEMO_KPIS) for (const a of DEMO_ACTUALS.filter((x) => x.kpi === k.key)) await seedActual(ctx, a);
    for (const key of ["2026-06", "2026-07"]) {
      const p = demoPeriod(key);
      if (p.closedAt === null) throw new Error(`demo seed: ${key} has no closing time`);
      const closed = when(ctx, p.closedAt);
      await seedUpdate(ctx, "reporting_period", p.id, "close", { status: "closed", closed_at: closed }, closed, null);
    }
  },
};

/**
 * Coverage condition `kpi.stale` (ADR-0050 §5; for BE-T's named line in coverage.ts): the KPIs of the transformation
 * whose current status is Stale, i.e. whose latest evaluation (highest run seq, 0035) of their latest evaluated
 * period-basis slot has value status `stale`. Relative to the synthetic clock: the evaluation was made on its business
 * date, and the stale value stays stale in real time.
 */
export async function countStaleKpis(tx: Tx, transformationId: string): Promise<number> {
  const r = await sql<{ n: string }>`
    WITH latest AS (
      SELECT DISTINCT ON (e.kpi_definition_id) e.kpi_definition_id, e.value_status
        FROM kpi_evaluation e
        JOIN calculation_run r ON r.id = e.calculation_run_id
        JOIN reporting_period p ON p.id = e.reporting_period_id
        JOIN kpi_definition d ON d.id = e.kpi_definition_id AND d.status = 'active'
       WHERE e.transformation_id = ${transformationId}::uuid AND e.value_basis = 'period'
         AND e.scope_kind = 'transformation' AND e.scope_id = e.transformation_id
       ORDER BY e.kpi_definition_id, p.period_end DESC, r.seq DESC)
    SELECT count(*)::text AS n FROM latest WHERE value_status = 'stale'`.execute(tx);
  return Number(r.rows[0]!.n);
}
