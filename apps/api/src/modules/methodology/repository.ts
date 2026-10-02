// methodology data access: the pinned catalogue (read-only seed, ADR-0016 §2) and its API shapes.
import type {
  CharterScopeCheckDefinitionTable,
  DbOrTx,
  DiagnosticDimensionTable,
  DiagnosticWorkstreamTable,
  GateCriterionDefinitionTable,
  GateDefinitionTable,
  GoodOutcomeCriterionTable,
  MethodologyVersionTable,
  TomDimensionTable,
} from "@mth/db";
import type { GateDefinition, MethodologyCatalogueBody, TomDimension } from "@mth/shared/schemas";
import type { Selectable } from "kysely";
import { iso, isoOrNull } from "../platform/index.ts";

export type MethodologyCatalogue = MethodologyCatalogueBody;

const stamps = (r: {
  version: number;
  created_at: Date;
  created_by: string | null;
  updated_at: Date;
  updated_by: string | null;
}) => ({
  version: r.version,
  createdAt: iso(r.created_at),
  createdBy: r.created_by,
  updatedAt: iso(r.updated_at),
  updatedBy: r.updated_by,
});

export const toTomDimension = (r: Selectable<TomDimensionTable>): TomDimension => ({
  id: r.id,
  code: r.code,
  methodologyVersionId: r.methodology_version_id,
  ordinal: r.ordinal,
  sourceNameEn: r.source_name_en,
  sourceDesignQuestionEn: r.source_design_question_en,
  sourceCanvasBoxEn: r.source_canvas_box_en,
  sourceCanvasPromptEn: r.source_canvas_prompt_en,
  labelEn: r.label_en,
  labelAr: r.label_ar,
  designQuestionAr: r.design_question_ar,
  canvasBoxAr: r.canvas_box_ar,
  canvasPromptAr: r.canvas_prompt_ar,
  sourceRef: r.source_ref,
  ...stamps(r),
});

export function toGateDefinition(
  r: Selectable<GateDefinitionTable>,
  criteria: readonly Selectable<GateCriterionDefinitionTable>[],
): GateDefinition {
  return {
    id: r.id,
    code: r.code,
    methodologyVersionId: r.methodology_version_id,
    ordinal: r.ordinal,
    phase: r.phase as GateDefinition["phase"],
    nextPhase: r.next_phase as GateDefinition["nextPhase"],
    sourceNameEn: r.source_name_en,
    nameAr: r.name_ar,
    sourceDecisionQuestionEn: r.source_decision_question_en,
    decisionQuestionAr: r.decision_question_ar,
    sourceEvidenceRequiredEn: r.source_evidence_required_en,
    evidenceRequiredAr: r.evidence_required_ar,
    defaultApproverRoleCode: r.default_approver_role_code,
    allowedApproverRoleCodes: r.allowed_approver_role_codes,
    submissionEnabled: r.submission_enabled,
    sourceRef: r.source_ref,
    ...stamps(r),
    criteria: criteria
      .filter((c) => c.gate_definition_id === r.id)
      .map((c) => ({
        id: c.id,
        gateDefinitionId: c.gate_definition_id,
        key: c.key,
        ordinal: c.ordinal,
        labelEn: c.label_en,
        labelAr: c.label_ar,
        descriptionEn: c.description_en,
        descriptionAr: c.description_ar,
        mandatory: c.mandatory,
        requiresVerifiedEvidence: c.requires_verified_evidence,
        sourceRef: c.source_ref,
        ...stamps(c),
      })),
  };
}

/** Gate definitions with their criteria, in gate order (G1..G6), criteria by ordinal. */
export async function loadGateDefinitions(db: DbOrTx): Promise<GateDefinition[]> {
  const gates = await db.selectFrom("gate_definition").selectAll().orderBy("ordinal").execute();
  const criteria = await db.selectFrom("gate_criterion_definition").selectAll().orderBy("ordinal").execute();
  return gates.map((g) => toGateDefinition(g, criteria));
}

const toMethodologyVersion = (r: Selectable<MethodologyVersionTable>) => ({
  id: r.id,
  key: r.key,
  versionNo: r.version_no,
  status: r.status as "draft" | "published" | "retired",
  titleEn: r.title_en,
  titleAr: r.title_ar,
  sourceDocument: r.source_document,
  sourceSha256: r.source_sha256,
  definition: r.definition as Record<string, unknown>,
  contentSha256: r.content_sha256,
  publishedAt: isoOrNull(r.published_at),
  publishedBy: r.published_by,
  ...stamps(r),
});
const toDiagnosticDimension = (r: Selectable<DiagnosticDimensionTable>) => ({
  id: r.id,
  code: r.code,
  methodologyVersionId: r.methodology_version_id,
  ordinal: r.ordinal,
  sourceLabel: r.source_label,
  labelEn: r.label_en,
  labelAr: r.label_ar,
  evidenceHintEn: r.evidence_hint_en,
  evidenceHintAr: r.evidence_hint_ar,
  impactHintEn: r.impact_hint_en,
  impactHintAr: r.impact_hint_ar,
  isSourceSeeded: r.is_source_seeded,
  status: r.status as "active" | "retired",
  ...stamps(r),
});
const toDiagnosticWorkstream = (r: Selectable<DiagnosticWorkstreamTable>) => ({
  id: r.id,
  code: r.code,
  methodologyVersionId: r.methodology_version_id,
  ordinal: r.ordinal,
  sourceNameEn: r.source_name_en,
  nameAr: r.name_ar,
  sourceKeyQuestionsEn: r.source_key_questions_en,
  keyQuestionsAr: r.key_questions_ar,
  sourceTypicalOutputsEn: r.source_typical_outputs_en,
  typicalOutputsAr: r.typical_outputs_ar,
  sourceRef: r.source_ref,
  status: r.status as "active" | "retired",
  ...stamps(r),
});
const toScopeCheck = (r: Selectable<CharterScopeCheckDefinitionTable>) => ({
  id: r.id,
  code: r.code,
  methodologyVersionId: r.methodology_version_id,
  ordinal: r.ordinal,
  sourceQuestionEn: r.source_question_en,
  questionAr: r.question_ar,
  sourceRef: r.source_ref,
  systemPrecheck: r.system_precheck as MethodologyCatalogue["charterScopeChecks"][number]["systemPrecheck"],
  ...stamps(r),
});
const toGoodOutcomeCriterion = (r: Selectable<GoodOutcomeCriterionTable>) => ({
  id: r.id,
  code: r.code,
  methodologyVersionId: r.methodology_version_id,
  ordinal: r.ordinal,
  sourceLabelEn: r.source_label_en,
  labelAr: r.label_ar,
  evaluation: r.evaluation as MethodologyCatalogue["goodOutcomeCriteria"][number]["evaluation"],
  sourceRef: r.source_ref,
  ...stamps(r),
});

/** The catalogue a transformation is pinned to (transformation_config_pin, ADR-0014); null when it has no pin. */
export async function loadMethodologyCatalogue(
  db: DbOrTx,
  transformationId: string,
): Promise<MethodologyCatalogue | null> {
  const pin = await db
    .selectFrom("transformation_config_pin")
    .select("methodology_version_id")
    .where("transformation_id", "=", transformationId)
    .where("kind", "=", "methodology")
    .executeTakeFirst();
  if (!pin) return null;
  const mv = pin.methodology_version_id;
  const version = await db.selectFrom("methodology_version").selectAll().where("id", "=", mv).executeTakeFirstOrThrow();
  const [dims, workstreams, toms, scopeChecks, goodOutcome, gates] = await Promise.all([
    db
      .selectFrom("diagnostic_dimension")
      .selectAll()
      .where("methodology_version_id", "=", mv)
      .orderBy("ordinal")
      .execute(),
    db
      .selectFrom("diagnostic_workstream")
      .selectAll()
      .where("methodology_version_id", "=", mv)
      .orderBy("ordinal")
      .execute(),
    db.selectFrom("tom_dimension").selectAll().where("methodology_version_id", "=", mv).orderBy("ordinal").execute(),
    db
      .selectFrom("charter_scope_check_definition")
      .selectAll()
      .where("methodology_version_id", "=", mv)
      .orderBy("ordinal")
      .execute(),
    db
      .selectFrom("good_outcome_criterion")
      .selectAll()
      .where("methodology_version_id", "=", mv)
      .orderBy("ordinal")
      .execute(),
    loadGateDefinitions(db),
  ]);
  return {
    methodologyVersion: toMethodologyVersion(version),
    diagnosticDimensions: dims.map(toDiagnosticDimension),
    diagnosticWorkstreams: workstreams.map(toDiagnosticWorkstream),
    tomDimensions: toms.map(toTomDimension),
    gateDefinitions: gates.filter((g) => g.methodologyVersionId === mv),
    charterScopeChecks: scopeChecks.map(toScopeCheck),
    goodOutcomeCriteria: goodOutcome.map(toGoodOutcomeCriterion),
  };
}
