// kpi data access: the only writer of kpi_definition, baseline, outcome_kpi and value_pool (migration 0014).
// Rows -> API bodies (camelCase, decimal strings, ISO instants). `numeric` arrives from pg as a string and is passed
// through unchanged: it is never converted to a JavaScript number.
import type { BaselineTable, DbOrTx, KpiDefinitionTable, OutcomeKpiTable, ValuePoolRow } from "@mth/db";
import type { Baseline, KpiDefinition, OutcomeKpi, TrajectoryPoint, ValuePool } from "@mth/shared/schemas";
import type { Selectable } from "kysely";
import { iso, isoOrNull } from "../platform/index.ts";

// @mth/db exports only ValuePoolRow of these four (schema.ts is frozen); the others are derived the same way.
export type KpiDefinitionRow = Selectable<KpiDefinitionTable>;
export type BaselineRow = Selectable<BaselineTable>;
export type OutcomeKpiRow = Selectable<OutcomeKpiTable>;
export type { ValuePoolRow };

export const KPI_DEFINITION_AUDIT_FIELDS = [
  "name",
  "description",
  "business_purpose",
  "unit_kind",
  "unit_label",
  "currency",
  "polarity",
  "frequency",
  "is_leading",
  "data_source",
  "owner_user_id",
  "steward_user_id",
  "status",
] as const satisfies readonly (keyof KpiDefinitionRow)[];

export const BASELINE_AUDIT_FIELDS = [
  "metric",
  "kpi_definition_id",
  "value",
  "unit",
  "currency",
  "source",
  "baseline_date",
  "scope",
  "owner_user_id",
  "validation_status",
  "validated_by",
  "validation_note",
  "validated_record_version",
  "status",
] as const satisfies readonly (keyof BaselineRow)[];

export const OUTCOME_KPI_AUDIT_FIELDS = [
  "outcome_id",
  "kpi_definition_id",
  "baseline_id",
  "baseline_value",
  "target_value",
  "target_date",
  "owner_user_id",
  "leading_indicator_text",
  "leading_kpi_definition_id",
  "ordinal",
  "trajectory_points",
  "trajectory_status",
  "trajectory_approved_by",
  "trajectory_approved_version",
  "status",
] as const satisfies readonly (keyof OutcomeKpiRow)[];

export const VALUE_POOL_AUDIT_FIELDS = [
  "name",
  "driver",
  "workstream_code",
  "quantification_status",
  "upside_amount",
  "downside_amount",
  "currency",
  "unquantified_reason",
  "materiality",
  "confidence",
  "owner_user_id",
  "validation_status",
  "validated_by",
  "validation_note",
  "validated_record_version",
  "status",
] as const satisfies readonly (keyof ValuePoolRow)[];

export function toKpiDefinition(r: KpiDefinitionRow): KpiDefinition {
  return {
    id: r.id,
    organizationId: r.organization_id,
    transformationId: r.transformation_id,
    name: r.name,
    description: r.description,
    businessPurpose: r.business_purpose,
    unitKind: r.unit_kind as KpiDefinition["unitKind"],
    unitLabel: r.unit_label,
    currency: r.currency,
    polarity: r.polarity as KpiDefinition["polarity"],
    frequency: r.frequency as KpiDefinition["frequency"],
    isLeading: r.is_leading,
    dataSource: r.data_source,
    ownerUserId: r.owner_user_id,
    stewardUserId: r.steward_user_id,
    status: r.status as KpiDefinition["status"],
    archivedAt: isoOrNull(r.archived_at),
    archivedBy: r.archived_by,
    archiveReason: r.archive_reason,
    version: r.version,
    createdAt: iso(r.created_at),
    createdBy: r.created_by,
    updatedAt: iso(r.updated_at),
    updatedBy: r.updated_by,
  };
}

export function toBaseline(r: BaselineRow): Baseline {
  return {
    id: r.id,
    organizationId: r.organization_id,
    transformationId: r.transformation_id,
    metric: r.metric,
    kpiDefinitionId: r.kpi_definition_id,
    value: r.value,
    unit: r.unit,
    currency: r.currency,
    source: r.source,
    baselineDate: r.baseline_date,
    scope: r.scope as Baseline["scope"],
    ownerUserId: r.owner_user_id,
    validationStatus: r.validation_status as Baseline["validationStatus"],
    validatedBy: r.validated_by,
    validatedAt: isoOrNull(r.validated_at),
    validationNote: r.validation_note,
    validatedRecordVersion: r.validated_record_version,
    status: r.status as Baseline["status"],
    archivedAt: isoOrNull(r.archived_at),
    archivedBy: r.archived_by,
    archiveReason: r.archive_reason,
    version: r.version,
    createdAt: iso(r.created_at),
    createdBy: r.created_by,
    updatedAt: iso(r.updated_at),
    updatedBy: r.updated_by,
  };
}

/** jsonb trajectory points as stored (validated on the way in: date strings and decimal strings). */
export function trajectoryPointsOf(value: unknown): TrajectoryPoint[] {
  if (!Array.isArray(value)) return [];
  return value.map((p: { date?: unknown; value?: unknown }) => ({ date: String(p.date), value: String(p.value) }));
}

export function toOutcomeKpi(r: OutcomeKpiRow): OutcomeKpi {
  return {
    id: r.id,
    organizationId: r.organization_id,
    transformationId: r.transformation_id,
    outcomeId: r.outcome_id,
    kpiDefinitionId: r.kpi_definition_id,
    baselineId: r.baseline_id,
    baselineValue: r.baseline_value,
    targetValue: r.target_value,
    targetDate: r.target_date,
    ownerUserId: r.owner_user_id,
    leadingIndicatorText: r.leading_indicator_text,
    leadingKpiDefinitionId: r.leading_kpi_definition_id,
    ordinal: r.ordinal,
    trajectoryPoints: trajectoryPointsOf(r.trajectory_points),
    trajectoryStatus: r.trajectory_status as OutcomeKpi["trajectoryStatus"],
    trajectoryApprovedBy: r.trajectory_approved_by,
    trajectoryApprovedAt: isoOrNull(r.trajectory_approved_at),
    trajectoryApprovedVersion: r.trajectory_approved_version,
    status: r.status as OutcomeKpi["status"],
    archivedAt: isoOrNull(r.archived_at),
    archivedBy: r.archived_by,
    archiveReason: r.archive_reason,
    version: r.version,
    createdAt: iso(r.created_at),
    createdBy: r.created_by,
    updatedAt: iso(r.updated_at),
    updatedBy: r.updated_by,
  };
}

export function toValuePool(r: ValuePoolRow): ValuePool {
  return {
    id: r.id,
    organizationId: r.organization_id,
    transformationId: r.transformation_id,
    name: r.name,
    driver: r.driver,
    workstreamCode: r.workstream_code,
    quantificationStatus: r.quantification_status as ValuePool["quantificationStatus"],
    upsideAmount: r.upside_amount,
    downsideAmount: r.downside_amount,
    currency: r.currency,
    unquantifiedReason: r.unquantified_reason,
    materiality: r.materiality as ValuePool["materiality"],
    confidence: r.confidence as ValuePool["confidence"],
    ownerUserId: r.owner_user_id,
    validationStatus: r.validation_status as ValuePool["validationStatus"],
    validatedBy: r.validated_by,
    validatedAt: isoOrNull(r.validated_at),
    validationNote: r.validation_note,
    validatedRecordVersion: r.validated_record_version,
    status: r.status as ValuePool["status"],
    archivedAt: isoOrNull(r.archived_at),
    archivedBy: r.archived_by,
    archiveReason: r.archive_reason,
    version: r.version,
    createdAt: iso(r.created_at),
    createdBy: r.created_by,
    updatedAt: iso(r.updated_at),
    updatedBy: r.updated_by,
  };
}

// ------------------------------------------------------------------------------------------------ finders

export function findKpiDefinition(
  db: DbOrTx,
  transformationId: string,
  id: string,
  forUpdate = false,
): Promise<KpiDefinitionRow | undefined> {
  let q = db
    .selectFrom("kpi_definition")
    .selectAll()
    .where("id", "=", id)
    .where("transformation_id", "=", transformationId);
  if (forUpdate) q = q.forUpdate();
  return q.executeTakeFirst();
}

export function findBaseline(
  db: DbOrTx,
  transformationId: string,
  id: string,
  forUpdate = false,
): Promise<BaselineRow | undefined> {
  let q = db.selectFrom("baseline").selectAll().where("id", "=", id).where("transformation_id", "=", transformationId);
  if (forUpdate) q = q.forUpdate();
  return q.executeTakeFirst();
}

export function findOutcomeKpi(
  db: DbOrTx,
  transformationId: string,
  id: string,
  forUpdate = false,
): Promise<OutcomeKpiRow | undefined> {
  let q = db
    .selectFrom("outcome_kpi")
    .selectAll()
    .where("id", "=", id)
    .where("transformation_id", "=", transformationId);
  if (forUpdate) q = q.forUpdate();
  return q.executeTakeFirst();
}

export function findValuePool(
  db: DbOrTx,
  transformationId: string,
  id: string,
  forUpdate = false,
): Promise<ValuePoolRow | undefined> {
  let q = db
    .selectFrom("value_pool")
    .selectAll()
    .where("id", "=", id)
    .where("transformation_id", "=", transformationId);
  if (forUpdate) q = q.forUpdate();
  return q.executeTakeFirst();
}

/** Status of a referenced row in the same transformation (null when it does not exist there). */
export async function referenceStatus(
  db: DbOrTx,
  table: "kpi_definition" | "baseline" | "outcome",
  transformationId: string,
  id: string,
): Promise<{ status: string; baselineDate: string | null } | null> {
  if (table === "baseline") {
    const r = await db
      .selectFrom("baseline")
      .select(["status", "baseline_date"])
      .where("id", "=", id)
      .where("transformation_id", "=", transformationId)
      .executeTakeFirst();
    return r ? { status: r.status, baselineDate: r.baseline_date } : null;
  }
  const r =
    table === "kpi_definition"
      ? await db
          .selectFrom("kpi_definition")
          .select("status")
          .where("id", "=", id)
          .where("transformation_id", "=", transformationId)
          .executeTakeFirst()
      : await db
          .selectFrom("outcome")
          .select("status")
          .where("id", "=", id)
          .where("transformation_id", "=", transformationId)
          .executeTakeFirst();
  return r ? { status: r.status, baselineDate: null } : null;
}

/** Named users (owner, steward) must exist, be active and belong to the transformation's organization. */
export async function activeOrgUsersExist(
  db: DbOrTx,
  organizationId: string,
  ids: readonly (string | null | undefined)[],
): Promise<boolean> {
  const unique = [...new Set(ids.filter((v): v is string => typeof v === "string"))];
  if (unique.length === 0) return true;
  const rows = await db
    .selectFrom("app_user")
    .select("id")
    .where("id", "in", unique)
    .where("status", "=", "active")
    .where("organization_id", "=", organizationId)
    .execute();
  return rows.length === unique.length;
}

export async function workstreamExists(db: DbOrTx, code: string): Promise<boolean> {
  const r = await db.selectFrom("diagnostic_workstream").select("code").where("code", "=", code).executeTakeFirst();
  return r !== undefined;
}

/** Active rows that still reference a KPI definition (archiving it would orphan them). */
export async function kpiDefinitionInUse(db: DbOrTx, transformationId: string, id: string): Promise<boolean> {
  const okpi = await db
    .selectFrom("outcome_kpi")
    .select("id")
    .where("transformation_id", "=", transformationId)
    .where("status", "<>", "archived")
    .where((eb) => eb.or([eb("kpi_definition_id", "=", id), eb("leading_kpi_definition_id", "=", id)]))
    .limit(1)
    .executeTakeFirst();
  if (okpi) return true;
  const base = await db
    .selectFrom("baseline")
    .select("id")
    .where("transformation_id", "=", transformationId)
    .where("status", "<>", "archived")
    .where("kpi_definition_id", "=", id)
    .limit(1)
    .executeTakeFirst();
  return base !== undefined;
}

/**
 * The outcome_kpi row's audit events that carry a diff, newest first: the source of who authored each part of the
 * current trajectory (rules.ts trajectoryAuthors; F-DG2-141). audit_event is append-only and written in the same
 * transaction as every outcome_kpi mutation, and the caller holds the row lock, so the trail matches the row.
 */
export async function outcomeKpiChangeEvents(
  db: DbOrTx,
  id: string,
): Promise<{ actorUserId: string | null; onBehalfOfUserId: string | null; changes: unknown }[]> {
  const rows = await db
    .selectFrom("audit_event")
    .select(["actor_user_id", "on_behalf_of_user_id", "changes"])
    .where("record_type", "=", "outcome_kpi")
    .where("record_id", "=", id)
    .where("changes", "is not", null)
    .orderBy("seq", "desc")
    .execute();
  return rows.map((r) => ({
    actorUserId: r.actor_user_id,
    onBehalfOfUserId: r.on_behalf_of_user_id,
    changes: r.changes,
  }));
}
