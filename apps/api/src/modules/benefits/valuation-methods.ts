// Valuation methods for non-financial benefits (P4 slice B; ADR-0029 §8, §9, §11; T-DG4-KBE-D2; REQ-S08-010):
//   GET  /transformations/{t}/benefit-valuation-methods                         list (transformation.read)
//   POST /transformations/{t}/benefit-valuation-methods                         propose (benefit.edit; TL, BO); VM-01…
//   POST /transformations/{t}/benefit-valuation-methods/{methodId}/decision     Finance decides (finance.validate; FIN)
//
// A SAR value can be attached to a non-financial (CX, risk, strategic, other) benefit only by referencing a valuation
// method that Finance APPROVED, in the benefit's currency (REQ-S08-010; the benefit row's check is in register.ts, the
// scenario value's in scenarios.ts, the measurement's in KBE-E's measurements.ts; the database refuses all of them
// again). A method's content is fixed once proposed: a different method is a new row.
// Decisions: proposed -> approved | rejected (never by the proposer: 403 benefit_valuation_method.decider_is_proposer;
// a rejection needs a note), approved -> retired (a retired method stays valid for the benefits that already reference
// it; new references need an approved one). Every mutation: 403 when the permission is held nowhere (AUD, ADM-only and,
// for the decision, BO), 404 outside the read scope, the write gate re-checked at commit, zod (400), the §11 rules
// (422/403), If-Match on the decision (428/409) and one audit event in the same transaction. No remote I/O.
// A Finance decision is a human decision inside the product; nothing here decides by itself or touches DG0-DG7.
import { diffFields, sql, type BenefitValuationMethodRow, type Tx } from "@mth/db";
import {
  benefitValuationMethodCreate,
  benefitValuationMethodDecision,
  MONEY_COLUMN,
  toColumnString,
  valuationDecisionAllowed,
  type BenefitValuationMethod,
  type ValuationMethodDecision,
  type ValuationMethodStatus,
} from "@mth/shared/schemas";
import { PROBLEM_TYPES } from "@mth/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { principalOf, requireTransformationRead } from "../access/index.ts";
import { record } from "../audit/index.ts";
import {
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
import { assertSameTransformation, maybeIdempotent, sendCreated, type WriteContext } from "../transformations/index.ts";
import { BENEFIT_EDIT, benefitRule, JSON_BODY, openBenefitWrite, parseTransformationParam } from "./register.ts";

export const FINANCE_VALIDATE = "finance.validate" as const;
export const VALUATION_METHODS = "/api/v1/transformations/:transformationId/benefit-valuation-methods";
export const VALUATION_METHOD_DECISION = `${VALUATION_METHODS}/:benefitValuationMethodId/decision`;

export const VALUATION_METHOD_AUDIT_FIELDS = [
  "code",
  "name",
  "method",
  "applies_to_type",
  "kpi_definition_id",
  "unit_value",
  "currency",
  "status",
  "decided_by",
  "decided_at",
  "decision_note",
  "retired_at",
] as const satisfies readonly (keyof BenefitValuationMethodRow & string)[];

// ------------------------------------------------------------------------------------------------ refusals (§11)

export const valuationRefusals = {
  deciderIsProposer: () =>
    new HttpProblem({
      status: 403,
      type: PROBLEM_TYPES.forbidden,
      code: "benefit_valuation_method.decider_is_proposer",
      title: "Forbidden",
      detail: "The person who proposed this valuation method cannot decide it.",
    }),
  notProposed: () =>
    benefitRule(
      "benefit_valuation_method.not_proposed",
      "Only a proposed valuation method can be decided.",
      "/decision",
    ),
  /** Retiring needs an approved method (an additional code; the ADR's not_proposed text names only approve/reject). */
  notApproved: () =>
    benefitRule(
      "benefit_valuation_method.not_approved",
      "Only an approved valuation method can be retired.",
      "/decision",
    ),
  noteRequired: () => benefitRule("benefit_valuation_method.note_required", "A rejection needs a note.", "/note"),
} as const;

// ------------------------------------------------------------------------------------------------ presenter

export function toValuationMethod(r: BenefitValuationMethodRow): BenefitValuationMethod {
  return {
    id: r.id,
    transformationId: r.transformation_id,
    code: r.code,
    name: r.name,
    method: r.method,
    appliesToType: r.applies_to_type as BenefitValuationMethod["appliesToType"],
    kpiDefinitionId: r.kpi_definition_id,
    unitValue: r.unit_value === null ? null : toColumnString(r.unit_value, MONEY_COLUMN),
    currency: r.currency.trim(),
    status: r.status as ValuationMethodStatus,
    decidedBy: r.decided_by,
    decidedAt: isoOrNull(r.decided_at),
    decisionNote: r.decision_note,
    retiredAt: isoOrNull(r.retired_at),
    version: r.version,
    createdAt: iso(r.created_at),
    createdBy: r.created_by,
    updatedAt: iso(r.updated_at),
  };
}

// ------------------------------------------------------------------------------------------------ services

async function nextMethodCode(tx: Tx, transformationId: string): Promise<string> {
  const row = await sql<{ last_value: number }>`
    INSERT INTO record_code_counter (transformation_id, prefix, last_value) VALUES (${transformationId}::uuid, 'VM', 1)
    ON CONFLICT (transformation_id, prefix) DO UPDATE SET last_value = record_code_counter.last_value + 1
    RETURNING last_value`.execute(tx);
  return `VM-${String(row.rows[0]!.last_value).padStart(2, "0")}`;
}

async function proposeMethod(tx: Tx, ctx: WriteContext, body: z.infer<typeof benefitValuationMethodCreate>) {
  await assertSameTransformation(tx, "kpi_definition", ctx.transformationId, body.kpiDefinitionId, "/kpiDefinitionId");
  const id = uuidv7();
  const row = await tx
    .insertInto("benefit_valuation_method")
    .values({
      id,
      organization_id: ctx.organizationId,
      transformation_id: ctx.transformationId,
      code: await nextMethodCode(tx, ctx.transformationId),
      name: body.name,
      method: body.method,
      applies_to_type: body.appliesToType,
      kpi_definition_id: body.kpiDefinitionId ?? null,
      unit_value: body.unitValue ?? null,
      currency: body.currency,
      created_by: ctx.userId,
      updated_by: ctx.userId,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: "benefit_valuation_method.propose",
    recordType: "benefit_valuation_method",
    recordId: id,
    organizationId: ctx.organizationId,
    transformationId: ctx.transformationId,
    newVersion: row.version,
    changes: diffFields({} as BenefitValuationMethodRow, row, [...VALUATION_METHOD_AUDIT_FIELDS]),
  });
  return row;
}

const decisionParams = z.strictObject({ transformationId: z.uuid(), benefitValuationMethodId: z.uuid() });

/**
 * The Finance decision (ADR-0029 §8). Order: 403 (finance.validate held nowhere), 404, commit-time write gate, 400,
 * If-Match (428/409), the transition (422 not_proposed / not_approved), the proposer rule (403) and the rejection note
 * (422). Approve and reject stamp the decider; retire keeps the approval stamps and sets retired_at.
 */
async function decideMethod(tx: Tx, request: FastifyRequest): Promise<BenefitValuationMethodRow> {
  const { transformationId, benefitValuationMethodId } = parse(decisionParams, request.params, "params");
  const ctx = await openBenefitWrite(tx, request, transformationId, FINANCE_VALIDATE);
  const body = parseBody(benefitValuationMethodDecision, request.body);
  const expected = requireIfMatch(request);
  const current = await tx
    .selectFrom("benefit_valuation_method")
    .selectAll()
    .where("id", "=", benefitValuationMethodId)
    .where("transformation_id", "=", transformationId)
    .forUpdate()
    .executeTakeFirst();
  if (!current) throw problems.notFound();
  if (current.version !== expected) throw problems.versionConflict(current.version);
  const decision: ValuationMethodDecision = body.decision;
  if (!valuationDecisionAllowed(current.status as ValuationMethodStatus, decision))
    throw decision === "retired" ? valuationRefusals.notApproved() : valuationRefusals.notProposed();
  if (decision !== "retired" && current.created_by === ctx.userId) throw valuationRefusals.deciderIsProposer();
  if (decision === "rejected" && body.note === undefined) throw valuationRefusals.noteRequired();
  const now = sql<Date>`now()`;
  const updated = await tx
    .updateTable("benefit_valuation_method")
    .set({
      status: decision,
      ...(decision === "retired"
        ? { retired_at: now }
        : { decided_by: ctx.userId, decided_at: now, decision_note: body.note ?? null }),
      version: current.version + 1,
      updated_at: now,
      updated_by: ctx.userId,
    })
    .where("id", "=", current.id)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: decision === "retired" ? "benefit_valuation_method.retire" : "benefit_valuation_method.decide",
    recordType: "benefit_valuation_method",
    recordId: current.id,
    organizationId: ctx.organizationId,
    transformationId,
    priorVersion: current.version,
    newVersion: updated.version,
    changes: diffFields(current, updated, [...VALUATION_METHOD_AUDIT_FIELDS]),
    ...(decision === "retired" && body.note !== undefined ? { reason: body.note } : {}),
  });
  return updated;
}

// ------------------------------------------------------------------------------------------------ routes

const pageQuery = z.strictObject({ cursor: cursorSchema, limit: limitSchema });

export function registerBenefitValuationMethodRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  const read = { access: { permission: "transformation.read" as const } };

  app.get(VALUATION_METHODS, { config: read }, async (request) => {
    const transformationId = parseTransformationParam(request.params);
    const query = parseQuery(pageQuery, request.query);
    await requireTransformationRead(db, principalOf(request), transformationId);
    const hash = filterHash({ table: "benefit_valuation_method", transformationId });
    const after = decodeCursor(query.cursor, hash, 1);
    let q = db.selectFrom("benefit_valuation_method").selectAll().where("transformation_id", "=", transformationId);
    if (after) q = q.where("id", ">", String(after[0]));
    const rows = await q
      .orderBy("id")
      .limit(query.limit + 1)
      .execute();
    const page = paginate(rows, query.limit, (r) => [r.id], hash);
    return { items: page.items.map(toValuationMethod), nextCursor: page.nextCursor };
  });

  app.post(
    VALUATION_METHODS,
    { config: { access: { permission: BENEFIT_EDIT }, consumes: JSON_BODY } },
    async (request, reply) => {
      const transformationId = parseTransformationParam(request.params);
      const result = await db.transaction().execute(async (tx) => {
        const ctx = await openBenefitWrite(tx, request, transformationId, BENEFIT_EDIT);
        const body = parseBody(benefitValuationMethodCreate, request.body);
        return maybeIdempotent(tx, request, ctx.userId, body, async () => ({
          status: 201,
          body: toValuationMethod(await proposeMethod(tx, ctx, body)),
        }));
      });
      return sendCreated(request, reply, result);
    },
  );

  app.post(
    VALUATION_METHOD_DECISION,
    { config: { access: { permission: FINANCE_VALIDATE }, consumes: JSON_BODY } },
    async (request, reply) => {
      const row = await db.transaction().execute((tx) => decideMethod(tx, request));
      return sendVersioned(reply, 200, toValuationMethod(row));
    },
  );

  return [`GET ${VALUATION_METHODS}`, `POST ${VALUATION_METHODS}`, `POST ${VALUATION_METHOD_DECISION}`];
}
