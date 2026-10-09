// Reporting periods (ADR-0027 §3, §11-§13; REQ-S07-003, REQ-S07-005, REQ-S12-005; T-DG4-KBE-C):
//   GET  /organizations/{o}/reporting-periods                         latest first (organization.read); frequency, status
//   POST /organizations/{o}/reporting-periods                         a scheduled period (reporting_period.manage; TO)
//   GET  /organizations/{o}/reporting-periods/{p}                     (organization.read)
//   POST /organizations/{o}/reporting-periods/{p}/open                scheduled -> open (If-Match; no body)
//   POST /organizations/{o}/reporting-periods/{p}/close               open -> closed, final in P4 (If-Match; no body)
//
// - One row per organization, frequency and label (409 reporting_period.label_taken). Periods of one organization and
//   frequency never overlap (422 reporting_period.overlap; checked here under the reportingPeriod lock class with the other period's label,
//   and again by trigger reporting_period_guard). A week-based period lasts exactly week_count x 7 days (422
//   reporting_period.weeks_invalid); a period ends on or after its start and lasts at most 367 days (422
//   reporting_period.range_invalid). Status scheduled -> open -> closed; a closed period stays closed (422
//   reporting_period.status_step). The kpi.reporting_period_open job (worker) opens due periods without this route.
// - Periods have no transformation: they are shared by every transformation of the organization.
// - Every mutation: organization read gate (404), reporting_period.manage decided on grants reloaded in the transaction
//   (commit-time authorization, 403), validation, If-Match (428/409; creates are version 1), one audit event in the same
//   transaction, no remote I/O (S-4).
import { diffFields, sql, type DbOrTx, type ReportingPeriodRow, type Tx } from "@mth/db";
import {
  KPI_FREQUENCIES,
  reportingPeriodCreate,
  REPORTING_PERIOD_STATUSES,
  type ReportingPeriod,
  type ReportingPeriodCreate,
} from "@mth/shared/schemas";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import {
  auditContextOf,
  commitTimeDenial,
  principalOf,
  refreshPrincipal,
  requireAction,
  requireRead,
} from "../access/index.ts";
import { record } from "../audit/index.ts";
import {
  ADVISORY_LOCK_CLASSES,
  cursorSchema,
  decodeCursor,
  filterHash,
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
import { ruleProblem } from "./support.ts";

const JSON_BODY = ["application/json"] as const;
const ORG_BASE = "/api/v1/organizations/:organizationId/reporting-periods";
const ITEM = `${ORG_BASE}/:reportingPeriodId`;
const READ = "organization.read" as const;
const MANAGE = "reporting_period.manage" as const;

export const REPORTING_PERIOD_AUDIT_FIELDS = [
  "frequency",
  "period_label",
  "period_start",
  "period_end",
  "basis",
  "week_count",
  "update_due_date",
  "status",
  "opened_at",
  "closed_at",
] as const satisfies readonly (keyof ReportingPeriodRow)[];

const orgParams = z.strictObject({ organizationId: z.uuid() });
const itemParams = z.strictObject({ organizationId: z.uuid(), reportingPeriodId: z.uuid() });
const listQuery = z.strictObject({
  cursor: cursorSchema,
  limit: limitSchema,
  frequency: z.enum(KPI_FREQUENCIES).optional(),
  status: z.enum(REPORTING_PERIOD_STATUSES).optional(),
});

// ------------------------------------------------------------------------------------------------ presenter

export function toReportingPeriod(r: ReportingPeriodRow): ReportingPeriod {
  return {
    id: r.id,
    organizationId: r.organization_id,
    frequency: r.frequency as ReportingPeriod["frequency"],
    periodLabel: r.period_label,
    periodStart: r.period_start,
    periodEnd: r.period_end,
    lengthDays: r.length_days,
    basis: r.basis as ReportingPeriod["basis"],
    weekCount: r.week_count,
    updateDueDate: r.update_due_date,
    status: r.status as ReportingPeriod["status"],
    openedAt: isoOrNull(r.opened_at),
    closedAt: isoOrNull(r.closed_at),
    version: r.version,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

// ------------------------------------------------------------------------------------------------ rules

/** Days between two calendar dates (YYYY-MM-DD), end minus start. */
export function daysBetween(start: string, end: string): number {
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000);
}

/** The shape rules of a new period (ADR-0027 §3, §13), in a fixed order; throws the first. */
export function checkPeriodShape(b: ReportingPeriodCreate): void {
  const span = daysBetween(b.periodStart, b.periodEnd);
  if (span < 0 || span > 366)
    throw ruleProblem({
      code: "reporting_period.range_invalid",
      detail: "A reporting period ends on or after its start and lasts at most 367 days.",
      pointer: "/periodEnd",
    });
  const weekCount = b.weekCount ?? null;
  if ((b.basis === "weeks") !== (weekCount !== null) || (weekCount !== null && span + 1 !== weekCount * 7))
    throw ruleProblem({
      code: "reporting_period.weeks_invalid",
      detail: "A week-based period lasts exactly its number of weeks times seven days.",
      pointer: "/weekCount",
    });
  if (b.updateDueDate !== undefined && b.updateDueDate !== null && !(b.updateDueDate > b.periodEnd))
    throw ruleProblem({
      code: "validation.constraint",
      detail: "The update due date comes after the end of the period.",
      pointer: "/updateDueDate",
    });
}

const statusStep = () =>
  ruleProblem({
    code: "reporting_period.status_step",
    detail: "A reporting period moves from scheduled to open to closed, and a closed period stays closed.",
    pointer: "",
  });

// ------------------------------------------------------------------------------------------------ access

/** Organization read gate (404), then reporting_period.manage on grants reloaded in `tx` (403). */
async function requireManage(tx: Tx, request: FastifyRequest, organizationId: string): Promise<string> {
  const target = await requireRead(tx, principalOf(request), READ, { type: "organization", id: organizationId });
  const fresh = await refreshPrincipal(tx, request);
  try {
    await requireAction(tx, fresh, MANAGE, target);
  } catch (err) {
    throw commitTimeDenial(err);
  }
  return fresh.userId!;
}

async function readOrganization(db: DbOrTx, request: FastifyRequest, organizationId: string): Promise<void> {
  await requireRead(db, principalOf(request), READ, { type: "organization", id: organizationId });
}

export async function findPeriod(
  db: DbOrTx,
  organizationId: string,
  id: string,
  forUpdate = false,
): Promise<ReportingPeriodRow | undefined> {
  let q = db
    .selectFrom("reporting_period")
    .selectAll()
    .where("organization_id", "=", organizationId)
    .where("id", "=", id);
  if (forUpdate) q = q.forUpdate();
  return q.executeTakeFirst();
}

// ------------------------------------------------------------------------------------------------ mutations

async function createPeriod(
  tx: Tx,
  request: FastifyRequest,
  organizationId: string,
  userId: string,
  b: ReportingPeriodCreate,
): Promise<ReportingPeriodRow> {
  checkPeriodShape(b);
  // The same lock the guard takes (per organization and frequency), so the label and overlap checks are race-free.
  await sql`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK_CLASSES.reportingPeriod}::integer, hashtext(${`${organizationId}:${b.frequency}`}::text))`.execute(
    tx,
  );
  const taken = await tx
    .selectFrom("reporting_period")
    .select("id")
    .where("organization_id", "=", organizationId)
    .where("frequency", "=", b.frequency)
    .where("period_label", "=", b.periodLabel)
    .executeTakeFirst();
  if (taken)
    throw problems.duplicate(
      "reporting_period.label_taken",
      `A ${b.frequency} reporting period ${b.periodLabel} already exists.`,
    );
  const other = await tx
    .selectFrom("reporting_period")
    .select("period_label")
    .where("organization_id", "=", organizationId)
    .where("frequency", "=", b.frequency)
    .where("period_start", "<=", b.periodEnd)
    .where("period_end", ">=", b.periodStart)
    .orderBy("period_start")
    .executeTakeFirst();
  if (other)
    throw ruleProblem({
      code: "reporting_period.overlap",
      detail: `The period overlaps the ${b.frequency} reporting period ${other.period_label}.`,
      pointer: "/periodStart",
    });
  const row = await tx
    .insertInto("reporting_period")
    .values({
      id: uuidv7(),
      organization_id: organizationId,
      frequency: b.frequency,
      period_label: b.periodLabel,
      period_start: b.periodStart,
      period_end: b.periodEnd,
      basis: b.basis,
      week_count: b.weekCount ?? null,
      update_due_date: b.updateDueDate ?? null,
      created_by: userId,
      updated_by: userId,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, auditContextOf(request), {
    action: "reporting_period.create",
    recordType: "reporting_period",
    recordId: row.id,
    organizationId,
    newVersion: 1,
    changes: diffFields({} as ReportingPeriodRow, row, [...REPORTING_PERIOD_AUDIT_FIELDS]),
  });
  return row;
}

async function stepPeriod(
  tx: Tx,
  request: FastifyRequest,
  organizationId: string,
  userId: string,
  id: string,
  to: "open" | "closed",
): Promise<ReportingPeriodRow> {
  const expected = requireIfMatch(request);
  const current = await findPeriod(tx, organizationId, id, true);
  if (!current) throw problems.notFound();
  if (current.version !== expected) throw problems.versionConflict(current.version);
  if ((to === "open" && current.status !== "scheduled") || (to === "closed" && current.status !== "open"))
    throw statusStep();
  const updated = await tx
    .updateTable("reporting_period")
    .set({
      status: to,
      ...(to === "open" ? { opened_at: sql<Date>`now()` } : { closed_at: sql<Date>`now()` }),
      version: sql<number>`version + 1`,
      updated_at: sql<Date>`now()`,
      updated_by: userId,
    })
    .where("id", "=", current.id)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, auditContextOf(request), {
    action: to === "open" ? "reporting_period.open" : "reporting_period.close",
    recordType: "reporting_period",
    recordId: current.id,
    organizationId,
    priorVersion: current.version,
    newVersion: updated.version,
    changes: diffFields(current, updated, [...REPORTING_PERIOD_AUDIT_FIELDS]),
  });
  return updated;
}

// ------------------------------------------------------------------------------------------------ routes

export function registerReportingPeriodRoutes(app: FastifyInstance, deps: ModuleDeps): string[] {
  const { db } = deps;
  const read = { access: { permission: READ } };
  const write = (body: boolean) => ({ access: { permission: MANAGE }, ...(body ? { consumes: JSON_BODY } : {}) });

  app.get(ORG_BASE, { config: read }, async (request) => {
    const { organizationId } = parse(orgParams, request.params, "params");
    const query = parseQuery(listQuery, request.query);
    await readOrganization(db, request, organizationId);
    const hash = filterHash({
      list: "reporting-periods",
      organizationId,
      frequency: query.frequency ?? null,
      status: query.status ?? null,
    });
    const after = decodeCursor(query.cursor, hash, 2);
    let q = db.selectFrom("reporting_period").selectAll().where("organization_id", "=", organizationId);
    if (query.frequency) q = q.where("frequency", "=", query.frequency);
    if (query.status) q = q.where("status", "=", query.status);
    if (after) q = q.where(sql<boolean>`(period_start, id) < (${String(after[0])}::date, ${String(after[1])}::uuid)`);
    const rows = await q
      .orderBy("period_start", "desc")
      .orderBy("id", "desc")
      .limit(query.limit + 1)
      .execute();
    const page = paginate(rows, query.limit, (r) => [r.period_start, r.id], hash);
    return { items: page.items.map(toReportingPeriod), nextCursor: page.nextCursor };
  });

  app.post(ORG_BASE, { config: write(true) }, async (request, reply) => {
    const { organizationId } = parse(orgParams, request.params, "params");
    const row = await db.transaction().execute(async (tx) => {
      const userId = await requireManage(tx, request, organizationId);
      const body = parseBody(reportingPeriodCreate, request.body);
      return createPeriod(tx, request, organizationId, userId, body);
    });
    return sendVersioned(
      reply,
      201,
      toReportingPeriod(row),
      `/api/v1/organizations/${organizationId}/reporting-periods/${row.id}`,
    );
  });

  app.get(ITEM, { config: read }, async (request, reply) => {
    const { organizationId, reportingPeriodId } = parse(itemParams, request.params, "params");
    await readOrganization(db, request, organizationId);
    const row = await findPeriod(db, organizationId, reportingPeriodId);
    if (!row) throw problems.notFound();
    return sendVersioned(reply, 200, toReportingPeriod(row));
  });

  for (const [suffix, to] of [
    ["open", "open"],
    ["close", "closed"],
  ] as const) {
    app.post(`${ITEM}/${suffix}`, { config: write(false) }, async (request, reply) => {
      const { organizationId, reportingPeriodId } = parse(itemParams, request.params, "params");
      const row = await db.transaction().execute(async (tx) => {
        const userId = await requireManage(tx, request, organizationId);
        return stepPeriod(tx, request, organizationId, userId, reportingPeriodId, to);
      });
      return sendVersioned(reply, 200, toReportingPeriod(row));
    });
  }

  return [`GET ${ORG_BASE}`, `POST ${ORG_BASE}`, `GET ${ITEM}`, `POST ${ITEM}/open`, `POST ${ITEM}/close`];
}
