// Sequential and parallel approval routes (OpenAPI tag "approval-routes"; ADR-0044 §4, §9, §10; REQ-S10-015, M0213;
// p5-work-split §E.2; T-DG5-BE-K):
//   GET  /admin/approval-routes                              the routes resolved from a published version (methodology.read)
//   GET  /approvals/{approvalId}/route                       one approval's steps, every round (the approval's read rule)
//   POST /approvals/{approvalId}/route/steps/{stepNo}/decision
//                                                            decide an active step (approval.decide in scope + the step's
//                                                            role or the DG4 delegate of a holder; If-Match = approval)
//
// Resolution: a canonical approval of type T is routed when the transformation's pinned methodology version resolves an
// `approver_route` element with stable key `approval.<T>`, mode sequential or parallel and 2-6 roles (ADR-0039 §2);
// for a procedure step approval (`procedure_step`), when the procedure definition's approval_mode is sequential or
// parallel with 2-6 roles (ADR-0042 §2; key `procedure.<code>`). Anything else (no element, mode `any`, one role, a type
// decided from its record) is the DG4 single-step approval with no route rows, decided as before.
//
// Instantiation (`instantiateApprovalRoute`, called by approvals.ts on request and resubmission): the steps of the
// current round are inserted; sequential -> step 1 active, the rest waiting; parallel -> all active. Each ACTIVE step
// gives one `approval_decision` work item (with its inbox notification) to every holder of its role in scope (dedupe
// `approval_route:<approvalId>:<round>:<step>:<userId>`; never the requester under requester_excluded). A waiting
// step has no work item and no notification until every earlier step is approved (REQ-S10-015).
//
// Decision: one person decides one step; the requester never decides (SoD); every step approved -> the approval is
// decided `approved` through `decideApprovalInTx` with the last decider; one reject -> `rejected`; one request changes ->
// `changes_requested`; the other open steps are cancelled. Locks: the approval row, the approvalSubject class, then the
// approvalRouteStep class (ADR-0016 §6). These are BUSINESS approvals decided by named people inside the product: no job, timer, seed or
// agent decides a step, and nothing here reads or writes the engineering gates DG0-DG7.
import { sql, type ApprovalRow, type ApprovalRouteStepRow, type DbOrTx, type Tx } from "@mth/db";
import {
  approvalRouteStepDecision,
  uuid,
  type ApprovalRoute,
  type ApprovalRouteDefinition,
  type ApprovalRouteStepStatus,
} from "@mth/shared/schemas";
import type { FastifyInstance } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import {
  actsFor,
  auditContextOf,
  commitTimeDenial,
  denialOf,
  grantApplies,
  isTechnicalAdminOnly,
  principalOf,
  refreshPrincipal,
  requireAction,
  requireTransformationRead,
  targetFor,
  type Principal,
  type ResolvedTarget,
} from "../access/index.ts";
import { record, type AuditContext } from "../audit/index.ts";
import { createConfigResolver, type ConfigResolver } from "../methodology/index.ts";
import {
  ADVISORY_LOCK_CLASSES,
  etag,
  HttpProblem,
  isoOrNull,
  parse,
  parseBody,
  parseQuery,
  problems,
  requireIfMatch,
  type ModuleDeps,
} from "../platform/index.ts";
import { createWorkItemOnce } from "../tasks/index.ts";
import { approvalRefusals, decideApprovalInTx, subjectVersionOf } from "./approvals.ts";

const JSON_BODY = ["application/json"] as const;
const ROUTE_LOCK_CLASS = ADVISORY_LOCK_CLASSES.approvalRouteStep;
const SUBJECT_LOCK_CLASS = ADVISORY_LOCK_CLASSES.approvalSubject;
const DECIDABLE = ["pending", "deferred"] as const;
const PROCEDURE_STEP_TYPE = "procedure_step";
const linkOf = (approvalId: string) => `/my-work/approvals/${approvalId}`;
const resolver: ConfigResolver = createConfigResolver();

// ------------------------------------------------------------------------------------------------ refusals (ADR-0044 §10)

const forbidden = (code: string, detail: string) =>
  new HttpProblem({ status: 403, type: "urn:mth:problem:forbidden", code, title: "Forbidden", detail });

export const approvalRouteRefusals = {
  stepNotActive: () =>
    problems.businessRule("approval_route.step_not_active", "This step is not waiting for a decision."),
  notStepApprover: () => forbidden("approval_route.not_step_approver", "You do not hold the role of this step."),
  selfDecision: () => forbidden("approval_route.self_decision", "You cannot decide a step of your own request."),
  oneStepPerPerson: () =>
    forbidden("approval_route.one_step_per_person", "You have already decided another step of this approval."),
} as const;

// ------------------------------------------------------------------------------------------------ resolution

/** A route resolved for one approval: its key, mode and the step roles in order (2-6). */
export interface ResolvedApprovalRoute {
  readonly routeKey: string;
  readonly mode: "sequential" | "parallel";
  readonly roleCodes: readonly string[];
}

const ROUTE_MODES: ReadonlySet<string> = new Set(["sequential", "parallel"]);

/** The roles of an `approver_route` element's attributes, in order (ADR-0039 §2: one of the two fields). */
function rolesOf(attributes: Readonly<Record<string, unknown>>): string[] {
  const a = new Map(Object.entries(attributes));
  const many = a.get("approverRoleCodes");
  if (Array.isArray(many)) return many.filter((x): x is string => typeof x === "string");
  const one = a.get("approverRoleCode");
  return typeof one === "string" ? [one] : [];
}

const modeOf = (attributes: Readonly<Record<string, unknown>>): string => {
  const m = new Map(Object.entries(attributes)).get("mode");
  return typeof m === "string" ? m : "any";
};

const routable = (mode: string, roles: readonly string[]) =>
  ROUTE_MODES.has(mode) && roles.length >= 2 && roles.length <= 6;

/**
 * The route of an approval being requested, or null for a DG4 single-step approval (ADR-0044 §4 "Configuration").
 * Reads the transformation's pinned methodology version (never "the latest"), or the procedure definition.
 */
export async function resolveApprovalRoute(
  db: DbOrTx,
  a: Pick<ApprovalRow, "approval_type" | "transformation_id" | "subject_id">,
): Promise<ResolvedApprovalRoute | null> {
  if (a.approval_type === PROCEDURE_STEP_TYPE) {
    const d = await db
      .selectFrom("procedure_step_instance as s")
      .innerJoin("procedure_instance as i", "i.id", "s.procedure_instance_id")
      .innerJoin("procedure_definition as d", "d.id", "i.procedure_definition_id")
      .select(["d.code", "d.approval_mode", "d.approval_role_codes"])
      .where("s.id", "=", a.subject_id)
      .executeTakeFirst();
    if (d === undefined || !routable(d.approval_mode, d.approval_role_codes)) return null;
    return {
      routeKey: `procedure.${d.code}`,
      mode: d.approval_mode as ResolvedApprovalRoute["mode"],
      roleCodes: [...d.approval_role_codes],
    };
  }
  const pinned = await resolver.pinnedVersion(db, a.transformation_id, "methodology");
  const routeKey = `approval.${a.approval_type}`;
  const e = await resolver.element(db, pinned.versionId, "approver_route", routeKey);
  if (e === null || e.removed) return null;
  const mode = modeOf(e.attributes);
  const roles = rolesOf(e.attributes);
  if (!routable(mode, roles)) return null;
  return { routeKey, mode: mode as ResolvedApprovalRoute["mode"], roleCodes: roles };
}

// ------------------------------------------------------------------------------------------------ step holders

/**
 * Active users holding `roleCode` WITH approval.decide on the transformation now (a transformation grant, or an
 * inherited organization / business-unit grant): the people a step of that role is routed to.
 */
export async function stepRoleHolders(db: DbOrTx, transformationId: string, roleCode: string): Promise<string[]> {
  const r = await sql<{ user_id: string }>`
    SELECT DISTINCT sa.user_id
    FROM scoped_assignment sa
    JOIN role r ON r.id = sa.role_id AND r.code = ${roleCode}
    JOIN role_permission rp ON rp.role_id = r.id AND rp.permission_code = 'approval.decide'
    JOIN app_user u ON u.id = sa.user_id AND u.status = 'active'
    JOIN transformation t ON t.id = ${transformationId}::uuid
    WHERE sa.revoked_at IS NULL AND sa.effective_from <= now() AND (sa.effective_to IS NULL OR sa.effective_to > now())
      AND sa.organization_id = t.organization_id
      AND ((sa.scope_type = 'transformation' AND sa.scope_id = t.id)
        OR (r.inherits_downward AND sa.scope_type = 'organization' AND sa.scope_id = t.organization_id)
        OR (r.inherits_downward AND sa.scope_type = 'business_unit'
            AND sa.scope_id IN (SELECT c.ancestor_id FROM business_unit_closure c WHERE c.descendant_id = t.business_unit_id)))
    ORDER BY sa.user_id`.execute(db);
  return r.rows.map((x) => x.user_id);
}

const userActor = (audit: AuditContext) =>
  ({ actorType: "user", actorUserId: audit.actorUserId, requestId: audit.requestId, source: "api" }) as const;

const stepDedupePrefix = (approvalId: string, roundNo: number, stepNo: number) =>
  `approval_route:${approvalId}:${roundNo}:${stepNo}:`;

/** One `approval_decision` work item (and its notification) per holder of an ACTIVE step's role; never the requester. */
async function notifyStep(tx: Tx, audit: AuditContext, a: ApprovalRow, step: ApprovalRouteStepRow): Promise<number> {
  let created = 0;
  for (const userId of await stepRoleHolders(tx, a.transformation_id, step.approver_role_code)) {
    if (userId === a.requested_by && a.sod_policy === "requester_excluded") continue;
    const r = await createWorkItemOnce(tx, userActor(audit), {
      organizationId: a.organization_id,
      transformationId: a.transformation_id,
      kind: "approval_decision",
      assigneeUserId: userId,
      subjectType: "approval",
      subjectId: a.id,
      linkPath: linkOf(a.id),
      messageKey: "approvals.task.decide",
      messageParams: {
        title: a.title,
        approvalType: a.approval_type,
        roundNo: a.round_no,
        dueDate: a.due_date,
        stepNo: step.step_no,
        stepRole: step.approver_role_code,
      },
      dueDate: a.due_date,
      dedupeKey: `${stepDedupePrefix(a.id, step.round_no, step.step_no)}${userId}`,
    });
    if (r.outcome === "created") created += 1;
  }
  return created;
}

/** Closes the open work items of one step (every holder's), as `status`, with an audit event each. */
async function closeStepItems(
  tx: Tx,
  audit: AuditContext,
  a: ApprovalRow,
  step: Pick<ApprovalRouteStepRow, "round_no" | "step_no">,
  status: "done" | "cancelled",
): Promise<void> {
  const open = await tx
    .selectFrom("work_item")
    .selectAll()
    .where("organization_id", "=", a.organization_id)
    .where("subject_type", "=", "approval")
    .where("subject_id", "=", a.id)
    .where("status", "=", "open")
    .where("dedupe_key", "like", `${stepDedupePrefix(a.id, step.round_no, step.step_no)}%`)
    .forUpdate()
    .execute();
  const by = audit.actorUserId;
  for (const item of open) {
    const updated = await tx
      .updateTable("work_item")
      .set((eb) => ({
        status,
        completed_at: status === "done" ? eb.fn<Date>("now", []) : null,
        completed_by: status === "done" ? by : null,
        version: eb("version", "+", 1),
        updated_at: eb.fn<Date>("now", []),
        updated_by: by,
      }))
      .where("id", "=", item.id)
      .where("version", "=", item.version)
      .returning("version")
      .executeTakeFirstOrThrow();
    await record(tx, audit, {
      action: status === "done" ? "work_item.complete" : "work_item.cancel",
      recordType: "work_item",
      recordId: item.id,
      organizationId: item.organization_id,
      transformationId: item.transformation_id,
      priorVersion: item.version,
      newVersion: updated.version,
      changes: { status: { from: "open", to: status } },
    });
  }
}

async function lockRoute(tx: Tx, approvalId: string): Promise<void> {
  await sql`SELECT pg_advisory_xact_lock(${ROUTE_LOCK_CLASS}::integer, hashtext(${approvalId}::text))`.execute(tx);
}

async function stepsOf(db: DbOrTx, approvalId: string, roundNo?: number): Promise<ApprovalRouteStepRow[]> {
  let q = db.selectFrom("approval_route_step").selectAll().where("approval_id", "=", approvalId);
  if (roundNo !== undefined) q = q.where("round_no", "=", roundNo);
  return q.orderBy("round_no").orderBy("step_no").execute();
}

/** True when the approval's current round has route steps (a routed approval; ADR-0044 §4). */
export async function isRoutedApproval(db: DbOrTx, a: Pick<ApprovalRow, "id" | "round_no">): Promise<boolean> {
  const row = await db
    .selectFrom("approval_route_step")
    .select("id")
    .where("approval_id", "=", a.id)
    .where("round_no", "=", a.round_no)
    .limit(1)
    .executeTakeFirst();
  return row !== undefined;
}

/** Updates one step (version + 1) with its audit event in the caller's transaction. */
async function updateStep(
  tx: Tx,
  audit: AuditContext,
  step: ApprovalRouteStepRow,
  set: {
    status: ApprovalRouteStepStatus;
    activated?: boolean;
    decidedBy?: string;
    decidedOnBehalfOf?: string | null;
    note?: string | null;
  },
  action: string,
): Promise<ApprovalRouteStepRow> {
  const decided = set.decidedBy !== undefined;
  const updated = await tx
    .updateTable("approval_route_step")
    .set({
      status: set.status,
      ...(set.activated === true ? { activated_at: sql<Date>`now()` } : {}),
      ...(decided
        ? {
            decided_by: set.decidedBy,
            decided_on_behalf_of: set.decidedOnBehalfOf ?? null,
            decided_at: sql<Date>`now()`,
            decision_note: set.note ?? null,
          }
        : {}),
      version: sql<number>`version + 1`,
      updated_at: sql<Date>`now()`,
      updated_by: audit.actorUserId,
    })
    .where("id", "=", step.id)
    .where("version", "=", step.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, audit, {
    action,
    recordType: "approval_route_step",
    recordId: step.id,
    organizationId: step.organization_id,
    transformationId: step.transformation_id,
    priorVersion: step.version,
    newVersion: updated.version,
    changes: {
      status: { from: step.status, to: updated.status },
      ...(decided
        ? {
            decided_by: { from: null, to: updated.decided_by },
            decided_on_behalf_of: { from: null, to: updated.decided_on_behalf_of },
          }
        : {}),
    },
  });
  return updated;
}

// ------------------------------------------------------------------------------------------------ instantiation

/**
 * Inserts the route steps of the approval's CURRENT round (ADR-0044 §4 "Instantiation") and notifies the active steps'
 * role holders; returns false (writing nothing) for an unrouted approval, whose DG4 assignee tasks the caller creates.
 * On a resubmission (round > 1) the route of the previous round is reused, so a DG4 approval without route rows stays
 * unrouted for its whole life and a routed one keeps its roles and mode; round 1 resolves the route from configuration.
 */
export async function instantiateApprovalRoute(tx: Tx, audit: AuditContext, a: ApprovalRow): Promise<boolean> {
  let route: ResolvedApprovalRoute | null;
  if (a.round_no > 1) {
    const previous = await stepsOf(tx, a.id, a.round_no - 1);
    const first = previous[0];
    route =
      first === undefined
        ? null
        : {
            routeKey: first.route_key,
            mode: first.route_mode as ResolvedApprovalRoute["mode"],
            roleCodes: previous.map((s) => s.approver_role_code),
          };
  } else {
    route = await resolveApprovalRoute(tx, a);
  }
  if (route === null) return false;
  await lockRoute(tx, a.id);
  const by = audit.actorUserId;
  for (const [n, roleCode] of route.roleCodes.entries()) {
    const stepNo = n + 1;
    const active = route.mode === "parallel" || stepNo === 1;
    const id = uuidv7();
    const step = await tx
      .insertInto("approval_route_step")
      .values({
        id,
        organization_id: a.organization_id,
        transformation_id: a.transformation_id,
        approval_id: a.id,
        round_no: a.round_no,
        route_key: route.routeKey,
        route_mode: route.mode,
        step_no: stepNo,
        approver_role_code: roleCode,
        assignee_user_id: null,
        status: active ? "active" : "waiting",
        activated_at: active ? sql<Date>`now()` : null,
        created_by: by,
        updated_by: by,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await record(tx, audit, {
      action: "approval_route_step.create",
      recordType: "approval_route_step",
      recordId: id,
      organizationId: a.organization_id,
      transformationId: a.transformation_id,
      newVersion: 1,
      changes: {
        approval_id: { from: null, to: a.id },
        round_no: { from: null, to: a.round_no },
        route_key: { from: null, to: route.routeKey },
        route_mode: { from: null, to: route.mode },
        step_no: { from: null, to: stepNo },
        approver_role_code: { from: null, to: roleCode },
        status: { from: null, to: step.status },
      },
    });
    if (active) await notifyStep(tx, audit, a, step);
  }
  return true;
}

/** Cancels the open (active or waiting) steps of a round and their work items (withdrawal, reject, request changes). */
export async function cancelOpenRouteSteps(
  tx: Tx,
  audit: AuditContext,
  a: ApprovalRow,
  exceptStepNo: number | null = null,
): Promise<void> {
  const steps = await stepsOf(tx, a.id, a.round_no);
  for (const s of steps) {
    if (s.step_no === exceptStepNo || (s.status !== "active" && s.status !== "waiting")) continue;
    await updateStep(tx, audit, s, { status: "cancelled" }, "approval_route_step.cancel");
    await closeStepItems(tx, audit, a, s, "cancelled");
  }
}

// ------------------------------------------------------------------------------------------------ views

const toStep = (s: ApprovalRouteStepRow) => ({
  stepNo: s.step_no,
  roundNo: s.round_no,
  approverRoleCode: s.approver_role_code,
  assigneeUserId: s.assignee_user_id,
  status: s.status as ApprovalRouteStepStatus,
  activatedAt: isoOrNull(s.activated_at),
  decidedBy: s.decided_by,
  decidedOnBehalfOf: s.decided_on_behalf_of,
  decidedAt: isoOrNull(s.decided_at),
  decisionNote: s.decision_note,
});

/** The ApprovalRoute view: the current round's route key and mode; every round's steps (history first). */
export async function toApprovalRoute(db: DbOrTx, a: ApprovalRow): Promise<ApprovalRoute> {
  const steps = await stepsOf(db, a.id);
  const current = steps.filter((s) => s.round_no === a.round_no);
  const latest = current[0] ?? steps.at(-1);
  return {
    approvalId: a.id,
    routed: latest !== undefined,
    routeKey: latest?.route_key ?? null,
    mode: (latest?.route_mode as ApprovalRoute["mode"] | undefined) ?? null,
    currentRoundNo: a.round_no,
    steps: steps.map(toStep),
    approvalStatus: a.status,
    approvalVersion: a.version,
  };
}

// ------------------------------------------------------------------------------------------------ decision

async function targetOf(db: DbOrTx, a: ApprovalRow): Promise<ResolvedTarget & { transformationId: string }> {
  const t = await db
    .selectFrom("transformation")
    .select(["organization_id", "business_unit_id"])
    .where("id", "=", a.transformation_id)
    .executeTakeFirstOrThrow();
  const target = await targetFor(db, "transformation", {
    organizationId: t.organization_id,
    businessUnitId: t.business_unit_id,
    transformationId: a.transformation_id,
  });
  return { ...target, transformationId: a.transformation_id };
}

/** The approval's read rule (approvals.ts readGate): 404 outside scope; 403 for a technical-admin-only member. */
async function readRule(db: DbOrTx, principal: Principal, a: ApprovalRow): Promise<void> {
  try {
    await requireTransformationRead(db, principal, a.transformation_id);
  } catch (err) {
    if (isTechnicalAdminOnly(principal, a.organization_id))
      throw problems.forbidden().withDenial(denialOf("approval.decide", await targetOf(db, a)));
    throw err;
  }
}

/** The capacity in which the caller decides a step: holding its role, or as the DG4 delegate of a holder. */
async function stepCapacity(
  tx: Tx,
  principal: Principal,
  a: ApprovalRow,
  step: ApprovalRouteStepRow,
  target: ResolvedTarget,
): Promise<{ onBehalfOf: string | null }> {
  principal.tracker.decisions += 1;
  if (
    principal.grants.some((g) => g.roleCode === step.approver_role_code && grantApplies(g, "approval.decide", target))
  )
    return { onBehalfOf: null };
  for (const holder of await stepRoleHolders(tx, a.transformation_id, step.approver_role_code))
    if (await actsFor(tx, principal, holder, "approval", target, "approval.decide")) return { onBehalfOf: holder };
  throw approvalRouteRefusals.notStepApprover().withDenial(denialOf("approval.decide", target));
}

const STEP_STATUS: ReadonlyMap<string, "approved" | "rejected" | "changes_requested"> = new Map([
  ["approve", "approved"],
  ["reject", "rejected"],
  ["request_changes", "changes_requested"],
]);

/**
 * Decides one step (ADR-0044 §4 "Decision"). Checks, in order, nothing written on a refusal: 404 (approval, read rule,
 * step); commit-time approval.decide in scope; 403 approval_route.not_step_approver; 403 approval_route.self_decision;
 * 403 approval_route.one_step_per_person; 428/409 If-Match on the approval; 422 approval_route.step_not_active; 409
 * approval.stale_version (the subject moved). Then the step's decision, its audit event, and the completion rule.
 */
async function decideStep(
  tx: Tx,
  request: Parameters<typeof principalOf>[0],
  approvalId: string,
  stepNo: number,
): Promise<ApprovalRow> {
  const body = parseBody(approvalRouteStepDecision, request.body);
  const seen = await tx.selectFrom("approval").selectAll().where("id", "=", approvalId).executeTakeFirst();
  if (!seen) throw problems.notFound();
  await readRule(tx, principalOf(request), seen);
  const fresh = await refreshPrincipal(tx, request);
  const a = (await tx.selectFrom("approval").selectAll().where("id", "=", approvalId).forUpdate().executeTakeFirst())!;
  let target: ResolvedTarget & { transformationId: string };
  try {
    await readRule(tx, fresh, a);
    target = await targetOf(tx, a);
    await requireAction(tx, fresh, "approval.decide", target);
  } catch (err) {
    throw commitTimeDenial(err);
  }
  await sql`SELECT pg_advisory_xact_lock(${SUBJECT_LOCK_CLASS}::integer, hashtext(${a.subject_id}::text))`.execute(tx);
  await lockRoute(tx, a.id);
  const steps = await stepsOf(tx, a.id, a.round_no);
  const step = steps.find((s) => s.step_no === stepNo);
  if (!step) throw problems.notFound();
  const me = fresh.userId!;
  const acting = await stepCapacity(tx, fresh, a, step, target);
  if (a.sod_policy === "requester_excluded" && (me === a.requested_by || acting.onBehalfOf === a.requested_by))
    throw approvalRouteRefusals.selfDecision().withDenial(denialOf("approval.decide", target));
  const person = acting.onBehalfOf ?? me;
  const other = steps.find(
    (s) =>
      s.id !== step.id &&
      s.decided_by !== null &&
      (s.decided_by === me ||
        s.decided_by === person ||
        (s.decided_on_behalf_of !== null && s.decided_on_behalf_of === person)),
  );
  if (other) throw approvalRouteRefusals.oneStepPerPerson().withDenial(denialOf("approval.decide", target));
  const expected = requireIfMatch(request);
  if (a.version !== expected) throw problems.versionConflict(a.version);
  if (step.status !== "active" || !(DECIDABLE as readonly string[]).includes(a.status))
    throw approvalRouteRefusals.stepNotActive();
  const current = await subjectVersionOf(tx, a.approval_type, a.subject_id, a.transformation_id);
  if (current === null || current !== a.subject_version)
    throw approvalRefusals.stale(a.subject_version, current ?? a.subject_version);

  const audit: AuditContext = { ...auditContextOf(request), onBehalfOfUserId: acting.onBehalfOf };
  const status = STEP_STATUS.get(body.outcome)!;
  const decided = await updateStep(
    tx,
    audit,
    step,
    { status, decidedBy: me, decidedOnBehalfOf: acting.onBehalfOf, note: body.note ?? null },
    "approval_route_step.decide",
  );
  await closeStepItems(tx, audit, a, step, "done");
  const after = steps.map((s) => (s.id === decided.id ? decided : s));
  const complete = (outcome: "approve" | "reject" | "request_changes", rationale: string) =>
    decideApprovalInTx(tx, auditContextOf(request), {
      approvalId: a.id,
      principal: fresh,
      target,
      outcome,
      rationale,
      comments: null,
      subjectVersion: a.subject_version,
      expectedApprovalVersion: a.version,
      routeStepActing: { onBehalfOf: acting.onBehalfOf },
    });
  if (status !== "approved") {
    await cancelOpenRouteSteps(tx, audit, a, step.step_no);
    return complete(
      body.outcome,
      body.note ??
        `Step ${step.step_no} of route ${step.route_key} (${step.approver_role_code}) recorded ${body.outcome} in round ${a.round_no}.`,
    );
  }
  if (after.every((s) => s.status === "approved"))
    return complete(
      "approve",
      body.note ?? `Every step of route ${step.route_key} approved in round ${a.round_no} (${after.length} steps).`,
    );
  if (step.route_mode === "sequential") {
    const next = after.find((s) => s.status === "waiting");
    if (next) {
      const activated = await updateStep(
        tx,
        audit,
        next,
        { status: "active", activated: true },
        "approval_route_step.activate",
      );
      await notifyStep(tx, audit, a, activated);
    }
  }
  return a;
}

// ------------------------------------------------------------------------------------------------ admin list

/** methodology.read in the caller's organization (the Studio read rule; methodology/drafts.ts requireStudioPermission). */
function requireMethodologyRead(principal: Principal): void {
  principal.tracker.decisions += 1;
  const org = principal.organizationId;
  const allowed =
    org !== null && principal.grants.some((g) => g.permissions.has("methodology.read") && g.organizationId === org);
  if (allowed && principal.userId !== null) return;
  const denied = problems.forbidden();
  throw org === null
    ? denied
    : denied.withDenial(
        denialOf("methodology.read", {
          level: "organization",
          organizationId: org,
          businessUnitId: null,
          transformationId: null,
          businessUnitAncestry: [],
        }),
      );
}

const labelOf = (attributes: Readonly<Record<string, unknown>>, field: "labelEn" | "labelAr"): string | null => {
  const v = new Map(Object.entries(attributes)).get(field);
  return typeof v === "string" ? v : null;
};

/** The routes of a published version: a methodology version's approver_route elements, or a procedure version's routes. */
async function routesOfVersion(
  db: DbOrTx,
  version: { id: string; config_kind: string },
): Promise<ApprovalRouteDefinition[]> {
  if (version.config_kind === "procedure") {
    const rows = await db
      .selectFrom("procedure_definition")
      .select(["code", "name_en", "name_ar", "approval_mode", "approval_role_codes"])
      .where("methodology_version_id", "=", version.id)
      .where("removed", "=", false)
      .where("approval_mode", "<>", "none")
      .orderBy("code")
      .execute();
    return rows.map((r) => ({
      routeKey: `procedure.${r.code}`,
      mode: r.approval_mode as ApprovalRouteDefinition["mode"],
      roleCodes: [...r.approval_role_codes],
      source: "procedure" as const,
      labelEn: r.name_en,
      labelAr: r.name_ar,
    }));
  }
  const elements = await resolver.elements(db, version.id, "approver_route");
  return elements
    .map((e) => ({ e, roles: rolesOf(e.attributes), mode: modeOf(e.attributes) }))
    .filter((x) => x.roles.length >= 1 && x.roles.length <= 6 && ["any", "sequential", "parallel"].includes(x.mode))
    .map(({ e, roles, mode }) => ({
      routeKey: e.stableKey,
      mode: mode as ApprovalRouteDefinition["mode"],
      roleCodes: roles,
      source: "approver_route" as const,
      labelEn: labelOf(e.attributes, "labelEn"),
      labelAr: labelOf(e.attributes, "labelAr"),
    }));
}

// ------------------------------------------------------------------------------------------------ routes

const approvalParams = z.strictObject({ approvalId: uuid });
const stepParams = z.strictObject({
  approvalId: uuid,
  stepNo: z
    .string()
    .regex(/^[1-6]$/, "validation.step_no")
    .transform(Number),
});
const listQuery = z.strictObject({ versionId: uuid.optional() });

/** Registers this file's routes and returns them as "METHOD /path". */
export function registerApprovalRouteRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  const ADMIN = "/api/v1/admin/approval-routes";
  const ROUTE = "/api/v1/approvals/:approvalId/route";
  const DECIDE = `${ROUTE}/steps/:stepNo/decision`;

  app.get(ADMIN, { config: { access: { permission: "methodology.read" } } }, async (request) => {
    const query = parseQuery(listQuery, request.query);
    requireMethodologyRead(principalOf(request));
    let q = db
      .selectFrom("methodology_version")
      .select(["id", "config_kind"])
      .where("status", "=", "published")
      .where("config_kind", "in", ["methodology", "procedure"]);
    q =
      query.versionId !== undefined
        ? q.where("id", "=", query.versionId)
        : q.where("config_kind", "=", "methodology").orderBy("published_at", "desc").orderBy("id", "desc").limit(1);
    const version = await q.executeTakeFirst();
    if (!version)
      throw problems.validation([
        {
          pointer: "/versionId",
          code: "validation.unknown_version",
          message: "Choose a published methodology or procedure version.",
        },
      ]);
    return { methodologyVersionId: version.id, items: await routesOfVersion(db, version) };
  });

  app.get(ROUTE, { config: { access: { permission: "transformation.read" } } }, async (request, reply) => {
    const { approvalId } = parse(approvalParams, request.params, "params");
    parseQuery(z.strictObject({}), request.query);
    const a = await db.selectFrom("approval").selectAll().where("id", "=", approvalId).executeTakeFirst();
    if (!a) throw problems.notFound();
    await requireTransformationRead(db, principalOf(request), a.transformation_id);
    return reply.header("etag", etag(a.version)).send(await toApprovalRoute(db, a));
  });

  app.post(
    DECIDE,
    { config: { access: { permission: "approval.decide" }, consumes: JSON_BODY } },
    async (request, reply) => {
      const { approvalId, stepNo } = parse(stepParams, request.params, "params");
      const a = await db.transaction().execute((tx) => decideStep(tx, request, approvalId, stepNo));
      const fresh = await db.selectFrom("approval").selectAll().where("id", "=", a.id).executeTakeFirstOrThrow();
      return reply
        .status(200)
        .header("etag", etag(fresh.version))
        .send(await toApprovalRoute(db, fresh));
    },
  );

  return [`GET ${ADMIN}`, `GET ${ROUTE}`, `POST ${DECIDE}`];
}
