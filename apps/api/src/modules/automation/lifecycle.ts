// Rule-version lifecycle (OpenAPI tag `automation`; ADR-0043 §4, §8, §9; REQ-S12-002; M0155 "Draft → Preview/Test →
// Review where configured → Publish"; D-143 (5); p5-work-split §D.2; T-DG5-BE-H2):
//   POST /admin/automation-rules/{ruleId}/versions/{versionNo}/submit   submitAutomationRuleVersion  (automation.configure;
//                                                                         If-Match = the version's version)
//   POST /admin/automation-rules/{ruleId}/versions/{versionNo}/review   decideAutomationRuleReview   (automation.review;
//                                                                         If-Match = the version's version)
//   POST /admin/automation-rules/{ruleId}/versions/{versionNo}/publish  publishAutomationRuleVersion (automation.configure;
//                                                                         If-Match = the RULE's version)
//   POST /admin/automation-rules/{ruleId}/versions/{versionNo}/discard  discardAutomationRuleVersion (automation.configure;
//                                                                         If-Match = the version's version)
//
// State machine (0074 automation_rule_version_guard refuses the same again):
//   draft -> in_review | published (only when the policy requires no review) | discarded
//   in_review -> approved | draft (changes requested) | discarded;  approved -> published | draft | discarded
//   published -> superseded (only by a newer published version)
// Leaving a draft needs a `pass` dry run of the CURRENT content hash (422 automation_rule_version.dry_run_required).
// "Review where configured" is the `config_review_policy` row `automation_rule_set` (read only here; TO switches it
// through slice A's updateConfigReviewPolicy). A missing row means review required (the 0074 guard's default).
//
// Publish order (ADR-0043 §4; D-145, ARCH-03 handback §4 item 3): in ONE transaction, (1) the version -> published,
// (2) the RULE ROW -> effective_version_id = the version (always written, so the deferred constraint trigger
// automation_rule_effective_check runs at COMMIT), (3) the previous published version -> superseded. One audit event
// per row written.
//
// A rule review is a CONFIGURATION review by a second person (automation.review, TO by default), never a business
// approval (G1-G6), and never engineering gate DG0-DG7. The author never reviews their own version (403
// automation_rule_version.self_review; CHECK automation_rule_version_review_sod again). Submitting opens one
// `automation_rule_review` work item per reviewer (dedupe `automation_rule_review:<versionId>:<userId>`); the decision,
// a discard or a publish closes them.
//
// Every write: authorization re-checked on grants reloaded inside the transaction; validation; If-Match (428/409);
// one audit event per row written in the same transaction; no remote I/O.
import {
  sql,
  type AuditActor,
  type AutomationRuleRow,
  type AutomationRuleVersionRow,
  type DbOrTx,
  type Tx,
} from "@mth/db";
import { PROBLEM_TYPES } from "@mth/shared";
import { freeText } from "@mth/shared/schemas";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { auditContextOf, denialOf, organizationsWith, refreshPrincipal, type Principal } from "../access/index.ts";
import { record } from "../audit/index.ts";
import {
  HttpProblem,
  parse,
  parseBody,
  problems,
  requireIfMatch,
  sendVersioned,
  type ModuleDeps,
} from "../platform/index.ts";
import { closeWorkItemsOfSubject, createWorkItemOnce } from "../tasks/index.ts";
import { loadRuleForWrite } from "./rules.ts";
import { toRuleVersion, VERSION } from "./versions.ts";

const JSON_BODY = ["application/json"] as const;
const SUBMIT = `${VERSION}/submit`;
const REVIEW = `${VERSION}/review`;
const PUBLISH = `${VERSION}/publish`;
const DISCARD = `${VERSION}/discard`;

/** The work-item kind and message key of a rule review (kind seeded by 0075; label in myWork.json). */
export const RULE_REVIEW_KIND = "automation_rule_review";
export const RULE_REVIEW_MESSAGE_KEY = "automation.task.rule_review";
export const ruleReviewDedupeKey = (versionId: string, userId: string) =>
  `automation_rule_review:${versionId}:${userId}`;

const OPEN_STATUSES = ["draft", "in_review", "approved"] as const;

// ------------------------------------------------------------------------------------------------ refusals (§9)

/** The ADR-0043 §9 lifecycle refusals with their exact English texts (p5-work-split §2 rule 15). */
export const lifecycleRefusals = {
  invalidTransition: () =>
    problems.businessRule("automation_rule_version.invalid_transition", "This version cannot move to that state."),
  dryRunRequired: () =>
    problems.businessRule(
      "automation_rule_version.dry_run_required",
      "Run a dry run of the current content before submitting or publishing.",
    ),
  reviewRequired: () =>
    problems.businessRule(
      "automation_rule_version.review_required",
      "This version needs its configured review before it is published.",
    ),
  selfReview: () =>
    new HttpProblem({
      status: 403,
      type: PROBLEM_TYPES.forbidden,
      code: "automation_rule_version.self_review",
      title: "Forbidden",
      detail: "You cannot review a version you authored.",
    }),
} as const;

// ------------------------------------------------------------------------------------------------ shared reads

export const versionParams = z.strictObject({
  ruleId: z.uuid(),
  versionNo: z.coerce.number().int().min(1).max(2_147_483_647),
});

/** One version of a rule (404 when the rule has no such version), optionally locked FOR UPDATE. */
export async function loadVersion(
  db: DbOrTx,
  ruleId: string,
  versionNo: number,
  forUpdate = false,
): Promise<AutomationRuleVersionRow> {
  let q = db
    .selectFrom("automation_rule_version")
    .selectAll()
    .where("automation_rule_id", "=", ruleId)
    .where("version_no", "=", versionNo);
  if (forUpdate) q = q.forUpdate();
  const row = await q.executeTakeFirst();
  if (row === undefined) throw problems.notFound();
  return row;
}

/** True when a `pass` dry run covers exactly the version's current content hash (REQ-S12-002). */
export async function hasPassingDryRun(db: DbOrTx, v: Pick<AutomationRuleVersionRow, "id" | "content_sha256">) {
  const run = await db
    .selectFrom("automation_dry_run")
    .select("id")
    .where("automation_rule_version_id", "=", v.id)
    .where("content_sha256", "=", v.content_sha256)
    .where("outcome", "=", "pass")
    .limit(1)
    .executeTakeFirst();
  return run !== undefined;
}

/** "Review where configured": the `automation_rule_set` policy row; no row = review required (the 0074 default). */
export async function reviewRequired(db: DbOrTx): Promise<boolean> {
  const row = await db
    .selectFrom("config_review_policy")
    .select("review_required")
    .where("config_kind", "=", "automation_rule_set")
    .executeTakeFirst();
  return row?.review_required ?? true;
}

/** The organization a rule's configuration rights are decided in: its own, or (a starter) the caller's. */
function ruleOrganization(rule: AutomationRuleRow, principal: Principal): string | null {
  return rule.organization_id ?? principal.organizationId;
}

/** Active holders of `automation.review` through a grant of `organizationId` (the reviewers of a version). */
async function reviewersOf(tx: Tx, organizationId: string): Promise<string[]> {
  const r = await sql<{ user_id: string }>`
    SELECT DISTINCT sa.user_id
    FROM scoped_assignment sa
    JOIN role_permission rp ON rp.role_id = sa.role_id AND rp.permission_code = 'automation.review'
    JOIN app_user u ON u.id = sa.user_id AND u.status = 'active'
    WHERE sa.organization_id = ${organizationId}::uuid AND sa.revoked_at IS NULL
      AND sa.effective_from <= now() AND (sa.effective_to IS NULL OR sa.effective_to > now())
    ORDER BY sa.user_id`.execute(tx);
  return r.rows.map((x) => x.user_id);
}

/** The audit actor of a request, for the tasks services (the approvals.ts pattern). */
function actorOf(request: FastifyRequest): AuditActor {
  const a = auditContextOf(request);
  return { actorType: "user", actorUserId: a.actorUserId, requestId: a.requestId, source: "api" };
}

const versionStamp = (actorUserId: string) => ({
  version: sql<number>`version + 1`,
  updated_at: sql<Date>`now()`,
  updated_by: actorUserId,
});

async function closeReviewItems(
  tx: Tx,
  request: FastifyRequest,
  organizationId: string | null,
  versionId: string,
  status: "done" | "cancelled",
): Promise<void> {
  if (organizationId === null) return;
  await closeWorkItemsOfSubject(
    tx,
    actorOf(request),
    { organizationId, subjectType: "automation_rule_version", subjectId: versionId, kinds: [RULE_REVIEW_KIND] },
    status,
  );
}

// ------------------------------------------------------------------------------------------------ submit

async function submitVersion(tx: Tx, request: FastifyRequest, ruleId: string, versionNo: number) {
  const { rule, actor } = await loadRuleForWrite(tx, request, ruleId);
  const expected = requireIfMatch(request);
  const v = await loadVersion(tx, rule.id, versionNo, true);
  if (v.version !== expected) throw problems.versionConflict(v.version);
  if (v.status !== "draft") throw lifecycleRefusals.invalidTransition();
  if (!(await hasPassingDryRun(tx, v))) throw lifecycleRefusals.dryRunRequired();
  const updated = await tx
    .updateTable("automation_rule_version")
    .set({
      status: "in_review",
      submitted_at: sql<Date>`now()`,
      reviewed_by: null,
      reviewed_at: null,
      review_note: null,
      ...versionStamp(actor.userId),
    })
    .where("id", "=", v.id)
    .where("version", "=", v.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, auditContextOf(request), {
    action: "automation_rule_version.submit",
    recordType: "automation_rule_version",
    recordId: v.id,
    organizationId: rule.organization_id,
    transformationId: rule.transformation_id,
    priorVersion: v.version,
    newVersion: updated.version,
    changes: {
      status: { from: v.status, to: updated.status },
      reviewed_by: { from: v.reviewed_by, to: null },
      review_note: { from: v.review_note, to: null },
    },
  });
  // One review task per reviewer other than the author (the author can never review; SoD).
  const principal = await refreshPrincipal(tx, request);
  const org = ruleOrganization(rule, principal);
  if (org !== null) {
    const actorAudit = actorOf(request);
    for (const userId of await reviewersOf(tx, org)) {
      if (userId === v.authored_by) continue;
      await createWorkItemOnce(tx, actorAudit, {
        organizationId: org,
        transformationId: rule.transformation_id,
        kind: RULE_REVIEW_KIND,
        assigneeUserId: userId,
        subjectType: "automation_rule_version",
        subjectId: v.id,
        linkPath: `/admin/automation-rules/${rule.id}/versions/${v.version_no}`,
        messageKey: RULE_REVIEW_MESSAGE_KEY,
        messageParams: {
          ruleCode: rule.code,
          ruleName: rule.name_en,
          ruleNameAr: rule.name_ar,
          versionNo: v.version_no,
        },
        dueDate: null,
        dedupeKey: ruleReviewDedupeKey(v.id, userId),
      });
    }
  }
  return updated;
}

// ------------------------------------------------------------------------------------------------ review

const reviewDecision = z
  .strictObject({ outcome: z.enum(["approve", "request_changes"]), note: freeText(3, 2000).optional() })
  .superRefine((b, ctx) => {
    // Sending a version back without saying why helps nobody: request_changes needs its note.
    if (b.outcome === "request_changes" && b.note === undefined)
      ctx.addIssue({ code: "custom", path: ["note"], message: "validation.required" });
  });

/** Commit-time: `automation.review` held through a grant of the rule's organization (the caller's for a starter). */
async function reviewer(tx: Tx, request: FastifyRequest, ruleId: string) {
  const principal = await refreshPrincipal(tx, request);
  const rule = await tx
    .selectFrom("automation_rule")
    .selectAll()
    .where("id", "=", ruleId)
    .forUpdate()
    .executeTakeFirst();
  if (rule === undefined) throw problems.notFound();
  const org = ruleOrganization(rule, principal);
  principal.tracker.decisions += 1;
  const allowed =
    principal.userId !== null &&
    org !== null &&
    principal.grants.some((g) => g.permissions.has("automation.review") && g.organizationId === org);
  if (!allowed) {
    // A rule of an organization the caller cannot read is not disclosed (the loadRuleForRead rule).
    if (
      rule.origin !== "starter" &&
      !organizationsWith(principal, "automation.read").includes(rule.organization_id ?? "")
    )
      throw problems.notFound();
    const denied = problems.forbidden();
    throw org === null
      ? denied
      : denied.withDenial(
          denialOf("automation.review", {
            level: "organization",
            organizationId: org,
            businessUnitId: null,
            transformationId: null,
            businessUnitAncestry: [],
          }),
        );
  }
  return { rule, userId: principal.userId as string, organizationId: org };
}

async function decideReview(tx: Tx, request: FastifyRequest, ruleId: string, versionNo: number) {
  const { rule, userId, organizationId } = await reviewer(tx, request, ruleId);
  const body = parseBody(reviewDecision, request.body);
  const expected = requireIfMatch(request);
  const v = await loadVersion(tx, rule.id, versionNo, true);
  if (v.version !== expected) throw problems.versionConflict(v.version);
  if (v.status !== "in_review") throw lifecycleRefusals.invalidTransition();
  if (v.authored_by === userId) throw lifecycleRefusals.selfReview();
  const approve = body.outcome === "approve";
  const updated = await tx
    .updateTable("automation_rule_version")
    .set({
      status: approve ? "approved" : "draft",
      reviewed_by: userId,
      reviewed_at: sql<Date>`now()`,
      review_note: body.note ?? null,
      ...versionStamp(userId),
    })
    .where("id", "=", v.id)
    .where("version", "=", v.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, auditContextOf(request), {
    action: approve ? "automation_rule_version.review_approve" : "automation_rule_version.review_request_changes",
    recordType: "automation_rule_version",
    recordId: v.id,
    organizationId: rule.organization_id,
    transformationId: rule.transformation_id,
    priorVersion: v.version,
    newVersion: updated.version,
    ...(body.note !== undefined ? { reason: body.note } : {}),
    changes: {
      status: { from: v.status, to: updated.status },
      reviewed_by: { from: v.reviewed_by, to: userId },
      review_note: { from: v.review_note, to: updated.review_note },
    },
  });
  // The review is decided: every open review task of the version is done (whoever decided it).
  await closeReviewItems(tx, request, organizationId, v.id, "done");
  return updated;
}

// ------------------------------------------------------------------------------------------------ publish

async function publishVersion(tx: Tx, request: FastifyRequest, ruleId: string, versionNo: number) {
  const { rule, actor } = await loadRuleForWrite(tx, request, ruleId);
  const expected = requireIfMatch(request);
  // If-Match is the RULE's version: publishing changes the rule's effective version (OpenAPI).
  if (rule.version !== expected) throw problems.versionConflict(rule.version);
  const v = await loadVersion(tx, rule.id, versionNo, true);
  if (v.status === "draft") {
    if (!(await hasPassingDryRun(tx, v))) throw lifecycleRefusals.dryRunRequired();
    if (await reviewRequired(tx)) throw lifecycleRefusals.reviewRequired();
  } else if (v.status !== "approved") throw lifecycleRefusals.invalidTransition();
  const previous =
    rule.effective_version_id === null
      ? undefined
      : await tx
          .selectFrom("automation_rule_version")
          .selectAll()
          .where("id", "=", rule.effective_version_id)
          .forUpdate()
          .executeTakeFirst();
  const ctx = auditContextOf(request);
  // (1) the version -> published.
  const published = await tx
    .updateTable("automation_rule_version")
    .set({
      status: "published",
      published_by: actor.userId,
      published_at: sql<Date>`now()`,
      ...versionStamp(actor.userId),
    })
    .where("id", "=", v.id)
    .where("version", "=", v.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, ctx, {
    action: "automation_rule_version.publish",
    recordType: "automation_rule_version",
    recordId: v.id,
    organizationId: rule.organization_id,
    transformationId: rule.transformation_id,
    priorVersion: v.version,
    newVersion: published.version,
    changes: { status: { from: v.status, to: "published" }, published_by: { from: null, to: actor.userId } },
  });
  // (2) the rule row -> its effective version (always written: automation_rule_effective_check runs at COMMIT).
  const ruleAfter = await tx
    .updateTable("automation_rule")
    .set({ effective_version_id: v.id, ...versionStamp(actor.userId) })
    .where("id", "=", rule.id)
    .where("version", "=", rule.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, ctx, {
    action: "automation_rule.effective_version",
    recordType: "automation_rule",
    recordId: rule.id,
    organizationId: rule.organization_id,
    transformationId: rule.transformation_id,
    priorVersion: rule.version,
    newVersion: ruleAfter.version,
    changes: { effective_version_id: { from: rule.effective_version_id, to: v.id } },
  });
  // (3) the previous published version -> superseded.
  if (previous !== undefined && previous.status === "published") {
    const superseded = await tx
      .updateTable("automation_rule_version")
      .set({ status: "superseded", superseded_at: sql<Date>`now()`, ...versionStamp(actor.userId) })
      .where("id", "=", previous.id)
      .where("version", "=", previous.version)
      .returningAll()
      .executeTakeFirstOrThrow();
    await record(tx, ctx, {
      action: "automation_rule_version.supersede",
      recordType: "automation_rule_version",
      recordId: previous.id,
      organizationId: rule.organization_id,
      transformationId: rule.transformation_id,
      priorVersion: previous.version,
      newVersion: superseded.version,
      changes: { status: { from: "published", to: "superseded" } },
    });
  }
  await closeReviewItems(
    tx,
    request,
    rule.organization_id ?? (await refreshPrincipal(tx, request)).organizationId,
    v.id,
    "cancelled",
  );
  return published;
}

// ------------------------------------------------------------------------------------------------ discard

async function discardVersion(tx: Tx, request: FastifyRequest, ruleId: string, versionNo: number) {
  const { rule, actor } = await loadRuleForWrite(tx, request, ruleId);
  const expected = requireIfMatch(request);
  const v = await loadVersion(tx, rule.id, versionNo, true);
  if (v.version !== expected) throw problems.versionConflict(v.version);
  if (!(OPEN_STATUSES as readonly string[]).includes(v.status)) throw lifecycleRefusals.invalidTransition();
  const updated = await tx
    .updateTable("automation_rule_version")
    .set({ status: "discarded", discarded_at: sql<Date>`now()`, ...versionStamp(actor.userId) })
    .where("id", "=", v.id)
    .where("version", "=", v.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, auditContextOf(request), {
    action: "automation_rule_version.discard",
    recordType: "automation_rule_version",
    recordId: v.id,
    organizationId: rule.organization_id,
    transformationId: rule.transformation_id,
    priorVersion: v.version,
    newVersion: updated.version,
    changes: { status: { from: v.status, to: "discarded" } },
  });
  await closeReviewItems(
    tx,
    request,
    rule.organization_id ?? (await refreshPrincipal(tx, request)).organizationId,
    v.id,
    "cancelled",
  );
  return updated;
}

// ------------------------------------------------------------------------------------------------ routes

/** Registers this file's routes and returns them as "METHOD /path". */
export function registerAutomationLifecycleRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  const configure = { access: { permission: "automation.configure" as const } };
  const review = { access: { permission: "automation.review" as const } };
  const route =
    (fn: (tx: Tx, request: FastifyRequest, ruleId: string, versionNo: number) => Promise<AutomationRuleVersionRow>) =>
    async (request: FastifyRequest, reply: Parameters<typeof sendVersioned>[0]) => {
      const { ruleId, versionNo } = parse(versionParams, request.params, "params");
      const row = await db.transaction().execute((tx) => fn(tx, request, ruleId, versionNo));
      return sendVersioned(reply, 200, await toRuleVersion(db, row));
    };
  app.post(SUBMIT, { config: configure }, route(submitVersion));
  app.post(REVIEW, { config: { ...review, consumes: JSON_BODY } }, route(decideReview));
  app.post(PUBLISH, { config: configure }, route(publishVersion));
  app.post(DISCARD, { config: configure }, route(discardVersion));
  return [`POST ${SUBMIT}`, `POST ${REVIEW}`, `POST ${PUBLISH}`, `POST ${DISCARD}`];
}
