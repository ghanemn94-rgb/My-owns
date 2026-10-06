// P2 charter mirrors (backend-workflow-engineer; ADR-0017): the current charter (14 source fields B0035, thesis B0037,
// scope sanity checks B0038-B0043), its immutable version snapshots and the computed view. Mirrors docs/api/openapi.yaml
// Charter, CharterVersion, CharterView, CharterWrite, CharterUpdate, ScopeCheckPrecheck.
import { z } from "zod";
import { freeText, timestamp, uuid, version } from "./common.ts";
import { northStar, outcome, strategicGuardrail } from "./direction.ts";
import { businessDate } from "./kpi.ts";
import { warning } from "./methodology.ts";

// F-DG2-150: blank (whitespace-only) free text is rejected with `validation.blank`; `null` clears the field.
const text = (min: number, max: number) => freeText(min, max).nullable();
const nullableUuid = uuid.nullable();
const scopeAnswer = z.enum(["yes", "partly", "no"]).nullable();

/** The editable charter fields (all nullable: an initial charter may be partial; G1 checks completeness). */
export const charterFields = {
  transformationName: text(1, 200),
  executiveSponsorUserId: nullableUuid,
  transformationLeadUserId: nullableUuid,
  caseForChange: text(1, 20000),
  northStarId: nullableUuid,
  inScope: text(1, 20000),
  outOfScope: text(1, 20000),
  baselineDate: businessDate.nullable(),
  targetHorizonValue: z.number().int().min(1).max(600).nullable(),
  targetHorizonUnit: z.enum(["months", "quarters", "years"]).nullable(),
  governanceForum: text(1, 500),
  decisionRights: text(1, 20000),
  successDefinition: text(1, 20000),
  thesisChange: text(1, 4000),
  thesisOutcomes: text(1, 4000),
  thesisBenefits: text(1, 4000),
  thesisBecause: text(1, 8000),
  scOutcomeLinkage: scopeAnswer,
  scOutcomeLinkageEvidence: text(1, 4000),
  scProblemTraceability: scopeAnswer,
  scProblemTraceabilityEvidence: text(1, 4000),
  scExclusionsDocumented: scopeAnswer,
  scExclusionsDocumentedEvidence: text(1, 4000),
  scBaselineMeasurable: scopeAnswer,
  scBaselineMeasurableEvidence: text(1, 4000),
  scExecutiveDecisionsVisible: scopeAnswer,
  scExecutiveDecisionsVisibleEvidence: text(1, 4000),
};

export const charter = z.strictObject({
  id: uuid,
  organizationId: uuid,
  transformationId: uuid,
  ...charterFields,
  version,
  createdAt: timestamp,
  createdBy: uuid,
  updatedAt: timestamp,
  updatedBy: uuid,
});
export type Charter = z.infer<typeof charter>;

export const charterVersion = z.strictObject({
  id: uuid,
  organizationId: uuid,
  transformationId: uuid,
  charterId: uuid,
  versionNo: z.number().int().min(1),
  ...charterFields,
  northStarStatement: text(1, 300),
  topOutcomesSnapshot: z.array(z.record(z.string(), z.unknown())),
  guardrailsSnapshot: z.array(z.record(z.string(), z.unknown())),
  changeSummary: text(1, 1000),
  savedBy: uuid,
  savedAt: timestamp,
});
export type CharterVersion = z.infer<typeof charterVersion>;
export const charterVersionPage = z.strictObject({ items: z.array(charterVersion), nextCursor: z.string().nullable() });

/** The target horizon is a pair: both value and unit, or neither. */
const horizonPair = (c: {
  targetHorizonValue?: number | null | undefined;
  targetHorizonUnit?: string | null | undefined;
}) =>
  c.targetHorizonValue === undefined && c.targetHorizonUnit === undefined
    ? true
    : (c.targetHorizonValue ?? null) === null
      ? (c.targetHorizonUnit ?? null) === null
      : (c.targetHorizonUnit ?? null) !== null;

export const charterWrite = z
  .strictObject(charterFields)
  .partial()
  .refine(horizonPair, { message: "validation.target_horizon_pair", path: ["targetHorizonUnit"] });
export const charterUpdate = z
  .strictObject({ ...charterFields, changeSummary: freeText(1, 1000) })
  .partial()
  .refine((v) => Object.keys(v).length >= 1, "validation.min_properties");

export const SCOPE_CHECK_CODES = [
  "outcome_linkage",
  "problem_traceability",
  "exclusions_documented",
  "baseline_measurable",
  "executive_decisions_visible",
] as const;
export const scopeCheckPrecheck = z.strictObject({
  code: z.enum(SCOPE_CHECK_CODES),
  result: z.enum(["pass", "attention", "not_applicable", "unknown"]),
  detail: z.string(),
});

export const charterView = z.strictObject({
  charter,
  northStar: northStar.nullable().optional(),
  topOutcomes: z.array(outcome),
  guardrails: z.array(strategicGuardrail),
  warnings: z.array(warning),
  scopeCheckPrechecks: z.array(scopeCheckPrecheck),
});
export type CharterViewBody = z.infer<typeof charterView>;

// ---- Transformation thesis (B0036/B0037, REQ-PB-030; F-DG2-203) ------------------------------------------------------

/** The four thesis parts, in the order of the source sentence. */
export const THESIS_PARTS = ["thesisChange", "thesisOutcomes", "thesisBenefits", "thesisBecause"] as const;
export type ThesisPart = (typeof THESIS_PARTS)[number];

/**
 * The source sentence structure of B0037 (EN): "If we change [capabilities / journeys / operating model], then
 * [customer/operational outcomes] will improve, which will create [financial/strategic benefits], because [evidence /
 * causal logic]." The placeholders are `{change}`, `{outcomes}`, `{benefits}` and `{because}`. A UI passes its own
 * translated template of the SAME structure (e.g. Arabic); the playbook text stays the authority.
 */
export const THESIS_SOURCE_TEMPLATE_EN =
  "If we change {change}, then {outcomes} will improve, which will create {benefits}, because {because}.";

export interface ComposedThesis {
  /** True only when all four parts are present (non-blank). */
  readonly complete: boolean;
  /** The parts that are empty, in source order. An incomplete thesis is flagged, never shown as answered. */
  readonly missing: readonly ThesisPart[];
  /** The composed sentence; null while any part is missing (no sentence with blanks is rendered as if complete). */
  readonly sentence: string | null;
}

const PLACEHOLDER: Readonly<Record<ThesisPart, string>> = {
  thesisChange: "{change}",
  thesisOutcomes: "{outcomes}",
  thesisBenefits: "{benefits}",
  thesisBecause: "{because}",
};

/** A part as it reads inside the sentence: trimmed, without its own closing full stop. Blank -> null. */
function thesisPartText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const t = value
    .trim()
    .replace(/[.۔]+$/u, "")
    .trim();
  return t === "" ? null : t;
}

/** Composes the four-part thesis into the source sentence, or flags it incomplete (pure; used by the API and the UI). */
export function composeThesis(
  parts: Readonly<Partial<Record<ThesisPart, string | null>>>,
  template: string = THESIS_SOURCE_TEMPLATE_EN,
): ComposedThesis {
  const missing = THESIS_PARTS.filter((p) => thesisPartText(parts[p]) === null);
  if (missing.length > 0) return { complete: false, missing, sentence: null };
  let sentence = template;
  for (const p of THESIS_PARTS) sentence = sentence.split(PLACEHOLDER[p]).join(thesisPartText(parts[p])!);
  return { complete: true, missing: [], sentence };
}
