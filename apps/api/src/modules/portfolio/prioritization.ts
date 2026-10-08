// Weight sets and the prioritization view (ADR-0022 §1, §3, §6, §7; REQ-PB-049, REQ-S09-001, REQ-S09-003,
// REQ-S09-004; T-DG3-BE-D):
//   GET  /transformations/{id}/prioritization                                 ranked table + value/feasibility view
//   GET  /transformations/{id}/prioritization/weight-sets                     every version, newest first
//   POST /transformations/{id}/prioritization/weight-sets                     propose the next version (prioritization.edit)
//   GET  /transformations/{id}/prioritization/weight-sets/{versionNo}         one version
//   POST /transformations/{id}/prioritization/weight-sets/{versionNo}/approve activate it (prioritization.approve)
//   POST /transformations/{id}/prioritization/weight-sets/{versionNo}/withdraw withdraw a proposal (prioritization.edit)
//
// A weight set is immutable from creation (append-only weights, DB freeze trigger); a correction is a new proposal.
// Weights must total exactly 100%: @mth/shared/calc validateWeightSet answers 422 with the first problem
// (`prioritization.weights_total` 'Weights must total 100% (got 95.00%)' for 95% or 105%) and NOTHING is written; the
// deferred DB trigger `scoring_weight_set_total` is the last line of defence. Approving a set is a BUSINESS approval
// inside the product (SP by default; never the proposer, DB CHECK as well): it supersedes the active set and appends a
// result under the new version for every eligible initiative. Results computed under the old version keep their
// weight_set_id forever (append-only). Ranking != selection != funding: the view shows three separate columns.
// Nothing here touches the engineering delivery gates DG0-DG7.
import type { DbOrTx, InitiativeRow, ScoringWeightSetRow, Tx } from "@mth/db";
import {
  axisScore,
  DISPLAY100_LABEL_EN,
  FEASIBILITY_AXIS_CRITERIA,
  validateWeightSet,
  VALUE_AXIS_CRITERIA,
  type CriterionWeight,
} from "@mth/shared/calc";
import {
  prioritizationQuery,
  reasonRequest,
  transitionNote,
  weightSetCreate,
  type FundingState,
  type Initiative,
  type PrioritizationQuery,
  type PrioritizationView,
  type ScheduleFlag,
  type WeightSet,
} from "@mth/shared/schemas";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { principalOf, requireTransformationRead } from "../access/index.ts";
import { record } from "../audit/index.ts";
import {
  HttpProblem,
  iso,
  isoOrNull,
  parse,
  parseBody,
  parseQuery,
  problems,
  requireIfMatch,
  sendVersioned,
  type ModuleDeps,
} from "../platform/index.ts";
import { bumpStamps, openWrite } from "../transformations/index.ts";
import { latestFundingState } from "./funding.ts";
import {
  appendResult,
  compareScoreDesc,
  ELIGIBLE_STATUSES,
  latestResults,
  loadActiveWeightSet,
  loadScoreMaps,
  loadWeights,
  lockPrioritization,
  resultOrLive,
  type WeightSetWithWeights,
} from "./scores.ts";

const JSON_BODY = ["application/json"] as const;
const T_BASE = "/api/v1/transformations/:transformationId/prioritization";
const tParams = z.strictObject({ transformationId: z.uuid() });
const vParams = z.strictObject({
  transformationId: z.uuid(),
  versionNo: z
    .string()
    .regex(/^[1-9][0-9]{0,9}$/)
    .transform((s) => Number.parseInt(s, 10))
    .refine((n) => n <= 2_147_483_647),
});

// ------------------------------------------------------------------------------------------------ schemas (contract)

// Moved to @mth/shared/schemas (prioritization.ts; T-DG3-ARCH-03): WeightSet*, PrioritizationItem/View and the query.

// ------------------------------------------------------------------------------------------------ presenters

export function presentWeightSet(row: ScoringWeightSetRow, weights: readonly CriterionWeight[]): WeightSet {
  return {
    id: row.id,
    organizationId: row.organization_id,
    transformationId: row.transformation_id,
    versionNo: row.version_no,
    status: row.status as WeightSet["status"],
    approvalBasis: row.approval_basis as WeightSet["approvalBasis"],
    rationale: row.rationale,
    weights: weights.map((w) => ({
      criterionCode: w.criterionCode as WeightSet["weights"][number]["criterionCode"],
      weightPercent: w.weightPercent,
    })),
    approvedBy: row.approved_by,
    approvedAt: isoOrNull(row.approved_at),
    activatedAt: isoOrNull(row.activated_at),
    supersededAt: isoOrNull(row.superseded_at),
    version: row.version,
    createdAt: iso(row.created_at),
    createdBy: row.created_by,
    updatedAt: iso(row.updated_at),
    updatedBy: row.updated_by,
  };
}

async function presentSets(db: DbOrTx, rows: readonly ScoringWeightSetRow[]): Promise<WeightSet[]> {
  const weights = await loadWeights(
    db,
    rows.map((r) => r.id),
  );
  return rows.map((r) => presentWeightSet(r, weights.get(r.id) ?? []));
}

const weightsAudit = (weights: readonly CriterionWeight[]) =>
  Object.fromEntries(weights.map((w) => [w.criterionCode, w.weightPercent]));

// ------------------------------------------------------------------------------------------------ rules

const rule = (code: string, detail: string, pointer: string) =>
  new HttpProblem({
    status: 422,
    type: "urn:mth:problem:validation",
    code,
    title: "Business rule violated",
    detail,
    errors: [{ pointer, code, message: detail }],
  });
const transition = (code: string, detail: string) =>
  new HttpProblem({
    status: 422,
    type: "urn:mth:problem:invalid-transition",
    code,
    title: "Invalid transition",
    detail,
  });
/** Separation of duties: the same code and text as the DB CHECK mapping (`*_approver_not_proposer`, db-errors.ts). */
export const approverIsProposer = () =>
  new HttpProblem({
    status: 403,
    type: "urn:mth:problem:forbidden",
    code: "approval.approver_is_proposer",
    title: "Forbidden",
    detail: "The person who proposed this cannot approve it (separation of duties).",
  });

async function lockSet(tx: Tx, transformationId: string, versionNo: number): Promise<ScoringWeightSetRow> {
  const row = await tx
    .selectFrom("scoring_weight_set")
    .selectAll()
    .where("transformation_id", "=", transformationId)
    .where("version_no", "=", versionNo)
    .forUpdate()
    .executeTakeFirst();
  if (!row) throw problems.notFound();
  return row;
}

// ------------------------------------------------------------------------------------------------ create

async function createWeightSet(tx: Tx, request: FastifyRequest, transformationId: string) {
  const ctx = await openWrite(tx, request, transformationId, [{ permission: "prioritization.edit" }], null, {
    atCommit: true,
  });
  const body = parseBody(weightSetCreate, request.body);
  // ADR-0022 §2a item 2: every validateWeightSet problem on a schema-valid body is 422 with the FIRST problem's code,
  // detail and pointer; weights_total is checked last. Nothing is written before this check.
  const checked = validateWeightSet(body.weights);
  if (!checked.ok) {
    const first = checked.problems[0]!;
    throw rule(first.code, first.detail, first.pointer);
  }
  await lockPrioritization(tx, transformationId);
  const last = await tx
    .selectFrom("scoring_weight_set")
    .select((eb) => eb.fn.max("version_no").as("max"))
    .where("transformation_id", "=", transformationId)
    .executeTakeFirst();
  const versionNo = (last?.max ?? 0) + 1;
  const id = uuidv7();
  const row = await tx
    .insertInto("scoring_weight_set")
    .values({
      id,
      organization_id: ctx.organizationId,
      transformation_id: transformationId,
      version_no: versionNo,
      status: "proposed",
      rationale: body.rationale,
      created_by: ctx.userId,
      updated_by: ctx.userId,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await tx
    .insertInto("scoring_weight")
    .values(
      body.weights.map((w) => ({
        id: uuidv7(),
        organization_id: ctx.organizationId,
        transformation_id: transformationId,
        weight_set_id: id,
        criterion_code: w.criterionCode,
        weight_percent: w.weightPercent,
        created_by: ctx.userId,
      })),
    )
    .execute();
  const weights = (await loadWeights(tx, [id])).get(id) ?? [];
  await record(tx, ctx.audit, {
    action: "scoring_weight_set.create",
    recordType: "scoring_weight_set",
    recordId: id,
    organizationId: ctx.organizationId,
    transformationId,
    newVersion: 1,
    reason: body.rationale,
    changes: {
      versionNo: { from: null, to: versionNo },
      status: { from: null, to: "proposed" },
      weights: { from: null, to: weightsAudit(weights) },
    },
  });
  return presentWeightSet(row, weights);
}

// ------------------------------------------------------------------------------------------------ approve (activate)

async function approveWeightSet(tx: Tx, request: FastifyRequest, transformationId: string, versionNo: number) {
  const ctx = await openWrite(tx, request, transformationId, [{ permission: "prioritization.approve" }], null, {
    atCommit: true,
  });
  const body = parseBody(transitionNote, request.body);
  const expected = requireIfMatch(request);
  await lockPrioritization(tx, transformationId);
  const current = await lockSet(tx, transformationId, versionNo);
  if (current.version !== expected) throw problems.versionConflict(current.version);
  if (current.created_by === ctx.userId) throw approverIsProposer();
  if (current.status !== "proposed")
    throw transition("prioritization.weight_set_not_proposed", "Only a proposed weight set can be approved.");
  const now = new Date();
  // 1. Supersede the active set (the partial unique index allows one active set per transformation).
  const previous = await tx
    .selectFrom("scoring_weight_set")
    .selectAll()
    .where("transformation_id", "=", transformationId)
    .where("status", "=", "active")
    .forUpdate()
    .executeTakeFirst();
  if (previous) {
    const sup = await tx
      .updateTable("scoring_weight_set")
      .set({ status: "superseded", superseded_at: now, ...bumpStamps(ctx.userId) })
      .where("id", "=", previous.id)
      .where("version", "=", previous.version)
      .returningAll()
      .executeTakeFirstOrThrow();
    await record(tx, ctx.audit, {
      action: "scoring_weight_set.supersede",
      recordType: "scoring_weight_set",
      recordId: previous.id,
      organizationId: ctx.organizationId,
      transformationId,
      priorVersion: previous.version,
      newVersion: sup.version,
      changes: { status: { from: "active", to: "superseded" }, supersededBy: { from: null, to: versionNo } },
    });
  }
  // 2. Activate this one: a business approval recorded with the approver, the time and the request version.
  const updated = await tx
    .updateTable("scoring_weight_set")
    .set({
      status: "active",
      approval_basis: "approved",
      approved_by: ctx.userId,
      approved_at: now,
      activated_at: now,
      ...bumpStamps(ctx.userId),
    })
    .where("id", "=", current.id)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  // 3. Append a result under the new version for every eligible initiative (old results keep their reference).
  const weights = (await loadWeights(tx, [current.id])).get(current.id) ?? [];
  const active: WeightSetWithWeights = { set: updated, weights };
  const eligible = await tx
    .selectFrom("initiative")
    .select("id")
    .where("transformation_id", "=", transformationId)
    .where("status", "in", [...ELIGIBLE_STATUSES])
    .orderBy("code")
    .execute();
  const scoreMaps = await loadScoreMaps(
    tx,
    eligible.map((i) => i.id),
  );
  for (const i of eligible)
    await appendResult(tx, {
      organizationId: ctx.organizationId,
      transformationId,
      initiativeId: i.id,
      active,
      scores: scoreMaps.get(i.id) ?? {},
      cause: "weight_set_activated",
      userId: ctx.userId,
    });
  await record(tx, ctx.audit, {
    action: "scoring_weight_set.approve",
    recordType: "scoring_weight_set",
    recordId: current.id,
    organizationId: ctx.organizationId,
    transformationId,
    priorVersion: current.version,
    newVersion: updated.version,
    ...(body.note !== undefined ? { reason: body.note } : {}),
    changes: {
      status: { from: "proposed", to: "active" },
      approvedBy: { from: null, to: ctx.userId },
      supersedes: { from: null, to: previous ? previous.version_no : null },
      rescoredInitiatives: { from: null, to: eligible.length },
    },
  });
  return presentWeightSet(updated, weights);
}

// ------------------------------------------------------------------------------------------------ withdraw

async function withdrawWeightSet(tx: Tx, request: FastifyRequest, transformationId: string, versionNo: number) {
  const ctx = await openWrite(tx, request, transformationId, [{ permission: "prioritization.edit" }], null, {
    atCommit: true,
  });
  const body = parseBody(reasonRequest, request.body);
  const expected = requireIfMatch(request);
  const current = await lockSet(tx, transformationId, versionNo);
  if (current.version !== expected) throw problems.versionConflict(current.version);
  if (current.status !== "proposed")
    throw transition("prioritization.weight_set_not_proposed", "Only a proposed weight set can be withdrawn.");
  const updated = await tx
    .updateTable("scoring_weight_set")
    .set({ status: "withdrawn", ...bumpStamps(ctx.userId) })
    .where("id", "=", current.id)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: "scoring_weight_set.withdraw",
    recordType: "scoring_weight_set",
    recordId: current.id,
    organizationId: ctx.organizationId,
    transformationId,
    priorVersion: current.version,
    newVersion: updated.version,
    reason: body.reason,
    changes: { status: { from: "proposed", to: "withdrawn" } },
  });
  return (await presentSets(tx, [updated]))[0]!;
}

// ------------------------------------------------------------------------------------------------ view (§7)

/** Flags for a set of initiatives (warnings, never rejections), keyed by initiative id. */
export type FlagSource = (
  db: DbOrTx,
  transformationId: string,
  initiativeIds: readonly string[],
) => Promise<ReadonlyMap<string, readonly ScheduleFlag[]>>;

export interface PrioritizationFlagSources {
  /** Sequencing flags (ADR-0023 §5; BE-C `schedule.ts`). */
  readonly scheduleFlags: FlagSource;
  /** Capacity flags (ADR-0023 §6; BE-E `capacity.ts`). */
  readonly capacityFlags: FlagSource;
}

const noFlags: FlagSource = async () => new Map();

/**
 * The flag sources the view uses. Defaults return no flags; BE-E replaces ONLY these two lines with the schedule
 * (BE-C `schedule.ts`) and capacity (BE-E `capacity.ts`) sources after integration (p3-work-split §2 BE-E).
 */
export const DEFAULT_FLAG_SOURCES: PrioritizationFlagSources = {
  scheduleFlags: noFlags,
  capacityFlags: noFlags,
};

/** ADR-0022 §7: one transformation's portfolio, at most 500 initiatives; cursor pagination does not apply. */
export const PORTFOLIO_VIEW_MAX = 500;

const SELECTED_STATUSES = new Set(["selected", "funded", "launched"]);

function presentInitiative(row: InitiativeRow, fundingState: FundingState, flags: readonly ScheduleFlag[]): Initiative {
  const displayStatus = row.status === "selected" && fundingState !== "funded" ? "Selected - unfunded" : row.status;
  const dateText = (d: unknown) => (d === null || d === undefined ? null : String(d).slice(0, 10));
  return {
    id: row.id,
    organizationId: row.organization_id,
    transformationId: row.transformation_id,
    code: row.code,
    name: row.name,
    executiveOwnerUserId: row.executive_owner_user_id,
    workstreamLeadUserId: row.workstream_lead_user_id,
    problemStatement: row.problem_statement,
    objective: row.objective,
    scopeIn: row.scope_in,
    scopeOut: row.scope_out,
    financialBenefitSummary: row.financial_benefit_summary,
    customerBenefitSummary: row.customer_benefit_summary,
    risksSummary: row.risks_summary,
    waveId: row.wave_id,
    plannedStart: dateText(row.planned_start),
    plannedEnd: dateText(row.planned_end),
    status: row.status as Initiative["status"],
    fundingState,
    displayStatus,
    launchedAt: isoOrNull(row.launched_at),
    launchedBy: row.launched_by,
    cancelledAt: isoOrNull(row.cancelled_at),
    cancelledBy: row.cancelled_by,
    cancelReason: row.cancel_reason,
    warnings: [],
    flags: [...flags],
    version: row.version,
    createdAt: iso(row.created_at),
    createdBy: row.created_by,
    updatedAt: iso(row.updated_at),
    updatedBy: row.updated_by,
  };
}

/**
 * The prioritization view (ADR-0022 §7) of every eligible initiative: the latest result under the active set (or the
 * live one when none is stored), the 0-100 view, the value and feasibility axes (@mth/shared/calc axisScore; null =
 * Unknown, never 0), the proposed rank of the current snapshot, selection and funding as SEPARATE columns
 * (REQ-S09-003), the wave and the sequencing and capacity flags. Ranked rows first (by rank), then the unranked ones
 * by weighted score desc and code. Exported for tests with injected flag sources.
 */
export async function buildPrioritizationView(
  db: DbOrTx,
  transformationId: string,
  query: PrioritizationQuery,
  sources: PrioritizationFlagSources = DEFAULT_FLAG_SOURCES,
): Promise<PrioritizationView> {
  const active = await loadActiveWeightSet(db, transformationId);
  if (!active) throw new Error(`transformation ${transformationId} has no active weight set`);
  const count = await db
    .selectFrom("initiative")
    .select((eb) => eb.fn.countAll<string>().as("n"))
    .where("transformation_id", "=", transformationId)
    .where("status", "in", [...ELIGIBLE_STATUSES])
    .executeTakeFirstOrThrow();
  if (BigInt(count.n) > BigInt(PORTFOLIO_VIEW_MAX))
    throw problems.businessRule(
      "prioritization.portfolio_too_large",
      `The prioritization view covers at most ${PORTFOLIO_VIEW_MAX} initiatives (got ${count.n}).`,
    );
  let q = db
    .selectFrom("initiative")
    .selectAll()
    .where("transformation_id", "=", transformationId)
    .where("status", "in", [...ELIGIBLE_STATUSES]);
  if (query.status !== undefined) q = q.where("status", "=", query.status);
  if (query.waveId !== undefined) q = q.where("wave_id", "=", query.waveId);
  const rows = await q.orderBy("code").execute();
  const ids = rows.map((r) => r.id);
  const [stored, scoreMaps, schedule, capacity] = await Promise.all([
    latestResults(db, active.set.id, ids),
    loadScoreMaps(db, ids),
    sources.scheduleFlags(db, transformationId, ids),
    sources.capacityFlags(db, transformationId, ids),
  ]);
  const snapshot = await db
    .selectFrom("ranking_snapshot")
    .select("id")
    .where("transformation_id", "=", transformationId)
    .where("status", "=", "current")
    .executeTakeFirst();
  const ranks = new Map<string, number>();
  if (snapshot) {
    const entries = await db
      .selectFrom("ranking_entry")
      .select(["initiative_id", "rank"])
      .where("snapshot_id", "=", snapshot.id)
      .where("rank", "is not", null)
      .execute();
    for (const e of entries) if (e.rank !== null) ranks.set(e.initiative_id, e.rank);
  }
  const items: PrioritizationView["items"] = [];
  for (const row of rows) {
    const scores = scoreMaps.get(row.id) ?? {};
    const result = resultOrLive(stored.get(row.id), scores, active);
    const selected = SELECTED_STATUSES.has(row.status);
    const funding: FundingState = selected ? await latestFundingState(db, row.id) : "not_applicable";
    const flags = [...(schedule.get(row.id) ?? []), ...(capacity.get(row.id) ?? [])];
    if (query.completeness !== undefined && result.completeness !== query.completeness) continue;
    if (query.funding !== undefined && funding !== query.funding) continue;
    if (query.flag !== undefined && !flags.some((f) => f.code === query.flag)) continue;
    items.push({
      initiative: presentInitiative(row, funding, flags),
      result,
      rank: ranks.get(row.id) ?? null,
      valueAxis: axisScore(scores, active.weights, VALUE_AXIS_CRITERIA),
      feasibilityAxis: axisScore(scores, active.weights, FEASIBILITY_AXIS_CRITERIA),
      selection: selected ? "selected" : "not_selected",
      funding,
      flags,
    });
  }
  items.sort(compareItems);
  return {
    transformationId,
    weightSet: presentWeightSet(active.set, active.weights),
    conversionLabel: DISPLAY100_LABEL_EN,
    items,
  };
}

function compareItems(a: PrioritizationView["items"][number], b: PrioritizationView["items"][number]): number {
  if (a.rank !== null && b.rank !== null) return a.rank - b.rank;
  if (a.rank !== null) return -1;
  if (b.rank !== null) return 1;
  const sa = a.result.weightedScore;
  const sb = b.result.weightedScore;
  if (sa !== null && sb !== null && sa !== sb) return compareScoreDesc(sa, sb);
  if (sa !== null && sb === null) return -1;
  if (sa === null && sb !== null) return 1;
  return a.initiative.code < b.initiative.code ? -1 : a.initiative.code > b.initiative.code ? 1 : 0;
}

// ------------------------------------------------------------------------------------------------ routes

export function registerPrioritizationRoutes(app: FastifyInstance, { db }: ModuleDeps): readonly string[] {
  const WS = `${T_BASE}/weight-sets`;

  app.get(T_BASE, { config: { access: { permission: "transformation.read" } } }, async (request) => {
    const { transformationId } = parse(tParams, request.params, "params");
    const query = parseQuery(prioritizationQuery, request.query);
    await requireTransformationRead(db, principalOf(request), transformationId);
    return buildPrioritizationView(db, transformationId, query);
  });

  app.get(WS, { config: { access: { permission: "transformation.read" } } }, async (request) => {
    const { transformationId } = parse(tParams, request.params, "params");
    await requireTransformationRead(db, principalOf(request), transformationId);
    const rows = await db
      .selectFrom("scoring_weight_set")
      .selectAll()
      .where("transformation_id", "=", transformationId)
      .orderBy("version_no", "desc")
      .execute();
    return { items: await presentSets(db, rows) };
  });

  app.post(
    WS,
    { config: { access: { permission: "prioritization.edit" }, consumes: JSON_BODY } },
    async (request, reply) => {
      const { transformationId } = parse(tParams, request.params, "params");
      const set = await db.transaction().execute((tx) => createWeightSet(tx, request, transformationId));
      return sendVersioned(
        reply,
        201,
        set,
        `/api/v1/transformations/${transformationId}/prioritization/weight-sets/${set.versionNo}`,
      );
    },
  );

  app.get(`${WS}/:versionNo`, { config: { access: { permission: "transformation.read" } } }, async (request, reply) => {
    const { transformationId, versionNo } = parse(vParams, request.params, "params");
    await requireTransformationRead(db, principalOf(request), transformationId);
    const row = await db
      .selectFrom("scoring_weight_set")
      .selectAll()
      .where("transformation_id", "=", transformationId)
      .where("version_no", "=", versionNo)
      .executeTakeFirst();
    if (!row) throw problems.notFound();
    return sendVersioned(reply, 200, (await presentSets(db, [row]))[0]!);
  });

  app.post(
    `${WS}/:versionNo/approve`,
    { config: { access: { permission: "prioritization.approve" }, consumes: JSON_BODY } },
    async (request, reply) => {
      const { transformationId, versionNo } = parse(vParams, request.params, "params");
      const set = await db.transaction().execute((tx) => approveWeightSet(tx, request, transformationId, versionNo));
      return sendVersioned(reply, 200, set);
    },
  );

  app.post(
    `${WS}/:versionNo/withdraw`,
    { config: { access: { permission: "prioritization.edit" }, consumes: JSON_BODY } },
    async (request, reply) => {
      const { transformationId, versionNo } = parse(vParams, request.params, "params");
      const set = await db.transaction().execute((tx) => withdrawWeightSet(tx, request, transformationId, versionNo));
      return sendVersioned(reply, 200, set);
    },
  );

  return [
    `GET ${T_BASE}`,
    `GET ${WS}`,
    `POST ${WS}`,
    `GET ${WS}/:versionNo`,
    `POST ${WS}/:versionNo/approve`,
    `POST ${WS}/:versionNo/withdraw`,
  ];
}
