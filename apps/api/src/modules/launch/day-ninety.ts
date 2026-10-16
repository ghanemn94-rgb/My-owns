// The Day-90 leadership test (P5 slice H; ADR-0048 §4, §7-§9; REQ-PB-087; p5-work-split §H.2; T-DG5-BE-P2):
//   GET  /transformations/{t}/day-90-test                              getDayNinetyTest       (transformation.read)
//   PUT  /transformations/{t}/day-90-test/responses/{questionCode}     putDayNinetyResponse   (day_ninety_test.respond; If-Match of the test)
//   POST /transformations/{t}/day-90-test/complete                     completeDayNinetyTest  (day_ninety_test.respond; If-Match of the test)
//
// The test is created with the launch plan (plan.ts) and scheduled on day 90 (= the plan's start date + 90 calendar
// days). The six questions are the seeded `day_ninety_question` rows, rendered VERBATIM (B0136-B0141; D-142 Q5); the
// Arabic texts are provisional translations. The test is INCOMPLETE while any question has no response: the read
// returns `completion {answered, total: 6, complete}`, and completing needs all six (422 day_ninety_test.incomplete;
// the 0086 CHECK day_ninety_test_completed_complete is the backstop). A completed test is final: a response after
// completion gives 422 day_ninety_test.completed (the 0086 guards day_ninety_response_test_open and
// day_ninety_test_completed_final are the backstop).
//
// Evidence suggestions (ADR-0048 §4 "Pre-filled evidence"): per question, at most 5 records of the types named in
// `day_ninety_question.evidence_record_types`, each with its label and its state. They are LINKS for the leader to
// confirm, never answers: nothing is pre-answered. The charter and the North Star are read through the transformations
// module's exported readers (findCharter, findCurrentNorthStar); the other owning modules export no list reader for
// these records, so their reads below are restated read-only selects of the same tables, scoped to the transformation
// and excluding archived rows (ADR-0002 rule 4; the gap is listed in the T-DG5-BE-P2 handback for the orchestrator). A
// state that is not recorded is null (Unknown), never guessed.
//
// Concurrency of answers (ADR-0048 §7): every response write takes If-Match of the TEST and steps the test's version
// (its answered_count), with its own audit event, so two leaders answering at once get one 409. Each mutated row has
// one audit event in the same transaction: the response (`day_ninety_response.create`/`.update`) and the test
// (`day_ninety_test.respond`); completion writes `day_ninety_test.complete` and closes the test's open
// `day_ninety_test_due` My Work items (created by the worker job launch.day_ninety_tests), each audited.
//
// Every mutation re-checks day_ninety_test.respond at commit time on the grants reloaded in the transaction (AUD, TO
// and WL get 403; an outsider 404), validates, needs If-Match (428/409), and does no remote I/O inside the
// transaction. A Day-90 answer is an assessment by a leader, not a G1-G6 business approval; nothing here reads or
// writes DG0-DG7.
import { sql, type DbOrTx, type Tx } from "@mth/db";
import {
  dayNinetyAnswer,
  dayNinetyCompletion,
  dayNinetyEvidenceSuggestion,
  dayNinetyQuestion,
  dayNinetyResponse,
  dayNinetyResponsePut,
  dayNinetyTest,
  truncateText,
  type DayNinetySuggestion,
  type DayNinetyTest,
} from "@mth/shared/schemas";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { principalOf, requireTransformationRead } from "../access/index.ts";
import { record } from "../audit/index.ts";
import {
  iso,
  isoOrNull,
  parse,
  parseBody,
  problems,
  requireIfMatch,
  sendVersioned,
  type ModuleDeps,
} from "../platform/index.ts";
import { closeWorkItemsOfSubject } from "../tasks/index.ts";
import {
  findCharter,
  findCurrentNorthStar,
  openWrite,
  ruleProblem,
  type WriteContext,
} from "../transformations/index.ts";
import { dateText, JSON_BODY, parseTransformationParam } from "./plan.ts";

export const DAY_NINETY_TEST = "/api/v1/transformations/:transformationId/day-90-test";
export const DAY_NINETY_RESPONSE = `${DAY_NINETY_TEST}/responses/:questionCode`;
export const DAY_NINETY_COMPLETE = `${DAY_NINETY_TEST}/complete`;
export const DAY_NINETY_RESPOND = "day_ninety_test.respond" as const;
/** The work-item kind of the job's "Day 90 reached -> create test task" (0086; worker handlers/launch.ts). */
export const DAY_NINETY_TASK_KIND = "day_ninety_test_due";
/** At most this many evidence suggestions per question (OpenAPI DayNinetyQuestion.evidenceSuggestions.maxItems). */
export const MAX_SUGGESTIONS = 5;
/** Suggestion labels are record texts, shortened only through truncateText (p5-work-split §2 rule 1). */
const LABEL_MAX = 200;

// ------------------------------------------------------------------------------------------------ the contract (zod)
// The zod mirrors of the OpenAPI components DayNinetyEvidenceSuggestion, DayNinetyResponse, DayNinetyQuestion,
// Completion, DayNinetyTest and DayNinetyResponsePut (docs/api/openapi.yaml is the source of truth). Written here by
// T-DG5-BE-P2 and promoted unchanged to packages/shared/src/schemas/day-ninety.ts by T-DG5-FE-F (D-159 d); re-exported
// under their original names so this module, its test and the contract exercises keep one definition.

export {
  dayNinetyAnswer,
  dayNinetyEvidenceSuggestion,
  dayNinetyResponse,
  dayNinetyQuestion,
  dayNinetyCompletion as completion,
  dayNinetyTest,
  dayNinetyResponsePut,
};
export type { DayNinetyTest, DayNinetySuggestion };

// ------------------------------------------------------------------------------------------------ problems (ADR-0048 §9)

export const TEST_INCOMPLETE = () =>
  problems.businessRule(
    "day_ninety_test.incomplete",
    "Answer all six questions before completing the Day-90 leadership test.",
  );
export const TEST_COMPLETED = () =>
  problems.businessRule(
    "day_ninety_test.completed",
    "The Day-90 leadership test is complete; its responses can no longer change.",
  );
const EVIDENCE_INVALID = () =>
  ruleProblem("validation.reference", "No such evidence in this transformation.", "/evidenceId");

// ------------------------------------------------------------------------------------------------ rows

interface TestRow {
  id: string;
  organization_id: string;
  transformation_id: string;
  plan_id: string;
  scheduled_date: string;
  status: string;
  answered_count: number;
  completed_at: Date | null;
  completed_by: string | null;
  version: number;
}

async function findTest(db: DbOrTx, transformationId: string, lock = false): Promise<TestRow> {
  let q = db
    .selectFrom("day_ninety_test")
    .select([
      "id",
      "organization_id",
      "transformation_id",
      "plan_id",
      "scheduled_date",
      "status",
      "answered_count",
      "completed_at",
      "completed_by",
      "version",
    ])
    .where("transformation_id", "=", transformationId);
  if (lock) q = q.forUpdate();
  const row = await q.executeTakeFirst();
  if (!row) throw problems.notFound();
  return row as TestRow;
}

// ------------------------------------------------------------------------------------------------ evidence suggestions

type SuggestionReader = (db: DbOrTx, transformationId: string) => Promise<DayNinetySuggestion[]>;

const label = (...parts: (string | null | undefined)[]): string =>
  truncateText(parts.filter((p): p is string => typeof p === "string" && p.trim() !== "").join(" "), LABEL_MAX);

/**
 * One reader per record type of the 0086 `evidence_record_types` lists. Each returns at most MAX_SUGGESTIONS rows of
 * the transformation, the most recently updated first, never an archived one.
 */
const SUGGESTION_READERS: ReadonlyMap<string, SuggestionReader> = new Map(
  Object.entries({
    // The charter has no lifecycle state column (its G1 approval is a separate business approval): state Unknown.
    charter: async (db, t) => {
      const c = await findCharter(db, t);
      return c
        ? [{ recordType: "charter", recordId: c.id, label: label(c.transformation_name) || "Charter", state: null }]
        : [];
    },
    north_star: async (db, t) => {
      const n = await findCurrentNorthStar(db, t);
      return n ? [{ recordType: "north_star", recordId: n.id, label: label(n.statement), state: n.status }] : [];
    },
    initiative: async (db, t) =>
      (
        await db
          .selectFrom("initiative")
          .select(["id", "code", "name", "status"])
          .where("transformation_id", "=", t)
          .orderBy("updated_at", "desc")
          .orderBy("id")
          .limit(MAX_SUGGESTIONS)
          .execute()
      ).map((r) => ({ recordType: "initiative", recordId: r.id, label: label(r.code, r.name), state: r.status })),
    tom_gap: async (db, t) =>
      (
        await db
          .selectFrom("tom_gap")
          .select(["id", "dimension_code", "gap", "target_state", "status"])
          .where("transformation_id", "=", t)
          .where("archived_at", "is", null)
          .orderBy("updated_at", "desc")
          .orderBy("id")
          .limit(MAX_SUGGESTIONS)
          .execute()
      ).map((r) => ({
        recordType: "tom_gap",
        recordId: r.id,
        label: label(r.gap ?? r.target_state ?? r.dimension_code),
        state: r.status,
      })),
    outcome: async (db, t) =>
      (
        await db
          .selectFrom("outcome")
          .select(["id", "statement", "status"])
          .where("transformation_id", "=", t)
          .where("archived_at", "is", null)
          .orderBy("updated_at", "desc")
          .orderBy("id")
          .limit(MAX_SUGGESTIONS)
          .execute()
      ).map((r) => ({ recordType: "outcome", recordId: r.id, label: label(r.statement), state: r.status })),
    decision_right: async (db, t) =>
      (
        await db
          .selectFrom("transformation_decision_right")
          .select(["id", "decision_en", "status"])
          .where("transformation_id", "=", t)
          .orderBy("ordinal")
          .orderBy("id")
          .limit(MAX_SUGGESTIONS)
          .execute()
      ).map((r) => ({ recordType: "decision_right", recordId: r.id, label: label(r.decision_en), state: r.status })),
    // The state of a baseline is its Finance validation state.
    baseline: async (db, t) =>
      (
        await db
          .selectFrom("baseline")
          .select(["id", "metric", "unit", "validation_status"])
          .where("transformation_id", "=", t)
          .where("archived_at", "is", null)
          .orderBy("updated_at", "desc")
          .orderBy("id")
          .limit(MAX_SUGGESTIONS)
          .execute()
      ).map((r) => ({
        recordType: "baseline",
        recordId: r.id,
        label: label(r.metric, `(${r.unit})`),
        state: r.validation_status,
      })),
    // The state of a benefit formula is the Finance validation state of its current version (null while it has none).
    benefit_formula: async (db, t) =>
      (
        await db
          .selectFrom("benefit_formula as f")
          .leftJoin("benefit_formula_version as v", (j) =>
            j.onRef("v.formula_id", "=", "f.id").onRef("v.version_no", "=", "f.current_version_no"),
          )
          .select(["f.id", "f.code", "f.benefit_name", "v.validation_status"])
          .where("f.transformation_id", "=", t)
          .where("f.archived_at", "is", null)
          .orderBy("f.updated_at", "desc")
          .orderBy("f.id")
          .limit(MAX_SUGGESTIONS)
          .execute()
      ).map((r) => ({
        recordType: "benefit_formula",
        recordId: r.id,
        label: label(r.code, r.benefit_name),
        state: r.validation_status ?? null,
      })),
    evidence: async (db, t) =>
      (
        await db
          .selectFrom("evidence")
          .select(["id", "title", "status"])
          .where("transformation_id", "=", t)
          .where("archived_at", "is", null)
          .orderBy("updated_at", "desc")
          .orderBy("id")
          .limit(MAX_SUGGESTIONS)
          .execute()
      ).map((r) => ({ recordType: "evidence", recordId: r.id, label: label(r.title), state: r.status })),
    // The transformation's open (or deferred) T16 executive asks (0045: kind 'executive' with an ask origin).
    executive_ask: async (db, t) =>
      (
        await db
          .selectFrom("decision")
          .select(["id", "code", "title", "status"])
          .where("transformation_id", "=", t)
          .where("kind", "=", "executive")
          .where("ask_origin", "is not", null)
          .where("status", "in", ["open", "deferred"])
          .orderBy("updated_at", "desc")
          .orderBy("id")
          .limit(MAX_SUGGESTIONS)
          .execute()
      ).map((r) => ({ recordType: "executive_ask", recordId: r.id, label: label(r.code, r.title), state: r.status })),
  } satisfies Record<string, SuggestionReader>),
);

/** The suggestions of one question: its record types in their seeded order, at most MAX_SUGGESTIONS in all. */
async function suggestionsFor(db: DbOrTx, transformationId: string, types: readonly string[]) {
  const out: DayNinetySuggestion[] = [];
  for (const type of types) {
    if (out.length >= MAX_SUGGESTIONS) break;
    const reader = SUGGESTION_READERS.get(type);
    if (!reader) continue; // a type without a reader suggests nothing (never a guessed record)
    out.push(...(await reader(db, transformationId)));
  }
  return out.slice(0, MAX_SUGGESTIONS);
}

// ------------------------------------------------------------------------------------------------ presenter

export async function presentTest(db: DbOrTx, transformationId: string): Promise<DayNinetyTest> {
  const test = await findTest(db, transformationId);
  const [questions, responses] = await Promise.all([
    db
      .selectFrom("day_ninety_question")
      .select(["code", "ordinal", "text_en", "text_ar", "source_ref", "evidence_record_types"])
      .orderBy("ordinal")
      .execute(),
    db
      .selectFrom("day_ninety_response")
      .select(["question_code", "answer", "comment", "evidence_id", "responded_by", "updated_at"])
      .where("test_id", "=", test.id)
      .execute(),
  ]);
  const byQuestion = new Map(responses.map((r) => [r.question_code, r]));
  const out = [];
  for (const q of questions) {
    const r = byQuestion.get(q.code);
    out.push({
      code: q.code,
      ordinal: q.ordinal,
      textEn: q.text_en,
      textAr: q.text_ar,
      sourceRef: q.source_ref,
      response: r
        ? {
            answer: r.answer as "yes" | "no",
            comment: r.comment,
            evidenceId: r.evidence_id,
            respondedBy: r.responded_by,
            updatedAt: iso(r.updated_at),
          }
        : null,
      evidenceSuggestions: await suggestionsFor(db, transformationId, q.evidence_record_types),
    });
  }
  return {
    id: test.id,
    planId: test.plan_id,
    scheduledDate: dateText(test.scheduled_date),
    status: test.status as DayNinetyTest["status"],
    completion: {
      answered: test.answered_count,
      total: questions.length,
      complete: test.answered_count === questions.length,
    },
    questions: out,
    completedAt: isoOrNull(test.completed_at),
    completedBy: test.completed_by,
    version: test.version,
  };
}

// ------------------------------------------------------------------------------------------------ writes

/**
 * The write context of the Day-90 mutations: the read gate on the request principal first (an outsider gets 404,
 * ADR-0006), then day_ninety_test.respond re-checked at commit time on the grants reloaded in the transaction (a grant
 * revoked meanwhile gives 403; AUD, TO and WL get 403).
 */
async function openRespondWrite(tx: Tx, request: FastifyRequest, transformationId: string): Promise<WriteContext> {
  await requireTransformationRead(tx, principalOf(request), transformationId);
  return openWrite(tx, request, transformationId, [{ permission: DAY_NINETY_RESPOND }], null, { atCommit: true });
}

/** Locks the test row, then checks If-Match and that it is open. */
async function lockOpenTest(tx: Tx, transformationId: string, expected: number): Promise<TestRow> {
  const test = await findTest(tx, transformationId, true);
  if (test.version !== expected) throw problems.versionConflict(test.version);
  if (test.status !== "open") throw TEST_COMPLETED();
  return test;
}

async function putResponse(
  tx: Tx,
  request: FastifyRequest,
  transformationId: string,
  questionCode: string,
): Promise<void> {
  const ctx = await openRespondWrite(tx, request, transformationId);
  const body = parseBody(dayNinetyResponsePut, request.body);
  const expected = requireIfMatch(request);
  const test = await lockOpenTest(tx, transformationId, expected);
  const evidenceId = body.evidenceId ?? null;
  if (evidenceId !== null) {
    const ev = await tx
      .selectFrom("evidence")
      .select("id")
      .where("id", "=", evidenceId)
      .where("transformation_id", "=", transformationId)
      .where("archived_at", "is", null)
      .executeTakeFirst();
    if (!ev) throw EVIDENCE_INVALID();
  }
  const comment = body.comment ?? null;
  const scope = { organizationId: ctx.organizationId, transformationId };
  const existing = await tx
    .selectFrom("day_ninety_response")
    .select(["id", "answer", "comment", "evidence_id", "responded_by", "version"])
    .where("test_id", "=", test.id)
    .where("question_code", "=", questionCode)
    .forUpdate()
    .executeTakeFirst();

  let answered = test.answered_count;
  if (!existing) {
    const id = uuidv7();
    await tx
      .insertInto("day_ninety_response")
      .values({
        id,
        organization_id: ctx.organizationId,
        transformation_id: transformationId,
        test_id: test.id,
        question_code: questionCode,
        answer: body.answer,
        comment,
        evidence_id: evidenceId,
        responded_by: ctx.userId,
        created_by: ctx.userId,
        updated_by: ctx.userId,
      })
      .execute();
    answered += 1;
    await record(tx, ctx.audit, {
      action: "day_ninety_response.create",
      recordType: "day_ninety_response",
      recordId: id,
      ...scope,
      newVersion: 1,
      changes: {
        question_code: { from: null, to: questionCode },
        answer: { from: null, to: body.answer },
        comment: { from: null, to: comment },
        evidence_id: { from: null, to: evidenceId },
      },
    });
  } else {
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    if (existing.answer !== body.answer) changes["answer"] = { from: existing.answer, to: body.answer };
    if (existing.comment !== comment) changes["comment"] = { from: existing.comment, to: comment };
    if (existing.evidence_id !== evidenceId) changes["evidence_id"] = { from: existing.evidence_id, to: evidenceId };
    if (existing.responded_by !== ctx.userId) changes["responded_by"] = { from: existing.responded_by, to: ctx.userId };
    if (Object.keys(changes).length === 0) return; // the same response again: nothing changes, nothing is written
    const updated = await tx
      .updateTable("day_ninety_response")
      .set({
        answer: body.answer,
        comment,
        evidence_id: evidenceId,
        responded_by: ctx.userId,
        version: sql<number>`version + 1`,
        updated_at: sql<Date>`now()`,
        updated_by: ctx.userId,
      })
      .where("id", "=", existing.id)
      .where("version", "=", existing.version)
      .returning("version")
      .executeTakeFirstOrThrow();
    await record(tx, ctx.audit, {
      action: "day_ninety_response.update",
      recordType: "day_ninety_response",
      recordId: existing.id,
      ...scope,
      priorVersion: existing.version,
      newVersion: updated.version,
      changes,
    });
  }

  // The test steps one version on every response write (ADR-0048 §7), with answered_count = its responses.
  const stepped = await tx
    .updateTable("day_ninety_test")
    .set({
      answered_count: answered,
      version: sql<number>`version + 1`,
      updated_at: sql<Date>`now()`,
      updated_by: ctx.userId,
    })
    .where("id", "=", test.id)
    .where("version", "=", test.version)
    .returning("version")
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: "day_ninety_test.respond",
    recordType: "day_ninety_test",
    recordId: test.id,
    ...scope,
    priorVersion: test.version,
    newVersion: stepped.version,
    changes: {
      question_code: { from: null, to: questionCode },
      ...(answered !== test.answered_count ? { answered_count: { from: test.answered_count, to: answered } } : {}),
    },
  });
}

async function complete(tx: Tx, request: FastifyRequest, transformationId: string): Promise<void> {
  const ctx = await openRespondWrite(tx, request, transformationId);
  const expected = requireIfMatch(request);
  const test = await lockOpenTest(tx, transformationId, expected);
  const total = await tx
    .selectFrom("day_ninety_question")
    .select(sql<number>`count(*)::int`.as("n"))
    .executeTakeFirstOrThrow();
  if (test.answered_count < total.n) throw TEST_INCOMPLETE();
  const done = await tx
    .updateTable("day_ninety_test")
    .set({
      status: "completed",
      completed_at: sql<Date>`now()`,
      completed_by: ctx.userId,
      version: sql<number>`version + 1`,
      updated_at: sql<Date>`now()`,
      updated_by: ctx.userId,
    })
    .where("id", "=", test.id)
    .where("version", "=", test.version)
    .returning(["version", "completed_at"])
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: "day_ninety_test.complete",
    recordType: "day_ninety_test",
    recordId: test.id,
    organizationId: ctx.organizationId,
    transformationId,
    priorVersion: test.version,
    newVersion: done.version,
    changes: {
      status: { from: "open", to: "completed" },
      completed_by: { from: null, to: ctx.userId },
      completed_at: { from: null, to: isoOrNull(done.completed_at) },
    },
  });
  // The job's "test due" tasks are done once the test is complete (each closed item is audited by the tasks module).
  await closeWorkItemsOfSubject(
    tx,
    { actorType: "user", actorUserId: ctx.userId, requestId: ctx.audit.requestId, source: "api" },
    {
      organizationId: ctx.organizationId,
      subjectType: "day_ninety_test",
      subjectId: test.id,
      kinds: [DAY_NINETY_TASK_KIND],
    },
    "done",
  );
}

// ------------------------------------------------------------------------------------------------ routes

const responseParams = z.strictObject({ transformationId: z.uuid(), questionCode: z.string().regex(/^q[1-6]$/) });

/** Registers the Day-90 test routes and returns them as "METHOD /path". */
export function registerDayNinetyRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  const read = { access: { permission: "transformation.read" as const } };
  const respond = { access: { permission: DAY_NINETY_RESPOND }, consumes: JSON_BODY };
  const action = { access: { permission: DAY_NINETY_RESPOND } };

  app.get(DAY_NINETY_TEST, { config: read }, async (request, reply) => {
    const transformationId = parseTransformationParam(request.params);
    await requireTransformationRead(db, principalOf(request), transformationId);
    const body = await db
      .transaction()
      .setIsolationLevel("repeatable read")
      .setAccessMode("read only")
      .execute(async (tx) => presentTest(tx, transformationId));
    return sendVersioned(reply, 200, body);
  });

  app.put(DAY_NINETY_RESPONSE, { config: respond }, async (request, reply) => {
    const { transformationId, questionCode } = parse(responseParams, request.params, "params");
    const body = await db.transaction().execute(async (tx) => {
      await putResponse(tx, request, transformationId, questionCode);
      return presentTest(tx, transformationId);
    });
    return sendVersioned(reply, 200, body);
  });

  app.post(DAY_NINETY_COMPLETE, { config: action }, async (request, reply) => {
    const transformationId = parseTransformationParam(request.params);
    const body = await db.transaction().execute(async (tx) => {
      await complete(tx, request, transformationId);
      return presentTest(tx, transformationId);
    });
    return sendVersioned(reply, 200, body);
  });

  return [`GET ${DAY_NINETY_TEST}`, `PUT ${DAY_NINETY_RESPONSE}`, `POST ${DAY_NINETY_COMPLETE}`];
}
