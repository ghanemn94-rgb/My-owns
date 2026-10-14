// Attachments of one record (OpenAPI tag "forms"; ADR-0041 §5 "Attachments", §6, §9, §10; REQ-S05-001;
// p5-work-split §B.3; T-DG5-BE-E):
//   GET  /transformations/{t}/form-records/{recordType}/{recordId}/attachments                       listFormRecordAttachments
//   POST /transformations/{t}/form-records/{recordType}/{recordId}/attachments                       attachFormRecordEvidence
//   POST /transformations/{t}/form-records/{recordType}/{recordId}/attachments/{attachmentId}/remove removeFormRecordAttachment
// ONE attachment place per record type (M0150 "avoid duplicate registers that drift"): the twenty DG2 record types of
// `evidence_link` (0012; e.g. T01 `diagnostic_item`, T03 `tom_gap`, the charter, baselines) read and write
// `evidence_link` exactly as the DG2 evidence routes do (same row shape, same audit action, same active-key rule);
// every other record type (e.g. T14 `benefit`) uses `form_record_attachment` (0068), whose trigger refuses the DG2
// types. The evidence module exports no link function (p5-work-split §B.3: "if no exported function exists, request
// one in the handback"), so the evidence_link rows are written here with the DG2 semantics; the request is in the
// T-DG5-BE-E handback.
// Lifecycle `active -> removed` with a reason (3-1000, the shared `reason` rule); removed is final (422
// form_attachment.already_removed); the evidence item itself never changes. Authorization: reads
// `transformation.read` in scope; writes the record type's write permission in scope, re-checked on the principal
// reloaded in the transaction (commit time; AUD 403); the evidence_link store additionally keeps the DG2 route
// permission `evidence.create`, so this path never grants more than the DG2 evidence routes. Attach is a create
// (version 1, no If-Match; 409 when the evidence is already attached to the record); remove needs If-Match (428
// missing; 409 form_record.conflict with currentVersion when stale). One audit event per write in the same
// transaction; no remote I/O inside it. An attachment approves nothing (no G1-G6 business approval).
import { sql, type Db, type FormRecordTypeRow, type Tx } from "@mth/db";
import { PROBLEM_TYPES } from "@mth/shared";
import {
  formRecordAttachmentCreate,
  formRecordAttachmentFilter,
  formRecordAttachmentRemove,
  uuid,
  type FormRecordAttachment,
} from "@mth/shared/schemas";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { auditContextOf, commitTimeDenial, refreshPrincipal, requireAction, requireRead } from "../access/index.ts";
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
import { cursorKey, FORM_RECORD, recordParams, requireRecordRead, type RecordParams } from "./history.ts";
import { assertWorking, loadRecordType, recordExists, requireRecordWrite } from "./record-types.ts";

export const ATTACHMENTS = `${FORM_RECORD}/attachments`;
export const ATTACHMENT_REMOVE = `${ATTACHMENTS}/:attachmentId/remove`;
const JSON_BODY = ["application/json"] as const;
const listQuery = z.strictObject({ cursor: cursorSchema, limit: limitSchema, ...formRecordAttachmentFilter.shape });
const removeParams = z.strictObject({ ...recordParams.shape, attachmentId: uuid });

/**
 * The record tables whose attachments live in the DG2 `evidence_link` (its record_type CHECK in 0012, and the list the
 * 0068 trigger `form_record_attachment_use_evidence_link` refuses). Every other table uses `form_record_attachment`.
 */
export const EVIDENCE_LINK_TABLES: ReadonlySet<string> = new Set([
  "charter",
  "north_star",
  "strategic_guardrail",
  "outcome",
  "kpi_definition",
  "baseline",
  "outcome_kpi",
  "value_pool",
  "diagnostic_item",
  "diagnostic_finding",
  "diagnostic_workstream_output",
  "tom_canvas_cell",
  "tom_gap",
  "capability",
  "journey",
  "journey_pain_point",
  "decision",
  "dependency",
  "tom_workshop",
  "action_item",
]);

type Store = FormRecordAttachment["store"];
type StoreTable = "evidence_link" | "form_record_attachment";

/** Where a record type keeps its attachments, and the value of the store's record_type column. */
export function storeOf(rt: FormRecordTypeRow & { table_name: string }): { store: Store; recordTypeColumn: string } {
  return EVIDENCE_LINK_TABLES.has(rt.table_name)
    ? { store: "evidence_link", recordTypeColumn: rt.table_name }
    : { store: "form_record_attachment", recordTypeColumn: rt.code };
}

export const attachmentRefusals = {
  evidenceUnknown: () =>
    problems.businessRule("form_attachment.evidence_unknown", "Choose evidence from this transformation."),
  alreadyRemoved: () => problems.businessRule("form_attachment.already_removed", "This attachment is already removed."),
  // The DG2 evidence-link refusals (ADR-0018), kept verbatim so both attachment paths refuse alike.
  evidenceArchived: () => problems.businessRule("evidence.archived", "Archived evidence cannot be linked."),
  duplicate: () => problems.duplicate("duplicate.evidence_link", "This evidence is already linked to the record."),
};

/** 409 form_record.conflict (ADR-0041 §5 "recoverable conflict") with the attachment's current version. */
function conflict(currentVersion: number): HttpProblem {
  return new HttpProblem({
    status: 409,
    type: PROBLEM_TYPES.versionConflict,
    code: "form_record.conflict",
    title: "Version conflict",
    detail: "This record changed since you opened it. Review the current version, then apply your changes again.",
    currentVersion,
  });
}

function selectAttachments(db: Db | Tx, table: StoreTable) {
  // Both stores have the same columns (0012 evidence_link; 0068 form_record_attachment "same shape").
  return db
    .selectFrom(`${table} as a` as "form_record_attachment as a")
    .leftJoin("evidence as e", "e.id", "a.evidence_id")
    .select([
      "a.id",
      "a.record_id",
      "a.evidence_id",
      "e.title",
      "a.status",
      "a.removed_at",
      "a.remove_reason",
      "a.version",
      "a.created_at",
      "a.created_by",
    ]);
}
type AttachmentRow = Awaited<ReturnType<ReturnType<typeof selectAttachments>["executeTakeFirstOrThrow"]>>;

function toAttachment(store: Store, recordTypeCode: string, r: AttachmentRow): FormRecordAttachment {
  return {
    id: r.id,
    store,
    recordType: recordTypeCode,
    recordId: r.record_id,
    evidenceId: r.evidence_id,
    evidenceTitle: r.title ?? null,
    status: r.status as FormRecordAttachment["status"],
    removedAt: isoOrNull(r.removed_at),
    removeReason: r.remove_reason,
    version: r.version,
    createdAt: iso(r.created_at),
    createdBy: r.created_by,
  };
}

/** The record type's write permission (record-types.ts), plus `evidence.create` for the DG2 evidence_link store. */
async function requireAttachmentWrite(
  tx: Tx,
  request: FastifyRequest,
  p: RecordParams,
  rt: FormRecordTypeRow,
  store: Store,
) {
  const actor = await requireRecordWrite(tx, request, p.transformationId, rt);
  if (store === "evidence_link") {
    const fresh = await refreshPrincipal(tx, request);
    try {
      const target = await requireRead(tx, fresh, "transformation.read", {
        type: "transformation",
        id: p.transformationId,
      });
      await requireAction(tx, fresh, "evidence.create", target);
    } catch (err) {
      throw commitTimeDenial(err);
    }
  }
  return actor;
}

/** A store's unique-key or evidence-reference refusal, mapped to the declared problem (null when not one of them). */
function mapStoreError(err: unknown): HttpProblem | null {
  const e = err as { code?: string; constraint?: string };
  if (
    e.code === "23505" &&
    (e.constraint === "evidence_link_active_key" || e.constraint === "form_record_attachment_active_key")
  )
    return attachmentRefusals.duplicate();
  if (
    e.code === "23503" &&
    (e.constraint === "evidence_link_evidence_id_fkey" || e.constraint === "form_record_attachment_evidence_fkey")
  )
    return attachmentRefusals.evidenceUnknown();
  return null;
}

async function attach(tx: Tx, request: FastifyRequest, p: RecordParams): Promise<FormRecordAttachment> {
  const rt = await loadRecordType(tx, p.recordType);
  assertWorking(rt);
  const { store, recordTypeColumn } = storeOf(rt);
  const actor = await requireAttachmentWrite(tx, request, p, rt, store);
  const body = parseBody(formRecordAttachmentCreate, request.body);
  if (!(await recordExists(tx, rt, p.transformationId, p.recordId))) throw problems.notFound();
  const ev = await tx
    .selectFrom("evidence")
    .select(["id", "status"])
    .where("id", "=", body.evidenceId)
    .where("transformation_id", "=", p.transformationId)
    .executeTakeFirst();
  if (ev === undefined) throw attachmentRefusals.evidenceUnknown();
  if (ev.status !== "active") throw attachmentRefusals.evidenceArchived();
  const id = uuidv7();
  await tx
    .insertInto(store as "form_record_attachment")
    .values({
      id,
      organization_id: actor.organizationId,
      transformation_id: p.transformationId,
      record_type: recordTypeColumn,
      record_id: p.recordId,
      evidence_id: body.evidenceId,
      created_by: actor.userId,
      updated_by: actor.userId,
    })
    .execute();
  await record(tx, auditContextOf(request), {
    action: `${store}.create`,
    recordType: store,
    recordId: id,
    organizationId: actor.organizationId,
    transformationId: p.transformationId,
    newVersion: 1,
    // The DG2 evidence_link.create change shape (evidence module), for both stores.
    changes: {
      evidenceId: { from: null, to: body.evidenceId },
      record: { from: null, to: `${recordTypeColumn}:${p.recordId}` },
    },
  });
  return toAttachment(
    store,
    rt.code,
    await selectAttachments(tx, store).where("a.id", "=", id).executeTakeFirstOrThrow(),
  );
}

async function remove(tx: Tx, request: FastifyRequest, p: z.infer<typeof removeParams>): Promise<FormRecordAttachment> {
  const rt = await loadRecordType(tx, p.recordType);
  assertWorking(rt);
  const { store, recordTypeColumn } = storeOf(rt);
  const actor = await requireAttachmentWrite(tx, request, p, rt, store);
  const { reason } = parseBody(formRecordAttachmentRemove, request.body);
  const expected = requireIfMatch(request);
  if (!(await recordExists(tx, rt, p.transformationId, p.recordId))) throw problems.notFound();
  const current = await tx
    .selectFrom(store as "form_record_attachment")
    .selectAll()
    .where("id", "=", p.attachmentId)
    .where("transformation_id", "=", p.transformationId)
    .where("record_type", "=", recordTypeColumn)
    .where("record_id", "=", p.recordId)
    .forUpdate()
    .executeTakeFirst();
  if (current === undefined) throw problems.notFound();
  if (current.version !== expected) throw conflict(current.version);
  if (current.status === "removed") throw attachmentRefusals.alreadyRemoved();
  await tx
    .updateTable(store as "form_record_attachment")
    .set({
      status: "removed",
      removed_at: sql<Date>`now()`,
      removed_by: actor.userId,
      remove_reason: reason,
      version: sql<number>`version + 1`,
      updated_at: sql<Date>`now()`,
      updated_by: actor.userId,
    })
    .where("id", "=", current.id)
    .where("version", "=", current.version)
    .executeTakeFirstOrThrow();
  await record(tx, auditContextOf(request), {
    action: `${store}.remove`,
    recordType: store,
    recordId: current.id,
    organizationId: actor.organizationId,
    transformationId: p.transformationId,
    priorVersion: current.version,
    newVersion: current.version + 1,
    reason,
    changes: { status: { from: "active", to: "removed" } },
  });
  return toAttachment(
    store,
    rt.code,
    await selectAttachments(tx, store).where("a.id", "=", current.id).executeTakeFirstOrThrow(),
  );
}

export function registerFormAttachmentRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  // The write permission depends on the record type (ADR-0041 §9) and is checked in the handler, at commit time; every
  // caller first needs read access to the transformation.
  const read = { access: { permission: "transformation.read" as const } };

  app.get(ATTACHMENTS, { config: read }, async (request) => {
    const p = parse(recordParams, request.params, "params");
    const query = parseQuery(listQuery, request.query);
    const rt = await requireRecordRead(db, request, p);
    const { store, recordTypeColumn } = storeOf(rt);
    const hash = filterHash({
      list: "attachments",
      recordType: p.recordType,
      recordId: p.recordId,
      includeRemoved: query.includeRemoved,
    });
    const after = cursorKey(decodeCursor(query.cursor, hash, 1), "uuid");
    let q = selectAttachments(db, store)
      .where("a.transformation_id", "=", p.transformationId)
      .where("a.record_type", "=", recordTypeColumn)
      .where("a.record_id", "=", p.recordId);
    if (!query.includeRemoved) q = q.where("a.status", "=", "active");
    // Keyset on (created_at, id) against the cursor row's stored values (microseconds kept; see comments.ts).
    if (after !== null)
      q = q.where(
        sql<boolean>`(a.created_at, a.id) > (SELECT k.created_at, k.id FROM ${sql.table(store)} k WHERE k.id = ${after}::uuid)`,
      );
    const rows = await q
      .orderBy("a.created_at", "asc")
      .orderBy("a.id", "asc")
      .limit(query.limit + 1)
      .execute();
    const pageOf = paginate(rows, query.limit, (r) => [r.id], hash);
    return { items: pageOf.items.map((r) => toAttachment(store, rt.code, r)), nextCursor: pageOf.nextCursor };
  });

  app.post(ATTACHMENTS, { config: { ...read, consumes: JSON_BODY } }, async (request, reply) => {
    const p = parse(recordParams, request.params, "params");
    const body = await db
      .transaction()
      .execute((tx) => attach(tx, request, p))
      .catch((err: unknown) => {
        throw (err instanceof HttpProblem ? null : mapStoreError(err)) ?? err;
      });
    return sendVersioned(reply, 201, body, `${request.url.split("?")[0]!}/${body.id}`);
  });

  app.post(ATTACHMENT_REMOVE, { config: { ...read, consumes: JSON_BODY } }, async (request, reply) => {
    const p = parse(removeParams, request.params, "params");
    const body = await db
      .transaction()
      .execute((tx) => remove(tx, request, p))
      .catch((err: unknown) => {
        throw (err instanceof HttpProblem ? null : mapStoreError(err)) ?? err;
      });
    return sendVersioned(reply, 200, body);
  });

  return [`GET ${ATTACHMENTS}`, `POST ${ATTACHMENTS}`, `POST ${ATTACHMENT_REMOVE}`];
}
