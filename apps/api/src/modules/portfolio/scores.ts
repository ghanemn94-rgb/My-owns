// T06 scores and the calculated, read-only weighted score (ADR-0022 §2, §2a, §3; REQ-PB-047, REQ-PB-048, REQ-S09-001;
// T-DG3-BE-D):
//   GET   /initiatives/{initiativeId}/scores                    the 1-5 scores and the result under the active set
//   POST  /initiatives/{initiativeId}/scores                    score one criterion (prioritization.score); 201
//   PATCH /initiatives/{initiativeId}/scores/{criterionCode}    change or clear (null) one score (If-Match)
//
// Every calculation is @mth/shared/calc (scoring.ts): this file never does arithmetic on a score or a weight. The
// weighted score is never an input (strict request objects: an unknown property such as `weightedScore` is 400); it is
// computed here and APPENDED to initiative_score_result with its cause (`initial`, `score_change`,
// `weight_set_activated`) and the version of the weight set it used. A missing score makes the result `incomplete`
// with weightedScore null, never a number and never 0. Storage is the exact numeric(7,4) value ("3.3000"); the display
// is 2 fraction digits ("3.30") and the labelled 0-100 view ("57.5").
//
// The shared prioritization helpers used by prioritization.ts (weight-set activation) and rankings.ts live here too:
// the active weight set, the score maps, the result append and the ScoreResult presenter.
import type { DbOrTx, InitiativeScoreResultRow, InitiativeScoreRow, ScoringWeightSetRow, Tx } from "@mth/db";
import { sql } from "@mth/db";
import {
  CRITERION_CODES,
  ScoringInputError,
  scoreResultView,
  weightedScore,
  type CriterionWeight,
  type ScoreMap,
} from "@mth/shared/calc";
import {
  criterionCode,
  initiativeScoreCreate,
  initiativeScoreUpdate,
  type InitiativeScore,
  type ScoreResult,
} from "@mth/shared/schemas";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { principalOf, requireTransformationRead } from "../access/index.ts";
import { record } from "../audit/index.ts";
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
import { bumpStamps, openWrite } from "../transformations/index.ts";
import { assertInitiativeEditable } from "./repository.ts";

const JSON_BODY = ["application/json"] as const;

// ------------------------------------------------------------------------------------------------ schemas (contract)

// Moved to @mth/shared/schemas (prioritization.ts; T-DG3-ARCH-03): criterionCode, InitiativeScore*, ScoreResult.

// ------------------------------------------------------------------------------------------------ shared helpers

/**
 * Advisory-lock class of the prioritization writes of one transformation (weight-set proposal and activation, ranking
 * snapshots, score results): they serialize on `pg_advisory_xact_lock(PRIORITIZATION_LOCK_CLASS, hashtext(transformation_id))`, so the
 * next version/snapshot number and the "latest result" are never computed from a concurrent, uncommitted state.
 * Registry: ADVISORY_LOCK_CLASSES (platform), ADR-0016.
 */
export const PRIORITIZATION_LOCK_CLASS = ADVISORY_LOCK_CLASSES.prioritization;

export async function lockPrioritization(tx: Tx, transformationId: string): Promise<void> {
  await sql`select pg_advisory_xact_lock(${PRIORITIZATION_LOCK_CLASS}, hashtext(${transformationId}))`.execute(tx);
}

/**
 * Exact comparison of two stored numeric(7,4) scores (always one integer digit 1-5 and four fraction digits, e.g.
 * "3.3000"): the fixed format makes the string order the numeric order, with no binary floating point.
 */
export function compareScoreDesc(a: string, b: string): number {
  return a === b ? 0 : a < b ? 1 : -1;
}

/** Initiative statuses that take part in prioritization (ADR-0022 §4 "Algorithm"). */
export const ELIGIBLE_STATUSES = ["submitted", "ranked", "selected", "funded", "launched"] as const;

export interface WeightSetWithWeights {
  readonly set: ScoringWeightSetRow;
  /** The set's weights in criterion-catalogue order, as exact decimal strings ("25.00"). */
  readonly weights: readonly CriterionWeight[];
}

const CRITERION_ORDER = new Map<string, number>(CRITERION_CODES.map((c, i) => [c, i]));
const byCriterion = (a: { criterionCode: string }, b: { criterionCode: string }) =>
  (CRITERION_ORDER.get(a.criterionCode) ?? 99) - (CRITERION_ORDER.get(b.criterionCode) ?? 99);

/** The weights of each set (criterion-catalogue order). */
export async function loadWeights(db: DbOrTx, setIds: readonly string[]): Promise<Map<string, CriterionWeight[]>> {
  const out = new Map<string, CriterionWeight[]>();
  if (setIds.length === 0) return out;
  const rows = await db
    .selectFrom("scoring_weight")
    .select(["weight_set_id", "criterion_code", "weight_percent"])
    .where("weight_set_id", "in", [...setIds])
    .execute();
  for (const r of rows) {
    const list = out.get(r.weight_set_id) ?? [];
    list.push({ criterionCode: r.criterion_code, weightPercent: String(r.weight_percent) });
    out.set(r.weight_set_id, list);
  }
  for (const list of out.values()) list.sort(byCriterion);
  return out;
}

/** The active weight set of a transformation with its weights (v1 is seeded at instantiation), or null. */
export async function loadActiveWeightSet(db: DbOrTx, transformationId: string): Promise<WeightSetWithWeights | null> {
  const set = await db
    .selectFrom("scoring_weight_set")
    .selectAll()
    .where("transformation_id", "=", transformationId)
    .where("status", "=", "active")
    .executeTakeFirst();
  if (!set) return null;
  return { set, weights: (await loadWeights(db, [set.id])).get(set.id) ?? [] };
}

/**
 * The current scores per initiative as ScoreMaps for scoring.ts. A smallint arrives as a JS integer; scoring.ts turns
 * it into its digit string before any arithmetic (ADR-0022 §2a item 3). A cleared score (NULL) is "not scored".
 */
export async function loadScoreMaps(db: DbOrTx, initiativeIds: readonly string[]): Promise<Map<string, ScoreMap>> {
  const out = new Map<string, ScoreMap>();
  if (initiativeIds.length === 0) return out;
  const rows = await db
    .selectFrom("initiative_score")
    .select(["initiative_id", "criterion_code", "score"])
    .where("initiative_id", "in", [...initiativeIds])
    .execute();
  const grouped = new Map<string, [string, number | null][]>();
  for (const r of rows) {
    const list = grouped.get(r.initiative_id) ?? [];
    list.push([r.criterion_code, r.score]);
    grouped.set(r.initiative_id, list);
  }
  for (const id of initiativeIds) out.set(id, Object.fromEntries(grouped.get(id) ?? []) as ScoreMap);
  return out;
}

/** scoring.ts on STORED rows: a ScoringInputError here means corrupt data (ADR-0022 §2a item 2) -> 500, never a score. */
export function computeStored(scores: ScoreMap, weights: readonly CriterionWeight[]) {
  try {
    return weightedScore(scores, weights);
  } catch (err) {
    if (err instanceof ScoringInputError)
      throw new Error(`stored prioritization data is invalid (${err.code} at ${err.pointer})`, { cause: err });
    throw err;
  }
}

/** The latest result of each initiative under one weight set (append-only rows; newest computed_at, then id). */
export async function latestResults(
  db: DbOrTx,
  weightSetId: string,
  initiativeIds: readonly string[],
): Promise<Map<string, InitiativeScoreResultRow>> {
  const out = new Map<string, InitiativeScoreResultRow>();
  if (initiativeIds.length === 0) return out;
  const rows = await db
    .selectFrom("initiative_score_result")
    .selectAll()
    .where("weight_set_id", "=", weightSetId)
    .where("initiative_id", "in", [...initiativeIds])
    .orderBy("initiative_id")
    .orderBy("computed_at", "desc")
    .orderBy("id", "desc")
    .execute();
  for (const r of rows) if (!out.has(r.initiative_id)) out.set(r.initiative_id, r);
  return out;
}

export type ResultCause = "initial" | "score_change" | "weight_set_activated";

/**
 * Computes the initiative's result under `active` from its CURRENT scores (scoring.ts) and appends it to
 * initiative_score_result with its cause. Returns the new row.
 */
export async function appendResult(
  tx: Tx,
  input: {
    readonly organizationId: string;
    readonly transformationId: string;
    readonly initiativeId: string;
    readonly active: WeightSetWithWeights;
    readonly scores: ScoreMap;
    readonly cause: ResultCause;
    readonly userId: string;
  },
): Promise<InitiativeScoreResultRow> {
  const r = computeStored(input.scores, input.active.weights);
  return tx
    .insertInto("initiative_score_result")
    .values({
      id: uuidv7(),
      organization_id: input.organizationId,
      transformation_id: input.transformationId,
      initiative_id: input.initiativeId,
      weight_set_id: input.active.set.id,
      weight_set_version_no: input.active.set.version_no,
      weighted_score: r.weightedScore,
      completeness: r.completeness,
      missing_criteria: [...r.missingCriteria],
      inputs: JSON.stringify(r.inputs),
      cause: input.cause,
      computed_by: input.userId,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

/** Contract `ScoreResult` from a stored result row (display values from scoring.ts). */
export function presentResult(row: InitiativeScoreResultRow): ScoreResult {
  return {
    weightSetVersionNo: row.weight_set_version_no,
    ...scoreResultView({
      completeness: row.completeness === "complete" ? "complete" : "incomplete",
      weightedScore: row.weighted_score === null ? null : String(row.weighted_score),
      missingCriteria: row.missing_criteria,
    }),
    computedAt: iso(row.computed_at),
  } as ScoreResult;
}

/** Contract `ScoreResult` computed live (no stored result under the active set yet): computedAt null. */
export function presentLiveResult(scores: ScoreMap, active: WeightSetWithWeights): ScoreResult {
  const r = computeStored(scores, active.weights);
  return {
    weightSetVersionNo: active.set.version_no,
    ...scoreResultView(r),
    computedAt: null,
  } as ScoreResult;
}

/** The stored result if any, else the live one; Unknown (incomplete) is never a number. */
export function resultOrLive(
  stored: InitiativeScoreResultRow | undefined,
  scores: ScoreMap,
  active: WeightSetWithWeights,
): ScoreResult {
  return stored ? presentResult(stored) : presentLiveResult(scores, active);
}

// ------------------------------------------------------------------------------------------------ scores

function presentScore(row: InitiativeScoreRow): InitiativeScore {
  return {
    id: row.id,
    organizationId: row.organization_id,
    transformationId: row.transformation_id,
    initiativeId: row.initiative_id,
    criterionCode: row.criterion_code as InitiativeScore["criterionCode"],
    score: row.score,
    note: row.note,
    scoredBy: row.scored_by,
    scoredAt: isoOrNull(row.scored_at),
    version: row.version,
    createdAt: iso(row.created_at),
    createdBy: row.created_by,
    updatedAt: iso(row.updated_at),
    updatedBy: row.updated_by,
  };
}

const iParams = z.strictObject({ initiativeId: z.uuid() });
const cParams = z.strictObject({ initiativeId: z.uuid(), criterionCode });

/** The initiative's transformation (404 when it does not exist; the read gate then hides unreadable ones as 404). */
async function initiativeHome(db: DbOrTx, initiativeId: string) {
  const row = await db
    .selectFrom("initiative")
    .select(["id", "transformation_id", "organization_id"])
    .where("id", "=", initiativeId)
    .executeTakeFirst();
  if (!row) throw problems.notFound();
  return row;
}

/** Appends the result under the active set after a score change, and returns the audit diff of the weighted score. */
async function rescore(
  tx: Tx,
  ctx: { organizationId: string; transformationId: string; userId: string },
  initiativeId: string,
) {
  const active = await loadActiveWeightSet(tx, ctx.transformationId);
  if (!active) return {};
  const before = (await latestResults(tx, active.set.id, [initiativeId])).get(initiativeId);
  const scores = (await loadScoreMaps(tx, [initiativeId])).get(initiativeId) ?? {};
  const after = await appendResult(tx, {
    organizationId: ctx.organizationId,
    transformationId: ctx.transformationId,
    initiativeId,
    active,
    scores,
    cause: before ? "score_change" : "initial",
    userId: ctx.userId,
  });
  return {
    weightedScore: { from: before ? before.weighted_score : null, to: after.weighted_score },
    completeness: { from: before ? before.completeness : null, to: after.completeness },
  };
}

async function createScore(tx: Tx, request: FastifyRequest, initiativeId: string) {
  const home = await initiativeHome(tx, initiativeId);
  const ctx = await openWrite(tx, request, home.transformation_id, [{ permission: "prioritization.score" }], null, {
    atCommit: true,
  });
  const body = parseBody(initiativeScoreCreate, request.body);
  await assertInitiativeEditable(tx, initiativeId);
  await lockPrioritization(tx, home.transformation_id);
  const existing = await tx
    .selectFrom("initiative_score")
    .select("id")
    .where("initiative_id", "=", initiativeId)
    .where("criterion_code", "=", body.criterionCode)
    .executeTakeFirst();
  if (existing)
    throw problems.duplicate(
      "prioritization.score_exists",
      "This criterion already has a score for the initiative; change it with PATCH.",
    );
  const id = uuidv7();
  const row = await tx
    .insertInto("initiative_score")
    .values({
      id,
      organization_id: ctx.organizationId,
      transformation_id: home.transformation_id,
      initiative_id: initiativeId,
      criterion_code: body.criterionCode,
      score: body.score,
      note: body.note ?? null,
      scored_by: ctx.userId,
      scored_at: new Date(),
      created_by: ctx.userId,
      updated_by: ctx.userId,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  const resultDiff = await rescore(tx, ctx, initiativeId);
  await record(tx, ctx.audit, {
    action: "initiative_score.create",
    recordType: "initiative_score",
    recordId: id,
    organizationId: ctx.organizationId,
    transformationId: home.transformation_id,
    newVersion: 1,
    changes: {
      initiativeId: { from: null, to: initiativeId },
      criterionCode: { from: null, to: body.criterionCode },
      score: { from: null, to: String(body.score) },
      note: { from: null, to: body.note ?? null },
      ...resultDiff,
    },
  });
  return row;
}

async function updateScore(tx: Tx, request: FastifyRequest, initiativeId: string, code: string) {
  const home = await initiativeHome(tx, initiativeId);
  const ctx = await openWrite(tx, request, home.transformation_id, [{ permission: "prioritization.score" }], null, {
    atCommit: true,
  });
  const body = parseBody(initiativeScoreUpdate, request.body);
  const expected = requireIfMatch(request);
  await lockPrioritization(tx, home.transformation_id);
  const current = await tx
    .selectFrom("initiative_score")
    .selectAll()
    .where("initiative_id", "=", initiativeId)
    .where("criterion_code", "=", code)
    .forUpdate()
    .executeTakeFirst();
  if (!current) throw problems.notFound();
  if (current.version !== expected) throw problems.versionConflict(current.version);
  await assertInitiativeEditable(tx, initiativeId);
  const note = body.note === undefined ? current.note : body.note;
  const updated = await tx
    .updateTable("initiative_score")
    .set({
      score: body.score,
      note,
      scored_by: body.score === null ? null : ctx.userId,
      scored_at: body.score === null ? null : new Date(),
      ...bumpStamps(ctx.userId),
    })
    .where("id", "=", current.id)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  const resultDiff = await rescore(tx, ctx, initiativeId);
  await record(tx, ctx.audit, {
    action: "initiative_score.update",
    recordType: "initiative_score",
    recordId: current.id,
    organizationId: ctx.organizationId,
    transformationId: home.transformation_id,
    priorVersion: current.version,
    newVersion: updated.version,
    changes: {
      score: {
        from: current.score === null ? null : String(current.score),
        to: body.score === null ? null : String(body.score),
      },
      ...(body.note !== undefined ? { note: { from: current.note, to: body.note } } : {}),
      ...resultDiff,
    },
  });
  return updated;
}

// ------------------------------------------------------------------------------------------------ routes

export function registerScoreRoutes(app: FastifyInstance, { db }: ModuleDeps): readonly string[] {
  const BASE = "/api/v1/initiatives/:initiativeId/scores";

  app.get(BASE, { config: { access: { permission: "transformation.read" } } }, async (request) => {
    const { initiativeId } = parse(iParams, request.params, "params");
    const home = await initiativeHome(db, initiativeId);
    await requireTransformationRead(db, principalOf(request), home.transformation_id);
    const rows = await db
      .selectFrom("initiative_score")
      .selectAll()
      .where("initiative_id", "=", initiativeId)
      .execute();
    rows.sort((a, b) => byCriterion({ criterionCode: a.criterion_code }, { criterionCode: b.criterion_code }));
    const active = await loadActiveWeightSet(db, home.transformation_id);
    if (!active) throw new Error(`transformation ${home.transformation_id} has no active weight set`);
    const stored = (await latestResults(db, active.set.id, [initiativeId])).get(initiativeId);
    const scores = (await loadScoreMaps(db, [initiativeId])).get(initiativeId) ?? {};
    return { initiativeId, scores: rows.map(presentScore), result: resultOrLive(stored, scores, active) };
  });

  app.post(
    BASE,
    { config: { access: { permission: "prioritization.score" }, consumes: JSON_BODY } },
    async (request, reply) => {
      const { initiativeId } = parse(iParams, request.params, "params");
      const row = await db.transaction().execute((tx) => createScore(tx, request, initiativeId));
      return sendVersioned(
        reply,
        201,
        presentScore(row),
        `${BASE.replace(":initiativeId", initiativeId)}/${row.criterion_code}`,
      );
    },
  );

  app.patch(
    `${BASE}/:criterionCode`,
    { config: { access: { permission: "prioritization.score" }, consumes: JSON_BODY } },
    async (request, reply) => {
      const { initiativeId, criterionCode: code } = parse(cParams, request.params, "params");
      const row = await db.transaction().execute((tx) => updateScore(tx, request, initiativeId, code));
      return sendVersioned(reply, 200, presentScore(row));
    },
  );

  return [`GET ${BASE}`, `POST ${BASE}`, `PATCH ${BASE}/:criterionCode`];
}
