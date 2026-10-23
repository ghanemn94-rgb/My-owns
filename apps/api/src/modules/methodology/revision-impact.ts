// The "revision proposed" starter (REQ-S12-018, M0238; ADR-0039 §8, §9, §11; p5-work-split §A.3; T-DG5-BE-B2):
//   GET /admin/revision-proposals   listRevisionProposals   (methodology.read)
//
// When a methodology/configuration revision or a benefit formula revision is proposed, the starter records ONE
// append-only `revision_proposal` with the validation result, the impact (affected transformations, records and
// benefits) and the review routing, and creates `config_review` work items for the holders of the configured reviewer
// role. Exactly once (ADR-0039 §8, RV01): the proposal is inserted with ON CONFLICT ON CONSTRAINT
// revision_proposal_dedupe_key DO NOTHING on "<subject_type>:<subject_id>:<content_sha256>", work items use the dedupe
// key "config_review:<proposalId>:<userId>" (createWorkItemOnce), and a replay, which finds the proposal already
// recorded, creates nothing.
//
//  1. Methodology/configuration revision (`proposeConfigRevision`, called by BE-B3's submitConfigReview in its own
//     transaction): validation = the latest preview and compatibility runs for the draft's current hash; impact = the
//     affected records of ADR-0039 §5 (affected-records.ts), and no benefits (no Studio element type binds a benefit
//     formula: they keep their DG3/DG4 versioned records, §4), stated as such and never as a count of 0; routing = the
//     kind's review policy; tasks = one per active holder of the reviewer role in the organization, never the requester
//     nor an author of the draft (its creator or a recorded contributor; SoD, §5, D-170). `createConfigReviewTasks` then creates them, once the caller knows the subject
//     the reviewer acts on (its review request).
//  2. Formula revision (`proposeFormulaRevision`): the composition root (server.ts) wraps the DG4 material-change port
//     with `withRevisionProposals`, so `benefitFormulaVersionCreated` (DG3 createBenefitFormulaVersion, a new version)
//     also runs here, in the same transaction, AFTER the DG4 behaviour (the automatic change request is unchanged, and
//     the DG3 request and response are unchanged: this adds rows only). It validates the expression with
//     `validateFormula` (the formula engine is unchanged), lists the benefits bound to the formula and the business-case
//     lines using it as the impact, and creates `config_review` work items for the active holders of the
//     `benefit_formula` policy's reviewer role (FIN) in the transformation, except the editor: the people who record
//     the DG3 Finance validation.
//
// Neither case approves anything: a review task asks a person to review, and the DG3 Finance validation and the
// configuration review stay human decisions. Policies with `review_required = false` route no task (review_task_count
// 0; the proposal is still recorded). `methodology` imports no business module, so the work items are written through
// a port the composition root wires with tasks' createWorkItemOnce (`setReviewTaskWriter`, the material-change port
// pattern); unwired, a write fails closed.
import { createHash } from "node:crypto";
import { sql, type AuditActor, type DbOrTx, type Tx } from "@mth/db";
import { validateFormula, type FormulaVariable } from "@mth/shared/calc";
import { revisionProposalListQuery, type RevisionProposal, type RevisionSubjectType } from "@mth/shared/schemas";
import type { FastifyInstance } from "fastify";
import type { Selectable } from "kysely";
import type { RevisionProposalTable } from "@mth/db";
import { v7 as uuidv7 } from "uuid";
import { grantApplies, loadGrants, principalOf, scopeFilter, targetFor, type ResolvedTarget } from "../access/index.ts";
import { record, type AuditContext } from "../audit/index.ts";
import {
  cursorSchema,
  decodeCursor,
  filterHash,
  iso,
  limitSchema,
  paginate,
  parseQuery,
  problems,
  type BenefitFormulaVersionChange,
  type MaterialChangePort,
  type ModuleDeps,
} from "../platform/index.ts";
import { affectedRecords } from "./affected-records.ts";
import { canonicalContentJson } from "./content-hash.ts";
import { configAuthors } from "./contributors.ts";
import { requireStudioPermission, type MethodologyVersionRow } from "./drafts.ts";
import { recordRequestExecution, REQUEST_STARTERS } from "../platform/index.ts";

export const REVISION_PROPOSALS = "/api/v1/admin/revision-proposals";
/** The work-item kind of every S12-018 review task (0063; My Work section "Reviews"). */
export const CONFIG_REVIEW_KIND = "config_review";
/** The i18n message keys of the review tasks (rendered at render time; S-6). */
export const REVIEW_TASK_MESSAGES = Object.freeze({
  formula: "methodology.task.formula_revision_review",
  config: "methodology.task.config_revision_review",
});
const FORMULA_POLICY_KIND = "benefit_formula";

type ProposalRow = Selectable<RevisionProposalTable>;

// ------------------------------------------------------------------------------------------------ the task port

/** A My Work item to create once (the shape of tasks' WorkItemInput, which methodology cannot import). */
export interface ReviewTaskInput {
  readonly organizationId: string;
  readonly transformationId: string | null;
  readonly kind: string;
  readonly assigneeUserId: string;
  readonly subjectType: string;
  readonly subjectId: string;
  readonly linkPath: string;
  readonly messageKey: string;
  readonly messageParams: Readonly<Record<string, string | number | boolean | null>>;
  readonly dueDate: null;
  readonly dedupeKey: string;
}

/** tasks' createWorkItemOnce, as wired by the composition root. */
export type ReviewTaskWriter = (
  tx: Tx,
  actor: AuditActor,
  input: ReviewTaskInput,
) => Promise<{ readonly outcome: "created" | "existing"; readonly workItemId: string }>;

let taskWriter: ReviewTaskWriter | null = null;

/** The composition root wires tasks' createWorkItemOnce (registration time); null unwires it (tests). */
export function setReviewTaskWriter(next: ReviewTaskWriter | null): void {
  taskWriter = next;
}

function writer(): ReviewTaskWriter {
  if (taskWriter === null) throw problems.internal();
  return taskWriter;
}

// ------------------------------------------------------------------------------------------------ routing

/** The review policy of a kind; a missing row reads as "review required" by TO (FIN for formulas), as 0062 does. */
async function reviewPolicy(db: DbOrTx, kind: string): Promise<{ required: boolean; roleCode: string }> {
  const row = await db
    .selectFrom("config_review_policy")
    .select(["review_required", "reviewer_role_code"])
    .where("config_kind", "=", kind)
    .executeTakeFirst();
  return row === undefined
    ? { required: true, roleCode: kind === FORMULA_POLICY_KIND ? "FIN" : "TO" }
    : { required: row.review_required, roleCode: row.reviewer_role_code };
}

/**
 * The active users holding `roleCode` at `target` (an organization: any effective assignment of the role in it; a
 * transformation: an assignment whose scope covers it, by the ADR-0006 rules), except `excluded`. Sorted, so the task
 * set is deterministic. May be empty: the proposal is still recorded with review_task_count 0.
 */
export async function reviewerHolders(
  db: DbOrTx,
  roleCode: string,
  target: ResolvedTarget,
  excluded: readonly (string | null)[],
): Promise<string[]> {
  const candidates = await db
    .selectFrom("scoped_assignment as a")
    .innerJoin("role as r", "r.id", "a.role_id")
    .innerJoin("app_user as u", "u.id", "a.user_id")
    .select("a.user_id")
    .distinct()
    .where("r.code", "=", roleCode)
    .where("a.organization_id", "=", target.organizationId)
    .where("a.revoked_at", "is", null)
    .where("u.status", "=", "active")
    .execute();
  const out: string[] = [];
  for (const userId of candidates.map((c) => c.user_id).sort()) {
    if (excluded.includes(userId)) continue;
    const grants = (await loadGrants(db, userId)).filter((g) => g.roleCode === roleCode);
    const covers = grants.some((g) =>
      target.level === "organization"
        ? g.organizationId === target.organizationId
        : [...g.permissions].some((p) => grantApplies(g, p, target)),
    );
    if (covers) out.push(userId);
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ the record

interface ProposalInput {
  readonly organizationId: string;
  readonly transformationId: string | null;
  readonly subjectType: RevisionSubjectType;
  readonly subjectId: string;
  readonly subjectVersion: number;
  readonly contentSha256: string;
  readonly validationResult: "pass" | "fail";
  readonly validationReport: Record<string, unknown>;
  readonly impact: Record<string, unknown>;
  readonly reviewerRoleCode: string;
  readonly reviewTaskCount: number;
  readonly createdBy: string | null;
}

export const proposalDedupeKey = (subjectType: string, subjectId: string, contentSha256: string) =>
  `${subjectType}:${subjectId}:${contentSha256}`;

/** Inserts the proposal once (RV01) with its audit event; `created` is false on a replay (nothing is written). */
async function insertProposalOnce(
  tx: Tx,
  audit: AuditContext,
  p: ProposalInput,
): Promise<{ readonly row: ProposalRow; readonly created: boolean }> {
  const dedupeKey = proposalDedupeKey(p.subjectType, p.subjectId, p.contentSha256);
  const id = uuidv7();
  const inserted = await tx
    .insertInto("revision_proposal")
    .values({
      id,
      organization_id: p.organizationId,
      transformation_id: p.transformationId,
      subject_type: p.subjectType,
      subject_id: p.subjectId,
      subject_version: p.subjectVersion,
      content_sha256: p.contentSha256,
      validation_result: p.validationResult,
      validation_report: JSON.stringify(p.validationReport),
      impact: JSON.stringify(p.impact),
      reviewer_role_code: p.reviewerRoleCode,
      review_task_count: p.reviewTaskCount,
      dedupe_key: dedupeKey,
      created_by: p.createdBy,
    })
    .onConflict((oc) => oc.constraint("revision_proposal_dedupe_key").doNothing())
    .returningAll()
    .executeTakeFirst();
  if (inserted === undefined) {
    const existing = await tx
      .selectFrom("revision_proposal")
      .selectAll()
      .where("dedupe_key", "=", dedupeKey)
      .executeTakeFirstOrThrow();
    return { row: existing, created: false };
  }
  await record(tx, audit, {
    action: "revision_proposal.create",
    recordType: "revision_proposal",
    recordId: id,
    organizationId: p.organizationId,
    transformationId: p.transformationId,
    newVersion: 1,
    changes: {
      subject_type: { from: null, to: p.subjectType },
      subject_id: { from: null, to: p.subjectId },
      subject_version: { from: null, to: p.subjectVersion },
      content_sha256: { from: null, to: p.contentSha256 },
      validation_result: { from: null, to: p.validationResult },
      reviewer_role_code: { from: null, to: p.reviewerRoleCode },
      review_task_count: { from: null, to: p.reviewTaskCount },
    },
  });
  // T-DG5-BE-J (ADR-0044 §1, starter 15): the committed proposal is one execution of its starter rule.
  await recordRequestExecution(tx, REQUEST_STARTERS.revisionProposed, id, {
    organizationId: p.organizationId,
    transformationId: p.transformationId,
    audit,
  });
  return { row: inserted, created: true };
}

const userActor = (audit: AuditContext): AuditActor => ({
  actorType: "user",
  actorUserId: audit.actorUserId,
  requestId: audit.requestId,
  source: "api",
});

/** One `config_review` work item per reviewer, each once ("config_review:<proposalId>:<userId>"). */
export async function createConfigReviewTasks(
  tx: Tx,
  audit: AuditContext,
  proposal: Pick<ProposalRow, "id" | "organization_id" | "transformation_id">,
  reviewerUserIds: readonly string[],
  task: {
    readonly subjectType: string;
    readonly subjectId: string;
    readonly linkPath: string;
    readonly messageKey: string;
    readonly messageParams: Readonly<Record<string, string | number | boolean | null>>;
  },
): Promise<void> {
  const write = writer();
  for (const userId of reviewerUserIds)
    await write(tx, userActor(audit), {
      organizationId: proposal.organization_id,
      transformationId: proposal.transformation_id,
      kind: CONFIG_REVIEW_KIND,
      assigneeUserId: userId,
      subjectType: task.subjectType,
      subjectId: task.subjectId,
      linkPath: task.linkPath,
      messageKey: task.messageKey,
      messageParams: task.messageParams,
      dueDate: null,
      dedupeKey: `config_review:${proposal.id}:${userId}`,
    });
}

// ------------------------------------------------------------------------------------------------ case 1

/**
 * ADR-0039 §8 case 1, in the caller's (submitConfigReview's) transaction: records the proposal of the draft's current
 * content and returns it with the reviewers to task (empty on a replay: the first call routed them). The caller creates
 * the tasks with `createConfigReviewTasks` once its review request exists.
 */
export async function proposeConfigRevision(
  tx: Tx,
  audit: AuditContext,
  input: { readonly version: MethodologyVersionRow; readonly organizationId: string; readonly requestedBy: string },
): Promise<{ readonly proposal: ProposalRow; readonly created: boolean; readonly reviewerUserIds: readonly string[] }> {
  const { version } = input;
  const runs = await tx
    .selectFrom("config_check_run")
    .select(["id", "check_kind", "result", "created_at"])
    .where("methodology_version_id", "=", version.id)
    .where("content_sha256", "=", version.content_sha256)
    .where("check_kind", "in", ["preview", "compatibility"])
    .orderBy("id", "desc")
    .execute();
  const latest = (kind: string) => runs.find((r) => r.check_kind === kind) ?? null;
  const preview = latest("preview");
  const compatibility = latest("compatibility");
  const valid = preview?.result === "pass" && (compatibility?.result === "pass" || compatibility?.result === "warn");
  const affected = await affectedRecords(tx, version, input.organizationId);
  const policy = await reviewPolicy(tx, version.config_kind);
  const target = await targetFor(tx, "organization", { organizationId: input.organizationId });
  const reviewers = policy.required
    ? await reviewerHolders(tx, policy.roleCode, target, [input.requestedBy, ...(await configAuthors(tx, version))])
    : [];
  const { row, created } = await insertProposalOnce(tx, audit, {
    organizationId: input.organizationId,
    transformationId: null,
    subjectType: "methodology_version",
    subjectId: version.id,
    subjectVersion: version.version_no,
    contentSha256: version.content_sha256,
    validationResult: valid ? "pass" : "fail",
    validationReport: {
      preview: preview === null ? null : { checkRunId: preview.id, result: preview.result },
      compatibility: compatibility === null ? null : { checkRunId: compatibility.id, result: compatibility.result },
    },
    impact: {
      affectedTransformations: affected.transformations.map((t) => ({
        transformationId: t.transformationId,
        code: t.code,
        pinnedVersionId: t.pinnedVersionId,
      })),
      affectedRecords: affected.transformations,
      // No Studio element type binds a benefit formula (ADR-0039 §4): not applicable, never "0 benefits".
      affectedBenefits: [],
      affectedBenefitsBasis: "not_applicable",
    },
    reviewerRoleCode: policy.roleCode,
    reviewTaskCount: reviewers.length,
    createdBy: input.requestedBy,
  });
  return { proposal: row, created, reviewerUserIds: created ? reviewers : [] };
}

// ------------------------------------------------------------------------------------------------ case 2

/** SHA-256 (hex) of the canonical JSON of a formula version's content: its expression and typed variables. */
function formulaContentSha256(expression: string, variables: readonly FormulaVariable[]): string {
  return createHash("sha256").update(canonicalContentJson({ expression, variables }), "utf8").digest("hex");
}

/**
 * ADR-0039 §8 case 2, in the DG3 createBenefitFormulaVersion transaction: validation, impact (the benefits bound to
 * the formula, the business-case lines using it) and the FIN review tasks of one formula revision, exactly once.
 */
export async function proposeFormulaRevision(tx: Tx, change: BenefitFormulaVersionChange): Promise<void> {
  const audit: AuditContext = { actorUserId: change.editorUserId, requestId: change.requestId };
  const [formula, version, variableRows, transformation] = await Promise.all([
    tx
      .selectFrom("benefit_formula")
      .select(["id", "code"])
      .where("id", "=", change.benefitFormulaId)
      .executeTakeFirstOrThrow(),
    tx
      .selectFrom("benefit_formula_version")
      .select(["id", "version_no", "expression"])
      .where("id", "=", change.benefitFormulaVersionId)
      .executeTakeFirstOrThrow(),
    tx
      .selectFrom("benefit_formula_variable")
      .select(["name", "kind", "unit", "currency", "period", "value", "source", "description"])
      .where("formula_version_id", "=", change.benefitFormulaVersionId)
      .orderBy("ordinal")
      .execute(),
    tx
      .selectFrom("transformation")
      .select(["id", "code", "business_unit_id"])
      .where("id", "=", change.transformationId)
      .executeTakeFirstOrThrow(),
  ]);
  const variables: FormulaVariable[] = variableRows.map((v) => ({
    name: v.name,
    kind: v.kind as FormulaVariable["kind"],
    period: v.period as FormulaVariable["period"],
    unit: v.unit,
    currency: v.currency,
    value: v.value,
    source: v.source,
    description: v.description,
  }));
  const checked = validateFormula(version.expression, variables);
  const [benefits, lines] = await Promise.all([
    tx
      .selectFrom("benefit")
      .select(["id", "code"])
      .where("transformation_id", "=", change.transformationId)
      .where("benefit_formula_id", "=", change.benefitFormulaId)
      .orderBy("code")
      .orderBy("id")
      .execute(),
    tx
      .selectFrom("business_case_line")
      .select(sql<string>`count(*)`.as("n"))
      .where("benefit_formula_id", "=", change.benefitFormulaId)
      .executeTakeFirstOrThrow(),
  ]);
  const policy = await reviewPolicy(tx, FORMULA_POLICY_KIND);
  const target = await targetFor(tx, "transformation", {
    organizationId: change.organizationId,
    businessUnitId: transformation.business_unit_id,
    transformationId: change.transformationId,
  });
  const reviewers = policy.required ? await reviewerHolders(tx, policy.roleCode, target, [change.editorUserId]) : [];
  const { row, created } = await insertProposalOnce(tx, audit, {
    organizationId: change.organizationId,
    transformationId: change.transformationId,
    subjectType: "benefit_formula_version",
    subjectId: change.benefitFormulaVersionId,
    subjectVersion: version.version_no,
    contentSha256: formulaContentSha256(version.expression, variables),
    validationResult: checked.ok ? "pass" : "fail",
    validationReport: checked.ok
      ? { engineVersion: checked.engineVersion, resultType: checked.resultType, errors: [] }
      : { engineVersion: checked.engineVersion, errors: checked.errors },
    impact: {
      formula: {
        benefitFormulaId: formula.id,
        code: formula.code,
        fromVersionNo: version.version_no - 1,
        toVersionNo: version.version_no,
      },
      affectedTransformations: [{ transformationId: transformation.id, code: transformation.code }],
      affectedRecords: [
        { recordType: "benefit", count: benefits.length },
        { recordType: "business_case_line", count: Number(lines.n) },
      ],
      affectedBenefits: benefits.map((b) => ({ benefitId: b.id, code: b.code })),
    },
    reviewerRoleCode: policy.roleCode,
    reviewTaskCount: reviewers.length,
    createdBy: change.editorUserId,
  });
  if (!created) return; // a replay: the first call recorded and routed it
  await createConfigReviewTasks(tx, audit, row, reviewers, {
    subjectType: "benefit_formula_version",
    subjectId: change.benefitFormulaVersionId,
    linkPath: `/transformations/${change.transformationId}/benefit-formulas/${change.benefitFormulaId}`,
    messageKey: REVIEW_TASK_MESSAGES.formula,
    messageParams: { formulaCode: formula.code, versionNo: version.version_no, benefitCount: benefits.length },
  });
}

/**
 * The composition root's wrapper of the DG4 material-change port (ADR-0039 §8 case 2): the DG4 behaviour runs first and
 * unchanged, then the S12-018 proposal in the same transaction. Every other member is the DG4 port's own.
 */
export function withRevisionProposals(base: MaterialChangePort): MaterialChangePort {
  return {
    ...base,
    benefitFormulaVersionCreated: async (tx, change) => {
      await base.benefitFormulaVersionCreated(tx, change);
      await proposeFormulaRevision(tx, change);
    },
  };
}

// ------------------------------------------------------------------------------------------------ the list

export function toRevisionProposal(r: ProposalRow): RevisionProposal {
  return {
    id: r.id,
    transformationId: r.transformation_id,
    subjectType: r.subject_type as RevisionSubjectType,
    subjectId: r.subject_id,
    subjectVersion: r.subject_version,
    contentSha256: r.content_sha256,
    validationResult: r.validation_result as RevisionProposal["validationResult"],
    validationReport: r.validation_report as Record<string, unknown>,
    impact: r.impact as Record<string, unknown>,
    reviewerRoleCode: r.reviewer_role_code,
    reviewTaskCount: r.review_task_count,
    createdAt: iso(r.created_at),
  };
}

const listQuery = revisionProposalListQuery.extend({ cursor: cursorSchema, limit: limitSchema });

export function registerRevisionProposalRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  app.get(REVISION_PROPOSALS, { config: { access: { permission: "methodology.read" } } }, async (request) => {
    const query = parseQuery(listQuery, request.query);
    const principal = principalOf(request);
    const actor = requireStudioPermission(principal, "methodology.read");
    const hash = filterHash({ subjectType: query.subjectType, subjectId: query.subjectId });
    const after = decodeCursor(query.cursor, hash, 1);
    // Proposals of the caller's organization. A formula revision is transformation data (its benefits): it is listed
    // only where the caller may also read that transformation (ADR-0006 scope filter, in the database).
    let q = db
      .selectFrom("revision_proposal as p")
      .leftJoin("transformation as t", "t.id", "p.transformation_id")
      .selectAll("p")
      .where("p.organization_id", "=", actor.organizationId)
      .where((eb) =>
        eb.or([
          eb("p.transformation_id", "is", null),
          scopeFilter(principal, "transformation.read", {
            level: "transformation",
            organizationId: sql<string>`t.organization_id`,
            businessUnitId: sql<string | null>`t.business_unit_id`,
            transformationId: sql<string | null>`t.id`,
          }),
        ]),
      );
    if (query.subjectType !== undefined) q = q.where("p.subject_type", "=", query.subjectType);
    if (query.subjectId !== undefined) q = q.where("p.subject_id", "=", query.subjectId);
    // Newest first: ids are UUIDv7 (time-ordered).
    if (after) q = q.where("p.id", "<", String(after[0]));
    const rows = await q
      .orderBy("p.id", "desc")
      .limit(query.limit + 1)
      .execute();
    const pageRows = paginate(rows, query.limit, (r) => [r.id], hash);
    return { items: pageRows.items.map(toRevisionProposal), nextCursor: pageRows.nextCursor };
  });

  return [`GET ${REVISION_PROPOSALS}`];
}
