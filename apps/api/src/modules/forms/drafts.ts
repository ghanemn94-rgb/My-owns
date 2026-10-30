// Form drafts (OpenAPI tag "forms"; ADR-0041 §5 "Draft saving", §6, §9, §10; REQ-S05-001; p5-work-split §B.4;
// T-DG5-BE-E2):
//   GET  /transformations/{t}/form-drafts                     listFormDrafts   (own drafts, newest first)
//   POST /transformations/{t}/form-drafts                     createFormDraft
//   GET  /transformations/{t}/form-drafts/{draftId}           getFormDraft     (reopen; baseChanged)
//   PUT  /transformations/{t}/form-drafts/{draftId}           updateFormDraft
//   POST /transformations/{t}/form-drafts/{draftId}/close     closeFormDraft   (saved | discarded)
//   GET  /me/form-drafts                                      listMyFormDrafts (P6, T-DG6-BE-Q2; ADR-0057 §6: the
//        caller's OPEN drafts across transformations, newest first, for draft recovery; a draft of a transformation the
//        caller can no longer read - ReadScope, transformation.read - is left out and not changed)
// A draft is the author's partial request body (`payload`, a JSON object of at most 256 KiB) for a new record or an
// existing one, with the record version it was started from. `open -> closed` ('saved' after the record write
// succeeded, or 'discarded'); a closed draft never changes (form_draft_guard). One open draft per user and existing
// record (form_draft_open_record_key; 409 form_draft.open_exists). Only the owner reads or changes a draft: everyone
// else gets 404 (the owner is the creator; form_draft_owner_is_creator). "A saved draft reopens" = getFormDraft returns
// the stored payload; when the record's version moved past the draft's base version, `baseChanged` is true and the
// client offers the conflict view (ADR-0041 §5 "Recoverable conflict").
// Authorization: reads need `transformation.read` in scope (404 outside it); every write needs the record type's
// `write_permission_code` in that scope, re-checked on the principal reloaded inside the write transaction
// (commit-time authorization, ADR-0006; AUD holds no write code and gets 403). Writes: If-Match on update and close
// (428 missing; 409 form_record.conflict with currentVersion when stale); creates are version 1; one audit event per
// write in the same transaction; no remote I/O. A draft approves nothing: no G1-G6 business approval is involved.
import { sql, type Db, type DbOrTx, type FormDraftRow, type FormRecordTypeRow, type Tx } from "@mth/db";
import { PROBLEM_TYPES } from "@mth/shared";
import {
  FORM_DRAFT_MAX_PAYLOAD_BYTES,
  formDraftClose,
  formDraftCreate,
  formDraftListQuery,
  formDraftUpdate,
  formRecordTypeCode,
  hasInvalidCharacter,
  uuid,
  type FormDraft,
} from "@mth/shared/schemas";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { auditContextOf, principalOf, readScopeFor } from "../access/index.ts";
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
import { assertWorking, loadRecordType, requireRecordWrite, requireTransformationRead } from "./record-types.ts";

export const FORM_DRAFTS = "/api/v1/transformations/:transformationId/form-drafts";
export const FORM_DRAFT = `${FORM_DRAFTS}/:draftId`;
export const FORM_DRAFT_CLOSE = `${FORM_DRAFT}/close`;
export const MY_FORM_DRAFTS = "/api/v1/me/form-drafts";
const JSON_BODY = ["application/json"] as const;
const tParams = z.strictObject({ transformationId: uuid });
const dParams = z.strictObject({ transformationId: uuid, draftId: uuid });

/** ADR-0041 §10 refusals of drafts (exact English texts). */
export const draftRefusals = {
  closed: () => problems.businessRule("form_draft.closed", "This draft is closed. Start a new draft."),
  openExists: () =>
    problems.duplicate(
      "form_draft.open_exists",
      "You already have an open draft of this record. Continue it or discard it first.",
    ),
};

/** 409 form_record.conflict (ADR-0041 §5 "Recoverable conflict", §10), with the server's current version. */
export function formRecordConflict(currentVersion: number | null): HttpProblem {
  return new HttpProblem({
    status: 409,
    type: PROBLEM_TYPES.versionConflict,
    code: "form_record.conflict",
    title: "Version conflict",
    detail: "This record changed since you opened it. Review the current version, then apply your changes again.",
    ...(currentVersion !== null ? { currentVersion } : {}),
  });
}

/**
 * The current version of a stored record of the type in the transformation (T04/T16: of the right decision kind), or
 * null when there is none. A register without a `version` column (funding decisions are append-only and immutable)
 * is at version 1. Table and column names come from the read-only registry (0068 seed), never from input.
 */
export async function currentRecordVersion(
  db: DbOrTx,
  rt: FormRecordTypeRow,
  transformationId: string,
  recordId: string,
  forUpdate = false,
): Promise<number | null> {
  if (rt.table_name === null || rt.table_name === "procedure_definition") return null;
  const kind =
    rt.discriminator_column !== null && rt.discriminator_value !== null
      ? sql` AND ${sql.ref(rt.discriminator_column)} = ${rt.discriminator_value}`
      : sql``;
  const lock = forUpdate ? sql` FOR UPDATE` : sql``;
  const r = await sql<{ v: string | null }>`SELECT to_jsonb(r.*) ->> 'version' AS v FROM ${sql.table(rt.table_name)} r
     WHERE r.id = ${recordId}::uuid AND r.transformation_id = ${transformationId}::uuid${kind}${lock}`.execute(db);
  const row = r.rows[0];
  if (row === undefined) return null;
  return row.v === null ? 1 : Number(row.v);
}

/** Payload rules beyond the object shape: at most 256 KiB of UTF-8 JSON and every text storable (shared rule 1). */
function checkPayload(payload: Record<string, unknown>): void {
  if (Buffer.byteLength(JSON.stringify(payload), "utf8") > FORM_DRAFT_MAX_PAYLOAD_BYTES)
    throw problems.badRequest("validation.too_big", "The draft is larger than 256 KiB.", "/payload");
  const errors: { pointer: string; code: string; message: string }[] = [];
  const walk = (v: unknown, pointer: string) => {
    if (typeof v === "string") {
      if (hasInvalidCharacter(v))
        errors.push({
          pointer,
          code: "validation.invalid_character",
          message: "The text contains an invalid character.",
        });
    } else if (Array.isArray(v)) {
      v.forEach((x, i) => walk(x, `${pointer}/${i}`));
    } else if (v !== null && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) {
        if (hasInvalidCharacter(k))
          errors.push({
            pointer,
            code: "validation.invalid_character",
            message: "The text contains an invalid character.",
          });
        walk(x, `${pointer}/${k.replace(/~/g, "~0").replace(/\//g, "~1")}`);
      }
    }
  };
  walk(payload, "/payload");
  if (errors.length > 0) throw problems.validation(errors.slice(0, 20));
}

async function present(db: DbOrTx, r: FormDraftRow): Promise<FormDraft> {
  let baseChanged = false;
  if (r.record_id !== null && r.base_record_version !== null) {
    const rt = await loadRecordType(db, r.record_type);
    const current = await currentRecordVersion(db, rt, r.transformation_id, r.record_id);
    // A record that cannot be read back is never reported as unchanged.
    baseChanged = current === null || current > r.base_record_version;
  }
  return {
    id: r.id,
    recordType: r.record_type,
    recordId: r.record_id,
    baseRecordVersion: r.base_record_version,
    baseChanged,
    payload: r.payload as Record<string, unknown>,
    status: r.status as FormDraft["status"],
    closedReason: r.closed_reason as FormDraft["closedReason"],
    closedAt: isoOrNull(r.closed_at),
    version: r.version,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

/** The record type a create body names, read before the body is validated (the write gate comes first). */
function peekRecordType(body: unknown): string | null {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return null;
  const v = new Map(Object.entries(body)).get("recordType");
  return formRecordTypeCode.safeParse(v).success ? (v as string) : null;
}

async function createDraft(tx: Tx, request: FastifyRequest, transformationId: string): Promise<FormDraftRow> {
  const peeked = peekRecordType(request.body);
  let actor: { userId: string; organizationId: string } | null = null;
  let rt: FormRecordTypeRow | null = null;
  if (peeked !== null) {
    rt = await loadRecordType(tx, peeked);
    assertWorking(rt);
    actor = await requireRecordWrite(tx, request, transformationId, rt);
  }
  const body = parseBody(formDraftCreate, request.body);
  if (rt === null || actor === null) throw problems.internal(); // the schema accepted a code the peek refused
  checkPayload(body.payload);
  const recordId = body.recordId ?? null;
  const base = body.baseRecordVersion ?? null;
  if (recordId !== null && base !== null) {
    const current = await currentRecordVersion(tx, rt, transformationId, recordId);
    if (current === null) throw problems.notFound();
    // A base version the record never had cannot be the version the author saw.
    if (base > current) throw formRecordConflict(current);
    const open = await tx
      .selectFrom("form_draft")
      .select("id")
      .where("owner_user_id", "=", actor.userId)
      .where("record_type", "=", rt.code)
      .where("record_id", "=", recordId)
      .where("status", "=", "open")
      .executeTakeFirst();
    if (open !== undefined) throw draftRefusals.openExists();
  }
  const row = await tx
    .insertInto("form_draft")
    .values({
      id: uuidv7(),
      organization_id: actor.organizationId,
      transformation_id: transformationId,
      record_type: rt.code,
      record_id: recordId,
      base_record_version: base,
      owner_user_id: actor.userId,
      payload: JSON.stringify(body.payload),
      created_by: actor.userId,
      updated_by: actor.userId,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, auditContextOf(request), {
    action: "form_draft.create",
    recordType: "form_draft",
    recordId: row.id,
    organizationId: actor.organizationId,
    transformationId,
    newVersion: row.version,
    // The payload's field names only: a draft's content is the author's work in progress, not an audit value.
    changes: {
      record_type: { from: null, to: rt.code },
      record_id: { from: null, to: recordId },
      base_record_version: { from: null, to: base },
      status: { from: null, to: "open" },
      payload_fields: { from: null, to: Object.keys(body.payload) },
    },
  });
  return row;
}

/**
 * The write prologue of update and close: the transformation in scope (404), the draft in it (404), the record
 * type's write permission on the reloaded principal (403; AUD), then ownership (another user's draft is 404).
 */
async function openDraftWrite(tx: Tx, request: FastifyRequest, p: z.infer<typeof dParams>) {
  await requireTransformationRead(tx, request, p.transformationId);
  const seen = await tx
    .selectFrom("form_draft")
    .selectAll()
    .where("id", "=", p.draftId)
    .where("transformation_id", "=", p.transformationId)
    .executeTakeFirst();
  if (seen === undefined) throw problems.notFound();
  const rt = await loadRecordType(tx, seen.record_type);
  const actor = await requireRecordWrite(tx, request, p.transformationId, rt);
  if (seen.owner_user_id !== actor.userId) throw problems.notFound();
  return actor;
}

async function lockOpenDraft(tx: Tx, draftId: string, expected: number): Promise<FormDraftRow> {
  const current = await tx
    .selectFrom("form_draft")
    .selectAll()
    .where("id", "=", draftId)
    .forUpdate()
    .executeTakeFirst();
  if (current === undefined) throw problems.notFound();
  if (current.version !== expected) throw formRecordConflict(current.version);
  if (current.status !== "open") throw draftRefusals.closed();
  return current;
}

async function updateDraft(tx: Tx, request: FastifyRequest, p: z.infer<typeof dParams>): Promise<FormDraftRow> {
  const actor = await openDraftWrite(tx, request, p);
  const body = parseBody(formDraftUpdate, request.body);
  checkPayload(body.payload);
  const expected = requireIfMatch(request);
  const current = await lockOpenDraft(tx, p.draftId, expected);
  const row = await tx
    .updateTable("form_draft")
    .set({
      payload: JSON.stringify(body.payload),
      version: sql<number>`version + 1`,
      updated_at: sql<Date>`now()`,
      updated_by: actor.userId,
    })
    .where("id", "=", current.id)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, auditContextOf(request), {
    action: "form_draft.update",
    recordType: "form_draft",
    recordId: row.id,
    organizationId: actor.organizationId,
    transformationId: p.transformationId,
    priorVersion: current.version,
    newVersion: row.version,
    changes: {
      payload_fields: {
        from: Object.keys(current.payload as Record<string, unknown>),
        to: Object.keys(body.payload),
      },
    },
  });
  return row;
}

async function closeDraft(tx: Tx, request: FastifyRequest, p: z.infer<typeof dParams>): Promise<FormDraftRow> {
  const actor = await openDraftWrite(tx, request, p);
  const body = parseBody(formDraftClose, request.body);
  const expected = requireIfMatch(request);
  const current = await lockOpenDraft(tx, p.draftId, expected);
  const row = await tx
    .updateTable("form_draft")
    .set({
      status: "closed",
      closed_reason: body.reason,
      closed_at: sql<Date>`now()`,
      version: sql<number>`version + 1`,
      updated_at: sql<Date>`now()`,
      updated_by: actor.userId,
    })
    .where("id", "=", current.id)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, auditContextOf(request), {
    action: "form_draft.close",
    recordType: "form_draft",
    recordId: row.id,
    organizationId: actor.organizationId,
    transformationId: p.transformationId,
    priorVersion: current.version,
    newVersion: row.version,
    changes: { status: { from: "open", to: "closed" }, closed_reason: { from: null, to: body.reason } },
  });
  return row;
}

/** A race on the one open draft per user and record: the loser sees 409 form_draft.open_exists. */
function mapDraftDbError(err: unknown): never {
  const e = err as { code?: string; constraint?: string };
  if (!(err instanceof HttpProblem) && e.code === "23505" && e.constraint === "form_draft_open_record_key")
    throw draftRefusals.openExists();
  if (!(err instanceof HttpProblem) && e.constraint === "form_draft_status_transition") throw draftRefusals.closed();
  throw err;
}

async function listDrafts(db: Db, request: FastifyRequest, transformationId: string) {
  const query = parseQuery(formDraftListQuery, request.query);
  await requireTransformationRead(db, request, transformationId);
  const userId = principalOf(request).userId ?? null;
  if (userId === null) throw problems.unauthenticated();
  const hash = filterHash({
    table: "form_draft",
    transformationId,
    recordType: query.recordType ?? null,
    status: query.status ?? null,
  });
  const after = decodeCursor(query.cursor, hash, 2);
  let q = db
    .selectFrom("form_draft")
    .selectAll()
    .where("transformation_id", "=", transformationId)
    .where("owner_user_id", "=", userId);
  if (query.recordType !== undefined) q = q.where("record_type", "=", query.recordType);
  if (query.status !== undefined) q = q.where("status", "=", query.status);
  if (after !== null)
    q = q.where(sql<boolean>`(updated_at, id) < (${String(after[0])}::timestamptz, ${String(after[1])}::uuid)`);
  const rows = await q
    .orderBy("updated_at", "desc")
    .orderBy("id", "desc")
    .limit(query.limit + 1)
    .execute();
  const page = paginate(rows, query.limit, (r) => [r.updated_at.toISOString(), r.id], hash);
  const items: FormDraft[] = [];
  for (const r of page.items) items.push(await present(db, r));
  return { items, nextCursor: page.nextCursor };
}

const myDraftsQuery = z.strictObject({ cursor: cursorSchema, limit: limitSchema });
const UUID_KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The contract's `MyFormDraft`: a recovery entry, without the payload (the editor reopens it with getFormDraft). */
export interface MyFormDraft {
  id: string;
  transformationId: string;
  transformationCode: string;
  transformationName: string;
  recordType: string;
  recordId: string | null;
  baseRecordVersion: number | null;
  baseChanged: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * listMyFormDrafts (ADR-0057 §6; REQ-S15-010 "unsaved drafts are recoverable"): the caller's open drafts in every
 * transformation it can still read, newest first (`updated_at` desc, `id` desc; keyset cursor). The read boundary is
 * the ReadScope port (ADR-0051 §1) for `transformation.read` on the draft's transformation, decided in SQL on this
 * request, so a revoked assignment hides the draft on the next request. Nothing is written: a hidden draft stays
 * stored, unchanged, and reappears if read access returns. This module is the only reader of `form_draft`
 * (form-draft-readers.test.ts), so a draft never enters any total.
 */
async function listMyDrafts(db: Db, request: FastifyRequest) {
  const query = parseQuery(myDraftsQuery, request.query);
  const principal = principalOf(request);
  const userId = principal.userId ?? null;
  if (userId === null) throw problems.unauthenticated();
  const hash = filterHash({ table: "form_draft", list: "me", status: "open" });
  const after = decodeCursor(query.cursor, hash, 2);
  if (after !== null && (Number.isNaN(Date.parse(String(after[0]))) || !UUID_KEY.test(String(after[1]))))
    throw problems.badRequest(
      "validation.cursor",
      "The cursor is invalid or belongs to other filters.",
      "/query/cursor",
    );
  const scope = await readScopeFor(db, principal, "transformation.read");
  let q = db
    .selectFrom("form_draft as d")
    .innerJoin("transformation as t", "t.id", "d.transformation_id")
    .selectAll("d")
    .select(["t.code as transformation_code", "t.name as transformation_name"])
    .where("d.owner_user_id", "=", userId)
    .where("d.status", "=", "open")
    .where(
      scope.predicate({
        recordType: null,
        recordId: sql.ref<string>("t.id"),
        organizationId: sql.ref<string>("t.organization_id"),
        businessUnitId: sql.ref<string | null>("t.business_unit_id"),
        transformationId: sql.ref<string | null>("t.id"),
      }),
    );
  if (after !== null)
    q = q.where(sql<boolean>`(d.updated_at, d.id) < (${String(after[0])}::timestamptz, ${String(after[1])}::uuid)`);
  const rows = await q
    .orderBy("d.updated_at", "desc")
    .orderBy("d.id", "desc")
    .limit(query.limit + 1)
    .execute();
  const page = paginate(rows, query.limit, (r) => [r.updated_at.toISOString(), r.id], hash);
  const items: MyFormDraft[] = [];
  for (const r of page.items) {
    const d = await present(db, r);
    items.push({
      id: d.id,
      transformationId: r.transformation_id,
      transformationCode: r.transformation_code,
      transformationName: r.transformation_name,
      recordType: d.recordType,
      recordId: d.recordId,
      baseRecordVersion: d.baseRecordVersion,
      baseChanged: d.baseChanged,
      version: d.version,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
    });
  }
  return { items, nextCursor: page.nextCursor };
}

export function registerFormDraftRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  // The write permission depends on the record type (ADR-0041 §9) and is checked in the handler; the route declares
  // the read permission every caller needs first.
  const read = { access: { permission: "transformation.read" as const } };
  const write = { ...read, consumes: JSON_BODY };

  app.get(FORM_DRAFTS, { config: read }, async (request) => {
    const p = parse(tParams, request.params, "params");
    return listDrafts(db, request, p.transformationId);
  });

  app.post(FORM_DRAFTS, { config: write }, async (request, reply) => {
    const p = parse(tParams, request.params, "params");
    const body = await db
      .transaction()
      .execute(async (tx) => present(tx, await createDraft(tx, request, p.transformationId)))
      .catch(mapDraftDbError);
    return sendVersioned(reply, 201, body, `${request.url.split("?")[0]!}/${body.id}`);
  });

  app.get(FORM_DRAFT, { config: read }, async (request, reply) => {
    const p = parse(dParams, request.params, "params");
    parseQuery(z.strictObject({}), request.query);
    await requireTransformationRead(db, request, p.transformationId);
    const row = await db
      .selectFrom("form_draft")
      .selectAll()
      .where("id", "=", p.draftId)
      .where("transformation_id", "=", p.transformationId)
      .where("owner_user_id", "=", principalOf(request).userId ?? "00000000-0000-0000-0000-000000000000")
      .executeTakeFirst();
    if (row === undefined) throw problems.notFound();
    return sendVersioned(reply, 200, await present(db, row));
  });

  app.put(FORM_DRAFT, { config: write }, async (request, reply) => {
    const p = parse(dParams, request.params, "params");
    const body = await db
      .transaction()
      .execute(async (tx) => present(tx, await updateDraft(tx, request, p)))
      .catch(mapDraftDbError);
    return sendVersioned(reply, 200, body);
  });

  app.post(FORM_DRAFT_CLOSE, { config: write }, async (request, reply) => {
    const p = parse(dParams, request.params, "params");
    const body = await db
      .transaction()
      .execute(async (tx) => present(tx, await closeDraft(tx, request, p)))
      .catch(mapDraftDbError);
    return sendVersioned(reply, 200, body);
  });

  // listMyFormDrafts (P6, T-DG6-BE-Q2): any signed-in user, own drafts only; ReadScope per draft in the query.
  app.get(MY_FORM_DRAFTS, { config: { access: { permission: "authenticated" } } }, async (request) =>
    listMyDrafts(db, request),
  );

  return [
    `GET ${MY_FORM_DRAFTS}`,
    `GET ${FORM_DRAFTS}`,
    `POST ${FORM_DRAFTS}`,
    `GET ${FORM_DRAFT}`,
    `PUT ${FORM_DRAFT}`,
    `POST ${FORM_DRAFT_CLOSE}`,
  ];
}
