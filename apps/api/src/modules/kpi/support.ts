// Shared route plumbing of the kpi module. Every mutation follows ONE order, inside ONE transaction:
//   1. read gate on the transformation (no transformation.read -> 404, existence not disclosed);
//   2. action gate (the route's write permission; denied -> 403, audited as authorization.denied - AUD lands here);
//   3. the transformation is not archived (422);
//   4. If-Match present and well-formed (428 / 400)          [changes of an existing record]
//   5. body validation with the @mth/shared zod mirrors (400), then business rules (422);
//   6. row lock, version equal to If-Match (409), record not archived (422);
//   7. the write with version + 1 (the p2_row_guard trigger refuses any other step) and exactly one audit event
//      (the deferred p2_audit_required trigger refuses a commit without it).
import { sql, type Db, type DbOrTx, type TransformationRow, type Tx } from "@mth/db";
import { PROBLEM_TYPES, type Permission } from "@mth/shared";
import { kpiListQuery } from "@mth/shared/schemas";
import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { principalOf, requireAction, requireRead, type ResolvedTarget } from "../access/index.ts";
import {
  cursorSchema,
  decodeCursor,
  filterHash,
  HttpProblem,
  idempotencyKeySchema,
  limitSchema,
  paginate,
  parse,
  parseQuery,
  problems,
  requestHash,
  sendVersioned,
  withIdempotency,
} from "../platform/index.ts";
import { findTransformation } from "../transformations/index.ts";
import { activeOrgUsersExist } from "./repository.ts";
import type { RuleViolation } from "./rules.ts";

export type KpiTable = "kpi_definition" | "baseline" | "outcome_kpi" | "value_pool";

export interface Scope {
  readonly target: ResolvedTarget;
  readonly transformation: TransformationRow;
}

export const transformationParams = z.strictObject({ transformationId: z.uuid() });
/**
 * Path params of a record route, e.g. { transformationId, baselineId } -> { transformationId, id }. A malformed id is a
 * 400 at `/params/<name>` (e.g. `/params/baselineId`), the pointer style of `parse` (T-DG2-ARCH-02).
 */
export function parseRecordParams(params: unknown, name: string): { transformationId: string; id: string } {
  const entries = new Map(Object.entries((params ?? {}) as Record<string, unknown>));
  const names = ["transformationId", name];
  const parsed = parse(
    z.strictObject(Object.fromEntries(names.map((n) => [n, z.uuid()]))),
    Object.fromEntries(names.map((n) => [n, entries.get(n)])),
    "params",
  );
  const ids = new Map(Object.entries(parsed));
  return { transformationId: ids.get("transformationId")!, id: ids.get(name)! };
}

/** Read gate (404) and the transformation row. */
export async function readScope(db: DbOrTx, request: FastifyRequest, transformationId: string): Promise<Scope> {
  const principal = principalOf(request);
  const target = await requireRead(db, principal, "transformation.read", {
    type: "transformation",
    id: transformationId,
  });
  const transformation = await findTransformation(db, transformationId);
  if (!transformation) throw problems.notFound();
  return { target, transformation };
}

/** Read gate (404), action gate (403), and a transformation that is not archived (422). */
export async function writeScope(
  db: DbOrTx,
  request: FastifyRequest,
  transformationId: string,
  permission: Permission,
): Promise<Scope> {
  const scope = await readScope(db, request, transformationId);
  await requireAction(db, principalOf(request), permission, scope.target);
  if (scope.transformation.archived_at !== null)
    throw problems.businessRule(
      "kpi.transformation_archived",
      "The transformation is archived; its KPI, baseline and value-pool records are read-only.",
    );
  return scope;
}

/** A violated business rule as a 422 problem with the field pointer. */
export function ruleProblem(v: RuleViolation): HttpProblem {
  return new HttpProblem({
    status: 422,
    type: PROBLEM_TYPES.validation,
    code: v.code,
    title: "Business rule violated",
    detail: v.detail,
    errors: [{ pointer: v.pointer, code: v.code, message: v.detail }],
  });
}

export function check(v: RuleViolation | null): void {
  if (v) throw ruleProblem(v);
}

/** Referenced record missing in this transformation (or archived): 422 with the field pointer. */
export function referenceProblem(pointer: string, detail: string): HttpProblem {
  return ruleProblem({ code: "validation.reference", detail, pointer });
}

/**
 * Separation of duties (ADR-0020 §3): Finance validation and trajectory approval are never done by the record's
 * creator. 403 with a specific code; audited like any other authorization denial.
 */
export function creatorDenied(
  code: string,
  detail: string,
  permission: Permission,
  record: { recordType: KpiTable; recordId: string; organizationId: string; transformationId: string },
): HttpProblem {
  return new HttpProblem({ status: 403, type: PROBLEM_TYPES.forbidden, code, title: "Forbidden", detail }).withDenial({
    permission,
    recordType: record.recordType,
    recordId: record.recordId,
    organizationId: record.organizationId,
    transformationId: record.transformationId,
  });
}

/** Named people (owner, steward) must be active users of the transformation's organization; 422 per field. */
export async function requireActiveUsers(
  db: DbOrTx,
  organizationId: string,
  named: readonly (readonly [field: string, userId: string | null | undefined])[],
): Promise<void> {
  for (const [field, userId] of named) {
    if (typeof userId === "string" && !(await activeOrgUsersExist(db, organizationId, [userId])))
      throw ruleProblem({
        code: "kpi.user_invalid",
        detail: "A named owner or steward must be an active user of the transformation's organization.",
        pointer: `/${field}`,
      });
  }
}

export function archivedRecord(kind: string): HttpProblem {
  return problems.businessRule(`${kind}.archived`, "Archived records are read-only.");
}

// ------------------------------------------------------------------------------------------------ lists

const listQuery = z.strictObject({ ...kpiListQuery.shape, cursor: cursorSchema, limit: limitSchema });

/**
 * A page of one kpi table for a transformation, newest change first (`updatedAt` desc, `id` desc), archived rows only
 * with includeArchived=true. The four tables share the columns used here (transformation_id, status, updated_at, id).
 */
export async function listPage<T>(
  db: Db,
  request: FastifyRequest,
  table: KpiTable,
  map: (row: never) => T,
): Promise<{ items: T[]; nextCursor: string | null }> {
  const { transformationId } = parse(transformationParams, request.params, "params");
  const query = parseQuery(listQuery, request.query);
  await readScope(db, request, transformationId);
  const hash = filterHash({ table, transformationId, includeArchived: query.includeArchived });
  const after = decodeCursor(query.cursor, hash, 2);
  // One query shape for the four tables: the table name is a closed union, typed as one member for Kysely.
  let q = db
    .selectFrom(table as "baseline")
    .selectAll()
    .select(sql<string>`to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`.as("sort_key"))
    .where("transformation_id", "=", transformationId);
  if (!query.includeArchived) q = q.where("status", "<>", "archived");
  if (after) {
    q = q.where(sql<boolean>`(updated_at, id) < (${String(after[0])}::timestamptz, ${String(after[1])}::uuid)`);
  }
  const rows = await q
    .orderBy("updated_at", "desc")
    .orderBy("id", "desc")
    .limit(query.limit + 1)
    .execute();
  const page = paginate(rows, query.limit, (r) => [r.sort_key, r.id], hash);
  return {
    items: page.items.map(({ sort_key: _k, ...r }) => map(r as never)),
    nextCursor: page.nextCursor,
  };
}

// ------------------------------------------------------------------------------------------------ create

/**
 * Create with an optional Idempotency-Key (same user + key + request -> the original 201 for 24 hours). `authorize`
 * runs FIRST in the transaction, before any replay lookup, so a replay is authorized afresh and never outlives a
 * revoked grant.
 */
export async function idempotentCreate<T extends { id: string; version: number }>(
  db: Db,
  request: FastifyRequest,
  reply: FastifyReply,
  collectionPath: string,
  authorize: (tx: Tx) => Promise<Scope>,
  run: (tx: Tx, scope: Scope) => Promise<T>,
): Promise<FastifyReply> {
  const principal = principalOf(request);
  const rawKey = request.headers["idempotency-key"];
  const key = rawKey === undefined ? undefined : parse(idempotencyKeySchema, rawKey, "header");
  const result = await db.transaction().execute(async (tx) => {
    const scope = await authorize(tx);
    const exec = async () => ({ status: 201, body: await run(tx, scope) });
    if (key === undefined) return { ...(await exec()), replayed: false };
    return withIdempotency(
      tx,
      { userId: principal.userId!, key, requestHash: requestHash("POST", collectionPath, request.body) },
      exec,
    );
  });
  if (result.replayed) reply.header("Idempotent-Replayed", "true");
  return sendVersioned(reply, result.status, result.body, `${collectionPath}/${result.body.id}`);
}
