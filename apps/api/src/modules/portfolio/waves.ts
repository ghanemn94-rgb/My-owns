// Roadmap waves (T07; ADR-0023 §1; REQ-PB-050; T-DG3-BE-C):
//   GET   /transformations/{id}/waves             the four source waves verbatim (B0079) plus added waves, by ordinal
//   POST  /transformations/{id}/waves             add a NON-source wave (roadmap.edit)
//   GET   /transformations/{id}/waves/{waveId}    one wave
//   PATCH /transformations/{id}/waves/{waveId}    planned dates, owner, notes, status (roadmap.edit; If-Match)
//
// The verbatim source columns of a seeded wave are immutable: the update schema does not admit them (400) and the
// database trigger roadmap_wave_source_immutable is the backstop. Horizons may OVERLAP (planning horizons, not
// deadlines; master prompt §9): there is no exclusion rule on horizons or planned dates. Arabic text is a provisional
// translation. Seeded waves cannot be archived.
//
// This file also holds the small write prologue the other BE-C portfolio files share (deliverables, milestones):
// read gate, row lock, then the write gate re-authorised at commit time on reloaded grants (BE18A), before the body
// is parsed, so a read-only auditor gets 403 for any body.
import { diffFields, type DbOrTx, type RoadmapWaveTable, type Tx } from "@mth/db";
import { businessDate, freeText, roadmapWave, roadmapWaveList, uuid, type RoadmapWave } from "@mth/shared/schemas";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Selectable } from "kysely";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { principalOf, requireTransformationRead, type Ownership, type WriteRule } from "../access/index.ts";
import { record } from "../audit/index.ts";
import {
  HttpProblem,
  iso,
  parse,
  parseBody,
  parseQuery,
  problems,
  requireIfMatch,
  sendVersioned,
  type ModuleDeps,
} from "../platform/index.ts";
import {
  assertActiveUsers,
  bumpStamps,
  loose,
  openWrite,
  type LooseRow,
  type WriteContext,
} from "../transformations/index.ts";

// ------------------------------------------------------------------------------------------------ shared (BE-C)

export const JSON_BODY = ["application/json"] as const;

/** A `date` column as YYYY-MM-DD (@mth/db returns dates as text). */
export function dateText(d: string | null): string | null {
  return d === null ? null : String(d).slice(0, 10);
}

/** 422 business rule with one pointer (ADR-0007 §5b). */
export function rule(code: string, detail: string, pointer: string): HttpProblem {
  return new HttpProblem({
    status: 422,
    type: "urn:mth:problem:validation",
    code,
    title: "Business rule violated",
    detail,
    errors: [{ pointer, code, message: detail }],
  });
}

/** 422 invalid transition (status changes outside the allowed steps). */
export function transitionProblem(code: string, detail: string): HttpProblem {
  return new HttpProblem({
    status: 422,
    type: "urn:mth:problem:invalid-transition",
    code,
    title: "Invalid transition",
    detail,
  });
}

/** 403 with a specific code (record-level rules: ownership, separation of duties). */
export function forbiddenProblem(code: string, detail: string): HttpProblem {
  return new HttpProblem({ status: 403, type: "urn:mth:problem:forbidden", code, title: "Forbidden", detail });
}

/** The end of a planned range must not precede its start (422 at `endPointer`). */
export function assertRange(start: string | null, end: string | null, code: string, endPointer: string): void {
  if (start !== null && end !== null && end < start)
    throw rule(code, "The planned end cannot be before the planned start.", endPointer);
}

export interface LockedRecord<Row> {
  readonly ctx: WriteContext;
  readonly current: Row;
}

/**
 * The write prologue of a mutation on an existing transformation-scoped record (BE18A pattern):
 *   1. find the row (404 when absent), 2. the read gate of its transformation (404 when not readable),
 *   3. lock the row FOR UPDATE, 4. re-resolve the session and reload the grants INSIDE the transaction and apply the
 *   write rules on them (403; a read right lost meanwhile is 403 too) - after any wait for the lock, i.e. at commit
 *   time, and before the body is parsed.
 * The caller then parses the body and checks If-Match.
 */
export async function lockForWrite<Row extends { transformation_id: string }>(
  tx: Tx,
  request: FastifyRequest,
  table: string,
  id: string,
  rules: readonly WriteRule[],
  ownership: (row: Row) => Ownership | Promise<Ownership>,
): Promise<LockedRecord<Row>> {
  const seen = (await loose(tx)
    .selectFrom(table)
    .select(["id", "transformation_id"])
    .where("id", "=", id)
    .executeTakeFirst()) as { transformation_id: string } | undefined;
  if (!seen) throw problems.notFound();
  await requireTransformationRead(tx, principalOf(request), seen.transformation_id);
  const current = (await loose(tx)
    .selectFrom(table)
    .selectAll()
    .where("id", "=", id)
    .forUpdate()
    .executeTakeFirst()) as unknown as Row | undefined;
  if (!current) throw problems.notFound();
  const ctx = await openWrite(tx, request, current.transformation_id, rules, await ownership(current), {
    atCommit: true,
  });
  return { ctx, current };
}

/** If-Match against the locked row's version (428 when absent, 409 with currentVersion when stale). */
export function checkVersion(request: FastifyRequest, current: { version: number }): void {
  const expected = requireIfMatch(request);
  if (current.version !== expected) throw problems.versionConflict(current.version);
}

// ------------------------------------------------------------------------------------------------ schemas

const nullableDate = businessDate.nullable();
const waveCode = z.string().regex(/^[a-z][a-z0-9_]{0,47}$/);
const weeks = z.number().int().min(0).max(520);

// The RoadmapWave(+List) response mirrors live in `@mth/shared/schemas` (roadmap.ts, T-DG3-ARCH-04), re-exported here.
export { roadmapWave, roadmapWaveList, type RoadmapWave };

export const roadmapWaveCreate = z.strictObject({
  code: waveCode,
  nameEn: freeText(1, 200),
  nameAr: freeText(1, 200),
  purposeEn: freeText(1, 500),
  purposeAr: freeText(1, 500),
  horizonEn: freeText(1, 100),
  horizonAr: freeText(1, 100),
  entryCriteriaEn: freeText(1, 500),
  entryCriteriaAr: freeText(1, 500),
  exitEvidenceEn: freeText(1, 500),
  exitEvidenceAr: freeText(1, 500),
  horizonFromWeeks: weeks,
  horizonToWeeks: weeks,
  plannedStart: nullableDate.optional(),
  plannedEnd: nullableDate.optional(),
  ownerUserId: uuid.nullable().optional(),
});
export const roadmapWaveUpdate = z
  .strictObject({
    plannedStart: nullableDate.optional(),
    plannedEnd: nullableDate.optional(),
    ownerUserId: uuid.nullable().optional(),
    notes: freeText(1, 4000).nullable().optional(),
    status: z.enum(["active", "archived"]).optional(),
  })
  .refine((v) => Object.keys(v).length >= 1, "validation.min_properties");

// ------------------------------------------------------------------------------------------------ presenter

export type WaveRow = Selectable<RoadmapWaveTable>;

export const toRoadmapWave = (r: WaveRow): RoadmapWave => ({
  id: r.id,
  organizationId: r.organization_id,
  transformationId: r.transformation_id,
  code: r.code,
  ordinal: r.ordinal,
  isSourceSeeded: r.is_source_seeded,
  sourceRef: r.source_ref,
  nameEn: r.name_en,
  nameAr: r.name_ar,
  purposeEn: r.purpose_en,
  purposeAr: r.purpose_ar,
  horizonEn: r.horizon_en,
  horizonAr: r.horizon_ar,
  entryCriteriaEn: r.entry_criteria_en,
  entryCriteriaAr: r.entry_criteria_ar,
  exitEvidenceEn: r.exit_evidence_en,
  exitEvidenceAr: r.exit_evidence_ar,
  horizonFromWeeks: r.horizon_from_weeks,
  horizonToWeeks: r.horizon_to_weeks,
  plannedStart: dateText(r.planned_start),
  plannedEnd: dateText(r.planned_end),
  ownerUserId: r.owner_user_id,
  notes: r.notes,
  status: r.status as RoadmapWave["status"],
  version: r.version,
  createdAt: iso(r.created_at),
  createdBy: r.created_by,
  updatedAt: iso(r.updated_at),
  updatedBy: r.updated_by,
});

/** Every wave of a transformation by ordinal (archived ones too: the list is "all waves"). */
export function loadWaves(db: DbOrTx, transformationId: string): Promise<WaveRow[]> {
  return db
    .selectFrom("roadmap_wave")
    .selectAll()
    .where("transformation_id", "=", transformationId)
    .orderBy("ordinal")
    .orderBy("id")
    .execute();
}

// ------------------------------------------------------------------------------------------------ writes

const WAVE_RULES: readonly WriteRule[] = [{ permission: "roadmap.edit" }];
const WAVE_AUDIT_FIELDS = [
  "code",
  "ordinal",
  "name_en",
  "name_ar",
  "purpose_en",
  "purpose_ar",
  "horizon_en",
  "horizon_ar",
  "entry_criteria_en",
  "entry_criteria_ar",
  "exit_evidence_en",
  "exit_evidence_ar",
  "horizon_from_weeks",
  "horizon_to_weeks",
  "planned_start",
  "planned_end",
  "owner_user_id",
  "notes",
  "status",
] as const;

async function createWave(tx: Tx, request: FastifyRequest, transformationId: string): Promise<WaveRow> {
  await requireTransformationRead(tx, principalOf(request), transformationId);
  // Serialise wave creation per transformation (the ordinal is max + 1) and give the commit-time check a wait point.
  await tx.selectFrom("transformation").select("id").where("id", "=", transformationId).forUpdate().execute();
  const ctx = await openWrite(tx, request, transformationId, WAVE_RULES, null, { atCommit: true });
  const body = parseBody(roadmapWaveCreate, request.body);
  if (body.horizonToWeeks < body.horizonFromWeeks)
    throw rule(
      "roadmap_wave.horizon_range",
      "The horizon end (weeks) cannot be before the horizon start.",
      "/horizonToWeeks",
    );
  assertRange(body.plannedStart ?? null, body.plannedEnd ?? null, "roadmap_wave.planned_range", "/plannedEnd");
  await assertActiveUsers(tx, ctx.organizationId, [{ id: body.ownerUserId ?? null, pointer: "/ownerUserId" }]);
  const existing = await loadWaves(tx, transformationId);
  if (existing.some((w) => w.code === body.code))
    throw problems.duplicate(
      "roadmap_wave.duplicate_code",
      "A wave with this code already exists in the transformation.",
    );
  const ordinal = existing.reduce((max, w) => Math.max(max, w.ordinal), -1) + 1;
  if (ordinal > 99) throw rule("roadmap_wave.too_many", "A transformation has at most 100 waves.", "/code");
  const id = uuidv7();
  const row = await tx
    .insertInto("roadmap_wave")
    .values({
      id,
      organization_id: ctx.organizationId,
      transformation_id: transformationId,
      code: body.code,
      ordinal,
      is_source_seeded: false,
      source_ref: null,
      name_en: body.nameEn,
      name_ar: body.nameAr,
      purpose_en: body.purposeEn,
      purpose_ar: body.purposeAr,
      horizon_en: body.horizonEn,
      horizon_ar: body.horizonAr,
      entry_criteria_en: body.entryCriteriaEn,
      entry_criteria_ar: body.entryCriteriaAr,
      exit_evidence_en: body.exitEvidenceEn,
      exit_evidence_ar: body.exitEvidenceAr,
      horizon_from_weeks: body.horizonFromWeeks,
      horizon_to_weeks: body.horizonToWeeks,
      planned_start: body.plannedStart ?? null,
      planned_end: body.plannedEnd ?? null,
      owner_user_id: body.ownerUserId ?? null,
      created_by: ctx.userId,
      updated_by: ctx.userId,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: "roadmap_wave.create",
    recordType: "roadmap_wave",
    recordId: id,
    organizationId: ctx.organizationId,
    transformationId,
    newVersion: row.version,
    changes: diffFields({} as LooseRow, row as unknown as LooseRow, WAVE_AUDIT_FIELDS),
  });
  return row;
}

async function updateWave(tx: Tx, request: FastifyRequest, transformationId: string, waveId: string) {
  const owner = await tx
    .selectFrom("roadmap_wave")
    .select("id")
    .where("id", "=", waveId)
    .where("transformation_id", "=", transformationId)
    .executeTakeFirst();
  if (!owner) {
    await requireTransformationRead(tx, principalOf(request), transformationId);
    throw problems.notFound();
  }
  const { ctx, current } = await lockForWrite<WaveRow>(tx, request, "roadmap_wave", waveId, WAVE_RULES, (r) => ({
    createdBy: r.created_by,
    ownerUserId: r.owner_user_id,
  }));
  const body = parseBody(roadmapWaveUpdate, request.body);
  checkVersion(request, current);
  if (current.status === "archived" && body.status !== "active")
    throw problems.businessRule("record.archived", "Archived records are read-only.");
  if (body.status === "archived" && current.is_source_seeded)
    throw rule("roadmap_wave.seeded_not_archivable", "A source wave (B0079) cannot be archived.", "/status");
  const next = {
    planned_start: body.plannedStart !== undefined ? body.plannedStart : dateText(current.planned_start),
    planned_end: body.plannedEnd !== undefined ? body.plannedEnd : dateText(current.planned_end),
  };
  assertRange(next.planned_start, next.planned_end, "roadmap_wave.planned_range", "/plannedEnd");
  await assertActiveUsers(tx, ctx.organizationId, [{ id: body.ownerUserId ?? null, pointer: "/ownerUserId" }]);
  const changes: LooseRow = {
    ...(body.plannedStart !== undefined ? { planned_start: body.plannedStart } : {}),
    ...(body.plannedEnd !== undefined ? { planned_end: body.plannedEnd } : {}),
    ...(body.ownerUserId !== undefined ? { owner_user_id: body.ownerUserId } : {}),
    ...(body.notes !== undefined ? { notes: body.notes } : {}),
    ...(body.status !== undefined ? { status: body.status } : {}),
  };
  const updated = (await loose(tx)
    .updateTable("roadmap_wave")
    .set({ ...changes, ...bumpStamps(ctx.userId) })
    .where("id", "=", current.id)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow()) as unknown as WaveRow;
  await record(tx, ctx.audit, {
    action: "roadmap_wave.update",
    recordType: "roadmap_wave",
    recordId: current.id,
    organizationId: ctx.organizationId,
    transformationId: ctx.transformationId,
    priorVersion: current.version,
    newVersion: updated.version,
    changes: diffFields(current as unknown as LooseRow, updated as unknown as LooseRow, WAVE_AUDIT_FIELDS),
  });
  return updated;
}

// ------------------------------------------------------------------------------------------------ routes

const BASE = "/api/v1/transformations/:transformationId/waves";
const tParams = z.strictObject({ transformationId: z.uuid() });
const wParams = z.strictObject({ transformationId: z.uuid(), waveId: z.uuid() });

/** Registers the wave routes and returns them as "METHOD /path". */
export function registerWaveRoutes(app: FastifyInstance, { db }: ModuleDeps): readonly string[] {
  app.get(BASE, { config: { access: { permission: "transformation.read" } } }, async (request) => {
    const { transformationId } = parse(tParams, request.params, "params");
    parseQuery(z.strictObject({}), request.query);
    await requireTransformationRead(db, principalOf(request), transformationId);
    return { items: (await loadWaves(db, transformationId)).map(toRoadmapWave) };
  });

  app.post(
    BASE,
    { config: { access: { permission: "roadmap.edit" }, consumes: JSON_BODY } },
    async (request, reply) => {
      const { transformationId } = parse(tParams, request.params, "params");
      const row = await db.transaction().execute((tx) => createWave(tx, request, transformationId));
      return sendVersioned(
        reply,
        201,
        toRoadmapWave(row),
        `/api/v1/transformations/${transformationId}/waves/${row.id}`,
      );
    },
  );

  app.get(`${BASE}/:waveId`, { config: { access: { permission: "transformation.read" } } }, async (request, reply) => {
    const { transformationId, waveId } = parse(wParams, request.params, "params");
    await requireTransformationRead(db, principalOf(request), transformationId);
    const row = await db
      .selectFrom("roadmap_wave")
      .selectAll()
      .where("id", "=", waveId)
      .where("transformation_id", "=", transformationId)
      .executeTakeFirst();
    if (!row) throw problems.notFound();
    return sendVersioned(reply, 200, toRoadmapWave(row));
  });

  app.patch(
    `${BASE}/:waveId`,
    { config: { access: { permission: "roadmap.edit" }, consumes: JSON_BODY } },
    async (request, reply) => {
      const { transformationId, waveId } = parse(wParams, request.params, "params");
      const row = await db.transaction().execute((tx) => updateWave(tx, request, transformationId, waveId));
      return sendVersioned(reply, 200, toRoadmapWave(row));
    },
  );

  return [`GET ${BASE}`, `POST ${BASE}`, `GET ${BASE}/:waveId`, `PATCH ${BASE}/:waveId`];
}
