// Saved views: a user's named columns, filters and sort of one list (P6 slice H; ADR-0057 §4, §10; REQ-S15-010
// "saved views", REQ-S15-013 "persist column choices in saved views"; T-DG6-BE-Q, p6-work-split §H/G.3). Route file
// created as a stub by T-DG6-BE-A with its registration line.
//   GET    /api/v1/saved-views                       listSavedViews   (signed in; own views + the organization's shared)
//   POST   /api/v1/saved-views                       createSavedView  (saved_view.manage)
//   GET    /api/v1/saved-views/{savedViewId}         getSavedView     (owner, or anyone in the organization if shared)
//   PUT    /api/v1/saved-views/{savedViewId}         putSavedView     (saved_view.manage; owner only; If-Match)
//   DELETE /api/v1/saved-views/{savedViewId}         deleteSavedView  (saved_view.manage; owner only; If-Match; soft)
//   POST   /api/v1/saved-views/{savedViewId}/share   shareSavedView   (shared true: saved_view.share, re-checked at
//                                                                      commit under the savedViewShare lock; false:
//                                                                      saved_view.manage; owner only; If-Match)
// Each write: authorization re-checked at commit inside the transaction after the row lock (the reloaded grants),
// validation (the shared list registry, packages/shared/src/saved-views.ts), If-Match (428 missing, 409 stale with
// currentVersion), one audit event per changed row with prior and new version in the same transaction, and no remote
// I/O. Setting a default clears the owner's previous default of that list and transformation in the same transaction
// (that row's own version step and audit event); a concurrent default switch is 409 saved_view.default_conflict (the
// 0108 unique index). A view grants no data: applying it only sets the list's query parameters, which the list then
// filters by its own read rules; a shared view of a transformation the reader cannot read is neither listed nor
// returned to that reader. Nothing here approves anything (G1-G6) or touches DG0-DG7.
import type { DbOrTx, SavedViewRow, Tx } from "@mth/db";
import { sql } from "@mth/db";
import {
  PROBLEM_TYPES,
  SAVED_VIEW_LIST_KEYS,
  savedViewFilterValueError,
  savedViewUnknownKey,
  type Permission,
  type SavedViewConfig,
  type SavedViewListKey,
} from "@mth/shared";
import { freeText, uuid } from "@mth/shared/schemas";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import {
  auditContextOf,
  authorize,
  commitTimeDenial,
  denialOf,
  organizationsWith,
  principalOf,
  refreshPrincipal,
  requireRead,
  scopeFilter,
  targetFor,
  type Principal,
} from "../access/index.ts";
import { record as audit } from "../audit/index.ts";
import {
  ADVISORY_LOCK_CLASSES,
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

export const SAVED_VIEW_MANAGE = "saved_view.manage" as const satisfies Permission;
export const SAVED_VIEW_SHARE = "saved_view.share" as const satisfies Permission;
const TRANSFORMATION_READ = "transformation.read" as const satisfies Permission;

const SAVED_VIEWS = "/api/v1/saved-views";
const SAVED_VIEW = "/api/v1/saved-views/:savedViewId";
const SAVED_VIEW_SHARE_PATH = "/api/v1/saved-views/:savedViewId/share";
const JSON_BODY = ["application/json"] as const;

// ------------------------------------------------------------------------------------------------ refusals

/** ADR-0057 §10, English verbatim. */
export const savedViewRefusals = {
  unknownKey: (key: string, pointer: string): HttpProblem => {
    const detail = `This view uses a column, filter or sort that the list does not offer: ${key}.`;
    return new HttpProblem({
      status: 422,
      type: PROBLEM_TYPES.validation,
      code: "saved_view.unknown_key",
      title: "Business rule violated",
      detail,
      errors: [{ pointer, code: "saved_view.unknown_key", message: detail }],
      params: { key },
    });
  },
  nameTaken: (): HttpProblem =>
    problems.duplicate("saved_view.name_taken", "You already have a view with this name for this list."),
  notOwner: (): HttpProblem =>
    new HttpProblem({
      status: 403,
      type: PROBLEM_TYPES.forbidden,
      code: "saved_view.not_owner",
      title: "Forbidden",
      detail: "Only the person who created this view can change it.",
    }),
  deleted: (): HttpProblem =>
    new HttpProblem({
      status: 409,
      type: PROBLEM_TYPES.invalidTransition,
      code: "saved_view.deleted",
      title: "Conflict",
      detail: "This view was deleted.",
    }),
  defaultConflict: (): HttpProblem =>
    new HttpProblem({
      status: 409,
      type: PROBLEM_TYPES.versionConflict,
      code: "saved_view.default_conflict",
      title: "Conflict",
      detail: "Another view was made the default for this list at the same time. Reload the list and try again.",
    }),
};

// ------------------------------------------------------------------------------------------------ validation

const KEY = z.string().regex(/^[a-z][A-Za-z0-9]{0,63}$/);
const filterValue = freeText(1, 200);
const columnsSchema = z
  .array(KEY)
  .min(1)
  .max(50)
  .refine((a) => new Set(a).size === a.length, "validation.unique_items");
const filtersSchema = z
  .record(KEY, z.union([filterValue, z.array(filterValue).min(1).max(20)]))
  .refine((o) => Object.keys(o).length <= 20, "validation.max_properties");
const sortSchema = z
  .array(z.strictObject({ key: KEY, direction: z.enum(["asc", "desc"]) }))
  .max(3)
  .refine((a) => new Set(a.map((s) => s.key)).size === a.length, "validation.unique_items");
const nameSchema = freeText(1, 120);

const savedViewCreate = z.strictObject({
  listKey: z.enum(SAVED_VIEW_LIST_KEYS),
  transformationId: uuid.nullable().optional(),
  name: nameSchema,
  columns: columnsSchema,
  filters: filtersSchema.optional(),
  sort: sortSchema.optional(),
  isDefault: z.boolean().optional(),
});
const savedViewUpdate = z.strictObject({
  name: nameSchema,
  columns: columnsSchema,
  filters: filtersSchema,
  sort: sortSchema,
  isDefault: z.boolean(),
});
const savedViewShare = z.strictObject({ shared: z.boolean() });
const listQuery = z.strictObject({
  listKey: z.enum(SAVED_VIEW_LIST_KEYS),
  transformationId: uuid.optional(),
  cursor: cursorSchema,
  limit: limitSchema,
});
const viewParams = z.strictObject({ savedViewId: uuid });
const noQuery = z.strictObject({});

/** The registry checks (ADR-0057 §4): 422 saved_view.unknown_key, then 400 for a filter value of the wrong format. */
export function checkAgainstRegistry(listKey: SavedViewListKey, config: SavedViewConfig): void {
  const unknown = savedViewUnknownKey(listKey, config);
  if (unknown) throw savedViewRefusals.unknownKey(unknown.key, unknown.pointer);
  const bad = savedViewFilterValueError(listKey, config.filters);
  if (bad)
    throw problems.badRequest(
      "validation.format",
      bad.expected === "single"
        ? `The filter ${bad.key} takes one value, not a list.`
        : `The value of the filter ${bad.key} is not a valid ${bad.expected}.`,
      bad.pointer,
    );
}

// ------------------------------------------------------------------------------------------------ rows and views

type SavedViewWithOwner = SavedViewRow & { owner_display_name: string };
type Filters = Record<string, string | string[]>;
type Sort = { key: string; direction: "asc" | "desc" }[];

export interface SavedViewBody {
  id: string;
  organizationId: string;
  ownerUserId: string;
  ownerDisplayName: string;
  isOwner: boolean;
  listKey: SavedViewListKey;
  transformationId: string | null;
  name: string;
  visibility: "personal" | "shared";
  columns: string[];
  filters: Filters;
  sort: Sort;
  isDefault: boolean;
  sharedAt: string | null;
  sharedBy: string | null;
  status: "active" | "deleted";
  deletedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export function toSavedView(row: SavedViewWithOwner, me: string): SavedViewBody {
  return {
    id: row.id,
    organizationId: row.organization_id,
    ownerUserId: row.owner_user_id,
    ownerDisplayName: row.owner_display_name,
    isOwner: row.owner_user_id === me,
    listKey: row.list_key as SavedViewListKey,
    transformationId: row.transformation_id,
    name: row.name,
    visibility: row.visibility as "personal" | "shared",
    columns: row.columns as string[],
    filters: row.filters as Filters,
    sort: row.sort as Sort,
    isDefault: row.is_default,
    sharedAt: isoOrNull(row.shared_at),
    sharedBy: row.shared_by,
    status: row.status as "active" | "deleted",
    deletedAt: isoOrNull(row.deleted_at),
    version: row.version,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

async function loadWithOwner(db: DbOrTx, id: string): Promise<SavedViewWithOwner | undefined> {
  return db
    .selectFrom("saved_view as v")
    .innerJoin("app_user as u", "u.id", "v.owner_user_id")
    .selectAll("v")
    .select("u.display_name as owner_display_name")
    .where("v.id", "=", id)
    .executeTakeFirst();
}

/** A user principal's id and home organization; a service principal saves and reads no view (403). */
function userOf(principal: Principal): { userId: string; organizationId: string } {
  if (principal.kind !== "user" || principal.userId === null || principal.organizationId === null)
    throw problems.forbidden();
  return { userId: principal.userId, organizationId: principal.organizationId };
}

/** SQL: the view's transformation is NULL or readable by the principal (transformation.read, scope-filtered). */
function transformationReadable(principal: Principal) {
  return sql<boolean>`(v.transformation_id IS NULL OR EXISTS (
    SELECT 1 FROM transformation t WHERE t.id = v.transformation_id AND ${scopeFilter(principal, TRANSFORMATION_READ, {
      level: "transformation",
      organizationId: sql.ref("t.organization_id"),
      businessUnitId: sql.ref("t.business_unit_id"),
      transformationId: sql.ref("t.id"),
    })}))`;
}

/**
 * Whether the principal may see the view (getSavedView, and the 404 of every write): its owner always (an owner who
 * lost a transformation's read right still sees, and may delete, the view; it grants nothing); anyone else of the
 * view's organization when it is active and shared and its transformation (if any) is readable. Otherwise false
 * (404: existence is not disclosed).
 */
async function visibleTo(db: DbOrTx, principal: Principal, row: SavedViewRow): Promise<boolean> {
  const me = userOf(principal);
  if (row.owner_user_id === me.userId) return true;
  if (row.organization_id !== me.organizationId || row.status !== "active" || row.visibility !== "shared") return false;
  if (row.transformation_id === null) return true;
  return (await authorize(db, principal, TRANSFORMATION_READ, { type: "transformation", id: row.transformation_id }))
    .allowed;
}

/**
 * The permission gate of a write (ADR-0057 §10; matrix §27: "own views only"). `readTransformationId` (a create of a
 * view of one transformation): transformation.read there, in the caller's organization (else 404). Then `permission`
 * held in a grant of the caller's own organization (else 403). A view grants no data, so the code is not narrowed
 * to the view's transformation; the owner of a view whose transformation they can no longer read may still change,
 * unshare or delete it (the view stays theirs and admits nothing).
 */
async function requireViewPermission(
  db: DbOrTx,
  principal: Principal,
  permission: Permission,
  readTransformationId: string | null,
): Promise<void> {
  const me = userOf(principal);
  if (readTransformationId !== null) {
    const target = await requireRead(db, principal, TRANSFORMATION_READ, {
      type: "transformation",
      id: readTransformationId,
    });
    if (target.organizationId !== me.organizationId) throw problems.notFound();
  }
  if (!organizationsWith(principal, permission).includes(me.organizationId))
    throw problems
      .forbidden()
      .withDenial(denialOf(permission, await targetFor(db, "organization", { organizationId: me.organizationId })));
}

/** The same gate at commit time, on the grants reloaded inside `tx` (a right revoked meanwhile: 403). */
async function recheckAtCommit(
  tx: Tx,
  request: FastifyRequest,
  permission: Permission,
  transformationId: string | null,
): Promise<string> {
  const fresh = await refreshPrincipal(tx, request);
  try {
    await requireViewPermission(tx, fresh, permission, transformationId);
  } catch (err) {
    if (err instanceof HttpProblem && err.status === 404 && !err.denial)
      throw problems.forbidden("Your access to this record changed while the request was in progress.");
    throw commitTimeDenial(err);
  }
  return userOf(fresh).userId;
}

/** Before a transaction: 404 when the caller cannot see the view, 403 saved_view.not_owner when it is not theirs. */
async function requireOwnVisible(db: DbOrTx, principal: Principal, id: string): Promise<SavedViewRow> {
  const row = await db.selectFrom("saved_view").selectAll().where("id", "=", id).executeTakeFirst();
  if (!row || !(await visibleTo(db, principal, row))) throw problems.notFound();
  if (row.owner_user_id !== userOf(principal).userId) throw savedViewRefusals.notOwner();
  return row;
}

/** Inside the transaction: the row lock, then visibility, ownership, the commit-time gate, deleted and the version. */
async function lockForChange(
  tx: Tx,
  request: FastifyRequest,
  id: string,
  expectedVersion: number,
  permission: Permission,
): Promise<{ locked: SavedViewRow; me: string }> {
  const locked = await tx.selectFrom("saved_view").selectAll().where("id", "=", id).forUpdate().executeTakeFirst();
  if (!locked) throw problems.notFound();
  const me = await recheckAtCommit(tx, request, permission, null);
  if (locked.owner_user_id !== me) throw savedViewRefusals.notOwner();
  if (locked.status === "deleted") throw savedViewRefusals.deleted();
  if (locked.version !== expectedVersion) throw problems.versionConflict(locked.version);
  return { locked, me };
}

const coalescedTransformation = (transformationId: string | null) =>
  transformationId === null
    ? sql<boolean>`v.transformation_id IS NULL`
    : sql<boolean>`v.transformation_id = ${transformationId}::uuid`;

/**
 * Clears the owner's previous default of (list, transformation), other than `exceptId`, with its own version step and
 * audit event. A concurrent switch that commits first makes this transaction's own default write fail on
 * saved_view_one_default_key (409 saved_view.default_conflict).
 */
async function clearPreviousDefault(
  tx: Tx,
  request: FastifyRequest,
  me: string,
  listKey: string,
  transformationId: string | null,
  exceptId: string | null,
): Promise<void> {
  let q = tx
    .selectFrom("saved_view as v")
    .selectAll("v")
    .where("v.owner_user_id", "=", me)
    .where("v.list_key", "=", listKey)
    .where("v.status", "=", "active")
    .where("v.is_default", "=", true)
    .where(coalescedTransformation(transformationId));
  if (exceptId !== null) q = q.where("v.id", "<>", exceptId);
  const previous = await q.forUpdate().executeTakeFirst();
  if (!previous) return;
  const updated = await tx
    .updateTable("saved_view")
    .set({ is_default: false, version: previous.version + 1, updated_at: sql<Date>`now()`, updated_by: me })
    .where("id", "=", previous.id)
    .where("version", "=", previous.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await audit(tx, auditContextOf(request), {
    action: "saved_view.updated",
    recordType: "saved_view",
    recordId: previous.id,
    organizationId: previous.organization_id,
    transformationId: previous.transformation_id,
    priorVersion: previous.version,
    newVersion: updated.version,
    reason: "Another view was made the default for this list (ADR-0057 §4).",
    changes: { is_default: { from: true, to: false } },
  });
}

/** 409 saved_view.name_taken before the write (the unique index saved_view_name_key is the race backstop). */
async function requireNameFree(
  db: DbOrTx,
  me: string,
  listKey: string,
  transformationId: string | null,
  name: string,
  exceptId: string | null,
): Promise<void> {
  let q = db
    .selectFrom("saved_view as v")
    .select("v.id")
    .where("v.owner_user_id", "=", me)
    .where("v.list_key", "=", listKey)
    .where("v.status", "=", "active")
    .where(sql<boolean>`lower(v.name) = lower(${name})`)
    .where(coalescedTransformation(transformationId));
  if (exceptId !== null) q = q.where("v.id", "<>", exceptId);
  if (await q.executeTakeFirst()) throw savedViewRefusals.nameTaken();
}

// ------------------------------------------------------------------------------------------------ writes

interface CreateInput {
  readonly listKey: SavedViewListKey;
  readonly transformationId: string | null;
  readonly name: string;
  readonly columns: string[];
  readonly filters: Filters;
  readonly sort: Sort;
  readonly isDefault: boolean;
}

export async function createSavedView(tx: Tx, request: FastifyRequest, input: CreateInput): Promise<SavedViewRow> {
  const me = await recheckAtCommit(tx, request, SAVED_VIEW_MANAGE, input.transformationId);
  const organizationId = userOf(request.principal!).organizationId;
  if (input.isDefault) await clearPreviousDefault(tx, request, me, input.listKey, input.transformationId, null);
  const id = uuidv7();
  const row = await tx
    .insertInto("saved_view")
    .values({
      id,
      organization_id: organizationId,
      owner_user_id: me,
      list_key: input.listKey,
      transformation_id: input.transformationId,
      name: input.name,
      columns: JSON.stringify(input.columns),
      filters: JSON.stringify(input.filters),
      sort: JSON.stringify(input.sort),
      is_default: input.isDefault,
      created_by: me,
      updated_by: me,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await audit(tx, auditContextOf(request), {
    action: "saved_view.created",
    recordType: "saved_view",
    recordId: id,
    organizationId,
    transformationId: input.transformationId,
    newVersion: 1,
    changes: {
      list_key: { from: null, to: input.listKey },
      transformation_id: { from: null, to: input.transformationId },
      name: { from: null, to: input.name },
      visibility: { from: null, to: "personal" },
      columns: { from: null, to: input.columns },
      filters: { from: null, to: input.filters },
      sort: { from: null, to: input.sort },
      is_default: { from: null, to: input.isDefault },
    },
  });
  return row;
}

interface UpdateInput {
  readonly name: string;
  readonly columns: string[];
  readonly filters: Filters;
  readonly sort: Sort;
  readonly isDefault: boolean;
}

export async function putSavedView(
  tx: Tx,
  request: FastifyRequest,
  id: string,
  expectedVersion: number,
  input: UpdateInput,
): Promise<SavedViewRow> {
  const { locked, me } = await lockForChange(tx, request, id, expectedVersion, SAVED_VIEW_MANAGE);
  if (input.isDefault && !locked.is_default)
    await clearPreviousDefault(tx, request, me, locked.list_key, locked.transformation_id, id);
  const updated = await tx
    .updateTable("saved_view")
    .set({
      name: input.name,
      columns: JSON.stringify(input.columns),
      filters: JSON.stringify(input.filters),
      sort: JSON.stringify(input.sort),
      is_default: input.isDefault,
      version: locked.version + 1,
      updated_at: sql<Date>`now()`,
      updated_by: me,
    })
    .where("id", "=", id)
    .where("version", "=", locked.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await audit(tx, auditContextOf(request), {
    action: "saved_view.updated",
    recordType: "saved_view",
    recordId: id,
    organizationId: locked.organization_id,
    transformationId: locked.transformation_id,
    priorVersion: locked.version,
    newVersion: updated.version,
    changes: {
      name: { from: locked.name, to: updated.name },
      columns: { from: locked.columns, to: updated.columns },
      filters: { from: locked.filters, to: updated.filters },
      sort: { from: locked.sort, to: updated.sort },
      is_default: { from: locked.is_default, to: updated.is_default },
    },
  });
  return updated;
}

/** deleteSavedView: soft (status deleted, final); a deleted view is never the default (0108). */
export async function deleteSavedView(
  tx: Tx,
  request: FastifyRequest,
  id: string,
  expectedVersion: number,
): Promise<SavedViewRow> {
  const { locked, me } = await lockForChange(tx, request, id, expectedVersion, SAVED_VIEW_MANAGE);
  const updated = await tx
    .updateTable("saved_view")
    .set({
      status: "deleted",
      deleted_at: sql<Date>`now()`,
      is_default: false,
      version: locked.version + 1,
      updated_at: sql<Date>`now()`,
      updated_by: me,
    })
    .where("id", "=", id)
    .where("version", "=", locked.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await audit(tx, auditContextOf(request), {
    action: "saved_view.deleted",
    recordType: "saved_view",
    recordId: id,
    organizationId: locked.organization_id,
    transformationId: locked.transformation_id,
    priorVersion: locked.version,
    newVersion: updated.version,
    changes: {
      status: { from: locked.status, to: "deleted" },
      is_default: { from: locked.is_default, to: false },
    },
  });
  return updated;
}

/**
 * shareSavedView: under the savedViewShare advisory lock (ADR-0016 §6; key: the view id), then the row lock. `shared: true` needs saved_view.share
 * re-checked here at commit time; `shared: false` needs saved_view.manage. A request for the state the view already
 * has changes nothing (no version step, no audit event) and returns the view.
 */
export async function shareSavedView(
  tx: Tx,
  request: FastifyRequest,
  id: string,
  expectedVersion: number,
  shared: boolean,
): Promise<SavedViewRow> {
  await sql`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK_CLASSES.savedViewShare}::int4, hashtext(${id}::text))`.execute(
    tx,
  );
  const { locked, me } = await lockForChange(
    tx,
    request,
    id,
    expectedVersion,
    shared ? SAVED_VIEW_SHARE : SAVED_VIEW_MANAGE,
  );
  if ((locked.visibility === "shared") === shared) return locked;
  const updated = await tx
    .updateTable("saved_view")
    .set({
      visibility: shared ? "shared" : "personal",
      shared_at: shared ? sql<Date>`now()` : null,
      shared_by: shared ? me : null,
      version: locked.version + 1,
      updated_at: sql<Date>`now()`,
      updated_by: me,
    })
    .where("id", "=", id)
    .where("version", "=", locked.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await audit(tx, auditContextOf(request), {
    action: shared ? "saved_view.shared" : "saved_view.unshared",
    recordType: "saved_view",
    recordId: id,
    organizationId: locked.organization_id,
    transformationId: locked.transformation_id,
    priorVersion: locked.version,
    newVersion: updated.version,
    changes: {
      visibility: { from: locked.visibility, to: updated.visibility },
      shared_by: { from: locked.shared_by, to: updated.shared_by },
    },
  });
  return updated;
}

// ------------------------------------------------------------------------------------------------ list

/**
 * listSavedViews: the caller's active views of the list, then the active views shared in the caller's organization by
 * others whose transformation (if any) the caller can read; each group by name (case-insensitive), then id. With
 * `transformationId`: that transformation's views and the views of every transformation (NULL). Keyset cursor
 * (group, lower(name), id), bound to listKey and transformationId.
 */
export async function listSavedViews(
  db: DbOrTx,
  principal: Principal,
  query: { listKey: SavedViewListKey; transformationId?: string; cursor?: string; limit: number },
): Promise<{ items: SavedViewWithOwner[]; nextCursor: string | null }> {
  const me = userOf(principal);
  const hash = filterHash({ listKey: query.listKey, transformationId: query.transformationId });
  const after = decodeCursor(query.cursor, hash, 3);
  const group = sql<number>`CASE WHEN v.owner_user_id = ${me.userId}::uuid THEN 0 ELSE 1 END`;
  let q = db
    .selectFrom("saved_view as v")
    .innerJoin("app_user as u", "u.id", "v.owner_user_id")
    .selectAll("v")
    .select("u.display_name as owner_display_name")
    .select(group.as("view_group"))
    .select(sql<string>`lower(v.name)`.as("name_key"))
    .where("v.list_key", "=", query.listKey)
    .where("v.status", "=", "active")
    .where((eb) =>
      eb.or([
        eb("v.owner_user_id", "=", me.userId),
        eb.and([
          eb("v.organization_id", "=", me.organizationId),
          eb("v.visibility", "=", "shared"),
          transformationReadable(principal),
        ]),
      ]),
    );
  if (query.transformationId !== undefined)
    q = q.where(sql<boolean>`(v.transformation_id IS NULL OR v.transformation_id = ${query.transformationId}::uuid)`);
  if (after) {
    const [g, n, i] = after;
    if (typeof g !== "number" || typeof n !== "string" || typeof i !== "string" || !/^[0-9a-f-]{36}$/i.test(i))
      throw problems.badRequest(
        "validation.cursor",
        "The cursor is invalid or belongs to other filters.",
        "/query/cursor",
      );
    q = q.where(sql<boolean>`(${group}, lower(v.name), v.id) > (${g}::int, ${n}::text, ${i}::uuid)`);
  }
  const rows = await q
    .orderBy(group)
    .orderBy(sql`lower(v.name)`)
    .orderBy("v.id")
    .limit(query.limit + 1)
    .execute();
  const page = paginate(rows, query.limit, (r) => [Number(r.view_group), r.name_key, r.id], hash);
  return {
    items: page.items.map(({ view_group: _g, name_key: _n, ...r }) => r),
    nextCursor: page.nextCursor,
  };
}

// ------------------------------------------------------------------------------------------------ routes

/** Registers this file's routes and returns them as "METHOD /path". */
export function registerSavedViewRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  // listSavedViews: signed in (AUD reads and applies). A service principal has no views: 403.
  app.get(SAVED_VIEWS, { config: { access: { permission: "authenticated" } } }, async (request) => {
    const query = parseQuery(listQuery, request.query);
    const principal = principalOf(request);
    const me = userOf(principal);
    const page = await listSavedViews(db, principal, {
      listKey: query.listKey,
      ...(query.transformationId !== undefined ? { transformationId: query.transformationId } : {}),
      ...(query.cursor !== undefined ? { cursor: query.cursor } : {}),
      limit: query.limit,
    });
    return { items: page.items.map((r) => toSavedView(r, me.userId)), nextCursor: page.nextCursor };
  });

  // createSavedView: 400 (body; a transformationId on the cross-transformation list) -> 404 (transformation not
  // readable) / 403 (saved_view.manage) -> 422 saved_view.unknown_key / 400 filter value -> 409 name taken -> 201.
  app.post(
    SAVED_VIEWS,
    { config: { access: { permission: SAVED_VIEW_MANAGE }, consumes: JSON_BODY } },
    async (request, reply) => {
      parseQuery(noQuery, request.query);
      const body = parseBody(savedViewCreate, request.body);
      const transformationId = body.transformationId ?? null;
      if (transformationId !== null && body.listKey === "transformations")
        throw problems.badRequest(
          "validation.transformation_not_allowed",
          "A view of the transformations list applies to every transformation; leave transformationId empty.",
          "/transformationId",
        );
      const principal = principalOf(request);
      await requireViewPermission(db, principal, SAVED_VIEW_MANAGE, transformationId);
      const config = { columns: body.columns, filters: body.filters ?? {}, sort: body.sort ?? [] };
      checkAgainstRegistry(body.listKey, config);
      await requireNameFree(db, userOf(principal).userId, body.listKey, transformationId, body.name, null);
      const row = await db.transaction().execute((tx) =>
        createSavedView(tx, request, {
          listKey: body.listKey,
          transformationId,
          name: body.name,
          columns: config.columns,
          filters: config.filters,
          sort: config.sort,
          isDefault: body.isDefault ?? false,
        }),
      );
      const view = await loadWithOwner(db, row.id);
      return sendVersioned(reply, 201, toSavedView(view!, row.owner_user_id), `${SAVED_VIEWS}/${row.id}`);
    },
  );

  // getSavedView: the owner's own view (also once deleted), or an active view shared in the organization whose
  // transformation the caller can read; else 404.
  app.get(SAVED_VIEW, { config: { access: { permission: "authenticated" } } }, async (request, reply) => {
    const { savedViewId } = parse(viewParams, request.params, "params");
    parseQuery(noQuery, request.query);
    const principal = principalOf(request);
    const me = userOf(principal);
    const row = await loadWithOwner(db, savedViewId);
    if (!row || !(await visibleTo(db, principal, row))) throw problems.notFound();
    return sendVersioned(reply, 200, toSavedView(row, me.userId));
  });

  // putSavedView: 400 -> 404 / 403 saved_view.not_owner / 403 -> 422 / 400 filter value -> 428 -> 409 (name taken,
  // deleted, stale, default conflict) -> 200.
  app.put(
    SAVED_VIEW,
    { config: { access: { permission: SAVED_VIEW_MANAGE }, consumes: JSON_BODY } },
    async (request, reply) => {
      const { savedViewId } = parse(viewParams, request.params, "params");
      parseQuery(noQuery, request.query);
      const body = parseBody(savedViewUpdate, request.body);
      const principal = principalOf(request);
      const current = await requireOwnVisible(db, principal, savedViewId);
      await requireViewPermission(db, principal, SAVED_VIEW_MANAGE, null);
      checkAgainstRegistry(current.list_key as SavedViewListKey, body);
      const expected = requireIfMatch(request);
      if (current.status === "deleted") throw savedViewRefusals.deleted();
      await requireNameFree(
        db,
        current.owner_user_id,
        current.list_key,
        current.transformation_id,
        body.name,
        current.id,
      );
      const row = await db.transaction().execute((tx) => putSavedView(tx, request, savedViewId, expected, body));
      const view = await loadWithOwner(db, row.id);
      return sendVersioned(reply, 200, toSavedView(view!, row.owner_user_id));
    },
  );

  // deleteSavedView: 404 / 403 -> 428 -> 409 (deleted, stale) -> 200 with the deleted view.
  app.delete(SAVED_VIEW, { config: { access: { permission: SAVED_VIEW_MANAGE } } }, async (request, reply) => {
    const { savedViewId } = parse(viewParams, request.params, "params");
    parseQuery(noQuery, request.query);
    const principal = principalOf(request);
    await requireOwnVisible(db, principal, savedViewId);
    await requireViewPermission(db, principal, SAVED_VIEW_MANAGE, null);
    const expected = requireIfMatch(request);
    const row = await db.transaction().execute((tx) => deleteSavedView(tx, request, savedViewId, expected));
    const view = await loadWithOwner(db, row.id);
    return sendVersioned(reply, 200, toSavedView(view!, row.owner_user_id));
  });

  // shareSavedView: 400 -> 404 / 403 saved_view.not_owner / 403 (saved_view.share for shared: true) -> 428 -> 409
  // (deleted, stale) -> 200.
  app.post(
    SAVED_VIEW_SHARE_PATH,
    { config: { access: { permission: SAVED_VIEW_MANAGE }, consumes: JSON_BODY } },
    async (request, reply) => {
      const { savedViewId } = parse(viewParams, request.params, "params");
      parseQuery(noQuery, request.query);
      const { shared } = parseBody(savedViewShare, request.body);
      const principal = principalOf(request);
      await requireOwnVisible(db, principal, savedViewId);
      await requireViewPermission(db, principal, shared ? SAVED_VIEW_SHARE : SAVED_VIEW_MANAGE, null);
      const expected = requireIfMatch(request);
      const row = await db.transaction().execute((tx) => shareSavedView(tx, request, savedViewId, expected, shared));
      const view = await loadWithOwner(db, row.id);
      return sendVersioned(reply, 200, toSavedView(view!, row.owner_user_id));
    },
  );

  return [
    `GET ${SAVED_VIEWS}`,
    `POST ${SAVED_VIEWS}`,
    `GET ${SAVED_VIEW}`,
    `PUT ${SAVED_VIEW}`,
    `DELETE ${SAVED_VIEW}`,
    `POST ${SAVED_VIEW_SHARE_PATH}`,
  ];
}
