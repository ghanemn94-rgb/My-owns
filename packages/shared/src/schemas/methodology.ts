// P2 methodology catalogue mirrors (backend-workflow-engineer; docs/api/openapi.yaml components MethodologyVersion,
// DiagnosticDimension, DiagnosticWorkstream, TomDimension, GateDefinition, GateCriterionDefinition,
// CharterScopeCheckDefinition, GoodOutcomeCriterion, MethodologyCatalogue, TomDimensionLabelsUpdate) plus the small P2
// enums shared by the other BE mirrors (codes, Warning, LinkableRecordType, the P2 list query).
// Source text is verbatim from the playbook; Arabic is a provisional translation (ADR-0016 §2).
import { z } from "zod";
import { phase, timestamp, uuid, version } from "./common.ts";

const text = (min: number, max: number) => z.string().min(min).max(max);
const catalogueCode = z.string().regex(/^[a-z][a-z0-9_]{0,47}$/);
const nullableUuid = uuid.nullable();

/** Product gates G1-G6: BUSINESS approvals inside the product, never the engineering delivery gates DG0-DG7. */
export const GATE_CODES = ["G1", "G2", "G3", "G4", "G5", "G6"] as const;
export const gateCode = z.enum(GATE_CODES);

export const TOM_DIMENSION_CODES = [
  "customer_value_proposition",
  "products_services",
  "journeys_processes",
  "organization",
  "governance_decision_rights",
  "people_capabilities",
  "technology",
  "data_analytics",
  "partners_sourcing",
  "performance_management",
] as const;
export const tomDimensionCode = z.enum(TOM_DIMENSION_CODES);

export const DIAGNOSTIC_DIMENSION_CODES = [
  "financial",
  "customer",
  "process",
  "people_org",
  "technology",
  "data",
] as const;
export const diagnosticDimensionCode = z.enum(DIAGNOSTIC_DIMENSION_CODES);

/** The 20 P2 record types an evidence link (and the record-ref guard) may point at (ADR-0018 §4). */
export const LINKABLE_RECORD_TYPES = [
  "charter",
  "north_star",
  "strategic_guardrail",
  "outcome",
  "kpi_definition",
  "baseline",
  "outcome_kpi",
  "value_pool",
  "diagnostic_item",
  "diagnostic_finding",
  "diagnostic_workstream_output",
  "tom_canvas_cell",
  "tom_gap",
  "capability",
  "journey",
  "journey_pain_point",
  "decision",
  "dependency",
  "tom_workshop",
  "action_item",
] as const;
export const linkableRecordType = z.enum(LINKABLE_RECORD_TYPES);

/** A computed, non-blocking warning or a missing item of a gate criterion (machine code + English diagnostic). */
export const warning = z.strictObject({
  code: z.string().regex(/^[a-z][a-z0-9_.]*$/),
  message: z.string(),
  pointer: z.string().optional(),
});
export type Warning = z.infer<typeof warning>;

/** List query of the P2 register lists (`includeArchived`; cursor and limit are added by the API). */
export const p2ListQuery = z.strictObject({ includeArchived: z.stringbool().default(false) });

const catalogueStamps = {
  version,
  createdAt: timestamp,
  createdBy: nullableUuid,
  updatedAt: timestamp,
  updatedBy: nullableUuid,
};

export const methodologyVersion = z.strictObject({
  id: uuid,
  key: z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/),
  versionNo: z.number().int().min(1),
  status: z.enum(["draft", "published", "retired"]),
  titleEn: text(1, 200),
  titleAr: text(1, 200),
  sourceDocument: text(1, 500),
  sourceSha256: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .nullable(),
  definition: z.record(z.string(), z.unknown()),
  contentSha256: z.string().regex(/^[0-9a-f]{64}$/),
  publishedAt: timestamp.nullable(),
  publishedBy: nullableUuid,
  ...catalogueStamps,
});

export const diagnosticDimension = z.strictObject({
  id: uuid,
  code: catalogueCode,
  methodologyVersionId: uuid,
  ordinal: z.number().int().min(1).max(99),
  sourceLabel: text(1, 100),
  labelEn: text(1, 200),
  labelAr: text(1, 200),
  evidenceHintEn: text(1, 200),
  evidenceHintAr: text(1, 200),
  impactHintEn: text(1, 200),
  impactHintAr: text(1, 200),
  isSourceSeeded: z.boolean(),
  status: z.enum(["active", "retired"]),
  ...catalogueStamps,
});

export const diagnosticWorkstream = z.strictObject({
  id: uuid,
  code: catalogueCode,
  methodologyVersionId: uuid,
  ordinal: z.number().int().min(1).max(99),
  sourceNameEn: text(1, 100),
  nameAr: text(1, 200),
  sourceKeyQuestionsEn: text(1, 1000),
  keyQuestionsAr: text(1, 1000),
  sourceTypicalOutputsEn: text(1, 1000),
  typicalOutputsAr: text(1, 1000),
  sourceRef: text(1, 50),
  status: z.enum(["active", "retired"]),
  ...catalogueStamps,
});

export const tomDimension = z.strictObject({
  id: uuid,
  code: catalogueCode,
  methodologyVersionId: uuid,
  ordinal: z.number().int().min(1).max(10),
  sourceNameEn: text(1, 100),
  sourceDesignQuestionEn: text(1, 500),
  sourceCanvasBoxEn: text(1, 100),
  sourceCanvasPromptEn: text(1, 500),
  labelEn: text(1, 200),
  labelAr: text(1, 200),
  designQuestionAr: text(1, 500),
  canvasBoxAr: text(1, 200),
  canvasPromptAr: text(1, 500),
  sourceRef: text(1, 50),
  ...catalogueStamps,
});
export type TomDimension = z.infer<typeof tomDimension>;

/** Only display labels and Arabic translations are editable (REQ-PB-038); source text, code and order are fixed. */
export const tomDimensionLabelsUpdate = z
  .strictObject({
    labelEn: text(1, 200),
    labelAr: text(1, 200),
    designQuestionAr: text(1, 500),
    canvasBoxAr: text(1, 200),
    canvasPromptAr: text(1, 500),
  })
  .partial()
  .refine((v) => Object.keys(v).length >= 1, "validation.min_properties");

export const gateCriterionDefinition = z.strictObject({
  id: uuid,
  gateDefinitionId: uuid,
  key: z.string().regex(/^g[1-6]\.[a-z_]{1,48}$/),
  ordinal: z.number().int().min(1).max(20),
  labelEn: text(1, 200),
  labelAr: text(1, 200),
  descriptionEn: text(1, 1000),
  descriptionAr: text(1, 1000),
  mandatory: z.boolean(),
  requiresVerifiedEvidence: z.boolean(),
  sourceRef: text(1, 100),
  ...catalogueStamps,
});

export const gateDefinition = z.strictObject({
  id: uuid,
  code: z.string().regex(/^G[1-6]$/),
  methodologyVersionId: uuid,
  ordinal: z.number().int().min(1).max(6),
  phase,
  nextPhase: phase.nullable(),
  sourceNameEn: text(1, 100),
  nameAr: text(1, 200),
  sourceDecisionQuestionEn: text(1, 500),
  decisionQuestionAr: text(1, 500),
  sourceEvidenceRequiredEn: text(1, 500),
  evidenceRequiredAr: text(1, 500),
  defaultApproverRoleCode: z.string(),
  allowedApproverRoleCodes: z.array(z.string()),
  submissionEnabled: z.boolean(),
  sourceRef: text(1, 50),
  ...catalogueStamps,
  criteria: z.array(gateCriterionDefinition),
});
export type GateDefinition = z.infer<typeof gateDefinition>;

export const SCOPE_CHECK_PRECHECKS = [
  "none",
  "scope_items_traced",
  "exclusions_present",
  "baseline_measurable",
  "executive_decisions_visible",
] as const;

export const charterScopeCheckDefinition = z.strictObject({
  id: uuid,
  code: catalogueCode,
  methodologyVersionId: uuid,
  ordinal: z.number().int().min(1).max(5),
  sourceQuestionEn: text(1, 500),
  questionAr: text(1, 500),
  sourceRef: text(1, 50),
  systemPrecheck: z.enum(SCOPE_CHECK_PRECHECKS),
  ...catalogueStamps,
});

export const goodOutcomeCriterion = z.strictObject({
  id: uuid,
  code: catalogueCode,
  methodologyVersionId: uuid,
  ordinal: z.number().int().min(1).max(5),
  sourceLabelEn: text(1, 200),
  labelAr: text(1, 200),
  evaluation: z.enum(["user_attested", "system_kpi_linked", "system_owner_set"]),
  sourceRef: text(1, 50),
  ...catalogueStamps,
});

export const methodologyCatalogue = z.strictObject({
  methodologyVersion,
  diagnosticDimensions: z.array(diagnosticDimension),
  diagnosticWorkstreams: z.array(diagnosticWorkstream),
  tomDimensions: z.array(tomDimension),
  gateDefinitions: z.array(gateDefinition),
  charterScopeChecks: z.array(charterScopeCheckDefinition),
  goodOutcomeCriteria: z.array(goodOutcomeCriterion),
});
export type MethodologyCatalogueBody = z.infer<typeof methodologyCatalogue>;
