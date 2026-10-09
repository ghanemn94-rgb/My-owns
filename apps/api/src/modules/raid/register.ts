// The T15 RAID register on canonical records (P4 slice E; ADR-0031 §1-§3, §9-§11; T-DG4-BE-D; REQ-PB-078, REQ-PB-079,
// REQ-PB-080, REQ-S16-018 Risk/Assumption/Issue):
//   GET  /transformations/{t}/raid                       the register (transformation.read): raid_register view
//   POST /transformations/{t}/raid                       log an entry, status Open (raid.edit; a Dependency entry also
//                                                        needs dependency.edit and IS the canonical T08 row, DEP-nn)
//   GET  /transformations/{t}/raid/{raidEntryId}         one entry (a Dependency entry is read from its dependency row)
//   PATCH /transformations/{t}/raid/{raidEntryId}        T15 fields, Open <-> In progress (If-Match)
//   POST /transformations/{t}/raid/{raidEntryId}/close   close with a note; final (If-Match)
//   GET  /transformations/{t}/raid-decision-log          open RAID entries + open design (T04) / executive (T16)
//                                                        decisions, from their canonical rows (B0126)
//
// One register, no copy (REQ-PB-078, M0150): Risk, Assumption and Issue are `raid_entry` rows; a Dependency entry is the
// `dependency` row itself, written through the RaidDependencyPort (dependency-port.ts) and read through the
// `raid_register` view, so a T08 owner edit IS the RAID entry's owner edit (same id, same version).
// Refusals are exactly ADR-0031 §11 (S-11): 400 raid.type_invalid at /type; 422 raid.probability_required,
// raid.probability_not_applicable (at /probability), raid.status_transition, raid.closed. Every mutation: the write gate
// re-checked at commit time (AUD 403; ADM-only 404, ADR-0006 non-disclosure), validation, If-Match (428/409), one
// audit event in the same transaction, no remote I/O inside it (S-4). Closing an entry is an operational record change,
// never a G1-G6 business approval, and nothing here touches DG0-DG7.
import { diffFields, sql, type DbOrTx, type RaidEntryRow, type RaidRegisterView, type Tx } from "@mth/db";
import type { FieldError } from "@mth/shared";
import {
  RAID_TYPE_INVALID_CODE,
  RAID_TYPE_INVALID_MESSAGE,
  raidEntryClose,
  raidEntryCreate,
  raidEntryType,
  raidEntryUpdate,
  raidStatus,
  type RaidDecisionLogItem,
  type RaidEntry,
  type RaidEntryCreate,
} from "@mth/shared/schemas";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Selectable } from "kysely";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { principalOf, requireRecordWrite, requireTransformationRead } from "../access/index.ts";
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
import { assertActiveUsers, assertSameTransformation, openWrite, type WriteContext } from "../transformations/index.ts";
import type { DependencyRow, RaidDependencyPort } from "./dependency-port.ts";

export const RAID = "/api/v1/transformations/:transformationId/raid";
export const RAID_ITEM = `${RAID}/:raidEntryId`;
export const RAID_CLOSE = `${RAID_ITEM}/close`;
export const RAID_DECISION_LOG = "/api/v1/transformations/:transformationId/raid-decision-log";
export const JSON_BODY = ["application/json"] as const;
export const RAID_EDIT = "raid.edit" as const;
export const DEPENDENCY_EDIT = "dependency.edit" as const;

export type RaidRegisterRow = Selectable<RaidRegisterView>;

// ------------------------------------------------------------------------------------------------ problems (ADR-0031 §11)

/** A 422 business rule with one error at `pointer` (code = i18n key, detail = the exact English text). */
export const raidRule = (code: string, detail: string, pointer = "") =>
  new HttpProblem({
    status: 422,
    type: "urn:mth:problem:validation",
    code,
    title: "Business rule violated",
    detail,
    errors: [{ pointer, code, message: detail }],
  });

export const PROBABILITY_REQUIRED = () =>
  raidRule("raid.probability_required", "A Risk needs a Probability (High, Medium or Low).", "/probability");
export const PROBABILITY_NOT_APPLICABLE = () =>
  raidRule(
    "raid.probability_not_applicable",
    "Probability is n/a for Assumption, Issue and Dependency entries; leave it empty.",
    "/probability",
  );
export const STATUS_TRANSITION = () =>
  raidRule("raid.status_transition", "A RAID entry moves between Open and In progress; use Close to close it.");
export const RAID_CLOSED = () => raidRule("raid.closed", "This RAID entry is closed and can no longer be changed.");

/** A field of the create body that does not apply to the entry's type (400; nothing written). */
const notApplicable = (pointer: string, message: string) =>
  problems.validation([{ pointer, code: "validation.not_applicable", message }]);

/**
 * REQ-PB-080 (B0128): Probability is H/M/L for a Risk and n/a otherwise. Returned before the database refuses
 * (`raid_entry_probability_applicable` is the last line; ADR-0031 §11).
 */
export function checkProbability(type: string, probability: string | null): void {
  if (type === "risk" && probability === null) throw PROBABILITY_REQUIRED();
  if (type !== "risk" && probability !== null) throw PROBABILITY_NOT_APPLICABLE();
}

/**
 * The create body (400 with pointers). A Type outside Risk/Assumption/Issue/Dependency is the error code
 * `raid.type_invalid` at `/type` with the ADR-0031 §3 text (REQ-PB-079), before any write.
 */
export function parseRaidCreate(body: unknown): RaidEntryCreate {
  try {
    return parseBody(raidEntryCreate, body);
  } catch (err) {
    if (!(err instanceof HttpProblem) || err.status !== 400 || err.errors === undefined) throw err;
    const errors = err.errors.map(
      (e): FieldError =>
        e.pointer === "/type"
          ? { pointer: "/type", code: RAID_TYPE_INVALID_CODE, message: RAID_TYPE_INVALID_MESSAGE }
          : e,
    );
    throw problems.validation(errors);
  }
}

// ------------------------------------------------------------------------------------------------ reads

const transformationParams = z.strictObject({ transformationId: z.uuid() });
const entryParams = z.strictObject({ transformationId: z.uuid(), raidEntryId: z.uuid() });

export function parseTransformationParam(params: unknown): string {
  return parse(transformationParams, params, "params").transformationId;
}
export function parseEntryParams(params: unknown): { transformationId: string; raidEntryId: string } {
  return parse(entryParams, params, "params");
}

const dateOrNull = (d: string | null): string | null => (d === null ? null : String(d).slice(0, 10));

/** The register rows as API bodies; the closure fields of a raid_entry row come from the row itself. */
export async function presentEntries(db: DbOrTx, rows: readonly RaidRegisterRow[]): Promise<RaidEntry[]> {
  const entryIds = rows.filter((r) => r.record_table === "raid_entry").map((r) => r.id!);
  const closures = new Map(
    entryIds.length === 0
      ? []
      : (
          await db
            .selectFrom("raid_entry")
            .select(["id", "closed_at", "closed_by", "closure_note"])
            .where("id", "in", entryIds)
            .execute()
        ).map((c) => [c.id, c] as const),
  );
  return rows.map((r) => {
    const c = closures.get(r.id!);
    return {
      id: r.id!,
      transformationId: r.transformation_id!,
      type: r.entry_type as RaidEntry["type"],
      code: r.code!,
      description: r.description!,
      impact: r.impact as RaidEntry["impact"],
      probability: r.probability as RaidEntry["probability"],
      ownerUserId: r.owner_user_id,
      dueDate: dateOrNull(r.due_date),
      mitigation: r.mitigation,
      status: r.raid_status as RaidEntry["status"],
      recordStatus: r.record_status!,
      recordTable: r.record_table as RaidEntry["recordTable"],
      initiativeId: r.initiative_id,
      closedAt: c === undefined ? null : isoOrNull(c.closed_at),
      closedBy: c?.closed_by ?? null,
      closureNote: c?.closure_note ?? null,
      version: r.version!,
      createdAt: iso(r.created_at!),
      updatedAt: iso(r.updated_at!),
    };
  });
}

/** One register row of a transformation, or undefined. */
export function registerRow(db: DbOrTx, transformationId: string, id: string): Promise<RaidRegisterRow | undefined> {
  return db
    .selectFrom("raid_register")
    .selectAll()
    .where("id", "=", id)
    .where("transformation_id", "=", transformationId)
    .executeTakeFirst();
}

async function presentOne(db: DbOrTx, transformationId: string, id: string): Promise<RaidEntry> {
  const row = await registerRow(db, transformationId, id);
  if (!row) throw problems.notFound();
  return (await presentEntries(db, [row]))[0]!;
}

// ------------------------------------------------------------------------------------------------ writes

/** The fields of a raid_entry change recorded in the audit diff. */
export const RAID_ENTRY_AUDIT_FIELDS = [
  "entry_type",
  "code",
  "description",
  "impact",
  "probability",
  "owner_user_id",
  "due_date",
  "mitigation",
  "initiative_id",
  "status",
  "closure_note",
] as const satisfies readonly (keyof RaidEntryRow & string)[];

/** The T15 ID prefix of a type (B0128: R01, A01, I01; D-089 Q5: R-nn, A-nn, I-nn). */
function codePrefixOf(type: "risk" | "assumption" | "issue"): "R" | "A" | "I" {
  return type === "risk" ? "R" : type === "assumption" ? "A" : "I";
}

/** R-01 / A-01 / I-01 from record_code_counter (D-089 Q5); a concurrent allocation serialises on the counter row. */
async function nextRaidCode(tx: Tx, transformationId: string, prefix: "R" | "A" | "I"): Promise<string> {
  const row = await sql<{ last_value: number }>`
    INSERT INTO record_code_counter (transformation_id, prefix, last_value) VALUES (${transformationId}::uuid, ${prefix}, 1)
    ON CONFLICT (transformation_id, prefix) DO UPDATE SET last_value = record_code_counter.last_value + 1
    RETURNING last_value`.execute(tx);
  return `${prefix}-${String(row.rows[0]!.last_value).padStart(2, "0")}`;
}

/**
 * The write gate of a RAID mutation. First the read gate on the request's principal: a caller who cannot read the
 * transformation (an ADM-only user, an outsider) gets 404 (ADR-0006 non-disclosure; ADR-0031 §9), as T08's create does.
 * Then raid.edit, re-checked at commit time on the reloaded grants (S-4): a right revoked meanwhile is 403.
 */
export async function openRaidWrite(tx: Tx, request: FastifyRequest, transformationId: string): Promise<WriteContext> {
  await requireTransformationRead(tx, principalOf(request), transformationId);
  return openWrite(tx, request, transformationId, [{ permission: RAID_EDIT }], null, { atCommit: true });
}

/** A Dependency entry also needs dependency.edit (ADR-0031 §9), on the same commit-time principal. */
async function requireDependencyEdit(ctx: WriteContext): Promise<void> {
  await requireRecordWrite(ctx.tx, ctx.principal, ctx.target, [{ permission: DEPENDENCY_EDIT }], {
    createdBy: ctx.userId,
  });
}

/** The composition root wires the port; unwired, a Dependency write is a programming error (fail closed, 500). */
function portOf(port: RaidDependencyPort | undefined): RaidDependencyPort {
  if (port === undefined) throw problems.internal();
  return port;
}

async function createEntry(tx: Tx, request: FastifyRequest, port: RaidDependencyPort | undefined): Promise<string> {
  const transformationId = parseTransformationParam(request.params);
  const ctx = await openRaidWrite(tx, request, transformationId);
  const body = parseRaidCreate(request.body);
  const probability = body.probability ?? null;
  if (body.type === "dependency") {
    await requireDependencyEdit(ctx);
    checkProbability(body.type, probability);
    const to = body.toInitiativeId ?? body.initiativeId ?? null;
    if (
      body.initiativeId !== undefined &&
      body.initiativeId !== null &&
      body.toInitiativeId !== undefined &&
      body.toInitiativeId !== null &&
      body.initiativeId !== body.toInitiativeId
    )
      throw notApplicable(
        "/initiativeId",
        "A Dependency entry's initiative is its T08 To initiative; give toInitiativeId only.",
      );
    const row = await portOf(port).create(ctx, {
      description: body.description,
      impact: body.impact,
      ownerUserId: body.ownerUserId,
      dueDate: body.dueDate ?? null,
      mitigation: body.mitigation ?? null,
      fromInitiativeId: body.fromInitiativeId ?? null,
      toInitiativeId: to,
      dependencyType: body.dependencyType ?? null,
    });
    return row.id;
  }
  const endpointFields = [
    ["fromInitiativeId", body.fromInitiativeId],
    ["toInitiativeId", body.toInitiativeId],
    ["dependencyType", body.dependencyType],
  ] as const;
  for (const [field, value] of endpointFields)
    if (value !== undefined && value !== null)
      throw notApplicable(`/${field}`, "Only a Dependency entry has T08 endpoints and a dependency type.");
  checkProbability(body.type, probability);
  await assertActiveUsers(tx, ctx.organizationId, [{ id: body.ownerUserId, pointer: "/ownerUserId" }]);
  await assertSameTransformation(tx, "initiative", transformationId, body.initiativeId, "/initiativeId");
  const id = uuidv7();
  const row = await tx
    .insertInto("raid_entry")
    .values({
      id,
      organization_id: ctx.organizationId,
      transformation_id: transformationId,
      entry_type: body.type,
      code: await nextRaidCode(tx, transformationId, codePrefixOf(body.type)),
      description: body.description,
      impact: body.impact,
      probability,
      owner_user_id: body.ownerUserId,
      due_date: body.dueDate ?? null,
      mitigation: body.mitigation ?? null,
      initiative_id: body.initiativeId ?? null,
      created_by: ctx.userId,
      updated_by: ctx.userId,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: "raid_entry.create",
    recordType: "raid_entry",
    recordId: id,
    organizationId: ctx.organizationId,
    transformationId,
    newVersion: row.version,
    changes: diffFields({} as RaidEntryRow, row, [...RAID_ENTRY_AUDIT_FIELDS]),
  });
  return id;
}

/** Which canonical table holds the entry (404 when it is not in the transformation's register). */
async function recordTableOf(tx: Tx, transformationId: string, id: string): Promise<"raid_entry" | "dependency"> {
  const row = await tx
    .selectFrom("raid_register")
    .select("record_table")
    .where("id", "=", id)
    .where("transformation_id", "=", transformationId)
    .executeTakeFirst();
  if (!row) throw problems.notFound();
  return row.record_table as "raid_entry" | "dependency";
}

/** A Dependency entry under the graph and row locks; 404 when gone or archived (not in the register). */
async function lockDependencyEntry(ctx: WriteContext, port: RaidDependencyPort, id: string): Promise<DependencyRow> {
  const current = await port.lock(ctx.tx, ctx.transformationId, id);
  if (!current || current.status === "archived") throw problems.notFound();
  return current;
}

async function lockRaidEntry(tx: Tx, transformationId: string, id: string): Promise<RaidEntryRow> {
  const current = await tx
    .selectFrom("raid_entry")
    .selectAll()
    .where("id", "=", id)
    .where("transformation_id", "=", transformationId)
    .forUpdate()
    .executeTakeFirst();
  if (!current) throw problems.notFound();
  return current;
}

async function updateEntry(tx: Tx, request: FastifyRequest, port: RaidDependencyPort | undefined): Promise<void> {
  const { transformationId, raidEntryId } = parseEntryParams(request.params);
  const ctx = await openRaidWrite(tx, request, transformationId);
  const table = await recordTableOf(tx, transformationId, raidEntryId);
  if (table === "dependency") await requireDependencyEdit(ctx);
  const body = parseBody(raidEntryUpdate, request.body);
  const expected = requireIfMatch(request);

  if (table === "dependency") {
    const p = portOf(port);
    const current = await lockDependencyEntry(ctx, p, raidEntryId);
    if (current.version !== expected) throw problems.versionConflict(current.version);
    if (current.status === "resolved") throw RAID_CLOSED();
    if (body.probability !== undefined) checkProbability("dependency", body.probability);
    // A dependency's RAID status is Open (open or at risk) or Closed (resolved); it has no In progress.
    if (body.status === "in_progress") throw STATUS_TRANSITION();
    await p.update(ctx, current, {
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.impact !== undefined ? { impact: body.impact } : {}),
      ...(body.ownerUserId !== undefined ? { ownerUserId: body.ownerUserId } : {}),
      ...(body.dueDate !== undefined ? { dueDate: body.dueDate } : {}),
      ...(body.mitigation !== undefined ? { mitigation: body.mitigation } : {}),
      ...(body.initiativeId !== undefined ? { toInitiativeId: body.initiativeId } : {}),
    });
    return;
  }

  const current = await lockRaidEntry(tx, transformationId, raidEntryId);
  if (current.version !== expected) throw problems.versionConflict(current.version);
  if (current.status === "closed") throw RAID_CLOSED();
  if (body.probability !== undefined) checkProbability(current.entry_type, body.probability);
  await assertActiveUsers(tx, ctx.organizationId, [{ id: body.ownerUserId, pointer: "/ownerUserId" }]);
  await assertSameTransformation(tx, "initiative", transformationId, body.initiativeId, "/initiativeId");
  const updated = await tx
    .updateTable("raid_entry")
    .set({
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.impact !== undefined ? { impact: body.impact } : {}),
      ...(body.probability !== undefined ? { probability: body.probability } : {}),
      ...(body.ownerUserId !== undefined ? { owner_user_id: body.ownerUserId } : {}),
      ...(body.dueDate !== undefined ? { due_date: body.dueDate } : {}),
      ...(body.mitigation !== undefined ? { mitigation: body.mitigation } : {}),
      ...(body.initiativeId !== undefined ? { initiative_id: body.initiativeId } : {}),
      ...(body.status !== undefined ? { status: body.status } : {}),
      version: sql<number>`version + 1`,
      updated_at: sql<Date>`now()`,
      updated_by: ctx.userId,
    })
    .where("id", "=", current.id)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: "raid_entry.update",
    recordType: "raid_entry",
    recordId: current.id,
    organizationId: ctx.organizationId,
    transformationId,
    priorVersion: current.version,
    newVersion: updated.version,
    changes: diffFields(current, updated, [...RAID_ENTRY_AUDIT_FIELDS]),
  });
}

async function closeEntry(tx: Tx, request: FastifyRequest, port: RaidDependencyPort | undefined): Promise<void> {
  const { transformationId, raidEntryId } = parseEntryParams(request.params);
  const ctx = await openRaidWrite(tx, request, transformationId);
  const table = await recordTableOf(tx, transformationId, raidEntryId);
  if (table === "dependency") await requireDependencyEdit(ctx);
  const { closureNote } = parseBody(raidEntryClose, request.body);
  const expected = requireIfMatch(request);

  if (table === "dependency") {
    const p = portOf(port);
    const current = await lockDependencyEntry(ctx, p, raidEntryId);
    if (current.version !== expected) throw problems.versionConflict(current.version);
    if (current.status === "resolved") throw RAID_CLOSED();
    await p.resolve(ctx, current, closureNote);
    return;
  }

  const current = await lockRaidEntry(tx, transformationId, raidEntryId);
  if (current.version !== expected) throw problems.versionConflict(current.version);
  if (current.status === "closed") throw RAID_CLOSED();
  const updated = await tx
    .updateTable("raid_entry")
    .set({
      status: "closed",
      closed_at: sql<Date>`now()`,
      closed_by: ctx.userId,
      closure_note: closureNote,
      version: sql<number>`version + 1`,
      updated_at: sql<Date>`now()`,
      updated_by: ctx.userId,
    })
    .where("id", "=", current.id)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: "raid_entry.close",
    recordType: "raid_entry",
    recordId: current.id,
    organizationId: ctx.organizationId,
    transformationId,
    priorVersion: current.version,
    newVersion: updated.version,
    reason: closureNote,
    changes: diffFields(current, updated, [...RAID_ENTRY_AUDIT_FIELDS]),
  });
}

// ------------------------------------------------------------------------------------------------ routes

const listQuery = z.strictObject({
  cursor: cursorSchema,
  limit: limitSchema,
  type: raidEntryType.optional(),
  status: raidStatus.optional(),
  ownerUserId: z.uuid().optional(),
});
const pageQuery = z.strictObject({ cursor: cursorSchema, limit: limitSchema });

interface DecisionLogRow {
  item_kind: "raid_entry" | "decision";
  id: string;
  code: string;
  kind: RaidDecisionLogItem["kind"];
  title: string;
  owner_user_id: string | null;
  due_date: string | null;
  status: string;
}

export function registerRaidRegisterRoutes(
  app: FastifyInstance,
  { db }: ModuleDeps,
  port: RaidDependencyPort | undefined,
): string[] {
  const read = { access: { permission: "transformation.read" as const } };
  const write = { access: { permission: RAID_EDIT }, consumes: JSON_BODY };

  app.get(RAID, { config: read }, async (request) => {
    const transformationId = parseTransformationParam(request.params);
    const query = parseQuery(listQuery, request.query);
    await requireTransformationRead(db, principalOf(request), transformationId);
    const hash = filterHash({
      table: "raid_register",
      transformationId,
      type: query.type ?? null,
      status: query.status ?? null,
      ownerUserId: query.ownerUserId ?? null,
    });
    const after = decodeCursor(query.cursor, hash, 1);
    let q = db.selectFrom("raid_register").selectAll().where("transformation_id", "=", transformationId);
    if (query.type !== undefined) q = q.where("entry_type", "=", query.type);
    if (query.status !== undefined) q = q.where("raid_status", "=", query.status);
    if (query.ownerUserId !== undefined) q = q.where("owner_user_id", "=", query.ownerUserId);
    if (after) q = q.where("id", ">", String(after[0]));
    const rows = await q
      .orderBy("id")
      .limit(query.limit + 1)
      .execute();
    const page = paginate(rows, query.limit, (r) => [r.id!], hash);
    return { items: await presentEntries(db, page.items), nextCursor: page.nextCursor };
  });

  app.post(RAID, { config: write }, async (request, reply) => {
    const transformationId = parseTransformationParam(request.params);
    const body = await db.transaction().execute(async (tx) => {
      const id = await createEntry(tx, request, port);
      return presentOne(tx, transformationId, id);
    });
    return sendVersioned(reply, 201, body, `${request.url.split("?")[0]!}/${body.id}`);
  });

  app.get(RAID_ITEM, { config: read }, async (request, reply) => {
    const { transformationId, raidEntryId } = parseEntryParams(request.params);
    await requireTransformationRead(db, principalOf(request), transformationId);
    return sendVersioned(reply, 200, await presentOne(db, transformationId, raidEntryId));
  });

  app.patch(RAID_ITEM, { config: write }, async (request, reply) => {
    const { transformationId, raidEntryId } = parseEntryParams(request.params);
    const body = await db.transaction().execute(async (tx) => {
      await updateEntry(tx, request, port);
      return presentOne(tx, transformationId, raidEntryId);
    });
    return sendVersioned(reply, 200, body);
  });

  app.post(RAID_CLOSE, { config: write }, async (request, reply) => {
    const { transformationId, raidEntryId } = parseEntryParams(request.params);
    const body = await db.transaction().execute(async (tx) => {
      await closeEntry(tx, request, port);
      return presentOne(tx, transformationId, raidEntryId);
    });
    return sendVersioned(reply, 200, body);
  });

  // B0126 "Integrated RAID + Decision Log" (REQ-PB-078): canonical rows only, no copied fields beyond the listed ones.
  app.get(RAID_DECISION_LOG, { config: read }, async (request) => {
    const transformationId = parseTransformationParam(request.params);
    const query = parseQuery(pageQuery, request.query);
    await requireTransformationRead(db, principalOf(request), transformationId);
    const hash = filterHash({ table: "raid_decision_log", transformationId });
    const after = decodeCursor(query.cursor, hash, 1);
    const afterId = after ? String(after[0]) : null;
    const result = await sql<DecisionLogRow>`
      SELECT x.* FROM (
        SELECT 'raid_entry'::text AS item_kind, r.id, r.code, r.entry_type AS kind, r.description AS title,
               r.owner_user_id, r.due_date::text AS due_date, r.raid_status AS status
          FROM raid_register r
         WHERE r.transformation_id = ${transformationId}::uuid AND r.raid_status <> 'closed'
        UNION ALL
        SELECT 'decision'::text, d.id, d.code, d.kind, d.title, d.owner_user_id, d.due_date::text, d.status
          FROM decision d
         WHERE d.transformation_id = ${transformationId}::uuid AND d.kind IN ('design', 'executive')
           AND d.status = 'open'
      ) x
      WHERE ${afterId}::uuid IS NULL OR x.id > ${afterId}::uuid
      ORDER BY x.id
      LIMIT ${query.limit + 1}`.execute(db);
    const page = paginate(result.rows, query.limit, (r) => [r.id], hash);
    return {
      items: page.items.map(
        (r): RaidDecisionLogItem => ({
          itemKind: r.item_kind,
          id: r.id,
          code: r.code,
          kind: r.kind,
          title: r.title,
          ownerUserId: r.owner_user_id,
          dueDate: dateOrNull(r.due_date),
          status: r.status,
        }),
      ),
      nextCursor: page.nextCursor,
    };
  });

  return [
    `GET ${RAID}`,
    `POST ${RAID}`,
    `GET ${RAID_ITEM}`,
    `PATCH ${RAID_ITEM}`,
    `POST ${RAID_CLOSE}`,
    `GET ${RAID_DECISION_LOG}`,
  ];
}
