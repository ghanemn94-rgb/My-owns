// Lessons and the cross-transformation lesson search (P4 slice G; ADR-0034 §8, §9, §12; T-DG4-BE-I2; REQ-S11-008 "a
// lesson is searchable from another transformation"):
//   GET   /transformations/{t}/lessons                     the transformation's lessons, drafts included (transformation.read)
//   POST  /transformations/{t}/lessons                     create, draft (lesson.edit; BO, TO)
//   PATCH /transformations/{t}/lessons/{l}                 edit, or archive (status archived; final) (If-Match)
//   POST  /transformations/{t}/lessons/{l}/publish         draft -> published (bodiless; If-Match)
//   GET   /lessons/search?q=&tag=&cursor=&limit=           published lessons across transformations (lesson.search)
//
// Search scope (ADR-0034 §8, p4-work-split FG.11 item 9): PUBLISHED lessons only, of transformations of the caller's
// organizations whose business unit is in the caller's lesson.search scope. The scope is the ADR-0006 one compiled by
// scopeFilter (organization grants, business-unit grants with their descendants, transformation grants), widened for a
// transformation-scoped grant to the business unit of that transformation: a user of transformation 2 finds the
// published lessons of transformation 1 of the same business unit, and nothing of a business unit outside the scope
// (no existence disclosure: such lessons are simply absent). Matching is plainto_tsquery('simple', q) on the stored
// `search_document`, so Arabic and English text are tokenised the same way. Drafts and archived lessons are never
// returned by the search. No guard here reads the transformation's status: lessons stay editable after closure.
// Every mutation re-checks authorization at commit time, validates, needs If-Match (creates are version 1) and writes
// its audit event in the same transaction (S-4). Nothing here approves anything or touches DG0-DG7.
import { sql, type DbOrTx, type Tx } from "@mth/db";
import { lessonCreate, lessonUpdate, type Lesson, type LessonSearchHit } from "@mth/shared/schemas";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { holdsAnywhere, principalOf, requireTransformationRead, scopeFilter, type Principal } from "../access/index.ts";
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
import { assertOpenArea, diffFields, nextOperationsCode } from "./controls.ts";
import { JSON_BODY, openSustainmentWrite, parseTransformationParam, sustainRule } from "./performance-areas.ts";

export const LESSONS = "/api/v1/transformations/:transformationId/lessons";
export const LESSON_ITEM = `${LESSONS}/:lessonId`;
export const LESSON_PUBLISH = `${LESSON_ITEM}/publish`;
export const LESSON_SEARCH = "/api/v1/lessons/search";
export const LESSON_EDIT = "lesson.edit" as const;
export const LESSON_SEARCH_PERMISSION = "lesson.search" as const;

// ------------------------------------------------------------------------------------------------ problems (§12, S-11)

const LESSON_ARCHIVED = () => sustainRule("lesson.archived", "This lesson is archived and can no longer be changed.");
const LESSON_TRANSITION = (from: string, to: string) =>
  sustainRule("lesson.status_transition", `This lesson cannot move from ${from} to ${to}.`);

// ------------------------------------------------------------------------------------------------ rows

interface LessonRow {
  id: string;
  organization_id: string;
  transformation_id: string;
  code: string;
  performance_area_id: string | null;
  title: string;
  context: string | null;
  lesson_text: string;
  recommendation: string | null;
  tags: string[];
  status: string;
  published_at: Date | string | null;
  published_by: string | null;
  archived_at: Date | string | null;
  archived_by: string | null;
  version: number;
  created_at: Date | string;
  created_by: string;
  updated_at: Date | string;
  updated_by: string;
}

/** Every column but the generated `search_document` (never returned). */
const LESSON_COLUMNS = [
  "id",
  "organization_id",
  "transformation_id",
  "code",
  "performance_area_id",
  "title",
  "context",
  "lesson_text",
  "recommendation",
  "tags",
  "status",
  "published_at",
  "published_by",
  "archived_at",
  "archived_by",
  "version",
  "created_at",
  "created_by",
  "updated_at",
  "updated_by",
] as const;

const LESSON_AUDIT_FIELDS = [
  "code",
  "performance_area_id",
  "title",
  "context",
  "lesson_text",
  "recommendation",
  "tags",
  "status",
] as const;

const toLesson = (r: LessonRow): Lesson => ({
  id: r.id,
  transformationId: r.transformation_id,
  code: r.code,
  performanceAreaId: r.performance_area_id,
  title: r.title,
  context: r.context,
  lessonText: r.lesson_text,
  recommendation: r.recommendation,
  tags: [...r.tags],
  status: r.status as Lesson["status"],
  publishedAt: isoOrNull(r.published_at as Date | null),
  publishedBy: r.published_by,
  archivedAt: isoOrNull(r.archived_at as Date | null),
  archivedBy: r.archived_by,
  version: r.version,
  createdAt: iso(r.created_at as Date),
  createdBy: r.created_by,
  updatedAt: iso(r.updated_at as Date),
  updatedBy: r.updated_by,
});

async function findLesson(db: DbOrTx, transformationId: string, id: string, lock = false): Promise<LessonRow> {
  let q = db
    .selectFrom("lesson")
    .select([...LESSON_COLUMNS])
    .where("id", "=", id)
    .where("transformation_id", "=", transformationId);
  if (lock) q = q.forUpdate();
  const row = await q.executeTakeFirst();
  if (!row) throw problems.notFound();
  return row as LessonRow;
}

// ------------------------------------------------------------------------------------------------ writes

async function createLesson(tx: Tx, request: FastifyRequest): Promise<string> {
  const transformationId = parseTransformationParam(request.params);
  const ctx = await openSustainmentWrite(tx, request, transformationId, LESSON_EDIT);
  const body = parseBody(lessonCreate, request.body);
  if (body.performanceAreaId !== undefined && body.performanceAreaId !== null)
    await assertOpenArea(tx, transformationId, body.performanceAreaId, "/performanceAreaId");
  const id = uuidv7();
  const row = (await tx
    .insertInto("lesson")
    .values({
      id,
      organization_id: ctx.organizationId,
      transformation_id: transformationId,
      code: await nextOperationsCode(tx, transformationId, "LL"),
      performance_area_id: body.performanceAreaId ?? null,
      title: body.title,
      context: body.context ?? null,
      lesson_text: body.lessonText,
      recommendation: body.recommendation ?? null,
      tags: body.tags ?? [],
      created_by: ctx.userId,
      updated_by: ctx.userId,
    })
    .returning([...LESSON_COLUMNS])
    .executeTakeFirstOrThrow()) as LessonRow;
  await record(tx, ctx.audit, {
    action: "lesson.create",
    recordType: "lesson",
    recordId: id,
    organizationId: ctx.organizationId,
    transformationId,
    newVersion: row.version,
    changes: diffFields({}, row, LESSON_AUDIT_FIELDS),
  });
  return id;
}

async function updateLesson(tx: Tx, request: FastifyRequest, transformationId: string, lessonId: string) {
  const ctx = await openSustainmentWrite(tx, request, transformationId, LESSON_EDIT);
  const body = parseBody(lessonUpdate, request.body);
  const expected = requireIfMatch(request);
  const current = await findLesson(tx, transformationId, lessonId, true);
  if (current.version !== expected) throw problems.versionConflict(current.version);
  if (current.status === "archived") throw LESSON_ARCHIVED();
  if (body.performanceAreaId !== undefined && body.performanceAreaId !== null)
    await assertOpenArea(tx, transformationId, body.performanceAreaId, "/performanceAreaId");
  const archiving = body.status === "archived";
  const updated = (await tx
    .updateTable("lesson")
    .set({
      ...(body.performanceAreaId !== undefined ? { performance_area_id: body.performanceAreaId } : {}),
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.context !== undefined ? { context: body.context } : {}),
      ...(body.lessonText !== undefined ? { lesson_text: body.lessonText } : {}),
      ...(body.recommendation !== undefined ? { recommendation: body.recommendation } : {}),
      ...(body.tags !== undefined ? { tags: body.tags } : {}),
      ...(archiving ? { status: "archived", archived_at: sql<Date>`now()`, archived_by: ctx.userId } : {}),
      version: sql<number>`version + 1`,
      updated_at: sql<Date>`now()`,
      updated_by: ctx.userId,
    })
    .where("id", "=", current.id)
    .where("version", "=", current.version)
    .returning([...LESSON_COLUMNS])
    .executeTakeFirstOrThrow()) as LessonRow;
  await record(tx, ctx.audit, {
    action: archiving ? "lesson.archive" : "lesson.update",
    recordType: "lesson",
    recordId: current.id,
    organizationId: ctx.organizationId,
    transformationId,
    priorVersion: current.version,
    newVersion: updated.version,
    changes: diffFields(current, updated, LESSON_AUDIT_FIELDS),
  });
}

async function publishLesson(tx: Tx, request: FastifyRequest, transformationId: string, lessonId: string) {
  const ctx = await openSustainmentWrite(tx, request, transformationId, LESSON_EDIT);
  const expected = requireIfMatch(request);
  const current = await findLesson(tx, transformationId, lessonId, true);
  if (current.version !== expected) throw problems.versionConflict(current.version);
  if (current.status === "archived") throw LESSON_ARCHIVED();
  if (current.status !== "draft") throw LESSON_TRANSITION(current.status, "published");
  const updated = (await tx
    .updateTable("lesson")
    .set({
      status: "published",
      published_at: sql<Date>`now()`,
      published_by: ctx.userId,
      version: sql<number>`version + 1`,
      updated_at: sql<Date>`now()`,
      updated_by: ctx.userId,
    })
    .where("id", "=", current.id)
    .where("version", "=", current.version)
    .returning([...LESSON_COLUMNS])
    .executeTakeFirstOrThrow()) as LessonRow;
  await record(tx, ctx.audit, {
    action: "lesson.publish",
    recordType: "lesson",
    recordId: current.id,
    organizationId: ctx.organizationId,
    transformationId,
    priorVersion: current.version,
    newVersion: updated.version,
    changes: diffFields(current, updated, LESSON_AUDIT_FIELDS),
  });
}

// ------------------------------------------------------------------------------------------------ search

/** Transformations the principal holds lesson.search in at transformation scope (their business units widen it). */
function transformationScopedGrants(principal: Principal): string[] {
  return [
    ...new Set(
      principal.grants
        .filter((g) => g.scopeType === "transformation" && g.permissions.has(LESSON_SEARCH_PERMISSION))
        .map((g) => g.scopeId),
    ),
  ];
}

const searchQuery = z.strictObject({
  q: z.string().min(1).max(200).optional(),
  tag: z.string().min(1).max(50).optional(),
  cursor: cursorSchema,
  limit: limitSchema,
});

async function searchLessons(db: DbOrTx, principal: Principal, query: z.output<typeof searchQuery>) {
  const hash = filterHash({ table: "lesson.search", q: query.q ?? null, tag: query.tag ?? null });
  const after = decodeCursor(query.cursor, hash, 2);
  const trScoped = transformationScopedGrants(principal);
  const inScope = scopeFilter(principal, LESSON_SEARCH_PERMISSION, {
    level: "transformation",
    organizationId: sql.ref("t.organization_id"),
    businessUnitId: sql.ref("t.business_unit_id"),
    transformationId: sql.ref("t.id"),
  });
  const viaTransformationGrant =
    trScoped.length === 0
      ? sql<boolean>`FALSE`
      : sql<boolean>`EXISTS (SELECT 1 FROM transformation g WHERE g.id = ANY(${trScoped}::uuid[])
                             AND g.organization_id = t.organization_id AND g.business_unit_id = t.business_unit_id)`;
  let q = db
    .selectFrom("lesson as l")
    .innerJoin("transformation as t", "t.id", "l.transformation_id")
    .select(LESSON_COLUMNS.map((c) => `l.${c}` as const))
    .select(["t.code as transformation_code", "t.name as transformation_name"])
    .select(sql<string>`to_char(l.published_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`.as("sort_key"))
    .where("l.status", "=", "published")
    .where(sql<boolean>`(${inScope} OR ${viaTransformationGrant})`);
  if (query.q !== undefined)
    q = q.where(sql<boolean>`l.search_document @@ plainto_tsquery('simple'::regconfig, ${query.q})`);
  if (query.tag !== undefined) q = q.where(sql<boolean>`${query.tag} = ANY(l.tags)`);
  if (after)
    q = q.where(sql<boolean>`(l.published_at, l.id) < (${String(after[0])}::timestamptz, ${String(after[1])}::uuid)`);
  const rows = await q
    .orderBy("l.published_at", "desc")
    .orderBy("l.id", "desc")
    .limit(query.limit + 1)
    .execute();
  const page = paginate(rows, query.limit, (r) => [r.sort_key, r.id], hash);
  const items: LessonSearchHit[] = page.items.map((r) => ({
    lesson: toLesson(r as unknown as LessonRow),
    transformationCode: r.transformation_code,
    transformationName: r.transformation_name,
  }));
  return { items, nextCursor: page.nextCursor };
}

// ------------------------------------------------------------------------------------------------ routes

const lessonParams = z.strictObject({ transformationId: z.uuid(), lessonId: z.uuid() });
const listQuery = z.strictObject({
  cursor: cursorSchema,
  limit: limitSchema,
  status: z.enum(["draft", "published", "archived"]).optional(),
});

/** Registers this file's routes and returns them as "METHOD /path". */
export function registerLessonRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  const read = { access: { permission: "transformation.read" as const } };
  const edit = { access: { permission: LESSON_EDIT }, consumes: JSON_BODY };
  const editBodiless = { access: { permission: LESSON_EDIT } };
  const search = { access: { permission: LESSON_SEARCH_PERMISSION } };

  app.get(LESSON_SEARCH, { config: search }, async (request) => {
    const principal = principalOf(request);
    const query = parseQuery(searchQuery, request.query);
    if (!holdsAnywhere(principal, LESSON_SEARCH_PERMISSION)) throw problems.forbidden();
    return searchLessons(db, principal, query);
  });

  app.get(LESSONS, { config: read }, async (request) => {
    const transformationId = parseTransformationParam(request.params);
    const query = parseQuery(listQuery, request.query);
    await requireTransformationRead(db, principalOf(request), transformationId);
    const hash = filterHash({ table: "lesson", transformationId, status: query.status ?? null });
    const after = decodeCursor(query.cursor, hash, 1);
    let q = db
      .selectFrom("lesson")
      .select([...LESSON_COLUMNS])
      .where("transformation_id", "=", transformationId);
    if (query.status !== undefined) q = q.where("status", "=", query.status);
    if (after) q = q.where("id", ">", String(after[0]));
    const rows = (await q
      .orderBy("id")
      .limit(query.limit + 1)
      .execute()) as LessonRow[];
    const page = paginate(rows, query.limit, (r) => [r.id], hash);
    return { items: page.items.map(toLesson), nextCursor: page.nextCursor };
  });

  app.post(LESSONS, { config: edit }, async (request, reply) => {
    const transformationId = parseTransformationParam(request.params);
    const body = await db.transaction().execute(async (tx) => {
      const id = await createLesson(tx, request);
      return toLesson(await findLesson(tx, transformationId, id));
    });
    return sendVersioned(reply, 201, body, `${request.url.split("?")[0]!}/${body.id}`);
  });

  app.patch(LESSON_ITEM, { config: edit }, async (request, reply) => {
    const { transformationId, lessonId } = parse(lessonParams, request.params, "params");
    const body = await db.transaction().execute(async (tx) => {
      await updateLesson(tx, request, transformationId, lessonId);
      return toLesson(await findLesson(tx, transformationId, lessonId));
    });
    return sendVersioned(reply, 200, body);
  });

  app.post(LESSON_PUBLISH, { config: editBodiless }, async (request, reply) => {
    const { transformationId, lessonId } = parse(lessonParams, request.params, "params");
    const body = await db.transaction().execute(async (tx) => {
      await publishLesson(tx, request, transformationId, lessonId);
      return toLesson(await findLesson(tx, transformationId, lessonId));
    });
    return sendVersioned(reply, 200, body);
  });

  return [
    `GET ${LESSON_SEARCH}`,
    `GET ${LESSONS}`,
    `POST ${LESSONS}`,
    `PATCH ${LESSON_ITEM}`,
    `POST ${LESSON_PUBLISH}`,
  ];
}
