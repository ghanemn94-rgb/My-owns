// Read-only KPI facts for the slice J dashboards (T-DG4-KBE-G; ADR-0037 §1 item 2, §3, §4; p4-work-split §J+K JK.4).
// Every status comes from the slice A status service (`statusOf`, ADR-0028 §6), so an override in force and the
// read-time Stale re-check apply exactly as on the KPI panel: nothing is re-derived here and nothing is written.
//
// Period rule (ADR-0037 §4): without a period filter, a KPI's current reporting period (the panel's default); with a
// period filter, that period when the KPI has its frequency, else the KPI's latest open or closed period of its own
// frequency that ends inside the window, else Unknown (`dashboard.kpi.no_period_in_window`), never 0 or green.
import type { DbOrTx } from "@mth/db";
import type { KpiStatus } from "@mth/shared/schemas";
import { statusOf } from "./kpi-status.ts";
import type { KpiDefinitionRow } from "./repository.ts";

/** The period filter of a dashboard read. */
export interface DashboardPeriodFilter {
  readonly id: string;
  readonly frequency: string;
  readonly start: string;
  readonly end: string;
}

/** One KPI status as the dashboards read it (structurally the `KpiStatusFact` of reporting/dashboards/areas.ts). */
export interface KpiDashboardStatus {
  readonly kpiDefinitionId: string;
  readonly kpiName: string;
  readonly ownerUserId: string | null;
  readonly displayedRag: string;
  readonly calculatedRag: string;
  readonly overridden: boolean;
  readonly actual: string | null;
  readonly actualStatus: string;
  readonly actualReason: string | null;
  readonly unit: string | null;
  readonly currency: string | null;
  readonly reportingPeriodId: string | null;
  readonly periodLabel: string | null;
  readonly evaluationId: string | null;
  readonly calculationRunId: string | null;
}

export interface KpiStatusRequest {
  readonly kpiDefinitionId: string;
  readonly scopeKind: string;
  readonly scopeId: string;
}

/** The key of one KPI status request ("kpi:scopeKind:scopeId"). */
const keyOf = (r: KpiStatusRequest) => `${r.kpiDefinitionId}:${r.scopeKind}:${r.scopeId}`;

function fromPanel(def: KpiDefinitionRow, s: KpiStatus): KpiDashboardStatus {
  return {
    kpiDefinitionId: def.id,
    kpiName: def.name,
    ownerUserId: def.owner_user_id,
    displayedRag: s.displayedRag,
    calculatedRag: s.calculatedRag,
    overridden: s.override !== null,
    actual: s.actual,
    actualStatus: s.actualStatus,
    actualReason: s.actualReason,
    unit: def.unit_label ?? def.unit_kind,
    currency: s.currency,
    reportingPeriodId: s.reportingPeriodId,
    periodLabel: s.periodLabel,
    evaluationId: s.evaluationId,
    calculationRunId: s.calculationRunId,
  };
}

function noPeriod(def: KpiDefinitionRow): KpiDashboardStatus {
  return {
    kpiDefinitionId: def.id,
    kpiName: def.name,
    ownerUserId: def.owner_user_id,
    displayedRag: "unknown",
    calculatedRag: "unknown",
    overridden: false,
    actual: null,
    actualStatus: "unknown",
    actualReason: "dashboard.kpi.no_period_in_window",
    unit: def.unit_label ?? def.unit_kind,
    currency: def.currency === null ? null : def.currency.trim(),
    reportingPeriodId: null,
    periodLabel: null,
    evaluationId: null,
    calculationRunId: null,
  };
}

/**
 * The slice A status of each requested KPI and scope for the dashboard's period (keyed "kpi:scopeKind:scopeId").
 * Read-only; `now` and `businessDate` are the read's clock.
 */
export async function loadKpiDashboardStatuses(
  db: DbOrTx,
  organizationId: string,
  requests: readonly KpiStatusRequest[],
  period: DashboardPeriodFilter | null,
  now: Date,
  businessDate: string,
): Promise<Map<string, KpiDashboardStatus>> {
  const out = new Map<string, KpiDashboardStatus>();
  const ids = [...new Set(requests.map((r) => r.kpiDefinitionId))];
  if (ids.length === 0) return out;
  const defs = new Map(
    (await db.selectFrom("kpi_definition").selectAll().where("id", "in", ids).execute()).map((d) => [d.id, d]),
  );
  // The period of each other frequency inside the window (one query per frequency, never per KPI).
  const periodByFrequency = new Map<string, string | null>();
  if (period !== null) {
    periodByFrequency.set(period.frequency, period.id);
    for (const frequency of new Set([...defs.values()].map((d) => d.frequency))) {
      if (periodByFrequency.has(frequency)) continue;
      const p = await db
        .selectFrom("reporting_period")
        .select("id")
        .where("organization_id", "=", organizationId)
        .where("frequency", "=", frequency)
        .where("status", "in", ["open", "closed"])
        .where("period_end", ">=", period.start)
        .where("period_end", "<=", period.end)
        .orderBy("period_end", "desc")
        .limit(1)
        .executeTakeFirst();
      periodByFrequency.set(frequency, p?.id ?? null);
    }
  }
  for (const r of requests) {
    const key = keyOf(r);
    if (out.has(key)) continue;
    const def = defs.get(r.kpiDefinitionId);
    if (!def) continue;
    if (period !== null && periodByFrequency.get(def.frequency) === null) {
      out.set(key, noPeriod(def));
      continue;
    }
    const periodId = period === null ? null : periodByFrequency.get(def.frequency)!;
    const panel = await statusOf(
      db,
      def,
      organizationId,
      { kind: r.scopeKind, id: r.scopeId },
      periodId,
      now,
      businessDate,
    );
    out.set(key, fromPanel(def, panel));
  }
  return out;
}

/** One active outcome KPI (T02 row) of an active outcome. */
export interface OutcomeKpiRowFact {
  readonly outcomeKpiId: string;
  readonly outcomeId: string;
  readonly kpiDefinitionId: string;
  readonly ownerUserId: string | null;
}

/** One active outcome of the scope with its active outcome KPIs. */
export interface OutcomeRowFact {
  readonly outcomeId: string;
  readonly transformationId: string;
  readonly statement: string;
  readonly ownerUserId: string | null;
  readonly kpis: readonly OutcomeKpiRowFact[];
}

/** The active outcomes of the transformations with their active outcome KPIs (ordered; read-only). */
export async function loadOutcomeRows(db: DbOrTx, transformationIds: readonly string[]): Promise<OutcomeRowFact[]> {
  if (transformationIds.length === 0) return [];
  const outcomes = await db
    .selectFrom("outcome")
    .select(["id", "transformation_id", "statement", "owner_user_id"])
    .where("transformation_id", "in", [...transformationIds])
    .where("status", "=", "active")
    .orderBy("transformation_id")
    .orderBy("top_rank")
    .orderBy("id")
    .execute();
  if (outcomes.length === 0) return [];
  const kpis = await db
    .selectFrom("outcome_kpi")
    .select(["id", "outcome_id", "kpi_definition_id", "owner_user_id"])
    .where(
      "outcome_id",
      "in",
      outcomes.map((o) => o.id),
    )
    .where("status", "=", "active")
    .orderBy("ordinal")
    .orderBy("id")
    .execute();
  return outcomes.map((o) => ({
    outcomeId: o.id,
    transformationId: o.transformation_id,
    statement: o.statement,
    ownerUserId: o.owner_user_id,
    kpis: kpis
      .filter((k) => k.outcome_id === o.id)
      .map((k) => ({
        outcomeKpiId: k.id,
        outcomeId: k.outcome_id,
        kpiDefinitionId: k.kpi_definition_id,
        ownerUserId: k.owner_user_id,
      })),
  }));
}

/** The evaluation behind a status, its accepted actual and that actual's evidence (the `outcomes.kpi_status` drill). */
export async function loadKpiStatusLineage(db: DbOrTx, evaluationId: string) {
  const evaluation = await db
    .selectFrom("kpi_evaluation")
    .select([
      "id",
      "calculation_run_id",
      "reporting_period_id",
      "kpi_definition_id",
      "scope_kind",
      "scope_id",
      "rounding",
    ])
    .where("id", "=", evaluationId)
    .executeTakeFirst();
  if (!evaluation) return null;
  const actual = await db
    .selectFrom("kpi_actual")
    .select(["id", "period_label", "period_start", "period_end", "accepted_value_no", "status"])
    .where("kpi_definition_id", "=", evaluation.kpi_definition_id)
    .where("scope_kind", "=", evaluation.scope_kind)
    .where("scope_id", "=", evaluation.scope_id)
    .where("reporting_period_id", "=", evaluation.reporting_period_id)
    .where("accepted_value_no", "is not", null)
    .executeTakeFirst();
  const evidence = actual
    ? await db
        .selectFrom("kpi_actual_evidence as l")
        .innerJoin("evidence as e", "e.id", "l.evidence_id")
        .select(["e.id", "e.title", "e.review_status"])
        .where("l.kpi_actual_id", "=", actual.id)
        .where("l.value_no", "=", actual.accepted_value_no!)
        .orderBy("e.id")
        .execute()
    : [];
  return { evaluation, actual: actual ?? null, evidence };
}
