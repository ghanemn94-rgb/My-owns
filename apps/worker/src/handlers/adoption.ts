// adoption job handlers (T-DG4-KBE-F; p4-work-split §F+G FG.3; stub by T-DG4-BE-A): the below-trajectory consumer of
// slice F (ADR-0033 §4; REQ-PB-069, REQ-PB-071 "an actual below trajectory creates a corrective intervention").
//
//   queue / consumer              event (producer)
//   adoption.indicator_evaluated  kpi.deviation_evaluated v1 (KBE-C, ADR-0027 §8; fanned out with raid.corrective_kpi,
//                                 D-102)
//
// Under the kit's runOnce(consumer, <event idempotency key>, fn), so a redelivery, a retry or a restart does nothing
// twice, in ONE transaction:
//   1. reads the event's kpi_evaluation (the stored row is the source of truth; it must be the payload's KPI, scope and
//      period of the payload's transformation);
//   2. step 2, the below-trajectory test: deviation adverse AND calculated RAG amber or red (isBelowTrajectory,
//      @mth/shared/calc). green, unknown, stale and not_computable never create an intervention: an Unknown period is
//      not counted as below trajectory;
//   3. for each ACTIVE adoption_metric_link of the event's KPI (in id order), createBelowTrajectoryIntervention below:
//      exactly one corrective intervention per link, scope and reporting period, with the owner's work item and one
//      adoption.check_failed outbox event (ADR-0031 §5.4 payload).
//
// createBelowTrajectoryIntervention is the worker twin of BE-H's exported service in
// apps/api/src/modules/adoption/interventions.ts (the worker imports no API code, ADR-0002 rule 5; D-102 item 2, the
// createWorkItemOnce precedent). Keep the two identical except the id source (the API uses the uuid package, the worker
// mth_uuid_v7()); apps/api/test/integration/adoption/indicators.test.ts proves both write the same rows for the same
// input. The audit actor is the service (jobActor); a job never decides a business approval and never touches DG0-DG7.
import { diffFields, insertAuditEvent, sql, type AuditActor, type Db, type Tx } from "@mth/db";
import { isBelowTrajectory } from "@mth/shared/calc";
import { outboxEnvelope, outboxPayloadSchema, type CheckFailedPayload, type OutboxEnvelope } from "@mth/shared/schemas";
import { addWorkingDays } from "@mth/shared/time";
import { createWorkItemOnce, jobActor, runOnce } from "../kit.ts";
import { ADOPTION_INDICATOR_EVALUATED_QUEUE } from "../queues/adoption.ts";
import type { JobHandler } from "./spec.ts";

/** ADR-0016 §6 / apps/api platform/advisory-locks.ts `adoptionIntervention` (the worker imports no API code). */
export const ADOPTION_INTERVENTION_LOCK_CLASS = 730242;
/** ADR-0033 §4 step 5 / §13 item 3 (adoption/interventions.ts BELOW_TRAJECTORY_DUE_WORKING_DAYS). */
export const BELOW_TRAJECTORY_DUE_WORKING_DAYS = 5;
export const ADOPTION_INTERVENTION_TASK_KIND = "adoption_intervention_due";
export const ADOPTION_INTERVENTION_TASK_MESSAGE = "adoption.task.intervention_due";
export const ADOPTION_INDICATOR_CONSUMER = ADOPTION_INDICATOR_EVALUATED_QUEUE;
export const ADOPTION_INDICATOR_EVENT = "kpi.deviation_evaluated";

/** adoption/interventions.ts ADOPTION_INTERVENTION_AUDIT_FIELDS (same list, same order). */
const ADOPTION_INTERVENTION_AUDIT_FIELDS = [
  "code",
  "stakeholder_group_id",
  "intervention_type",
  "title",
  "description",
  "owner_user_id",
  "due_date",
  "status",
  "origin",
  "metric_link_id",
  "kpi_evaluation_id",
  "reporting_period_id",
  "scope_kind",
  "scope_id",
  "trigger_key",
  "outcome_note",
] as const;

// ------------------------------------------------------------------------------------------------ the worker twin

/** The trigger of one below-trajectory evaluation (adoption/interventions.ts BelowTrajectoryInput). */
export interface BelowTrajectoryInput {
  readonly actor: AuditActor;
  readonly metricLinkId: string;
  readonly kpiEvaluationId: string;
  readonly reportingPeriodId: string;
  readonly scopeKind: "transformation" | "business_unit" | "initiative";
  readonly scopeId: string;
  /** The `kpi.deviation_evaluated` event's created_at: its business date is the due-date base (§4 step 5). */
  readonly eventCreatedAt: Date | string;
  /** The evaluation time (`failedAt` of the ADR-0031 §5.4 payload). */
  readonly failedAt: Date | string;
}

export type BelowTrajectoryResult =
  | { readonly outcome: "created"; readonly interventionId: string; readonly outboxEventId: string }
  | { readonly outcome: "existing"; readonly interventionId: string }
  | { readonly outcome: "skipped"; readonly reason: "link_not_active" };

export function belowTrajectoryTriggerKey(
  i: Pick<BelowTrajectoryInput, "metricLinkId" | "scopeKind" | "scopeId" | "reportingPeriodId">,
): string {
  return `${i.metricLinkId}:${i.scopeKind}:${i.scopeId}:${i.reportingPeriodId}`;
}

async function uuidv7(tx: Tx): Promise<string> {
  const r = await sql<{ id: string }>`SELECT mth_uuid_v7() AS id`.execute(tx);
  return r.rows[0]!.id;
}

const dateOrNull = (d: string | null): string | null => (d === null ? null : String(d).slice(0, 10));

async function firstActiveUser(
  tx: Tx,
  organizationId: string,
  candidates: readonly (string | null)[],
): Promise<string | null> {
  const ids = candidates.filter((c): c is string => c !== null);
  if (ids.length === 0) return null;
  const active = new Set(
    (
      await tx
        .selectFrom("app_user")
        .select("id")
        .where("id", "in", ids)
        .where("organization_id", "=", organizationId)
        .where("status", "=", "active")
        .execute()
    ).map((u) => u.id),
  );
  return ids.find((id) => active.has(id)) ?? null;
}

/** organization/calendar.ts computeWorkingDayDueDate (dueDate only): the n-th working day after `raisedOn`. */
async function workingDayDueDate(
  tx: Tx,
  organizationId: string,
  raisedOn: string,
  workingDays: number,
): Promise<string | null> {
  const calendar = await tx
    .selectFrom("business_calendar")
    .select(["id", "workweek"])
    .where("organization_id", "=", organizationId)
    .where("is_default", "=", true)
    .where("status", "=", "active")
    .executeTakeFirst();
  if (!calendar) return addWorkingDays(raisedOn, workingDays, null).dueDate;
  const holidays = await tx
    .selectFrom("business_calendar_holiday")
    .select([sql<string>`date_from::text`.as("dateFrom"), sql<string>`date_to::text`.as("dateTo")])
    .where("calendar_id", "=", calendar.id)
    .where("status", "=", "active")
    .execute();
  return addWorkingDays(raisedOn, workingDays, { workweek: calendar.workweek.map(Number), holidays }).dueDate;
}

/**
 * Creates exactly one corrective intervention for a below-trajectory evaluation of an active adoption metric link
 * (ADR-0033 §4 steps 3-6), inside `tx`; the twin of the API service of the same name. Called twice for the same trigger
 * it returns `existing` and writes nothing (the adoptionIntervention lock, then insert-if-absent on trigger_key).
 */
export async function createBelowTrajectoryIntervention(
  tx: Tx,
  input: BelowTrajectoryInput,
): Promise<BelowTrajectoryResult> {
  const triggerKey = belowTrajectoryTriggerKey(input);
  await sql`SELECT pg_advisory_xact_lock(${ADOPTION_INTERVENTION_LOCK_CLASS}::int, hashtext(${triggerKey}))`.execute(
    tx,
  );
  const link = await tx
    .selectFrom("adoption_metric_link")
    .selectAll()
    .where("id", "=", input.metricLinkId)
    .executeTakeFirstOrThrow();
  const existing = await tx
    .selectFrom("adoption_intervention")
    .select("id")
    .where("transformation_id", "=", link.transformation_id)
    .where("trigger_key", "=", triggerKey)
    .executeTakeFirst();
  if (existing) return { outcome: "existing", interventionId: existing.id };
  if (link.status !== "active" || link.kpi_definition_id === null)
    return { outcome: "skipped", reason: "link_not_active" };

  const transformation = await tx
    .selectFrom("transformation")
    .select(["id", "organization_id", "lead_user_id"])
    .where("id", "=", link.transformation_id)
    .executeTakeFirstOrThrow();
  const kpi = await tx
    .selectFrom("kpi_definition")
    .select(["name", "owner_user_id"])
    .where("id", "=", link.kpi_definition_id)
    .executeTakeFirstOrThrow();
  const targetOwners: (string | null)[] = [];
  if (link.stakeholder_group_id !== null) {
    const g = await tx
      .selectFrom("stakeholder_group")
      .select("owner_user_id")
      .where("id", "=", link.stakeholder_group_id)
      .executeTakeFirstOrThrow();
    targetOwners.push(g.owner_user_id);
  } else if (link.outcome_id !== null) {
    const o = await tx
      .selectFrom("outcome")
      .select("owner_user_id")
      .where("id", "=", link.outcome_id)
      .executeTakeFirstOrThrow();
    targetOwners.push(o.owner_user_id);
  } else if (link.initiative_id !== null) {
    const i = await tx
      .selectFrom("initiative")
      .select(["executive_owner_user_id", "workstream_lead_user_id"])
      .where("id", "=", link.initiative_id)
      .executeTakeFirstOrThrow();
    targetOwners.push(i.executive_owner_user_id, i.workstream_lead_user_id);
  } else {
    targetOwners.push(transformation.lead_user_id);
  }
  const ownerUserId = await firstActiveUser(tx, transformation.organization_id, [
    ...targetOwners,
    kpi.owner_user_id,
    transformation.lead_user_id,
  ]);

  // The business date of the event in the default calendar's timezone, else the organization's (ADR-0025 §2).
  const calendarTz = await tx
    .selectFrom("business_calendar")
    .select("timezone")
    .where("organization_id", "=", transformation.organization_id)
    .where("is_default", "=", true)
    .where("status", "=", "active")
    .executeTakeFirst();
  const tz =
    calendarTz?.timezone ??
    (
      await tx
        .selectFrom("organization")
        .select("default_timezone")
        .where("id", "=", transformation.organization_id)
        .executeTakeFirstOrThrow()
    ).default_timezone;
  const eventAt = input.eventCreatedAt instanceof Date ? input.eventCreatedAt.toISOString() : input.eventCreatedAt;
  const businessDate = (
    await sql<{ d: string }>`SELECT p4_business_date(${eventAt}::timestamptz, ${tz})::text AS d`.execute(tx)
  ).rows[0]!.d;
  const dueDate = await workingDayDueDate(
    tx,
    transformation.organization_id,
    businessDate,
    BELOW_TRAJECTORY_DUE_WORKING_DAYS,
  );

  const id = await uuidv7(tx);
  const counter = await sql<{ last_value: number }>`
    INSERT INTO record_code_counter (transformation_id, prefix, last_value) VALUES (${transformation.id}::uuid, 'AI', 1)
    ON CONFLICT (transformation_id, prefix) DO UPDATE SET last_value = record_code_counter.last_value + 1
    RETURNING last_value`.execute(tx);
  const row = await tx
    .insertInto("adoption_intervention")
    .values({
      id,
      organization_id: transformation.organization_id,
      transformation_id: transformation.id,
      code: `AI-${String(counter.rows[0]!.last_value).padStart(2, "0")}`,
      stakeholder_group_id: link.target_kind === "stakeholder_group" ? link.stakeholder_group_id : null,
      intervention_type: "corrective",
      title: kpi.name,
      owner_user_id: ownerUserId,
      due_date: dueDate,
      origin: "below_trajectory",
      metric_link_id: link.id,
      kpi_evaluation_id: input.kpiEvaluationId,
      reporting_period_id: input.reportingPeriodId,
      scope_kind: input.scopeKind,
      scope_id: input.scopeId,
      trigger_key: triggerKey,
      created_source: "worker",
      created_by: null,
      updated_by: null,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await insertAuditEvent(tx, input.actor, {
    action: "adoption_intervention.create",
    recordType: "adoption_intervention",
    recordId: id,
    organizationId: row.organization_id,
    transformationId: row.transformation_id,
    newVersion: row.version,
    changes: diffFields({} as typeof row, row, [...ADOPTION_INTERVENTION_AUDIT_FIELDS]),
  });
  if (row.owner_user_id !== null)
    await createWorkItemOnce(tx, input.actor, {
      organizationId: row.organization_id,
      transformationId: row.transformation_id,
      kind: ADOPTION_INTERVENTION_TASK_KIND,
      assigneeUserId: row.owner_user_id,
      subjectType: "adoption_intervention",
      subjectId: row.id,
      linkPath: `/transformations/${row.transformation_id}/adoption-interventions/${row.id}`,
      messageKey: ADOPTION_INTERVENTION_TASK_MESSAGE,
      messageParams: { code: row.code },
      dueDate: dateOrNull(row.due_date),
      dedupeKey: `adoption.intervention:${row.id}:${row.owner_user_id}`,
    });

  // ADR-0031 §5.4: exactly this payload; idempotency key `adoption.check_failed:<interventionId>`.
  const failedAt =
    input.failedAt instanceof Date ? input.failedAt.toISOString() : new Date(input.failedAt).toISOString();
  const payload: CheckFailedPayload = {
    checkId: id,
    checkRecordType: "adoption_intervention",
    transformationId: row.transformation_id,
    ownerUserId,
    subjectLabel: kpi.name,
    failedAt,
    businessDate,
  };
  const schema = outboxPayloadSchema("adoption.check_failed", 1);
  if (!schema) throw new Error("outbox: no schema for adoption.check_failed v1");
  const outboxEventId = await uuidv7(tx);
  await tx
    .insertInto("outbox_event")
    .values({
      id: outboxEventId,
      organization_id: row.organization_id,
      aggregate_type: "adoption_intervention",
      aggregate_id: id,
      event_type: "adoption.check_failed",
      schema_version: 1,
      payload: JSON.stringify(schema.parse(payload)),
      idempotency_key: `adoption.check_failed:${id}`,
    })
    .execute();
  return { outcome: "created", interventionId: id, outboxEventId };
}

// ------------------------------------------------------------------------------------------------ the consumer

export interface IndicatorEvaluatedResult {
  readonly outcome: "duplicate" | "not_below_trajectory" | "evaluated";
  /** One entry per active metric link of the KPI (empty when none, or not below trajectory). */
  readonly interventions: readonly (BelowTrajectoryResult & { readonly metricLinkId: string })[];
}

function envelopeFor(data: unknown): OutboxEnvelope {
  const envelope = outboxEnvelope.parse(data);
  if (envelope.eventType !== ADOPTION_INDICATOR_EVENT)
    throw new Error(`${ADOPTION_INDICATOR_CONSUMER} received ${envelope.eventType} (queue mapping error)`);
  return envelope;
}

/** adoption.indicator_evaluated: kpi.deviation_evaluated v1 (ADR-0033 §4 steps 1-7). */
export async function handleIndicatorEvaluated(
  db: Db,
  data: unknown,
  jobId: string,
): Promise<IndicatorEvaluatedResult> {
  const envelope = envelopeFor(data);
  const schema = outboxPayloadSchema(envelope.eventType, envelope.schemaVersion);
  if (!schema) throw new Error(`no schema for ${envelope.eventType} v${envelope.schemaVersion}`);
  const p = schema.parse(envelope.payload) as {
    evaluationId: string;
    transformationId: string;
    kpiDefinitionId: string;
    scopeKind: "transformation" | "business_unit" | "initiative";
    scopeId: string;
    reportingPeriodId: string;
  };
  const r = await runOnce(db, ADOPTION_INDICATOR_CONSUMER, envelope.idempotencyKey, async (tx) => {
    const evaluation = await tx
      .selectFrom("kpi_evaluation")
      .select([
        "id",
        "organization_id",
        "transformation_id",
        "kpi_definition_id",
        "scope_kind",
        "scope_id",
        "reporting_period_id",
        "calculated_rag",
        "deviation",
        "evaluated_at",
      ])
      .where("id", "=", p.evaluationId)
      .executeTakeFirstOrThrow();
    if (
      evaluation.organization_id !== envelope.organizationId ||
      evaluation.transformation_id !== p.transformationId ||
      evaluation.kpi_definition_id !== p.kpiDefinitionId ||
      evaluation.scope_kind !== p.scopeKind ||
      evaluation.scope_id !== p.scopeId ||
      evaluation.reporting_period_id !== p.reportingPeriodId
    )
      throw new Error(`kpi.deviation_evaluated ${envelope.outboxEventId} does not match evaluation ${p.evaluationId}`);
    // Step 2: green, unknown, stale and not_computable never create an intervention.
    if (!isBelowTrajectory(evaluation.calculated_rag, evaluation.deviation))
      return { outcome: "not_below_trajectory" as const, interventions: [] };
    const links = await tx
      .selectFrom("adoption_metric_link")
      .select("id")
      .where("transformation_id", "=", p.transformationId)
      .where("kpi_definition_id", "=", p.kpiDefinitionId)
      .where("status", "=", "active")
      .orderBy("id")
      .execute();
    const event = await tx
      .selectFrom("outbox_event")
      .select("created_at")
      .where("id", "=", envelope.outboxEventId)
      .executeTakeFirst();
    const eventCreatedAt =
      event?.created_at ?? (await sql<{ now: Date }>`SELECT now() AS now`.execute(tx)).rows[0]!.now;
    const interventions = [];
    for (const link of links) {
      const result = await createBelowTrajectoryIntervention(tx, {
        actor: jobActor(jobId),
        metricLinkId: link.id,
        kpiEvaluationId: evaluation.id,
        reportingPeriodId: evaluation.reporting_period_id,
        scopeKind: p.scopeKind,
        scopeId: p.scopeId,
        eventCreatedAt,
        failedAt: evaluation.evaluated_at,
      });
      interventions.push({ ...result, metricLinkId: link.id });
    }
    return { outcome: "evaluated" as const, interventions };
  });
  return r.outcome === "duplicate" ? { outcome: "duplicate", interventions: [] } : r.result;
}

export const ADOPTION_HANDLERS: readonly JobHandler[] = [
  { queue: ADOPTION_INDICATOR_CONSUMER, handle: handleIndicatorEvaluated },
];
