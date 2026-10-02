// Workshop mode (ADR-0015 §3; REQ-PB-042; B0063 TOM canvas workshop): participants (business owners flagged),
// contributions and unresolved items, and the conversion of an unresolved item into a T04 design decision (status
// Open) or an owned action - one transaction: the new record, the item's status `converted` and both audit events.
// A workshop cannot close while an unresolved item is open (API 422 + trigger tom_workshop_close_guard).
import {
  diffFields,
  sql,
  type Db,
  type TomWorkshopItemTable,
  type TomWorkshopParticipantTable,
  type Tx,
} from "@mth/db";
import {
  reasonRequest,
  tomWorkshopItemConversion,
  tomWorkshopItemCreate,
  tomWorkshopParticipantCreate,
  type TomWorkshopItem,
  type TomWorkshopParticipant,
} from "@mth/shared/schemas";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Selectable } from "kysely";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { principalOf, requireTransformationRead, type WriteRule } from "../access/index.ts";
import { record } from "../audit/index.ts";
import {
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
} from "../platform/index.ts";
import {
  assertActiveUsers,
  assertCatalogueCode,
  bumpStamps,
  maybeIdempotent,
  openWrite,
  ruleProblem,
  sendCreated,
} from "../transformations/index.ts";
import { insertDesignDecision } from "./decisions.ts";

const W = "/api/v1/transformations/:transformationId/tom-workshops/:workshopId";
const wParams = z.strictObject({ transformationId: z.uuid(), workshopId: z.uuid() });
const pParams = z.strictObject({ transformationId: z.uuid(), workshopId: z.uuid(), participantId: z.uuid() });
const iParams = z.strictObject({ transformationId: z.uuid(), workshopId: z.uuid(), itemId: z.uuid() });
const FACILITATE: readonly WriteRule[] = [{ permission: "workshop.facilitate" }];

export const toParticipant = (r: Selectable<TomWorkshopParticipantTable>): TomWorkshopParticipant => ({
  id: r.id,
  organizationId: r.organization_id,
  transformationId: r.transformation_id,
  workshopId: r.workshop_id,
  userId: r.user_id,
  isBusinessOwner: r.is_business_owner,
  status: r.status as TomWorkshopParticipant["status"],
  version: r.version,
  createdAt: iso(r.created_at),
  createdBy: r.created_by,
  updatedAt: iso(r.updated_at),
  updatedBy: r.updated_by,
});

export const toWorkshopItem = (r: Selectable<TomWorkshopItemTable>): TomWorkshopItem => ({
  id: r.id,
  organizationId: r.organization_id,
  transformationId: r.transformation_id,
  workshopId: r.workshop_id,
  dimensionCode: r.dimension_code,
  kind: r.kind as TomWorkshopItem["kind"],
  body: r.body,
  ownerUserId: r.owner_user_id,
  status: r.status as TomWorkshopItem["status"],
  convertedDecisionId: r.converted_decision_id,
  convertedActionId: r.converted_action_id,
  convertedAt: isoOrNull(r.converted_at),
  convertedBy: r.converted_by,
  version: r.version,
  createdAt: iso(r.created_at),
  createdBy: r.created_by,
  updatedAt: iso(r.updated_at),
  updatedBy: r.updated_by,
});

async function workshopOf(db: Db | Tx, transformationId: string, workshopId: string) {
  const w = await db
    .selectFrom("tom_workshop")
    .select(["id", "status"])
    .where("id", "=", workshopId)
    .where("transformation_id", "=", transformationId)
    .executeTakeFirst();
  if (!w) throw problems.notFound();
  return w;
}
const notClosed = (w: { status: string }) => {
  if (w.status === "closed") throw problems.businessRule("workshop.closed", "A closed workshop is read-only.");
};

export function registerWorkshopRoutes(app: FastifyInstance, db: Db): string[] {
  const read = { access: { permission: "transformation.read" as const } };
  const facilitate = { access: { permission: "workshop.facilitate" as const } };

  // ---------------------------------------------------------------- participants
  app.get(`${W}/participants`, { config: read }, async (request) => {
    const { transformationId, workshopId } = parse(wParams, request.params, "params");
    await requireTransformationRead(db, principalOf(request), transformationId);
    await workshopOf(db, transformationId, workshopId);
    const rows = await db
      .selectFrom("tom_workshop_participant")
      .selectAll()
      .where("workshop_id", "=", workshopId)
      .orderBy("id")
      .execute();
    return { items: rows.map(toParticipant) };
  });

  app.post(`${W}/participants`, { config: facilitate }, async (request, reply) => {
    const { transformationId, workshopId } = parse(wParams, request.params, "params");
    const result = await db.transaction().execute(async (tx) => {
      const ctx = await openWrite(tx, request, transformationId, FACILITATE, null);
      notClosed(await workshopOf(tx, transformationId, workshopId));
      const body = parseBody(tomWorkshopParticipantCreate, request.body);
      return maybeIdempotent(tx, request, ctx.userId, body, async () => {
        await assertActiveUsers(tx, ctx.organizationId, [{ id: body.userId, pointer: "/userId" }]);
        const id = uuidv7();
        const row = await tx
          .insertInto("tom_workshop_participant")
          .values({
            id,
            organization_id: ctx.organizationId,
            transformation_id: transformationId,
            workshop_id: workshopId,
            user_id: body.userId,
            is_business_owner: body.isBusinessOwner ?? false,
            created_by: ctx.userId,
            updated_by: ctx.userId,
          })
          .returningAll()
          .executeTakeFirstOrThrow()
          .catch((e: { code?: string; constraint?: string }) => {
            if (e.code === "23505" && e.constraint === "tom_workshop_participant_active_key")
              throw problems.duplicate("duplicate.participant", "The person already takes part in this workshop.");
            throw e;
          });
        await record(tx, ctx.audit, {
          action: "tom_workshop_participant.create",
          recordType: "tom_workshop_participant",
          recordId: id,
          organizationId: ctx.organizationId,
          transformationId,
          newVersion: 1,
          changes: {
            userId: { from: null, to: body.userId },
            isBusinessOwner: { from: null, to: row.is_business_owner },
          },
        });
        return { status: 201, body: toParticipant(row) };
      });
    });
    return sendCreated(request, reply, result);
  });

  app.post(`${W}/participants/:participantId/remove`, { config: facilitate }, async (request, reply) => {
    const { transformationId, workshopId, participantId } = parse(pParams, request.params, "params");
    const row = await db.transaction().execute(async (tx) => {
      const ctx = await openWrite(tx, request, transformationId, FACILITATE, null);
      await workshopOf(tx, transformationId, workshopId);
      const { reason } = parseBody(reasonRequest, request.body);
      const expected = requireIfMatch(request);
      const current = await tx
        .selectFrom("tom_workshop_participant")
        .selectAll()
        .where("id", "=", participantId)
        .where("workshop_id", "=", workshopId)
        .forUpdate()
        .executeTakeFirst();
      if (!current) throw problems.notFound();
      if (current.version !== expected) throw problems.versionConflict(current.version);
      if (current.status === "removed")
        throw problems.businessRule("participant.already_removed", "The participant is already removed.");
      const updated = await tx
        .updateTable("tom_workshop_participant")
        .set({ status: "removed", ...bumpStamps(ctx.userId) })
        .where("id", "=", participantId)
        .where("version", "=", current.version)
        .returningAll()
        .executeTakeFirstOrThrow();
      await record(tx, ctx.audit, {
        action: "tom_workshop_participant.remove",
        recordType: "tom_workshop_participant",
        recordId: participantId,
        organizationId: ctx.organizationId,
        transformationId,
        priorVersion: current.version,
        newVersion: updated.version,
        reason,
        changes: { status: { from: "active", to: "removed" } },
      });
      return updated;
    });
    return sendVersioned(reply, 200, toParticipant(row));
  });

  // ---------------------------------------------------------------- items
  app.get(`${W}/items`, { config: read }, async (request) => {
    const { transformationId, workshopId } = parse(wParams, request.params, "params");
    const query = parseQuery(z.strictObject({ cursor: cursorSchema, limit: limitSchema }), request.query);
    await requireTransformationRead(db, principalOf(request), transformationId);
    await workshopOf(db, transformationId, workshopId);
    const hash = filterHash({ workshopId });
    const after = decodeCursor(query.cursor, hash, 1);
    let q = db.selectFrom("tom_workshop_item").selectAll().where("workshop_id", "=", workshopId);
    if (after) q = q.where("id", ">", String(after[0]));
    const rows = await q
      .orderBy("id")
      .limit(query.limit + 1)
      .execute();
    const page = paginate(rows, query.limit, (r) => [r.id], hash);
    return { items: page.items.map(toWorkshopItem), nextCursor: page.nextCursor };
  });

  app.post(`${W}/items`, { config: facilitate }, async (request, reply) => {
    const { transformationId, workshopId } = parse(wParams, request.params, "params");
    const result = await db.transaction().execute(async (tx) => {
      // workshop.facilitate; or tom.edit / tom.contribute for an ACTIVE participant of this workshop.
      const me = principalOf(request).userId;
      const participant = await tx
        .selectFrom("tom_workshop_participant")
        .select("id")
        .where("workshop_id", "=", workshopId)
        .where("user_id", "=", me ?? "00000000-0000-0000-0000-000000000000")
        .where("status", "=", "active")
        .executeTakeFirst();
      const rules: readonly WriteRule[] = participant
        ? [...FACILITATE, { permission: "tom.edit" }, { permission: "tom.contribute", scope: "own" }]
        : FACILITATE;
      const ctx = await openWrite(tx, request, transformationId, rules, null);
      notClosed(await workshopOf(tx, transformationId, workshopId));
      const body = parseBody(tomWorkshopItemCreate, request.body);
      return maybeIdempotent(tx, request, ctx.userId, body, async () => {
        await assertCatalogueCode(tx, "tom_dimension", body.dimensionCode ?? null, "/dimensionCode");
        await assertActiveUsers(tx, ctx.organizationId, [{ id: body.ownerUserId ?? null, pointer: "/ownerUserId" }]);
        const id = uuidv7();
        const row = await tx
          .insertInto("tom_workshop_item")
          .values({
            id,
            organization_id: ctx.organizationId,
            transformation_id: transformationId,
            workshop_id: workshopId,
            dimension_code: body.dimensionCode ?? null,
            kind: body.kind,
            body: body.body,
            owner_user_id: body.ownerUserId ?? null,
            // An unresolved item starts open and must be converted; a contribution is simply recorded.
            status: body.kind === "unresolved" ? "open" : "recorded",
            created_by: ctx.userId,
            updated_by: ctx.userId,
          })
          .returningAll()
          .executeTakeFirstOrThrow();
        await record(tx, ctx.audit, {
          action: "tom_workshop_item.create",
          recordType: "tom_workshop_item",
          recordId: id,
          organizationId: ctx.organizationId,
          transformationId,
          newVersion: 1,
          changes: diffFields({} as Record<string, unknown>, row as unknown as Record<string, unknown>, [
            "kind",
            "body",
            "dimension_code",
            "owner_user_id",
            "status",
          ]),
        });
        return { status: 201, body: toWorkshopItem(row) };
      });
    });
    return sendCreated(request, reply, result);
  });

  app.post(`${W}/items/:itemId/convert`, { config: facilitate }, async (request, reply) => {
    const { transformationId, workshopId, itemId } = parse(iParams, request.params, "params");
    const row = await db
      .transaction()
      .execute(async (tx) => convertItem(tx, request, transformationId, workshopId, itemId));
    return sendVersioned(reply, 200, toWorkshopItem(row));
  });

  return [
    `GET ${W}/participants`,
    `POST ${W}/participants`,
    `POST ${W}/participants/:participantId/remove`,
    `GET ${W}/items`,
    `POST ${W}/items`,
    `POST ${W}/items/:itemId/convert`,
  ];
}

async function convertItem(
  tx: Tx,
  request: FastifyRequest,
  transformationId: string,
  workshopId: string,
  itemId: string,
) {
  const ctx = await openWrite(tx, request, transformationId, FACILITATE, null);
  await workshopOf(tx, transformationId, workshopId);
  const body = parseBody(tomWorkshopItemConversion, request.body);
  const expected = requireIfMatch(request);
  const item = await tx
    .selectFrom("tom_workshop_item")
    .selectAll()
    .where("id", "=", itemId)
    .where("workshop_id", "=", workshopId)
    .forUpdate()
    .executeTakeFirst();
  if (!item) throw problems.notFound();
  if (item.version !== expected) throw problems.versionConflict(item.version);
  if (item.kind !== "unresolved" || item.status !== "open")
    throw problems.invalidTransition("Only an open unresolved item can be converted.");
  await assertActiveUsers(tx, ctx.organizationId, [{ id: body.ownerUserId, pointer: "/ownerUserId" }]);

  let decisionId: string | null = null;
  let actionId: string | null = null;
  if (body.target === "design_decision") {
    const d = await insertDesignDecision(tx, ctx, {
      title: body.title,
      context: item.body,
      ownerUserId: body.ownerUserId,
      dueDate: body.dueDate ?? null,
      tomDimensionCode: item.dimension_code,
      sourceWorkshopItemId: item.id,
    });
    decisionId = d.id;
  } else {
    actionId = uuidv7();
    await tx
      .insertInto("action_item")
      .values({
        id: actionId,
        organization_id: ctx.organizationId,
        transformation_id: transformationId,
        title: body.title,
        description: item.body.length <= 4000 ? item.body : null,
        owner_user_id: body.ownerUserId,
        due_date: body.dueDate ?? null,
        source_workshop_item_id: item.id,
        created_by: ctx.userId,
        updated_by: ctx.userId,
      })
      .execute();
    await record(tx, ctx.audit, {
      action: "action_item.create",
      recordType: "action_item",
      recordId: actionId,
      organizationId: ctx.organizationId,
      transformationId,
      newVersion: 1,
      changes: {
        title: { from: null, to: body.title },
        ownerUserId: { from: null, to: body.ownerUserId },
        sourceWorkshopItemId: { from: null, to: item.id },
      },
    });
  }
  const updated = await tx
    .updateTable("tom_workshop_item")
    .set({
      status: "converted",
      owner_user_id: body.ownerUserId,
      converted_decision_id: decisionId,
      converted_action_id: actionId,
      converted_at: sql<Date>`now()`,
      converted_by: ctx.userId,
      ...bumpStamps(ctx.userId),
    })
    .where("id", "=", item.id)
    .where("version", "=", item.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: "tom_workshop_item.convert",
    recordType: "tom_workshop_item",
    recordId: item.id,
    organizationId: ctx.organizationId,
    transformationId,
    priorVersion: item.version,
    newVersion: updated.version,
    changes: diffFields(item, updated, ["status", "owner_user_id", "converted_decision_id", "converted_action_id"]),
  });
  if (decisionId === null && actionId === null) throw ruleProblem("workshop.conversion", "Nothing was converted.", "");
  return updated;
}
