// The KPI status panel (ADR-0028 §6; REQ-S07-006, REQ-S07-008, REQ-S07-009 display; T-DG4-KBE-C):
//   GET /transformations/{t}/kpi-definitions/{k}/status       one KPI panel (scope default: the transformation; period
//                                                            default: the KPI's current reporting period)
//   GET /transformations/{t}/kpi-status                       the panel of every KPI of the transformation, by scope
//
// The panel is the slot's latest evaluation (highest run seq, basis period) with the two READ-TIME rules applied, never
// stored: staleness re-checked against today's business date (a stored ok value can display as Stale), and an override
// in force while status = 'active' and now() < expires_at (displayedRag; calculatedRag is always returned, so after
// expiry the calculated RAG displays). The seven elements are always present: actual, expected-to-date, final target,
// variance, trend, freshness and the explanation naming the threshold used; a missing one is null with a reason, never
// 0. Unknown, Stale and Not computable are statuses with reasons, never 0 or green. Keys are i18n keys (en and ar are
// rendered by the web). A KPI without an active version is Unknown (kpi.no_active_version); a KPI with no evaluation for
// the period is Unknown (kpi.no_accepted_actual, or kpi.calculation_pending while an accepted value awaits its run).
import { sql, type DbOrTx } from "@mth/db";
import { resolveThresholds, withReadTimeStaleness, type KpiReasonCode, type KpiValueStatus } from "@mth/shared/calc";
import { canonicalDecimal, KPI_SCOPE_KINDS, type KpiStatus } from "@mth/shared/schemas";
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
import { activeVersionOf, businessDateOf } from "./actuals.ts";
import { latestPeriodEvaluation } from "./rag-overrides.ts";
import type { KpiDefinitionRow } from "./repository.ts";

const T_BASE = "/api/v1/transformations/:transformationId";
const ONE = `${T_BASE}/kpi-definitions/:kpiDefinitionId/status`;
const ALL = `${T_BASE}/kpi-status`;

const oneQuery = z.strictObject({
  scopeKind: z.enum(KPI_SCOPE_KINDS).optional(),
  scopeId: z.uuid().optional(),
  reportingPeriodId: z.uuid().optional(),
});
const allQuery = z.strictObject({
  cursor: cursorSchema,
  limit: limitSchema,
  scopeKind: z.enum(KPI_SCOPE_KINDS).optional(),
  scopeId: z.uuid().optional(),
});

const dec = (v: string | null): string | null => (v === null ? null : canonicalDecimal(v));
const obj = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const int = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) ? v : null);

/** The KPI's current reporting period: the latest open or closed period of its frequency (ADR-0028 §6). */
async function currentPeriod(db: DbOrTx, organizationId: string, frequency: string) {
  return db
    .selectFrom("reporting_period")
    .select(["id", "period_label"])
    .where("organization_id", "=", organizationId)
    .where("frequency", "=", frequency)
    .where("status", "in", ["open", "closed"])
    .orderBy("period_end", "desc")
    .limit(1)
    .executeTakeFirst();
}

/** The panel of one KPI, scope and period (`now` and `businessDate` are the read's clock). */
export async function statusOf(
  db: DbOrTx,
  def: KpiDefinitionRow,
  organizationId: string,
  scope: { kind: string; id: string },
  periodId: string | null,
  now: Date,
  businessDate: string,
): Promise<KpiStatus> {
  const version = await activeVersionOf(db, def.id);
  const period =
    periodId === null
      ? await currentPeriod(db, organizationId, def.frequency)
      : await db
          .selectFrom("reporting_period")
          .select(["id", "period_label"])
          .where("organization_id", "=", organizationId)
          .where("id", "=", periodId)
          .executeTakeFirst();
  if (periodId !== null && !period) throw problems.notFound();
  const evaluation =
    version && period
      ? await latestPeriodEvaluation(db, {
          kpiDefinitionId: def.id,
          scopeKind: scope.kind,
          scopeId: scope.id,
          reportingPeriodId: period.id,
        })
      : undefined;
  const configured = await db
    .selectFrom("kpi_rag_threshold")
    .select(["id", "version_no", "tolerance_mode", "amber_threshold", "red_threshold"])
    .where("kpi_definition_id", "=", def.id)
    .where("status", "=", "active")
    .executeTakeFirst();
  const staleAfterDays = version?.dq_stale_after_days ?? null;
  const base = {
    kpiDefinitionId: def.id,
    kpiName: def.name,
    kpiVersionId: version?.id ?? null,
    unitKind: def.unit_kind as KpiStatus["unitKind"],
    currency: def.currency === null ? null : def.currency.trim(),
    scopeKind: scope.kind as KpiStatus["scopeKind"],
    scopeId: scope.id,
    reportingPeriodId: period?.id ?? null,
    periodLabel: period?.period_label ?? null,
    finalTarget: dec(version?.target_value ?? null),
    finalTargetDate: version?.target_date ?? null,
    changeLabel: (def.unit_kind === "percentage" ? "pp" : "unit") as KpiStatus["changeLabel"],
  };
  // The override in force for the slot (read-time rule).
  const override = period
    ? await db
        .selectFrom("rag_override")
        .select(["id", "override_rag", "reason", "evidence_id", "expires_at", "created_by"])
        .where("kpi_definition_id", "=", def.id)
        .where("scope_kind", "=", scope.kind)
        .where("scope_id", "=", scope.id)
        .where("reporting_period_id", "=", period.id)
        .where("status", "=", "active")
        .where("expires_at", ">", now)
        .orderBy("created_at", "desc")
        .executeTakeFirst()
    : undefined;
  const inForce = override
    ? {
        id: override.id,
        rag: override.override_rag as "green" | "amber" | "red",
        reason: override.reason,
        evidenceId: override.evidence_id,
        expiresAt: iso(override.expires_at),
        createdBy: override.created_by,
      }
    : null;

  if (!evaluation) {
    // No evaluation: Unknown with its reason, never 0 or green. The explanation still names the threshold in force.
    let reason: KpiReasonCode | "kpi.calculation_pending" = "kpi.no_active_version";
    if (version && period) {
      const accepted = await db
        .selectFrom("kpi_actual")
        .select("id")
        .where("kpi_definition_id", "=", def.id)
        .where("scope_kind", "=", scope.kind)
        .where("scope_id", "=", scope.id)
        .where("reporting_period_id", "=", period.id)
        .where("accepted_value_no", "is not", null)
        .executeTakeFirst();
      reason = accepted ? "kpi.calculation_pending" : "kpi.no_accepted_actual";
    } else if (version) reason = "kpi.no_accepted_actual";
    const t = resolveThresholds(
      configured
        ? {
            id: configured.id,
            versionNo: configured.version_no,
            toleranceMode: configured.tolerance_mode as "relative" | "absolute",
            amberThreshold: configured.amber_threshold,
            redThreshold: configured.red_threshold,
          }
        : null,
    );
    return {
      ...base,
      actual: null,
      actualStatus: "unknown",
      actualReason: reason,
      expectedToDate: null,
      expectedReason: null,
      variance: null,
      varianceRatio: null,
      trend: "unknown",
      freshness: { status: "unknown", dataAsOf: null, staleAfterDays },
      explanation: {
        key: version ? "kpi.rag.no_actual" : "kpi.rag.not_computable",
        params: { reason },
        thresholdSource: t.source,
        thresholdVersion: t.versionNo,
        toleranceMode: t.toleranceMode,
        amberThreshold: dec(t.amberThreshold),
        redThreshold: dec(t.redThreshold),
        trajectoryVersion: null,
      },
      calculatedRag: "unknown",
      displayedRag: inForce ? inForce.rag : "unknown",
      override: inForce,
      evaluationId: null,
      calculationRunId: null,
    };
  }
  // Read-time staleness (ADR-0028 §6): a stored ok value can display as Stale.
  const read = withReadTimeStaleness(
    {
      value: evaluation.value,
      valueStatus: evaluation.value_status as KpiValueStatus,
      valueReason: evaluation.value_reason as KpiReasonCode | null,
      calculatedRag: evaluation.calculated_rag as KpiStatus["calculatedRag"],
      explanationKey: evaluation.explanation_key as never,
      dataAsOf: evaluation.data_as_of,
    },
    staleAfterDays ?? 45,
    businessDate,
  );
  const params = obj(evaluation.explanation_params);
  const expectedReason: string | null =
    evaluation.expected_value !== null
      ? null
      : evaluation.explanation_key === "kpi.rag.before_trajectory"
        ? "kpi.before_trajectory"
        : evaluation.target_trajectory_id === null &&
            (version?.measure_type === "higher_is_better" || version?.measure_type === "lower_is_better")
          ? "kpi.no_approved_trajectory"
          : null;
  return {
    ...base,
    actual: dec(read.value),
    actualStatus: read.valueStatus,
    actualReason: read.valueReason,
    expectedToDate: dec(evaluation.expected_value),
    expectedReason,
    variance: dec(evaluation.variance),
    varianceRatio: dec(evaluation.variance_ratio),
    trend: evaluation.trend as KpiStatus["trend"],
    freshness: {
      status: read.freshness.status,
      dataAsOf: read.freshness.dataAsOf,
      staleAfterDays: read.freshness.staleAfterDays,
    },
    explanation: {
      key: read.explanationKey,
      params,
      thresholdSource: evaluation.threshold_source as KpiStatus["explanation"]["thresholdSource"],
      thresholdVersion: int(params["thresholdVersion"]),
      toleranceMode: str(params["toleranceMode"]) as KpiStatus["explanation"]["toleranceMode"],
      amberThreshold: dec(str(params["amberThreshold"])),
      redThreshold: dec(str(params["redThreshold"])),
      trajectoryVersion: int(params["trajectoryVersion"]),
    },
    calculatedRag: read.calculatedRag,
    displayedRag: inForce ? inForce.rag : read.calculatedRag,
    override: inForce,
    evaluationId: evaluation.id,
    calculationRunId: evaluation.calculation_run_id,
  };
}

async function dbNow(db: DbOrTx): Promise<Date> {
  const r = await sql<{ now: Date }>`SELECT now() AS now`.execute(db);
  return r.rows[0]!.now;
}

export function registerKpiStatusRoutes(app: FastifyInstance, deps: ModuleDeps): string[] {
  const { db } = deps;
  const read = { access: { permission: "transformation.read" as const } };

  app.get(ONE, { config: read }, async (request) => {
    const { transformationId, kpiDefinitionId } = parse(
      z.strictObject({ transformationId: z.uuid(), kpiDefinitionId: z.uuid() }),
      request.params,
      "params",
    );
    const query = parseQuery(oneQuery, request.query);
    const target = await requireTransformationRead(db, principalOf(request), transformationId);
    const def = (await db
      .selectFrom("kpi_definition")
      .selectAll()
      .where("transformation_id", "=", transformationId)
      .where("id", "=", kpiDefinitionId)
      .executeTakeFirst()) as KpiDefinitionRow | undefined;
    if (!def) throw problems.notFound();
    const scope = { kind: query.scopeKind ?? "transformation", id: query.scopeId ?? transformationId };
    return statusOf(
      db,
      def,
      target.organizationId,
      scope,
      query.reportingPeriodId ?? null,
      await dbNow(db),
      await businessDateOf(db, target.organizationId),
    );
  });

  app.get(ALL, { config: read }, async (request) => {
    const { transformationId } = parse(z.strictObject({ transformationId: z.uuid() }), request.params, "params");
    const query = parseQuery(allQuery, request.query);
    const target = await requireTransformationRead(db, principalOf(request), transformationId);
    const scope = { kind: query.scopeKind ?? "transformation", id: query.scopeId ?? transformationId };
    const hash = filterHash({ list: "kpi-status", transformationId, scopeKind: scope.kind, scopeId: scope.id });
    const after = decodeCursor(query.cursor, hash, 2);
    let q = db
      .selectFrom("kpi_definition")
      .selectAll()
      .select(sql<string>`to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`.as("sort_key"))
      .where("transformation_id", "=", transformationId)
      .where("status", "<>", "archived");
    if (after)
      q = q.where(sql<boolean>`(created_at, id) > (${String(after[0])}::timestamptz, ${String(after[1])}::uuid)`);
    const rows = await q
      .orderBy("created_at")
      .orderBy("id")
      .limit(query.limit + 1)
      .execute();
    const page = paginate(rows, query.limit, (r) => [r.sort_key, r.id], hash);
    const now = await dbNow(db);
    const businessDate = await businessDateOf(db, target.organizationId);
    const items: KpiStatus[] = [];
    for (const { sort_key: _k, ...def } of page.items)
      items.push(await statusOf(db, def as KpiDefinitionRow, target.organizationId, scope, null, now, businessDate));
    return { items, nextCursor: page.nextCursor };
  });

  return [`GET ${ONE}`, `GET ${ALL}`];
}
