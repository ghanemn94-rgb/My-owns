// Governance matrices: the T11 and T12 approval headers (OpenAPI tag "raci"; ADR-0026 §7; REQ-S10-007, REQ-PB-065
// "approve-matrix: SP", REQ-PB-067 "approve: SP"; T-DG4-BE-C):
//   GET  /transformations/{id}/governance-matrices                       both headers with their approval state
//   POST /transformations/{id}/governance-matrices/{matrixKind}/submit   draft -> in_approval and a
//                                                                        governance_matrix_change approval routed to SP
//                                                                        (decision_right.configure for T11, raci.edit
//                                                                        for T12; If-Match on the header)
//
// Every T11 row or T12 deliverable/cell edit bumps its header's version in the same transaction (`reviseMatrix`); an
// edit to an approved matrix sets it back to draft (the earlier approval stays in the history). While a matrix is
// in_approval its rows are frozen (422 governance_matrix.in_approval; the 0030 trigger is the last line).
//
// The approval is a BUSINESS approval inside the product, decided by the Sponsor-mapped person through the approval
// service (workflows, BE-B); this module never writes approval rows (S-14). Its subject provider applies each outcome to
// the header in the deciding transaction: approve -> approved (approved_version = the requested version); reject,
// request changes, withdraw -> draft; defer -> still in approval. Nothing here touches DG0-DG7.
//
// Round 2 and later (ADR-0026 amendment A4; T-DG4-BE-R2): after changes are requested the header is a draft again and
// its rows are editable. Submitting it again sets the header in_approval (version + 1, audited) and then resubmits the
// SAME approval on that new version through `resubmitApprovalInTx`, in one transaction, so the rows are frozen again
// for every round. The type sets `resubmitThroughSubject`, so `POST /approvals/{id}/resubmit` refuses it (422
// approval.resubmit_through_record) and the header can never be pending while it is still a draft.
import { sql, type GovernanceMatrixRow, type DbOrTx, type Tx } from "@mth/db";
import { governanceMatrixKind, governanceMatrixSubmit, uuid, type GovernanceMatrix } from "@mth/shared/schemas";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  commitTimeDenial,
  principalOf,
  refreshPrincipal,
  requireAction,
  requireTransformationRead,
  auditContextOf,
  type ResolvedTarget,
} from "../access/index.ts";
import { record, type AuditContext } from "../audit/index.ts";
import {
  ADVISORY_LOCK_CLASSES,
  iso,
  isoOrNull,
  parse,
  parseBody,
  problems,
  requireIfMatch,
  sendVersioned,
  type ModuleDeps,
} from "../platform/index.ts";
import {
  registerApprovalSubject,
  requestApprovalInTx,
  resubmitApprovalInTx,
  toApprovals,
  type ApprovalOutcomeEvent,
} from "../workflows/index.ts";

const JSON_BODY = ["application/json"] as const;
export const MATRIX_APPROVAL_TYPE = "governance_matrix_change";
/** The party that approves a matrix version (ADR-0026 §7; REQ-PB-065 "approve-matrix: SP", REQ-PB-067 "approve: SP"). */
export const MATRIX_APPROVER_PARTY = "SP";
const OPEN_APPROVAL_STATUSES = ["pending", "changes_requested", "deferred"] as const;
export type MatrixKind = z.infer<typeof governanceMatrixKind>;
/** The permission that edits (and submits) each matrix kind (ADR-0026 §5, §7). */
export const editPermissionOf = (kind: MatrixKind): "decision_right.configure" | "raci.edit" =>
  kind === "decision_rights" ? "decision_right.configure" : "raci.edit";

const transformationParams = z.strictObject({ transformationId: uuid });
const submitParams = z.strictObject({ transformationId: uuid, matrixKind: governanceMatrixKind });

// ------------------------------------------------------------------------------------------------ refusals (S-11)

export const governanceMatrixRefusals = {
  inApproval: () =>
    problems.businessRule(
      "governance_matrix.in_approval",
      "This matrix is waiting for approval. It can change again once the approval is decided or withdrawn.",
    ),
  notDraft: () =>
    problems.businessRule("governance_matrix.not_draft", "Only a draft matrix can be submitted for approval."),
} as const;

// ------------------------------------------------------------------------------------------------ access

/**
 * Read gate (404), then `permission` decided on grants reloaded in `tx` (the commit-time re-check of S-4; a denial is
 * 403 and audited). Returns the acting user and the transformation's resolved target.
 */
export async function requireGovernanceWrite(
  tx: Tx,
  request: FastifyRequest,
  transformationId: string,
  permission: "decision_right.configure" | "raci.edit",
): Promise<{ userId: string; target: ResolvedTarget & { transformationId: string } }> {
  const target = await requireTransformationRead(tx, principalOf(request), transformationId);
  const fresh = await refreshPrincipal(tx, request);
  try {
    await requireTransformationRead(tx, fresh, transformationId);
    await requireAction(tx, fresh, permission, target);
  } catch (err) {
    throw commitTimeDenial(err);
  }
  return { userId: fresh.userId!, target: { ...target, transformationId } };
}

// ------------------------------------------------------------------------------------------------ header service

async function lockMatrixSubject(tx: Tx, matrixId: string): Promise<void> {
  // ADR-0026 §4 / work split §I+C.8 item 4: a module updating a record that can be an approval subject takes lock
  // class approvalSubject on its id first, so an approval decided concurrently sees either the old or the new version.
  await sql`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK_CLASSES.approvalSubject}::integer, hashtext(${matrixId}::text))`.execute(
    tx,
  );
}

async function matrixIdOf(db: DbOrTx, transformationId: string, kind: MatrixKind): Promise<string> {
  const m = await db
    .selectFrom("governance_matrix")
    .select("id")
    .where("transformation_id", "=", transformationId)
    .where("kind", "=", kind)
    .executeTakeFirst();
  // Every transformation has both headers (p4_instantiate_transformation, and the 0030 backfill).
  if (!m) throw problems.notFound();
  return m.id;
}

/**
 * Called before any T11/T12 row write (ADR-0026 §7): refuses with 422 governance_matrix.in_approval while the matrix
 * is in approval, otherwise bumps the header's version (approved -> draft) with its audit event, in `tx`.
 */
export async function reviseMatrix(
  tx: Tx,
  audit: AuditContext,
  transformationId: string,
  kind: MatrixKind,
  actorUserId: string,
): Promise<GovernanceMatrixRow> {
  const id = await matrixIdOf(tx, transformationId, kind);
  await lockMatrixSubject(tx, id);
  const m = await tx
    .selectFrom("governance_matrix")
    .selectAll()
    .where("id", "=", id)
    .forUpdate()
    .executeTakeFirstOrThrow();
  if (m.status === "in_approval") throw governanceMatrixRefusals.inApproval();
  const updated = await tx
    .updateTable("governance_matrix")
    .set({
      status: "draft",
      version: sql<number>`version + 1`,
      updated_at: sql<Date>`now()`,
      updated_by: actorUserId,
    })
    .where("id", "=", id)
    .where("version", "=", m.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, audit, {
    action: "governance_matrix.revise",
    recordType: "governance_matrix",
    recordId: id,
    organizationId: m.organization_id,
    transformationId,
    priorVersion: m.version,
    newVersion: updated.version,
    changes: m.status === "draft" ? {} : { status: { from: m.status, to: "draft" } },
  });
  return updated;
}

async function openApprovalIds(db: DbOrTx, matrixIds: readonly string[]): Promise<Map<string, string>> {
  if (matrixIds.length === 0) return new Map();
  const rows = await db
    .selectFrom("approval")
    .select(["id", "subject_id"])
    .where("approval_type", "=", MATRIX_APPROVAL_TYPE)
    .where("subject_id", "in", matrixIds)
    .where("status", "in", [...OPEN_APPROVAL_STATUSES])
    .execute();
  return new Map(rows.map((r) => [r.subject_id, r.id]));
}

export const toGovernanceMatrix = (m: GovernanceMatrixRow, openApprovalId: string | null): GovernanceMatrix => ({
  id: m.id,
  transformationId: m.transformation_id,
  kind: m.kind as GovernanceMatrix["kind"],
  status: m.status as GovernanceMatrix["status"],
  approvedVersion: m.approved_version,
  approvedAt: isoOrNull(m.approved_at),
  approvedBy: m.approved_by,
  openApprovalId,
  version: m.version,
  updatedAt: iso(m.updated_at),
});

/** The header of one matrix kind, as the API shows it (with the id of its open approval, if any). */
export async function loadGovernanceMatrix(
  db: DbOrTx,
  transformationId: string,
  kind: MatrixKind,
): Promise<GovernanceMatrix> {
  const m = await db
    .selectFrom("governance_matrix")
    .selectAll()
    .where("transformation_id", "=", transformationId)
    .where("kind", "=", kind)
    .executeTakeFirst();
  if (!m) throw problems.notFound();
  const open = await openApprovalIds(db, [m.id]);
  return toGovernanceMatrix(m, open.get(m.id) ?? null);
}

// ------------------------------------------------------------------------------------------------ approval subject

/**
 * Applies a governance_matrix_change outcome to its header, in the deciding transaction (the approval service calls it
 * after the decision row is written; the 0031 trigger has already checked that the header is still at the requested
 * version). The decision itself is the named person's; this only reflects it on the matrix.
 */
export async function applyMatrixOutcome(tx: Tx, event: ApprovalOutcomeEvent): Promise<void> {
  const a = event.approval;
  const next =
    event.outcome === "approved"
      ? "approved"
      : event.outcome === "rejected" || event.outcome === "changes_requested" || event.outcome === "withdrawn"
        ? "draft"
        : null; // deferred: still in approval. resubmitted: never emitted for this type (resubmitThroughSubject).
  if (next === null) return;
  const m = await tx
    .selectFrom("governance_matrix")
    .selectAll()
    .where("id", "=", a.subject_id)
    .forUpdate()
    .executeTakeFirst();
  if (!m || (m.status === next && next === "draft")) return;
  const approved = next === "approved";
  const updated = await tx
    .updateTable("governance_matrix")
    .set({
      status: next,
      ...(approved
        ? { approved_version: a.subject_version, approved_at: sql<Date>`now()`, approved_by: event.actorUserId }
        : {}),
      version: sql<number>`version + 1`,
      updated_at: sql<Date>`now()`,
      updated_by: event.actorUserId,
    })
    .where("id", "=", m.id)
    .where("version", "=", m.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, event.audit, {
    action: approved ? "governance_matrix.approve" : "governance_matrix.return_to_draft",
    recordType: "governance_matrix",
    recordId: m.id,
    organizationId: m.organization_id,
    transformationId: m.transformation_id,
    priorVersion: m.version,
    newVersion: updated.version,
    reason: `approval ${a.id}: ${event.outcome}`,
    changes: {
      status: { from: m.status, to: next },
      ...(approved
        ? {
            approved_version: { from: m.approved_version, to: updated.approved_version },
            approved_by: { from: m.approved_by, to: updated.approved_by },
          }
        : {}),
    },
  });
}

// ------------------------------------------------------------------------------------------------ routes

export function registerGovernanceMatrixRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  const LIST = "/api/v1/transformations/:transformationId/governance-matrices";
  const SUBMIT = `${LIST}/:matrixKind/submit`;
  registerApprovalSubject(MATRIX_APPROVAL_TYPE, { onOutcome: applyMatrixOutcome, resubmitThroughSubject: true });

  app.get(LIST, { config: { access: { permission: "transformation.read" } } }, async (request) => {
    const { transformationId } = parse(transformationParams, request.params, "params");
    await requireTransformationRead(db, principalOf(request), transformationId);
    const rows = await db
      .selectFrom("governance_matrix")
      .selectAll()
      .where("transformation_id", "=", transformationId)
      .orderBy("kind")
      .execute();
    const open = await openApprovalIds(
      db,
      rows.map((r) => r.id),
    );
    return { items: rows.map((r) => toGovernanceMatrix(r, open.get(r.id) ?? null)) };
  });

  // The declared permission documents the route (both edit permissions are held by TL and TO, ADR-0026 §8); the handler
  // decides the exact one for the kind (decision_right.configure for T11, raci.edit for T12) inside the transaction.
  app.post(SUBMIT, { config: { access: { permission: "raci.edit" }, consumes: JSON_BODY } }, async (request, reply) => {
    const { transformationId, matrixKind } = parse(submitParams, request.params, "params");
    const body = parseBody(governanceMatrixSubmit, request.body);
    const approval = await db.transaction().execute(async (tx) => {
      const { userId, target } = await requireGovernanceWrite(
        tx,
        request,
        transformationId,
        editPermissionOf(matrixKind),
      );
      const expected = requireIfMatch(request);
      const audit = auditContextOf(request);
      const id = await matrixIdOf(tx, transformationId, matrixKind);
      await lockMatrixSubject(tx, id);
      const m = await tx
        .selectFrom("governance_matrix")
        .selectAll()
        .where("id", "=", id)
        .forUpdate()
        .executeTakeFirstOrThrow();
      if (m.version !== expected) throw problems.versionConflict(m.version);
      if (m.status !== "draft") throw governanceMatrixRefusals.notDraft();
      // A draft whose approval had changes requested (round >= 2) is resubmitted through that approval below.
      const returned = await tx
        .selectFrom("approval")
        .select("id")
        .where("approval_type", "=", MATRIX_APPROVAL_TYPE)
        .where("subject_id", "=", id)
        .where("status", "=", "changes_requested")
        .executeTakeFirst();
      const inApproval = await tx
        .updateTable("governance_matrix")
        .set({
          status: "in_approval",
          version: sql<number>`version + 1`,
          updated_at: sql<Date>`now()`,
          updated_by: userId,
        })
        .where("id", "=", id)
        .where("version", "=", m.version)
        .returningAll()
        .executeTakeFirstOrThrow();
      await record(tx, audit, {
        action: "governance_matrix.submit",
        recordType: "governance_matrix",
        recordId: id,
        organizationId: m.organization_id,
        transformationId,
        priorVersion: m.version,
        newVersion: inApproval.version,
        changes: { status: { from: "draft", to: "in_approval" } },
      });
      // Round >= 2: the same approval, on the version now frozen (403 approval.not_requester for anyone but its
      // requester; 409 approval.stale_version cannot occur: the header was stepped just above, under the
      // approvalSubject advisory lock).
      if (returned)
        return resubmitApprovalInTx(tx, audit, {
          approvalId: returned.id,
          subjectVersion: inApproval.version,
          ...(body.requestNote !== undefined ? { requestNote: body.requestNote } : {}),
        });
      // The approval is requested on the version now frozen (the header's current version), routed to the party SP
      // through role mapping: an unmapped Sponsor is 422 routing.role_unmapped and the whole submit writes nothing.
      return requestApprovalInTx(tx, audit, {
        organizationId: m.organization_id,
        transformationId,
        scope: target,
        approvalType: MATRIX_APPROVAL_TYPE,
        subjectId: id,
        subjectVersion: inApproval.version,
        title: body.title,
        requestNote: body.requestNote ?? null,
        assigneePartyCode: MATRIX_APPROVER_PARTY,
        decisionRightId: null,
        slaType: null,
        urgentReason: null,
        due: null,
      });
    });
    const [out] = await toApprovals(db, [approval]);
    return sendVersioned(reply, 201, out!, `/api/v1/approvals/${approval.id}`);
  });

  return [`GET ${LIST}`, `POST ${SUBMIT}`];
}
