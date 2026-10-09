// Calculation runs and their KPI evaluations, read-only (ADR-0027 §7; ADR-0028 §6; REQ-S07-013, REQ-S16-014;
// T-DG4-KBE-C):
//   GET /transformations/{t}/calculation-runs                 newest first (seq), optional kpiDefinitionId
//   GET /transformations/{t}/calculation-runs/{r}             one run with its evaluations (lineage)
//
// Runs are written only by the worker's kpi.recalculate consumer (one per trigger, no audit event); they have no create
// operation. Values are decimal strings; Unknown and Not computable are NULL with a reason, never 0.
import { sql, type CalculationRunRow, type DbOrTx, type KpiEvaluationRow } from "@mth/db";
import { canonicalDecimal, type CalculationRun, type KpiEvaluation } from "@mth/shared/schemas";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { principalOf, requireTransformationRead } from "../access/index.ts";
import {
  cursorSchema,
  decodeCursor,
  filterHash,
  iso,
  limitSchema,
  paginate,
  parse,
  parseQuery,
  problems,
  type ModuleDeps,
} from "../platform/index.ts";

const T_BASE = "/api/v1/transformations/:transformationId";
const RUNS = `${T_BASE}/calculation-runs`;
const RUN_ITEM = `${RUNS}/:calculationRunId`;

const listQuery = z.strictObject({ cursor: cursorSchema, limit: limitSchema, kpiDefinitionId: z.uuid().optional() });
const runParams = z.strictObject({ transformationId: z.uuid(), calculationRunId: z.uuid() });

const dec = (v: string | null): string | null => (v === null ? null : canonicalDecimal(v));
const obj = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

export function toKpiEvaluation(e: KpiEvaluationRow): KpiEvaluation {
  return {
    id: e.id,
    kpiDefinitionId: e.kpi_definition_id,
    kpiVersionId: e.kpi_version_id,
    scopeKind: e.scope_kind as KpiEvaluation["scopeKind"],
    scopeId: e.scope_id,
    reportingPeriodId: e.reporting_period_id,
    periodLabel: e.period_label,
    valueBasis: e.value_basis as KpiEvaluation["valueBasis"],
    value: dec(e.value),
    valueStatus: e.value_status as KpiEvaluation["valueStatus"],
    valueReason: e.value_reason,
    valueSource: e.value_source as KpiEvaluation["valueSource"],
    currency: e.currency === null ? null : e.currency.trim(),
    inputs: obj(e.inputs),
    rounding: e.rounding === null ? null : obj(e.rounding),
    expectedValue: dec(e.expected_value),
    finalTarget: dec(e.final_target),
    variance: dec(e.variance),
    varianceRatio: dec(e.variance_ratio),
    comparisonFlag: e.comparison_flag as KpiEvaluation["comparisonFlag"],
    trend: e.trend as KpiEvaluation["trend"],
    dataAsOf: e.data_as_of,
    calculatedRag: e.calculated_rag as KpiEvaluation["calculatedRag"],
    deviation: e.deviation as KpiEvaluation["deviation"],
    thresholdId: e.threshold_id,
    thresholdSource: e.threshold_source as KpiEvaluation["thresholdSource"],
    targetTrajectoryId: e.target_trajectory_id,
    explanationKey: e.explanation_key,
    explanationParams: obj(e.explanation_params),
    evaluatedAt: iso(e.evaluated_at),
  };
}

export function toCalculationRun(r: CalculationRunRow, evaluations: readonly KpiEvaluationRow[] = []): CalculationRun {
  return {
    id: r.id,
    seq: String(r.seq),
    transformationId: r.transformation_id,
    triggerKind: r.trigger_kind as CalculationRun["triggerKind"],
    triggerRecordType: r.trigger_record_type as CalculationRun["triggerRecordType"],
    triggerRecordId: r.trigger_record_id,
    triggerSlot: r.trigger_slot,
    status: r.status as CalculationRun["status"],
    errorCode: r.error_code,
    evaluationCount: r.evaluation_count,
    findingCount: r.finding_count,
    formulaEngineVersion: r.formula_engine_version,
    kpiRulesVersion: r.kpi_rules_version,
    startedAt: iso(r.started_at),
    completedAt: iso(r.completed_at),
    evaluations: evaluations.map(toKpiEvaluation),
  };
}

export async function findRun(db: DbOrTx, transformationId: string, id: string) {
  return db
    .selectFrom("calculation_run")
    .selectAll()
    .where("transformation_id", "=", transformationId)
    .where("id", "=", id)
    .executeTakeFirst();
}

export function registerCalculationRunRoutes(app: FastifyInstance, deps: ModuleDeps): string[] {
  const { db } = deps;
  const read = { access: { permission: "transformation.read" as const } };

  app.get(RUNS, { config: read }, async (request) => {
    const { transformationId } = parse(z.strictObject({ transformationId: z.uuid() }), request.params, "params");
    const query = parseQuery(listQuery, request.query);
    await requireTransformationRead(db, principalOf(request), transformationId);
    const hash = filterHash({
      list: "calculation-runs",
      transformationId,
      kpiDefinitionId: query.kpiDefinitionId ?? null,
    });
    const after = decodeCursor(query.cursor, hash, 1);
    let q = db.selectFrom("calculation_run as r").selectAll("r").where("r.transformation_id", "=", transformationId);
    if (query.kpiDefinitionId) {
      const kpiId = query.kpiDefinitionId;
      q = q.where((eb) =>
        eb.exists(
          eb
            .selectFrom("kpi_evaluation as e")
            .select("e.id")
            .whereRef("e.calculation_run_id", "=", "r.id")
            .where("e.kpi_definition_id", "=", kpiId),
        ),
      );
    }
    if (after) q = q.where(sql<boolean>`r.seq < ${String(after[0])}::bigint`);
    const rows = await q
      .orderBy("r.seq", "desc")
      .limit(query.limit + 1)
      .execute();
    const page = paginate(rows, query.limit, (r) => [String(r.seq)], hash);
    return { items: page.items.map((r) => toCalculationRun(r)), nextCursor: page.nextCursor };
  });

  app.get(RUN_ITEM, { config: read }, async (request) => {
    const { transformationId, calculationRunId } = parse(runParams, request.params, "params");
    await requireTransformationRead(db, principalOf(request), transformationId);
    const run = await findRun(db, transformationId, calculationRunId);
    if (!run) throw problems.notFound();
    const evaluations = await db
      .selectFrom("kpi_evaluation")
      .selectAll()
      .where("calculation_run_id", "=", run.id)
      .orderBy("kpi_definition_id")
      .orderBy("scope_kind")
      .orderBy("scope_id")
      .orderBy("value_basis", "desc")
      .execute();
    return toCalculationRun(run, evaluations);
  });

  return [`GET ${RUNS}`, `GET ${RUN_ITEM}`];
}
