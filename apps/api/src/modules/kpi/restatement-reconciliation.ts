// The reconciliation of a KPI restatement (ADR-0047 §2 "Submission and the retained reconciliation", §9; M0163
// "a retained reconciliation"; REQ-S07-016; T-DG5-KBE-E).
//
// For each selected (closed) period, scope and value basis that has an evaluation or an accepted actual:
//   - BEFORE: the slot's latest DG4 evaluation (highest calculation-run seq): its value, value status, calculated RAG,
//     final target and KPI version; `none` when the slot was never evaluated;
//   - AFTER: the same slot evaluated in memory with the RESTATED version, by the DG4 KPI calculation library
//     (`@mth/shared/calc` kpi/**, read-only and unchanged; the formula engine is untouched, p5-work-split §2 rule 9):
//     period and cumulative values, freshness, the roll-up to the transformation scope, formula KPIs, storage
//     rounding, expected-to-date and RAG, in the order and with the rules of the worker's run
//     (apps/worker/src/handlers/kpi.ts `evaluateSlot`/`toEvaluationRow`, which the API cannot import, ADR-0002 rule 5);
//   - the DIFFERENCE after - before, only when both sides are `ok`.
// A slot with no evaluation and no accepted actual gets no row. Nothing here writes: `computeReconciliation` is the
// draft preview, and the submission (restatements.ts) inserts exactly the rows it returns, in its own transaction, so
// the retained reconciliation equals the preview computed in that transaction.
//
// Unknown, Stale, Not computable and `none` are never shown as a number, 0 or green (`toReconciliationRow`). The
// database keeps a stale side's number because its CHECK requires one (`kpi_restatement_reconciliation_before`/
// `_after`: value present exactly for ok and stale); the API never shows it (ADR-0047 §9).
//
// Formula KPIs: an input of a formula KPI is bound to the source KPI's LATEST STORED evaluation of the same scope,
// period and input basis (read-only). A restatement changes one KPI; its sources keep their own evaluations.
import { sql, type DbOrTx } from "@mth/db";
import {
  applyFreshness,
  cumulativeValue,
  evaluateKpiFormula,
  evaluateRag,
  expectedToDate,
  FORMULA_DECIMAL as D,
  freshness,
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
import { canonicalDecimal, type KpiRestatementReconciliationRow } from "@mth/shared/schemas";

// ------------------------------------------------------------------------------------------------ types

type ScopeKind = KpiRestatementReconciliationRow["scopeKind"];
type ValueStatus = "ok" | "unknown" | "stale" | "not_computable";

/** One reconciliation row as it is stored (kpi_restatement_reconciliation; a stale side keeps its number). */
export interface ReconciliationRowData {
  readonly reportingPeriodId: string;
  readonly periodLabel: string;
  readonly scopeKind: ScopeKind;
  readonly scopeId: string;
  readonly valueBasis: ValueBasis;
  readonly before: {
    readonly evaluationId: string | null;
    readonly kpiVersionId: string | null;
    readonly value: string | null;
    readonly valueStatus: ValueStatus | "none";
    readonly rag: string;
    readonly target: string | null;
  };
  readonly after: {
    readonly value: string | null;
    readonly valueStatus: ValueStatus;
    readonly rag: string;
    readonly target: string | null;
  };
  readonly difference: string | null;
  readonly currency: string | null;
  readonly unitKind: UnitKind;
}

export interface ReconciliationInput {
  readonly organizationId: string;
  readonly kpiDefinitionId: string;
  readonly kpiVersionId: string;
  readonly periods: readonly { readonly id: string; readonly label: string }[];
}

interface VersionInfo {
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
}

interface Kpi {
  readonly id: string;
  readonly unitKind: UnitKind;
  readonly unitLabel: string | null;
  readonly currency: string | null;
  readonly frequency: string;
  readonly version: VersionInfo;
}

type Period = ReportingPeriodInfo & { readonly periodEnd: string; readonly label: string; readonly status: string };

interface Accepted {
  readonly entry: PeriodEntry | null;
  readonly achieved: boolean | null;
  readonly achievedOn: string | null;
  readonly dataAsOf: string;
}

interface Ctx {
  readonly db: DbOrTx;
  readonly organizationId: string;
  readonly businessDate: string;
  readonly periods: readonly Period[];
}

// ------------------------------------------------------------------------------------------------ loading

const trim = (c: string | null) => (c === null ? null : c.trim());

/** The KPI with the given version (the restated one), or null when either is missing. */
async function loadKpiWithVersion(db: DbOrTx, kpiDefinitionId: string, kpiVersionId: string): Promise<Kpi | null> {
  const d = await db
    .selectFrom("kpi_definition")
    .select(["id", "unit_kind", "unit_label", "currency", "frequency"])
    .where("id", "=", kpiDefinitionId)
    .executeTakeFirst();
  const v = await db
    .selectFrom("kpi_version")
    .selectAll()
    .where("id", "=", kpiVersionId)
    .where("kpi_definition_id", "=", kpiDefinitionId)
    .executeTakeFirst();
  if (!d || !v) return null;
  return {
    id: d.id,
    unitKind: d.unit_kind as UnitKind,
    unitLabel: d.unit_label,
    currency: trim(d.currency),
    frequency: d.frequency,
    version: {
      id: v.id,
      measureType: v.measure_type as VersionInfo["measureType"],
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
    },
  };
}

/** The accepted value in force of each slot of a KPI, by scope id and period id (the worker's `acceptedValues`). */
async function acceptedValues(db: DbOrTx, kpiId: string): Promise<Map<string, Map<string, Accepted>>> {
  const rows = await db
    .selectFrom("kpi_actual as a")
    .innerJoin("kpi_actual_value as v", (j) =>
      j.onRef("v.kpi_actual_id", "=", "a.id").onRef("v.value_no", "=", "a.accepted_value_no"),
    )
    .select([
      "a.scope_id",
      "a.reporting_period_id",
      "v.value",
      "v.numerator",
      "v.denominator",
      "v.milestone_achieved",
      "v.achieved_on",
      "v.missing_reason",
      "v.data_as_of",
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
      entry,
      achieved: r.milestone_achieved,
      achievedOn: r.achieved_on,
      dataAsOf: r.data_as_of,
    });
    out.set(r.scope_id, byPeriod);
  }
  return out;
}

/** The organization's business date (default calendar timezone, else the organization's; the worker's rule). */
async function businessDate(db: DbOrTx, organizationId: string): Promise<string> {
  const r = await sql<{ d: string }>`
    SELECT p4_business_date(now(), coalesce(
      (SELECT c.timezone FROM business_calendar c
        WHERE c.organization_id = ${organizationId}::uuid AND c.is_default AND c.status = 'active' LIMIT 1),
      (SELECT o.default_timezone FROM organization o WHERE o.id = ${organizationId}::uuid)))::text AS d`.execute(db);
  return r.rows[0]!.d;
}

async function loadPeriods(db: DbOrTx, organizationId: string): Promise<Period[]> {
  const rows = await db
    .selectFrom("reporting_period")
    .select(["id", "frequency", "period_start", "period_end", "basis", "week_count", "period_label", "status"])
    .where("organization_id", "=", organizationId)
    .orderBy("period_start")
    .execute();
  return rows.map((r) => ({
    id: r.id,
    frequency: r.frequency as ReportingPeriodInfo["frequency"],
    periodStart: r.period_start,
    periodEnd: r.period_end,
    basis: r.basis as "calendar" | "weeks",
    weekCount: r.week_count,
    label: r.period_label,
    status: r.status,
  }));
}

/** The latest evaluation (highest run seq) of every slot of one KPI and period. */
async function latestEvaluations(db: DbOrTx, kpiId: string, periodId: string) {
  const rows = await db
    .selectFrom("kpi_evaluation as e")
    .innerJoin("calculation_run as r", "r.id", "e.calculation_run_id")
    .select([
      "e.id",
      "e.kpi_version_id",
      "e.scope_kind",
      "e.scope_id",
      "e.value_basis",
      "e.value",
      "e.value_status",
      "e.calculated_rag",
      "e.final_target",
      "r.seq",
    ])
    .where("e.kpi_definition_id", "=", kpiId)
    .where("e.reporting_period_id", "=", periodId)
    .orderBy("r.seq", "desc")
    .orderBy("e.id", "desc")
    .execute();
  const latest = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    const k = `${r.scope_kind}:${r.scope_id}:${r.value_basis}`;
    if (!latest.has(k)) latest.set(k, r);
  }
  return latest;
}

// ------------------------------------------------------------------------------------------------ evaluation

/** An entered value at its entry scope for one period and basis (the worker's `enteredValue`). */
function enteredValue(
  ctx: Ctx,
  kpi: Kpi,
  scopeId: string,
  period: Period,
  basis: ValueBasis,
  values: Map<string, Map<string, Accepted>>,
): { result: KpiResult; accepted: Accepted | null; window?: readonly string[] } {
  const v = kpi.version;
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
      return { result: applyFreshness(ok(new D(acc.achieved ? 1 : 0)), f), accepted: acc };
    }
    return { result: applyFreshness(periodValue(v.valueNature, acc?.entry ?? null), f), accepted: acc };
  }
  const entries: Record<string, PeriodEntry | null> = Object.fromEntries(
    [...byPeriod].map(([pid, a]) => [pid, a.entry] as const),
  );
  const cum = cumulativeValue({
    valueNature: v.valueNature,
    current: period,
    periods: ctx.periods,
    values: entries,
    ytdStartMonth: v.ytdStartMonth,
  })!;
  return { result: applyFreshness(cum.result, f), accepted: acc, window: cum.window };
}

/** Scopes that reported a value in any period ending on or before `period` (the roll-up's expected scopes). */
function scopesReportedBy(ctx: Ctx, values: Map<string, Map<string, Accepted>>, period: Period): string[] {
  return [...values.entries()]
    .filter(([, byPeriod]) =>
      [...byPeriod.keys()].some((pid) => {
        const p = ctx.periods.find((x) => x.id === pid);
        return p !== undefined && p.periodEnd <= period.periodEnd;
      }),
    )
    .map(([scopeId]) => scopeId);
}

/** The roll-up of a narrower entry scope to the transformation scope (the worker's ADR-0028 §7 branch). */
function rolledUpValue(
  ctx: Ctx,
  kpi: Kpi,
  period: Period,
  basis: ValueBasis,
  values: Map<string, Map<string, Accepted>>,
): KpiResult {
  const v = kpi.version;
  if (v.valueNature === "milestone" || v.aggregationRule === "none") return notComputable("kpi.no_rollup");
  const scopeInputs = [...values.keys()].map((s) => {
    const r = enteredValue(ctx, kpi, s, period, basis, values);
    const acc = r.accepted;
    let entry: PeriodEntry | null = null;
    if (basis === "period") entry = acc?.entry ?? null;
    else if (r.result.value !== null) entry = { kind: "value", value: r.result.value };
    if (basis === "cumulative" && v.valueNature === "ratio" && r.result.value !== null) {
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
    previouslyReportingScopes: scopesReportedBy(ctx, values, period),
    inputs: scopeInputs,
    unitKind: kpi.unitKind,
    unitLabel: kpi.unitLabel,
    currency: kpi.currency,
  });
  if (!outcome.ok || outcome.kind !== "value") return unknown("kpi.scope_missing");
  const f = freshness({ dataAsOf: outcome.dataAsOf, staleAfterDays: v.staleAfterDays, businessDate: ctx.businessDate });
  return applyFreshness(outcome.result, f);
}

/** A formula KPI's value, each input bound to its source's latest stored evaluation of the same scope and period, on
 * the input's own basis (as the worker binds it, for both bases of the slot). */
async function formulaValue(ctx: Ctx, kpi: Kpi, scopeId: string, period: Period) {
  const v = kpi.version;
  const inputs = await ctx.db
    .selectFrom("kpi_formula_input as i")
    .innerJoin("kpi_definition as d", "d.id", "i.source_kpi_definition_id")
    .select([
      "i.variable_name",
      "i.source_kpi_definition_id",
      "i.input_basis",
      "d.unit_kind",
      "d.unit_label",
      "d.currency",
      "d.frequency",
    ])
    .where("i.kpi_version_id", "=", v.id)
    .orderBy("i.id")
    .execute();
  const bound = [];
  for (const i of inputs) {
    const latest = await ctx.db
      .selectFrom("kpi_evaluation as e")
      .innerJoin("calculation_run as r", "r.id", "e.calculation_run_id")
      .select(["e.value", "e.value_status", "e.value_reason"])
      .where("e.kpi_definition_id", "=", i.source_kpi_definition_id)
      .where("e.scope_id", "=", scopeId)
      .where("e.reporting_period_id", "=", period.id)
      .where("e.value_basis", "=", i.input_basis)
      .orderBy("r.seq", "desc")
      .limit(1)
      .executeTakeFirst();
    const value: KpiResult =
      latest && latest.value !== null && (latest.value_status === "ok" || latest.value_status === "stale")
        ? ({
            status: latest.value_status,
            value: latest.value,
            reason: latest.value_status === "stale" ? "kpi.stale" : null,
          } as KpiResult)
        : unknown("kpi.formula_input_unknown");
    bound.push({
      variableName: i.variable_name,
      source: {
        unitKind: i.unit_kind as UnitKind,
        unitLabel: i.unit_label,
        currency: trim(i.currency),
        frequency: i.frequency as never,
      },
      inputBasis: i.input_basis as ValueBasis,
      value,
    });
  }
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
  return { result, inexact: false };
}

/** The value, status, RAG and target of one slot evaluated with the restated version (the worker's rules). */
async function evaluateAfter(
  ctx: Ctx,
  kpi: Kpi,
  scopeKind: string,
  scopeId: string,
  period: Period,
  basis: ValueBasis,
  values: Map<string, Map<string, Accepted>>,
): Promise<ReconciliationRowData["after"]> {
  const v = kpi.version;
  let result: KpiResult;
  let milestone: { achieved: boolean; achievedOn: string | null } | null = null;
  if (v.calculationMethod === "formula") result = (await formulaValue(ctx, kpi, scopeId, period)).result;
  else if (scopeKind === "transformation" && v.entryScopeKind !== "transformation")
    result = rolledUpValue(ctx, kpi, period, basis, values);
  else {
    const r = enteredValue(ctx, kpi, scopeId, period, basis, values);
    result = r.result;
    const acc = r.accepted;
    if (v.valueNature === "milestone" && acc !== null && acc.achieved !== null)
      milestone = { achieved: acc.achieved, achievedOn: acc.achievedOn };
  }
  // Storage: round once (numeric(24,6)).
  let stored: string | null = null;
  if (result.value !== null) {
    const r = roundForStorage(result.value);
    if (r.ok) stored = r.stored;
    else result = notComputable("kpi.value_out_of_range" as never);
  }
  const threshold = await ctx.db
    .selectFrom("kpi_rag_threshold")
    .select(["id", "version_no", "tolerance_mode", "amber_threshold", "red_threshold"])
    .where("kpi_definition_id", "=", kpi.id)
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
  const trajectory = await ctx.db
    .selectFrom("target_trajectory")
    .select(["id", "version_no", "basis", "interpolation"])
    .where("kpi_definition_id", "=", kpi.id)
    .where("scope_kind", "=", scopeKind)
    .where("scope_id", "=", scopeId)
    .where("status", "=", "approved")
    .executeTakeFirst();
  const usable = trajectory && trajectory.basis === basis ? trajectory : null;
  const points: TrajectoryPoint[] = usable
    ? (
        await ctx.db
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
    at: period.periodEnd,
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
              milestone !== null && (result.status === "ok" || result.status === "stale")
                ? { status: result.status, achieved: milestone.achieved, achievedOn: milestone.achievedOn }
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
  // The 0035 invariants, as the worker applies them: a non-ok status forces the same-named RAG; green, amber or red
  // need a known deviation.
  const status = result.status as ValueStatus;
  let calculatedRag: string = rag.calculatedRag;
  if (status !== "ok") calculatedRag = status;
  else if (
    (calculatedRag === "green" || calculatedRag === "amber" || calculatedRag === "red") &&
    rag.deviation === "unknown"
  )
    calculatedRag = "unknown";
  return {
    value: status === "ok" || status === "stale" ? stored : null,
    valueStatus: status,
    rag: calculatedRag,
    target: v.targetValue,
  };
}

// ------------------------------------------------------------------------------------------------ the reconciliation

/**
 * The reconciliation rows of a restatement, computed now (read-only). Rows are ordered by period start, scope kind,
 * scope id and basis, so the preview and the retained rows compare one to one.
 */
export async function computeReconciliation(db: DbOrTx, input: ReconciliationInput): Promise<ReconciliationRowData[]> {
  const kpi = await loadKpiWithVersion(db, input.kpiDefinitionId, input.kpiVersionId);
  if (!kpi) return [];
  const ctx: Ctx = {
    db,
    organizationId: input.organizationId,
    businessDate: await businessDate(db, input.organizationId),
    periods: await loadPeriods(db, input.organizationId),
  };
  const values = await acceptedValues(db, kpi.id);
  const actualScopes = await db
    .selectFrom("kpi_actual")
    .select(["scope_kind", "scope_id", "reporting_period_id"])
    .where("kpi_definition_id", "=", kpi.id)
    .where("accepted_value_no", "is not", null)
    .execute();
  const bases: ValueBasis[] = kpi.version.valueNature === "milestone" ? ["period"] : ["period", "cumulative"];
  const selected = input.periods
    .map((p) => ctx.periods.find((x) => x.id === p.id))
    .filter((p): p is Period => p !== undefined)
    .sort((a, b) => (a.periodStart < b.periodStart ? -1 : a.periodStart > b.periodStart ? 1 : 0));
  const rows: ReconciliationRowData[] = [];
  for (const period of selected) {
    const evaluated = await latestEvaluations(db, kpi.id, period.id);
    // The slots: every evaluated slot, plus every slot with an accepted actual (and its roll-up when narrower).
    const slots = new Map<string, { scopeKind: string; scopeId: string; basis: ValueBasis }>();
    for (const e of evaluated.values())
      slots.set(`${e.scope_kind}:${e.scope_id}:${e.value_basis}`, {
        scopeKind: e.scope_kind,
        scopeId: e.scope_id,
        basis: e.value_basis as ValueBasis,
      });
    const reported = actualScopes.filter((a) => a.reporting_period_id === period.id);
    for (const a of reported)
      for (const basis of bases)
        slots.set(`${a.scope_kind}:${a.scope_id}:${basis}`, { scopeKind: a.scope_kind, scopeId: a.scope_id, basis });
    if (
      reported.length > 0 &&
      kpi.version.entryScopeKind !== "transformation" &&
      kpi.version.calculationMethod !== "formula"
    ) {
      const transformation = await db
        .selectFrom("kpi_definition")
        .select("transformation_id")
        .where("id", "=", kpi.id)
        .executeTakeFirstOrThrow();
      for (const basis of bases)
        slots.set(`transformation:${transformation.transformation_id}:${basis}`, {
          scopeKind: "transformation",
          scopeId: transformation.transformation_id,
          basis,
        });
    }
    const ordered = [...slots.values()].sort((x, y) => {
      const a = `${x.scopeKind}:${x.scopeId}:${x.basis === "period" ? 0 : 1}`;
      const b = `${y.scopeKind}:${y.scopeId}:${y.basis === "period" ? 0 : 1}`;
      return a < b ? -1 : a > b ? 1 : 0;
    });
    for (const slot of ordered) {
      const e = evaluated.get(`${slot.scopeKind}:${slot.scopeId}:${slot.basis}`);
      const before: ReconciliationRowData["before"] = e
        ? {
            evaluationId: e.id,
            kpiVersionId: e.kpi_version_id,
            value: e.value_status === "ok" || e.value_status === "stale" ? e.value : null,
            valueStatus: e.value_status as ValueStatus,
            rag: e.calculated_rag,
            target: e.final_target,
          }
        : { evaluationId: null, kpiVersionId: null, value: null, valueStatus: "none", rag: "none", target: null };
      const after = await evaluateAfter(ctx, kpi, slot.scopeKind, slot.scopeId, period, slot.basis, values);
      const difference =
        before.valueStatus === "ok" && after.valueStatus === "ok" && before.value !== null && after.value !== null
          ? new D(after.value).minus(before.value).toFixed()
          : null;
      rows.push({
        reportingPeriodId: period.id,
        periodLabel: period.label,
        scopeKind: slot.scopeKind as ScopeKind,
        scopeId: slot.scopeId,
        valueBasis: slot.basis,
        before,
        after,
        difference,
        currency: kpi.currency,
        unitKind: kpi.unitKind,
      });
    }
  }
  return rows;
}

/** Only an `ok` side shows its number: Unknown, Stale, Not computable and none never show one (ADR-0047 §9). */
const shown = (status: string, value: string | null): string | null =>
  status === "ok" && value !== null ? canonicalDecimal(value) : null;
/** Every number in its canonical form ("100.000000" -> "100"), so a retained row equals its preview. */
const canon = (value: string | null): string | null => (value === null ? null : canonicalDecimal(value));

/** The API form of a reconciliation row (preview or retained). */
export function toReconciliationRow(r: ReconciliationRowData): KpiRestatementReconciliationRow {
  return {
    reportingPeriodId: r.reportingPeriodId,
    periodLabel: r.periodLabel,
    scopeKind: r.scopeKind,
    scopeId: r.scopeId,
    valueBasis: r.valueBasis,
    before: {
      evaluationId: r.before.evaluationId,
      kpiVersionId: r.before.kpiVersionId,
      value: shown(r.before.valueStatus, r.before.value),
      valueStatus: r.before.valueStatus,
      rag: r.before.rag as KpiRestatementReconciliationRow["before"]["rag"],
      target: canon(r.before.target),
    },
    after: {
      value: shown(r.after.valueStatus, r.after.value),
      valueStatus: r.after.valueStatus,
      rag: r.after.rag as KpiRestatementReconciliationRow["after"]["rag"],
      target: canon(r.after.target),
    },
    difference: canon(r.difference),
    currency: r.currency,
    unitKind: r.unitKind,
  };
}

/** A stored kpi_restatement_reconciliation row as row data (numeric columns come back as strings). */
export function fromStoredRow(
  r: {
    reporting_period_id: string;
    scope_kind: string;
    scope_id: string;
    value_basis: string;
    before_evaluation_id: string | null;
    before_kpi_version_id: string | null;
    before_value: string | null;
    before_value_status: string;
    before_rag: string;
    before_target: string | null;
    after_value: string | null;
    after_value_status: string;
    after_rag: string;
    after_target: string | null;
    difference: string | null;
    currency: string | null;
  },
  periodLabel: string,
  unitKind: UnitKind,
): ReconciliationRowData {
  return {
    reportingPeriodId: r.reporting_period_id,
    periodLabel,
    scopeKind: r.scope_kind as ScopeKind,
    scopeId: r.scope_id,
    valueBasis: r.value_basis as ValueBasis,
    before: {
      evaluationId: r.before_evaluation_id,
      kpiVersionId: r.before_kpi_version_id,
      value: r.before_value,
      valueStatus: r.before_value_status as ValueStatus | "none",
      rag: r.before_rag,
      target: r.before_target,
    },
    after: {
      value: r.after_value,
      valueStatus: r.after_value_status as ValueStatus,
      rag: r.after_rag,
      target: r.after_target,
    },
    difference: r.difference,
    currency: trim(r.currency),
    unitKind,
  };
}
