// RAG with versioned thresholds (ADR-0028 §5, REQ-S07-007). Owner: kpi-benefits-engineer (T-DG4-KBE-A).
//
// Thresholds: the active kpi_rag_threshold version, else the DEFAULT relative thresholds 0.05 / 0.10
// (threshold_source 'default'; "Threshold defaults are an implementation assumption", REQ-S07-007 notes).
// Adverse deviation d: relative d = s / |e| (band: s / (U − L); e = 0 or U = L → Not computable, kpi.zero_base);
// absolute d = s. Green d ≤ amber; Amber amber < d ≤ red; Red d > red. Milestones: favourable → Green
// (milestone_achieved), within → Green (milestone_not_yet_due), adverse → Red (milestone_overdue).
//
// The evaluator's inputs are exactly: the value(s), the expectation (from the approved trajectory, or the band or the
// due date), the threshold version and the business date. There is no field for task, action, deliverable, milestone
// or initiative status, so RAG can never be derived from activity completion (M0160, playbook B0095).
import { evaluateMeasure, parseBand, type MeasureEvaluation } from "./measures.ts";
import {
  dec,
  KpiInputError,
  plain,
  type Deviation,
  type KpiExplanationKey,
  type KpiNoValue,
  type KpiRag,
  type KpiReasonCode,
  type KpiResult,
} from "./types.ts";

export type ToleranceMode = "relative" | "absolute";

/** A kpi_rag_threshold version (0033). Thresholds are non-negative decimal strings with red ≥ amber. */
export interface RagThresholdVersion {
  readonly id: string;
  readonly versionNo: number;
  readonly toleranceMode: ToleranceMode;
  readonly amberThreshold: string;
  readonly redThreshold: string;
}

/** ADR-0028 §5 defaults, used when the KPI has no threshold version. */
export const DEFAULT_RAG_THRESHOLDS = Object.freeze({
  toleranceMode: "relative" as const,
  amberThreshold: "0.05",
  redThreshold: "0.10",
});

export interface ThresholdsInForce {
  readonly source: "configured" | "default";
  readonly id: string | null;
  readonly versionNo: number | null;
  readonly toleranceMode: ToleranceMode;
  readonly amberThreshold: string;
  readonly redThreshold: string;
}

/** The thresholds in force: the configured version, or the defaults. Validates 0 ≤ amber ≤ red. */
export function resolveThresholds(configured: RagThresholdVersion | null): ThresholdsInForce {
  const t =
    configured === null
      ? { source: "default" as const, id: null, versionNo: null, ...DEFAULT_RAG_THRESHOLDS }
      : {
          source: "configured" as const,
          id: configured.id,
          versionNo: configured.versionNo,
          toleranceMode: configured.toleranceMode,
          amberThreshold: configured.amberThreshold,
          redThreshold: configured.redThreshold,
        };
  if (t.toleranceMode !== "relative" && t.toleranceMode !== "absolute") {
    throw new KpiInputError("toleranceMode", "must be relative or absolute");
  }
  const amber = dec(t.amberThreshold, "amberThreshold");
  const red = dec(t.redThreshold, "redThreshold");
  if (amber.isNegative()) throw new KpiInputError("amberThreshold", "must be ≥ 0");
  if (red.lt(amber)) throw new KpiInputError("redThreshold", "must be ≥ amberThreshold (kpi_threshold.order)");
  if (t.versionNo !== null && (!Number.isInteger(t.versionNo) || t.versionNo < 1)) {
    throw new KpiInputError("versionNo", "must be an integer ≥ 1");
  }
  return Object.freeze(t);
}

/** Green / Amber / Red of an adverse deviation d against the thresholds (d ≤ amber green; ≤ red amber; else red). */
export function classifyDeviation(d: string, thresholds: ThresholdsInForce): "green" | "amber" | "red" {
  const x = dec(d, "d");
  if (x.lte(dec(thresholds.amberThreshold, "amberThreshold"))) return "green";
  if (x.lte(dec(thresholds.redThreshold, "redThreshold"))) return "amber";
  return "red";
}

// ------------------------------------------------------------------------------------------------ evaluation

interface RagCommon {
  /** The KPI's active threshold version, or null (defaults apply). */
  readonly thresholds: RagThresholdVersion | null;
}
export interface DirectionalRagInput extends RagCommon {
  readonly measureType: "higher_is_better" | "lower_is_better";
  /** The value of the slot (period or cumulative basis), with its status. */
  readonly actual: KpiResult;
  /** expectedToDate(...).result. */
  readonly expected: KpiResult;
  /** The approved trajectory's version number, for the explanation (null when none). */
  readonly trajectoryVersion: number | null;
}
export interface BandRagInput extends RagCommon {
  readonly measureType: "acceptable_band";
  readonly actual: KpiResult;
  readonly bandLower: string;
  readonly bandUpper: string;
}
/** A milestone's accepted value: achieved flag and date, possibly Stale; or no value. */
export type MilestoneActual =
  | { readonly status: "ok" | "stale"; readonly achieved: boolean; readonly achievedOn: string | null }
  | KpiNoValue;
export interface MilestoneRagInput extends RagCommon {
  readonly measureType: "binary_milestone";
  readonly actual: MilestoneActual;
  readonly dueDate: string;
  /** Today's business date (a parameter; the library reads no clock). */
  readonly businessDate: string;
}
export type RagInput = DirectionalRagInput | BandRagInput | MilestoneRagInput;

/** kpi_evaluation.explanation_params / contract KpiStatusExplanation: always names the threshold used. */
export interface RagExplanationParams {
  readonly thresholdSource: "configured" | "default" | "none";
  readonly thresholdVersion: number | null;
  readonly toleranceMode: ToleranceMode | null;
  readonly amberThreshold: string | null;
  readonly redThreshold: string | null;
  readonly trajectoryVersion: number | null;
  readonly expected: string | null;
  readonly actual: string | null;
  /** The adverse deviation d (relative fraction or absolute amount), when computed. */
  readonly deviationValue: string | null;
  readonly bandLower?: string;
  readonly bandUpper?: string;
  readonly dueDate?: string;
  readonly achievedOn?: string | null;
  /** The reason key of an Unknown / Not computable result. */
  readonly reason?: KpiReasonCode;
}

export interface RagEvaluation {
  readonly calculatedRag: KpiRag;
  readonly deviation: Deviation;
  /** The shortfall s in the KPI's unit, or null. */
  readonly shortfall: string | null;
  /** The adverse deviation d compared with the thresholds, or null when not computed. */
  readonly adverseDeviation: string | null;
  readonly explanationKey: KpiExplanationKey;
  readonly explanationParams: RagExplanationParams;
  /** kpi_evaluation.threshold_source / threshold_id (CHECK: configured ⇔ id not null). */
  readonly thresholdSource: "configured" | "default" | "none";
  readonly thresholdId: string | null;
  /** The reason of an Unknown / Not computable RAG (e.g. kpi.zero_base), else null. */
  readonly reason: KpiReasonCode | null;
}

const NO_THRESHOLD = Object.freeze({
  thresholdSource: "none" as const,
  thresholdVersion: null,
  toleranceMode: null,
  amberThreshold: null,
  redThreshold: null,
});

function thresholdParams(t: ThresholdsInForce) {
  return {
    thresholdSource: t.source,
    thresholdVersion: t.versionNo,
    toleranceMode: t.toleranceMode,
    amberThreshold: t.amberThreshold,
    redThreshold: t.redThreshold,
  };
}

/** Evaluates the calculated RAG of one slot (ADR-0028 §5, §6). Pure; never reads a clock or any activity status. */
export function evaluateRag(input: RagInput): RagEvaluation {
  const thresholds = resolveThresholds(input.thresholds);
  const trajectoryVersion =
    input.measureType === "higher_is_better" || input.measureType === "lower_is_better"
      ? input.trajectoryVersion
      : null;
  const actualText =
    input.actual.status === "ok" || input.actual.status === "stale"
      ? "value" in input.actual
        ? input.actual.value
        : null
      : null;
  const extras =
    input.measureType === "acceptable_band"
      ? { bandLower: input.bandLower, bandUpper: input.bandUpper }
      : input.measureType === "binary_milestone"
        ? { dueDate: input.dueDate, achievedOn: "achievedOn" in input.actual ? input.actual.achievedOn : null }
        : {};
  if (input.measureType === "acceptable_band") parseBand(input.bandLower, input.bandUpper);

  const finish = (
    rag: KpiRag,
    key: KpiExplanationKey,
    m: Pick<MeasureEvaluation, "deviation" | "shortfall">,
    opts: { expected?: string | null; d?: string | null; reason?: KpiReasonCode | null; used?: boolean } = {},
  ): RagEvaluation => {
    const used = opts.used ?? false;
    const params: RagExplanationParams = Object.freeze({
      ...(used ? thresholdParams(thresholds) : NO_THRESHOLD),
      trajectoryVersion,
      expected: opts.expected ?? null,
      actual: actualText,
      deviationValue: opts.d ?? null,
      ...extras,
      ...(opts.reason ? { reason: opts.reason } : {}),
    });
    return Object.freeze({
      calculatedRag: rag,
      deviation: m.deviation,
      shortfall: m.shortfall,
      adverseDeviation: opts.d ?? null,
      explanationKey: key,
      explanationParams: params,
      thresholdSource: used ? thresholds.source : "none",
      thresholdId: used ? thresholds.id : null,
      reason: opts.reason ?? null,
    });
  };
  const noJudgement = { deviation: "unknown" as const, shortfall: null };

  // 1. The value's own status forces the RAG (ADR-0028 §6; 0035 kpi_evaluation_unknown_rag).
  switch (input.actual.status) {
    case "unknown":
      return finish("unknown", "kpi.rag.no_actual", noJudgement, { reason: input.actual.reason });
    case "not_computable":
      return finish("not_computable", "kpi.rag.not_computable", noJudgement, { reason: input.actual.reason });
    case "stale":
      return finish("stale", "kpi.rag.stale", noJudgement, { reason: "kpi.stale" });
    case "ok":
      break;
  }

  // 2. Milestones: favourable / within → Green, adverse → Red; thresholds are not used.
  if (input.measureType === "binary_milestone") {
    const a = input.actual as Exclude<MilestoneActual, KpiNoValue>;
    const m = evaluateMeasure({
      measureType: "binary_milestone",
      achieved: a.achieved,
      achievedOn: a.achievedOn,
      dueDate: input.dueDate,
      businessDate: input.businessDate,
    });
    if (m.deviation === "unknown")
      return finish("unknown", "kpi.rag.no_actual", m, { reason: "kpi.no_accepted_actual" });
    if (m.deviation === "adverse") return finish("red", "kpi.rag.milestone_overdue", m);
    return finish(
      "green",
      m.deviation === "favourable" ? "kpi.rag.milestone_achieved" : "kpi.rag.milestone_not_yet_due",
      m,
    );
  }

  const actual = (input.actual as Extract<KpiResult, { status: "ok" }>).value;

  // 3. Bands: inside → Green; outside → d against the thresholds.
  if (input.measureType === "acceptable_band") {
    const m = evaluateMeasure({
      measureType: "acceptable_band",
      actual,
      bandLower: input.bandLower,
      bandUpper: input.bandUpper,
    });
    const s = dec(m.shortfall!, "shortfall");
    const width = dec(input.bandUpper, "bandUpper").minus(dec(input.bandLower, "bandLower"));
    if (thresholds.toleranceMode === "relative" && width.isZero()) {
      return finish("not_computable", "kpi.rag.not_computable", m, { reason: "kpi.zero_base", used: true });
    }
    const d = thresholds.toleranceMode === "relative" ? s.div(width) : s;
    if (m.bandPosition === "inside") return finish("green", "kpi.rag.inside_band", m, { d: plain(d), used: true });
    return finish(classifyDeviation(plain(d), thresholds), "kpi.rag.outside_band", m, { d: plain(d), used: true });
  }

  // 4. Higher / lower is better against the trajectory's expected-to-date.
  if (input.expected.status !== "ok") {
    const reason = input.expected.reason ?? "kpi.no_approved_trajectory";
    if (input.expected.status === "not_computable") {
      return finish("not_computable", "kpi.rag.not_computable", noJudgement, { reason });
    }
    const key: KpiExplanationKey =
      reason === "kpi.before_trajectory" ? "kpi.rag.before_trajectory" : "kpi.rag.no_approved_trajectory";
    return finish("unknown", key, noJudgement, { reason });
  }
  const expected = input.expected.value;
  const m = evaluateMeasure({ measureType: input.measureType, actual, expected });
  const s = dec(m.shortfall!, "shortfall");
  const e = dec(expected, "expected");
  if (thresholds.toleranceMode === "relative" && e.isZero()) {
    return finish("not_computable", "kpi.rag.not_computable", m, { expected, reason: "kpi.zero_base", used: true });
  }
  const d = plain(thresholds.toleranceMode === "relative" ? s.div(e.abs()) : s);
  const rag = classifyDeviation(d, thresholds);
  const key: KpiExplanationKey =
    rag === "green"
      ? "kpi.rag.on_or_better_than_trajectory"
      : rag === "amber"
        ? "kpi.rag.amber_band"
        : "kpi.rag.red_threshold";
  return finish(rag, key, m, { expected, d, used: true });
}
