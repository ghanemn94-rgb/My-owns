// The `tom` assembler (ADR-0045 §1, §3, §5; B0055 Target Operating Model, B0057 TOM canvas and design; REQ-S13-004;
// T-DG5-KBE-C2).
//
// Reads what the TOM screens show, without pagination:
//  - `canvas`: the ten TOM canvas boxes (GET …/tom-canvas, workflows/canvas.ts `canvasViews`): one `tom_canvas_cell` per
//    TOM dimension, in the dimension's source order, with its current and target design, owner and status;
//  - `gaps`: the T03 gap rows of those dimensions (the canvas's `gaps`: not archived, by id);
//  - `design_decisions`: the T04 design decisions of those dimensions (the canvas's `decisions`: kind design, by id);
//  - `dependencies`: the dependencies of those dimensions (the canvas's `dependencies`: not archived, by id);
//  - `capabilities`: the capability heatmap (GET …/capability-heatmap; register kit: not archived, by id), through the
//    DG2 presenter `toCapability`.
// `reporting` may not import `workflows` (modules.ts), so the canvas queries are restated here with the same tables,
// predicates and order as `canvasViews`; tom-report.test.ts compares every section with the canvas and heatmap routes.
//
// Values: every cell is a record field (ADR-0045 §5 rule 6); a field the record lacks is Unknown (rule 5). No number is
// computed. Approval state: not_applicable (ADR-0045 §3). Evidence cited: the active DG2 evidence links of the canvas
// boxes (as the canvas shows them) and of the gaps and capabilities.
import { emptyReportParameters, type ReportColumn, type ReportSection, type ReportValue } from "@mth/shared/schemas";
import { toCapability, toTomGap } from "../../../transformations/index.ts";
import {
  citedEvidence,
  codeValue,
  countValue,
  dateValue,
  textValue,
  userNames,
  type Assembler,
  type AssemblyContext,
  type AssembledOutput,
  type EvidenceRef,
  type SourceRecord,
} from "../assembler.ts";
import { reportRefusals } from "../definitions.ts";

const S = {
  canvas: "canvas",
  gaps: "gaps",
  decisions: "design_decisions",
  dependencies: "dependencies",
  capabilities: "capabilities",
} as const;
const L = (k: string) => `report.tom.${k}`;
const column = (key: string, valueKind: ReportColumn["valueKind"]): ReportColumn => ({
  key,
  labelKey: L(key),
  valueKind,
  unitKind: null,
});
const source = (
  sectionKey: string,
  recordType: string,
  r: { id: string; version: number; updated_at: Date | string },
): SourceRecord => ({
  sectionKey,
  recordType,
  recordId: r.id,
  recordVersion: r.version,
  recordUpdatedAt: r.updated_at,
  approvalState: null,
  validationState: "not_applicable",
});

async function assemble(ctx: AssemblyContext): Promise<AssembledOutput> {
  const { db } = ctx;
  const tId = ctx.transformation.id;

  // canvasViews: the cells in TOM dimension order; then the records of the same dimensions.
  const cells = await db
    .selectFrom("tom_canvas_cell as c")
    .innerJoin("tom_dimension as d", "d.code", "c.dimension_code")
    .selectAll("c")
    .where("c.transformation_id", "=", tId)
    .orderBy("d.ordinal")
    .execute();
  const codes = cells.map((c) => c.dimension_code);
  const gaps =
    codes.length === 0
      ? []
      : await db
          .selectFrom("tom_gap")
          .selectAll()
          .where("transformation_id", "=", tId)
          .where("dimension_code", "in", codes)
          .where("status", "<>", "archived")
          .orderBy("id")
          .execute();
  const decisions =
    codes.length === 0
      ? []
      : await db
          .selectFrom("decision")
          .selectAll()
          .where("transformation_id", "=", tId)
          .where("kind", "=", "design")
          .where("tom_dimension_code", "in", codes)
          .orderBy("id")
          .execute();
  const dependencies =
    codes.length === 0
      ? []
      : await db
          .selectFrom("dependency")
          .selectAll()
          .where("transformation_id", "=", tId)
          .where("tom_dimension_code", "in", codes)
          .where("status", "<>", "archived")
          .orderBy("id")
          .execute();
  // GET …/capability-heatmap (register kit): not archived, by id.
  const capabilities = await db
    .selectFrom("capability")
    .selectAll()
    .where("transformation_id", "=", tId)
    .where("status", "<>", "archived")
    .orderBy("id")
    .execute();

  const names = await userNames(db, [
    ...cells.map((r) => r.owner_user_id),
    ...gaps.map((r) => r.owner_user_id),
    ...decisions.map((r) => r.owner_user_id),
    ...dependencies.map((r) => r.owner_user_id),
    ...capabilities.map((r) => r.owner_user_id),
  ]);
  const owner = (id: string | null): ReportValue =>
    id === null ? textValue(null) : textValue(names.get(id) ?? null, "system");

  const sources: SourceRecord[] = [];
  const ref = (recordType: string) => (r: { id: string; version: number }) => ({
    recordType,
    recordId: r.id,
    recordVersion: r.version,
  });
  const sections: ReportSection[] = [];

  sections.push({
    key: S.canvas,
    titleKey: L("canvas"),
    kind: "table",
    sources: cells.map(ref("tom_canvas_cell")),
    columns: [
      column("dimension", "code"),
      column("current_design", "text"),
      column("target_design", "text"),
      column("owner", "text"),
      column("status", "code"),
    ],
    rows: cells.map((c) => ({
      ...ref("tom_canvas_cell")(c),
      cells: [
        codeValue(c.dimension_code, "report.tom_dimension"),
        textValue(c.current_design),
        textValue(c.target_design),
        owner(c.owner_user_id),
        codeValue(c.status, "report.tom_cell_status"),
      ],
    })),
    totals: [],
    emptyKey: "report.empty.no_records",
  });
  for (const c of cells) sources.push(source(S.canvas, "tom_canvas_cell", c));

  const gapViews = gaps.map(toTomGap);
  sections.push({
    key: S.gaps,
    titleKey: L("gaps"),
    kind: "table",
    sources: gapViews.map(ref("tom_gap")),
    columns: [
      column("dimension", "code"),
      column("current_state", "text"),
      column("target_state", "text"),
      column("gap", "text"),
      column("owner", "text"),
      column("status", "code"),
    ],
    rows: gapViews.map((g) => ({
      ...ref("tom_gap")(g),
      cells: [
        codeValue(g.dimensionCode, "report.tom_dimension"),
        textValue(g.currentState),
        textValue(g.targetState),
        textValue(g.gap),
        owner(g.ownerUserId),
        codeValue(g.status, "report.tom_gap_status"),
      ],
    })),
    totals: [],
    emptyKey: "report.empty.no_records",
  });
  for (const g of gaps) sources.push(source(S.gaps, "tom_gap", g));

  sections.push({
    key: S.decisions,
    titleKey: L("design_decisions"),
    kind: "table",
    sources: decisions.map(ref("decision")),
    columns: [
      column("code", "text"),
      column("dimension", "code"),
      column("title", "text"),
      column("owner", "text"),
      column("due_date", "date"),
      column("outcome", "text"),
      column("status", "code"),
    ],
    rows: decisions.map((d) => ({
      ...ref("decision")(d),
      cells: [
        textValue(d.code, "system"),
        codeValue(d.tom_dimension_code, "report.tom_dimension"),
        textValue(d.title),
        owner(d.owner_user_id),
        dateValue(d.due_date === null ? null : String(d.due_date)),
        textValue(d.outcome_text),
        codeValue(d.status, "report.decision_status"),
      ],
    })),
    totals: [],
    emptyKey: "report.empty.no_records",
  });
  for (const d of decisions) sources.push(source(S.decisions, "decision", d));

  sections.push({
    key: S.dependencies,
    titleKey: L("dependencies"),
    kind: "table",
    sources: dependencies.map(ref("dependency")),
    columns: [
      column("code", "text"),
      column("dimension", "code"),
      column("description", "text"),
      column("from", "text"),
      column("to", "text"),
      column("needed_by", "date"),
      column("owner", "text"),
      column("status", "code"),
    ],
    rows: dependencies.map((d) => ({
      ...ref("dependency")(d),
      cells: [
        textValue(d.code, "system"),
        codeValue(d.tom_dimension_code, "report.tom_dimension"),
        textValue(d.description),
        textValue(d.from_label),
        textValue(d.to_label),
        dateValue(d.needed_by === null ? null : String(d.needed_by)),
        owner(d.owner_user_id),
        codeValue(d.status, "report.dependency_status"),
      ],
    })),
    totals: [],
    emptyKey: "report.empty.no_records",
  });
  for (const d of dependencies) sources.push(source(S.dependencies, "dependency", d));

  const capabilityViews = capabilities.map(toCapability);
  sections.push({
    key: S.capabilities,
    titleKey: L("capabilities"),
    kind: "table",
    sources: capabilityViews.map(ref("capability")),
    columns: [
      column("name", "text"),
      column("dimension", "code"),
      column("current_level", "count"),
      column("target_level", "count"),
      column("sourcing_need", "code"),
      column("owner", "text"),
      column("status", "code"),
    ],
    rows: capabilityViews.map((c) => ({
      ...ref("capability")(c),
      cells: [
        textValue(c.name),
        codeValue(c.dimensionCode, "report.tom_dimension"),
        // An unassessed level is Unknown, never 0.
        countValue(c.currentLevel),
        countValue(c.targetLevel),
        codeValue(c.sourcingNeed, "report.sourcing_need"),
        owner(c.ownerUserId),
        codeValue(c.status, "report.capability_status"),
      ],
    })),
    totals: [],
    emptyKey: "report.empty.no_records",
  });
  for (const c of capabilities) sources.push(source(S.capabilities, "capability", c));

  const evidence: EvidenceRef[] = [
    ...(await citedEvidence(
      db,
      tId,
      "tom_canvas_cell",
      cells.map((r) => r.id),
      S.canvas,
    )),
    ...(await citedEvidence(
      db,
      tId,
      "tom_gap",
      gaps.map((r) => r.id),
      S.gaps,
    )),
    ...(await citedEvidence(
      db,
      tId,
      "decision",
      decisions.map((r) => r.id),
      S.decisions,
    )),
    ...(await citedEvidence(
      db,
      tId,
      "dependency",
      dependencies.map((r) => r.id),
      S.dependencies,
    )),
    ...(await citedEvidence(
      db,
      tId,
      "capability",
      capabilities.map((r) => r.id),
      S.capabilities,
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

export const tomAssembler: Assembler = {
  code: "tom",
  parseParameters(raw) {
    const r = emptyReportParameters.safeParse(raw ?? {});
    if (!r.success) throw reportRefusals.parametersInvalid();
    return r.data;
  },
  assemble,
};
