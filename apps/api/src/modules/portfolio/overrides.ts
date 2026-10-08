// Ranking overrides (ADR-0022 §5; REQ-S09-005; T-DG3-BE-D):
//   GET  /transformations/{id}/prioritization/overrides                          list, newest first (cursor)
//   POST /transformations/{id}/prioritization/overrides                          propose (prioritization.edit); 201
//   POST /transformations/{id}/prioritization/overrides/{overrideId}/decision    approve / reject (prioritization.approve)
//   POST /transformations/{id}/prioritization/overrides/{overrideId}/revoke      revoke an approved one (prioritization.approve)
//
// A reason is REQUIRED: a missing or empty `reason` (or one shorter than the contract's 3 characters) is 400 at
// `/reason`; text with no visible content (whitespace or invisible characters only) is 422
// `prioritization.override_reason_required`. Approving or rejecting is a BUSINESS approval inside the product
// ("override approver", SP by default), recorded with the decider, the time and the request version; the proposer is
// never the approver (403 `approval.approver_is_proposer`; DB CHECK `ranking_override_approver_not_proposer`). An
// approved override applies from the next ranking snapshot. Nothing here touches DG0-DG7.
import type { DbOrTx, RankingOverrideRow, Tx } from "@mth/db";
import {
  approvalDecision,
  hasText,
  rankingOverrideCreate,
  reasonRequest,
  type RankingOverride,
} from "@mth/shared/schemas";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { principalOf, requireTransformationRead } from "../access/index.ts";
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
import { assertSameTransformation, bumpStamps, openWrite } from "../transformations/index.ts";
import { approverIsProposer } from "./prioritization.ts";
import { ELIGIBLE_STATUSES } from "./scores.ts";

const JSON_BODY = ["application/json"] as const;
const BASE = "/api/v1/transformations/:transformationId/prioritization/overrides";
const tParams = z.strictObject({ transformationId: z.uuid() });
const oParams = z.strictObject({ transformationId: z.uuid(), overrideId: z.uuid() });

// ------------------------------------------------------------------------------------------------ schemas (contract)

// Moved to @mth/shared/schemas (prioritization.ts; T-DG3-ARCH-03): RankingOverride*, ApprovalDecision.

export const OVERRIDE_REASON_REQUIRED_DETAIL = "An override needs a reason.";

function present(row: RankingOverrideRow): RankingOverride {
  return {
    id: row.id,
    organizationId: row.organization_id,
    transformationId: row.transformation_id,
    initiativeId: row.initiative_id,
    overrideRank: row.override_rank,
    reason: row.reason,
    status: row.status as RankingOverride["status"],
    proposedBy: row.proposed_by,
    decidedBy: row.decided_by,
    decidedAt: isoOrNull(row.decided_at),
    decisionNote: row.decision_note,
    revokedBy: row.revoked_by,
    revokedAt: isoOrNull(row.revoked_at),
    revokeReason: row.revoke_reason,
    version: row.version,
    createdAt: iso(row.created_at),
    createdBy: row.created_by,
    updatedAt: iso(row.updated_at),
    updatedBy: row.updated_by,
  };
}

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

async function lockRow(tx: Tx, transformationId: string, id: string): Promise<RankingOverrideRow> {
  const row = await tx
    .selectFrom("ranking_override")
    .selectAll()
    .where("id", "=", id)
    .where("transformation_id", "=", transformationId)
    .forUpdate()
    .executeTakeFirst();
  if (!row) throw problems.notFound();
  return row;
}

// ------------------------------------------------------------------------------------------------ mutations

async function createOverride(tx: Tx, request: FastifyRequest, transformationId: string) {
  const ctx = await openWrite(tx, request, transformationId, [{ permission: "prioritization.edit" }], null, {
    atCommit: true,
  });
  const body = parseBody(rankingOverrideCreate, request.body);
  if (!hasText(body.reason))
    throw rule("prioritization.override_reason_required", OVERRIDE_REASON_REQUIRED_DETAIL, "/reason");
  await assertSameTransformation(tx, "initiative", transformationId, body.initiativeId, "/initiativeId");
  const ini = await tx
    .selectFrom("initiative")
    .select("status")
    .where("id", "=", body.initiativeId)
    .executeTakeFirstOrThrow();
  if (!(ELIGIBLE_STATUSES as readonly string[]).includes(ini.status))
    throw rule(
      "prioritization.override_not_eligible",
      "Only an initiative in the portfolio (submitted or later, not cancelled) can be given a rank override.",
      "/initiativeId",
    );
  const live = await tx
    .selectFrom("ranking_override")
    .select("id")
    .where("initiative_id", "=", body.initiativeId)
    .where("status", "in", ["proposed", "approved"])
    .executeTakeFirst();
  if (live)
    throw problems.duplicate(
      "prioritization.override_exists",
      "The initiative already has a proposed or approved override; revoke or decide it first.",
    );
  const id = uuidv7();
  const row = await tx
    .insertInto("ranking_override")
    .values({
      id,
      organization_id: ctx.organizationId,
      transformation_id: transformationId,
      initiative_id: body.initiativeId,
      override_rank: body.overrideRank,
      reason: body.reason,
      status: "proposed",
      proposed_by: ctx.userId,
      created_by: ctx.userId,
      updated_by: ctx.userId,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: "ranking_override.create",
    recordType: "ranking_override",
    recordId: id,
    organizationId: ctx.organizationId,
    transformationId,
    newVersion: 1,
    reason: body.reason,
    changes: {
      initiativeId: { from: null, to: body.initiativeId },
      overrideRank: { from: null, to: body.overrideRank },
      status: { from: null, to: "proposed" },
    },
  });
  return row;
}

async function decideOverride(tx: Tx, request: FastifyRequest, transformationId: string, id: string) {
  const ctx = await openWrite(tx, request, transformationId, [{ permission: "prioritization.approve" }], null, {
    atCommit: true,
  });
  const current = await lockRow(tx, transformationId, id);
  const body = parseBody(approvalDecision, request.body);
  const expected = requireIfMatch(request);
  if (current.version !== expected) throw problems.versionConflict(current.version);
  // The named approver decides in person: no delegation path, so no approval loop can exist.
  if (body.onBehalfOfUserId !== undefined)
    throw rule(
      "prioritization.on_behalf_not_supported",
      "A ranking override is decided by the approver in person; deciding on someone's behalf is not available.",
      "/onBehalfOfUserId",
    );
  if (current.proposed_by === ctx.userId) throw approverIsProposer();
  if (current.status !== "proposed")
    throw transition("prioritization.override_not_proposed", "Only a proposed override can be approved or rejected.");
  const updated = await tx
    .updateTable("ranking_override")
    .set({
      status: body.result,
      decided_by: ctx.userId,
      decided_at: new Date(),
      decision_note: body.note ?? null,
      ...bumpStamps(ctx.userId),
    })
    .where("id", "=", current.id)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: "ranking_override.decide",
    recordType: "ranking_override",
    recordId: current.id,
    organizationId: ctx.organizationId,
    transformationId,
    priorVersion: current.version,
    newVersion: updated.version,
    ...(body.note !== undefined ? { reason: body.note } : {}),
    changes: { status: { from: "proposed", to: body.result }, decidedBy: { from: null, to: ctx.userId } },
  });
  return updated;
}

async function revokeOverride(tx: Tx, request: FastifyRequest, transformationId: string, id: string) {
  const ctx = await openWrite(tx, request, transformationId, [{ permission: "prioritization.approve" }], null, {
    atCommit: true,
  });
  const current = await lockRow(tx, transformationId, id);
  const body = parseBody(reasonRequest, request.body);
  const expected = requireIfMatch(request);
  if (current.version !== expected) throw problems.versionConflict(current.version);
  if (current.status !== "approved")
    throw transition("prioritization.override_not_revocable", "Only an approved override can be revoked.");
  const updated = await tx
    .updateTable("ranking_override")
    .set({
      status: "revoked",
      revoked_by: ctx.userId,
      revoked_at: new Date(),
      revoke_reason: body.reason,
      ...bumpStamps(ctx.userId),
    })
    .where("id", "=", current.id)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: "ranking_override.revoke",
    recordType: "ranking_override",
    recordId: current.id,
    organizationId: ctx.organizationId,
    transformationId,
    priorVersion: current.version,
    newVersion: updated.version,
    reason: body.reason,
    changes: { status: { from: "approved", to: "revoked" }, revokedBy: { from: null, to: ctx.userId } },
  });
  return updated;
}

// ------------------------------------------------------------------------------------------------ routes

export async function loadOverride(db: DbOrTx, id: string): Promise<RankingOverride | null> {
  const row = await db.selectFrom("ranking_override").selectAll().where("id", "=", id).executeTakeFirst();
  return row ? present(row) : null;
}

export function registerOverrideRoutes(app: FastifyInstance, { db }: ModuleDeps): readonly string[] {
  app.get(BASE, { config: { access: { permission: "transformation.read" } } }, async (request) => {
    const { transformationId } = parse(tParams, request.params, "params");
    const query = parseQuery(z.strictObject({ cursor: cursorSchema, limit: limitSchema }), request.query);
    await requireTransformationRead(db, principalOf(request), transformationId);
    const hash = filterHash({ transformationId, list: "ranking_override" });
    const after = decodeCursor(query.cursor, hash, 2);
    let q = db.selectFrom("ranking_override").selectAll().where("transformation_id", "=", transformationId);
    if (after)
      q = q.where((eb) =>
        eb.or([
          eb("created_at", "<", new Date(String(after[0]))),
          eb.and([eb("created_at", "=", new Date(String(after[0]))), eb("id", "<", String(after[1]))]),
        ]),
      );
    const rows = await q
      .orderBy("created_at", "desc")
      .orderBy("id", "desc")
      .limit(query.limit + 1)
      .execute();
    const page = paginate(rows, query.limit, (r) => [r.created_at.toISOString(), r.id], hash);
    return { items: page.items.map(present), nextCursor: page.nextCursor };
  });

  app.post(
    BASE,
    { config: { access: { permission: "prioritization.edit" }, consumes: JSON_BODY } },
    async (request, reply) => {
      const { transformationId } = parse(tParams, request.params, "params");
      const row = await db.transaction().execute((tx) => createOverride(tx, request, transformationId));
      return sendVersioned(
        reply,
        201,
        present(row),
        `/api/v1/transformations/${transformationId}/prioritization/overrides/${row.id}`,
      );
    },
  );

  app.post(
    `${BASE}/:overrideId/decision`,
    { config: { access: { permission: "prioritization.approve" }, consumes: JSON_BODY } },
    async (request, reply) => {
      const { transformationId, overrideId } = parse(oParams, request.params, "params");
      const row = await db.transaction().execute((tx) => decideOverride(tx, request, transformationId, overrideId));
      return sendVersioned(reply, 200, present(row));
    },
  );

  app.post(
    `${BASE}/:overrideId/revoke`,
    { config: { access: { permission: "prioritization.approve" }, consumes: JSON_BODY } },
    async (request, reply) => {
      const { transformationId, overrideId } = parse(oParams, request.params, "params");
      const row = await db.transaction().execute((tx) => revokeOverride(tx, request, transformationId, overrideId));
      return sendVersioned(reply, 200, present(row));
    },
  );

  return [`GET ${BASE}`, `POST ${BASE}`, `POST ${BASE}/:overrideId/decision`, `POST ${BASE}/:overrideId/revoke`];
}
