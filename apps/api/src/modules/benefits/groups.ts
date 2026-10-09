// Shared-benefit groups (P4 slice B; ADR-0029 §6, §11; T-DG4-KBE-D; REQ-PB-058):
//   GET   /transformations/{t}/benefit-groups                    list with members and counted member (transformation.read)
//   POST  /transformations/{t}/benefit-groups                    create (benefit_group.manage; TL, BO); code BG-01…
//   GET   /transformations/{t}/benefit-groups/{benefitGroupId}   read
//   PATCH /transformations/{t}/benefit-groups/{benefitGroupId}   rename or name the counted member (If-Match)
//
// A group gathers benefits that claim ONE economic pool. Exactly the member named `countedBenefitId` is counted in
// totals; while none is named, NO member is counted (benefit_counting exclusion `group_counted_member_not_named`), so a
// group never double counts by default. The counted member must be a member (422 benefit_group.counted_not_member);
// members join or leave through updateBenefit (`benefitGroupId`), and the counted member cannot leave while it is the
// counted one (register.ts, 422 benefit_group.counted_member_leaving).
import { diffFields, sql, type BenefitGroupRow, type DbOrTx, type Tx } from "@mth/db";
import { benefitGroupCreate, benefitGroupUpdate, type BenefitGroup } from "@mth/shared/schemas";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { principalOf, requireTransformationRead } from "../access/index.ts";
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
  type ModuleDeps,
} from "../platform/index.ts";
import {
  assertSameTransformation,
  bumpStamps,
  maybeIdempotent,
  sendCreated,
  type WriteContext,
} from "../transformations/index.ts";
import { benefitRule, JSON_BODY, openBenefitWrite, parseTransformationParam } from "./register.ts";

export const BENEFIT_GROUP_MANAGE = "benefit_group.manage" as const;
export const GROUPS = "/api/v1/transformations/:transformationId/benefit-groups";
export const GROUP_ITEM = `${GROUPS}/:benefitGroupId`;

export const GROUP_AUDIT_FIELDS = [
  "code",
  "title",
  "description",
  "counted_benefit_id",
  "status",
] as const satisfies readonly (keyof BenefitGroupRow & string)[];

export async function presentGroups(db: DbOrTx, rows: readonly BenefitGroupRow[]): Promise<BenefitGroup[]> {
  if (rows.length === 0) return [];
  const members = await db
    .selectFrom("benefit")
    .select(["id", "benefit_group_id"])
    .where(
      "benefit_group_id",
      "in",
      rows.map((r) => r.id),
    )
    .orderBy("code")
    .execute();
  return rows.map((g) => ({
    id: g.id,
    transformationId: g.transformation_id,
    code: g.code,
    title: g.title,
    description: g.description,
    countedBenefitId: g.counted_benefit_id,
    memberBenefitIds: members.filter((m) => m.benefit_group_id === g.id).map((m) => m.id),
    status: g.status as BenefitGroup["status"],
    archivedAt: isoOrNull(g.archived_at),
    archivedBy: g.archived_by,
    archiveReason: g.archive_reason,
    version: g.version,
    createdAt: iso(g.created_at),
    createdBy: g.created_by,
    updatedAt: iso(g.updated_at),
  }));
}

const groupParams = z.strictObject({ transformationId: z.uuid(), benefitGroupId: z.uuid() });

async function nextGroupCode(tx: Tx, transformationId: string): Promise<string> {
  const row = await sql<{ last_value: number }>`
    INSERT INTO record_code_counter (transformation_id, prefix, last_value) VALUES (${transformationId}::uuid, 'BG', 1)
    ON CONFLICT (transformation_id, prefix) DO UPDATE SET last_value = record_code_counter.last_value + 1
    RETURNING last_value`.execute(tx);
  return `BG-${String(row.rows[0]!.last_value).padStart(2, "0")}`;
}

async function createGroup(tx: Tx, ctx: WriteContext, body: z.infer<typeof benefitGroupCreate>) {
  const id = uuidv7();
  const row = await tx
    .insertInto("benefit_group")
    .values({
      id,
      organization_id: ctx.organizationId,
      transformation_id: ctx.transformationId,
      code: await nextGroupCode(tx, ctx.transformationId),
      title: body.title,
      description: body.description ?? null,
      created_by: ctx.userId,
      updated_by: ctx.userId,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: "benefit_group.create",
    recordType: "benefit_group",
    recordId: id,
    organizationId: ctx.organizationId,
    transformationId: ctx.transformationId,
    newVersion: row.version,
    changes: diffFields({} as BenefitGroupRow, row, [...GROUP_AUDIT_FIELDS]),
  });
  return row;
}

async function updateGroup(tx: Tx, request: FastifyRequest) {
  const { transformationId, benefitGroupId } = parse(groupParams, request.params, "params");
  const ctx = await openBenefitWrite(tx, request, transformationId, BENEFIT_GROUP_MANAGE);
  const body = parseBody(benefitGroupUpdate, request.body);
  const expected = requireIfMatch(request);
  const current = await tx
    .selectFrom("benefit_group")
    .selectAll()
    .where("id", "=", benefitGroupId)
    .where("transformation_id", "=", transformationId)
    .forUpdate()
    .executeTakeFirst();
  if (!current) throw problems.notFound();
  if (current.version !== expected) throw problems.versionConflict(current.version);
  if (current.status === "archived") throw problems.businessRule("record.archived", "Archived records are read-only.");
  if (body.countedBenefitId !== undefined && body.countedBenefitId !== null) {
    await assertSameTransformation(tx, "benefit", transformationId, body.countedBenefitId, "/countedBenefitId");
    const member = await tx
      .selectFrom("benefit")
      .select("id")
      .where("id", "=", body.countedBenefitId)
      .where("benefit_group_id", "=", benefitGroupId)
      .executeTakeFirst();
    if (!member)
      throw benefitRule(
        "benefit_group.counted_not_member",
        "The counted benefit must be a member of the group.",
        "/countedBenefitId",
      );
  }
  const updated = await tx
    .updateTable("benefit_group")
    .set({
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.countedBenefitId !== undefined ? { counted_benefit_id: body.countedBenefitId } : {}),
      ...bumpStamps(ctx.userId),
    })
    .where("id", "=", benefitGroupId)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: "benefit_group.update",
    recordType: "benefit_group",
    recordId: benefitGroupId,
    organizationId: ctx.organizationId,
    transformationId,
    priorVersion: current.version,
    newVersion: updated.version,
    changes: diffFields(current, updated, [...GROUP_AUDIT_FIELDS]),
  });
  return updated;
}

const pageQuery = z.strictObject({ cursor: cursorSchema, limit: limitSchema });

export function registerBenefitGroupRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  const read = { access: { permission: "transformation.read" as const } };
  const write = { access: { permission: BENEFIT_GROUP_MANAGE }, consumes: JSON_BODY };

  app.get(GROUPS, { config: read }, async (request) => {
    const transformationId = parseTransformationParam(request.params);
    const query = parseQuery(pageQuery, request.query);
    await requireTransformationRead(db, principalOf(request), transformationId);
    const hash = filterHash({ table: "benefit_group", transformationId });
    const after = decodeCursor(query.cursor, hash, 1);
    let q = db.selectFrom("benefit_group").selectAll().where("transformation_id", "=", transformationId);
    if (after) q = q.where("id", ">", String(after[0]));
    const rows = await q
      .orderBy("id")
      .limit(query.limit + 1)
      .execute();
    const page = paginate(rows, query.limit, (r) => [r.id], hash);
    return { items: await presentGroups(db, page.items), nextCursor: page.nextCursor };
  });

  app.post(GROUPS, { config: write }, async (request, reply) => {
    const transformationId = parseTransformationParam(request.params);
    const result = await db.transaction().execute(async (tx) => {
      const ctx = await openBenefitWrite(tx, request, transformationId, BENEFIT_GROUP_MANAGE);
      const body = parseBody(benefitGroupCreate, request.body);
      return maybeIdempotent(tx, request, ctx.userId, body, async () => ({
        status: 201,
        body: (await presentGroups(tx, [await createGroup(tx, ctx, body)]))[0]!,
      }));
    });
    return sendCreated(request, reply, result);
  });

  app.get(GROUP_ITEM, { config: read }, async (request, reply) => {
    const { transformationId, benefitGroupId } = parse(groupParams, request.params, "params");
    await requireTransformationRead(db, principalOf(request), transformationId);
    const row = await db
      .selectFrom("benefit_group")
      .selectAll()
      .where("id", "=", benefitGroupId)
      .where("transformation_id", "=", transformationId)
      .executeTakeFirst();
    if (!row) throw problems.notFound();
    return sendVersioned(reply, 200, (await presentGroups(db, [row]))[0]!);
  });

  app.patch(GROUP_ITEM, { config: write }, async (request, reply) => {
    const body = await db
      .transaction()
      .execute(async (tx) => (await presentGroups(tx, [await updateGroup(tx, request)]))[0]!);
    return sendVersioned(reply, 200, body);
  });

  return [`GET ${GROUPS}`, `POST ${GROUPS}`, `GET ${GROUP_ITEM}`, `PATCH ${GROUP_ITEM}`];
}
