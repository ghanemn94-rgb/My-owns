// Delegation management (OpenAPI tag "delegations"; ADR-0026 §3; REQ-S10-010, REQ-S16-011; D-089 Q3; T-DG4-BE-B):
//   GET  /delegations                        the caller's delegations (delegator or delegate); with delegation.manage,
//                                            every delegation of the organizations where the caller holds it
//   POST /delegations                        delegate for a period: delegation.create_own for yourself, or
//                                            delegation.manage (ADM_ACCESS) on the delegator's request, with a reason
//   GET  /delegations/{id}                   delegator, delegate or delegation.manage; others 404
//   POST /delegations/{id}/revoke            the delegator or delegation.manage, with a reason (If-Match)
//
// Rules (ADR-0026 §3; the database enforces 1-3, this file 4-9):
//   1 no self-delegation (422 delegation.self; CHECK delegation_not_self)
//   2 no loop, whatever the scopes and windows (422 delegation.loop; trigger delegation_loop_guard under the delegation-graph lock)
//   3 row guard (version step, immutable identity). The audit-required trigger is NOT attached to `delegation` (DG3
//     fixtures insert rows directly), so every write here records its audit event itself, and the tests assert it.
//   4 who creates (403 delegation.not_delegator; 422 delegation.admin_self)
//   5 window: start < end, end in the future, at most 366 days (422 delegation.window_invalid)
//   6 never to the requester of an approval pending with the delegator (422 delegation.delegate_is_requester)
//   7 capability = the delegator's, AT USE TIME (`actsFor`): active, effective_from <= now < effective_to, and the
//     delegator currently holds the needed permission. After expiry the delegate loses it at once, sweep or not.
//   8 one hop: a delegate acts only for the delegator, never for the delegator's own delegators
//   9 audit identity: a decision by B for A is audited actor B, on behalf of A (the approval service does this)
// The P3 approvals keep their DG3 in-person rule (422 *.on_behalf_not_supported); they never call `actsFor`.
import { sql, type DbOrTx, type Tx } from "@mth/db";
import type { Permission } from "@mth/shared";
import { delegationCreate, reasonRequest, uuid, type Delegation } from "@mth/shared/schemas";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { record } from "../audit/index.ts";
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
import {
  authorize,
  denialOf,
  loadGrants,
  organizationsWith,
  resolveTarget,
  targetFor,
  type Principal,
} from "./policy.ts";
import { auditContextOf, principalOf, refreshPrincipal } from "./request.ts";
import { decide, type ResolvedTarget } from "./rules.ts";

const JSON_BODY = ["application/json"] as const;
/** The delegation-graph lock (per organization), the one the 0029 loop guard takes (ADR-0016 §6). */
export const DELEGATION_GRAPH_LOCK_CLASS = ADVISORY_LOCK_CLASSES.delegationGraph;
const CREATE_OWN = "delegation.create_own" as const;
const MANAGE = "delegation.manage" as const;
/** Rule 5: at most 366 days between start and end. */
const MAX_WINDOW_MS = 366 * 24 * 60 * 60 * 1000;

const idParams = z.strictObject({ delegationId: uuid });
const listQuery = z.strictObject({
  cursor: cursorSchema,
  limit: limitSchema,
  role: z.enum(["delegator", "delegate", "any"]).default("any"),
  status: z.enum(["active", "revoked", "expired"]).optional(),
});

// ------------------------------------------------------------------------------------------------ refusals (ADR-0026 §3)

const rule = (code: string, detail: string, pointer: string) =>
  new HttpProblem({
    status: 422,
    type: "urn:mth:problem:validation",
    code,
    title: "Business rule violated",
    detail,
    errors: [{ pointer, code, message: detail }],
  });

export const delegationRefusals = {
  loop: (delegate: string, delegator: string) =>
    rule(
      "delegation.loop",
      `This delegation would create a loop: ${delegate} already delegates, directly or through others, to ${delegator}.`,
      "/delegateUserId",
    ),
  self: () => rule("delegation.self", "You cannot delegate to yourself.", "/delegateUserId"),
  windowInvalid: () =>
    rule(
      "delegation.window_invalid",
      "A delegation needs a start before its end, an end in the future, and at most 366 days in between.",
      "/effectiveTo",
    ),
  delegateIsRequester: (delegate: string, delegator: string) =>
    rule(
      "delegation.delegate_is_requester",
      `${delegate} requested an approval that is pending with ${delegator}, so they cannot act on ${delegator}'s behalf.`,
      "/delegateUserId",
    ),
  adminSelf: () =>
    rule(
      "delegation.admin_self",
      "An access administrator cannot record a delegation to themselves.",
      "/delegateUserId",
    ),
  notDelegator: () =>
    new HttpProblem({
      status: 403,
      type: "urn:mth:problem:forbidden",
      code: "delegation.not_delegator",
      title: "Forbidden",
      detail:
        "Only the delegator, or an access administrator on the delegator's request, can create or revoke this delegation.",
    }),
  notActive: (status: string) =>
    rule("delegation.not_active", `This delegation is ${status} and can no longer be revoked.`, ""),
  // Not listed in ADR-0026 §3 (field-level checks the ADR leaves to the API):
  delegateUnknown: () =>
    rule(
      "delegation.delegate_unknown",
      "The delegate must be an active user of the delegator's organization.",
      "/delegateUserId",
    ),
  scopeInvalid: () =>
    rule(
      "delegation.scope_invalid",
      "The scope must be the delegator's organization, one of its business units or one of its transformations.",
      "/scopeId",
    ),
} as const;

// ------------------------------------------------------------------------------------------------ rows and mapping

async function findDelegation(db: DbOrTx, id: string, lock = false) {
  let q = db.selectFrom("delegation").selectAll().where("id", "=", id);
  if (lock) q = q.forUpdate();
  return q.executeTakeFirst();
}
type DelegationRow = NonNullable<Awaited<ReturnType<typeof findDelegation>>>;

/** The displayed status: an `active` row whose end has passed is `expired`, whether or not the sweep has run. */
function shownStatus(r: DelegationRow, now: number = Date.now()): Delegation["status"] {
  if (r.status === "active" && new Date(r.effective_to).getTime() <= now) return "expired";
  return r.status as Delegation["status"];
}

export const toDelegation = (r: DelegationRow): Delegation => ({
  id: r.id,
  organizationId: r.organization_id,
  delegatorUserId: r.delegator_user_id,
  delegateUserId: r.delegate_user_id,
  scopeType: r.scope_type,
  scopeId: r.scope_id,
  recordTypes: r.record_types,
  reasonCode: r.reason_code as Delegation["reasonCode"],
  reasonText: r.reason_text,
  absenceNote: r.absence_note,
  requestedByUserId: r.requested_by_user_id,
  effectiveFrom: iso(r.effective_from),
  effectiveTo: iso(r.effective_to),
  status: shownStatus(r),
  revokedAt: isoOrNull(r.revoked_at),
  revokedBy: r.revoked_by,
  revokeReason: r.revoke_reason,
  version: r.version,
  createdAt: iso(r.created_at),
});

// ------------------------------------------------------------------------------------------------ actsFor (rule 7)

/**
 * The scopes a delegation can name for a target: its organization, its business-unit chain, its transformation.
 * (The reserved scope types grant nothing until their stage implements them.)
 */
function scopesOf(target: ResolvedTarget): { type: string; id: string }[] {
  return [
    { type: "organization", id: target.organizationId },
    ...target.businessUnitAncestry.map((id) => ({ type: "business_unit", id })),
    ...(target.transformationId ? [{ type: "transformation", id: target.transformationId }] : []),
  ];
}

/**
 * Delegation for P4 approvals (ADR-0026 §3 rule 7; REQ-S10-010): true when `delegatorUserId` has an ACTIVE delegation
 * to the caller, effective NOW (`effective_from <= now() < effective_to`, read from the window, never from the sweep),
 * covering `recordType` and the target's scope, AND the delegator currently holds `permission` on the target (the
 * capability is the delegator's, at use time). One hop (rule 8): only the delegator's own capability counts. Counted
 * as a policy decision. Replaces the one-hop `actsOnBehalfOf` check for the P4 approvals; `actsOnBehalfOf`'s existing
 * callers (ADR-0015 paths) are unchanged.
 */
export async function actsFor(
  db: DbOrTx,
  principal: Principal,
  delegatorUserId: string,
  recordType: string,
  target: ResolvedTarget,
  permission: Permission,
): Promise<boolean> {
  principal.tracker.decisions += 1;
  if (principal.userId === null || principal.userId === delegatorUserId) return false;
  const rows = await db
    .selectFrom("delegation")
    .select(["scope_type", "scope_id", "record_types"])
    .where("delegator_user_id", "=", delegatorUserId)
    .where("delegate_user_id", "=", principal.userId)
    .where("organization_id", "=", target.organizationId)
    .where("status", "=", "active")
    .where("effective_from", "<=", sql<Date>`now()`)
    .where("effective_to", ">", sql<Date>`now()`)
    .execute();
  const scopes = scopesOf(target);
  const covered = rows.some(
    (d) =>
      (d.record_types === null || d.record_types.includes(recordType)) &&
      (d.scope_type === null || scopes.some((s) => s.type === d.scope_type && s.id === d.scope_id)),
  );
  if (!covered) return false;
  const delegator = await db
    .selectFrom("app_user")
    .select("status")
    .where("id", "=", delegatorUserId)
    .executeTakeFirst();
  if (!delegator || delegator.status !== "active") return false;
  const grants = await loadGrants(db, delegatorUserId);
  return decide({ kind: "user", userId: delegatorUserId, grants }, permission, target).allowed;
}

/** Users who currently delegate to `delegateUserId` (active, effective now); for "approvals of people I act for". */
export async function delegatorsOf(db: DbOrTx, delegateUserId: string): Promise<string[]> {
  const rows = await db
    .selectFrom("delegation")
    .select("delegator_user_id")
    .distinct()
    .where("delegate_user_id", "=", delegateUserId)
    .where("status", "=", "active")
    .where("effective_from", "<=", sql<Date>`now()`)
    .where("effective_to", ">", sql<Date>`now()`)
    .execute();
  return rows.map((r) => r.delegator_user_id);
}

// ------------------------------------------------------------------------------------------------ rules

/** Rule 2 pre-check (the trigger is the last line): would delegator -> delegate close a path back to the delegator? */
async function closesLoop(db: DbOrTx, organizationId: string, delegatorId: string, delegateId: string) {
  const r = await sql<{ loops: boolean }>`
    WITH RECURSIVE reach (user_id, depth) AS (
      SELECT ${delegateId}::uuid, 0
      UNION
      SELECT d.delegate_user_id, r.depth + 1
      FROM reach r JOIN delegation d ON d.delegator_user_id = r.user_id
      WHERE d.organization_id = ${organizationId}::uuid AND d.status = 'active' AND d.effective_to > now() AND r.depth < 50
    )
    SELECT EXISTS (SELECT 1 FROM reach WHERE user_id = ${delegatorId}::uuid) AS loops`.execute(db);
  return r.rows[0]?.loops === true;
}

/**
 * Rule 6: the delegate requested an approval that is open and waiting for the delegator (assigned to them, to a group
 * they currently belong to, or escalated to either).
 */
async function delegateRequestedPendingWith(db: DbOrTx, delegatorId: string, delegateId: string): Promise<boolean> {
  const r = await sql<{ hit: boolean }>`
    SELECT EXISTS (
      SELECT 1 FROM approval a
      WHERE a.requested_by = ${delegateId}::uuid AND a.status IN ('pending', 'deferred')
        AND (a.assignee_user_id = ${delegatorId}::uuid OR a.escalated_to_user_id = ${delegatorId}::uuid
             OR a.assignee_group_id IN (SELECT m.group_id FROM access_group_member m
                                        WHERE m.user_id = ${delegatorId}::uuid AND m.removed_at IS NULL
                                          AND m.effective_from <= now() AND (m.effective_to IS NULL OR m.effective_to > now()))
             OR a.escalated_to_group_id IN (SELECT m.group_id FROM access_group_member m
                                        WHERE m.user_id = ${delegatorId}::uuid AND m.removed_at IS NULL
                                          AND m.effective_from <= now() AND (m.effective_to IS NULL OR m.effective_to > now())))
    ) AS hit`.execute(db);
  return r.rows[0]?.hit === true;
}

/** Holds delegation.manage in the organization (ADM_ACCESS; organization-level, one policy decision). */
async function managesIn(db: DbOrTx, principal: Principal, organizationId: string): Promise<boolean> {
  const d = await authorize(db, principal, MANAGE, await targetFor(db, "organization", { organizationId }));
  return d.allowed;
}

/** The delegation, visible to the caller (delegator, delegate, or delegation.manage in its organization), or 404. */
async function visibleDelegation(db: DbOrTx, principal: Principal, id: string, lock = false): Promise<DelegationRow> {
  const row = await findDelegation(db, id, lock);
  principal.tracker.decisions += 1;
  if (!row) throw problems.notFound();
  const me = principal.userId;
  if (me !== null && (row.delegator_user_id === me || row.delegate_user_id === me)) return row;
  if (await managesIn(db, principal, row.organization_id)) return row;
  throw problems.notFound();
}

async function createDelegation(tx: Tx, request: FastifyRequest) {
  const body = parseBody(delegationCreate, request.body);
  const fresh = await refreshPrincipal(tx, request); // commit-time authorisation
  const me = fresh.userId!;
  const delegatorId = body.delegatorUserId ?? me;
  const delegator = await tx
    .selectFrom("app_user")
    .select(["id", "organization_id", "status", "display_name"])
    .where("id", "=", delegatorId)
    .executeTakeFirst();
  // Rule 4: for yourself with delegation.create_own (any scope of your organization), or as an access administrator
  // (delegation.manage in the delegator's organization) on the delegator's request.
  let onRequest = false;
  if (delegatorId === me) {
    if (!delegator || !organizationsWith(fresh, CREATE_OWN).includes(delegator.organization_id))
      throw problems
        .forbidden()
        .withDenial(
          denialOf(CREATE_OWN, await targetFor(tx, "organization", { organizationId: fresh.organizationId! })),
        );
  } else {
    if (!delegator || !(await managesIn(tx, fresh, delegator.organization_id)))
      throw delegationRefusals
        .notDelegator()
        .withDenial(denialOf(MANAGE, await targetFor(tx, "organization", { organizationId: fresh.organizationId! })));
    onRequest = true;
  }
  if (delegator.status !== "active") throw delegationRefusals.notDelegator();
  // Rule 1 (and the admin's own variant).
  if (body.delegateUserId === delegatorId) throw delegationRefusals.self();
  if (onRequest && body.delegateUserId === me) throw delegationRefusals.adminSelf();
  if (onRequest && body.reasonText === undefined)
    throw problems.validation(
      [{ pointer: "/reasonText", code: "validation.required", message: "Give the delegator's request as the reason." }],
      "A delegation recorded on the delegator's request needs a reason.",
    );
  const delegate = await tx
    .selectFrom("app_user")
    .select(["id", "display_name"])
    .where("id", "=", body.delegateUserId)
    .where("organization_id", "=", delegator.organization_id)
    .where("status", "=", "active")
    .executeTakeFirst();
  if (!delegate) throw delegationRefusals.delegateUnknown();
  // Rule 5 (now = the database clock, the one the loop guard and `actsFor` use).
  const now = (await sql<{ now: Date }>`SELECT now() AS now`.execute(tx)).rows[0]!.now.getTime();
  const from = Date.parse(body.effectiveFrom);
  const to = Date.parse(body.effectiveTo);
  if (!(from < to) || !(to > now) || to - from > MAX_WINDOW_MS) throw delegationRefusals.windowInvalid();
  // Scope: both or neither, and inside the delegator's organization.
  if ((body.scopeType === undefined) !== (body.scopeId === undefined))
    throw problems.validation([
      { pointer: "/scopeId", code: "validation.scope_pair", message: "Give scopeType and scopeId together." },
    ]);
  if (body.scopeType !== undefined) {
    const level = body.scopeType;
    if (level !== "organization" && level !== "business_unit" && level !== "transformation")
      throw delegationRefusals.scopeInvalid();
    const t = await resolveTarget(tx, { type: level, id: body.scopeId! });
    if (!t || t.organizationId !== delegator.organization_id) throw delegationRefusals.scopeInvalid();
  }
  // Rule 6, then rule 2 (pre-check with names; the trigger serializes under the delegation-graph lock and is the last line).
  if (await delegateRequestedPendingWith(tx, delegatorId, body.delegateUserId))
    throw delegationRefusals.delegateIsRequester(delegate.display_name, delegator.display_name);
  await sql`SELECT pg_advisory_xact_lock(${DELEGATION_GRAPH_LOCK_CLASS}::integer, hashtext(${delegator.organization_id}::text))`.execute(
    tx,
  );
  if (await closesLoop(tx, delegator.organization_id, delegatorId, body.delegateUserId))
    throw delegationRefusals.loop(delegate.display_name, delegator.display_name);
  const id = uuidv7();
  const created = await tx
    .insertInto("delegation")
    .values({
      id,
      organization_id: delegator.organization_id,
      delegator_user_id: delegatorId,
      delegate_user_id: body.delegateUserId,
      scope_type: body.scopeType ?? null,
      scope_id: body.scopeId ?? null,
      record_types: body.recordTypes ?? null,
      reason_code: body.reasonCode,
      reason_text: body.reasonText ?? null,
      absence_note: body.absenceNote ?? null,
      requested_by_user_id: onRequest ? delegatorId : null,
      effective_from: new Date(body.effectiveFrom),
      effective_to: new Date(body.effectiveTo),
      created_by: me,
      updated_by: me,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, auditContextOf(request), {
    action: "delegation.create",
    recordType: "delegation",
    recordId: id,
    organizationId: delegator.organization_id,
    newVersion: 1,
    reason: onRequest ? `Recorded on the delegator's request: ${body.reasonText}` : null,
    changes: {
      delegator_user_id: { from: null, to: delegatorId },
      delegate_user_id: { from: null, to: body.delegateUserId },
      scope_type: { from: null, to: created.scope_type },
      scope_id: { from: null, to: created.scope_id },
      record_types: { from: null, to: created.record_types },
      reason_code: { from: null, to: created.reason_code },
      requested_by_user_id: { from: null, to: created.requested_by_user_id },
      effective_from: { from: null, to: iso(created.effective_from) },
      effective_to: { from: null, to: iso(created.effective_to) },
    },
  });
  return created;
}

// ------------------------------------------------------------------------------------------------ routes

export function registerDelegationRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  const BASE = "/api/v1/delegations";
  const ONE = `${BASE}/:delegationId`;
  const REVOKE = `${ONE}/revoke`;
  const session = { access: { permission: "authenticated" } } as const;

  app.get(BASE, { config: session }, async (request) => {
    const principal = principalOf(request);
    const me = principal.userId;
    if (me === null) throw problems.unauthenticated();
    const query = parseQuery(listQuery, request.query);
    const managed = query.role === "any" ? organizationsWith(principal, MANAGE) : [];
    const hash = filterHash({ me, role: query.role, status: query.status, managed });
    const after = decodeCursor(query.cursor, hash, 1);
    let q = db.selectFrom("delegation").selectAll();
    q = q.where((eb) => {
      const mine = [
        ...(query.role !== "delegate" ? [eb("delegator_user_id", "=", me)] : []),
        ...(query.role !== "delegator" ? [eb("delegate_user_id", "=", me)] : []),
        ...(managed.length > 0 ? [eb("organization_id", "in", managed)] : []),
      ];
      return eb.or(mine);
    });
    // The displayed status (an `active` row past its end is `expired`), so the filter matches what is shown.
    if (query.status === "active") q = q.where("status", "=", "active").where("effective_to", ">", sql<Date>`now()`);
    if (query.status === "expired")
      q = q.where((eb) =>
        eb.or([
          eb("status", "=", "expired"),
          eb.and([eb("status", "=", "active"), eb("effective_to", "<=", sql<Date>`now()`)]),
        ]),
      );
    if (query.status === "revoked") q = q.where("status", "=", "revoked");
    if (after) q = q.where("id", "<", String(after[0]));
    const rows = await q
      .orderBy("id", "desc")
      .limit(query.limit + 1)
      .execute();
    const page = paginate(rows, query.limit, (r) => [r.id], hash);
    return { items: page.items.map(toDelegation), nextCursor: page.nextCursor };
  });

  app.post(BASE, { config: { access: { permission: CREATE_OWN }, consumes: JSON_BODY } }, async (request, reply) => {
    principalOf(request);
    // The loop guard is the last line for two concurrent halves of a loop (probe C01): the delegation-graph advisory lock
    // serializes them, so the second one sees the first and is refused here, or by the trigger (db-errors.ts).
    const row = await db.transaction().execute((tx) => createDelegation(tx, request));
    return sendVersioned(reply, 201, toDelegation(row), `${BASE}/${row.id}`);
  });

  app.get(ONE, { config: session }, async (request, reply) => {
    const { delegationId } = parse(idParams, request.params, "params");
    parseQuery(z.strictObject({}), request.query);
    return sendVersioned(reply, 200, toDelegation(await visibleDelegation(db, principalOf(request), delegationId)));
  });

  app.post(REVOKE, { config: { access: { permission: CREATE_OWN }, consumes: JSON_BODY } }, async (request, reply) => {
    const { delegationId } = parse(idParams, request.params, "params");
    const body = parseBody(reasonRequest, request.body);
    const row = await db.transaction().execute(async (tx) => {
      const fresh = await refreshPrincipal(tx, request);
      const me = fresh.userId!;
      const current = await visibleDelegation(tx, fresh, delegationId, true);
      if (current.delegator_user_id !== me && !(await managesIn(tx, fresh, current.organization_id)))
        throw delegationRefusals
          .notDelegator()
          .withDenial(
            denialOf(MANAGE, await targetFor(tx, "organization", { organizationId: current.organization_id })),
          );
      const expected = requireIfMatch(request);
      if (current.version !== expected) throw problems.versionConflict(current.version);
      const status = shownStatus(current);
      if (status !== "active") throw delegationRefusals.notActive(status);
      const updated = await tx
        .updateTable("delegation")
        .set({
          status: "revoked",
          revoked_at: sql<Date>`now()`,
          revoked_by: me,
          revoke_reason: body.reason,
          version: sql<number>`version + 1`,
          updated_at: sql<Date>`now()`,
          updated_by: me,
        })
        .where("id", "=", delegationId)
        .where("version", "=", current.version)
        .returningAll()
        .executeTakeFirstOrThrow();
      await record(tx, auditContextOf(request), {
        action: "delegation.revoke",
        recordType: "delegation",
        recordId: delegationId,
        organizationId: current.organization_id,
        priorVersion: current.version,
        newVersion: updated.version,
        reason: body.reason,
        changes: { status: { from: current.status, to: "revoked" } },
      });
      return updated;
    });
    return sendVersioned(reply, 200, toDelegation(row));
  });

  return [`GET ${BASE}`, `POST ${BASE}`, `GET ${ONE}`, `POST ${REVOKE}`];
}
