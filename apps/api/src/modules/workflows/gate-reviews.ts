// Per-criterion gate review and Under Review (T-DG4-BE-K2; ADR-0035 §3, §8, §11; REQ-S04-009, REQ-S04-010;
// p4-work-split §H H.2):
//   GET  .../gates/{gateCode}/submissions/{submissionNo}/criteria                          the criteria review table
//   GET  .../gates/{gateCode}/submissions/{submissionNo}/criteria/{criterionKey}/reviews   every review, oldest first
//   POST .../gates/{gateCode}/submissions/{submissionNo}/criteria/{criterionKey}/reviews   record one (gate.review)
//
// Each criterion row shows the nine M0124 fields: criterion (label), required evidence (description), completeness
// (frozen at submission), and the reviewer, finding, open condition, risk, decision (the reviewer's recommendation) and
// rationale of the LATEST review; with no review those six are null ("not reviewed"), never "meets". The row also shows
// the exception recorded on it at submission (ADR-0035 §4), with its coverage today.
//
// The first review of a submitted gate moves it to under_review in the same transaction, with its audit event (the one
// new edge of the ADR-0035 §3 table). A review is a reviewer's finding and recommendation, not the gate's business
// decision: only the configured approver decides (DG2 POST .../decision), and the submitter never reviews (403; the
// 0051 trigger refuses it too). Nothing here reads or writes the engineering delivery gates DG0-DG7.
import type { DbOrTx, GateCriterionReviewRow, GateExceptionRow, Tx } from "@mth/db";
import { PROBLEM_TYPES } from "@mth/shared";
import {
  gateCriterionReviewCreate,
  type GateCriterionReview,
  type GateCriterionRow,
  type GateCriterionRowList,
} from "@mth/shared/schemas";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { denialOf, principalOf, requireTransformationRead } from "../access/index.ts";
import { record } from "../audit/index.ts";
import {
  cursorSchema,
  decodeCursor,
  filterHash,
  HttpProblem,
  iso,
  limitSchema,
  paginate,
  parse,
  parseBody,
  parseQuery,
  problems,
  requireIfMatch,
  type ModuleDeps,
} from "../platform/index.ts";
import { assertSameTransformation, bumpStamps, openWrite } from "../transformations/index.ts";
import { exceptionBusinessDate, toGateException } from "./gate-exceptions.ts";

const G = "/api/v1/transformations/:transformationId/gates/:gateCode/submissions/:submissionNo/criteria";
export const GATE_CRITERIA = G;
export const GATE_CRITERION_REVIEWS = `${G}/:criterionKey/reviews`;
const JSON_BODY = ["application/json"] as const;

const sParams = z.strictObject({
  transformationId: z.uuid(),
  gateCode: z.enum(["G1", "G2", "G3", "G4", "G5", "G6"]),
  submissionNo: z.coerce.number().int().min(1),
});
const cParams = sParams.extend({ criterionKey: z.string().regex(/^g[1-6]\.[a-z_]{1,48}$/) });

// ------------------------------------------------------------------------------------------------ refusals (ADR-0035 §11)

export const gateReviewRefusals = {
  notOpen: () =>
    problems.businessRule("gate.review_not_open", "Only a submitted or under-review gate submission can be reviewed."),
  reviewerIsSubmitter: () =>
    new HttpProblem({
      status: 403,
      type: PROBLEM_TYPES.forbidden,
      code: "gate.reviewer_is_submitter",
      title: "Forbidden",
      detail: "The submitter cannot review their own gate submission.",
    }),
  conditionRequired: () =>
    new HttpProblem({
      status: 422,
      type: PROBLEM_TYPES.validation,
      code: "gate.review_condition_required",
      title: "Business rule violated",
      detail: "An open condition is required when the criterion meets with conditions.",
      errors: [
        {
          pointer: "/openCondition",
          code: "gate.review_condition_required",
          message: "An open condition is required when the criterion meets with conditions.",
        },
      ],
    }),
} as const;

// ------------------------------------------------------------------------------------------------ shapes

export const toGateCriterionReview = (r: GateCriterionReviewRow): GateCriterionReview => ({
  id: r.id,
  gateSubmissionId: r.gate_submission_id,
  criterionKey: r.criterion_key,
  reviewNo: r.review_no,
  reviewerUserId: r.reviewer_user_id,
  finding: r.finding,
  openCondition: r.open_condition,
  riskNote: r.risk_note,
  raidEntryId: r.raid_entry_id,
  recommendation: r.recommendation as GateCriterionReview["recommendation"],
  rationale: r.rationale,
  reviewedAt: iso(r.reviewed_at),
});

/** The gate instance and one of its submissions by number (404 when either is missing). */
async function submissionOf(db: DbOrTx, transformationId: string, gateCode: string, submissionNo: number) {
  const instance = await db
    .selectFrom("gate_instance")
    .selectAll()
    .where("transformation_id", "=", transformationId)
    .where("gate_code", "=", gateCode)
    .executeTakeFirst();
  if (!instance) throw problems.notFound();
  const submission = await db
    .selectFrom("gate_submission")
    .selectAll()
    .where("gate_instance_id", "=", instance.id)
    .where("submission_no", "=", submissionNo)
    .executeTakeFirst();
  if (!submission) throw problems.notFound();
  return { instance, submission };
}

/**
 * listGateSubmissionCriteria: one row per frozen criterion of the submission, in ordinal order, with the nine fields
 * (the six review fields from the latest review, null when none) and the exception recorded at submission.
 */
export async function listGateSubmissionCriteria(
  db: DbOrTx,
  transformationId: string,
  gateCode: string,
  submissionNo: number,
): Promise<GateCriterionRowList> {
  const { instance, submission } = await submissionOf(db, transformationId, gateCode, submissionNo);
  const criteria = await db
    .selectFrom("gate_submission_criterion as s")
    .innerJoin("gate_criterion_definition as d", "d.key", "s.criterion_key")
    .select([
      "s.criterion_key",
      "s.ordinal",
      "s.mandatory",
      "s.completeness",
      "s.gate_exception_id",
      "d.label_en",
      "d.label_ar",
      "d.description_en",
      "d.description_ar",
    ])
    .where("s.gate_submission_id", "=", submission.id)
    .orderBy("s.ordinal")
    .execute();
  const reviews = await db
    .selectFrom("gate_criterion_review")
    .selectAll()
    .where("gate_submission_id", "=", submission.id)
    .orderBy("criterion_key")
    .orderBy("review_no")
    .execute();
  const exceptionIds = criteria.map((c) => c.gate_exception_id).filter((x): x is string => x !== null);
  const exceptions: GateExceptionRow[] =
    exceptionIds.length === 0
      ? []
      : await db.selectFrom("gate_exception").selectAll().where("id", "in", exceptionIds).execute();
  const today = exceptions.length === 0 ? "" : await exceptionBusinessDate(db, transformationId);
  const items: GateCriterionRow[] = criteria.map((c) => {
    const mine = reviews.filter((r) => r.criterion_key === c.criterion_key);
    const latest = mine.at(-1);
    const exception = exceptions.find((e) => e.id === c.gate_exception_id);
    return {
      criterionKey: c.criterion_key,
      ordinal: c.ordinal,
      mandatory: c.mandatory,
      criterionLabelEn: c.label_en,
      criterionLabelAr: c.label_ar,
      requiredEvidenceEn: c.description_en,
      requiredEvidenceAr: c.description_ar,
      completeness: c.completeness as GateCriterionRow["completeness"],
      reviewerUserId: latest?.reviewer_user_id ?? null,
      finding: latest?.finding ?? null,
      openCondition: latest?.open_condition ?? null,
      risk: latest ? { note: latest.risk_note, raidEntryId: latest.raid_entry_id } : null,
      decision: (latest?.recommendation ?? null) as GateCriterionRow["decision"],
      rationale: latest?.rationale ?? null,
      reviewCount: mine.length,
      exception: exception ? toGateException(exception, today) : null,
    };
  });
  return {
    gateCode,
    submissionNo,
    snapshotSha256: submission.snapshot_sha256,
    gateStatus: instance.status as GateCriterionRowList["gateStatus"],
    items,
  };
}

/** Every review of one criterion of the submission (404 when the criterion is not in it), oldest first. */
export async function listGateCriterionReviews(
  db: DbOrTx,
  params: z.infer<typeof cParams>,
  query: { cursor?: string | undefined; limit: number },
): Promise<{ items: GateCriterionReview[]; nextCursor: string | null }> {
  const { submission } = await submissionOf(db, params.transformationId, params.gateCode, params.submissionNo);
  const criterion = await db
    .selectFrom("gate_submission_criterion")
    .select("id")
    .where("gate_submission_id", "=", submission.id)
    .where("criterion_key", "=", params.criterionKey)
    .executeTakeFirst();
  if (!criterion) throw problems.notFound();
  const hash = filterHash({ table: "gate_criterion_review", submission: submission.id, key: params.criterionKey });
  const after = decodeCursor(query.cursor, hash, 1);
  let q = db
    .selectFrom("gate_criterion_review")
    .selectAll()
    .where("gate_submission_id", "=", submission.id)
    .where("criterion_key", "=", params.criterionKey);
  if (after) q = q.where("review_no", ">", Number(after[0]));
  const rows = await q
    .orderBy("review_no")
    .limit(query.limit + 1)
    .execute();
  const page = paginate(rows, query.limit, (r) => [r.review_no], hash);
  return { items: page.items.map(toGateCriterionReview), nextCursor: page.nextCursor };
}

/**
 * createGateCriterionReview (gate.review; SP, BO, FIN, TO): authorised again at commit time; If-Match = the gate
 * instance's version (428/409); only the current PENDING submission of a submitted or under-review gate (422
 * gate.review_not_open); never the submitter (403 gate.reviewer_is_submitter); an open condition with
 * meets_with_conditions (422); a linked risk of the same transformation. Inserts review N+1 with its audit event; the
 * first review of a `submitted` gate moves it to `under_review` (version + 1, audit gate_instance.review_open).
 */
export async function createGateCriterionReview(
  tx: Tx,
  request: FastifyRequest,
  params: z.infer<typeof cParams>,
): Promise<GateCriterionReview> {
  const { transformationId, gateCode, submissionNo, criterionKey } = params;
  const ctx = await openWrite(tx, request, transformationId, [{ permission: "gate.review" }], null, {
    atCommit: true,
  });
  const body = parseBody(gateCriterionReviewCreate, request.body);
  if (body.recommendation === "meets_with_conditions" && body.openCondition === undefined)
    throw gateReviewRefusals.conditionRequired();
  const expected = requireIfMatch(request);
  const instance = await tx
    .selectFrom("gate_instance")
    .selectAll()
    .where("transformation_id", "=", transformationId)
    .where("gate_code", "=", gateCode)
    .forUpdate()
    .executeTakeFirst();
  if (!instance) throw problems.notFound();
  if (instance.version !== expected) throw problems.versionConflict(instance.version);
  const submission = await tx
    .selectFrom("gate_submission")
    .selectAll()
    .where("gate_instance_id", "=", instance.id)
    .where("submission_no", "=", submissionNo)
    .executeTakeFirst();
  if (!submission) throw problems.notFound();
  const criterion = await tx
    .selectFrom("gate_submission_criterion")
    .select("id")
    .where("gate_submission_id", "=", submission.id)
    .where("criterion_key", "=", criterionKey)
    .executeTakeFirst();
  if (!criterion) throw problems.notFound();
  if (
    submission.status !== "pending" ||
    instance.current_submission_id !== submission.id ||
    (instance.status !== "submitted" && instance.status !== "under_review")
  )
    throw gateReviewRefusals.notOpen();
  if (submission.submitted_by === ctx.userId)
    throw gateReviewRefusals.reviewerIsSubmitter().withDenial(denialOf("gate.review", ctx.target));
  await assertSameTransformation(tx, "raid_entry", transformationId, body.raidEntryId, "/raidEntryId");
  const last = await tx
    .selectFrom("gate_criterion_review")
    .select((eb) => eb.fn.max<number>("review_no").as("n"))
    .where("gate_submission_id", "=", submission.id)
    .where("criterion_key", "=", criterionKey)
    .executeTakeFirst();
  const reviewNo = Number(last?.n ?? 0) + 1;
  const id = uuidv7();
  const row = await tx
    .insertInto("gate_criterion_review")
    .values({
      id,
      organization_id: ctx.organizationId,
      transformation_id: transformationId,
      gate_submission_id: submission.id,
      criterion_key: criterionKey,
      review_no: reviewNo,
      reviewer_user_id: ctx.userId,
      finding: body.finding,
      open_condition: body.openCondition ?? null,
      risk_note: body.riskNote ?? null,
      raid_entry_id: body.raidEntryId ?? null,
      recommendation: body.recommendation,
      rationale: body.rationale,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: "gate_criterion_review.create",
    recordType: "gate_criterion_review",
    recordId: id,
    organizationId: ctx.organizationId,
    transformationId,
    newVersion: 1,
    reason: body.rationale,
    changes: {
      gateCode: { from: null, to: gateCode },
      submissionNo: { from: null, to: submissionNo },
      criterionKey: { from: null, to: criterionKey },
      reviewNo: { from: null, to: reviewNo },
      recommendation: { from: null, to: body.recommendation },
      openCondition: { from: null, to: body.openCondition ?? null },
      raidEntryId: { from: null, to: body.raidEntryId ?? null },
    },
  });
  // REQ-S04-010 "review opened -> Under Review": the first review of a submitted gate, in this transaction.
  if (instance.status === "submitted") {
    const updated = await tx
      .updateTable("gate_instance")
      .set({ status: "under_review", ...bumpStamps(ctx.userId) })
      .where("id", "=", instance.id)
      .where("version", "=", instance.version)
      .returning("version")
      .executeTakeFirstOrThrow();
    await record(tx, ctx.audit, {
      action: "gate_instance.review_open",
      recordType: "gate_instance",
      recordId: instance.id,
      organizationId: ctx.organizationId,
      transformationId,
      priorVersion: instance.version,
      newVersion: updated.version,
      changes: { status: { from: "submitted", to: "under_review" } },
    });
  }
  return toGateCriterionReview(row);
}

// ------------------------------------------------------------------------------------------------ routes

const pageQuery = z.strictObject({ cursor: cursorSchema, limit: limitSchema });

/** Registers this file's routes and returns them as "METHOD /path". */
export function registerGateReviewRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  const read = { access: { permission: "transformation.read" as const } };

  app.get(GATE_CRITERIA, { config: read }, async (request) => {
    const { transformationId, gateCode, submissionNo } = parse(sParams, request.params, "params");
    await requireTransformationRead(db, principalOf(request), transformationId);
    return listGateSubmissionCriteria(db, transformationId, gateCode, submissionNo);
  });

  app.get(GATE_CRITERION_REVIEWS, { config: read }, async (request) => {
    const params = parse(cParams, request.params, "params");
    const query = parseQuery(pageQuery, request.query);
    await requireTransformationRead(db, principalOf(request), params.transformationId);
    return listGateCriterionReviews(db, params, query);
  });

  app.post(
    GATE_CRITERION_REVIEWS,
    { config: { access: { permission: "gate.review" }, consumes: JSON_BODY } },
    async (request, reply) => {
      const params = parse(cParams, request.params, "params");
      const body = await db.transaction().execute((tx) => createGateCriterionReview(tx, request, params));
      reply.header(
        "Location",
        `/api/v1/transformations/${params.transformationId}/gates/${params.gateCode}/submissions/${params.submissionNo}/criteria/${params.criterionKey}/reviews`,
      );
      return reply.code(201).send(body);
    },
  );

  return [`GET ${GATE_CRITERIA}`, `GET ${GATE_CRITERION_REVIEWS}`, `POST ${GATE_CRITERION_REVIEWS}`];
}
