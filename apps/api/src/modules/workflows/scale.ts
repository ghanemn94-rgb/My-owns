// The G5 approved scale scope, scale transitions and risk dispositions (T-DG4-BE-K; ADR-0035 §5, §6, §8, §11;
// REQ-S03-004, REQ-S04-007, REQ-PB-020, REQ-S12-010; p4-work-split §H H.1):
//   GET  /transformations/{id}/scale-scope                        the latest approved G5 decision's items and conditions
//   GET  /transformations/{id}/scale-transitions                  scale transitions of the transformation
//   POST /transformations/{id}/scale-transitions                  scale one initiative into one business unit (TL)
//   GET  /transformations/{id}/risk-dispositions[?raidEntryId=]   proposed dispositions with their approval status
//   POST /transformations/{id}/risk-dispositions                  propose a disposition; requests its business approval
//   GET  /transformations/{id}/risk-dispositions/{dispositionId}  one disposition with its approval
//
// Scaling is allowed only inside the scope of the latest APPROVED G5 decision (a person's business approval inside the
// product): before it, 422 invalid-transition gate.g5_not_approved (names G5); outside its scope, 422
// scale.outside_approved_scope; the 0051 triggers make both refusals hold in SQL. A risk disposition is immutable; its
// approval is a canonical approval of type risk_disposition (requestApprovalInTx, ADR-0026 §4), decided through
// POST /approvals/{id}/decision by a person other than the proposer. Nothing here approves anything, and nothing reads
// or writes the engineering delivery gates DG0-DG7.
import type { ApprovalRow, DbOrTx, Tx } from "@mth/db";
import { PROBLEM_TYPES } from "@mth/shared";
import {
  riskDispositionCreate,
  scaleTransitionCreate,
  type RiskDisposition,
  type ScaleScope,
  type ScaleTransition,
} from "@mth/shared/schemas";
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
  limitSchema,
  paginate,
  parse,
  parseBody,
  parseQuery,
  problems,
  sendVersioned,
  type ModuleDeps,
} from "../platform/index.ts";
import { assertActiveUsers, openWrite } from "../transformations/index.ts";
import { registerApprovalSubject, requestApprovalInTx } from "./approvals.ts";

const T_BASE = "/api/v1/transformations/:transformationId";
export const SCALE_SCOPE = `${T_BASE}/scale-scope`;
export const SCALE_TRANSITIONS = `${T_BASE}/scale-transitions`;
export const RISK_DISPOSITIONS = `${T_BASE}/risk-dispositions`;
export const RISK_DISPOSITION = `${RISK_DISPOSITIONS}/:riskDispositionId`;
const JSON_BODY = ["application/json"] as const;

/** The approval type of a risk disposition (0053; ADR-0035 §6). */
export const RISK_DISPOSITION_APPROVAL_TYPE = "risk_disposition";

const tParams = z.strictObject({ transformationId: z.uuid() });
const dParams = z.strictObject({ transformationId: z.uuid(), riskDispositionId: z.uuid() });

// ------------------------------------------------------------------------------------------------ refusals (ADR-0035 §11)

const invalidTransition = (code: string, detail: string) =>
  new HttpProblem({ status: 422, type: PROBLEM_TYPES.invalidTransition, code, title: "Invalid transition", detail });

export const scaleRefusals = {
  g5NotApproved: () =>
    invalidTransition(
      "gate.g5_not_approved",
      "Scaling requires the G5 (Scale) business approval, which is not approved for this transformation.",
    ),
  outsideScope: () =>
    invalidTransition(
      "scale.outside_approved_scope",
      "This initiative and business unit are outside the scale scope approved at G5.",
    ),
  alreadyScaled: () =>
    problems.duplicate("scale.already_scaled", "This initiative is already scaled into this business unit."),
  notOpenRisk: () =>
    new HttpProblem({
      status: 422,
      type: PROBLEM_TYPES.validation,
      code: "risk_disposition.not_open_risk",
      title: "Business rule violated",
      detail: "Only an open risk can be given a disposition.",
      errors: [
        {
          pointer: "/raidEntryId",
          code: "risk_disposition.not_open_risk",
          message: "Only an open risk can be given a disposition.",
        },
      ],
    }),
} as const;

// ------------------------------------------------------------------------------------------------ scale scope

/** The latest approved G5 decision of the transformation, or undefined (G5 not approved). */
async function latestApprovedG5(db: DbOrTx, transformationId: string) {
  return db
    .selectFrom("gate_decision")
    .select(["id", "decided_at"])
    .where("transformation_id", "=", transformationId)
    .where("gate_code", "=", "G5")
    .where("outcome", "=", "approved")
    .orderBy("decided_at", "desc")
    .orderBy("id", "desc")
    .limit(1)
    .executeTakeFirst();
}

/** getScaleScope: approved = false and empty lists before G5 is approved (never a 404). */
export async function getScaleScope(db: DbOrTx, transformationId: string): Promise<ScaleScope> {
  const decision = await latestApprovedG5(db, transformationId);
  if (!decision) return { approved: false, gateDecisionId: null, decidedAt: null, items: [], conditions: [] };
  const items = await db
    .selectFrom("gate_decision_scale_scope")
    .select(["id", "initiative_id", "business_unit_id", "note"])
    .where("gate_decision_id", "=", decision.id)
    .orderBy("created_at")
    .orderBy("id")
    .execute();
  const conditions = await db
    .selectFrom("gate_decision_condition")
    .select(["id", "ordinal", "condition_text", "owner_user_id", "due_date"])
    .where("gate_decision_id", "=", decision.id)
    .orderBy("ordinal")
    .execute();
  return {
    approved: true,
    gateDecisionId: decision.id,
    decidedAt: iso(decision.decided_at),
    items: items.map((i) => ({
      id: i.id,
      initiativeId: i.initiative_id,
      businessUnitId: i.business_unit_id,
      note: i.note,
    })),
    conditions: conditions.map((c) => ({
      id: c.id,
      ordinal: c.ordinal,
      text: c.condition_text,
      ownerUserId: c.owner_user_id,
      dueDate: dateText(c.due_date),
    })),
  };
}

const dateText = (d: string | Date): string => (typeof d === "string" ? d.slice(0, 10) : iso(d).slice(0, 10));

// ------------------------------------------------------------------------------------------------ scale transitions

type ScaleTransitionRow = {
  id: string;
  transformation_id: string;
  initiative_id: string;
  business_unit_id: string;
  gate_decision_id: string;
  note: string | null;
  transitioned_by: string;
  transitioned_at: Date;
};

const toScaleTransition = (r: ScaleTransitionRow): ScaleTransition => ({
  id: r.id,
  transformationId: r.transformation_id,
  initiativeId: r.initiative_id,
  businessUnitId: r.business_unit_id,
  gateDecisionId: r.gate_decision_id,
  note: r.note,
  transitionedBy: r.transitioned_by,
  transitionedAt: iso(r.transitioned_at),
});

/**
 * createScaleTransition (scale.transition; TL): authorised again at commit time; 422 gate.g5_not_approved before an
 * approved G5, 422 scale.outside_approved_scope outside its scope, 409 scale.already_scaled; one audit event.
 */
export async function createScaleTransition(
  tx: Tx,
  request: FastifyRequest,
  transformationId: string,
): Promise<ScaleTransition> {
  const ctx = await openWrite(tx, request, transformationId, [{ permission: "scale.transition" }], null, {
    atCommit: true,
  });
  const body = parseBody(scaleTransitionCreate, request.body);
  const decision = await latestApprovedG5(tx, transformationId);
  if (!decision) throw scaleRefusals.g5NotApproved();
  const inScope = await tx
    .selectFrom("gate_decision_scale_scope")
    .select("id")
    .where("gate_decision_id", "=", decision.id)
    .where("initiative_id", "=", body.initiativeId)
    .where("business_unit_id", "=", body.businessUnitId)
    .executeTakeFirst();
  if (!inScope) throw scaleRefusals.outsideScope();
  const existing = await tx
    .selectFrom("scale_transition")
    .select("id")
    .where("initiative_id", "=", body.initiativeId)
    .where("business_unit_id", "=", body.businessUnitId)
    .executeTakeFirst();
  if (existing) throw scaleRefusals.alreadyScaled();
  const id = uuidv7();
  const row = await tx
    .insertInto("scale_transition")
    .values({
      id,
      organization_id: ctx.organizationId,
      transformation_id: transformationId,
      initiative_id: body.initiativeId,
      business_unit_id: body.businessUnitId,
      gate_decision_id: decision.id,
      note: body.note ?? null,
      transitioned_by: ctx.userId,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: "scale_transition.create",
    recordType: "scale_transition",
    recordId: id,
    organizationId: ctx.organizationId,
    transformationId,
    changes: {
      initiative_id: { from: null, to: row.initiative_id },
      business_unit_id: { from: null, to: row.business_unit_id },
      gate_decision_id: { from: null, to: row.gate_decision_id },
    },
  });
  return toScaleTransition(row);
}

// ------------------------------------------------------------------------------------------------ risk dispositions

type DispositionRow = {
  id: string;
  transformation_id: string;
  raid_entry_id: string;
  disposition: string;
  rationale: string;
  residual_owner_user_id: string;
  version: number;
  created_at: Date;
  created_by: string;
};

/** The disposition with its (latest) canonical approval, or null when none was requested. */
function toRiskDisposition(
  r: DispositionRow,
  approval: Pick<ApprovalRow, "id" | "status"> | undefined,
): RiskDisposition {
  return {
    id: r.id,
    transformationId: r.transformation_id,
    raidEntryId: r.raid_entry_id,
    disposition: r.disposition as RiskDisposition["disposition"],
    rationale: r.rationale,
    residualOwnerUserId: r.residual_owner_user_id,
    approvalId: approval?.id ?? null,
    approvalStatus: (approval?.status ?? null) as RiskDisposition["approvalStatus"],
    version: r.version,
    createdAt: iso(r.created_at),
    createdBy: r.created_by,
  };
}

async function approvalsOf(db: DbOrTx, transformationId: string, ids: readonly string[]) {
  if (ids.length === 0) return new Map<string, { id: string; status: string }>();
  const rows = await db
    .selectFrom("approval")
    .select(["id", "status", "subject_id"])
    .where("transformation_id", "=", transformationId)
    .where("approval_type", "=", RISK_DISPOSITION_APPROVAL_TYPE)
    .where("subject_id", "in", ids)
    .orderBy("created_at")
    .orderBy("id")
    .execute();
  // The latest approval of each subject wins (there is one per disposition: the row is immutable).
  return new Map(rows.map((r) => [r.subject_id, { id: r.id, status: r.status }]));
}

export async function getRiskDisposition(
  db: DbOrTx,
  transformationId: string,
  riskDispositionId: string,
): Promise<RiskDisposition> {
  const row = await db
    .selectFrom("risk_disposition")
    .selectAll()
    .where("transformation_id", "=", transformationId)
    .where("id", "=", riskDispositionId)
    .executeTakeFirst();
  if (!row) throw problems.notFound();
  return toRiskDisposition(row, (await approvalsOf(db, transformationId, [row.id])).get(row.id));
}

/**
 * The party a risk disposition is routed to (ADR-0035 §6): SP, or the approving party of the transformation's T11 row
 * `go_live_scale` when G5's configured approver role is BO (T11 "Go-live / scale"; its approve party, else BO).
 */
async function dispositionParty(tx: Tx, transformationId: string): Promise<string> {
  const g5 = await tx
    .selectFrom("gate_instance")
    .select("approver_role_code")
    .where("transformation_id", "=", transformationId)
    .where("gate_code", "=", "G5")
    .executeTakeFirst();
  if (g5?.approver_role_code !== "BO") return "SP";
  const t11 = await tx
    .selectFrom("transformation_decision_right")
    .select("approve_party_code")
    .where("transformation_id", "=", transformationId)
    .where("template_key", "=", "go_live_scale")
    .where("status", "=", "active")
    .executeTakeFirst();
  return t11?.approve_party_code ?? "BO";
}

/**
 * createRiskDisposition (risk_disposition.propose; TL, BO, WL): an OPEN risk of the transformation only (422
 * risk_disposition.not_open_risk), an active residual owner; inserts the immutable row (version 1) with its audit event
 * and requests the risk_disposition approval in the same transaction (422 routing.role_unmapped writes nothing).
 */
export async function createRiskDisposition(
  tx: Tx,
  request: FastifyRequest,
  transformationId: string,
): Promise<RiskDisposition> {
  const ctx = await openWrite(tx, request, transformationId, [{ permission: "risk_disposition.propose" }], null, {
    atCommit: true,
  });
  const body = parseBody(riskDispositionCreate, request.body);
  const risk = await tx
    .selectFrom("raid_entry")
    .select(["id", "code", "entry_type", "status"])
    .where("transformation_id", "=", transformationId)
    .where("id", "=", body.raidEntryId)
    .forShare()
    .executeTakeFirst();
  if (!risk || risk.entry_type !== "risk" || risk.status === "closed") throw scaleRefusals.notOpenRisk();
  await assertActiveUsers(tx, ctx.organizationId, [{ id: body.residualOwnerUserId, pointer: "/residualOwnerUserId" }]);
  const id = uuidv7();
  const row = await tx
    .insertInto("risk_disposition")
    .values({
      id,
      organization_id: ctx.organizationId,
      transformation_id: transformationId,
      raid_entry_id: risk.id,
      disposition: body.disposition,
      rationale: body.rationale,
      residual_owner_user_id: body.residualOwnerUserId,
      created_by: ctx.userId,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: "risk_disposition.create",
    recordType: "risk_disposition",
    recordId: id,
    organizationId: ctx.organizationId,
    transformationId,
    newVersion: 1,
    changes: {
      raid_entry_id: { from: null, to: row.raid_entry_id },
      disposition: { from: null, to: row.disposition },
      residual_owner_user_id: { from: null, to: row.residual_owner_user_id },
    },
  });
  const approval = await requestApprovalInTx(tx, ctx.audit, {
    organizationId: ctx.organizationId,
    transformationId,
    scope: { ...ctx.target, transformationId },
    approvalType: RISK_DISPOSITION_APPROVAL_TYPE,
    subjectId: id,
    subjectVersion: row.version,
    title: `Risk disposition (${body.disposition}): ${risk.code}`,
    requestNote: null,
    assigneePartyCode: await dispositionParty(tx, transformationId),
    decisionRightId: null,
    slaType: null,
    urgentReason: null,
    due: null,
  });
  return toRiskDisposition(row, approval);
}

/**
 * The risk_disposition subject provider (ADR-0026 §4): the subject is the immutable row (version 1); the outcome needs
 * no write on the row, because "approved disposition" is read from the approval's own status (ADR-0035 §6).
 */
export function registerRiskDispositionSubject(): void {
  registerApprovalSubject(RISK_DISPOSITION_APPROVAL_TYPE, {
    currentVersion: async (db, subjectId, transformationId) =>
      (
        await db
          .selectFrom("risk_disposition")
          .select("version")
          .where("id", "=", subjectId)
          .where("transformation_id", "=", transformationId)
          .executeTakeFirst()
      )?.version ?? null,
  });
}

// ------------------------------------------------------------------------------------------------ routes

const pageQuery = z.strictObject({ cursor: cursorSchema, limit: limitSchema });
const dispositionQuery = pageQuery.extend({ raidEntryId: z.uuid().optional() });

/** Registers this file's routes and returns them as "METHOD /path". */
export function registerScaleRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  registerRiskDispositionSubject();
  const read = { access: { permission: "transformation.read" as const } };

  app.get(SCALE_SCOPE, { config: read }, async (request) => {
    const { transformationId } = parse(tParams, request.params, "params");
    await requireTransformationRead(db, principalOf(request), transformationId);
    return getScaleScope(db, transformationId);
  });

  app.get(SCALE_TRANSITIONS, { config: read }, async (request) => {
    const { transformationId } = parse(tParams, request.params, "params");
    const query = parseQuery(pageQuery, request.query);
    await requireTransformationRead(db, principalOf(request), transformationId);
    const hash = filterHash({ table: "scale_transition", transformationId });
    const after = decodeCursor(query.cursor, hash, 1);
    let q = db.selectFrom("scale_transition").selectAll().where("transformation_id", "=", transformationId);
    if (after) q = q.where("id", ">", String(after[0]));
    const rows = await q
      .orderBy("id")
      .limit(query.limit + 1)
      .execute();
    const page = paginate(rows, query.limit, (r) => [r.id], hash);
    return { items: page.items.map(toScaleTransition), nextCursor: page.nextCursor };
  });

  app.post(
    SCALE_TRANSITIONS,
    { config: { access: { permission: "scale.transition" }, consumes: JSON_BODY } },
    async (request, reply) => {
      const { transformationId } = parse(tParams, request.params, "params");
      const body = await db.transaction().execute((tx) => createScaleTransition(tx, request, transformationId));
      reply.header("Location", `/api/v1/transformations/${transformationId}/scale-transitions/${body.id}`);
      return reply.code(201).send(body);
    },
  );

  app.get(RISK_DISPOSITIONS, { config: read }, async (request) => {
    const { transformationId } = parse(tParams, request.params, "params");
    const query = parseQuery(dispositionQuery, request.query);
    await requireTransformationRead(db, principalOf(request), transformationId);
    const hash = filterHash({ table: "risk_disposition", transformationId, raidEntryId: query.raidEntryId ?? null });
    const after = decodeCursor(query.cursor, hash, 1);
    let q = db.selectFrom("risk_disposition").selectAll().where("transformation_id", "=", transformationId);
    if (query.raidEntryId !== undefined) q = q.where("raid_entry_id", "=", query.raidEntryId);
    if (after) q = q.where("id", ">", String(after[0]));
    const rows = await q
      .orderBy("id")
      .limit(query.limit + 1)
      .execute();
    const page = paginate(rows, query.limit, (r) => [r.id], hash);
    const approvals = await approvalsOf(
      db,
      transformationId,
      page.items.map((r) => r.id),
    );
    return { items: page.items.map((r) => toRiskDisposition(r, approvals.get(r.id))), nextCursor: page.nextCursor };
  });

  app.post(
    RISK_DISPOSITIONS,
    { config: { access: { permission: "risk_disposition.propose" }, consumes: JSON_BODY } },
    async (request, reply) => {
      const { transformationId } = parse(tParams, request.params, "params");
      const body = await db.transaction().execute((tx) => createRiskDisposition(tx, request, transformationId));
      return sendVersioned(
        reply,
        201,
        body,
        `/api/v1/transformations/${transformationId}/risk-dispositions/${body.id}`,
      );
    },
  );

  app.get(RISK_DISPOSITION, { config: read }, async (request, reply) => {
    const { transformationId, riskDispositionId } = parse(dParams, request.params, "params");
    await requireTransformationRead(db, principalOf(request), transformationId);
    const body = await getRiskDisposition(db, transformationId, riskDispositionId);
    return sendVersioned(reply, 200, body);
  });

  return [
    `GET ${SCALE_SCOPE}`,
    `GET ${SCALE_TRANSITIONS}`,
    `POST ${SCALE_TRANSITIONS}`,
    `GET ${RISK_DISPOSITIONS}`,
    `POST ${RISK_DISPOSITIONS}`,
    `GET ${RISK_DISPOSITION}`,
  ];
}
