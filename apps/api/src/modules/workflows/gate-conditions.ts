// The tracked conditions of a conditional approval (OpenAPI tag "gate-conditions"; ADR-0044 §3, §9, §10; REQ-S04-011;
// p5-work-split §E.2; T-DG5-BE-K):
//   GET  /transformations/{id}/gate-conditions                       every condition of the transformation's conditional
//                                                                    approvals with owner, due date and derived status
//                                                                    (transformation.read; AUD reads)
//   POST /transformations/{id}/gate-conditions/{conditionId}/close   the condition's owner closes it with a note and
//                                                                    optional evidence (gate_condition.close; AUD 403)
//
// The DG4 condition rows (gate_decision_condition, 0051) are append-only and unchanged; a closure is one append-only
// gate_condition_closure row (UNIQUE per condition; the 0075 guard refuses anyone but the owner), written with its audit
// event and the completion of the condition's open work items (the owner's `gate_condition_due` and any approver's
// `gate_condition_overdue`) in the same transaction. Status is derived, never stored: closed (closure row), overdue (open
// and today in the transformation's time zone is after the due date), else open. Escalation is the worker's
// `gate.condition_escalation_scan` (apps/worker/src/handlers/gates.ts); it informs and decides nothing.
import { sql, type DbOrTx } from "@mth/db";
import { gateConditionClose, uuid, type TrackedGateCondition } from "@mth/shared/schemas";
import type { FastifyInstance } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import {
  auditContextOf,
  commitTimeDenial,
  denialOf,
  principalOf,
  refreshPrincipal,
  requireAction,
  requireTransformationRead,
  type ResolvedTarget,
} from "../access/index.ts";
import { record } from "../audit/index.ts";
import {
  cursorSchema,
  decodeCursor,
  filterHash,
  HttpProblem,
  isoOrNull,
  limitSchema,
  paginate,
  parse,
  parseBody,
  parseQuery,
  problems,
  type ModuleDeps,
} from "../platform/index.ts";
import { closeWorkItemsOfSubject } from "../tasks/index.ts";

const JSON_BODY = ["application/json"] as const;
const CONDITION_ITEM_KINDS = ["gate_condition_due", "gate_condition_overdue"] as const;

export const gateConditionRefusals = {
  alreadyClosed: () => problems.businessRule("gate_condition.already_closed", "This condition is already closed."),
  notOwner: () =>
    new HttpProblem({
      status: 403,
      type: "urn:mth:problem:forbidden",
      code: "gate_condition.not_owner",
      title: "Forbidden",
      detail: "Only the condition's owner can close it.",
    }),
} as const;

/** The derived status (ADR-0044 §3), in SQL, against the transformation's business date. */
const STATUS = sql<"open" | "overdue" | "closed">`CASE
  WHEN z.id IS NOT NULL THEN 'closed'
  WHEN c.due_date < p4_business_date(now(), t.timezone) THEN 'overdue'
  ELSE 'open' END`;

function conditionQuery(db: DbOrTx, transformationId: string) {
  return db
    .selectFrom("gate_decision_condition as c")
    .innerJoin("gate_decision as d", "d.id", "c.gate_decision_id")
    .innerJoin("transformation as t", "t.id", "c.transformation_id")
    .leftJoin("gate_condition_closure as z", "z.gate_decision_condition_id", "c.id")
    .leftJoin("gate_condition_escalation as e", "e.gate_decision_condition_id", "c.id")
    .select([
      "c.id",
      "c.gate_decision_id",
      "d.gate_code",
      "c.ordinal",
      "c.condition_text",
      "c.owner_user_id",
      sql<string>`c.due_date::text`.as("due_date"),
      STATUS.as("status"),
      "z.created_at as closed_at",
      "z.closed_by",
      "z.closure_note",
      "z.evidence_id",
      "e.created_at as escalated_at",
      "e.escalated_to_user_id",
    ])
    .where("c.transformation_id", "=", transformationId);
}

type ConditionRow = Awaited<ReturnType<ReturnType<typeof conditionQuery>["execute"]>>[number];

const toTracked = (r: ConditionRow): TrackedGateCondition => ({
  id: r.id,
  gateDecisionId: r.gate_decision_id,
  gateCode: r.gate_code,
  ordinal: r.ordinal,
  conditionText: r.condition_text,
  ownerUserId: r.owner_user_id,
  dueDate: r.due_date,
  status: r.status,
  closedAt: isoOrNull(r.closed_at),
  closedBy: r.closed_by,
  closureNote: r.closure_note,
  evidenceId: r.evidence_id,
  escalatedAt: isoOrNull(r.escalated_at),
  escalatedToUserId: r.escalated_to_user_id,
});

export async function loadTrackedCondition(
  db: DbOrTx,
  transformationId: string,
  conditionId: string,
): Promise<TrackedGateCondition | null> {
  const row = await conditionQuery(db, transformationId).where("c.id", "=", conditionId).executeTakeFirst();
  return row === undefined ? null : toTracked(row);
}

const transformationParams = z.strictObject({ transformationId: uuid });
const conditionParams = z.strictObject({ transformationId: uuid, conditionId: uuid });
const listQuery = z.strictObject({
  cursor: cursorSchema,
  limit: limitSchema,
  status: z.enum(["open", "overdue", "closed"]).optional(),
});

export function registerGateConditionRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  const LIST = "/api/v1/transformations/:transformationId/gate-conditions";
  const CLOSE = `${LIST}/:conditionId/close`;

  app.get(LIST, { config: { access: { permission: "transformation.read" } } }, async (request) => {
    const { transformationId } = parse(transformationParams, request.params, "params");
    const query = parseQuery(listQuery, request.query);
    await requireTransformationRead(db, principalOf(request), transformationId);
    const hash = filterHash({ transformationId, status: query.status ?? null });
    const after = decodeCursor(query.cursor, hash, 2);
    let q = conditionQuery(db, transformationId);
    if (query.status !== undefined) q = q.where(sql<boolean>`${STATUS} = ${query.status}`);
    if (after) q = q.where(sql<boolean>`(c.due_date, c.id) > (${String(after[0])}::date, ${String(after[1])}::uuid)`);
    const rows = await q
      .orderBy("c.due_date")
      .orderBy("c.id")
      .limit(query.limit + 1)
      .execute();
    const page = paginate(rows, query.limit, (r) => [r.due_date, r.id], hash);
    return { items: page.items.map(toTracked), nextCursor: page.nextCursor };
  });

  app.post(
    CLOSE,
    { config: { access: { permission: "gate_condition.close" }, consumes: JSON_BODY } },
    async (request, reply) => {
      const { transformationId, conditionId } = parse(conditionParams, request.params, "params");
      const body = parseBody(gateConditionClose, request.body);
      await db.transaction().execute(async (tx) => {
        await requireTransformationRead(tx, principalOf(request), transformationId);
        const fresh = await refreshPrincipal(tx, request);
        let target: ResolvedTarget;
        try {
          target = await requireTransformationRead(tx, fresh, transformationId);
          await requireAction(tx, fresh, "gate_condition.close", target);
        } catch (err) {
          throw commitTimeDenial(err);
        }
        const c = await tx
          .selectFrom("gate_decision_condition")
          .selectAll()
          .where("id", "=", conditionId)
          .where("transformation_id", "=", transformationId)
          .executeTakeFirst();
        if (!c) throw problems.notFound();
        if (fresh.userId !== c.owner_user_id)
          throw gateConditionRefusals.notOwner().withDenial(denialOf("gate_condition.close", target));
        const closed = await tx
          .selectFrom("gate_condition_closure")
          .select("id")
          .where("gate_decision_condition_id", "=", c.id)
          .executeTakeFirst();
        if (closed) throw gateConditionRefusals.alreadyClosed();
        if (body.evidenceId !== undefined) {
          const ev = await tx
            .selectFrom("evidence")
            .select("id")
            .where("id", "=", body.evidenceId)
            .where("transformation_id", "=", transformationId)
            .executeTakeFirst();
          if (!ev)
            throw problems.validation([
              {
                pointer: "/evidenceId",
                code: "validation.reference",
                message: "Choose evidence of this transformation.",
              },
            ]);
        }
        const id = uuidv7();
        const audit = auditContextOf(request);
        await tx
          .insertInto("gate_condition_closure")
          .values({
            id,
            organization_id: c.organization_id,
            transformation_id: transformationId,
            gate_decision_condition_id: c.id,
            closure_note: body.note,
            evidence_id: body.evidenceId ?? null,
            closed_by: fresh.userId,
          })
          .execute()
          .catch((err: unknown) => {
            // A concurrent closure of the same condition (UNIQUE gate_condition_closure_once_key).
            if ((err as { constraint?: string } | null)?.constraint === "gate_condition_closure_once_key")
              throw gateConditionRefusals.alreadyClosed();
            throw err;
          });
        await record(tx, audit, {
          action: "gate_condition_closure.create",
          recordType: "gate_condition_closure",
          recordId: id,
          organizationId: c.organization_id,
          transformationId,
          newVersion: 1,
          changes: {
            gate_decision_condition_id: { from: null, to: c.id },
            evidence_id: { from: null, to: body.evidenceId ?? null },
            closed_by: { from: null, to: fresh.userId },
          },
        });
        await closeWorkItemsOfSubject(
          tx,
          { actorType: "user", actorUserId: fresh.userId, requestId: audit.requestId, source: "api" },
          {
            organizationId: c.organization_id,
            subjectType: "gate_decision_condition",
            subjectId: c.id,
            kinds: CONDITION_ITEM_KINDS,
          },
          "done",
        );
      });
      const view = await loadTrackedCondition(db, transformationId, conditionId);
      return reply
        .status(201)
        .header("location", `/api/v1/transformations/${transformationId}/gate-conditions?status=closed`)
        .send(view);
    },
  );

  return [`GET ${LIST}`, `POST ${CLOSE}`];
}
