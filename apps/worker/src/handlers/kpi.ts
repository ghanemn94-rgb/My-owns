// kpi job handlers (T-DG4-KBE-C; p4-work-split §A.3, §I+C.5; ADR-0027 §3, §7-§9; ADR-0028; REQ-S07-006, REQ-S07-007,
// REQ-S07-010, REQ-S07-013, REQ-S12-005, REQ-S12-006, REQ-S16-014):
//
// 1. `kpi.recalculate` (consumer kpi.recalculate.v1), fed by the outbox events of the four triggers:
//      kpi.actual_accepted   -> trigger actual_accepted     (kpi_actual, slot = value number)
//      kpi.threshold_changed -> trigger threshold_changed   (kpi_rag_threshold, slot = version number)
//      kpi.trajectory_approved -> trigger trajectory_approved (target_trajectory, slot = version number)
//      kpi.version_activated -> trigger version_activated   (kpi_version, slot = version number)
//    In ONE transaction under the kit's runOnce (key = the event's idempotency key) it
//      - validates the accepted value against the version's data-quality rule and records data_quality_finding rows
//        (ON CONFLICT DO NOTHING: at most one open finding per KPI, scope, period and rule);
//      - recalculates: the slot's evaluations (bases period and cumulative), the roll-up to the transformation scope
//        when the entry scope is narrower, and every formula KPI that reads the KPI transitively, for the same period
//        (an accepted actual); or the KPI's slots of its current reporting period (the other three triggers);
//      - evaluates deviations: RAG from the approved trajectory and the threshold version in force, NEVER from task
//        completion (the inputs are values, the active version, the trajectory, the thresholds and the business date);
//      - inserts exactly one calculation_run (unique trigger key: a redelivery or a restart writes no second run) and
//        its kpi_evaluation rows, with kpi_rules_version and formula_engine_version;
//      - writes one kpi.deviation_evaluated per evaluation of basis period and exactly one kpi.values_recalculated.
//    Runs, evaluations and finding inserts write NO audit event (system lineage, ADR-0027 §7, the benefit_calculation
//    precedent). Unknown is NULL with a reason, never 0; Unknown, Stale and Not computable force the same-named RAG.
//
// 2. `kpi.reporting_period_open` (job_schedule row, daily): opens every scheduled period whose period_end is before
//    today's business date in the organization's default calendar timezone (else its default timezone), with one audit
//    event (actor service), and creates one `kpi_update_due` work item per active KPI of that frequency for its owner
//    (createWorkItemOnce, dedupe key kpi.period_open:<kpiDefinitionId>:<periodLabel>:<ownerUserId>; ADR-0025 §4).
//
// A job never decides a business approval and never touches the engineering gates DG0-DG7.
import { insertAuditEvent, sql, type Db, type Tx } from "@mth/db";
import {
  applyFreshness,
  computeTrend,
  computeVariance,
  cumulativeValue,
  ENGINE_VERSION,
  evaluateKpiFormula,
  evaluateRag,
  expectedToDate,
  FORMULA_DECIMAL as D,
  freshness,
  KPI_RULES_VERSION,
  notComputable,
  ok,
  periodValue,
  rollUp,
  roundForStorage,
  unknown,
  type KpiResult,
  type PeriodEntry,
  type RagThresholdVersion,
  type ReportingPeriodInfo,
  type TrajectoryPoint,
  type UnitKind,
  type ValueBasis,
  type ValueNature,
} from "@mth/shared/calc";
import { outboxEnvelope, outboxPayloadSchema } from "@mth/shared/schemas";
import { z } from "zod";
import { createWorkItemOnce, jobActor, runOnce } from "../kit.ts";
import type { JobHandler } from "./spec.ts";

export const RECALCULATE_QUEUE = "kpi.recalculate";
export const RECALCULATE_CONSUMER = "kpi.recalculate.v1";
export const PERIOD_OPEN_QUEUE = "kpi.reporting_period_open";
export const PERIOD_OPEN_CONSUMER = "kpi.reporting_period_open.v1";
/** The outbox events that trigger a calculation run (ADR-0027 §8). */
export const RECALCULATE_EVENTS = [
  "kpi.actual_accepted",
  "kpi.threshold_changed",
  "kpi.trajectory_approved",
  "kpi.version_activated",
] as const;

type Trigger = {
  readonly kind: "actual_accepted" | "threshold_changed" | "trajectory_approved" | "version_activated";
  readonly recordType: "kpi_actual" | "kpi_rag_threshold" | "target_trajectory" | "kpi_version";
  readonly recordId: string;
  readonly slot: number;
  readonly transformationId: string;
  readonly kpiDefinitionId: string;
  /** actual_accepted: the slot; trajectory_approved: the trajectory's scope. */
  readonly scopeKind?: string;
  readonly scopeId?: string;
  readonly reportingPeriodId?: string;
};

const ids = z.object({ kpiDefinitionId: z.uuid(), transformationId: z.uuid(), versionNo: z.number().int() }).loose();

/** The trigger of an outbox envelope (payload already validated by the relay and again here). */
export function triggerOf(eventType: string, schemaVersion: number, payload: unknown): Trigger {
  const schema = outboxPayloadSchema(eventType, schemaVersion);
  if (!schema) throw new Error(`kpi.recalculate: no schema for ${eventType} v${schemaVersion}`);
  const p = schema.parse(payload) as Record<string, unknown>;
  switch (eventType) {
    case "kpi.actual_accepted":
      return {
        kind: "actual_accepted",
        recordType: "kpi_actual",
        recordId: p["kpiActualId"] as string,
        slot: p["valueNo"] as number,
        transformationId: p["transformationId"] as string,
        kpiDefinitionId: p["kpiDefinitionId"] as string,
        scopeKind: p["scopeKind"] as string,
        scopeId: p["scopeId"] as string,
        reportingPeriodId: p["reportingPeriodId"] as string,
      };
    case "kpi.threshold_changed": {
      const q = ids.parse(p);
      return {
        kind: "threshold_changed",
        recordType: "kpi_rag_threshold",
        recordId: p["kpiRagThresholdId"] as string,
        slot: q.versionNo,
        transformationId: q.transformationId,
        kpiDefinitionId: q.kpiDefinitionId,
      };
    }
    case "kpi.trajectory_approved": {
      const q = ids.parse(p);
      return {
        kind: "trajectory_approved",
        recordType: "target_trajectory",
        recordId: p["targetTrajectoryId"] as string,
        slot: q.versionNo,
        transformationId: q.transformationId,
        kpiDefinitionId: q.kpiDefinitionId,
        scopeKind: p["scopeKind"] as string,
        scopeId: p["scopeId"] as string,
      };
    }
    case "kpi.version_activated": {
      const q = ids.parse(p);
      return {
        kind: "version_activated",
        recordType: "kpi_version",
        recordId: p["kpiVersionId"] as string,
        slot: q.versionNo,
        transformationId: q.transformationId,
        kpiDefinitionId: q.kpiDefinitionId,
      };
    }
    default:
      throw new Error(`kpi.recalculate: unexpected event ${eventType}`);
  }
}

// ------------------------------------------------------------------------------------------------ loading

interface Kpi {
  readonly id: string;
  readonly unitKind: UnitKind;
  readonly unitLabel: string | null;
  readonly currency: string | null;
  readonly frequency: string;
  readonly version: {
    readonly id: string;
    readonly measureType: "higher_is_better" | "lower_is_better" | "acceptable_band" | "binary_milestone";
    readonly valueNature: ValueNature;
    readonly entryScopeKind: string;
    readonly aggregationRule: string;
    readonly stockAdditive: boolean;
    readonly ytdStartMonth: number;
    readonly calculationMethod: string;
    readonly formulaExpression: string | null;
    readonly baselineValue: string | null;
    readonly baselineDate: string | null;
    readonly targetValue: string | null;
    readonly bandLower: string | null;
    readonly bandUpper: string | null;
    readonly milestoneDueDate: string | null;
    readonly staleAfterDays: number;
    readonly validMin: string | null;
    readonly validMax: string | null;
    readonly evidenceRequired: boolean;
  } | null;
}

async function loadKpi(tx: Tx, id: string): Promise<Kpi | null> {
  const d = await tx
    .selectFrom("kpi_definition")
    .select(["id", "unit_kind", "unit_label", "currency", "frequency"])
    .where("id", "=", id)
    .executeTakeFirst();
  if (!d) return null;
  const v = await tx
    .selectFrom("kpi_version")
    .selectAll()
    .where("kpi_definition_id", "=", id)
    .where("status", "=", "active")
    .executeTakeFirst();
  const trim = (c: string | null) => (c === null ? null : c.trim());
  return {
    id: d.id,
    unitKind: d.unit_kind as UnitKind,
    unitLabel: d.unit_label,
    currency: trim(d.currency),
    frequency: d.frequency,
    version: v
      ? {
          id: v.id,
          measureType: v.measure_type as NonNullable<Kpi["version"]>["measureType"],
          valueNature: v.value_nature as ValueNature,
          entryScopeKind: v.entry_scope_kind,
          aggregationRule: v.aggregation_rule ?? "none",
          stockAdditive: v.stock_additive_across_scopes,
          ytdStartMonth: v.ytd_start_month,
          calculationMethod: v.calculation_method,
          formulaExpression: v.formula_expression,
          baselineValue: v.baseline_value,
          baselineDate: v.baseline_date,
          targetValue: v.target_value,
          bandLower: v.band_lower,
          bandUpper: v.band_upper,
          milestoneDueDate: v.milestone_due_date,
          staleAfterDays: v.dq_stale_after_days,
          validMin: v.dq_valid_min,
          validMax: v.dq_valid_max,
          evidenceRequired: v.dq_evidence_required,
        }
      : null,
  };
}

const periodInfo = (r: {
  id: string;
  frequency: string;
  period_start: string;
  period_end: string;
  basis: string;
  week_count: number | null;
}): ReportingPeriodInfo & { readonly periodEnd: string } => ({
  id: r.id,
  frequency: r.frequency as ReportingPeriodInfo["frequency"],
  periodStart: r.period_start,
  periodEnd: r.period_end,
  basis: r.basis as "calendar" | "weeks",
  weekCount: r.week_count,
});

interface Accepted {
  readonly actualId: string;
  readonly valueNo: number;
  readonly entry: PeriodEntry | null;
  readonly achieved: boolean | null;
  readonly achievedOn: string | null;
  readonly dataAsOf: string;
  readonly evidenceCount: number;
  readonly value: string | null;
}

/** The accepted values of a KPI, by scope id and period id (the value in force of each slot). */
async function acceptedValues(tx: Tx, kpiId: string): Promise<Map<string, Map<string, Accepted>>> {
  const rows = await tx
    .selectFrom("kpi_actual as a")
    .innerJoin("kpi_actual_value as v", (j) =>
      j.onRef("v.kpi_actual_id", "=", "a.id").onRef("v.value_no", "=", "a.accepted_value_no"),
    )
    .select([
      "a.id",
      "a.scope_id",
      "a.reporting_period_id",
      "v.value_no",
      "v.value",
      "v.numerator",
      "v.denominator",
      "v.milestone_achieved",
      "v.achieved_on",
      "v.missing_reason",
      "v.data_as_of",
      sql<number>`(SELECT count(*)::int FROM kpi_actual_evidence e WHERE e.kpi_actual_id = a.id AND e.value_no = v.value_no)`.as(
        "evidence_count",
      ),
    ])
    .where("a.kpi_definition_id", "=", kpiId)
    .where("a.accepted_value_no", "is not", null)
    .execute();
  const out = new Map<string, Map<string, Accepted>>();
  for (const r of rows) {
    const entry: PeriodEntry | null =
      r.missing_reason !== null
        ? { kind: "not_available", missingReason: r.missing_reason }
        : r.numerator !== null && r.denominator !== null
          ? { kind: "ratio", numerator: r.numerator, denominator: r.denominator }
          : r.value !== null
            ? { kind: "value", value: r.value }
            : null;
    const byPeriod = out.get(r.scope_id) ?? new Map<string, Accepted>();
    byPeriod.set(r.reporting_period_id, {
      actualId: r.id,
      valueNo: r.value_no,
      entry,
      achieved: r.milestone_achieved,
      achievedOn: r.achieved_on,
      dataAsOf: r.data_as_of,
      evidenceCount: r.evidence_count,
      value: r.value,
    });
    out.set(r.scope_id, byPeriod);
  }
  return out;
}

async function businessDate(tx: Tx, organizationId: string): Promise<string> {
  const r = await sql<{ d: string }>`
    SELECT p4_business_date(now(), coalesce(
      (SELECT c.timezone FROM business_calendar c
        WHERE c.organization_id = ${organizationId}::uuid AND c.is_default AND c.status = 'active' LIMIT 1),
      (SELECT o.default_timezone FROM organization o WHERE o.id = ${organizationId}::uuid)))::text AS d`.execute(tx);
  return r.rows[0]!.d;
}

// ------------------------------------------------------------------------------------------------ evaluation

interface EvaluationRow {
  readonly kpiDefinitionId: string;
  readonly kpiVersionId: string;
  readonly scopeKind: string;
  readonly scopeId: string;
  readonly period: ReportingPeriodInfo & { readonly periodEnd: string };
  readonly periodLabel: string;
  readonly basis: ValueBasis;
  readonly result: KpiResult;
  readonly source: "entered" | "rolled_up" | "formula" | "none";
  readonly currency: string | null;
  readonly inputs: Record<string, unknown>;
  readonly dataAsOf: string | null;
  readonly milestone: { achieved: boolean; achievedOn: string | null } | null;
  readonly inexact?: boolean;
  readonly formulaRounding?: Record<string, unknown> | null;
}

interface Finding {
  readonly kpiDefinitionId: string;
  readonly scopeKind: string;
  readonly scopeId: string;
  readonly periodId: string;
  readonly actualId: string | null;
  readonly valueNo: number | null;
  readonly rule: string;
  readonly severity: "info" | "warning";
  readonly params: Record<string, unknown>;
}

interface Context {
  readonly tx: Tx;
  readonly organizationId: string;
  readonly transformationId: string;
  readonly businessDate: string;
  readonly periods: readonly (ReportingPeriodInfo & { periodEnd: string; label: string; status: string })[];
  readonly computed: Map<string, KpiResult>;
  readonly findings: Finding[];
}

const key = (kpi: string, scope: string, period: string, basis: string) => `${kpi}:${scope}:${period}:${basis}`;

/** The value of an entered KPI at its entry scope, for one period and basis. */
function enteredValue(
  ctx: Context,
  kpi: Kpi,
  scopeId: string,
  period: Context["periods"][number],
  basis: ValueBasis,
  values: Map<string, Map<string, Accepted>>,
): { result: KpiResult; accepted: Accepted | null; window?: readonly string[] } {
  const v = kpi.version!;
  const byPeriod = values.get(scopeId) ?? new Map<string, Accepted>();
  const acc = byPeriod.get(period.id) ?? null;
  const f = freshness({
    dataAsOf: acc?.dataAsOf ?? null,
    staleAfterDays: v.staleAfterDays,
    businessDate: ctx.businessDate,
  });
  if (basis === "period") {
    if (v.valueNature === "milestone") {
      if (acc === null) return { result: unknown("kpi.no_accepted_actual"), accepted: null };
      if (acc.entry?.kind === "not_available") return { result: unknown("kpi.value_not_available"), accepted: acc };
      // A milestone has no numeric value; its period result carries 1 (achieved) or 0 (not yet) only as a status
      // holder for the RAG input, and the stored value stays NULL (see `milestone`).
      return { result: applyFreshness(ok(new D(acc.achieved ? 1 : 0)), f), accepted: acc };
    }
    return { result: applyFreshness(periodValue(v.valueNature, acc?.entry ?? null), f), accepted: acc };
  }
  const entries: Record<string, PeriodEntry | null> = {};
  for (const [pid, a] of byPeriod) entries[pid] = a.entry;
  const cum = cumulativeValue({
    valueNature: v.valueNature,
    current: period,
    periods: ctx.periods,
    values: entries,
    ytdStartMonth: v.ytdStartMonth,
  })!;
  return { result: applyFreshness(cum.result, f), accepted: acc, window: cum.window };
}

function evaluateSlot(
  ctx: Context,
  kpi: Kpi,
  scopeKind: string,
  scopeId: string,
  period: Context["periods"][number],
  basis: ValueBasis,
  values: Map<string, Map<string, Accepted>>,
  formulaInputs: Map<string, { variable: string; source: string; basis: ValueBasis; type: Kpi }[]>,
  previouslyReporting: Map<string, string[]>,
): EvaluationRow {
  const v = kpi.version!;
  const base = {
    kpiDefinitionId: kpi.id,
    kpiVersionId: v.id,
    scopeKind,
    scopeId,
    period,
    periodLabel: period.label,
    basis,
    currency: kpi.currency,
  };
  // Formula KPI: the engine with each input bound to the source's value of the same scope, period and input basis.
  if (v.calculationMethod === "formula") {
    const inputs = formulaInputs.get(kpi.id) ?? [];
    const bound = inputs.map((i) => ({
      variableName: i.variable,
      source: {
        unitKind: i.type.unitKind,
        unitLabel: i.type.unitLabel,
        currency: i.type.currency,
        frequency: i.type.frequency as never,
      },
      inputBasis: i.basis,
      value: ctx.computed.get(key(i.source, scopeId, period.id, i.basis)) ?? unknown("kpi.formula_input_unknown"),
    }));
    const e = evaluateKpiFormula(v.formulaExpression!, bound, {
      unitKind: kpi.unitKind,
      unitLabel: kpi.unitLabel,
      currency: kpi.currency,
      frequency: kpi.frequency as never,
    });
    const result: KpiResult = e.ok
      ? e.result.status === "not_computable"
        ? notComputable("kpi.formula_division_by_zero")
        : e.result
      : unknown("kpi.formula_input_unknown");
    return {
      ...base,
      result,
      source: "formula",
      inputs: e.ok ? { formula: v.formulaExpression, values: e.inputs } : { formula: v.formulaExpression },
      dataAsOf: null,
      milestone: null,
      formulaRounding: e.ok ? (e.rounding as unknown as Record<string, unknown>) : null,
    };
  }
  // Roll-up from a narrower entry scope to the transformation scope (ADR-0028 §7).
  if (scopeKind === "transformation" && v.entryScopeKind !== "transformation") {
    if (v.valueNature === "milestone" || v.aggregationRule === "none")
      return {
        ...base,
        result: notComputable("kpi.no_rollup"),
        source: "rolled_up",
        inputs: {},
        dataAsOf: null,
        milestone: null,
      };
    const scopes = [...values.keys()];
    const scopeInputs = scopes.map((s) => {
      const r = enteredValue(ctx, kpi, s, period, basis, values);
      const acc = r.accepted;
      let entry: PeriodEntry | null = null;
      if (basis === "period") entry = acc?.entry ?? null;
      else if (r.result.value !== null) entry = { kind: "value", value: r.result.value };
      if (basis === "cumulative" && v.valueNature === "ratio" && r.result.value !== null) {
        // The scope's Σ numerators / Σ denominators over its window, so the roll-up is a weighted ratio.
        let num = new D(0);
        let den = new D(0);
        for (const pid of r.window ?? []) {
          const e = values.get(s)?.get(pid)?.entry;
          if (e?.kind === "ratio") {
            num = num.plus(e.numerator);
            den = den.plus(e.denominator);
          }
        }
        entry = { kind: "ratio", numerator: num.toString(), denominator: den.toString() };
      }
      return {
        scopeId: s,
        periodId: period.id,
        basis,
        entry,
        dataAsOf: acc?.dataAsOf ?? null,
        unitKind: kpi.unitKind,
        unitLabel: kpi.unitLabel,
        currency: kpi.currency,
      };
    });
    const outcome = rollUp({
      rule: v.aggregationRule as never,
      valueNature: v.valueNature,
      stockAdditiveAcrossScopes: v.stockAdditive,
      periodId: period.id,
      basis,
      previouslyReportingScopes: previouslyReporting.get(kpi.id) ?? [],
      inputs: scopeInputs,
      unitKind: kpi.unitKind,
      unitLabel: kpi.unitLabel,
      currency: kpi.currency,
    });
    if (!outcome.ok || outcome.kind !== "value")
      return {
        ...base,
        result: unknown("kpi.scope_missing"),
        source: "rolled_up",
        inputs: {},
        dataAsOf: null,
        milestone: null,
      };
    if (outcome.missingScopes.length > 0 && basis === "period")
      ctx.findings.push({
        kpiDefinitionId: kpi.id,
        scopeKind,
        scopeId,
        periodId: period.id,
        actualId: null,
        valueNo: null,
        rule: "scope_missing",
        severity: "warning",
        params: { missingScopes: [...outcome.missingScopes], periodLabel: period.label },
      });
    const f = freshness({
      dataAsOf: outcome.dataAsOf,
      staleAfterDays: v.staleAfterDays,
      businessDate: ctx.businessDate,
    });
    return {
      ...base,
      result: applyFreshness(outcome.result, f),
      source: "rolled_up",
      inputs: { expectedScopes: [...outcome.expectedScopes], missingScopes: [...outcome.missingScopes] },
      dataAsOf: outcome.dataAsOf,
      milestone: null,
    };
  }
  // An entered value at the entry scope.
  const r = enteredValue(ctx, kpi, scopeId, period, basis, values);
  const acc = r.accepted;
  if (basis === "period") {
    if (acc === null)
      ctx.findings.push({
        kpiDefinitionId: kpi.id,
        scopeKind,
        scopeId,
        periodId: period.id,
        actualId: null,
        valueNo: null,
        rule: "missing_actual",
        severity: "warning",
        params: { periodLabel: period.label },
      });
    else {
      const ref = {
        kpiDefinitionId: kpi.id,
        scopeKind,
        scopeId,
        periodId: period.id,
        actualId: acc.actualId,
        valueNo: acc.valueNo,
      };
      if (r.result.status === "stale")
        ctx.findings.push({
          ...ref,
          rule: "stale",
          severity: "warning",
          params: { dataAsOf: acc.dataAsOf, staleAfterDays: v.staleAfterDays },
        });
      if (r.result.reason === "kpi.zero_denominator")
        ctx.findings.push({
          ...ref,
          rule: "zero_denominator",
          severity: "warning",
          params: { periodLabel: period.label },
        });
      if (v.evidenceRequired && acc.evidenceCount === 0)
        ctx.findings.push({
          ...ref,
          rule: "evidence_missing",
          severity: "warning",
          params: { periodLabel: period.label },
        });
      const value = r.result.value;
      if (value !== null && v.valueNature !== "milestone") {
        const x = new D(value);
        if ((v.validMin !== null && x.lt(v.validMin)) || (v.validMax !== null && x.gt(v.validMax)))
          ctx.findings.push({
            ...ref,
            rule: "out_of_range",
            severity: "warning",
            params: { value, validMin: v.validMin, validMax: v.validMax },
          });
      }
    }
  }
  return {
    ...base,
    result: r.result,
    source: acc === null ? "none" : "entered",
    inputs:
      acc === null
        ? {}
        : { kpiActualId: acc.actualId, valueNo: acc.valueNo, ...(r.window ? { window: [...r.window] } : {}) },
    dataAsOf: acc?.dataAsOf ?? null,
    milestone:
      v.valueNature === "milestone" && acc !== null && acc.achieved !== null
        ? { achieved: acc.achieved, achievedOn: acc.achievedOn }
        : null,
  };
}

// ------------------------------------------------------------------------------------------------ the run

export interface RecalculateResult {
  readonly outcome: "done" | "duplicate" | "already_run";
  readonly runId: string | null;
  readonly evaluationCount: number;
}

/** One calculation run for one trigger (ADR-0027 §8 step 2). Exported for the tests (REQ-S16-014). */
export async function recalculate(db: Db, data: unknown, _jobId: string): Promise<RecalculateResult> {
  const envelope = outboxEnvelope.parse(data);
  const trigger = triggerOf(envelope.eventType, envelope.schemaVersion, envelope.payload);
  const startedAt = new Date();
  const res = await runOnce(db, RECALCULATE_CONSUMER, envelope.idempotencyKey, async (tx) => {
    const existing = await tx
      .selectFrom("calculation_run")
      .select("id")
      .where("trigger_kind", "=", trigger.kind)
      .where("trigger_record_id", "=", trigger.recordId)
      .where("trigger_slot", "=", trigger.slot)
      .executeTakeFirst();
    if (existing) return { outcome: "already_run" as const, runId: existing.id, evaluationCount: 0 };
    return runCalculation(tx, envelope.organizationId, trigger, startedAt, envelope.idempotencyKey);
  });
  return res.outcome === "duplicate" ? { outcome: "duplicate", runId: null, evaluationCount: 0 } : res.result;
}

async function runCalculation(
  tx: Tx,
  organizationId: string,
  trigger: Trigger,
  startedAt: Date,
  idempotencyKey: string,
): Promise<RecalculateResult> {
  const kpi = await loadKpi(tx, trigger.kpiDefinitionId);
  const periodRows = await tx
    .selectFrom("reporting_period")
    .select(["id", "frequency", "period_start", "period_end", "basis", "week_count", "period_label", "status"])
    .where("organization_id", "=", organizationId)
    .orderBy("period_start")
    .execute();
  const ctx: Context = {
    tx,
    organizationId,
    transformationId: trigger.transformationId,
    businessDate: await businessDate(tx, organizationId),
    periods: periodRows.map((r) => ({ ...periodInfo(r), label: r.period_label, status: r.status })),
    computed: new Map(),
    findings: [],
  };
  // The targets: (KPI, scope, period). Readers of the KPI (formula KPIs) follow their sources.
  const targets: { kpi: Kpi; scopeKind: string; scopeId: string; periodId: string }[] = [];
  const readers: Kpi[] = [];
  if (kpi?.version) {
    let periodIds: string[];
    let scopes: { kind: string; id: string }[];
    if (trigger.kind === "actual_accepted") {
      periodIds = [trigger.reportingPeriodId!];
      scopes = [{ kind: trigger.scopeKind!, id: trigger.scopeId! }];
    } else {
      // The KPI's current reporting period: the latest open or closed period of its frequency (ADR-0028 §6).
      const current = [...ctx.periods]
        .filter((p) => p.frequency === kpi.frequency && p.status !== "scheduled")
        .sort((a, b) => (a.periodEnd < b.periodEnd ? 1 : -1))[0];
      periodIds = current ? [current.id] : [];
      const slotScopes = current
        ? await tx
            .selectFrom("kpi_actual")
            .select(["scope_kind", "scope_id"])
            .distinct()
            .where("kpi_definition_id", "=", kpi.id)
            .where("reporting_period_id", "=", current.id)
            .execute()
        : [];
      scopes = slotScopes.map((s) => ({ kind: s.scope_kind, id: s.scope_id }));
      if (trigger.scopeKind && trigger.scopeId && !scopes.some((s) => s.id === trigger.scopeId))
        scopes.push({ kind: trigger.scopeKind, id: trigger.scopeId });
      if (scopes.length === 0 && kpi.version.entryScopeKind === "transformation")
        scopes.push({ kind: "transformation", id: trigger.transformationId });
    }
    const withRollUp = [...scopes];
    if (kpi.version.entryScopeKind !== "transformation" && !withRollUp.some((s) => s.kind === "transformation"))
      withRollUp.push({ kind: "transformation", id: trigger.transformationId });
    for (const periodId of periodIds)
      for (const s of withRollUp) targets.push({ kpi, scopeKind: s.kind, scopeId: s.id, periodId });
    // Formula readers, transitively, through active versions.
    let frontier = [kpi.id];
    const seen = new Set([kpi.id]);
    while (frontier.length > 0) {
      const rows = await tx
        .selectFrom("kpi_formula_input as i")
        .innerJoin("kpi_version as v", "v.id", "i.kpi_version_id")
        .select("v.kpi_definition_id")
        .distinct()
        .where("v.status", "=", "active")
        .where("i.source_kpi_definition_id", "in", frontier)
        .execute();
      frontier = [];
      for (const r of rows)
        if (!seen.has(r.kpi_definition_id)) {
          seen.add(r.kpi_definition_id);
          frontier.push(r.kpi_definition_id);
          const reader = await loadKpi(tx, r.kpi_definition_id);
          if (reader?.version) readers.push(reader);
        }
    }
    for (const reader of readers)
      for (const periodId of periodIds)
        for (const s of scopes) targets.push({ kpi: reader, scopeKind: s.kind, scopeId: s.id, periodId });
  }

  // Inputs of the formula readers (and their source KPIs' types).
  const formulaInputs = new Map<string, { variable: string; source: string; basis: ValueBasis; type: Kpi }[]>();
  for (const reader of readers) {
    const rows = await tx
      .selectFrom("kpi_formula_input")
      .select(["variable_name", "source_kpi_definition_id", "input_basis"])
      .where("kpi_version_id", "=", reader.version!.id)
      .execute();
    const list = [];
    for (const r of rows) {
      const src = await loadKpi(tx, r.source_kpi_definition_id);
      if (src) list.push({ variable: r.variable_name, source: src.id, basis: r.input_basis as ValueBasis, type: src });
    }
    formulaInputs.set(reader.id, list);
  }

  const valuesByKpi = new Map<string, Map<string, Map<string, Accepted>>>();
  const previouslyReporting = new Map<string, string[]>();
  const evaluations: EvaluationRow[] = [];
  for (const t of targets) {
    if (!valuesByKpi.has(t.kpi.id)) valuesByKpi.set(t.kpi.id, await acceptedValues(tx, t.kpi.id));
    const values = valuesByKpi.get(t.kpi.id)!;
    const period = ctx.periods.find((p) => p.id === t.periodId)!;
    if (!previouslyReporting.has(t.kpi.id)) {
      const scopesBefore = [...values.entries()]
        .filter(([, byPeriod]) =>
          [...byPeriod.keys()].some((pid) => {
            const p = ctx.periods.find((x) => x.id === pid);
            return p !== undefined && p.periodEnd <= period.periodEnd;
          }),
        )
        .map(([scopeId]) => scopeId);
      previouslyReporting.set(t.kpi.id, scopesBefore);
    }
    const bases: ValueBasis[] = t.kpi.version!.valueNature === "milestone" ? ["period"] : ["period", "cumulative"];
    for (const basis of bases) {
      const e = evaluateSlot(
        ctx,
        t.kpi,
        t.scopeKind,
        t.scopeId,
        period,
        basis,
        values,
        formulaInputs,
        previouslyReporting,
      );
      ctx.computed.set(key(t.kpi.id, t.scopeId, period.id, basis), e.result);
      evaluations.push(e);
    }
  }

  const runId = await sql<{ id: string }>`SELECT mth_uuid_v7() AS id`.execute(tx).then((r) => r.rows[0]!.id);
  const rows = [];
  for (const e of evaluations) rows.push(await toEvaluationRow(ctx, e, runId));
  // Comparability and negative-baseline flags become findings (info).
  for (const row of rows)
    if (
      row.values.value_basis === "period" &&
      row.values.comparison_flag !== null &&
      row.values.comparison_flag !== "zero_base"
    )
      ctx.findings.push({
        kpiDefinitionId: row.values.kpi_definition_id,
        scopeKind: row.values.scope_kind,
        scopeId: row.values.scope_id,
        periodId: row.values.reporting_period_id,
        actualId: null,
        valueNo: null,
        rule: row.values.comparison_flag,
        severity: "info",
        params: { periodLabel: row.values.period_label },
      });
  // The run row is append-only and written once, so the new findings are counted before it: one per KPI, scope, period
  // and rule, skipping a rule that already has an open finding (data_quality_finding_one_open).
  const fresh: Finding[] = [];
  const seenRule = new Set<string>();
  for (const f of ctx.findings) {
    const k = `${f.kpiDefinitionId}:${f.scopeKind}:${f.scopeId}:${f.periodId}:${f.rule}`;
    if (seenRule.has(k)) continue;
    seenRule.add(k);
    const open = await tx
      .selectFrom("data_quality_finding")
      .select("id")
      .where("kpi_definition_id", "=", f.kpiDefinitionId)
      .where("scope_kind", "=", f.scopeKind)
      .where("scope_id", "=", f.scopeId)
      .where("reporting_period_id", "=", f.periodId)
      .where("rule_code", "=", f.rule)
      .where("status", "=", "open")
      .executeTakeFirst();
    if (!open) fresh.push(f);
  }
  const inserted = await tx
    .insertInto("calculation_run")
    .values({
      id: runId,
      organization_id: organizationId,
      transformation_id: trigger.transformationId,
      trigger_kind: trigger.kind,
      trigger_record_type: trigger.recordType,
      trigger_record_id: trigger.recordId,
      trigger_slot: trigger.slot,
      idempotency_key: idempotencyKey,
      status: "completed",
      evaluation_count: rows.length,
      finding_count: fresh.length,
      formula_engine_version: ENGINE_VERSION,
      kpi_rules_version: KPI_RULES_VERSION,
      started_at: startedAt,
    })
    .onConflict((oc) => oc.doNothing())
    .returning("id")
    .executeTakeFirst();
  // A unique violation on the trigger key means the run already exists (p4-work-split §A.8 item 5): do nothing.
  if (!inserted) return { outcome: "already_run", runId: null, evaluationCount: 0 };
  for (const row of rows) await tx.insertInto("kpi_evaluation").values(row.values).execute();
  for (const f of fresh)
    await tx
      .insertInto("data_quality_finding")
      .values({
        id: sql<string>`mth_uuid_v7()`,
        organization_id: organizationId,
        transformation_id: trigger.transformationId,
        kpi_definition_id: f.kpiDefinitionId,
        scope_kind: f.scopeKind,
        scope_id: f.scopeId,
        reporting_period_id: f.periodId,
        kpi_actual_id: f.actualId,
        value_no: f.valueNo,
        rule_code: f.rule,
        severity: f.severity,
        detail_params: JSON.stringify(f.params),
        detected_by_run_id: runId,
      })
      .onConflict((oc) => oc.doNothing())
      .execute();
  for (const row of rows)
    if (row.values.value_basis === "period")
      await enqueue(
        tx,
        organizationId,
        "kpi.deviation_evaluated",
        `kpi.deviation_evaluated:${row.values.id}`,
        "kpi_evaluation",
        row.values.id,
        {
          evaluationId: row.values.id,
          transformationId: trigger.transformationId,
          kpiDefinitionId: row.values.kpi_definition_id,
          scopeKind: row.values.scope_kind,
          scopeId: row.values.scope_id,
          reportingPeriodId: row.values.reporting_period_id,
          calculatedRag: row.values.calculated_rag,
          deviation: row.values.deviation,
          previousCalculatedRag: row.previousRag,
        },
      );
  const periodIds = [...new Set(rows.map((r) => r.values.reporting_period_id))];
  await enqueue(
    tx,
    organizationId,
    "kpi.values_recalculated",
    `kpi.values_recalculated:${runId}`,
    "calculation_run",
    runId,
    {
      runId,
      transformationId: trigger.transformationId,
      kpiDefinitionIds: [...new Set(rows.map((r) => r.values.kpi_definition_id))],
      reportingPeriodId: periodIds.length === 1 ? periodIds[0]! : null,
    },
  );
  return { outcome: "done", runId, evaluationCount: rows.length };
}

async function enqueue(
  tx: Tx,
  organizationId: string,
  eventType: "kpi.deviation_evaluated" | "kpi.values_recalculated",
  idempotencyKey: string,
  aggregateType: string,
  aggregateId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const schema = outboxPayloadSchema(eventType, 1)!;
  await tx
    .insertInto("outbox_event")
    .values({
      id: sql<string>`mth_uuid_v7()`,
      organization_id: organizationId,
      aggregate_type: aggregateType,
      aggregate_id: aggregateId,
      event_type: eventType,
      schema_version: 1,
      payload: JSON.stringify(schema.parse(payload)),
      idempotency_key: idempotencyKey,
    })
    .execute();
}

/** One kpi_evaluation row: storage rounding once, expected-to-date, RAG, variance, trend (ADR-0028 §1-§6). */
async function toEvaluationRow(ctx: Context, e: EvaluationRow, runId: string) {
  const { tx } = ctx;
  const kpiVersion = (await loadKpi(tx, e.kpiDefinitionId))!;
  const v = kpiVersion.version!;
  // Storage: round once (numeric(24,6)); a milestone stores no numeric value.
  let result = e.result;
  let rounding: Record<string, unknown> | null = e.formulaRounding ?? null;
  let stored: string | null = null;
  if (result.value !== null) {
    const r = roundForStorage(result.value, e.inexact ?? false);
    if (r.ok) {
      stored = r.stored;
      rounding = rounding ?? (r.rounding as unknown as Record<string, unknown>);
    } else result = notComputable("kpi.value_out_of_range" as never);
  }
  // Thresholds and trajectory in force.
  const threshold = await tx
    .selectFrom("kpi_rag_threshold")
    .select(["id", "version_no", "tolerance_mode", "amber_threshold", "red_threshold"])
    .where("kpi_definition_id", "=", e.kpiDefinitionId)
    .where("status", "=", "active")
    .executeTakeFirst();
  const thresholds: RagThresholdVersion | null = threshold
    ? {
        id: threshold.id,
        versionNo: threshold.version_no,
        toleranceMode: threshold.tolerance_mode as "relative" | "absolute",
        amberThreshold: threshold.amber_threshold,
        redThreshold: threshold.red_threshold,
      }
    : null;
  const trajectory = await tx
    .selectFrom("target_trajectory")
    .select(["id", "version_no", "basis", "interpolation"])
    .where("kpi_definition_id", "=", e.kpiDefinitionId)
    .where("scope_kind", "=", e.scopeKind)
    .where("scope_id", "=", e.scopeId)
    .where("status", "=", "approved")
    .executeTakeFirst();
  const usable = trajectory && trajectory.basis === e.basis ? trajectory : null;
  const points: TrajectoryPoint[] = usable
    ? (
        await tx
          .selectFrom("target_trajectory_point")
          .select(["point_date", "expected_value"])
          .where("target_trajectory_id", "=", usable.id)
          .orderBy("point_date")
          .execute()
      ).map((p) => ({ date: p.point_date, value: p.expected_value }))
    : [];
  const expected = expectedToDate({
    trajectory: usable
      ? {
          id: usable.id,
          versionNo: usable.version_no,
          basis: usable.basis as ValueBasis,
          interpolation: usable.interpolation as "linear" | "step",
          points,
        }
      : null,
    baseline:
      v.baselineValue !== null && v.baselineDate !== null ? { date: v.baselineDate, value: v.baselineValue } : null,
    at: e.period.periodEnd,
  });
  const actualForRag: KpiResult =
    stored !== null && result.status !== "unknown" && result.status !== "not_computable"
      ? ({ ...result, value: stored } as KpiResult)
      : result;
  const rag =
    v.measureType === "acceptable_band"
      ? evaluateRag({
          measureType: "acceptable_band",
          thresholds,
          actual: actualForRag,
          bandLower: v.bandLower!,
          bandUpper: v.bandUpper!,
        })
      : v.measureType === "binary_milestone"
        ? evaluateRag({
            measureType: "binary_milestone",
            thresholds,
            actual:
              e.milestone !== null && (result.status === "ok" || result.status === "stale")
                ? { status: result.status, achieved: e.milestone.achieved, achievedOn: e.milestone.achievedOn }
                : result.status === "unknown" || result.status === "not_computable"
                  ? result
                  : unknown("kpi.no_accepted_actual"),
            dueDate: v.milestoneDueDate!,
            businessDate: ctx.businessDate,
          })
        : evaluateRag({
            measureType: v.measureType,
            thresholds,
            actual: actualForRag,
            expected: expected.result,
            trajectoryVersion: usable?.version_no ?? null,
          });
  // Variance (ADR-0028 §3) when both values are known.
  let variance: string | null = null;
  let varianceRatio: string | null = null;
  let flag: "negative_baseline" | "not_comparable" | "zero_base" | null = null;
  if (stored !== null && expected.result.value !== null && v.valueNature !== "milestone") {
    const vr = computeVariance({ actual: stored, expected: expected.result.value, unitKind: kpiVersion.unitKind });
    variance = roundStored(vr.variance);
    varianceRatio = vr.varianceRatio.value === null ? null : roundStored(vr.varianceRatio.value);
    flag = vr.flag ?? null;
  }
  // Trend against the previous period of the same frequency (its latest stored evaluation of the same basis).
  const previousPeriod =
    [...ctx.periods]
      .filter((p) => p.frequency === e.period.frequency && p.periodEnd < e.period.periodStart)
      .sort((a, b) => (a.periodEnd < b.periodEnd ? 1 : -1))[0] ?? null;
  const previous = previousPeriod
    ? await tx
        .selectFrom("kpi_evaluation as x")
        .innerJoin("calculation_run as r", "r.id", "x.calculation_run_id")
        .select(["x.value", "x.value_status", "x.value_reason"])
        .where("x.kpi_definition_id", "=", e.kpiDefinitionId)
        .where("x.scope_kind", "=", e.scopeKind)
        .where("x.scope_id", "=", e.scopeId)
        .where("x.reporting_period_id", "=", previousPeriod.id)
        .where("x.value_basis", "=", e.basis)
        .orderBy("r.seq", "desc")
        .limit(1)
        .executeTakeFirst()
    : undefined;
  const previousRow = await tx
    .selectFrom("kpi_evaluation as x")
    .innerJoin("calculation_run as r", "r.id", "x.calculation_run_id")
    .select("x.calculated_rag")
    .where("x.kpi_definition_id", "=", e.kpiDefinitionId)
    .where("x.scope_kind", "=", e.scopeKind)
    .where("x.scope_id", "=", e.scopeId)
    .where("x.reporting_period_id", "=", e.period.id)
    .where("x.value_basis", "=", e.basis)
    .orderBy("r.seq", "desc")
    .limit(1)
    .executeTakeFirst();
  let trend: string = "unknown";
  if (v.measureType !== "binary_milestone") {
    const prevResult: KpiResult | null =
      previous === undefined
        ? null
        : previous.value !== null
          ? ({
              status: previous.value_status === "stale" ? "stale" : "ok",
              value: previous.value,
              reason: previous.value_status === "stale" ? "kpi.stale" : null,
            } as KpiResult)
          : unknown("kpi.no_accepted_actual");
    const t = computeTrend(
      v.measureType === "acceptable_band"
        ? {
            measureType: "acceptable_band",
            current: actualForRag,
            previous: prevResult,
            bandLower: v.bandLower!,
            bandUpper: v.bandUpper!,
            currentPeriod: e.period,
            previousPeriod,
            valueBasis: e.basis,
          }
        : {
            measureType: v.measureType,
            current: actualForRag,
            previous: prevResult,
            currentPeriod: e.period,
            previousPeriod,
            valueBasis: e.basis,
          },
    );
    trend = t.trend;
    if (t.comparisonFlag) flag = t.comparisonFlag;
  } else if (previousPeriod !== null) {
    const t = computeTrend({
      measureType: "binary_milestone",
      current: e.milestone?.achieved ?? null,
      previous: null,
      currentPeriod: e.period,
      previousPeriod,
    });
    trend = t.trend;
    if (t.comparisonFlag) flag = t.comparisonFlag;
  }
  // Database invariants (0035): a non-ok status forces the same-named RAG; green/amber/red need ok and a deviation.
  const status = result.status;
  let calculatedRag: string = rag.calculatedRag;
  let deviation: string = rag.deviation;
  let explanationKey: string = rag.explanationKey;
  if (status !== "ok") {
    calculatedRag = status;
    if (status === "stale") explanationKey = "kpi.rag.stale";
    else if (status === "not_computable") explanationKey = "kpi.rag.not_computable";
    else if (!explanationKey.startsWith("kpi.rag.no_") && explanationKey !== "kpi.rag.before_trajectory")
      explanationKey = "kpi.rag.no_actual";
  } else if (
    (calculatedRag === "green" || calculatedRag === "amber" || calculatedRag === "red") &&
    deviation === "unknown"
  ) {
    calculatedRag = "unknown";
  }
  if (status !== "ok" && deviation !== "unknown" && calculatedRag !== "stale") deviation = "unknown";
  return {
    previousRag: previousRow?.calculated_rag ?? null,
    values: {
      id: await sql<{ id: string }>`SELECT mth_uuid_v7() AS id`.execute(tx).then((r) => r.rows[0]!.id),
      organization_id: ctx.organizationId,
      transformation_id: ctx.transformationId,
      calculation_run_id: runId,
      kpi_definition_id: e.kpiDefinitionId,
      kpi_version_id: e.kpiVersionId,
      scope_kind: e.scopeKind,
      scope_id: e.scopeId,
      reporting_period_id: e.period.id,
      period_label: e.periodLabel,
      value_basis: e.basis,
      value: status === "ok" || status === "stale" ? stored : null,
      value_status: status,
      value_reason: result.reason,
      value_source: e.source,
      currency: e.currency,
      inputs: JSON.stringify(e.inputs),
      rounding: rounding === null ? null : JSON.stringify(rounding),
      expected_value: expected.result.value === null ? null : roundStored(expected.result.value),
      final_target: v.targetValue,
      variance,
      variance_ratio: varianceRatio,
      comparison_flag: flag,
      trend,
      previous_period_id: previousPeriod?.id ?? null,
      data_as_of: e.dataAsOf,
      calculated_rag: calculatedRag,
      deviation,
      threshold_id: rag.thresholdId,
      threshold_source: rag.thresholdSource,
      target_trajectory_id: usable?.id ?? null,
      explanation_key: explanationKey,
      explanation_params: JSON.stringify(rag.explanationParams),
    },
  };
}

function roundStored(value: string): string | null {
  const r = roundForStorage(value);
  return r.ok ? r.stored : null;
}

// ------------------------------------------------------------------------------------------------ period open (S12-005)

export interface PeriodOpenResult {
  readonly opened: number;
  readonly tasks: number;
}

const periodOpenData = z.object({ organizationId: z.uuid().optional() }).loose();

/** Opens the due periods and creates the owners' update tasks (REQ-S12-005; ADR-0025 §4). Exported for the tests. */
export async function openDuePeriods(db: Db, data: unknown, jobId: string): Promise<PeriodOpenResult> {
  const { organizationId } = periodOpenData.parse(data ?? {});
  let q = db.selectFrom("reporting_period").select(["id", "organization_id"]).where("status", "=", "scheduled");
  if (organizationId) q = q.where("organization_id", "=", organizationId);
  const candidates = await q.orderBy("period_end").limit(500).execute();
  let opened = 0;
  let tasks = 0;
  for (const c of candidates) {
    const res = await runOnce(db, PERIOD_OPEN_CONSUMER, `kpi.reporting_period_open:${c.id}`, async (tx) => {
      const today = await businessDate(tx, c.organization_id);
      const p = await tx
        .selectFrom("reporting_period")
        .selectAll()
        .where("id", "=", c.id)
        .forUpdate()
        .executeTakeFirst();
      if (!p || p.status !== "scheduled" || !(p.period_end < today)) return null;
      const updated = await tx
        .updateTable("reporting_period")
        .set({
          status: "open",
          opened_at: sql<Date>`now()`,
          version: sql<number>`version + 1`,
          updated_at: sql<Date>`now()`,
          updated_by: null,
        })
        .where("id", "=", p.id)
        .where("version", "=", p.version)
        .returningAll()
        .executeTakeFirstOrThrow();
      await insertAuditEvent(tx, jobActor(jobId), {
        action: "reporting_period.open",
        recordType: "reporting_period",
        recordId: p.id,
        organizationId: p.organization_id,
        priorVersion: p.version,
        newVersion: updated.version,
        changes: { status: { from: "scheduled", to: "open" } },
      });
      const kpis = await tx
        .selectFrom("kpi_definition as k")
        .innerJoin("transformation as t", "t.id", "k.transformation_id")
        .select(["k.id", "k.name", "k.owner_user_id", "k.transformation_id"])
        .where("t.organization_id", "=", p.organization_id)
        .where("t.archived_at", "is", null)
        .where("k.status", "=", "active")
        .where("k.frequency", "=", p.frequency)
        .where("k.owner_user_id", "is not", null)
        .orderBy("k.id")
        .execute();
      let created = 0;
      for (const k of kpis) {
        const r = await createWorkItemOnce(tx, jobActor(jobId), {
          organizationId: p.organization_id,
          transformationId: k.transformation_id,
          kind: "kpi_update_due",
          assigneeUserId: k.owner_user_id!,
          subjectType: "kpi_definition",
          subjectId: k.id,
          linkPath: `/transformations/${k.transformation_id}/kpis/${k.id}/actuals`,
          messageKey: "kpi.update_due",
          messageParams: { kpiName: k.name, periodLabel: p.period_label },
          dueDate: p.update_due_date,
          periodLabel: p.period_label,
          dedupeKey: `kpi.period_open:${k.id}:${p.period_label}:${k.owner_user_id}`,
        });
        if (r.outcome === "created") created += 1;
      }
      return created;
    });
    if (res.outcome === "done" && res.result !== null) {
      opened += 1;
      tasks += res.result;
    }
  }
  return { opened, tasks };
}

export const KPI_HANDLERS: readonly JobHandler[] = [
  { queue: RECALCULATE_QUEUE, handle: recalculate },
  { queue: PERIOD_OPEN_QUEUE, handle: openDuePeriods },
];
