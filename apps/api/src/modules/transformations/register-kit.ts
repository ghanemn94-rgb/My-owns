// The P2 register kit (ADR-0016 §3, ADR-0007): one implementation of the five operations every transformation-scoped
// P2 register exposes - list, create, get, update, archive - so each register states only its columns and rules.
//
// Every mutation runs in ONE transaction, in this order (P1 pattern, extended for P2):
//   1. read gate      the caller can read the transformation (404 otherwise; existence is never disclosed);
//   2. write gate     the register's write rules through the policy function (403; record-level `own` rules use the
//                     loaded row, ADR-0020 §3) - BEFORE the body is parsed, so a read-only auditor gets 403 for any
//                     body (ADR-0020 §4b);
//   3. validation     the shared zod mirror (400 with pointers) and the register's business checks (422);
//   4. concurrency    If-Match (428 / 400), row lock, version equal (409);
//   5. write          version + 1 (the database guard enforces exactly +1), then exactly one audit event with the
//                     prior and new version and the field diff (the deferred guard refuses a commit without it).
// An archived transformation is read-only (422 transformation.archived); an archived record too (422 record.archived).
import { diffFields, sql, type Db, type DbOrTx, type Tx } from "@mth/db";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Kysely } from "kysely";
import { v7 as uuidv7 } from "uuid";
import { reasonRequest } from "@mth/shared/schemas";
import { z } from "zod";
import {
  auditContextOf,
  principalOf,
  requireRecordWrite,
  requireTransformationRead,
  type Ownership,
  type Principal,
  type ResolvedTarget,
  type WriteRule,
} from "../access/index.ts";
import { record, type AuditContext } from "../audit/index.ts";
import {
  cursorSchema,
  decodeCursor,
  filterHash,
  HttpProblem,
  idempotencyKeySchema,
  limitSchema,
  paginate,
  parse,
  parseBody,
  parseQuery,
  problems,
  requestHash,
  requireIfMatch,
  sendVersioned,
  withIdempotency,
} from "../platform/index.ts";

/** Kysely over the generic row shape, for registers addressed by table name. Typed access stays in each register. */
export type LooseRow = Record<string, unknown>;
type LooseDb = Kysely<Record<string, LooseRow>>;
export const loose = (db: DbOrTx): LooseDb => db as unknown as LooseDb;

/** The columns every P2 register row has (ADR-0016 §3). */
export interface RegisterRow {
  readonly id: string;
  readonly organization_id: string;
  readonly transformation_id: string;
  readonly version: number;
  readonly created_by: string;
  readonly status?: string;
  readonly owner_user_id?: string | null;
}

/** The transformation a request writes into, already authorized. */
export interface WriteContext {
  readonly tx: Tx;
  readonly principal: Principal;
  readonly userId: string;
  readonly audit: AuditContext;
  readonly transformationId: string;
  readonly organizationId: string;
  readonly target: ResolvedTarget;
  readonly request: FastifyRequest;
}

/** A nested register (e.g. pain points under a journey): the parent must exist in the same transformation. */
export interface ParentSpec {
  readonly param: string;
  readonly column: string;
  readonly table: string;
  readonly archivable: boolean;
}

/**
 * How rows become API bodies: either a pure per-row mapper, or an async batch presenter for registers whose response
 * carries COMPUTED read fields that need more data (e.g. the outcome's good outcome test, REQ-PB-036). The presenter
 * runs on the same connection as the write, so a create/update response reflects the committed-to-be state.
 */
export type RegisterPresenter<Row, Api> =
  | { readonly toApi: (row: Row) => Api; readonly present?: never }
  | { readonly present: (db: DbOrTx, rows: readonly Row[]) => Promise<Api[]>; readonly toApi?: never };

export type RegisterSpec<Row extends RegisterRow, Api> = RegisterSpecBase<Row> & RegisterPresenter<Row, Api>;

export interface RegisterSpecBase<Row extends RegisterRow> {
  /** Table name; also the audit `record_type` (the database audit guard matches on it). */
  readonly table: string;
  /** Collection path, e.g. "/api/v1/transformations/:transformationId/strategic-guardrails". */
  readonly path: string;
  readonly idParam: string;
  readonly parent?: ParentSpec;
  readonly writeRules: readonly WriteRule[];
  /**
   * Write rules of update and archive when they differ from create's (default `writeRules`), e.g. evidence: anyone with
   * evidence.create adds an item, but only its creator/owner edits its content (F-DG2-140).
   */
  readonly updateRules?: readonly WriteRule[];
  readonly archiveRules?: readonly WriteRule[];
  readonly createSchema: z.ZodType;
  readonly updateSchema: z.ZodType;
  /** Columns of a new row from the parsed body (ids, stamps and version are added by the kit). */
  readonly insertValues: (body: never, ctx: WriteContext) => LooseRow;
  /** Columns to change from the parsed update body. */
  readonly updateValues: (body: never, current: Row, ctx: WriteContext) => LooseRow;
  /** Business checks on the merged row (current + changes) before the write; throw 422 problems. */
  readonly check?: (merged: LooseRow, ctx: WriteContext, current: Row | null) => Promise<void>;
  /** Async completion of a new row after the checks (e.g. a generated code DEP-01 from record_code_counter). */
  readonly beforeInsert?: (values: LooseRow, ctx: WriteContext) => Promise<LooseRow>;
  /** Columns recorded in the audit diff. */
  readonly auditFields: readonly string[];
  /** Status transitions allowed by an update (`from` -> allowed `to`); absent = no status in the update body. */
  readonly transitions?: ReadonlyMap<string, readonly string[]>;
  /** Archive support; `refuse` returns a problem when this row may not be archived (e.g. seeded T01 rows). */
  readonly archive?: { readonly refuse?: (row: Row) => HttpProblem | null } | false;
  /** Which operations to register (default all five). */
  readonly ops?: Partial<Record<"list" | "create" | "get" | "update" | "archive", boolean>>;
  /** Ownership a create counts as (for `own` rules), from the raw body. Default: the caller creates it. */
  readonly createOwnership?: (rawBody: unknown, userId: string) => Ownership;
}

const listQuery = z.strictObject({
  includeArchived: z.stringbool().default(false),
  cursor: cursorSchema,
  limit: limitSchema,
});
const uuidParam = z.uuid();

/**
 * Path parameters of a register route, validated (malformed id -> 400 at `/params/<name>`, the pointer style of
 * `parse`; T-DG2-ARCH-02). All names are validated together, so every malformed parameter is reported.
 */
function paramsOf(request: FastifyRequest, names: readonly string[]): ReadonlyMap<string, string> {
  const raw = new Map(Object.entries((request.params ?? {}) as Record<string, unknown>));
  const schema = z.strictObject(Object.fromEntries(names.map((name) => [name, uuidParam])));
  const parsed = parse(schema, Object.fromEntries(names.map((name) => [name, raw.get(name)])), "params");
  return new Map(Object.entries(parsed));
}

/** Active users of the organization; otherwise 422 with a pointer (naming a person never grants access). */
export async function assertActiveUsers(
  db: DbOrTx,
  organizationId: string,
  users: ReadonlyArray<{ readonly id: string | null | undefined; readonly pointer: string }>,
): Promise<void> {
  const named = users.filter((u): u is { id: string; pointer: string } => typeof u.id === "string");
  if (named.length === 0) return;
  const rows = await db
    .selectFrom("app_user")
    .select("id")
    .where(
      "id",
      "in",
      named.map((u) => u.id),
    )
    .where("organization_id", "=", organizationId)
    .where("status", "=", "active")
    .execute();
  const ok = new Set(rows.map((r) => r.id));
  const bad = named.filter((u) => !ok.has(u.id));
  if (bad.length > 0)
    throw new HttpProblem({
      status: 422,
      type: "urn:mth:problem:validation",
      code: "validation.user_invalid",
      title: "Business rule violated",
      detail: "A named person must be an active user of the transformation's organization.",
      errors: bad.map((u) => ({ pointer: u.pointer, code: "validation.user_invalid", message: "Not an active user." })),
    });
}

/** A catalogue code (e.g. a T01 or TOM dimension) must exist; otherwise 422 with a pointer. */
export async function assertCatalogueCode(
  db: DbOrTx,
  table: "diagnostic_dimension" | "diagnostic_workstream" | "tom_dimension",
  code: unknown,
  pointer: string,
): Promise<void> {
  if (code === null || code === undefined) return;
  const row = await loose(db).selectFrom(table).select("code").where("code", "=", String(code)).executeTakeFirst();
  if (!row)
    throw new HttpProblem({
      status: 422,
      type: "urn:mth:problem:validation",
      code: "validation.unknown_code",
      title: "Business rule violated",
      detail: `Unknown ${table.replace(/_/g, " ")} code.`,
      errors: [{ pointer, code: "validation.unknown_code", message: `No ${table} with this code.` }],
    });
}

/** A record of `table` in the same transformation (null id passes); otherwise 422 with a pointer. */
export async function assertSameTransformation(
  db: DbOrTx,
  table: string,
  transformationId: string,
  id: unknown,
  pointer: string,
): Promise<void> {
  if (id === null || id === undefined) return;
  const row = await loose(db)
    .selectFrom(table)
    .select("id")
    .where("id", "=", String(id))
    .where("transformation_id", "=", transformationId)
    .executeTakeFirst();
  if (!row)
    throw new HttpProblem({
      status: 422,
      type: "urn:mth:problem:validation",
      code: "validation.reference",
      title: "Business rule violated",
      detail: "The referenced record does not exist in this transformation.",
      errors: [{ pointer, code: "validation.reference", message: `No ${table} with this id in this transformation.` }],
    });
}

/** The transformation row (organization, archive state) for a write; 404 when it vanished. */
export async function writableTransformation(tx: Tx, transformationId: string) {
  const t = await tx
    .selectFrom("transformation")
    .select(["id", "organization_id", "archived_at"])
    .where("id", "=", transformationId)
    .executeTakeFirst();
  if (!t) throw problems.notFound();
  if (t.archived_at !== null)
    throw problems.businessRule("transformation.archived", "Archived transformations are read-only.");
  return t;
}

/** The read + write gates of a mutation inside a transformation; returns the context for the write. */
export async function openWrite(
  tx: Tx,
  request: FastifyRequest,
  transformationId: string,
  rules: readonly WriteRule[],
  ownership: Ownership | null,
): Promise<WriteContext> {
  const principal = principalOf(request);
  const target = await requireTransformationRead(tx, principal, transformationId);
  await requireRecordWrite(tx, principal, target, rules, ownership ?? { createdBy: principal.userId });
  const t = await writableTransformation(tx, transformationId);
  return {
    tx,
    principal,
    userId: principal.userId!,
    audit: auditContextOf(request),
    transformationId,
    organizationId: t.organization_id,
    target,
    request,
  };
}

/** Stamps of an update: version + 1 and who/when. */
export function bumpStamps(userId: string): LooseRow {
  return { version: sql<number>`version + 1`, updated_at: sql<Date>`now()`, updated_by: userId };
}

/** Optional Idempotency-Key on a create (ADR-0007 §6): same key + same body replays the first response. */
export async function maybeIdempotent<B>(
  tx: Tx,
  request: FastifyRequest,
  userId: string,
  body: unknown,
  run: () => Promise<{ status: number; body: B }>,
): Promise<{ status: number; body: B; replayed: boolean }> {
  const rawKey = request.headers["idempotency-key"];
  if (rawKey === undefined) return { ...(await run()), replayed: false };
  const key = parse(idempotencyKeySchema, rawKey, "header");
  const path = request.url.split("?")[0]!;
  return withIdempotency(tx, { userId, key, requestHash: requestHash(request.method, path, body) }, run);
}

/** Sends a create/replay response with ETag + Location. */
export function sendCreated<B extends { id: string; version: number }>(
  request: FastifyRequest,
  reply: FastifyReply,
  result: { status: number; body: B; replayed: boolean },
  collection: string = request.url.split("?")[0]!,
): FastifyReply {
  if (result.replayed) {
    request.authz.decisions += 1;
    reply.header("Idempotent-Replayed", "true");
  }
  const base = collection;
  return sendVersioned(reply, result.status, result.body, `${base}/${result.body.id}`);
}

/** Registers the register's routes on the app. Returns "METHOD path" strings for the module registration. */
export function registerRegister<Row extends RegisterRow, Api extends { id: string; version: number }>(
  app: FastifyInstance,
  db: Db,
  spec: RegisterSpec<Row, Api>,
): string[] {
  const ops = { list: true, create: true, get: true, update: true, archive: true, ...(spec.ops ?? {}) };
  const itemPath = `${spec.path}/:${spec.idParam}`;
  const parentParams = spec.parent ? ["transformationId", spec.parent.param] : ["transformationId"];
  const itemParams = [...parentParams, spec.idParam];
  const routes: string[] = [];
  const readAccess = { access: { permission: "transformation.read" as const } };
  const writeAccess = { access: { permission: spec.writeRules[0]!.permission } };

  /** Rows -> API bodies through the register's presenter. */
  const render = async (dbx: DbOrTx, rows: readonly Row[]): Promise<Api[]> =>
    spec.present ? spec.present(dbx, rows) : rows.map((r) => spec.toApi!(r));
  const renderOne = async (dbx: DbOrTx, row: Row): Promise<Api> => (await render(dbx, [row]))[0]!;

  /** Parent check: the parent row exists in the transformation (404 otherwise). */
  const checkParent = async (dbx: DbOrTx, transformationId: string, params: ReadonlyMap<string, string>) => {
    if (!spec.parent) return;
    const row = await loose(dbx)
      .selectFrom(spec.parent.table)
      .select(["id"])
      .where("id", "=", params.get(spec.parent.param)!)
      .where("transformation_id", "=", transformationId)
      .executeTakeFirst();
    if (!row) throw problems.notFound();
  };
  const findRow = async (dbx: DbOrTx, params: ReadonlyMap<string, string>, forUpdate = false) => {
    let q = loose(dbx)
      .selectFrom(spec.table)
      .selectAll()
      .where("id", "=", params.get(spec.idParam)!)
      .where("transformation_id", "=", params.get("transformationId")!);
    if (spec.parent) q = q.where(spec.parent.column, "=", params.get(spec.parent.param)!);
    if (forUpdate) q = q.forUpdate();
    return (await q.executeTakeFirst()) as Row | undefined;
  };

  if (ops.list) {
    routes.push(`GET ${spec.path}`);
    app.get(spec.path, { config: readAccess }, async (request) => {
      const params = paramsOf(request, parentParams);
      const transformationId = params.get("transformationId")!;
      const query = parseQuery(listQuery, request.query);
      await requireTransformationRead(db, principalOf(request), transformationId);
      await checkParent(db, transformationId, params);
      const hash = filterHash({
        includeArchived: query.includeArchived,
        parent: spec.parent ? params.get(spec.parent.param) : null,
      });
      const after = decodeCursor(query.cursor, hash, 1);
      let q = loose(db).selectFrom(spec.table).selectAll().where("transformation_id", "=", transformationId);
      if (spec.parent) q = q.where(spec.parent.column, "=", params.get(spec.parent.param)!);
      if (spec.archive !== false && spec.archive !== undefined && !query.includeArchived)
        q = q.where("status", "<>", "archived");
      if (after) q = q.where("id", ">", String(after[0]));
      const rows = (await q
        .orderBy("id")
        .limit(query.limit + 1)
        .execute()) as unknown as Row[];
      const pageRows = paginate(rows, query.limit, (r) => [r.id], hash);
      return { items: await render(db, pageRows.items), nextCursor: pageRows.nextCursor };
    });
  }

  if (ops.get) {
    routes.push(`GET ${itemPath}`);
    app.get(itemPath, { config: readAccess }, async (request, reply) => {
      const params = paramsOf(request, itemParams);
      await requireTransformationRead(db, principalOf(request), params.get("transformationId")!);
      const row = await findRow(db, params);
      if (!row) throw problems.notFound();
      return sendVersioned(reply, 200, await renderOne(db, row));
    });
  }

  if (ops.create) {
    routes.push(`POST ${spec.path}`);
    app.post(spec.path, { config: writeAccess }, async (request, reply) => {
      const params = paramsOf(request, parentParams);
      const transformationId = params.get("transformationId")!;
      const result = await db.transaction().execute(async (tx) => {
        const userId = principalOf(request).userId!;
        const ctx = await openWrite(
          tx,
          request,
          transformationId,
          spec.writeRules,
          spec.createOwnership ? spec.createOwnership(request.body, userId) : { createdBy: userId },
        );
        await checkParent(tx, transformationId, params);
        const body = parseBody(spec.createSchema, request.body);
        return maybeIdempotent(tx, request, ctx.userId, body, async () => {
          const values: LooseRow = {
            ...spec.insertValues(body as never, ctx),
            ...(spec.parent ? Object.fromEntries([[spec.parent.column, params.get(spec.parent.param)!]]) : {}),
          };
          if (spec.check) await spec.check(values, ctx, null);
          const completed = spec.beforeInsert ? await spec.beforeInsert(values, ctx) : values;
          const id = uuidv7();
          const row = (await loose(tx)
            .insertInto(spec.table)
            .values({
              ...completed,
              id,
              organization_id: ctx.organizationId,
              transformation_id: transformationId,
              created_by: ctx.userId,
              updated_by: ctx.userId,
            })
            .returningAll()
            .executeTakeFirstOrThrow()) as unknown as Row;
          await record(tx, ctx.audit, {
            action: `${spec.table}.create`,
            recordType: spec.table,
            recordId: id,
            organizationId: ctx.organizationId,
            transformationId,
            newVersion: row.version,
            changes: diffFields({} as LooseRow, row as unknown as LooseRow, spec.auditFields),
          });
          return { status: 201, body: await renderOne(tx, row) };
        });
      });
      return sendCreated(request, reply, result);
    });
  }

  /** Shared prologue of update and archive: gates, If-Match, lock, version. */
  const lockForChange = async (
    tx: Tx,
    request: FastifyRequest,
    params: ReadonlyMap<string, string>,
    rules: readonly WriteRule[],
  ) => {
    const principal = principalOf(request);
    const transformationId = params.get("transformationId")!;
    await requireTransformationRead(tx, principal, transformationId);
    const seen = await findRow(tx, params);
    if (!seen) throw problems.notFound();
    const ctx = await openWrite(tx, request, transformationId, rules, {
      createdBy: seen.created_by,
      ownerUserId: seen.owner_user_id ?? null,
    });
    return { ctx, seen };
  };
  const finishLock = async (tx: Tx, request: FastifyRequest, params: ReadonlyMap<string, string>) => {
    const expected = requireIfMatch(request);
    const current = await findRow(tx, params, true);
    if (!current) throw problems.notFound();
    if (current.version !== expected) throw problems.versionConflict(current.version);
    if (current.status === "archived")
      throw problems.businessRule("record.archived", "Archived records are read-only.");
    return current;
  };

  if (ops.update) {
    routes.push(`PATCH ${itemPath}`);
    app.patch(itemPath, { config: writeAccess }, async (request, reply) => {
      const params = paramsOf(request, itemParams);
      const row = await db.transaction().execute(async (tx) => {
        const { ctx } = await lockForChange(tx, request, params, spec.updateRules ?? spec.writeRules);
        const body = parseBody(spec.updateSchema, request.body) as LooseRow;
        const current = await finishLock(tx, request, params);
        const changes = spec.updateValues(body as never, current, ctx);
        const nextStatus = new Map(Object.entries(changes)).get("status");
        if (nextStatus !== undefined && nextStatus !== current.status) {
          if (nextStatus === "archived")
            throw problems.invalidTransition("Use the archive operation (a reason is mandatory) to archive a record.");
          const allowed = spec.transitions?.get(String(current.status)) ?? [];
          if (!allowed.includes(String(nextStatus)))
            throw problems.invalidTransition(
              `The record cannot move from ${String(current.status)} to ${String(nextStatus)}.`,
            );
        }
        if (spec.check) await spec.check({ ...(current as unknown as LooseRow), ...changes }, ctx, current);
        const updated = (await loose(tx)
          .updateTable(spec.table)
          .set({ ...changes, ...bumpStamps(ctx.userId) })
          .where("id", "=", current.id)
          .where("version", "=", current.version)
          .returningAll()
          .executeTakeFirstOrThrow()) as unknown as Row;
        await record(tx, ctx.audit, {
          action: `${spec.table}.update`,
          recordType: spec.table,
          recordId: current.id,
          organizationId: ctx.organizationId,
          transformationId: ctx.transformationId,
          priorVersion: current.version,
          newVersion: updated.version,
          changes: diffFields(current as unknown as LooseRow, updated as unknown as LooseRow, spec.auditFields),
        });
        return renderOne(tx, updated);
      });
      return sendVersioned(reply, 200, row);
    });
  }

  if (ops.archive && spec.archive !== false && spec.archive !== undefined) {
    const refuse = spec.archive.refuse;
    routes.push(`POST ${itemPath}/archive`);
    app.post(`${itemPath}/archive`, { config: writeAccess }, async (request, reply) => {
      const params = paramsOf(request, itemParams);
      const row = await db.transaction().execute(async (tx) => {
        const { ctx } = await lockForChange(tx, request, params, spec.archiveRules ?? spec.writeRules);
        const { reason } = parseBody(reasonRequest, request.body);
        const current = await finishLock(tx, request, params);
        const refused = refuse ? refuse(current) : null;
        if (refused) throw refused;
        const updated = (await loose(tx)
          .updateTable(spec.table)
          .set({
            status: "archived",
            archived_at: sql<Date>`now()`,
            archived_by: ctx.userId,
            archive_reason: reason,
            ...bumpStamps(ctx.userId),
          })
          .where("id", "=", current.id)
          .where("version", "=", current.version)
          .returningAll()
          .executeTakeFirstOrThrow()) as unknown as Row;
        await record(tx, ctx.audit, {
          action: `${spec.table}.archive`,
          recordType: spec.table,
          recordId: current.id,
          organizationId: ctx.organizationId,
          transformationId: ctx.transformationId,
          priorVersion: current.version,
          newVersion: updated.version,
          reason,
          changes: { status: { from: current.status ?? null, to: "archived" } },
        });
        return renderOne(tx, updated);
      });
      return sendVersioned(reply, 200, row);
    });
  }
  return routes;
}
