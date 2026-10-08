// Funding decisions (ADR-0023 §7, ADR-0021 §3 and §6; REQ-S09-003, REQ-S04-006, REQ-S16-016/-018):
//   GET  /api/v1/funding-decisions?transformationId=&initiativeId=   the append-only history, newest first
//   POST /api/v1/funding-decisions                                  record a person's funding decision (funding.approve)
//   GET  /api/v1/funding-decisions/{id}                             one decision
// and latestFundingState(), the derived funding state every reader uses (T-DG3-BE-B; scoped to the current selection
// by T-DG3-BE-E, see below).
//
// A funding decision is a BUSINESS APPROVAL inside the product (funding.approve; FIN and SP by default): the product
// records a named person's decision with rationale, timestamp, approver role and audit event. One transaction writes
// the canonical `decision` row of kind `executive` (DEC-nn, status decided; one decision model, ADR-0015) and the
// append-only `funding_decision` row, each with its audit event, and mirrors the initiative status:
//   approved            selected -> funded
//   rejected / deferred the initiative stays selected ('Selected - unfunded')
//   revoked             funded (not launched) -> selected; needs a prior approved decision
// Any other starting status is 422 `funding.not_selected` ('Funding can only be approved for a selected initiative').
// Nothing auto-approves or auto-funds: no job, rule or seed writes here, and nothing touches DG0-DG7.
//
// Delegation (`onBehalfOfUserId`) is refused (ADR-0021 §6, T-DG3-ARCH-03): 422 funding.on_behalf_not_supported at
// /onBehalfOfUserId, checked before the business preconditions and before any write; on_behalf_of_user_id stays NULL.
//
// Deselect rule (decided by T-DG3-BE-E; BE-B handback §7 item 4): DESELECTING VOIDS FUNDING. A funding decision counts
// only for the selection it was recorded under: latestFundingState() reads the latest decision recorded AFTER the
// initiative's latest `selected` portfolio_selection row. A deselected and re-selected initiative is therefore
// 'Selected - unfunded' until a person records a NEW approved funding decision; re-selection never re-mirrors to
// `funded`, and deselecting writes no funding record (selection and funding stay separate records, REQ-S09-003).
import { sql, type DbOrTx, type FundingDecisionRow, type InitiativeRow, type Tx } from "@mth/db";
import {
  fundingDecisionCreate,
  truncateText,
  type FundingDecision,
  type FundingDecisionCreate,
  type FundingState,
} from "@mth/shared/schemas";
import { Decimal } from "decimal.js";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { grantApplies, principalOf, requireTransformationRead } from "../access/index.ts";
import { record } from "../audit/index.ts";
import {
  cursorSchema,
  decodeCursor,
  etag,
  filterHash,
  HttpProblem,
  iso,
  limitSchema,
  paginate,
  parse,
  parseBody,
  parseQuery,
  problems,
  type ModuleDeps,
} from "../platform/index.ts";
import { assertSameTransformation, maybeIdempotent, openWrite, type WriteContext } from "../transformations/index.ts";
import { applyStatusChange, transitionProblem } from "./repository.ts";

/** The exact English texts of ADR-0021 §3 / ADR-0023 §7 for funding. */
export const FUNDING_REASONS = {
  "funding.not_selected": "Funding can only be approved for a selected initiative",
  "funding.not_revocable": "Only the funding of a funded initiative that is not launched can be revoked",
} as const;

/** ADR-0021 §6, the uniform detail text for a refused delegated P3 business approval. */
export const FUNDING_ON_BEHALF_DETAIL =
  "A funding decision is decided by the approver in person; deciding on someone's behalf is not available.";

// ------------------------------------------------------------------------------------------------ derived state

/**
 * The funding state of an initiative, derived from its LATEST funding decision (ADR-0023 §7; T-DG3-BE-B owns this
 * function, T-DG3-ARCH-02). funding_decision is append-only and the latest row per initiative (decided_at, then id)
 * decides: `approved` -> "funded"; `revoked` -> "revoked"; `rejected` / `deferred` -> "unfunded"; no decision at all
 * -> "unfunded" (fail closed: a selected initiative stays 'Selected - unfunded' and cannot launch). Read-only.
 * T-DG3-BE-E (deselect rule, header): only decisions recorded after the latest `selected` portfolio selection count.
 */
export async function latestFundingState(db: DbOrTx, initiativeId: string): Promise<FundingState> {
  const latest = await db
    .selectFrom("funding_decision")
    .select("outcome")
    .where("initiative_id", "=", initiativeId)
    .where(
      "decided_at",
      ">",
      sql<Date>`COALESCE((SELECT max(s.decided_at) FROM portfolio_selection s
                           WHERE s.initiative_id = ${initiativeId}::uuid AND s.action = 'selected'), '-infinity')`,
    )
    .orderBy("decided_at", "desc")
    .orderBy("id", "desc")
    .limit(1)
    .executeTakeFirst();
  if (latest === undefined) return "unfunded";
  if (latest.outcome === "approved") return "funded";
  if (latest.outcome === "revoked") return "revoked";
  return "unfunded";
}

// ------------------------------------------------------------------------------------------------ presenter

export function toFundingDecision(r: FundingDecisionRow, decisionCode: string): FundingDecision {
  return {
    id: r.id,
    organizationId: r.organization_id,
    transformationId: r.transformation_id,
    initiativeId: r.initiative_id,
    decisionId: r.decision_id,
    decisionCode,
    outcome: r.outcome as FundingDecision["outcome"],
    amount: r.amount === null ? null : String(r.amount),
    currency: String(r.currency).trim(),
    fundingSource: r.funding_source,
    conditions: r.conditions,
    rationale: r.rationale,
    businessCaseId: r.business_case_id,
    approverRoleCode: r.approver_role_code,
    decidedBy: r.decided_by,
    onBehalfOfUserId: r.on_behalf_of_user_id,
    decidedAt: iso(r.decided_at),
  };
}

async function present(db: DbOrTx, rows: readonly FundingDecisionRow[]): Promise<FundingDecision[]> {
  if (rows.length === 0) return [];
  const codes = await db
    .selectFrom("decision")
    .select(["id", "code"])
    .where(
      "id",
      "in",
      rows.map((r) => r.decision_id),
    )
    .execute();
  const byId = new Map(codes.map((c) => [c.id, c.code]));
  return rows.map((r) => toFundingDecision(r, byId.get(r.decision_id)!));
}

// ------------------------------------------------------------------------------------------------ rules

/** ADR-0021 §6: a P3 business approval is decided in person; acting on someone's behalf is refused (422). */
function refuseOnBehalf(onBehalfOf: string | undefined): void {
  if (onBehalfOf === undefined) return;
  throw new HttpProblem({
    status: 422,
    type: "urn:mth:problem:validation",
    code: "funding.on_behalf_not_supported",
    title: "Business rule violated",
    detail: FUNDING_ON_BEHALF_DETAIL,
    errors: [
      { pointer: "/onBehalfOfUserId", code: "funding.on_behalf_not_supported", message: FUNDING_ON_BEHALF_DETAIL },
    ],
  });
}

/** numeric(20,4) and >= 0 (CHECK): never rounded silently, never negative (422 at /amount). */
function assertAmount(amount: string | null | undefined): void {
  if (amount === null || amount === undefined) return;
  const d = new Decimal(amount);
  const fraction = amount.includes(".") ? amount.split(".")[1]!.length : 0;
  if (d.isNegative() || fraction > 4 || d.abs().greaterThanOrEqualTo(new Decimal("1e16")))
    throw new HttpProblem({
      status: 422,
      type: "urn:mth:problem:validation",
      code: "funding.amount_invalid",
      title: "Business rule violated",
      detail: "The funding amount must be zero or more, with at most 16 digits before and 4 after the decimal point.",
      errors: [
        {
          pointer: "/amount",
          code: "funding.amount_invalid",
          message:
            "The funding amount must be zero or more, with at most 16 digits before and 4 after the decimal point.",
        },
      ],
    });
}

/** The role in which the caller holds funding.approve on this transformation (FIN preferred, then SP, then any). */
function approverRoleOf(ctx: WriteContext): string {
  const roles = ctx.principal.grants
    .filter((g) => grantApplies(g, "funding.approve", ctx.target))
    .map((g) => g.roleCode)
    .sort();
  return roles.find((r) => r === "FIN") ?? roles.find((r) => r === "SP") ?? roles[0]!;
}

/** The status step of an outcome (ADR-0021 §3), or the 422 with its exact text. */
function stepOf(current: InitiativeRow, outcome: FundingDecisionCreate["outcome"]): string | null {
  if (outcome === "revoked") {
    if (current.status !== "funded")
      throw transitionProblem("funding.not_revocable", FUNDING_REASONS["funding.not_revocable"]);
    return "selected";
  }
  if (current.status !== "selected")
    throw transitionProblem("funding.not_selected", FUNDING_REASONS["funding.not_selected"]);
  return outcome === "approved" ? "funded" : null;
}

async function recordFunding(ctx: WriteContext, current: InitiativeRow, body: FundingDecisionCreate) {
  const { tx } = ctx;
  const code = await sql<{ last_value: number }>`
    INSERT INTO record_code_counter (transformation_id, prefix, last_value) VALUES (${ctx.transformationId}::uuid, 'DEC', 1)
    ON CONFLICT (transformation_id, prefix) DO UPDATE SET last_value = record_code_counter.last_value + 1
    RETURNING last_value`.execute(tx);
  const decisionCode = `DEC-${String(code.rows[0]!.last_value).padStart(2, "0")}`;
  const decisionId = uuidv7();
  await tx
    .insertInto("decision")
    .values({
      id: decisionId,
      organization_id: ctx.organizationId,
      transformation_id: ctx.transformationId,
      kind: "executive",
      code: decisionCode,
      title: truncateText(`Funding decision: ${current.code} ${current.name}`, 500),
      owner_user_id: ctx.userId,
      status: "decided",
      outcome_text: truncateText(`${body.outcome}: ${body.rationale}`, 8000),
      decided_by: ctx.userId,
      decided_at: sql<Date>`now()`,
      created_by: ctx.userId,
      updated_by: ctx.userId,
    })
    .execute();
  await record(tx, ctx.audit, {
    action: "decision.create",
    recordType: "decision",
    recordId: decisionId,
    organizationId: ctx.organizationId,
    transformationId: ctx.transformationId,
    newVersion: 1,
    reason: body.rationale,
    changes: {
      kind: { from: null, to: "executive" },
      code: { from: null, to: decisionCode },
      outcome: { from: null, to: body.outcome },
    },
  });
  const id = uuidv7();
  const approverRoleCode = approverRoleOf(ctx);
  const row = await tx
    .insertInto("funding_decision")
    .values({
      id,
      organization_id: ctx.organizationId,
      transformation_id: ctx.transformationId,
      initiative_id: current.id,
      decision_id: decisionId,
      outcome: body.outcome,
      amount: body.amount ?? null,
      currency: body.currency,
      funding_source: body.fundingSource ?? null,
      conditions: body.conditions ?? null,
      rationale: body.rationale,
      business_case_id: body.businessCaseId ?? null,
      approver_role_code: approverRoleCode,
      decided_by: ctx.userId,
      on_behalf_of_user_id: null,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: "funding_decision.create",
    recordType: "funding_decision",
    recordId: id,
    organizationId: ctx.organizationId,
    transformationId: ctx.transformationId,
    reason: body.rationale,
    changes: {
      initiativeId: { from: null, to: current.id },
      decisionCode: { from: null, to: decisionCode },
      outcome: { from: null, to: body.outcome },
      amount: { from: null, to: row.amount === null ? null : String(row.amount) },
      currency: { from: null, to: body.currency },
      approverRoleCode: { from: null, to: approverRoleCode },
    },
  });
  return { row, decisionCode };
}

async function createFunding(tx: Tx, request: FastifyRequest) {
  // The transformation is the initiative's: read the id leniently first so authorization precedes validation.
  const raw = (request.body ?? {}) as { initiativeId?: unknown };
  const initiativeId = parse(z.uuid(), raw.initiativeId, "body");
  const seen = await tx
    .selectFrom("initiative")
    .select(["id", "transformation_id"])
    .where("id", "=", initiativeId)
    .executeTakeFirst();
  if (!seen) throw problems.notFound();
  await requireTransformationRead(tx, principalOf(request), seen.transformation_id);
  // Business approval: re-authorised at commit time (BE18A); AUD and every non-holder get 403 for any body.
  const ctx = await openWrite(tx, request, seen.transformation_id, [{ permission: "funding.approve" }], null, {
    atCommit: true,
  });
  const body = parseBody(fundingDecisionCreate, request.body);
  return maybeIdempotent(tx, request, ctx.userId, body, async () => {
    // A create has no If-Match (version 1). Delegation is refused before every business precondition and write.
    refuseOnBehalf(body.onBehalfOfUserId);
    assertAmount(body.amount);
    await assertSameTransformation(tx, "business_case", ctx.transformationId, body.businessCaseId, "/businessCaseId");
    const current = await tx
      .selectFrom("initiative")
      .selectAll()
      .where("id", "=", initiativeId)
      .forUpdate()
      .executeTakeFirstOrThrow();
    const to = stepOf(current, body.outcome);
    const { row, decisionCode } = await recordFunding(ctx, current, body);
    if (to !== null)
      await applyStatusChange(ctx, current, to, body.outcome === "approved" ? "initiative.fund" : "initiative.unfund", {
        reason: body.rationale,
      });
    return { status: 201, body: toFundingDecision(row, decisionCode) };
  });
}

// ------------------------------------------------------------------------------------------------ routes

const COLLECTION = "/api/v1/funding-decisions";
const ITEM = `${COLLECTION}/:fundingDecisionId`;
const idParams = z.strictObject({ fundingDecisionId: z.uuid() });

/** Registers the funding-decision routes and returns them as "METHOD /path". */
export function registerFundingRoutes(app: FastifyInstance, { db }: ModuleDeps): readonly string[] {
  const read = { access: { permission: "transformation.read" as const } };
  const approve = { access: { permission: "funding.approve" as const }, consumes: ["application/json"] as const };
  const listQuery = z.strictObject({
    transformationId: z.uuid(),
    initiativeId: z.uuid().optional(),
    cursor: cursorSchema,
    limit: limitSchema,
  });

  app.get(COLLECTION, { config: read }, async (request) => {
    const query = parseQuery(listQuery, request.query);
    await requireTransformationRead(db, principalOf(request), query.transformationId);
    const hash = filterHash({ transformationId: query.transformationId, initiativeId: query.initiativeId });
    const after = decodeCursor(query.cursor, hash, 2);
    let q = db.selectFrom("funding_decision").selectAll().where("transformation_id", "=", query.transformationId);
    if (query.initiativeId !== undefined) q = q.where("initiative_id", "=", query.initiativeId);
    if (after)
      q = q.where((eb) =>
        eb.or([
          eb("decided_at", "<", new Date(String(after[0]))),
          eb.and([eb("decided_at", "=", new Date(String(after[0]))), eb("id", "<", String(after[1]))]),
        ]),
      );
    const rows = await q
      .orderBy("decided_at", "desc")
      .orderBy("id", "desc")
      .limit(query.limit + 1)
      .execute();
    const page = paginate(rows, query.limit, (r) => [r.decided_at.toISOString(), r.id], hash);
    return { items: await present(db, page.items), nextCursor: page.nextCursor };
  });

  app.post(COLLECTION, { config: approve }, async (request, reply) => {
    const result = await db.transaction().execute((tx) => createFunding(tx, request));
    // FundingDecision is append-only and carries no `version`; the ETag is the create's version 1 (ADR-0007).
    if (result.replayed) {
      request.authz.decisions += 1;
      reply.header("Idempotent-Replayed", "true");
    }
    reply.header("ETag", etag(1));
    reply.header("Location", `${COLLECTION}/${result.body.id}`);
    return reply.code(result.status).send(result.body);
  });

  app.get(ITEM, { config: read }, async (request) => {
    const { fundingDecisionId } = parse(idParams, request.params, "params");
    const row = await db
      .selectFrom("funding_decision")
      .selectAll()
      .where("id", "=", fundingDecisionId)
      .executeTakeFirst();
    if (!row) throw problems.notFound();
    await requireTransformationRead(db, principalOf(request), row.transformation_id);
    return (await present(db, [row]))[0]!;
  });

  return [`GET ${COLLECTION}`, `POST ${COLLECTION}`, `GET ${ITEM}`];
}
