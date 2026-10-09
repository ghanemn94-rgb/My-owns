// Corrective-action cases (recovery plans) of a transformation (P4 slice E; ADR-0031 §5, §6, §9-§11; T-DG4-BE-D2;
// REQ-PB-085, REQ-S12-016):
//   GET   /transformations/{t}/corrective-actions                         the cases, filters sourceKind, status,
//                                                                       ownerUserId (transformation.read)
//   POST  /transformations/{t}/corrective-actions                         a person's case for a Value Review finding
//                                                                       (B0093), with owner and follow-up date
//                                                                       (corrective_action.manage: TL, BO, FIN)
//   GET   /transformations/{t}/corrective-actions/{c}                     one case, with the benefit's lifecycle step
//   PATCH /transformations/{t}/corrective-actions/{c}                     recovery plan, owner, follow-up date, Open <->
//                                                                       In progress (If-Match)
//   POST  /transformations/{t}/corrective-actions/{c}/close               close with a note; final (If-Match)
//   GET   /transformations/{t}/corrective-actions/{c}/signals             the source signals, newest first
//   GET   /transformations/{t}/corrective-actions/{c}/actions             the actions linked to the case
//   POST  /transformations/{t}/corrective-actions/{c}/actions             an owned recovery action (BE-D's
//                                                                       createLinkedAction; action.edit or update_own)
//
// The four event-driven kinds are created and updated only by the worker (apps/worker/src/handlers/raid.ts; ADR-0031
// §5.4); people create Value Review cases and edit, assign and close every case. One case that is not closed per source:
// a second open case for the same finding is 409 corrective_case.already_open, decided under the correctiveCase advisory
// lock on `<transformationId>:<sourceKind>:<sourceScopeKey>` (the worker's lock) by the insert itself (ON CONFLICT on
// corrective_case_one_open_key DO NOTHING, then the open case's code is read; T-DG4-BE-R1), so this service is the only
// path that answers that refusal and it always names the real code. The owner gets one My Work item
// (corrective_case_follow_up, dedupe corrective.follow_up:<case>:<owner>, due = the follow-up date; ADR-0031 §5.6;
// system managed, so only the case closes it); an owner change cancels the previous owner's open item and opens the new
// owner's (A -> B -> A leaves one, for A), a follow-up date change moves its due date (T-DG4-BE-R1), and closing the
// case closes it. Refusals are exactly ADR-0031 §11 (S-11). Every mutation: the write gate re-checked at commit time
// (AUD 403; ADM-only and outsiders 404), validation, If-Match (428/409; creates are version 1), one audit event in the
// same transaction, no remote I/O. Closing a case records a person's judgement, never a G1-G6 business approval; a case
// never moves a benefit's lifecycle step (ADR-0031 §5.5). Nothing here touches DG0-DG7.
import { diffFields, sql, type CorrectiveCaseRow, type DbOrTx, type Tx } from "@mth/db";
import {
  correctiveCaseClose,
  correctiveCaseCreate,
  correctiveCaseStatus,
  correctiveCaseUpdate,
  correctiveSourceKind,
  raidActionCreate,
  type CorrectiveCase,
  type CorrectiveSignal,
} from "@mth/shared/schemas";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { principalOf, requireTransformationRead } from "../access/index.ts";
import { record } from "../audit/index.ts";
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
import { assertActiveUsers, openWrite, type WriteContext } from "../transformations/index.ts";
import { createLinkedAction, openActionCreate, todayOf, toRaidAction, type ActionRow } from "./actions.ts";
import { JSON_BODY, parseTransformationParam, raidRule } from "./register.ts";

export const CORRECTIVE_CASES = "/api/v1/transformations/:transformationId/corrective-actions";
export const CORRECTIVE_CASE_ITEM = `${CORRECTIVE_CASES}/:correctiveCaseId`;
export const CORRECTIVE_CASE_CLOSE = `${CORRECTIVE_CASE_ITEM}/close`;
export const CORRECTIVE_CASE_SIGNALS = `${CORRECTIVE_CASE_ITEM}/signals`;
export const CORRECTIVE_CASE_ACTIONS = `${CORRECTIVE_CASE_ITEM}/actions`;
export const CORRECTIVE_ACTION_MANAGE = "corrective_action.manage" as const;
export const CORRECTIVE_FOLLOW_UP_KIND = "corrective_case_follow_up";
export const CORRECTIVE_FOLLOW_UP_MESSAGE = "raid.task.corrective_follow_up";

// ------------------------------------------------------------------------------------------------ problems (ADR-0031 §11)

export const CASE_STATUS_TRANSITION = () =>
  raidRule(
    "corrective_case.status_transition",
    "A corrective action moves between Open and In progress; use Close to close it.",
  );
export const CASE_CLOSED = () =>
  raidRule("corrective_case.closed", "This corrective action is closed and can no longer be changed.");
export const CASE_OWNER_REQUIRED = () =>
  raidRule("corrective_case.owner_required", "Assign an owner before closing this corrective action.");
export const CASE_FOLLOW_UP_PAST = () =>
  raidRule("corrective_case.follow_up_past", "The follow-up date cannot be before today.", "/followUpDate");
export const CASE_ALREADY_OPEN = (code: string) =>
  problems.duplicate(
    "corrective_case.already_open",
    `An open corrective action already exists for this finding: ${code}.`,
  );

// ------------------------------------------------------------------------------------------------ presentation

const transformationParams = z.strictObject({ transformationId: z.uuid() });
const caseParams = z.strictObject({ transformationId: z.uuid(), correctiveCaseId: z.uuid() });

function parseCaseParams(params: unknown): { transformationId: string; correctiveCaseId: string } {
  return parse(caseParams, params, "params");
}

const dateOrNull = (d: string | null): string | null => (d === null ? null : String(d).slice(0, 10));

/** The case rows as API bodies; a benefit case shows the benefit's current lifecycle step (read only). */
export async function presentCases(db: DbOrTx, rows: readonly CorrectiveCaseRow[]): Promise<CorrectiveCase[]> {
  const benefitIds = [...new Set(rows.map((r) => r.benefit_id).filter((x): x is string => x !== null))];
  const steps = new Map(
    benefitIds.length === 0
      ? []
      : (await db.selectFrom("benefit").select(["id", "lifecycle_step"]).where("id", "in", benefitIds).execute()).map(
          (b) => [b.id, b.lifecycle_step] as const,
        ),
  );
  return rows.map((r) => ({
    id: r.id,
    transformationId: r.transformation_id,
    code: r.code,
    sourceKind: r.source_kind as CorrectiveCase["sourceKind"],
    sourceScopeKey: r.source_scope_key,
    kpiDefinitionId: r.kpi_definition_id,
    kpiScopeKind: r.kpi_scope_kind as CorrectiveCase["kpiScopeKind"],
    kpiScopeId: r.kpi_scope_id,
    benefitId: r.benefit_id,
    benefitLifecycleStep: r.benefit_id === null ? null : (steps.get(r.benefit_id) ?? null),
    sourceRecordType: r.source_record_type,
    sourceRecordId: r.source_record_id,
    title: r.title,
    recoveryPlan: r.recovery_plan,
    ownerUserId: r.owner_user_id,
    ownerStatus: r.owner_user_id === null ? "unassigned" : "assigned",
    followUpDate: dateOrNull(r.follow_up_date),
    // A missing follow-up date has one cause: no active default calendar when it was computed (ADR-0031 §5.4).
    followUpUnknownReason: r.follow_up_date === null ? "calendar_not_configured" : null,
    status: r.status as CorrectiveCase["status"],
    consecutiveOffTrack: r.consecutive_off_track,
    signalCount: r.signal_count,
    lastSignalAt: isoOrNull(r.last_signal_at),
    closedAt: isoOrNull(r.closed_at),
    closedBy: r.closed_by,
    closureNote: r.closure_note,
    createdSource: r.created_source as CorrectiveCase["createdSource"],
    version: r.version,
    createdAt: iso(r.created_at),
    createdBy: r.created_by,
    updatedAt: iso(r.updated_at),
    updatedBy: r.updated_by,
  }));
}

function caseRow(db: DbOrTx, transformationId: string, id: string): Promise<CorrectiveCaseRow | undefined> {
  return db
    .selectFrom("corrective_case")
    .selectAll()
    .where("id", "=", id)
    .where("transformation_id", "=", transformationId)
    .executeTakeFirst();
}

async function presentOne(db: DbOrTx, transformationId: string, id: string): Promise<CorrectiveCase> {
  const row = await caseRow(db, transformationId, id);
  if (!row) throw problems.notFound();
  return (await presentCases(db, [row]))[0]!;
}

// ------------------------------------------------------------------------------------------------ writes

export const CASE_AUDIT_FIELDS = [
  "code",
  "source_kind",
  "source_scope_key",
  "title",
  "recovery_plan",
  "owner_user_id",
  "follow_up_date",
  "status",
  "closure_note",
] as const satisfies readonly (keyof CorrectiveCaseRow & string)[];

const userActor = (ctx: WriteContext) =>
  ({ actorType: "user", actorUserId: ctx.userId, requestId: ctx.audit.requestId, source: "api" }) as const;

/** The write gate: the read gate first (ADM-only and outsiders 404), then corrective_action.manage at commit time. */
async function openCaseWrite(tx: Tx, request: FastifyRequest, transformationId: string): Promise<WriteContext> {
  await requireTransformationRead(tx, principalOf(request), transformationId);
  return openWrite(tx, request, transformationId, [{ permission: CORRECTIVE_ACTION_MANAGE }], null, {
    atCommit: true,
  });
}

/** ADR-0031 §5.4: the per-source lock, the same one the worker's consumers take, before the open case is read. */
export async function lockCorrectiveScope(tx: Tx, transformationId: string, kind: string, scopeKey: string) {
  await sql`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK_CLASSES.correctiveCase}::int4,
    hashtext(${`${transformationId}:${kind}:${scopeKey}`}))`.execute(tx);
}

/** CA-01 from record_code_counter (prefix CA); a concurrent allocation serialises on the counter row. */
async function nextCaseCode(tx: Tx, transformationId: string): Promise<string> {
  const row = await sql<{ last_value: number }>`
    INSERT INTO record_code_counter (transformation_id, prefix, last_value) VALUES (${transformationId}::uuid, 'CA', 1)
    ON CONFLICT (transformation_id, prefix) DO UPDATE SET last_value = record_code_counter.last_value + 1
    RETURNING last_value`.execute(tx);
  return `CA-${String(row.rows[0]!.last_value).padStart(2, "0")}`;
}

/** The owner's follow-up item (ADR-0031 §5.6): one per case and owner; a returning owner's key gets `#n`. */
function followUpInput(ctx: WriteContext, row: CorrectiveCaseRow, ownerUserId: string): WorkItemInput {
  return {
    organizationId: ctx.organizationId,
    transformationId: ctx.transformationId,
    kind: CORRECTIVE_FOLLOW_UP_KIND,
    assigneeUserId: ownerUserId,
    subjectType: "corrective_case",
    subjectId: row.id,
    linkPath: `/transformations/${ctx.transformationId}/corrective-actions/${row.id}`,
    messageKey: CORRECTIVE_FOLLOW_UP_MESSAGE,
    messageParams: { caseCode: row.code },
    dueDate: dateOrNull(row.follow_up_date),
    dedupeKey: `corrective.follow_up:${row.id}:${ownerUserId}`,
  };
}

/** The owner's follow-up item (ADR-0031 §5.6); none without an owner (unassigned is shown, never skipped silently). */
async function assignFollowUp(ctx: WriteContext, row: CorrectiveCaseRow): Promise<void> {
  if (row.owner_user_id === null || row.status === "closed") return;
  await createWorkItemOnce(ctx.tx, userActor(ctx), followUpInput(ctx, row, row.owner_user_id));
}

/**
 * The open case's follow-up follows it (T-DG4-BE-R1; ADR-0031 §5.5-§5.6): an owner change moves it to the new owner
 * (the previous owner's open item is cancelled; A -> B -> A leaves one open item, for A), a follow-up date change moves
 * its due date.
 */
async function followFollowUp(ctx: WriteContext, before: CorrectiveCaseRow, after: CorrectiveCaseRow): Promise<void> {
  if (after.status === "closed") return;
  if (after.owner_user_id !== before.owner_user_id) {
    if (after.owner_user_id === null) await closeFollowUps(ctx, after.id, "cancelled");
    else await reassignWorkItemOfSubject(ctx.tx, userActor(ctx), followUpInput(ctx, after, after.owner_user_id));
  }
  if (dateOrNull(after.follow_up_date) !== dateOrNull(before.follow_up_date))
    await rescheduleWorkItemsOfSubject(
      ctx.tx,
      userActor(ctx),
      {
        organizationId: ctx.organizationId,
        subjectType: "corrective_case",
        subjectId: after.id,
        kinds: [CORRECTIVE_FOLLOW_UP_KIND],
      },
      dateOrNull(after.follow_up_date),
    );
}

function closeFollowUps(ctx: WriteContext, caseId: string, status: "done" | "cancelled"): Promise<number> {
  return closeWorkItemsOfSubject(
    ctx.tx,
    userActor(ctx),
    {
      organizationId: ctx.organizationId,
      subjectType: "corrective_case",
      subjectId: caseId,
      kinds: [CORRECTIVE_FOLLOW_UP_KIND],
    },
    status,
  );
}

/** The scope key of a Value Review finding: `value_review:` + the trimmed, lower-cased reference (ADR-0031 §5.5). */
export function valueReviewScopeKey(findingRef: string): string {
  return `value_review:${findingRef.trim().toLowerCase()}`;
}

async function createCase(tx: Tx, request: FastifyRequest): Promise<string> {
  const transformationId = parseTransformationParam(request.params);
  const ctx = await openCaseWrite(tx, request, transformationId);
  const body = parseBody(correctiveCaseCreate, request.body);
  if (body.followUpDate < (await todayOf(tx, ctx.organizationId))) throw CASE_FOLLOW_UP_PAST();
  await assertActiveUsers(tx, ctx.organizationId, [{ id: body.ownerUserId, pointer: "/ownerUserId" }]);
  const scopeKey = valueReviewScopeKey(body.findingRef);
  await lockCorrectiveScope(tx, transformationId, "value_review", scopeKey);
  const id = uuidv7();
  const row = await tx
    .insertInto("corrective_case")
    .values({
      id,
      organization_id: ctx.organizationId,
      transformation_id: transformationId,
      code: await nextCaseCode(tx, transformationId),
      source_kind: "value_review",
      source_scope_key: scopeKey,
      title: body.title,
      recovery_plan: body.recoveryPlan ?? null,
      owner_user_id: body.ownerUserId,
      follow_up_date: body.followUpDate,
      created_source: "api",
      created_by: ctx.userId,
      updated_by: ctx.userId,
    })
    // T-DG4-BE-R1 (BE-D2 handback §4): the one-open-case rule is decided here, so the refusal always names the open
    // case's code; corrective_case_one_open_key never reaches the database mapper from this path.
    .onConflict((oc) =>
      oc.columns(["transformation_id", "source_kind", "source_scope_key"]).where("status", "<>", "closed").doNothing(),
    )
    .returningAll()
    .executeTakeFirst();
  if (!row) {
    const open = await tx
      .selectFrom("corrective_case")
      .select("code")
      .where("transformation_id", "=", transformationId)
      .where("source_kind", "=", "value_review")
      .where("source_scope_key", "=", scopeKey)
      .where("status", "<>", "closed")
      .executeTakeFirst();
    if (!open) throw problems.internal();
    throw CASE_ALREADY_OPEN(open.code);
  }
  await record(tx, ctx.audit, {
    action: "corrective_case.created",
    recordType: "corrective_case",
    recordId: id,
    organizationId: ctx.organizationId,
    transformationId,
    newVersion: row.version,
    changes: diffFields({} as CorrectiveCaseRow, row, [...CASE_AUDIT_FIELDS]),
  });
  await assignFollowUp(ctx, row);
  return id;
}

async function lockCase(tx: Tx, transformationId: string, id: string): Promise<CorrectiveCaseRow> {
  const current = await tx
    .selectFrom("corrective_case")
    .selectAll()
    .where("id", "=", id)
    .where("transformation_id", "=", transformationId)
    .forUpdate()
    .executeTakeFirst();
  if (!current) throw problems.notFound();
  return current;
}

/** A body asking for `status: "closed"` is the ADR-0031 §11 transition refusal (Close is its own operation). */
function refuseCloseByPatch(body: unknown): void {
  if (body !== null && typeof body === "object" && (body as { status?: unknown }).status === "closed")
    throw CASE_STATUS_TRANSITION();
}

async function updateCase(tx: Tx, request: FastifyRequest): Promise<void> {
  const { transformationId, correctiveCaseId } = parseCaseParams(request.params);
  const ctx = await openCaseWrite(tx, request, transformationId);
  refuseCloseByPatch(request.body);
  const body = parseBody(correctiveCaseUpdate, request.body);
  const expected = requireIfMatch(request);
  const current = await lockCase(tx, transformationId, correctiveCaseId);
  if (current.version !== expected) throw problems.versionConflict(current.version);
  if (current.status === "closed") throw CASE_CLOSED();
  if (body.followUpDate !== undefined && body.followUpDate < (await todayOf(tx, ctx.organizationId)))
    throw CASE_FOLLOW_UP_PAST();
  await assertActiveUsers(tx, ctx.organizationId, [{ id: body.ownerUserId, pointer: "/ownerUserId" }]);
  const updated = await tx
    .updateTable("corrective_case")
    .set({
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.recoveryPlan !== undefined ? { recovery_plan: body.recoveryPlan } : {}),
      ...(body.ownerUserId !== undefined ? { owner_user_id: body.ownerUserId } : {}),
      ...(body.followUpDate !== undefined
        ? { follow_up_date: body.followUpDate, follow_up_calendar_id: null, follow_up_calendar_version: null }
        : {}),
      ...(body.status !== undefined ? { status: body.status } : {}),
      version: sql<number>`version + 1`,
      updated_at: sql<Date>`now()`,
      updated_by: ctx.userId,
    })
    .where("id", "=", current.id)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: "corrective_case.updated",
    recordType: "corrective_case",
    recordId: current.id,
    organizationId: ctx.organizationId,
    transformationId,
    priorVersion: current.version,
    newVersion: updated.version,
    changes: diffFields(current, updated, [...CASE_AUDIT_FIELDS]),
  });
  // ADR-0031 §5.5: an owner change cancels the previous owner's open item and creates the new owner's; a follow-up
  // date change moves the open item's due date (T-DG4-BE-R1).
  await followFollowUp(ctx, current, updated);
}

async function closeCase(tx: Tx, request: FastifyRequest): Promise<void> {
  const { transformationId, correctiveCaseId } = parseCaseParams(request.params);
  const ctx = await openCaseWrite(tx, request, transformationId);
  const { closureNote } = parseBody(correctiveCaseClose, request.body);
  const expected = requireIfMatch(request);
  const current = await lockCase(tx, transformationId, correctiveCaseId);
  if (current.version !== expected) throw problems.versionConflict(current.version);
  if (current.status === "closed") throw CASE_CLOSED();
  if (current.owner_user_id === null) throw CASE_OWNER_REQUIRED();
  const updated = await tx
    .updateTable("corrective_case")
    .set({
      status: "closed",
      closed_at: sql<Date>`now()`,
      closed_by: ctx.userId,
      closure_note: closureNote,
      version: sql<number>`version + 1`,
      updated_at: sql<Date>`now()`,
      updated_by: ctx.userId,
    })
    .where("id", "=", current.id)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: "corrective_case.closed",
    recordType: "corrective_case",
    recordId: current.id,
    organizationId: ctx.organizationId,
    transformationId,
    priorVersion: current.version,
    newVersion: updated.version,
    reason: closureNote,
    changes: diffFields(current, updated, [...CASE_AUDIT_FIELDS]),
  });
  // The follow-up item closes with the case (ADR-0031 §5.6, the subject-bound rule of ADR-0025 §4).
  await closeFollowUps(ctx, current.id, "done");
}

/** The case an action links to, locked FOR SHARE (a concurrent close waits); 404 outside, 422 when closed. */
async function lockActionSource(tx: Tx, transformationId: string, id: string): Promise<{ id: string; code: string }> {
  const c = await tx
    .selectFrom("corrective_case")
    .select(["id", "code", "status"])
    .where("id", "=", id)
    .where("transformation_id", "=", transformationId)
    .forShare()
    .executeTakeFirst();
  if (!c) throw problems.notFound();
  if (c.status === "closed") throw CASE_CLOSED();
  return { id: c.id, code: c.code };
}

async function createCaseAction(tx: Tx, request: FastifyRequest): Promise<ActionRow> {
  const { transformationId, correctiveCaseId } = parseCaseParams(request.params);
  const ctx = await openActionCreate(tx, request, transformationId);
  const body = parseBody(raidActionCreate, request.body);
  const source = await lockActionSource(tx, transformationId, correctiveCaseId);
  return createLinkedAction(ctx, { correctiveCaseId: source.id, code: source.code }, body);
}

// ------------------------------------------------------------------------------------------------ routes

const listQuery = z.strictObject({
  cursor: cursorSchema,
  limit: limitSchema,
  sourceKind: correctiveSourceKind.optional(),
  status: correctiveCaseStatus.optional(),
  ownerUserId: z.uuid().optional(),
});
const pageQuery = z.strictObject({ cursor: cursorSchema, limit: limitSchema });

async function organizationOf(db: DbOrTx, transformationId: string): Promise<string> {
  const t = await db
    .selectFrom("transformation")
    .select("organization_id")
    .where("id", "=", transformationId)
    .executeTakeFirstOrThrow();
  return t.organization_id;
}

/** 404 unless the case is in the transformation (the read gate has passed). */
async function requireCase(db: DbOrTx, transformationId: string, id: string): Promise<void> {
  const row = await db
    .selectFrom("corrective_case")
    .select("id")
    .where("id", "=", id)
    .where("transformation_id", "=", transformationId)
    .executeTakeFirst();
  if (!row) throw problems.notFound();
}

export function registerCorrectiveCaseRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  const read = { access: { permission: "transformation.read" as const } };
  const write = { access: { permission: CORRECTIVE_ACTION_MANAGE }, consumes: JSON_BODY };
  const actionWrite = { access: { permission: "action.edit" as const }, consumes: JSON_BODY };

  app.get(CORRECTIVE_CASES, { config: read }, async (request) => {
    const { transformationId } = parse(transformationParams, request.params, "params");
    const query = parseQuery(listQuery, request.query);
    await requireTransformationRead(db, principalOf(request), transformationId);
    const hash = filterHash({
      table: "corrective_case",
      transformationId,
      sourceKind: query.sourceKind ?? null,
      status: query.status ?? null,
      ownerUserId: query.ownerUserId ?? null,
    });
    const after = decodeCursor(query.cursor, hash, 1);
    let q = db.selectFrom("corrective_case").selectAll().where("transformation_id", "=", transformationId);
    if (query.sourceKind !== undefined) q = q.where("source_kind", "=", query.sourceKind);
    if (query.status !== undefined) q = q.where("status", "=", query.status);
    if (query.ownerUserId !== undefined) q = q.where("owner_user_id", "=", query.ownerUserId);
    if (after) q = q.where("id", ">", String(after[0]));
    const rows = await q
      .orderBy("id")
      .limit(query.limit + 1)
      .execute();
    const page = paginate(rows, query.limit, (r) => [r.id], hash);
    return { items: await presentCases(db, page.items), nextCursor: page.nextCursor };
  });

  app.post(CORRECTIVE_CASES, { config: write }, async (request, reply) => {
    const transformationId = parseTransformationParam(request.params);
    const body = await db.transaction().execute(async (tx) => {
      const id = await createCase(tx, request);
      return presentOne(tx, transformationId, id);
    });
    return sendVersioned(reply, 201, body, `${request.url.split("?")[0]!}/${body.id}`);
  });

  app.get(CORRECTIVE_CASE_ITEM, { config: read }, async (request, reply) => {
    const { transformationId, correctiveCaseId } = parseCaseParams(request.params);
    await requireTransformationRead(db, principalOf(request), transformationId);
    return sendVersioned(reply, 200, await presentOne(db, transformationId, correctiveCaseId));
  });

  app.patch(CORRECTIVE_CASE_ITEM, { config: write }, async (request, reply) => {
    const { transformationId, correctiveCaseId } = parseCaseParams(request.params);
    const body = await db.transaction().execute(async (tx) => {
      await updateCase(tx, request);
      return presentOne(tx, transformationId, correctiveCaseId);
    });
    return sendVersioned(reply, 200, body);
  });

  app.post(CORRECTIVE_CASE_CLOSE, { config: write }, async (request, reply) => {
    const { transformationId, correctiveCaseId } = parseCaseParams(request.params);
    const body = await db.transaction().execute(async (tx) => {
      await closeCase(tx, request);
      return presentOne(tx, transformationId, correctiveCaseId);
    });
    return sendVersioned(reply, 200, body);
  });

  app.get(CORRECTIVE_CASE_SIGNALS, { config: read }, async (request) => {
    const { transformationId, correctiveCaseId } = parseCaseParams(request.params);
    const query = parseQuery(pageQuery, request.query);
    await requireTransformationRead(db, principalOf(request), transformationId);
    await requireCase(db, transformationId, correctiveCaseId);
    const hash = filterHash({ table: "corrective_signal", transformationId, correctiveCaseId });
    const after = decodeCursor(query.cursor, hash, 2);
    let q = db
      .selectFrom("corrective_signal")
      .selectAll()
      // The cursor keeps the full microsecond receipt time (an ISO string in milliseconds could skip a row).
      .select(sql<string>`to_char(received_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US')`.as("received_key"))
      .where("transformation_id", "=", transformationId)
      .where("corrective_case_id", "=", correctiveCaseId);
    if (after) {
      const at = String(after[0]);
      const id = String(after[1]);
      q = q.where(sql<boolean>`(received_at, id) < ((${at}::timestamp AT TIME ZONE 'UTC'), ${id}::uuid)`);
    }
    // Newest first: by receipt time, then id.
    const rows = await q
      .orderBy("received_at", "desc")
      .orderBy("id", "desc")
      .limit(query.limit + 1)
      .execute();
    const page = paginate(rows, query.limit, (r) => [r.received_key, r.id], hash);
    return {
      items: page.items.map(
        (r): CorrectiveSignal => ({
          id: r.id,
          sourceKind: r.source_kind as CorrectiveSignal["sourceKind"],
          sourceEventKey: r.source_event_key,
          periodKey: r.period_key,
          periodStart: dateOrNull(r.period_start),
          periodEnd: dateOrNull(r.period_end),
          observedRag: r.observed_rag as CorrectiveSignal["observedRag"],
          offTrack: r.off_track,
          rulePersistence: r.rule_persistence,
          consecutiveOffTrack: r.consecutive_off_track,
          outcome: r.outcome as CorrectiveSignal["outcome"],
          correctiveCaseId: r.corrective_case_id,
          receivedAt: iso(r.received_at),
        }),
      ),
      nextCursor: page.nextCursor,
    };
  });

  app.get(CORRECTIVE_CASE_ACTIONS, { config: read }, async (request) => {
    const { transformationId, correctiveCaseId } = parseCaseParams(request.params);
    const query = parseQuery(pageQuery, request.query);
    await requireTransformationRead(db, principalOf(request), transformationId);
    await requireCase(db, transformationId, correctiveCaseId);
    const hash = filterHash({ table: "action_item", transformationId, correctiveCaseId });
    const after = decodeCursor(query.cursor, hash, 1);
    let q = db
      .selectFrom("action_item")
      .selectAll()
      .where("transformation_id", "=", transformationId)
      .where("corrective_case_id", "=", correctiveCaseId);
    if (after) q = q.where("id", ">", String(after[0]));
    const rows = await q
      .orderBy("id")
      .limit(query.limit + 1)
      .execute();
    const page = paginate(rows, query.limit, (r) => [r.id], hash);
    const today = await todayOf(db, await organizationOf(db, transformationId));
    return { items: page.items.map((r) => toRaidAction(r, today)), nextCursor: page.nextCursor };
  });

  app.post(CORRECTIVE_CASE_ACTIONS, { config: actionWrite }, async (request, reply) => {
    const { body, location } = await db.transaction().execute(async (tx) => {
      const row = await createCaseAction(tx, request);
      const today = await todayOf(tx, row.organization_id);
      return {
        body: toRaidAction(row, today),
        location: `/api/v1/transformations/${row.transformation_id}/action-register/${row.id}`,
      };
    });
    return sendVersioned(reply, 201, body, location);
  });

  return [
    `GET ${CORRECTIVE_CASES}`,
    `POST ${CORRECTIVE_CASES}`,
    `GET ${CORRECTIVE_CASE_ITEM}`,
    `PATCH ${CORRECTIVE_CASE_ITEM}`,
    `POST ${CORRECTIVE_CASE_CLOSE}`,
    `GET ${CORRECTIVE_CASE_SIGNALS}`,
    `GET ${CORRECTIVE_CASE_ACTIONS}`,
    `POST ${CORRECTIVE_CASE_ACTIONS}`,
  ];
}
