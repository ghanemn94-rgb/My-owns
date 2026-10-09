// Manual RAG overrides (ADR-0027 §10-§13; ADR-0028 §6; REQ-S07-009; T-DG4-KBE-C):
//   GET  /transformations/{t}/kpi-definitions/{k}/rag-overrides     newest first, with inForce (transformation.read)
//   POST /transformations/{t}/kpi-definitions/{k}/rag-overrides     override one scope and period (rag.override; TL, BO)
//   POST /transformations/{t}/rag-overrides/{o}/revoke              revoke an override in force (rag.override; If-Match)
//
// - "A RAG override requires authorized role, reason, evidence and expiry date": a missing reason, evidence or expiry is
//   its own 422 (rag_override.reason_required / evidence_required / expiry_required), checked before anything is
//   written; the expiry must be in the future and at most 366 days away (422 rag_override.expiry_invalid). A caller
//   without rag.override gets 403 (technical admins and AUD hold none).
// - The calculated RAG is PRESERVED: the override stores the calculated RAG of the slot's latest evaluation (basis
//   period, highest run seq) and its id, or `unknown` with no evaluation; evaluations keep being calculated underneath.
// - In force while status = 'active' and now() < expires_at; after expiry the calculated RAG displays again with no job
//   (the reads compare expires_at with the current time). At most one in force per slot (409
//   rag_override.already_in_force, checked under the slot lock kpiActualSlot that the guard also takes).
// - Immutable except active -> revoked with a reason (422 rag_override.not_active otherwise).
// - Every mutation: commit-time authorization, validation, If-Match on revoke (428/409; creates are version 1), one audit
//   event in the same transaction, no remote I/O (S-4).
import { diffFields, sql, type DbOrTx, type RagOverrideRow } from "@mth/db";
import {
  hasText,
  kpiReasonRequest,
  ragOverrideCreate,
  type RagOverride,
  type RagOverrideCreate,
} from "@mth/shared/schemas";
import type { FastifyInstance } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { principalOf, requireTransformationRead } from "../access/index.ts";
import { record } from "../audit/index.ts";
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
import { openWrite, type WriteContext } from "../transformations/index.ts";
import { actualRefusals, activeVersionOf, scopeValid } from "./actuals.ts";
import { ruleProblem } from "./support.ts";

const JSON_BODY = ["application/json"] as const;
const T_BASE = "/api/v1/transformations/:transformationId";
const DEF_OVERRIDES = `${T_BASE}/kpi-definitions/:kpiDefinitionId/rag-overrides`;
const OVERRIDE_ITEM = `${T_BASE}/rag-overrides/:ragOverrideId`;
const OVERRIDE = "rag.override" as const;
/** The longest override (ADR-0027 §10; CHECK rag_override_expiry_window). */
const MAX_EXPIRY_MS = 366 * 86_400_000;

const AUDIT_FIELDS = [
  "kpi_definition_id",
  "scope_kind",
  "scope_id",
  "reporting_period_id",
  "override_rag",
  "calculated_rag",
  "kpi_evaluation_id",
  "reason",
  "evidence_id",
  "expires_at",
  "status",
  "revoked_by",
  "revoked_at",
  "revoke_reason",
] as const satisfies readonly (keyof RagOverrideRow)[];

const definitionParams = z.strictObject({ transformationId: z.uuid(), kpiDefinitionId: z.uuid() });
const overrideParams = z.strictObject({ transformationId: z.uuid(), ragOverrideId: z.uuid() });
const listQuery = z.strictObject({ cursor: cursorSchema, limit: limitSchema });

export const overrideRefusals = {
  reasonRequired: () =>
    ruleProblem({ code: "rag_override.reason_required", detail: "A RAG override needs a reason.", pointer: "/reason" }),
  evidenceRequired: () =>
    ruleProblem({
      code: "rag_override.evidence_required",
      detail: "A RAG override needs evidence.",
      pointer: "/evidenceId",
    }),
  expiryRequired: () =>
    ruleProblem({
      code: "rag_override.expiry_required",
      detail: "A RAG override needs an expiry date and time.",
      pointer: "/expiresAt",
    }),
  expiryInvalid: () =>
    ruleProblem({
      code: "rag_override.expiry_invalid",
      detail: "The expiry must be in the future and at most 366 days away.",
      pointer: "/expiresAt",
    }),
  alreadyInForce: () =>
    problems.duplicate(
      "rag_override.already_in_force",
      "An override is already in force for this KPI, scope and period. Revoke it first.",
    ),
  notActive: () =>
    ruleProblem({ code: "rag_override.not_active", detail: "Only an override in force can be revoked.", pointer: "" }),
} as const;

/** In force: active and not yet expired at `now` (ADR-0027 §10). */
export const overrideInForce = (r: Pick<RagOverrideRow, "status" | "expires_at">, now: Date): boolean =>
  r.status === "active" && now.getTime() < r.expires_at.getTime();

export function toRagOverride(r: RagOverrideRow, now: Date): RagOverride {
  return {
    id: r.id,
    transformationId: r.transformation_id,
    kpiDefinitionId: r.kpi_definition_id,
    scopeKind: r.scope_kind as RagOverride["scopeKind"],
    scopeId: r.scope_id,
    reportingPeriodId: r.reporting_period_id,
    overrideRag: r.override_rag as RagOverride["overrideRag"],
    calculatedRag: r.calculated_rag as RagOverride["calculatedRag"],
    kpiEvaluationId: r.kpi_evaluation_id,
    reason: r.reason,
    evidenceId: r.evidence_id,
    expiresAt: iso(r.expires_at),
    inForce: overrideInForce(r, now),
    status: r.status as RagOverride["status"],
    revokedBy: r.revoked_by,
    revokedAt: isoOrNull(r.revoked_at),
    revokeReason: r.revoke_reason,
    version: r.version,
    createdAt: iso(r.created_at),
    createdBy: r.created_by,
    updatedAt: iso(r.updated_at),
  };
}

/** The database's clock (the CHECKs and the in-force rule use now()). */
async function dbNow(db: DbOrTx): Promise<Date> {
  const r = await sql<{ now: Date }>`SELECT now() AS now`.execute(db);
  return r.rows[0]!.now;
}

/** The slot's latest evaluation of basis `period` (highest run seq), or undefined. */
export async function latestPeriodEvaluation(
  db: DbOrTx,
  slot: { kpiDefinitionId: string; scopeKind: string; scopeId: string; reportingPeriodId: string },
) {
  return db
    .selectFrom("kpi_evaluation as e")
    .innerJoin("calculation_run as r", "r.id", "e.calculation_run_id")
    .selectAll("e")
    .select("r.seq")
    .where("e.kpi_definition_id", "=", slot.kpiDefinitionId)
    .where("e.scope_kind", "=", slot.scopeKind)
    .where("e.scope_id", "=", slot.scopeId)
    .where("e.reporting_period_id", "=", slot.reportingPeriodId)
    .where("e.value_basis", "=", "period")
    .orderBy("r.seq", "desc")
    .limit(1)
    .executeTakeFirst();
}

async function createOverride(
  ctx: WriteContext,
  kpiDefinitionId: string,
  b: RagOverrideCreate,
): Promise<RagOverrideRow> {
  const { tx } = ctx;
  const def = await tx
    .selectFrom("kpi_definition")
    .select(["id"])
    .where("transformation_id", "=", ctx.transformationId)
    .where("id", "=", kpiDefinitionId)
    .forShare()
    .executeTakeFirst();
  if (!def) throw problems.notFound();
  // The three required elements first, each with its own refusal (REQ-S07-009); nothing is written.
  if (b.reason === undefined || b.reason === null || !hasText(b.reason) || b.reason.trim().length < 3)
    throw overrideRefusals.reasonRequired();
  if (b.evidenceId === undefined || b.evidenceId === null) throw overrideRefusals.evidenceRequired();
  if (b.expiresAt === undefined || b.expiresAt === null) throw overrideRefusals.expiryRequired();
  const now = await dbNow(tx);
  const expires = new Date(b.expiresAt);
  if (!(expires.getTime() > now.getTime()) || expires.getTime() - now.getTime() > MAX_EXPIRY_MS)
    throw overrideRefusals.expiryInvalid();
  // Every P4 use reads the active version (D-089 Q1).
  if (!(await activeVersionOf(tx, def.id, true))) throw actualRefusals.noActiveVersion();
  if (!(await scopeValid(tx, ctx.organizationId, ctx.transformationId, b.scopeKind, b.scopeId)))
    throw actualRefusals.scopeInvalid(b.scopeKind, b.scopeId);
  const period = await tx
    .selectFrom("reporting_period")
    .select("id")
    .where("organization_id", "=", ctx.organizationId)
    .where("id", "=", b.reportingPeriodId)
    .executeTakeFirst();
  const evidence = await tx
    .selectFrom("evidence")
    .select("id")
    .where("transformation_id", "=", ctx.transformationId)
    .where("id", "=", b.evidenceId)
    .executeTakeFirst();
  if (!period || !evidence)
    throw ruleProblem({
      code: "validation.reference",
      detail: "The referenced record does not exist in this transformation.",
      pointer: period ? "/evidenceId" : "/reportingPeriodId",
    });
  await sql`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK_CLASSES.kpiActualSlot}::integer, hashtext(${`${def.id}:${b.scopeKind}:${b.scopeId}:${b.reportingPeriodId}`}::text))`.execute(
    tx,
  );
  const inForce = await tx
    .selectFrom("rag_override")
    .select("id")
    .where("kpi_definition_id", "=", def.id)
    .where("scope_kind", "=", b.scopeKind)
    .where("scope_id", "=", b.scopeId)
    .where("reporting_period_id", "=", b.reportingPeriodId)
    .where("status", "=", "active")
    .where("expires_at", ">", sql<Date>`now()`)
    .executeTakeFirst();
  if (inForce) throw overrideRefusals.alreadyInForce();
  const evaluation = await latestPeriodEvaluation(tx, {
    kpiDefinitionId: def.id,
    scopeKind: b.scopeKind,
    scopeId: b.scopeId,
    reportingPeriodId: b.reportingPeriodId,
  });
  const row = await tx
    .insertInto("rag_override")
    .values({
      id: uuidv7(),
      organization_id: ctx.organizationId,
      transformation_id: ctx.transformationId,
      kpi_definition_id: def.id,
      scope_kind: b.scopeKind,
      scope_id: b.scopeId,
      reporting_period_id: b.reportingPeriodId,
      override_rag: b.overrideRag,
      calculated_rag: evaluation?.calculated_rag ?? "unknown",
      kpi_evaluation_id: evaluation?.id ?? null,
      reason: b.reason,
      evidence_id: b.evidenceId,
      expires_at: expires,
      created_by: ctx.userId,
      updated_by: ctx.userId,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: "rag_override.create",
    recordType: "rag_override",
    recordId: row.id,
    organizationId: ctx.organizationId,
    transformationId: ctx.transformationId,
    newVersion: 1,
    reason: b.reason,
    changes: diffFields({} as RagOverrideRow, row, [...AUDIT_FIELDS]),
  });
  return row;
}

async function revokeOverride(
  ctx: WriteContext,
  id: string,
  expected: number,
  reason: string,
): Promise<RagOverrideRow> {
  const current = await ctx.tx
    .selectFrom("rag_override")
    .selectAll()
    .where("transformation_id", "=", ctx.transformationId)
    .where("id", "=", id)
    .forUpdate()
    .executeTakeFirst();
  if (!current) throw problems.notFound();
  if (current.version !== expected) throw problems.versionConflict(current.version);
  if (!overrideInForce(current, await dbNow(ctx.tx))) throw overrideRefusals.notActive();
  const updated = await ctx.tx
    .updateTable("rag_override")
    .set({
      status: "revoked",
      revoked_by: ctx.userId,
      revoked_at: sql<Date>`now()`,
      revoke_reason: reason,
      version: sql<number>`version + 1`,
      updated_at: sql<Date>`now()`,
      updated_by: ctx.userId,
    })
    .where("id", "=", current.id)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(ctx.tx, ctx.audit, {
    action: "rag_override.revoke",
    recordType: "rag_override",
    recordId: current.id,
    organizationId: ctx.organizationId,
    transformationId: ctx.transformationId,
    priorVersion: current.version,
    newVersion: updated.version,
    reason,
    changes: diffFields(current, updated, [...AUDIT_FIELDS]),
  });
  return updated;
}

export function registerRagOverrideRoutes(app: FastifyInstance, deps: ModuleDeps): string[] {
  const { db } = deps;
  const read = { access: { permission: "transformation.read" as const } };
  const write = { access: { permission: OVERRIDE }, consumes: JSON_BODY };

  app.get(DEF_OVERRIDES, { config: read }, async (request) => {
    const { transformationId, kpiDefinitionId } = parse(definitionParams, request.params, "params");
    const query = parseQuery(listQuery, request.query);
    await requireTransformationRead(db, principalOf(request), transformationId);
    const def = await db
      .selectFrom("kpi_definition")
      .select("id")
      .where("transformation_id", "=", transformationId)
      .where("id", "=", kpiDefinitionId)
      .executeTakeFirst();
    if (!def) throw problems.notFound();
    const hash = filterHash({ list: "rag-overrides", transformationId, kpiDefinitionId });
    const after = decodeCursor(query.cursor, hash, 1);
    let q = db.selectFrom("rag_override").selectAll().where("kpi_definition_id", "=", kpiDefinitionId);
    if (after) q = q.where("id", "<", String(after[0]));
    const rows = await q
      .orderBy("id", "desc")
      .limit(query.limit + 1)
      .execute();
    const page = paginate(rows, query.limit, (r) => [r.id], hash);
    const now = await dbNow(db);
    return { items: page.items.map((r) => toRagOverride(r, now)), nextCursor: page.nextCursor };
  });

  app.post(DEF_OVERRIDES, { config: write }, async (request, reply) => {
    const { transformationId, kpiDefinitionId } = parse(definitionParams, request.params, "params");
    const row = await db.transaction().execute(async (tx) => {
      const ctx = await openWrite(tx, request, transformationId, [{ permission: OVERRIDE }], null, { atCommit: true });
      const body = parseBody(ragOverrideCreate, request.body);
      return createOverride(ctx, kpiDefinitionId, body);
    });
    return sendVersioned(
      reply,
      201,
      toRagOverride(row, await dbNow(db)),
      `/api/v1/transformations/${transformationId}/rag-overrides/${row.id}`,
    );
  });

  app.post(`${OVERRIDE_ITEM}/revoke`, { config: write }, async (request, reply) => {
    const { transformationId, ragOverrideId } = parse(overrideParams, request.params, "params");
    const row = await db.transaction().execute(async (tx) => {
      const ctx = await openWrite(tx, request, transformationId, [{ permission: OVERRIDE }], null, { atCommit: true });
      const expected = requireIfMatch(request);
      const { reason } = parseBody(kpiReasonRequest, request.body);
      return revokeOverride(ctx, ragOverrideId, expected, reason);
    });
    return sendVersioned(reply, 200, toRagOverride(row, await dbNow(db)));
  });

  return [`GET ${DEF_OVERRIDES}`, `POST ${DEF_OVERRIDES}`, `POST ${OVERRIDE_ITEM}/revoke`];
}
