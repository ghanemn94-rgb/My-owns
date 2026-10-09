// Gate exceptions (waivers) for one missing mandatory criterion (T-DG4-BE-K2; ADR-0035 §4, §8, §9, §11; REQ-S04-012,
// REQ-S04-013; D-089 Q2; p4-work-split §H H.2):
//   GET  /transformations/{id}/gate-exceptions[?gateCode=&status=]          exceptions with today's coverage
//   POST /transformations/{id}/gate-exceptions                              request one (gate_exception.request; TL)
//   GET  /transformations/{id}/gate-exceptions/{gateExceptionId}            one exception
//   POST /transformations/{id}/gate-exceptions/{gateExceptionId}/decision   accept / reject (gate_exception.decide)
//   POST /transformations/{id}/gate-exceptions/{gateExceptionId}/withdraw   the requester withdraws a pending one
//   POST /transformations/{id}/gate-exceptions/{gateExceptionId}/revoke     revoke an accepted one (gate_exception.decide)
//
// An exception records the five REQ-S04-013 fields (reason, scope, approver = decided_by, expiry, compensating action
// with its owner). It is decided by a PERSON: the gate's configured approver (the DG2 isGateApprover rule, or one hop of
// delegation per D-089 Q3), never the requester (CHECK gate_exception_decider_not_requester as well), and never a
// technical admin (D-094: an ADM-only caller gets 403). Coverage is a DATE comparison in the transformation's timezone:
// an accepted exception covers its criterion on business date d when d <= expires_on, so on the day after expiry the
// criterion is missing again whether or not the expiry scan (worker gate.exception_expiry_scan) has run. Nothing here
// approves a gate, and nothing reads or writes the engineering delivery gates DG0-DG7.
import { sql, type DbOrTx, type GateExceptionRow, type Tx } from "@mth/db";
import { PROBLEM_TYPES } from "@mth/shared";
import { businessDateOf } from "@mth/shared/time";
import {
  gateExceptionCreate,
  gateExceptionDecision,
  gateExceptionRevoke,
  hasInvalidCharacter,
  hasText,
  type GateException,
} from "@mth/shared/schemas";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import {
  actsFor,
  denialOf,
  grantApplies,
  loadGrants,
  principalOf,
  requireTransformationRead,
  type Principal,
  type ResolvedTarget,
} from "../access/index.ts";
import { record, type AuditContext } from "../audit/index.ts";
import {
  ADVISORY_LOCK_CLASSES,
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
import { closeWorkItemsOfSubject, createWorkItemOnce } from "../tasks/index.ts";
import { assertActiveUsers, bumpStamps, openWrite, type WriteContext } from "../transformations/index.ts";
import { isGateApprover } from "./gates.ts";

const T_BASE = "/api/v1/transformations/:transformationId";
export const GATE_EXCEPTIONS = `${T_BASE}/gate-exceptions`;
export const GATE_EXCEPTION = `${GATE_EXCEPTIONS}/:gateExceptionId`;
const JSON_BODY = ["application/json"] as const;

/** Work-item kinds (0053) and message keys (translated at render time, S-6). */
export const GATE_EXCEPTION_TO_DECIDE_KIND = "gate_exception_to_decide";
export const GATE_EXCEPTION_TO_DECIDE_MESSAGE = "gates.task.gate_exception_to_decide";
/** The delegation record type that lets a delegate decide an exception for the configured approver (one hop). */
export const GATE_EXCEPTION_RECORD_TYPE = "gate_exception";

const tParams = z.strictObject({ transformationId: z.uuid() });
const eParams = z.strictObject({ transformationId: z.uuid(), gateExceptionId: z.uuid() });

// ------------------------------------------------------------------------------------------------ the business clock

/**
 * The instant the exception rules treat as "now". Production never sets it: the database clock (`now()`) is used, the
 * same one the 0051 trigger gate_submission_criterion_exception_valid reads. Tests inject a later instant to prove
 * expiry without waiting a day (p4-work-split §H H.2 "clock injected"); the database trigger still reads its own
 * clock, which can only be earlier, so an injected clock can make the API stricter, never laxer.
 */
let injectedClock: (() => Date) | null = null;

/** Test hook: inject the instant the exception rules read (null restores the database clock). */
export function setGateExceptionClock(clock: (() => Date) | null): void {
  injectedClock = clock;
}

/** Today's business date (YYYY-MM-DD) in the transformation's timezone (ADR-0025 §2; ADR-0035 §4). */
export async function exceptionBusinessDate(db: DbOrTx, transformationId: string): Promise<string> {
  const t = await db
    .selectFrom("transformation")
    .select("timezone")
    .where("id", "=", transformationId)
    .executeTakeFirst();
  if (!t) throw problems.notFound();
  if (injectedClock !== null) return businessDateOf(injectedClock(), t.timezone);
  const r = await sql<{ d: string }>`SELECT p4_business_date(now(), ${t.timezone}::text)::text AS d`.execute(db);
  return r.rows[0]!.d;
}

// ------------------------------------------------------------------------------------------------ shapes

const dateText = (d: string | Date): string => (typeof d === "string" ? d.slice(0, 10) : iso(d).slice(0, 10));

/** Covering on `today`: accepted and today <= expires_on (a date comparison; ISO dates compare as strings). */
export const covers = (r: Pick<GateExceptionRow, "status" | "expires_on">, today: string): boolean =>
  r.status === "accepted" && today <= dateText(r.expires_on);

export const toGateException = (r: GateExceptionRow, today: string): GateException => ({
  id: r.id,
  transformationId: r.transformation_id,
  gateInstanceId: r.gate_instance_id,
  gateCode: r.gate_code,
  criterionKey: r.criterion_key,
  reason: r.reason,
  scope: r.scope,
  compensatingAction: r.compensating_action,
  compensatingOwnerUserId: r.compensating_owner_user_id,
  expiresOn: dateText(r.expires_on),
  status: r.status as GateException["status"],
  covering: covers(r, today),
  requestedBy: r.requested_by,
  requestedAt: iso(r.requested_at),
  decidedBy: r.decided_by,
  decidedOnBehalfOf: r.decided_on_behalf_of,
  decidedAt: isoOrNull(r.decided_at),
  decisionNote: r.decision_note,
  revokedBy: r.revoked_by,
  revokedAt: isoOrNull(r.revoked_at),
  revokeReason: r.revoke_reason,
  expiryNotifiedAt: isoOrNull(r.expiry_notified_at),
  version: r.version,
  createdAt: iso(r.created_at),
  createdBy: r.created_by,
  updatedAt: iso(r.updated_at),
  updatedBy: r.updated_by,
});

// ------------------------------------------------------------------------------------------------ refusals (ADR-0035 §11)

const forbidden = (code: string, detail: string) =>
  new HttpProblem({ status: 403, type: PROBLEM_TYPES.forbidden, code, title: "Forbidden", detail });
const rule = (code: string, detail: string, pointer: string) =>
  new HttpProblem({
    status: 422,
    type: PROBLEM_TYPES.validation,
    code,
    title: "Business rule violated",
    detail,
    errors: [{ pointer, code, message: detail }],
  });
const invalidTransition = (code: string, detail: string) =>
  new HttpProblem({ status: 422, type: PROBLEM_TYPES.invalidTransition, code, title: "Invalid transition", detail });

export const gateExceptionRefusals = {
  criterionNotMandatory: () =>
    rule(
      "gate_exception.criterion_not_mandatory",
      "An exception can only cover a mandatory criterion of this gate.",
      "/criterionKey",
    ),
  alreadyPending: () =>
    problems.duplicate(
      "gate_exception.already_pending",
      "An exception for this criterion is already awaiting a decision.",
    ),
  expiryInPast: () => rule("gate_exception.expiry_in_past", "The expiry date must be today or later.", "/expiresOn"),
  notApprover: () =>
    forbidden("gate_exception.not_approver", "Only the configured approver of this gate can decide its exceptions."),
  requesterCannotDecide: () =>
    forbidden("gate_exception.requester_cannot_decide", "The requester cannot decide their own exception."),
  notPending: () =>
    invalidTransition("gate_exception.not_pending", "Only a pending exception can be decided or withdrawn."),
  notAccepted: () => invalidTransition("gate_exception.not_accepted", "Only an accepted exception can be revoked."),
  revokeReasonRequired: () =>
    problems.badRequest(
      "gate_exception.revoke_reason_required",
      "A reason is required to revoke an exception.",
      "/reason",
    ),
  /** The decision-time refusal of a G-approval whose snapshot records an exception that has since expired (§4). */
  expired: (label: string, date: string) =>
    problems.businessRule(
      "gate.exception_expired",
      `The exception for ${label} expired on ${date}; it no longer covers the missing evidence.`,
    ),
} as const;

// ------------------------------------------------------------------------------------------------ coverage

/** Takes the gate-instance exception lock (ADVISORY_LOCK_CLASSES.gateException) in `tx` (request, decide, revoke, and the covering submission). */
export async function lockGateExceptions(tx: Tx, gateInstanceId: string): Promise<void> {
  await sql`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK_CLASSES.gateException}::integer, hashtext(${gateInstanceId}::text))`.execute(
    tx,
  );
}

/**
 * The accepted exceptions of a gate instance that cover their criterion on `businessDate` (expires_on >= the date),
 * one per criterion key (the one that runs longest, then the newest). No lock: the read-only gate view uses it.
 */
export async function coveringExceptions(
  db: DbOrTx,
  gateInstanceId: string,
  businessDate: string,
): Promise<Map<string, GateExceptionRow>> {
  const rows = await db
    .selectFrom("gate_exception")
    .selectAll()
    .where("gate_instance_id", "=", gateInstanceId)
    .where("status", "=", "accepted")
    .where(sql<boolean>`expires_on >= ${businessDate}::date`)
    .orderBy("criterion_key")
    .orderBy("expires_on", "desc")
    .orderBy("id", "desc")
    .execute();
  const byKey = new Map<string, GateExceptionRow>();
  for (const r of rows) if (!byKey.has(r.criterion_key)) byKey.set(r.criterion_key, r);
  return byKey;
}

/**
 * What submitGate calls (ADR-0035 §4): under the gateException advisory lock (key = the gate instance), the covering exceptions of the
 * instance on `businessDate`, by criterion key. A request, decision or revocation of the same instance waits for the
 * submission's transaction, so the exception a submission records cannot change underneath it.
 */
export async function coveringExceptionsInTx(
  tx: Tx,
  gateInstanceId: string,
  businessDate: string,
): Promise<Map<string, GateExceptionRow>> {
  await lockGateExceptions(tx, gateInstanceId);
  return coveringExceptions(tx, gateInstanceId, businessDate);
}

/** The snapshot member of a covered criterion (ADR-0035 §4). */
export const exceptionSnapshotOf = (e: GateExceptionRow) => ({
  id: e.id,
  reason: e.reason,
  scope: e.scope,
  compensatingAction: e.compensating_action,
  compensatingOwnerUserId: e.compensating_owner_user_id,
  expiresOn: dateText(e.expires_on),
  decidedBy: e.decided_by,
  decidedAt: isoOrNull(e.decided_at),
});

// ------------------------------------------------------------------------------------------------ approver rule

/** The configured approver of the transformation's gate: a named user, or the approver role (DG2 gate_instance). */
async function gateApproverConfig(db: DbOrTx, transformationId: string, gateCode: string) {
  const instance = await db
    .selectFrom("gate_instance")
    .select(["id", "approver_role_code", "approver_user_id"])
    .where("transformation_id", "=", transformationId)
    .where("gate_code", "=", gateCode)
    .executeTakeFirst();
  if (!instance) throw problems.notFound();
  return instance;
}

/**
 * Is the caller (in person, or for `onBehalfOf` through one hop of delegation, D-089 Q3) the gate's configured
 * approver? In person: the DG2 isGateApprover rule (the named user, or a holder of the approver role with gate.decide
 * on the transformation). For someone: an active, effective delegation of record type gate_exception from a delegator
 * who holds gate_exception.decide (actsFor), and who is that configured approver.
 */
async function decidesAsApprover(
  tx: Tx,
  principal: Principal,
  transformationId: string,
  gateCode: string,
  target: ResolvedTarget,
  onBehalfOf: string | undefined,
): Promise<boolean> {
  if (onBehalfOf === undefined) return isGateApprover(tx, principal, transformationId, gateCode, target);
  if (!(await actsFor(tx, principal, onBehalfOf, GATE_EXCEPTION_RECORD_TYPE, target, "gate_exception.decide")))
    return false;
  const config = await gateApproverConfig(tx, transformationId, gateCode);
  if (config.approver_user_id !== null) return config.approver_user_id === onBehalfOf;
  const grants = await loadGrants(tx, onBehalfOf);
  return grants.some((g) => g.roleCode === config.approver_role_code && grantApplies(g, "gate.decide", target));
}

/**
 * The people a pending exception is routed to (the `gate_exception_to_decide` work item): the configured approver
 * user, else every active holder of the approver role with gate.decide and gate_exception.decide on the transformation
 * (scoped assignments, as the worker's approverRoleHolders), never the requester.
 */
async function exceptionApprovers(
  tx: Tx,
  transformationId: string,
  gateCode: string,
  requesterId: string,
): Promise<string[]> {
  const config = await gateApproverConfig(tx, transformationId, gateCode);
  if (config.approver_user_id !== null) return config.approver_user_id === requesterId ? [] : [config.approver_user_id];
  const r = await sql<{ user_id: string }>`
    SELECT DISTINCT sa.user_id
    FROM scoped_assignment sa
    JOIN role r ON r.id = sa.role_id AND r.code = ${config.approver_role_code}
    JOIN role_permission rp ON rp.role_id = r.id AND rp.permission_code = 'gate.decide'
    JOIN role_permission rx ON rx.role_id = r.id AND rx.permission_code = 'gate_exception.decide'
    JOIN app_user u ON u.id = sa.user_id AND u.status = 'active'
    JOIN transformation t ON t.id = ${transformationId}::uuid
    WHERE sa.revoked_at IS NULL AND sa.effective_from <= now() AND (sa.effective_to IS NULL OR sa.effective_to > now())
      AND sa.organization_id = t.organization_id
      AND ((sa.scope_type = 'transformation' AND sa.scope_id = t.id)
        OR (r.inherits_downward AND sa.scope_type = 'organization' AND sa.scope_id = t.organization_id)
        OR (r.inherits_downward AND sa.scope_type = 'business_unit'
            AND sa.scope_id IN (SELECT c.ancestor_id FROM business_unit_closure c WHERE c.descendant_id = t.business_unit_id)))
    ORDER BY sa.user_id`.execute(tx);
  return r.rows.map((x) => x.user_id).filter((u) => u !== requesterId);
}

// ------------------------------------------------------------------------------------------------ services

/** The acting user as the audit actor of the work items this module creates or closes (the approvals.ts helper). */
const userActor = (audit: AuditContext) =>
  ({ actorType: "user", actorUserId: audit.actorUserId, requestId: audit.requestId, source: "api" }) as const;

async function exceptionOf(db: DbOrTx, transformationId: string, id: string, forUpdate = false) {
  let q = db
    .selectFrom("gate_exception")
    .selectAll()
    .where("transformation_id", "=", transformationId)
    .where("id", "=", id);
  if (forUpdate) q = q.forUpdate();
  const row = await q.executeTakeFirst();
  if (!row) throw problems.notFound();
  return row;
}

export async function getGateException(db: DbOrTx, transformationId: string, id: string): Promise<GateException> {
  const row = await exceptionOf(db, transformationId, id);
  return toGateException(row, await exceptionBusinessDate(db, transformationId));
}

const listQuery = z.strictObject({
  cursor: cursorSchema,
  limit: limitSchema,
  gateCode: z
    .string()
    .regex(/^G[1-6]$/)
    .optional(),
  status: z.enum(["pending", "accepted", "rejected", "withdrawn", "revoked"]).optional(),
});

export async function listGateExceptions(
  db: DbOrTx,
  transformationId: string,
  query: z.infer<typeof listQuery>,
): Promise<{ items: GateException[]; nextCursor: string | null }> {
  const hash = filterHash({
    table: "gate_exception",
    transformationId,
    gateCode: query.gateCode ?? null,
    status: query.status ?? null,
  });
  const after = decodeCursor(query.cursor, hash, 1);
  let q = db.selectFrom("gate_exception").selectAll().where("transformation_id", "=", transformationId);
  if (query.gateCode !== undefined) q = q.where("gate_code", "=", query.gateCode);
  if (query.status !== undefined) q = q.where("status", "=", query.status);
  if (after) q = q.where("id", ">", String(after[0]));
  const rows = await q
    .orderBy("id")
    .limit(query.limit + 1)
    .execute();
  const page = paginate(rows, query.limit, (r) => [r.id], hash);
  const today = await exceptionBusinessDate(db, transformationId);
  return { items: page.items.map((r) => toGateException(r, today)), nextCursor: page.nextCursor };
}

/**
 * createGateException (gate_exception.request; TL): authorised again at commit time; all five fields required (400);
 * a mandatory criterion of that gate (422 gate_exception.criterion_not_mandatory); expiry today or later in the
 * transformation's timezone (422 gate_exception.expiry_in_past); an active compensating owner; one pending exception
 * per gate and criterion (409 gate_exception.already_pending, under the gateException lock and the partial unique index). Inserts
 * the pending row (version 1) with its audit event and one `gate_exception_to_decide` My Work item per approver.
 */
export async function createGateException(
  tx: Tx,
  request: FastifyRequest,
  transformationId: string,
): Promise<GateException> {
  const ctx = await openWrite(tx, request, transformationId, [{ permission: "gate_exception.request" }], null, {
    atCommit: true,
  });
  const body = parseBody(gateExceptionCreate, request.body);
  const criterion = await tx
    .selectFrom("gate_criterion_definition as c")
    .innerJoin("gate_definition as d", "d.id", "c.gate_definition_id")
    .select(["c.key", "c.mandatory"])
    .where("c.key", "=", body.criterionKey)
    .where("d.code", "=", body.gateCode)
    .executeTakeFirst();
  if (!criterion || !criterion.mandatory) throw gateExceptionRefusals.criterionNotMandatory();
  const today = await exceptionBusinessDate(tx, transformationId);
  if (body.expiresOn < today) throw gateExceptionRefusals.expiryInPast();
  await assertActiveUsers(tx, ctx.organizationId, [
    { id: body.compensatingOwnerUserId, pointer: "/compensatingOwnerUserId" },
  ]);
  const instance = await gateApproverConfig(tx, transformationId, body.gateCode);
  await lockGateExceptions(tx, instance.id);
  const pending = await tx
    .selectFrom("gate_exception")
    .select("id")
    .where("gate_instance_id", "=", instance.id)
    .where("criterion_key", "=", body.criterionKey)
    .where("status", "=", "pending")
    .executeTakeFirst();
  if (pending) throw gateExceptionRefusals.alreadyPending();
  const id = uuidv7();
  const row = await tx
    .insertInto("gate_exception")
    .values({
      id,
      organization_id: ctx.organizationId,
      transformation_id: transformationId,
      gate_instance_id: instance.id,
      gate_code: body.gateCode,
      criterion_key: body.criterionKey,
      reason: body.reason,
      scope: body.scope,
      compensating_action: body.compensatingAction,
      compensating_owner_user_id: body.compensatingOwnerUserId,
      expires_on: body.expiresOn,
      requested_by: ctx.userId,
      created_by: ctx.userId,
      updated_by: ctx.userId,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: "gate_exception.create",
    recordType: "gate_exception",
    recordId: id,
    organizationId: ctx.organizationId,
    transformationId,
    newVersion: 1,
    reason: body.reason,
    changes: {
      gateCode: { from: null, to: body.gateCode },
      criterionKey: { from: null, to: body.criterionKey },
      scope: { from: null, to: body.scope },
      compensatingAction: { from: null, to: body.compensatingAction },
      compensatingOwnerUserId: { from: null, to: body.compensatingOwnerUserId },
      expiresOn: { from: null, to: body.expiresOn },
      status: { from: null, to: "pending" },
    },
  });
  for (const userId of await exceptionApprovers(tx, transformationId, body.gateCode, ctx.userId))
    await createWorkItemOnce(tx, userActor(ctx.audit), {
      organizationId: ctx.organizationId,
      transformationId,
      kind: GATE_EXCEPTION_TO_DECIDE_KIND,
      assigneeUserId: userId,
      subjectType: "gate_exception",
      subjectId: id,
      linkPath: `/transformations/${transformationId}/gate-exceptions/${id}`,
      messageKey: GATE_EXCEPTION_TO_DECIDE_MESSAGE,
      messageParams: { gateCode: body.gateCode, criterionKey: body.criterionKey, expiresOn: body.expiresOn },
      dedupeKey: `gate_exception_to_decide:${id}:${userId}`,
    });
  return toGateException(row, today);
}

/** openWrite for a decision-class action: an ADM-only caller gets 403, not 404 (D-094; ADR-0035 §8). */
const openDecisionWrite = (tx: Tx, request: FastifyRequest, transformationId: string) =>
  openWrite(tx, request, transformationId, [{ permission: "gate_exception.decide" }], null, {
    atCommit: true,
    technicalAdminRefusal: "gate_exception.decide",
  });

/** Loads the exception under the instance lock (gateException class) and checks If-Match (428 missing, 409 stale). */
async function lockedForWrite(tx: Tx, request: FastifyRequest, transformationId: string, id: string) {
  const expected = requireIfMatch(request);
  const first = await exceptionOf(tx, transformationId, id);
  await lockGateExceptions(tx, first.gate_instance_id);
  const current = await exceptionOf(tx, transformationId, id, true);
  if (current.version !== expected) throw problems.versionConflict(current.version);
  return current;
}

/** Separation of duties: neither the requester nor someone acting for them decides or revokes (ADR-0035 §4). */
function assertNotRequester(ctx: WriteContext, current: GateExceptionRow, onBehalfOf: string | undefined): void {
  if (current.requested_by === ctx.userId || current.requested_by === onBehalfOf)
    throw gateExceptionRefusals.requesterCannotDecide().withDenial(denialOf("gate_exception.decide", ctx.target));
}

/**
 * decideGateException (gate_exception.decide; SP, BO): the gate's configured approver in person or by one hop of
 * delegation; not the requester (403); only a pending exception (422 gate_exception.not_pending); If-Match. Records
 * the decider, the person decided for, the time and the note; closes the `gate_exception_to_decide` items.
 */
export async function decideGateException(
  tx: Tx,
  request: FastifyRequest,
  transformationId: string,
  id: string,
): Promise<GateException> {
  const ctx = await openDecisionWrite(tx, request, transformationId);
  const body = parseBody(gateExceptionDecision, request.body);
  const current = await lockedForWrite(tx, request, transformationId, id);
  assertNotRequester(ctx, current, body.onBehalfOfUserId);
  if (
    !(await decidesAsApprover(
      tx,
      ctx.principal,
      transformationId,
      current.gate_code,
      ctx.target,
      body.onBehalfOfUserId,
    ))
  )
    throw gateExceptionRefusals.notApprover().withDenial(denialOf("gate_exception.decide", ctx.target));
  if (current.status !== "pending") throw gateExceptionRefusals.notPending();
  const updated = await tx
    .updateTable("gate_exception")
    .set({
      status: body.outcome,
      decided_by: ctx.userId,
      decided_on_behalf_of: body.onBehalfOfUserId ?? null,
      decided_at: sql<Date>`now()`,
      decision_note: body.note,
      ...bumpStamps(ctx.userId),
    })
    .where("id", "=", current.id)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  const audit: AuditContext = {
    ...ctx.audit,
    ...(body.onBehalfOfUserId !== undefined ? { onBehalfOfUserId: body.onBehalfOfUserId } : {}),
  };
  await record(tx, audit, {
    action: "gate_exception.decide",
    recordType: "gate_exception",
    recordId: current.id,
    organizationId: ctx.organizationId,
    transformationId,
    priorVersion: current.version,
    newVersion: updated.version,
    reason: body.note,
    changes: {
      status: { from: "pending", to: body.outcome },
      decidedBy: { from: null, to: ctx.userId },
      decidedOnBehalfOf: { from: null, to: body.onBehalfOfUserId ?? null },
    },
  });
  await closeWorkItemsOfSubject(
    tx,
    userActor(ctx.audit),
    {
      organizationId: ctx.organizationId,
      subjectType: "gate_exception",
      subjectId: current.id,
      kinds: [GATE_EXCEPTION_TO_DECIDE_KIND],
    },
    "done",
  );
  return toGateException(updated, await exceptionBusinessDate(tx, transformationId));
}

/**
 * withdrawGateException (gate_exception.request; the requester only, 403 otherwise): only a pending exception (422
 * gate_exception.not_pending); If-Match; cancels the `gate_exception_to_decide` items.
 */
export async function withdrawGateException(
  tx: Tx,
  request: FastifyRequest,
  transformationId: string,
  id: string,
): Promise<GateException> {
  const ctx = await openWrite(tx, request, transformationId, [{ permission: "gate_exception.request" }], null, {
    atCommit: true,
  });
  const current = await lockedForWrite(tx, request, transformationId, id);
  if (current.requested_by !== ctx.userId)
    throw problems
      .forbidden("Only the requester can withdraw their exception.")
      .withDenial(denialOf("gate_exception.request", ctx.target));
  if (current.status !== "pending") throw gateExceptionRefusals.notPending();
  const updated = await tx
    .updateTable("gate_exception")
    .set({ status: "withdrawn", ...bumpStamps(ctx.userId) })
    .where("id", "=", current.id)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: "gate_exception.withdraw",
    recordType: "gate_exception",
    recordId: current.id,
    organizationId: ctx.organizationId,
    transformationId,
    priorVersion: current.version,
    newVersion: updated.version,
    changes: { status: { from: "pending", to: "withdrawn" } },
  });
  await closeWorkItemsOfSubject(
    tx,
    userActor(ctx.audit),
    {
      organizationId: ctx.organizationId,
      subjectType: "gate_exception",
      subjectId: current.id,
      kinds: [GATE_EXCEPTION_TO_DECIDE_KIND],
    },
    "cancelled",
  );
  return toGateException(updated, await exceptionBusinessDate(tx, transformationId));
}

/**
 * The revoke body: a missing, null, blank or too short reason is 400 gate_exception.revoke_reason_required at /reason
 * (ADR-0035 §11); every other defect (an unknown property, a reason over 1000 characters, an invalid character) is the
 * ordinary 400 validation problem of the schema.
 */
function parseRevoke(raw: unknown) {
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
    const reason = (raw as { reason?: unknown }).reason;
    const absent =
      reason === undefined ||
      reason === null ||
      (typeof reason === "string" && !hasInvalidCharacter(reason) && (!hasText(reason) || reason.length < 3));
    if (absent) throw gateExceptionRefusals.revokeReasonRequired();
  }
  return parseBody(gateExceptionRevoke, raw);
}

/**
 * revokeGateException (gate_exception.decide; the gate's configured approver in person, not the requester): only an
 * accepted exception (422 gate_exception.not_accepted); a reason (400); If-Match. From that moment the criterion is
 * missing again (the exception no longer covers it); a submission already frozen with it keeps its snapshot.
 */
export async function revokeGateException(
  tx: Tx,
  request: FastifyRequest,
  transformationId: string,
  id: string,
): Promise<GateException> {
  const ctx = await openDecisionWrite(tx, request, transformationId);
  const body = parseRevoke(request.body);
  const current = await lockedForWrite(tx, request, transformationId, id);
  assertNotRequester(ctx, current, undefined);
  if (!(await decidesAsApprover(tx, ctx.principal, transformationId, current.gate_code, ctx.target, undefined)))
    throw gateExceptionRefusals.notApprover().withDenial(denialOf("gate_exception.decide", ctx.target));
  if (current.status !== "accepted") throw gateExceptionRefusals.notAccepted();
  const updated = await tx
    .updateTable("gate_exception")
    .set({
      status: "revoked",
      revoked_by: ctx.userId,
      revoked_at: sql<Date>`now()`,
      revoke_reason: body.reason,
      ...bumpStamps(ctx.userId),
    })
    .where("id", "=", current.id)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: "gate_exception.revoke",
    recordType: "gate_exception",
    recordId: current.id,
    organizationId: ctx.organizationId,
    transformationId,
    priorVersion: current.version,
    newVersion: updated.version,
    reason: body.reason,
    changes: { status: { from: "accepted", to: "revoked" }, revokedBy: { from: null, to: ctx.userId } },
  });
  return toGateException(updated, await exceptionBusinessDate(tx, transformationId));
}

// ------------------------------------------------------------------------------------------------ routes

/** Registers this file's routes and returns them as "METHOD /path". */
export function registerGateExceptionRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  const read = { access: { permission: "transformation.read" as const } };

  app.get(GATE_EXCEPTIONS, { config: read }, async (request) => {
    const { transformationId } = parse(tParams, request.params, "params");
    const query = parseQuery(listQuery, request.query);
    await requireTransformationRead(db, principalOf(request), transformationId);
    return listGateExceptions(db, transformationId, query);
  });

  app.post(
    GATE_EXCEPTIONS,
    { config: { access: { permission: "gate_exception.request" }, consumes: JSON_BODY } },
    async (request, reply) => {
      const { transformationId } = parse(tParams, request.params, "params");
      const body = await db.transaction().execute((tx) => createGateException(tx, request, transformationId));
      return sendVersioned(reply, 201, body, `/api/v1/transformations/${transformationId}/gate-exceptions/${body.id}`);
    },
  );

  app.get(GATE_EXCEPTION, { config: read }, async (request, reply) => {
    const { transformationId, gateExceptionId } = parse(eParams, request.params, "params");
    await requireTransformationRead(db, principalOf(request), transformationId);
    return sendVersioned(reply, 200, await getGateException(db, transformationId, gateExceptionId));
  });

  const action = (
    path: string,
    permission: "gate_exception.decide" | "gate_exception.request",
    run: (tx: Tx, request: FastifyRequest, transformationId: string, id: string) => Promise<GateException>,
    consumes: readonly string[] | undefined,
  ) =>
    app.post(
      `${GATE_EXCEPTION}/${path}`,
      { config: { access: { permission }, ...(consumes ? { consumes } : {}) } },
      async (request, reply) => {
        const { transformationId, gateExceptionId } = parse(eParams, request.params, "params");
        const body = await db.transaction().execute((tx) => run(tx, request, transformationId, gateExceptionId));
        return sendVersioned(reply, 200, body);
      },
    );
  action("decision", "gate_exception.decide", decideGateException, JSON_BODY);
  action("withdraw", "gate_exception.request", withdrawGateException, undefined);
  action("revoke", "gate_exception.decide", revokeGateException, JSON_BODY);

  return [
    `GET ${GATE_EXCEPTIONS}`,
    `POST ${GATE_EXCEPTIONS}`,
    `GET ${GATE_EXCEPTION}`,
    `POST ${GATE_EXCEPTION}/decision`,
    `POST ${GATE_EXCEPTION}/withdraw`,
    `POST ${GATE_EXCEPTION}/revoke`,
  ];
}
