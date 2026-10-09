// Budget lines and execution tracking per initiative (P4 slice E; ADR-0031 §7, §9-§11, §13; T-DG4-BE-E; REQ-S09-007):
//   GET   /initiatives/{i}/budget-lines        the lines (transformation.read); ?status=active|archived
//   POST  /initiatives/{i}/budget-lines        create (budget.edit; TL, FIN); currency = the organization default now
//   GET   /budget-lines/{id}                   one line (transformation.read)
//   PATCH /budget-lines/{id}                   label, month, amounts, owner, note (budget.edit; If-Match)
//   POST  /budget-lines/{id}/archive           archive with a reason; final (budget.edit; If-Match)
//   GET   /initiatives/{i}/execution           execution tracking (transformation.read): approved vs forecast milestone
//                                              dates with the slip in WORKING days, deliverable acceptance, budget /
//                                              actual / forecast totals and variances per currency, role-based capacity
//                                              and FTE demand, dependencies, decisions, critical-path membership
//
// Decimal only (REQ-S09-007 "budget/actual/forecast use decimal SAR"; S-5): amounts are numeric(20,4) in the database,
// decimal strings on the wire and decimal.js in code, never floats. Each line keeps its own currency (copied from the
// organization default at creation, immutable); totals are per currency and never converted. A NULL amount is Unknown:
// a total is `known` only when every active line of the currency has the operand(s), otherwise `unknown` with the
// known part and the number of lines missing it - never a 0. An initiative with no active line has no total at all
// (`budgetUnknownReason: "no_budget_lines"`).
// The slip is counted in working days on the organization's active default business calendar (ADR-0025 §1; M0196),
// never in elapsed days; without a calendar it is Unknown (`calendar_not_configured`). The DG3 calendar-day variance is
// shown beside it unchanged (`calendarVarianceDays`). Everything else is read from its canonical record; nothing is
// copied. Every mutation: the read gate (404 outside scope; ADM-only users get 404), budget.edit re-checked at commit
// time (AUD 403), validation, If-Match (428/409; creates are version 1), one audit event in the same transaction, no
// remote I/O inside it (S-4). Refusals are exactly ADR-0031 §11 (S-11). Nothing here is a business or Finance approval,
// and nothing touches the engineering gates DG0-DG7.
import { diffFields, sql, type BudgetLineRow, type DbOrTx, type Tx } from "@mth/db";
import { computeWorkingDaySlip } from "@mth/shared/calc";
import {
  budgetLineCreate,
  budgetLineStatus,
  budgetLineUpdate,
  BUDGET_LINE_REFUSALS,
  checkDecimal,
  MONEY_COLUMN,
  reasonRequest,
  type BudgetLine,
  type ExecutionAmount,
  type ExecutionBudgetTotal,
  type InitiativeExecution,
} from "@mth/shared/schemas";
import { Decimal } from "decimal.js";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { principalOf, requireTransformationRead, type WriteRule } from "../access/index.ts";
import { record } from "../audit/index.ts";
import {
  cursorSchema,
  decodeCursor,
  filterHash,
  HttpProblem,
  iso,
  isoOrNull,
  limitSchema,
  materialChangePort,
  type ModuleDeps,
  paginate,
  parse,
  parseBody,
  parseQuery,
  problems,
  sendVersioned,
} from "../platform/index.ts";
import { assertActiveUsers, openWrite } from "../transformations/index.ts";
import { fteText } from "./capacity.ts";
import { varianceDays } from "./milestones.ts";
import { loadScheduleNetwork, onCriticalPath } from "./schedule-network.ts";
import { checkVersion, dateText, lockForWrite } from "./waves.ts";

export const BUDGET_LINES = "/api/v1/initiatives/:initiativeId/budget-lines";
export const BUDGET_LINE = "/api/v1/budget-lines/:budgetLineId";
export const BUDGET_LINE_ARCHIVE = `${BUDGET_LINE}/archive`;
export const INITIATIVE_EXECUTION = "/api/v1/initiatives/:initiativeId/execution";
const JSON_BODY = ["application/json"] as const;
const BUDGET_EDIT: readonly WriteRule[] = [{ permission: "budget.edit" }];

// ------------------------------------------------------------------------------------------------ decimal money

/** decimal.js clone for money: enough significant digits for exact sums of numeric(20,4) amounts; never a float. */
export const Money = Decimal.clone({ precision: 80, rounding: Decimal.ROUND_HALF_UP, toExpNeg: -80, toExpPos: 80 });
type Dec = InstanceType<typeof Money>;

/** A money value as a numeric(20,4) decimal string ("0.3" -> "0.3000"). */
export const moneyText = (d: Dec): string => d.toFixed(MONEY_COLUMN.scale);

/** The amount columns of a line, as the totals need them. */
export interface BudgetAmounts {
  readonly currency: string;
  readonly budget_amount: string | null;
  readonly actual_amount: string | null;
  readonly forecast_amount: string | null;
}

/** Reason of an `unknown` total: at least one active line lacks the operand (null amount = Unknown). */
export const MISSING_AMOUNTS = "missing_amounts";

/** One ExecutionAmount over `rows`: `pick` returns the line's operand, or null when the line lacks it. */
function totalOf<R>(rows: readonly R[], pick: (row: R) => Dec | null): ExecutionAmount {
  let sum = new Money(0);
  let known = 0;
  for (const row of rows) {
    const v = pick(row);
    if (v === null) continue;
    sum = sum.plus(v);
    known += 1;
  }
  const missing = rows.length - known;
  if (missing === 0) {
    const amount = moneyText(sum);
    return { status: "known", amount, knownAmount: amount, missingCount: 0, reason: null };
  }
  return {
    status: "unknown",
    amount: null,
    knownAmount: known === 0 ? null : moneyText(sum),
    missingCount: missing,
    reason: MISSING_AMOUNTS,
  };
}

const dec = (v: string | null): Dec | null => (v === null ? null : new Money(v));
const minus = (a: Dec | null, b: Dec | null): Dec | null => (a === null || b === null ? null : a.minus(b));

/**
 * Budget, actual and forecast totals with `forecastVariance = forecast - budget` and `actualVariance = actual -
 * budget`, per currency in code order, never converted (ADR-0031 §7). Pass the ACTIVE lines only.
 */
export function budgetTotals(lines: readonly BudgetAmounts[]): ExecutionBudgetTotal[] {
  const byCurrency = new Map<string, BudgetAmounts[]>();
  for (const l of lines) byCurrency.set(l.currency, [...(byCurrency.get(l.currency) ?? []), l]);
  return [...byCurrency.keys()].sort().map((currency) => {
    const rows = byCurrency.get(currency)!;
    return {
      currency,
      budget: totalOf(rows, (r) => dec(r.budget_amount)),
      actual: totalOf(rows, (r) => dec(r.actual_amount)),
      forecast: totalOf(rows, (r) => dec(r.forecast_amount)),
      forecastVariance: totalOf(rows, (r) => minus(dec(r.forecast_amount), dec(r.budget_amount))),
      actualVariance: totalOf(rows, (r) => minus(dec(r.actual_amount), dec(r.budget_amount))),
    };
  });
}

// ------------------------------------------------------------------------------------------------ problems (ADR-0031 §11)

const rule = (code: string, detail: string, pointer: string) =>
  new HttpProblem({
    status: 422,
    type: "urn:mth:problem:validation",
    code,
    title: "Business rule violated",
    detail,
    errors: [{ pointer, code, message: detail }],
  });
const R = BUDGET_LINE_REFUSALS;
export const AMOUNT_INVALID = (pointer: string) =>
  rule("budget_line.amount_invalid", R["budget_line.amount_invalid"], pointer);
export const PERIOD_INVALID = () => rule("budget_line.period_invalid", R["budget_line.period_invalid"], "/periodMonth");
export const BUDGET_LINE_ARCHIVED = () => rule("budget_line.archived", R["budget_line.archived"], "");
export const BUDGET_LINE_DUPLICATE = () => problems.duplicate("budget_line.duplicate", R["budget_line.duplicate"]);

/** One amount of a request body: zero or more and fitting numeric(20,4), else 422 at `pointer`. */
function checkAmount(value: string | null | undefined, pointer: string): void {
  if (value === undefined || value === null) return;
  if (!checkDecimal(value, MONEY_COLUMN).ok) throw AMOUNT_INVALID(pointer);
  const d = new Money(value);
  if (d.isNegative() && !d.isZero()) throw AMOUNT_INVALID(pointer); // "-0" is zero, allowed
}

/**
 * An amount must be zero or more and fit numeric(20,4) (at most 16 integer and 4 fraction digits) so the database never
 * rounds it silently: otherwise 422 budget_line.amount_invalid at the field (ADR-0031 §7).
 */
export function checkAmounts(body: {
  readonly budgetAmount?: string | null | undefined;
  readonly actualAmount?: string | null | undefined;
  readonly forecastAmount?: string | null | undefined;
}): void {
  checkAmount(body.budgetAmount, "/budgetAmount");
  checkAmount(body.actualAmount, "/actualAmount");
  checkAmount(body.forecastAmount, "/forecastAmount");
}

/** A month is given as its first day (YYYY-MM-01); 422 budget_line.period_invalid otherwise. */
export function checkPeriod(periodMonth: string | null | undefined): void {
  if (periodMonth !== undefined && periodMonth !== null && !periodMonth.endsWith("-01")) throw PERIOD_INVALID();
}

// ------------------------------------------------------------------------------------------------ representation

export const toBudgetLine = (r: BudgetLineRow): BudgetLine => ({
  id: r.id,
  transformationId: r.transformation_id,
  initiativeId: r.initiative_id,
  label: r.label,
  periodMonth: dateText(r.period_month),
  currency: r.currency,
  budgetAmount: r.budget_amount,
  actualAmount: r.actual_amount,
  forecastAmount: r.forecast_amount,
  ownerUserId: r.owner_user_id,
  note: r.note,
  status: r.status as BudgetLine["status"],
  archivedAt: isoOrNull(r.archived_at),
  archivedBy: r.archived_by,
  archiveReason: r.archive_reason,
  version: r.version,
  createdAt: iso(r.created_at),
  createdBy: r.created_by,
  updatedAt: iso(r.updated_at),
  updatedBy: r.updated_by,
});

const BUDGET_AUDIT_FIELDS = [
  "initiative_id",
  "label",
  "period_month",
  "currency",
  "budget_amount",
  "actual_amount",
  "forecast_amount",
  "owner_user_id",
  "note",
  "status",
  "archive_reason",
] as const satisfies readonly (keyof BudgetLineRow & string)[];

// ------------------------------------------------------------------------------------------------ writes

/** Another ACTIVE line of the initiative with the same label (case-insensitive) and month -> 409 budget_line.duplicate. */
async function assertNoDuplicate(
  tx: Tx,
  initiativeId: string,
  label: string,
  periodMonth: string | null,
  exceptId: string | null,
): Promise<void> {
  let q = tx
    .selectFrom("budget_line")
    .select("id")
    .where("initiative_id", "=", initiativeId)
    .where("status", "=", "active")
    .where(sql<boolean>`lower(label) = lower(${label})`)
    .where(sql<boolean>`period_month IS NOT DISTINCT FROM ${periodMonth}::date`);
  if (exceptId !== null) q = q.where("id", "<>", exceptId);
  if (await q.executeTakeFirst()) throw BUDGET_LINE_DUPLICATE();
}

async function createLine(tx: Tx, request: FastifyRequest): Promise<BudgetLineRow> {
  const { initiativeId } = parse(initiativeParams, request.params, "params");
  // The transformation is the initiative's: 404 when unknown or outside the caller's read scope, then budget.edit on
  // the grants reloaded inside this transaction (403).
  const ini = await tx
    .selectFrom("initiative")
    .select(["id", "transformation_id"])
    .where("id", "=", initiativeId)
    .executeTakeFirst();
  if (!ini) throw problems.notFound();
  await requireTransformationRead(tx, principalOf(request), ini.transformation_id);
  const ctx = await openWrite(tx, request, ini.transformation_id, BUDGET_EDIT, null, { atCommit: true });
  const body = parseBody(budgetLineCreate, request.body);
  checkAmounts(body);
  checkPeriod(body.periodMonth);
  await assertActiveUsers(tx, ctx.organizationId, [{ id: body.ownerUserId ?? null, pointer: "/ownerUserId" }]);
  const periodMonth = body.periodMonth ?? null;
  await assertNoDuplicate(tx, initiativeId, body.label, periodMonth, null);
  // S-5 / ADR-0025 §2: the line's currency is the organization default NOW; changing the default never rewrites it.
  const org = await tx
    .selectFrom("organization")
    .select("default_currency")
    .where("id", "=", ctx.organizationId)
    .executeTakeFirstOrThrow();
  const id = uuidv7();
  const row = await tx
    .insertInto("budget_line")
    .values({
      id,
      organization_id: ctx.organizationId,
      transformation_id: ctx.transformationId,
      initiative_id: initiativeId,
      label: body.label,
      period_month: periodMonth,
      currency: org.default_currency,
      budget_amount: body.budgetAmount ?? null,
      actual_amount: body.actualAmount ?? null,
      forecast_amount: body.forecastAmount ?? null,
      owner_user_id: body.ownerUserId ?? null,
      note: body.note ?? null,
      created_by: ctx.userId,
      updated_by: ctx.userId,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: "budget_line.create",
    recordType: "budget_line",
    recordId: id,
    organizationId: ctx.organizationId,
    transformationId: ctx.transformationId,
    newVersion: row.version,
    changes: diffFields({} as BudgetLineRow, row, [...BUDGET_AUDIT_FIELDS]),
  });
  return row;
}

const ownership = (r: BudgetLineRow) => ({ createdBy: r.created_by, ownerUserId: r.owner_user_id });

async function updateLine(tx: Tx, request: FastifyRequest, id: string): Promise<BudgetLineRow> {
  const { ctx, current } = await lockForWrite<BudgetLineRow>(tx, request, "budget_line", id, BUDGET_EDIT, ownership);
  const body = parseBody(budgetLineUpdate, request.body);
  checkVersion(request, current);
  if (current.status === "archived") throw BUDGET_LINE_ARCHIVED();
  checkAmounts(body);
  checkPeriod(body.periodMonth);
  await assertActiveUsers(tx, ctx.organizationId, [{ id: body.ownerUserId ?? null, pointer: "/ownerUserId" }]);
  if (body.label !== undefined || body.periodMonth !== undefined)
    await assertNoDuplicate(
      tx,
      current.initiative_id,
      body.label ?? current.label,
      body.periodMonth !== undefined ? body.periodMonth : dateText(current.period_month),
      current.id,
    );
  // T-DG4-BE-L (ADR-0036 §3): changing the budget beyond a configured material ratio needs a change request.
  if (body.budgetAmount !== undefined) {
    const changeControl = materialChangePort();
    if (changeControl === null) throw problems.internal();
    await changeControl.assertBudgetChangeWithinThreshold(
      tx,
      ctx.transformationId,
      current.budget_amount,
      body.budgetAmount,
    );
  }
  const updated = await tx
    .updateTable("budget_line")
    .set({
      ...(body.label !== undefined ? { label: body.label } : {}),
      ...(body.periodMonth !== undefined ? { period_month: body.periodMonth } : {}),
      ...(body.budgetAmount !== undefined ? { budget_amount: body.budgetAmount } : {}),
      ...(body.actualAmount !== undefined ? { actual_amount: body.actualAmount } : {}),
      ...(body.forecastAmount !== undefined ? { forecast_amount: body.forecastAmount } : {}),
      ...(body.ownerUserId !== undefined ? { owner_user_id: body.ownerUserId } : {}),
      ...(body.note !== undefined ? { note: body.note } : {}),
      version: sql<number>`version + 1`,
      updated_at: sql<Date>`now()`,
      updated_by: ctx.userId,
    })
    .where("id", "=", current.id)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: "budget_line.update",
    recordType: "budget_line",
    recordId: current.id,
    organizationId: ctx.organizationId,
    transformationId: ctx.transformationId,
    priorVersion: current.version,
    newVersion: updated.version,
    changes: diffFields(current, updated, [...BUDGET_AUDIT_FIELDS]),
  });
  return updated;
}

async function archiveLine(tx: Tx, request: FastifyRequest, id: string): Promise<BudgetLineRow> {
  const { ctx, current } = await lockForWrite<BudgetLineRow>(tx, request, "budget_line", id, BUDGET_EDIT, ownership);
  const { reason } = parseBody(reasonRequest, request.body);
  checkVersion(request, current);
  if (current.status === "archived") throw BUDGET_LINE_ARCHIVED();
  const updated = await tx
    .updateTable("budget_line")
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
    action: "budget_line.archive",
    recordType: "budget_line",
    recordId: current.id,
    organizationId: ctx.organizationId,
    transformationId: ctx.transformationId,
    priorVersion: current.version,
    newVersion: updated.version,
    reason,
    changes: diffFields(current, updated, [...BUDGET_AUDIT_FIELDS]),
  });
  return updated;
}

// ------------------------------------------------------------------------------------------------ execution view

/** The organization's active default calendar with all its active holidays, or null (ADR-0025 §1). */
async function defaultWorkingCalendar(db: DbOrTx, organizationId: string) {
  const calendar = await db
    .selectFrom("business_calendar")
    .select(["id", "workweek"])
    .where("organization_id", "=", organizationId)
    .where("is_default", "=", true)
    .where("status", "=", "active")
    .executeTakeFirst();
  if (!calendar) return null;
  const holidays = await db
    .selectFrom("business_calendar_holiday")
    .select(["id", "date_from", "date_to"])
    .where("calendar_id", "=", calendar.id)
    .where("status", "=", "active")
    .orderBy("date_from")
    .execute();
  return {
    id: calendar.id,
    calendar: {
      workweek: calendar.workweek.map(Number),
      holidays: holidays.map((h) => ({ id: h.id, dateFrom: dateText(h.date_from)!, dateTo: dateText(h.date_to)! })),
    },
  };
}

/** Execution tracking of one initiative (REQ-S09-007), computed now from the canonical records. */
export async function loadInitiativeExecution(
  db: DbOrTx,
  initiative: { id: string; organization_id: string; transformation_id: string },
): Promise<InitiativeExecution> {
  const initiativeId = initiative.id;
  const cal = await defaultWorkingCalendar(db, initiative.organization_id);
  const milestones = await db
    .selectFrom("milestone")
    .select(["id", "title", "approved_date", "forecast_date", "status"])
    .where("initiative_id", "=", initiativeId)
    .orderBy(sql`coalesce(forecast_date, approved_date) asc nulls last`)
    .orderBy("id")
    .execute();
  const deliverables = await db
    .selectFrom("deliverable")
    .select(["id", "title", "due_date", "acceptance_status"])
    .where("initiative_id", "=", initiativeId)
    .where("status", "=", "active")
    .orderBy("ordinal")
    .orderBy("id")
    .execute();
  const lines = await db
    .selectFrom("budget_line")
    .select(["currency", "budget_amount", "actual_amount", "forecast_amount"])
    .where("initiative_id", "=", initiativeId)
    .where("status", "=", "active")
    .execute();
  const demand = await db
    .selectFrom("resource_demand")
    .select(["id", "resource_role_id", "period_month", "demand_fte", "status"])
    .where("initiative_id", "=", initiativeId)
    .where("status", "<>", "archived")
    .orderBy("period_month")
    .orderBy("id")
    .execute();
  const capacity =
    demand.length === 0
      ? []
      : await db
          .selectFrom("capacity")
          .select(["resource_role_id", "period_month", "available_fte"])
          .where("resource_role_id", "in", [...new Set(demand.map((d) => d.resource_role_id))])
          .where("status", "=", "active")
          .execute();
  const available = new Map(
    capacity.map((c) => [`${c.resource_role_id}|${dateText(c.period_month)}`, c.available_fte]),
  );
  const dependencies = await db
    .selectFrom("dependency")
    .select(["id", "code", "status", "needed_by", "impact", "from_initiative_id"])
    .where("transformation_id", "=", initiative.transformation_id)
    .where("status", "<>", "archived")
    .where((eb) => eb.or([eb("from_initiative_id", "=", initiativeId), eb("to_initiative_id", "=", initiativeId)]))
    .orderBy("code")
    .execute();
  const decisions = await db
    .selectFrom("initiative_decision_link as l")
    .innerJoin("decision as d", "d.id", "l.decision_id")
    .select(["d.id", "d.code", "d.kind", "d.status", "d.title"])
    .where("l.initiative_id", "=", initiativeId)
    .where("l.status", "=", "active")
    .orderBy("d.code")
    .execute();
  const network = await loadScheduleNetwork(db, initiative.transformation_id);

  return {
    initiativeId,
    calendarId: cal?.id ?? null,
    milestones: milestones.map((m) => {
      const approved = dateText(m.approved_date);
      const forecast = dateText(m.forecast_date);
      return {
        milestoneId: m.id,
        title: m.title,
        approvedDate: approved,
        forecastDate: forecast,
        status: m.status as InitiativeExecution["milestones"][number]["status"],
        calendarVarianceDays: varianceDays(approved, forecast),
        slipWorkingDays: { ...computeWorkingDaySlip(approved, forecast, cal?.calendar ?? null) },
      };
    }),
    deliverables: deliverables.map((d) => ({
      deliverableId: d.id,
      title: d.title,
      dueDate: dateText(d.due_date),
      acceptanceStatus: d.acceptance_status as InitiativeExecution["deliverables"][number]["acceptanceStatus"],
    })),
    budgetLineCount: lines.length,
    budgetUnknownReason: lines.length === 0 ? "no_budget_lines" : null,
    budgetTotals: budgetTotals(lines),
    demand: demand.map((d) => {
      const month = dateText(d.period_month)!;
      const fte = available.get(`${d.resource_role_id}|${month}`);
      return {
        resourceDemandId: d.id,
        resourceRoleId: d.resource_role_id,
        periodMonth: month,
        demandFte: fteText(d.demand_fte),
        status: d.status as InitiativeExecution["demand"][number]["status"],
        availableFte: fte === undefined ? null : fteText(fte),
        capacityStatus: fte === undefined ? "unknown" : "known",
      };
    }),
    dependencies: dependencies.map((d) => ({
      dependencyId: d.id,
      code: d.code,
      direction: d.from_initiative_id === initiativeId ? "outgoing" : "incoming",
      status: d.status,
      neededBy: dateText(d.needed_by),
      impact: d.impact as InitiativeExecution["dependencies"][number]["impact"],
    })),
    decisions: decisions.map((d) => ({
      decisionId: d.id,
      code: d.code,
      kind: d.kind as InitiativeExecution["decisions"][number]["kind"],
      status: d.status,
      title: d.title,
    })),
    onCriticalPath: onCriticalPath(network, initiativeId),
  };
}

// ------------------------------------------------------------------------------------------------ routes

const initiativeParams = z.strictObject({ initiativeId: z.uuid() });
const lineParams = z.strictObject({ budgetLineId: z.uuid() });
const listQuery = z.strictObject({ cursor: cursorSchema, limit: limitSchema, status: budgetLineStatus.optional() });

/** The initiative of a read, behind the read gate (404 when unknown or outside the caller's scope). */
async function readableInitiative(db: DbOrTx, request: FastifyRequest, initiativeId: string) {
  const ini = await db
    .selectFrom("initiative")
    .select(["id", "organization_id", "transformation_id"])
    .where("id", "=", initiativeId)
    .executeTakeFirst();
  if (!ini) throw problems.notFound();
  await requireTransformationRead(db, principalOf(request), ini.transformation_id);
  return ini;
}

/** Registers this file's routes and returns them as "METHOD /path". */
export function registerBudgetRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  const read = { access: { permission: "transformation.read" as const } };
  const write = { access: { permission: "budget.edit" as const }, consumes: JSON_BODY };

  app.get(BUDGET_LINES, { config: read }, async (request) => {
    const { initiativeId } = parse(initiativeParams, request.params, "params");
    const query = parseQuery(listQuery, request.query);
    await readableInitiative(db, request, initiativeId);
    const hash = filterHash({ table: "budget_line", initiativeId, status: query.status ?? null });
    const after = decodeCursor(query.cursor, hash, 1);
    let q = db.selectFrom("budget_line").selectAll().where("initiative_id", "=", initiativeId);
    if (query.status !== undefined) q = q.where("status", "=", query.status);
    if (after) q = q.where("id", ">", String(after[0]));
    const rows = await q
      .orderBy("id")
      .limit(query.limit + 1)
      .execute();
    const page = paginate(rows, query.limit, (r) => [r.id], hash);
    return { items: page.items.map(toBudgetLine), nextCursor: page.nextCursor };
  });

  app.post(BUDGET_LINES, { config: write }, async (request, reply) => {
    const row = await db.transaction().execute((tx) => createLine(tx, request));
    return sendVersioned(reply, 201, toBudgetLine(row), `/api/v1/budget-lines/${row.id}`);
  });

  app.get(BUDGET_LINE, { config: read }, async (request, reply) => {
    const { budgetLineId } = parse(lineParams, request.params, "params");
    const row = await db.selectFrom("budget_line").selectAll().where("id", "=", budgetLineId).executeTakeFirst();
    if (!row) throw problems.notFound();
    await requireTransformationRead(db, principalOf(request), row.transformation_id);
    return sendVersioned(reply, 200, toBudgetLine(row));
  });

  app.patch(BUDGET_LINE, { config: write }, async (request, reply) => {
    const { budgetLineId } = parse(lineParams, request.params, "params");
    const row = await db.transaction().execute((tx) => updateLine(tx, request, budgetLineId));
    return sendVersioned(reply, 200, toBudgetLine(row));
  });

  app.post(BUDGET_LINE_ARCHIVE, { config: write }, async (request, reply) => {
    const { budgetLineId } = parse(lineParams, request.params, "params");
    const row = await db.transaction().execute((tx) => archiveLine(tx, request, budgetLineId));
    return sendVersioned(reply, 200, toBudgetLine(row));
  });

  app.get(INITIATIVE_EXECUTION, { config: read }, async (request) => {
    const { initiativeId } = parse(initiativeParams, request.params, "params");
    const ini = await readableInitiative(db, request, initiativeId);
    return loadInitiativeExecution(db, ini);
  });

  return [
    `GET ${BUDGET_LINES}`,
    `POST ${BUDGET_LINES}`,
    `GET ${BUDGET_LINE}`,
    `PATCH ${BUDGET_LINE}`,
    `POST ${BUDGET_LINE_ARCHIVE}`,
    `GET ${INITIATIVE_EXECUTION}`,
  ];
}
