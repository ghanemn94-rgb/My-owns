// Proposed rankings and their history (ADR-0022 §4, §6; REQ-S09-005, REQ-S09-003; T-DG3-BE-D):
//   GET  /transformations/{id}/prioritization/rankings                 snapshots, newest first (cursor)
//   POST /transformations/{id}/prioritization/rankings                 propose a ranking (prioritization.edit); 201
//   GET  /transformations/{id}/prioritization/rankings/{snapshotNo}    one snapshot with its entries
//   GET  /transformations/{id}/prioritization/ranking-history          every rank change with causes and labels
//
// A snapshot is a PROPOSED ranking: advisory, never a selection and never funding (REQ-S09-003). Algorithm (§4):
// every initiative with status submitted, ranked, selected, funded or launched; its latest result under the active
// weight set (a missing one is computed and appended with cause `initial`). Complete ones are sorted by the exact
// stored weighted score desc, then `code` asc (the deterministic tie-break). Approved overrides are applied in
// ascending override rank by moving the initiative to that position (the others shift). Incomplete ones follow,
// unranked. Each entry is compared with the previous (current) snapshot: `new`, `weight` (detail names the versions),
// `score` (detail lists the criteria), `override`, `relative` (rank changed with none of the above), and an entry
// with `removed` for an initiative that is no longer eligible. Complete `submitted` initiatives move to `ranked`, each
// with its own audit event. Labels: 'weight version {n}', 'score change ({criteria})', 'override: {reason}'.
import type { DbOrTx, InitiativeScoreResultRow, RankingEntryRow, RankingSnapshotRow, Tx } from "@mth/db";
import { sql } from "@mth/db";
import { transitionNote, type RankingCause, type RankingEntry, type RankingSnapshot } from "@mth/shared/schemas";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { principalOf, requireTransformationRead } from "../access/index.ts";
import { record } from "../audit/index.ts";
import {
  cursorSchema,
  decodeCursor,
  etag,
  filterHash,
  iso,
  isoOrNull,
  limitSchema,
  paginate,
  parse,
  parseBody,
  parseQuery,
  problems,
  type ModuleDeps,
} from "../platform/index.ts";
import { bumpStamps, openWrite } from "../transformations/index.ts";
import {
  appendResult,
  compareScoreDesc,
  ELIGIBLE_STATUSES,
  latestResults,
  loadActiveWeightSet,
  loadScoreMaps,
  lockPrioritization,
} from "./scores.ts";

const JSON_BODY = ["application/json"] as const;
const BASE = "/api/v1/transformations/:transformationId/prioritization";
const tParams = z.strictObject({ transformationId: z.uuid() });
const positiveInt = z
  .string()
  .regex(/^[1-9][0-9]{0,9}$/)
  .transform((s) => Number.parseInt(s, 10))
  .refine((n) => n <= 2_147_483_647);
const sParams = z.strictObject({ transformationId: z.uuid(), snapshotNo: positiveInt });

// ------------------------------------------------------------------------------------------------ schemas (contract)

// Moved to @mth/shared/schemas (prioritization.ts; T-DG3-ARCH-03): RANKING_CAUSES, RankingEntry, RankingSnapshot*,
// RankingChange and the history page.

// ------------------------------------------------------------------------------------------------ labels

interface CauseDetail {
  weightSetVersionNo?: number;
  previousWeightSetVersionNo?: number;
  overrideId?: string;
  changedCriteria?: string[];
}

/**
 * English labels rendered from the cause codes (the web renders Arabic from the same codes): `weight` ->
 * 'weight version {n}', `score` -> 'score change ({criteria})', `override` -> 'override: {reason}'; `new`,
 * `relative` and `removed` as their codes.
 */
export function causeLabels(
  causes: readonly string[],
  detail: CauseDetail,
  overrideReasons: ReadonlyMap<string, string>,
): string[] {
  return causes.map((c) => {
    if (c === "weight") return `weight version ${detail.weightSetVersionNo ?? "?"}`;
    if (c === "score") return `score change (${(detail.changedCriteria ?? []).join(", ")})`;
    if (c === "override")
      return `override: ${detail.overrideId !== undefined ? (overrideReasons.get(detail.overrideId) ?? "") : ""}`;
    return c;
  });
}

// ------------------------------------------------------------------------------------------------ presenters

async function weightSetVersions(db: DbOrTx, ids: readonly string[]): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .selectFrom("scoring_weight_set")
    .select(["id", "version_no"])
    .where("id", "in", [...new Set(ids)])
    .execute();
  return new Map(rows.map((r) => [r.id, r.version_no]));
}

function presentSnapshot(row: RankingSnapshotRow, versions: ReadonlyMap<string, number>): RankingSnapshot {
  return {
    id: row.id,
    transformationId: row.transformation_id,
    snapshotNo: row.snapshot_no,
    weightSetId: row.weight_set_id,
    weightSetVersionNo: versions.get(row.weight_set_id) ?? 1,
    status: row.status as RankingSnapshot["status"],
    note: row.note,
    proposedBy: row.proposed_by,
    proposedAt: iso(row.proposed_at),
    supersededAt: isoOrNull(row.superseded_at),
    version: row.version,
  };
}

async function overrideReasonsOf(db: DbOrTx, entries: readonly RankingEntryRow[]): Promise<Map<string, string>> {
  const ids = [...new Set(entries.map((e) => e.override_id).filter((x): x is string => x !== null))];
  if (ids.length === 0) return new Map();
  const rows = await db.selectFrom("ranking_override").select(["id", "reason"]).where("id", "in", ids).execute();
  return new Map(rows.map((r) => [r.id, r.reason]));
}

function presentEntry(row: RankingEntryRow, reasons: ReadonlyMap<string, string>): RankingEntry {
  const detail = (row.cause_detail ?? {}) as CauseDetail & Record<string, unknown>;
  return {
    initiativeId: row.initiative_id,
    rank: row.rank,
    previousRank: row.previous_rank,
    weightedScore: row.weighted_score === null ? null : String(row.weighted_score),
    completeness: row.completeness as RankingEntry["completeness"],
    causes: row.causes as RankingCause[],
    causeLabels: causeLabels(row.causes, detail, reasons),
    causeDetail: detail,
    overrideId: row.override_id,
  };
}

async function presentView(db: DbOrTx, snapshot: RankingSnapshotRow) {
  const entries = await db.selectFrom("ranking_entry").selectAll().where("snapshot_id", "=", snapshot.id).execute();
  entries.sort(entryOrder);
  const [versions, reasons] = await Promise.all([
    weightSetVersions(db, [snapshot.weight_set_id]),
    overrideReasonsOf(db, entries),
  ]);
  return { snapshot: presentSnapshot(snapshot, versions), entries: entries.map((e) => presentEntry(e, reasons)) };
}

/** Ranked entries by rank, then incomplete, then removed; ties by initiative id (stable output). */
function entryOrder(a: RankingEntryRow, b: RankingEntryRow): number {
  const bucket = (e: RankingEntryRow) => (e.rank !== null ? 0 : e.completeness === "incomplete" ? 1 : 2);
  if (bucket(a) !== bucket(b)) return bucket(a) - bucket(b);
  if (a.rank !== null && b.rank !== null) return a.rank - b.rank;
  return a.initiative_id < b.initiative_id ? -1 : a.initiative_id > b.initiative_id ? 1 : 0;
}

// ------------------------------------------------------------------------------------------------ algorithm (§4)

interface Candidate {
  readonly id: string;
  readonly code: string;
  readonly status: string;
  readonly version: number;
  readonly result: InitiativeScoreResultRow;
}

/** The criterion scores recorded in a result's `inputs` ({criterion: {score, weightPercent}}). */
function scoresOf(result: InitiativeScoreResultRow | undefined): Map<string, string | null> {
  const out = new Map<string, string | null>();
  if (!result) return out;
  const inputs = result.inputs as Record<string, { score?: unknown }> | null;
  for (const [code, v] of Object.entries(inputs ?? {})) out.set(code, typeof v?.score === "string" ? v.score : null);
  return out;
}

/** Criteria whose own score differs between two results (criteria of either set). */
function changedCriteria(
  before: InitiativeScoreResultRow | undefined,
  after: InitiativeScoreResultRow,
  criteriaOfAfter: readonly string[],
): string[] {
  const a = scoresOf(before);
  const b = scoresOf(after);
  return criteriaOfAfter.filter((c) => a.has(c) && (a.get(c) ?? null) !== (b.get(c) ?? null));
}

export interface RankingPlanEntry {
  readonly initiativeId: string;
  readonly rank: number | null;
  readonly overrideId: string | null;
}

/**
 * The ranking order (pure): complete candidates by weighted score desc, then code asc; approved overrides applied in
 * ascending override rank (then decision time and id) by moving the initiative to that position, clamped to the list.
 * Exported for unit tests.
 */
export function rankOrder(
  complete: readonly { id: string; code: string; weightedScore: string }[],
  overrides: readonly { id: string; initiativeId: string; overrideRank: number }[],
): RankingPlanEntry[] {
  const order = [...complete].sort((a, b) =>
    a.weightedScore !== b.weightedScore
      ? compareScoreDesc(a.weightedScore, b.weightedScore)
      : a.code < b.code
        ? -1
        : a.code > b.code
          ? 1
          : 0,
  );
  const ids = order.map((c) => c.id);
  const placedBy = new Map<string, string>();
  for (const o of overrides) {
    const at = ids.indexOf(o.initiativeId);
    if (at < 0) continue;
    ids.splice(at, 1);
    ids.splice(Math.min(o.overrideRank, ids.length + 1) - 1, 0, o.initiativeId);
    placedBy.set(o.initiativeId, o.id);
  }
  return ids.map((id, i) => ({ initiativeId: id, rank: i + 1, overrideId: placedBy.get(id) ?? null }));
}

async function createSnapshot(tx: Tx, request: FastifyRequest, transformationId: string) {
  const ctx = await openWrite(tx, request, transformationId, [{ permission: "prioritization.edit" }], null, {
    atCommit: true,
  });
  const body = parseBody(transitionNote, request.body);
  await lockPrioritization(tx, transformationId);
  const active = await loadActiveWeightSet(tx, transformationId);
  if (!active) throw new Error(`transformation ${transformationId} has no active weight set`);

  // 1. Eligible initiatives and their latest result under the active set (missing -> computed and appended).
  const initiatives = await tx
    .selectFrom("initiative")
    .select(["id", "code", "status", "version"])
    .where("transformation_id", "=", transformationId)
    .where("status", "in", [...ELIGIBLE_STATUSES])
    .orderBy("code")
    .forUpdate()
    .execute();
  const ids = initiatives.map((i) => i.id);
  const results = await latestResults(tx, active.set.id, ids);
  const missing = ids.filter((id) => !results.has(id));
  if (missing.length > 0) {
    const maps = await loadScoreMaps(tx, missing);
    for (const id of missing)
      results.set(
        id,
        await appendResult(tx, {
          organizationId: ctx.organizationId,
          transformationId,
          initiativeId: id,
          active,
          scores: maps.get(id) ?? {},
          cause: "initial",
          userId: ctx.userId,
        }),
      );
  }
  const candidates: Candidate[] = initiatives.map((i) => ({ ...i, result: results.get(i.id)! }));
  const complete = candidates.filter((c) => c.result.completeness === "complete" && c.result.weighted_score !== null);
  const incomplete = candidates.filter((c) => !complete.includes(c));

  // 2. Approved overrides apply from this snapshot on.
  const overrides = await tx
    .selectFrom("ranking_override")
    .select(["id", "initiative_id", "override_rank", "decided_at"])
    .where("transformation_id", "=", transformationId)
    .where("status", "=", "approved")
    .orderBy("override_rank")
    .orderBy("decided_at")
    .orderBy("id")
    .execute();
  const plan = rankOrder(
    complete.map((c) => ({ id: c.id, code: c.code, weightedScore: String(c.result.weighted_score) })),
    overrides.map((o) => ({ id: o.id, initiativeId: o.initiative_id, overrideRank: o.override_rank })),
  );

  // 3. The previous (current) snapshot, superseded by this one.
  const previous = await tx
    .selectFrom("ranking_snapshot")
    .selectAll()
    .where("transformation_id", "=", transformationId)
    .where("status", "=", "current")
    .forUpdate()
    .executeTakeFirst();
  const prevEntries = previous
    ? await tx.selectFrom("ranking_entry").selectAll().where("snapshot_id", "=", previous.id).execute()
    : [];
  const prevById = new Map(prevEntries.map((e) => [e.initiative_id, e]));
  const prevResultIds = prevEntries.map((e) => e.score_result_id).filter((x): x is string => x !== null);
  const prevResults = new Map(
    prevResultIds.length === 0
      ? []
      : (await tx.selectFrom("initiative_score_result").selectAll().where("id", "in", prevResultIds).execute()).map(
          (r) => [r.id, r],
        ),
  );
  const versions = await weightSetVersions(tx, [active.set.id, ...(previous ? [previous.weight_set_id] : [])]);
  const thisVersion = active.set.version_no;
  const prevVersion = previous ? (versions.get(previous.weight_set_id) ?? null) : null;
  const now = new Date();
  if (previous) {
    const sup = await tx
      .updateTable("ranking_snapshot")
      .set({ status: "superseded", superseded_at: now, ...bumpStamps(ctx.userId) })
      .where("id", "=", previous.id)
      .where("version", "=", previous.version)
      .returningAll()
      .executeTakeFirstOrThrow();
    await record(tx, ctx.audit, {
      action: "ranking_snapshot.supersede",
      recordType: "ranking_snapshot",
      recordId: previous.id,
      organizationId: ctx.organizationId,
      transformationId,
      priorVersion: previous.version,
      newVersion: sup.version,
      changes: { status: { from: "current", to: "superseded" } },
    });
  }
  const last = await tx
    .selectFrom("ranking_snapshot")
    .select((eb) => eb.fn.max("snapshot_no").as("max"))
    .where("transformation_id", "=", transformationId)
    .executeTakeFirst();
  const snapshotNo = (last?.max ?? 0) + 1;
  const snapshotId = uuidv7();
  const snapshot = await tx
    .insertInto("ranking_snapshot")
    .values({
      id: snapshotId,
      organization_id: ctx.organizationId,
      transformation_id: transformationId,
      snapshot_no: snapshotNo,
      weight_set_id: active.set.id,
      status: "current",
      note: body.note ?? null,
      proposed_by: ctx.userId,
      proposed_at: now,
      created_by: ctx.userId,
      updated_by: ctx.userId,
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  // 4. Entries with their causes.
  const criteria = active.weights.map((w) => w.criterionCode);
  const values: {
    initiativeId: string;
    rank: number | null;
    weightedScore: string | null;
    completeness: string;
    resultId: string | null;
    previousRank: number | null;
    causes: RankingCause[];
    detail: CauseDetail;
    overrideId: string | null;
  }[] = [];
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const causesFor = (c: Candidate, rank: number | null, overrideId: string | null) => {
    const prev = prevById.get(c.id);
    const causes: RankingCause[] = [];
    const detail: CauseDetail = { weightSetVersionNo: thisVersion };
    if (prevVersion !== null) detail.previousWeightSetVersionNo = prevVersion;
    if (!prev || prev.completeness === "removed") {
      causes.push("new");
    } else {
      if (previous && previous.weight_set_id !== active.set.id) causes.push("weight");
      const changed = changedCriteria(
        prev.score_result_id ? prevResults.get(prev.score_result_id) : undefined,
        c.result,
        criteria,
      );
      if (changed.length > 0) {
        causes.push("score");
        detail.changedCriteria = changed;
      }
    }
    if (overrideId !== null) {
      causes.push("override");
      detail.overrideId = overrideId;
    }
    if (causes.length === 0 && prev && (prev.rank ?? null) !== rank) causes.push("relative");
    return { causes, detail, previousRank: prev?.rank ?? null };
  };
  for (const p of plan) {
    const c = byId.get(p.initiativeId)!;
    const k = causesFor(c, p.rank, p.overrideId);
    values.push({
      initiativeId: c.id,
      rank: p.rank,
      weightedScore: String(c.result.weighted_score),
      completeness: "complete",
      resultId: c.result.id,
      previousRank: k.previousRank,
      causes: k.causes,
      detail: k.detail,
      overrideId: p.overrideId,
    });
  }
  for (const c of incomplete) {
    const k = causesFor(c, null, null);
    values.push({
      initiativeId: c.id,
      rank: null,
      weightedScore: null,
      completeness: "incomplete",
      resultId: c.result.id,
      previousRank: k.previousRank,
      causes: k.causes,
      detail: { ...k.detail, ...{ missingCriteria: c.result.missing_criteria } },
      overrideId: null,
    });
  }
  for (const prev of prevEntries) {
    if (byId.has(prev.initiative_id) || prev.completeness === "removed") continue;
    values.push({
      initiativeId: prev.initiative_id,
      rank: null,
      weightedScore: null,
      completeness: "removed",
      resultId: null,
      previousRank: prev.rank,
      causes: ["removed"],
      detail: {
        weightSetVersionNo: thisVersion,
        ...(prevVersion !== null ? { previousWeightSetVersionNo: prevVersion } : {}),
      },
      overrideId: null,
    });
  }
  if (values.length > 0)
    await tx
      .insertInto("ranking_entry")
      .values(
        values.map((v) => ({
          id: uuidv7(),
          organization_id: ctx.organizationId,
          transformation_id: transformationId,
          snapshot_id: snapshotId,
          initiative_id: v.initiativeId,
          rank: v.rank,
          weighted_score: v.weightedScore,
          completeness: v.completeness,
          score_result_id: v.resultId,
          previous_rank: v.previousRank,
          causes: v.causes,
          cause_detail: JSON.stringify(v.detail),
          override_id: v.overrideId,
          created_by: ctx.userId,
        })),
      )
      .execute();
  await record(tx, ctx.audit, {
    action: "ranking_snapshot.create",
    recordType: "ranking_snapshot",
    recordId: snapshotId,
    organizationId: ctx.organizationId,
    transformationId,
    newVersion: 1,
    ...(body.note !== undefined ? { reason: body.note } : {}),
    changes: {
      snapshotNo: { from: null, to: snapshotNo },
      weightSetVersionNo: { from: null, to: thisVersion },
      ranked: { from: null, to: plan.length },
      incomplete: { from: null, to: incomplete.length },
      supersedes: { from: null, to: previous ? previous.snapshot_no : null },
    },
  });

  // 5. submitted -> ranked for every complete one (ADR-0021 §3), each with its own audit event.
  for (const p of plan) {
    const c = byId.get(p.initiativeId)!;
    if (c.status !== "submitted") continue;
    const moved = await tx
      .updateTable("initiative")
      .set({ status: "ranked", ...bumpStamps(ctx.userId) })
      .where("id", "=", c.id)
      .where("version", "=", c.version)
      .returningAll()
      .executeTakeFirst();
    if (!moved) throw problems.versionConflict(c.version);
    await record(tx, ctx.audit, {
      action: "initiative.rank",
      recordType: "initiative",
      recordId: c.id,
      organizationId: ctx.organizationId,
      transformationId,
      priorVersion: c.version,
      newVersion: moved.version,
      changes: {
        status: { from: "submitted", to: "ranked" },
        rank: { from: null, to: p.rank },
        snapshotNo: { from: null, to: snapshotNo },
      },
    });
  }
  return snapshot;
}

// ------------------------------------------------------------------------------------------------ routes

const historyQuery = z.strictObject({ initiativeId: z.uuid().optional(), cursor: cursorSchema, limit: limitSchema });

export function registerRankingRoutes(app: FastifyInstance, { db }: ModuleDeps): readonly string[] {
  const R = `${BASE}/rankings`;
  const H = `${BASE}/ranking-history`;

  app.get(R, { config: { access: { permission: "transformation.read" } } }, async (request) => {
    const { transformationId } = parse(tParams, request.params, "params");
    const query = parseQuery(z.strictObject({ cursor: cursorSchema, limit: limitSchema }), request.query);
    await requireTransformationRead(db, principalOf(request), transformationId);
    const hash = filterHash({ transformationId, list: "ranking_snapshot" });
    const after = decodeCursor(query.cursor, hash, 1);
    let q = db.selectFrom("ranking_snapshot").selectAll().where("transformation_id", "=", transformationId);
    if (after) q = q.where("snapshot_no", "<", positiveInt.parse(String(after[0])));
    const rows = await q
      .orderBy("snapshot_no", "desc")
      .limit(query.limit + 1)
      .execute();
    const page = paginate(rows, query.limit, (r) => [String(r.snapshot_no)], hash);
    const versions = await weightSetVersions(
      db,
      page.items.map((r) => r.weight_set_id),
    );
    return { items: page.items.map((r) => presentSnapshot(r, versions)), nextCursor: page.nextCursor };
  });

  app.post(
    R,
    { config: { access: { permission: "prioritization.edit" }, consumes: JSON_BODY } },
    async (request, reply) => {
      const { transformationId } = parse(tParams, request.params, "params");
      const snapshot = await db.transaction().execute((tx) => createSnapshot(tx, request, transformationId));
      reply.header("ETag", etag(snapshot.version));
      reply.header(
        "Location",
        `/api/v1/transformations/${transformationId}/prioritization/rankings/${snapshot.snapshot_no}`,
      );
      return reply.code(201).send(await presentView(db, snapshot));
    },
  );

  app.get(`${R}/:snapshotNo`, { config: { access: { permission: "transformation.read" } } }, async (request) => {
    const { transformationId, snapshotNo } = parse(sParams, request.params, "params");
    await requireTransformationRead(db, principalOf(request), transformationId);
    const snapshot = await db
      .selectFrom("ranking_snapshot")
      .selectAll()
      .where("transformation_id", "=", transformationId)
      .where("snapshot_no", "=", snapshotNo)
      .executeTakeFirst();
    if (!snapshot) throw problems.notFound();
    return presentView(db, snapshot);
  });

  app.get(H, { config: { access: { permission: "transformation.read" } } }, async (request) => {
    const { transformationId } = parse(tParams, request.params, "params");
    const query = parseQuery(historyQuery, request.query);
    await requireTransformationRead(db, principalOf(request), transformationId);
    const hash = filterHash({ transformationId, list: "ranking_history", initiativeId: query.initiativeId ?? null });
    const after = decodeCursor(query.cursor, hash, 2);
    let q = db
      .selectFrom("ranking_entry as e")
      .innerJoin("ranking_snapshot as s", "s.id", "e.snapshot_id")
      .selectAll("e")
      .select(["s.snapshot_no", "s.proposed_at"])
      .where("e.transformation_id", "=", transformationId)
      .where(sql<boolean>`cardinality(e.causes) > 0`);
    if (query.initiativeId !== undefined) q = q.where("e.initiative_id", "=", query.initiativeId);
    if (after) {
      const no = positiveInt.parse(String(after[0]));
      q = q.where((eb) =>
        eb.or([
          eb("s.snapshot_no", "<", no),
          eb.and([eb("s.snapshot_no", "=", no), eb("e.id", "<", String(after[1]))]),
        ]),
      );
    }
    const rows = await q
      .orderBy("s.snapshot_no", "desc")
      .orderBy("e.id", "desc")
      .limit(query.limit + 1)
      .execute();
    const page = paginate(rows, query.limit, (r) => [String(r.snapshot_no), r.id], hash);
    const reasons = await overrideReasonsOf(db, page.items);
    return {
      items: page.items.map((r) => ({
        snapshotNo: r.snapshot_no,
        proposedAt: iso(r.proposed_at),
        entry: presentEntry(r, reasons),
      })),
      nextCursor: page.nextCursor,
    };
  });

  return [`GET ${R}`, `POST ${R}`, `GET ${R}/:snapshotNo`, `GET ${H}`];
}
