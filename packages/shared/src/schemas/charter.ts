// P2 charter mirrors (backend-workflow-engineer; ADR-0017): the current charter (14 source fields B0035, thesis B0037,
// scope sanity checks B0038-B0043), its immutable version snapshots and the computed view. Mirrors docs/api/openapi.yaml
// Charter, CharterVersion, CharterView, CharterWrite, CharterUpdate, ScopeCheckPrecheck.
import { z } from "zod";
import { timestamp, uuid, version } from "./common.ts";
import { northStar, outcome, strategicGuardrail } from "./direction.ts";
import { businessDate } from "./kpi.ts";
import { warning } from "./methodology.ts";

const text = (min: number, max: number) => z.string().min(min).max(max).nullable();
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
  .strictObject({ ...charterFields, changeSummary: z.string().min(1).max(1000) })
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
