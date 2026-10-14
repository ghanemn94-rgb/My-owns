// Configuration reviews, "Review where configured" (OpenAPI tag "studio"; ADR-0039 §5, §8, §9, §11, §13; REQ-S06-007,
// REQ-S06-010, REQ-S12-018 case 1; p5-work-split §A.4; T-DG5-BE-B3):
//   POST /admin/methodology-versions/{versionId}/submit-review                       submitConfigReview   (methodology.publish)
//   GET  /admin/methodology-versions/{versionId}/reviews                             listConfigReviews    (methodology.read)
//   POST /admin/methodology-versions/{versionId}/reviews/{reviewId}/decision         decideConfigReview   (methodology.review)
//   POST /admin/methodology-versions/{versionId}/reviews/{reviewId}/withdraw         withdrawConfigReview (methodology.publish)
//
// Every write: commit-time authorization (grants reloaded inside the write transaction), Zod validation, If-Match
// (submit: the draft's version; decide and withdraw: the review request's version), lock class `configDraft` on
// "<kind>:<key>", one audit event per row written in the same transaction, no remote I/O.
//
// submit (stage preview -> review): records the review request for exactly the draft's current content hash, the
// S12-018 revision proposal (revision-impact.ts `proposeConfigRevision`: validation, impact, routing) and one
// `config_review` work item per active holder of the policy's reviewer role in the organization, never the requester
// nor the draft's author (createWorkItemOnce through the revision-impact port; dedupe "config_review:<proposalId>:<userId>").
// The proposal is keyed on the content hash, so a second review request of the same content (after a withdrawal or a
// "request changes" with no content change) finds the proposal already recorded; its tasks then use the round-suffixed
// key "config_review:<proposalId>#<round>:<userId>" (the `#n` precedent of tasks/service.ts), so each pending request
// has its reviewers' tasks exactly once.
// decide (methodology.review, and the caller holds the request's reviewer role): approve (stage review -> approved)
// or request changes (note required; stage review -> editing). Never the draft's author nor the requester
// (403 config_review.self_review; the 0062 CHECK and trigger refuse the same). The decider's task is done, the other
// reviewers' tasks are cancelled.
// withdraw: the pending request is withdrawn, the stage returns to editing and the open tasks are cancelled.
//
// A configuration review is not a business approval: it approves a Studio configuration change only, never a G1-G6
// gate, a Finance validation or any decision in a transformation. Timers never decide a review.
import { insertAuditEvent, sql, type AuditActor, type ConfigReviewRequestTable, type Tx } from "@mth/db";
import {
  configReviewDecision,
  configReviewSubmit,
  type ConfigReviewRequest,
  type ConfigReviewStatus,
} from "@mth/shared/schemas";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Selectable } from "kysely";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { auditContextOf, principalOf, refreshPrincipal, targetFor } from "../access/index.ts";
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
import {
  loadVersion,
  lockConfigDraft,
  requireStudioPermission,
  requireStudioWrite,
  studioRefusals,
  versionParams,
  VERSIONS,
  type MethodologyVersionRow,
} from "./drafts.ts";
import {
  CONFIG_REVIEW_KIND,
  createConfigReviewTasks,
  proposeConfigRevision,
  reviewerHolders,
  REVIEW_TASK_MESSAGES,
} from "./revision-impact.ts";

type ReviewRow = Selectable<ConfigReviewRequestTable>;

const JSON_BODY = ["application/json"] as const;
const ONE = `${VERSIONS}/:versionId`;
const SUBMIT = `${ONE}/submit-review`;
const REVIEWS = `${ONE}/reviews`;
const DECISION = `${REVIEWS}/:reviewId/decision`;
const WITHDRAW = `${REVIEWS}/:reviewId/withdraw`;

const reviewParams = z.strictObject({ versionId: z.uuid(), reviewId: z.uuid() });

/** The subject of a review task: the review request the reviewer decides. */
export const CONFIG_REVIEW_TASK_SUBJECT = "config_review_request";

export function toConfigReviewRequest(r: ReviewRow): ConfigReviewRequest {
  return {
    id: r.id,
    versionId: r.methodology_version_id,
    contentSha256: r.content_sha256,
    reviewerRoleCode: r.reviewer_role_code,
    status: r.status as ConfigReviewStatus,
    requestNote: r.request_note,
    revisionProposalId: r.revision_proposal_id,
    requestedBy: r.requested_by,
    requestedAt: iso(r.requested_at),
    decidedBy: r.decided_by,
    decidedAt: isoOrNull(r.decided_at),
    decisionNote: r.decision_note,
    version: r.version,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

/** The review policy of a kind; a missing row reads as "review required" (the 0062 guard's coalesce(..., true)). */
export async function reviewRequiredFor(tx: Tx, kind: string): Promise<boolean> {
  const row = await tx
    .selectFrom("config_review_policy")
    .select("review_required")
    .where("config_kind", "=", kind)
    .executeTakeFirst();
  return row?.review_required ?? true;
}

/** Locks the version's configuration (configDraft) and re-reads it for update. */
async function lockVersion(tx: Tx, versionId: string): Promise<MethodologyVersionRow> {
  const probe = await loadVersion(tx, versionId);
  await lockConfigDraft(tx, probe.config_kind, probe.key);
  return loadVersion(tx, versionId, true);
}

/** Moves the draft's stage one step (version +1) with its audit event. */
export async function stepDraftStage(
  tx: Tx,
  audit: AuditContext,
  actor: { userId: string; organizationId: string },
  current: MethodologyVersionRow,
  to: "editing" | "review" | "approved",
  action: string,
  extra: Record<string, { from: unknown; to: unknown }> = {},
  reason: string | null = null,
): Promise<MethodologyVersionRow> {
  const updated = await tx
    .updateTable("methodology_version")
    .set({
      draft_stage: to,
      version: sql<number>`version + 1`,
      updated_at: sql<Date>`now()`,
      updated_by: actor.userId,
    })
    .where("id", "=", current.id)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, audit, {
    action,
    recordType: "methodology_version",
    recordId: current.id,
    organizationId: actor.organizationId,
    priorVersion: current.version,
    newVersion: updated.version,
    reason,
    changes: { draft_stage: { from: current.draft_stage, to }, ...extra },
  });
  return updated;
}

// ------------------------------------------------------------------------------------------------ review tasks

const userActor = (audit: AuditContext): AuditActor => ({
  actorType: "user",
  actorUserId: audit.actorUserId,
  requestId: audit.requestId,
  source: "api",
});

/**
 * Closes the open `config_review` work items of a review request, each with its audit event: the decider's item is
 * done, every other one cancelled (an item never reopens: 0028 work_item_guard). `methodology` imports no business
 * module, so this is the only work-item write here besides createWorkItemOnce through the revision-impact port; it
 * moves only the status columns tasks' closeWorkItemsOfSubject moves, under the same guard.
 */
export async function closeConfigReviewTasks(
  tx: Tx,
  audit: AuditContext,
  organizationId: string,
  reviewRequestId: string,
  doneBy: string | null,
): Promise<number> {
  const open = await tx
    .selectFrom("work_item")
    .select(["id", "version", "assignee_user_id", "organization_id", "transformation_id"])
    .where("organization_id", "=", organizationId)
    .where("kind", "=", CONFIG_REVIEW_KIND)
    .where("subject_type", "=", CONFIG_REVIEW_TASK_SUBJECT)
    .where("subject_id", "=", reviewRequestId)
    .where("status", "=", "open")
    .orderBy("id")
    .forUpdate()
    .execute();
  const by = audit.actorUserId;
  for (const item of open) {
    const status = doneBy !== null && item.assignee_user_id === doneBy ? "done" : "cancelled";
    const updated = await tx
      .updateTable("work_item")
      .set({
        status,
        completed_at: status === "done" ? sql<Date>`now()` : null,
        completed_by: status === "done" ? by : null,
        version: sql<number>`version + 1`,
        updated_at: sql<Date>`now()`,
        updated_by: by,
      })
      .where("id", "=", item.id)
      .where("version", "=", item.version)
      .returning("version")
      .executeTakeFirstOrThrow();
    await insertAuditEvent(tx, userActor(audit), {
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
  return open.length;
}

// ------------------------------------------------------------------------------------------------ writes

async function submitReview(tx: Tx, request: FastifyRequest, versionId: string): Promise<ReviewRow> {
  const actor = await requireStudioWrite(tx, request, "methodology.publish");
  const body = parseBody(configReviewSubmit, request.body);
  const expected = requireIfMatch(request);
  const current = await lockVersion(tx, versionId);
  if (current.version !== expected) throw problems.versionConflict(current.version);
  if (current.status !== "draft" || current.draft_stage === "discarded") throw studioRefusals.notEditable();
  // Only a previewed draft is reviewed (a passing preview run for exactly its content moved it to `preview`).
  if (current.draft_stage === "editing") throw studioRefusals.previewRequired();
  // Already under review, or approved: nothing more to submit; the draft is no longer being edited.
  if (current.draft_stage !== "preview") throw studioRefusals.notEditable();
  const audit = auditContextOf(request);
  const proposed = await proposeConfigRevision(tx, audit, {
    version: current,
    organizationId: actor.organizationId,
    requestedBy: actor.userId,
  });
  const id = uuidv7();
  const row = await tx
    .insertInto("config_review_request")
    .values({
      id,
      methodology_version_id: current.id,
      content_sha256: current.content_sha256,
      reviewer_role_code: proposed.proposal.reviewer_role_code,
      request_note: body.note ?? null,
      revision_proposal_id: proposed.proposal.id,
      requested_by: actor.userId,
      created_by: actor.userId,
      updated_by: actor.userId,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, audit, {
    action: "config_review_request.create",
    recordType: "config_review_request",
    recordId: id,
    organizationId: actor.organizationId,
    newVersion: 1,
    changes: {
      methodology_version_id: { from: null, to: current.id },
      content_sha256: { from: null, to: current.content_sha256 },
      reviewer_role_code: { from: null, to: row.reviewer_role_code },
      revision_proposal_id: { from: null, to: proposed.proposal.id },
    },
  });
  await stepDraftStage(tx, audit, actor, current, "review", "methodology_version.submit_review", {
    review_request_id: { from: null, to: id },
  });
  // The reviewers of this request: the proposal's routing on its first recording; on a later request of the same
  // content (the proposal is already recorded), the policy's holders now, under the round-suffixed key.
  const round = await tx
    .selectFrom("config_review_request")
    .select(sql<string>`count(*)`.as("n"))
    .where("methodology_version_id", "=", current.id)
    .where("content_sha256", "=", current.content_sha256)
    .executeTakeFirstOrThrow();
  const roundNo = Number(round.n);
  let reviewers: readonly string[] = proposed.reviewerUserIds;
  if (!proposed.created && (await reviewRequiredFor(tx, current.config_kind))) {
    const target = await targetFor(tx, "organization", { organizationId: actor.organizationId });
    reviewers = await reviewerHolders(tx, row.reviewer_role_code, target, [actor.userId, current.created_by]);
  }
  const taskKeyRef =
    roundNo <= 1 ? proposed.proposal : { ...proposed.proposal, id: `${proposed.proposal.id}#${roundNo}` };
  await createConfigReviewTasks(tx, audit, taskKeyRef, reviewers, {
    subjectType: CONFIG_REVIEW_TASK_SUBJECT,
    subjectId: id,
    linkPath: `/admin/studio/versions/${current.id}`,
    messageKey: REVIEW_TASK_MESSAGES.config,
    messageParams: { configKind: current.config_kind, key: current.key, versionNo: current.version_no },
  });
  return row;
}

/** The review request of the version, locked, with its If-Match checked; 404 when it belongs to another version. */
async function lockedReview(tx: Tx, versionId: string, reviewId: string, expected: number): Promise<ReviewRow> {
  const row = await tx
    .selectFrom("config_review_request")
    .selectAll()
    .where("id", "=", reviewId)
    .where("methodology_version_id", "=", versionId)
    .forUpdate()
    .executeTakeFirst();
  if (row === undefined) throw problems.notFound();
  if (row.version !== expected) throw problems.versionConflict(row.version);
  return row;
}

const notPending = () => problems.invalidTransition("This review has already been decided or withdrawn.");

async function decideReview(tx: Tx, request: FastifyRequest, versionId: string, reviewId: string): Promise<ReviewRow> {
  principalOf(request);
  const principal = await refreshPrincipal(tx, request);
  const actor = requireStudioPermission(principal, "methodology.review");
  const body = parseBody(configReviewDecision, request.body);
  if (body.outcome === "request_changes" && body.note === undefined)
    throw problems.validation([
      { pointer: "/note", code: "validation.required", message: "A required value is missing." },
    ]);
  const expected = requireIfMatch(request);
  const current = await lockVersion(tx, versionId);
  const review = await lockedReview(tx, versionId, reviewId, expected);
  if (review.status !== "pending") throw notPending();
  // Separation of duties (ADR-0039 §5): never the draft's author nor the requester.
  if (actor.userId === review.requested_by || actor.userId === current.created_by) throw studioRefusals.selfReview();
  // The configured reviewer: the caller holds the request's reviewer role in the organization.
  const holdsRole = principal.grants.some(
    (g) => g.roleCode === review.reviewer_role_code && g.organizationId === actor.organizationId,
  );
  if (!holdsRole) throw problems.forbidden();
  // The request reviews exactly the draft's current content; the stage `review` freezes it, so this always holds.
  if (current.draft_stage !== "review" || current.content_sha256 !== review.content_sha256)
    throw problems.versionConflict(current.version);
  const audit = auditContextOf(request);
  const status = body.outcome === "approve" ? "approved" : "changes_requested";
  const updated = await tx
    .updateTable("config_review_request")
    .set({
      status,
      decided_by: actor.userId,
      decided_at: sql<Date>`now()`,
      decision_note: body.note ?? null,
      version: sql<number>`version + 1`,
      updated_at: sql<Date>`now()`,
      updated_by: actor.userId,
    })
    .where("id", "=", review.id)
    .where("version", "=", review.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, audit, {
    action: "config_review_request.decide",
    recordType: "config_review_request",
    recordId: review.id,
    organizationId: actor.organizationId,
    priorVersion: review.version,
    newVersion: updated.version,
    reason: body.note ?? null,
    changes: {
      status: { from: "pending", to: status },
      decided_by: { from: null, to: actor.userId },
    },
  });
  await stepDraftStage(
    tx,
    audit,
    actor,
    current,
    status === "approved" ? "approved" : "editing",
    status === "approved" ? "methodology_version.review_approve" : "methodology_version.review_request_changes",
    { review_request_id: { from: null, to: review.id } },
    body.note ?? null,
  );
  await closeConfigReviewTasks(tx, audit, actor.organizationId, review.id, actor.userId);
  return updated;
}

async function withdrawReview(
  tx: Tx,
  request: FastifyRequest,
  versionId: string,
  reviewId: string,
): Promise<ReviewRow> {
  const actor = await requireStudioWrite(tx, request, "methodology.publish");
  const expected = requireIfMatch(request);
  const current = await lockVersion(tx, versionId);
  const review = await lockedReview(tx, versionId, reviewId, expected);
  if (review.status !== "pending") throw notPending();
  const audit = auditContextOf(request);
  const updated = await tx
    .updateTable("config_review_request")
    .set({
      status: "withdrawn",
      version: sql<number>`version + 1`,
      updated_at: sql<Date>`now()`,
      updated_by: actor.userId,
    })
    .where("id", "=", review.id)
    .where("version", "=", review.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, audit, {
    action: "config_review_request.withdraw",
    recordType: "config_review_request",
    recordId: review.id,
    organizationId: actor.organizationId,
    priorVersion: review.version,
    newVersion: updated.version,
    changes: { status: { from: "pending", to: "withdrawn" } },
  });
  if (current.status === "draft" && current.draft_stage === "review")
    await stepDraftStage(tx, audit, actor, current, "editing", "methodology_version.review_withdraw", {
      review_request_id: { from: review.id, to: null },
    });
  await closeConfigReviewTasks(tx, audit, actor.organizationId, review.id, null);
  return updated;
}

// ------------------------------------------------------------------------------------------------ routes

const listQuery = z.strictObject({ cursor: cursorSchema, limit: limitSchema });

function sendReview(reply: FastifyReply, status: number, row: ReviewRow, location?: string): FastifyReply {
  return sendVersioned(reply, status, toConfigReviewRequest(row), location);
}

export function registerConfigReviewRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  const read = { access: { permission: "methodology.read" as const } };
  const publish = { access: { permission: "methodology.publish" as const } };
  const review = { access: { permission: "methodology.review" as const } };

  app.post(SUBMIT, { config: { ...publish, consumes: JSON_BODY } }, async (request, reply) => {
    const { versionId } = parse(versionParams, request.params, "params");
    const row = await db.transaction().execute((tx) => submitReview(tx, request, versionId));
    return sendReview(reply, 201, row, `${VERSIONS}/${versionId}/reviews`);
  });

  app.get(REVIEWS, { config: read }, async (request) => {
    const { versionId } = parse(versionParams, request.params, "params");
    const query = parseQuery(listQuery, request.query);
    requireStudioPermission(principalOf(request), "methodology.read");
    await loadVersion(db, versionId);
    const hash = filterHash({ versionId });
    const after = decodeCursor(query.cursor, hash, 1);
    let q = db.selectFrom("config_review_request").selectAll().where("methodology_version_id", "=", versionId);
    // Newest first: ids are UUIDv7 (time-ordered).
    if (after) q = q.where("id", "<", String(after[0]));
    const rows = await q
      .orderBy("id", "desc")
      .limit(query.limit + 1)
      .execute();
    const pageRows = paginate(rows, query.limit, (r) => [r.id], hash);
    return { items: pageRows.items.map(toConfigReviewRequest), nextCursor: pageRows.nextCursor };
  });

  app.post(DECISION, { config: { ...review, consumes: JSON_BODY } }, async (request, reply) => {
    const { versionId, reviewId } = parse(reviewParams, request.params, "params");
    const row = await db.transaction().execute((tx) => decideReview(tx, request, versionId, reviewId));
    return sendReview(reply, 200, row);
  });

  app.post(WITHDRAW, { config: publish }, async (request, reply) => {
    const { versionId, reviewId } = parse(reviewParams, request.params, "params");
    const row = await db.transaction().execute((tx) => withdrawReview(tx, request, versionId, reviewId));
    return sendReview(reply, 200, row);
  });

  return [`POST ${SUBMIT}`, `GET ${REVIEWS}`, `POST ${DECISION}`, `POST ${WITHDRAW}`];
}
