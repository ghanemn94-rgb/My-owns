// Meeting outputs linked to canonical records (OpenAPI tag "meetings"; ADR-0032 §4, §9, §11; REQ-PB-061; T-DG4-BE-F2):
//   GET  /transformations/{id}/meetings/{meetingId}/outputs   the meeting's outputs (transformation.read)
//   POST /transformations/{id}/meetings/{meetingId}/outputs   record one (meeting.prepare); append-only
//
// An output is one of the forum's B0093 outputs (422 meeting_output.kind_not_in_forum) and links the canonical record it
// is about (decision, RAID entry, dependency, benefit, milestone, action, evidence, benefit evidence or measurement,
// corrective case) in the same transformation (422 meeting_output.record_not_found); the kinds that are records must link
// one of their types (422 meeting_output.record_required); a kind without a record states a note. Outputs are references,
// never copies: a forecast output points at the benefit whose forecast the register shows. A Value Review meeting's
// minutes are published only with a benefit evidence or forecast output (minutes.ts). Nothing here approves anything.
import type { MeetingOutputRow, Tx } from "@mth/db";
import { sql } from "@mth/db";
import { PROBLEM_TYPES } from "@mth/shared";
import {
  meetingOutputCreate,
  type MeetingOutput,
  type MeetingOutputKind,
  type MeetingOutputRecordType,
} from "@mth/shared/schemas";
import type { FastifyInstance } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { auditContextOf, principalOf, requireTransformationRead } from "../access/index.ts";
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
  type ModuleDeps,
} from "../platform/index.ts";
import {
  assertMeetingEditable,
  lockMeeting,
  meetingParams,
  PREPARE,
  readMeeting,
  requireCommitteeAction,
  sendCreated,
} from "./agenda.ts";

const JSON_BODY = ["application/json"] as const;
const listQuery = z.strictObject({ cursor: cursorSchema, limit: limitSchema });

/** The record types each output kind may link, and whether it must link one (ADR-0032 §4 table; meeting_output_record_type). */
export const OUTPUT_RECORD_RULES: Readonly<
  Record<MeetingOutputKind, { readonly types: readonly MeetingOutputRecordType[]; readonly required: boolean }>
> = {
  decision: { types: ["decision"], required: true },
  decision_log: { types: ["decision"], required: false },
  unblocker: { types: ["raid_entry", "dependency", "decision"], required: false },
  benefit_view: { types: ["benefit"], required: false },
  integrated_status: { types: [], required: false },
  milestone: { types: ["milestone"], required: true },
  action: { types: ["action_item"], required: true },
  raid: { types: ["raid_entry", "dependency"], required: true },
  test: { types: ["evidence"], required: false },
  evidence: { types: ["evidence"], required: true },
  recommendation: { types: ["decision"], required: false },
  benefit_evidence: { types: ["benefit_evidence", "benefit_measurement"], required: true },
  forecast: { types: ["benefit", "benefit_measurement"], required: true },
  corrective_action: { types: ["corrective_case"], required: true },
};

/** OUTPUT_RECORD_RULES and OUTPUT_NAMES as maps (literal-key lookups only; the ADR-0002 architecture test). */
const RECORD_RULE = new Map(Object.entries(OUTPUT_RECORD_RULES));

/** The English names of the outputs (the forum.output_kind_invalid sentence of ADR-0032 §11). */
export const OUTPUT_NAMES: Readonly<Record<MeetingOutputKind, string>> = {
  decision: "decisions",
  unblocker: "unblockers",
  benefit_view: "benefit view",
  integrated_status: "integrated status",
  decision_log: "decision log",
  milestone: "milestones",
  action: "actions",
  raid: "RAID",
  test: "test",
  evidence: "evidence",
  recommendation: "recommendation",
  benefit_evidence: "benefit evidence",
  forecast: "forecast",
  corrective_action: "corrective action",
};

const at422 = (code: string, detail: string, pointer: string) =>
  new HttpProblem({
    status: 422,
    type: PROBLEM_TYPES.validation,
    code,
    title: "Business rule violated",
    detail,
    errors: [{ pointer, code, message: detail }],
  });

/** ADR-0032 §11, output lines (exact codes and English texts), plus this task's codes listed in the handback. */
export const outputRefusals = {
  kindNotInForum: (kind: string) =>
    at422("meeting_output.kind_not_in_forum", `${kind} is not an output of this forum.`, "/outputKind"),
  recordRequired: (types: readonly string[]) =>
    at422("meeting_output.record_required", `This output links a record of type ${types.join(" or ")}.`, "/recordType"),
  recordNotFound: () =>
    at422("meeting_output.record_not_found", "The linked record does not exist in this transformation.", "/recordId"),
  /** New 400 field code (this task; handback §6): meeting_output_record_pair, before the database. */
  recordPair: (pointer: string) =>
    problems.validation([
      {
        pointer,
        code: "validation.record_pair",
        message: "A linked record names both its record type and its record.",
      },
    ]),
  /** A kind without a record states a note (meeting_output_note_or_record). */
  noteRequired: () =>
    problems.validation([{ pointer: "/note", code: "validation.required", message: "A required value is missing." }]),
  /** New 400 field code (this task; handback §6): an agenda item named on a meeting record is one of its items. */
  agendaItemUnknown: () =>
    problems.validation([
      {
        pointer: "/agendaItemId",
        code: "validation.agenda_item_unknown",
        message: "Choose an agenda item of this meeting.",
      },
    ]),
} as const;

const OUTPUT_NAME: ReadonlyMap<string, string> = new Map(Object.entries(OUTPUT_NAMES));
/** The English name of an output kind (its code when unknown). */
export const outputNameOf = (kind: string): string => OUTPUT_NAME.get(kind) ?? kind;

export const toMeetingOutput = (r: MeetingOutputRow): MeetingOutput => ({
  id: r.id,
  meetingId: r.meeting_id,
  agendaItemId: r.agenda_item_id,
  outputKind: r.output_kind as MeetingOutput["outputKind"],
  recordType: r.record_type as MeetingOutput["recordType"],
  recordId: r.record_id,
  note: r.note,
  createdAt: iso(r.created_at),
  createdBy: r.created_by,
});

/** True when `recordType` row `recordId` exists in the transformation (the meeting_output_record_ref rule). */
async function recordExists(
  tx: Tx,
  transformationId: string,
  recordType: MeetingOutputRecordType,
  recordId: string,
): Promise<boolean> {
  // recordType is one of the closed enum's table names (zod-validated), never caller text.
  const r = await sql<{ found: boolean }>`
    SELECT EXISTS (SELECT 1 FROM ${sql.table(recordType)} WHERE id = ${recordId}::uuid
                   AND transformation_id = ${transformationId}::uuid) AS found`.execute(tx);
  return r.rows[0]?.found === true;
}

/** An agenda item named on a meeting record must be one of the meeting's items (400 at /agendaItemId). */
export async function checkAgendaItemOf(tx: Tx, meetingId: string, agendaItemId: string | undefined): Promise<void> {
  if (agendaItemId === undefined) return;
  const item = await tx
    .selectFrom("agenda_item")
    .select("id")
    .where("id", "=", agendaItemId)
    .where("meeting_id", "=", meetingId)
    .executeTakeFirst();
  if (!item) throw outputRefusals.agendaItemUnknown();
}

export function registerMeetingOutputRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  const OUTPUTS = "/api/v1/transformations/:transformationId/meetings/:meetingId/outputs";
  const read = { access: { permission: "transformation.read" as const } };

  app.get(OUTPUTS, { config: read }, async (request) => {
    const { transformationId, meetingId } = parse(meetingParams, request.params, "params");
    const query = parseQuery(listQuery, request.query);
    await requireTransformationRead(db, principalOf(request), transformationId);
    await readMeeting(db, transformationId, meetingId);
    const hash = filterHash({ meetingId });
    // Creation order by the time-ordered UUIDv7 id (a timestamp cursor would lose PostgreSQL's microseconds).
    const after = decodeCursor(query.cursor, hash, 1);
    let q = db.selectFrom("meeting_output").selectAll().where("meeting_id", "=", meetingId);
    if (after) q = q.where("id", ">", String(after[0]));
    const rows = await q
      .orderBy("id")
      .limit(query.limit + 1)
      .execute();
    const page = paginate(rows, query.limit, (r) => [r.id], hash);
    return { items: page.items.map(toMeetingOutput), nextCursor: page.nextCursor };
  });

  app.post(OUTPUTS, { config: { access: { permission: PREPARE }, consumes: JSON_BODY } }, async (request, reply) => {
    const { transformationId, meetingId } = parse(meetingParams, request.params, "params");
    const body = parseBody(meetingOutputCreate, request.body);
    if ((body.recordType === undefined) !== (body.recordId === undefined))
      throw outputRefusals.recordPair(body.recordType === undefined ? "/recordType" : "/recordId");
    const row = await db.transaction().execute(async (tx) => {
      const { userId } = await requireCommitteeAction(tx, request, transformationId, PREPARE);
      const meeting = await lockMeeting(tx, transformationId, meetingId);
      assertMeetingEditable(meeting);
      const forum = await tx
        .selectFrom("forum")
        .select("output_kinds")
        .where("id", "=", meeting.forum_id)
        .executeTakeFirstOrThrow();
      if (!forum.output_kinds.includes(body.outputKind)) throw outputRefusals.kindNotInForum(body.outputKind);
      const rule = RECORD_RULE.get(body.outputKind)!;
      if (
        (rule.required && body.recordType === undefined) ||
        (body.recordType !== undefined && !rule.types.includes(body.recordType))
      )
        throw outputRefusals.recordRequired(rule.types.length > 0 ? rule.types : ["none"]);
      if (body.recordType === undefined && body.note === undefined) throw outputRefusals.noteRequired();
      if (
        body.recordType !== undefined &&
        body.recordId !== undefined &&
        !(await recordExists(tx, transformationId, body.recordType, body.recordId))
      )
        throw outputRefusals.recordNotFound();
      await checkAgendaItemOf(tx, meetingId, body.agendaItemId);
      const id = uuidv7();
      const inserted = await tx
        .insertInto("meeting_output")
        .values({
          id,
          organization_id: meeting.organization_id,
          transformation_id: transformationId,
          meeting_id: meetingId,
          agenda_item_id: body.agendaItemId ?? null,
          output_kind: body.outputKind,
          record_type: body.recordType ?? null,
          record_id: body.recordId ?? null,
          note: body.note ?? null,
          created_by: userId,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await record(tx, auditContextOf(request), {
        action: "meeting_output.create",
        recordType: "meeting_output",
        recordId: id,
        organizationId: meeting.organization_id,
        transformationId,
        newVersion: 1,
        changes: {
          meeting_id: { from: null, to: meetingId },
          agenda_item_id: { from: null, to: inserted.agenda_item_id },
          output_kind: { from: null, to: inserted.output_kind },
          record_type: { from: null, to: inserted.record_type },
          record_id: { from: null, to: inserted.record_id },
          note: { from: null, to: inserted.note },
        },
      });
      return inserted;
    });
    return sendCreated(
      reply,
      toMeetingOutput(row),
      // Outputs have no single-record read; the Location is the meeting's output list that contains it.
      `/api/v1/transformations/${transformationId}/meetings/${meetingId}/outputs`,
    );
  });

  return [`GET ${OUTPUTS}`, `POST ${OUTPUTS}`];
}
