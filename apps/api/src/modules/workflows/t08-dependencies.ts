// T08 Dependency Map (B0081; ADR-0023 §4-§5; REQ-PB-051, REQ-S09-008, REQ-S16-018 increment; T-DG3-BE-C) on THE
// canonical dependency record (DG2 0017, extended by 0022; one record shared by T08 and RAID):
//   GET   /dependencies?transformationId=…        page, newest change first, with schedule flags
//   POST  /dependencies                           create (dependency.edit): From = an initiative or `external` (label)
//   GET   /dependencies/{dependencyId}            one dependency with its schedule flags
//   PATCH /dependencies/{dependencyId}            update (dependency.edit; If-Match); the cycle check runs again
//   POST  /dependencies/{dependencyId}/archive    archive with a reason, never delete (dependency.edit; If-Match)
//
// The seven T08 columns: Dependency (code DEP-nn + description), From (initiative, or external with a label), To (an
// initiative), Type (the dependency_type catalogue; unknown or retired -> 422 dependency.unknown_type), Needed by,
// Owner, Status / mitigation.
//
// Cycles (REQ-S09-008), race-free (the F-DG1-140 pattern): the write transaction first takes
// pg_advisory_xact_lock(DEPENDENCY_GRAPH_LOCK_CLASS, hashtext(transformation_id)), then runs the friendly breadth-first
// check over the transformation's edges (fresh READ COMMITTED snapshots, so it sees what the previous lock holder
// committed), then writes; the database guard dependency_cycle_guard() takes the same lock and checks again. A cycle is
// 422 dependency.cycle, detail 'Dependency cycle: INI-01 → INI-02 → INI-03 → INI-01', pointer /toInitiativeId, and the
// `cycle` member [{initiativeId, code, name}, …] with the first node repeated at the end. Nothing is written.
//
// Schedule flags (ADR-0023 §5) are computed by portfolio/schedule.ts. workflows never imports portfolio (module
// graph), so the flags arrive through T08ScheduleFlagsProvider, which the composition root (server.ts) passes in
// explicitly, like the G4 GateFactsProvider (ADR-0023 §5, T-DG3-ARCH-03). Unwired, every scheduled dependency is
// flagged schedule.unknown: Unknown is never shown as "no conflict".
import { sql, type DbOrTx, type DependencyTable, type Tx } from "@mth/db";
import {
  businessDate,
  dependencyTypeCode,
  freeText,
  t08Dependency,
  t08DependencyPage,
  uuid,
  type ScheduleFlag,
  type T08Dependency,
} from "@mth/shared/schemas";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Selectable } from "kysely";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { principalOf, requireTransformationRead } from "../access/index.ts";
import { record } from "../audit/index.ts";
import {
  ADVISORY_LOCK_CLASSES,
  cursorSchema,
  DependencyCycleProblem,
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
  type CycleNode as PlatformCycleNode,
} from "../platform/index.ts";
import { assertActiveUsers, assertSameTransformation, openWrite, type WriteContext } from "../transformations/index.ts";
import { nextCode } from "./codes.ts";

/** Advisory-lock class of a transformation's dependency graph; the database guard takes the same (0022). */
export const DEPENDENCY_GRAPH_LOCK_CLASS = ADVISORY_LOCK_CLASSES.dependencyGraph;
/** ADR-0023 §5: the friendly search is bounded; past it the database guard (unbounded) decides. */
const MAX_VISITED_EDGES = 10_000;

const JSON_BODY = ["application/json"] as const;

// ------------------------------------------------------------------------------------------------ schemas

const t08From = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("initiative"), initiativeId: uuid }),
  z.strictObject({ kind: z.literal("external"), label: freeText(1, 300) }),
]);
// The T08Dependency(+Page) response mirrors live in `@mth/shared/schemas` (roadmap.ts, T-DG3-ARCH-04), re-exported here.
export { t08Dependency, t08DependencyPage, type T08Dependency };

export const t08DependencyCreate = z.strictObject({
  transformationId: uuid,
  description: freeText(1, 2000),
  from: t08From,
  toInitiativeId: uuid,
  dependencyType: dependencyTypeCode,
  neededBy: businessDate.nullable().optional(),
  ownerUserId: uuid.nullable().optional(),
  mitigation: freeText(1, 4000).nullable().optional(),
  decisionId: uuid.nullable().optional(),
});
export const t08DependencyUpdate = z
  .strictObject({
    description: freeText(1, 2000).optional(),
    from: t08From.optional(),
    toInitiativeId: uuid.optional(),
    dependencyType: dependencyTypeCode.optional(),
    neededBy: businessDate.nullable().optional(),
    ownerUserId: uuid.nullable().optional(),
    status: z.enum(["open", "at_risk", "resolved"]).optional(),
    mitigation: freeText(1, 4000).nullable().optional(),
    decisionId: uuid.nullable().optional(),
  })
  .refine((v) => Object.keys(v).length >= 1, "validation.min_properties");

// ------------------------------------------------------------------------------------------------ schedule flags seam

/** Schedule flags of a transformation's dependencies, by dependency id (portfolio/schedule.ts via the portfolio module). */
export type T08ScheduleFlagsProvider = (
  db: DbOrTx,
  transformationId: string,
) => Promise<ReadonlyMap<string, readonly ScheduleFlag[]>>;

type DependencyRow = Selectable<DependencyTable>;

/** Does a dependency take part in the schedule checks (ADR-0023 §5)? */
const scheduled = (r: DependencyRow) =>
  r.status !== "archived" && r.status !== "resolved" && r.to_initiative_id !== null;

/** Unwired fallback: Unknown, never "no conflict". */
const UNWIRED_FLAG = (r: DependencyRow): ScheduleFlag[] => [
  {
    code: "schedule.unknown",
    message: "Schedule unknown: the schedule facts are not available",
    dependencyId: r.id,
    ...(r.to_initiative_id !== null ? { initiativeId: r.to_initiative_id } : {}),
  },
];

async function flagsFor(
  provider: T08ScheduleFlagsProvider | undefined,
  db: DbOrTx,
  transformationId: string,
): Promise<(r: DependencyRow) => ScheduleFlag[]> {
  if (provider === undefined) return (r) => (scheduled(r) ? UNWIRED_FLAG(r) : []);
  const byDependency = await provider(db, transformationId);
  return (r) => [...(byDependency.get(r.id) ?? (scheduled(r) ? UNWIRED_FLAG(r) : []))];
}

export const toT08Dependency = (r: DependencyRow, flags: readonly ScheduleFlag[]): T08Dependency => ({
  id: r.id,
  organizationId: r.organization_id,
  transformationId: r.transformation_id,
  code: r.code,
  description: r.description,
  fromKind: r.from_kind as T08Dependency["fromKind"],
  fromLabel: r.from_label,
  fromInitiativeId: r.from_initiative_id,
  toKind: r.to_kind as T08Dependency["toKind"],
  toLabel: r.to_label,
  toInitiativeId: r.to_initiative_id,
  dependencyType: r.dependency_type,
  neededBy: r.needed_by === null ? null : String(r.needed_by).slice(0, 10),
  ownerUserId: r.owner_user_id,
  status: r.status as T08Dependency["status"],
  mitigation: r.mitigation,
  decisionId: r.decision_id,
  flags: [...flags],
  archivedAt: isoOrNull(r.archived_at),
  archivedBy: r.archived_by,
  archiveReason: r.archive_reason,
  version: r.version,
  createdAt: iso(r.created_at),
  createdBy: r.created_by,
  updatedAt: iso(r.updated_at),
  updatedBy: r.updated_by,
});

// ------------------------------------------------------------------------------------------------ rules

const rule = (code: string, detail: string, pointer: string) =>
  new HttpProblem({
    status: 422,
    type: "urn:mth:problem:validation",
    code,
    title: "Business rule violated",
    detail,
    errors: [{ pointer, code, message: detail }],
  });

/**
 * One node of a reported cycle (ADR-0023 §5); the first node is repeated at the end. The T08 check always fills the
 * name. The 422 itself is the platform's `DependencyCycleProblem` (one class for this check and the mapped database
 * error; T-DG3-ARCH-03), so both answer the same body.
 */
export type CycleNode = PlatformCycleNode & { readonly name: string };

/** The type must be an active catalogue code (ADR-0023 §4); the FK and dependency_type_active are the backstop. */
async function assertActiveType(db: DbOrTx, code: string): Promise<void> {
  const t = await db
    .selectFrom("dependency_type")
    .select("code")
    .where("code", "=", code)
    .where("status", "=", "active")
    .executeTakeFirst();
  if (!t) throw rule("dependency.unknown_type", `Unknown dependency type: ${code}`, "/dependencyType");
}

/**
 * Breadth-first search for a path to -> … -> from over the transformation's other non-archived initiative edges
 * (ADR-0023 §5). Returns the cycle from -> to -> … -> from (initiative ids), or null. Bounded to MAX_VISITED_EDGES;
 * past the bound it answers null and the database guard (unbounded, same lock) decides.
 */
export function findCycle(
  edges: ReadonlyArray<{ readonly from: string; readonly to: string }>,
  from: string,
  to: string,
): string[] | null {
  const out = new Map<string, string[]>();
  for (const e of edges) out.set(e.from, [...(out.get(e.from) ?? []), e.to]);
  for (const list of out.values()) list.sort();
  const parent = new Map<string, string | null>([[to, null]]);
  let frontier = [to];
  let visitedEdges = 0;
  let found = false;
  while (frontier.length > 0 && !found) {
    const next: string[] = [];
    for (const node of [...frontier].sort()) {
      for (const t of out.get(node) ?? []) {
        visitedEdges += 1;
        if (visitedEdges > MAX_VISITED_EDGES) return null;
        if (parent.has(t)) continue;
        parent.set(t, node);
        if (t === from) {
          found = true;
          break;
        }
        next.push(t);
      }
      if (found) break;
    }
    frontier = next;
  }
  if (!found) return null;
  const chain = [from];
  let cur: string | null | undefined = from;
  while (cur !== to) {
    cur = parent.get(cur!);
    if (cur === undefined || cur === null) return null;
    chain.unshift(cur);
  }
  return [from, ...chain];
}

/**
 * Under the graph lock (the caller holds it): refuse an edge from -> to that would close a cycle. `excludeId` is the
 * dependency being changed (its old edge does not count).
 */
async function assertAcyclic(tx: Tx, transformationId: string, from: string, to: string, excludeId: string | null) {
  let q = tx
    .selectFrom("dependency")
    .select(["from_initiative_id", "to_initiative_id"])
    .where("transformation_id", "=", transformationId)
    .where("status", "<>", "archived")
    .where("from_initiative_id", "is not", null)
    .where("to_initiative_id", "is not", null);
  if (excludeId !== null) q = q.where("id", "<>", excludeId);
  const rows = await q.execute();
  const cycle = findCycle(
    rows.map((r) => ({ from: r.from_initiative_id!, to: r.to_initiative_id! })),
    from,
    to,
  );
  if (cycle === null) return;
  const names = await tx
    .selectFrom("initiative")
    .select(["id", "code", "name"])
    .where("transformation_id", "=", transformationId)
    .where("id", "in", [...new Set(cycle)])
    .execute();
  const byId = new Map(names.map((n) => [n.id, n]));
  throw new DependencyCycleProblem(
    cycle.map(
      (id): CycleNode => ({ initiativeId: id, code: byId.get(id)?.code ?? id, name: byId.get(id)?.name ?? "" }),
    ),
  );
}

async function lockGraph(tx: Tx, transformationId: string): Promise<void> {
  await sql`SELECT pg_advisory_xact_lock(${DEPENDENCY_GRAPH_LOCK_CLASS}::integer, hashtext(${transformationId}::text))`.execute(
    tx,
  );
}

/** Endpoint and reference checks shared by create and update. */
async function checkReferences(
  ctx: WriteContext,
  v: {
    fromInitiativeId: string | null;
    toInitiativeId: string;
    ownerUserId: string | null | undefined;
    decisionId: string | null | undefined;
  },
): Promise<void> {
  await assertSameTransformation(ctx.tx, "initiative", ctx.transformationId, v.fromInitiativeId, "/from/initiativeId");
  await assertSameTransformation(ctx.tx, "initiative", ctx.transformationId, v.toInitiativeId, "/toInitiativeId");
  if (v.fromInitiativeId !== null && v.fromInitiativeId === v.toInitiativeId)
    throw rule("dependency.self", "An initiative cannot depend on itself.", "/toInitiativeId");
  await assertSameTransformation(ctx.tx, "decision", ctx.transformationId, v.decisionId, "/decisionId");
  await assertActiveUsers(ctx.tx, ctx.organizationId, [{ id: v.ownerUserId ?? null, pointer: "/ownerUserId" }]);
}

const AUDIT_FIELDS = [
  "code",
  "description",
  "from_kind",
  "from_label",
  "from_initiative_id",
  "to_kind",
  "to_label",
  "to_initiative_id",
  "dependency_type",
  "needed_by",
  "owner_user_id",
  "status",
  "mitigation",
  "decision_id",
] as const;

function diff(before: Partial<DependencyRow>, after: DependencyRow) {
  const changes = new Map<string, { from: unknown; to: unknown }>();
  const b = new Map(Object.entries(before));
  const a = new Map(Object.entries(after));
  for (const f of AUDIT_FIELDS) {
    const from = b.get(f) ?? null;
    const to = a.get(f) ?? null;
    if (JSON.stringify(from) !== JSON.stringify(to)) changes.set(f, { from, to });
  }
  return changes.size > 0 ? Object.fromEntries(changes) : null;
}

const RULES = [{ permission: "dependency.edit" }] as const;

/** `transformationId` from a raw create body, so the authorization gates run before full validation (AUD -> 403). */
function rawTransformationId(raw: unknown): string | null {
  if (raw === null || typeof raw !== "object") return null;
  const v = new Map(Object.entries(raw)).get("transformationId");
  return typeof v === "string" && uuid.safeParse(v).success ? v : null;
}

// ------------------------------------------------------------------------------------------------ writes

async function createDependency(tx: Tx, request: FastifyRequest): Promise<DependencyRow> {
  const early = rawTransformationId(request.body);
  if (early === null) parseBody(t08DependencyCreate, request.body); // 400 with pointers
  const transformationId = early!;
  await requireTransformationRead(tx, principalOf(request), transformationId);
  // The graph lock first (serialises this transformation's dependency writes), then authorise at commit time.
  await lockGraph(tx, transformationId);
  const ctx = await openWrite(tx, request, transformationId, RULES, null, { atCommit: true });
  const body = parseBody(t08DependencyCreate, request.body);
  await assertActiveType(tx, body.dependencyType);
  const fromInitiativeId = body.from.kind === "initiative" ? body.from.initiativeId : null;
  await checkReferences(ctx, {
    fromInitiativeId,
    toInitiativeId: body.toInitiativeId,
    ownerUserId: body.ownerUserId,
    decisionId: body.decisionId,
  });
  if (fromInitiativeId !== null) await assertAcyclic(tx, transformationId, fromInitiativeId, body.toInitiativeId, null);
  const id = uuidv7();
  const row = await tx
    .insertInto("dependency")
    .values({
      id,
      organization_id: ctx.organizationId,
      transformation_id: transformationId,
      code: await nextCode(tx, transformationId, "DEP"),
      description: body.description,
      from_kind: body.from.kind,
      from_label: body.from.kind === "external" ? body.from.label : null,
      from_initiative_id: fromInitiativeId,
      to_kind: "initiative",
      to_label: null,
      to_initiative_id: body.toInitiativeId,
      dependency_type: body.dependencyType,
      needed_by: body.neededBy ?? null,
      owner_user_id: body.ownerUserId ?? null,
      mitigation: body.mitigation ?? null,
      decision_id: body.decisionId ?? null,
      created_by: ctx.userId,
      updated_by: ctx.userId,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: "dependency.create",
    recordType: "dependency",
    recordId: id,
    organizationId: ctx.organizationId,
    transformationId,
    newVersion: row.version,
    changes: diff({}, row),
  });
  return row;
}

/** Read gate, then (optionally) the graph lock, the row lock and the commit-time write gate (BE18A). */
async function lockDependency(tx: Tx, request: FastifyRequest, id: string, graph: boolean) {
  const seen = await tx.selectFrom("dependency").select("transformation_id").where("id", "=", id).executeTakeFirst();
  if (!seen) throw problems.notFound();
  await requireTransformationRead(tx, principalOf(request), seen.transformation_id);
  if (graph) await lockGraph(tx, seen.transformation_id);
  const current = await tx
    .selectFrom("dependency")
    .selectAll()
    .where("id", "=", id)
    .forUpdate()
    .executeTakeFirstOrThrow();
  const ctx = await openWrite(
    tx,
    request,
    current.transformation_id,
    RULES,
    { createdBy: current.created_by, ownerUserId: current.owner_user_id },
    { atCommit: true },
  );
  return { ctx, current };
}

async function updateDependency(tx: Tx, request: FastifyRequest, id: string): Promise<DependencyRow> {
  const { ctx, current } = await lockDependency(tx, request, id, true);
  const body = parseBody(t08DependencyUpdate, request.body);
  const expected = requireIfMatch(request);
  if (current.version !== expected) throw problems.versionConflict(current.version);
  if (current.status === "archived") throw problems.businessRule("record.archived", "Archived records are read-only.");
  if (body.dependencyType !== undefined && body.dependencyType !== current.dependency_type)
    await assertActiveType(tx, body.dependencyType);
  const from =
    body.from === undefined
      ? null
      : body.from.kind === "initiative"
        ? { from_kind: "initiative", from_label: null, from_initiative_id: body.from.initiativeId }
        : { from_kind: "external", from_label: body.from.label, from_initiative_id: null };
  const to =
    body.toInitiativeId === undefined
      ? null
      : { to_kind: "initiative", to_label: null, to_initiative_id: body.toInitiativeId };
  const nextFrom = from === null ? current.from_initiative_id : from.from_initiative_id;
  const nextTo = to === null ? current.to_initiative_id : to.to_initiative_id;
  if (nextTo === null)
    throw rule(
      "dependency.to_required",
      "A T08 dependency's To is an initiative: set toInitiativeId.",
      "/toInitiativeId",
    );
  await checkReferences(ctx, {
    fromInitiativeId: nextFrom,
    toInitiativeId: nextTo,
    ownerUserId: body.ownerUserId,
    decisionId: body.decisionId,
  });
  if (nextFrom !== null && (nextFrom !== current.from_initiative_id || nextTo !== current.to_initiative_id))
    await assertAcyclic(tx, current.transformation_id, nextFrom, nextTo, current.id);
  const transitions = new Map([
    ["open", ["at_risk", "resolved"]],
    ["at_risk", ["open", "resolved"]],
    ["resolved", ["open"]],
  ]);
  if (
    body.status !== undefined &&
    body.status !== current.status &&
    !(transitions.get(current.status) ?? []).includes(body.status)
  )
    throw problems.invalidTransition(`The record cannot move from ${current.status} to ${body.status}.`);
  const updated = await tx
    .updateTable("dependency")
    .set({
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(from ?? {}),
      ...(to ?? {}),
      ...(body.dependencyType !== undefined ? { dependency_type: body.dependencyType } : {}),
      ...(body.neededBy !== undefined ? { needed_by: body.neededBy } : {}),
      ...(body.ownerUserId !== undefined ? { owner_user_id: body.ownerUserId } : {}),
      ...(body.status !== undefined ? { status: body.status } : {}),
      ...(body.mitigation !== undefined ? { mitigation: body.mitigation } : {}),
      ...(body.decisionId !== undefined ? { decision_id: body.decisionId } : {}),
      version: sql<number>`version + 1`,
      updated_at: sql<Date>`now()`,
      updated_by: ctx.userId,
    })
    .where("id", "=", current.id)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: "dependency.update",
    recordType: "dependency",
    recordId: current.id,
    organizationId: ctx.organizationId,
    transformationId: ctx.transformationId,
    priorVersion: current.version,
    newVersion: updated.version,
    changes: diff(current, updated),
  });
  return updated;
}

async function archiveDependency(tx: Tx, request: FastifyRequest, id: string): Promise<DependencyRow> {
  const { ctx, current } = await lockDependency(tx, request, id, false);
  const { reason } = parseBody(z.strictObject({ reason: freeText(3, 1000) }), request.body);
  const expected = requireIfMatch(request);
  if (current.version !== expected) throw problems.versionConflict(current.version);
  if (current.status === "archived") throw problems.businessRule("record.archived", "Archived records are read-only.");
  const updated = await tx
    .updateTable("dependency")
    .set({
      status: "archived",
      archived_at: sql<Date>`now()`,
      archived_by: ctx.userId,
      archive_reason: reason,
      version: sql<number>`version + 1`,
      updated_at: sql<Date>`now()`,
      updated_by: ctx.userId,
    })
    .where("id", "=", current.id)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: "dependency.archive",
    recordType: "dependency",
    recordId: current.id,
    organizationId: ctx.organizationId,
    transformationId: ctx.transformationId,
    priorVersion: current.version,
    newVersion: updated.version,
    reason,
    changes: { status: { from: current.status, to: "archived" } },
  });
  return updated;
}

// ------------------------------------------------------------------------------------------------ routes

const BASE = "/api/v1/dependencies";
const dParams = z.strictObject({ dependencyId: z.uuid() });
const listQuery = z.strictObject({
  transformationId: z.uuid(),
  initiativeId: z.uuid().optional(),
  includeArchived: z.stringbool().default(false),
  cursor: cursorSchema,
  limit: limitSchema,
});

async function presentOne(
  provider: T08ScheduleFlagsProvider | undefined,
  db: DbOrTx,
  row: DependencyRow,
): Promise<T08Dependency> {
  const flags = await flagsFor(provider, db, row.transformation_id);
  return toT08Dependency(row, flags(row));
}

/**
 * Registers the T08 dependency routes (workflows/index.ts) and returns them as "METHOD /path". `scheduleFlags` is the
 * portfolio provider passed in by the composition root; undefined = unwired (fail closed: schedule.unknown).
 */
export function registerT08DependencyRoutes(
  app: FastifyInstance,
  db: DbOrTx,
  scheduleFlags?: T08ScheduleFlagsProvider,
): string[] {
  app.get(BASE, { config: { access: { permission: "transformation.read" } } }, async (request) => {
    const query = parseQuery(listQuery, request.query);
    await requireTransformationRead(db, principalOf(request), query.transformationId);
    const hash = filterHash({
      transformationId: query.transformationId,
      initiativeId: query.initiativeId ?? null,
      includeArchived: query.includeArchived,
    });
    const after = decodeCursor(query.cursor, hash, 2);
    let q = db.selectFrom("dependency").selectAll().where("transformation_id", "=", query.transformationId);
    if (query.initiativeId !== undefined) {
      const ini = query.initiativeId;
      q = q.where((eb) => eb.or([eb("from_initiative_id", "=", ini), eb("to_initiative_id", "=", ini)]));
    }
    if (!query.includeArchived) q = q.where("status", "<>", "archived");
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
    const flags = await flagsFor(scheduleFlags, db, query.transformationId);
    return { items: page.items.map((r) => toT08Dependency(r, flags(r))), nextCursor: page.nextCursor };
  });

  app.post(
    BASE,
    { config: { access: { permission: "dependency.edit" }, consumes: JSON_BODY } },
    async (request, reply) => {
      const row = await db.transaction().execute((tx) => createDependency(tx, request));
      return sendVersioned(reply, 201, await presentOne(scheduleFlags, db, row), `${BASE}/${row.id}`);
    },
  );

  app.get(
    `${BASE}/:dependencyId`,
    { config: { access: { permission: "transformation.read" } } },
    async (request, reply) => {
      const { dependencyId } = parse(dParams, request.params, "params");
      const row = await db.selectFrom("dependency").selectAll().where("id", "=", dependencyId).executeTakeFirst();
      if (!row) throw problems.notFound();
      await requireTransformationRead(db, principalOf(request), row.transformation_id);
      return sendVersioned(reply, 200, await presentOne(scheduleFlags, db, row));
    },
  );

  app.patch(
    `${BASE}/:dependencyId`,
    { config: { access: { permission: "dependency.edit" }, consumes: JSON_BODY } },
    async (request, reply) => {
      const { dependencyId } = parse(dParams, request.params, "params");
      const row = await db.transaction().execute((tx) => updateDependency(tx, request, dependencyId));
      return sendVersioned(reply, 200, await presentOne(scheduleFlags, db, row));
    },
  );

  app.post(
    `${BASE}/:dependencyId/archive`,
    { config: { access: { permission: "dependency.edit" }, consumes: JSON_BODY } },
    async (request, reply) => {
      const { dependencyId } = parse(dParams, request.params, "params");
      const row = await db.transaction().execute((tx) => archiveDependency(tx, request, dependencyId));
      return sendVersioned(reply, 200, await presentOne(scheduleFlags, db, row));
    },
  );

  return [
    `GET ${BASE}`,
    `POST ${BASE}`,
    `GET ${BASE}/:dependencyId`,
    `PATCH ${BASE}/:dependencyId`,
    `POST ${BASE}/:dependencyId/archive`,
  ];
}
