// The `diagnostic` assembler (ADR-0045 §1, §3, §5; B0030 Current-State Diagnostic; REQ-S13-004, REQ-S13-008;
// T-DG5-KBE-C2).
//
// Four sections, each exactly the rows of the DG2 list route it names, in that route's order, without pagination:
//  - `items`: T01 diagnostic items (GET …/diagnostic-items; transformations register kit: not archived, by id), read
//    through the DG2 presenter `toDiagnosticItem`;
//  - `findings`: diagnostic findings (GET …/diagnostic-findings; the same kit rule), through `toDiagnosticFinding`;
//  - `baselines`: the baseline registry (GET …/baselines; kpi `listPage`: not archived, `updated_at` desc, id desc);
//  - `value_pools`: the value pools (GET …/value-pools; the same `listPage` rule).
// The kpi presenters of baselines and value pools are module-private, so the two queries restate the list route's
// predicates and order (the KBE-C registers precedent); diagnostic-report.test.ts compares each section with its route.
//
// Values (ADR-0045 §5): a baseline value is provisional unless its Finance validation is current (rule 3, through
// `baselineState`: validated on an earlier version of the row does not count); a value pool's amounts carry the same
// Finance validation of the same kind (ADR-0019 §3) and are labelled the same way; a missing amount or value is
// Unknown with no number, never 0 (rule 5). Every other cell is a record field (rule 6). A baseline's unit is free
// text, so the value column has the one unit kind `other` and the unit and currency are stated beside it; it is never
// summed. The value pools carry the screen's total (`totalValuePools`) as a system SUM total of the upside and downside
// columns when every pool is in one currency (D-163); an unquantified pool makes it Unknown; no other table is summed.
// Approval state: not_applicable (ADR-0045 §3). Evidence cited: the active DG2 evidence links of every row.
import {
  emptyReportParameters,
  totalValuePools,
  type ReportColumn,
  type ReportRow,
  type ReportSection,
  type ReportValue,
} from "@mth/shared/schemas";
import { toDiagnosticFinding, toDiagnosticItem } from "../../../transformations/index.ts";
import {
  citedEvidence,
  codeValue,
  dateValue,
  decimalValue,
  textValue,
  userNames,
  type Assembler,
  type AssemblyContext,
  type AssembledOutput,
  type EvidenceRef,
  type SourceRecord,
} from "../assembler.ts";
import { reportRefusals } from "../definitions.ts";
import { columnTotals } from "./table-totals.ts";
import { baselineState, NOT_APPLICABLE, type ValueState } from "../provisional.ts";

const S = { items: "items", findings: "findings", baselines: "baselines", valuePools: "value_pools" } as const;
const L = (k: string) => `report.diagnostic.${k}`;
const column = (
  key: string,
  valueKind: ReportColumn["valueKind"],
  unitKind: ReportColumn["unitKind"] = null,
): ReportColumn => ({ key, labelKey: L(key), valueKind, unitKind });

const source = (
  sectionKey: string,
  recordType: string,
  r: { id: string; version: number; updated_at: Date | string },
  validationState: SourceRecord["validationState"] = "not_applicable",
): SourceRecord => ({
  sectionKey,
  recordType,
  recordId: r.id,
  recordVersion: r.version,
  recordUpdatedAt: r.updated_at,
  approvalState: null,
  validationState,
});

/** The validation of a baseline or value pool row (ADR-0019 §3; rule 3): only a current `validated` counts. */
function financeState(r: {
  validation_status: string;
  validated_record_version: number | null;
  version: number;
}): ValueState {
  return baselineState({
    validationStatus: r.validation_status,
    validatedRecordVersion: r.validated_record_version,
    version: r.version,
  });
}

async function assemble(ctx: AssemblyContext): Promise<AssembledOutput> {
  const { db } = ctx;
  const tId = ctx.transformation.id;

  // GET …/diagnostic-items and …/diagnostic-findings (register kit): not archived, ordered by id.
  const items = await db
    .selectFrom("diagnostic_item")
    .selectAll()
    .where("transformation_id", "=", tId)
    .where("status", "<>", "archived")
    .orderBy("id")
    .execute();
  const findings = await db
    .selectFrom("diagnostic_finding")
    .selectAll()
    .where("transformation_id", "=", tId)
    .where("status", "<>", "archived")
    .orderBy("id")
    .execute();
  // GET …/baselines and …/value-pools (kpi listPage): not archived, updated_at desc, id desc.
  const baselines = await db
    .selectFrom("baseline")
    .selectAll()
    .where("transformation_id", "=", tId)
    .where("status", "<>", "archived")
    .orderBy("updated_at", "desc")
    .orderBy("id", "desc")
    .execute();
  const pools = await db
    .selectFrom("value_pool")
    .selectAll()
    .where("transformation_id", "=", tId)
    .where("status", "<>", "archived")
    .orderBy("updated_at", "desc")
    .orderBy("id", "desc")
    .execute();

  const names = await userNames(db, [
    ...items.map((r) => r.owner_user_id),
    ...findings.map((r) => r.owner_user_id),
    ...baselines.map((r) => r.owner_user_id),
    ...pools.map((r) => r.owner_user_id),
  ]);
  const owner = (id: string | null): ReportValue =>
    id === null ? textValue(null) : textValue(names.get(id) ?? null, "system");

  const sources: SourceRecord[] = [];
  const sections: ReportSection[] = [];

  // ---------------------------------------------------------------------------------------------- T01 items
  const itemViews = items.map(toDiagnosticItem);
  sections.push({
    key: S.items,
    titleKey: L("items"),
    kind: "table",
    sources: itemViews.map((i) => ({ recordType: "diagnostic_item", recordId: i.id, recordVersion: i.version })),
    columns: [
      column("dimension", "code"),
      column("current_state", "text"),
      column("evidence_baseline", "text"),
      column("root_cause", "text"),
      column("impact", "text"),
      column("impact_amount", "decimal", "currency"),
      column("confidence", "code"),
      column("owner", "text"),
      column("status", "code"),
    ],
    rows: itemViews.map((i) => ({
      recordType: "diagnostic_item",
      recordId: i.id,
      recordVersion: i.version,
      cells: [
        codeValue(i.dimensionCode, "report.diagnostic_dimension"),
        textValue(i.currentState),
        textValue(i.evidenceBaseline),
        textValue(i.rootCause),
        textValue(i.impactText),
        // Unknown impact stays Unknown (never 0; ADR-0019).
        decimalValue(i.impactAmount, { unitKind: "currency", currency: i.impactCurrency }),
        codeValue(i.confidence, "report.confidence"),
        owner(i.ownerUserId),
        codeValue(i.status, "report.diagnostic_item_status"),
      ],
    })),
    totals: [],
    emptyKey: "report.empty.no_records",
  });
  for (const r of items) sources.push(source(S.items, "diagnostic_item", r));

  // ---------------------------------------------------------------------------------------------- findings
  const findingViews = findings.map(toDiagnosticFinding);
  sections.push({
    key: S.findings,
    titleKey: L("findings"),
    kind: "table",
    sources: findingViews.map((f) => ({ recordType: "diagnostic_finding", recordId: f.id, recordVersion: f.version })),
    columns: [
      column("workstream", "code"),
      column("kind", "code"),
      column("statement", "text"),
      column("detail", "text"),
      column("confidence", "code"),
      column("owner", "text"),
      column("status", "code"),
    ],
    rows: findingViews.map((f) => ({
      recordType: "diagnostic_finding",
      recordId: f.id,
      recordVersion: f.version,
      cells: [
        codeValue(f.workstreamCode, "report.diagnostic_workstream"),
        codeValue(f.kind, "report.finding_kind"),
        textValue(f.statement),
        textValue(f.detail),
        codeValue(f.confidence, "report.confidence"),
        owner(f.ownerUserId),
        codeValue(f.status, "report.finding_status"),
      ],
    })),
    totals: [],
    emptyKey: "report.empty.no_records",
  });
  for (const r of findings) sources.push(source(S.findings, "diagnostic_finding", r));

  // ---------------------------------------------------------------------------------------------- baselines
  sections.push({
    key: S.baselines,
    titleKey: L("baselines"),
    kind: "table",
    sources: baselines.map((b) => ({ recordType: "baseline", recordId: b.id, recordVersion: b.version })),
    columns: [
      column("metric", "text"),
      column("value", "decimal", "other"),
      column("unit", "text"),
      column("currency", "text"),
      column("scope", "code"),
      column("source", "text"),
      column("baseline_date", "date"),
      column("validation", "code"),
      column("owner", "text"),
    ],
    rows: baselines.map((b) => {
      const state = financeState(b);
      return {
        recordType: "baseline",
        recordId: b.id,
        recordVersion: b.version,
        cells: [
          textValue(b.metric),
          decimalValue(b.value, { unitKind: "other", currency: b.currency, valueBasis: "baseline", state }),
          textValue(b.unit),
          // A baseline without a currency is not a money figure: n/a, not Unknown.
          textValue(
            b.currency === null ? null : b.currency.trim(),
            "user",
            b.currency === null ? NOT_APPLICABLE : undefined,
          ),
          codeValue(b.scope, "report.baseline_scope"),
          textValue(b.source),
          dateValue(b.baseline_date === null ? null : String(b.baseline_date)),
          codeValue(b.validation_status, "report.validation_status"),
          owner(b.owner_user_id),
        ],
      };
    }),
    totals: [],
    emptyKey: "report.empty.no_records",
  });
  for (const b of baselines) sources.push(source(S.baselines, "baseline", b, financeState(b).validation));

  // ---------------------------------------------------------------------------------------------- value pools
  const poolColumns: ReportColumn[] = [
    column("name", "text"),
    column("driver", "text"),
    column("workstream", "code"),
    column("quantification", "code"),
    column("upside_amount", "decimal", "currency"),
    column("downside_amount", "decimal", "currency"),
    column("unquantified_reason", "text"),
    column("materiality", "code"),
    column("confidence", "code"),
    column("validation", "code"),
    column("owner", "text"),
  ];
  const poolRows: ReportRow[] = pools.map((v) => {
    const state = financeState(v);
    const unquantified = v.quantification_status === "unquantified";
    return {
      recordType: "value_pool",
      recordId: v.id,
      recordVersion: v.version,
      cells: [
        textValue(v.name),
        textValue(v.driver),
        codeValue(v.workstream_code, "report.diagnostic_workstream"),
        codeValue(v.quantification_status, "report.quantification_status"),
        // An unquantified pool has no amount: Unknown (missing), never 0.
        decimalValue(v.upside_amount, { unitKind: "currency", currency: v.currency, state }),
        decimalValue(v.downside_amount, { unitKind: "currency", currency: v.currency, state }),
        // The reason applies only to an unquantified pool.
        textValue(v.unquantified_reason, "user", unquantified ? undefined : NOT_APPLICABLE),
        codeValue(v.materiality, "report.materiality"),
        codeValue(v.confidence, "report.confidence"),
        codeValue(v.validation_status, "report.validation_status"),
        owner(v.owner_user_id),
      ],
    };
  });
  // The screen's total (DiagnosePage ValuePoolTotals: `totalValuePools`, per currency, upside and downside). One
  // currency: a system SUM total of that figure; an unquantified pool makes it Unknown (the screen's "partial" total
  // is never shown as complete here); several currencies: no total (never converted).
  const poolTotals = totalValuePools(
    pools.map((v) => ({
      quantificationStatus: v.quantification_status,
      upsideAmount: v.upside_amount,
      downsideAmount: v.downside_amount,
      currency: v.currency.trim(),
      status: v.status,
    })),
  );
  const poolTotal = poolTotals.length === 1 ? poolTotals[0]!.quantifiedTotal : null;
  sections.push({
    key: S.valuePools,
    titleKey: L("value_pools"),
    kind: "table",
    sources: pools.map((v) => ({ recordType: "value_pool", recordId: v.id, recordVersion: v.version })),
    columns: poolColumns,
    rows: poolRows,
    totals: columnTotals({ columns: poolColumns, rows: poolRows }, ["upside_amount", "downside_amount"], {
      upside_amount: poolTotal?.upside,
      downside_amount: poolTotal?.downside,
    }),
    emptyKey: "report.empty.no_records",
  });
  for (const v of pools) sources.push(source(S.valuePools, "value_pool", v, financeState(v).validation));

  const evidence: EvidenceRef[] = [
    ...(await citedEvidence(
      db,
      tId,
      "diagnostic_item",
      items.map((r) => r.id),
      S.items,
    )),
    ...(await citedEvidence(
      db,
      tId,
      "diagnostic_finding",
      findings.map((r) => r.id),
      S.findings,
    )),
    ...(await citedEvidence(
      db,
      tId,
      "baseline",
      baselines.map((r) => r.id),
      S.baselines,
    )),
    ...(await citedEvidence(
      db,
      tId,
      "value_pool",
      pools.map((r) => r.id),
      S.valuePools,
    )),
  ];
  return {
    subject: { code: ctx.transformation.code, label: ctx.transformation.name },
    approvalState: "not_applicable",
    sections,
    sources,
    versions: [],
    evidence,
  };
}

export const diagnosticAssembler: Assembler = {
  code: "diagnostic",
  parseParameters(raw) {
    const r = emptyReportParameters.safeParse(raw ?? {});
    if (!r.success) throw reportRefusals.parametersInvalid();
    return r.data;
  },
  assemble,
};
