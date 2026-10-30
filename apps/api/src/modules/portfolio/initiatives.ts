// Initiatives (T05 Initiative Card, B0072; ADR-0021 §2; REQ-PB-045, REQ-S16-016; T-DG3-BE-B):
//   GET   /api/v1/initiatives?transformationId=&status=&waveId=     list, newest change first (transformation.read);
//         &q=&executiveOwnerUserId=&workstreamLeadUserId=&sort=     P6 (ADR-0057 §5, T-DG6-BE-R): optional text and owner
//                                                                   filters and a keyset sort; all absent = the DG5 page
//   POST  /api/v1/initiatives                                       create a draft (initiative.edit); INI-nn generated
//   GET   /api/v1/initiatives/{initiativeId}                        one initiative with warnings and the funding label
//   PATCH /api/v1/initiatives/{initiativeId}                        update T05 fields, wave, planned dates (If-Match)
//
// Drafting is allowed at any time, including before G1 (B0009, ADR-0021 §3). The status changes only through the
// transition actions (transitions.ts, selections.ts). Archive, never delete: there is no DELETE; a cancelled (or
// completed) initiative is read-only. Warnings (deliverable count outside 3-7, no gap link, no executive owner) are
// hints, never rejections. Every mutation: authorization re-checked at commit (BE18A), validation, If-Match (creates are
// version 1) and one audit event; no client or remote I/O inside the transaction.
import { diffFields, sql, type InitiativeRow, type Tx } from "@mth/db";
import { initiativeCreate, initiativeStatus, initiativeUpdate } from "@mth/shared/schemas";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { RawBuilder } from "kysely";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { principalOf, requireTransformationRead } from "../access/index.ts";
import { record } from "../audit/index.ts";
import {
  cursorSchema,
  decodeCursor,
  filterHash,
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
  assertActiveUsers,
  assertSameTransformation,
  bumpStamps,
  maybeIdempotent,
  openWrite,
  pick,
  sendCreated,
  type RegisterUpdater,
  type WriteContext,
} from "../transformations/index.ts";
import {
  assertEditable,
  assertPlannedRange,
  dateText,
  lockInitiativeForWrite,
  loadInitiative,
  nextInitiativeCode,
  presentInitiative,
  presentInitiatives,
  readableInitiative,
} from "./repository.ts";

const BASE = "/api/v1/initiatives";
const idParams = z.strictObject({ initiativeId: z.uuid() });
const JSON_BODY = ["application/json"] as const;
const EDIT = [{ permission: "initiative.edit" as const }];

/** The T05 columns (body field -> column) and the audited columns. */
const FIELD_COLUMNS = [
  ["name", "name"],
  ["executiveOwnerUserId", "executive_owner_user_id"],
  ["workstreamLeadUserId", "workstream_lead_user_id"],
  ["problemStatement", "problem_statement"],
  ["objective", "objective"],
  ["scopeIn", "scope_in"],
  ["scopeOut", "scope_out"],
  ["financialBenefitSummary", "financial_benefit_summary"],
  ["customerBenefitSummary", "customer_benefit_summary"],
  ["risksSummary", "risks_summary"],
  ["waveId", "wave_id"],
  ["plannedStart", "planned_start"],
  ["plannedEnd", "planned_end"],
] as const;
export const INITIATIVE_AUDIT_FIELDS = [...FIELD_COLUMNS.map(([, c]) => c), "status", "code"] as const;

/** The audit diff of a create: every set column as `{ from: null, to }` (the AuditEvent `changes` shape). */
export function createChanges(row: InitiativeRow): Record<string, { from: null; to: unknown }> {
  const values = new Map<string, unknown>(Object.entries(row));
  const out: [string, { from: null; to: unknown }][] = [];
  for (const field of INITIATIVE_AUDIT_FIELDS) {
    const v = values.get(field);
    if (v === null || v === undefined) continue;
    out.push([field, { from: null, to: v instanceof Date ? v.toISOString() : v }]);
  }
  return Object.fromEntries(out);
}

/**
 * The ADR-0057 §5 sorts of listInitiatives (T-DG6-BE-R): key -> the sorted expression, its kind (how the keyset value
 * travels in the cursor) and the direction. `name` sorts on lower(name), the expression of `initiative_name_sort_idx`
 * (0110). The expressions are constants of this map, never request text.
 */
type InitiativeSortKind = "timestamp" | "text" | "date";
interface InitiativeSort {
  readonly expr: string;
  readonly kind: InitiativeSortKind;
  readonly dir: "asc" | "desc";
}
const INITIATIVE_SORT_COLUMNS: ReadonlyArray<readonly [string, string, InitiativeSortKind]> = [
  ["updatedAt", "updated_at", "timestamp"],
  ["code", "code", "text"],
  ["name", "lower(name)", "text"],
  ["plannedEnd", "planned_end", "date"],
];
const INITIATIVE_SORTS: ReadonlyMap<string, InitiativeSort> = new Map(
  INITIATIVE_SORT_COLUMNS.flatMap(([key, expr, kind]): [string, InitiativeSort][] => [
    [key, { expr, kind, dir: "asc" }],
    [`-${key}`, { expr, kind, dir: "desc" }],
  ]),
);
const initiativeSort = z.enum([
  "-updatedAt",
  "updatedAt",
  "code",
  "-code",
  "name",
  "-name",
  "plannedEnd",
  "-plannedEnd",
]);

const listQuery = z.strictObject({
  transformationId: z.uuid(),
  status: initiativeStatus.optional(),
  waveId: z.uuid().optional(),
  q: z.string().min(1).max(200).optional(),
  executiveOwnerUserId: z.uuid().optional(),
  workstreamLeadUserId: z.uuid().optional(),
  sort: initiativeSort.optional(),
  cursor: cursorSchema,
  limit: limitSchema,
});

const UUID_TEXT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const invalidCursor = () =>
  problems.badRequest("validation.cursor", "The cursor is invalid or belongs to other filters.", "/query/cursor");

/** A keyset value of `kind` as the database reads it; a value of another shape is a 400 (never a database error). */
function keysetValue(kind: InitiativeSortKind, value: string | number | null): RawBuilder<unknown> | null {
  if (value === null) return null;
  if (typeof value !== "string") throw invalidCursor();
  if (kind === "text") return sql`${value}::text`;
  const iso = kind === "date" ? `${value}T00:00:00.000Z` : `${value.slice(0, 23)}Z`;
  const shape = kind === "date" ? /^\d{4}-\d{2}-\d{2}$/ : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
  const time = Date.parse(iso);
  if (!shape.test(value) || Number.isNaN(time) || new Date(time).toISOString() !== iso) throw invalidCursor();
  return kind === "date" ? sql`${value}::date` : sql`${value}::timestamptz`;
}

/**
 * The rows after the keyset (value, id) in the order `expr dir NULLS LAST|FIRST, id dir` (ADR-0057 §5: nulls last
 * ascending, first descending), so paging returns every row once.
 */
function afterKeyset(sort: InitiativeSort, after: readonly (string | number | null)[]): RawBuilder<boolean> {
  const [rawValue, rawId] = after;
  if (typeof rawId !== "string" || !UUID_TEXT.test(rawId)) throw invalidCursor();
  const e = sql.raw(sort.expr);
  const id = sql`${rawId}::uuid`;
  const value = keysetValue(sort.kind, rawValue ?? null);
  if (sort.dir === "asc") {
    return value === null
      ? sql<boolean>`(${e} IS NULL AND id > ${id})`
      : sql<boolean>`((${e}, id) > (${value}, ${id}) OR ${e} IS NULL)`;
  }
  return value === null
    ? sql<boolean>`((${e} IS NULL AND id < ${id}) OR ${e} IS NOT NULL)`
    : sql<boolean>`((${e}, id) < (${value}, ${id}))`;
}

/** The sort key of a row as it travels in the cursor (timestamps to the microsecond, dates as YYYY-MM-DD). */
function sortKeyExpr(sort: InitiativeSort): RawBuilder<string | null> {
  if (sort.kind === "timestamp")
    return sql<string>`to_char(${sql.raw(sort.expr)} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
  if (sort.kind === "date") return sql<string | null>`${sql.raw(sort.expr)}::text`;
  return sql<string>`${sql.raw(sort.expr)}`;
}

/** Named people and the wave must be valid references in the transformation (422 with pointers). */
async function checkReferences(
  ctx: WriteContext,
  values: { executive_owner_user_id?: unknown; workstream_lead_user_id?: unknown; wave_id?: unknown },
): Promise<void> {
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  await assertActiveUsers(ctx.tx, ctx.organizationId, [
    { id: str(values.executive_owner_user_id), pointer: "/executiveOwnerUserId" },
    { id: str(values.workstream_lead_user_id), pointer: "/workstreamLeadUserId" },
  ]);
  await assertSameTransformation(ctx.tx, "roadmap_wave", ctx.transformationId, values.wave_id, "/waveId");
}

/**
 * The PATCH core of an initiative (T05). `transformationId`, when given, must be the initiative's own (404 otherwise);
 * `expected` is read where the PATCH always read If-Match, so the single-record route answers exactly as before
 * (T-DG5-BE-E3).
 */
async function updateInitiativeRow(
  tx: Tx,
  request: FastifyRequest,
  input: { initiativeId: string; transformationId?: string; body: unknown; expected: () => number },
): Promise<InitiativeRow> {
  const { initiativeId } = input;
  const { row: seen } = await readableInitiative(tx, request, initiativeId);
  if (input.transformationId !== undefined && seen.transformation_id !== input.transformationId)
    throw problems.notFound();
  const ctx = await openWrite(tx, request, seen.transformation_id, EDIT, null, { atCommit: true });
  const update = parseBody(initiativeUpdate, input.body);
  const current = await lockInitiativeForWrite(tx, request, initiativeId, input.expected);
  assertEditable(current);
  const changes = pick(update, FIELD_COLUMNS);
  const start =
    "planned_start" in changes ? (changes["planned_start"] as string | null) : dateText(current.planned_start);
  const end = "planned_end" in changes ? (changes["planned_end"] as string | null) : dateText(current.planned_end);
  assertPlannedRange(start, end);
  await checkReferences(ctx, changes);
  const updated = await tx
    .updateTable("initiative")
    .set({ ...changes, ...bumpStamps(ctx.userId) })
    .where("id", "=", current.id)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: "initiative.update",
    recordType: "initiative",
    recordId: current.id,
    organizationId: ctx.organizationId,
    transformationId: ctx.transformationId,
    priorVersion: current.version,
    newVersion: updated.version,
    changes: diffFields(current, updated, [...INITIATIVE_AUDIT_FIELDS]),
  });
  return updated;
}

/**
 * T-DG5-BE-E3 (ADR-0041 §5; D-159 a): the T05 PATCH core for the forms bulk edit, inside the caller's transaction:
 * the same read and write gates (re-checked at commit), validation, lock, version check, editability, references and
 * `initiative.update` audit event as a single PATCH.
 */
export const updateInitiative: RegisterUpdater = async (tx, request, input) => {
  const updated = await updateInitiativeRow(tx, request, {
    initiativeId: input.recordId,
    transformationId: input.transformationId,
    body: input.body,
    expected: () => input.expectedVersion,
  });
  return { id: updated.id, version: updated.version };
};

export function registerInitiativeRoutes(app: FastifyInstance, { db }: ModuleDeps): readonly string[] {
  const read = { access: { permission: "transformation.read" as const } };
  const edit = { access: { permission: "initiative.edit" as const }, consumes: JSON_BODY };

  app.get(BASE, { config: read }, async (request) => {
    const query = parseQuery(listQuery, request.query);
    await requireTransformationRead(db, principalOf(request), query.transformationId);
    // Every filter and the sort bind the cursor; an absent parameter is left out, so the DG5 hash is unchanged.
    const hash = filterHash({
      transformationId: query.transformationId,
      status: query.status,
      waveId: query.waveId,
      q: query.q,
      executiveOwnerUserId: query.executiveOwnerUserId,
      workstreamLeadUserId: query.workstreamLeadUserId,
      sort: query.sort,
    });
    const after = decodeCursor(query.cursor, hash, 2);
    let q = db.selectFrom("initiative").selectAll().where("transformation_id", "=", query.transformationId);
    if (query.status) q = q.where("status", "=", query.status);
    if (query.waveId) q = q.where("wave_id", "=", query.waveId);
    if (query.q) {
      const like = `%${query.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      q = q.where((eb) => eb.or([eb("code", "ilike", like), eb("name", "ilike", like)]));
    }
    if (query.executiveOwnerUserId) q = q.where("executive_owner_user_id", "=", query.executiveOwnerUserId);
    if (query.workstreamLeadUserId) q = q.where("workstream_lead_user_id", "=", query.workstreamLeadUserId);
    const sort = query.sort === undefined ? undefined : INITIATIVE_SORTS.get(query.sort);
    if (sort !== undefined) {
      // ADR-0057 §5: the keyset (sort value, id), nulls last ascending and first descending.
      let sq = q.select(sortKeyExpr(sort).as("sort_key"));
      if (after) sq = sq.where(afterKeyset(sort, after));
      const nulls = sql.raw(sort.dir === "asc" ? "NULLS LAST" : "NULLS FIRST");
      const rows = await sq
        .orderBy(sql`${sql.raw(sort.expr)} ${sql.raw(sort.dir)} ${nulls}`)
        .orderBy("id", sort.dir)
        .limit(query.limit + 1)
        .execute();
      const page = paginate(rows, query.limit, (r) => [r.sort_key, r.id], hash);
      const items = page.items.map(({ sort_key: _k, ...row }) => row);
      return { items: await presentInitiatives(db, items), nextCursor: page.nextCursor };
    }
    // `sort` absent: today's order and cursor, exactly as at DG5 (ADR-0057 §5 "absent = today's result and order").
    if (after)
      q = q.where((eb) =>
        eb.or([
          eb("updated_at", "<", new Date(String(after[0]))),
          eb.and([eb("updated_at", "=", new Date(String(after[0]))), eb("id", "<", String(after[1]))]),
        ]),
      );
    const rows = await q
      .orderBy("updated_at", "desc")
      .orderBy("id", "desc")
      .limit(query.limit + 1)
      .execute();
    const page = paginate(rows, query.limit, (r) => [r.updated_at.toISOString(), r.id], hash);
    return { items: await presentInitiatives(db, page.items), nextCursor: page.nextCursor };
  });

  app.post(BASE, { config: edit }, async (request, reply) => {
    // The transformation comes from the body; read it leniently first so authorization precedes validation (a read-only
    // auditor gets 403 for any body naming a transformation it can read).
    const raw = (request.body ?? {}) as { transformationId?: unknown };
    const transformationId = parse(z.uuid(), raw.transformationId, "body");
    const result = await db.transaction().execute(async (tx) => {
      const ctx = await openWrite(tx, request, transformationId, EDIT, null, { atCommit: true });
      const body = parseBody(initiativeCreate, request.body);
      return maybeIdempotent(tx, request, ctx.userId, body, async () => {
        const fields = pick(body, FIELD_COLUMNS);
        assertPlannedRange(body.plannedStart, body.plannedEnd);
        await checkReferences(ctx, fields);
        const id = uuidv7();
        const code = await nextInitiativeCode(tx, transformationId);
        const row = await tx
          .insertInto("initiative")
          .values({
            ...fields,
            name: body.name,
            id,
            organization_id: ctx.organizationId,
            transformation_id: transformationId,
            code,
            created_by: ctx.userId,
            updated_by: ctx.userId,
          })
          .returningAll()
          .executeTakeFirstOrThrow();
        await record(tx, ctx.audit, {
          action: "initiative.create",
          recordType: "initiative",
          recordId: id,
          organizationId: ctx.organizationId,
          transformationId,
          newVersion: 1,
          changes: createChanges(row),
        });
        return { status: 201, body: await presentInitiative(tx, row) };
      });
    });
    return sendCreated(request, reply, result, BASE);
  });

  app.get(`${BASE}/:initiativeId`, { config: read }, async (request, reply) => {
    const { initiativeId } = parse(idParams, request.params, "params");
    const { row } = await readableInitiative(db, request, initiativeId);
    return sendVersioned(reply, 200, await presentInitiative(db, row));
  });

  app.patch(`${BASE}/:initiativeId`, { config: edit }, async (request, reply) => {
    const { initiativeId } = parse(idParams, request.params, "params");
    const body = await db.transaction().execute(async (tx) => {
      await updateInitiativeRow(tx, request, {
        initiativeId,
        body: request.body,
        expected: () => requireIfMatch(request),
      });
      return loadInitiative(tx, initiativeId);
    });
    return sendVersioned(reply, 200, body);
  });

  return [`GET ${BASE}`, `POST ${BASE}`, `GET ${BASE}/:initiativeId`, `PATCH ${BASE}/:initiativeId`];
}
