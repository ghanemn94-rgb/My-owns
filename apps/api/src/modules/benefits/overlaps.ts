// Benefit overlap warnings and their Finance resolution (P4 slice B; ADR-0029 §7, §9, §11; T-DG4-KBE-D2; REQ-S08-014):
//   GET  /transformations/{t}/benefit-overlaps                          warnings, open first (transformation.read)
//   POST /transformations/{t}/benefit-overlaps                          a user raises a warning (benefit.edit; TL, BO)
//   GET  /transformations/{t}/benefit-overlaps/{overlapId}              one warning
//   POST /transformations/{t}/benefit-overlaps/{overlapId}/resolve      Finance resolves it (finance.validate; FIN only)
//
// THE RULE (`detectBenefitOverlaps`, registered into the register's `onBenefitKeysChanged` hook, so it runs inside the
// createBenefit / updateBenefit transaction whenever a benefit is created or its driver key, population key or
// realization window changes): under advisory lock class benefitOverlap (ADVISORY_LOCK_CLASSES), key "<transformationId>:<driverKey>",
// every other ACTIVE benefit of the transformation with the same driver key and an overlapping realization window (a
// missing bound is open-ended, so a missing window overlaps everything) gets a warning with dimensions {driver, period},
// plus `population` when both carry the same population key — unless that pair already has an open warning. Each
// warning writes one audit event and one `benefit_overlap_review` work item per Finance recipient through
// createWorkItemOnce (dedupe key "benefit.overlap:<overlapId>:<recipientId>"; "Overlap detected -> Finance task").
//
// WHILE OPEN, both benefits are `overlap_open` in the benefit_counting view, so their values stay out of every validated
// and sustained total (KBE-E's totals report them on the separate `pendingOverlap` line). Only Finance resolves:
// `no_economic_overlap` (both count) or `duplicate` with the excluded benefit (never counted again,
// exclusion_reason `overlap_duplicate`), always with a note, never by the owner of either benefit (403
// benefit_overlap.resolver_is_owner). open -> resolved is final; a later key change raises a new warning.
// Every mutation: 403 when the permission is held nowhere (AUD, ADM-only and, for the resolution, BO and TL), 404
// outside the read scope, the write gate re-checked at commit time, zod (400), the §11 rules (422/409/403), If-Match on
// the resolution (428/409) and its audit events in the same transaction. No remote or client I/O inside a transaction.
// A Finance resolution is a human decision inside the product; nothing here resolves by itself or touches DG0-DG7.
import { diffFields, sql, type BenefitOverlapRow, type BenefitRow, type DbOrTx, type Tx } from "@mth/db";
import { PROBLEM_TYPES, type Permission } from "@mth/shared";
import {
  benefitOverlapCreate,
  benefitOverlapResolve,
  benefitOverlapStatusQuery,
  canonicalDimensions,
  orderedPair,
  overlapOf,
  windowIntersection,
  type BenefitOverlap,
  type BenefitOverlapDimension,
  type OverlapKeys,
} from "@mth/shared/schemas";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import {
  currentGroupMemberIds,
  decide,
  loadGrants,
  principalOf,
  requireTransformationRead,
  resolveParty,
  type ResolvedTarget,
} from "../access/index.ts";
import { record } from "../audit/index.ts";
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
import { closeWorkItemsOfSubject, createWorkItemOnce } from "../tasks/index.ts";
import { maybeIdempotent, sendCreated, type WriteContext } from "../transformations/index.ts";
import {
  archivedBenefit,
  BENEFIT_EDIT,
  benefitRule,
  JSON_BODY,
  onBenefitKeysChanged,
  openBenefitWrite,
  parseTransformationParam,
  type BenefitKeysChange,
} from "./register.ts";

export const FINANCE_VALIDATE: Permission = "finance.validate";
export const OVERLAPS = "/api/v1/transformations/:transformationId/benefit-overlaps";
export const OVERLAP_ITEM = `${OVERLAPS}/:benefitOverlapId`;
export const OVERLAP_RESOLVE = `${OVERLAP_ITEM}/resolve`;
/** The work-item kind of the Finance task (0040) and the governance party it goes to (0029). */
export const OVERLAP_TASK_KIND = "benefit_overlap_review" as const;
export const FINANCE_PARTY = "FIN" as const;

export const OVERLAP_AUDIT_FIELDS = [
  "benefit_a_id",
  "benefit_b_id",
  "dimensions",
  "driver_key",
  "population_key",
  "overlap_start",
  "overlap_end",
  "detected_by",
  "status",
  "resolution",
  "excluded_benefit_id",
  "resolution_note",
  "resolved_by",
  "resolved_at",
] as const satisfies readonly (keyof BenefitOverlapRow & string)[];

// ------------------------------------------------------------------------------------------------ refusals (§11)

export const overlapRefusals = {
  sameBenefit: () =>
    benefitRule("benefit_overlap.same_benefit", "An overlap needs two different benefits.", "/benefitBId"),
  alreadyOpen: () =>
    problems.duplicate(
      "benefit_overlap.already_open",
      "An open overlap warning already exists for these two benefits.",
    ),
  notOpen: () => benefitRule("benefit_overlap.not_open", "Only an open overlap warning can be resolved.", ""),
  excludedRequired: () =>
    benefitRule(
      "benefit_overlap.excluded_required",
      "A duplicate resolution names which of the two benefits is not counted.",
      "/excludedBenefitId",
    ),
  noteRequired: () => benefitRule("benefit_overlap.note_required", "A resolution needs a note.", "/note"),
  resolverIsOwner: () =>
    new HttpProblem({
      status: 403,
      type: PROBLEM_TYPES.forbidden,
      code: "benefit_overlap.resolver_is_owner",
      title: "Forbidden",
      detail: "You own one of the overlapping benefits, so you cannot resolve this overlap.",
    }),
} as const;

// ------------------------------------------------------------------------------------------------ presenter

const dateOrNull = (v: string | Date | null): string | null =>
  v === null ? null : typeof v === "string" ? v : v.toISOString().slice(0, 10);

export function toOverlap(r: BenefitOverlapRow): BenefitOverlap {
  return {
    id: r.id,
    transformationId: r.transformation_id,
    benefitAId: r.benefit_a_id,
    benefitBId: r.benefit_b_id,
    dimensions: dimensionsOf(r.dimensions),
    driverKey: r.driver_key,
    populationKey: r.population_key,
    overlapStart: dateOrNull(r.overlap_start),
    overlapEnd: dateOrNull(r.overlap_end),
    detectedBy: r.detected_by as BenefitOverlap["detectedBy"],
    status: r.status as BenefitOverlap["status"],
    resolution: r.resolution as BenefitOverlap["resolution"],
    excludedBenefitId: r.excluded_benefit_id,
    resolutionNote: r.resolution_note,
    resolvedBy: r.resolved_by,
    resolvedAt: isoOrNull(r.resolved_at),
    version: r.version,
    createdAt: iso(r.created_at),
    createdBy: r.created_by,
    updatedAt: iso(r.updated_at),
  };
}

/**
 * `dimensions` is text[]: node-postgres returns a string[] at run time, but the frozen Kysely type in
 * packages/db/src/schema.ts declares `string` (reported to the orchestrator). Accept both shapes.
 */
export function dimensionsOf(v: unknown): BenefitOverlapDimension[] {
  const list = Array.isArray(v)
    ? v.map(String)
    : String(v)
        .replace(/^\{|\}$/g, "")
        .split(",");
  return canonicalDimensions(list.filter((d) => d !== "") as BenefitOverlapDimension[]);
}

const keysOf = (b: BenefitRow): OverlapKeys => ({
  driverKey: b.driver_key,
  populationKey: b.population_key,
  realizationStart: dateOrNull(b.realization_start),
  realizationEnd: dateOrNull(b.realization_end),
});

// ------------------------------------------------------------------------------------------------ Finance recipients

/** True when `userId` is active and currently holds finance.validate in the transformation's scope. */
async function holdsFinanceValidate(db: DbOrTx, userId: string, target: ResolvedTarget): Promise<boolean> {
  const user = await db.selectFrom("app_user").select("status").where("id", "=", userId).executeTakeFirst();
  if (!user || user.status !== "active") return false;
  return decide({ kind: "user", userId, grants: await loadGrants(db, userId) }, FINANCE_VALIDATE, target).allowed;
}

/**
 * Who receives the Finance task of a warning: the transformation's mapped FIN party (the person, or the mapped group's
 * members) when it is mapped, otherwise every active user holding finance.validate in the transformation's scope —
 * always filtered to users who hold finance.validate there and who own neither benefit (they could not resolve it).
 * Sorted, so the task set is deterministic. May be empty: the warning is still listed and still excludes both benefits.
 */
export async function overlapTaskRecipients(
  db: DbOrTx,
  target: ResolvedTarget,
  transformationId: string,
  ownerIds: readonly string[],
): Promise<string[]> {
  const party = await resolveParty(db, transformationId, FINANCE_PARTY);
  let candidates: string[];
  if (party.status === "mapped")
    candidates = party.kind === "user" ? [party.userId] : await currentGroupMemberIds(db, party.groupId);
  else {
    const rows = await db
      .selectFrom("scoped_assignment as a")
      .innerJoin("role_permission as rp", "rp.role_id", "a.role_id")
      .select("a.user_id")
      .distinct()
      .where("a.organization_id", "=", target.organizationId)
      .where("rp.permission_code", "=", FINANCE_VALIDATE)
      .where("a.revoked_at", "is", null)
      .execute();
    candidates = rows.map((r) => r.user_id);
  }
  const out: string[] = [];
  for (const id of [...new Set(candidates)].sort())
    if (!ownerIds.includes(id) && (await holdsFinanceValidate(db, id, target))) out.push(id);
  return out;
}

// ------------------------------------------------------------------------------------------------ raising a warning

interface RaiseInput {
  readonly a: BenefitRow;
  readonly b: BenefitRow;
  readonly dimensions: readonly BenefitOverlapDimension[];
  readonly start: string | null;
  readonly end: string | null;
  readonly detectedBy: "rule" | "user";
}

/**
 * Inserts one open warning for the pair (stored in id order), its audit event and the Finance task(s). Returns null when
 * the pair already has an open warning (the rule then raises nothing; the caller of a user request answers 409).
 */
async function raiseOverlap(tx: Tx, ctx: WriteContext, input: RaiseInput): Promise<BenefitOverlapRow | null> {
  const [loId] = orderedPair(input.a.id, input.b.id);
  const [lo, hi] = loId === input.a.id.toLowerCase() ? [input.a, input.b] : [input.b, input.a];
  const open = await tx
    .selectFrom("benefit_overlap")
    .select("id")
    .where("benefit_a_id", "=", lo.id)
    .where("benefit_b_id", "=", hi.id)
    .where("status", "=", "open")
    .executeTakeFirst();
  if (open) return null;
  const id = uuidv7();
  const row = await tx
    .insertInto("benefit_overlap")
    .values({
      id,
      organization_id: ctx.organizationId,
      transformation_id: ctx.transformationId,
      benefit_a_id: lo.id,
      benefit_b_id: hi.id,
      dimensions: sql<string>`${canonicalDimensions(input.dimensions)}::text[]`,
      driver_key: lo.driver_key !== null && lo.driver_key === hi.driver_key ? lo.driver_key : null,
      population_key: lo.population_key !== null && lo.population_key === hi.population_key ? lo.population_key : null,
      overlap_start: input.start,
      overlap_end: input.end,
      detected_by: input.detectedBy,
      created_by: ctx.userId,
      updated_by: ctx.userId,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: input.detectedBy === "rule" ? "benefit_overlap.detect" : "benefit_overlap.raise",
    recordType: "benefit_overlap",
    recordId: id,
    organizationId: ctx.organizationId,
    transformationId: ctx.transformationId,
    newVersion: row.version,
    changes: diffFields({} as BenefitOverlapRow, row, [...OVERLAP_AUDIT_FIELDS]),
  });
  const recipients = await overlapTaskRecipients(tx, ctx.target, ctx.transformationId, [
    lo.owner_user_id,
    hi.owner_user_id,
  ]);
  for (const userId of recipients)
    await createWorkItemOnce(
      tx,
      { actorType: "user", actorUserId: ctx.userId, requestId: ctx.audit.requestId, source: "api" },
      {
        organizationId: ctx.organizationId,
        transformationId: ctx.transformationId,
        kind: OVERLAP_TASK_KIND,
        assigneeUserId: userId,
        subjectType: "benefit_overlap",
        subjectId: id,
        linkPath: `/transformations/${ctx.transformationId}/benefit-overlaps/${id}`,
        messageKey: "benefits.task.overlap_review",
        messageParams: {
          benefitACode: lo.code,
          benefitBCode: hi.code,
          dimensions: dimensionsOf(row.dimensions).join(","),
        },
        dedupeKey: `benefit.overlap:${id}:${userId}`,
      },
    );
  return row;
}

/** Advisory lock class benefitOverlap on "<transformationId>:<driverKey>" (ADR-0029 §7, ADR-0016 §6). */
async function lockDriver(tx: Tx, transformationId: string, driverKey: string): Promise<void> {
  await sql`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK_CLASSES.benefitOverlap}::int4, hashtext(${`${transformationId}:${driverKey}`}))`.execute(
    tx,
  );
}

/**
 * The overlap rule (ADR-0029 §7) for one created or re-keyed benefit. Runs inside the register's transaction, after
 * the benefit row and its audit event are written. Raises one warning per overlapping active benefit that has no open
 * warning with it yet, and returns the warnings it raised.
 */
export async function detectBenefitOverlaps(
  tx: Tx,
  ctx: WriteContext,
  benefit: BenefitRow,
): Promise<BenefitOverlapRow[]> {
  if (benefit.status !== "active" || benefit.driver_key === null) return [];
  await lockDriver(tx, benefit.transformation_id, benefit.driver_key);
  const others = await tx
    .selectFrom("benefit")
    .selectAll()
    .where("transformation_id", "=", benefit.transformation_id)
    .where("driver_key", "=", benefit.driver_key)
    .where("status", "=", "active")
    .where("id", "<>", benefit.id)
    .orderBy("id")
    .execute();
  const raised: BenefitOverlapRow[] = [];
  for (const other of others) {
    const hit = overlapOf(keysOf(benefit), keysOf(other));
    if (hit === null) continue;
    const row = await raiseOverlap(tx, ctx, {
      a: benefit,
      b: other,
      dimensions: hit.dimensions,
      start: hit.start,
      end: hit.end,
      detectedBy: "rule",
    });
    if (row !== null) raised.push(row);
  }
  return raised;
}

/** The hook registered into the register (KBE-D's `onBenefitKeysChanged`). */
export async function detectBenefitOverlapsHook(tx: Tx, ctx: WriteContext, change: BenefitKeysChange): Promise<void> {
  await detectBenefitOverlaps(tx, ctx, change.after);
}

// Registered once, at module load (an ES module is evaluated once, however many apps register the routes).
if (!onBenefitKeysChanged.includes(detectBenefitOverlapsHook)) onBenefitKeysChanged.push(detectBenefitOverlapsHook);

// ------------------------------------------------------------------------------------------------ user-raised warning

async function benefitOf(tx: Tx, transformationId: string, benefitId: string, pointer: string): Promise<BenefitRow> {
  const row = await tx
    .selectFrom("benefit")
    .selectAll()
    .where("id", "=", benefitId)
    .where("transformation_id", "=", transformationId)
    .forShare()
    .executeTakeFirst();
  if (!row)
    throw new HttpProblem({
      status: 422,
      type: "urn:mth:problem:validation",
      code: "validation.reference",
      title: "Business rule violated",
      detail: "The referenced record does not exist in this transformation.",
      errors: [{ pointer, code: "validation.reference", message: "No benefit with this id in this transformation." }],
    });
  return row;
}

async function createUserOverlap(tx: Tx, ctx: WriteContext, body: z.infer<typeof benefitOverlapCreate>) {
  if (body.benefitAId.toLowerCase() === body.benefitBId.toLowerCase()) throw overlapRefusals.sameBenefit();
  const a = await benefitOf(tx, ctx.transformationId, body.benefitAId, "/benefitAId");
  const b = await benefitOf(tx, ctx.transformationId, body.benefitBId, "/benefitBId");
  if (a.status !== "active" || b.status !== "active") throw archivedBenefit();
  if (a.driver_key !== null && a.driver_key === b.driver_key) await lockDriver(tx, ctx.transformationId, a.driver_key);
  const window = windowIntersection(keysOf(a), keysOf(b));
  const row = await raiseOverlap(tx, ctx, {
    a,
    b,
    dimensions: body.dimensions,
    start: window?.start ?? null,
    end: window?.end ?? null,
    detectedBy: "user",
  });
  if (row === null) throw overlapRefusals.alreadyOpen();
  return row;
}

// ------------------------------------------------------------------------------------------------ resolution

const overlapParams = z.strictObject({ transformationId: z.uuid(), benefitOverlapId: z.uuid() });

/**
 * Finance resolution (ADR-0029 §7). Order: 403 (finance.validate held nowhere), 404, commit-time write gate, 400,
 * If-Match (428/409), 422 not_open, 403 resolver_is_owner, then the duplicate's excluded benefit and the note (422).
 * Closes the warning's open Finance tasks in the same transaction.
 */
async function resolveOverlap(tx: Tx, request: FastifyRequest): Promise<BenefitOverlapRow> {
  const { transformationId, benefitOverlapId } = parse(overlapParams, request.params, "params");
  const ctx = await openBenefitWrite(tx, request, transformationId, FINANCE_VALIDATE);
  const body = parseBody(benefitOverlapResolve, request.body);
  const expected = requireIfMatch(request);
  const current = await tx
    .selectFrom("benefit_overlap")
    .selectAll()
    .where("id", "=", benefitOverlapId)
    .where("transformation_id", "=", transformationId)
    .forUpdate()
    .executeTakeFirst();
  if (!current) throw problems.notFound();
  if (current.version !== expected) throw problems.versionConflict(current.version);
  if (current.status !== "open") throw overlapRefusals.notOpen();
  const owners = await tx
    .selectFrom("benefit")
    .select("owner_user_id")
    .where("id", "in", [current.benefit_a_id, current.benefit_b_id])
    .execute();
  if (owners.some((o) => o.owner_user_id === ctx.userId)) throw overlapRefusals.resolverIsOwner();
  const pair = [current.benefit_a_id, current.benefit_b_id];
  const excluded = body.excludedBenefitId?.toLowerCase();
  if (body.resolution === "duplicate" ? excluded === undefined || !pair.includes(excluded) : excluded !== undefined)
    throw overlapRefusals.excludedRequired();
  if (body.note === undefined) throw overlapRefusals.noteRequired();
  const now = sql<Date>`now()`;
  const updated = await tx
    .updateTable("benefit_overlap")
    .set({
      status: "resolved",
      resolution: body.resolution,
      excluded_benefit_id: body.resolution === "duplicate" ? excluded! : null,
      resolution_note: body.note,
      resolved_by: ctx.userId,
      resolved_at: now,
      version: current.version + 1,
      updated_at: now,
      updated_by: ctx.userId,
    })
    .where("id", "=", current.id)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: "benefit_overlap.resolve",
    recordType: "benefit_overlap",
    recordId: current.id,
    organizationId: ctx.organizationId,
    transformationId,
    priorVersion: current.version,
    newVersion: updated.version,
    changes: diffFields(current, updated, [...OVERLAP_AUDIT_FIELDS]),
    reason: body.note,
  });
  await closeWorkItemsOfSubject(
    tx,
    { actorType: "user", actorUserId: ctx.userId, requestId: ctx.audit.requestId, source: "api" },
    {
      organizationId: ctx.organizationId,
      subjectType: "benefit_overlap",
      subjectId: current.id,
      kinds: [OVERLAP_TASK_KIND],
    },
    "done",
  );
  return updated;
}

// ------------------------------------------------------------------------------------------------ routes

const listQuery = benefitOverlapStatusQuery.extend({ cursor: cursorSchema, limit: limitSchema });

export function registerBenefitOverlapRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  const read = { access: { permission: "transformation.read" as const } };

  app.get(OVERLAPS, { config: read }, async (request) => {
    const transformationId = parseTransformationParam(request.params);
    const query = parseQuery(listQuery, request.query);
    await requireTransformationRead(db, principalOf(request), transformationId);
    const hash = filterHash({ table: "benefit_overlap", transformationId, status: query.status ?? null });
    const after = decodeCursor(query.cursor, hash, 2);
    let q = db.selectFrom("benefit_overlap").selectAll().where("transformation_id", "=", transformationId);
    if (query.status !== undefined) q = q.where("status", "=", query.status);
    // Open first ("open" < "resolved"), then by id; the cursor carries both keys.
    if (after) {
      const [status, id] = [String(after[0]), String(after[1])];
      q = q.where((eb) => eb.or([eb("status", ">", status), eb.and([eb("status", "=", status), eb("id", ">", id)])]));
    }
    const rows = await q
      .orderBy("status")
      .orderBy("id")
      .limit(query.limit + 1)
      .execute();
    const page = paginate(rows, query.limit, (r) => [r.status, r.id], hash);
    return { items: page.items.map(toOverlap), nextCursor: page.nextCursor };
  });

  app.post(
    OVERLAPS,
    { config: { access: { permission: BENEFIT_EDIT }, consumes: JSON_BODY } },
    async (request, reply) => {
      const transformationId = parseTransformationParam(request.params);
      const result = await db.transaction().execute(async (tx) => {
        const ctx = await openBenefitWrite(tx, request, transformationId, BENEFIT_EDIT);
        const body = parseBody(benefitOverlapCreate, request.body);
        return maybeIdempotent(tx, request, ctx.userId, body, async () => ({
          status: 201,
          body: toOverlap(await createUserOverlap(tx, ctx, body)),
        }));
      });
      return sendCreated(request, reply, result);
    },
  );

  app.get(OVERLAP_ITEM, { config: read }, async (request, reply) => {
    const { transformationId, benefitOverlapId } = parse(overlapParams, request.params, "params");
    await requireTransformationRead(db, principalOf(request), transformationId);
    const row = await db
      .selectFrom("benefit_overlap")
      .selectAll()
      .where("id", "=", benefitOverlapId)
      .where("transformation_id", "=", transformationId)
      .executeTakeFirst();
    if (!row) throw problems.notFound();
    return sendVersioned(reply, 200, toOverlap(row));
  });

  app.post(
    OVERLAP_RESOLVE,
    { config: { access: { permission: FINANCE_VALIDATE }, consumes: JSON_BODY } },
    async (request, reply) => {
      const row = await db.transaction().execute((tx) => resolveOverlap(tx, request));
      return sendVersioned(reply, 200, toOverlap(row));
    },
  );

  return [`GET ${OVERLAPS}`, `POST ${OVERLAPS}`, `GET ${OVERLAP_ITEM}`, `POST ${OVERLAP_RESOLVE}`];
}
