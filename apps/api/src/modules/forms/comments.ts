// Comments on one record (OpenAPI tag "forms"; ADR-0041 §5 "Comments", §6, §8, §9, §10; REQ-S05-001;
// p5-work-split §B.3; T-DG5-BE-E):
//   GET  /transformations/{t}/form-records/{recordType}/{recordId}/comments   listFormRecordComments
//   POST /transformations/{t}/form-records/{recordType}/{recordId}/comments   createFormRecordComment
// `form_record_comment` (0068) is APPEND-ONLY: a comment is never edited or deleted (a correction is a new comment), so
// a create needs no If-Match and no lock (ADR-0041 §8: the comment-thread lock class stays reserved, unused). Replies are one level deep and stay on
// the same record: a reply to a reply, to a comment of another record or to a missing comment is 422
// form_comment.parent_invalid (the trigger form_record_comment_parent repeats the rule). The body follows the shared
// free-text rules (1-4000, not blank, no NUL or lone surrogate; stored verbatim).
// Authorization: reads `transformation.read` in scope; the create needs `form_record.comment` in the same scope,
// re-checked on the principal reloaded inside the write transaction (commit-time; 403 and nothing written when the
// grant was revoked while the request waited). AUD holds no write code and gets 403. One audit event in the same
// transaction; no remote I/O inside it. A comment approves nothing (no G1-G6 business approval).
import { sql, type Db, type Tx } from "@mth/db";
import { formRecordCommentCreate, type FormRecordComment } from "@mth/shared/schemas";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import {
  auditContextOf,
  commitTimeDenial,
  principalOf,
  refreshPrincipal,
  requireAction,
  requireRead,
} from "../access/index.ts";
import { record } from "../audit/index.ts";
import {
  cursorSchema,
  decodeCursor,
  filterHash,
  HttpProblem,
  iso,
  limitSchema,
  paginate,
  parse,
  parseBody,
  parseQuery,
  problems,
  type ModuleDeps,
} from "../platform/index.ts";
import { cursorKey, FORM_RECORD, recordParams, requireRecordRead, type RecordParams } from "./history.ts";
import { assertWorking, loadRecordType, recordExists } from "./record-types.ts";

export const COMMENTS = `${FORM_RECORD}/comments`;
const JSON_BODY = ["application/json"] as const;
const listQuery = z.strictObject({ cursor: cursorSchema, limit: limitSchema });

export const commentRefusals = {
  parentInvalid: () =>
    problems.businessRule("form_comment.parent_invalid", "A reply must answer a top-level comment on the same record."),
};

interface CommentRow {
  id: string;
  record_type: string;
  record_id: string;
  parent_comment_id: string | null;
  body: string;
  created_at: Date;
  created_by: string;
  display_name: string | null;
}

export function toFormRecordComment(r: CommentRow): FormRecordComment {
  return {
    id: r.id,
    recordType: r.record_type,
    recordId: r.record_id,
    parentCommentId: r.parent_comment_id,
    body: r.body,
    createdAt: iso(r.created_at),
    createdBy: r.created_by,
    createdByDisplayName: r.display_name,
  };
}

function selectComments(db: Db | Tx) {
  return db
    .selectFrom("form_record_comment as c")
    .leftJoin("app_user as u", "u.id", "c.created_by")
    .select([
      "c.id",
      "c.record_type",
      "c.record_id",
      "c.parent_comment_id",
      "c.body",
      "c.created_at",
      "c.created_by",
      "u.display_name",
    ]);
}

/**
 * `form_record.comment` in the transformation's scope, re-checked on the principal reloaded in the transaction:
 * outside the request-start scope 404; a grant revoked meanwhile 403 (commit-time authorization, ADR-0006).
 */
async function requireCommentWrite(tx: Tx, request: FastifyRequest, transformationId: string) {
  await requireRead(tx, principalOf(request), "transformation.read", { type: "transformation", id: transformationId });
  const fresh = await refreshPrincipal(tx, request);
  try {
    const target = await requireRead(tx, fresh, "transformation.read", {
      type: "transformation",
      id: transformationId,
    });
    await requireAction(tx, fresh, "form_record.comment", target);
    return { userId: fresh.userId!, organizationId: target.organizationId };
  } catch (err) {
    throw commitTimeDenial(err);
  }
}

async function createComment(tx: Tx, request: FastifyRequest, p: RecordParams): Promise<FormRecordComment> {
  const rt = await loadRecordType(tx, p.recordType);
  assertWorking(rt);
  const actor = await requireCommentWrite(tx, request, p.transformationId);
  const body = parseBody(formRecordCommentCreate, request.body);
  if (!(await recordExists(tx, rt, p.transformationId, p.recordId))) throw problems.notFound();
  const parentId = body.parentCommentId ?? null;
  if (parentId !== null) {
    const parent = await tx
      .selectFrom("form_record_comment")
      .select("id")
      .where("id", "=", parentId)
      .where("record_type", "=", rt.code)
      .where("record_id", "=", p.recordId)
      .where("transformation_id", "=", p.transformationId)
      .where("parent_comment_id", "is", null)
      .executeTakeFirst();
    if (parent === undefined) throw commentRefusals.parentInvalid();
  }
  const id = uuidv7();
  await tx
    .insertInto("form_record_comment")
    .values({
      id,
      organization_id: actor.organizationId,
      transformation_id: p.transformationId,
      record_type: rt.code,
      record_id: p.recordId,
      parent_comment_id: parentId,
      body: body.body,
      created_by: actor.userId,
    })
    .execute();
  await record(tx, auditContextOf(request), {
    action: "form_record_comment.create",
    recordType: "form_record_comment",
    recordId: id,
    organizationId: actor.organizationId,
    transformationId: p.transformationId,
    newVersion: 1,
    changes: {
      record: { from: null, to: `${rt.code}:${p.recordId}` },
      parent_comment_id: { from: null, to: parentId },
      body: { from: null, to: body.body },
    },
  });
  const row = await selectComments(tx).where("c.id", "=", id).executeTakeFirstOrThrow();
  return toFormRecordComment(row);
}

export function registerFormCommentRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  const read = { access: { permission: "transformation.read" as const } };

  app.get(COMMENTS, { config: read }, async (request) => {
    const p = parse(recordParams, request.params, "params");
    const query = parseQuery(listQuery, request.query);
    const rt = await requireRecordRead(db, request, p);
    const hash = filterHash({ list: "comments", recordType: p.recordType, recordId: p.recordId });
    const after = cursorKey(decodeCursor(query.cursor, hash, 1), "uuid");
    let q = selectComments(db)
      .where("c.record_type", "=", rt.code)
      .where("c.record_id", "=", p.recordId)
      .where("c.transformation_id", "=", p.transformationId);
    // Keyset on (created_at, id) against the cursor row's stored values: the timestamp keeps its microseconds (an ISO
    // string in the cursor would drop them and repeat the boundary row).
    if (after !== null)
      q = q.where(
        sql<boolean>`(c.created_at, c.id) > (SELECT k.created_at, k.id FROM form_record_comment k WHERE k.id = ${after}::uuid)`,
      );
    const rows = await q
      .orderBy("c.created_at", "asc")
      .orderBy("c.id", "asc")
      .limit(query.limit + 1)
      .execute();
    const pageOf = paginate(rows, query.limit, (r) => [r.id], hash);
    return { items: pageOf.items.map(toFormRecordComment), nextCursor: pageOf.nextCursor };
  });

  // The write permission is `form_record.comment` (checked in the handler, at commit time); every caller first needs
  // read access to the transformation.
  app.post(COMMENTS, { config: { ...read, consumes: JSON_BODY } }, async (request, reply) => {
    const p = parse(recordParams, request.params, "params");
    const body = await db
      .transaction()
      .execute((tx) => createComment(tx, request, p))
      .catch((err: unknown) => {
        if (err instanceof HttpProblem) throw err;
        const e = err as { code?: string; constraint?: string };
        // The database repeats the reply rule (a programming error to reach it; mapped to the same refusal).
        if (e.code === "23514" && e.constraint === "form_record_comment_parent_same_record")
          throw commentRefusals.parentInvalid();
        throw err;
      });
    return reply
      .code(201)
      .header("Location", `${request.url.split("?")[0]!}/${body.id}`)
      .send(body);
  });

  return [`GET ${COMMENTS}`, `POST ${COMMENTS}`];
}
