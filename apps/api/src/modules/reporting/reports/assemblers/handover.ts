// The `handover` assembler (ADR-0045 §1, §3, §5; B0100 Sustain; M0217 BAU handover content; REQ-S13-004; p5-work-split
// §F.4; T-DG5-KBE-D2).
//
// Subject: one BAU handover (`bau_handover`) of the transformation. It reads, read only, exactly what GET
// …/bau-handovers/{h} shows (sustainment/handovers.ts `presentHandover`): the handover row, the ACTIVE controls of its
// performance area (id order), the linked evidence (`bau_handover_evidence`, created_at, id), the area's OPEN
// improvement items (status open or in_progress, id order) and the M0217 items a submission still needs (the same rule
// as handovers.ts `missingItemsOf`, ADR-0034 §5 order of BAU_HANDOVER_ITEMS). `reporting` may import sustainment only
// through its index.ts, which exposes no handover read, so the same tables are read with the same filters and order.
// Sections: `handover` (the M0217 content as authored, the area, the people and the status stamps), `items` (each
// M0217 item present or missing), `controls`, `evidence` (cited with each item's current content revision and SHA-256)
// and `improvement_items`.
// Snapshot approval state (ADR-0045 §3): approved when accepted, pending when submitted, changes_requested when
// returned, not_submitted in draft. Acceptance is the receiving owner's business approval INSIDE the product, recorded
// here as a fact; this report approves nothing and is unrelated to the engineering gates DG0-DG7 (product gate G6 never
// implies DG7). Labels: rule 6, not_applicable; a content item not written yet is Unknown (missing), never a
// placeholder, and is listed as missing in `items`.
import type { BauHandoverRow } from "@mth/db";
import {
  BAU_HANDOVER_ITEMS,
  emptyReportParameters,
  type BauHandoverItem,
  type ReportField,
  type ReportRow,
  type ReportSourceApprovalState,
} from "@mth/shared/schemas";
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
  type EvidenceRef,
} from "../assembler.ts";
import { reportRefusals } from "../definitions.ts";
import { NOT_APPLICABLE } from "../provisional.ts";
import { meetingColumn, optionalText, refsOf, SourceSet } from "./meeting-minutes.ts";

const L = (k: string) => `report.handover.${k}`;
const col = (key: string, kind: Parameters<typeof meetingColumn>[1]) => meetingColumn(key, kind, L);

/** ADR-0045 §3: the handover's snapshot approval state from `bau_handover.status`. */
export function handoverApprovalState(status: string): ReportSourceApprovalState {
  switch (status) {
    case "accepted":
      return "approved";
    case "submitted":
      return "pending";
    case "returned":
      return "changes_requested";
    default:
      return "not_submitted";
  }
}

/** Pure: which M0217 items are present (handovers.ts `missingItemsOf`, in BAU_HANDOVER_ITEMS order). */
export function handoverItems(
  h: Pick<
    BauHandoverRow,
    | "kpi_owner_user_id"
    | "operating_procedures"
    | "capability_readiness"
    | "unresolved_accepted_risks"
    | "benefit_monitoring_cadence"
    | "data_access"
    | "improvement_backlog_summary"
  >,
  facts: { readonly controls: number; readonly evidence: number },
): { item: BauHandoverItem; present: boolean }[] {
  const present = new Map<BauHandoverItem, boolean>([
    ["kpi_owner", h.kpi_owner_user_id !== null],
    ["operating_procedures", h.operating_procedures !== null],
    ["controls", facts.controls > 0],
    ["evidence", facts.evidence > 0],
    ["capability_readiness", h.capability_readiness !== null],
    ["unresolved_accepted_risks", h.unresolved_accepted_risks !== null],
    ["benefit_monitoring_cadence", h.benefit_monitoring_cadence !== null],
    ["data_access", h.data_access !== null],
    ["improvement_backlog", h.improvement_backlog_summary !== null],
  ]);
  return BAU_HANDOVER_ITEMS.map((i) => ({ item: i.item, present: present.get(i.item) === true }));
}

async function assemble(ctx: AssemblyContext): Promise<AssembledOutput> {
  const { db } = ctx;
  const tId = ctx.transformation.id;
  const h = await db
    .selectFrom("bau_handover")
    .selectAll()
    .where("id", "=", ctx.subject.id)
    .where("transformation_id", "=", tId)
    .executeTakeFirst();
  if (h === undefined) throw reportRefusals.subjectInvalid();
  const area = await db
    .selectFrom("performance_area")
    .select(["id", "code", "name", "status", "version", "updated_at"])
    .where("id", "=", h.performance_area_id)
    .executeTakeFirstOrThrow();
  const [controls, links, improvements] = await Promise.all([
    db
      .selectFrom("control")
      .select([
        "id",
        "code",
        "name",
        "owner_user_id",
        "frequency",
        "next_check_date",
        "status",
        "version",
        "updated_at",
      ])
      .where("performance_area_id", "=", area.id)
      .where("status", "=", "active")
      .orderBy("id")
      .execute(),
    db
      .selectFrom("bau_handover_evidence")
      .select(["evidence_id"])
      .where("handover_id", "=", h.id)
      .orderBy("created_at")
      .orderBy("id")
      .execute(),
    db
      .selectFrom("improvement_item")
      .select(["id", "code", "title", "owner_user_id", "priority", "target_date", "status", "version", "updated_at"])
      .where("performance_area_id", "=", area.id)
      .where("status", "in", ["open", "in_progress"])
      .orderBy("id")
      .execute(),
  ]);
  const evidenceIds = links.map((l) => l.evidence_id);
  const items =
    evidenceIds.length === 0
      ? []
      : await db
          .selectFrom("evidence as e")
          .leftJoin("evidence_content as c", "c.id", "e.current_content_id")
          .select([
            "e.id",
            "e.title",
            "e.kind",
            "e.review_status",
            "e.version",
            "e.updated_at",
            "c.id as contentId",
            "c.revision",
            "c.sha256",
          ])
          .where("e.id", "in", evidenceIds)
          .execute();
  const byId = new Map(items.map((e) => [e.id, e] as const));

  const names = await userNames(db, [
    h.receiving_owner_user_id,
    h.kpi_owner_user_id,
    h.submitted_by,
    h.accepted_by,
    h.returned_by,
    ...controls.map((c) => c.owner_user_id),
    ...improvements.map((i) => i.owner_user_id),
  ]);
  const name = (id: string | null) => textValue(id === null ? null : (names.get(id) ?? null), "system");
  const optName = (id: string | null) => (id === null ? textValue(null, "system", NOT_APPLICABLE) : name(id));
  const stamp = (at: Date | string | null) => timestampValue(at, at === null ? NOT_APPLICABLE : undefined);
  const approval = handoverApprovalState(h.status);

  const sources = new SourceSet();
  sources.record("handover", "bau_handover", h, approval);
  sources.record("handover", "performance_area", area);

  // A content item not written yet is Unknown (missing) and listed as missing below; KPI owner likewise.
  const fields: ReportField[] = [
    { key: "code", labelKey: L("code"), value: textValue(h.code, "system") },
    {
      key: "performance_area",
      labelKey: L("performance_area"),
      value: textValue(`${area.code} ${area.name}`, "system"),
    },
    { key: "cycle_no", labelKey: L("cycle_no"), value: countValue(h.cycle_no) },
    { key: "status", labelKey: L("status"), value: codeValue(h.status, "report.bau_handover_status") },
    { key: "receiving_owner", labelKey: L("receiving_owner"), value: name(h.receiving_owner_user_id) },
    { key: "kpi_owner", labelKey: L("kpi_owner"), value: name(h.kpi_owner_user_id) },
    { key: "operating_procedures", labelKey: L("operating_procedures"), value: textValue(h.operating_procedures) },
    { key: "capability_readiness", labelKey: L("capability_readiness"), value: textValue(h.capability_readiness) },
    {
      key: "unresolved_accepted_risks",
      labelKey: L("unresolved_accepted_risks"),
      value: textValue(h.unresolved_accepted_risks),
    },
    {
      key: "benefit_monitoring_cadence",
      labelKey: L("benefit_monitoring_cadence"),
      value: codeValue(h.benefit_monitoring_cadence, "report.sustain_frequency"),
    },
    { key: "data_access", labelKey: L("data_access"), value: textValue(h.data_access) },
    {
      key: "improvement_backlog_summary",
      labelKey: L("improvement_backlog_summary"),
      value: textValue(h.improvement_backlog_summary),
    },
    { key: "submitted_at", labelKey: L("submitted_at"), value: stamp(h.submitted_at) },
    { key: "submitted_by", labelKey: L("submitted_by"), value: optName(h.submitted_by) },
    { key: "accepted_at", labelKey: L("accepted_at"), value: stamp(h.accepted_at) },
    { key: "accepted_by", labelKey: L("accepted_by"), value: optName(h.accepted_by) },
    { key: "acceptance_note", labelKey: L("acceptance_note"), value: optionalText(h.acceptance_note) },
    { key: "returned_at", labelKey: L("returned_at"), value: stamp(h.returned_at) },
    { key: "returned_by", labelKey: L("returned_by"), value: optName(h.returned_by) },
    { key: "return_reason", labelKey: L("return_reason"), value: optionalText(h.return_reason) },
  ];

  const itemRows = handoverItems(h, { controls: controls.length, evidence: evidenceIds.length });
  const itemFields: ReportField[] = itemRows.map((i) => ({
    key: i.item,
    labelKey: `report.bau_handover_item.${i.item}`,
    value: codeValue(i.present ? "present" : "missing", L("item_state")),
  }));

  const controlRows: ReportRow[] = controls.map((c) => {
    sources.record("controls", "control", c);
    return {
      recordType: "control",
      recordId: c.id,
      recordVersion: c.version,
      cells: [
        textValue(c.code, "system"),
        textValue(c.name),
        optName(c.owner_user_id),
        codeValue(c.frequency, "report.sustain_frequency"),
        dateValue(
          c.next_check_date === null ? null : String(c.next_check_date).slice(0, 10),
          c.next_check_date === null ? NOT_APPLICABLE : undefined,
        ),
        codeValue(c.status, "report.control_status"),
      ],
    };
  });

  const evidenceRows: ReportRow[] = [];
  const evidence: EvidenceRef[] = [];
  for (const id of evidenceIds) {
    const e = byId.get(id);
    if (e === undefined) continue;
    sources.record("evidence", "evidence", e);
    evidenceRows.push({
      recordType: "evidence",
      recordId: e.id,
      recordVersion: e.version,
      cells: [
        textValue(e.title),
        codeValue(e.kind, "report.evidence_kind"),
        codeValue(e.review_status, "report.evidence_review_status"),
        countValue(e.revision ?? null, e.contentId === null ? NOT_APPLICABLE : undefined),
        textValue(
          e.sha256 === null ? null : e.sha256.trim(),
          "system",
          e.contentId === null ? NOT_APPLICABLE : undefined,
        ),
      ],
    });
    evidence.push({
      sectionKey: "evidence",
      evidenceId: e.id,
      contentId: e.contentId,
      contentRevision: e.revision,
      contentSha256: e.sha256 === null ? null : e.sha256.trim(),
      reviewStatus: e.review_status as EvidenceRef["reviewStatus"],
    });
  }

  const improvementRows: ReportRow[] = improvements.map((i) => {
    sources.record("improvement_items", "improvement_item", i);
    return {
      recordType: "improvement_item",
      recordId: i.id,
      recordVersion: i.version,
      cells: [
        textValue(i.code, "system"),
        textValue(i.title),
        optName(i.owner_user_id),
        codeValue(i.priority, "report.improvement_priority", i.priority === null ? NOT_APPLICABLE : undefined),
        dateValue(
          i.target_date === null ? null : String(i.target_date).slice(0, 10),
          i.target_date === null ? NOT_APPLICABLE : undefined,
        ),
        codeValue(i.status, "report.improvement_status"),
      ],
    };
  });

  return {
    subject: { code: h.code, label: `${h.code} ${area.name}` },
    approvalState: approval,
    sections: [
      {
        key: "handover",
        titleKey: L("title"),
        kind: "fields",
        sources: [
          { recordType: "bau_handover", recordId: h.id, recordVersion: h.version },
          { recordType: "performance_area", recordId: area.id, recordVersion: area.version },
        ],
        fields,
      },
      {
        key: "items",
        titleKey: L("items"),
        kind: "fields",
        sources: [{ recordType: "bau_handover", recordId: h.id, recordVersion: h.version }],
        fields: itemFields,
      },
      {
        key: "controls",
        titleKey: L("controls"),
        kind: "table",
        sources: refsOf(controlRows),
        columns: [
          col("control_code", "text"),
          col("control_name", "text"),
          col("control_owner", "text"),
          col("control_frequency", "code"),
          col("next_check_date", "date"),
          col("control_status", "code"),
        ],
        rows: controlRows,
        totals: [],
        emptyKey: "report.empty.no_records",
      },
      {
        key: "evidence",
        titleKey: L("evidence"),
        kind: "table",
        sources: refsOf(evidenceRows),
        columns: [
          col("evidence_title", "text"),
          col("evidence_kind", "code"),
          col("review_status", "code"),
          col("content_revision", "count"),
          col("content_sha256", "text"),
        ],
        rows: evidenceRows,
        totals: [],
        emptyKey: "report.empty.no_records",
      },
      {
        key: "improvement_items",
        titleKey: L("improvement_items"),
        kind: "table",
        sources: refsOf(improvementRows),
        columns: [
          col("improvement_code", "text"),
          col("improvement_title", "text"),
          col("improvement_owner", "text"),
          col("improvement_priority", "code"),
          col("target_date", "date"),
          col("improvement_status", "code"),
        ],
        rows: improvementRows,
        totals: [],
        emptyKey: "report.empty.no_records",
      },
    ],
    sources: sources.rows,
    versions: [],
    evidence,
  };
}

export const handoverAssembler: Assembler = {
  code: "handover",
  parseParameters(raw) {
    const r = emptyReportParameters.safeParse(raw ?? {});
    if (!r.success) throw reportRefusals.parametersInvalid();
    return r.data;
  },
  assemble,
};
