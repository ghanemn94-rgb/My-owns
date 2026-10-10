// Agenda items and executive-ask briefs (OpenAPI tag "agenda-items"; ADR-0032 §3.2, §3.3, §4, §9, §11; REQ-PB-061,
// REQ-PB-068, REQ-S10-011, REQ-S10-012, REQ-S16-019 "AgendaItem"; T-DG4-BE-F2):
//   GET  /transformations/{id}/meetings/{meetingId}/agenda-items                         the agenda (transformation.read)
//   POST /transformations/{id}/meetings/{meetingId}/agenda-items                         a draft item (meeting.prepare)
//   PATCH /…/agenda-items/{agendaItemId}                                                 edit a draft (meeting.prepare)
//   POST /…/agenda-items/{agendaItemId}/publish                                          publish (meeting.chair; the chair)
//   POST /…/agenda-items/{agendaItemId}/withdraw                                         withdraw (meeting.prepare)
//   POST /…/agenda-items/{agendaItemId}/outcome                                          decided | deferred | noted
//
// "Escalate decisions, not status" (B0102): an executive forum's agenda takes executive asks only. An executive ask
// either links an open T16 ask or carries a draft brief, never both. Publishing it checks the seven elements (decision
// required, why now, options >= 2, recommendation, impact of delay, decision owner, required date) BEFORE any write
// (422 agenda_item.executive_ask_incomplete, one error per missing element); a brief becomes a T16 decision through
// BE-G's createExecutiveAsk (ask_origin 'agenda') and is cleared in the same UPDATE that links it, so one copy of the ask
// exists. Recording 'decided' is the decision owner's (or active delegate's) business decision through BE-G's
// recordExecutiveOutcome, refused below the meeting's quorum (422 meeting.quorum_not_met), and adds the meeting's
// decision output in the same transaction, so every decision recorded in a meeting is a T16 entry. No job decides.
// Nothing here is a G1-G6 gate decision or touches the engineering gates DG0-DG7.
//
// This file also holds the committee-workflow helpers the attendance, minutes, output and action files share (meeting
// lock, frozen check, chair rule, commit-time authorization).
import type { AgendaItemRow, DbOrTx, DecisionRow, MeetingRow, Tx } from "@mth/db";
import { sql } from "@mth/db";
import { PROBLEM_TYPES, type FieldError } from "@mth/shared";
import {
  agendaItemCreate,
  agendaItemOutcome,
  agendaItemUpdate,
  uuid,
  type AgendaAskElement,
  type AgendaItem,
  type AgendaItemOutcome,
  type ExecutiveAskBrief,
  type ExecutiveAskBriefInput,
} from "@mth/shared/schemas";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import {
  actsFor,
  auditContextOf,
  commitTimeDenial,
  denialOf,
  principalOf,
  refreshPrincipal,
  requireAction,
  requireTransformationRead,
  technicalAdminRefusal,
  type Principal,
  type ResolvedTarget,
} from "../access/index.ts";
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
import {
  createExecutiveAsk,
  executiveDecisionRefusals,
  recordExecutiveOutcome,
  type T16Context,
} from "./executive-decisions.ts";
import { diffFields, isActiveUserOf, unknownTarget } from "./forums.ts";
import { businessToday, meetingRefusals } from "./meetings.ts";

const JSON_BODY = ["application/json"] as const;
export const PREPARE = "meeting.prepare" as const;
export const CHAIR = "meeting.chair" as const;
const DECIDE = "executive_decision.decide" as const;

export type CommitteePermission = "meeting.prepare" | "meeting.chair" | "executive_decision.decide";

export const meetingParams = z.strictObject({ transformationId: uuid, meetingId: uuid });
const itemParams = z.strictObject({ transformationId: uuid, meetingId: uuid, agendaItemId: uuid });
const listQuery = z.strictObject({ cursor: cursorSchema, limit: limitSchema });

// ------------------------------------------------------------------------------------------------ refusals (S-11)

const at422 = (code: string, detail: string, errors: readonly FieldError[]) =>
  new HttpProblem({
    status: 422,
    type: PROBLEM_TYPES.validation,
    code,
    title: "Business rule violated",
    detail,
    errors,
  });

/** The English names of the seven elements, in the order of the ADR-0032 §11 sentence. */
const ELEMENT_NAMES: Readonly<Record<AgendaAskElement, string>> = {
  decision_required: "decision required",
  why_now: "why now",
  options: "options",
  recommendation: "recommendation",
  impact_of_delay: "impact of delay",
  decision_owner: "decision owner",
  required_date: "required date",
};
/** The brief member each element is stated in (the error pointer). */
const ELEMENT_POINTERS: Readonly<Record<AgendaAskElement, string>> = {
  decision_required: "/brief/decisionRequired",
  why_now: "/brief/whyNow",
  options: "/brief/options",
  recommendation: "/brief/recommendation",
  impact_of_delay: "/brief/impactOfDelay",
  decision_owner: "/brief/ownerUserId",
  required_date: "/brief/requiredDate",
};
const capitalized = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
// Literal-key lookups only (the ADR-0002 architecture test refuses computed members with a variable key).
const ELEMENT_NAME: ReadonlyMap<string, string> = new Map(Object.entries(ELEMENT_NAMES));
const ELEMENT_POINTER: ReadonlyMap<string, string> = new Map(Object.entries(ELEMENT_POINTERS));
const nameOf = (e: AgendaAskElement) => ELEMENT_NAME.get(e) ?? e;

/** ADR-0032 §11, agenda-item lines (exact codes and English texts), plus this task's codes listed in the handback. */
export const agendaRefusals = {
  executiveAskIncomplete: (missing: readonly AgendaAskElement[]) =>
    at422(
      "agenda_item.executive_ask_incomplete",
      `An executive agenda item must state the decision required, why now, options, recommendation, impact of delay, decision owner and required date before it is published. Missing: ${missing.map(nameOf).join(", ")}.`,
      missing.map((e) => ({
        pointer: ELEMENT_POINTER.get(e) ?? "/brief",
        code: "agenda_item.executive_ask_incomplete",
        message: `${capitalized(nameOf(e))} is required.`,
      })),
    ),
  executiveAsksOnly: () =>
    problems.businessRule(
      "agenda_item.executive_asks_only",
      "Escalate decisions, not status: this forum's agenda takes executive asks only.",
    ),
  afterCutoff: () =>
    problems.businessRule(
      "agenda_item.after_cutoff",
      "The agenda cut-off for this meeting has passed, and this forum does not accept late items.",
    ),
  maxItems: (max: number) =>
    problems.businessRule("agenda_item.max_items", `This forum's agenda takes at most ${max} items.`),
  notDraft: () => problems.businessRule("agenda_item.not_draft", "Only a draft agenda item can be changed."),
  final: (status: string) =>
    problems.businessRule("agenda_item.final", `This agenda item is ${status} and can no longer be changed.`),
  decisionNotLinkable: () =>
    at422("agenda_item.decision_not_linkable", "Only an open executive ask of this transformation can be linked.", [
      {
        pointer: "/decisionId",
        code: "agenda_item.decision_not_linkable",
        message: "Only an open executive ask of this transformation can be linked.",
      },
    ]),
  quorumNotMet: (present: number, quorum: number) =>
    problems.businessRule(
      "meeting.quorum_not_met",
      `This meeting has not reached its quorum: ${present} of ${quorum} counted present. Decisions cannot be recorded below quorum.`,
    ),
  notInSession: () =>
    problems.businessRule(
      "meeting.not_in_session",
      "Decisions and blocker status are recorded while the meeting is in session or held.",
    ),
  /** New (this task; handback §6): an outcome is recorded on a published item only. */
  notPublished: () =>
    problems.businessRule("agenda_item.not_published", "Only a published agenda item can take an outcome."),
  /** New (this task; handback §6): only an executive ask takes the outcome 'decided' (agenda_item_outcome_complete). */
  outcomeNotAsk: () =>
    problems.businessRule(
      "agenda_item.outcome_not_ask",
      "Only an executive ask records a decision; record this item as noted or deferred.",
    ),
  /** New (this task; handback §6): two items of one meeting cannot share a position (agenda_item_ordinal_key). */
  ordinalTaken: () =>
    problems.duplicate("agenda_item.ordinal_taken", "Another agenda item of this meeting has this position."),
  /** New 400 field code (this task; handback §6): the agenda_item_ask_shape rule, before the database. */
  askShape: (pointer: string) =>
    problems.validation([
      {
        pointer,
        code: "validation.agenda_ask_shape",
        message: "Only an executive ask links a decision or carries a brief, and never both.",
      },
    ]),
  /** New 400 field code (this task; handback §6): materials are evidence records of this transformation. */
  evidenceUnknown: () =>
    problems.validation([
      {
        pointer: "/materialsEvidenceIds",
        code: "validation.evidence_unknown",
        message: "Choose evidence of this transformation.",
      },
    ]),
  /** Required for 'decided' (the stale-version guard of the T16 decision). */
  decisionVersionRequired: () =>
    problems.validation([
      { pointer: "/decisionVersion", code: "validation.required", message: "A required value is missing." },
    ]),
} as const;

/** ADR-0032 §11 "meeting.frozen": the children of a minutes_published or cancelled meeting can no longer change. */
export const meetingFrozen = (status: string) =>
  problems.businessRule("meeting.frozen", `This meeting is ${status}; its records can no longer be changed.`);

const FROZEN: ReadonlySet<string> = new Set(["minutes_published", "cancelled"]);

// ------------------------------------------------------------------------------------------------ shared helpers

export interface CommitteeActor {
  readonly userId: string;
  readonly principal: Principal;
  readonly target: ResolvedTarget & { readonly transformationId: string };
}

/**
 * Read gate first (404 outside scope, ADR-0006), then `permission` decided on grants reloaded inside `tx` (the
 * commit-time re-check of S-4; a denial is 403 and audited). With `technicalAdmin403` an ADM-only caller gets the
 * REQ-S10-003 403 instead of the read gate's 404 (recording a business decision, D-094).
 */
export async function requireCommitteeAction(
  tx: Tx,
  request: FastifyRequest,
  transformationId: string,
  permission: CommitteePermission,
  technicalAdmin403 = false,
): Promise<CommitteeActor> {
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

/** The meeting of a child write, locked FOR UPDATE (serializes ordinals and publication); 404 outside the transformation. */
export async function lockMeeting(tx: Tx, transformationId: string, meetingId: string): Promise<MeetingRow> {
  const m = await tx
    .selectFrom("meeting")
    .selectAll()
    .where("id", "=", meetingId)
    .where("transformation_id", "=", transformationId)
    .forUpdate()
    .executeTakeFirst();
  if (!m) throw problems.notFound();
  return m;
}

/** 422 meeting.frozen when the meeting's minutes are published or it is cancelled (ADR-0032 §3.1 "Frozen children"). */
export function assertMeetingEditable(m: Pick<MeetingRow, "status">): void {
  if (FROZEN.has(m.status)) throw meetingFrozen(m.status);
}

/** Chair is a record-level rule (ADR-0032 §9): none set -> 422 meeting.chair_unassigned; another person -> 403. */
export function assertChair(m: Pick<MeetingRow, "chair_user_id">, userId: string): void {
  if (m.chair_user_id === null) throw meetingRefusals.chairUnassigned();
  if (m.chair_user_id !== userId) throw meetingRefusals.notChair();
}

/** The meeting of a read (scope checked by the caller); 404 outside the transformation. */
export async function readMeeting(db: DbOrTx, transformationId: string, meetingId: string): Promise<MeetingRow> {
  const m = await db
    .selectFrom("meeting")
    .selectAll()
    .where("id", "=", meetingId)
    .where("transformation_id", "=", transformationId)
    .executeTakeFirst();
  if (!m) throw problems.notFound();
  return m;
}

/** Present persons who count for quorum (ADR-0032 §3.3). */
export async function presentCount(db: DbOrTx, meetingId: string): Promise<number> {
  const r = await db
    .selectFrom("meeting_attendance")
    .select(sql<number>`count(*)::integer`.as("n"))
    .where("meeting_id", "=", meetingId)
    .where("attendance", "=", "present")
    .where("counts_for_quorum", "=", true)
    .executeTakeFirstOrThrow();
  return r.n;
}

/** Sends a created append-only record (no version, so no ETag) with its Location. */
export function sendCreated(reply: FastifyReply, body: unknown, location: string): FastifyReply {
  reply.header("Location", location);
  return reply.code(201).send(body);
}

const dateOf = (d: unknown): string | null => (d === null || d === undefined ? null : String(d).slice(0, 10));

// ------------------------------------------------------------------------------------------------ mapping

interface LinkedAsk {
  readonly row: DecisionRow;
  readonly activeOptions: number;
}

function briefOf(r: AgendaItemRow): ExecutiveAskBrief | null {
  const empty =
    r.ask_decision_required === null &&
    r.ask_why_now === null &&
    r.ask_options === null &&
    r.ask_recommendation === null &&
    r.ask_impact_of_delay === null &&
    r.ask_owner_user_id === null &&
    r.ask_required_date === null;
  if (r.item_kind !== "executive_ask" || r.decision_id !== null || empty) return null;
  return {
    decisionRequired: r.ask_decision_required,
    whyNow: r.ask_why_now,
    options: r.ask_options,
    recommendation: r.ask_recommendation,
    impactOfDelay: r.ask_impact_of_delay,
    ownerUserId: r.ask_owner_user_id,
    requiredDate: dateOf(r.ask_required_date),
  };
}

/** The elements an executive ask does not state yet: from the linked T16 decision, else from the brief. */
function missingOf(r: AgendaItemRow, linked: LinkedAsk | undefined): AgendaAskElement[] {
  if (r.item_kind !== "executive_ask") return [];
  if (r.decision_id !== null) {
    if (!linked) return [];
    const d = linked.row;
    const out: AgendaAskElement[] = [];
    if (d.title.length === 0) out.push("decision_required");
    if (d.why_now === null) out.push("why_now");
    if (linked.activeOptions < 2) out.push("options");
    if (d.recommendation_option_id === null && d.recommendation_text === null) out.push("recommendation");
    if (d.impact_of_delay === null) out.push("impact_of_delay");
    if (d.owner_user_id === null) out.push("decision_owner");
    if (d.due_date === null) out.push("required_date");
    return out;
  }
  const out: AgendaAskElement[] = [];
  if (r.ask_decision_required === null) out.push("decision_required");
  if (r.ask_why_now === null) out.push("why_now");
  if (r.ask_options === null || r.ask_options.length < 2) out.push("options");
  if (r.ask_recommendation === null) out.push("recommendation");
  if (r.ask_impact_of_delay === null) out.push("impact_of_delay");
  if (r.ask_owner_user_id === null) out.push("decision_owner");
  if (r.ask_required_date === null) out.push("required_date");
  return out;
}

async function linkedAsks(db: DbOrTx, rows: readonly AgendaItemRow[]): Promise<Map<string, LinkedAsk>> {
  const ids = [...new Set(rows.map((r) => r.decision_id).filter((d): d is string => d !== null))];
  if (ids.length === 0) return new Map();
  const decisions = await db.selectFrom("decision").selectAll().where("id", "in", ids).execute();
  const counts = await db
    .selectFrom("decision_option")
    .select(["decision_id", sql<number>`count(*)::integer`.as("n")])
    .where("decision_id", "in", ids)
    .where("status", "=", "active")
    .groupBy("decision_id")
    .execute();
  const byId = new Map(counts.map((c) => [c.decision_id, c.n] as const));
  return new Map(decisions.map((d) => [d.id, { row: d, activeOptions: byId.get(d.id) ?? 0 }] as const));
}

export const toAgendaItem = (r: AgendaItemRow, linked: LinkedAsk | undefined): AgendaItem => ({
  id: r.id,
  meetingId: r.meeting_id,
  ordinal: r.ordinal,
  itemKind: r.item_kind as AgendaItem["itemKind"],
  title: r.title,
  description: r.description,
  presenterUserId: r.presenter_user_id,
  durationMinutes: r.duration_minutes,
  materialsEvidenceIds: r.materials_evidence_ids,
  decisionId: r.decision_id,
  brief: briefOf(r),
  missingElements: missingOf(r, linked),
  late: r.late,
  status: r.status as AgendaItem["status"],
  publishedAt: isoOrNull(r.published_at),
  publishedBy: r.published_by,
  outcome: r.outcome as AgendaItem["outcome"],
  outcomeQuorumPresent: r.outcome_quorum_present,
  outcomeRecordedAt: isoOrNull(r.outcome_recorded_at),
  outcomeRecordedBy: r.outcome_recorded_by,
  version: r.version,
  createdAt: iso(r.created_at),
  createdBy: r.created_by,
  updatedAt: iso(r.updated_at),
  updatedBy: r.updated_by,
});

export async function toAgendaItems(db: DbOrTx, rows: readonly AgendaItemRow[]): Promise<AgendaItem[]> {
  const asks = await linkedAsks(db, rows);
  return rows.map((r) => toAgendaItem(r, r.decision_id === null ? undefined : asks.get(r.decision_id)));
}

async function one(db: DbOrTx, row: AgendaItemRow): Promise<AgendaItem> {
  const [out] = await toAgendaItems(db, [row]);
  return out!;
}

/** The agenda-item fields audited on create and update (literal accesses only; F-DG1-124). */
const itemFields = (r: AgendaItemRow): ReadonlyMap<string, unknown> =>
  new Map<string, unknown>([
    ["ordinal", r.ordinal],
    ["item_kind", r.item_kind],
    ["title", r.title],
    ["description", r.description],
    ["presenter_user_id", r.presenter_user_id],
    ["duration_minutes", r.duration_minutes],
    ["materials_evidence_ids", r.materials_evidence_ids],
    ["decision_id", r.decision_id],
    ["ask_decision_required", r.ask_decision_required],
    ["ask_why_now", r.ask_why_now],
    ["ask_options", r.ask_options],
    ["ask_recommendation", r.ask_recommendation],
    ["ask_impact_of_delay", r.ask_impact_of_delay],
    ["ask_owner_user_id", r.ask_owner_user_id],
    ["ask_required_date", dateOf(r.ask_required_date)],
    ["late", r.late],
    ["status", r.status],
    ["outcome", r.outcome],
    ["outcome_quorum_present", r.outcome_quorum_present],
  ]);

const EMPTY: ReadonlyMap<string, unknown> = new Map();

// ------------------------------------------------------------------------------------------------ validation

type AskColumns = Pick<
  AgendaItemRow,
  | "ask_decision_required"
  | "ask_why_now"
  | "ask_options"
  | "ask_recommendation"
  | "ask_impact_of_delay"
  | "ask_owner_user_id"
  | "ask_required_date"
>;

const NO_BRIEF: AskColumns = {
  ask_decision_required: null,
  ask_why_now: null,
  ask_options: null,
  ask_recommendation: null,
  ask_impact_of_delay: null,
  ask_owner_user_id: null,
  ask_required_date: null,
};

/** A brief input merged over the current brief columns (an absent member keeps its value; null clears it). */
function mergeBrief(current: AskColumns, b: ExecutiveAskBriefInput): AskColumns {
  return {
    ask_decision_required: b.decisionRequired !== undefined ? b.decisionRequired : current.ask_decision_required,
    ask_why_now: b.whyNow !== undefined ? b.whyNow : current.ask_why_now,
    ask_options: b.options !== undefined ? b.options : current.ask_options,
    ask_recommendation: b.recommendation !== undefined ? b.recommendation : current.ask_recommendation,
    ask_impact_of_delay: b.impactOfDelay !== undefined ? b.impactOfDelay : current.ask_impact_of_delay,
    ask_owner_user_id: b.ownerUserId !== undefined ? b.ownerUserId : current.ask_owner_user_id,
    ask_required_date: b.requiredDate !== undefined ? b.requiredDate : dateOf(current.ask_required_date),
  };
}

const hasBrief = (c: AskColumns) => Object.values(c).some((v) => v !== null);

async function checkPeople(
  tx: Tx,
  organizationId: string,
  people: readonly (readonly [string, string | null | undefined])[],
): Promise<void> {
  for (const [pointer, id] of people)
    if (id !== undefined && id !== null && !(await isActiveUserOf(tx, organizationId, id)))
      throw unknownTarget(pointer, "user");
}

async function checkEvidence(tx: Tx, transformationId: string, ids: readonly string[] | undefined): Promise<void> {
  if (ids === undefined || ids.length === 0) return;
  const unique = [...new Set(ids)];
  const found = await tx
    .selectFrom("evidence")
    .select("id")
    .where("id", "in", unique)
    .where("transformation_id", "=", transformationId)
    .execute();
  if (found.length !== unique.length) throw agendaRefusals.evidenceUnknown();
}

/** An open executive ask of this transformation (kind executive, an ask origin, open or deferred), else 422. */
async function checkLinkable(tx: Tx, transformationId: string, decisionId: string): Promise<void> {
  const d = await tx
    .selectFrom("decision")
    .select(["id"])
    .where("id", "=", decisionId)
    .where("transformation_id", "=", transformationId)
    .where("kind", "=", "executive")
    .where("ask_origin", "is not", null)
    .where("status", "in", ["open", "deferred"])
    .executeTakeFirst();
  if (!d) throw agendaRefusals.decisionNotLinkable();
}

async function checkOrdinalFree(tx: Tx, meetingId: string, ordinal: number, itemId: string): Promise<void> {
  const other = await tx
    .selectFrom("agenda_item")
    .select("id")
    .where("meeting_id", "=", meetingId)
    .where("ordinal", "=", ordinal)
    .where("id", "<>", itemId)
    .executeTakeFirst();
  if (other) throw agendaRefusals.ordinalTaken();
}

/** The item of a write, locked at the expected version (428 / 409 / 404). */
async function lockItem(tx: Tx, request: FastifyRequest, meetingId: string, itemId: string): Promise<AgendaItemRow> {
  const expected = requireIfMatch(request);
  const current = await tx
    .selectFrom("agenda_item")
    .selectAll()
    .where("id", "=", itemId)
    .where("meeting_id", "=", meetingId)
    .forUpdate()
    .executeTakeFirst();
  if (!current) throw problems.notFound();
  if (current.version !== expected) throw problems.versionConflict(current.version);
  return current;
}

function assertNotFinal(r: AgendaItemRow): void {
  if (r.status === "closed" || r.status === "withdrawn") throw agendaRefusals.final(r.status);
}

/** The forum's decision output kind for a meeting decision: 'decision', else 'decision_log', else none (ADR-0032 §4). */
function decisionOutputKind(outputKinds: readonly string[]): "decision" | "decision_log" | null {
  if (outputKinds.includes("decision")) return "decision";
  if (outputKinds.includes("decision_log")) return "decision_log";
  return null;
}

// ------------------------------------------------------------------------------------------------ routes

export function registerAgendaRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  const ITEMS = "/api/v1/transformations/:transformationId/meetings/:meetingId/agenda-items";
  const ONE = `${ITEMS}/:agendaItemId`;
  const PUBLISH = `${ONE}/publish`;
  const WITHDRAW = `${ONE}/withdraw`;
  const OUTCOME = `${ONE}/outcome`;
  const read = { access: { permission: "transformation.read" as const } };
  const location = (t: string, m: string, id: string) =>
    `/api/v1/transformations/${t}/meetings/${m}/agenda-items/${id}`;

  app.get(ITEMS, { config: read }, async (request) => {
    const { transformationId, meetingId } = parse(meetingParams, request.params, "params");
    const query = parseQuery(listQuery, request.query);
    await requireTransformationRead(db, principalOf(request), transformationId);
    await readMeeting(db, transformationId, meetingId);
    const hash = filterHash({ meetingId });
    const after = decodeCursor(query.cursor, hash, 2);
    let q = db.selectFrom("agenda_item").selectAll().where("meeting_id", "=", meetingId);
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
    return { items: await toAgendaItems(db, page.items), nextCursor: page.nextCursor };
  });

  app.post(ITEMS, { config: { access: { permission: PREPARE }, consumes: JSON_BODY } }, async (request, reply) => {
    const { transformationId, meetingId } = parse(meetingParams, request.params, "params");
    const body = parseBody(agendaItemCreate, request.body);
    if (body.itemKind !== "executive_ask" && (body.decisionId !== undefined || body.brief !== undefined))
      throw agendaRefusals.askShape(body.decisionId !== undefined ? "/decisionId" : "/brief");
    if (body.decisionId !== undefined && body.brief !== undefined) throw agendaRefusals.askShape("/brief");
    const row = await db.transaction().execute(async (tx) => {
      const { userId, target } = await requireCommitteeAction(tx, request, transformationId, PREPARE);
      const meeting = await lockMeeting(tx, transformationId, meetingId);
      assertMeetingEditable(meeting);
      const forum = await tx
        .selectFrom("forum")
        .select(["executive_asks_only", "agenda_max_items", "late_items_rule"])
        .where("id", "=", meeting.forum_id)
        .executeTakeFirstOrThrow();
      if (forum.executive_asks_only && body.itemKind !== "executive_ask") throw agendaRefusals.executiveAsksOnly();
      if (forum.agenda_max_items !== null) {
        const n = await tx
          .selectFrom("agenda_item")
          .select(sql<number>`count(*)::integer`.as("n"))
          .where("meeting_id", "=", meetingId)
          .where("status", "<>", "withdrawn")
          .executeTakeFirstOrThrow();
        if (n.n >= forum.agenda_max_items) throw agendaRefusals.maxItems(forum.agenda_max_items);
      }
      // Late: created after the cut-off date (a business date in the meeting's timezone); an Unknown cut-off flags nothing.
      let late = false;
      const cutoff = dateOf(meeting.cutoff_date);
      if (cutoff !== null && (await businessToday(tx, meeting.timezone)) > cutoff) {
        if (forum.late_items_rule === "refuse") throw agendaRefusals.afterCutoff();
        late = true;
      }
      await checkPeople(tx, target.organizationId, [
        ["/presenterUserId", body.presenterUserId],
        ["/brief/ownerUserId", body.brief?.ownerUserId],
      ]);
      await checkEvidence(tx, transformationId, body.materialsEvidenceIds);
      if (body.decisionId !== undefined) await checkLinkable(tx, transformationId, body.decisionId);
      const brief = body.brief !== undefined ? mergeBrief(NO_BRIEF, body.brief) : NO_BRIEF;
      const max = await tx
        .selectFrom("agenda_item")
        .select(sql<number>`coalesce(max(ordinal), 0)::integer`.as("n"))
        .where("meeting_id", "=", meetingId)
        .executeTakeFirstOrThrow();
      if (max.n >= 999) throw agendaRefusals.maxItems(999);
      const id = uuidv7();
      const inserted = await tx
        .insertInto("agenda_item")
        .values({
          id,
          organization_id: meeting.organization_id,
          transformation_id: transformationId,
          meeting_id: meetingId,
          ordinal: max.n + 1,
          item_kind: body.itemKind,
          title: body.title,
          description: body.description ?? null,
          presenter_user_id: body.presenterUserId ?? null,
          duration_minutes: body.durationMinutes ?? null,
          materials_evidence_ids: body.materialsEvidenceIds ?? [],
          decision_id: body.decisionId ?? null,
          ...brief,
          late,
          created_by: userId,
          updated_by: userId,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await record(tx, auditContextOf(request), {
        action: "agenda_item.create",
        recordType: "agenda_item",
        recordId: id,
        organizationId: meeting.organization_id,
        transformationId,
        newVersion: 1,
        changes: { meeting_id: { from: null, to: meetingId }, ...diffFields(EMPTY, itemFields(inserted)) },
      });
      return inserted;
    });
    return sendVersioned(reply, 201, await one(db, row), location(transformationId, meetingId, row.id));
  });

  app.patch(ONE, { config: { access: { permission: PREPARE }, consumes: JSON_BODY } }, async (request, reply) => {
    const { transformationId, meetingId, agendaItemId } = parse(itemParams, request.params, "params");
    const body = parseBody(agendaItemUpdate, request.body);
    const row = await db.transaction().execute(async (tx) => {
      const { userId, target } = await requireCommitteeAction(tx, request, transformationId, PREPARE);
      const meeting = await lockMeeting(tx, transformationId, meetingId);
      assertMeetingEditable(meeting);
      const current = await lockItem(tx, request, meetingId, agendaItemId);
      assertNotFinal(current);
      if (current.status !== "draft") throw agendaRefusals.notDraft();
      const isAsk = current.item_kind === "executive_ask";
      if (!isAsk && body.decisionId !== undefined && body.decisionId !== null)
        throw agendaRefusals.askShape("/decisionId");
      if (!isAsk && body.brief !== undefined && body.brief !== null) throw agendaRefusals.askShape("/brief");
      const decisionId = body.decisionId !== undefined ? body.decisionId : current.decision_id;
      const brief =
        body.brief === null ? NO_BRIEF : body.brief !== undefined ? mergeBrief(current, body.brief) : current;
      if (decisionId !== null && hasBrief(brief)) throw agendaRefusals.askShape("/brief");
      await checkPeople(tx, target.organizationId, [
        ["/presenterUserId", body.presenterUserId],
        ["/brief/ownerUserId", body.brief?.ownerUserId],
      ]);
      await checkEvidence(tx, transformationId, body.materialsEvidenceIds);
      if (body.decisionId !== undefined && body.decisionId !== null && body.decisionId !== current.decision_id)
        await checkLinkable(tx, transformationId, body.decisionId);
      if (body.ordinal !== undefined && body.ordinal !== current.ordinal)
        await checkOrdinalFree(tx, meetingId, body.ordinal, agendaItemId);
      const updated = await tx
        .updateTable("agenda_item")
        .set({
          ...(body.title !== undefined ? { title: body.title } : {}),
          ...(body.description !== undefined ? { description: body.description } : {}),
          ...(body.presenterUserId !== undefined ? { presenter_user_id: body.presenterUserId } : {}),
          ...(body.durationMinutes !== undefined ? { duration_minutes: body.durationMinutes } : {}),
          ...(body.materialsEvidenceIds !== undefined ? { materials_evidence_ids: body.materialsEvidenceIds } : {}),
          ...(body.ordinal !== undefined ? { ordinal: body.ordinal } : {}),
          decision_id: decisionId,
          ask_decision_required: brief.ask_decision_required,
          ask_why_now: brief.ask_why_now,
          ask_options: brief.ask_options,
          ask_recommendation: brief.ask_recommendation,
          ask_impact_of_delay: brief.ask_impact_of_delay,
          ask_owner_user_id: brief.ask_owner_user_id,
          ask_required_date: dateOf(brief.ask_required_date),
          version: sql<number>`version + 1`,
          updated_at: sql<Date>`now()`,
          updated_by: userId,
        })
        .where("id", "=", agendaItemId)
        .where("version", "=", current.version)
        .returningAll()
        .executeTakeFirst();
      if (!updated) throw problems.versionConflict(current.version + 1);
      await record(tx, auditContextOf(request), {
        action: "agenda_item.update",
        recordType: "agenda_item",
        recordId: agendaItemId,
        organizationId: current.organization_id,
        transformationId,
        priorVersion: current.version,
        newVersion: updated.version,
        changes: diffFields(itemFields(current), itemFields(updated)),
      });
      return updated;
    });
    return sendVersioned(reply, 200, await one(db, row));
  });

  // Bodiless actions (no config.consumes; the completeWorkItem precedent, S-3).
  app.post(PUBLISH, { config: { access: { permission: CHAIR } } }, async (request, reply) => {
    const { transformationId, meetingId, agendaItemId } = parse(itemParams, request.params, "params");
    const row = await db.transaction().execute(async (tx) => {
      const actor = await requireCommitteeAction(tx, request, transformationId, CHAIR);
      const meeting = await lockMeeting(tx, transformationId, meetingId);
      assertMeetingEditable(meeting);
      assertChair(meeting, actor.userId);
      const current = await lockItem(tx, request, meetingId, agendaItemId);
      assertNotFinal(current);
      if (current.status !== "draft") throw agendaRefusals.notDraft();
      let decisionId = current.decision_id;
      if (current.item_kind === "executive_ask") {
        // REQ-PB-068 / REQ-S10-012: every element is checked before any write.
        const linked = decisionId === null ? undefined : (await linkedAsks(tx, [current])).get(decisionId);
        const missing = missingOf(current, linked);
        if (missing.length > 0) throw agendaRefusals.executiveAskIncomplete(missing);
        if (decisionId !== null) await checkLinkable(tx, transformationId, decisionId);
        else {
          const ctx: T16Context = {
            principal: actor.principal,
            userId: actor.userId,
            audit: auditContextOf(request),
            target: actor.target,
          };
          decisionId = await createExecutiveAsk(tx, ctx, {
            title: current.ask_decision_required!,
            whyNow: current.ask_why_now!,
            options: current.ask_options!.map((title) => ({ title })),
            recommendation: current.ask_recommendation!,
            impactOfDelay: current.ask_impact_of_delay!,
            ownerUserId: current.ask_owner_user_id!,
            requiredDate: dateOf(current.ask_required_date)!,
            context: current.description,
            origin: "agenda",
            sourceAgendaItemId: current.id,
          });
        }
      }
      // One statement: published, linked, and the brief cleared (one copy of the ask; ADR-0032 §3.2).
      const updated = await tx
        .updateTable("agenda_item")
        .set({
          status: "published",
          published_at: sql<Date>`now()`,
          published_by: actor.userId,
          decision_id: decisionId,
          ...NO_BRIEF,
          version: sql<number>`version + 1`,
          updated_at: sql<Date>`now()`,
          updated_by: actor.userId,
        })
        .where("id", "=", agendaItemId)
        .where("version", "=", current.version)
        .returningAll()
        .executeTakeFirst();
      if (!updated) throw problems.versionConflict(current.version + 1);
      await record(tx, auditContextOf(request), {
        action: "agenda_item.publish",
        recordType: "agenda_item",
        recordId: agendaItemId,
        organizationId: current.organization_id,
        transformationId,
        priorVersion: current.version,
        newVersion: updated.version,
        changes: diffFields(itemFields(current), itemFields(updated)),
      });
      return updated;
    });
    return sendVersioned(reply, 200, await one(db, row));
  });

  app.post(WITHDRAW, { config: { access: { permission: PREPARE } } }, async (request, reply) => {
    const { transformationId, meetingId, agendaItemId } = parse(itemParams, request.params, "params");
    const row = await db.transaction().execute(async (tx) => {
      const { userId } = await requireCommitteeAction(tx, request, transformationId, PREPARE);
      const meeting = await lockMeeting(tx, transformationId, meetingId);
      assertMeetingEditable(meeting);
      const current = await lockItem(tx, request, meetingId, agendaItemId);
      assertNotFinal(current);
      const updated = await tx
        .updateTable("agenda_item")
        .set({
          status: "withdrawn",
          // agenda_item_published_complete: only a published or closed item carries publication stamps (the audit
          // trail keeps who published it and when).
          published_at: null,
          published_by: null,
          version: sql<number>`version + 1`,
          updated_at: sql<Date>`now()`,
          updated_by: userId,
        })
        .where("id", "=", agendaItemId)
        .where("version", "=", current.version)
        .returningAll()
        .executeTakeFirst();
      if (!updated) throw problems.versionConflict(current.version + 1);
      await record(tx, auditContextOf(request), {
        action: "agenda_item.withdraw",
        recordType: "agenda_item",
        recordId: agendaItemId,
        organizationId: current.organization_id,
        transformationId,
        priorVersion: current.version,
        newVersion: updated.version,
        changes: {
          status: { from: current.status, to: "withdrawn" },
          ...(current.published_at !== null
            ? {
                published_at: { from: iso(current.published_at), to: null },
                published_by: { from: current.published_by, to: null },
              }
            : {}),
        },
      });
      return updated;
    });
    return sendVersioned(reply, 200, await one(db, row));
  });

  app.post(OUTCOME, { config: { access: { permission: PREPARE }, consumes: JSON_BODY } }, async (request, reply) => {
    const { transformationId, meetingId, agendaItemId } = parse(itemParams, request.params, "params");
    const body = parseBody(agendaItemOutcome, request.body);
    const row = await db
      .transaction()
      .execute(async (tx) => recordOutcome(tx, request, transformationId, meetingId, agendaItemId, body));
    return sendVersioned(reply, 200, await one(db, row));
  });

  return [`GET ${ITEMS}`, `POST ${ITEMS}`, `PATCH ${ONE}`, `POST ${PUBLISH}`, `POST ${WITHDRAW}`, `POST ${OUTCOME}`];
}

/**
 * recordAgendaItemOutcome (ADR-0032 §3.3, §4, §6, §9). 'decided': executive_decision.decide AND the decision's owner or
 * active delegate (403 executive_decision.not_owner), the meeting in session or held, the quorum reached (422
 * meeting.quorum_not_met with both numbers), all before any write; then BE-G's recordExecutiveOutcome on the linked T16
 * decision at `decisionVersion`, the item closed, and the meeting's decision output, in one transaction. 'deferred' and
 * 'noted': meeting.prepare; the item is closed with that outcome (the T16 decision is not changed).
 */
async function recordOutcome(
  tx: Tx,
  request: FastifyRequest,
  transformationId: string,
  meetingId: string,
  agendaItemId: string,
  body: AgendaItemOutcome,
): Promise<AgendaItemRow> {
  const decided = body.outcome === "decided";
  const actor = await requireCommitteeAction(tx, request, transformationId, decided ? DECIDE : PREPARE, decided);
  const meeting = await lockMeeting(tx, transformationId, meetingId);
  assertMeetingEditable(meeting);
  const current = await lockItem(tx, request, meetingId, agendaItemId);
  assertNotFinal(current);
  if (current.status !== "published") throw agendaRefusals.notPublished();
  const present = await presentCount(tx, meetingId);
  let outputKind: "decision" | "decision_log" | null = null;
  if (decided) {
    if (current.item_kind !== "executive_ask" || current.decision_id === null) throw agendaRefusals.outcomeNotAsk();
    if (body.decisionVersion === undefined) throw agendaRefusals.decisionVersionRequired();
    // Record-level rule before any other check (ADR-0032 §9): the owner, or the owner's active delegate.
    const decision = await tx
      .selectFrom("decision")
      .select(["owner_user_id"])
      .where("id", "=", current.decision_id)
      .executeTakeFirstOrThrow();
    if (decision.owner_user_id !== actor.userId) {
      const delegated =
        decision.owner_user_id !== null &&
        (await actsFor(tx, actor.principal, decision.owner_user_id, "decision", actor.target, DECIDE));
      if (!delegated) throw executiveDecisionRefusals.notOwner().withDenial(denialOf(DECIDE, actor.target));
    }
    if (meeting.status !== "in_session" && meeting.status !== "held") throw agendaRefusals.notInSession();
    if (meeting.quorum_min !== null && present < meeting.quorum_min)
      throw agendaRefusals.quorumNotMet(present, meeting.quorum_min);
    const ctx: T16Context = {
      principal: actor.principal,
      userId: actor.userId,
      audit: auditContextOf(request),
      target: actor.target,
    };
    await recordExecutiveOutcome(
      tx,
      ctx,
      current.decision_id,
      {
        outcome: "decided",
        ...(body.chosenOptionLabel !== undefined ? { chosenOptionLabel: body.chosenOptionLabel } : {}),
        ...(body.outcomeText !== undefined ? { outcomeText: body.outcomeText } : {}),
      },
      body.decisionVersion,
    );
    const forum = await tx
      .selectFrom("forum")
      .select("output_kinds")
      .where("id", "=", meeting.forum_id)
      .executeTakeFirstOrThrow();
    outputKind = decisionOutputKind(forum.output_kinds);
  }
  const updated = await tx
    .updateTable("agenda_item")
    .set({
      status: "closed",
      outcome: body.outcome,
      outcome_quorum_present: present,
      outcome_recorded_at: sql<Date>`now()`,
      outcome_recorded_by: actor.userId,
      version: sql<number>`version + 1`,
      updated_at: sql<Date>`now()`,
      updated_by: actor.userId,
    })
    .where("id", "=", agendaItemId)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirst();
  if (!updated) throw problems.versionConflict(current.version + 1);
  await record(tx, auditContextOf(request), {
    action: "agenda_item.outcome",
    recordType: "agenda_item",
    recordId: agendaItemId,
    organizationId: current.organization_id,
    transformationId,
    priorVersion: current.version,
    newVersion: updated.version,
    changes: {
      status: { from: current.status, to: "closed" },
      outcome: { from: null, to: body.outcome },
      outcome_quorum_present: { from: null, to: present },
    },
  });
  if (outputKind !== null) {
    // Every decision recorded in a meeting is a T16 entry and a meeting output (REQ-PB-061; ADR-0032 §4).
    const outputId = uuidv7();
    await tx
      .insertInto("meeting_output")
      .values({
        id: outputId,
        organization_id: current.organization_id,
        transformation_id: transformationId,
        meeting_id: meetingId,
        agenda_item_id: agendaItemId,
        output_kind: outputKind,
        record_type: "decision",
        record_id: current.decision_id,
        note: null,
        created_by: actor.userId,
      })
      .execute();
    await record(tx, auditContextOf(request), {
      action: "meeting_output.create",
      recordType: "meeting_output",
      recordId: outputId,
      organizationId: current.organization_id,
      transformationId,
      newVersion: 1,
      changes: {
        meeting_id: { from: null, to: meetingId },
        agenda_item_id: { from: null, to: agendaItemId },
        output_kind: { from: null, to: outputKind },
        record_type: { from: null, to: "decision" },
        record_id: { from: null, to: current.decision_id },
      },
    });
  }
  return updated;
}
