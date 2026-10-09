// Adoption indicators (P4 slice F; ADR-0033 §2, §3, §6, §9, §10, §12; T-DG4-KBE-F; REQ-PB-071, REQ-PB-072, REQ-S11-002
// (the count half), REQ-S16-020 AdoptionMetricLink):
//   GET  /adoption-indicator-templates                               the seven leading indicators of B0109-B0115,
//                                                                    verbatim, as KPI templates (any signed-in user)
//   GET  /transformations/{t}/adoption-metric-links                  indicator measures attached to targets
//   POST /transformations/{t}/adoption-metric-links                  attach one; a KPI-fed measure names a KPI of the
//                                                                    transformation or creates one from the template
//                                                                    (createKpi) in the same transaction (adoption.edit)
//   POST /transformations/{t}/adoption-metric-links/{l}/remove       remove; final (If-Match; adoption.edit)
//   GET  /transformations/{t}/adoption-indicators                    the measures of a target for a reporting period
//
// Values (ADR-0033 §12): a KPI-fed measure is slice A's latest evaluation of the KPI for the period (highest run seq,
// basis period) with the read-time staleness rule, unchanged: its value, Unknown / Stale / Not computable with the
// reason, its calculated RAG and the trajectory's expected-to-date value. Training completion and observed
// proficiency are computed from training and assessment records by @mth/shared/calc (decimal.js; fractions rounded
// half-up to 6 digits), with numerator and denominator; without records or observations they are Unknown with their
// reason and value null, never 0, and proficiency never derives from training (REQ-PB-072). A target other than a
// stakeholder group aggregates over the transformation's active groups by summing numerators and denominators.
//
// createKpi: the KPI row is written by slice A's create service (kpi/index.ts createKpiDefinitionRow; T-DG4-KBE-R1), the
// one createKpiDefinition uses (same columns, same `kpi_definition.create` audit event and fields, the same 409 for a
// taken name), from the template: name = the measure's English name, is_leading = true, the template's unit and
// polarity, the owner from the request.
//
// Every mutation: the read gate first (ADM-only callers and outsiders get 404), adoption.edit re-checked at commit time
// (AUD 403), validation, If-Match on the removal (428/409; creates are version 1), one audit event per written row in
// the same transaction, no remote I/O inside it (S-4). Nothing here is a G1-G6 business approval or touches DG0-DG7.
import { diffFields, sql, type AdoptionMetricLinkTable, type DbOrTx, type KpiDefinitionTable, type Tx } from "@mth/db";
import {
  observedProficiency,
  trainingCompletion,
  withReadTimeStaleness,
  type KpiReasonCode,
  type KpiValueStatus,
  type MeasurePeriod,
  type ProficiencyObservationInput,
  type RecordMeasure,
  type TrainingRecordInput,
} from "@mth/shared/calc";
import {
  adoptionMetricLinkCreate,
  adoptionTargetKind,
  canonicalDecimal,
  type AdoptionIndicatorReport,
  type AdoptionIndicatorTemplate,
  type AdoptionMeasureValue,
  type AdoptionMetricLink,
} from "@mth/shared/schemas";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Selectable } from "kysely";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { principalOf, requireTransformationRead } from "../access/index.ts";
import { record } from "../audit/index.ts";
import { defaultCalendarTimezone } from "../organization/index.ts";
import {
  cursorSchema,
  decodeCursor,
  filterHash,
  iso,
  isoOrNull,
  limitSchema,
  paginate,
  parse,
  parseBody,
  parseQuery,
  problems,
  requireIfMatch,
  sendVersioned,
  type ModuleDeps,
} from "../platform/index.ts";
import { createKpiDefinitionRow } from "../kpi/index.ts";
import { assertActiveUsers } from "../transformations/index.ts";
import {
  adoptionRule,
  ADOPTION_EDIT,
  GROUP_ARCHIVED,
  JSON_BODY,
  openAdoptionWrite,
  parseTransformationParam,
  T_BASE,
} from "./register.ts";

export type AdoptionMetricLinkRow = Selectable<AdoptionMetricLinkTable>;
type KpiDefinitionRow = Selectable<KpiDefinitionTable>;

export const ADOPTION_INDICATOR_TEMPLATES = "/api/v1/adoption-indicator-templates";
export const ADOPTION_METRIC_LINKS = `${T_BASE}/adoption-metric-links`;
export const ADOPTION_METRIC_LINK_REMOVE = `${ADOPTION_METRIC_LINKS}/:adoptionMetricLinkId/remove`;
export const ADOPTION_INDICATORS = `${T_BASE}/adoption-indicators`;

export const ADOPTION_METRIC_LINK_AUDIT_FIELDS = [
  "template_key",
  "kpi_definition_id",
  "target_kind",
  "outcome_id",
  "initiative_id",
  "stakeholder_group_id",
  "status",
  "removed_at",
  "removed_by",
] as const satisfies readonly (keyof AdoptionMetricLinkRow & string)[];

/** The default staleness window of slice A when a KPI has no active version (kpi-status.ts; ADR-0028 §6). */
const DEFAULT_STALE_AFTER_DAYS = 45;

// ------------------------------------------------------------------------------------------------ problems (§10)

const KPI_REQUIRED = () =>
  adoptionRule(
    "adoption_metric_link.kpi_required",
    "This indicator is measured by a KPI: name a KPI or create one from the template.",
    "/kpiDefinitionId",
  );
const KPI_NOT_APPLICABLE = () =>
  adoptionRule(
    "adoption_metric_link.kpi_not_applicable",
    "This measure is computed from training or assessment records and takes no KPI.",
    "/kpiDefinitionId",
  );
const KPI_MISMATCH = () =>
  adoptionRule(
    "adoption_metric_link.kpi_mismatch",
    "The KPI's unit and polarity must match the indicator template.",
    "/kpiDefinitionId",
  );
const LINK_EXISTS = () =>
  problems.duplicate("adoption_metric_link.exists", "This indicator is already attached to this target.");
const REFERENCE = (pointer: string) =>
  adoptionRule("validation.reference", "No such record in this transformation.", pointer);
/** Slice A's refusal for a taken KPI name (kpi-definitions.ts), unchanged. */
const KPI_NAME_TAKEN = () =>
  problems.duplicate("duplicate.name", "A KPI with this name already exists in the transformation.");

// ------------------------------------------------------------------------------------------------ presentation

type TemplateRow = {
  key: string;
  indicator_key: string;
  indicator_ordinal: number;
  measure_ordinal: number;
  source_indicator_en: string;
  indicator_ar: string;
  measure_en: string;
  measure_ar: string;
  ar_provisional: boolean;
  unit_kind: string;
  polarity: string;
  value_nature: string;
  aggregation_rule: string;
  value_source: string;
  source_ref: string;
};

function toTemplate(r: TemplateRow): AdoptionIndicatorTemplate {
  return {
    key: r.key,
    indicatorKey: r.indicator_key,
    indicatorOrdinal: Number(r.indicator_ordinal),
    measureOrdinal: Number(r.measure_ordinal),
    sourceIndicatorEn: r.source_indicator_en,
    indicatorAr: r.indicator_ar,
    measureEn: r.measure_en,
    measureAr: r.measure_ar,
    arProvisional: r.ar_provisional,
    unitKind: r.unit_kind as AdoptionIndicatorTemplate["unitKind"],
    polarity: r.polarity as AdoptionIndicatorTemplate["polarity"],
    valueNature: r.value_nature as AdoptionIndicatorTemplate["valueNature"],
    aggregationRule: r.aggregation_rule as AdoptionIndicatorTemplate["aggregationRule"],
    valueSource: r.value_source as AdoptionIndicatorTemplate["valueSource"],
    sourceRef: r.source_ref,
  };
}

const targetIdOf = (r: AdoptionMetricLinkRow): string =>
  r.outcome_id ?? r.initiative_id ?? r.stakeholder_group_id ?? r.transformation_id;

export function toAdoptionMetricLink(r: AdoptionMetricLinkRow): AdoptionMetricLink {
  return {
    id: r.id,
    transformationId: r.transformation_id,
    templateKey: r.template_key,
    kpiDefinitionId: r.kpi_definition_id,
    targetKind: r.target_kind as AdoptionMetricLink["targetKind"],
    targetId: targetIdOf(r),
    status: r.status as AdoptionMetricLink["status"],
    removedAt: isoOrNull(r.removed_at),
    removedBy: r.removed_by,
    version: r.version,
    createdAt: iso(r.created_at),
    createdBy: r.created_by,
    updatedAt: iso(r.updated_at),
    updatedBy: r.updated_by,
  };
}

function templatesQuery(db: DbOrTx) {
  return db
    .selectFrom("adoption_indicator_template")
    .selectAll()
    .orderBy("indicator_ordinal")
    .orderBy("measure_ordinal");
}

// ------------------------------------------------------------------------------------------------ targets

type TargetKind = z.infer<typeof adoptionTargetKind>;

/** The link columns of a target (CHECK adoption_metric_link_target). */
function targetColumns(kind: TargetKind, id: string) {
  return {
    outcome_id: kind === "outcome" ? id : null,
    initiative_id: kind === "initiative" ? id : null,
    stakeholder_group_id: kind === "stakeholder_group" ? id : null,
  };
}

/**
 * Resolves and locks (FOR SHARE) the target of a write: an outcome or initiative of the transformation, an ACTIVE
 * stakeholder group of it (archived → 422 stakeholder_group.archived), or the transformation itself. A target outside
 * the transformation → 422 validation.reference at /targetId.
 */
async function lockTarget(tx: Tx, transformationId: string, kind: TargetKind, targetId: string | undefined) {
  if (kind === "transformation") {
    if (targetId !== undefined && targetId !== transformationId) throw REFERENCE("/targetId");
    return transformationId;
  }
  const id = targetId!;
  if (kind === "stakeholder_group") {
    const g = await tx
      .selectFrom("stakeholder_group")
      .select(["id", "status"])
      .where("id", "=", id)
      .where("transformation_id", "=", transformationId)
      .forShare()
      .executeTakeFirst();
    if (!g) throw REFERENCE("/targetId");
    if (g.status !== "active") throw GROUP_ARCHIVED();
    return id;
  }
  const table = kind === "outcome" ? "outcome" : "initiative";
  const row = await tx
    .selectFrom(table)
    .select("id")
    .where("id", "=", id)
    .where("transformation_id", "=", transformationId)
    .forShare()
    .executeTakeFirst();
  if (!row) throw REFERENCE("/targetId");
  return id;
}

/** A read target of the transformation, or 404 (non-disclosure). */
async function readTarget(db: DbOrTx, transformationId: string, kind: TargetKind, targetId: string | undefined) {
  if (kind === "transformation") {
    if (targetId !== undefined && targetId !== transformationId) throw problems.notFound();
    return transformationId;
  }
  if (targetId === undefined)
    throw problems.validation([{ pointer: "/targetId", code: "validation.required", message: "Required." }]);
  const table = kind === "outcome" ? "outcome" : kind === "initiative" ? "initiative" : "stakeholder_group";
  const row = await db
    .selectFrom(table)
    .select("id")
    .where("id", "=", targetId)
    .where("transformation_id", "=", transformationId)
    .executeTakeFirst();
  if (!row) throw problems.notFound();
  return targetId;
}

// ------------------------------------------------------------------------------------------------ writes

async function createKpiFromTemplate(
  tx: Tx,
  ctx: Awaited<ReturnType<typeof openAdoptionWrite>>,
  transformationId: string,
  template: TemplateRow,
  ownerUserId: string,
): Promise<KpiDefinitionRow> {
  await assertActiveUsers(tx, ctx.organizationId, [{ id: ownerUserId, pointer: "/kpiOwnerUserId" }]);
  const taken = await tx
    .selectFrom("kpi_definition")
    .select("id")
    .where("transformation_id", "=", transformationId)
    .where(sql<string>`lower(name)`, "=", template.measure_en.toLowerCase())
    .where("status", "<>", "archived")
    .executeTakeFirst();
  if (taken) throw KPI_NAME_TAKEN();
  return createKpiDefinitionRow(tx, ctx.audit, {
    organizationId: ctx.organizationId,
    transformationId,
    actorUserId: ctx.userId,
    name: template.measure_en,
    unitKind: template.unit_kind,
    polarity: template.polarity,
    isLeading: true,
    ownerUserId,
  });
}

async function createLink(tx: Tx, request: FastifyRequest): Promise<AdoptionMetricLinkRow> {
  const transformationId = parseTransformationParam(request.params);
  const ctx = await openAdoptionWrite(tx, request, transformationId);
  const body = parseBody(adoptionMetricLinkCreate, request.body);
  const template = await tx
    .selectFrom("adoption_indicator_template")
    .selectAll()
    .where("key", "=", body.templateKey)
    .executeTakeFirst();
  if (!template) throw REFERENCE("/templateKey");
  const kpiFed = template.value_source === "kpi_actuals";
  const namesKpi = body.kpiDefinitionId !== undefined || body.createKpi === true;
  if (kpiFed && !namesKpi) throw KPI_REQUIRED();
  if (!kpiFed && namesKpi) throw KPI_NOT_APPLICABLE();

  const targetId = await lockTarget(tx, transformationId, body.targetKind, body.targetId);
  const columns = targetColumns(body.targetKind, targetId);
  const exists = async () =>
    tx
      .selectFrom("adoption_metric_link")
      .select("id")
      .where("transformation_id", "=", transformationId)
      .where("template_key", "=", template.key)
      .where("target_kind", "=", body.targetKind)
      .where(sql<string>`coalesce(outcome_id, initiative_id, stakeholder_group_id, transformation_id)`, "=", targetId)
      .where("status", "=", "active")
      .executeTakeFirst();
  if (await exists()) throw LINK_EXISTS();

  let kpiDefinitionId: string | null = null;
  if (body.kpiDefinitionId !== undefined) {
    const kpi = await tx
      .selectFrom("kpi_definition")
      .select(["id", "unit_kind", "polarity", "status"])
      .where("id", "=", body.kpiDefinitionId)
      .where("transformation_id", "=", transformationId)
      .forShare()
      .executeTakeFirst();
    if (!kpi || kpi.status === "archived") throw REFERENCE("/kpiDefinitionId");
    if (kpi.unit_kind !== template.unit_kind || kpi.polarity !== template.polarity) throw KPI_MISMATCH();
    kpiDefinitionId = kpi.id;
  } else if (body.createKpi === true) {
    kpiDefinitionId = (await createKpiFromTemplate(tx, ctx, transformationId, template, body.kpiOwnerUserId!)).id;
  }

  const id = uuidv7();
  const row = await tx
    .insertInto("adoption_metric_link")
    .values({
      id,
      organization_id: ctx.organizationId,
      transformation_id: transformationId,
      template_key: template.key,
      kpi_definition_id: kpiDefinitionId,
      target_kind: body.targetKind,
      ...columns,
      created_by: ctx.userId,
      updated_by: ctx.userId,
    })
    .returningAll()
    .executeTakeFirstOrThrow()
    .catch((e: { code?: string; constraint?: string }) => {
      // A concurrent attachment of the same measure to the same target (the partial unique index is the backstop).
      if (e.code === "23505" && e.constraint === "adoption_metric_link_active_key") throw LINK_EXISTS();
      throw e;
    });
  await record(tx, ctx.audit, {
    action: "adoption_metric_link.create",
    recordType: "adoption_metric_link",
    recordId: id,
    organizationId: ctx.organizationId,
    transformationId,
    newVersion: row.version,
    changes: diffFields({} as AdoptionMetricLinkRow, row, [...ADOPTION_METRIC_LINK_AUDIT_FIELDS]),
  });
  return row;
}

const linkParams = z.strictObject({ transformationId: z.uuid(), adoptionMetricLinkId: z.uuid() });

async function removeLink(tx: Tx, request: FastifyRequest): Promise<AdoptionMetricLinkRow> {
  const { transformationId, adoptionMetricLinkId } = parse(linkParams, request.params, "params");
  const ctx = await openAdoptionWrite(tx, request, transformationId);
  const current = await tx
    .selectFrom("adoption_metric_link")
    .selectAll()
    .where("id", "=", adoptionMetricLinkId)
    .where("transformation_id", "=", transformationId)
    .forUpdate()
    .executeTakeFirst();
  if (!current) throw problems.notFound();
  const expected = requireIfMatch(request);
  if (current.version !== expected) throw problems.versionConflict(current.version);
  if (current.status === "removed") throw problems.invalidTransition("This metric link is already removed.");
  const updated = await tx
    .updateTable("adoption_metric_link")
    .set({
      status: "removed",
      removed_at: sql<Date>`now()`,
      removed_by: ctx.userId,
      version: sql<number>`version + 1`,
      updated_at: sql<Date>`now()`,
      updated_by: ctx.userId,
    })
    .where("id", "=", current.id)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: "adoption_metric_link.remove",
    recordType: "adoption_metric_link",
    recordId: current.id,
    organizationId: ctx.organizationId,
    transformationId,
    priorVersion: current.version,
    newVersion: updated.version,
    changes: diffFields(current, updated, [...ADOPTION_METRIC_LINK_AUDIT_FIELDS]),
  });
  return updated;
}

// ------------------------------------------------------------------------------------------------ indicator values

/** The organization's business timezone: the default calendar's, else the organization's (ADR-0025 §2). */
async function businessTimezone(db: DbOrTx, organizationId: string): Promise<string> {
  return (
    (await defaultCalendarTimezone(db, organizationId)) ??
    (
      await db
        .selectFrom("organization")
        .select("default_timezone")
        .where("id", "=", organizationId)
        .executeTakeFirstOrThrow()
    ).default_timezone
  );
}

const dec = (v: string | null): string | null => (v === null ? null : canonicalDecimal(v));

/** A KPI-fed measure: slice A's latest evaluation of the slot, with the read-time staleness rule (ADR-0028 §6). */
async function kpiMeasure(
  db: DbOrTx,
  link: AdoptionMetricLinkRow,
  periodId: string,
  businessDate: string,
): Promise<AdoptionMeasureValue> {
  const kpiId = link.kpi_definition_id!;
  const scope =
    link.target_kind === "initiative"
      ? { kind: "initiative", id: link.initiative_id! }
      : { kind: "transformation", id: link.transformation_id };
  const base = { templateKey: link.template_key, metricLinkId: link.id, kpiDefinitionId: kpiId };
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
    .where("e.reporting_period_id", "=", periodId)
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
        .where("reporting_period_id", "=", periodId)
        .where("accepted_value_no", "is not", null)
        .executeTakeFirst();
      reason = accepted ? "kpi.calculation_pending" : "kpi.no_accepted_actual";
    }
    return {
      ...base,
      value: null,
      valueStatus: "unknown",
      valueReason: reason,
      calculatedRag: "unknown",
      trajectoryValue: null,
      numerator: null,
      denominator: null,
    };
  }
  const read = withReadTimeStaleness(
    {
      value: evaluation.value,
      valueStatus: evaluation.value_status as KpiValueStatus,
      valueReason: evaluation.value_reason as KpiReasonCode | null,
      calculatedRag: evaluation.calculated_rag as AdoptionMeasureValue["calculatedRag"] & string,
      explanationKey: evaluation.explanation_key as never,
      dataAsOf: evaluation.data_as_of,
    },
    version?.dq_stale_after_days ?? DEFAULT_STALE_AFTER_DAYS,
    businessDate,
  );
  return {
    ...base,
    value: dec(read.value),
    valueStatus: read.valueStatus,
    valueReason: read.valueReason,
    calculatedRag: read.calculatedRag,
    trajectoryValue: dec(evaluation.expected_value),
    numerator: null,
    denominator: null,
  };
}

/** The record-fed inputs of the groups of a target, one array per group (ADR-0033 §6). */
async function recordInputs(
  db: DbOrTx,
  transformationId: string,
  groupIds: readonly string[],
  period: MeasurePeriod,
  tz: string,
): Promise<{ training: TrainingRecordInput[][]; observations: ProficiencyObservationInput[][] }> {
  if (groupIds.length === 0) return { training: [], observations: [] };
  const training = await db
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
  const observations = await db
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
  const byGroup = <T>(rows: readonly { stakeholder_group_id: string }[], map: (r: never) => T): T[][] =>
    groupIds.map((g) => rows.filter((r) => r.stakeholder_group_id === g).map((r) => map(r as never)));
  return {
    training: byGroup(training, (r: (typeof training)[number]) => ({
      status: r.status as TrainingRecordInput["status"],
      completedOn: r.completed_on,
      createdOn: r.created_on,
    })),
    observations: byGroup(observations, (r: (typeof observations)[number]) => ({
      status: r.status as ProficiencyObservationInput["status"],
      subjectUserId: r.subject_user_id,
      subjectLabel: r.subject_label,
      observedOn: r.observed_on,
      result: r.proficiency_result as ProficiencyObservationInput["result"],
      order: r.ord,
    })),
  };
}

const recordValue = (
  templateKey: string,
  link: AdoptionMetricLinkRow | undefined,
  m: RecordMeasure,
): AdoptionMeasureValue => ({
  templateKey,
  metricLinkId: link?.id ?? null,
  kpiDefinitionId: null,
  value: m.value,
  valueStatus: m.valueStatus,
  valueReason: m.valueReason,
  // Record-fed measures have no trajectory or RAG in DG4 (ADR-0033 §12, §13 item 1).
  calculatedRag: null,
  trajectoryValue: null,
  numerator: m.numerator,
  denominator: m.denominator,
});

const indicatorsQuery = z.strictObject({
  targetKind: adoptionTargetKind,
  targetId: z.uuid().optional(),
  reportingPeriodId: z.uuid().optional(),
});

async function indicatorReport(db: DbOrTx, request: FastifyRequest): Promise<AdoptionIndicatorReport> {
  const transformationId = parseTransformationParam(request.params);
  const query = parseQuery(indicatorsQuery, request.query);
  await requireTransformationRead(db, principalOf(request), transformationId);
  const { organization_id: organizationId } = await db
    .selectFrom("transformation")
    .select("organization_id")
    .where("id", "=", transformationId)
    .executeTakeFirstOrThrow();
  const targetId = await readTarget(db, transformationId, query.targetKind, query.targetId);
  const tz = await businessTimezone(db, organizationId);
  const businessDate = (await sql<{ d: string }>`SELECT p4_business_date(now(), ${tz})::text AS d`.execute(db)).rows[0]!
    .d;
  const periodSelect = db
    .selectFrom("reporting_period")
    .select(["id", sql<string>`period_start::text`.as("start"), sql<string>`period_end::text`.as("end")])
    .where("organization_id", "=", organizationId);
  const period =
    query.reportingPeriodId !== undefined
      ? await periodSelect.where("id", "=", query.reportingPeriodId).executeTakeFirst()
      : // Default: the organization's latest open or closed period that has started (the shortest on a tie).
        await periodSelect
          .where("status", "in", ["open", "closed"])
          .where("period_start", "<=", businessDate)
          .orderBy("period_end", "desc")
          .orderBy("length_days", "asc")
          .orderBy("id")
          .limit(1)
          .executeTakeFirst();
  if (!period) {
    if (query.reportingPeriodId !== undefined) throw problems.notFound();
    throw adoptionRule(
      "validation.required",
      "Name a reporting period: none of the organization's periods is open or closed yet.",
      "/reportingPeriodId",
    );
  }

  const links = await db
    .selectFrom("adoption_metric_link as l")
    .innerJoin("adoption_indicator_template as t", "t.key", "l.template_key")
    .selectAll("l")
    .select(["t.value_source", "t.indicator_ordinal", "t.measure_ordinal"])
    .where("l.transformation_id", "=", transformationId)
    .where("l.target_kind", "=", query.targetKind)
    .where(
      sql<string>`coalesce(l.outcome_id, l.initiative_id, l.stakeholder_group_id, l.transformation_id)`,
      "=",
      targetId,
    )
    .where("l.status", "=", "active")
    .orderBy("t.indicator_ordinal")
    .orderBy("t.measure_ordinal")
    .orderBy("l.id")
    .execute();

  const groupIds =
    query.targetKind === "stakeholder_group"
      ? [targetId]
      : (
          await db
            .selectFrom("stakeholder_group")
            .select("id")
            .where("transformation_id", "=", transformationId)
            .where("status", "=", "active")
            .orderBy("id")
            .execute()
        ).map((g) => g.id);
  const inputs = await recordInputs(db, transformationId, groupIds, period, tz);

  const measures: AdoptionMeasureValue[] = [];
  const templates = await templatesQuery(db).execute();
  for (const t of templates) {
    if (t.value_source === "kpi_actuals") {
      for (const l of links.filter((x) => x.template_key === t.key))
        measures.push(await kpiMeasure(db, l, period.id, businessDate));
      continue;
    }
    // The two record-fed measures are always reported, attached or not (REQ-PB-072: Unknown, never absent or 0).
    const link = links.find((x) => x.template_key === t.key);
    const m =
      t.value_source === "training_records"
        ? trainingCompletion(inputs.training, period)
        : observedProficiency(inputs.observations, period);
    measures.push(recordValue(t.key, link, m));
  }
  return { targetKind: query.targetKind, targetId, reportingPeriodId: period.id, measures };
}

// ------------------------------------------------------------------------------------------------ routes

const listQuery = z.strictObject({
  cursor: cursorSchema,
  limit: limitSchema,
  targetKind: adoptionTargetKind.optional(),
  targetId: z.uuid().optional(),
});

/** Registers this file's routes and returns them as "METHOD /path". */
export function registerAdoptionIndicatorRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  const signedIn = { access: { permission: "authenticated" as const } };
  const read = { access: { permission: "transformation.read" as const } };
  const write = { access: { permission: ADOPTION_EDIT }, consumes: JSON_BODY };
  const bodiless = { access: { permission: ADOPTION_EDIT } };

  app.get(ADOPTION_INDICATOR_TEMPLATES, { config: signedIn }, async (request) => {
    parseQuery(z.strictObject({}), request.query);
    return { items: (await templatesQuery(db).execute()).map(toTemplate) };
  });

  app.get(ADOPTION_METRIC_LINKS, { config: read }, async (request) => {
    const transformationId = parseTransformationParam(request.params);
    const query = parseQuery(listQuery, request.query);
    await requireTransformationRead(db, principalOf(request), transformationId);
    const hash = filterHash({
      table: "adoption_metric_link",
      transformationId,
      targetKind: query.targetKind ?? null,
      targetId: query.targetId ?? null,
    });
    const after = decodeCursor(query.cursor, hash, 1);
    let q = db.selectFrom("adoption_metric_link").selectAll().where("transformation_id", "=", transformationId);
    if (query.targetKind !== undefined) q = q.where("target_kind", "=", query.targetKind);
    if (query.targetId !== undefined)
      q = q.where(
        sql<string>`coalesce(outcome_id, initiative_id, stakeholder_group_id, transformation_id)`,
        "=",
        query.targetId,
      );
    if (after) q = q.where("id", ">", String(after[0]));
    const rows = await q
      .orderBy("id")
      .limit(query.limit + 1)
      .execute();
    const page = paginate(rows, query.limit, (r) => [r.id], hash);
    return { items: page.items.map(toAdoptionMetricLink), nextCursor: page.nextCursor };
  });

  app.post(ADOPTION_METRIC_LINKS, { config: write }, async (request, reply) => {
    const row = await db.transaction().execute((tx) => createLink(tx, request));
    return sendVersioned(reply, 201, toAdoptionMetricLink(row), `${request.url.split("?")[0]!}/${row.id}`);
  });

  app.post(ADOPTION_METRIC_LINK_REMOVE, { config: bodiless }, async (request, reply) => {
    const row = await db.transaction().execute((tx) => removeLink(tx, request));
    return sendVersioned(reply, 200, toAdoptionMetricLink(row));
  });

  app.get(ADOPTION_INDICATORS, { config: read }, async (request) => indicatorReport(db, request));

  return [
    `GET ${ADOPTION_INDICATOR_TEMPLATES}`,
    `GET ${ADOPTION_METRIC_LINKS}`,
    `POST ${ADOPTION_METRIC_LINKS}`,
    `POST ${ADOPTION_METRIC_LINK_REMOVE}`,
    `GET ${ADOPTION_INDICATORS}`,
  ];
}
