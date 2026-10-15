// methodology data access: the pinned catalogue (read-only seed, ADR-0016 §2; resolved per version, ADR-0039 §2) and its
// API shapes.
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
import { createConfigResolver, type ConfigResolver, type ResolvedElement } from "./config-resolver.ts";

/** The resolver of callers that pass none (the route passes the composition root's). */
const defaultResolver: ConfigResolver = createConfigResolver();

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

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const bool = (v: unknown): boolean | undefined => (typeof v === "boolean" ? v : undefined);
const attr = (e: ResolvedElement, name: string): unknown => new Map(Object.entries(e.attributes)).get(name);
/** A version's own rows of a type that name a catalogue identity (the overrides of ADR-0039 §2), by stable key. */
const overridesOf = (elements: readonly ResolvedElement[]) =>
  new Map(elements.filter((e) => e.overridden && e.origin === "source").map((e) => [e.stableKey, e] as const));

/**
 * The TOM dimensions of a version (ADR-0039 §2 "Resolution"): the registry rows, each with the version's
 * `tom_dimension` row applied where one exists (labelEn/labelAr, helpEn/helpAr = the design question, the attribute
 * mapping of config-resolver.ts `loadCatalogue`). Without rows (playbook v1) the catalogue rows are returned as they are.
 */
function resolveTomDimensions(dims: readonly TomDimension[], elements: readonly ResolvedElement[]): TomDimension[] {
  const by = overridesOf(elements);
  if (by.size === 0) return [...dims];
  return dims.map((d) => {
    const e = by.get(d.code);
    if (e === undefined) return d;
    return {
      ...d,
      labelEn: str(attr(e, "labelEn")) ?? d.labelEn,
      labelAr: str(attr(e, "labelAr")) ?? d.labelAr,
      sourceDesignQuestionEn: str(attr(e, "helpEn")) ?? d.sourceDesignQuestionEn,
      designQuestionAr: str(attr(e, "helpAr")) ?? d.designQuestionAr,
    };
  });
}

/**
 * The gate definitions of a version (ADR-0039 §2 "Resolution"): the registry rows, each with the version's `gate` and
 * `gate_criterion` rows applied where they exist. This is the same mapping as the gates reader's
 * `resolveGateDefinitions` (workflows/criteria.ts, BE-C), so the catalogue and the gate workflow agree: the default
 * approver only inside the DG2 allowed set, removed criteria left out. Without rows (playbook v1) the catalogue rows are
 * returned as they are.
 */
function resolveGates(
  defs: readonly GateDefinition[],
  gateElements: readonly ResolvedElement[],
  criterionElements: readonly ResolvedElement[],
): GateDefinition[] {
  const gateBy = overridesOf(gateElements);
  const critBy = overridesOf(criterionElements);
  if (gateBy.size === 0 && critBy.size === 0) return [...defs];
  return defs.map((d) => {
    const g = gateBy.get(d.code);
    const touched = d.criteria.some((c) => critBy.has(c.key));
    if (g === undefined && !touched) return d;
    const approver = g === undefined ? undefined : str(attr(g, "defaultApproverRoleCode"));
    return {
      ...d,
      ...(g === undefined
        ? {}
        : {
            sourceNameEn: str(attr(g, "labelEn")) ?? d.sourceNameEn,
            nameAr: str(attr(g, "labelAr")) ?? d.nameAr,
            sourceDecisionQuestionEn: str(attr(g, "helpEn")) ?? d.sourceDecisionQuestionEn,
            decisionQuestionAr: str(attr(g, "helpAr")) ?? d.decisionQuestionAr,
            defaultApproverRoleCode:
              approver !== undefined && d.allowedApproverRoleCodes.includes(approver)
                ? approver
                : d.defaultApproverRoleCode,
            submissionEnabled: bool(attr(g, "submissionEnabled")) ?? d.submissionEnabled,
          }),
      criteria: d.criteria
        .filter((c) => critBy.get(c.key)?.removed !== true)
        .map((c) => {
          const e = critBy.get(c.key);
          if (e === undefined) return c;
          return {
            ...c,
            labelEn: str(attr(e, "labelEn")) ?? c.labelEn,
            labelAr: str(attr(e, "labelAr")) ?? c.labelAr,
            descriptionEn: str(attr(e, "helpEn")) ?? c.descriptionEn,
            descriptionAr: str(attr(e, "helpAr")) ?? c.descriptionAr,
            mandatory: bool(attr(e, "mandatory")) ?? c.mandatory,
          };
        }),
    };
  });
}

/**
 * The catalogue of the methodology version a transformation is pinned to (transformation_config_pin, ADR-0014); null
 * when it has no methodology pin.
 *
 * ADR-0039 §2/§3 (T-DG5-BE-C2, D-155): the DG2-DG4 catalogue rows are the stable-identity REGISTRY. Their codes and
 * ordinals are globally unique (0011), they all belong to `playbook` v1, and no later version gets rows of its own. So
 * the identities of every version are the registry rows (never filtered by the pinned version id: that returned empty
 * catalogues for every transformation pinned to a version after v1), and their attributes resolve as the pinned
 * version's `methodology_element` row when it exists, else the catalogue's values, through the ConfigResolver.
 * Diagnostic dimensions and workstreams, charter scope checks and good-outcome criteria have no element type
 * (ADR-0039 §2), so they are the registry values for every version. `methodologyVersionId` on each item stays the
 * registry row's own column. For a transformation pinned to v1 (no element rows) the result is byte-identical to DG4.
 */
export async function loadMethodologyCatalogue(
  db: DbOrTx,
  transformationId: string,
  resolver: ConfigResolver = defaultResolver,
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
  const [dims, workstreams, toms, scopeChecks, goodOutcome, gates, tomElements, gateElements, criterionElements] =
    await Promise.all([
      db.selectFrom("diagnostic_dimension").selectAll().orderBy("ordinal").execute(),
      db.selectFrom("diagnostic_workstream").selectAll().orderBy("ordinal").execute(),
      db.selectFrom("tom_dimension").selectAll().orderBy("ordinal").execute(),
      db.selectFrom("charter_scope_check_definition").selectAll().orderBy("ordinal").execute(),
      db.selectFrom("good_outcome_criterion").selectAll().orderBy("ordinal").execute(),
      loadGateDefinitions(db),
      resolver.elements(db, mv, "tom_dimension", { includeRemoved: true }),
      resolver.elements(db, mv, "gate", { includeRemoved: true }),
      resolver.elements(db, mv, "gate_criterion", { includeRemoved: true }),
    ]);
  return {
    methodologyVersion: toMethodologyVersion(version),
    diagnosticDimensions: dims.map(toDiagnosticDimension),
    diagnosticWorkstreams: workstreams.map(toDiagnosticWorkstream),
    tomDimensions: resolveTomDimensions(toms.map(toTomDimension), tomElements),
    gateDefinitions: resolveGates(gates, gateElements, criterionElements),
    charterScopeChecks: scopeChecks.map(toScopeCheck),
    goodOutcomeCriteria: goodOutcome.map(toGoodOutcomeCriterion),
  };
}
