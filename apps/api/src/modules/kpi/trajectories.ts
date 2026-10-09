// Target trajectories (ADR-0027 §5, ADR-0028 §4; REQ-S07-007 trajectory half, REQ-S16-014; T-DG4-KBE-B):
//   GET  /transformations/{t}/kpi-definitions/{k}/trajectories           ?scopeKind&scopeId, newest first
//   POST /transformations/{t}/kpi-definitions/{k}/trajectories           a new draft (target_trajectory.edit)
//   GET  /transformations/{t}/target-trajectories/{id}
//   POST /transformations/{t}/target-trajectories/{id}/approve           business approval (kpi_target.approve; If-Match)
//   POST /transformations/{t}/target-trajectories/{id}/withdraw          draft -> withdrawn (target_trajectory.edit; If-Match)
//
// - One trajectory per KPI, scope and version number; the scope is the transformation, a business unit of its
//   organization or one of its initiatives (422 kpi.scope_invalid). At most one draft (409
//   target_trajectory.draft_exists) and one approved trajectory per KPI and scope.
// - Points are fixed at creation (append-only rows, inserted only while draft): different points = withdraw the draft
//   and create the next version. `sourceOutcomeKpiId` imports the current points of a DG2 T02 outcome-KPI row of the
//   same KPI (source outcome_kpi_import) into a NEW DRAFT that needs its own approval; DG2 T02 is unchanged.
// - Approval is a business approval inside the product, decided by a person holding kpi_target.approve (SP, BO) who is
//   not the creator (403 target_trajectory.approver_is_author). The previously approved trajectory of the KPI and scope
//   is superseded first, in the same transaction, and the outbox event kpi.trajectory_approved (key
//   kpi.trajectory_approved:<id>:<versionNo>) is written with it. No agent, seed or job approves a trajectory.
import { diffFields, sql, type DbOrTx, type TargetTrajectoryRow, type Tx } from "@mth/db";
import { PROBLEM_TYPES } from "@mth/shared";
import {
  canonicalDecimal,
  checkDecimal,
  kpiReasonRequest,
  MEASURE_COLUMN,
  targetTrajectoryApproval,
  targetTrajectoryCreate,
  targetTrajectoryListQuery,
  type TargetTrajectory,
  type TargetTrajectoryCreate,
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
import { maybeIdempotent, openWrite, sendCreated, type WriteContext } from "../transformations/index.ts";
import { trajectoryPointsOf } from "./repository.ts";
import { enqueueKpiEvent } from "./kpi-outbox.ts";
import { ruleProblem } from "./support.ts";

const JSON_BODY = ["application/json"] as const;
const T_BASE = "/api/v1/transformations/:transformationId";
const COLLECTION = `${T_BASE}/kpi-definitions/:kpiDefinitionId/trajectories`;
const ITEM = `${T_BASE}/target-trajectories/:targetTrajectoryId`;
const EDIT = "target_trajectory.edit" as const;
const APPROVE = "kpi_target.approve" as const;

export const TARGET_TRAJECTORY_AUDIT_FIELDS = [
  "kpi_definition_id",
  "scope_kind",
  "scope_id",
  "version_no",
  "basis",
  "interpolation",
  "source",
  "source_outcome_kpi_id",
  "status",
  "approved_by",
  "approved_at",
  "approved_record_version",
  "superseded_at",
  "withdrawn_at",
  "withdraw_reason",
] as const satisfies readonly (keyof TargetTrajectoryRow)[];

type Point = TargetTrajectory["points"][number];

export function toTargetTrajectory(r: TargetTrajectoryRow, points: readonly Point[]): TargetTrajectory {
  return {
    id: r.id,
    transformationId: r.transformation_id,
    kpiDefinitionId: r.kpi_definition_id,
    scopeKind: r.scope_kind as TargetTrajectory["scopeKind"],
    scopeId: r.scope_id,
    versionNo: r.version_no,
    basis: r.basis as TargetTrajectory["basis"],
    interpolation: r.interpolation as TargetTrajectory["interpolation"],
    source: r.source as TargetTrajectory["source"],
    sourceOutcomeKpiId: r.source_outcome_kpi_id,
    status: r.status as TargetTrajectory["status"],
    points: [...points],
    approvedBy: r.approved_by,
    approvedAt: isoOrNull(r.approved_at),
    supersededAt: isoOrNull(r.superseded_at),
    withdrawnAt: isoOrNull(r.withdrawn_at),
    withdrawReason: r.withdraw_reason,
    version: r.version,
    createdAt: iso(r.created_at),
    createdBy: r.created_by,
    updatedAt: iso(r.updated_at),
  };
}

async function pointsOf(db: DbOrTx, ids: readonly string[]): Promise<Map<string, Point[]>> {
  const out = new Map<string, Point[]>();
  if (ids.length === 0) return out;
  const rows = await db
    .selectFrom("target_trajectory_point")
    .select(["target_trajectory_id", "point_date", "expected_value"])
    .where("target_trajectory_id", "in", [...ids])
    .orderBy("point_date")
    .execute();
  for (const r of rows)
    out.set(r.target_trajectory_id, [
      ...(out.get(r.target_trajectory_id) ?? []),
      { pointDate: r.point_date, expectedValue: canonicalDecimal(r.expected_value) },
    ]);
  return out;
}

export async function presentTrajectories(
  db: DbOrTx,
  rows: readonly TargetTrajectoryRow[],
): Promise<TargetTrajectory[]> {
  const points = await pointsOf(
    db,
    rows.map((r) => r.id),
  );
  return rows.map((r) => toTargetTrajectory(r, points.get(r.id) ?? []));
}

const auditOf = (
  ctx: WriteContext,
  action: string,
  before: TargetTrajectoryRow | null,
  after: TargetTrajectoryRow,
  reason: string | null = null,
  extra: Record<string, { from: unknown; to: unknown }> = {},
) =>
  record(ctx.tx, ctx.audit, {
    action,
    recordType: "target_trajectory",
    recordId: after.id,
    organizationId: ctx.organizationId,
    transformationId: ctx.transformationId,
    priorVersion: before?.version ?? null,
    newVersion: after.version,
    reason,
    changes: {
      ...(diffFields(before ?? ({} as TargetTrajectoryRow), after, [...TARGET_TRAJECTORY_AUDIT_FIELDS]) ?? {}),
      ...extra,
    },
  });

// ------------------------------------------------------------------------------------------------ create

async function scopeValid(tx: Tx, organizationId: string, transformationId: string, kind: string, id: string) {
  const r = await sql<{
    ok: boolean;
  }>`SELECT p4_kpi_scope_valid(${organizationId}::uuid, ${transformationId}::uuid, ${kind}, ${id}::uuid) AS ok`.execute(
    tx,
  );
  return r.rows[0]?.ok === true;
}

/** The current points of a DG2 T02 outcome-KPI row of this KPI (source outcome_kpi_import). */
async function importedPoints(tx: Tx, transformationId: string, kpiDefinitionId: string, outcomeKpiId: string) {
  const row = await tx
    .selectFrom("outcome_kpi")
    .select(["id", "kpi_definition_id", "trajectory_points"])
    .where("transformation_id", "=", transformationId)
    .where("id", "=", outcomeKpiId)
    .executeTakeFirst();
  if (!row || row.kpi_definition_id !== kpiDefinitionId)
    throw ruleProblem({
      code: "validation.reference",
      detail: "The outcome KPI row must exist in this transformation and measure this KPI.",
      pointer: "/sourceOutcomeKpiId",
    });
  const points = trajectoryPointsOf(row.trajectory_points).map((p) => ({ pointDate: p.date, expectedValue: p.value }));
  if (points.length === 0)
    throw ruleProblem({
      code: "target_trajectory.points_required",
      detail: "An approved trajectory needs at least one point.",
      pointer: "/sourceOutcomeKpiId",
    });
  for (const p of points)
    if (!checkDecimal(p.expectedValue, MEASURE_COLUMN).ok)
      throw ruleProblem({
        code: "validation.constraint",
        detail: "A point of the outcome KPI row does not fit a KPI value (numeric(24,6)).",
        pointer: "/sourceOutcomeKpiId",
      });
  return points;
}

async function createTrajectory(ctx: WriteContext, kpiDefinitionId: string, body: TargetTrajectoryCreate) {
  const { tx, transformationId } = ctx;
  const def = await tx
    .selectFrom("kpi_definition")
    .select(["id", "status"])
    .where("transformation_id", "=", transformationId)
    .where("id", "=", kpiDefinitionId)
    .forUpdate()
    .executeTakeFirst();
  if (!def) throw problems.notFound();
  if (def.status === "archived")
    throw problems.businessRule("kpi_definition.archived", "Archived records are read-only.");
  if (!(await scopeValid(tx, ctx.organizationId, transformationId, body.scopeKind, body.scopeId)))
    throw ruleProblem({
      code: "kpi.scope_invalid",
      detail: `The scope ${body.scopeKind} ${body.scopeId} is not part of this transformation.`,
      pointer: "/scopeId",
    });
  const existing = await tx
    .selectFrom("target_trajectory")
    .select(["version_no", "status"])
    .where("kpi_definition_id", "=", def.id)
    .where("scope_kind", "=", body.scopeKind)
    .where("scope_id", "=", body.scopeId)
    .orderBy("version_no", "desc")
    .execute();
  if (existing.some((t) => t.status === "draft"))
    throw problems.duplicate(
      "target_trajectory.draft_exists",
      "This KPI already has a draft trajectory for this scope. Approve or withdraw it first.",
    );
  const points =
    body.sourceOutcomeKpiId !== undefined
      ? await importedPoints(tx, transformationId, def.id, body.sourceOutcomeKpiId)
      : body.points!;
  const id = uuidv7();
  const row = await tx
    .insertInto("target_trajectory")
    .values({
      id,
      organization_id: ctx.organizationId,
      transformation_id: transformationId,
      kpi_definition_id: def.id,
      scope_kind: body.scopeKind,
      scope_id: body.scopeId,
      version_no: (existing[0]?.version_no ?? 0) + 1,
      basis: body.basis,
      interpolation: body.interpolation,
      source: body.sourceOutcomeKpiId !== undefined ? "outcome_kpi_import" : "api",
      source_outcome_kpi_id: body.sourceOutcomeKpiId ?? null,
      created_by: ctx.userId,
      updated_by: ctx.userId,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await tx
    .insertInto("target_trajectory_point")
    .values(
      points.map((p) => ({
        id: uuidv7(),
        organization_id: ctx.organizationId,
        transformation_id: transformationId,
        target_trajectory_id: id,
        point_date: p.pointDate,
        expected_value: p.expectedValue,
        created_by: ctx.userId,
      })),
    )
    .execute();
  const stored = (await pointsOf(tx, [id])).get(id) ?? [];
  await auditOf(ctx, "target_trajectory.create", null, row, null, { points: { from: null, to: stored } });
  return toTargetTrajectory(row, stored);
}

// ------------------------------------------------------------------------------------------------ approve, withdraw

async function lockDraft(ctx: WriteContext, id: string): Promise<TargetTrajectoryRow> {
  const current = await ctx.tx
    .selectFrom("target_trajectory")
    .selectAll()
    .where("transformation_id", "=", ctx.transformationId)
    .where("id", "=", id)
    .forUpdate()
    .executeTakeFirst();
  if (!current) throw problems.notFound();
  return current;
}

const notDraft = () =>
  problems.businessRule("target_trajectory.not_draft", "Only a draft trajectory can be approved or withdrawn.");

const approverIsAuthor = (ctx: WriteContext) =>
  new HttpProblem({
    status: 403,
    type: PROBLEM_TYPES.forbidden,
    code: "target_trajectory.approver_is_author",
    title: "Forbidden",
    detail: "The person who created this trajectory cannot approve it.",
  }).withDenial(denialOf(APPROVE, ctx.target));

async function approveTrajectory(ctx: WriteContext, id: string, expected: number, comment: string | null) {
  const current = await lockDraft(ctx, id);
  // Separation of duties (CHECK target_trajectory_approver_not_creator): never the creator.
  if (current.created_by === ctx.userId) throw approverIsAuthor(ctx);
  if (current.version !== expected) throw problems.versionConflict(current.version);
  if (current.status !== "draft") throw notDraft();
  const points = (await pointsOf(ctx.tx, [current.id])).get(current.id) ?? [];
  if (points.length === 0)
    throw problems.businessRule(
      "target_trajectory.points_required",
      "An approved trajectory needs at least one point.",
    );
  const previous = await ctx.tx
    .selectFrom("target_trajectory")
    .selectAll()
    .where("kpi_definition_id", "=", current.kpi_definition_id)
    .where("scope_kind", "=", current.scope_kind)
    .where("scope_id", "=", current.scope_id)
    .where("status", "=", "approved")
    .forUpdate()
    .executeTakeFirst();
  if (previous) {
    const superseded = await ctx.tx
      .updateTable("target_trajectory")
      .set({
        status: "superseded",
        superseded_at: sql<Date>`now()`,
        version: sql<number>`version + 1`,
        updated_at: sql<Date>`now()`,
        updated_by: ctx.userId,
      })
      .where("id", "=", previous.id)
      .where("version", "=", previous.version)
      .returningAll()
      .executeTakeFirstOrThrow();
    await auditOf(ctx, "target_trajectory.supersede", previous, superseded);
  }
  const approved = await ctx.tx
    .updateTable("target_trajectory")
    .set({
      status: "approved",
      approved_by: ctx.userId,
      approved_at: sql<Date>`now()`,
      approved_record_version: current.version,
      version: sql<number>`version + 1`,
      updated_at: sql<Date>`now()`,
      updated_by: ctx.userId,
    })
    .where("id", "=", current.id)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await auditOf(ctx, "target_trajectory.approve", current, approved, comment);
  await enqueueKpiEvent(ctx.tx, {
    organizationId: ctx.organizationId,
    aggregateType: "target_trajectory",
    aggregateId: approved.id,
    eventType: "kpi.trajectory_approved",
    schemaVersion: 1,
    payload: {
      targetTrajectoryId: approved.id,
      kpiDefinitionId: approved.kpi_definition_id,
      transformationId: ctx.transformationId,
      scopeKind: approved.scope_kind,
      scopeId: approved.scope_id,
      versionNo: approved.version_no,
      occurredAt: iso(approved.approved_at!),
    },
    idempotencyKey: `kpi.trajectory_approved:${approved.id}:${approved.version_no}`,
  });
  return toTargetTrajectory(approved, points);
}

async function withdrawTrajectory(ctx: WriteContext, id: string, expected: number, reason: string) {
  const current = await lockDraft(ctx, id);
  if (current.version !== expected) throw problems.versionConflict(current.version);
  if (current.status !== "draft") throw notDraft();
  const updated = await ctx.tx
    .updateTable("target_trajectory")
    .set({
      status: "withdrawn",
      withdrawn_at: sql<Date>`now()`,
      withdraw_reason: reason,
      version: sql<number>`version + 1`,
      updated_at: sql<Date>`now()`,
      updated_by: ctx.userId,
    })
    .where("id", "=", current.id)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await auditOf(ctx, "target_trajectory.withdraw", current, updated, reason);
  return (await presentTrajectories(ctx.tx, [updated]))[0]!;
}

// ------------------------------------------------------------------------------------------------ routes

const collectionParams = z.strictObject({ transformationId: z.uuid(), kpiDefinitionId: z.uuid() });
const itemParams = z.strictObject({ transformationId: z.uuid(), targetTrajectoryId: z.uuid() });
const listQuery = z.strictObject({ ...targetTrajectoryListQuery.shape, cursor: cursorSchema, limit: limitSchema });

export function registerTrajectoryRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  const read = { access: { permission: "transformation.read" as const } };
  const open = (tx: Tx, request: FastifyRequest, transformationId: string, permission: typeof EDIT | typeof APPROVE) =>
    openWrite(tx, request, transformationId, [{ permission }], null, { atCommit: true });

  app.get(COLLECTION, { config: read }, async (request) => {
    const { transformationId, kpiDefinitionId } = parse(collectionParams, request.params, "params");
    const query = parseQuery(listQuery, request.query);
    await requireTransformationRead(db, principalOf(request), transformationId);
    const def = await db
      .selectFrom("kpi_definition")
      .select("id")
      .where("transformation_id", "=", transformationId)
      .where("id", "=", kpiDefinitionId)
      .executeTakeFirst();
    if (!def) throw problems.notFound();
    const hash = filterHash({ list: "trajectories", transformationId, kpiDefinitionId, ...query });
    const after = decodeCursor(query.cursor, hash, 2);
    let q = db
      .selectFrom("target_trajectory")
      .selectAll()
      .select(sql<string>`to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`.as("sort_key"))
      .where("kpi_definition_id", "=", kpiDefinitionId);
    if (query.scopeKind !== undefined) q = q.where("scope_kind", "=", query.scopeKind);
    if (query.scopeId !== undefined) q = q.where("scope_id", "=", query.scopeId);
    if (after)
      q = q.where(sql<boolean>`(created_at, id) < (${String(after[0])}::timestamptz, ${String(after[1])}::uuid)`);
    const rows = await q
      .orderBy("created_at", "desc")
      .orderBy("id", "desc")
      .limit(query.limit + 1)
      .execute();
    const page = paginate(rows, query.limit, (r) => [r.sort_key, r.id], hash);
    return {
      items: await presentTrajectories(
        db,
        page.items.map(({ sort_key: _k, ...r }) => r as TargetTrajectoryRow),
      ),
      nextCursor: page.nextCursor,
    };
  });

  app.post(COLLECTION, { config: { access: { permission: EDIT }, consumes: JSON_BODY } }, async (request, reply) => {
    const { transformationId, kpiDefinitionId } = parse(collectionParams, request.params, "params");
    const result = await db.transaction().execute(async (tx) => {
      const ctx = await open(tx, request, transformationId, EDIT);
      const body = parseBody(targetTrajectoryCreate, request.body);
      return maybeIdempotent(tx, request, ctx.userId, request.body, async () => ({
        status: 201,
        body: await createTrajectory(ctx, kpiDefinitionId, body),
      }));
    });
    return sendCreated(request, reply, result, `/api/v1/transformations/${transformationId}/target-trajectories`);
  });

  app.get(ITEM, { config: read }, async (request, reply) => {
    const { transformationId, targetTrajectoryId } = parse(itemParams, request.params, "params");
    await requireTransformationRead(db, principalOf(request), transformationId);
    const row = await db
      .selectFrom("target_trajectory")
      .selectAll()
      .where("transformation_id", "=", transformationId)
      .where("id", "=", targetTrajectoryId)
      .executeTakeFirst();
    if (!row) throw problems.notFound();
    return sendVersioned(reply, 200, (await presentTrajectories(db, [row]))[0]!);
  });

  app.post(
    `${ITEM}/approve`,
    { config: { access: { permission: APPROVE }, consumes: JSON_BODY } },
    async (request, reply) => {
      const { transformationId, targetTrajectoryId } = parse(itemParams, request.params, "params");
      const body = await db.transaction().execute(async (tx) => {
        const ctx = await open(tx, request, transformationId, APPROVE);
        const expected = requireIfMatch(request);
        const { comment } = parseBody(targetTrajectoryApproval, request.body);
        return approveTrajectory(ctx, targetTrajectoryId, expected, comment ?? null);
      });
      return sendVersioned(reply, 200, body);
    },
  );

  app.post(
    `${ITEM}/withdraw`,
    { config: { access: { permission: EDIT }, consumes: JSON_BODY } },
    async (request, reply) => {
      const { transformationId, targetTrajectoryId } = parse(itemParams, request.params, "params");
      const body = await db.transaction().execute(async (tx) => {
        const ctx = await open(tx, request, transformationId, EDIT);
        const expected = requireIfMatch(request);
        const { reason } = parseBody(kpiReasonRequest, request.body);
        return withdrawTrajectory(ctx, targetTrajectoryId, expected, reason);
      });
      return sendVersioned(reply, 200, body);
    },
  );

  return [`GET ${COLLECTION}`, `POST ${COLLECTION}`, `GET ${ITEM}`, `POST ${ITEM}/approve`, `POST ${ITEM}/withdraw`];
}
