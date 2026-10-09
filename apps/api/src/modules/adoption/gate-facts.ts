// G5 "Adoption" facts (T-DG4-BE-K; ADR-0035 §2, ADR-0033 §3, §6; REQ-PB-015): every ACTIVE adoption metric link of the
// transformation (any target) with the status of its current value in the organization's current reporting period,
// computed exactly as the indicator report does (indicators.ts; read-only, no file of this module is edited):
//  - a KPI-fed measure: slice A's latest evaluation of the slot (highest run seq, basis period) with the read-time
//    staleness rule (ADR-0028 §6); no evaluation = Unknown (kpi.no_active_version / kpi.no_accepted_actual /
//    kpi.calculation_pending);
//  - a record-fed measure: training completion or observed proficiency from @mth/shared/calc over the target's
//    stakeholder groups (the target group, else every active group); no records = Unknown, never 0.
// No reporting period open or closed yet = every indicator Unknown (adoption.no_reporting_period). Wired into
// workflows' GateFactsProvider by server.ts; workflows never imports adoption.
import { sql, type DbOrTx } from "@mth/db";
import {
  observedProficiency,
  trainingCompletion,
  withReadTimeStaleness,
  type KpiReasonCode,
  type KpiValueStatus,
  type ProficiencyObservationInput,
  type TrainingRecordInput,
} from "@mth/shared/calc";

/** The KPI freshness window when the KPI has no active version (indicators.ts uses the same default). */
const DEFAULT_STALE_AFTER_DAYS = 45;

export interface AdoptionIndicatorGateFact {
  readonly metricLinkId: string;
  readonly templateKey: string;
  readonly kpiDefinitionId: string | null;
  readonly valueStatus: string;
  readonly valueReason: string | null;
}

export async function loadAdoptionGateFacts(
  db: DbOrTx,
  transformationId: string,
): Promise<{ transformationId: string; indicators: AdoptionIndicatorGateFact[] }> {
  const ctx = await sql<{ organization_id: string; tz: string }>`
    SELECT t.organization_id, coalesce(
      (SELECT c.timezone FROM business_calendar c
        WHERE c.organization_id = t.organization_id AND c.is_default AND c.status = 'active' LIMIT 1),
      o.default_timezone) AS tz
      FROM transformation t JOIN organization o ON o.id = t.organization_id
     WHERE t.id = ${transformationId}::uuid`.execute(db);
  const { organization_id: organizationId, tz } = ctx.rows[0]!;
  const businessDate = (await sql<{ d: string }>`SELECT p4_business_date(now(), ${tz})::text AS d`.execute(db)).rows[0]!
    .d;
  const links = await db
    .selectFrom("adoption_metric_link as l")
    .innerJoin("adoption_indicator_template as t", "t.key", "l.template_key")
    .selectAll("l")
    .select(["t.value_source", "t.indicator_ordinal", "t.measure_ordinal"])
    .where("l.transformation_id", "=", transformationId)
    .where("l.status", "=", "active")
    .orderBy("t.indicator_ordinal")
    .orderBy("t.measure_ordinal")
    .orderBy("l.id")
    .execute();
  if (links.length === 0) return { transformationId, indicators: [] };
  // The organization's latest open or closed period that has started (the shortest on a tie): the report's default.
  const period = await db
    .selectFrom("reporting_period")
    .select(["id", sql<string>`period_start::text`.as("start"), sql<string>`period_end::text`.as("end")])
    .where("organization_id", "=", organizationId)
    .where("status", "in", ["open", "closed"])
    .where("period_start", "<=", businessDate)
    .orderBy("period_end", "desc")
    .orderBy("length_days", "asc")
    .orderBy("id")
    .limit(1)
    .executeTakeFirst();
  const base = (l: (typeof links)[number]) => ({
    metricLinkId: l.id,
    templateKey: l.template_key,
    kpiDefinitionId: l.kpi_definition_id,
  });
  if (!period)
    return {
      transformationId,
      indicators: links.map((l) => ({
        ...base(l),
        valueStatus: "unknown",
        valueReason: "adoption.no_reporting_period",
      })),
    };
  const activeGroups = (
    await db
      .selectFrom("stakeholder_group")
      .select("id")
      .where("transformation_id", "=", transformationId)
      .where("status", "=", "active")
      .orderBy("id")
      .execute()
  ).map((g) => g.id);

  const indicators: AdoptionIndicatorGateFact[] = [];
  for (const l of links) {
    if (l.value_source === "kpi_actuals" && l.kpi_definition_id !== null) {
      const kpiId = l.kpi_definition_id;
      const scope =
        l.target_kind === "initiative" && l.initiative_id !== null
          ? { kind: "initiative", id: l.initiative_id }
          : { kind: "transformation", id: transformationId };
      const version = await db
        .selectFrom("kpi_version")
        .select(["id", "dq_stale_after_days"])
        .where("kpi_definition_id", "=", kpiId)
        .where("status", "=", "active")
        .executeTakeFirst();
      const evaluation = await db
        .selectFrom("kpi_evaluation as e")
        .innerJoin("calculation_run as r", "r.id", "e.calculation_run_id")
        .selectAll("e")
        .where("e.kpi_definition_id", "=", kpiId)
        .where("e.scope_kind", "=", scope.kind)
        .where("e.scope_id", "=", scope.id)
        .where("e.reporting_period_id", "=", period.id)
        .where("e.value_basis", "=", "period")
        .orderBy("r.seq", "desc")
        .limit(1)
        .executeTakeFirst();
      if (!evaluation) {
        let reason = "kpi.no_active_version";
        if (version) {
          const accepted = await db
            .selectFrom("kpi_actual")
            .select("id")
            .where("kpi_definition_id", "=", kpiId)
            .where("scope_kind", "=", scope.kind)
            .where("scope_id", "=", scope.id)
            .where("reporting_period_id", "=", period.id)
            .where("accepted_value_no", "is not", null)
            .executeTakeFirst();
          reason = accepted ? "kpi.calculation_pending" : "kpi.no_accepted_actual";
        }
        indicators.push({ ...base(l), valueStatus: "unknown", valueReason: reason });
        continue;
      }
      const read = withReadTimeStaleness(
        {
          value: evaluation.value,
          valueStatus: evaluation.value_status as KpiValueStatus,
          valueReason: evaluation.value_reason as KpiReasonCode | null,
          calculatedRag: evaluation.calculated_rag as never,
          explanationKey: evaluation.explanation_key as never,
          dataAsOf: evaluation.data_as_of,
        },
        version?.dq_stale_after_days ?? DEFAULT_STALE_AFTER_DAYS,
        businessDate,
      );
      indicators.push({ ...base(l), valueStatus: read.valueStatus, valueReason: read.valueReason });
      continue;
    }
    const groups =
      l.target_kind === "stakeholder_group" && l.stakeholder_group_id ? [l.stakeholder_group_id] : activeGroups;
    const range = { start: period.start, end: period.end };
    const m =
      l.value_source === "training_records"
        ? trainingCompletion(await trainingInputs(db, transformationId, groups, tz), range)
        : observedProficiency(await observationInputs(db, transformationId, groups, range), range);
    indicators.push({ ...base(l), valueStatus: m.valueStatus, valueReason: m.valueReason });
  }
  return { transformationId, indicators };
}

async function trainingInputs(
  db: DbOrTx,
  transformationId: string,
  groupIds: readonly string[],
  tz: string,
): Promise<TrainingRecordInput[][]> {
  if (groupIds.length === 0) return [];
  const rows = await db
    .selectFrom("training_record")
    .select([
      "stakeholder_group_id",
      "status",
      sql<string | null>`completed_on::text`.as("completed_on"),
      sql<string>`p4_business_date(created_at, ${tz})::text`.as("created_on"),
    ])
    .where("transformation_id", "=", transformationId)
    .where("stakeholder_group_id", "in", groupIds)
    .execute();
  return groupIds.map((g) =>
    rows
      .filter((r) => r.stakeholder_group_id === g)
      .map((r) => ({
        status: r.status as TrainingRecordInput["status"],
        completedOn: r.completed_on,
        createdOn: r.created_on,
      })),
  );
}

async function observationInputs(
  db: DbOrTx,
  transformationId: string,
  groupIds: readonly string[],
  period: { start: string; end: string },
): Promise<ProficiencyObservationInput[][]> {
  if (groupIds.length === 0) return [];
  const rows = await db
    .selectFrom("assessment_record")
    .select([
      "stakeholder_group_id",
      "status",
      "subject_user_id",
      "subject_label",
      sql<string>`observed_on::text`.as("observed_on"),
      "proficiency_result",
      sql<string>`to_char(created_at AT TIME ZONE 'UTC', 'YYYYMMDDHH24MISSUS') || id::text`.as("ord"),
    ])
    .where("transformation_id", "=", transformationId)
    .where("stakeholder_group_id", "in", groupIds)
    .where("kind", "=", "proficiency_observation")
    .where("observed_on", ">=", period.start)
    .where("observed_on", "<=", period.end)
    .execute();
  return groupIds.map((g) =>
    rows
      .filter((r) => r.stakeholder_group_id === g)
      .map((r) => ({
        status: r.status as ProficiencyObservationInput["status"],
        subjectUserId: r.subject_user_id,
        subjectLabel: r.subject_label,
        observedOn: r.observed_on,
        result: r.proficiency_result as ProficiencyObservationInput["result"],
        order: r.ord,
      })),
  );
}
