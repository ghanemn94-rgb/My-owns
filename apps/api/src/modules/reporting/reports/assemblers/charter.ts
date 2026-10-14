// The `charter` assembler (ADR-0045 §1, §3, §5; B0034 Transformation Charter; REQ-S13-004; T-DG5-KBE-C).
//
// Reads through the DG2 charter service (`findCharter`, `charterView` of the transformations module): the charter
// fields, the CURRENT North Star, the 3-5 top outcomes and the active strategic guardrails, exactly as the charter
// screen shows them. Snapshot approval state = the charter's approval, which is the product gate G1 (Case for Change)
// decision state of the transformation (`gate_instance.status`; ADR-0045 §3); a recorded fact, never an approval.
// Evidence cited: the active evidence linked to the charter (DG2 `evidence_link`, record type `charter`).
// A charter not yet written shows every field as Unknown (missing), never blank or zero.
import { emptyReportParameters, type ReportField, type ReportSection } from "@mth/shared/schemas";
import { charterView, findCharter } from "../../../transformations/index.ts";
import {
  citedEvidence,
  codeValue,
  countValue,
  dateValue,
  gateApprovalState,
  textValue,
  userNames,
  type Assembler,
  type AssemblyContext,
  type AssembledOutput,
  type SourceRecord,
} from "../assembler.ts";
import { reportRefusals } from "../definitions.ts";

const SECTION = { charter: "charter", northStar: "north_star", outcomes: "top_outcomes", guardrails: "guardrails" };
const L = (k: string) => `report.charter.${k}`;

async function assemble(ctx: AssemblyContext): Promise<AssembledOutput> {
  const { db } = ctx;
  const tId = ctx.transformation.id;
  const g1 = await db
    .selectFrom("gate_instance")
    .select(["id", "status", "version", "updated_at"])
    .where("transformation_id", "=", tId)
    .where("gate_code", "=", "G1")
    .executeTakeFirst();
  const approvalState = gateApprovalState(g1?.status ?? null);
  const row = await findCharter(db, tId);
  const view = row === undefined ? null : await charterView(db, row);
  const c = view?.charter ?? null;
  const names = await userNames(db, [c?.executiveSponsorUserId ?? null, c?.transformationLeadUserId ?? null]);
  const userText = (id: string | null | undefined) =>
    id === null || id === undefined ? textValue(null) : textValue(names.get(id) ?? null, "system");
  const t = (v: string | null | undefined) => textValue(v ?? null);
  const fields: ReportField[] = [
    { key: "transformation_name", labelKey: L("transformation_name"), value: t(c?.transformationName) },
    { key: "executive_sponsor", labelKey: L("executive_sponsor"), value: userText(c?.executiveSponsorUserId) },
    { key: "transformation_lead", labelKey: L("transformation_lead"), value: userText(c?.transformationLeadUserId) },
    { key: "case_for_change", labelKey: L("case_for_change"), value: t(c?.caseForChange) },
    { key: "in_scope", labelKey: L("in_scope"), value: t(c?.inScope) },
    { key: "out_of_scope", labelKey: L("out_of_scope"), value: t(c?.outOfScope) },
    { key: "baseline_date", labelKey: L("baseline_date"), value: dateValue(c?.baselineDate ?? null) },
    {
      key: "target_horizon",
      labelKey: L("target_horizon"),
      value: countValue(c?.targetHorizonValue ?? null),
    },
    {
      key: "target_horizon_unit",
      labelKey: L("target_horizon_unit"),
      value: codeValue(c?.targetHorizonUnit ?? null, "report.horizon_unit"),
    },
    { key: "governance_forum", labelKey: L("governance_forum"), value: t(c?.governanceForum) },
    { key: "decision_rights", labelKey: L("decision_rights"), value: t(c?.decisionRights) },
    { key: "success_definition", labelKey: L("success_definition"), value: t(c?.successDefinition) },
    { key: "thesis_change", labelKey: L("thesis_change"), value: t(c?.thesisChange) },
    { key: "thesis_outcomes", labelKey: L("thesis_outcomes"), value: t(c?.thesisOutcomes) },
    { key: "thesis_benefits", labelKey: L("thesis_benefits"), value: t(c?.thesisBenefits) },
    { key: "thesis_because", labelKey: L("thesis_because"), value: t(c?.thesisBecause) },
    {
      key: "g1_state",
      labelKey: L("approval_state"),
      value: codeValue(approvalState, "report.approval_state", undefined),
    },
  ];
  const sources: SourceRecord[] = [];
  const charterRef = c === null ? [] : [{ recordType: "charter", recordId: c.id, recordVersion: c.version }];
  if (c !== null && row !== undefined)
    sources.push({
      sectionKey: SECTION.charter,
      recordType: "charter",
      recordId: c.id,
      recordVersion: c.version,
      recordUpdatedAt: row.updated_at,
      approvalState,
      validationState: "not_applicable",
    });
  const ns = view?.northStar ?? null;
  if (ns !== null)
    sources.push({
      sectionKey: SECTION.northStar,
      recordType: "north_star",
      recordId: ns.id,
      recordVersion: ns.version,
      recordUpdatedAt: ns.updatedAt,
      approvalState: null,
      validationState: "not_applicable",
    });
  const outcomes = view?.topOutcomes ?? [];
  const guardrails = view?.guardrails ?? [];
  for (const o of outcomes)
    sources.push({
      sectionKey: SECTION.outcomes,
      recordType: "outcome",
      recordId: o.id,
      recordVersion: o.version,
      recordUpdatedAt: o.updatedAt,
      approvalState: null,
      validationState: "not_applicable",
    });
  for (const g of guardrails)
    sources.push({
      sectionKey: SECTION.guardrails,
      recordType: "strategic_guardrail",
      recordId: g.id,
      recordVersion: g.version,
      recordUpdatedAt: g.updatedAt,
      approvalState: null,
      validationState: "not_applicable",
    });
  const sections: ReportSection[] = [
    { key: SECTION.charter, titleKey: L("title"), kind: "fields", sources: charterRef, fields },
    {
      key: SECTION.northStar,
      titleKey: L("north_star"),
      kind: "text",
      sources: ns === null ? [] : [{ recordType: "north_star", recordId: ns.id, recordVersion: ns.version }],
      text: textValue(ns?.statement ?? null),
    },
    {
      key: SECTION.outcomes,
      titleKey: L("top_outcomes"),
      kind: "table",
      sources: outcomes.map((o) => ({ recordType: "outcome", recordId: o.id, recordVersion: o.version })),
      columns: [
        { key: "rank", labelKey: L("rank"), valueKind: "count", unitKind: null },
        { key: "statement", labelKey: L("outcome"), valueKind: "text", unitKind: null },
        { key: "status", labelKey: L("status"), valueKind: "code", unitKind: null },
      ],
      rows: outcomes.map((o) => ({
        recordType: "outcome",
        recordId: o.id,
        recordVersion: o.version,
        cells: [countValue(o.topRank), textValue(o.statement), codeValue(o.status, "report.outcome_status")],
      })),
      totals: [],
      emptyKey: "report.empty.no_records",
    },
    {
      key: SECTION.guardrails,
      titleKey: L("guardrails"),
      kind: "table",
      sources: guardrails.map((g) => ({ recordType: "strategic_guardrail", recordId: g.id, recordVersion: g.version })),
      columns: [
        { key: "title", labelKey: L("guardrail"), valueKind: "text", unitKind: null },
        { key: "category", labelKey: L("category"), valueKind: "code", unitKind: null },
        { key: "statement", labelKey: L("statement"), valueKind: "text", unitKind: null },
      ],
      rows: guardrails.map((g) => ({
        recordType: "strategic_guardrail",
        recordId: g.id,
        recordVersion: g.version,
        cells: [textValue(g.title), codeValue(g.category, "report.guardrail_category"), textValue(g.statement)],
      })),
      totals: [],
      emptyKey: "report.empty.no_records",
    },
  ];
  const evidence = c === null ? [] : await citedEvidence(db, tId, "charter", [c.id], SECTION.charter);
  return {
    subject: { code: ctx.transformation.code, label: ctx.transformation.name },
    approvalState,
    sections,
    sources,
    versions: [],
    evidence,
  };
}

export const charterAssembler: Assembler = {
  code: "charter",
  parseParameters(raw) {
    const r = emptyReportParameters.safeParse(raw ?? {});
    if (!r.success) throw reportRefusals.parametersInvalid();
    return r.data;
  },
  assemble,
};
