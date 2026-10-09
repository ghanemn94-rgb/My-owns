// The P4 approval service (OpenAPI tag "approvals"; ADR-0026 §4, §6, §8; D-089 Q10; REQ-S10-003, REQ-S10-008,
// REQ-S10-014, REQ-S10-016, REQ-S10-017, REQ-S10-018; T-DG4-BE-B):
//   GET  /approvals                                    the caller's approvals: assigned to them, their groups, escalated
//                                                      to them, or to people they act for (role=assignee), or requested
//                                                      by them (role=requester); only transformations they can read
//   POST /transformations/{id}/approvals               request a decision routed by a T11 row (approval.request)
//   GET  /approvals/{id}                               one approval with its decisions and escalations
//   POST /approvals/{id}/decisions                     approve | reject | request_changes | defer (approval.decide and
//                                                      assigned; If-Match). The checks run in ADR-0026 §4's order
//   POST /approvals/{id}/resubmit                      after request changes: a newer subject version (the requester)
//   POST /approvals/{id}/withdraw                      the requester, with a reason. Final
//   GET  /transformations/{id}/approval-decisions      read-only union of business-approval decisions (D-089 Q10)
//
// These are BUSINESS approvals inside the product (G1-G6 style), decided by named people with a rationale. No timer, job
// or seed decides one: the escalation job (apps/worker/src/handlers/approvals.ts) only records an escalation, and the
// 0031 trigger refuses an approved/rejected status without a user's decision row. Nothing here reads or writes the
// engineering gates DG0-DG7.
//
// For other modules (S-14): a module that needs a business approval seeds its `approval_type` row by migration,
// registers its subject provider with `registerApprovalSubject`, and requests through `requestApprovalInTx` (with the
// routing from `routeByDecisionRight` where T11 applies). It never writes approval, approval_decision or
// approval_escalation itself. `onOutcome` runs in the deciding transaction (e.g. the governance matrix becomes approved).
import {
  sql,
  type ApprovalDecisionRow,
  type ApprovalEscalationRow,
  type ApprovalRow,
  type DbOrTx,
  type Tx,
} from "@mth/db";
import {
  approvalDecisionCreate,
  approvalRequestCreate,
  approvalResubmit,
  hasText,
  reasonRequest,
  uuid,
  type Approval,
  type ApprovalDecisionRecord,
} from "@mth/shared/schemas";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import {
  actsFor,
  approversOf,
  auditContextOf,
  commitTimeDenial,
  delegatorsOf,
  denialOf,
  effectiveGroupIds,
  isTechnicalAdminOnly,
  principalOf,
  refreshPrincipal,
  requireAction,
  requireTransformationRead,
  routeToParty,
  scopeFilter,
  targetFor,
  type Principal,
  type ResolvedTarget,
} from "../access/index.ts";
import { record, type AuditContext } from "../audit/index.ts";
import { computeWorkingDayDueDate } from "../organization/index.ts";
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

const JSON_BODY = ["application/json"] as const;
/** Per subject record (ADR-0016 §6): a module updating a record that is the subject of an open approval takes it too. */
export const APPROVAL_SUBJECT_LOCK_CLASS = ADVISORY_LOCK_CLASSES.approvalSubject;
const OPEN_STATUSES = ["pending", "changes_requested", "deferred"] as const;
const DECIDABLE_STATUSES = ["pending", "deferred"] as const;
/** The work-item kinds whose task closes with the approval (tasks SYSTEM_MANAGED_KINDS). */
const APPROVER_TASK_KINDS = ["approval_decision", "approval_escalated"] as const;
const linkOf = (approvalId: string) => `/my-work/approvals/${approvalId}`;

// ------------------------------------------------------------------------------------------------ refusals (ADR-0026 §4)

const rule = (code: string, detail: string, pointer: string) =>
  new HttpProblem({
    status: 422,
    type: "urn:mth:problem:validation",
    code,
    title: "Business rule violated",
    detail,
    errors: [{ pointer, code, message: detail }],
  });

/** The 409 stale refusal; its body carries `currentVersion` (the subject's) and `requestedVersion` (REQ-S10-017). */
export class StaleApprovalProblem extends HttpProblem {
  readonly requestedVersion: number;
  constructor(requestedVersion: number, currentVersion: number) {
    super({
      status: 409,
      type: "urn:mth:problem:version-conflict",
      code: "approval.stale_version",
      title: "Version conflict",
      detail: `The record changed after this approval was requested: version ${requestedVersion} was submitted and the record is now at version ${currentVersion}. Review the changes before deciding.`,
      currentVersion,
    });
    this.requestedVersion = requestedVersion;
  }
  override toBody(requestId: string, instance?: string) {
    return { ...super.toBody(requestId, instance), requestedVersion: this.requestedVersion } as ReturnType<
      HttpProblem["toBody"]
    >;
  }
}

const forbidden = (code: string, detail: string) =>
  new HttpProblem({ status: 403, type: "urn:mth:problem:forbidden", code, title: "Forbidden", detail });

export const approvalRefusals = {
  notAssignee: () =>
    forbidden("approval.not_assignee", "This approval is not assigned to you, your group or anyone you act for."),
  sodRequester: () =>
    forbidden(
      "approval.sod_requester",
      "You requested this change, so you cannot decide it. The separation-of-duties policy requires a different approver.",
    ),
  stale: (requested: number, current: number) => new StaleApprovalProblem(requested, current),
  notOpen: (status: string) =>
    rule("approval.not_open", `This approval is ${status} and can no longer be decided.`, ""),
  rationaleRequired: () => rule("approval.rationale_required", "Enter a rationale for this decision.", "/rationale"),
  deferDateRequired: () =>
    rule("approval.defer_date_required", "A deferral needs a new date after today.", "/deferUntil"),
  alreadyOpen: () => problems.duplicate("approval.already_open", "An approval for this record is already open."),
  resubmitNeedsNewVersion: () =>
    rule(
      "approval.resubmit_needs_new_version",
      "Resubmit after changing the record: the request must be for a newer version.",
      "/subjectVersion",
    ),
  notRequester: () => forbidden("approval.not_requester", "Only the requester can resubmit or withdraw this approval."),
  // T11 request refusals (ADR-0026 §5).
  urgentNotConfigured: () =>
    rule(
      "decision_right.urgent_not_configured",
      "This decision has no urgent route configured, so it cannot be raised as urgent.",
      "/urgent",
    ),
  urgentReasonRequired: () =>
    rule("decision_right.urgent_reason_required", "An urgent request needs a reason.", "/urgentReason"),
  // Not listed in ADR-0026 (field-level checks the ADR leaves to the API).
  decisionRightUnknown: () =>
    rule(
      "approval.decision_right_unknown",
      "Choose an active decision right of this transformation.",
      "/decisionRightId",
    ),
  subjectUnknown: () =>
    rule("approval.subject_unknown", "The record to approve does not exist in this transformation.", "/subjectId"),
  notResubmittable: (status: string) =>
    problems.invalidTransition(
      `This approval is ${status}; only an approval with changes requested can be resubmitted.`,
    ),
  calendarNotConfigured: () =>
    rule(
      "approval.calendar_not_configured",
      "Configure the organization's default business calendar before deferring this approval.",
      "/deferUntil",
    ),
} as const;

// ------------------------------------------------------------------------------------------------ subject registry

export type ApprovalOutcomeEventKind =
  | "approved"
  | "rejected"
  | "changes_requested"
  | "deferred"
  | "withdrawn"
  | "resubmitted";

export interface ApprovalOutcomeEvent {
  /** The approval row after the change. */
  readonly approval: ApprovalRow;
  readonly outcome: ApprovalOutcomeEventKind;
  readonly actorUserId: string;
  readonly audit: AuditContext;
}

/** What a module registers for its approval type's subject (BE-C: governance_matrix_change; BE-L: change_request). */
export interface ApprovalSubjectProvider {
  /** The subject's current version; default: the 0031 `p4_approval_subject_version` (row of `subject_table`). */
  readonly currentVersion?: (db: DbOrTx, subjectId: string, transformationId: string) => Promise<number | null>;
  /** Applies the outcome to the subject in the same transaction (e.g. the matrix becomes approved / draft). */
  readonly onOutcome?: (tx: Tx, event: ApprovalOutcomeEvent) => Promise<void>;
}

const SUBJECTS = new Map<string, ApprovalSubjectProvider>();

/** Registers (or replaces, so a second server instance in one process is harmless) a subject provider. */
export function registerApprovalSubject(approvalType: string, provider: ApprovalSubjectProvider): void {
  SUBJECTS.set(approvalType, provider);
}

/** The subject's current version, read FOR SHARE (a concurrent subject update waits); null when it does not exist. */
export async function subjectVersionOf(
  db: DbOrTx,
  approvalType: string,
  subjectId: string,
  transformationId: string,
): Promise<number | null> {
  const p = SUBJECTS.get(approvalType);
  if (p?.currentVersion) return p.currentVersion(db, subjectId, transformationId);
  const r = await sql<{ v: number | null }>`
    SELECT p4_approval_subject_version(${approvalType}, ${subjectId}::uuid, ${transformationId}::uuid) AS v`.execute(
    db,
  );
  return r.rows[0]?.v ?? null;
}

async function lockSubject(tx: Tx, subjectId: string): Promise<void> {
  await sql`SELECT pg_advisory_xact_lock(${APPROVAL_SUBJECT_LOCK_CLASS}::integer, hashtext(${subjectId}::text))`.execute(
    tx,
  );
}

async function emitOutcome(tx: Tx, event: ApprovalOutcomeEvent): Promise<void> {
  const p = SUBJECTS.get(event.approval.approval_type);
  if (p?.onOutcome) await p.onOutcome(tx, event);
}

// ------------------------------------------------------------------------------------------------ T11 routing seam

export interface DueDate {
  /** null = Unknown with `unknownReason`; never guessed, never elapsed calendar days. */
  readonly dueDate: string | null;
  readonly unknownReason: "no_steerco_scheduled" | "no_release_date" | "calendar_not_configured" | "no_sla" | null;
  readonly calendarId: string | null;
  readonly calendarVersion: number | null;
}

export interface DecisionRightRouting {
  readonly decisionRightId: string;
  /** The row's Approve party (ADR-0026 §5); resolved by the service through `routeToParty`. */
  readonly approvePartyCode: string;
  readonly slaType: "working_days" | "next_steerco_or_urgent" | "release_plan";
  readonly urgentReason: string | null;
  readonly due: DueDate;
}

export interface DecisionRightRequest {
  readonly organizationId: string;
  readonly transformationId: string;
  readonly decisionRightId: string;
  /** The request's business date (ADR-0025 §2) from which working days count. */
  readonly requestBusinessDate: string;
  readonly urgent: boolean;
  readonly urgentReason: string | null;
  readonly releaseMilestoneId: string | null;
}

/** Reads a T11 row and computes its SLA (BE-C's `routeByDecisionRight` registers itself with `setDecisionRightRouter`). */
export type DecisionRightRouter = (tx: Tx, request: DecisionRightRequest) => Promise<DecisionRightRouting>;

/**
 * The default T11 router (ADR-0026 §5, D-089 Q6), used until governance/decision-rights.ts (BE-C) registers its own:
 *  - working_days: addWorkingDays over the organization's default calendar (Unknown `calendar_not_configured`);
 *  - next_steerco_or_urgent: urgent (with a reason) -> urgent_working_days; otherwise the next scheduled SteerCo, which
 *    no provider supplies yet, so the due date is Unknown `no_steerco_scheduled` (never guessed);
 *  - release_plan: the approved date of the named milestone, else Unknown `no_release_date`.
 */
export const defaultDecisionRightRouter: DecisionRightRouter = async (tx, req) => {
  const row = await tx
    .selectFrom("transformation_decision_right")
    .selectAll()
    .where("id", "=", req.decisionRightId)
    .where("transformation_id", "=", req.transformationId)
    .where("status", "=", "active")
    .executeTakeFirst();
  if (!row) throw approvalRefusals.decisionRightUnknown();
  const slaType = row.sla_type as DecisionRightRouting["slaType"];
  if (req.urgent) {
    if (req.urgentReason === null) throw approvalRefusals.urgentReasonRequired();
    if (slaType !== "next_steerco_or_urgent" || row.urgent_working_days === null)
      throw approvalRefusals.urgentNotConfigured();
  }
  const unknown = (reason: DueDate["unknownReason"]): DueDate => ({
    dueDate: null,
    unknownReason: reason,
    calendarId: null,
    calendarVersion: null,
  });
  let due: DueDate;
  if (slaType === "working_days") {
    due = await computeWorkingDayDueDate(tx, req.organizationId, req.requestBusinessDate, row.sla_working_days!);
  } else if (slaType === "next_steerco_or_urgent") {
    due = req.urgent
      ? await computeWorkingDayDueDate(tx, req.organizationId, req.requestBusinessDate, row.urgent_working_days!)
      : unknown("no_steerco_scheduled");
  } else {
    const m =
      req.releaseMilestoneId === null
        ? undefined
        : await tx
            .selectFrom("milestone")
            .select("approved_date")
            .where("id", "=", req.releaseMilestoneId)
            .where("transformation_id", "=", req.transformationId)
            .executeTakeFirst();
    due = m?.approved_date
      ? { dueDate: m.approved_date, unknownReason: null, calendarId: null, calendarVersion: null }
      : unknown("no_release_date");
  }
  return {
    decisionRightId: row.id,
    approvePartyCode: row.approve_party_code,
    slaType,
    urgentReason: req.urgent ? req.urgentReason : null,
    due,
  };
};

let decisionRightRouter: DecisionRightRouter = defaultDecisionRightRouter;

/** BE-C wires `routeByDecisionRight` here (registration time); passing null restores the default. */
export function setDecisionRightRouter(router: DecisionRightRouter | null): void {
  decisionRightRouter = router ?? defaultDecisionRightRouter;
}

// ------------------------------------------------------------------------------------------------ helpers

/** Today's business date for an approval: the calendar's timezone, else the organization's (the 0031 guard's rule). */
async function todayOf(db: DbOrTx, organizationId: string, calendarId: string | null): Promise<string> {
  const r = await sql<{ d: string }>`
    SELECT p4_business_date(now(), coalesce(
      (SELECT c.timezone FROM business_calendar c WHERE c.id = ${calendarId}::uuid),
      (SELECT o.default_timezone FROM organization o WHERE o.id = ${organizationId}::uuid)))::text AS d`.execute(db);
  return r.rows[0]!.d;
}

/** Outcome -> status (a Map: module source never looks up a runtime key with a computed member, F-DG1-124). */
const OUTCOME_STATUS: ReadonlyMap<string, "approved" | "rejected" | "changes_requested" | "deferred"> = new Map([
  ["approve", "approved"],
  ["reject", "rejected"],
  ["request_changes", "changes_requested"],
  ["defer", "deferred"],
]);

async function findApproval(db: DbOrTx, id: string, lock = false): Promise<ApprovalRow | undefined> {
  let q = db.selectFrom("approval").selectAll().where("id", "=", id);
  if (lock) q = q.forUpdate();
  return q.executeTakeFirst();
}

const toDecisionEntry = (d: ApprovalDecisionRow) => ({
  id: d.id,
  roundNo: d.round_no,
  outcome: d.outcome as Approval["decisions"][number]["outcome"],
  rationale: d.rationale,
  comments: d.comments,
  subjectVersion: d.subject_version,
  decidedBy: d.decided_by,
  onBehalfOfUserId: d.on_behalf_of_user_id,
  decidedAt: iso(d.decided_at),
  businessDate: d.business_date,
  deferUntil: d.defer_until,
});

const toEscalation = (e: ApprovalEscalationRow) => ({
  id: e.id,
  roundNo: e.round_no,
  dueDate: e.due_date,
  level: e.level,
  fromPartyCode: e.from_party_code,
  toPartyCode: e.to_party_code,
  toUserId: e.to_user_id,
  toGroupId: e.to_group_id,
  routingError: e.routing_error as Approval["escalations"][number]["routingError"],
  escalatedAt: iso(e.escalated_at),
});

/** The API shape of approvals, with their decisions and escalations (one query each for the whole page). */
export async function toApprovals(db: DbOrTx, rows: readonly ApprovalRow[]): Promise<Approval[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const decisions = await db
    .selectFrom("approval_decision")
    .selectAll()
    .where("approval_id", "in", ids)
    .orderBy("decided_at")
    .orderBy("id")
    .execute();
  const escalations = await db
    .selectFrom("approval_escalation")
    .selectAll()
    .where("approval_id", "in", ids)
    .orderBy("escalated_at")
    .orderBy("id")
    .execute();
  return rows.map((r) => ({
    id: r.id,
    transformationId: r.transformation_id,
    approvalType: r.approval_type,
    subjectType: r.subject_type,
    subjectId: r.subject_id,
    subjectVersion: r.subject_version,
    roundNo: r.round_no,
    decisionRightId: r.decision_right_id,
    title: r.title,
    requestNote: r.request_note,
    requestedBy: r.requested_by,
    requestedAt: iso(r.requested_at),
    requestBusinessDate: r.request_business_date,
    assignee: { partyCode: r.assignee_party_code, userId: r.assignee_user_id, groupId: r.assignee_group_id },
    slaType: r.sla_type as Approval["slaType"],
    urgentReason: r.urgent_reason,
    dueDate: r.due_date,
    dueUnknownReason: r.due_unknown_reason as Approval["dueUnknownReason"],
    calendarId: r.calendar_id,
    status: r.status as Approval["status"],
    escalationLevel: r.escalation_level,
    escalatedTo:
      r.escalated_to_party_code === null
        ? null
        : { partyCode: r.escalated_to_party_code, userId: r.escalated_to_user_id, groupId: r.escalated_to_group_id },
    decidedBy: r.decided_by,
    decidedOnBehalfOf: r.decided_on_behalf_of,
    decidedAt: isoOrNull(r.decided_at),
    decisions: decisions.filter((d) => d.approval_id === r.id).map(toDecisionEntry),
    escalations: escalations.filter((e) => e.approval_id === r.id).map(toEscalation),
    version: r.version,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  }));
}

async function toApproval(db: DbOrTx, row: ApprovalRow): Promise<Approval> {
  return (await toApprovals(db, [row]))[0]!;
}

/** The transformation target of an approval (for policy decisions). */
async function targetOfApproval(db: DbOrTx, a: ApprovalRow): Promise<ResolvedTarget & { transformationId: string }> {
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

/** The users who currently receive the approval task: the assignee person, or the assignee group's approvers. */
async function assigneeApprovers(db: DbOrTx, a: ApprovalRow, scope: ResolvedTarget): Promise<string[]> {
  if (a.assignee_user_id !== null) return [a.assignee_user_id];
  return approversOf(db, { status: "mapped", mappingId: "", kind: "group", groupId: a.assignee_group_id! }, scope);
}

/** One `approval_decision` task (and its reminder) per approver for this round and due date; never the requester. */
async function createApproverTasks(tx: Tx, audit: AuditContext, a: ApprovalRow, approverIds: readonly string[]) {
  for (const userId of approverIds) {
    if (userId === a.requested_by && a.sod_policy === "requester_excluded") continue;
    await createWorkItemOnce(
      tx,
      { actorType: "user", actorUserId: audit.actorUserId, requestId: audit.requestId, source: "api" },
      {
        organizationId: a.organization_id,
        transformationId: a.transformation_id,
        kind: "approval_decision",
        assigneeUserId: userId,
        subjectType: "approval",
        subjectId: a.id,
        linkPath: linkOf(a.id),
        messageKey: "approvals.task.decide",
        messageParams: { title: a.title, approvalType: a.approval_type, roundNo: a.round_no, dueDate: a.due_date },
        dueDate: a.due_date,
        dedupeKey: `approval.assign:${a.id}:${a.round_no}:${a.due_date ?? "unknown"}:${userId}`,
      },
    );
  }
}

const userActor = (audit: AuditContext) =>
  ({ actorType: "user", actorUserId: audit.actorUserId, requestId: audit.requestId, source: "api" }) as const;

// ------------------------------------------------------------------------------------------------ request

export interface ApprovalRequestInput {
  readonly organizationId: string;
  readonly transformationId: string;
  /** The transformation's resolved target (routing checks approval.decide in this scope). */
  readonly scope: ResolvedTarget & { transformationId: string };
  readonly approvalType: string;
  readonly subjectId: string;
  readonly subjectVersion: number;
  readonly title: string;
  readonly requestNote: string | null;
  /** The party the approval is routed to (resolved through role mapping; no fallback). */
  readonly assigneePartyCode: string;
  readonly decisionRightId: string | null;
  readonly slaType: "working_days" | "next_steerco_or_urgent" | "release_plan" | null;
  readonly urgentReason: string | null;
  /** null = compute nothing: due date Unknown with reason `no_sla`. */
  readonly due: DueDate | null;
  /** The request's business date, when the caller already computed it (for the SLA); else today in the organization. */
  readonly requestBusinessDate?: string;
}

/**
 * Requests a business approval in `tx` (ADR-0026 §4): the subject must exist in the transformation at
 * `subjectVersion` (409 approval.stale_version otherwise), no other open approval of the type on the subject (409
 * approval.already_open), the party resolved to a person or group that can decide (422 routing.role_unmapped /
 * routing.assignee_not_approver; nothing written). Inserts the approval (pending, round 1), its audit event and one
 * `approval_decision` task per approver. The caller has already authorised the requester.
 */
export async function requestApprovalInTx(
  tx: Tx,
  audit: AuditContext,
  input: ApprovalRequestInput,
): Promise<ApprovalRow> {
  const requesterId = audit.actorUserId;
  if (requesterId === null) throw new Error("requestApprovalInTx: a person requests an approval");
  await lockSubject(tx, input.subjectId);
  const current = await subjectVersionOf(tx, input.approvalType, input.subjectId, input.transformationId);
  if (current === null) throw approvalRefusals.subjectUnknown();
  if (current !== input.subjectVersion) throw approvalRefusals.stale(input.subjectVersion, current);
  const open = await tx
    .selectFrom("approval")
    .select("id")
    .where("approval_type", "=", input.approvalType)
    .where("subject_id", "=", input.subjectId)
    .where("status", "in", [...OPEN_STATUSES])
    .executeTakeFirst();
  if (open) throw approvalRefusals.alreadyOpen();
  const routed = await routeToParty(tx, input.scope, input.assigneePartyCode);
  const type = await tx
    .selectFrom("approval_type")
    .select(["subject_table", "default_sod_policy"])
    .where("code", "=", input.approvalType)
    .executeTakeFirstOrThrow();
  const due: DueDate = input.due ?? { dueDate: null, unknownReason: "no_sla", calendarId: null, calendarVersion: null };
  const businessDate = input.requestBusinessDate ?? (await todayOf(tx, input.organizationId, due.calendarId));
  const id = uuidv7();
  const row = await tx
    .insertInto("approval")
    .values({
      id,
      organization_id: input.organizationId,
      transformation_id: input.transformationId,
      approval_type: input.approvalType,
      subject_type: type.subject_table,
      subject_id: input.subjectId,
      subject_version: input.subjectVersion,
      decision_right_id: input.decisionRightId,
      title: input.title,
      request_note: input.requestNote,
      requested_by: requesterId,
      request_business_date: businessDate,
      assignee_party_code: input.assigneePartyCode,
      assignee_user_id: routed.target.kind === "user" ? routed.target.userId : null,
      assignee_group_id: routed.target.kind === "group" ? routed.target.groupId : null,
      sla_type: input.slaType,
      urgent_reason: input.urgentReason,
      due_date: due.dueDate,
      due_unknown_reason: due.dueDate === null ? (due.unknownReason ?? "no_sla") : null,
      calendar_id: due.calendarId,
      calendar_version: due.calendarVersion,
      sod_policy: type.default_sod_policy,
      created_by: requesterId,
      updated_by: requesterId,
    })
    .returningAll()
    .executeTakeFirstOrThrow()
    .catch((err: unknown) => {
      const c = (err as { constraint?: string } | null)?.constraint;
      if (c === "approval_one_open_per_subject") throw approvalRefusals.alreadyOpen();
      throw err;
    });
  await record(tx, audit, {
    action: "approval.request",
    recordType: "approval",
    recordId: id,
    organizationId: input.organizationId,
    transformationId: input.transformationId,
    newVersion: 1,
    changes: {
      approval_type: { from: null, to: row.approval_type },
      subject_id: { from: null, to: row.subject_id },
      subject_version: { from: null, to: row.subject_version },
      assignee_party_code: { from: null, to: row.assignee_party_code },
      assignee_user_id: { from: null, to: row.assignee_user_id },
      assignee_group_id: { from: null, to: row.assignee_group_id },
      due_date: { from: null, to: row.due_date },
      due_unknown_reason: { from: null, to: row.due_unknown_reason },
      sod_policy: { from: null, to: row.sod_policy },
    },
  });
  await createApproverTasks(tx, audit, row, routed.approverUserIds);
  return row;
}

// ------------------------------------------------------------------------------------------------ decide

/** Rule 1 of ADR-0026 §4, with REQ-S10-003: a member of the approval's organization who cannot read it gets 403. */
// isTechnicalAdminOnly is shared with the DG1-DG3 gate and Finance endpoints (access/technical-admin.ts; D-094).

async function readGate(
  db: DbOrTx,
  principal: Principal,
  a: ApprovalRow,
): Promise<ResolvedTarget & { transformationId: string }> {
  const target = await targetOfApproval(db, a);
  try {
    await requireTransformationRead(db, principal, a.transformation_id);
  } catch (err) {
    // REQ-S10-003 ("an ADM-only user ... gets 403"): a caller whose every grant in the approval's organization is a
    // technical-administrator role is refused with 403 (the missing business-approval right), not 404. Only such a
    // caller: anyone else who cannot read the transformation, inside or outside the organization, still gets 404.
    if (isTechnicalAdminOnly(principal, a.organization_id))
      throw problems.forbidden().withDenial(denialOf("approval.decide", target));
    throw err;
  }
  return target;
}

interface Acting {
  readonly onBehalfOf: string | null;
}

/** Rule 3: the assignee, an effective member of the assignee group, the escalation target, or their delegate. */
async function actingCapacity(
  tx: Tx,
  principal: Principal,
  a: ApprovalRow,
  target: ResolvedTarget,
  requestedOnBehalfOf: string | undefined,
): Promise<Acting> {
  const me = principal.userId!;
  const myGroups = new Set(await effectiveGroupIds(tx, me));
  const directly =
    a.assignee_user_id === me ||
    a.escalated_to_user_id === me ||
    (a.assignee_group_id !== null && myGroups.has(a.assignee_group_id)) ||
    (a.escalated_to_group_id !== null && myGroups.has(a.escalated_to_group_id));
  if (requestedOnBehalfOf === undefined && directly) return { onBehalfOf: null };
  const isAssignee = async (userId: string) => {
    if (userId === a.assignee_user_id || userId === a.escalated_to_user_id) return true;
    const groups = new Set(await effectiveGroupIds(tx, userId));
    return (
      (a.assignee_group_id !== null && groups.has(a.assignee_group_id)) ||
      (a.escalated_to_group_id !== null && groups.has(a.escalated_to_group_id))
    );
  };
  const candidates =
    requestedOnBehalfOf !== undefined
      ? [requestedOnBehalfOf]
      : [a.assignee_user_id, a.escalated_to_user_id].filter((x): x is string => x !== null);
  for (const userId of candidates) {
    if (userId === me) continue;
    if (!(await isAssignee(userId))) continue;
    if (await actsFor(tx, principal, userId, "approval", target, "approval.decide")) return { onBehalfOf: userId };
  }
  throw approvalRefusals.notAssignee().withDenial(denialOf("approval.decide", target));
}

async function decideApproval(tx: Tx, request: FastifyRequest, approvalId: string): Promise<ApprovalRow> {
  const body = parseBody(approvalDecisionCreate, request.body);
  const seen = await findApproval(tx, approvalId);
  if (!seen) throw problems.notFound();
  // 1. read gate (request-start grants: 404 hides existence; REQ-S10-003 variant above)
  await readGate(tx, principalOf(request), seen);
  // 2-4. re-checked at commit time on reloaded grants (DG3 lesson 4)
  const fresh = await refreshPrincipal(tx, request);
  const a = (await findApproval(tx, approvalId, true))!;
  let target: ResolvedTarget & { transformationId: string };
  try {
    target = await readGate(tx, fresh, a);
    await requireAction(tx, fresh, "approval.decide", target);
  } catch (err) {
    throw commitTimeDenial(err);
  }
  const acting = await actingCapacity(tx, fresh, a, target, body.onBehalfOfUserId);
  const me = fresh.userId!;
  if (a.sod_policy === "requester_excluded" && (me === a.requested_by || acting.onBehalfOf === a.requested_by))
    throw approvalRefusals.sodRequester().withDenial(denialOf("approval.decide", target));
  // 5. If-Match on the approval
  const expected = requireIfMatch(request);
  if (a.version !== expected) throw problems.versionConflict(a.version);
  // 6. open
  if (!(DECIDABLE_STATUSES as readonly string[]).includes(a.status)) throw approvalRefusals.notOpen(a.status);
  // 7. stale: the request version and the subject's current version (read FOR SHARE under the approval-subject lock)
  await lockSubject(tx, a.subject_id);
  const current = await subjectVersionOf(tx, a.approval_type, a.subject_id, a.transformation_id);
  if (current === null || current !== a.subject_version)
    throw approvalRefusals.stale(a.subject_version, current ?? a.subject_version);
  if (body.subjectVersion !== a.subject_version) throw approvalRefusals.stale(body.subjectVersion, a.subject_version);
  // 8. rationale and deferral date
  if (!hasText(body.rationale)) throw approvalRefusals.rationaleRequired();
  const today = await todayOf(tx, a.organization_id, a.calendar_id);
  if (body.outcome === "defer") {
    if (body.deferUntil === undefined || !(body.deferUntil > today)) throw approvalRefusals.deferDateRequired();
  } else if (body.deferUntil !== undefined) {
    throw problems.validation([
      { pointer: "/deferUntil", code: "validation.defer_only", message: "Only a deferral takes a new date." },
    ]);
  }
  const audit: AuditContext = { ...auditContextOf(request), onBehalfOfUserId: acting.onBehalfOf };
  const decisionId = uuidv7();
  await tx
    .insertInto("approval_decision")
    .values({
      id: decisionId,
      organization_id: a.organization_id,
      transformation_id: a.transformation_id,
      approval_id: a.id,
      round_no: a.round_no,
      outcome: body.outcome,
      rationale: body.rationale,
      comments: body.comments ?? null,
      subject_version: a.subject_version,
      decided_by: me,
      on_behalf_of_user_id: acting.onBehalfOf,
      business_date: today,
      defer_until: body.outcome === "defer" ? body.deferUntil! : null,
    })
    .execute();
  await record(tx, audit, {
    action: "approval_decision.create",
    recordType: "approval_decision",
    recordId: decisionId,
    organizationId: a.organization_id,
    transformationId: a.transformation_id,
    newVersion: 1,
    changes: {
      approval_id: { from: null, to: a.id },
      round_no: { from: null, to: a.round_no },
      outcome: { from: null, to: body.outcome },
      subject_version: { from: null, to: a.subject_version },
      on_behalf_of_user_id: { from: null, to: acting.onBehalfOf },
      defer_until: { from: null, to: body.deferUntil ?? null },
    },
  });
  const status = OUTCOME_STATUS.get(body.outcome)!;
  const final = status === "approved" || status === "rejected";
  let deferCalendar: { id: string; version: number } | null = null;
  if (status === "deferred" && a.sla_type === "working_days" && a.calendar_id === null) {
    // approval_working_day_calendar: a working-day approval with a date names its calendar.
    const c = await tx
      .selectFrom("business_calendar")
      .select(["id", "version"])
      .where("organization_id", "=", a.organization_id)
      .where("is_default", "=", true)
      .where("status", "=", "active")
      .executeTakeFirst();
    if (!c) throw approvalRefusals.calendarNotConfigured();
    deferCalendar = c;
  }
  const updated = await tx
    .updateTable("approval")
    .set({
      status,
      ...(final ? { decided_by: me, decided_on_behalf_of: acting.onBehalfOf, decided_at: sql<Date>`now()` } : {}),
      ...(status === "deferred" ? { due_date: body.deferUntil!, due_unknown_reason: null } : {}),
      ...(deferCalendar ? { calendar_id: deferCalendar.id, calendar_version: deferCalendar.version } : {}),
      version: sql<number>`version + 1`,
      updated_at: sql<Date>`now()`,
      updated_by: me,
    })
    .where("id", "=", a.id)
    .where("version", "=", a.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, audit, {
    action: "approval.decide",
    recordType: "approval",
    recordId: a.id,
    organizationId: a.organization_id,
    transformationId: a.transformation_id,
    priorVersion: a.version,
    newVersion: updated.version,
    changes: {
      status: { from: a.status, to: status },
      ...(final
        ? { decided_by: { from: null, to: me }, decided_on_behalf_of: { from: null, to: acting.onBehalfOf } }
        : {}),
      ...(status === "deferred" ? { due_date: { from: a.due_date, to: updated.due_date } } : {}),
    },
  });
  // Downstream (ADR-0026 §4 "Outcome behaviour"): each outcome is distinct (REQ-S10-018).
  const subject = { organizationId: a.organization_id, subjectType: "approval", subjectId: a.id };
  if (status === "deferred") {
    // The assignee's task stays open with the new due date: the dated task is replaced by one for the new date.
    await closeWorkItemsOfSubject(tx, userActor(audit), { ...subject, kinds: ["approval_decision"] }, "cancelled");
    await createApproverTasks(tx, audit, updated, await assigneeApprovers(tx, updated, target));
  } else {
    await closeWorkItemsOfSubject(tx, userActor(audit), { ...subject, kinds: [...APPROVER_TASK_KINDS] }, "done");
  }
  if (status === "changes_requested") {
    // Returned to the requester, NOT closed: they resubmit a newer version (round + 1) or withdraw.
    await createWorkItemOnce(tx, userActor(audit), {
      organizationId: a.organization_id,
      transformationId: a.transformation_id,
      kind: "approval_changes_requested",
      assigneeUserId: a.requested_by,
      subjectType: "approval",
      subjectId: a.id,
      linkPath: linkOf(a.id),
      messageKey: "approvals.task.changes_requested",
      messageParams: { title: a.title, roundNo: a.round_no },
      dedupeKey: `approval.changes:${a.id}:${a.round_no}:${a.requested_by}`,
    });
  }
  if (final) {
    // ADR-0026 §4 "Outcome behaviour": on approve or reject "the requester gets an inbox reminder". Once per (approval,
    // round, requester); a request-changes outcome has its own work item above, and a deferral keeps the approval open
    // with the assignee (no requester reminder in the ADR's table).
    await createWorkItemOnce(tx, userActor(audit), {
      organizationId: a.organization_id,
      transformationId: a.transformation_id,
      kind: "approval_outcome",
      assigneeUserId: a.requested_by,
      subjectType: "approval",
      subjectId: a.id,
      linkPath: linkOf(a.id),
      messageKey: "approvals.task.outcome",
      messageParams: { title: a.title, roundNo: a.round_no, outcome: status },
      dueDate: null,
      dedupeKey: `approval.outcome:${a.id}:${a.round_no}:${a.requested_by}`,
    });
  }
  await emitOutcome(tx, { approval: updated, outcome: status, actorUserId: me, audit });
  return updated;
}

// ------------------------------------------------------------------------------------------------ resubmit / withdraw

/** Requester-only actions: read gate (404), commit-time reload, then 403 approval.not_requester for anyone else. */
async function openAsRequester(tx: Tx, request: FastifyRequest, approvalId: string) {
  const seen = await findApproval(tx, approvalId);
  if (!seen) throw problems.notFound();
  await requireTransformationRead(tx, principalOf(request), seen.transformation_id);
  const fresh = await refreshPrincipal(tx, request);
  const a = (await findApproval(tx, approvalId, true))!;
  const target = await targetOfApproval(tx, a);
  try {
    await requireTransformationRead(tx, fresh, a.transformation_id);
  } catch (err) {
    throw commitTimeDenial(err);
  }
  if (fresh.userId !== a.requested_by)
    throw approvalRefusals.notRequester().withDenial(denialOf("approval.request", target));
  return { a, target, me: fresh.userId, fresh };
}

async function resubmitApproval(tx: Tx, request: FastifyRequest, approvalId: string): Promise<ApprovalRow> {
  const body = parseBody(approvalResubmit, request.body);
  const { a, target, me, fresh } = await openAsRequester(tx, request, approvalId);
  try {
    await requireAction(tx, fresh, "approval.request", target);
  } catch (err) {
    throw commitTimeDenial(err);
  }
  const expected = requireIfMatch(request);
  if (a.version !== expected) throw problems.versionConflict(a.version);
  if (a.status !== "changes_requested") throw approvalRefusals.notResubmittable(a.status);
  if (!(body.subjectVersion > a.subject_version)) throw approvalRefusals.resubmitNeedsNewVersion();
  await lockSubject(tx, a.subject_id);
  const current = await subjectVersionOf(tx, a.approval_type, a.subject_id, a.transformation_id);
  if (current === null) throw approvalRefusals.subjectUnknown();
  if (current !== body.subjectVersion) throw approvalRefusals.stale(body.subjectVersion, current);
  const audit = auditContextOf(request);
  const updated = await tx
    .updateTable("approval")
    .set({
      status: "pending",
      round_no: a.round_no + 1,
      subject_version: body.subjectVersion,
      ...(body.requestNote !== undefined ? { request_note: body.requestNote } : {}),
      version: sql<number>`version + 1`,
      updated_at: sql<Date>`now()`,
      updated_by: me,
    })
    .where("id", "=", a.id)
    .where("version", "=", a.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, audit, {
    action: "approval.resubmit",
    recordType: "approval",
    recordId: a.id,
    organizationId: a.organization_id,
    transformationId: a.transformation_id,
    priorVersion: a.version,
    newVersion: updated.version,
    changes: {
      status: { from: a.status, to: "pending" },
      round_no: { from: a.round_no, to: updated.round_no },
      subject_version: { from: a.subject_version, to: updated.subject_version },
    },
  });
  await closeWorkItemsOfSubject(
    tx,
    userActor(audit),
    {
      organizationId: a.organization_id,
      subjectType: "approval",
      subjectId: a.id,
      kinds: ["approval_changes_requested"],
    },
    "done",
  );
  await createApproverTasks(tx, audit, updated, await assigneeApprovers(tx, updated, target));
  await emitOutcome(tx, { approval: updated, outcome: "resubmitted", actorUserId: me, audit });
  return updated;
}

async function withdrawApproval(tx: Tx, request: FastifyRequest, approvalId: string): Promise<ApprovalRow> {
  const body = parseBody(reasonRequest, request.body);
  const { a, me } = await openAsRequester(tx, request, approvalId);
  const expected = requireIfMatch(request);
  if (a.version !== expected) throw problems.versionConflict(a.version);
  if (!(OPEN_STATUSES as readonly string[]).includes(a.status)) throw approvalRefusals.notOpen(a.status);
  const audit = auditContextOf(request);
  const updated = await tx
    .updateTable("approval")
    .set({ status: "withdrawn", version: sql<number>`version + 1`, updated_at: sql<Date>`now()`, updated_by: me })
    .where("id", "=", a.id)
    .where("version", "=", a.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, audit, {
    action: "approval.withdraw",
    recordType: "approval",
    recordId: a.id,
    organizationId: a.organization_id,
    transformationId: a.transformation_id,
    priorVersion: a.version,
    newVersion: updated.version,
    reason: body.reason,
    changes: { status: { from: a.status, to: "withdrawn" } },
  });
  await closeWorkItemsOfSubject(
    tx,
    userActor(audit),
    { organizationId: a.organization_id, subjectType: "approval", subjectId: a.id },
    "cancelled",
  );
  await emitOutcome(tx, { approval: updated, outcome: "withdrawn", actorUserId: me, audit });
  return updated;
}

// ------------------------------------------------------------------------------------------------ routes

const approvalParams = z.strictObject({ approvalId: uuid });
const transformationParams = z.strictObject({ transformationId: uuid });
const myQuery = z.strictObject({
  cursor: cursorSchema,
  limit: limitSchema,
  role: z.enum(["assignee", "requester"]).default("assignee"),
  status: z.enum(["pending", "changes_requested", "deferred", "approved", "rejected", "withdrawn"]).optional(),
  transformationId: uuid.optional(),
});
const pageQuery = z.strictObject({ cursor: cursorSchema, limit: limitSchema });
/** Cursor key of the decision view: decided_at in whole microseconds. */
const DECIDED_US = sql<string>`(EXTRACT(EPOCH FROM decided_at) * 1000000)::bigint`;

export function registerApprovalRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  const MINE = "/api/v1/approvals";
  const REQUEST = "/api/v1/transformations/:transformationId/approvals";
  const ONE = "/api/v1/approvals/:approvalId";
  const DECIDE = `${ONE}/decisions`;
  const RESUBMIT = `${ONE}/resubmit`;
  const WITHDRAW = `${ONE}/withdraw`;
  const RECORDS = "/api/v1/transformations/:transformationId/approval-decisions";
  const read = { access: { permission: "transformation.read" as const } };

  // Declared transformation.read (the workflows GET convention): the list is SQL-filtered by scopeFilter on it.
  app.get(MINE, { config: read }, async (request) => {
    const principal = principalOf(request);
    const me = principal.userId;
    if (me === null) throw problems.unauthenticated();
    const query = parseQuery(myQuery, request.query);
    const groups = query.role === "assignee" ? await effectiveGroupIds(db, me) : [];
    const delegators = query.role === "assignee" ? await delegatorsOf(db, me) : [];
    const hash = filterHash({ me, role: query.role, status: query.status, transformationId: query.transformationId });
    const after = decodeCursor(query.cursor, hash, 1);
    let q = db
      .selectFrom("approval as a")
      .selectAll("a")
      .where((eb) =>
        eb.exists(
          eb
            .selectFrom("transformation as t")
            .select("t.id")
            .whereRef("t.id", "=", "a.transformation_id")
            .where(
              scopeFilter(principal, "transformation.read", {
                level: "transformation",
                organizationId: sql.ref("t.organization_id"),
                businessUnitId: sql.ref("t.business_unit_id"),
                transformationId: sql.ref("t.id"),
              }),
            ),
        ),
      );
    if (query.role === "requester") q = q.where("a.requested_by", "=", me);
    else {
      const people = [me, ...delegators];
      q = q.where((eb) =>
        eb.or([
          eb("a.assignee_user_id", "in", people),
          eb("a.escalated_to_user_id", "in", people),
          ...(groups.length > 0
            ? [eb("a.assignee_group_id", "in", groups), eb("a.escalated_to_group_id", "in", groups)]
            : []),
        ]),
      );
    }
    if (query.status) q = q.where("a.status", "=", query.status);
    if (query.transformationId) q = q.where("a.transformation_id", "=", query.transformationId);
    if (after) q = q.where("a.id", "<", String(after[0]));
    const rows = await q
      .orderBy("a.id", "desc")
      .limit(query.limit + 1)
      .execute();
    const page = paginate(rows, query.limit, (r) => [r.id], hash);
    return { items: await toApprovals(db, page.items), nextCursor: page.nextCursor };
  });

  app.post(
    REQUEST,
    { config: { access: { permission: "approval.request" }, consumes: JSON_BODY } },
    async (request, reply) => {
      const { transformationId } = parse(transformationParams, request.params, "params");
      const body = parseBody(approvalRequestCreate, request.body);
      const row = await db.transaction().execute(async (tx) => {
        await requireTransformationRead(tx, principalOf(request), transformationId);
        const fresh = await refreshPrincipal(tx, request);
        let target: ResolvedTarget;
        try {
          target = await requireTransformationRead(tx, fresh, transformationId);
          await requireAction(tx, fresh, "approval.request", target);
        } catch (err) {
          throw commitTimeDenial(err);
        }
        const scope = { ...target, transformationId };
        const requestBusinessDate = await todayOf(tx, target.organizationId, null);
        const routing = await decisionRightRouter(tx, {
          organizationId: target.organizationId,
          transformationId,
          decisionRightId: body.decisionRightId,
          requestBusinessDate,
          urgent: body.urgent,
          urgentReason: body.urgentReason ?? null,
          releaseMilestoneId: body.releaseMilestoneId ?? null,
        });
        return requestApprovalInTx(tx, auditContextOf(request), {
          organizationId: target.organizationId,
          transformationId,
          scope,
          approvalType: body.approvalType,
          subjectId: body.subjectId,
          subjectVersion: body.subjectVersion,
          title: body.title,
          requestNote: body.requestNote ?? null,
          assigneePartyCode: routing.approvePartyCode,
          decisionRightId: routing.decisionRightId,
          slaType: routing.slaType,
          urgentReason: routing.urgentReason,
          due: routing.due,
          requestBusinessDate,
        });
      });
      return sendVersioned(reply, 201, await toApproval(db, row), `/api/v1/approvals/${row.id}`);
    },
  );

  app.get(ONE, { config: read }, async (request, reply) => {
    const { approvalId } = parse(approvalParams, request.params, "params");
    parseQuery(z.strictObject({}), request.query);
    const row = await findApproval(db, approvalId);
    if (!row) throw problems.notFound();
    await requireTransformationRead(db, principalOf(request), row.transformation_id);
    return sendVersioned(reply, 200, await toApproval(db, row));
  });

  app.post(
    DECIDE,
    { config: { access: { permission: "approval.decide" }, consumes: JSON_BODY } },
    async (request, reply) => {
      const { approvalId } = parse(approvalParams, request.params, "params");
      const row = await db.transaction().execute((tx) => decideApproval(tx, request, approvalId));
      return sendVersioned(reply, 200, await toApproval(db, row));
    },
  );

  app.post(
    RESUBMIT,
    { config: { access: { permission: "approval.request" }, consumes: JSON_BODY } },
    async (request, reply) => {
      const { approvalId } = parse(approvalParams, request.params, "params");
      const row = await db.transaction().execute((tx) => resubmitApproval(tx, request, approvalId));
      return sendVersioned(reply, 200, await toApproval(db, row));
    },
  );

  app.post(
    WITHDRAW,
    { config: { access: { permission: "approval.request" }, consumes: JSON_BODY } },
    async (request, reply) => {
      const { approvalId } = parse(approvalParams, request.params, "params");
      const row = await db.transaction().execute((tx) => withdrawApproval(tx, request, approvalId));
      return sendVersioned(reply, 200, await toApproval(db, row));
    },
  );

  app.get(RECORDS, { config: read }, async (request) => {
    const { transformationId } = parse(transformationParams, request.params, "params");
    const query = parseQuery(pageQuery, request.query);
    await requireTransformationRead(db, principalOf(request), transformationId);
    const hash = filterHash({ transformationId });
    const after = decodeCursor(query.cursor, hash, 2);
    let q = db
      .selectFrom("approval_decision_record")
      .selectAll()
      .select(DECIDED_US.as("decided_us"))
      .where("transformation_id", "=", transformationId);
    if (after)
      q = q.where(sql<boolean>`(${DECIDED_US}, record_id) < (${String(after[0])}::bigint, ${String(after[1])}::uuid)`);
    const rows = await q
      .orderBy("decided_at", "desc")
      .orderBy("record_id", "desc")
      .limit(query.limit + 1)
      .execute();
    const page = paginate(rows, query.limit, (r) => [String(r.decided_us), r.record_id], hash);
    const items: ApprovalDecisionRecord[] = page.items.map((r) => ({
      source: r.source as ApprovalDecisionRecord["source"],
      recordId: r.record_id,
      approvalKind: r.approval_kind,
      subjectType: r.subject_type,
      subjectId: r.subject_id,
      subjectVersion: r.subject_version,
      outcome: r.outcome as ApprovalDecisionRecord["outcome"],
      rationale: r.rationale,
      decidedBy: r.decided_by,
      onBehalfOfUserId: r.on_behalf_of_user_id,
      decidedAt: iso(r.decided_at),
    }));
    return { items, nextCursor: page.nextCursor };
  });

  return [
    `GET ${MINE}`,
    `POST ${REQUEST}`,
    `GET ${ONE}`,
    `POST ${DECIDE}`,
    `POST ${RESUBMIT}`,
    `POST ${WITHDRAW}`,
    `GET ${RECORDS}`,
  ];
}
