// Adoption interventions (P4 slice F; ADR-0033 §4, §9, §10, §12; T-DG4-BE-H; REQ-S11-001, REQ-PB-069, REQ-S16-020
// AdoptionIntervention):
//   GET   /transformations/{t}/adoption-interventions          planned by people and corrective (transformation.read)
//   POST  /transformations/{t}/adoption-interventions          plan one with owner and due date (adoption.edit)
//   GET   /transformations/{t}/adoption-interventions/{i}      one intervention
//   PATCH /transformations/{t}/adoption-interventions/{i}      title, description, owner, due date, status with the
//                                                              outcome note (If-Match)
//
// My Work (REQ-S11-001 "an intervention with owner and due date appears in My Work"): on create, and on an owner change,
// the owner gets one work item `adoption_intervention_due` through createWorkItemOnce (dedupe
// `adoption.intervention:<interventionId>:<ownerUserId>`, due = the intervention's due date); the item follows the
// intervention (T-DG4-BE-R1): an owner change cancels the previous owner's open item and opens the new owner's (A -> B
// -> A leaves one open item, for A), a due-date change moves its due date; done / cancelled closes it.
//
// `createBelowTrajectoryIntervention` (exported for KBE-F's consumer `adoption.indicator_evaluated`, ADR-0033 §4 steps
// 3-6) creates exactly one corrective intervention per metric link, scope and reporting period: the adoptionIntervention advisory lock,
// insert-if-absent on trigger_key (the unique index adoption_intervention_trigger_key is the backstop), the owner
// resolution, the 5-working-day due date in the organization's default calendar (never elapsed days; Unknown when no
// calendar is configured), the owner's work item and one `adoption.check_failed` outbox event with exactly the
// ADR-0031 §5.4 payload, all in the caller's transaction. Its audit actor is the caller's (`service` for a job; S-13).
// Nothing here is a business approval or touches DG0-DG7.
import {
  diffFields,
  insertAuditEvent,
  sql,
  type AdoptionInterventionTable,
  type AuditActor,
  type DbOrTx,
  type Tx,
} from "@mth/db";
import {
  adoptionInterventionCreate,
  adoptionInterventionUpdate,
  outboxPayloadSchema,
  type AdoptionIntervention,
  type CheckFailedPayload,
} from "@mth/shared/schemas";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Selectable } from "kysely";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { principalOf, requireTransformationRead } from "../access/index.ts";
import { record } from "../audit/index.ts";
import { computeWorkingDayDueDate, defaultCalendarTimezone } from "../organization/index.ts";
import {
  ADVISORY_LOCK_CLASSES,
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
import {
  closeWorkItemsOfSubject,
  createWorkItemOnce,
  reassignWorkItemOfSubject,
  rescheduleWorkItemsOfSubject,
  type WorkItemInput,
} from "../tasks/index.ts";
import { assertActiveUsers, type WriteContext } from "../transformations/index.ts";
import {
  adoptionRule,
  ADOPTION_EDIT,
  JSON_BODY,
  lockActiveGroupRef,
  nextAdoptionCode,
  openAdoptionWrite,
  parseTransformationParam,
  T_BASE,
} from "./register.ts";

export type AdoptionInterventionRow = Selectable<AdoptionInterventionTable>;

export const ADOPTION_INTERVENTIONS = `${T_BASE}/adoption-interventions`;
export const ADOPTION_INTERVENTION = `${ADOPTION_INTERVENTIONS}/:adoptionInterventionId`;

export const ADOPTION_INTERVENTION_TASK_KIND = "adoption_intervention_due";
/** ADR-0033 §4 step 5 / §13 item 3: a below-trajectory intervention is due 5 working days after the business date. */
export const BELOW_TRAJECTORY_DUE_WORKING_DAYS = 5;

const OPEN_STATUSES = ["planned", "in_progress"] as const;
/** The legal transitions (0047 `adoption_intervention_guard`); done and cancelled are final. */
const TRANSITIONS: ReadonlyMap<string, readonly string[]> = new Map([
  ["planned", ["in_progress", "done", "cancelled"]],
  ["in_progress", ["done", "cancelled"]],
]);

export const ADOPTION_INTERVENTION_AUDIT_FIELDS = [
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
] as const satisfies readonly (keyof AdoptionInterventionRow & string)[];

// ------------------------------------------------------------------------------------------------ problems (§10)

const FINAL = (status: string) =>
  adoptionRule("adoption_intervention.final", `This intervention is ${status} and can no longer be changed.`);
const STATUS_TRANSITION = (from: string, to: string) =>
  adoptionRule(
    "adoption_intervention.status_transition",
    `This intervention cannot move from ${from} to ${to}.`,
    "/status",
  );
const OUTCOME_REQUIRED = () =>
  adoptionRule(
    "adoption_intervention.outcome_required",
    "Record the outcome before completing or cancelling the intervention.",
    "/outcomeNote",
  );
const OWNER_REQUIRED = () =>
  adoptionRule("adoption_intervention.owner_required", "Assign an owner before completing this intervention.");

// ------------------------------------------------------------------------------------------------ presentation

const dateOrNull = (d: string | null): string | null => (d === null ? null : String(d).slice(0, 10));

export function toAdoptionIntervention(r: AdoptionInterventionRow): AdoptionIntervention {
  const dueDate = dateOrNull(r.due_date);
  return {
    id: r.id,
    transformationId: r.transformation_id,
    code: r.code,
    stakeholderGroupId: r.stakeholder_group_id,
    interventionType: r.intervention_type as AdoptionIntervention["interventionType"],
    title: r.title,
    description: r.description,
    ownerUserId: r.owner_user_id,
    ownerStatus: r.owner_user_id === null ? "unassigned" : "assigned",
    dueDate,
    // Only the worker leaves a due date null, and only when no business calendar is configured (ADR-0033 §4 step 5).
    dueUnknownReason: dueDate === null ? "calendar_not_configured" : null,
    status: r.status as AdoptionIntervention["status"],
    origin: r.origin as AdoptionIntervention["origin"],
    metricLinkId: r.metric_link_id,
    kpiEvaluationId: r.kpi_evaluation_id,
    reportingPeriodId: r.reporting_period_id,
    scopeKind: r.scope_kind as AdoptionIntervention["scopeKind"],
    scopeId: r.scope_id,
    outcomeNote: r.outcome_note,
    completedAt: isoOrNull(r.completed_at),
    completedBy: r.completed_by,
    createdSource: r.created_source as AdoptionIntervention["createdSource"],
    version: r.version,
    createdAt: iso(r.created_at),
    createdBy: r.created_by,
    updatedAt: iso(r.updated_at),
    updatedBy: r.updated_by,
  };
}

// ------------------------------------------------------------------------------------------------ work items

/** The owner's My Work item of an intervention (one per intervention and owner; a returning owner's key gets `#n`). */
function interventionTaskInput(row: AdoptionInterventionRow, ownerUserId: string): WorkItemInput {
  return {
    organizationId: row.organization_id,
    transformationId: row.transformation_id,
    kind: ADOPTION_INTERVENTION_TASK_KIND,
    assigneeUserId: ownerUserId,
    subjectType: "adoption_intervention",
    subjectId: row.id,
    linkPath: `/transformations/${row.transformation_id}/adoption-interventions/${row.id}`,
    messageKey: "adoption.task.intervention_due",
    messageParams: { code: row.code },
    dueDate: dateOrNull(row.due_date),
    dedupeKey: `adoption.intervention:${row.id}:${ownerUserId}`,
  };
}

/** The owner's My Work item for an open intervention with an owner (createWorkItemOnce; one per intervention and owner). */
async function assignInterventionTask(tx: Tx, actor: AuditActor, row: AdoptionInterventionRow): Promise<void> {
  if (row.owner_user_id === null || !(OPEN_STATUSES as readonly string[]).includes(row.status)) return;
  await createWorkItemOnce(tx, actor, interventionTaskInput(row, row.owner_user_id));
}

/**
 * The open intervention's item follows it (T-DG4-BE-R1; D-102): an owner change moves it to the new owner (the
 * previous owner's open item is cancelled; A -> B -> A leaves one open item, for A), a due-date change moves its due
 * date.
 */
async function followInterventionTask(
  tx: Tx,
  actor: AuditActor,
  before: AdoptionInterventionRow,
  after: AdoptionInterventionRow,
): Promise<void> {
  if (!(OPEN_STATUSES as readonly string[]).includes(after.status)) return;
  if (after.owner_user_id !== before.owner_user_id) {
    if (after.owner_user_id === null) await closeInterventionTasks(tx, actor, after, "cancelled");
    else await reassignWorkItemOfSubject(tx, actor, interventionTaskInput(after, after.owner_user_id));
  }
  if (dateOrNull(after.due_date) !== dateOrNull(before.due_date))
    await rescheduleWorkItemsOfSubject(
      tx,
      actor,
      {
        organizationId: after.organization_id,
        subjectType: "adoption_intervention",
        subjectId: after.id,
        kinds: [ADOPTION_INTERVENTION_TASK_KIND],
      },
      dateOrNull(after.due_date),
    );
}

function closeInterventionTasks(
  tx: Tx,
  actor: AuditActor,
  row: AdoptionInterventionRow,
  status: "done" | "cancelled",
): Promise<number> {
  return closeWorkItemsOfSubject(
    tx,
    actor,
    {
      organizationId: row.organization_id,
      subjectType: "adoption_intervention",
      subjectId: row.id,
      kinds: [ADOPTION_INTERVENTION_TASK_KIND],
    },
    status,
  );
}

const userActor = (ctx: WriteContext): AuditActor => ({
  actorType: "user",
  actorUserId: ctx.userId,
  requestId: ctx.audit.requestId,
  source: "api",
});

// ------------------------------------------------------------------------------------------------ writes (API)

async function createIntervention(tx: Tx, request: FastifyRequest): Promise<AdoptionInterventionRow> {
  const transformationId = parseTransformationParam(request.params);
  const ctx = await openAdoptionWrite(tx, request, transformationId);
  const body = parseBody(adoptionInterventionCreate, request.body);
  const groupId =
    body.stakeholderGroupId === undefined || body.stakeholderGroupId === null
      ? null
      : (await lockActiveGroupRef(tx, transformationId, body.stakeholderGroupId, "/stakeholderGroupId")).id;
  await assertActiveUsers(tx, ctx.organizationId, [{ id: body.ownerUserId, pointer: "/ownerUserId" }]);
  const id = uuidv7();
  const row = await tx
    .insertInto("adoption_intervention")
    .values({
      id,
      organization_id: ctx.organizationId,
      transformation_id: transformationId,
      code: await nextAdoptionCode(tx, transformationId, "AI"),
      stakeholder_group_id: groupId,
      intervention_type: body.interventionType,
      title: body.title,
      description: body.description ?? null,
      owner_user_id: body.ownerUserId,
      due_date: body.dueDate,
      origin: "manual",
      created_source: "api",
      created_by: ctx.userId,
      updated_by: ctx.userId,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: "adoption_intervention.create",
    recordType: "adoption_intervention",
    recordId: id,
    organizationId: ctx.organizationId,
    transformationId,
    newVersion: row.version,
    changes: diffFields({} as AdoptionInterventionRow, row, [...ADOPTION_INTERVENTION_AUDIT_FIELDS]),
  });
  await assignInterventionTask(tx, userActor(ctx), row);
  return row;
}

const interventionParams = z.strictObject({ transformationId: z.uuid(), adoptionInterventionId: z.uuid() });

async function updateIntervention(tx: Tx, request: FastifyRequest): Promise<AdoptionInterventionRow> {
  const { transformationId, adoptionInterventionId } = parse(interventionParams, request.params, "params");
  const ctx = await openAdoptionWrite(tx, request, transformationId);
  const current = await tx
    .selectFrom("adoption_intervention")
    .selectAll()
    .where("id", "=", adoptionInterventionId)
    .where("transformation_id", "=", transformationId)
    .forUpdate()
    .executeTakeFirst();
  if (!current) throw problems.notFound();
  const body = parseBody(adoptionInterventionUpdate, request.body);
  const expected = requireIfMatch(request);
  if (current.version !== expected) throw problems.versionConflict(current.version);
  if (current.status === "done" || current.status === "cancelled") throw FINAL(current.status);
  const to = body.status ?? current.status;
  if (to !== current.status && !(TRANSITIONS.get(current.status) ?? []).includes(to))
    throw STATUS_TRANSITION(current.status, to);
  const closing = to === "done" || to === "cancelled";
  if (closing && body.outcomeNote === undefined) throw OUTCOME_REQUIRED();
  const owner = body.ownerUserId ?? current.owner_user_id;
  if (to === "done" && owner === null) throw OWNER_REQUIRED();
  await assertActiveUsers(tx, ctx.organizationId, [{ id: body.ownerUserId, pointer: "/ownerUserId" }]);
  const updated = await tx
    .updateTable("adoption_intervention")
    .set({
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.ownerUserId !== undefined ? { owner_user_id: body.ownerUserId } : {}),
      ...(body.dueDate !== undefined ? { due_date: body.dueDate } : {}),
      ...(body.outcomeNote !== undefined ? { outcome_note: body.outcomeNote } : {}),
      ...(body.status !== undefined ? { status: body.status } : {}),
      ...(to === "done" ? { completed_at: sql<Date>`now()`, completed_by: ctx.userId } : {}),
      version: sql<number>`version + 1`,
      updated_at: sql<Date>`now()`,
      updated_by: ctx.userId,
    })
    .where("id", "=", current.id)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: "adoption_intervention.update",
    recordType: "adoption_intervention",
    recordId: current.id,
    organizationId: ctx.organizationId,
    transformationId,
    priorVersion: current.version,
    newVersion: updated.version,
    changes: diffFields(current, updated, [...ADOPTION_INTERVENTION_AUDIT_FIELDS]),
  });
  const actor = userActor(ctx);
  if (closing) {
    if (updated.status !== current.status) await closeInterventionTasks(tx, actor, updated, to);
  } else await followInterventionTask(tx, actor, current, updated);
  return updated;
}

// ------------------------------------------------------------------------------------------------ below trajectory

/** The trigger of one below-trajectory evaluation (ADR-0033 §4; the KBE-F consumer passes the event's facts). */
export interface BelowTrajectoryInput {
  /** The audit actor: `service` with source `worker` for a job (S-13); never a person approving anything. */
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

/** `<metricLinkId>:<scopeKind>:<scopeId>:<reportingPeriodId>` (ADR-0033 §4 step 3; the adoptionIntervention lock key). */
export function belowTrajectoryTriggerKey(
  i: Pick<BelowTrajectoryInput, "metricLinkId" | "scopeKind" | "scopeId" | "reportingPeriodId">,
): string {
  return `${i.metricLinkId}:${i.scopeKind}:${i.scopeId}:${i.reportingPeriodId}`;
}

/**
 * The first active user among `candidates` (in order), or null (ADR-0033 §4 step 4: the link target's owner, else the
 * KPI's owner, else the transformation's lead; none -> unassigned, no work item).
 */
async function firstActiveUser(
  db: DbOrTx,
  organizationId: string,
  candidates: readonly (string | null)[],
): Promise<string | null> {
  const ids = candidates.filter((c): c is string => c !== null);
  if (ids.length === 0) return null;
  const active = new Set(
    (
      await db
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

/**
 * Creates exactly one corrective intervention for a below-trajectory evaluation of an active adoption metric link
 * (ADR-0033 §4 steps 3-6), inside `tx`. Called twice for the same trigger it returns `existing` and writes nothing
 * (the adoptionIntervention lock, then insert-if-absent on trigger_key). Whether the evaluation IS below trajectory (step 2) is the
 * caller's test (KBE-F); this function never decides an approval.
 */
export async function createBelowTrajectoryIntervention(
  tx: Tx,
  input: BelowTrajectoryInput,
): Promise<BelowTrajectoryResult> {
  const triggerKey = belowTrajectoryTriggerKey(input);
  await sql`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK_CLASSES.adoptionIntervention}::int, hashtext(${triggerKey}))`.execute(
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
  const tz =
    (await defaultCalendarTimezone(tx, transformation.organization_id)) ??
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
  const due = await computeWorkingDayDueDate(
    tx,
    transformation.organization_id,
    businessDate,
    BELOW_TRAJECTORY_DUE_WORKING_DAYS,
  );

  const id = uuidv7();
  const row = await tx
    .insertInto("adoption_intervention")
    .values({
      id,
      organization_id: transformation.organization_id,
      transformation_id: transformation.id,
      code: await nextAdoptionCode(tx, transformation.id, "AI"),
      stakeholder_group_id: link.target_kind === "stakeholder_group" ? link.stakeholder_group_id : null,
      intervention_type: "corrective",
      title: kpi.name,
      owner_user_id: ownerUserId,
      due_date: due.dueDate,
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
    changes: diffFields({} as AdoptionInterventionRow, row, [...ADOPTION_INTERVENTION_AUDIT_FIELDS]),
  });
  await assignInterventionTask(tx, input.actor, row);

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
  const outboxEventId = uuidv7();
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

// ------------------------------------------------------------------------------------------------ routes

const listQuery = z.strictObject({
  cursor: cursorSchema,
  limit: limitSchema,
  stakeholderGroupId: z.uuid().optional(),
  status: z.enum(["planned", "in_progress", "done", "cancelled"]).optional(),
  origin: z.enum(["manual", "below_trajectory"]).optional(),
});

export function registerAdoptionInterventionRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  const read = { access: { permission: "transformation.read" as const } };
  const write = { access: { permission: ADOPTION_EDIT }, consumes: JSON_BODY };

  app.get(ADOPTION_INTERVENTIONS, { config: read }, async (request) => {
    const transformationId = parseTransformationParam(request.params);
    const query = parseQuery(listQuery, request.query);
    await requireTransformationRead(db, principalOf(request), transformationId);
    const hash = filterHash({
      table: "adoption_intervention",
      transformationId,
      stakeholderGroupId: query.stakeholderGroupId ?? null,
      status: query.status ?? null,
      origin: query.origin ?? null,
    });
    const after = decodeCursor(query.cursor, hash, 1);
    let q = db.selectFrom("adoption_intervention").selectAll().where("transformation_id", "=", transformationId);
    if (query.stakeholderGroupId !== undefined) q = q.where("stakeholder_group_id", "=", query.stakeholderGroupId);
    if (query.status !== undefined) q = q.where("status", "=", query.status);
    if (query.origin !== undefined) q = q.where("origin", "=", query.origin);
    if (after) q = q.where("id", ">", String(after[0]));
    const rows = await q
      .orderBy("id")
      .limit(query.limit + 1)
      .execute();
    const page = paginate(rows, query.limit, (r) => [r.id], hash);
    return { items: page.items.map(toAdoptionIntervention), nextCursor: page.nextCursor };
  });

  app.post(ADOPTION_INTERVENTIONS, { config: write }, async (request, reply) => {
    const row = await db.transaction().execute((tx) => createIntervention(tx, request));
    return sendVersioned(reply, 201, toAdoptionIntervention(row), `${request.url.split("?")[0]!}/${row.id}`);
  });

  app.get(ADOPTION_INTERVENTION, { config: read }, async (request, reply) => {
    const { transformationId, adoptionInterventionId } = parse(interventionParams, request.params, "params");
    await requireTransformationRead(db, principalOf(request), transformationId);
    const row = await db
      .selectFrom("adoption_intervention")
      .selectAll()
      .where("id", "=", adoptionInterventionId)
      .where("transformation_id", "=", transformationId)
      .executeTakeFirst();
    if (!row) throw problems.notFound();
    return sendVersioned(reply, 200, toAdoptionIntervention(row));
  });

  app.patch(ADOPTION_INTERVENTION, { config: write }, async (request, reply) => {
    const row = await db.transaction().execute((tx) => updateIntervention(tx, request));
    return sendVersioned(reply, 200, toAdoptionIntervention(row));
  });

  return [
    `GET ${ADOPTION_INTERVENTIONS}`,
    `POST ${ADOPTION_INTERVENTIONS}`,
    `GET ${ADOPTION_INTERVENTION}`,
    `PATCH ${ADOPTION_INTERVENTION}`,
  ];
}
