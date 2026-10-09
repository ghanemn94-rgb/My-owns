// BAU controls, their periodic checks and the recurring sustainment reviews (P4 slice G; ADR-0034 §6, §9, §11, §12;
// T-DG4-BE-I2; REQ-S11-008 "a failed control check creates a recovery action", REQ-S11-004, REQ-S03-002):
//   GET   /transformations/{t}/controls                                        list (transformation.read)
//   POST  /transformations/{t}/controls                                        create, active (control.manage; BO, TO)
//   PATCH /transformations/{t}/controls/{c}                                    edit, or retire with a reason (If-Match);
//                                                                              retiring cancels its due checks and their tasks
//   GET   /transformations/{t}/control-checks                                  list (transformation.read)
//   POST  /transformations/{t}/control-checks/{k}/record                       passed | failed (control_check.record;
//                                                                              BO, TO; If-Match)
//   GET   /transformations/{t}/sustainment-reviews                             list (transformation.read)
//   POST  /transformations/{t}/sustainment-reviews/{r}/complete                the assignee only
//                                                                              (sustainment_review.complete; If-Match)
//
// Checks and reviews are CREATED by the daily worker scans (apps/worker/src/handlers/sustainment.ts), never here. A
// failed check writes, in the same transaction, one outbox event `control_check.failed` with exactly the ADR-0031 §5.4
// payload (idempotency key `control_check.failed:<checkId>`); slice E's consumer `raid.corrective_control` opens exactly
// one corrective case (the recovery action, with owner and follow-up date). No guard here reads the transformation's
// status: after closure, controls, checks and reviews stay writable (ADR-0034 §4, Context 3); an archived
// transformation is read-only (the DG1 register-kit rule in openWrite).
//
// Every mutation: the read gate on the request principal (ADM-only or outsider: 404, ADR-0006), then the write
// permission re-checked at commit time on the reloaded grants (AUD 403), validation, If-Match (428/409; creates are
// version 1), one audit event per changed row in the same transaction, and no remote I/O inside it (S-4). Nothing here
// is a G1-G6 business approval, and nothing touches DG0-DG7.
import { sql, type DbOrTx, type Tx } from "@mth/db";
import {
  controlCreate,
  controlUpdate,
  controlCheckRecord,
  outboxPayloadSchema,
  sustainmentReviewComplete,
  type CheckFailedPayload,
  type Control,
  type ControlCheck,
  type SustainFrequency,
  type SustainmentReview,
} from "@mth/shared/schemas";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { principalOf, requireTransformationRead } from "../access/index.ts";
import { record } from "../audit/index.ts";
import {
  cursorSchema,
  decodeCursor,
  filterHash,
  HttpProblem,
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
import { closeWorkItemsOfSubject } from "../tasks/index.ts";
import { assertActiveUsers } from "../transformations/index.ts";
import { PROBLEM_TYPES } from "@mth/shared";
import {
  AREA_RETIRED,
  businessDatePlusPeriod,
  dateOrNull,
  JSON_BODY,
  openSustainmentWrite,
  parseTransformationParam,
  sustainRule,
  userActor,
} from "./performance-areas.ts";

export const CONTROLS = "/api/v1/transformations/:transformationId/controls";
export const CONTROL_ITEM = `${CONTROLS}/:controlId`;
export const CONTROL_CHECKS = "/api/v1/transformations/:transformationId/control-checks";
export const CONTROL_CHECK_RECORD = `${CONTROL_CHECKS}/:controlCheckId/record`;
export const SUSTAINMENT_REVIEWS = "/api/v1/transformations/:transformationId/sustainment-reviews";
export const SUSTAINMENT_REVIEW_COMPLETE = `${SUSTAINMENT_REVIEWS}/:sustainmentReviewId/complete`;
export const CONTROL_MANAGE = "control.manage" as const;
export const CONTROL_CHECK_RECORD_PERMISSION = "control_check.record" as const;
export const SUSTAINMENT_REVIEW_COMPLETE_PERMISSION = "sustainment_review.complete" as const;
export const CONTROL_CHECK_FAILED_EVENT = "control_check.failed";
export const CONTROL_CHECK_TASK_KIND = "control_check_due";

// ------------------------------------------------------------------------------------------------ problems (§12, S-11)

const CONTROL_RETIRED = () => sustainRule("control.retired", "This control is retired and can no longer be changed.");
const CHECK_FINAL = (status: string) =>
  sustainRule("control_check.final", `This control check is ${status} and can no longer be changed.`);
const RESULT_NOTE_REQUIRED = () =>
  problems.badRequest(
    "control_check.result_note_required",
    "A failed control check needs a result note.",
    "/resultNote",
  );
const NOT_ASSIGNEE = () =>
  new HttpProblem({
    status: 403,
    type: PROBLEM_TYPES.forbidden,
    code: "sustainment_review.not_assignee",
    title: "Forbidden",
    detail: "Only the assigned reviewer can complete this review.",
  });
const REVIEW_FINAL = (status: string) =>
  sustainRule("sustainment_review.final", `This review is ${status} and can no longer be changed.`);

// ------------------------------------------------------------------------------------------------ shared helpers

/** CTL-01 / CI-01 / LL-01 from record_code_counter; a concurrent allocation serialises on the counter row. */
export async function nextOperationsCode(
  tx: Tx,
  transformationId: string,
  prefix: "CTL" | "CI" | "LL",
): Promise<string> {
  const row = await sql<{ last_value: number }>`
    INSERT INTO record_code_counter (transformation_id, prefix, last_value) VALUES (${transformationId}::uuid, ${prefix}, 1)
    ON CONFLICT (transformation_id, prefix) DO UPDATE SET last_value = record_code_counter.last_value + 1
    RETURNING last_value`.execute(tx);
  return `${prefix}-${String(row.rows[0]!.last_value).padStart(2, "0")}`;
}

/**
 * A performance area of the transformation for a slice G child record (`pointer` names the body member): 422
 * validation.reference when it is not in this transformation, 422 performance_area.retired when it is retired.
 */
export async function assertOpenArea(tx: Tx, transformationId: string, areaId: string, pointer: string) {
  const area = await tx
    .selectFrom("performance_area")
    .select(["id", "status"])
    .where("id", "=", areaId)
    .where("transformation_id", "=", transformationId)
    .executeTakeFirst();
  if (!area)
    throw sustainRule("validation.reference", "The referenced record does not exist in this transformation.", pointer);
  if (area.status === "retired") throw AREA_RETIRED();
}

/** The organization's business date at `at` (its default active calendar's timezone, else its default timezone). */
export async function organizationBusinessDate(db: DbOrTx, organizationId: string, at: Date | string): Promise<string> {
  const r = await sql<{ d: string }>`
    SELECT p4_business_date(${at instanceof Date ? at.toISOString() : at}::timestamptz, coalesce(
      (SELECT c.timezone FROM business_calendar c
        WHERE c.organization_id = ${organizationId}::uuid AND c.is_default AND c.status = 'active' LIMIT 1),
      (SELECT o.default_timezone FROM organization o WHERE o.id = ${organizationId}::uuid)))::text AS d`.execute(db);
  return r.rows[0]!.d;
}

/** The audit diff of the listed snake_case fields (dates as YYYY-MM-DD, so an unchanged date is no change). */
export function diffFields<T extends object>(
  before: Partial<T>,
  after: T,
  fields: readonly string[],
  dateFields: readonly string[] = [],
): Record<string, { from: unknown; to: unknown }> {
  const b = new Map(Object.entries(before));
  const a = new Map(Object.entries(after));
  const out = new Map<string, { from: unknown; to: unknown }>();
  for (const f of fields) {
    const isDate = dateFields.includes(f);
    const value = (v: unknown) => (isDate ? dateOrNull(v) : (v ?? null));
    const key = (v: unknown) => (Array.isArray(v) ? JSON.stringify(v) : v);
    const from = value(b.get(f));
    const to = value(a.get(f));
    if (key(from) !== key(to)) out.set(f, { from, to });
  }
  return Object.fromEntries(out);
}

// ------------------------------------------------------------------------------------------------ rows and presenters

interface ControlRow {
  id: string;
  organization_id: string;
  transformation_id: string;
  performance_area_id: string;
  code: string;
  name: string;
  description: string | null;
  owner_user_id: string | null;
  frequency: string;
  frequency_interval: number;
  next_check_date: string | null;
  status: string;
  retired_at: Date | string | null;
  retired_by: string | null;
  retire_reason: string | null;
  version: number;
  created_at: Date | string;
  created_by: string;
  updated_at: Date | string;
  updated_by: string | null;
}

const CONTROL_AUDIT_FIELDS = [
  "code",
  "performance_area_id",
  "name",
  "description",
  "owner_user_id",
  "frequency",
  "frequency_interval",
  "next_check_date",
  "status",
  "retire_reason",
] as const;

const toControl = (r: ControlRow): Control => ({
  id: r.id,
  transformationId: r.transformation_id,
  performanceAreaId: r.performance_area_id,
  code: r.code,
  name: r.name,
  description: r.description,
  ownerUserId: r.owner_user_id,
  frequency: r.frequency as SustainFrequency,
  frequencyInterval: r.frequency_interval,
  nextCheckDate: dateOrNull(r.next_check_date),
  status: r.status as Control["status"],
  retiredAt: isoOrNull(r.retired_at as Date | null),
  retireReason: r.retire_reason,
  version: r.version,
  createdAt: iso(r.created_at as Date),
  createdBy: r.created_by,
  updatedAt: iso(r.updated_at as Date),
  updatedBy: r.updated_by,
});

async function findControl(db: DbOrTx, transformationId: string, id: string, lock = false): Promise<ControlRow> {
  let q = db.selectFrom("control").selectAll().where("id", "=", id).where("transformation_id", "=", transformationId);
  if (lock) q = q.forUpdate();
  const row = await q.executeTakeFirst();
  if (!row) throw problems.notFound();
  return row as ControlRow;
}

interface CheckRow {
  id: string;
  organization_id: string;
  transformation_id: string;
  control_id: string;
  performance_area_id: string;
  due_date: string;
  assignee_user_id: string | null;
  status: string;
  performed_at: Date | string | null;
  performed_by: string | null;
  result_note: string | null;
  created_source: string;
  version: number;
  created_at: Date | string;
  created_by: string | null;
  updated_at: Date | string;
  updated_by: string | null;
  corrective_case_id?: string | null;
}

const toCheck = (r: CheckRow): ControlCheck => ({
  id: r.id,
  transformationId: r.transformation_id,
  controlId: r.control_id,
  performanceAreaId: r.performance_area_id,
  dueDate: dateOrNull(r.due_date)!,
  assigneeUserId: r.assignee_user_id,
  status: r.status as ControlCheck["status"],
  performedAt: isoOrNull(r.performed_at as Date | null),
  performedBy: r.performed_by,
  resultNote: r.result_note,
  correctiveCaseId: r.corrective_case_id ?? null,
  createdSource: r.created_source as ControlCheck["createdSource"],
  version: r.version,
  createdAt: iso(r.created_at as Date),
  createdBy: r.created_by,
  updatedAt: iso(r.updated_at as Date),
  updatedBy: r.updated_by,
});

/** Checks with slice E's corrective case for each (the case opened for a failed check; null until it exists). */
function checksQuery(db: DbOrTx, transformationId: string) {
  return db
    .selectFrom("control_check as k")
    .selectAll("k")
    .select((eb) =>
      eb
        .selectFrom("corrective_case as c")
        .select("c.id")
        .where("c.source_record_type", "=", "control_check")
        .whereRef("c.source_record_id", "=", "k.id")
        .where("c.transformation_id", "=", transformationId)
        .limit(1)
        .as("corrective_case_id"),
    )
    .where("k.transformation_id", "=", transformationId);
}

async function presentCheck(db: DbOrTx, transformationId: string, id: string): Promise<ControlCheck> {
  const row = await checksQuery(db, transformationId).where("k.id", "=", id).executeTakeFirst();
  if (!row) throw problems.notFound();
  return toCheck(row as CheckRow);
}

interface ReviewRow {
  id: string;
  organization_id: string;
  transformation_id: string;
  subject_kind: string;
  performance_area_id: string | null;
  cycle_no: number | null;
  transition_decision_id: string | null;
  due_date: string;
  assignee_user_id: string;
  status: string;
  completed_at: Date | string | null;
  completed_by: string | null;
  outcome_note: string | null;
  performance_signal: string | null;
  created_source: string;
  version: number;
  created_at: Date | string;
  created_by: string | null;
  updated_at: Date | string;
  updated_by: string | null;
}

const toReview = (r: ReviewRow): SustainmentReview => ({
  id: r.id,
  transformationId: r.transformation_id,
  subjectKind: r.subject_kind as SustainmentReview["subjectKind"],
  performanceAreaId: r.performance_area_id,
  cycleNo: r.cycle_no,
  transitionDecisionId: r.transition_decision_id,
  dueDate: dateOrNull(r.due_date)!,
  assigneeUserId: r.assignee_user_id,
  status: r.status as SustainmentReview["status"],
  completedAt: isoOrNull(r.completed_at as Date | null),
  completedBy: r.completed_by,
  outcomeNote: r.outcome_note,
  performanceSignal: r.performance_signal as SustainmentReview["performanceSignal"],
  createdSource: r.created_source as SustainmentReview["createdSource"],
  version: r.version,
  createdAt: iso(r.created_at as Date),
  createdBy: r.created_by,
  updatedAt: iso(r.updated_at as Date),
  updatedBy: r.updated_by,
});

async function findReview(db: DbOrTx, transformationId: string, id: string, lock = false): Promise<ReviewRow> {
  let q = db
    .selectFrom("sustainment_review")
    .selectAll()
    .where("id", "=", id)
    .where("transformation_id", "=", transformationId);
  if (lock) q = q.forUpdate();
  const row = await q.executeTakeFirst();
  if (!row) throw problems.notFound();
  return row as ReviewRow;
}

// ------------------------------------------------------------------------------------------------ writes

async function createControl(tx: Tx, request: FastifyRequest): Promise<string> {
  const transformationId = parseTransformationParam(request.params);
  const ctx = await openSustainmentWrite(tx, request, transformationId, CONTROL_MANAGE);
  const body = parseBody(controlCreate, request.body);
  await assertOpenArea(tx, transformationId, body.performanceAreaId, "/performanceAreaId");
  await assertActiveUsers(tx, ctx.organizationId, [{ id: body.ownerUserId, pointer: "/ownerUserId" }]);
  const interval = body.frequencyInterval ?? 1;
  // An omitted first check date is the business date plus one period; an explicit null is "not scheduled" (§11).
  const nextCheckDate =
    body.nextCheckDate !== undefined
      ? body.nextCheckDate
      : await businessDatePlusPeriod(tx, ctx.organizationId, body.frequency, interval);
  const id = uuidv7();
  const row = (await tx
    .insertInto("control")
    .values({
      id,
      organization_id: ctx.organizationId,
      transformation_id: transformationId,
      performance_area_id: body.performanceAreaId,
      code: await nextOperationsCode(tx, transformationId, "CTL"),
      name: body.name,
      description: body.description ?? null,
      owner_user_id: body.ownerUserId ?? null,
      frequency: body.frequency,
      frequency_interval: interval,
      next_check_date: nextCheckDate,
      created_by: ctx.userId,
      updated_by: ctx.userId,
    })
    .returningAll()
    .executeTakeFirstOrThrow()) as ControlRow;
  await record(tx, ctx.audit, {
    action: "control.create",
    recordType: "control",
    recordId: id,
    organizationId: ctx.organizationId,
    transformationId,
    newVersion: row.version,
    changes: diffFields({}, row, CONTROL_AUDIT_FIELDS, ["next_check_date"]),
  });
  return id;
}

async function updateControl(tx: Tx, request: FastifyRequest, transformationId: string, controlId: string) {
  const ctx = await openSustainmentWrite(tx, request, transformationId, CONTROL_MANAGE);
  const body = parseBody(controlUpdate, request.body);
  const expected = requireIfMatch(request);
  const current = await findControl(tx, transformationId, controlId, true);
  if (current.version !== expected) throw problems.versionConflict(current.version);
  if (current.status === "retired") throw CONTROL_RETIRED();
  await assertActiveUsers(tx, ctx.organizationId, [{ id: body.ownerUserId, pointer: "/ownerUserId" }]);
  const retiring = body.status === "retired";
  const updated = (await tx
    .updateTable("control")
    .set({
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.ownerUserId !== undefined ? { owner_user_id: body.ownerUserId } : {}),
      ...(body.frequency !== undefined ? { frequency: body.frequency } : {}),
      ...(body.frequencyInterval !== undefined ? { frequency_interval: body.frequencyInterval } : {}),
      ...(body.nextCheckDate !== undefined ? { next_check_date: body.nextCheckDate } : {}),
      ...(retiring
        ? {
            status: "retired",
            retired_at: sql<Date>`now()`,
            retired_by: ctx.userId,
            retire_reason: body.retireReason!,
          }
        : {}),
      version: sql<number>`version + 1`,
      updated_at: sql<Date>`now()`,
      updated_by: ctx.userId,
    })
    .where("id", "=", current.id)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow()) as ControlRow;
  await record(tx, ctx.audit, {
    action: retiring ? "control.retire" : "control.update",
    recordType: "control",
    recordId: current.id,
    organizationId: ctx.organizationId,
    transformationId,
    priorVersion: current.version,
    newVersion: updated.version,
    ...(retiring ? { reason: body.retireReason! } : {}),
    changes: diffFields(current, updated, CONTROL_AUDIT_FIELDS, ["next_check_date"]),
  });
  if (retiring) await cancelDueChecks(tx, ctx, transformationId, current.id, body.retireReason!);
}

/**
 * A retired control is checked no more: each of its `due` checks becomes `cancelled` (final; ADR-0034 §6), audited with
 * the retire reason, and its `control_check_due` work item is cancelled, so no task is left in the owner's My Work for
 * a control that no longer exists. Recorded (passed/failed) checks are final and stay as they are.
 */
async function cancelDueChecks(
  tx: Tx,
  ctx: Awaited<ReturnType<typeof openSustainmentWrite>>,
  transformationId: string,
  controlId: string,
  reason: string,
): Promise<void> {
  const cancelled = (await tx
    .updateTable("control_check")
    .set({
      status: "cancelled",
      version: sql<number>`version + 1`,
      updated_at: sql<Date>`now()`,
      updated_by: ctx.userId,
    })
    .where("control_id", "=", controlId)
    .where("transformation_id", "=", transformationId)
    .where("status", "=", "due")
    .returning(["id", "version"])
    .execute()) as { id: string; version: number }[];
  for (const check of cancelled) {
    await record(tx, ctx.audit, {
      action: "control_check.cancel",
      recordType: "control_check",
      recordId: check.id,
      organizationId: ctx.organizationId,
      transformationId,
      priorVersion: check.version - 1,
      newVersion: check.version,
      reason,
      changes: { status: { from: "due", to: "cancelled" } },
    });
    await closeWorkItemsOfSubject(
      tx,
      userActor(ctx),
      { organizationId: ctx.organizationId, subjectType: "control_check", subjectId: check.id },
      "cancelled",
    );
  }
}

/**
 * REQ-S11-008: records a due check as passed or failed. A failed check needs its result note (400 at /resultNote) and
 * writes, in this transaction, the `control_check.failed` outbox event with exactly the ADR-0031 §5.4 payload; its
 * idempotency key `control_check.failed:<checkId>` is unique, and a check is recorded once (`control_check.final`), so
 * slice E receives one event per failed check. The check's `control_check_due` work item is closed as done.
 */
async function recordCheck(tx: Tx, request: FastifyRequest, transformationId: string, checkId: string) {
  const ctx = await openSustainmentWrite(tx, request, transformationId, CONTROL_CHECK_RECORD_PERMISSION);
  const body = parseBody(controlCheckRecord, request.body);
  if (body.result === "failed" && body.resultNote === undefined) throw RESULT_NOTE_REQUIRED();
  const expected = requireIfMatch(request);
  const current = (await tx
    .selectFrom("control_check")
    .selectAll()
    .where("id", "=", checkId)
    .where("transformation_id", "=", transformationId)
    .forUpdate()
    .executeTakeFirst()) as CheckRow | undefined;
  if (!current) throw problems.notFound();
  if (current.version !== expected) throw problems.versionConflict(current.version);
  if (current.status !== "due") throw CHECK_FINAL(current.status);
  const updated = (await tx
    .updateTable("control_check")
    .set({
      status: body.result,
      performed_at: sql<Date>`now()`,
      performed_by: ctx.userId,
      result_note: body.resultNote ?? null,
      version: sql<number>`version + 1`,
      updated_at: sql<Date>`now()`,
      updated_by: ctx.userId,
    })
    .where("id", "=", current.id)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow()) as CheckRow;
  await record(tx, ctx.audit, {
    action: `control_check.${body.result}`,
    recordType: "control_check",
    recordId: current.id,
    organizationId: ctx.organizationId,
    transformationId,
    priorVersion: current.version,
    newVersion: updated.version,
    changes: diffFields(current, updated, ["status", "performed_by", "result_note"]),
  });
  await closeWorkItemsOfSubject(
    tx,
    userActor(ctx),
    { organizationId: ctx.organizationId, subjectType: "control_check", subjectId: current.id },
    "done",
  );
  if (body.result !== "failed") return;
  const control = await tx
    .selectFrom("control")
    .select(["name", "owner_user_id"])
    .where("id", "=", current.control_id)
    .executeTakeFirstOrThrow();
  const failedAt = updated.performed_at as Date;
  const payload: CheckFailedPayload = {
    checkId: current.id,
    checkRecordType: "control_check",
    transformationId,
    ownerUserId: control.owner_user_id,
    subjectLabel: control.name,
    failedAt: iso(failedAt),
    businessDate: await organizationBusinessDate(tx, ctx.organizationId, failedAt),
  };
  const schema = outboxPayloadSchema(CONTROL_CHECK_FAILED_EVENT, 1);
  if (!schema) throw new Error(`outbox: no schema for ${CONTROL_CHECK_FAILED_EVENT} v1`);
  await tx
    .insertInto("outbox_event")
    .values({
      id: uuidv7(),
      organization_id: ctx.organizationId,
      aggregate_type: "control_check",
      aggregate_id: current.id,
      event_type: CONTROL_CHECK_FAILED_EVENT,
      schema_version: 1,
      payload: JSON.stringify(schema.parse(payload)),
      idempotency_key: `${CONTROL_CHECK_FAILED_EVENT}:${current.id}`,
    })
    .execute();
}

/** Completes a due review: the assignee only (403 otherwise), with its outcome note and performance signal. */
async function completeReview(tx: Tx, request: FastifyRequest, transformationId: string, reviewId: string) {
  const ctx = await openSustainmentWrite(tx, request, transformationId, SUSTAINMENT_REVIEW_COMPLETE_PERMISSION);
  const body = parseBody(sustainmentReviewComplete, request.body);
  const expected = requireIfMatch(request);
  const current = await findReview(tx, transformationId, reviewId, true);
  if (current.assignee_user_id !== ctx.userId) throw NOT_ASSIGNEE();
  if (current.version !== expected) throw problems.versionConflict(current.version);
  if (current.status !== "due") throw REVIEW_FINAL(current.status);
  const updated = (await tx
    .updateTable("sustainment_review")
    .set({
      status: "done",
      completed_at: sql<Date>`now()`,
      completed_by: ctx.userId,
      outcome_note: body.outcomeNote,
      performance_signal: body.performanceSignal,
      version: sql<number>`version + 1`,
      updated_at: sql<Date>`now()`,
      updated_by: ctx.userId,
    })
    .where("id", "=", current.id)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow()) as ReviewRow;
  await record(tx, ctx.audit, {
    action: "sustainment_review.complete",
    recordType: "sustainment_review",
    recordId: current.id,
    organizationId: ctx.organizationId,
    transformationId,
    priorVersion: current.version,
    newVersion: updated.version,
    changes: diffFields(current, updated, ["status", "completed_by", "outcome_note", "performance_signal"]),
  });
  await closeWorkItemsOfSubject(
    tx,
    userActor(ctx),
    { organizationId: ctx.organizationId, subjectType: "sustainment_review", subjectId: current.id },
    "done",
  );
}

// ------------------------------------------------------------------------------------------------ routes

const controlParams = z.strictObject({ transformationId: z.uuid(), controlId: z.uuid() });
const checkParams = z.strictObject({ transformationId: z.uuid(), controlCheckId: z.uuid() });
const reviewParams = z.strictObject({ transformationId: z.uuid(), sustainmentReviewId: z.uuid() });

const controlListQuery = z.strictObject({
  cursor: cursorSchema,
  limit: limitSchema,
  performanceAreaId: z.uuid().optional(),
  status: z.enum(["active", "retired"]).optional(),
});
const checkListQuery = z.strictObject({
  cursor: cursorSchema,
  limit: limitSchema,
  performanceAreaId: z.uuid().optional(),
  status: z.enum(["due", "passed", "failed", "cancelled"]).optional(),
});
const reviewListQuery = z.strictObject({
  cursor: cursorSchema,
  limit: limitSchema,
  performanceAreaId: z.uuid().optional(),
  status: z.enum(["due", "done", "cancelled"]).optional(),
});

/** Registers this file's routes and returns them as "METHOD /path". */
export function registerControlRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  const read = { access: { permission: "transformation.read" as const } };
  const manage = { access: { permission: CONTROL_MANAGE }, consumes: JSON_BODY };
  const recordCfg = { access: { permission: CONTROL_CHECK_RECORD_PERMISSION }, consumes: JSON_BODY };
  const completeCfg = { access: { permission: SUSTAINMENT_REVIEW_COMPLETE_PERMISSION }, consumes: JSON_BODY };

  app.get(CONTROLS, { config: read }, async (request) => {
    const transformationId = parseTransformationParam(request.params);
    const query = parseQuery(controlListQuery, request.query);
    await requireTransformationRead(db, principalOf(request), transformationId);
    const hash = filterHash({
      table: "control",
      transformationId,
      performanceAreaId: query.performanceAreaId ?? null,
      status: query.status ?? null,
    });
    const after = decodeCursor(query.cursor, hash, 1);
    let q = db.selectFrom("control").selectAll().where("transformation_id", "=", transformationId);
    if (query.performanceAreaId !== undefined) q = q.where("performance_area_id", "=", query.performanceAreaId);
    if (query.status !== undefined) q = q.where("status", "=", query.status);
    if (after) q = q.where("id", ">", String(after[0]));
    const rows = (await q
      .orderBy("id")
      .limit(query.limit + 1)
      .execute()) as ControlRow[];
    const page = paginate(rows, query.limit, (r) => [r.id], hash);
    return { items: page.items.map(toControl), nextCursor: page.nextCursor };
  });

  app.post(CONTROLS, { config: manage }, async (request, reply) => {
    const transformationId = parseTransformationParam(request.params);
    const body = await db.transaction().execute(async (tx) => {
      const id = await createControl(tx, request);
      return toControl(await findControl(tx, transformationId, id));
    });
    return sendVersioned(reply, 201, body, `${request.url.split("?")[0]!}/${body.id}`);
  });

  app.patch(CONTROL_ITEM, { config: manage }, async (request, reply) => {
    const { transformationId, controlId } = parse(controlParams, request.params, "params");
    const body = await db.transaction().execute(async (tx) => {
      await updateControl(tx, request, transformationId, controlId);
      return toControl(await findControl(tx, transformationId, controlId));
    });
    return sendVersioned(reply, 200, body);
  });

  app.get(CONTROL_CHECKS, { config: read }, async (request) => {
    const transformationId = parseTransformationParam(request.params);
    const query = parseQuery(checkListQuery, request.query);
    await requireTransformationRead(db, principalOf(request), transformationId);
    const hash = filterHash({
      table: "control_check",
      transformationId,
      performanceAreaId: query.performanceAreaId ?? null,
      status: query.status ?? null,
    });
    const after = decodeCursor(query.cursor, hash, 1);
    let q = checksQuery(db, transformationId);
    if (query.performanceAreaId !== undefined) q = q.where("k.performance_area_id", "=", query.performanceAreaId);
    if (query.status !== undefined) q = q.where("k.status", "=", query.status);
    if (after) q = q.where("k.id", ">", String(after[0]));
    const rows = (await q
      .orderBy("k.id")
      .limit(query.limit + 1)
      .execute()) as CheckRow[];
    const page = paginate(rows, query.limit, (r) => [r.id], hash);
    return { items: page.items.map(toCheck), nextCursor: page.nextCursor };
  });

  app.post(CONTROL_CHECK_RECORD, { config: recordCfg }, async (request, reply) => {
    const { transformationId, controlCheckId } = parse(checkParams, request.params, "params");
    const body = await db.transaction().execute(async (tx) => {
      await recordCheck(tx, request, transformationId, controlCheckId);
      return presentCheck(tx, transformationId, controlCheckId);
    });
    return sendVersioned(reply, 200, body);
  });

  app.get(SUSTAINMENT_REVIEWS, { config: read }, async (request) => {
    const transformationId = parseTransformationParam(request.params);
    const query = parseQuery(reviewListQuery, request.query);
    await requireTransformationRead(db, principalOf(request), transformationId);
    const hash = filterHash({
      table: "sustainment_review",
      transformationId,
      performanceAreaId: query.performanceAreaId ?? null,
      status: query.status ?? null,
    });
    const after = decodeCursor(query.cursor, hash, 1);
    let q = db.selectFrom("sustainment_review").selectAll().where("transformation_id", "=", transformationId);
    if (query.performanceAreaId !== undefined) q = q.where("performance_area_id", "=", query.performanceAreaId);
    if (query.status !== undefined) q = q.where("status", "=", query.status);
    if (after) q = q.where("id", ">", String(after[0]));
    const rows = (await q
      .orderBy("id")
      .limit(query.limit + 1)
      .execute()) as ReviewRow[];
    const page = paginate(rows, query.limit, (r) => [r.id], hash);
    return { items: page.items.map(toReview), nextCursor: page.nextCursor };
  });

  app.post(SUSTAINMENT_REVIEW_COMPLETE, { config: completeCfg }, async (request, reply) => {
    const { transformationId, sustainmentReviewId } = parse(reviewParams, request.params, "params");
    const body = await db.transaction().execute(async (tx) => {
      await completeReview(tx, request, transformationId, sustainmentReviewId);
      return toReview(await findReview(tx, transformationId, sustainmentReviewId));
    });
    return sendVersioned(reply, 200, body);
  });

  return [
    `GET ${CONTROLS}`,
    `POST ${CONTROLS}`,
    `PATCH ${CONTROL_ITEM}`,
    `GET ${CONTROL_CHECKS}`,
    `POST ${CONTROL_CHECK_RECORD}`,
    `GET ${SUSTAINMENT_REVIEWS}`,
    `POST ${SUSTAINMENT_REVIEW_COMPLETE}`,
  ];
}
