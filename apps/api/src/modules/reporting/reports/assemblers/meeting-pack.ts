// The `meeting_pack` assembler (ADR-0045 §1, §3, §5, §7; M0212 printable packs and presentation mode; B0093; B0102
// "Escalate decisions, not status"; REQ-S13-004, REQ-S10-013; p5-work-split §F.4, §F.7; T-DG5-KBE-D2).
//
// Subject: one meeting of the transformation. The pack and the live presentation (governance/presentation.ts, BE-O)
// come from this one assembler over the same records; nothing is typed into the pack (M0212). Sections:
//  - `meeting`: the meeting record (the fields shared with the minutes, meeting-minutes.ts);
//  - `agenda`: every agenda item in agenda order (GET …/agenda-items: ordinal, id) with its kind, title, description,
//    presenter, duration, late flag, status, outcome and its linked T16 decision (code and title, status);
//  - `asks`: one row per executive-ask item: the seven B0102 elements read from the linked T16 decision when the item
//    links one (title, why now, active options, recommendation, impact of delay, decision owner, due date: agenda.ts
//    `missingOf`), else from the item's draft brief; with the count of elements still missing and the decision's status.
//    A linked decision changed before cut-off therefore appears changed in the live view, while an issued pack keeps
//    the snapshot (REQ-S10-013);
//  - `decisions`: each linked T16 decision with its owner, due date, recommendation, outcome and decision time;
//  - `actions`: the meeting's actions (GET …/actions).
// `reporting` may import governance only through its index.ts, which exposes no read service, so the same tables are
// read with the same filters and order as those routes (assembler.ts allows it).
// Snapshot approval state: not_applicable (ADR-0045 §3). Recording an outcome or issuing a pack approves nothing; product
// gates G1-G6 are business approvals inside the product, and nothing here touches DG0-DG7. Labels: rule 6 (meeting
// records have no validation state): not_applicable; an element the ask does not state yet is Unknown (missing), never
// a placeholder text, and counted in `missing_elements`.
import type { AgendaItemRow, DbOrTx, DecisionRow } from "@mth/db";
import { emptyReportParameters, type ReportRow, type ReportValue } from "@mth/shared/schemas";
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
} from "../assembler.ts";
import { reportRefusals } from "../definitions.ts";
import { NOT_APPLICABLE } from "../provisional.ts";
import {
  ACTION_COLUMNS,
  decisionRef,
  linkedDecisions,
  loadMeetingFacts,
  meetingActions,
  meetingColumn,
  meetingFields,
  ML,
  optionalText,
  refsOf,
  SourceSet,
  withOwners,
} from "./meeting-minutes.ts";

const L = (k: string) => `report.meeting_pack.${k}`;

export interface OptionFact {
  readonly id: string;
  readonly label: string;
  readonly title: string;
  readonly ordinal: number;
}

/** The seven B0102 elements of an executive ask, as the pack states them (null = not stated yet). */
export interface AskElements {
  readonly decisionRequired: string | null;
  readonly whyNow: string | null;
  readonly options: readonly string[];
  readonly recommendation: string | null;
  readonly impactOfDelay: string | null;
  readonly ownerUserId: string | null;
  readonly requiredDate: string | null;
}

const dateOf = (d: unknown): string | null => (d === null || d === undefined ? null : String(d).slice(0, 10));

/**
 * Pure: the elements of an ask - from its linked T16 decision when it has one (the decision's active options in
 * ordinal order; the recommendation as the recommended option or the decision's text), else from the draft brief.
 */
export function askElements(
  item: Pick<
    AgendaItemRow,
    | "decision_id"
    | "ask_decision_required"
    | "ask_why_now"
    | "ask_options"
    | "ask_recommendation"
    | "ask_impact_of_delay"
    | "ask_owner_user_id"
    | "ask_required_date"
  >,
  decision: Pick<
    DecisionRow,
    | "title"
    | "why_now"
    | "recommendation_option_id"
    | "recommendation_text"
    | "impact_of_delay"
    | "owner_user_id"
    | "due_date"
  > | null,
  options: readonly OptionFact[],
): AskElements {
  if (item.decision_id !== null && decision !== null) {
    const sorted = [...options].sort((a, b) => a.ordinal - b.ordinal || a.id.localeCompare(b.id));
    const rec = sorted.find((o) => o.id === decision.recommendation_option_id);
    return {
      decisionRequired: decision.title.length === 0 ? null : decision.title,
      whyNow: decision.why_now,
      options: sorted.map((o) => `${o.label}. ${o.title}`),
      recommendation: rec !== undefined ? `${rec.label}. ${rec.title}` : decision.recommendation_text,
      impactOfDelay: decision.impact_of_delay,
      ownerUserId: decision.owner_user_id,
      requiredDate: dateOf(decision.due_date),
    };
  }
  return {
    decisionRequired: item.ask_decision_required,
    whyNow: item.ask_why_now,
    options: item.ask_options ?? [],
    recommendation: item.ask_recommendation,
    impactOfDelay: item.ask_impact_of_delay,
    ownerUserId: item.ask_owner_user_id,
    requiredDate: dateOf(item.ask_required_date),
  };
}

/** Pure: how many of the seven elements are not stated (options need at least two; agenda.ts `missingOf`). */
export function missingElementCount(e: AskElements): number {
  return [
    e.decisionRequired === null,
    e.whyNow === null,
    e.options.length < 2,
    e.recommendation === null,
    e.impactOfDelay === null,
    e.ownerUserId === null,
    e.requiredDate === null,
  ].filter(Boolean).length;
}

async function activeOptions(db: DbOrTx, decisionIds: readonly string[]): Promise<Map<string, OptionFact[]>> {
  const out = new Map<string, OptionFact[]>();
  if (decisionIds.length === 0) return out;
  const rows = await db
    .selectFrom("decision_option")
    .select(["id", "decision_id", "label", "title", "ordinal"])
    .where("decision_id", "in", [...decisionIds])
    .where("status", "=", "active")
    .orderBy("ordinal")
    .orderBy("id")
    .execute();
  for (const r of rows) out.set(r.decision_id, [...(out.get(r.decision_id) ?? []), r]);
  return out;
}

async function assemble(ctx: AssemblyContext): Promise<AssembledOutput> {
  const { db } = ctx;
  const f = await loadMeetingFacts(db, ctx.transformation.id, ctx.subject.id);
  const m = f.meeting;
  const sources = new SourceSet();
  sources.record("meeting", "meeting", m);
  sources.record("meeting", "forum", f.forum);

  const agenda = await db
    .selectFrom("agenda_item")
    .selectAll()
    .where("meeting_id", "=", m.id)
    .orderBy("ordinal")
    .orderBy("id")
    .execute();
  const decisions = await linkedDecisions(
    db,
    agenda.map((a) => a.decision_id),
  );
  const options = await activeOptions(db, [...decisions.keys()]);
  const actions = await meetingActions(db, m.id, "actions", sources);
  const elements = new Map(
    agenda
      .filter((a) => a.item_kind === "executive_ask")
      .map((a) => {
        const d = a.decision_id === null ? null : (decisions.get(a.decision_id) ?? null);
        return [a.id, askElements(a, d, d === null ? [] : (options.get(d.id) ?? []))] as const;
      }),
  );
  const names = await userNames(db, [
    m.chair_user_id,
    m.secretary_user_id,
    ...agenda.map((a) => a.presenter_user_id),
    ...[...elements.values()].map((e) => e.ownerUserId),
    ...[...decisions.values()].map((d) => d.owner_user_id),
    ...actions.owners,
  ]);
  const person = (id: string | null, absent: "n/a" | "unknown"): ReportValue =>
    id === null
      ? textValue(null, "system", absent === "n/a" ? NOT_APPLICABLE : undefined)
      : textValue(names.get(id) ?? null, "system");

  const agendaRows: ReportRow[] = agenda.map((a) => {
    sources.record("agenda", "agenda_item", a);
    const d = a.decision_id === null ? undefined : decisions.get(a.decision_id);
    return {
      recordType: "agenda_item",
      recordId: a.id,
      recordVersion: a.version,
      cells: [
        countValue(a.ordinal),
        codeValue(a.item_kind, "report.agenda_item_kind"),
        textValue(a.title),
        optionalText(a.description),
        person(a.presenter_user_id, "n/a"),
        countValue(a.duration_minutes, a.duration_minutes === null ? NOT_APPLICABLE : undefined),
        codeValue(a.late ? "yes" : "no", "report.yes_no"),
        codeValue(a.status, "report.agenda_item_status"),
        codeValue(a.outcome, "report.agenda_item_outcome", a.outcome === null ? NOT_APPLICABLE : undefined),
        decisionRef(d),
        codeValue(d?.status ?? null, "report.decision_status", d === undefined ? NOT_APPLICABLE : undefined),
      ],
    };
  });

  // An element the ask does not state is Unknown (missing): stateOf in assembler.ts.
  const askRows: ReportRow[] = agenda
    .filter((a) => a.item_kind === "executive_ask")
    .map((a) => {
      const e = elements.get(a.id)!;
      const d = a.decision_id === null ? undefined : decisions.get(a.decision_id);
      return {
        recordType: "agenda_item",
        recordId: a.id,
        recordVersion: a.version,
        cells: [
          countValue(a.ordinal),
          codeValue(d === undefined ? "brief" : "t16_decision", L("ask_source")),
          decisionRef(d),
          textValue(e.decisionRequired),
          textValue(e.whyNow),
          textValue(e.options.length === 0 ? null : e.options.join("\n")),
          textValue(e.recommendation),
          textValue(e.impactOfDelay),
          person(e.ownerUserId, "unknown"),
          dateValue(e.requiredDate),
          countValue(missingElementCount(e)),
          codeValue(d?.status ?? null, "report.decision_status", d === undefined ? NOT_APPLICABLE : undefined),
        ],
      };
    });

  const decisionRows: ReportRow[] = [...decisions.values()]
    .sort((x, y) => x.code.localeCompare(y.code) || x.id.localeCompare(y.id))
    .map((d) => {
      sources.record("decisions", "decision", d);
      const opts = options.get(d.id) ?? [];
      const chosen = opts.find((o) => o.id === d.chosen_option_id);
      return {
        recordType: "decision",
        recordId: d.id,
        recordVersion: d.version,
        cells: [
          textValue(d.code, "system"),
          textValue(d.title),
          codeValue(d.kind, "report.decision_kind"),
          codeValue(d.status, "report.decision_status"),
          person(d.owner_user_id, "unknown"),
          dateValue(dateOf(d.due_date), d.due_date === null ? NOT_APPLICABLE : undefined),
          chosen !== undefined ? textValue(`${chosen.label}. ${chosen.title}`) : optionalText(d.outcome_text),
          timestampValue(d.decided_at, d.decided_at === null ? NOT_APPLICABLE : undefined),
        ],
      };
    });

  const actionRows = withOwners(actions.rows, actions.owners, names);
  const scheduled = String(m.scheduled_date).slice(0, 10);
  return {
    subject: { code: scheduled, label: `${f.forum.name_en} ${scheduled}` },
    approvalState: "not_applicable",
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
        key: "agenda",
        titleKey: L("agenda"),
        kind: "table",
        sources: refsOf(agendaRows),
        columns: [
          meetingColumn("ordinal", "count"),
          meetingColumn("item_kind", "code"),
          meetingColumn("item_title", "text"),
          meetingColumn("item_description", "text"),
          meetingColumn("presenter", "text"),
          meetingColumn("duration_minutes", "count"),
          meetingColumn("late", "code"),
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
        key: "asks",
        titleKey: L("asks"),
        kind: "table",
        sources: refsOf(askRows),
        columns: [
          meetingColumn("ordinal", "count"),
          meetingColumn("ask_source", "code", L),
          meetingColumn("decision", "text"),
          meetingColumn("decision_required", "text", L),
          meetingColumn("why_now", "text", L),
          meetingColumn("options", "text", L),
          meetingColumn("recommendation", "text", L),
          meetingColumn("impact_of_delay", "text", L),
          meetingColumn("decision_owner", "text", L),
          meetingColumn("required_date", "date", L),
          meetingColumn("missing_elements", "count", L),
          meetingColumn("decision_status", "code"),
        ],
        rows: askRows,
        totals: [],
        emptyKey: L("no_asks"),
      },
      {
        key: "decisions",
        titleKey: L("decisions"),
        kind: "table",
        sources: refsOf(decisionRows),
        columns: [
          meetingColumn("decision_code", "text", L),
          meetingColumn("decision_title", "text", L),
          meetingColumn("decision_kind", "code", L),
          meetingColumn("decision_status", "code"),
          meetingColumn("decision_owner", "text", L),
          meetingColumn("due_date", "date", L),
          meetingColumn("decision_outcome", "text", L),
          meetingColumn("decided_at", "timestamp", L),
        ],
        rows: decisionRows,
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

export const meetingPackAssembler: Assembler = {
  code: "meeting_pack",
  parseParameters(raw) {
    const r = emptyReportParameters.safeParse(raw ?? {});
    if (!r.success) throw reportRefusals.parametersInvalid();
    return r.data;
  },
  assemble,
};
