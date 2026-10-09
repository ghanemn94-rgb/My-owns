// The T16 Executive Decision Log (OpenAPI tag "executive-decisions"; ADR-0032 §6, §9, §11; REQ-PB-081, REQ-S10-012;
// T-DG4-BE-G), on the ONE canonical decision record (kind 'executive', code DEC-nn; ADR-0015):
//   GET   /transformations/{id}/executive-decisions                       the log (transformation.read); overdue on read
//   POST  /transformations/{id}/executive-decisions                       raise an ask (executive_decision.create)
//   GET   /transformations/{id}/executive-decisions/{decisionId}          one entry, missingElements, escalationLevel
//   PATCH /transformations/{id}/executive-decisions/{decisionId}          complete or edit an open ask (If-Match)
//   POST  /transformations/{id}/executive-decisions/{decisionId}/outcome  the Outcome (executive_decision.decide; owner)
//
// An ask states the seven elements (decision, why now, options A/B/C…, recommendation, impact of delay, decision owner,
// required date); a request without one is a 400 at its pointer BEFORE any write, and the database refuses the same row
// as its last line (decision_ask_complete, decision_ask_options). The decision owner must hold executive_decision.decide
// in the transformation (B0130 "[Exec]"). The SLA due date is the required date, or, with a T11 row, BE-C's SLA
// computation for that row (Unknown is stored with its reason and is never escalated).
//
// Recording the Outcome is a PERSON's business decision: only the owner, or the owner's active delegate (ADR-0026 §3),
// holding executive_decision.decide, through this API. No job, trigger or seed writes status 'decided'. It is not a
// G1-G6 gate decision, and nothing here touches the engineering gates DG0-DG7.
//
// `createExecutiveAsk` and `recordExecutiveOutcome` are the services BE-F2's agenda calls (publication of a brief and
// recordAgendaItemOutcome 'decided'), in the caller's transaction.
import type { DbOrTx, DecisionOptionTable, DecisionRow, Tx } from "@mth/db";
import type { Selectable } from "kysely";
import { sql } from "@mth/db";
import {
  executiveDecisionCreate,
  executiveDecisionListQuery,
  executiveDecisionOutcome,
  executiveDecisionUpdate,
  missingAskElements,
  uuid,
  type AskOrigin,
  type BlockerRecordType,
  type ExecutiveDecision,
  type ExecutiveDecisionOptionInput,
  type ExecutiveDecisionOutcome,
} from "@mth/shared/schemas";
import { PROBLEM_TYPES, type FieldError } from "@mth/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import {
  actsFor,
  auditContextOf,
  commitTimeDenial,
  decide,
  denialOf,
  loadGrants,
  principalOf,
  refreshPrincipal,
  requireAction,
  requireTransformationRead,
  technicalAdminRefusal,
  type Principal,
  type ResolvedTarget,
} from "../access/index.ts";
import { record, type AuditContext } from "../audit/index.ts";
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
import { closeWorkItemsOfSubject, createWorkItemOnce } from "../tasks/index.ts";
import { nextCode } from "../workflows/codes.ts";
import { blockerAskOpen, lockBlockerAsk, blockerExists } from "./blocker-escalation.ts";
import { computeDecisionRightDue } from "./decision-rights.ts";

const JSON_BODY = ["application/json"] as const;
const CREATE = "executive_decision.create" as const;
const DECIDE = "executive_decision.decide" as const;
/** The slice D permissions of the T16 log, the escalation rules and blocker statuses (ADR-0032 §9). */
export type T16Permission = "executive_decision.create" | "executive_decision.decide" | "escalation_rule.configure";
export type BlockerPermission = T16Permission | "meeting.prepare";

/** My Work kinds of the T16 log (0046). */
export const EXECUTIVE_DECISION_DUE_KIND = "executive_decision_due";
export const EXECUTIVE_DECISION_ESCALATED_KIND = "executive_decision_escalated";
export const EXECUTIVE_DECISION_DUE_MESSAGE = "governance.task.executive_decision_due";

const transformationParams = z.strictObject({ transformationId: uuid });
const decisionParams = z.strictObject({ transformationId: uuid, decisionId: uuid });
const OPTION_LABELS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
type DecisionOptionRow = Selectable<DecisionOptionTable>;

// ------------------------------------------------------------------------------------------------ refusals (S-11)

const at = (status: 400 | 422, code: string, detail: string, pointer: string) =>
  new HttpProblem({
    status,
    type: PROBLEM_TYPES.validation,
    code,
    title: status === 400 ? "Validation failed" : "Business rule violated",
    detail,
    errors: [{ pointer, code, message: detail }],
  });

/** The element names of the 400 "{Element} is required." texts (ADR-0032 §11). */
export const ASK_FIELD_ELEMENTS = {
  title: "Decision",
  whyNow: "Why now",
  options: "Options",
  recommendation: "Recommendation",
  impactOfDelay: "Impact of delay",
  ownerUserId: "Decision owner",
  requiredDate: "Required date",
} as const;

/** ADR-0032 §11, T16 lines: exact codes and English texts. */
export const executiveDecisionRefusals = {
  fieldsRequired: (fields: readonly (keyof typeof ASK_FIELD_ELEMENTS)[]) => {
    const errors: FieldError[] = fields.map((f) => ({
      pointer: `/${f}`,
      code: "executive_decision.field_required",
      message: `${ASK_FIELD_ELEMENTS[f]} is required.`,
    }));
    return new HttpProblem({
      status: 400,
      type: PROBLEM_TYPES.validation,
      code: "executive_decision.field_required",
      title: "Validation failed",
      detail: errors.map((e) => e.message).join(" "),
      errors,
    });
  },
  outcomeTextRequired: () => at(400, "executive_decision.field_required", "Outcome is required.", "/outcomeText"),
  optionsTooFew: () =>
    at(400, "executive_decision.options_too_few", "An executive ask states at least two options.", "/options"),
  ownerNotExecutive: () =>
    at(
      422,
      "executive_decision.owner_not_executive",
      "The decision owner must be an executive who holds the decision right in this transformation.",
      "/ownerUserId",
    ),
  requiredDatePast: () =>
    at(422, "executive_decision.required_date_past", "The required date cannot be before today.", "/requiredDate"),
  optionUnknown: (pointer: "/chosenOptionLabel" | "/recommendation") =>
    at(422, "executive_decision.option_unknown", "This option is not one of the decision's options.", pointer),
  closed: (status: string) =>
    problems.businessRule(
      "executive_decision.closed",
      `This executive decision is ${status} and can no longer be changed.`,
    ),
  deferDateRequired: () =>
    at(422, "executive_decision.defer_date_required", "A deferral needs a new date after today.", "/deferUntil"),
  notOwner: () =>
    new HttpProblem({
      status: 403,
      type: PROBLEM_TYPES.forbidden,
      code: "executive_decision.not_owner",
      title: "Forbidden",
      detail: "Only the decision owner, or an active delegate acting for them, can record the outcome.",
    }),
  blockerAskOpen: (code: string) =>
    problems.duplicate(
      "executive_decision.blocker_ask_open",
      `An open executive ask already exists for this blocker: ${code}.`,
    ),
  blockerNotFound: () =>
    at(
      422,
      "blocker_status.record_not_found",
      "The blocker does not exist in this transformation.",
      "/blockerRecordId",
    ),
} as const;

const unknownDecisionRight = () =>
  problems.validation([
    {
      pointer: "/decisionRightId",
      code: "validation.decision_right_unknown",
      message: "Choose an active decision-rights row of this transformation.",
    },
  ]);

// ------------------------------------------------------------------------------------------------ authorization

/**
 * Read gate first (404 outside scope, ADR-0006), then `permission` decided on grants reloaded inside `tx` (the
 * commit-time re-check of S-4; a denial is 403 and audited). With `technicalAdmin403` an ADM-only caller gets the
 * REQ-S10-003 403 instead of the read gate's 404 (a business-approval endpoint, D-094).
 */
export async function requireT16Action(
  tx: Tx,
  request: FastifyRequest,
  transformationId: string,
  permission: BlockerPermission,
  technicalAdmin403 = false,
): Promise<{ userId: string; principal: Principal; target: ResolvedTarget & { transformationId: string } }> {
  let target: ResolvedTarget;
  try {
    target = await requireTransformationRead(tx, principalOf(request), transformationId);
  } catch (err) {
    throw technicalAdmin403 ? technicalAdminRefusal(principalOf(request), err, permission) : err;
  }
  const fresh = await refreshPrincipal(tx, request);
  try {
    await requireTransformationRead(tx, fresh, transformationId);
    await requireAction(tx, fresh, permission, target);
  } catch (err) {
    throw commitTimeDenial(err);
  }
  return { userId: fresh.userId!, principal: fresh, target: { ...target, transformationId } };
}

/** True when `userId` is an active user of the organization holding executive_decision.decide on the target now. */
export async function holdsExecutiveDecide(db: DbOrTx, userId: string, target: ResolvedTarget): Promise<boolean> {
  const user = await db
    .selectFrom("app_user")
    .select(["status", "organization_id"])
    .where("id", "=", userId)
    .executeTakeFirst();
  if (!user || user.status !== "active" || user.organization_id !== target.organizationId) return false;
  const grants = await loadGrants(db, userId);
  return decide({ kind: "user", userId, grants }, DECIDE, target).allowed;
}

// ------------------------------------------------------------------------------------------------ time

/**
 * Today's business date in the organization's default business-calendar timezone (Asia/Riyadh when none; ADR-0025 §1,
 * ADR-0032 §6 "Overdue list"), from the database clock (`p4_business_date`, the same function the guards use).
 */
export async function organizationBusinessToday(db: DbOrTx, organizationId: string): Promise<string> {
  const r = await sql<{ d: string }>`
    SELECT p4_business_date(now(), coalesce(
      (SELECT c.timezone FROM business_calendar c
       WHERE c.organization_id = ${organizationId}::uuid AND c.is_default AND c.status = 'active' LIMIT 1),
      'Asia/Riyadh'))::text AS d`.execute(db);
  return r.rows[0]!.d;
}

// ------------------------------------------------------------------------------------------------ mapping

const askOriginOf = (r: Pick<DecisionRow, "ask_origin">): AskOrigin => (r.ask_origin ?? "earlier_record") as AskOrigin;

const toOption = (o: DecisionOptionRow) => ({
  id: o.id,
  organizationId: o.organization_id,
  transformationId: o.transformation_id,
  decisionId: o.decision_id,
  label: o.label,
  title: o.title,
  description: o.description,
  ordinal: o.ordinal,
  status: o.status as "active" | "withdrawn",
  version: o.version,
  createdAt: iso(o.created_at),
  createdBy: o.created_by,
  updatedAt: iso(o.updated_at),
  updatedBy: o.updated_by,
});

export function toExecutiveDecision(
  r: DecisionRow,
  options: readonly DecisionOptionRow[],
  escalationLevel: number,
  today: string,
): ExecutiveDecision {
  const active = options.filter((o) => o.status === "active");
  const labelOf = (id: string | null) => (id === null ? null : (options.find((o) => o.id === id)?.label ?? null));
  const origin = askOriginOf(r);
  return {
    id: r.id,
    transformationId: r.transformation_id,
    code: r.code,
    decision: r.title,
    whyNow: r.why_now,
    options: [...options].sort((a, b) => a.ordinal - b.ordinal).map(toOption),
    recommendationOptionLabel: labelOf(r.recommendation_option_id),
    recommendationText: r.recommendation_text,
    ownerUserId: r.owner_user_id,
    ownerStatus: r.owner_user_id === null ? "unassigned" : "assigned",
    decisionDate: r.due_date,
    impactOfDelay: r.impact_of_delay,
    outcome: r.outcome_text,
    chosenOptionLabel: labelOf(r.chosen_option_id),
    status: r.status as ExecutiveDecision["status"],
    overdue: (r.status === "open" || r.status === "deferred") && r.due_date !== null && r.due_date < today,
    askOrigin: origin,
    createdSource: r.created_source as ExecutiveDecision["createdSource"],
    sourceAgendaItemId: r.source_agenda_item_id,
    decisionRightId: r.decision_right_id,
    slaDueDate: r.sla_due_date,
    slaUnknownReason: r.sla_unknown_reason as ExecutiveDecision["slaUnknownReason"],
    blockerRecordType: r.blocker_record_type as ExecutiveDecision["blockerRecordType"],
    blockerRecordId: r.blocker_record_id,
    missingElements: missingAskElements({
      askOrigin: origin,
      title: r.title,
      whyNow: r.why_now,
      activeOptionCount: active.length,
      hasRecommendation: r.recommendation_option_id !== null || r.recommendation_text !== null,
      impactOfDelay: r.impact_of_delay,
      ownerUserId: r.owner_user_id,
      dueDate: r.due_date,
    }),
    escalationLevel,
    decidedAt: isoOrNull(r.decided_at),
    decidedBy: r.decided_by,
    decidedOnBehalfOfUserId: r.decided_on_behalf_of_user_id,
    version: r.version,
    createdAt: iso(r.created_at),
    createdBy: r.created_by,
    updatedAt: iso(r.updated_at),
    updatedBy: r.updated_by,
  };
}

/** The API shape of executive decision rows, with their options, escalation level and the overdue flag. */
export async function toExecutiveDecisions(db: DbOrTx, rows: readonly DecisionRow[]): Promise<ExecutiveDecision[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const options = await db.selectFrom("decision_option").selectAll().where("decision_id", "in", ids).execute();
  const levels = await db
    .selectFrom("decision_escalation")
    .select(["decision_id", sql<number>`max(level)::integer`.as("lvl")])
    .where("decision_id", "in", ids)
    .groupBy("decision_id")
    .execute();
  const today = await organizationBusinessToday(db, rows[0]!.organization_id);
  return rows.map((r) =>
    toExecutiveDecision(
      r,
      options.filter((o) => o.decision_id === r.id),
      levels.find((l) => l.decision_id === r.id)?.lvl ?? 0,
      today,
    ),
  );
}

export async function loadExecutiveDecision(
  db: DbOrTx,
  transformationId: string,
  decisionId: string,
  forUpdate = false,
): Promise<DecisionRow> {
  let q = db
    .selectFrom("decision")
    .selectAll()
    .where("id", "=", decisionId)
    .where("transformation_id", "=", transformationId)
    .where("kind", "=", "executive");
  if (forUpdate) q = q.forUpdate();
  const row = await q.executeTakeFirst();
  if (!row) throw problems.notFound();
  return row;
}

// ------------------------------------------------------------------------------------------------ the services

/** What an ask service needs from its caller: the acting person, the audit context and the resolved scope. */
export interface T16Context {
  readonly principal: Principal;
  readonly userId: string;
  readonly audit: AuditContext;
  readonly target: ResolvedTarget & { readonly transformationId: string };
}

/** The fields of a new ask (createExecutiveDecision body, or BE-F2's published agenda brief). */
export interface ExecutiveAskFields {
  readonly title: string;
  readonly whyNow: string;
  readonly options: readonly ExecutiveDecisionOptionInput[];
  /** An option label (A-Z) or a recommendation text. */
  readonly recommendation: string;
  readonly impactOfDelay: string;
  readonly ownerUserId: string;
  readonly requiredDate: string;
  readonly context?: string | null | undefined;
  readonly decisionRightId?: string | null | undefined;
  readonly blockerRecordType?: BlockerRecordType | null | undefined;
  readonly blockerRecordId?: string | null | undefined;
  /** 'api' (createExecutiveDecision) or 'agenda' (BE-F2's publishAgendaItem, with the source item). */
  readonly origin: "api" | "agenda";
  readonly sourceAgendaItemId?: string | null | undefined;
}

const isLabel = (v: string) => /^[A-Z]$/.test(v);

interface SlaOf {
  readonly slaDueDate: string | null;
  readonly slaUnknownReason: string | null;
}

/** ADR-0032 §6 "SLA due date": the required date, or the T11 row's SLA from today's business date. */
async function slaOf(
  tx: Tx,
  target: ResolvedTarget & { transformationId: string },
  decisionRightId: string | null,
  requiredDate: string,
  today: string,
): Promise<SlaOf> {
  if (decisionRightId === null) return { slaDueDate: requiredDate, slaUnknownReason: null };
  const row = await tx
    .selectFrom("transformation_decision_right")
    .selectAll()
    .where("id", "=", decisionRightId)
    .where("transformation_id", "=", target.transformationId)
    .where("status", "=", "active")
    .executeTakeFirst();
  if (!row) throw unknownDecisionRight();
  const due = await computeDecisionRightDue(tx, row, {
    organizationId: target.organizationId,
    transformationId: target.transformationId,
    raisedOn: today,
    urgent: false,
    urgentReason: undefined,
    releaseMilestoneId: null,
  });
  return { slaDueDate: due.dueDate, slaUnknownReason: due.dueDate === null ? due.unknownReason : null };
}

/** The owner's My Work item for an open ask (dedupe `t16.decision:<decisionId>:<ownerUserId>`, ADR-0032 §6). */
async function ownerWorkItem(
  tx: Tx,
  ctx: T16Context,
  d: { id: string; code: string; title: string },
  owner: string,
  due: string | null,
) {
  await createWorkItemOnce(
    tx,
    { actorType: "user", actorUserId: ctx.userId, requestId: ctx.audit.requestId, source: "api" },
    {
      organizationId: ctx.target.organizationId,
      transformationId: ctx.target.transformationId,
      kind: EXECUTIVE_DECISION_DUE_KIND,
      assigneeUserId: owner,
      subjectType: "decision",
      subjectId: d.id,
      linkPath: `/transformations/${ctx.target.transformationId}/executive-decisions/${d.id}`,
      messageKey: EXECUTIVE_DECISION_DUE_MESSAGE,
      messageParams: { code: d.code, title: d.title },
      dueDate: due,
      dedupeKey: `t16.decision:${d.id}:${owner}`,
    },
  );
}

/**
 * Creates a person-raised executive ask (origin 'api' or 'agenda') in `tx`: owner check, required date not past,
 * recommendation label check, SLA due date, DEC-nn code, options A, B, C … as decision_option rows (inserted in the
 * same statement as the decision, so the recommended option exists when the row's foreign key is checked), the audit
 * events, and the owner's My Work item. A blocker link is serialized under lock 730239 and refused when the blocker
 * already has an open ask (409). The caller has authorized executive_decision.create. Returns the decision id.
 */
export async function createExecutiveAsk(tx: Tx, ctx: T16Context, f: ExecutiveAskFields): Promise<string> {
  if (f.options.length < 2) throw executiveDecisionRefusals.optionsTooFew();
  if (!(await holdsExecutiveDecide(tx, f.ownerUserId, ctx.target))) throw executiveDecisionRefusals.ownerNotExecutive();
  const today = await organizationBusinessToday(tx, ctx.target.organizationId);
  if (f.requiredDate < today) throw executiveDecisionRefusals.requiredDatePast();
  const optionIds = f.options.map(() => uuidv7());
  let recommendationOptionId: string | null = null;
  let recommendationText: string | null = f.recommendation;
  if (isLabel(f.recommendation)) {
    const i = OPTION_LABELS.indexOf(f.recommendation);
    if (i < 0 || i >= f.options.length) throw executiveDecisionRefusals.optionUnknown("/recommendation");
    recommendationOptionId = optionIds[i]!;
    recommendationText = null;
  }
  const blockerType = f.blockerRecordType ?? null;
  const blockerId = f.blockerRecordId ?? null;
  if ((blockerType === null) !== (blockerId === null))
    throw problems.validation([
      {
        pointer: blockerType === null ? "/blockerRecordType" : "/blockerRecordId",
        code: "validation.blocker_pair",
        message: "A blocker link names both its record type and its record.",
      },
    ]);
  if (blockerType !== null && blockerId !== null) {
    await lockBlockerAsk(tx, ctx.target.transformationId, blockerType, blockerId);
    if (!(await blockerExists(tx, ctx.target.transformationId, blockerType, blockerId)))
      throw executiveDecisionRefusals.blockerNotFound();
    const open = await blockerAskOpen(tx, ctx.target.transformationId, blockerType, blockerId);
    if (open !== null) throw executiveDecisionRefusals.blockerAskOpen(open.code);
  }
  const sla = await slaOf(tx, ctx.target, f.decisionRightId ?? null, f.requiredDate, today);
  const id = uuidv7();
  const code = await nextCode(tx, ctx.target.transformationId, "DEC");
  const org = ctx.target.organizationId;
  const tid = ctx.target.transformationId;
  const by = ctx.userId;
  const optionRows = f.options.map(
    (o, i) =>
      sql`(${optionIds[i]!}::uuid, ${org}::uuid, ${tid}::uuid, ${id}::uuid, ${OPTION_LABELS[i]!}, ${o.title}, ${o.description ?? null}::text, ${i + 1}::smallint, ${by}::uuid, ${by}::uuid)`,
  );
  // One statement: the decision row and its options. Non-deferrable foreign keys (the options' decision, the
  // decision's recommended option) are checked at the end of the statement, when both sides exist.
  await sql`
    WITH d AS (
      INSERT INTO decision (id, organization_id, transformation_id, kind, code, title, context, owner_user_id, due_date,
                            recommendation_option_id, recommendation_text, why_now, impact_of_delay, ask_origin,
                            created_source, source_agenda_item_id, decision_right_id, sla_due_date, sla_unknown_reason,
                            blocker_record_type, blocker_record_id, created_by, updated_by)
      VALUES (${id}::uuid, ${org}::uuid, ${tid}::uuid, 'executive', ${code}, ${f.title}, ${f.context ?? null}::text,
              ${f.ownerUserId}::uuid, ${f.requiredDate}::date, ${recommendationOptionId}::uuid, ${recommendationText}::text,
              ${f.whyNow}, ${f.impactOfDelay}, ${f.origin}, 'api', ${f.sourceAgendaItemId ?? null}::uuid,
              ${f.decisionRightId ?? null}::uuid, ${sla.slaDueDate}::date, ${sla.slaUnknownReason}::text,
              ${blockerType}::text, ${blockerId}::uuid, ${by}::uuid, ${by}::uuid)
      RETURNING id)
    INSERT INTO decision_option (id, organization_id, transformation_id, decision_id, label, title, description, ordinal,
                                 created_by, updated_by)
    VALUES ${sql.join(optionRows)}`.execute(tx);
  await record(tx, ctx.audit, {
    action: "executive_decision.create",
    recordType: "decision",
    recordId: id,
    organizationId: org,
    transformationId: tid,
    newVersion: 1,
    changes: {
      kind: { from: null, to: "executive" },
      code: { from: null, to: code },
      title: { from: null, to: f.title },
      ask_origin: { from: null, to: f.origin },
      owner_user_id: { from: null, to: f.ownerUserId },
      due_date: { from: null, to: f.requiredDate },
      sla_due_date: { from: null, to: sla.slaDueDate },
      sla_unknown_reason: { from: null, to: sla.slaUnknownReason },
      decision_right_id: { from: null, to: f.decisionRightId ?? null },
      blocker_record_type: { from: null, to: blockerType },
      blocker_record_id: { from: null, to: blockerId },
      source_agenda_item_id: { from: null, to: f.sourceAgendaItemId ?? null },
    },
  });
  for (const [i, o] of f.options.entries())
    await record(tx, ctx.audit, {
      action: "decision_option.create",
      recordType: "decision_option",
      recordId: optionIds[i]!,
      organizationId: org,
      transformationId: tid,
      newVersion: 1,
      changes: {
        decision_id: { from: null, to: id },
        label: { from: null, to: OPTION_LABELS[i]! },
        title: { from: null, to: o.title },
      },
    });
  await ownerWorkItem(tx, ctx, { id, code, title: f.title }, f.ownerUserId, f.requiredDate);
  return id;
}

/**
 * Records the Outcome of an executive ask in `tx` (ADR-0032 §6): `decided` (outcome text required; chosen option when a
 * label is given), `deferred` (a new date after today: due and SLA date move, so an expired deferral escalates once
 * more) or `cancelled` (the reason as outcome text). The caller must hold executive_decision.decide AND be the owner,
 * or act for the owner through an active delegation (decided_on_behalf_of_user_id = the owner). A decided or
 * cancelled ask is final. `expectedVersion` is the If-Match value (null: the caller already locked and checked it).
 * Closes the ask's My Work items when it is decided or cancelled. Returns the updated row.
 */
export async function recordExecutiveOutcome(
  tx: Tx,
  ctx: T16Context,
  decisionId: string,
  body: ExecutiveDecisionOutcome,
  expectedVersion: number | null,
): Promise<DecisionRow> {
  try {
    await requireAction(tx, ctx.principal, DECIDE, ctx.target);
  } catch (err) {
    throw commitTimeDenial(err);
  }
  const current = await loadExecutiveDecision(tx, ctx.target.transformationId, decisionId, true);
  if (expectedVersion !== null && current.version !== expectedVersion) throw problems.versionConflict(current.version);
  if (current.status === "decided" || current.status === "cancelled" || current.ask_origin === null)
    throw executiveDecisionRefusals.closed(current.status);
  // Record-level rule (ADR-0032 §9): the owner, or the owner's active delegate (ADR-0026 §3 rule 7).
  let onBehalfOf: string | null = null;
  if (current.owner_user_id !== ctx.userId) {
    const delegated =
      current.owner_user_id !== null &&
      (await actsFor(tx, ctx.principal, current.owner_user_id, "decision", ctx.target, DECIDE));
    if (!delegated) throw executiveDecisionRefusals.notOwner().withDenial(denialOf(DECIDE, ctx.target));
    onBehalfOf = current.owner_user_id;
  }
  const options = await tx.selectFrom("decision_option").selectAll().where("decision_id", "=", decisionId).execute();
  const today = await organizationBusinessToday(tx, ctx.target.organizationId);
  let set: {
    status: string;
    chosen_option_id?: string | null;
    outcome_text?: string;
    decided_by?: string;
    decided_on_behalf_of_user_id?: string | null;
    decided_at?: ReturnType<typeof sql<Date>>;
    due_date?: string;
    sla_due_date?: string;
    sla_unknown_reason?: null;
  };
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  if (body.outcome === "decided") {
    if (body.outcomeText === undefined) throw executiveDecisionRefusals.outcomeTextRequired();
    let chosen: string | null = null;
    if (body.chosenOptionLabel !== undefined) {
      const o = options.find((x) => x.label === body.chosenOptionLabel && x.status === "active");
      if (!o) throw executiveDecisionRefusals.optionUnknown("/chosenOptionLabel");
      chosen = o.id;
    }
    set = {
      status: "decided",
      chosen_option_id: chosen,
      outcome_text: body.outcomeText,
      decided_by: ctx.userId,
      decided_on_behalf_of_user_id: onBehalfOf,
      decided_at: sql<Date>`now()`,
    };
    changes["chosen_option_id"] = { from: current.chosen_option_id, to: chosen };
    changes["outcome_text"] = { from: current.outcome_text, to: body.outcomeText };
    changes["decided_by"] = { from: null, to: ctx.userId };
    changes["decided_on_behalf_of_user_id"] = { from: null, to: onBehalfOf };
  } else if (body.outcome === "deferred") {
    if (body.deferUntil === undefined || body.deferUntil <= today) throw executiveDecisionRefusals.deferDateRequired();
    set = {
      status: "deferred",
      due_date: body.deferUntil,
      sla_due_date: body.deferUntil,
      sla_unknown_reason: null,
      ...(body.outcomeText !== undefined ? { outcome_text: body.outcomeText } : {}),
    };
    changes["due_date"] = { from: current.due_date, to: body.deferUntil };
    changes["sla_due_date"] = { from: current.sla_due_date, to: body.deferUntil };
  } else {
    if (body.outcomeText === undefined) throw executiveDecisionRefusals.outcomeTextRequired();
    set = { status: "cancelled", outcome_text: body.outcomeText };
    changes["outcome_text"] = { from: current.outcome_text, to: body.outcomeText };
  }
  changes["status"] = { from: current.status, to: body.outcome };
  const updated = await tx
    .updateTable("decision")
    .set({
      ...set,
      version: sql<number>`version + 1`,
      updated_at: sql<Date>`now()`,
      updated_by: ctx.userId,
    })
    .where("id", "=", decisionId)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirst();
  if (!updated) throw problems.versionConflict(current.version + 1);
  await record(
    tx,
    { ...ctx.audit, onBehalfOfUserId: onBehalfOf },
    {
      action: `executive_decision.${body.outcome === "decided" ? "decide" : body.outcome === "deferred" ? "defer" : "cancel"}`,
      recordType: "decision",
      recordId: decisionId,
      organizationId: current.organization_id,
      transformationId: current.transformation_id,
      priorVersion: current.version,
      newVersion: updated.version,
      changes,
    },
  );
  if (body.outcome !== "deferred")
    await closeWorkItemsOfSubject(
      tx,
      { actorType: "user", actorUserId: ctx.userId, requestId: ctx.audit.requestId, source: "api" },
      {
        organizationId: current.organization_id,
        subjectType: "decision",
        subjectId: decisionId,
        kinds: [EXECUTIVE_DECISION_DUE_KIND, EXECUTIVE_DECISION_ESCALATED_KIND],
      },
      body.outcome === "decided" ? "done" : "cancelled",
    );
  return updated;
}

// ------------------------------------------------------------------------------------------------ request checks

/**
 * REQ-S10-012 "an ask without 'why now' is rejected by the API": the seven elements are checked for presence before
 * the schema, so each missing one is a 400 `executive_decision.field_required` at its own pointer with its exact text,
 * and fewer than two options is `executive_decision.options_too_few` (ADR-0032 §11).
 */
function checkAskElements(body: unknown): void {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return; // parseBody answers
  const b = body as Record<string, unknown>;
  const missing = (Object.keys(ASK_FIELD_ELEMENTS) as (keyof typeof ASK_FIELD_ELEMENTS)[]).filter(
    (k) => b[k] === undefined || b[k] === null,
  );
  if (missing.length > 0) throw executiveDecisionRefusals.fieldsRequired(missing);
  if (Array.isArray(b["options"]) && b["options"].length < 2) throw executiveDecisionRefusals.optionsTooFew();
}

/** The same option-count refusal on an update that replaces the options. */
function checkUpdateOptions(body: unknown): void {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return;
  const o = (body as Record<string, unknown>)["options"];
  if (Array.isArray(o) && o.length < 2) throw executiveDecisionRefusals.optionsTooFew();
}

/** The decision fields audited on update (literal accesses only; F-DG1-124). */
const decisionFields = (r: DecisionRow): ReadonlyMap<string, unknown> =>
  new Map<string, unknown>([
    ["title", r.title],
    ["why_now", r.why_now],
    ["impact_of_delay", r.impact_of_delay],
    ["recommendation_option_id", r.recommendation_option_id],
    ["recommendation_text", r.recommendation_text],
    ["owner_user_id", r.owner_user_id],
    ["due_date", r.due_date],
    ["context", r.context],
    ["decision_right_id", r.decision_right_id],
    ["sla_due_date", r.sla_due_date],
    ["sla_unknown_reason", r.sla_unknown_reason],
  ]);

function diff(before: ReadonlyMap<string, unknown>, after: ReadonlyMap<string, unknown>) {
  const out: Record<string, { from: unknown; to: unknown }> = {};
  for (const [k, v] of after) if (before.get(k) !== v) out[k] = { from: before.get(k) ?? null, to: v };
  return out;
}

// ------------------------------------------------------------------------------------------------ routes

export function registerExecutiveDecisionRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  const LOG = "/api/v1/transformations/:transformationId/executive-decisions";
  const ONE = `${LOG}/:decisionId`;
  const OUTCOME = `${ONE}/outcome`;
  const read = { access: { permission: "transformation.read" as const } };

  app.get(LOG, { config: read }, async (request) => {
    const { transformationId } = parse(transformationParams, request.params, "params");
    const query = parseQuery(
      executiveDecisionListQuery.extend({ cursor: cursorSchema, limit: limitSchema }),
      request.query,
    );
    const target = await requireTransformationRead(db, principalOf(request), transformationId);
    const today = await organizationBusinessToday(db, target.organizationId);
    const hash = filterHash({
      transformationId,
      status: query.status ?? null,
      overdue: query.overdue ?? null,
      origin: query.origin ?? null,
    });
    const after = decodeCursor(query.cursor, hash, 1);
    let q = db
      .selectFrom("decision")
      .selectAll()
      .where("transformation_id", "=", transformationId)
      .where("kind", "=", "executive");
    if (query.status !== undefined) q = q.where("status", "=", query.status);
    if (query.origin !== undefined)
      q =
        query.origin === "earlier_record"
          ? q.where("ask_origin", "is", null)
          : q.where("ask_origin", "=", query.origin);
    if (query.overdue === true)
      q = q.where("status", "in", ["open", "deferred"]).where("due_date", "is not", null).where("due_date", "<", today);
    if (query.overdue === false)
      q = q.where((eb) =>
        eb.or([eb("status", "not in", ["open", "deferred"]), eb("due_date", "is", null), eb("due_date", ">=", today)]),
      );
    if (after) q = q.where("id", ">", String(after[0]));
    const rows = await q
      .orderBy("id")
      .limit(query.limit + 1)
      .execute();
    const page = paginate(rows, query.limit, (r) => [r.id], hash);
    return { items: await toExecutiveDecisions(db, page.items), nextCursor: page.nextCursor };
  });

  app.post(LOG, { config: { access: { permission: CREATE }, consumes: JSON_BODY } }, async (request, reply) => {
    const { transformationId } = parse(transformationParams, request.params, "params");
    checkAskElements(request.body);
    const body = parseBody(executiveDecisionCreate, request.body);
    const row = await db.transaction().execute(async (tx) => {
      const { userId, principal, target } = await requireT16Action(tx, request, transformationId, CREATE);
      const id = await createExecutiveAsk(
        tx,
        { principal, userId, audit: auditContextOf(request), target },
        { ...body, origin: "api" },
      );
      return loadExecutiveDecision(tx, transformationId, id);
    });
    const [out] = await toExecutiveDecisions(db, [row]);
    return sendVersioned(reply, 201, out!, `/api/v1/transformations/${transformationId}/executive-decisions/${row.id}`);
  });

  app.get(ONE, { config: read }, async (request, reply) => {
    const { transformationId, decisionId } = parse(decisionParams, request.params, "params");
    await requireTransformationRead(db, principalOf(request), transformationId);
    const row = await loadExecutiveDecision(db, transformationId, decisionId);
    const [out] = await toExecutiveDecisions(db, [row]);
    return sendVersioned(reply, 200, out!);
  });

  app.patch(ONE, { config: { access: { permission: CREATE }, consumes: JSON_BODY } }, async (request, reply) => {
    const { transformationId, decisionId } = parse(decisionParams, request.params, "params");
    checkUpdateOptions(request.body);
    const body = parseBody(executiveDecisionUpdate, request.body);
    const row = await db.transaction().execute(async (tx) => {
      const { userId, principal, target } = await requireT16Action(tx, request, transformationId, CREATE);
      const ctx: T16Context = { principal, userId, audit: auditContextOf(request), target };
      const expected = requireIfMatch(request);
      const current = await loadExecutiveDecision(tx, transformationId, decisionId, true);
      if (current.version !== expected) throw problems.versionConflict(current.version);
      if (current.ask_origin === null || current.status === "decided" || current.status === "cancelled")
        throw executiveDecisionRefusals.closed(current.status);
      if (body.ownerUserId !== undefined && !(await holdsExecutiveDecide(tx, body.ownerUserId, target)))
        throw executiveDecisionRefusals.ownerNotExecutive();
      const today = await organizationBusinessToday(tx, target.organizationId);
      if (body.requiredDate !== undefined && body.requiredDate < today)
        throw executiveDecisionRefusals.requiredDatePast();
      // Options: the n-th option keeps label n (an existing row is edited in place, a missing one inserted); options
      // beyond the new list are withdrawn, never deleted (decision_option_label_key covers withdrawn labels too).
      const options = await tx
        .selectFrom("decision_option")
        .selectAll()
        .where("decision_id", "=", decisionId)
        .orderBy("ordinal")
        .forUpdate()
        .execute();
      const activeAfter: { id: string; label: string }[] = [];
      if (body.options !== undefined) {
        for (const [i, o] of body.options.entries()) {
          const label = OPTION_LABELS[i]!;
          const existing = options.find((x) => x.label === label);
          const description = o.description ?? null;
          if (!existing) {
            const oid = uuidv7();
            await tx
              .insertInto("decision_option")
              .values({
                id: oid,
                organization_id: current.organization_id,
                transformation_id: transformationId,
                decision_id: decisionId,
                label,
                title: o.title,
                description,
                ordinal: i + 1,
                created_by: userId,
                updated_by: userId,
              })
              .execute();
            await record(tx, ctx.audit, {
              action: "decision_option.create",
              recordType: "decision_option",
              recordId: oid,
              organizationId: current.organization_id,
              transformationId,
              newVersion: 1,
              changes: {
                decision_id: { from: null, to: decisionId },
                label: { from: null, to: label },
                title: { from: null, to: o.title },
              },
            });
            activeAfter.push({ id: oid, label });
          } else {
            if (existing.title !== o.title || existing.description !== description || existing.status !== "active") {
              await tx
                .updateTable("decision_option")
                .set({
                  title: o.title,
                  description,
                  status: "active",
                  version: sql<number>`version + 1`,
                  updated_at: sql<Date>`now()`,
                  updated_by: userId,
                })
                .where("id", "=", existing.id)
                .execute();
              await record(tx, ctx.audit, {
                action: "decision_option.update",
                recordType: "decision_option",
                recordId: existing.id,
                organizationId: current.organization_id,
                transformationId,
                priorVersion: existing.version,
                newVersion: existing.version + 1,
                changes: {
                  title: { from: existing.title, to: o.title },
                  description: { from: existing.description, to: description },
                  status: { from: existing.status, to: "active" },
                },
              });
            }
            activeAfter.push({ id: existing.id, label });
          }
        }
        const count = body.options.length;
        for (const x of options.filter((o) => o.ordinal > count && o.status === "active")) {
          await tx
            .updateTable("decision_option")
            .set({
              status: "withdrawn",
              version: sql<number>`version + 1`,
              updated_at: sql<Date>`now()`,
              updated_by: userId,
            })
            .where("id", "=", x.id)
            .execute();
          await record(tx, ctx.audit, {
            action: "decision_option.withdraw",
            recordType: "decision_option",
            recordId: x.id,
            organizationId: current.organization_id,
            transformationId,
            priorVersion: x.version,
            newVersion: x.version + 1,
            changes: { status: { from: "active", to: "withdrawn" } },
          });
        }
      } else {
        for (const o of options) if (o.status === "active") activeAfter.push({ id: o.id, label: o.label });
      }
      // Recommendation: a label must name an active option after this change; a recommended option that was just
      // withdrawn must be replaced in the same request.
      let recommendation: { recommendation_option_id: string | null; recommendation_text: string | null } | null = null;
      if (body.recommendation !== undefined) {
        if (isLabel(body.recommendation)) {
          const o = activeAfter.find((x) => x.label === body.recommendation);
          if (!o) throw executiveDecisionRefusals.optionUnknown("/recommendation");
          recommendation = { recommendation_option_id: o.id, recommendation_text: null };
        } else recommendation = { recommendation_option_id: null, recommendation_text: body.recommendation };
      } else if (
        current.recommendation_option_id !== null &&
        !activeAfter.some((x) => x.id === current.recommendation_option_id)
      )
        throw executiveDecisionRefusals.optionUnknown("/recommendation");
      const requiredDate = body.requiredDate ?? current.due_date;
      const rightId = body.decisionRightId !== undefined ? body.decisionRightId : current.decision_right_id;
      const slaChanged = body.requiredDate !== undefined || body.decisionRightId !== undefined;
      const sla = slaChanged && requiredDate !== null ? await slaOf(tx, target, rightId, requiredDate, today) : null;
      const updated = await tx
        .updateTable("decision")
        .set({
          ...(body.title !== undefined ? { title: body.title } : {}),
          ...(body.whyNow !== undefined ? { why_now: body.whyNow } : {}),
          ...(body.impactOfDelay !== undefined ? { impact_of_delay: body.impactOfDelay } : {}),
          ...(body.ownerUserId !== undefined ? { owner_user_id: body.ownerUserId } : {}),
          ...(body.requiredDate !== undefined ? { due_date: body.requiredDate } : {}),
          ...(body.context !== undefined ? { context: body.context } : {}),
          ...(body.decisionRightId !== undefined ? { decision_right_id: body.decisionRightId } : {}),
          ...(recommendation ?? {}),
          ...(sla !== null ? { sla_due_date: sla.slaDueDate, sla_unknown_reason: sla.slaUnknownReason } : {}),
          version: sql<number>`version + 1`,
          updated_at: sql<Date>`now()`,
          updated_by: userId,
        })
        .where("id", "=", decisionId)
        .where("version", "=", current.version)
        .returningAll()
        .executeTakeFirst();
      if (!updated) throw problems.versionConflict(current.version + 1);
      await record(tx, ctx.audit, {
        action: "executive_decision.update",
        recordType: "decision",
        recordId: decisionId,
        organizationId: current.organization_id,
        transformationId,
        priorVersion: current.version,
        newVersion: updated.version,
        changes: {
          ...diff(decisionFields(current), decisionFields(updated)),
          ...(body.options !== undefined
            ? { options: { from: null, to: activeAfter.map((x) => x.label).join("/") } }
            : {}),
        },
      });
      // A new or re-owned open ask: one My Work item for its owner (ADR-0032 §6); the previous owner's item closes.
      if (updated.owner_user_id !== null && updated.owner_user_id !== current.owner_user_id) {
        if (current.owner_user_id !== null)
          await closeWorkItemsOfSubject(
            tx,
            { actorType: "user", actorUserId: userId, requestId: ctx.audit.requestId, source: "api" },
            {
              organizationId: current.organization_id,
              subjectType: "decision",
              subjectId: decisionId,
              kinds: [EXECUTIVE_DECISION_DUE_KIND],
            },
            "cancelled",
          );
        await ownerWorkItem(tx, ctx, updated, updated.owner_user_id, updated.due_date);
      }
      return updated;
    });
    const [out] = await toExecutiveDecisions(db, [row]);
    return sendVersioned(reply, 200, out!);
  });

  app.post(OUTCOME, { config: { access: { permission: DECIDE }, consumes: JSON_BODY } }, async (request, reply) => {
    const { transformationId, decisionId } = parse(decisionParams, request.params, "params");
    const body = parseBody(executiveDecisionOutcome, request.body);
    const row = await db.transaction().execute(async (tx) => {
      const { userId, principal, target } = await requireT16Action(tx, request, transformationId, DECIDE, true);
      const expected = requireIfMatch(request);
      return recordExecutiveOutcome(
        tx,
        { principal, userId, audit: auditContextOf(request), target },
        decisionId,
        body,
        expected,
      );
    });
    const [out] = await toExecutiveDecisions(db, [row]);
    return sendVersioned(reply, 200, out!);
  });

  return [`GET ${LOG}`, `POST ${LOG}`, `GET ${ONE}`, `PATCH ${ONE}`, `POST ${OUTCOME}`];
}
