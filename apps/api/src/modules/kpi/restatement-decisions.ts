// The decision of a KPI restatement (ADR-0047 §2 "Authority", §3 item 1, §6-§8; M0163 "authority"; REQ-S07-016;
// D-142 Q10; p5-work-split §G.2; T-DG5-KBE-E2):
//   POST /transformations/{t}/kpi-restatements/{r}/decision     approve or reject a submitted restatement
//
// - Authority: the decider holds `kpi_restatement.approve` (a business_approval code: SP, BO and FIN by default) in
//   THIS transformation, re-checked inside the transaction on the commit-time principal; otherwise 403
//   kpi_restatement.no_authority ("a restatement of Q1 without authority is rejected"). The requester never decides
//   their own restatement: 403 kpi_restatement.self_decision (the database CHECK kpi_restatement_sod is the backstop).
//   Both refusals write nothing but the failed-mutation audit every 403 carries (ADR-0004).
// - The decision records `authority_permission` (always kpi_restatement.approve) and `authority_role_code`: the role of
//   the decider's grant through which the right applies to the transformation (the first in role-code order when
//   several apply, so the record is deterministic).
// - Order of the checks: body (400) -> record (404) -> If-Match (409) -> authority (403 no_authority) -> requester
//   (403 self_decision) -> status (422 not_submitted) -> note (422 note_required).
// - One transaction under the `kpiRestatement` advisory lock (key: the KPI, the lock the 0085 guard also takes):
//   the status and decision columns, exactly one audit event `kpi_restatement.decide` on the restatement, the open
//   decision tasks completed (ADR-0047 §3 item 1; each with its own work_item event), and on approval the outbox event
//   `kpi_restatement.approved` v1 (key `kpi_restatement.approved:<id>`), which the worker consumes once to write the
//   one restatement calculation run and the reissue offers (apps/worker/src/handlers/kpi.ts). No remote I/O inside.
// - A decision is a business approval made by a person inside the product. No agent, seed or job decides one, and
//   nothing here reads or writes the engineering gates DG0-DG7.
import { diffFields, sql, type KpiRestatementRow } from "@mth/db";
import { kpiRestatementDecision, outboxPayloadSchema, type KpiRestatementDecision } from "@mth/shared/schemas";
import type { FastifyInstance } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { authorize, grantApplies } from "../access/index.ts";
import { record } from "../audit/index.ts";
import { parse, parseBody, problems, requireIfMatch, sendVersioned, type ModuleDeps } from "../platform/index.ts";
import { closeWorkItemsOfSubject } from "../tasks/index.ts";
import { openWrite, type WriteContext } from "../transformations/index.ts";
import { DECIDE_KIND, lockKpiRestatements, periodsOf, restatementRefusals, toKpiRestatement } from "./restatements.ts";

const JSON_BODY = ["application/json"] as const;
const DECISION = "/api/v1/transformations/:transformationId/kpi-restatements/:restatementId/decision";
const APPROVE = "kpi_restatement.approve" as const;
/** The outbox event of an approval (ADR-0047 §7), consumed once by the worker's kpi.recalculate queue. */
export const RESTATEMENT_APPROVED_EVENT = "kpi_restatement.approved";

const itemParams = z.strictObject({ transformationId: z.uuid(), restatementId: z.uuid() });

const DECISION_AUDIT_FIELDS = [
  "status",
  "decided_by",
  "decided_at",
  "decision_note",
  "authority_permission",
  "authority_role_code",
] as const satisfies readonly (keyof KpiRestatementRow)[];

const actor = (ctx: WriteContext) =>
  ({ actorType: "user", actorUserId: ctx.userId, requestId: ctx.audit.requestId, source: "api" }) as const;

/**
 * The role through which the principal holds kpi_restatement.approve on the transformation, or null when no grant
 * applies (one policy decision is consulted, so the decision is counted and audited like any other).
 */
async function authorityRole(ctx: WriteContext): Promise<string | null> {
  const d = await authorize(ctx.tx, ctx.principal, APPROVE, ctx.target);
  if (!d.allowed) return null;
  const roles = ctx.principal.grants
    .filter((g) => grantApplies(g, APPROVE, ctx.target))
    .map((g) => g.roleCode)
    .sort();
  return roles[0] ?? null;
}

async function decideRestatement(
  ctx: WriteContext,
  id: string,
  expected: number,
  b: KpiRestatementDecision,
): Promise<KpiRestatementRow> {
  const { tx } = ctx;
  const probe = await tx
    .selectFrom("kpi_restatement")
    .select("kpi_definition_id")
    .where("transformation_id", "=", ctx.transformationId)
    .where("id", "=", id)
    .executeTakeFirst();
  if (!probe) throw problems.notFound();
  await lockKpiRestatements(tx, probe.kpi_definition_id);
  const current = await tx
    .selectFrom("kpi_restatement")
    .selectAll()
    .where("id", "=", id)
    .forUpdate()
    .executeTakeFirstOrThrow();
  if (current.version !== expected) throw problems.versionConflict(current.version);
  const denial = {
    permission: APPROVE,
    recordType: "kpi_restatement",
    recordId: current.id,
    organizationId: ctx.organizationId,
    transformationId: ctx.transformationId,
  } as const;
  const roleCode = await authorityRole(ctx);
  if (roleCode === null) throw restatementRefusals.noAuthority().withDenial(denial);
  if (current.requested_by === ctx.userId) throw restatementRefusals.selfDecision().withDenial(denial);
  if (current.status !== "submitted") throw restatementRefusals.notSubmitted();
  const note = b.note ?? null;
  if (b.decision === "reject" && note === null) throw restatementRefusals.noteRequired();
  const updated = await tx
    .updateTable("kpi_restatement")
    .set({
      status: b.decision === "approve" ? "approved" : "rejected",
      decided_by: ctx.userId,
      decided_at: sql<Date>`now()`,
      decision_note: note,
      authority_permission: APPROVE,
      authority_role_code: roleCode,
      version: sql<number>`version + 1`,
      updated_at: sql<Date>`now()`,
      updated_by: ctx.userId,
    })
    .where("id", "=", current.id)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: "kpi_restatement.decide",
    recordType: "kpi_restatement",
    recordId: updated.id,
    organizationId: ctx.organizationId,
    transformationId: ctx.transformationId,
    priorVersion: current.version,
    newVersion: updated.version,
    ...(note !== null ? { reason: note } : {}),
    changes: diffFields(current, updated, [...DECISION_AUDIT_FIELDS]),
  });
  // The decision tasks of every approver are completed by the decision (ADR-0047 §3 item 1: "is completed").
  await closeWorkItemsOfSubject(
    tx,
    actor(ctx),
    { organizationId: ctx.organizationId, subjectType: "kpi_restatement", subjectId: current.id, kinds: [DECIDE_KIND] },
    "done",
  );
  if (updated.status === "approved") {
    const schema = outboxPayloadSchema(RESTATEMENT_APPROVED_EVENT, 1);
    if (!schema) throw new Error(`outbox: no schema for ${RESTATEMENT_APPROVED_EVENT} v1`);
    const payload = schema.parse({
      restatementId: updated.id,
      kpiDefinitionId: updated.kpi_definition_id,
      transformationId: updated.transformation_id,
    });
    await tx
      .insertInto("outbox_event")
      .values({
        id: uuidv7(),
        organization_id: updated.organization_id,
        aggregate_type: "kpi_restatement",
        aggregate_id: updated.id,
        event_type: RESTATEMENT_APPROVED_EVENT,
        schema_version: 1,
        payload: JSON.stringify(payload),
        idempotency_key: `${RESTATEMENT_APPROVED_EVENT}:${updated.id}`,
      })
      .execute();
  }
  return updated;
}

/** Registers decideKpiRestatement and returns it as "METHOD /path" (called from restatements.ts). */
export function registerKpiRestatementDecisionRoutes(app: FastifyInstance, deps: ModuleDeps): string[] {
  const { db } = deps;
  app.post(DECISION, { config: { access: { permission: APPROVE }, consumes: JSON_BODY } }, async (request, reply) => {
    const { transformationId, restatementId } = parse(itemParams, request.params, "params");
    const body = await db.transaction().execute(async (tx) => {
      // Read access to the transformation is the gate here (404 outside it); the approval right itself is checked on
      // the record below, so a reader without it gets the slice's own 403 kpi_restatement.no_authority.
      const ctx = await openWrite(tx, request, transformationId, [{ permission: "transformation.read" }], null, {
        atCommit: true,
        technicalAdminRefusal: APPROVE,
      });
      const b = parseBody(kpiRestatementDecision, request.body);
      const expected = requireIfMatch(request);
      const row = await decideRestatement(ctx, restatementId, expected, b);
      return toKpiRestatement(row, (await periodsOf(tx, [row.id])).get(row.id)!);
    });
    return sendVersioned(reply, 200, body);
  });
  return [`POST ${DECISION}`];
}
