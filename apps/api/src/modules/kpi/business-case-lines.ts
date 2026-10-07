// Business-case lines (ADR-0024 §2; REQ-PB-053, REQ-S05-005; T-DG3-KBE-B):
//   GET  /business-cases/{id}/lines                       list (transformation.read); archived only with includeArchived
//   POST /business-cases/{id}/lines                       create (business_case.edit); version 1
//   PATCH /business-cases/{id}/lines/{lineId}             update (business_case.edit; If-Match)
//   POST /business-cases/{id}/lines/{lineId}/archive      archive with a reason (business_case.edit; If-Match)
//
// Classification: every line has EXACTLY ONE class (investment: capex | opex | internal_fte | vendor_cost |
// opportunity_cost; benefit: revenue | cost_reduction | cost_avoidance | working_capital | strategic_non_financial),
// stored in one of two typed columns (DB CHECK business_case_line_one_class). Two classes in a request (an array, or
// investmentClass + benefitClass) are malformed: 400 at /class (strict schema). A class that does not fit `lineKind`
// is 422 business_case.line_class_mismatch; a value basis that does not fit the class is 422
// business_case.value_basis_mismatch (revenue uplift vs margin, avoided cost vs cash saving, cash vs non-cash). The
// kind, class and value basis are fixed at creation (the update body has none of them).
// Amounts are decimal strings fitting numeric(20,4), ≥ 0, in a configurable currency; null = Unknown, never 0.
// Strategic / non-financial benefits carry no amount (no monetisation without an approved valuation method). FTE only
// on internal-FTE lines. One T09 benefit formula backs at most ONE active line in the whole transformation (409
// business_case.formula_already_linked; DB partial unique index too), so a benefit is never counted in two cases.
import { diffFields, sql, type BusinessCaseLineRow, type DbOrTx, type Tx } from "@mth/db";
import {
  businessCaseLineCreate,
  businessCaseLineUpdate,
  INVESTMENT_CLASSES,
  kindOfClass,
  lineClassProblem,
  reasonRequest,
  type BusinessCaseLine,
  type BusinessCaseLineClass,
} from "@mth/shared/schemas";
import { compareDecimal } from "@mth/shared/schemas";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { record } from "../audit/index.ts";
import {
  iso,
  isoOrNull,
  parse,
  parseBody,
  parseQuery,
  problems,
  requireIfMatch,
  sendVersioned,
  type ModuleDeps,
} from "../platform/index.ts";
import { bumpStamps, openWrite } from "../transformations/index.ts";
import {
  archivedCase,
  BUSINESS_CASES,
  CASE_ITEM,
  caseTransformation,
  JSON_BODY,
  lockCase,
  parseCaseId,
  readCase,
  requireCaseEdit,
  rule,
} from "./business-cases.ts";
import { requireActiveUsers } from "./support.ts";

const LINES = `${CASE_ITEM}/lines`;
const LINE_ITEM = `${LINES}/:lineId`;
const EDIT = "business_case.edit" as const;

export const BUSINESS_CASE_LINE_AUDIT_FIELDS = [
  "line_kind",
  "investment_class",
  "benefit_class",
  "value_basis",
  "title",
  "description",
  "amount",
  "currency",
  "fte",
  "period_start",
  "period_end",
  "recurrence",
  "benefit_formula_id",
  "owner_user_id",
  "status",
  "archive_reason",
] as const satisfies readonly (keyof BusinessCaseLineRow & string)[];

const dateText = (d: unknown): string | null => (d === null || d === undefined ? null : String(d).slice(0, 10));

export function toBusinessCaseLine(l: BusinessCaseLineRow): BusinessCaseLine {
  return {
    id: l.id,
    organizationId: l.organization_id,
    transformationId: l.transformation_id,
    businessCaseId: l.business_case_id,
    lineKind: l.line_kind as BusinessCaseLine["lineKind"],
    class: (l.investment_class ?? l.benefit_class) as BusinessCaseLineClass,
    valueBasis: l.value_basis as BusinessCaseLine["valueBasis"],
    title: l.title,
    description: l.description,
    amount: l.amount,
    currency: l.currency,
    fte: l.fte,
    periodStart: dateText(l.period_start),
    periodEnd: dateText(l.period_end),
    recurrence: l.recurrence as BusinessCaseLine["recurrence"],
    benefitFormulaId: l.benefit_formula_id,
    ownerUserId: l.owner_user_id,
    status: l.status as BusinessCaseLine["status"],
    archivedAt: isoOrNull(l.archived_at),
    archivedBy: l.archived_by,
    archiveReason: l.archive_reason,
    version: l.version,
    createdAt: iso(l.created_at),
    createdBy: l.created_by,
    updatedAt: iso(l.updated_at),
    updatedBy: l.updated_by,
  };
}

// ------------------------------------------------------------------------------------------------ rules

/** The merged state of a line that the value rules check (create body, or current row + update). */
interface LineState {
  readonly cls: BusinessCaseLineClass;
  readonly amount: string | null;
  readonly fte: string | null;
  readonly periodStart: string | null;
  readonly periodEnd: string | null;
}

function checkLineValues(s: LineState): void {
  if (s.amount !== null && compareDecimal(s.amount, "0") < 0)
    throw rule("business_case.amount_negative", "A line amount cannot be negative.", "/amount");
  if (s.cls === "strategic_non_financial" && s.amount !== null)
    throw rule(
      "business_case.non_financial_amount",
      "A strategic or non-financial benefit has no amount: it is not monetised without an approved valuation method.",
      "/amount",
    );
  if (s.fte !== null && s.cls !== "internal_fte")
    throw rule("business_case.fte_only_internal", "FTE applies only to internal FTE investment lines.", "/fte");
  if (s.fte !== null && compareDecimal(s.fte, "0") <= 0)
    throw rule("business_case.fte_positive", "FTE must be greater than 0.", "/fte");
  if (s.periodStart !== null && s.periodEnd !== null && s.periodEnd < s.periodStart)
    throw rule("business_case.period_range", "The period end cannot be before the period start.", "/periodEnd");
}

/** A benefit formula of this transformation that is active and not yet backing another active line. */
async function checkFormula(
  tx: Tx,
  transformationId: string,
  formulaId: string,
  cls: BusinessCaseLineClass,
  exceptLineId: string | null,
): Promise<void> {
  if (kindOfClass(cls) !== "benefit")
    throw rule(
      "business_case.formula_only_benefit",
      "Only a benefit line can be backed by a benefit formula.",
      "/benefitFormulaId",
    );
  const formula = await tx
    .selectFrom("benefit_formula")
    .select(["id", "status"])
    .where("id", "=", formulaId)
    .where("transformation_id", "=", transformationId)
    .executeTakeFirst();
  if (!formula || formula.status !== "active")
    throw rule(
      "validation.reference",
      "The referenced record does not exist in this transformation.",
      "/benefitFormulaId",
    );
  let q = tx
    .selectFrom("business_case_line")
    .select("id")
    .where("benefit_formula_id", "=", formulaId)
    .where("status", "=", "active");
  if (exceptLineId !== null) q = q.where("id", "<>", exceptLineId);
  if (await q.executeTakeFirst())
    throw problems.duplicate(
      "business_case.formula_already_linked",
      "This benefit formula already backs another active line; one benefit is counted in one line only.",
    );
}

async function lockLine(tx: Tx, caseId: string, lineId: string): Promise<BusinessCaseLineRow> {
  const row = await tx
    .selectFrom("business_case_line")
    .selectAll()
    .where("id", "=", lineId)
    .where("business_case_id", "=", caseId)
    .forUpdate()
    .executeTakeFirst();
  if (!row) throw problems.notFound();
  return row;
}

const lineParams = z.strictObject({ businessCaseId: z.uuid(), lineId: z.uuid() });

// ------------------------------------------------------------------------------------------------ mutations

async function createLine(tx: Tx, request: FastifyRequest, caseId: string) {
  const transformationId = await caseTransformation(tx, caseId);
  const ctx = await openWrite(tx, request, transformationId, [{ permission: EDIT }], null, { atCommit: true });
  const body = parseBody(businessCaseLineCreate, request.body);
  const kase = await lockCase(tx, transformationId, caseId, "share");
  await requireCaseEdit(tx, ctx, { level: kase.level, initiativeId: kase.initiative_id });
  if (kase.status === "archived") throw archivedCase();
  const mismatch = lineClassProblem(body.lineKind, body.class, body.valueBasis);
  if (mismatch)
    throw rule(
      mismatch.code,
      mismatch.code === "business_case.line_class_mismatch"
        ? `The class ${body.class} is not a ${body.lineKind} class.`
        : `The value basis ${body.valueBasis} does not fit the class ${body.class}.`,
      mismatch.pointer,
    );
  checkLineValues({
    cls: body.class,
    amount: body.amount ?? null,
    fte: body.fte ?? null,
    periodStart: body.periodStart ?? null,
    periodEnd: body.periodEnd ?? null,
  });
  if (body.benefitFormulaId !== undefined)
    await checkFormula(tx, transformationId, body.benefitFormulaId, body.class, null);
  await requireActiveUsers(tx, ctx.organizationId, [["ownerUserId", body.ownerUserId]]);
  const isInvestment = (INVESTMENT_CLASSES as readonly string[]).includes(body.class);
  const id = uuidv7();
  const row = await tx
    .insertInto("business_case_line")
    .values({
      id,
      organization_id: ctx.organizationId,
      transformation_id: transformationId,
      business_case_id: caseId,
      line_kind: body.lineKind,
      investment_class: isInvestment ? body.class : null,
      benefit_class: isInvestment ? null : body.class,
      value_basis: body.valueBasis,
      title: body.title,
      description: body.description ?? null,
      amount: body.amount ?? null,
      currency: body.currency,
      fte: body.fte ?? null,
      period_start: body.periodStart ?? null,
      period_end: body.periodEnd ?? null,
      recurrence: body.recurrence ?? null,
      benefit_formula_id: body.benefitFormulaId ?? null,
      owner_user_id: body.ownerUserId ?? null,
      created_by: ctx.userId,
      updated_by: ctx.userId,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: "business_case_line.create",
    recordType: "business_case_line",
    recordId: id,
    organizationId: ctx.organizationId,
    transformationId,
    newVersion: 1,
    changes: diffFields({} as BusinessCaseLineRow, row, [...BUSINESS_CASE_LINE_AUDIT_FIELDS]),
  });
  return row;
}

async function updateLine(tx: Tx, request: FastifyRequest, caseId: string, lineId: string) {
  const transformationId = await caseTransformation(tx, caseId);
  const ctx = await openWrite(tx, request, transformationId, [{ permission: EDIT }], null, { atCommit: true });
  const expected = requireIfMatch(request);
  const body = parseBody(businessCaseLineUpdate, request.body);
  const kase = await lockCase(tx, transformationId, caseId, "share");
  const current = await lockLine(tx, caseId, lineId);
  if (current.version !== expected) throw problems.versionConflict(current.version);
  await requireCaseEdit(tx, ctx, { level: kase.level, initiativeId: kase.initiative_id });
  if (kase.status === "archived") throw archivedCase();
  if (current.status === "archived")
    throw problems.businessRule("business_case_line.archived", "Archived lines are read-only.");
  const cls = (current.investment_class ?? current.benefit_class) as BusinessCaseLineClass;
  checkLineValues({
    cls,
    amount: body.amount !== undefined ? body.amount : current.amount,
    fte: body.fte !== undefined ? body.fte : current.fte,
    periodStart: body.periodStart !== undefined ? body.periodStart : dateText(current.period_start),
    periodEnd: body.periodEnd !== undefined ? body.periodEnd : dateText(current.period_end),
  });
  if (body.benefitFormulaId !== undefined && body.benefitFormulaId !== null)
    await checkFormula(tx, transformationId, body.benefitFormulaId, cls, lineId);
  await requireActiveUsers(tx, ctx.organizationId, [["ownerUserId", body.ownerUserId]]);
  const updated = await tx
    .updateTable("business_case_line")
    .set({
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.amount !== undefined ? { amount: body.amount } : {}),
      ...(body.fte !== undefined ? { fte: body.fte } : {}),
      ...(body.periodStart !== undefined ? { period_start: body.periodStart } : {}),
      ...(body.periodEnd !== undefined ? { period_end: body.periodEnd } : {}),
      ...(body.recurrence !== undefined ? { recurrence: body.recurrence } : {}),
      ...(body.benefitFormulaId !== undefined ? { benefit_formula_id: body.benefitFormulaId } : {}),
      ...(body.ownerUserId !== undefined ? { owner_user_id: body.ownerUserId } : {}),
      ...bumpStamps(ctx.userId),
    })
    .where("id", "=", lineId)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: "business_case_line.update",
    recordType: "business_case_line",
    recordId: lineId,
    organizationId: ctx.organizationId,
    transformationId,
    priorVersion: current.version,
    newVersion: updated.version,
    changes: diffFields(current, updated, [...BUSINESS_CASE_LINE_AUDIT_FIELDS]),
  });
  return updated;
}

async function archiveLine(tx: Tx, request: FastifyRequest, caseId: string, lineId: string) {
  const transformationId = await caseTransformation(tx, caseId);
  const ctx = await openWrite(tx, request, transformationId, [{ permission: EDIT }], null, { atCommit: true });
  const expected = requireIfMatch(request);
  const { reason } = parseBody(reasonRequest, request.body);
  const kase = await lockCase(tx, transformationId, caseId, "share");
  const current = await lockLine(tx, caseId, lineId);
  if (current.version !== expected) throw problems.versionConflict(current.version);
  await requireCaseEdit(tx, ctx, { level: kase.level, initiativeId: kase.initiative_id });
  if (kase.status === "archived") throw archivedCase();
  if (current.status === "archived")
    throw problems.businessRule("business_case_line.already_archived", "The line is already archived.");
  const updated = await tx
    .updateTable("business_case_line")
    .set({
      status: "archived",
      archived_at: sql<Date>`now()`,
      archived_by: ctx.userId,
      archive_reason: reason,
      ...bumpStamps(ctx.userId),
    })
    .where("id", "=", lineId)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: "business_case_line.archive",
    recordType: "business_case_line",
    recordId: lineId,
    organizationId: ctx.organizationId,
    transformationId,
    priorVersion: current.version,
    newVersion: updated.version,
    reason,
    changes: diffFields(current, updated, [...BUSINESS_CASE_LINE_AUDIT_FIELDS]),
  });
  return updated;
}

/** Active lines of one case (for callers outside the routes, e.g. KBE-C's G4 facts). */
export async function activeLinesOf(db: DbOrTx, caseId: string): Promise<BusinessCaseLineRow[]> {
  return db
    .selectFrom("business_case_line")
    .selectAll()
    .where("business_case_id", "=", caseId)
    .where("status", "=", "active")
    .orderBy("created_at")
    .orderBy("id")
    .execute();
}

// ------------------------------------------------------------------------------------------------ routes

const listQuery = z.strictObject({ includeArchived: z.stringbool().default(false) });

export function registerBusinessCaseLineRoutes(app: FastifyInstance, { db }: ModuleDeps): readonly string[] {
  const write = { access: { permission: EDIT }, consumes: JSON_BODY };

  app.get(LINES, { config: { access: { permission: "transformation.read" } } }, async (request) => {
    const caseId = parseCaseId(request.params);
    const query = parseQuery(listQuery, request.query);
    await readCase(db, request, caseId);
    let q = db.selectFrom("business_case_line").selectAll().where("business_case_id", "=", caseId);
    if (!query.includeArchived) q = q.where("status", "=", "active");
    const rows = await q.orderBy("created_at").orderBy("id").execute();
    return { items: rows.map(toBusinessCaseLine) };
  });

  app.post(LINES, { config: write }, async (request, reply) => {
    const caseId = parseCaseId(request.params);
    const row = await db.transaction().execute((tx) => createLine(tx, request, caseId));
    return sendVersioned(reply, 201, toBusinessCaseLine(row), `${BUSINESS_CASES}/${caseId}/lines/${row.id}`);
  });

  app.patch(LINE_ITEM, { config: write }, async (request, reply) => {
    const { businessCaseId, lineId } = parse(lineParams, request.params, "params");
    const row = await db.transaction().execute((tx) => updateLine(tx, request, businessCaseId, lineId));
    return sendVersioned(reply, 200, toBusinessCaseLine(row));
  });

  app.post(`${LINE_ITEM}/archive`, { config: write }, async (request, reply) => {
    const { businessCaseId, lineId } = parse(lineParams, request.params, "params");
    const row = await db.transaction().execute((tx) => archiveLine(tx, request, businessCaseId, lineId));
    return sendVersioned(reply, 200, toBusinessCaseLine(row));
  });

  return [`GET ${LINES}`, `POST ${LINES}`, `PATCH ${LINE_ITEM}`, `POST ${LINE_ITEM}/archive`];
}
