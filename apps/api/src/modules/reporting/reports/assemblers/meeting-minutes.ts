// The `meeting_minutes` assembler (ADR-0045 §1, §3, §5; B0093 operating rhythm "Outputs"; REQ-S13-004; p5-work-split
// §F.4; T-DG5-KBE-D2).
//
// Subject: one meeting (`meeting`) of the transformation. What it reads, read only and in the order of the DG4 meeting
// screen's own routes (governance: meetings.ts, attendance.ts, minutes.ts, agenda.ts, meeting-outputs.ts,
// meeting-actions.ts). `reporting` may import governance only through its index.ts, which exposes no read service, so
// this file reads the same tables with the same filters and order as those list routes (assembler.ts allows it):
//  - `meeting`: the meeting record with its forum (both forum names, as seeded in en and ar), schedule, chair,
//    secretary, quorum, cut-off date and present count (GET …/meetings/{m}; present = attendance `present` rows that
//    count for quorum, agenda.ts `presentCount`);
//  - `attendance`: every attendance row (GET …/attendance; order: created_at, id);
//  - `minutes`: the DG4 minutes - their status (draft, approved, published), the body as authored and the approval and
//    publication stamps; or the code `no_minutes` when none were drafted (never a blank);
//  - `agenda`: every agenda item with its outcome and its linked T16 decision (GET …/agenda-items; ordinal, id);
//  - `outputs`: the recorded meeting outputs (GET …/outputs; created_at, id), each with its linked record;
//  - `actions`: the meeting's actions through `meeting_action_link` (GET …/actions; link id order) with the action
//    register's own fields.
// Snapshot approval state (ADR-0045 §3): `approved` once the minutes are approved (approved or published), else
// `pending` (also when no minutes exist yet). A recorded fact: approving minutes is a meeting record step, not a G1-G6
// business approval, and nothing here touches the engineering gates DG0-DG7.
// Labels (ADR-0045 §5, rule 6): meeting records carry no validation state, so every value is not_applicable; a missing
// value the record should have (an unresolved chair, an Unknown cut-off) is Unknown with no text, never a placeholder.
import type { DbOrTx, DecisionRow, MeetingRow } from "@mth/db";
import { emptyReportParameters, type ReportColumn, type ReportField, type ReportRow } from "@mth/shared/schemas";
import {
  codeValue,
  countValue,
  dateValue,
  textValue,
  timestampValue,
  userNames,
  type Assembler,
  type AssembledOutput,
  type AssemblyContext,
  type SourceRecord,
} from "../assembler.ts";
import { reportRefusals } from "../definitions.ts";
import { NOT_APPLICABLE, UNKNOWN_MISSING } from "../provisional.ts";

const L = (k: string) => `report.meeting_minutes.${k}`;
/** Labels shared by the minutes and the meeting pack (`report.meeting.*`). */
export const ML = (k: string) => `report.meeting.${k}`;

export const meetingColumn = (key: string, valueKind: ReportColumn["valueKind"], prefix = ML): ReportColumn => ({
  key,
  labelKey: prefix(key),
  valueKind,
  unitKind: null,
});

// ------------------------------------------------------------------------------------------------ pure mapping

/** ADR-0045 §3: the minutes' snapshot approval state (approved once approved or published, else pending). */
export function minutesApprovalState(status: string | null): "approved" | "pending" {
  return status === "approved" || status === "published" ? "approved" : "pending";
}

/** A nullable author-written text: absent is "not stated" (n/a), never a placeholder sentence. */
export const optionalText = (v: string | null) => (v === null ? textValue(null, "user", NOT_APPLICABLE) : textValue(v));

/** A date the source may not know (cut-off): absent is Unknown (missing), never a guessed date. */
export const knownDate = (v: unknown) =>
  dateValue(v === null || v === undefined ? null : String(v).slice(0, 10), v === null ? UNKNOWN_MISSING : undefined);

/** Collects source rows once per record (report_snapshot_source is unique per snapshot and record). */
export class SourceSet {
  private readonly seen = new Set<string>();
  readonly rows: SourceRecord[] = [];
  add(r: SourceRecord): void {
    const k = `${r.recordType}:${r.recordId}`;
    if (this.seen.has(k)) return;
    this.seen.add(k);
    this.rows.push(r);
  }
  record(
    sectionKey: string,
    recordType: string,
    r: { id: string; version: number; updated_at?: Date | string | null; created_at?: Date | string | null },
    approvalState: SourceRecord["approvalState"] = null,
  ): void {
    this.add({
      sectionKey,
      recordType,
      recordId: r.id,
      recordVersion: r.version,
      recordUpdatedAt: r.updated_at ?? r.created_at ?? null,
      approvalState,
      validationState: "not_applicable",
    });
  }
}

/** The record references of a table's rows, for the section's `sources`. */
export const refsOf = (rows: readonly ReportRow[]) =>
  rows.map((r) => ({ recordType: r.recordType, recordId: r.recordId, recordVersion: r.recordVersion }));

// ------------------------------------------------------------------------------------------------ shared reads

export interface MeetingFacts {
  readonly meeting: MeetingRow;
  readonly forum: { id: string; name_en: string; name_ar: string; version: number; updated_at: Date | string };
  readonly present: number;
}

/** The meeting (already checked to be a record of the transformation) with its forum and present count. */
export async function loadMeetingFacts(db: DbOrTx, transformationId: string, meetingId: string): Promise<MeetingFacts> {
  const meeting = await db
    .selectFrom("meeting")
    .selectAll()
    .where("id", "=", meetingId)
    .where("transformation_id", "=", transformationId)
    .executeTakeFirst();
  // snapshots.ts already checked the subject (RS06); a missing one here is a refused subject, never an empty report.
  if (meeting === undefined) throw reportRefusals.subjectInvalid();
  const forum = await db
    .selectFrom("forum")
    .select(["id", "name_en", "name_ar", "version", "updated_at"])
    .where("id", "=", meeting.forum_id)
    .executeTakeFirstOrThrow();
  const n = await db
    .selectFrom("meeting_attendance")
    .select((eb) => eb.fn.countAll<string>().as("n"))
    .where("meeting_id", "=", meetingId)
    .where("attendance", "=", "present")
    .where("counts_for_quorum", "=", true)
    .executeTakeFirstOrThrow();
  return { meeting, forum, present: Number(n.n) };
}

/** The `meeting` fields section shared by the minutes and the pack. */
export function meetingFields(f: MeetingFacts, names: ReadonlyMap<string, string>): ReportField[] {
  const m = f.meeting;
  const person = (id: string | null) => textValue(id === null ? null : (names.get(id) ?? null), "system");
  return [
    { key: "forum_name_en", labelKey: ML("forum_name_en"), value: textValue(f.forum.name_en, "system") },
    { key: "forum_name_ar", labelKey: ML("forum_name_ar"), value: textValue(f.forum.name_ar, "system") },
    { key: "scheduled_date", labelKey: ML("scheduled_date"), value: dateValue(String(m.scheduled_date).slice(0, 10)) },
    { key: "starts_at", labelKey: ML("starts_at"), value: timestampValue(m.starts_at) },
    { key: "ends_at", labelKey: ML("ends_at"), value: timestampValue(m.ends_at) },
    { key: "timezone", labelKey: ML("timezone"), value: textValue(m.timezone, "system") },
    { key: "location", labelKey: ML("location"), value: optionalText(m.location) },
    { key: "status", labelKey: ML("status"), value: codeValue(m.status, "report.meeting_status") },
    // An unresolved chair (no person mapped to the forum's chair party) is Unknown, as the DG4 chair_unassigned flag.
    { key: "chair", labelKey: ML("chair"), value: person(m.chair_user_id) },
    {
      key: "secretary",
      labelKey: ML("secretary"),
      value: m.secretary_user_id === null ? textValue(null, "system", NOT_APPLICABLE) : person(m.secretary_user_id),
    },
    {
      key: "quorum_min",
      labelKey: ML("quorum_min"),
      value: countValue(m.quorum_min, m.quorum_min === null ? NOT_APPLICABLE : undefined),
    },
    { key: "present_count", labelKey: ML("present_count"), value: countValue(f.present) },
    { key: "cutoff_date", labelKey: ML("cutoff_date"), value: knownDate(m.cutoff_date) },
    {
      key: "held_at",
      labelKey: ML("held_at"),
      value: timestampValue(m.held_at, m.held_at === null ? NOT_APPLICABLE : undefined),
    },
  ];
}

/** The meeting's actions (GET …/actions order: the link id) with the action register's fields. */
export async function meetingActions(
  db: DbOrTx,
  meetingId: string,
  sectionKey: string,
  sources: SourceSet,
): Promise<{ rows: ReportRow[]; owners: string[] }> {
  const links = await db
    .selectFrom("meeting_action_link as l")
    .innerJoin("action_item as a", "a.id", "l.action_item_id")
    .select([
      "l.id as linkId",
      "l.link_kind",
      "l.agenda_item_id",
      "a.id",
      "a.title",
      "a.owner_user_id",
      "a.due_date",
      "a.status",
      "a.version",
      "a.updated_at",
    ])
    .where("l.meeting_id", "=", meetingId)
    .orderBy("l.id")
    .execute();
  const rows: ReportRow[] = [];
  for (const a of links) {
    sources.record(sectionKey, "action_item", a);
    rows.push({
      recordType: "action_item",
      recordId: a.id,
      recordVersion: a.version,
      cells: [
        textValue(a.title),
        textValue(null, "system"), // owner name: filled below
        dateValue(
          a.due_date === null ? null : String(a.due_date).slice(0, 10),
          a.due_date === null ? NOT_APPLICABLE : undefined,
        ),
        codeValue(a.status, "report.action_status"),
        codeValue(a.link_kind, "report.meeting_action_link_kind"),
      ],
    });
  }
  return { rows, owners: links.map((l) => l.owner_user_id) };
}

export const ACTION_COLUMNS: ReportColumn[] = [
  meetingColumn("action_title", "text"),
  meetingColumn("action_owner", "text"),
  meetingColumn("action_due_date", "date"),
  meetingColumn("action_status", "code"),
  meetingColumn("action_link_kind", "code"),
];

/** Fills the owner column of `meetingActions` rows once the names are loaded. */
export function withOwners(
  rows: ReportRow[],
  owners: readonly string[],
  names: ReadonlyMap<string, string>,
): ReportRow[] {
  return rows.map((r, i) => {
    const owner = owners.at(i);
    return {
      ...r,
      cells: r.cells.map((c, j) =>
        j === 1 ? textValue(owner === undefined ? null : (names.get(owner) ?? null), "system") : c,
      ),
    };
  });
}

/** The T16 decisions linked by agenda items (DecisionRow by id). */
export async function linkedDecisions(db: DbOrTx, ids: readonly (string | null)[]): Promise<Map<string, DecisionRow>> {
  const wanted = [...new Set(ids.filter((i): i is string => i !== null))];
  if (wanted.length === 0) return new Map();
  const rows = await db.selectFrom("decision").selectAll().where("id", "in", wanted).execute();
  return new Map(rows.map((d) => [d.id, d] as const));
}

/** A decision reference as text: its code and title (system text built from the record), or n/a when none. */
export const decisionRef = (d: DecisionRow | undefined) =>
  d === undefined ? textValue(null, "system", NOT_APPLICABLE) : textValue(`${d.code} ${d.title}`, "system");

// ------------------------------------------------------------------------------------------------ assembly

async function assemble(ctx: AssemblyContext): Promise<AssembledOutput> {
  const { db } = ctx;
  const tId = ctx.transformation.id;
  const f = await loadMeetingFacts(db, tId, ctx.subject.id);
  const m = f.meeting;
  const sources = new SourceSet();
  sources.record("meeting", "meeting", m);
  sources.record("meeting", "forum", f.forum);

  const [attendance, minutes, agenda, outputs] = await Promise.all([
    db
      .selectFrom("meeting_attendance")
      .selectAll()
      .where("meeting_id", "=", m.id)
      .orderBy("created_at")
      .orderBy("id")
      .execute(),
    db.selectFrom("meeting_minutes").selectAll().where("meeting_id", "=", m.id).executeTakeFirst(),
    db.selectFrom("agenda_item").selectAll().where("meeting_id", "=", m.id).orderBy("ordinal").orderBy("id").execute(),
    db
      .selectFrom("meeting_output")
      .selectAll()
      .where("meeting_id", "=", m.id)
      .orderBy("created_at")
      .orderBy("id")
      .execute(),
  ]);
  const actions = await meetingActions(db, m.id, "actions", sources);
  const decisions = await linkedDecisions(db, [
    ...agenda.map((a) => a.decision_id),
    ...outputs.filter((o) => o.record_type === "decision").map((o) => o.record_id),
  ]);
  const names = await userNames(db, [
    m.chair_user_id,
    m.secretary_user_id,
    ...attendance.flatMap((a) => [a.user_id, a.on_behalf_of_user_id]),
    minutes?.approved_by ?? null,
    minutes?.published_by ?? null,
    ...actions.owners,
  ]);
  const name = (id: string | null) => textValue(id === null ? null : (names.get(id) ?? null), "system");

  // Attendance.
  const attendanceRows: ReportRow[] = attendance.map((a) => {
    sources.record("attendance", "meeting_attendance", a);
    return {
      recordType: "meeting_attendance",
      recordId: a.id,
      recordVersion: a.version,
      cells: [
        name(a.user_id),
        codeValue(a.attendance, "report.attendance"),
        codeValue(a.counts_for_quorum ? "yes" : "no", "report.yes_no"),
        a.on_behalf_of_user_id === null ? textValue(null, "system", NOT_APPLICABLE) : name(a.on_behalf_of_user_id),
        optionalText(a.note),
      ],
    };
  });

  // Minutes.
  const minutesFields: ReportField[] = [];
  if (minutes === undefined) {
    minutesFields.push({
      key: "minutes_state",
      labelKey: L("minutes_state"),
      value: codeValue("no_minutes", L("minutes_state")),
    });
  } else {
    sources.record("minutes", "meeting_minutes", minutes, minutesApprovalState(minutes.status));
    const stamp = (at: Date | string | null) => timestampValue(at, at === null ? NOT_APPLICABLE : undefined);
    const by = (id: string | null) => (id === null ? textValue(null, "system", NOT_APPLICABLE) : name(id));
    minutesFields.push(
      { key: "minutes_state", labelKey: L("minutes_state"), value: codeValue(minutes.status, L("minutes_state")) },
      { key: "body", labelKey: L("body"), value: textValue(minutes.body) },
      { key: "approved_at", labelKey: L("approved_at"), value: stamp(minutes.approved_at) },
      { key: "approved_by", labelKey: L("approved_by"), value: by(minutes.approved_by) },
      { key: "published_at", labelKey: L("published_at"), value: stamp(minutes.published_at) },
      { key: "published_by", labelKey: L("published_by"), value: by(minutes.published_by) },
    );
  }

  // Agenda outcomes.
  const agendaRows: ReportRow[] = agenda.map((a) => {
    sources.record("agenda", "agenda_item", a);
    const d = a.decision_id === null ? undefined : decisions.get(a.decision_id);
    if (d !== undefined) sources.record("agenda", "decision", d);
    return {
      recordType: "agenda_item",
      recordId: a.id,
      recordVersion: a.version,
      cells: [
        countValue(a.ordinal),
        codeValue(a.item_kind, "report.agenda_item_kind"),
        textValue(a.title),
        codeValue(a.status, "report.agenda_item_status"),
        codeValue(a.outcome, "report.agenda_item_outcome", a.outcome === null ? NOT_APPLICABLE : undefined),
        decisionRef(d),
        codeValue(d?.status ?? null, "report.decision_status", d === undefined ? NOT_APPLICABLE : undefined),
      ],
    };
  });

  // Outputs (append-only rows: version 1, as the DG4 table has no version column).
  const agendaTitle = new Map(agenda.map((a) => [a.id, a.title] as const));
  const outputRows: ReportRow[] = outputs.map((o) => {
    sources.add({
      sectionKey: "outputs",
      recordType: "meeting_output",
      recordId: o.id,
      recordVersion: 1,
      recordUpdatedAt: o.created_at,
      approvalState: null,
      validationState: "not_applicable",
    });
    const d = o.record_type === "decision" && o.record_id !== null ? decisions.get(o.record_id) : undefined;
    return {
      recordType: "meeting_output",
      recordId: o.id,
      recordVersion: 1,
      cells: [
        codeValue(o.output_kind, "report.meeting_output_kind"),
        codeValue(o.record_type, "report.record_type", o.record_type === null ? NOT_APPLICABLE : undefined),
        d !== undefined ? decisionRef(d) : textValue(null, "system", NOT_APPLICABLE),
        o.agenda_item_id === null
          ? textValue(null, "user", NOT_APPLICABLE)
          : textValue(agendaTitle.get(o.agenda_item_id) ?? null),
        optionalText(o.note),
        timestampValue(o.created_at),
      ],
    };
  });

  const actionRows = withOwners(actions.rows, actions.owners, names);
  return {
    subject: {
      code: String(m.scheduled_date).slice(0, 10),
      label: `${f.forum.name_en} ${String(m.scheduled_date).slice(0, 10)}`,
    },
    approvalState: minutesApprovalState(minutes?.status ?? null),
    sections: [
      {
        key: "meeting",
        titleKey: ML("title"),
        kind: "fields",
        sources: [
          { recordType: "meeting", recordId: m.id, recordVersion: m.version },
          { recordType: "forum", recordId: f.forum.id, recordVersion: f.forum.version },
        ],
        fields: meetingFields(f, names),
      },
      {
        key: "attendance",
        titleKey: L("attendance"),
        kind: "table",
        sources: refsOf(attendanceRows),
        columns: [
          meetingColumn("attendee", "text", L),
          meetingColumn("attendance", "code", L),
          meetingColumn("counts_for_quorum", "code", L),
          meetingColumn("on_behalf_of", "text", L),
          meetingColumn("note", "text", L),
        ],
        rows: attendanceRows,
        totals: [],
        emptyKey: "report.empty.no_records",
      },
      {
        key: "minutes",
        titleKey: L("minutes"),
        kind: "fields",
        sources:
          minutes === undefined
            ? []
            : [{ recordType: "meeting_minutes", recordId: minutes.id, recordVersion: minutes.version }],
        fields: minutesFields,
      },
      {
        key: "agenda",
        titleKey: L("agenda"),
        kind: "table",
        sources: refsOf(agendaRows),
        columns: [
          meetingColumn("ordinal", "count"),
          meetingColumn("item_kind", "code"),
          meetingColumn("item_title", "text"),
          meetingColumn("item_status", "code"),
          meetingColumn("outcome", "code"),
          meetingColumn("decision", "text"),
          meetingColumn("decision_status", "code"),
        ],
        rows: agendaRows,
        totals: [],
        emptyKey: "report.empty.no_records",
      },
      {
        key: "outputs",
        titleKey: L("outputs"),
        kind: "table",
        sources: refsOf(outputRows),
        columns: [
          meetingColumn("output_kind", "code", L),
          meetingColumn("record_type", "code", L),
          meetingColumn("linked_decision", "text", L),
          meetingColumn("agenda_item", "text", L),
          meetingColumn("note", "text", L),
          meetingColumn("recorded_at", "timestamp", L),
        ],
        rows: outputRows,
        totals: [],
        emptyKey: "report.empty.no_records",
      },
      {
        key: "actions",
        titleKey: ML("actions"),
        kind: "table",
        sources: refsOf(actionRows),
        columns: ACTION_COLUMNS,
        rows: actionRows,
        totals: [],
        emptyKey: "report.empty.no_records",
      },
    ],
    sources: sources.rows,
    versions: [],
    evidence: [],
  };
}

export const meetingMinutesAssembler: Assembler = {
  code: "meeting_minutes",
  parseParameters(raw) {
    const r = emptyReportParameters.safeParse(raw ?? {});
    if (!r.success) throw reportRefusals.parametersInvalid();
    return r.data;
  },
  assemble,
};
