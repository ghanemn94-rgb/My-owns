// T11 Decision Rights Matrix (OpenAPI tag "decision-rights"; ADR-0026 §5; D-089 Q6, Q7; REQ-PB-065, REQ-PB-066;
// T-DG4-BE-C):
//   GET   /decision-right-templates                                   the four B0099 rows, verbatim (signed in)
//   GET   /transformations/{id}/decision-rights                       the transformation's copy (transformation.read)
//   POST  /transformations/{id}/decision-rights                       add a row (decision_right.configure; TO, TL)
//   GET   /transformations/{id}/decision-rights/{rowId}               one row
//   PATCH /transformations/{id}/decision-rights/{rowId}               edit the copy (If-Match); the template never changes
//   GET   /transformations/{id}/decision-rights/{rowId}/due-date      the due date a request raised on a date would get
//
// Routing (`routeByDecisionRight`): the active row's Approve party, resolved through role mapping with NO fallback
// (422 routing.role_unmapped / routing.assignee_not_approver), with its SLA and escalation chain. It is registered with
// the approval service (`setDecisionRightRouter`), so every `decision_request` approval is routed and dated here.
//
// SLA types (D-089 Q6), computed when an approval is requested:
//   working_days            addWorkingDays over the organization's default business calendar (Asia/Riyadh default,
//                           configurable workweek and holidays); never elapsed calendar days. Unknown when no calendar.
//   next_steerco_or_urgent  the next scheduled Executive SteerCo of the transformation, from the NextForumDateProvider
//                           (slice D implements it; until then it answers "none", so the due date is Unknown
//                           `no_steerco_scheduled`, never guessed); or, urgent with a reason, urgent_working_days.
//   release_plan            the approved date of the named milestone; Unknown `no_release_date` otherwise.
// Business approvals routed here are decided by named people; a timer may escalate, never approve. Nothing here
// touches DG0-DG7.
import type { DbOrTx, DecisionRightTemplateRow, Tx, TransformationDecisionRightRow } from "@mth/db";
import { sql } from "@mth/db";
import {
  decisionRightCreate,
  decisionRightUpdate,
  dueDatePreviewQuery,
  uuid,
  type DecisionRight,
  type DecisionRightTemplate,
  type DueDatePreview,
} from "@mth/shared/schemas";
import type { FastifyInstance } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import {
  auditContextOf,
  principalOf,
  requireTransformationRead,
  resolveTarget,
  routeToParty,
  type RoutedParty,
} from "../access/index.ts";
import { record } from "../audit/index.ts";
import { computeWorkingDayDueDate } from "../organization/index.ts";
import {
  cursorSchema,
  decodeCursor,
  HttpProblem,
  limitSchema,
  filterHash,
  iso,
  paginate,
  parse,
  parseBody,
  parseQuery,
  problems,
  requireIfMatch,
  sendVersioned,
  type ModuleDeps,
} from "../platform/index.ts";
import {
  setDecisionRightRouter,
  type DecisionRightRequest,
  type DecisionRightRouter,
  type DecisionRightRouting,
  type DueDate,
} from "../workflows/index.ts";
import { requireGovernanceWrite, reviseMatrix } from "./matrices.ts";

const JSON_BODY = ["application/json"] as const;
const CONFIGURE = "decision_right.configure" as const;
type SlaType = DecisionRightRouting["slaType"];

const transformationParams = z.strictObject({ transformationId: uuid });
const rowParams = z.strictObject({ transformationId: uuid, decisionRightId: uuid });
const listQuery = z.strictObject({ cursor: cursorSchema, limit: limitSchema });

// ------------------------------------------------------------------------------------------------ refusals (S-11)

const rule = (code: string, detail: string, pointer: string) =>
  new HttpProblem({
    status: 422,
    type: "urn:mth:problem:validation",
    code,
    title: "Business rule violated",
    detail,
    errors: [{ pointer, code, message: detail }],
  });

export const decisionRightRefusals = {
  partyUnknown: (party: string, pointer: string) =>
    rule("decision_right.party_unknown", `${party} is not a known governance role.`, pointer),
  slaInvalid: (pointer: string) =>
    rule(
      "decision_right.sla_invalid",
      "A working-days SLA needs a number of working days between 1 and 250; other SLA types take none.",
      pointer,
    ),
  urgentNotConfigured: () =>
    rule(
      "decision_right.urgent_not_configured",
      "This decision has no urgent route configured, so it cannot be raised as urgent.",
      "/urgent",
    ),
  urgentReasonRequired: () =>
    rule("decision_right.urgent_reason_required", "An urgent request needs a reason.", "/urgentReason"),
  unknownRow: () =>
    rule(
      "approval.decision_right_unknown",
      "Choose an active decision right of this transformation.",
      "/decisionRightId",
    ),
} as const;

// ------------------------------------------------------------------------------------------------ next forum (slice D)

/** The next scheduled Executive SteerCo meeting of a transformation on or after a business date (D-089 Q6). */
export interface NextForumDateProvider {
  /** The meeting's business date, or null when none is scheduled (the due date is then Unknown, never guessed). */
  nextSteerCoDate(db: DbOrTx, transformationId: string, onOrAfter: string): Promise<string | null>;
}

/** Until slice D (BE-F) implements meetings, no SteerCo is ever scheduled: the due date is Unknown. */
export const NO_FORUM_DATES: NextForumDateProvider = Object.freeze({ nextSteerCoDate: async () => null });
let nextForumDates: NextForumDateProvider = NO_FORUM_DATES;

/** BE-F wires its meeting-backed provider here (registration time); null restores the default ("none"). */
export function setNextForumDateProvider(provider: NextForumDateProvider | null): void {
  nextForumDates = provider ?? NO_FORUM_DATES;
}

// ------------------------------------------------------------------------------------------------ SLA computation

export interface SlaRequest {
  readonly organizationId: string;
  readonly transformationId: string;
  /** The business date the request is raised on (ADR-0025 §2). */
  readonly raisedOn: string;
  readonly urgent: boolean;
  /** Required with `urgent` on an approval request; the preview passes `undefined` (no reason is asked there). */
  readonly urgentReason: string | null | undefined;
  readonly releaseMilestoneId: string | null;
}

const unknown = (reason: NonNullable<DueDate["unknownReason"]>): DueDate => ({
  dueDate: null,
  unknownReason: reason,
  calendarId: null,
  calendarVersion: null,
});

/** The due date of a request under a T11 row's SLA type (ADR-0026 §5, D-089 Q6). Unknown is null with a reason. */
export async function computeDecisionRightDue(
  db: DbOrTx,
  row: Pick<TransformationDecisionRightRow, "sla_type" | "sla_working_days" | "urgent_working_days">,
  req: SlaRequest,
): Promise<DueDate> {
  const slaType = row.sla_type as SlaType;
  if (req.urgent) {
    if (req.urgentReason === null) throw decisionRightRefusals.urgentReasonRequired();
    if (slaType !== "next_steerco_or_urgent" || row.urgent_working_days === null)
      throw decisionRightRefusals.urgentNotConfigured();
  }
  if (slaType === "working_days") {
    return computeWorkingDayDueDate(db, req.organizationId, req.raisedOn, row.sla_working_days!);
  }
  if (slaType === "next_steerco_or_urgent") {
    if (req.urgent) return computeWorkingDayDueDate(db, req.organizationId, req.raisedOn, row.urgent_working_days!);
    const next = await nextForumDates.nextSteerCoDate(db, req.transformationId, req.raisedOn);
    return next === null
      ? unknown("no_steerco_scheduled")
      : { dueDate: next, unknownReason: null, calendarId: null, calendarVersion: null };
  }
  const m =
    req.releaseMilestoneId === null
      ? undefined
      : await db
          .selectFrom("milestone")
          .select("approved_date")
          .where("id", "=", req.releaseMilestoneId)
          .where("transformation_id", "=", req.transformationId)
          .executeTakeFirst();
  return m?.approved_date
    ? { dueDate: m.approved_date, unknownReason: null, calendarId: null, calendarVersion: null }
    : unknown("no_release_date");
}

// ------------------------------------------------------------------------------------------------ routing

export interface DecisionRightRoute {
  readonly decisionRight: TransformationDecisionRightRow;
  readonly approvePartyCode: string;
  /** The person or group mapped to the Approve party, with the users who can decide. */
  readonly assignee: RoutedParty;
  readonly slaType: SlaType;
  readonly escalationChain: readonly string[];
}

/**
 * Routes a decision by the transformation's active T11 row with that template key (or row id) (ADR-0026 §5): the
 * row's Approve party resolved through role mapping, never a fallback (422 routing.role_unmapped,
 * routing.assignee_not_approver), with its SLA type and escalation chain. Writes nothing. Slice H calls it with
 * 'business_scope_change' for a change request (REQ-PB-065: routed to the Sponsor).
 */
export async function routeByDecisionRight(
  tx: DbOrTx,
  transformationId: string,
  keyOrId: string,
): Promise<DecisionRightRoute> {
  const isId = uuid.safeParse(keyOrId).success;
  const row = await tx
    .selectFrom("transformation_decision_right")
    .selectAll()
    .where("transformation_id", "=", transformationId)
    .where(isId ? "id" : "template_key", "=", keyOrId)
    .where("status", "=", "active")
    .executeTakeFirst();
  if (!row) throw decisionRightRefusals.unknownRow();
  const target = await resolveTarget(tx, { type: "transformation", id: transformationId });
  if (!target) throw problems.notFound();
  const assignee = await routeToParty(tx, { ...target, transformationId }, row.approve_party_code);
  return {
    decisionRight: row,
    approvePartyCode: row.approve_party_code,
    assignee,
    slaType: row.sla_type as SlaType,
    escalationChain: row.escalation_chain,
  };
}

/** The approval service's T11 router (BE-B's seam): the row, its Approve party and its SLA with this module's providers. */
export const decisionRightRouter: DecisionRightRouter = async (tx: Tx, req: DecisionRightRequest) => {
  const row = await tx
    .selectFrom("transformation_decision_right")
    .selectAll()
    .where("id", "=", req.decisionRightId)
    .where("transformation_id", "=", req.transformationId)
    .where("status", "=", "active")
    .executeTakeFirst();
  if (!row) throw decisionRightRefusals.unknownRow();
  const due = await computeDecisionRightDue(tx, row, {
    organizationId: req.organizationId,
    transformationId: req.transformationId,
    raisedOn: req.requestBusinessDate,
    urgent: req.urgent,
    urgentReason: req.urgentReason,
    releaseMilestoneId: req.releaseMilestoneId,
  });
  return {
    decisionRightId: row.id,
    approvePartyCode: row.approve_party_code,
    slaType: row.sla_type as SlaType,
    urgentReason: req.urgent ? req.urgentReason : null,
    due,
  };
};

// ------------------------------------------------------------------------------------------------ mapping

export const toDecisionRightTemplate = (r: DecisionRightTemplateRow): DecisionRightTemplate => ({
  key: r.key,
  ordinal: r.ordinal,
  sourceDecisionEn: r.source_decision_en,
  sourceRecommendEn: r.source_recommend_en,
  sourceApproveEn: r.source_approve_en,
  sourceConsultEn: r.source_consult_en,
  sourceInformEn: r.source_inform_en,
  sourceSlaEn: r.source_sla_en,
  decisionAr: r.decision_ar,
  recommendAr: r.recommend_ar,
  approveAr: r.approve_ar,
  consultAr: r.consult_ar,
  informAr: r.inform_ar,
  slaAr: r.sla_ar,
  recommendParties: r.recommend_parties,
  approvePartyCode: r.approve_party_code,
  consultParties: r.consult_parties,
  informParties: r.inform_parties,
  slaType: r.sla_type as SlaType,
  slaWorkingDays: r.sla_working_days,
  escalationChain: r.escalation_chain,
  sourceRef: r.source_ref,
});

export const toDecisionRight = (r: TransformationDecisionRightRow): DecisionRight => ({
  id: r.id,
  transformationId: r.transformation_id,
  templateKey: r.template_key,
  ordinal: r.ordinal,
  decisionEn: r.decision_en,
  decisionAr: r.decision_ar,
  recommendLabel: r.recommend_label,
  approveLabel: r.approve_label,
  consultLabel: r.consult_label,
  informLabel: r.inform_label,
  slaLabel: r.sla_label,
  recommendParties: r.recommend_parties,
  approvePartyCode: r.approve_party_code,
  consultParties: r.consult_parties,
  informParties: r.inform_parties,
  slaType: r.sla_type as SlaType,
  slaWorkingDays: r.sla_working_days,
  urgentWorkingDays: r.urgent_working_days,
  escalationChain: r.escalation_chain,
  status: r.status as DecisionRight["status"],
  version: r.version,
  createdAt: iso(r.created_at),
  updatedAt: iso(r.updated_at),
});

// ------------------------------------------------------------------------------------------------ validation

interface RowShape {
  recommend_parties: readonly string[];
  approve_party_code: string;
  consult_parties: readonly string[];
  inform_parties: readonly string[];
  escalation_chain: readonly string[];
  sla_type: string;
  sla_working_days: number | null;
  urgent_working_days: number | null;
}

/** Party codes must name known governance parties; SLA fields must match the SLA type (ADR-0026 §5). */
async function validateRow(db: DbOrTx, r: RowShape): Promise<void> {
  const lists: [string, readonly string[]][] = [
    ["/recommendParties", r.recommend_parties],
    ["/approvePartyCode", [r.approve_party_code]],
    ["/consultParties", r.consult_parties],
    ["/informParties", r.inform_parties],
    ["/escalationChain", r.escalation_chain],
  ];
  const all = [...new Set(lists.flatMap(([, codes]) => codes))];
  const known = new Set(
    (await db.selectFrom("governance_party").select("code").where("code", "in", all).execute()).map((p) => p.code),
  );
  for (const [pointer, codes] of lists) {
    const bad = codes.find((c) => !known.has(c));
    if (bad !== undefined) throw decisionRightRefusals.partyUnknown(bad, pointer);
  }
  const inRange = (n: number | null) => n !== null && n >= 1 && n <= 250;
  if (r.sla_type === "working_days" ? !inRange(r.sla_working_days) : r.sla_working_days !== null)
    throw decisionRightRefusals.slaInvalid("/slaWorkingDays");
  if (r.urgent_working_days !== null && (r.sla_type !== "next_steerco_or_urgent" || !inRange(r.urgent_working_days)))
    throw decisionRightRefusals.slaInvalid("/urgentWorkingDays");
}

/** The audited fields of a row, by column name (literal accesses only; F-DG1-124). */
const auditedFields = (r: Partial<TransformationDecisionRightRow>): ReadonlyMap<string, unknown> =>
  new Map<string, unknown>([
    ["ordinal", r.ordinal],
    ["decision_en", r.decision_en],
    ["decision_ar", r.decision_ar],
    ["recommend_label", r.recommend_label],
    ["approve_label", r.approve_label],
    ["consult_label", r.consult_label],
    ["inform_label", r.inform_label],
    ["sla_label", r.sla_label],
    ["recommend_parties", r.recommend_parties],
    ["approve_party_code", r.approve_party_code],
    ["consult_parties", r.consult_parties],
    ["inform_parties", r.inform_parties],
    ["sla_type", r.sla_type],
    ["sla_working_days", r.sla_working_days],
    ["urgent_working_days", r.urgent_working_days],
    ["escalation_chain", r.escalation_chain],
    ["status", r.status],
  ]);

function diff(
  before: Partial<TransformationDecisionRightRow>,
  after: TransformationDecisionRightRow,
): Record<string, { from: unknown; to: unknown }> {
  const b = auditedFields(before);
  const changes: [string, { from: unknown; to: unknown }][] = [];
  for (const [field, value] of auditedFields(after)) {
    const from = b.get(field) ?? null;
    const to = value ?? null;
    if (JSON.stringify(from) !== JSON.stringify(to)) changes.push([field, { from, to }]);
  }
  return Object.fromEntries(changes);
}

// ------------------------------------------------------------------------------------------------ routes

export function registerDecisionRightRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  const TEMPLATES = "/api/v1/decision-right-templates";
  const ROWS = "/api/v1/transformations/:transformationId/decision-rights";
  const ONE = `${ROWS}/:decisionRightId`;
  const DUE = `${ONE}/due-date`;
  const read = { access: { permission: "transformation.read" as const } };
  // The approval service routes and dates every decision_request through this module (BE-B handback §4.3).
  setDecisionRightRouter(decisionRightRouter);

  app.get(TEMPLATES, { config: { access: { permission: "authenticated" } } }, async (request) => {
    principalOf(request);
    parseQuery(z.strictObject({}), request.query);
    const rows = await db.selectFrom("decision_right_template").selectAll().orderBy("ordinal").execute();
    return { items: rows.map(toDecisionRightTemplate) };
  });

  app.get(ROWS, { config: read }, async (request) => {
    const { transformationId } = parse(transformationParams, request.params, "params");
    const query = parseQuery(listQuery, request.query);
    await requireTransformationRead(db, principalOf(request), transformationId);
    const hash = filterHash({ transformationId });
    const after = decodeCursor(query.cursor, hash, 2);
    let q = db
      .selectFrom("transformation_decision_right")
      .selectAll()
      .where("transformation_id", "=", transformationId);
    if (after)
      q = q.where((eb) =>
        eb.or([
          eb("ordinal", ">", Number(after[0])),
          eb.and([eb("ordinal", "=", Number(after[0])), eb("id", ">", String(after[1]))]),
        ]),
      );
    const rows = await q
      .orderBy("ordinal")
      .orderBy("id")
      .limit(query.limit + 1)
      .execute();
    const page = paginate(rows, query.limit, (r) => [r.ordinal, r.id], hash);
    return { items: page.items.map(toDecisionRight), nextCursor: page.nextCursor };
  });

  app.post(ROWS, { config: { access: { permission: CONFIGURE }, consumes: JSON_BODY } }, async (request, reply) => {
    const { transformationId } = parse(transformationParams, request.params, "params");
    const body = parseBody(decisionRightCreate, request.body);
    const row = await db.transaction().execute(async (tx) => {
      const { userId, target } = await requireGovernanceWrite(tx, request, transformationId, CONFIGURE);
      const audit = auditContextOf(request);
      const shape: RowShape = {
        recommend_parties: body.recommendParties ?? [],
        approve_party_code: body.approvePartyCode,
        consult_parties: body.consultParties ?? [],
        inform_parties: body.informParties ?? [],
        escalation_chain: body.escalationChain,
        sla_type: body.slaType,
        sla_working_days: body.slaWorkingDays ?? null,
        urgent_working_days: body.urgentWorkingDays ?? null,
      };
      await validateRow(tx, shape);
      await reviseMatrix(tx, audit, transformationId, "decision_rights", userId);
      const ordinal =
        body.ordinal ??
        Math.min(
          999,
          ((
            await tx
              .selectFrom("transformation_decision_right")
              .select(sql<number | null>`max(ordinal)`.as("m"))
              .where("transformation_id", "=", transformationId)
              .executeTakeFirst()
          )?.m ?? 0) + 1,
        );
      const id = uuidv7();
      const created = await tx
        .insertInto("transformation_decision_right")
        .values({
          id,
          organization_id: target.organizationId,
          transformation_id: transformationId,
          template_key: null,
          ordinal,
          decision_en: body.decisionEn,
          decision_ar: body.decisionAr,
          recommend_label: body.recommendLabel,
          approve_label: body.approveLabel,
          consult_label: body.consultLabel,
          inform_label: body.informLabel,
          sla_label: body.slaLabel,
          recommend_parties: [...shape.recommend_parties],
          approve_party_code: shape.approve_party_code,
          consult_parties: [...shape.consult_parties],
          inform_parties: [...shape.inform_parties],
          sla_type: shape.sla_type,
          sla_working_days: shape.sla_working_days,
          urgent_working_days: shape.urgent_working_days,
          escalation_chain: [...shape.escalation_chain],
          created_by: userId,
          updated_by: userId,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await record(tx, audit, {
        action: "transformation_decision_right.create",
        recordType: "transformation_decision_right",
        recordId: id,
        organizationId: target.organizationId,
        transformationId,
        newVersion: 1,
        changes: diff({}, created),
      });
      return created;
    });
    return sendVersioned(
      reply,
      201,
      toDecisionRight(row),
      `/api/v1/transformations/${transformationId}/decision-rights/${row.id}`,
    );
  });

  app.get(ONE, { config: read }, async (request, reply) => {
    const { transformationId, decisionRightId } = parse(rowParams, request.params, "params");
    await requireTransformationRead(db, principalOf(request), transformationId);
    const row = await db
      .selectFrom("transformation_decision_right")
      .selectAll()
      .where("id", "=", decisionRightId)
      .where("transformation_id", "=", transformationId)
      .executeTakeFirst();
    if (!row) throw problems.notFound();
    return sendVersioned(reply, 200, toDecisionRight(row));
  });

  app.patch(ONE, { config: { access: { permission: CONFIGURE }, consumes: JSON_BODY } }, async (request, reply) => {
    const { transformationId, decisionRightId } = parse(rowParams, request.params, "params");
    const body = parseBody(decisionRightUpdate, request.body);
    const row = await db.transaction().execute(async (tx) => {
      const { userId } = await requireGovernanceWrite(tx, request, transformationId, CONFIGURE);
      const expected = requireIfMatch(request);
      const audit = auditContextOf(request);
      const current = await tx
        .selectFrom("transformation_decision_right")
        .selectAll()
        .where("id", "=", decisionRightId)
        .where("transformation_id", "=", transformationId)
        .executeTakeFirst();
      if (!current) throw problems.notFound();
      if (current.version !== expected) throw problems.versionConflict(current.version);
      const slaType = body.slaType ?? current.sla_type;
      const slaTypeChanged = slaType !== current.sla_type;
      // A field the SLA type no longer takes is cleared when the request changes the type without naming it.
      const shape: RowShape = {
        recommend_parties: body.recommendParties ?? current.recommend_parties,
        approve_party_code: body.approvePartyCode ?? current.approve_party_code,
        consult_parties: body.consultParties ?? current.consult_parties,
        inform_parties: body.informParties ?? current.inform_parties,
        escalation_chain: body.escalationChain ?? current.escalation_chain,
        sla_type: slaType,
        sla_working_days:
          body.slaWorkingDays !== undefined
            ? body.slaWorkingDays
            : slaTypeChanged && slaType !== "working_days"
              ? null
              : current.sla_working_days,
        urgent_working_days:
          body.urgentWorkingDays !== undefined
            ? body.urgentWorkingDays
            : slaTypeChanged && slaType !== "next_steerco_or_urgent"
              ? null
              : current.urgent_working_days,
      };
      await validateRow(tx, shape);
      // The header first (the approvalSubject lock, the in-approval refusal), then the row under its version.
      await reviseMatrix(tx, audit, transformationId, "decision_rights", userId);
      const updated = await tx
        .updateTable("transformation_decision_right")
        .set({
          ...(body.ordinal !== undefined ? { ordinal: body.ordinal } : {}),
          ...(body.decisionEn !== undefined ? { decision_en: body.decisionEn } : {}),
          ...(body.decisionAr !== undefined ? { decision_ar: body.decisionAr } : {}),
          ...(body.recommendLabel !== undefined ? { recommend_label: body.recommendLabel } : {}),
          ...(body.approveLabel !== undefined ? { approve_label: body.approveLabel } : {}),
          ...(body.consultLabel !== undefined ? { consult_label: body.consultLabel } : {}),
          ...(body.informLabel !== undefined ? { inform_label: body.informLabel } : {}),
          ...(body.slaLabel !== undefined ? { sla_label: body.slaLabel } : {}),
          ...(body.status !== undefined ? { status: body.status } : {}),
          recommend_parties: [...shape.recommend_parties],
          approve_party_code: shape.approve_party_code,
          consult_parties: [...shape.consult_parties],
          inform_parties: [...shape.inform_parties],
          escalation_chain: [...shape.escalation_chain],
          sla_type: shape.sla_type,
          sla_working_days: shape.sla_working_days,
          urgent_working_days: shape.urgent_working_days,
          version: sql<number>`version + 1`,
          updated_at: sql<Date>`now()`,
          updated_by: userId,
        })
        .where("id", "=", decisionRightId)
        .where("version", "=", current.version)
        .returningAll()
        .executeTakeFirst();
      if (!updated) throw problems.versionConflict(current.version + 1);
      await record(tx, audit, {
        action: "transformation_decision_right.update",
        recordType: "transformation_decision_right",
        recordId: decisionRightId,
        organizationId: current.organization_id,
        transformationId,
        priorVersion: current.version,
        newVersion: updated.version,
        changes: diff(current, updated),
      });
      return updated;
    });
    return sendVersioned(reply, 200, toDecisionRight(row));
  });

  app.get(DUE, { config: read }, async (request) => {
    const { transformationId, decisionRightId } = parse(rowParams, request.params, "params");
    const query = parseQuery(dueDatePreviewQuery, request.query);
    const target = await requireTransformationRead(db, principalOf(request), transformationId);
    const row = await db
      .selectFrom("transformation_decision_right")
      .selectAll()
      .where("id", "=", decisionRightId)
      .where("transformation_id", "=", transformationId)
      .executeTakeFirst();
    if (!row) throw problems.notFound();
    const due = await computeDecisionRightDue(db, row, {
      organizationId: target.organizationId,
      transformationId,
      raisedOn: query.raisedOn,
      urgent: query.urgent,
      urgentReason: undefined,
      releaseMilestoneId: query.releaseMilestoneId ?? null,
    });
    const out: DueDatePreview = {
      decisionRightId: row.id,
      slaType: row.sla_type as SlaType,
      raisedOn: query.raisedOn,
      dueDate: due.dueDate,
      unknownReason: due.dueDate === null ? (due.unknownReason as DueDatePreview["unknownReason"]) : null,
      calendarId: due.calendarId,
      calendarVersion: due.calendarVersion,
    };
    return out;
  });

  return [`GET ${TEMPLATES}`, `GET ${ROWS}`, `POST ${ROWS}`, `GET ${ONE}`, `PATCH ${ONE}`, `GET ${DUE}`];
}
