// Change impact: the preview of an unsaved or saved change request and the frozen impact assessments (P4 slice H;
// ADR-0036 §5, §9; T-DG4-BE-L; REQ-S04-014, REQ-S07-015):
//   POST /transformations/{t}/change-requests/impact-preview            preview of an unsaved change (writes nothing)
//   GET  /transformations/{t}/change-requests/{id}/impact-preview       live preview of the request's current content
//   GET  /transformations/{t}/change-requests/{id}/impact-assessments   the frozen assessments, one per submitted version
//   GET  /transformations/{t}/impact-assessments/{impactAssessmentId}   one frozen assessment with its items and SHA-256
//
// Every route reads with transformation.read (AUD included; 404 outside scope). The item derivation is the exported pure
// `deriveImpactItems` over facts loaded by `loadImpactFacts` (read-only queries; BE-M may reuse both, p4-work-split
// §H.6). "Reports" are the fixed T10 read-model areas (B0095): no report entity exists before DG5/DG6, so no issued
// report is changed (M0163). A gate item names the affected submission and, when approved, the PRESERVED decision: an
// assessment never edits gate rows (ADR-0036 §2), and nothing here touches DG0-DG7.
import { createHash } from "node:crypto";
import {
  sql,
  type ChangeRequestRow,
  type DbOrTx,
  type ImpactAssessmentItemRow,
  type ImpactAssessmentRow,
} from "@mth/db";
import {
  changeRequestCreate,
  type ChangeKind,
  type ChangeSubjectType,
  type ImpactAssessment,
  type ImpactItem,
  type ImpactPreview,
  type Materiality,
} from "@mth/shared/schemas";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { principalOf, requireTransformationRead } from "../access/index.ts";
import {
  canonicalJson,
  cursorSchema,
  decodeCursor,
  filterHash,
  iso,
  limitSchema,
  paginate,
  parse,
  parseBody,
  parseQuery,
  problems,
  type ModuleDeps,
} from "../platform/index.ts";

const JSON_BODY = ["application/json"] as const;
const BASE = "/api/v1/transformations/:transformationId";
export const CHANGE_REQUESTS_PATH = `${BASE}/change-requests`;
const PREVIEW = `${CHANGE_REQUESTS_PATH}/impact-preview`;
const CR_PREVIEW = `${CHANGE_REQUESTS_PATH}/:changeRequestId/impact-preview`;
const CR_ASSESSMENTS = `${CHANGE_REQUESTS_PATH}/:changeRequestId/impact-assessments`;
const ASSESSMENT = `${BASE}/impact-assessments/:impactAssessmentId`;

// ------------------------------------------------------------------------------------------------ facts

export interface RecordRef {
  readonly id: string;
  readonly code: string | null;
  readonly label: string;
}

export interface GateFact {
  readonly gateCode: string;
  readonly status: string;
  /** The submission whose snapshot is affected: the approved one, or the pending one. */
  readonly submissionId: string;
  readonly submissionNo: number;
  /** The preserved approval decision, when the gate is approved. */
  readonly decisionId: string | null;
}

/** Everything the derivation reads, loaded by `loadImpactFacts` (read-only). */
export interface ImpactFacts {
  readonly changeKind: ChangeKind;
  readonly subjectType: ChangeSubjectType;
  readonly subject: RecordRef;
  readonly outcomes: readonly RecordRef[];
  /** KPIs whose formula has the changed KPI as an input (ADR-0027 §4). */
  readonly dependentKpis: readonly RecordRef[];
  readonly benefits: readonly RecordRef[];
  /** Benefit formulas bound to the affected benefits, or using the changed formula. */
  readonly benefitFormulas: readonly (RecordRef & { readonly currentVersionNo: number | null })[];
  readonly initiatives: readonly RecordRef[];
  readonly dependentInitiatives: readonly RecordRef[];
  readonly businessCaseLines: readonly RecordRef[];
  readonly tomGaps: readonly RecordRef[];
  readonly decisions: readonly RecordRef[];
  readonly gates: readonly GateFact[];
}

type Draft = Omit<ImpactItem, "ordinal">;

const item = (
  itemType: ImpactItem["itemType"],
  recordType: string | null,
  ref: RecordRef | null,
  label: string,
  effect: ImpactItem["effect"],
  detail: Record<string, unknown> = {},
): Draft => ({
  itemType,
  recordType,
  recordId: ref?.id ?? null,
  recordCode: ref?.code ?? null,
  label: label.slice(0, 300) || itemType,
  effect,
  gateSubmissionId: null,
  gateDecisionId: null,
  detail,
});

const report = (area: string, label: string): Draft => item("report", null, null, label, "informational", { area });

/** The gates each subject affects (ADR-0036 §5); G1 only for a baseline change of a KPI. */
function gatesFor(kind: ChangeKind, subjectType: ChangeSubjectType): readonly string[] {
  switch (subjectType) {
    case "kpi_definition":
    case "outcome_kpi":
      return kind === "baseline" ? ["G1", "G2", "G5"] : ["G2", "G5"];
    case "tom_canvas_cell":
      return ["G3"];
    case "charter":
      return ["G1", "G4"];
    case "initiative":
      return kind === "business_scope" ? ["G1", "G4"] : ["G4"];
    default:
      return ["G4"];
  }
}

/**
 * The impact items of a change (ADR-0036 §5), in a stable order: the subject's own related records, then gates, then
 * reports. A pure function of the facts: the same facts always give the same items (and so the same SHA-256).
 */
export function deriveImpactItems(f: ImpactFacts): ImpactItem[] {
  const out: Draft[] = [];
  const kpiSubject = f.subjectType === "kpi_definition" || f.subjectType === "outcome_kpi";
  if (kpiSubject) {
    for (const o of f.outcomes) out.push(item("outcome", "outcome", o, o.label, "value_changes"));
    for (const k of f.dependentKpis) out.push(item("kpi", "kpi_definition", k, k.label, "recalculation"));
    for (const b of f.benefits) out.push(item("benefit", "benefit", b, b.label, "value_changes"));
    for (const k of f.dependentKpis)
      out.push(item("formula", "kpi_definition", k, `KPI formula: ${k.label}`, "recalculation"));
    for (const bf of f.benefitFormulas)
      out.push(
        item("formula", "benefit_formula", bf, bf.label, "recalculation", { currentVersionNo: bf.currentVersionNo }),
      );
  } else if (f.subjectType === "tom_canvas_cell") {
    for (const g of f.tomGaps) out.push(item("initiative", "tom_gap", g, `TOM gap: ${g.label}`, "informational"));
    for (const d of f.decisions) out.push(item("initiative", "decision", d, `Decision: ${d.label}`, "informational"));
  } else if (f.changeKind === "business_scope") {
    for (const o of f.outcomes) out.push(item("outcome", "outcome", o, o.label, "informational"));
    for (const i of f.initiatives) out.push(item("initiative", "initiative", i, i.label, "value_changes"));
  } else if (f.subjectType === "benefit_formula") {
    for (const l of f.businessCaseLines)
      out.push(item("business_case", "business_case_line", l, l.label, "recalculation"));
    for (const b of f.benefits) out.push(item("benefit", "benefit", b, b.label, "value_changes"));
  } else if (f.subjectType === "milestone") {
    for (const i of f.initiatives) out.push(item("initiative", "initiative", i, i.label, "value_changes"));
    for (const i of f.dependentInitiatives)
      out.push(item("initiative", "initiative", i, i.label, "informational", { relation: "dependent" }));
  } else {
    // cost / budget rebaseline (initiative or budget line)
    if (f.subjectType === "budget_line")
      out.push(item("budget_line", "budget_line", f.subject, f.subject.label, "value_changes"));
    for (const i of f.initiatives) out.push(item("initiative", "initiative", i, i.label, "value_changes"));
    for (const l of f.businessCaseLines)
      out.push(item("business_case", "business_case_line", l, l.label, "informational"));
  }
  for (const g of f.gates) {
    const approved = g.decisionId !== null || g.status === "approved";
    const d = item(
      "gate",
      "gate_submission",
      { id: g.submissionId, code: g.gateCode, label: g.gateCode },
      "",
      approved ? "reapproval_required" : "informational",
      {
        gateCode: g.gateCode,
        gateStatus: g.status,
        submissionNo: g.submissionNo,
        ...(f.subjectType === "benefit_formula"
          ? { pinnedFormulaVersionNo: f.benefitFormulas.find((x) => x.id === f.subject.id)?.currentVersionNo ?? null }
          : {}),
      },
    );
    out.push({
      ...d,
      label: approved
        ? `${g.gateCode} approval (submission ${g.submissionNo}) is preserved; this change needs reapproval`
        : `${g.gateCode} pending submission ${g.submissionNo}`,
      gateSubmissionId: g.submissionId,
      gateDecisionId: g.decisionId,
    });
  }
  if (kpiSubject) out.push(report("T10.outcomes", "T10 Outcomes area"));
  else if (f.subjectType === "milestone") {
    out.push(report("T10.portfolio", "T10 Portfolio area"));
    out.push(report("T10.dependencies", "T10 Dependencies area"));
  } else if (f.subjectType === "budget_line" || f.subjectType === "benefit_formula" || f.changeKind === "cost")
    out.push(report("T10.value", "T10 Value area"));
  else out.push(report("T10.portfolio", "T10 Portfolio area"));
  return out.map((d, i) => ({ ordinal: i + 1, ...d }));
}

/** SHA-256 over the canonical JSON of the items (the assessment the approver saw can be proven unchanged). */
export function impactContentSha256(items: readonly ImpactItem[]): string {
  return createHash("sha256").update(canonicalJson(items)).digest("hex");
}

// ------------------------------------------------------------------------------------------------ fact loading

/** The KPI definition a KPI-subject change is about. */
async function kpiOfSubject(db: DbOrTx, subjectType: ChangeSubjectType, subjectId: string): Promise<string | null> {
  if (subjectType === "kpi_definition") return subjectId;
  const r = await db
    .selectFrom("outcome_kpi")
    .select("kpi_definition_id")
    .where("id", "=", subjectId)
    .executeTakeFirst();
  return r?.kpi_definition_id ?? null;
}

/** Approved (with the preserved decision) or pending gate submissions of the named gates. */
async function gateFacts(db: DbOrTx, transformationId: string, codes: readonly string[]): Promise<GateFact[]> {
  if (codes.length === 0) return [];
  const rows = await db
    .selectFrom("gate_instance as g")
    .innerJoin("gate_submission as s", "s.id", "g.current_submission_id")
    .leftJoin("gate_decision as d", (j) =>
      j.onRef("d.gate_submission_id", "=", "s.id").on("d.outcome", "=", "approved"),
    )
    .select([
      "g.gate_code",
      "g.status",
      "s.id as submission_id",
      "s.submission_no",
      "s.status as submission_status",
      "d.id as decision_id",
    ])
    .where("g.transformation_id", "=", transformationId)
    .where("g.gate_code", "in", [...codes])
    .orderBy("g.gate_code")
    .execute();
  return rows
    .filter((r) => r.status === "approved" || r.submission_status === "pending")
    .map((r) => ({
      gateCode: r.gate_code,
      status: r.status,
      submissionId: r.submission_id,
      submissionNo: r.submission_no,
      decisionId: r.decision_id ?? null,
    }));
}

const ref = (id: string, code: string | null, label: string | null): RecordRef => ({
  id,
  code,
  label: label ?? code ?? id,
});

/** The subject's label and code (the subject exists; the caller checked). */
async function subjectRef(db: DbOrTx, t: ChangeSubjectType, id: string): Promise<RecordRef> {
  const one = async (q: Promise<{ code: string | null; label: string | null } | undefined>) => {
    const r = await q;
    return ref(id, r?.code ?? null, r?.label ?? null);
  };
  switch (t) {
    case "charter":
      return one(
        db
          .selectFrom("charter")
          .select([sql<null>`NULL`.as("code"), "transformation_name as label"])
          .where("id", "=", id)
          .executeTakeFirst(),
      );
    case "kpi_definition":
      return one(
        db
          .selectFrom("kpi_definition")
          .select([sql<null>`NULL`.as("code"), "name as label"])
          .where("id", "=", id)
          .executeTakeFirst(),
      );
    case "outcome_kpi":
      return one(
        db
          .selectFrom("outcome_kpi as ok")
          .innerJoin("kpi_definition as k", "k.id", "ok.kpi_definition_id")
          .select([sql<null>`NULL`.as("code"), "k.name as label"])
          .where("ok.id", "=", id)
          .executeTakeFirst(),
      );
    case "tom_canvas_cell":
      return one(
        db
          .selectFrom("tom_canvas_cell")
          .select(["dimension_code as code", "dimension_code as label"])
          .where("id", "=", id)
          .executeTakeFirst(),
      );
    case "initiative":
      return one(db.selectFrom("initiative").select(["code", "name as label"]).where("id", "=", id).executeTakeFirst());
    case "benefit_formula":
      return one(
        db
          .selectFrom("benefit_formula")
          .select(["code", "benefit_name as label"])
          .where("id", "=", id)
          .executeTakeFirst(),
      );
    case "milestone":
      return one(
        db
          .selectFrom("milestone")
          .select([sql<null>`NULL`.as("code"), "title as label"])
          .where("id", "=", id)
          .executeTakeFirst(),
      );
    case "budget_line":
      return one(
        db
          .selectFrom("budget_line")
          .select([sql<null>`NULL`.as("code"), "label"])
          .where("id", "=", id)
          .executeTakeFirst(),
      );
  }
}

/** Loads the facts of a change (read-only; every query is filtered to the change's transformation). */
export async function loadImpactFacts(
  db: DbOrTx,
  transformationId: string,
  change: { changeKind: ChangeKind; subjectType: ChangeSubjectType; subjectId: string },
): Promise<ImpactFacts> {
  const { changeKind, subjectType, subjectId } = change;
  const empty: Omit<ImpactFacts, "changeKind" | "subjectType" | "subject" | "gates"> = {
    outcomes: [],
    dependentKpis: [],
    benefits: [],
    benefitFormulas: [],
    initiatives: [],
    dependentInitiatives: [],
    businessCaseLines: [],
    tomGaps: [],
    decisions: [],
  };
  const subject = await subjectRef(db, subjectType, subjectId);
  const gates = await gateFacts(db, transformationId, gatesFor(changeKind, subjectType));
  const base = { changeKind, subjectType, subject, gates };
  const T = transformationId;

  if (subjectType === "kpi_definition" || subjectType === "outcome_kpi") {
    const kpiId = await kpiOfSubject(db, subjectType, subjectId);
    if (kpiId === null) return { ...base, ...empty };
    const outcomes = await db
      .selectFrom("outcome_kpi as ok")
      .innerJoin("outcome as o", "o.id", "ok.outcome_id")
      .select(["o.id", "o.statement"])
      .distinct()
      .where("ok.transformation_id", "=", T)
      .where("ok.kpi_definition_id", "=", kpiId)
      .where("o.status", "<>", "archived")
      .orderBy("o.id")
      .execute();
    const dependents = await db
      .selectFrom("kpi_formula_input as i")
      .innerJoin("kpi_version as v", "v.id", "i.kpi_version_id")
      .innerJoin("kpi_definition as k", "k.id", "v.kpi_definition_id")
      .select(["k.id", "k.name"])
      .distinct()
      .where("i.transformation_id", "=", T)
      .where("i.source_kpi_definition_id", "=", kpiId)
      .where("v.status", "in", ["active", "draft"])
      .where("k.id", "<>", kpiId)
      .orderBy("k.id")
      .execute();
    const benefits = await db
      .selectFrom("benefit as b")
      .select(["b.id", "b.code", "b.title", "b.benefit_formula_id"])
      .where("b.transformation_id", "=", T)
      .where("b.status", "<>", "archived")
      .where((eb) =>
        eb.or([
          eb("b.measurement_kpi_definition_id", "=", kpiId),
          eb.exists(
            eb
              .selectFrom("benefit_valuation_method as m")
              .select("m.id")
              .whereRef("m.id", "=", "b.valuation_method_id")
              .where("m.kpi_definition_id", "=", kpiId),
          ),
        ]),
      )
      .orderBy("b.id")
      .execute();
    const formulaIds = [...new Set(benefits.map((b) => b.benefit_formula_id).filter((x): x is string => x !== null))];
    const formulas =
      formulaIds.length === 0
        ? []
        : await db
            .selectFrom("benefit_formula")
            .select(["id", "code", "benefit_name", "current_version_no"])
            .where("id", "in", formulaIds)
            .orderBy("id")
            .execute();
    return {
      ...base,
      ...empty,
      outcomes: outcomes.map((o) => ref(o.id, null, o.statement)),
      dependentKpis: dependents.map((k) => ref(k.id, null, k.name)),
      benefits: benefits.map((b) => ref(b.id, b.code, b.title)),
      benefitFormulas: formulas.map((x) => ({
        ...ref(x.id, x.code, x.benefit_name),
        currentVersionNo: x.current_version_no,
      })),
    };
  }
  if (subjectType === "tom_canvas_cell") {
    const cell = await db
      .selectFrom("tom_canvas_cell")
      .select("dimension_code")
      .where("id", "=", subjectId)
      .executeTakeFirst();
    const dim = cell?.dimension_code ?? "";
    const gaps = await db
      .selectFrom("tom_gap")
      .select(["id", "gap", "design_decision_id"])
      .where("transformation_id", "=", T)
      .where("dimension_code", "=", dim)
      .where("status", "<>", "archived")
      .orderBy("id")
      .execute();
    const decisionIds = [...new Set(gaps.map((g) => g.design_decision_id).filter((x): x is string => x !== null))];
    const decisions =
      decisionIds.length === 0
        ? []
        : await db
            .selectFrom("decision")
            .select(["id", "code", "title"])
            .where("id", "in", decisionIds)
            .orderBy("id")
            .execute();
    return {
      ...base,
      ...empty,
      tomGaps: gaps.map((g) => ref(g.id, null, g.gap)),
      decisions: decisions.map((d) => ref(d.id, d.code, d.title)),
    };
  }
  if (changeKind === "business_scope") {
    const outcomes =
      subjectType === "charter"
        ? await db
            .selectFrom("outcome")
            .select(["id", "statement"])
            .where("transformation_id", "=", T)
            .where("status", "<>", "archived")
            .where("is_top_outcome", "=", true)
            .orderBy("id")
            .execute()
        : [];
    const initiatives = await db
      .selectFrom("initiative")
      .select(["id", "code", "name"])
      .where("transformation_id", "=", T)
      .where("status", "<>", "cancelled")
      .$if(subjectType === "initiative", (q) => q.where("id", "=", subjectId))
      .$if(subjectType === "charter", (q) => q.where("status", "in", ["selected", "funded", "launched"]))
      .orderBy("id")
      .execute();
    return {
      ...base,
      ...empty,
      outcomes: outcomes.map((o) => ref(o.id, null, o.statement)),
      initiatives: initiatives.map((i) => ref(i.id, i.code, i.name)),
    };
  }
  if (subjectType === "benefit_formula") {
    const lines = await db
      .selectFrom("business_case_line")
      .select(["id", "title"])
      .where("transformation_id", "=", T)
      .where("benefit_formula_id", "=", subjectId)
      .where("status", "<>", "archived")
      .orderBy("id")
      .execute();
    const benefits = await db
      .selectFrom("benefit")
      .select(["id", "code", "title"])
      .where("transformation_id", "=", T)
      .where("benefit_formula_id", "=", subjectId)
      .where("status", "<>", "archived")
      .orderBy("id")
      .execute();
    const f = await db
      .selectFrom("benefit_formula")
      .select(["id", "code", "benefit_name", "current_version_no"])
      .where("id", "=", subjectId)
      .executeTakeFirst();
    return {
      ...base,
      ...empty,
      businessCaseLines: lines.map((l) => ref(l.id, null, l.title)),
      benefits: benefits.map((b) => ref(b.id, b.code, b.title)),
      benefitFormulas: f ? [{ ...ref(f.id, f.code, f.benefit_name), currentVersionNo: f.current_version_no }] : [],
    };
  }
  // milestone, budget line, initiative cost: the initiative first.
  let initiativeId: string | null = subjectType === "initiative" ? subjectId : null;
  if (subjectType === "milestone")
    initiativeId =
      (await db.selectFrom("milestone").select("initiative_id").where("id", "=", subjectId).executeTakeFirst())
        ?.initiative_id ?? null;
  if (subjectType === "budget_line")
    initiativeId =
      (await db.selectFrom("budget_line").select("initiative_id").where("id", "=", subjectId).executeTakeFirst())
        ?.initiative_id ?? null;
  const initiative =
    initiativeId === null
      ? undefined
      : await db
          .selectFrom("initiative")
          .select(["id", "code", "name"])
          .where("id", "=", initiativeId)
          .executeTakeFirst();
  const initiatives = initiative ? [ref(initiative.id, initiative.code, initiative.name)] : [];
  if (subjectType === "milestone") {
    const deps =
      initiativeId === null
        ? []
        : await db
            .selectFrom("dependency as d")
            .innerJoin("initiative as i", "i.id", "d.to_initiative_id")
            .select(["i.id", "i.code", "i.name"])
            .distinct()
            .where("d.transformation_id", "=", T)
            .where("d.from_initiative_id", "=", initiativeId)
            .where("d.status", "<>", "archived")
            .orderBy("i.id")
            .execute();
    return { ...base, ...empty, initiatives, dependentInitiatives: deps.map((i) => ref(i.id, i.code, i.name)) };
  }
  const lines =
    initiativeId === null
      ? []
      : await db
          .selectFrom("business_case_line as l")
          .innerJoin("business_case as c", "c.id", "l.business_case_id")
          .select(["l.id", "l.title"])
          .where("l.transformation_id", "=", T)
          .where("c.initiative_id", "=", initiativeId)
          .where("l.status", "<>", "archived")
          .orderBy("l.id")
          .execute();
  return { ...base, ...empty, initiatives, businessCaseLines: lines.map((l) => ref(l.id, null, l.title)) };
}

// ------------------------------------------------------------------------------------------------ presenters

export function toImpactItem(r: ImpactAssessmentItemRow): ImpactItem {
  return {
    ordinal: r.ordinal,
    itemType: r.item_type as ImpactItem["itemType"],
    recordType: r.record_type,
    recordId: r.record_id,
    recordCode: r.record_code,
    label: r.label,
    effect: r.effect as ImpactItem["effect"],
    gateSubmissionId: r.gate_submission_id,
    gateDecisionId: r.gate_decision_id,
    detail: (r.detail ?? {}) as Record<string, unknown>,
  };
}

export async function presentAssessments(
  db: DbOrTx,
  rows: readonly ImpactAssessmentRow[],
): Promise<ImpactAssessment[]> {
  if (rows.length === 0) return [];
  const items = await db
    .selectFrom("impact_assessment_item")
    .selectAll()
    .where(
      "impact_assessment_id",
      "in",
      rows.map((r) => r.id),
    )
    .orderBy("impact_assessment_id")
    .orderBy("ordinal")
    .execute();
  return rows.map((r) => ({
    id: r.id,
    transformationId: r.transformation_id,
    changeRequestId: r.change_request_id,
    changeRequestVersion: r.change_request_version,
    itemCount: r.item_count,
    contentSha256: r.content_sha256,
    assessedAt: iso(r.assessed_at),
    assessedBy: r.assessed_by,
    items: items.filter((i) => i.impact_assessment_id === r.id).map(toImpactItem),
  }));
}

// ------------------------------------------------------------------------------------------------ routes

/** The preview computation the change-request service provides (materiality + validation of the draft). */
export interface ImpactPreviewPort {
  /** Validates an unsaved draft like a create (422/404 without writing) and returns its materiality. */
  readonly previewDraft: (
    db: DbOrTx,
    transformationId: string,
    body: z.output<typeof changeRequestCreate>,
  ) => Promise<Materiality>;
  /** The materiality of a saved request's current content. */
  readonly previewSaved: (db: DbOrTx, cr: ChangeRequestRow) => Promise<Materiality>;
}

const tParams = z.strictObject({ transformationId: z.uuid() });
const crParams = z.strictObject({ transformationId: z.uuid(), changeRequestId: z.uuid() });
const iaParams = z.strictObject({ transformationId: z.uuid(), impactAssessmentId: z.uuid() });
const pageQuery = z.strictObject({ cursor: cursorSchema, limit: limitSchema });

/** The live preview of a change: materiality, items; every record is in the transformation the caller can read. */
export async function previewOf(
  db: DbOrTx,
  transformationId: string,
  change: { changeKind: ChangeKind; subjectType: ChangeSubjectType; subjectId: string },
  materiality: Materiality,
): Promise<ImpactPreview> {
  const items = deriveImpactItems(await loadImpactFacts(db, transformationId, change));
  // Every derived record belongs to this transformation, which the caller reads (checked by the route), so nothing is
  // hidden here; the count stays in the contract for records a later derivation reaches across transformations.
  return { materiality: materiality.materiality, materialityBasis: materiality.basis, items, hiddenItemCount: 0 };
}

async function findRequest(db: DbOrTx, transformationId: string, id: string): Promise<ChangeRequestRow> {
  const cr = await db
    .selectFrom("change_request")
    .selectAll()
    .where("id", "=", id)
    .where("transformation_id", "=", transformationId)
    .executeTakeFirst();
  if (!cr) throw problems.notFound();
  return cr;
}

/** The request's materiality port is wired by change-requests.ts (same module) at registration time. */
let previewPort: ImpactPreviewPort | null = null;
export function setImpactPreviewPort(port: ImpactPreviewPort): void {
  previewPort = port;
}
function portOf(): ImpactPreviewPort {
  if (previewPort === null) throw problems.internal();
  return previewPort;
}

export function registerImpactRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  const read = { access: { permission: "transformation.read" as const } };

  // A read sent as a POST (the draft is a body; nothing is written): declared "authenticated", the one non-write form a
  // POST may declare (workflows.test), and authorised by transformation.read on the transformation in the handler
  // (404 outside scope), as OpenAPI previewChangeImpact states.
  app.post(
    PREVIEW,
    { config: { access: { permission: "authenticated" as const }, consumes: JSON_BODY } },
    async (request) => {
      const { transformationId } = parse(tParams, request.params, "params");
      await requireTransformationRead(db, principalOf(request), transformationId);
      const body = parseBody(changeRequestCreate, request.body);
      const materiality = await portOf().previewDraft(db, transformationId, body);
      return previewOf(db, transformationId, body, materiality);
    },
  );

  app.get(CR_PREVIEW, { config: read }, async (request) => {
    const { transformationId, changeRequestId } = parse(crParams, request.params, "params");
    parseQuery(z.strictObject({}), request.query);
    await requireTransformationRead(db, principalOf(request), transformationId);
    const cr = await findRequest(db, transformationId, changeRequestId);
    const materiality = await portOf().previewSaved(db, cr);
    return previewOf(
      db,
      transformationId,
      {
        changeKind: cr.change_kind as ChangeKind,
        subjectType: cr.subject_type as ChangeSubjectType,
        subjectId: cr.subject_id,
      },
      materiality,
    );
  });

  app.get(CR_ASSESSMENTS, { config: read }, async (request) => {
    const { transformationId, changeRequestId } = parse(crParams, request.params, "params");
    const query = parseQuery(pageQuery, request.query);
    await requireTransformationRead(db, principalOf(request), transformationId);
    await findRequest(db, transformationId, changeRequestId);
    const hash = filterHash({ table: "impact_assessment", changeRequestId });
    const after = decodeCursor(query.cursor, hash, 1);
    let q = db
      .selectFrom("impact_assessment")
      .selectAll()
      .where("change_request_id", "=", changeRequestId)
      .where("transformation_id", "=", transformationId);
    if (after) q = q.where("change_request_version", ">", Number(after[0]));
    const rows = await q
      .orderBy("change_request_version")
      .limit(query.limit + 1)
      .execute();
    const page = paginate(rows, query.limit, (r) => [r.change_request_version], hash);
    return { items: await presentAssessments(db, page.items), nextCursor: page.nextCursor };
  });

  app.get(ASSESSMENT, { config: read }, async (request) => {
    const { transformationId, impactAssessmentId } = parse(iaParams, request.params, "params");
    parseQuery(z.strictObject({}), request.query);
    await requireTransformationRead(db, principalOf(request), transformationId);
    const row = await db
      .selectFrom("impact_assessment")
      .selectAll()
      .where("id", "=", impactAssessmentId)
      .where("transformation_id", "=", transformationId)
      .executeTakeFirst();
    if (!row) throw problems.notFound();
    return (await presentAssessments(db, [row]))[0]!;
  });

  return [`POST ${PREVIEW}`, `GET ${CR_PREVIEW}`, `GET ${CR_ASSESSMENTS}`, `GET ${ASSESSMENT}`];
}
