// Resource roles, capacity and the capacity plan (ADR-0023 §6; REQ-PB-059, REQ-S09-004; T-DG3-BE-E):
//   GET   /transformations/{id}/resource-roles              resourcing roles (not access roles)   (transformation.read)
//   POST  /transformations/{id}/resource-roles              create                                (capacity.edit)
//   PATCH /transformations/{id}/resource-roles/{roleId}     labels or archive; If-Match            (capacity.edit)
//   GET   /capacity?transformationId=&resourceRoleId=        available FTE per role and month      (transformation.read)
//   POST  /capacity                                         create                                (capacity.edit)
//   GET   /capacity/{capacityId}                            one row                               (transformation.read)
//   PATCH /capacity/{capacityId}                            update or archive; If-Match            (capacity.edit)
//   GET   /transformations/{id}/capacity-plan?from=&to=      role x month grid with the conflict flag
//
// THE CONFLICT RULE (ADR-0023 §6), one function (`capacityCell`), used by the plan, the initiative flags and G4:
//   demand    = sum of demand_fte of `planned` + `committed` demand of initiatives that are not cancelled/completed;
//   available = the ACTIVE capacity row's available_fte for that role and month;
//   demand > available  -> `capacity.over_allocated`, with the decimal shortfall demand - available;
//   no capacity row     -> `capacity.unknown`: Unknown, NEVER "no conflict" (available and shortfall are null, not 0).
// FTE is a decimal string on the wire and numeric(6,2) in SQL; sums run in SQL (numeric) and comparisons in decimal.js,
// never through Number(). G4 uses committed demand only (workflows/g4.ts).
import type { CapacityTable, DbOrTx, ResourceRoleTable, Tx } from "@mth/db";
import { sql } from "@mth/db";
import {
  businessDate,
  CAPACITY_FLAGS,
  capacity,
  capacityPage,
  capacityPlan,
  capacityPlanCell,
  freeText,
  fte,
  periodMonth,
  resourceRole,
  resourceRoleList,
  uuid,
  type Capacity,
  type CapacityPlanCell,
  type ResourceRole,
  type ScheduleFlag,
} from "@mth/shared/schemas";
import { Decimal } from "decimal.js";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Selectable } from "kysely";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { principalOf, requireTransformationRead } from "../access/index.ts";
import { record } from "../audit/index.ts";
import {
  cursorSchema,
  decodeCursor,
  filterHash,
  iso,
  limitSchema,
  paginate,
  parse,
  parseBody,
  parseQuery,
  problems,
  sendVersioned,
  type ModuleDeps,
} from "../platform/index.ts";
import { assertActiveUsers, bumpStamps, openWrite } from "../transformations/index.ts";
import { loadScheduleFacts } from "./roadmap.ts";
import { computeScheduleFlags } from "./schedule.ts";
import { checkVersion, dateText, JSON_BODY, lockForWrite, rule } from "./waves.ts";

export type ResourceRoleRow = Selectable<ResourceRoleTable>;
export type CapacityRow = Selectable<CapacityTable>;

// ------------------------------------------------------------------------------------------------ zod mirrors

// The response mirrors (Fte, PeriodMonth, ResourceRole(+List), Capacity(+Page), CapacityPlanCell, CapacityPlan and the
// capacity flags) live in `@mth/shared/schemas` (roadmap.ts, T-DG3-ARCH-04) so the web uses the same definitions. They
// are re-exported here under their old names; the request schemas stay with the routes.
export {
  CAPACITY_FLAGS,
  capacity,
  capacityPage,
  capacityPlan,
  capacityPlanCell,
  fte,
  periodMonth,
  resourceRole,
  resourceRoleList,
  type Capacity,
  type CapacityPlanCell,
  type ResourceRole,
};
const roleCodeText = z.string().regex(/^[a-z][a-z0-9_]{0,47}$/, "validation.code");
const atLeastOne = <T extends z.ZodRawShape>(shape: T) =>
  z.strictObject(shape).refine((v) => Object.keys(v).length >= 1, "validation.min_properties");

export const resourceRoleCreate = z.strictObject({
  code: roleCodeText,
  labelEn: freeText(1, 200),
  labelAr: freeText(1, 200),
});
export const resourceRoleUpdate = atLeastOne({
  labelEn: freeText(1, 200).optional(),
  labelAr: freeText(1, 200).optional(),
  status: z.enum(["active", "archived"]).optional(),
});

export const capacityCreate = z.strictObject({
  transformationId: uuid,
  resourceRoleId: uuid,
  periodMonth,
  availableFte: fte,
  ownerUserId: uuid.nullable().optional(),
  note: freeText(1, 2000).optional(),
});
export const capacityUpdate = atLeastOne({
  availableFte: fte.optional(),
  ownerUserId: uuid.nullable().optional(),
  note: freeText(1, 2000).nullable().optional(),
  status: z.enum(["active", "archived"]).optional(),
});

// ------------------------------------------------------------------------------------------------ presenters

export const toResourceRole = (r: ResourceRoleRow): ResourceRole => ({
  id: r.id,
  organizationId: r.organization_id,
  transformationId: r.transformation_id,
  code: r.code,
  labelEn: r.label_en,
  labelAr: r.label_ar,
  status: r.status as ResourceRole["status"],
  version: r.version,
  createdAt: iso(r.created_at),
  createdBy: r.created_by,
  updatedAt: iso(r.updated_at),
  updatedBy: r.updated_by,
});

/** numeric(6,2) text as the Fte wire form (two decimals; the DB already holds it exactly). */
export const fteText = (v: string | Decimal): string => new Decimal(String(v)).toFixed(2);

export const toCapacity = (r: CapacityRow): Capacity => ({
  id: r.id,
  organizationId: r.organization_id,
  transformationId: r.transformation_id,
  resourceRoleId: r.resource_role_id,
  periodMonth: dateText(r.period_month as unknown as string)!,
  availableFte: fteText(r.available_fte),
  ownerUserId: r.owner_user_id,
  note: r.note,
  status: r.status as Capacity["status"],
  version: r.version,
  createdAt: iso(r.created_at),
  createdBy: r.created_by,
  updatedAt: iso(r.updated_at),
  updatedBy: r.updated_by,
});

// ------------------------------------------------------------------------------------------------ the conflict rule

/**
 * One cell of the plan (pure; ADR-0023 §6). `available` null = no active capacity row = Unknown (flag
 * `capacity.unknown`, shortfall null - never 0 and never "no conflict"). `demand > available` = over-allocated with the
 * decimal shortfall. Otherwise no flag and a zero shortfall.
 */
export function capacityCell(
  resourceRoleId: string,
  month: string,
  available: string | null,
  demand: string,
  committed: string,
): CapacityPlanCell {
  const d = new Decimal(demand);
  const base = {
    resourceRoleId,
    periodMonth: month,
    demandFte: fteText(d),
    committedDemandFte: fteText(committed),
  };
  if (available === null) return { ...base, availableFte: null, shortfallFte: null, flag: CAPACITY_FLAGS.unknown };
  const a = new Decimal(available);
  if (d.greaterThan(a))
    return { ...base, availableFte: fteText(a), shortfallFte: fteText(d.minus(a)), flag: CAPACITY_FLAGS.overAllocated };
  return { ...base, availableFte: fteText(a), shortfallFte: fteText("0"), flag: null };
}

/** Demand of initiatives that still count (ADR-0023 §6): not cancelled / completed. */
const CLOSED_INITIATIVE = ["cancelled", "completed"] as const;

interface DemandSum {
  resource_role_id: string;
  period_month: string;
  demand: string;
  committed: string;
}

/**
 * The role x month grid of a transformation: one cell for every (role, month) with an active capacity row or with
 * counted demand. Sums are numeric in SQL; the rule is `capacityCell`. `from`/`to` bound the months (inclusive).
 */
export async function loadCapacityPlan(
  db: DbOrTx,
  transformationId: string,
  range: { from?: string | undefined; to?: string | undefined } = {},
): Promise<{ roles: ResourceRoleRow[]; cells: CapacityPlanCell[] }> {
  const roles = await db
    .selectFrom("resource_role")
    .selectAll()
    .where("transformation_id", "=", transformationId)
    .orderBy("code")
    .execute();
  let cq = db
    .selectFrom("capacity")
    .select(["resource_role_id", "period_month", "available_fte"])
    .where("transformation_id", "=", transformationId)
    .where("status", "=", "active");
  if (range.from !== undefined) cq = cq.where("period_month", ">=", range.from as never);
  if (range.to !== undefined) cq = cq.where("period_month", "<=", range.to as never);
  const caps = await cq.execute();
  const fromSql = range.from === undefined ? sql`` : sql`AND d.period_month >= ${range.from}::date`;
  const toSql = range.to === undefined ? sql`` : sql`AND d.period_month <= ${range.to}::date`;
  const sums = await sql<DemandSum>`
    SELECT d.resource_role_id, to_char(d.period_month, 'YYYY-MM-DD') AS period_month,
           sum(d.demand_fte)::text AS demand,
           COALESCE(sum(d.demand_fte) FILTER (WHERE d.status = 'committed'), 0)::text AS committed
      FROM resource_demand d JOIN initiative i ON i.id = d.initiative_id
     WHERE d.transformation_id = ${transformationId}::uuid
       AND d.status IN ('planned', 'committed')
       AND i.status NOT IN (${sql.join([...CLOSED_INITIATIVE])})
       ${fromSql} ${toSql}
     GROUP BY d.resource_role_id, d.period_month`.execute(db);
  const key = (role: string, month: string) => `${role}|${month}`;
  const available = new Map(
    caps.map((c) => [key(c.resource_role_id, dateText(c.period_month as unknown as string)!), String(c.available_fte)]),
  );
  const demand = new Map(sums.rows.map((s) => [key(s.resource_role_id, s.period_month), s]));
  const keys = [...new Set([...available.keys(), ...demand.keys()])].sort();
  const cells = keys.map((k) => {
    const [role, month] = k.split("|") as [string, string];
    const s = demand.get(k);
    return capacityCell(role, month, available.get(k) ?? null, s?.demand ?? "0", s?.committed ?? "0");
  });
  return { roles, cells };
}

// ------------------------------------------------------------------------------------------------ initiative flags

/** Flags for a set of initiatives, keyed by initiative id (same signature as prioritization's FlagSource). */
export type InitiativeFlagSource = (
  db: DbOrTx,
  transformationId: string,
  initiativeIds: readonly string[],
) => Promise<ReadonlyMap<string, readonly ScheduleFlag[]>>;

/**
 * Capacity flags of initiatives (ADR-0023 §6; REQ-S09-004): every (role, month) where the initiative has counted demand
 * and the cell is over-allocated or Unknown. Warnings, never rejections.
 */
export const capacityFlagSource: InitiativeFlagSource = async (db, transformationId, initiativeIds) => {
  const out = new Map<string, ScheduleFlag[]>();
  if (initiativeIds.length === 0) return out;
  const { roles, cells } = await loadCapacityPlan(db, transformationId);
  const roleLabel = new Map(roles.map((r) => [r.id, r.label_en]));
  const cellOf = new Map(cells.map((c) => [`${c.resourceRoleId}|${c.periodMonth}`, c]));
  const demands = await db
    .selectFrom("resource_demand")
    .select(["initiative_id", "resource_role_id", "period_month"])
    .where("transformation_id", "=", transformationId)
    .where("initiative_id", "in", [...initiativeIds])
    .where("status", "in", ["planned", "committed"])
    .orderBy("period_month")
    .orderBy("resource_role_id")
    .execute();
  const seen = new Set<string>();
  for (const d of demands) {
    const month = dateText(d.period_month as unknown as string)!;
    const k = `${d.resource_role_id}|${month}`;
    if (seen.has(`${d.initiative_id}|${k}`)) continue;
    seen.add(`${d.initiative_id}|${k}`);
    const cell = cellOf.get(k);
    if (cell === undefined || cell.flag === null) continue; // a closed initiative's demand forms no cell
    const role = roleLabel.get(d.resource_role_id) ?? d.resource_role_id;
    const period = month.slice(0, 7);
    const message =
      cell.flag === CAPACITY_FLAGS.overAllocated
        ? `Capacity over-allocated: ${role} ${period} (demand ${cell.demandFte} FTE, available ${cell.availableFte} FTE, shortfall ${cell.shortfallFte} FTE)`
        : `Capacity unknown: ${role} ${period} (no capacity recorded)`;
    out.set(d.initiative_id, [
      ...(out.get(d.initiative_id) ?? []),
      { code: cell.flag, message, initiativeId: d.initiative_id },
    ]);
  }
  return out;
};

/** Schedule flags of initiatives as successors (BE-C schedule.ts over the roadmap facts; ADR-0023 §5). */
export const scheduleFlagSource: InitiativeFlagSource = async (db, transformationId, initiativeIds) => {
  const out = new Map<string, readonly ScheduleFlag[]>();
  if (initiativeIds.length === 0) return out;
  const { byInitiative } = computeScheduleFlags(await loadScheduleFacts(db, transformationId));
  for (const id of initiativeIds) {
    const flags = byInitiative.get(id);
    if (flags !== undefined && flags.length > 0) out.set(id, flags);
  }
  return out;
};

/** Schedule then capacity flags of initiatives of possibly several transformations (the initiative presenter). */
export async function initiativeFlags(
  db: DbOrTx,
  rows: ReadonlyArray<{ id: string; transformation_id: string }>,
): Promise<Map<string, ScheduleFlag[]>> {
  const byTransformation = new Map<string, string[]>();
  for (const r of rows)
    byTransformation.set(r.transformation_id, [...(byTransformation.get(r.transformation_id) ?? []), r.id]);
  const out = new Map<string, ScheduleFlag[]>();
  for (const [tid, ids] of byTransformation) {
    const schedule = await scheduleFlagSource(db, tid, ids);
    const cap = await capacityFlagSource(db, tid, ids);
    for (const id of ids) out.set(id, [...(schedule.get(id) ?? []), ...(cap.get(id) ?? [])]);
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ writes

const EDIT = [{ permission: "capacity.edit" as const }];

/** The changed fields of an update as the AuditEvent diff shape {field: {from, to}}, from [field, before, after]. */
function diff(pairs: ReadonlyArray<readonly [string, unknown, unknown]>) {
  return Object.fromEntries(
    pairs
      .filter(([, a, b]) => String(a ?? null) !== String(b ?? null))
      .map(([f, a, b]) => [f, { from: a ?? null, to: b ?? null }]),
  );
}

async function assertRoleCodeFree(tx: Tx, transformationId: string, code: string): Promise<void> {
  const clash = await tx
    .selectFrom("resource_role")
    .select("id")
    .where("transformation_id", "=", transformationId)
    .where("code", "=", code)
    .executeTakeFirst();
  if (clash)
    throw problems.duplicate("resource_role.code_taken", `A resourcing role with the code '${code}' already exists.`);
}

/** The role must exist in the transformation and be active (a new capacity or demand row). */
export async function activeRole(tx: DbOrTx, transformationId: string, roleId: string): Promise<ResourceRoleRow> {
  const role = await tx
    .selectFrom("resource_role")
    .selectAll()
    .where("id", "=", roleId)
    .where("transformation_id", "=", transformationId)
    .executeTakeFirst();
  if (!role)
    throw rule("validation.reference", "The resourcing role does not exist in this transformation.", "/resourceRoleId");
  if (role.status !== "active")
    throw rule("resource_role.archived", "The resourcing role is archived.", "/resourceRoleId");
  return role;
}

async function assertCapacityFree(tx: Tx, roleId: string, month: string, exceptId: string | null): Promise<void> {
  let q = tx
    .selectFrom("capacity")
    .select("id")
    .where("resource_role_id", "=", roleId)
    .where("period_month", "=", month as never)
    .where("status", "=", "active");
  if (exceptId !== null) q = q.where("id", "<>", exceptId);
  if (await q.executeTakeFirst())
    throw problems.duplicate(
      "capacity.duplicate",
      "This resourcing role already has active capacity for that month; update that row instead.",
    );
}

async function createRole(tx: Tx, request: FastifyRequest, transformationId: string): Promise<ResourceRoleRow> {
  const ctx = await openWrite(tx, request, transformationId, EDIT, null, { atCommit: true });
  const body = parseBody(resourceRoleCreate, request.body);
  await assertRoleCodeFree(tx, transformationId, body.code);
  const id = uuidv7();
  const row = await tx
    .insertInto("resource_role")
    .values({
      id,
      organization_id: ctx.organizationId,
      transformation_id: transformationId,
      code: body.code,
      label_en: body.labelEn,
      label_ar: body.labelAr,
      created_by: ctx.userId,
      updated_by: ctx.userId,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: "resource_role.create",
    recordType: "resource_role",
    recordId: id,
    organizationId: ctx.organizationId,
    transformationId,
    newVersion: 1,
    changes: {
      code: { from: null, to: row.code },
      label_en: { from: null, to: row.label_en },
      label_ar: { from: null, to: row.label_ar },
    },
  });
  return row;
}

async function updateRole(tx: Tx, request: FastifyRequest, transformationId: string, id: string) {
  const { ctx, current } = await lockForWrite<ResourceRoleRow>(tx, request, "resource_role", id, EDIT, (r) => ({
    createdBy: r.created_by,
  }));
  if (current.transformation_id !== transformationId) throw problems.notFound();
  const body = parseBody(resourceRoleUpdate, request.body);
  checkVersion(request, current);
  const updated = await tx
    .updateTable("resource_role")
    .set({
      ...(body.labelEn !== undefined ? { label_en: body.labelEn } : {}),
      ...(body.labelAr !== undefined ? { label_ar: body.labelAr } : {}),
      ...(body.status !== undefined ? { status: body.status } : {}),
      ...bumpStamps(ctx.userId),
    })
    .where("id", "=", id)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action:
      body.status === "archived" && current.status !== "archived" ? "resource_role.archive" : "resource_role.update",
    recordType: "resource_role",
    recordId: id,
    organizationId: ctx.organizationId,
    transformationId: ctx.transformationId,
    priorVersion: current.version,
    newVersion: updated.version,
    changes: diff([
      ["label_en", current.label_en, updated.label_en],
      ["label_ar", current.label_ar, updated.label_ar],
      ["status", current.status, updated.status],
    ]),
  });
  return updated;
}

async function createCapacity(tx: Tx, request: FastifyRequest): Promise<CapacityRow> {
  // The transformation comes from the body: read it leniently first so authorization precedes validation (AUD -> 403).
  const raw = (request.body ?? {}) as { transformationId?: unknown };
  const transformationId = parse(z.uuid(), raw.transformationId, "body");
  const ctx = await openWrite(tx, request, transformationId, EDIT, null, { atCommit: true });
  const body = parseBody(capacityCreate, request.body);
  await activeRole(tx, transformationId, body.resourceRoleId);
  await tx.selectFrom("resource_role").select("id").where("id", "=", body.resourceRoleId).forUpdate().execute();
  await assertCapacityFree(tx, body.resourceRoleId, body.periodMonth, null);
  await assertActiveUsers(tx, ctx.organizationId, [{ id: body.ownerUserId ?? null, pointer: "/ownerUserId" }]);
  const id = uuidv7();
  const row = await tx
    .insertInto("capacity")
    .values({
      id,
      organization_id: ctx.organizationId,
      transformation_id: transformationId,
      resource_role_id: body.resourceRoleId,
      period_month: body.periodMonth,
      available_fte: body.availableFte,
      owner_user_id: body.ownerUserId ?? null,
      note: body.note ?? null,
      created_by: ctx.userId,
      updated_by: ctx.userId,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: "capacity.create",
    recordType: "capacity",
    recordId: id,
    organizationId: ctx.organizationId,
    transformationId,
    newVersion: 1,
    changes: {
      resource_role_id: { from: null, to: row.resource_role_id },
      period_month: { from: null, to: body.periodMonth },
      available_fte: { from: null, to: fteText(row.available_fte) },
      owner_user_id: { from: null, to: row.owner_user_id },
    },
  });
  return row;
}

async function updateCapacity(tx: Tx, request: FastifyRequest, id: string): Promise<CapacityRow> {
  const { ctx, current } = await lockForWrite<CapacityRow>(tx, request, "capacity", id, EDIT, (r) => ({
    createdBy: r.created_by,
    ownerUserId: r.owner_user_id,
  }));
  const body = parseBody(capacityUpdate, request.body);
  checkVersion(request, current);
  if (body.status === "active" && current.status !== "active")
    await assertCapacityFree(tx, current.resource_role_id, dateText(current.period_month as unknown as string)!, id);
  await assertActiveUsers(tx, ctx.organizationId, [{ id: body.ownerUserId ?? null, pointer: "/ownerUserId" }]);
  const updated = await tx
    .updateTable("capacity")
    .set({
      ...(body.availableFte !== undefined ? { available_fte: body.availableFte } : {}),
      ...(body.ownerUserId !== undefined ? { owner_user_id: body.ownerUserId } : {}),
      ...(body.note !== undefined ? { note: body.note } : {}),
      ...(body.status !== undefined ? { status: body.status } : {}),
      ...bumpStamps(ctx.userId),
    })
    .where("id", "=", id)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: body.status === "archived" && current.status !== "archived" ? "capacity.archive" : "capacity.update",
    recordType: "capacity",
    recordId: id,
    organizationId: ctx.organizationId,
    transformationId: ctx.transformationId,
    priorVersion: current.version,
    newVersion: updated.version,
    changes: diff([
      ["available_fte", fteText(current.available_fte), fteText(updated.available_fte)],
      ["owner_user_id", current.owner_user_id, updated.owner_user_id],
      ["note", current.note, updated.note],
      ["status", current.status, updated.status],
    ]),
  });
  return updated;
}

// ------------------------------------------------------------------------------------------------ routes

const tParams = z.strictObject({ transformationId: z.uuid() });
const roleParams = z.strictObject({ transformationId: z.uuid(), resourceRoleId: z.uuid() });
const capParams = z.strictObject({ capacityId: z.uuid() });
const ROLES = "/api/v1/transformations/:transformationId/resource-roles";
const ROLE = `${ROLES}/:resourceRoleId`;
const CAPACITY = "/api/v1/capacity";
const CAPACITY_ITEM = `${CAPACITY}/:capacityId`;
const PLAN = "/api/v1/transformations/:transformationId/capacity-plan";

/** Registers this file's routes and returns them as "METHOD /path". */
export function registerCapacityRoutes(app: FastifyInstance, { db }: ModuleDeps): readonly string[] {
  const read = { access: { permission: "transformation.read" as const } };
  const edit = { access: { permission: "capacity.edit" as const }, consumes: JSON_BODY };

  app.get(ROLES, { config: read }, async (request) => {
    const { transformationId } = parse(tParams, request.params, "params");
    parseQuery(z.strictObject({}), request.query);
    await requireTransformationRead(db, principalOf(request), transformationId);
    const rows = await db
      .selectFrom("resource_role")
      .selectAll()
      .where("transformation_id", "=", transformationId)
      .orderBy("code")
      .execute();
    return { items: rows.map(toResourceRole) };
  });

  app.post(ROLES, { config: edit }, async (request, reply) => {
    const { transformationId } = parse(tParams, request.params, "params");
    const row = await db.transaction().execute((tx) => createRole(tx, request, transformationId));
    return sendVersioned(
      reply,
      201,
      toResourceRole(row),
      `/api/v1/transformations/${transformationId}/resource-roles/${row.id}`,
    );
  });

  app.patch(ROLE, { config: edit }, async (request, reply) => {
    const { transformationId, resourceRoleId } = parse(roleParams, request.params, "params");
    const row = await db.transaction().execute((tx) => updateRole(tx, request, transformationId, resourceRoleId));
    return sendVersioned(reply, 200, toResourceRole(row));
  });

  const listQuery = z.strictObject({
    transformationId: z.uuid(),
    resourceRoleId: z.uuid().optional(),
    cursor: cursorSchema,
    limit: limitSchema,
  });
  app.get(CAPACITY, { config: read }, async (request) => {
    const query = parseQuery(listQuery, request.query);
    await requireTransformationRead(db, principalOf(request), query.transformationId);
    const hash = filterHash({ transformationId: query.transformationId, resourceRoleId: query.resourceRoleId });
    const after = decodeCursor(query.cursor, hash, 2);
    let q = db.selectFrom("capacity").selectAll().where("transformation_id", "=", query.transformationId);
    if (query.resourceRoleId !== undefined) q = q.where("resource_role_id", "=", query.resourceRoleId);
    if (after)
      q = q.where((eb) =>
        eb.or([
          eb("period_month", ">", String(after[0]) as never),
          eb.and([eb("period_month", "=", String(after[0]) as never), eb("id", ">", String(after[1]))]),
        ]),
      );
    const rows = await q
      .orderBy("period_month")
      .orderBy("id")
      .limit(query.limit + 1)
      .execute();
    const page = paginate(rows, query.limit, (r) => [dateText(r.period_month as unknown as string), r.id], hash);
    return { items: page.items.map(toCapacity), nextCursor: page.nextCursor };
  });

  app.post(CAPACITY, { config: edit }, async (request, reply) => {
    const row = await db.transaction().execute((tx) => createCapacity(tx, request));
    return sendVersioned(reply, 201, toCapacity(row), `${CAPACITY}/${row.id}`);
  });

  app.get(CAPACITY_ITEM, { config: read }, async (request, reply) => {
    const { capacityId } = parse(capParams, request.params, "params");
    const row = await db.selectFrom("capacity").selectAll().where("id", "=", capacityId).executeTakeFirst();
    if (!row) throw problems.notFound();
    await requireTransformationRead(db, principalOf(request), row.transformation_id);
    return sendVersioned(reply, 200, toCapacity(row));
  });

  app.patch(CAPACITY_ITEM, { config: edit }, async (request, reply) => {
    const { capacityId } = parse(capParams, request.params, "params");
    const row = await db.transaction().execute((tx) => updateCapacity(tx, request, capacityId));
    return sendVersioned(reply, 200, toCapacity(row));
  });

  const planQuery = z.strictObject({ from: businessDate.optional(), to: businessDate.optional() });
  app.get(PLAN, { config: read }, async (request) => {
    const { transformationId } = parse(tParams, request.params, "params");
    const query = parseQuery(planQuery, request.query);
    await requireTransformationRead(db, principalOf(request), transformationId);
    const plan = await loadCapacityPlan(db, transformationId, {
      from: query.from === undefined ? undefined : monthOf(query.from),
      to: query.to === undefined ? undefined : monthOf(query.to),
    });
    return { transformationId, roles: plan.roles.map(toResourceRole), cells: plan.cells };
  });

  return [
    `GET ${ROLES}`,
    `POST ${ROLES}`,
    `PATCH ${ROLE}`,
    `GET ${CAPACITY}`,
    `POST ${CAPACITY}`,
    `GET ${CAPACITY_ITEM}`,
    `PATCH ${CAPACITY_ITEM}`,
    `GET ${PLAN}`,
  ];
}

/** `from`/`to` of the plan are BusinessDates; the plan is monthly, so a date selects its month. */
const monthOf = (d: string) => `${d.slice(0, 7)}-01`;
