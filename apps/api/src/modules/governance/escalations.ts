// Escalations (OpenAPI tag "escalations"; ADR-0032 §7, §8, §9, §11; REQ-S12-011, REQ-PB-082; T-DG4-BE-G):
//   GET   /transformations/{id}/escalations                                decision-SLA escalations (transformation.read)
//   GET   /transformations/{id}/escalation-rules                           both rules in force; isDefault without a row
//   POST  /transformations/{id}/escalation-rules                           store the rule of a kind (escalation_rule.configure)
//   PATCH /transformations/{id}/escalation-rules/{ruleKind}                change a stored rule (If-Match)
//   GET   /transformations/{id}/meetings/{meetingId}/blocker-statuses      the blocker RAGs of one review cycle
//   POST  /transformations/{id}/meetings/{meetingId}/blocker-statuses      record one (meeting.prepare; append-only)
//
// Escalations are written by the worker only (`governance.decision_sla_scan`, apps/worker/src/handlers/escalations.ts):
// this file reads them. Recording a blocker's RAG writes the observation, its audit event and the outbox event
// `blocker_status.recorded` in one transaction; the consumer `governance.blocker_escalation` evaluates the red-cycles
// rule (ADR-0032 §8.3). An escalation or a rule never decides anything, and nothing here touches DG0-DG7.
import type { BlockerStatusRow, DecisionEscalationRow, Tx } from "@mth/db";
import { sql } from "@mth/db";
import {
  blockerStatusCreate,
  decisionEscalationListQuery,
  escalationRuleCreate,
  escalationRuleKind,
  escalationRuleUpdate,
  uuid,
  type BlockerRecordType,
  type BlockerStatus,
  type DecisionEscalation,
  type EscalationRuleKind,
} from "@mth/shared/schemas";
import type { FastifyInstance } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { auditContextOf, principalOf, requireTransformationRead } from "../access/index.ts";
import { record } from "../audit/index.ts";
import { enqueueOutboxEvent } from "../jobs/index.ts";
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
  requireIfMatch,
  sendVersioned,
  type ModuleDeps,
} from "../platform/index.ts";
import { blockerExists } from "./blocker-escalation.ts";
import { escalationRulesInForce, toEscalationRule } from "./escalation-rules.ts";
import { requireT16Action } from "./executive-decisions.ts";
import { forumRefusals } from "./forums.ts";
import { loadMeeting } from "./meetings.ts";

const JSON_BODY = ["application/json"] as const;
const CONFIGURE = "escalation_rule.configure" as const;
const PREPARE = "meeting.prepare" as const;
export const BLOCKER_STATUS_RECORDED = "blocker_status.recorded";

const transformationParams = z.strictObject({ transformationId: uuid });
const ruleParams = z.strictObject({ transformationId: uuid, ruleKind: escalationRuleKind });
const meetingParams = z.strictObject({ transformationId: uuid, meetingId: uuid });
const pageQuery = { cursor: cursorSchema, limit: limitSchema };

// ------------------------------------------------------------------------------------------------ refusals (S-11)

/** ADR-0032 §11, escalation-rule and blocker-status lines: exact codes and English texts. */
export const escalationRefusals = {
  ruleExists: () =>
    problems.duplicate(
      "escalation_rule.exists",
      "A rule of this kind already exists in this transformation; update it instead.",
    ),
  ruleShape: () =>
    problems.businessRule(
      "escalation_rule.shape",
      "A decision-SLA rule takes an escalation chain only; a blocker rule takes red cycles (2–12), a deadline in working days and an owner role.",
    ),
  blockerStatusExists: () =>
    problems.duplicate("blocker_status.exists", "A RAG for this blocker is already recorded in this meeting."),
  blockerNotFound: () =>
    new HttpProblem({
      status: 422,
      type: "urn:mth:problem:validation",
      code: "blocker_status.record_not_found",
      title: "Business rule violated",
      detail: "The blocker does not exist in this transformation.",
      errors: [
        {
          pointer: "/sourceRecordId",
          code: "blocker_status.record_not_found",
          message: "The blocker does not exist in this transformation.",
        },
      ],
    }),
  notInSession: () =>
    problems.businessRule(
      "meeting.not_in_session",
      "Decisions and blocker status are recorded while the meeting is in session or held.",
    ),
  meetingFrozen: (status: string) =>
    problems.businessRule("meeting.frozen", `This meeting is ${status}; its records can no longer be changed.`),
} as const;

// ------------------------------------------------------------------------------------------------ mapping

export const toDecisionEscalation = (r: DecisionEscalationRow, decisionCode: string): DecisionEscalation => ({
  id: r.id,
  decisionId: r.decision_id,
  decisionCode,
  slaDueDate: r.sla_due_date,
  businessDate: r.business_date,
  level: r.level,
  partyCode: r.party_code,
  targetUserId: r.target_user_id,
  targetGroupId: r.target_group_id,
  routingError: r.routing_error as DecisionEscalation["routingError"],
  delayImpact: r.delay_impact,
  escalatedAt: iso(r.escalated_at),
});

export const toBlockerStatus = (r: BlockerStatusRow): BlockerStatus => ({
  id: r.id,
  meetingId: r.meeting_id,
  forumId: r.forum_id,
  cycleDate: r.cycle_date,
  sourceRecordType: r.source_record_type as BlockerRecordType,
  sourceRecordId: r.source_record_id,
  rag: r.rag as BlockerStatus["rag"],
  note: r.note,
  createdAt: iso(r.created_at),
  createdBy: r.created_by,
});

// ------------------------------------------------------------------------------------------------ rule checks

interface RuleShape {
  readonly escalationChain?: readonly string[] | undefined;
  readonly redCycles?: number | undefined;
  readonly deadlineWorkingDays?: number | undefined;
  readonly ownerPartyCode?: string | undefined;
}

/** ADR-0032 §8.1 shape: decision_sla takes a chain only; blocker_red takes cycles, deadline and owner only. */
function checkShape(kind: EscalationRuleKind, r: RuleShape, complete: boolean): void {
  const blockerFields = [r.redCycles, r.deadlineWorkingDays, r.ownerPartyCode];
  if (kind === "decision_sla") {
    if (blockerFields.some((v) => v !== undefined)) throw escalationRefusals.ruleShape();
    if (complete && r.escalationChain === undefined) throw escalationRefusals.ruleShape();
  } else {
    if (r.escalationChain !== undefined) throw escalationRefusals.ruleShape();
    if (complete && blockerFields.some((v) => v === undefined)) throw escalationRefusals.ruleShape();
  }
}

/** Every named party must be a known governance party (422 forum.party_unknown with the first unknown one). */
async function checkParties(tx: Tx, r: RuleShape): Promise<void> {
  const named: [string, string][] = [
    ...(r.escalationChain ?? []).map((p, i) => [p, `/escalationChain/${i}`] as [string, string]),
    ...(r.ownerPartyCode !== undefined ? [[r.ownerPartyCode, "/ownerPartyCode"] as [string, string]] : []),
  ];
  if (named.length === 0) return;
  const known = new Set(
    (
      await tx
        .selectFrom("governance_party")
        .select("code")
        .where(
          "code",
          "in",
          named.map(([p]) => p),
        )
        .execute()
    ).map((x) => x.code),
  );
  const bad = named.find(([p]) => !known.has(p));
  if (bad) throw forumRefusals.partyUnknown(bad[0], bad[1]);
}

// ------------------------------------------------------------------------------------------------ routes

export function registerEscalationRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  const T = "/api/v1/transformations/:transformationId";
  const ESCALATIONS = `${T}/escalations`;
  const RULES = `${T}/escalation-rules`;
  const RULE = `${RULES}/:ruleKind`;
  const STATUSES = `${T}/meetings/:meetingId/blocker-statuses`;
  const read = { access: { permission: "transformation.read" as const } };

  app.get(ESCALATIONS, { config: read }, async (request) => {
    const { transformationId } = parse(transformationParams, request.params, "params");
    const query = parseQuery(decisionEscalationListQuery.extend(pageQuery), request.query);
    await requireTransformationRead(db, principalOf(request), transformationId);
    const hash = filterHash({ transformationId, decisionId: query.decisionId ?? null });
    const after = decodeCursor(query.cursor, hash, 1);
    let q = db
      .selectFrom("decision_escalation as e")
      .innerJoin("decision as d", "d.id", "e.decision_id")
      .selectAll("e")
      .select("d.code as decision_code")
      .where("e.transformation_id", "=", transformationId);
    if (query.decisionId !== undefined) q = q.where("e.decision_id", "=", query.decisionId);
    if (after) q = q.where("e.id", "<", String(after[0]));
    const rows = await q
      .orderBy("e.id", "desc")
      .limit(query.limit + 1)
      .execute();
    const page = paginate(rows, query.limit, (r) => [r.id], hash);
    return { items: page.items.map((r) => toDecisionEscalation(r, r.decision_code)), nextCursor: page.nextCursor };
  });

  app.get(RULES, { config: read }, async (request) => {
    const { transformationId } = parse(transformationParams, request.params, "params");
    parseQuery(z.strictObject(pageQuery), request.query);
    await requireTransformationRead(db, principalOf(request), transformationId);
    // Two kinds at most: one page, never a cursor.
    return { items: await escalationRulesInForce(db, transformationId), nextCursor: null };
  });

  app.post(RULES, { config: { access: { permission: CONFIGURE }, consumes: JSON_BODY } }, async (request, reply) => {
    const { transformationId } = parse(transformationParams, request.params, "params");
    const body = parseBody(escalationRuleCreate, request.body);
    const row = await db.transaction().execute(async (tx) => {
      const { userId, target } = await requireT16Action(tx, request, transformationId, CONFIGURE);
      checkShape(body.ruleKind, body, true);
      await checkParties(tx, body);
      const existing = await tx
        .selectFrom("governance_escalation_rule")
        .select("id")
        .where("transformation_id", "=", transformationId)
        .where("rule_kind", "=", body.ruleKind)
        .executeTakeFirst();
      if (existing) throw escalationRefusals.ruleExists();
      const id = uuidv7();
      const inserted = await tx
        .insertInto("governance_escalation_rule")
        .values({
          id,
          organization_id: target.organizationId,
          transformation_id: transformationId,
          rule_kind: body.ruleKind,
          enabled: body.enabled ?? true,
          escalation_chain: body.escalationChain ?? null,
          red_cycles: body.redCycles ?? null,
          deadline_working_days: body.deadlineWorkingDays ?? null,
          owner_party_code: body.ownerPartyCode ?? null,
          created_by: userId,
          updated_by: userId,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await record(tx, auditContextOf(request), {
        action: "escalation_rule.create",
        recordType: "governance_escalation_rule",
        recordId: id,
        organizationId: target.organizationId,
        transformationId,
        newVersion: 1,
        changes: {
          rule_kind: { from: null, to: inserted.rule_kind },
          enabled: { from: null, to: inserted.enabled },
          escalation_chain: { from: null, to: inserted.escalation_chain },
          red_cycles: { from: null, to: inserted.red_cycles },
          deadline_working_days: { from: null, to: inserted.deadline_working_days },
          owner_party_code: { from: null, to: inserted.owner_party_code },
        },
      });
      return inserted;
    });
    return sendVersioned(
      reply,
      201,
      { ...toEscalationRule(row), version: row.version },
      `/api/v1/transformations/${transformationId}/escalation-rules/${row.rule_kind}`,
    );
  });

  app.patch(RULE, { config: { access: { permission: CONFIGURE }, consumes: JSON_BODY } }, async (request, reply) => {
    const { transformationId, ruleKind } = parse(ruleParams, request.params, "params");
    const body = parseBody(escalationRuleUpdate, request.body);
    const row = await db.transaction().execute(async (tx) => {
      const { userId } = await requireT16Action(tx, request, transformationId, CONFIGURE);
      const expected = requireIfMatch(request);
      const current = await tx
        .selectFrom("governance_escalation_rule")
        .selectAll()
        .where("transformation_id", "=", transformationId)
        .where("rule_kind", "=", ruleKind)
        .forUpdate()
        .executeTakeFirst();
      if (!current) throw problems.notFound();
      if (current.version !== expected) throw problems.versionConflict(current.version);
      checkShape(ruleKind, body, false);
      await checkParties(tx, body);
      const updated = await tx
        .updateTable("governance_escalation_rule")
        .set({
          ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
          ...(body.escalationChain !== undefined ? { escalation_chain: body.escalationChain } : {}),
          ...(body.redCycles !== undefined ? { red_cycles: body.redCycles } : {}),
          ...(body.deadlineWorkingDays !== undefined ? { deadline_working_days: body.deadlineWorkingDays } : {}),
          ...(body.ownerPartyCode !== undefined ? { owner_party_code: body.ownerPartyCode } : {}),
          version: sql<number>`version + 1`,
          updated_at: sql<Date>`now()`,
          updated_by: userId,
        })
        .where("id", "=", current.id)
        .where("version", "=", current.version)
        .returningAll()
        .executeTakeFirst();
      if (!updated) throw problems.versionConflict(current.version + 1);
      const changes: Record<string, { from: unknown; to: unknown }> = {};
      const pairs: [string, unknown, unknown][] = [
        ["enabled", current.enabled, updated.enabled],
        ["escalation_chain", current.escalation_chain?.join(",") ?? null, updated.escalation_chain?.join(",") ?? null],
        ["red_cycles", current.red_cycles, updated.red_cycles],
        ["deadline_working_days", current.deadline_working_days, updated.deadline_working_days],
        ["owner_party_code", current.owner_party_code, updated.owner_party_code],
      ];
      for (const [k, from, to] of pairs) if (from !== to) changes[k] = { from, to };
      await record(tx, auditContextOf(request), {
        action: "escalation_rule.update",
        recordType: "governance_escalation_rule",
        recordId: current.id,
        organizationId: current.organization_id,
        transformationId,
        priorVersion: current.version,
        newVersion: updated.version,
        changes,
      });
      return updated;
    });
    return sendVersioned(reply, 200, { ...toEscalationRule(row), version: row.version });
  });

  app.get(STATUSES, { config: read }, async (request) => {
    const { transformationId, meetingId } = parse(meetingParams, request.params, "params");
    const query = parseQuery(z.strictObject(pageQuery), request.query);
    await requireTransformationRead(db, principalOf(request), transformationId);
    await loadMeeting(db, transformationId, meetingId);
    const hash = filterHash({ transformationId, meetingId });
    const after = decodeCursor(query.cursor, hash, 1);
    let q = db.selectFrom("blocker_status").selectAll().where("meeting_id", "=", meetingId);
    if (after) q = q.where("id", ">", String(after[0]));
    const rows = await q
      .orderBy("id")
      .limit(query.limit + 1)
      .execute();
    const page = paginate(rows, query.limit, (r) => [r.id], hash);
    return { items: page.items.map(toBlockerStatus), nextCursor: page.nextCursor };
  });

  app.post(STATUSES, { config: { access: { permission: PREPARE }, consumes: JSON_BODY } }, async (request, reply) => {
    const { transformationId, meetingId } = parse(meetingParams, request.params, "params");
    const body = parseBody(blockerStatusCreate, request.body);
    const row = await db.transaction().execute(async (tx) => {
      const { userId, target } = await requireT16Action(tx, request, transformationId, PREPARE);
      const meeting = await tx
        .selectFrom("meeting")
        .selectAll()
        .where("id", "=", meetingId)
        .where("transformation_id", "=", transformationId)
        .forShare()
        .executeTakeFirst();
      if (!meeting) throw problems.notFound();
      if (meeting.status === "minutes_published" || meeting.status === "cancelled")
        throw escalationRefusals.meetingFrozen(meeting.status);
      if (meeting.status !== "in_session" && meeting.status !== "held") throw escalationRefusals.notInSession();
      if (!(await blockerExists(tx, transformationId, body.sourceRecordType, body.sourceRecordId)))
        throw escalationRefusals.blockerNotFound();
      const dup = await tx
        .selectFrom("blocker_status")
        .select("id")
        .where("meeting_id", "=", meetingId)
        .where("source_record_type", "=", body.sourceRecordType)
        .where("source_record_id", "=", body.sourceRecordId)
        .executeTakeFirst();
      if (dup) throw escalationRefusals.blockerStatusExists();
      const id = uuidv7();
      const inserted = await tx
        .insertInto("blocker_status")
        .values({
          id,
          organization_id: target.organizationId,
          transformation_id: transformationId,
          meeting_id: meetingId,
          forum_id: meeting.forum_id,
          cycle_date: meeting.scheduled_date,
          source_record_type: body.sourceRecordType,
          source_record_id: body.sourceRecordId,
          rag: body.rag,
          note: body.note ?? null,
          created_by: userId,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await record(tx, auditContextOf(request), {
        action: "blocker_status.create",
        recordType: "blocker_status",
        recordId: id,
        organizationId: target.organizationId,
        transformationId,
        changes: {
          meeting_id: { from: null, to: meetingId },
          source_record_type: { from: null, to: body.sourceRecordType },
          source_record_id: { from: null, to: body.sourceRecordId },
          rag: { from: null, to: body.rag },
        },
      });
      // ADR-0032 §8.3: the consumer governance.blocker_escalation evaluates the red-cycles rule (ADR-0031 §5.4 payload
      // conventions; one event per observation).
      await enqueueOutboxEvent(tx, {
        organizationId: target.organizationId,
        aggregateType: "blocker_status",
        aggregateId: id,
        eventType: BLOCKER_STATUS_RECORDED,
        schemaVersion: 1,
        payload: {
          blockerStatusId: id,
          transformationId,
          forumId: meeting.forum_id,
          meetingId,
          cycleDate: meeting.scheduled_date,
          sourceRecordType: body.sourceRecordType,
          sourceRecordId: body.sourceRecordId,
          rag: body.rag,
        },
        idempotencyKey: `${BLOCKER_STATUS_RECORDED}:${id}`,
      });
      return inserted;
    });
    reply.header("Location", `/api/v1/transformations/${transformationId}/meetings/${meetingId}/blocker-statuses`);
    return reply.code(201).send(toBlockerStatus(row));
  });

  return [
    `GET ${ESCALATIONS}`,
    `GET ${RULES}`,
    `POST ${RULES}`,
    `PATCH ${RULE}`,
    `GET ${STATUSES}`,
    `POST ${STATUSES}`,
  ];
}
