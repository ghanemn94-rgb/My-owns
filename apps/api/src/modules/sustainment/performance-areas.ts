// Performance areas that outlive their transformation, their KPI and benefit links, and their append-only cycle history
// (P4 slice G; ADR-0034 §4, §9, §10, §12; T-DG4-BE-I; REQ-S03-002 (areas), REQ-S11-009):
//   GET  /transformations/{t}/performance-areas                                   list (transformation.read)
//   POST /transformations/{t}/performance-areas                                   create, establishing, cycle 1
//                                                                                 (performance_area.manage; BO, TO)
//   GET  /transformations/{t}/performance-areas/{a}                               one area with its cycles
//   PATCH /transformations/{t}/performance-areas/{a}                              name, description, BU, sponsor,
//                                                                                 review cadence (If-Match)
//   POST /transformations/{t}/performance-areas/{a}/reopen                        BAU -> reopened, cycle + 1
//                                                                                 (performance_area.reopen; BO, TL)
//   POST /transformations/{t}/performance-areas/{a}/retire                        final, with a reason
//   GET  /transformations/{t}/performance-areas/{a}/links                         the area's KPIs and benefits
//   POST /transformations/{t}/performance-areas/{a}/links                         link a KPI or a benefit
//   POST /transformations/{t}/performance-areas/{a}/links/{l}/remove              remove a link; final (If-Match)
//
// `transformationId` is the ORIGIN transformation (scope, audit, code counter). No guard here reads the transformation's
// status: after the transformation closes, the area still takes edits, links and reviews (ADR-0034 §4, Context 3);
// only an archived transformation is read-only (the DG1 register-kit rule). A reopening never overwrites anything: it
// writes the next `performance_area_cycle` row, copying the prior accepted handover and the origin transformation's
// closure as they are at that moment, and the accepted handover stays final (REQ-S11-009).
//
// Every mutation: the read gate on the request principal (an ADM-only user or an outsider gets 404, ADR-0006), then the
// write permission re-checked at commit time on the reloaded grants (AUD 403), validation, If-Match (428/409; creates
// are version 1), one audit event per changed row in the same transaction, and no remote I/O inside it (S-4). Nothing
// here is a G1-G6 business approval, and nothing touches DG0-DG7.
import { insertAuditEvent, sql, type AuditActor, type DbOrTx, type Tx } from "@mth/db";
import type { Permission } from "@mth/shared";
import {
  performanceAreaCreate,
  performanceAreaLinkCreate,
  performanceAreaUpdate,
  sustainmentReason,
  type PerformanceArea,
  type PerformanceAreaCycle,
  type PerformanceAreaLink,
  type SustainFrequency,
} from "@mth/shared/schemas";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { principalOf, requireTransformationRead, technicalAdminRefusal } from "../access/index.ts";
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
import { createWorkItemOnce } from "../tasks/index.ts";
import { assertActiveUsers, assertSameTransformation, openWrite, type WriteContext } from "../transformations/index.ts";
import { PROBLEM_TYPES } from "@mth/shared";

export const AREAS = "/api/v1/transformations/:transformationId/performance-areas";
export const AREA_ITEM = `${AREAS}/:performanceAreaId`;
export const AREA_REOPEN = `${AREA_ITEM}/reopen`;
export const AREA_RETIRE = `${AREA_ITEM}/retire`;
export const AREA_LINKS = `${AREA_ITEM}/links`;
export const AREA_LINK_REMOVE = `${AREA_LINKS}/:performanceAreaLinkId/remove`;
export const JSON_BODY = ["application/json"] as const;
export const PERFORMANCE_AREA_MANAGE = "performance_area.manage" as const;
export const PERFORMANCE_AREA_REOPEN = "performance_area.reopen" as const;
export const PERFORMANCE_REVIEW_TASK_KIND = "performance_review_due";

// ------------------------------------------------------------------------------------------------ problems (§12, S-11)

/** A 422 business rule (validation type) with one error at `pointer`; code = i18n key, detail = the exact text. */
export const sustainRule = (code: string, detail: string, pointer = "") =>
  new HttpProblem({
    status: 422,
    type: PROBLEM_TYPES.validation,
    code,
    title: "Business rule violated",
    detail,
    errors: [{ pointer, code, message: detail }],
  });

/** A 422 invalid-transition with the slice code (ADR-0034 §12 "(invalid-transition)"). */
export const sustainTransition = (code: string, detail: string) =>
  new HttpProblem({
    status: 422,
    type: PROBLEM_TYPES.invalidTransition,
    code,
    title: "Invalid transition",
    detail,
    errors: [{ pointer: "", code, message: detail }],
  });

export const AREA_RETIRED = () =>
  sustainRule("performance_area.retired", "This performance area is retired and can no longer be changed.");
export const AREA_NOT_REOPENABLE = () =>
  sustainTransition("performance_area.not_reopenable", "Only a performance area in BAU can be reopened.");
export const LINK_EXISTS = () =>
  problems.duplicate("performance_area_link.exists", "This KPI or benefit is already linked to the performance area.");
const REOPEN_REASON_REQUIRED = () =>
  problems.badRequest(
    "performance_area.reopen_reason_required",
    "A reason is required to reopen a performance area.",
    "/reason",
  );
const LINK_REMOVED = () => problems.invalidTransition("This link is removed; a removed link is final.");

/**
 * Parses a `{reason}` body; a missing, blank or too-short reason becomes the action's own 400 at `/reason` (`code`),
 * every other error (an unknown member, a wrong type) stays the generic 400.
 */
export function parseReason(body: unknown, required: () => HttpProblem): string {
  try {
    return parseBody(sustainmentReason, body).reason;
  } catch (err) {
    if (!(err instanceof HttpProblem) || err.status !== 400 || err.errors === undefined) throw err;
    if (err.errors.length > 0 && err.errors.every((e) => e.pointer === "/reason" || e.pointer === "")) {
      const hasReason = typeof body === "object" && body !== null && !Array.isArray(body);
      const unknownMember = hasReason && Object.keys(body).some((k) => k !== "reason");
      if (!unknownMember) throw required();
    }
    throw err;
  }
}

// ------------------------------------------------------------------------------------------------ params and gates

const transformationParams = z.strictObject({ transformationId: z.uuid() });
const areaParams = z.strictObject({ transformationId: z.uuid(), performanceAreaId: z.uuid() });
const linkParams = z.strictObject({
  transformationId: z.uuid(),
  performanceAreaId: z.uuid(),
  performanceAreaLinkId: z.uuid(),
});

export const parseTransformationParam = (params: unknown): string =>
  parse(transformationParams, params, "params").transformationId;
const parseAreaParams = (params: unknown) => parse(areaParams, params, "params");
const parseLinkParams = (params: unknown) => parse(linkParams, params, "params");

/**
 * The write gate of a slice G mutation: the read gate on the request's principal first (ADM-only or outsider: 404,
 * ADR-0006), then `permission` re-checked at commit time on the reloaded grants (S-4; AUD and a role without it: 403).
 * `adminRefusal` (a business-approval endpoint, REQ-S10-003): a technical-admin-only caller gets 403, not 404.
 */
export async function openSustainmentWrite(
  tx: Tx,
  request: FastifyRequest,
  transformationId: string,
  permission: Permission,
  adminRefusal?: Permission,
): Promise<WriteContext> {
  const principal = principalOf(request);
  try {
    await requireTransformationRead(tx, principal, transformationId);
  } catch (err) {
    throw adminRefusal === undefined ? err : technicalAdminRefusal(principal, err, adminRefusal);
  }
  return openWrite(tx, request, transformationId, [{ permission }], null, {
    atCommit: true,
    ...(adminRefusal !== undefined ? { technicalAdminRefusal: adminRefusal } : {}),
  });
}

/** The user audit actor of a request's write context (for the shared @mth/db writers). */
export const userActor = (ctx: WriteContext): AuditActor => ({
  actorType: "user",
  actorUserId: ctx.userId,
  requestId: ctx.audit.requestId,
  source: "api",
});

/** Transaction-scoped lock class bauHandover on the area (ADR-0034 §10): handover writes and reopening. */
export async function lockAreaHandover(tx: Tx, performanceAreaId: string): Promise<void> {
  await sql`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK_CLASSES.bauHandover}::int4, hashtext(${performanceAreaId}))`.execute(
    tx,
  );
}

/** PA-01 / HO-01 from record_code_counter; a concurrent allocation serialises on the counter row. */
export async function nextSustainmentCode(tx: Tx, transformationId: string, prefix: "PA" | "HO"): Promise<string> {
  const row = await sql<{ last_value: number }>`
    INSERT INTO record_code_counter (transformation_id, prefix, last_value) VALUES (${transformationId}::uuid, ${prefix}, 1)
    ON CONFLICT (transformation_id, prefix) DO UPDATE SET last_value = record_code_counter.last_value + 1
    RETURNING last_value`.execute(tx);
  return `${prefix}-${String(row.rows[0]!.last_value).padStart(2, "0")}`;
}

/** A `date` column as YYYY-MM-DD (or null). */
export const dateOrNull = (d: unknown): string | null =>
  d === null || d === undefined ? null : String(d).slice(0, 10);

/** Calendar months of one review period (weekly is counted in weeks). */
const PERIOD_MONTHS: ReadonlyMap<SustainFrequency, number> = new Map([
  ["weekly", 0],
  ["monthly", 1],
  ["quarterly", 3],
  ["semi_annual", 6],
  ["annual", 12],
]);

/**
 * The organization's business date today plus one review period (`frequency` x `interval`; calendar weeks or months,
 * never working days; ADR-0034 §5) in the organization's default calendar timezone, else its default timezone.
 */
export async function businessDatePlusPeriod(
  db: DbOrTx,
  organizationId: string,
  frequency: SustainFrequency,
  interval: number,
): Promise<string> {
  const months = (PERIOD_MONTHS.get(frequency) ?? 0) * interval;
  const weeks = frequency === "weekly" ? interval : 0;
  const r = await sql<{ d: string }>`
    SELECT (p4_business_date(now(), coalesce(
      (SELECT c.timezone FROM business_calendar c
        WHERE c.organization_id = ${organizationId}::uuid AND c.is_default AND c.status = 'active' LIMIT 1),
      (SELECT o.default_timezone FROM organization o WHERE o.id = ${organizationId}::uuid)))
      + make_interval(months => ${months}::int, weeks => ${weeks}::int))::date::text AS d`.execute(db);
  return r.rows[0]!.d;
}

// ------------------------------------------------------------------------------------------------ rows and presenters

interface AreaRow {
  id: string;
  organization_id: string;
  transformation_id: string;
  code: string;
  name: string;
  description: string | null;
  business_unit_id: string | null;
  sponsor_user_id: string | null;
  bau_owner_user_id: string | null;
  kpi_owner_user_id: string | null;
  review_frequency: string;
  review_interval: number;
  next_review_date: string | null;
  cycle_no: number;
  status: string;
  current_handover_id: string | null;
  retired_at: Date | string | null;
  retired_by: string | null;
  retire_reason: string | null;
  version: number;
  created_at: Date | string;
  created_by: string;
  updated_at: Date | string;
  updated_by: string | null;
}

/** The fields of a performance_area change recorded in the audit diff. */
const AREA_AUDIT_FIELDS = [
  "code",
  "name",
  "description",
  "business_unit_id",
  "sponsor_user_id",
  "bau_owner_user_id",
  "kpi_owner_user_id",
  "review_frequency",
  "review_interval",
  "next_review_date",
  "cycle_no",
  "status",
  "current_handover_id",
  "retire_reason",
] as const;

/** The audit diff of two area rows (dates as YYYY-MM-DD, so an unchanged date is no change). */
export function areaChanges(before: Partial<AreaRow>, after: AreaRow): Record<string, { from: unknown; to: unknown }> {
  const b = new Map(Object.entries(before));
  const a = new Map(Object.entries(after));
  const out = new Map<string, { from: unknown; to: unknown }>();
  for (const f of AREA_AUDIT_FIELDS) {
    const norm = (v: unknown) => (f === "next_review_date" ? dateOrNull(v) : (v ?? null));
    const from = norm(b.get(f));
    const to = norm(a.get(f));
    if (from !== to) out.set(f, { from, to });
  }
  return Object.fromEntries(out);
}

const toCycle = (c: {
  cycle_no: number;
  opened_at: Date | string;
  opened_by: string;
  reopen_reason: string | null;
  prior_handover_id: string | null;
  prior_handover_accepted_at: Date | string | null;
  prior_handover_accepted_by: string | null;
  prior_closure_record_id: string | null;
  prior_closed_at: Date | string | null;
}): PerformanceAreaCycle => ({
  cycleNo: c.cycle_no,
  openedAt: iso(c.opened_at as Date),
  openedBy: c.opened_by,
  reopenReason: c.reopen_reason,
  priorHandoverId: c.prior_handover_id,
  priorHandoverAcceptedAt: isoOrNull(c.prior_handover_accepted_at as Date | null),
  priorHandoverAcceptedBy: c.prior_handover_accepted_by,
  priorClosureRecordId: c.prior_closure_record_id,
  priorClosedAt: isoOrNull(c.prior_closed_at as Date | null),
});

export async function presentAreas(db: DbOrTx, rows: readonly AreaRow[]): Promise<PerformanceArea[]> {
  const cycles =
    rows.length === 0
      ? []
      : await db
          .selectFrom("performance_area_cycle")
          .selectAll()
          .where(
            "performance_area_id",
            "in",
            rows.map((r) => r.id),
          )
          .orderBy("cycle_no")
          .execute();
  return rows.map((r) => ({
    id: r.id,
    transformationId: r.transformation_id,
    code: r.code,
    name: r.name,
    description: r.description,
    businessUnitId: r.business_unit_id,
    sponsorUserId: r.sponsor_user_id,
    reviewFrequency: r.review_frequency as SustainFrequency,
    reviewInterval: r.review_interval,
    bauOwnerUserId: r.bau_owner_user_id,
    kpiOwnerUserId: r.kpi_owner_user_id,
    nextReviewDate: dateOrNull(r.next_review_date),
    cycleNo: r.cycle_no,
    status: r.status as PerformanceArea["status"],
    currentHandoverId: r.current_handover_id,
    cycles: cycles.filter((c) => c.performance_area_id === r.id).map(toCycle),
    retiredAt: isoOrNull(r.retired_at as Date | null),
    retireReason: r.retire_reason,
    version: r.version,
    createdAt: iso(r.created_at as Date),
    createdBy: r.created_by,
    updatedAt: iso(r.updated_at as Date),
    updatedBy: r.updated_by,
  }));
}

/** One area of the transformation (optionally FOR UPDATE), or 404. */
export async function findArea(db: DbOrTx, transformationId: string, id: string, lock = false): Promise<AreaRow> {
  let q = db
    .selectFrom("performance_area")
    .selectAll()
    .where("id", "=", id)
    .where("transformation_id", "=", transformationId);
  if (lock) q = q.forUpdate();
  const row = await q.executeTakeFirst();
  if (!row) throw problems.notFound();
  return row as AreaRow;
}

async function presentArea(db: DbOrTx, transformationId: string, id: string): Promise<PerformanceArea> {
  return (await presentAreas(db, [await findArea(db, transformationId, id)]))[0]!;
}

interface LinkRow {
  id: string;
  transformation_id: string;
  performance_area_id: string;
  link_kind: string;
  kpi_definition_id: string | null;
  benefit_id: string | null;
  status: string;
  removed_at: Date | string | null;
  removed_by: string | null;
  version: number;
  created_at: Date | string;
  created_by: string;
  updated_at: Date | string;
  updated_by: string;
}

const toLink = (r: LinkRow): PerformanceAreaLink => ({
  id: r.id,
  transformationId: r.transformation_id,
  performanceAreaId: r.performance_area_id,
  linkKind: r.link_kind as PerformanceAreaLink["linkKind"],
  kpiDefinitionId: r.kpi_definition_id,
  benefitId: r.benefit_id,
  status: r.status as PerformanceAreaLink["status"],
  removedAt: isoOrNull(r.removed_at as Date | null),
  removedBy: r.removed_by,
  version: r.version,
  createdAt: iso(r.created_at as Date),
  createdBy: r.created_by,
  updatedAt: iso(r.updated_at as Date),
  updatedBy: r.updated_by,
});

const LINK_AUDIT_FIELDS = ["link_kind", "kpi_definition_id", "benefit_id", "status"] as const;
const linkChanges = (before: Partial<LinkRow>, after: LinkRow) => {
  const b = new Map(Object.entries(before));
  const a = new Map(Object.entries(after));
  return Object.fromEntries(
    LINK_AUDIT_FIELDS.filter((f) => (b.get(f) ?? null) !== (a.get(f) ?? null)).map((f) => [
      f,
      { from: b.get(f) ?? null, to: a.get(f) ?? null },
    ]),
  );
};

// ------------------------------------------------------------------------------------------------ the first review

export interface ScheduledReview {
  readonly outcome: "created" | "existing";
  readonly reviewId: string;
}

const SERVICE_ACTOR: AuditActor = { actorType: "service", actorUserId: null, source: "worker" };

/**
 * Schedules the area review due on `dueDate` exactly once (ADR-0034 §5, §6): inserts the `sustainment_review` of
 * subject `performance_area` (the area's current cycle, assignee its BAU owner) if absent on `sustainment_review_due_key`,
 * with its audit event and its `performance_review_due` work item (dedupe `sustainment.review:<areaId>:<dueDate>`).
 * A second call for the same area and due date creates nothing and returns `existing`. The area must be in BAU (the
 * database refuses a review otherwise, `sustainment_review_area_bau`). `actor` defaults to the service actor of a job
 * (source worker, S-13); the API passes the acting user. Used by acceptBauHandover (the first review) and by BE-I2's
 * `sustainment.review_scan` (the next ones).
 */
export async function scheduleAreaReview(
  tx: Tx,
  areaId: string,
  dueDate: string,
  actor: AuditActor = SERVICE_ACTOR,
): Promise<ScheduledReview> {
  const area = await tx
    .selectFrom("performance_area")
    .select(["id", "organization_id", "transformation_id", "code", "cycle_no", "bau_owner_user_id"])
    .where("id", "=", areaId)
    .executeTakeFirstOrThrow();
  if (area.bau_owner_user_id === null) throw new Error(`scheduleAreaReview: area ${areaId} has no BAU owner`);
  const byUser = actor.actorType === "user" ? actor.actorUserId : null;
  const id = uuidv7();
  const inserted = await sql<{ id: string }>`
    INSERT INTO sustainment_review (id, organization_id, transformation_id, subject_kind, performance_area_id, cycle_no,
                                    due_date, assignee_user_id, created_source, created_by, updated_by)
    VALUES (${id}::uuid, ${area.organization_id}::uuid, ${area.transformation_id}::uuid, 'performance_area',
            ${area.id}::uuid, ${area.cycle_no}, ${dueDate}::date, ${area.bau_owner_user_id}::uuid,
            ${byUser === null ? "worker" : "api"}, ${byUser}::uuid, ${byUser}::uuid)
    ON CONFLICT (subject_kind, (coalesce(performance_area_id, transition_decision_id)), due_date) DO NOTHING
    RETURNING id`.execute(tx);
  if (inserted.rows.length === 0) {
    const existing = await tx
      .selectFrom("sustainment_review")
      .select("id")
      .where("subject_kind", "=", "performance_area")
      .where("performance_area_id", "=", area.id)
      .where("due_date", "=", dueDate)
      .executeTakeFirstOrThrow();
    return { outcome: "existing", reviewId: existing.id };
  }
  await insertAuditEvent(tx, actor, {
    action: "sustainment_review.create",
    recordType: "sustainment_review",
    recordId: id,
    organizationId: area.organization_id,
    transformationId: area.transformation_id,
    newVersion: 1,
    changes: {
      subject_kind: { from: null, to: "performance_area" },
      performance_area_id: { from: null, to: area.id },
      cycle_no: { from: null, to: area.cycle_no },
      due_date: { from: null, to: dueDate },
      assignee_user_id: { from: null, to: area.bau_owner_user_id },
    },
  });
  await createWorkItemOnce(tx, actor, {
    organizationId: area.organization_id,
    transformationId: area.transformation_id,
    kind: PERFORMANCE_REVIEW_TASK_KIND,
    assigneeUserId: area.bau_owner_user_id,
    subjectType: "sustainment_review",
    subjectId: id,
    linkPath: `/transformations/${area.transformation_id}/performance-areas/${area.id}`,
    messageKey: "sustainment.task.performance_review_due",
    messageParams: { areaCode: area.code, dueDate },
    dueDate,
    dedupeKey: `sustainment.review:${area.id}:${dueDate}`,
  });
  return { outcome: "created", reviewId: id };
}

// ------------------------------------------------------------------------------------------------ writes

/** A business unit of the organization (null passes); otherwise 422 validation.reference at `pointer`. */
async function assertBusinessUnit(tx: Tx, organizationId: string, id: string | null | undefined): Promise<void> {
  if (id === null || id === undefined) return;
  const row = await tx
    .selectFrom("business_unit")
    .select("id")
    .where("id", "=", id)
    .where("organization_id", "=", organizationId)
    .executeTakeFirst();
  if (!row)
    throw sustainRule(
      "validation.reference",
      "The referenced record does not exist in this transformation.",
      "/businessUnitId",
    );
}

async function createArea(tx: Tx, request: FastifyRequest): Promise<string> {
  const transformationId = parseTransformationParam(request.params);
  const ctx = await openSustainmentWrite(tx, request, transformationId, PERFORMANCE_AREA_MANAGE);
  const body = parseBody(performanceAreaCreate, request.body);
  await assertBusinessUnit(tx, ctx.organizationId, body.businessUnitId);
  await assertActiveUsers(tx, ctx.organizationId, [{ id: body.sponsorUserId, pointer: "/sponsorUserId" }]);
  const id = uuidv7();
  const row = (await tx
    .insertInto("performance_area")
    .values({
      id,
      organization_id: ctx.organizationId,
      transformation_id: transformationId,
      code: await nextSustainmentCode(tx, transformationId, "PA"),
      name: body.name,
      description: body.description ?? null,
      business_unit_id: body.businessUnitId ?? null,
      sponsor_user_id: body.sponsorUserId ?? null,
      ...(body.reviewFrequency !== undefined ? { review_frequency: body.reviewFrequency } : {}),
      ...(body.reviewInterval !== undefined ? { review_interval: body.reviewInterval } : {}),
      created_by: ctx.userId,
      updated_by: ctx.userId,
    })
    .returningAll()
    .executeTakeFirstOrThrow()) as AreaRow;
  await record(tx, ctx.audit, {
    action: "performance_area.create",
    recordType: "performance_area",
    recordId: id,
    organizationId: ctx.organizationId,
    transformationId,
    newVersion: row.version,
    changes: areaChanges({}, row),
  });
  // Cycle 1 (the deferred trigger performance_area_cycle_present refuses an area without its current cycle's row).
  const cycleId = uuidv7();
  await tx
    .insertInto("performance_area_cycle")
    .values({
      id: cycleId,
      organization_id: ctx.organizationId,
      transformation_id: transformationId,
      performance_area_id: id,
      cycle_no: 1,
      opened_by: ctx.userId,
      created_by: ctx.userId,
    })
    .execute();
  await record(tx, ctx.audit, {
    action: "performance_area_cycle.create",
    recordType: "performance_area_cycle",
    recordId: cycleId,
    organizationId: ctx.organizationId,
    transformationId,
    changes: { performance_area_id: { from: null, to: id }, cycle_no: { from: null, to: 1 } },
  });
  return id;
}

async function updateArea(tx: Tx, request: FastifyRequest): Promise<void> {
  const { transformationId, performanceAreaId } = parseAreaParams(request.params);
  const ctx = await openSustainmentWrite(tx, request, transformationId, PERFORMANCE_AREA_MANAGE);
  const body = parseBody(performanceAreaUpdate, request.body);
  const expected = requireIfMatch(request);
  const current = await findArea(tx, transformationId, performanceAreaId, true);
  if (current.version !== expected) throw problems.versionConflict(current.version);
  if (current.status === "retired") throw AREA_RETIRED();
  await assertBusinessUnit(tx, ctx.organizationId, body.businessUnitId);
  await assertActiveUsers(tx, ctx.organizationId, [{ id: body.sponsorUserId, pointer: "/sponsorUserId" }]);
  const updated = (await tx
    .updateTable("performance_area")
    .set({
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.businessUnitId !== undefined ? { business_unit_id: body.businessUnitId } : {}),
      ...(body.sponsorUserId !== undefined ? { sponsor_user_id: body.sponsorUserId } : {}),
      ...(body.reviewFrequency !== undefined ? { review_frequency: body.reviewFrequency } : {}),
      ...(body.reviewInterval !== undefined ? { review_interval: body.reviewInterval } : {}),
      version: sql<number>`version + 1`,
      updated_at: sql<Date>`now()`,
      updated_by: ctx.userId,
    })
    .where("id", "=", current.id)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow()) as AreaRow;
  await record(tx, ctx.audit, {
    action: "performance_area.update",
    recordType: "performance_area",
    recordId: current.id,
    organizationId: ctx.organizationId,
    transformationId,
    priorVersion: current.version,
    newVersion: updated.version,
    changes: areaChanges(current, updated),
  });
}

async function retireArea(tx: Tx, request: FastifyRequest): Promise<void> {
  const { transformationId, performanceAreaId } = parseAreaParams(request.params);
  const ctx = await openSustainmentWrite(tx, request, transformationId, PERFORMANCE_AREA_MANAGE);
  const { reason } = parseBody(sustainmentReason, request.body);
  const expected = requireIfMatch(request);
  const current = await findArea(tx, transformationId, performanceAreaId, true);
  if (current.version !== expected) throw problems.versionConflict(current.version);
  if (current.status === "retired") throw AREA_RETIRED();
  const updated = (await tx
    .updateTable("performance_area")
    .set({
      status: "retired",
      retired_at: sql<Date>`now()`,
      retired_by: ctx.userId,
      retire_reason: reason,
      version: sql<number>`version + 1`,
      updated_at: sql<Date>`now()`,
      updated_by: ctx.userId,
    })
    .where("id", "=", current.id)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow()) as AreaRow;
  await record(tx, ctx.audit, {
    action: "performance_area.retire",
    recordType: "performance_area",
    recordId: current.id,
    organizationId: ctx.organizationId,
    transformationId,
    priorVersion: current.version,
    newVersion: updated.version,
    reason,
    changes: areaChanges(current, updated),
  });
}

/**
 * REQ-S11-009: reopening a deteriorating area in BAU writes the next cycle and overwrites nothing. Under lock class
 * bauHandover on the area: the new `performance_area_cycle` row copies the prior cycle's accepted handover (id,
 * acceptance time and acceptor) and the origin transformation's closure (id and time) as they are now; the area moves
 * to `reopened` with `cycle_no + 1`, keeps `current_handover_id` on the prior accepted handover until a new one is
 * accepted, and its next review date becomes "not scheduled" (NULL) until then (ADR-0034 §4, §11).
 */
async function reopenArea(tx: Tx, request: FastifyRequest): Promise<void> {
  const { transformationId, performanceAreaId } = parseAreaParams(request.params);
  const ctx = await openSustainmentWrite(tx, request, transformationId, PERFORMANCE_AREA_REOPEN);
  const reason = parseReason(request.body, REOPEN_REASON_REQUIRED);
  const expected = requireIfMatch(request);
  await findArea(tx, transformationId, performanceAreaId);
  await lockAreaHandover(tx, performanceAreaId);
  const current = await findArea(tx, transformationId, performanceAreaId, true);
  if (current.version !== expected) throw problems.versionConflict(current.version);
  if (current.status === "retired") throw AREA_RETIRED();
  if (current.status !== "bau" || current.current_handover_id === null) throw AREA_NOT_REOPENABLE();
  const prior = await tx
    .selectFrom("bau_handover")
    .select(["id", "accepted_at", "accepted_by"])
    .where("id", "=", current.current_handover_id)
    .where("status", "=", "accepted")
    .executeTakeFirstOrThrow();
  const closure = await tx
    .selectFrom("closure_record")
    .select(["id", "closed_at"])
    .where("transformation_id", "=", transformationId)
    .where("subject_kind", "=", "transformation")
    .executeTakeFirst();
  const cycleNo = current.cycle_no + 1;
  const cycleId = uuidv7();
  await tx
    .insertInto("performance_area_cycle")
    .values({
      id: cycleId,
      organization_id: ctx.organizationId,
      transformation_id: transformationId,
      performance_area_id: current.id,
      cycle_no: cycleNo,
      opened_by: ctx.userId,
      reopen_reason: reason,
      prior_handover_id: prior.id,
      prior_handover_accepted_at: prior.accepted_at,
      prior_handover_accepted_by: prior.accepted_by,
      prior_closure_record_id: closure?.id ?? null,
      prior_closed_at: closure?.closed_at ?? null,
      created_by: ctx.userId,
    })
    .execute();
  await record(tx, ctx.audit, {
    action: "performance_area_cycle.create",
    recordType: "performance_area_cycle",
    recordId: cycleId,
    organizationId: ctx.organizationId,
    transformationId,
    reason,
    changes: {
      performance_area_id: { from: null, to: current.id },
      cycle_no: { from: null, to: cycleNo },
      prior_handover_id: { from: null, to: prior.id },
      prior_closure_record_id: { from: null, to: closure?.id ?? null },
    },
  });
  const updated = (await tx
    .updateTable("performance_area")
    .set({
      status: "reopened",
      cycle_no: cycleNo,
      next_review_date: null,
      version: sql<number>`version + 1`,
      updated_at: sql<Date>`now()`,
      updated_by: ctx.userId,
    })
    .where("id", "=", current.id)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow()) as AreaRow;
  await record(tx, ctx.audit, {
    action: "performance_area.reopen",
    recordType: "performance_area",
    recordId: current.id,
    organizationId: ctx.organizationId,
    transformationId,
    priorVersion: current.version,
    newVersion: updated.version,
    reason,
    changes: areaChanges(current, updated),
  });
}

async function findLink(tx: DbOrTx, areaId: string, linkId: string, lock = false): Promise<LinkRow> {
  let q = tx
    .selectFrom("performance_area_link")
    .selectAll()
    .where("id", "=", linkId)
    .where("performance_area_id", "=", areaId);
  if (lock) q = q.forUpdate();
  const row = await q.executeTakeFirst();
  if (!row) throw problems.notFound();
  return row as LinkRow;
}

async function createLink(tx: Tx, request: FastifyRequest): Promise<{ areaId: string; linkId: string }> {
  const { transformationId, performanceAreaId } = parseAreaParams(request.params);
  const ctx = await openSustainmentWrite(tx, request, transformationId, PERFORMANCE_AREA_MANAGE);
  const body = parseBody(performanceAreaLinkCreate, request.body);
  const area = await findArea(tx, transformationId, performanceAreaId, true);
  if (area.status === "retired") throw AREA_RETIRED();
  const targetId = (body.linkKind === "kpi" ? body.kpiDefinitionId : body.benefitId)!;
  if (body.linkKind === "kpi")
    await assertSameTransformation(tx, "kpi_definition", transformationId, targetId, "/kpiDefinitionId");
  else await assertSameTransformation(tx, "benefit", transformationId, targetId, "/benefitId");
  const existing = await tx
    .selectFrom("performance_area_link")
    .select("id")
    .where("performance_area_id", "=", area.id)
    .where("status", "=", "active")
    .where(body.linkKind === "kpi" ? "kpi_definition_id" : "benefit_id", "=", targetId)
    .executeTakeFirst();
  if (existing) throw LINK_EXISTS();
  const id = uuidv7();
  const row = (await tx
    .insertInto("performance_area_link")
    .values({
      id,
      organization_id: ctx.organizationId,
      transformation_id: transformationId,
      performance_area_id: area.id,
      link_kind: body.linkKind,
      kpi_definition_id: body.linkKind === "kpi" ? targetId : null,
      benefit_id: body.linkKind === "benefit" ? targetId : null,
      created_by: ctx.userId,
      updated_by: ctx.userId,
    })
    .returningAll()
    .executeTakeFirstOrThrow()) as LinkRow;
  await record(tx, ctx.audit, {
    action: "performance_area_link.create",
    recordType: "performance_area_link",
    recordId: id,
    organizationId: ctx.organizationId,
    transformationId,
    newVersion: row.version,
    changes: { performance_area_id: { from: null, to: area.id }, ...linkChanges({}, row) },
  });
  return { areaId: area.id, linkId: id };
}

async function removeLink(tx: Tx, request: FastifyRequest): Promise<void> {
  const { transformationId, performanceAreaId, performanceAreaLinkId } = parseLinkParams(request.params);
  const ctx = await openSustainmentWrite(tx, request, transformationId, PERFORMANCE_AREA_MANAGE);
  const expected = requireIfMatch(request);
  const area = await findArea(tx, transformationId, performanceAreaId);
  const current = await findLink(tx, area.id, performanceAreaLinkId, true);
  if (current.version !== expected) throw problems.versionConflict(current.version);
  if (area.status === "retired") throw AREA_RETIRED();
  if (current.status === "removed") throw LINK_REMOVED();
  const updated = (await tx
    .updateTable("performance_area_link")
    .set({
      status: "removed",
      removed_at: sql<Date>`now()`,
      removed_by: ctx.userId,
      version: sql<number>`version + 1`,
      updated_at: sql<Date>`now()`,
      updated_by: ctx.userId,
    })
    .where("id", "=", current.id)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow()) as LinkRow;
  await record(tx, ctx.audit, {
    action: "performance_area_link.remove",
    recordType: "performance_area_link",
    recordId: current.id,
    organizationId: ctx.organizationId,
    transformationId,
    priorVersion: current.version,
    newVersion: updated.version,
    changes: linkChanges(current, updated),
  });
}

// ------------------------------------------------------------------------------------------------ routes

const listQuery = z.strictObject({
  cursor: cursorSchema,
  limit: limitSchema,
  status: z.enum(["establishing", "bau", "reopened", "retired"]).optional(),
});
const pageQuery = z.strictObject({ cursor: cursorSchema, limit: limitSchema });

/** Registers this file's routes and returns them as "METHOD /path". */
export function registerPerformanceAreaRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  const read = { access: { permission: "transformation.read" as const } };
  const manage = { access: { permission: PERFORMANCE_AREA_MANAGE }, consumes: JSON_BODY };
  const manageBodiless = { access: { permission: PERFORMANCE_AREA_MANAGE } };
  const reopen = { access: { permission: PERFORMANCE_AREA_REOPEN }, consumes: JSON_BODY };

  app.get(AREAS, { config: read }, async (request) => {
    const transformationId = parseTransformationParam(request.params);
    const query = parseQuery(listQuery, request.query);
    await requireTransformationRead(db, principalOf(request), transformationId);
    const hash = filterHash({ table: "performance_area", transformationId, status: query.status ?? null });
    const after = decodeCursor(query.cursor, hash, 1);
    let q = db.selectFrom("performance_area").selectAll().where("transformation_id", "=", transformationId);
    if (query.status !== undefined) q = q.where("status", "=", query.status);
    if (after) q = q.where("id", ">", String(after[0]));
    const rows = (await q
      .orderBy("id")
      .limit(query.limit + 1)
      .execute()) as AreaRow[];
    const page = paginate(rows, query.limit, (r) => [r.id], hash);
    return { items: await presentAreas(db, page.items), nextCursor: page.nextCursor };
  });

  app.post(AREAS, { config: manage }, async (request, reply) => {
    const transformationId = parseTransformationParam(request.params);
    const body = await db.transaction().execute(async (tx) => {
      const id = await createArea(tx, request);
      return presentArea(tx, transformationId, id);
    });
    return sendVersioned(reply, 201, body, `${request.url.split("?")[0]!}/${body.id}`);
  });

  app.get(AREA_ITEM, { config: read }, async (request, reply) => {
    const { transformationId, performanceAreaId } = parseAreaParams(request.params);
    await requireTransformationRead(db, principalOf(request), transformationId);
    return sendVersioned(reply, 200, await presentArea(db, transformationId, performanceAreaId));
  });

  app.patch(AREA_ITEM, { config: manage }, async (request, reply) => {
    const { transformationId, performanceAreaId } = parseAreaParams(request.params);
    const body = await db.transaction().execute(async (tx) => {
      await updateArea(tx, request);
      return presentArea(tx, transformationId, performanceAreaId);
    });
    return sendVersioned(reply, 200, body);
  });

  app.post(AREA_REOPEN, { config: reopen }, async (request, reply) => {
    const { transformationId, performanceAreaId } = parseAreaParams(request.params);
    const body = await db.transaction().execute(async (tx) => {
      await reopenArea(tx, request);
      return presentArea(tx, transformationId, performanceAreaId);
    });
    return sendVersioned(reply, 200, body);
  });

  app.post(AREA_RETIRE, { config: manage }, async (request, reply) => {
    const { transformationId, performanceAreaId } = parseAreaParams(request.params);
    const body = await db.transaction().execute(async (tx) => {
      await retireArea(tx, request);
      return presentArea(tx, transformationId, performanceAreaId);
    });
    return sendVersioned(reply, 200, body);
  });

  app.get(AREA_LINKS, { config: read }, async (request) => {
    const { transformationId, performanceAreaId } = parseAreaParams(request.params);
    const query = parseQuery(pageQuery, request.query);
    await requireTransformationRead(db, principalOf(request), transformationId);
    const area = await findArea(db, transformationId, performanceAreaId);
    const hash = filterHash({ table: "performance_area_link", performanceAreaId: area.id });
    const after = decodeCursor(query.cursor, hash, 1);
    let q = db.selectFrom("performance_area_link").selectAll().where("performance_area_id", "=", area.id);
    if (after) q = q.where("id", ">", String(after[0]));
    const rows = (await q
      .orderBy("id")
      .limit(query.limit + 1)
      .execute()) as LinkRow[];
    const page = paginate(rows, query.limit, (r) => [r.id], hash);
    return { items: page.items.map(toLink), nextCursor: page.nextCursor };
  });

  app.post(AREA_LINKS, { config: manage }, async (request, reply) => {
    const body = await db.transaction().execute(async (tx) => {
      const { areaId, linkId } = await createLink(tx, request);
      return toLink(await findLink(tx, areaId, linkId));
    });
    return sendVersioned(reply, 201, body, `${request.url.split("?")[0]!}/${body.id}`);
  });

  app.post(AREA_LINK_REMOVE, { config: manageBodiless }, async (request, reply) => {
    const { performanceAreaId, performanceAreaLinkId } = parseLinkParams(request.params);
    const body = await db.transaction().execute(async (tx) => {
      await removeLink(tx, request);
      return toLink(await findLink(tx, performanceAreaId, performanceAreaLinkId));
    });
    return sendVersioned(reply, 200, body);
  });

  return [
    `GET ${AREAS}`,
    `POST ${AREAS}`,
    `GET ${AREA_ITEM}`,
    `PATCH ${AREA_ITEM}`,
    `POST ${AREA_REOPEN}`,
    `POST ${AREA_RETIRE}`,
    `GET ${AREA_LINKS}`,
    `POST ${AREA_LINKS}`,
    `POST ${AREA_LINK_REMOVE}`,
  ];
}
