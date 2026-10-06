// evidence routes (ADR-0018, ADR-0010; REQ-S13-010..013, REQ-S16-006, REQ-S16-013):
//   /transformations/{id}/evidence                      list, create (evidence.create)
//   /transformations/{id}/evidence/{evidenceId}         get, update (evidence.create, own rows only), archive (own rows,
//                                                       or evidence.review)
//   .../evidence/{evidenceId}/content                   download (transformation.read) / upload a revision (own rows)
//   .../evidence/{evidenceId}/review                    verify or reject (evidence.review; never the creator, the
//                                                       content author or the uploader of the current revision)
//   /transformations/{id}/evidence-links                list, create (evidence.create + edit rights on the record)
//   .../evidence-links/{linkId}/remove                  remove with a reason (the row stays); the SAME record-level
//                                                       edit rights as creating the link (F-DG2-142)
// A new content revision, or a change of a link's URL / a note's text, resets the item to `unverified`: a verification
// is bound to the content the reviewer saw (reviewed_content_id).
// Separation of duties (F-DG2-140, REQ-S13-012): nobody verifies content they supplied. The content author is kept in
// evidence.content_authored_by by the 0019 trigger, which also refuses such a review (the last line of defence).
import { diffFields, sql, type Db, type EvidenceRow, type Tx } from "@mth/db";
import type { Permission } from "@mth/shared";
import {
  evidenceCreate,
  evidenceLinkCreate,
  evidenceLinkListQuery,
  evidenceReview,
  evidenceUpdate,
  reasonRequest,
  type Evidence,
} from "@mth/shared/schemas";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import {
  denialOf,
  principalOf,
  requireRecordWrite,
  requireTransformationRead,
  type ResolvedTarget,
  type WriteRule,
} from "../access/index.ts";
import { record } from "../audit/index.ts";
import {
  cursorSchema,
  decodeCursor,
  filterHash,
  HttpProblem,
  limitSchema,
  paginate,
  parse,
  parseBody,
  parseQuery,
  problems,
  requireIfMatch,
  sendVersioned,
  type ModuleDeps,
  type ModuleRegistration,
} from "../platform/index.ts";
import {
  assertActiveUsers,
  bumpStamps,
  col,
  loose,
  maybeIdempotent,
  openWrite,
  pick,
  registerRegister,
  ruleProblem,
  sendCreated,
  type LooseRow,
  type RegisterSpec,
} from "../transformations/index.ts";
import { toEvidence, toEvidenceLink } from "./repository.ts";
import {
  EVIDENCE_MAX_BYTES,
  EvidenceStoreUnavailable,
  EvidenceTooLarge,
  evidenceStoreFor,
  type EvidenceStore,
} from "./store.ts";

const T = "/api/v1/transformations/:transformationId";
const ITEM = `${T}/evidence/:evidenceId`;
const LINKS = `${T}/evidence-links`;
const itemParams = z.strictObject({ transformationId: z.uuid(), evidenceId: z.uuid() });
const linkParams = z.strictObject({ transformationId: z.uuid(), linkId: z.uuid() });
const tParams = z.strictObject({ transformationId: z.uuid() });
const CREATE: readonly WriteRule[] = [{ permission: "evidence.create" }];
/** Editing or replacing an item's content: only its creator or named owner (F-DG2-140; no evidence.edit right exists). */
const EDIT_OWN: readonly WriteRule[] = [{ permission: "evidence.create", scope: "own" }];
/** Archiving: the creator/owner, or a reviewer curating the repository (archiving never supplies content). */
const ARCHIVE: readonly WriteRule[] = [
  { permission: "evidence.create", scope: "own" },
  { permission: "evidence.review" },
];

const EVIDENCE_COLS = [
  ["title", "title"],
  ["description", "description"],
  ["evidenceType", "evidence_type"],
  ["source", "source"],
  ["ownerUserId", "owner_user_id"],
  ["observationStart", "observation_start"],
  ["observationEnd", "observation_end"],
  ["noteBody", "note_body"],
  ["url", "url"],
  ["fileName", "file_name"],
] as const;
const EVIDENCE_AUDIT = [
  "kind",
  ...EVIDENCE_COLS.map(([, c]) => c),
  "review_status",
  "accessibility_status",
  "current_content_id",
  "status",
];

/** Clears a verification (the content changed after the review). */
const RESET_REVIEW: LooseRow = {
  review_status: "unverified",
  accessibility_status: "unchecked",
  reviewed_by: null,
  reviewed_at: null,
  reviewed_content_id: null,
  review_note: null,
};

export const evidenceRegister: RegisterSpec<EvidenceRow, Evidence> = {
  table: "evidence",
  path: `${T}/evidence`,
  idParam: "evidenceId",
  writeRules: CREATE,
  updateRules: EDIT_OWN,
  archiveRules: ARCHIVE,
  createSchema: evidenceCreate,
  updateSchema: evidenceUpdate,
  toApi: toEvidence,
  insertValues: (b: z.infer<typeof evidenceCreate>) => ({ kind: b.kind, ...pick(b, EVIDENCE_COLS) }),
  updateValues: (b: z.infer<typeof evidenceUpdate>, current: EvidenceRow) => {
    const changes = pick(b, EVIDENCE_COLS);
    const m = new Map(Object.entries(changes));
    const contentChanged =
      (m.has("url") && m.get("url") !== current.url) ||
      (m.has("note_body") && m.get("note_body") !== current.note_body) ||
      (m.has("file_name") && m.get("file_name") !== current.file_name && current.kind === "file_reference");
    return contentChanged && current.review_status !== "unverified" ? { ...changes, ...RESET_REVIEW } : changes;
  },
  check: async (m, ctx) => {
    const kind = col(m, "kind");
    const has = (c: string) => (col(m, c) ?? null) !== null;
    if (kind === "note" && !has("note_body"))
      throw ruleProblem("evidence.payload", "A note needs its text.", "/noteBody");
    if (kind === "external_link" && !has("url")) throw ruleProblem("evidence.payload", "A link needs its URL.", "/url");
    if (kind === "file_reference" && !has("file_name"))
      throw ruleProblem("evidence.payload", "A filename reference needs the filename.", "/fileName");
    if (kind !== "note" && has("note_body"))
      throw ruleProblem("evidence.payload", "Only a note carries text.", "/noteBody");
    if (kind !== "external_link" && has("url"))
      throw ruleProblem("evidence.payload", "Only an external link carries a URL.", "/url");
    const start = col(m, "observation_start");
    const end = col(m, "observation_end");
    if (typeof start === "string" && typeof end === "string" && end < start)
      throw ruleProblem(
        "evidence.observation_range",
        "The observation period ends before it starts.",
        "/observationEnd",
      );
    await assertActiveUsers(ctx.tx, ctx.organizationId, [
      { id: col(m, "owner_user_id") as string | null, pointer: "/ownerUserId" },
    ]);
  },
  auditFields: EVIDENCE_AUDIT,
  archive: {},
};

/**
 * Edit rights on a linked record (ADR-0018 §4: link "plus edit rights on the target record"): the record type's
 * write rules, with `own` rules against the record's creator/owner.
 */
export const RECORD_WRITE_RULES: ReadonlyMap<string, readonly WriteRule[]> = (() => {
  const diagnostic: readonly WriteRule[] = [
    { permission: "diagnostic.edit" },
    { permission: "diagnostic.contribute", scope: "own" },
  ];
  const tom: readonly WriteRule[] = [{ permission: "tom.edit" }, { permission: "tom.contribute", scope: "own" }];
  const only = (permission: Permission): readonly WriteRule[] => [{ permission }];
  return new Map<string, readonly WriteRule[]>([
    ["charter", only("charter.edit")],
    ["strategic_guardrail", only("charter.edit")],
    ["north_star", only("north_star.edit")],
    ["outcome", only("outcome.edit")],
    ["outcome_kpi", only("outcome.edit")],
    ["kpi_definition", only("kpi_definition.edit")],
    ["baseline", only("baseline.edit")],
    ["value_pool", only("diagnostic.edit")],
    ["diagnostic_item", diagnostic],
    ["diagnostic_finding", diagnostic],
    ["diagnostic_workstream_output", diagnostic],
    ["tom_canvas_cell", tom],
    ["tom_gap", tom],
    ["capability", tom],
    ["journey", tom],
    ["journey_pain_point", tom],
    ["decision", only("decision.edit")],
    ["dependency", only("dependency.edit")],
    ["tom_workshop", only("workshop.facilitate")],
    ["action_item", [{ permission: "action.edit" }, { permission: "action.update_own", scope: "own" }]],
  ]);
})();

export const EVIDENCE_MODULE_ROUTES = [
  `GET ${T}/evidence`,
  `POST ${T}/evidence`,
  `GET ${ITEM}`,
  `PATCH ${ITEM}`,
  `POST ${ITEM}/archive`,
  `GET ${ITEM}/content`,
  `POST ${ITEM}/content`,
  `POST ${ITEM}/review`,
  `GET ${LINKS}`,
  `POST ${LINKS}`,
  `POST ${LINKS}/:linkId/remove`,
] as const;

export const EVIDENCE_MODULE: ModuleRegistration = Object.freeze({
  module: "evidence",
  status: "active",
  deliversIn: "P2",
  routes: Object.freeze([...EVIDENCE_MODULE_ROUTES]) as readonly string[],
});

/** Header-safe attachment filename (RFC 6266 with an RFC 5987 UTF-8 form). */
function contentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

/** X-File-Name may be percent-encoded (non-ASCII names); a malformed encoding is taken literally. */
function decodeFileName(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function storeProblem(err: unknown): HttpProblem | null {
  if (err instanceof EvidenceTooLarge)
    return new HttpProblem({
      status: 413,
      type: "urn:mth:problem:validation",
      code: "evidence.too_large",
      title: "Content too large",
      detail: `Evidence content is limited to ${err.maxBytes} bytes per revision.`,
    });
  if (err instanceof EvidenceStoreUnavailable) return problems.unavailable();
  return null;
}

async function lockEvidence(tx: Tx, request: FastifyRequest, transformationId: string, evidenceId: string) {
  const expected = requireIfMatch(request);
  const current = await tx
    .selectFrom("evidence")
    .selectAll()
    .where("id", "=", evidenceId)
    .where("transformation_id", "=", transformationId)
    .forUpdate()
    .executeTakeFirst();
  if (!current) throw problems.notFound();
  if (current.version !== expected) throw problems.versionConflict(current.version);
  if (current.status === "archived") throw problems.businessRule("record.archived", "Archived records are read-only.");
  return current;
}

/** Created-by / owner of a linkable record in this transformation (null when it does not exist there). */
async function recordOwnership(tx: Tx, transformationId: string, recordType: string, recordId: string) {
  const row = await loose(tx)
    .selectFrom(recordType)
    .select([
      sql<string>`created_by`.as("created_by"),
      sql<string | null>`to_jsonb(${sql.table(recordType)})->>'owner_user_id'`.as("owner"),
    ])
    .where("id", "=", recordId)
    .where("transformation_id", "=", transformationId)
    .executeTakeFirst();
  return row ? { createdBy: row.created_by as string, ownerUserId: (row.owner as string | null) ?? null } : null;
}

type SupplierFacts = Pick<EvidenceRow, "id" | "created_by" | "content_authored_by" | "current_content_id">;

/** The people who supplied an evidence item's current content: its creator, the content author, the file uploader. */
async function suppliersOf(tx: Tx, row: SupplierFacts): Promise<{ creator: string; authors: Set<string> }> {
  const authors = new Set<string>([row.content_authored_by ?? row.created_by]);
  if (row.current_content_id !== null) {
    const c = await tx
      .selectFrom("evidence_content")
      .select("uploaded_by")
      .where("id", "=", row.current_content_id)
      .where("evidence_id", "=", row.id)
      .executeTakeFirst();
    if (c) authors.add(c.uploaded_by);
  }
  return { creator: row.created_by, authors };
}

/** 403 (with a denied-mutation audit) when the reviewer added the item or supplied its current content. */
async function assertReviewerIndependent(
  tx: Tx,
  ctx: { readonly userId: string; readonly target: ResolvedTarget },
  row: SupplierFacts,
): Promise<void> {
  const { creator, authors } = await suppliersOf(tx, row);
  if (creator === ctx.userId)
    throw new HttpProblem({
      status: 403,
      type: "urn:mth:problem:forbidden",
      code: "evidence.reviewer_is_creator",
      title: "Forbidden",
      detail: "Evidence is reviewed by someone other than the person who added it.",
    }).withDenial(denialOf("evidence.review", ctx.target));
  if (authors.has(ctx.userId))
    throw new HttpProblem({
      status: 403,
      type: "urn:mth:problem:forbidden",
      code: "evidence.reviewer_is_author",
      title: "Forbidden",
      detail: "Evidence is reviewed by someone other than the person who supplied its current content.",
    }).withDenial(denialOf("evidence.review", ctx.target));
}

export function registerEvidenceModule(
  app: FastifyInstance,
  { db, config }: ModuleDeps,
  store: EvidenceStore = evidenceStoreFor(config.evidenceStorage),
): ModuleRegistration {
  // Uploads arrive as raw bytes: hand the request stream to the handler, which hashes and stores it after the
  // authorization checks (never buffered whole; the size limit is enforced while streaming).
  app.addContentTypeParser("application/octet-stream", (_request, payload, done) => done(null, payload));

  registerRegister(app, db, evidenceRegister);
  registerContentRoutes(app, db, store);
  registerReviewRoute(app, db);
  registerLinkRoutes(app, db);
  return EVIDENCE_MODULE;
}

function registerContentRoutes(app: FastifyInstance, db: Db, store: EvidenceStore): void {
  app.get(`${ITEM}/content`, { config: { access: { permission: "transformation.read" } } }, async (request, reply) => {
    const { transformationId, evidenceId } = parse(itemParams, request.params, "params");
    await requireTransformationRead(db, principalOf(request), transformationId);
    const content = await db
      .selectFrom("evidence as e")
      .innerJoin("evidence_content as c", (j) =>
        j.onRef("c.id", "=", "e.current_content_id").onRef("c.evidence_id", "=", "e.id"),
      )
      .select(["c.storage_key", "c.file_name", "c.sha256", "c.size_bytes"])
      .where("e.id", "=", evidenceId)
      .where("e.transformation_id", "=", transformationId)
      .executeTakeFirst();
    if (!content) throw problems.notFound();
    let stream: AsyncIterable<Uint8Array>;
    try {
      stream = await store.get(content.storage_key);
    } catch (err) {
      throw storeProblem(err) ?? problems.notFound();
    }
    return reply
      .code(200)
      .header("Content-Type", "application/octet-stream")
      .header("Content-Disposition", contentDisposition(content.file_name))
      .header("X-Content-Type-Options", "nosniff")
      .header("Cache-Control", "private, no-store")
      .header("Digest", `sha-256=${Buffer.from(content.sha256, "hex").toString("base64")}`)
      .send(stream);
  });

  app.post(`${ITEM}/content`, { config: { access: { permission: "evidence.create" } } }, async (request, reply) => {
    const { transformationId, evidenceId } = parse(itemParams, request.params, "params");
    let storedKey: string | null = null;
    try {
      const row = await db.transaction().execute(async (tx) => {
        // Replacing the stored content is an edit: only the item's creator or named owner (F-DG2-140).
        await requireTransformationRead(tx, principalOf(request), transformationId);
        const seen = await tx
          .selectFrom("evidence")
          .select(["created_by", "owner_user_id"])
          .where("id", "=", evidenceId)
          .where("transformation_id", "=", transformationId)
          .executeTakeFirst();
        if (!seen) throw problems.notFound();
        const ctx = await openWrite(tx, request, transformationId, EDIT_OWN, {
          createdBy: seen.created_by,
          ownerUserId: seen.owner_user_id,
        });
        const rawName = request.headers["x-file-name"];
        const fileName = parse(
          z
            .string()
            .min(1)
            .max(255)
            .regex(/^[^\\/\x00-\x1f]+$/, "validation.file_name"),
          decodeFileName(Array.isArray(rawName) ? rawName[0] : rawName),
          "header",
        );
        const current = await lockEvidence(tx, request, transformationId, evidenceId);
        if (current.kind !== "file")
          throw ruleProblem("evidence.not_a_file", "Only file evidence has stored content.", "");
        const body = request.body as AsyncIterable<Uint8Array> | Uint8Array | undefined;
        if (body === undefined || body === null)
          throw problems.badRequest("validation.body_required", "Send the file bytes as application/octet-stream.");
        const last = await tx
          .selectFrom("evidence_content")
          .select((eb) => eb.fn.max<number>("revision").as("n"))
          .where("evidence_id", "=", evidenceId)
          .executeTakeFirst();
        const revision = (last?.n ?? 0) + 1;
        const contentId = uuidv7();
        const key = `${ctx.organizationId}/${transformationId}/${evidenceId}/${contentId}`;
        const stored = await store.put(key, body, EVIDENCE_MAX_BYTES);
        storedKey = key;
        await tx
          .insertInto("evidence_content")
          .values({
            id: contentId,
            organization_id: ctx.organizationId,
            transformation_id: transformationId,
            evidence_id: evidenceId,
            revision,
            storage_key: stored.key,
            sha256: stored.sha256,
            size_bytes: String(stored.size),
            content_type: "application/octet-stream",
            file_name: fileName,
            uploaded_by: ctx.userId,
          })
          .execute();
        const updated = await tx
          .updateTable("evidence")
          .set({ current_content_id: contentId, file_name: fileName, ...RESET_REVIEW, ...bumpStamps(ctx.userId) })
          .where("id", "=", evidenceId)
          .where("version", "=", current.version)
          .returningAll()
          .executeTakeFirstOrThrow();
        await record(tx, ctx.audit, {
          action: "evidence.upload_content",
          recordType: "evidence",
          recordId: evidenceId,
          organizationId: ctx.organizationId,
          transformationId,
          priorVersion: current.version,
          newVersion: updated.version,
          changes: {
            ...(diffFields(current, updated, ["current_content_id", "file_name", "review_status"]) ?? {}),
            contentRevision: { from: revision - 1 || null, to: revision },
            contentSize: { from: null, to: stored.size },
          },
        });
        return updated;
      });
      storedKey = null;
      return sendVersioned(reply, 200, toEvidence(row));
    } catch (err) {
      if (storedKey !== null) await store.discardUncommitted(storedKey).catch(() => undefined);
      throw storeProblem(err) ?? err;
    }
  });
}

function registerReviewRoute(app: FastifyInstance, db: Db): void {
  app.post(`${ITEM}/review`, { config: { access: { permission: "evidence.review" } } }, async (request, reply) => {
    const { transformationId, evidenceId } = parse(itemParams, request.params, "params");
    const row = await db.transaction().execute(async (tx) => {
      const ctx = await openWrite(tx, request, transformationId, [{ permission: "evidence.review" }], null);
      const seen = await tx
        .selectFrom("evidence")
        .select(["id", "created_by", "content_authored_by", "current_content_id"])
        .where("id", "=", evidenceId)
        .where("transformation_id", "=", transformationId)
        .executeTakeFirst();
      if (!seen) throw problems.notFound();
      // Separation of duties (ADR-0018 §3, ADR-0020 §3, F-DG2-140): nobody reviews evidence they created, nor content
      // they supplied (note text / URL author, uploader of the current revision). Also the 0019 trigger.
      await assertReviewerIndependent(tx, ctx, seen);
      const body = parseBody(evidenceReview, request.body);
      const current = await lockEvidence(tx, request, transformationId, evidenceId);
      // Re-check on the locked row: the content may have changed between the first read and the lock.
      await assertReviewerIndependent(tx, ctx, current);
      if (
        current.kind === "file_reference" &&
        (body.result === "verified" || body.accessibilityStatus === "accessible")
      )
        throw ruleProblem(
          "evidence.filename_never_verified",
          "A bare filename reference can never be verified or accessible; upload the file or link accessible content.",
          "/result",
        );
      if (body.result === "verified" && body.accessibilityStatus !== "accessible")
        throw ruleProblem(
          "evidence.verification_requires_accessible",
          "Only accessible evidence can be verified.",
          "/accessibilityStatus",
        );
      if (body.result === "verified" && current.kind === "file" && current.current_content_id === null)
        throw ruleProblem("evidence.no_content", "Upload the file before verifying it.", "/result");
      const updated = await tx
        .updateTable("evidence")
        .set({
          review_status: body.result,
          accessibility_status: body.accessibilityStatus,
          reviewed_by: ctx.userId,
          reviewed_at: sql<Date>`now()`,
          reviewed_content_id: current.kind === "file" ? current.current_content_id : null,
          review_note: body.note,
          ...bumpStamps(ctx.userId),
        })
        .where("id", "=", evidenceId)
        .where("version", "=", current.version)
        .returningAll()
        .executeTakeFirstOrThrow();
      await record(tx, ctx.audit, {
        action: "evidence.review",
        recordType: "evidence",
        recordId: evidenceId,
        organizationId: ctx.organizationId,
        transformationId,
        priorVersion: current.version,
        newVersion: updated.version,
        reason: body.note,
        changes: diffFields(current, updated, ["review_status", "accessibility_status", "reviewed_content_id"]),
      });
      return updated;
    });
    return sendVersioned(reply, 200, toEvidence(row));
  });
}

function registerLinkRoutes(app: FastifyInstance, db: Db): void {
  const listQuery = z.strictObject({ ...evidenceLinkListQuery.shape, cursor: cursorSchema, limit: limitSchema });

  app.get(LINKS, { config: { access: { permission: "transformation.read" } } }, async (request) => {
    const { transformationId } = parse(tParams, request.params, "params");
    const query = parseQuery(listQuery, request.query);
    await requireTransformationRead(db, principalOf(request), transformationId);
    const hash = filterHash({ recordType: query.recordType, recordId: query.recordId });
    const after = decodeCursor(query.cursor, hash, 1);
    let q = db.selectFrom("evidence_link").selectAll().where("transformation_id", "=", transformationId);
    if (query.recordType) q = q.where("record_type", "=", query.recordType);
    if (query.recordId) q = q.where("record_id", "=", query.recordId);
    if (after) q = q.where("id", "<", String(after[0]));
    const rows = await q
      .orderBy("id", "desc")
      .limit(query.limit + 1)
      .execute();
    const page = paginate(rows, query.limit, (r) => [r.id], hash);
    return { items: page.items.map(toEvidenceLink), nextCursor: page.nextCursor };
  });

  app.post(LINKS, { config: { access: { permission: "evidence.create" } } }, async (request, reply) => {
    const { transformationId } = parse(tParams, request.params, "params");
    const result = await db.transaction().execute(async (tx) => {
      const ctx = await openWrite(tx, request, transformationId, CREATE, null);
      const body = parseBody(evidenceLinkCreate, request.body);
      return maybeIdempotent(tx, request, ctx.userId, body, async () => {
        const ev = await tx
          .selectFrom("evidence")
          .select(["id", "status"])
          .where("id", "=", body.evidenceId)
          .where("transformation_id", "=", transformationId)
          .executeTakeFirst();
        if (!ev) throw ruleProblem("validation.reference", "No such evidence in this transformation.", "/evidenceId");
        if (ev.status !== "active")
          throw ruleProblem("evidence.archived", "Archived evidence cannot be linked.", "/evidenceId");
        // The target must exist in THIS transformation (also the p2_record_ref_guard trigger), and the caller needs
        // edit rights on it.
        const target = await recordOwnership(tx, transformationId, body.recordType, body.recordId);
        if (!target)
          throw ruleProblem("validation.reference", "The record does not exist in this transformation.", "/recordId");
        await requireRecordWrite(tx, ctx.principal, ctx.target, RECORD_WRITE_RULES.get(body.recordType)!, target);
        const id = uuidv7();
        const row = await tx
          .insertInto("evidence_link")
          .values({
            id,
            organization_id: ctx.organizationId,
            transformation_id: transformationId,
            evidence_id: body.evidenceId,
            record_type: body.recordType,
            record_id: body.recordId,
            created_by: ctx.userId,
            updated_by: ctx.userId,
          })
          .returningAll()
          .executeTakeFirstOrThrow()
          .catch((e: { code?: string; constraint?: string }) => {
            if (e.code === "23505" && e.constraint === "evidence_link_active_key")
              throw problems.duplicate("duplicate.evidence_link", "This evidence is already linked to the record.");
            throw e;
          });
        await record(tx, ctx.audit, {
          action: "evidence_link.create",
          recordType: "evidence_link",
          recordId: id,
          organizationId: ctx.organizationId,
          transformationId,
          newVersion: 1,
          changes: {
            evidenceId: { from: null, to: body.evidenceId },
            record: { from: null, to: `${body.recordType}:${body.recordId}` },
          },
        });
        return { status: 201, body: toEvidenceLink(row) };
      });
    });
    return sendCreated(request, reply, result);
  });

  app.post(
    `${LINKS}/:linkId/remove`,
    { config: { access: { permission: "evidence.create" } } },
    async (request, reply) => {
      const { transformationId, linkId } = parse(linkParams, request.params, "params");
      const row = await db.transaction().execute(async (tx) => {
        const seen = await tx
          .selectFrom("evidence_link")
          .select(["record_type", "record_id"])
          .where("id", "=", linkId)
          .where("transformation_id", "=", transformationId)
          .executeTakeFirst();
        const ctx = await openWrite(tx, request, transformationId, CREATE, null);
        if (!seen) throw problems.notFound();
        // F-DG2-142: removing a link needs the SAME record-level edit rights as creating it (ADR-0018 §4), so a
        // contributor cannot un-ready a gate by removing evidence from a record they may not edit. 403 + audit.
        const rules = RECORD_WRITE_RULES.get(seen.record_type);
        if (rules === undefined) throw problems.internal();
        await requireRecordWrite(
          tx,
          ctx.principal,
          ctx.target,
          rules,
          (await recordOwnership(tx, transformationId, seen.record_type, seen.record_id)) ?? {},
        );
        const { reason } = parseBody(reasonRequest, request.body);
        const expected = requireIfMatch(request);
        const current = await tx
          .selectFrom("evidence_link")
          .selectAll()
          .where("id", "=", linkId)
          .forUpdate()
          .executeTakeFirstOrThrow();
        if (current.version !== expected) throw problems.versionConflict(current.version);
        if (current.status === "removed")
          throw problems.businessRule("evidence_link.already_removed", "The link is already removed.");
        const updated = await tx
          .updateTable("evidence_link")
          .set({
            status: "removed",
            removed_at: sql<Date>`now()`,
            removed_by: ctx.userId,
            remove_reason: reason,
            ...bumpStamps(ctx.userId),
          })
          .where("id", "=", linkId)
          .where("version", "=", current.version)
          .returningAll()
          .executeTakeFirstOrThrow();
        await record(tx, ctx.audit, {
          action: "evidence_link.remove",
          recordType: "evidence_link",
          recordId: linkId,
          organizationId: ctx.organizationId,
          transformationId,
          priorVersion: current.version,
          newVersion: updated.version,
          reason,
          changes: { status: { from: "active", to: "removed" } },
        });
        return updated;
      });
      return sendVersioned(reply, 200, toEvidenceLink(row));
    },
  );
}
