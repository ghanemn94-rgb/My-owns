// Health-check assessments, the HealthAssessment entity (P5 slice H; ADR-0048 §5, §7-§11; REQ-PB-091, REQ-PB-092,
// REQ-S14-001..003, REQ-S16-021; p5-work-split §H.4; T-DG5-KBE-G2):
//   GET   /transformations/{t}/health-checks                               listHealthChecks      (transformation.read)
//   POST  /transformations/{t}/health-checks                               createHealthCheck     (health_check.assess)
//   GET   /transformations/{t}/health-checks/{a}                           getHealthCheck        (transformation.read)
//   PATCH /transformations/{t}/health-checks/{a}                           updateHealthCheck     (health_check.assess; If-Match)
//   PUT   /transformations/{t}/health-checks/{a}/answers/{questionCode}    putHealthCheckAnswer  (health_check.assess; If-Match of the assessment)
//   PUT   /transformations/{t}/health-checks/{a}/actions                   putHealthCheckActions (health_check.assess; If-Match of the assessment)
//   POST  /transformations/{t}/health-checks/{a}/submit                    submitHealthCheck     (health_check.assess; If-Match)
//
// SCHEME. An assessment is created under the transformation's `health_check_scheme` pin, read through ConfigResolver
// (ADR-0039 §3); with no pin, version 1 of key `health-check` ("never the latest"). Its scheme version never changes:
// publishing a new scheme or migrating the pin affects only assessments created afterwards (ADR-0048 §6, ADR-0040), so
// a submitted assessment keeps its scheme version, score and band forever (REQ-S14-003). Reassessments are new rows in
// sequence order, each naming the previous submitted one (M0288 "track reassessments over time"); at most one draft.
//
// SCORE. The score, the maximum and the band come from the shared pure functions (`healthAssessmentResult`,
// `packages/shared/src/health/**`, decimal.js), never a binary float. While any of the 25 questions is unanswered the
// assessment is INCOMPLETE: `completion {answered, total: 25, complete: false}`, `score: null`, `scoreMax: null` and
// `band: null` (REQ-S14-002; never 0, never a band). A complete draft shows its computed score and band, with status
// `draft` (not submitted); an all-N/A one is not computable (null). Submission (lock class healthAssessmentSubmit) needs 25 answers and the
// top 3 actions, then writes the shared result; the database recomputes it (`p5_health_assessment_result`) and refuses
// any other value (`health_assessment_score_matches`). Scheme v1 (Yes = 1, No = 0, out of 25) is an IMPLEMENTATION
// ASSUMPTION (M0262, D-010), and every body says so (`scoringAssumption`).
//
// ACTIONS. `putHealthCheckActions` sets one to three ranked actions; each rank sent is created or replaced, a rank not
// sent keeps its stored action (the table has no DELETE grant: nothing is ever deleted). Submission needs exactly three.
//
// Every mutation re-checks health_check.assess at commit time on the grants reloaded in the transaction (AUD and any
// role without it get 403; an outsider 404), validates, needs If-Match (428/409; create returns version 1), writes one
// audit event per mutated row in the same transaction, and does no remote I/O. A health-check score is an assessment,
// not a G1-G6 business approval; nothing here reads or writes the engineering gates DG0-DG7.
import { sql, type DbOrTx, type Tx } from "@mth/db";
import {
  formatHealthScore,
  healthAssessmentResult,
  healthCompletion,
  healthResponseAllowed,
  HEALTH_QUESTION_COUNT,
} from "@mth/shared/calc";
import {
  healthCheckActionsPut,
  healthCheckAnswerPut,
  healthCheckCreate,
  healthCheckUpdate,
  HEALTH_QUESTION_CODE_PATTERN,
  type HealthCheck,
  type HealthCheckAction,
  type HealthCheckSummary,
} from "@mth/shared/schemas";
import { Decimal } from "decimal.js";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { principalOf, requireTransformationRead } from "../access/index.ts";
import { record } from "../audit/index.ts";
import { createConfigResolver, type ConfigResolver } from "../methodology/index.ts";
import {
  ADVISORY_LOCK_CLASSES,
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
import { assertActiveUsers, assertSameTransformation, openWrite, type WriteContext } from "../transformations/index.ts";
import { HEALTH_CHECK_SCHEME_KIND, loadHealthScheme, toHealthCheckScheme, type LoadedHealthScheme } from "./schemes.ts";

export const HEALTH_CHECKS = "/api/v1/transformations/:transformationId/health-checks";
export const HEALTH_CHECK = `${HEALTH_CHECKS}/:assessmentId`;
export const HEALTH_CHECK_ANSWER = `${HEALTH_CHECK}/answers/:questionCode`;
export const HEALTH_CHECK_ACTIONS = `${HEALTH_CHECK}/actions`;
export const HEALTH_CHECK_SUBMIT = `${HEALTH_CHECK}/submit`;
export const HEALTH_CHECK_ASSESS = "health_check.assess" as const;
/** Submission needs exactly this many ranked actions (B0150 "Top 3 actions"; `health_assessment_three_actions`). */
export const HEALTH_CHECK_ACTIONS_REQUIRED = 3;
const JSON_BODY = ["application/json"] as const;

// ------------------------------------------------------------------------------------------------ problems (ADR-0048 §9)

export const DRAFT_EXISTS = () =>
  problems.duplicate("health_check.draft_exists", "This transformation already has a health check in progress.");
export const INCOMPLETE = () =>
  problems.businessRule("health_check.incomplete", "Answer all 25 questions before submitting the health check.");
export const ACTIONS_REQUIRED = () =>
  problems.businessRule("health_check.actions_required", "Submit the health check with its top 3 actions.");
export const NOT_DRAFT = () =>
  problems.businessRule("health_check.not_draft", "Only a health check in progress can be changed or submitted.");
export const RESPONSE_NOT_ALLOWED = () =>
  problems.businessRule(
    "health_check.response_not_allowed",
    "This response is not allowed by the health check's scoring scheme.",
  );
export const NOT_COMPUTABLE = () =>
  problems.businessRule("health_check.not_computable", "No question is applicable, so no score can be computed.");

// ------------------------------------------------------------------------------------------------ rows

interface AssessmentRow {
  id: string;
  organization_id: string;
  transformation_id: string;
  sequence_no: number;
  scheme_version_id: string;
  assessment_date: unknown;
  owner_user_id: string;
  status: string;
  answered_count: number;
  score: string | null;
  score_max: string | null;
  band_key: string | null;
  previous_assessment_id: string | null;
  submitted_at: Date | null;
  submitted_by: string | null;
  version: number;
  created_at: Date;
  updated_at: Date;
}

const ASSESSMENT_COLUMNS = [
  "id",
  "organization_id",
  "transformation_id",
  "sequence_no",
  "scheme_version_id",
  "assessment_date",
  "owner_user_id",
  "status",
  "answered_count",
  "score",
  "score_max",
  "band_key",
  "previous_assessment_id",
  "submitted_at",
  "submitted_by",
  "version",
  "created_at",
  "updated_at",
] as const;

const dateText = (d: unknown): string => String(d).slice(0, 10);

async function findAssessment(
  db: DbOrTx,
  transformationId: string,
  assessmentId: string,
  lock = false,
): Promise<AssessmentRow> {
  let q = db
    .selectFrom("health_assessment")
    .select([...ASSESSMENT_COLUMNS])
    .where("transformation_id", "=", transformationId)
    .where("id", "=", assessmentId);
  if (lock) q = q.forUpdate();
  const row = await q.executeTakeFirst();
  if (!row) throw problems.notFound();
  return row as unknown as AssessmentRow;
}

// ------------------------------------------------------------------------------------------------ presenter

/** A stored numeric(7,2) in its API form ("17", "62.50"); null stays null (never 0). */
const scoreText = (v: string | null): string | null => (v === null ? null : formatHealthScore(new Decimal(v)));

/** The schemes of a page, loaded once each (a scheme version is immutable once published). */
type SchemeCache = Map<string, Promise<LoadedHealthScheme | null>>;
const schemeOf = (db: DbOrTx, cache: SchemeCache, id: string): Promise<LoadedHealthScheme | null> => {
  let s = cache.get(id);
  if (s === undefined) {
    s = loadHealthScheme(db, id);
    cache.set(id, s);
  }
  return s;
};

async function answersOf(db: DbOrTx, assessmentIds: readonly string[]) {
  if (assessmentIds.length === 0) return [];
  return db
    .selectFrom("health_assessment_answer")
    .select([
      "assessment_id",
      "question_code",
      "response",
      "evidence_note",
      "evidence_id",
      "owner_user_id",
      "action_note",
      "answered_by",
      "updated_at",
    ])
    .where("assessment_id", "in", [...assessmentIds])
    .orderBy("question_code")
    .execute();
}

/**
 * The summary of one assessment. A submitted one shows its STORED score and band (fixed at submission under its own
 * scheme version); a draft shows the shared result of its answers: null while incomplete or not computable.
 */
function toSummary(a: AssessmentRow, scheme: LoadedHealthScheme, responses: readonly string[]): HealthCheckSummary {
  const view = toHealthCheckScheme(scheme);
  let score: string | null;
  let scoreMax: string | null;
  let bandKey: string | null;
  if (a.status === "submitted") {
    score = scoreText(a.score);
    scoreMax = scoreText(a.score_max);
    bandKey = a.band_key;
  } else {
    const r = healthAssessmentResult(scheme.input, responses);
    score = r.score;
    scoreMax = r.scoreMax;
    bandKey = r.bandKey;
  }
  const band = score === null || bandKey === null ? null : (view.bands.find((b) => b.key === bandKey) ?? null);
  return {
    id: a.id,
    transformationId: a.transformation_id,
    sequenceNo: a.sequence_no,
    schemeVersionId: a.scheme_version_id,
    schemeVersionNo: scheme.versionNo,
    assessmentDate: dateText(a.assessment_date),
    ownerUserId: a.owner_user_id,
    status: a.status as HealthCheckSummary["status"],
    completion: healthCompletion(a.answered_count),
    score,
    scoreMax: score === null ? null : scoreMax,
    band,
    scoringAssumption: view.implementationAssumption,
    previousAssessmentId: a.previous_assessment_id,
    submittedAt: isoOrNull(a.submitted_at),
    submittedBy: a.submitted_by,
    version: a.version,
    createdAt: iso(a.created_at),
    updatedAt: iso(a.updated_at),
  };
}

export async function presentSummaries(db: DbOrTx, rows: readonly AssessmentRow[]): Promise<HealthCheckSummary[]> {
  const cache: SchemeCache = new Map();
  const answers = await answersOf(
    db,
    rows.map((r) => r.id),
  );
  const out: HealthCheckSummary[] = [];
  for (const a of rows) {
    const scheme = await schemeOf(db, cache, a.scheme_version_id);
    if (scheme === null) throw problems.internal(); // the FK and the guard make this unreachable
    out.push(
      toSummary(
        a,
        scheme,
        answers.filter((x) => x.assessment_id === a.id).map((x) => x.response),
      ),
    );
  }
  return out;
}

export async function presentHealthCheck(
  db: DbOrTx,
  transformationId: string,
  assessmentId: string,
): Promise<HealthCheck> {
  const a = await findAssessment(db, transformationId, assessmentId);
  const [scheme, answers, actions] = await Promise.all([
    loadHealthScheme(db, a.scheme_version_id),
    answersOf(db, [a.id]),
    db
      .selectFrom("health_assessment_action")
      .select(["rank", "action_text", "owner_user_id", "due_date", "improvement_item_id"])
      .where("assessment_id", "=", a.id)
      .orderBy("rank")
      .execute(),
  ]);
  if (scheme === null) throw problems.internal();
  return {
    ...toSummary(
      a,
      scheme,
      answers.map((x) => x.response),
    ),
    answers: answers.map((x) => ({
      questionCode: x.question_code,
      response: x.response as HealthCheck["answers"][number]["response"],
      evidenceNote: x.evidence_note,
      evidenceId: x.evidence_id,
      ownerUserId: x.owner_user_id,
      actionNote: x.action_note,
      answeredBy: x.answered_by,
      updatedAt: iso(x.updated_at),
    })),
    actions: actions.map(
      (x): HealthCheckAction => ({
        rank: x.rank,
        actionText: x.action_text,
        ownerUserId: x.owner_user_id,
        dueDate: x.due_date === null ? null : dateText(x.due_date),
        improvementItemId: x.improvement_item_id,
      }),
    ),
  };
}

// ------------------------------------------------------------------------------------------------ writes

/**
 * The write context of the assessment mutations: the read gate on the request principal first (an outsider gets 404,
 * ADR-0006), then health_check.assess re-checked at commit time on the grants reloaded in the transaction (a grant
 * revoked meanwhile gives 403; AUD and the roles without it get 403).
 */
async function openAssessWrite(tx: Tx, request: FastifyRequest, transformationId: string): Promise<WriteContext> {
  await requireTransformationRead(tx, principalOf(request), transformationId);
  return openWrite(tx, request, transformationId, [{ permission: HEALTH_CHECK_ASSESS }], null, { atCommit: true });
}

/** Locks the assessment row, then checks If-Match and that it is a draft. */
async function lockDraft(tx: Tx, transformationId: string, assessmentId: string, expected: number) {
  const a = await findAssessment(tx, transformationId, assessmentId, true);
  if (a.version !== expected) throw problems.versionConflict(a.version);
  if (a.status !== "draft") throw NOT_DRAFT();
  return a;
}

/** The audit `changes` of the columns of `next` whose value differs from `before`. */
function diffOf(
  before: ReadonlyMap<string, unknown>,
  next: Readonly<Record<string, unknown>>,
): Record<string, { from: unknown; to: unknown }> {
  return Object.fromEntries(
    Object.entries(next)
      .filter(([k, v]) => before.get(k) !== v)
      .map(([k, v]) => [k, { from: before.get(k), to: v }]),
  );
}

/** Steps the assessment's version (ADR-0048 §7: every child write steps its parent, so concurrent writers get one 409). */
async function stepAssessment(
  tx: Tx,
  ctx: WriteContext,
  a: AssessmentRow,
  action: string,
  changes: Record<string, { from: unknown; to: unknown }>,
  set: { answered_count?: number } = {},
): Promise<void> {
  const stepped = await tx
    .updateTable("health_assessment")
    .set({
      ...set,
      version: sql<number>`version + 1`,
      updated_at: sql<Date>`now()`,
      updated_by: ctx.userId,
    })
    .where("id", "=", a.id)
    .where("version", "=", a.version)
    .returning("version")
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action,
    recordType: "health_assessment",
    recordId: a.id,
    organizationId: ctx.organizationId,
    transformationId: a.transformation_id,
    priorVersion: a.version,
    newVersion: stepped.version,
    changes,
  });
}

async function createAssessment(
  tx: Tx,
  request: FastifyRequest,
  transformationId: string,
  resolver: ConfigResolver,
): Promise<string> {
  const ctx = await openAssessWrite(tx, request, transformationId);
  const body = parseBody(healthCheckCreate, request.body);
  const ownerUserId = body.ownerUserId ?? ctx.userId;
  await assertActiveUsers(tx, ctx.organizationId, [{ id: body.ownerUserId, pointer: "/ownerUserId" }]);
  const draft = await tx
    .selectFrom("health_assessment")
    .select("id")
    .where("transformation_id", "=", transformationId)
    .where("status", "=", "draft")
    .executeTakeFirst();
  if (draft) throw DRAFT_EXISTS();
  // The pinned scheme (ADR-0039 §3; else v1 of `health-check`), fixed for the assessment's life.
  const pinned = await resolver.pinnedVersion(tx, transformationId, HEALTH_CHECK_SCHEME_KIND);
  const [last, previous] = await Promise.all([
    tx
      .selectFrom("health_assessment")
      .select(sql<number>`coalesce(max(sequence_no), 0)::int`.as("max"))
      .where("transformation_id", "=", transformationId)
      .executeTakeFirstOrThrow(),
    tx
      .selectFrom("health_assessment")
      .select("id")
      .where("transformation_id", "=", transformationId)
      .where("status", "=", "submitted")
      .orderBy("sequence_no", "desc")
      .limit(1)
      .executeTakeFirst(),
  ]);
  const id = uuidv7();
  const sequenceNo = last.max + 1;
  const previousId = previous?.id ?? null;
  await tx
    .insertInto("health_assessment")
    .values({
      id,
      organization_id: ctx.organizationId,
      transformation_id: transformationId,
      sequence_no: sequenceNo,
      scheme_version_id: pinned.versionId,
      assessment_date: body.assessmentDate,
      owner_user_id: ownerUserId,
      previous_assessment_id: previousId,
      created_by: ctx.userId,
      updated_by: ctx.userId,
    })
    .execute();
  await record(tx, ctx.audit, {
    action: "health_assessment.create",
    recordType: "health_assessment",
    recordId: id,
    organizationId: ctx.organizationId,
    transformationId,
    newVersion: 1,
    changes: {
      sequence_no: { from: null, to: sequenceNo },
      scheme_version_id: { from: null, to: pinned.versionId },
      assessment_date: { from: null, to: body.assessmentDate },
      owner_user_id: { from: null, to: ownerUserId },
      previous_assessment_id: { from: null, to: previousId },
      status: { from: null, to: "draft" },
    },
  });
  return id;
}

async function updateAssessment(
  tx: Tx,
  request: FastifyRequest,
  transformationId: string,
  assessmentId: string,
): Promise<void> {
  const ctx = await openAssessWrite(tx, request, transformationId);
  const body = parseBody(healthCheckUpdate, request.body);
  const expected = requireIfMatch(request);
  const a = await lockDraft(tx, transformationId, assessmentId, expected);
  await assertActiveUsers(tx, ctx.organizationId, [{ id: body.ownerUserId, pointer: "/ownerUserId" }]);
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  const oldDate = dateText(a.assessment_date);
  if (body.assessmentDate !== undefined && body.assessmentDate !== oldDate)
    changes["assessment_date"] = { from: oldDate, to: body.assessmentDate };
  if (body.ownerUserId !== undefined && body.ownerUserId !== a.owner_user_id)
    changes["owner_user_id"] = { from: a.owner_user_id, to: body.ownerUserId };
  if (Object.keys(changes).length === 0) return; // nothing changes, nothing is written
  const updated = await tx
    .updateTable("health_assessment")
    .set({
      ...(changes["assessment_date"] ? { assessment_date: body.assessmentDate! } : {}),
      ...(changes["owner_user_id"] ? { owner_user_id: body.ownerUserId! } : {}),
      version: sql<number>`version + 1`,
      updated_at: sql<Date>`now()`,
      updated_by: ctx.userId,
    })
    .where("id", "=", a.id)
    .where("version", "=", a.version)
    .returning("version")
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: "health_assessment.update",
    recordType: "health_assessment",
    recordId: a.id,
    organizationId: ctx.organizationId,
    transformationId,
    priorVersion: a.version,
    newVersion: updated.version,
    changes,
  });
}

async function putAnswer(
  tx: Tx,
  request: FastifyRequest,
  transformationId: string,
  assessmentId: string,
  questionCode: string,
): Promise<void> {
  const ctx = await openAssessWrite(tx, request, transformationId);
  const body = parseBody(healthCheckAnswerPut, request.body);
  const expected = requireIfMatch(request);
  const a = await lockDraft(tx, transformationId, assessmentId, expected);
  const scheme = await loadHealthScheme(tx, a.scheme_version_id);
  if (scheme === null) throw problems.internal();
  if (!healthResponseAllowed(scheme.input, body.response)) throw RESPONSE_NOT_ALLOWED();
  await assertActiveUsers(tx, ctx.organizationId, [{ id: body.ownerUserId, pointer: "/ownerUserId" }]);
  await assertSameTransformation(tx, "evidence", transformationId, body.evidenceId, "/evidenceId");

  const next = {
    response: body.response,
    evidence_note: body.evidenceNote ?? null,
    evidence_id: body.evidenceId ?? null,
    owner_user_id: body.ownerUserId ?? null,
    action_note: body.actionNote ?? null,
  };
  const scope = { organizationId: ctx.organizationId, transformationId };
  const existing = await tx
    .selectFrom("health_assessment_answer")
    .select([
      "id",
      "response",
      "evidence_note",
      "evidence_id",
      "owner_user_id",
      "action_note",
      "answered_by",
      "version",
    ])
    .where("assessment_id", "=", a.id)
    .where("question_code", "=", questionCode)
    .forUpdate()
    .executeTakeFirst();

  let answered = a.answered_count;
  if (!existing) {
    const id = uuidv7();
    await tx
      .insertInto("health_assessment_answer")
      .values({
        id,
        organization_id: ctx.organizationId,
        transformation_id: transformationId,
        assessment_id: a.id,
        question_code: questionCode,
        ...next,
        answered_by: ctx.userId,
        created_by: ctx.userId,
        updated_by: ctx.userId,
      })
      .execute();
    answered += 1;
    await record(tx, ctx.audit, {
      action: "health_assessment_answer.create",
      recordType: "health_assessment_answer",
      recordId: id,
      ...scope,
      newVersion: 1,
      changes: {
        question_code: { from: null, to: questionCode },
        ...Object.fromEntries(Object.entries(next).map(([k, v]) => [k, { from: null, to: v }])),
      },
    });
  } else {
    const changes = {
      ...diffOf(new Map<string, unknown>(Object.entries(existing)), next),
      ...(existing.answered_by !== ctx.userId ? { answered_by: { from: existing.answered_by, to: ctx.userId } } : {}),
    };
    if (Object.keys(changes).length === 0) return; // the same answer again: nothing changes, nothing is written
    const updated = await tx
      .updateTable("health_assessment_answer")
      .set({
        ...next,
        answered_by: ctx.userId,
        version: sql<number>`version + 1`,
        updated_at: sql<Date>`now()`,
        updated_by: ctx.userId,
      })
      .where("id", "=", existing.id)
      .where("version", "=", existing.version)
      .returning("version")
      .executeTakeFirstOrThrow();
    await record(tx, ctx.audit, {
      action: "health_assessment_answer.update",
      recordType: "health_assessment_answer",
      recordId: existing.id,
      ...scope,
      priorVersion: existing.version,
      newVersion: updated.version,
      changes,
    });
  }
  await stepAssessment(
    tx,
    ctx,
    a,
    "health_assessment.answer",
    {
      question_code: { from: null, to: questionCode },
      ...(answered !== a.answered_count ? { answered_count: { from: a.answered_count, to: answered } } : {}),
    },
    { answered_count: answered },
  );
}

async function putActions(
  tx: Tx,
  request: FastifyRequest,
  transformationId: string,
  assessmentId: string,
): Promise<void> {
  const ctx = await openAssessWrite(tx, request, transformationId);
  const body = parseBody(healthCheckActionsPut, request.body);
  const expected = requireIfMatch(request);
  const a = await lockDraft(tx, transformationId, assessmentId, expected);
  await assertActiveUsers(
    tx,
    ctx.organizationId,
    body.actions.map((x, i) => ({ id: x.ownerUserId, pointer: `/actions/${i}/ownerUserId` })),
  );
  for (const [i, x] of body.actions.entries())
    await assertSameTransformation(
      tx,
      "improvement_item",
      transformationId,
      x.improvementItemId,
      `/actions/${i}/improvementItemId`,
    );
  const stored = await tx
    .selectFrom("health_assessment_action")
    .select(["id", "rank", "action_text", "owner_user_id", "due_date", "improvement_item_id", "version"])
    .where("assessment_id", "=", a.id)
    .forUpdate()
    .execute();
  const byRank = new Map(stored.map((s) => [s.rank, s]));
  const scope = { organizationId: ctx.organizationId, transformationId };
  const ranks: number[] = [];
  for (const x of [...body.actions].sort((p, q) => p.rank - q.rank)) {
    const next = {
      action_text: x.actionText,
      owner_user_id: x.ownerUserId ?? null,
      due_date: x.dueDate ?? null,
      improvement_item_id: x.improvementItemId ?? null,
    };
    const old = byRank.get(x.rank);
    if (!old) {
      const id = uuidv7();
      await tx
        .insertInto("health_assessment_action")
        .values({
          id,
          organization_id: ctx.organizationId,
          transformation_id: transformationId,
          assessment_id: a.id,
          rank: x.rank,
          ...next,
          created_by: ctx.userId,
          updated_by: ctx.userId,
        })
        .execute();
      await record(tx, ctx.audit, {
        action: "health_assessment_action.create",
        recordType: "health_assessment_action",
        recordId: id,
        ...scope,
        newVersion: 1,
        changes: {
          rank: { from: null, to: x.rank },
          ...Object.fromEntries(Object.entries(next).map(([k, v]) => [k, { from: null, to: v }])),
        },
      });
      ranks.push(x.rank);
      continue;
    }
    const before = new Map<string, unknown>([
      ["action_text", old.action_text],
      ["owner_user_id", old.owner_user_id],
      ["due_date", old.due_date === null ? null : dateText(old.due_date)],
      ["improvement_item_id", old.improvement_item_id],
    ]);
    const changes = diffOf(before, next);
    if (Object.keys(changes).length === 0) continue;
    const updated = await tx
      .updateTable("health_assessment_action")
      .set({
        ...next,
        version: sql<number>`version + 1`,
        updated_at: sql<Date>`now()`,
        updated_by: ctx.userId,
      })
      .where("id", "=", old.id)
      .where("version", "=", old.version)
      .returning("version")
      .executeTakeFirstOrThrow();
    await record(tx, ctx.audit, {
      action: "health_assessment_action.update",
      recordType: "health_assessment_action",
      recordId: old.id,
      ...scope,
      priorVersion: old.version,
      newVersion: updated.version,
      changes,
    });
    ranks.push(x.rank);
  }
  if (ranks.length === 0) return; // the same actions again: nothing changes, nothing is written
  await stepAssessment(tx, ctx, a, "health_assessment.actions", { action_ranks: { from: null, to: ranks } });
}

async function submitAssessment(
  tx: Tx,
  request: FastifyRequest,
  transformationId: string,
  assessmentId: string,
): Promise<void> {
  const ctx = await openAssessWrite(tx, request, transformationId);
  const expected = requireIfMatch(request);
  // Lock class healthAssessmentSubmit on the assessment: the score, band and three-action check together
  // (the 0086 guard takes the same key; ADR-0048 §8).
  await sql`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK_CLASSES.healthAssessmentSubmit}::int4, hashtext(${assessmentId}))`.execute(
    tx,
  );
  const a = await lockDraft(tx, transformationId, assessmentId, expected);
  if (a.answered_count < HEALTH_QUESTION_COUNT) throw INCOMPLETE();
  const actions = await tx
    .selectFrom("health_assessment_action")
    .select(sql<number>`count(*)::int`.as("n"))
    .where("assessment_id", "=", a.id)
    .executeTakeFirstOrThrow();
  if (actions.n !== HEALTH_CHECK_ACTIONS_REQUIRED) throw ACTIONS_REQUIRED();
  const [scheme, answers] = await Promise.all([loadHealthScheme(tx, a.scheme_version_id), answersOf(tx, [a.id])]);
  if (scheme === null) throw problems.internal();
  const result = healthAssessmentResult(
    scheme.input,
    answers.map((x) => x.response),
  );
  if (!result.completion.complete) throw INCOMPLETE();
  if (result.score === null || result.scoreMax === null) throw NOT_COMPUTABLE();
  const done = await tx
    .updateTable("health_assessment")
    .set({
      status: "submitted",
      score: result.score,
      score_max: result.scoreMax,
      band_key: result.bandKey,
      submitted_at: sql<Date>`now()`,
      submitted_by: ctx.userId,
      version: sql<number>`version + 1`,
      updated_at: sql<Date>`now()`,
      updated_by: ctx.userId,
    })
    .where("id", "=", a.id)
    .where("version", "=", a.version)
    .returning(["version", "submitted_at"])
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: "health_assessment.submit",
    recordType: "health_assessment",
    recordId: a.id,
    organizationId: ctx.organizationId,
    transformationId,
    priorVersion: a.version,
    newVersion: done.version,
    changes: {
      status: { from: "draft", to: "submitted" },
      score: { from: null, to: result.score },
      score_max: { from: null, to: result.scoreMax },
      band_key: { from: null, to: result.bandKey },
      scheme_version_id: { from: a.scheme_version_id, to: a.scheme_version_id },
      submitted_by: { from: null, to: ctx.userId },
      submitted_at: { from: null, to: isoOrNull(done.submitted_at) },
    },
  });
}

// ------------------------------------------------------------------------------------------------ routes

const transformationParams = z.strictObject({ transformationId: z.uuid() });
const assessmentParams = z.strictObject({ transformationId: z.uuid(), assessmentId: z.uuid() });
const answerParams = z.strictObject({
  transformationId: z.uuid(),
  assessmentId: z.uuid(),
  questionCode: z.string().regex(HEALTH_QUESTION_CODE_PATTERN),
});
const listQuery = z.strictObject({ cursor: cursorSchema, limit: limitSchema });

/** Registers the assessment routes and returns them as "METHOD /path". */
export function registerHealthAssessmentRoutes(
  app: FastifyInstance,
  { db }: ModuleDeps,
  resolver: ConfigResolver = createConfigResolver(),
): string[] {
  const read = { access: { permission: "transformation.read" as const } };
  const assess = { access: { permission: HEALTH_CHECK_ASSESS }, consumes: JSON_BODY };
  const action = { access: { permission: HEALTH_CHECK_ASSESS } };
  const readOnly = <T>(fn: (tx: Tx) => Promise<T>) =>
    db.transaction().setIsolationLevel("repeatable read").setAccessMode("read only").execute(fn);

  app.get(HEALTH_CHECKS, { config: read }, async (request) => {
    const { transformationId } = parse(transformationParams, request.params, "params");
    const query = parseQuery(listQuery, request.query);
    await requireTransformationRead(db, principalOf(request), transformationId);
    const hash = filterHash({ table: "health_assessment", transformationId });
    const after = decodeCursor(query.cursor, hash, 1);
    return readOnly(async (tx) => {
      let q = tx
        .selectFrom("health_assessment")
        .select([...ASSESSMENT_COLUMNS])
        .where("transformation_id", "=", transformationId);
      if (after) q = q.where("sequence_no", ">", Number(after[0]));
      const rows = (await q
        .orderBy("sequence_no")
        .limit(query.limit + 1)
        .execute()) as unknown as AssessmentRow[];
      const page = paginate(rows, query.limit, (r) => [r.sequence_no], hash);
      return { items: await presentSummaries(tx, page.items), nextCursor: page.nextCursor };
    });
  });

  app.post(HEALTH_CHECKS, { config: assess }, async (request, reply) => {
    const { transformationId } = parse(transformationParams, request.params, "params");
    const body = await db.transaction().execute(async (tx) => {
      const id = await createAssessment(tx, request, transformationId, resolver);
      return presentHealthCheck(tx, transformationId, id);
    });
    return sendVersioned(reply, 201, body, `${request.url.split("?")[0]!}/${body.id}`);
  });

  app.get(HEALTH_CHECK, { config: read }, async (request, reply) => {
    const { transformationId, assessmentId } = parse(assessmentParams, request.params, "params");
    await requireTransformationRead(db, principalOf(request), transformationId);
    const body = await readOnly((tx) => presentHealthCheck(tx, transformationId, assessmentId));
    return sendVersioned(reply, 200, body);
  });

  app.patch(HEALTH_CHECK, { config: assess }, async (request, reply) => {
    const { transformationId, assessmentId } = parse(assessmentParams, request.params, "params");
    const body = await db.transaction().execute(async (tx) => {
      await updateAssessment(tx, request, transformationId, assessmentId);
      return presentHealthCheck(tx, transformationId, assessmentId);
    });
    return sendVersioned(reply, 200, body);
  });

  app.put(HEALTH_CHECK_ANSWER, { config: assess }, async (request, reply) => {
    const { transformationId, assessmentId, questionCode } = parse(answerParams, request.params, "params");
    const body = await db.transaction().execute(async (tx) => {
      await putAnswer(tx, request, transformationId, assessmentId, questionCode);
      return presentHealthCheck(tx, transformationId, assessmentId);
    });
    return sendVersioned(reply, 200, body);
  });

  app.put(HEALTH_CHECK_ACTIONS, { config: assess }, async (request, reply) => {
    const { transformationId, assessmentId } = parse(assessmentParams, request.params, "params");
    const body = await db.transaction().execute(async (tx) => {
      await putActions(tx, request, transformationId, assessmentId);
      return presentHealthCheck(tx, transformationId, assessmentId);
    });
    return sendVersioned(reply, 200, body);
  });

  app.post(HEALTH_CHECK_SUBMIT, { config: action }, async (request, reply) => {
    const { transformationId, assessmentId } = parse(assessmentParams, request.params, "params");
    const body = await db.transaction().execute(async (tx) => {
      await submitAssessment(tx, request, transformationId, assessmentId);
      return presentHealthCheck(tx, transformationId, assessmentId);
    });
    return sendVersioned(reply, 200, body);
  });

  return [
    `GET ${HEALTH_CHECKS}`,
    `POST ${HEALTH_CHECKS}`,
    `GET ${HEALTH_CHECK}`,
    `PATCH ${HEALTH_CHECK}`,
    `PUT ${HEALTH_CHECK_ANSWER}`,
    `PUT ${HEALTH_CHECK_ACTIONS}`,
    `POST ${HEALTH_CHECK_SUBMIT}`,
  ];
}
