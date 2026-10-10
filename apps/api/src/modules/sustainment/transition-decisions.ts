// Benefit transition decisions (P4 slice G; ADR-0034 §3, §6, §9, §12; T-DG4-BE-J; REQ-S11-007 "after the transition
// decision, the benefit's forecast is still reported as forecast, and monitoring tasks appear for the residual owner";
// M0218 "allow a documented transition decision with residual benefit ownership and scheduled monitoring; do not label
// forecast future value as already sustained"):
//   GET   /transformations/{t}/transition-decisions                  list (transformation.read; benefitId, status)
//   POST  /transformations/{t}/transition-decisions                  draft (transition_decision.propose; BO, FIN)
//   GET   /transformations/{t}/transition-decisions/{d}              one decision (transformation.read)
//   PATCH /transformations/{t}/transition-decisions/{d}              edit a draft, or withdraw a draft or submitted
//                                                                    decision (If-Match)
//   POST  /transformations/{t}/transition-decisions/{d}/submit       draft -> submitted and the canonical approval of
//                                                                    type benefit_transition_decision (If-Match)
//
// The decision is a BUSINESS approval inside the product, decided by a person through workflows' approval service
// (ADR-0026 §4; assignee party SP; SoD requester_excluded, so the requester cannot approve it). This module never writes
// `approval`, `approval_decision` or `approval_escalation` (S-14): it reaches the service through the port that the
// composition root wires with `wireTransitionDecisionApprovals` (sustainment may not import workflows, ADR-0002,
// p4-plan §2; the KpiApprovalPort precedent). Unwired, submit fails closed (500) and nothing is written.
//
// The approval binds the decision's row version: the 0031 guards compare `approval.subject_version` with the row at the
// approval's insert and at every decision, and the 0010 guard steps the version by exactly 1 on every update, while
// the 0048 CHECK needs `approval_id` on a `submitted` row. A stored draft -> submitted move at submit would therefore
// make its own approval stale. So submit requests the approval on the draft's CURRENT version and writes nothing else
// to the row: the stored status stays `draft`, and the API presents it as `submitted` with its `approvalId` while the
// approval is pending or deferred (the effective status; list filters use it too), and the service refuses content
// edits meanwhile (422 transition_decision.frozen; any edit would also make the approval stale, 409 at the decision).
// The provider applies the outcome in the deciding transaction, after the guard has passed: approved -> the row moves
// draft -> submitted -> approved (decided stamps, next_monitoring_date = first_monitoring_date, and the monitoring
// reviews already inside the 7-day horizon); rejected -> draft -> submitted -> rejected; changes requested and a
// withdrawn approval leave it a draft. A timer never decides: the escalation job only escalates. The stored-status
// detail is accepted as built (ADR-0034 amendment A2).
//
// Resubmit and withdraw (ADR-0026 amendment A4; T-DG4-BE-R2): after changes are requested the draft is editable again
// (each edit steps its version), and submitting it again resubmits the SAME approval on the decision's current version
// through workflows' `resubmitApprovalInTx`, in the submit's transaction. `POST /approvals/{id}/resubmit` refuses this
// type (422 approval.resubmit_through_record; the provider sets `resubmitThroughSubject`). Withdrawing a decision
// whose approval is open (pending, deferred or changes requested) first withdraws that approval through
// `withdrawApprovalInTx` (its requester only: 403 approval.not_requester otherwise), then moves the row draft ->
// withdrawn, in one transaction, so no approval is left that can never be decided. Both services reach this module
// through `bindServices` at subject registration, so the composition root's one wiring line is unchanged.
//
// Forecast stays forecast: nothing here writes a benefit value, a measurement, a lifecycle step or a `sustained` series
// row; the benefit's value status becomes `transition` (status-model.ts), never validated or sustained. Monitoring:
// `sustainment_review` rows of subject transition_decision, assigned to the residual owner only, each with a
// `benefit_monitoring_due` work item, created by scheduleMonitoringReviews (here) and by its worker twin in the daily
// sustainment.review_scan (apps/worker/src/handlers/sustainment.ts; ADR-0002 rule 5, D-102 (2): the parity test is in
// test/integration/sustainment/transition-decisions.test.ts). Nothing touches DG0-DG7.
import { insertAuditEvent, sql, type ApprovalRow, type AuditActor, type DbOrTx, type Tx } from "@mth/db";
import {
  transitionDecisionCreate,
  transitionDecisionUpdate,
  type SustainFrequency,
  type TransitionDecision,
  type TransitionDecisionStatus,
} from "@mth/shared/schemas";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { principalOf, requireTransformationRead, type ResolvedTarget } from "../access/index.ts";
import { record, type AuditContext } from "../audit/index.ts";
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
import { createWorkItemOnce } from "../tasks/index.ts";
import { assertActiveUsers } from "../transformations/index.ts";
import { diffFields, organizationBusinessDate } from "./controls.ts";
import {
  dateOrNull,
  JSON_BODY,
  openSustainmentWrite,
  parseTransformationParam,
  sustainRule,
} from "./performance-areas.ts";

export const TRANSITION_DECISIONS = "/api/v1/transformations/:transformationId/transition-decisions";
export const TRANSITION_DECISION_ITEM = `${TRANSITION_DECISIONS}/:transitionDecisionId`;
export const TRANSITION_DECISION_SUBMIT = `${TRANSITION_DECISION_ITEM}/submit`;
export const TRANSITION_DECISION_PROPOSE = "transition_decision.propose" as const;
/** The approval type (0049 seeds it: subject transition_decision, SoD requester_excluded). */
export const TRANSITION_DECISION_APPROVAL_TYPE = "benefit_transition_decision";
/** The party the decision is routed to by default (REQ-S11-007 "decide:SP or configured authority"; ADR-0034 §3). */
export const TRANSITION_DECISION_APPROVER_PARTY = "SP";
export const BENEFIT_MONITORING_TASK_KIND = "benefit_monitoring_due";
/** A monitoring review is created at the latest this many calendar days before it is due (ADR-0034 §6). */
export const MONITORING_HORIZON_DAYS = 7;
/** Bound on the catch-up steps for one decision in one call. */
const MAX_STEPS_PER_DECISION = 520;
/** While its approval is pending or deferred a draft (resubmitted after changes requested) is frozen. */
const FREEZING_APPROVAL_STATUSES = ["pending", "deferred"] as const;
/** The approval statuses a withdrawal of the decision withdraws first (ADR-0026 amendment A3, A4). */
const OPEN_APPROVAL_STATUSES = ["pending", "deferred", "changes_requested"] as const;

// ------------------------------------------------------------------------------------------------ problems (§12, S-11)

const EXISTS = () =>
  problems.duplicate(
    "transition_decision.exists",
    "This benefit already has a transition decision in progress or approved.",
  );
const FINAL = (status: string) =>
  sustainRule("transition_decision.final", `This transition decision is ${status} and can no longer be changed.`);
const FROZEN = () => sustainRule("transition_decision.frozen", "A submitted transition decision cannot be edited.");
const BENEFIT_VALIDATED = () =>
  sustainRule(
    "transition_decision.benefit_validated",
    "This benefit already has Finance-validated value; a transition decision is for value still to be realized.",
    "/benefitId",
  );
const MONITORING_AFTER_END = () =>
  sustainRule(
    "transition_decision.monitoring_after_end",
    "The first monitoring date must be on or before the expected realization end.",
    "/firstMonitoringDate",
  );
const BENEFIT_REFERENCE = () =>
  sustainRule("validation.reference", "The referenced record does not exist in this transformation.", "/benefitId");

// ------------------------------------------------------------------------------------------------ the approval port

/** The subset of ADR-0026 §4's request input this module passes (structurally that of workflows' service). */
export interface TransitionDecisionApprovalRequest {
  readonly organizationId: string;
  readonly transformationId: string;
  readonly scope: ResolvedTarget & { transformationId: string };
  readonly approvalType: string;
  readonly subjectId: string;
  readonly subjectVersion: number;
  readonly title: string;
  readonly requestNote: string | null;
  readonly assigneePartyCode: string;
  readonly decisionRightId: null;
  readonly slaType: null;
  readonly urgentReason: null;
  readonly due: null;
}

/** The outcome event the approval service passes to a subject provider (structurally workflows' one). */
export interface TransitionDecisionApprovalEvent {
  readonly approval: ApprovalRow;
  readonly outcome: string;
  readonly actorUserId: string;
  readonly audit: AuditContext;
}

/** workflows' in-transaction resubmit and withdraw (ADR-0026 amendment A2, A3), structurally. */
export interface TransitionDecisionApprovalServices {
  readonly resubmit: (
    tx: Tx,
    audit: AuditContext,
    input: { readonly approvalId: string; readonly subjectVersion: number },
  ) => Promise<ApprovalRow>;
  readonly withdraw: (
    tx: Tx,
    audit: AuditContext,
    input: { readonly approvalId: string; readonly reason: string },
  ) => Promise<ApprovalRow>;
}

/** The subject provider shape of ADR-0026 §4 and amendment A4 (structurally workflows' ApprovalSubjectProvider). */
export interface TransitionDecisionSubjectProvider {
  readonly onOutcome: (tx: Tx, event: TransitionDecisionApprovalEvent) => Promise<void>;
  readonly resubmitThroughSubject: true;
  readonly bindServices: (services: TransitionDecisionApprovalServices) => void;
}

/** The approval service as this module sees it: workflows' `requestApprovalInTx` and `registerApprovalSubject`. */
export interface TransitionDecisionApprovalPort {
  readonly requestApproval: (
    tx: Tx,
    audit: AuditContext,
    input: TransitionDecisionApprovalRequest,
  ) => Promise<ApprovalRow>;
  readonly registerSubject: (approvalType: string, provider: TransitionDecisionSubjectProvider) => void;
}

let approvalPort: TransitionDecisionApprovalPort | null = null;
let approvalServices: TransitionDecisionApprovalServices | null = null;

/**
 * Wires workflows' approval service (called by the composition root, server.ts, beside registerSustainmentModule):
 * stores the port and registers the benefit_transition_decision subject provider, which receives the in-transaction
 * resubmit and withdraw through `bindServices`. Idempotent.
 */
export function wireTransitionDecisionApprovals(port: TransitionDecisionApprovalPort): void {
  approvalPort = port;
  port.registerSubject(TRANSITION_DECISION_APPROVAL_TYPE, {
    onOutcome: applyTransitionDecisionOutcome,
    resubmitThroughSubject: true,
    bindServices: (services) => {
      approvalServices = services;
    },
  });
}

/** Submit without a wired approval service fails closed (the KPI-version precedent): 500, nothing written. */
const unwiredApprovals = () => problems.internal();

// ------------------------------------------------------------------------------------------------ rows and presenter

interface DecisionRow {
  id: string;
  organization_id: string;
  transformation_id: string;
  code: string;
  benefit_id: string;
  residual_owner_user_id: string;
  rationale: string;
  expected_realization_end: string;
  monitoring_frequency: string;
  monitoring_interval: number;
  first_monitoring_date: string;
  next_monitoring_date: string | null;
  status: string;
  approval_id: string | null;
  decided_at: Date | string | null;
  decided_by: string | null;
  version: number;
  created_at: Date | string;
  created_by: string;
  updated_at: Date | string;
  updated_by: string | null;
}

const AUDIT_FIELDS = [
  "code",
  "benefit_id",
  "residual_owner_user_id",
  "rationale",
  "expected_realization_end",
  "monitoring_frequency",
  "monitoring_interval",
  "first_monitoring_date",
  "next_monitoring_date",
  "status",
  "approval_id",
  "decided_by",
] as const;
const DATE_FIELDS = ["expected_realization_end", "first_monitoring_date", "next_monitoring_date"] as const;

/** The presented status and approval: a stored draft with a pending or deferred approval is `submitted` (header). */
export interface EffectiveDecisionState {
  readonly status: TransitionDecisionStatus;
  readonly approvalId: string | null;
}

export const toTransitionDecision = (r: DecisionRow, eff: EffectiveDecisionState): TransitionDecision => ({
  id: r.id,
  transformationId: r.transformation_id,
  code: r.code,
  benefitId: r.benefit_id,
  residualOwnerUserId: r.residual_owner_user_id,
  rationale: r.rationale,
  expectedRealizationEnd: dateOrNull(r.expected_realization_end)!,
  monitoringFrequency: r.monitoring_frequency as SustainFrequency,
  monitoringInterval: r.monitoring_interval,
  firstMonitoringDate: dateOrNull(r.first_monitoring_date)!,
  nextMonitoringDate: dateOrNull(r.next_monitoring_date),
  status: eff.status,
  approvalId: eff.approvalId,
  decidedAt: isoOrNull(r.decided_at as Date | null),
  decidedBy: r.decided_by,
  version: r.version,
  createdAt: iso(r.created_at as Date),
  createdBy: r.created_by,
  updatedAt: iso(r.updated_at as Date),
  updatedBy: r.updated_by,
});

async function findDecision(db: DbOrTx, transformationId: string, id: string, lock = false): Promise<DecisionRow> {
  let q = db
    .selectFrom("transition_decision")
    .selectAll()
    .where("id", "=", id)
    .where("transformation_id", "=", transformationId);
  if (lock) q = q.forUpdate();
  const row = await q.executeTakeFirst();
  if (!row) throw problems.notFound();
  return row as DecisionRow;
}

/** TD-01 from record_code_counter; a concurrent allocation serialises on the counter row. */
async function nextDecisionCode(tx: Tx, transformationId: string): Promise<string> {
  const row = await sql<{ last_value: number }>`
    INSERT INTO record_code_counter (transformation_id, prefix, last_value) VALUES (${transformationId}::uuid, 'TD', 1)
    ON CONFLICT (transformation_id, prefix) DO UPDATE SET last_value = record_code_counter.last_value + 1
    RETURNING last_value`.execute(tx);
  return `TD-${String(row.rows[0]!.last_value).padStart(2, "0")}`;
}

/** True when the benefit has Finance-validated value (at least one validated measurement; ADR-0034 §2). */
async function benefitHasValidatedValue(db: DbOrTx, benefitId: string): Promise<boolean> {
  const r = await db
    .selectFrom("benefit_measurement")
    .select("id")
    .where("benefit_id", "=", benefitId)
    .where("status", "=", "validated")
    .limit(1)
    .executeTakeFirst();
  return r !== undefined;
}

/** The decision's approval while it is pending or deferred (a resubmitted draft is frozen), else undefined. */
async function freezingApproval(db: DbOrTx, decisionId: string) {
  return db
    .selectFrom("approval")
    .select(["id", "status"])
    .where("approval_type", "=", TRANSITION_DECISION_APPROVAL_TYPE)
    .where("subject_id", "=", decisionId)
    .where("status", "in", [...FREEZING_APPROVAL_STATUSES])
    .executeTakeFirst();
}

/** The decision's approval in `statuses` (at most one is open per subject: approval_one_open_per_subject). */
async function approvalIn(db: DbOrTx, decisionId: string, statuses: readonly string[]) {
  return db
    .selectFrom("approval")
    .select(["id", "status"])
    .where("approval_type", "=", TRANSITION_DECISION_APPROVAL_TYPE)
    .where("subject_id", "=", decisionId)
    .where("status", "in", [...statuses])
    .executeTakeFirst();
}

/** The latest approval of each decision (any status), newest first per subject. */
async function latestApprovals(
  db: DbOrTx,
  ids: readonly string[],
): Promise<Map<string, { id: string; status: string }>> {
  const out = new Map<string, { id: string; status: string }>();
  if (ids.length === 0) return out;
  const rows = await db
    .selectFrom("approval")
    .select(["id", "status", "subject_id"])
    .where("approval_type", "=", TRANSITION_DECISION_APPROVAL_TYPE)
    .where("subject_id", "in", [...ids])
    .orderBy("created_at", "desc")
    .orderBy("id", "desc")
    .execute();
  for (const r of rows) if (!out.has(r.subject_id)) out.set(r.subject_id, { id: r.id, status: r.status });
  return out;
}

/** Presents decisions with their effective status and approval id (see the file header). */
export async function presentDecisions(db: DbOrTx, rows: readonly DecisionRow[]): Promise<TransitionDecision[]> {
  const latest = await latestApprovals(
    db,
    rows.map((r) => r.id),
  );
  return rows.map((r) => {
    const a = latest.get(r.id);
    const inApproval =
      r.status === "draft" && a !== undefined && (FREEZING_APPROVAL_STATUSES as readonly string[]).includes(a.status);
    return toTransitionDecision(r, {
      status: inApproval ? "submitted" : (r.status as TransitionDecisionStatus),
      approvalId: r.approval_id ?? a?.id ?? null,
    });
  });
}

async function presentDecision(db: DbOrTx, transformationId: string, id: string): Promise<TransitionDecision> {
  const [d] = await presentDecisions(db, [await findDecision(db, transformationId, id)]);
  return d!;
}

// ------------------------------------------------------------------------------------------------ writes

async function createDecision(tx: Tx, request: FastifyRequest, transformationId: string): Promise<string> {
  const ctx = await openSustainmentWrite(tx, request, transformationId, TRANSITION_DECISION_PROPOSE);
  const body = parseBody(transitionDecisionCreate, request.body);
  const benefit = await tx
    .selectFrom("benefit")
    .select(["id", "status"])
    .where("id", "=", body.benefitId)
    .where("transformation_id", "=", transformationId)
    .executeTakeFirst();
  if (!benefit || benefit.status !== "active") throw BENEFIT_REFERENCE();
  await assertActiveUsers(tx, ctx.organizationId, [{ id: body.residualOwnerUserId, pointer: "/residualOwnerUserId" }]);
  if (body.firstMonitoringDate > body.expectedRealizationEnd) throw MONITORING_AFTER_END();
  if (await benefitHasValidatedValue(tx, benefit.id)) throw BENEFIT_VALIDATED();
  const live = await tx
    .selectFrom("transition_decision")
    .select("id")
    .where("benefit_id", "=", benefit.id)
    .where("status", "in", ["draft", "submitted", "approved"])
    .executeTakeFirst();
  if (live) throw EXISTS();
  const id = uuidv7();
  const row = (await tx
    .insertInto("transition_decision")
    .values({
      id,
      organization_id: ctx.organizationId,
      transformation_id: transformationId,
      code: await nextDecisionCode(tx, transformationId),
      benefit_id: benefit.id,
      residual_owner_user_id: body.residualOwnerUserId,
      rationale: body.rationale,
      expected_realization_end: body.expectedRealizationEnd,
      monitoring_frequency: body.monitoringFrequency,
      monitoring_interval: body.monitoringInterval ?? 1,
      first_monitoring_date: body.firstMonitoringDate,
      created_by: ctx.userId,
      updated_by: ctx.userId,
    })
    .returningAll()
    .executeTakeFirstOrThrow()) as DecisionRow;
  await record(tx, ctx.audit, {
    action: "transition_decision.create",
    recordType: "transition_decision",
    recordId: id,
    organizationId: ctx.organizationId,
    transformationId,
    newVersion: row.version,
    changes: diffFields({}, row, AUDIT_FIELDS, DATE_FIELDS),
  });
  return id;
}

async function updateDecision(tx: Tx, request: FastifyRequest, transformationId: string, id: string): Promise<void> {
  const ctx = await openSustainmentWrite(tx, request, transformationId, TRANSITION_DECISION_PROPOSE);
  const body = parseBody(transitionDecisionUpdate, request.body);
  const expected = requireIfMatch(request);
  const current = await findDecision(tx, transformationId, id, true);
  if (current.version !== expected) throw problems.versionConflict(current.version);
  if (["approved", "rejected", "withdrawn"].includes(current.status)) throw FINAL(current.status);
  const withdrawing = body.status === "withdrawn";
  const contentChange =
    body.residualOwnerUserId !== undefined ||
    body.rationale !== undefined ||
    body.expectedRealizationEnd !== undefined ||
    body.monitoringFrequency !== undefined ||
    body.monitoringInterval !== undefined ||
    body.firstMonitoringDate !== undefined;
  if (contentChange && (current.status === "submitted" || (await freezingApproval(tx, current.id)) !== undefined))
    throw FROZEN();
  await assertActiveUsers(tx, ctx.organizationId, [{ id: body.residualOwnerUserId, pointer: "/residualOwnerUserId" }]);
  const end = body.expectedRealizationEnd ?? dateOrNull(current.expected_realization_end)!;
  const first = body.firstMonitoringDate ?? dateOrNull(current.first_monitoring_date)!;
  if (first > end) throw MONITORING_AFTER_END();
  if (withdrawing) {
    // ADR-0026 amendment A4: an open approval is withdrawn first (final), then the row; one transaction.
    const open = await approvalIn(tx, current.id, OPEN_APPROVAL_STATUSES);
    if (open !== undefined) {
      if (approvalServices === null) throw unwiredApprovals();
      await approvalServices.withdraw(tx, ctx.audit, {
        approvalId: open.id,
        reason: `Transition decision ${current.code} withdrawn.`,
      });
    }
  }
  const updated = (await tx
    .updateTable("transition_decision")
    .set({
      ...(body.residualOwnerUserId !== undefined ? { residual_owner_user_id: body.residualOwnerUserId } : {}),
      ...(body.rationale !== undefined ? { rationale: body.rationale } : {}),
      ...(body.expectedRealizationEnd !== undefined ? { expected_realization_end: body.expectedRealizationEnd } : {}),
      ...(body.monitoringFrequency !== undefined ? { monitoring_frequency: body.monitoringFrequency } : {}),
      ...(body.monitoringInterval !== undefined ? { monitoring_interval: body.monitoringInterval } : {}),
      ...(body.firstMonitoringDate !== undefined ? { first_monitoring_date: body.firstMonitoringDate } : {}),
      ...(withdrawing ? { status: "withdrawn" } : {}),
      version: sql<number>`version + 1`,
      updated_at: sql<Date>`now()`,
      updated_by: ctx.userId,
    })
    .where("id", "=", current.id)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow()) as DecisionRow;
  await record(tx, ctx.audit, {
    action: withdrawing ? "transition_decision.withdraw" : "transition_decision.update",
    recordType: "transition_decision",
    recordId: current.id,
    organizationId: ctx.organizationId,
    transformationId,
    priorVersion: current.version,
    newVersion: updated.version,
    changes: diffFields(current, updated, AUDIT_FIELDS, DATE_FIELDS),
  });
}

/**
 * submitTransitionDecision: requests the canonical approval of type benefit_transition_decision on the draft's current
 * version, routed to the party SP (an unmapped Sponsor is 422 routing.role_unmapped and nothing is written). The row
 * itself is not updated (see the file header); the decision is presented as `submitted` from now on. A decision that
 * is not a draft, or already in approval, is 422 transition_decision.final. A draft whose approval has changes
 * requested is resubmitted: the same approval, round + 1, on the draft's current version (`resubmitApprovalInTx`;
 * 422 approval.resubmit_needs_new_version when the draft was not edited since, 403 approval.not_requester for anyone
 * but the approval's requester), in this transaction.
 */
async function submitDecision(tx: Tx, request: FastifyRequest, transformationId: string, id: string): Promise<void> {
  const ctx = await openSustainmentWrite(tx, request, transformationId, TRANSITION_DECISION_PROPOSE);
  const expected = requireIfMatch(request);
  const current = await findDecision(tx, transformationId, id, true);
  if (current.version !== expected) throw problems.versionConflict(current.version);
  if (current.status !== "draft") throw FINAL(current.status);
  if ((await freezingApproval(tx, current.id)) !== undefined) throw FINAL("submitted");
  if (await benefitHasValidatedValue(tx, current.benefit_id)) throw BENEFIT_VALIDATED();
  if (approvalPort === null) throw unwiredApprovals();
  const returned = await approvalIn(tx, current.id, ["changes_requested"]);
  if (returned !== undefined) {
    if (approvalServices === null) throw unwiredApprovals();
    await approvalServices.resubmit(tx, ctx.audit, { approvalId: returned.id, subjectVersion: current.version });
    return;
  }
  const benefit = await tx
    .selectFrom("benefit")
    .select("code")
    .where("id", "=", current.benefit_id)
    .executeTakeFirstOrThrow();
  await approvalPort.requestApproval(tx, ctx.audit, {
    organizationId: ctx.organizationId,
    transformationId,
    scope: { ...ctx.target, transformationId },
    approvalType: TRANSITION_DECISION_APPROVAL_TYPE,
    subjectId: current.id,
    subjectVersion: current.version,
    title: `${current.code} · ${benefit.code}`,
    requestNote: null,
    assigneePartyCode: TRANSITION_DECISION_APPROVER_PARTY,
    decisionRightId: null,
    slaType: null,
    urgentReason: null,
    due: null,
  });
}

// ------------------------------------------------------------------------------------------------ the approval outcome

/** One status step of a decision in the deciding transaction (version + 1, audited as the deciding user). */
async function stepDecision(
  tx: Tx,
  audit: AuditContext,
  row: DecisionRow,
  set: Record<string, unknown>,
  action: string,
): Promise<DecisionRow> {
  const updated = (await tx
    .updateTable("transition_decision")
    .set({
      ...set,
      version: sql<number>`version + 1`,
      updated_at: sql<Date>`now()`,
      updated_by: audit.actorUserId,
    })
    .where("id", "=", row.id)
    .where("version", "=", row.version)
    .returningAll()
    .executeTakeFirstOrThrow()) as DecisionRow;
  await record(tx, audit, {
    action,
    recordType: "transition_decision",
    recordId: row.id,
    organizationId: row.organization_id,
    transformationId: row.transformation_id,
    priorVersion: row.version,
    newVersion: updated.version,
    changes: diffFields(row, updated, AUDIT_FIELDS, DATE_FIELDS),
  });
  return updated;
}

/**
 * The benefit_transition_decision subject provider (ADR-0034 §3), run by the approval service in the deciding
 * transaction after the decision row passed the 0031 guards (the decision was made by a person; the requester was
 * excluded). approved: draft -> submitted -> approved with the decided stamps and next_monitoring_date =
 * first_monitoring_date, then the monitoring reviews already inside the horizon; rejected: draft -> submitted ->
 * rejected. changes requested, deferred, resubmitted and withdrawn leave the stored draft as it is (its effective status
 * follows the approval). Writes no benefit value, measurement, lifecycle step or sustained row.
 */
export async function applyTransitionDecisionOutcome(tx: Tx, event: TransitionDecisionApprovalEvent): Promise<void> {
  if (event.outcome !== "approved" && event.outcome !== "rejected") return;
  const a = event.approval;
  let row = (await tx
    .selectFrom("transition_decision")
    .selectAll()
    .where("id", "=", a.subject_id)
    .where("transformation_id", "=", a.transformation_id)
    .forUpdate()
    .executeTakeFirst()) as DecisionRow | undefined;
  if (!row || (row.status !== "draft" && row.status !== "submitted")) return;
  if (row.status === "draft")
    row = await stepDecision(
      tx,
      event.audit,
      row,
      { status: "submitted", approval_id: a.id },
      "transition_decision.submit",
    );
  const approved = event.outcome === "approved";
  row = await stepDecision(
    tx,
    event.audit,
    row,
    {
      status: approved ? "approved" : "rejected",
      decided_at: sql<Date>`now()`,
      decided_by: event.actorUserId,
      ...(approved ? { next_monitoring_date: dateOrNull(row.first_monitoring_date) } : {}),
    },
    approved ? "transition_decision.approve" : "transition_decision.reject",
  );
  if (!approved) return;
  const today = await organizationBusinessDate(tx, row.organization_id, new Date());
  const actor: AuditActor = {
    actorType: "user",
    actorUserId: event.actorUserId,
    requestId: event.audit.requestId,
    source: "api",
  };
  await scheduleMonitoringReviews(tx, today, { decisionId: row.id, actor });
}

// ------------------------------------------------------------------------------------------------ monitoring reviews

const SERVICE_ACTOR: AuditActor = { actorType: "service", actorUserId: null, source: "worker" };

export interface MonitoringStep {
  readonly decisionId: string;
  readonly dueDate: string;
  readonly outcome: "created" | "existing";
  readonly reviewId: string;
}

/** Calendar months of one monitoring period (weekly is counted in weeks). */
const MONITORING_PERIOD_MONTHS: ReadonlyMap<string, number> = new Map([
  ["monthly", 1],
  ["quarterly", 3],
  ["semi_annual", 6],
  ["annual", 12],
]);

/** One monitoring period after `date` (calendar weeks or months, never working days; ADR-0034 §5, §6). */
async function plusMonitoringPeriod(tx: Tx, date: string, frequency: string, interval: number): Promise<string> {
  const months = MONITORING_PERIOD_MONTHS.get(frequency) ?? 0;
  const weeks = frequency === "weekly" ? interval : 0;
  if (months === 0 && weeks === 0) throw new Error(`scheduleMonitoringReviews: unknown frequency ${frequency}`);
  const r = await sql<{ d: string }>`
    SELECT (${date}::date + make_interval(months => ${months * interval}::int, weeks => ${weeks}::int))::date::text AS d`.execute(
    tx,
  );
  return r.rows[0]!.d;
}

/**
 * The benefit-monitoring reviews of approved transition decisions (ADR-0034 §3, §6; REQ-S11-007 "monitoring tasks
 * appear for the residual owner"). For every approved decision (or the one `decisionId`) whose next_monitoring_date is
 * on or before `today` + 7 days and on or before its expected realization end: inserts the `sustainment_review` of
 * subject transition_decision for that date if absent (sustainment_review_due_key), assigned to the residual owner,
 * audited, with its `benefit_monitoring_due` work item (dedupe `sustainment.monitoring:<decisionId>:<dueDate>`), then
 * advances next_monitoring_date by one period (version + 1, audited), repeating while the date stays inside both
 * bounds. A second call creates nothing twice. `actor` defaults to the service actor (source worker, S-13); the
 * approval outcome passes the deciding user. The worker's daily sustainment.review_scan runs the twin of this function
 * (runMonitoringScan, apps/worker/src/handlers/sustainment.ts); the parity test proves both write the same rows.
 */
export async function scheduleMonitoringReviews(
  tx: Tx,
  today: string,
  opts: { decisionId?: string; organizationId?: string; actor?: AuditActor } = {},
): Promise<MonitoringStep[]> {
  const actor = opts.actor ?? SERVICE_ACTOR;
  const byUser = actor.actorType === "user" ? actor.actorUserId : null;
  const due = await tx
    .selectFrom("transition_decision")
    .select("id")
    .where("status", "=", "approved")
    .where("next_monitoring_date", "is not", null)
    .where(sql<boolean>`next_monitoring_date <= (${today}::date + ${MONITORING_HORIZON_DAYS}::int)`)
    .where(sql<boolean>`next_monitoring_date <= expected_realization_end`)
    .$if(opts.decisionId !== undefined, (q) => q.where("id", "=", opts.decisionId!))
    .$if(opts.organizationId !== undefined, (q) => q.where("organization_id", "=", opts.organizationId!))
    .orderBy("id")
    .execute();
  const steps: MonitoringStep[] = [];
  for (const { id: decisionId } of due) {
    for (let i = 0; i < MAX_STEPS_PER_DECISION; i += 1) {
      const d = await tx
        .selectFrom("transition_decision")
        .selectAll()
        .select([
          sql<string | null>`next_monitoring_date::text`.as("next_text"),
          sql<string>`expected_realization_end::text`.as("end_text"),
          sql<string>`(${today}::date + ${MONITORING_HORIZON_DAYS}::int)::text`.as("horizon_text"),
        ])
        .where("id", "=", decisionId)
        .forUpdate()
        .executeTakeFirstOrThrow();
      const dueDate = d.next_text;
      if (d.status !== "approved" || dueDate === null || dueDate > d.end_text || dueDate > d.horizon_text) break;
      const reviewId = uuidv7();
      const inserted = await sql<{ id: string }>`
        INSERT INTO sustainment_review (id, organization_id, transformation_id, subject_kind, transition_decision_id,
                                        due_date, assignee_user_id, created_source, created_by, updated_by)
        VALUES (${reviewId}::uuid, ${d.organization_id}::uuid, ${d.transformation_id}::uuid, 'transition_decision',
                ${d.id}::uuid, ${dueDate}::date, ${d.residual_owner_user_id}::uuid,
                ${byUser === null ? "worker" : "api"}, ${byUser}::uuid, ${byUser}::uuid)
        ON CONFLICT (subject_kind, (coalesce(performance_area_id, transition_decision_id)), due_date) DO NOTHING
        RETURNING id`.execute(tx);
      if (inserted.rows.length === 0) {
        const existing = await tx
          .selectFrom("sustainment_review")
          .select("id")
          .where("subject_kind", "=", "transition_decision")
          .where("transition_decision_id", "=", d.id)
          .where("due_date", "=", dueDate)
          .executeTakeFirstOrThrow();
        steps.push({ decisionId: d.id, dueDate, outcome: "existing", reviewId: existing.id });
      } else {
        await insertAuditEvent(tx, actor, {
          action: "sustainment_review.create",
          recordType: "sustainment_review",
          recordId: reviewId,
          organizationId: d.organization_id,
          transformationId: d.transformation_id,
          newVersion: 1,
          changes: {
            subject_kind: { from: null, to: "transition_decision" },
            transition_decision_id: { from: null, to: d.id },
            due_date: { from: null, to: dueDate },
            assignee_user_id: { from: null, to: d.residual_owner_user_id },
          },
        });
        await createWorkItemOnce(tx, actor, {
          organizationId: d.organization_id,
          transformationId: d.transformation_id,
          kind: BENEFIT_MONITORING_TASK_KIND,
          assigneeUserId: d.residual_owner_user_id,
          subjectType: "sustainment_review",
          subjectId: reviewId,
          linkPath: `/transformations/${d.transformation_id}/transition-decisions/${d.id}`,
          messageKey: "sustainment.task.benefit_monitoring_due",
          messageParams: { decisionCode: d.code, dueDate },
          dueDate,
          dedupeKey: `sustainment.monitoring:${d.id}:${dueDate}`,
        });
        steps.push({ decisionId: d.id, dueDate, outcome: "created", reviewId });
      }
      const next = await plusMonitoringPeriod(tx, dueDate, d.monitoring_frequency, d.monitoring_interval);
      await tx
        .updateTable("transition_decision")
        .set({
          next_monitoring_date: next,
          version: sql<number>`version + 1`,
          updated_at: sql<Date>`now()`,
          updated_by: byUser,
        })
        .where("id", "=", d.id)
        .where("version", "=", d.version)
        .executeTakeFirstOrThrow();
      await insertAuditEvent(tx, actor, {
        action: "transition_decision.monitoring_scheduled",
        recordType: "transition_decision",
        recordId: d.id,
        organizationId: d.organization_id,
        transformationId: d.transformation_id,
        priorVersion: d.version,
        newVersion: d.version + 1,
        changes: { next_monitoring_date: { from: dueDate, to: next } },
      });
    }
  }
  return steps;
}

// ------------------------------------------------------------------------------------------------ routes

const decisionParams = z.strictObject({ transformationId: z.uuid(), transitionDecisionId: z.uuid() });
const listQuery = z.strictObject({
  cursor: cursorSchema,
  limit: limitSchema,
  benefitId: z.uuid().optional(),
  status: z.enum(["draft", "submitted", "approved", "rejected", "withdrawn"]).optional(),
});

/** Registers this file's routes and returns them as "METHOD /path". */
export function registerTransitionDecisionRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  const read = { access: { permission: "transformation.read" as const } };
  const propose = { access: { permission: TRANSITION_DECISION_PROPOSE }, consumes: JSON_BODY };
  // submitTransitionDecision has no request body (the completeWorkItem precedent, S-3).
  const submitCfg = { access: { permission: TRANSITION_DECISION_PROPOSE } };

  app.get(TRANSITION_DECISIONS, { config: read }, async (request) => {
    const transformationId = parseTransformationParam(request.params);
    const query = parseQuery(listQuery, request.query);
    await requireTransformationRead(db, principalOf(request), transformationId);
    const hash = filterHash({
      table: "transition_decision",
      transformationId,
      benefitId: query.benefitId ?? null,
      status: query.status ?? null,
    });
    const after = decodeCursor(query.cursor, hash, 1);
    // The effective status (see the file header): a stored draft with a pending or deferred approval is `submitted`.
    const inApproval = sql<boolean>`EXISTS (SELECT 1 FROM approval a WHERE a.subject_id = d.id
      AND a.approval_type = ${TRANSITION_DECISION_APPROVAL_TYPE} AND a.status IN ('pending', 'deferred'))`;
    let q = db
      .selectFrom("transition_decision as d")
      .selectAll("d")
      .where("d.transformation_id", "=", transformationId);
    if (query.benefitId !== undefined) q = q.where("d.benefit_id", "=", query.benefitId);
    if (query.status === "submitted")
      q = q.where(sql<boolean>`(d.status = 'submitted' OR (d.status = 'draft' AND ${inApproval}))`);
    else if (query.status === "draft") q = q.where("d.status", "=", "draft").where(sql<boolean>`NOT ${inApproval}`);
    else if (query.status !== undefined) q = q.where("d.status", "=", query.status);
    if (after) q = q.where("d.id", ">", String(after[0]));
    const rows = (await q
      .orderBy("d.id")
      .limit(query.limit + 1)
      .execute()) as DecisionRow[];
    const page = paginate(rows, query.limit, (r) => [r.id], hash);
    return { items: await presentDecisions(db, page.items), nextCursor: page.nextCursor };
  });

  app.post(TRANSITION_DECISIONS, { config: propose }, async (request, reply) => {
    const transformationId = parseTransformationParam(request.params);
    const body = await db.transaction().execute(async (tx) => {
      const id = await createDecision(tx, request, transformationId);
      return presentDecision(tx, transformationId, id);
    });
    return sendVersioned(reply, 201, body, `${request.url.split("?")[0]!}/${body.id}`);
  });

  app.get(TRANSITION_DECISION_ITEM, { config: read }, async (request, reply) => {
    const { transformationId, transitionDecisionId } = parse(decisionParams, request.params, "params");
    await requireTransformationRead(db, principalOf(request), transformationId);
    return sendVersioned(reply, 200, await presentDecision(db, transformationId, transitionDecisionId));
  });

  app.patch(TRANSITION_DECISION_ITEM, { config: propose }, async (request, reply) => {
    const { transformationId, transitionDecisionId } = parse(decisionParams, request.params, "params");
    const body = await db.transaction().execute(async (tx) => {
      await updateDecision(tx, request, transformationId, transitionDecisionId);
      return presentDecision(tx, transformationId, transitionDecisionId);
    });
    return sendVersioned(reply, 200, body);
  });

  app.post(TRANSITION_DECISION_SUBMIT, { config: submitCfg }, async (request, reply) => {
    const { transformationId, transitionDecisionId } = parse(decisionParams, request.params, "params");
    const body = await db.transaction().execute(async (tx) => {
      await submitDecision(tx, request, transformationId, transitionDecisionId);
      return presentDecision(tx, transformationId, transitionDecisionId);
    });
    return sendVersioned(reply, 200, body);
  });

  return [
    `GET ${TRANSITION_DECISIONS}`,
    `POST ${TRANSITION_DECISIONS}`,
    `GET ${TRANSITION_DECISION_ITEM}`,
    `PATCH ${TRANSITION_DECISION_ITEM}`,
    `POST ${TRANSITION_DECISION_SUBMIT}`,
  ];
}
