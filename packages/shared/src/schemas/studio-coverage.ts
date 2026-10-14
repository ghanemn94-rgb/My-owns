// zod mirrors of the P5 slice A source coverage and the S12-018 revision proposals (docs/api/openapi.yaml tag `studio`:
// getSourceCoverage, runSourceCoverageCheck, listRevisionProposals; ADR-0039 §6, §8, §12; REQ-S02-001, REQ-S12-018;
// p5-work-split §A.3; T-DG5-BE-B2). The OpenAPI file is the source of truth; the contract test parses every success
// body with these. runSourceCoverageCheck answers with the `configCheckRun` mirror of studio-checks.ts.
// A coverage run or a revision proposal tests and routes configuration; neither grants or records a business approval.
import { z } from "zod";
import { page, timestamp, uuid } from "./common.ts";

// ------------------------------------------------------------------------------------------------ source coverage

/** The ten counted source element sets of REQ-S02-001 (M0083), in the order of the report (ADR-0039 §6). */
export const SOURCE_SET_CODES = [
  "mode",
  "phase",
  "gate",
  "template",
  "tom_dimension",
  "forum",
  "benefit_lifecycle_step",
  "launch_window",
  "roaming_example",
  "health_question",
] as const;
export type SourceSetCode = (typeof SOURCE_SET_CODES)[number];
export const sourceSetCode = z.enum(SOURCE_SET_CODES);

const coverageResult = z.enum(["pass", "warn", "fail"]);
const sha256 = z.string().regex(/^[0-9a-f]{64}$/);

/** One element set of the report (`SourceCoverageSet`). Counts are integers, never decimals (ADR-0039 §12). */
export const sourceCoverageSet = z.strictObject({
  setCode: sourceSetCode,
  expected: z.number().int().min(0),
  present: z.number().int().min(0),
  removed: z.array(z.string()),
  plannedFeatures: z.array(z.string()),
  result: coverageResult,
});
export type SourceCoverageSet = z.infer<typeof sourceCoverageSet>;

/** getSourceCoverage (`SourceCoverageReport`). */
export const sourceCoverageReport = z.strictObject({
  versionId: uuid,
  contentSha256: sha256,
  result: coverageResult,
  sets: z.array(sourceCoverageSet),
});
export type SourceCoverageReport = z.infer<typeof sourceCoverageReport>;

/** getSourceCoverage query (`ConfigVersionIdQuery`): default, the newest published methodology version. */
export const sourceCoverageQuery = z.strictObject({ versionId: uuid.optional() });

/** runSourceCoverageCheck body (`SourceCoverageRunRequest`). */
export const sourceCoverageRunRequest = z.strictObject({ versionId: uuid });
export type SourceCoverageRunRequest = z.infer<typeof sourceCoverageRunRequest>;

// ------------------------------------------------------------------------------------------------ revision proposals

export const REVISION_SUBJECT_TYPES = ["methodology_version", "benefit_formula_version"] as const;
export type RevisionSubjectType = (typeof REVISION_SUBJECT_TYPES)[number];
export const revisionSubjectType = z.enum(REVISION_SUBJECT_TYPES);

/** One S12-018 record (`RevisionProposal`): validation, impact and review routing of a proposed revision. */
export const revisionProposal = z.strictObject({
  id: uuid,
  transformationId: uuid.nullable(),
  subjectType: revisionSubjectType,
  subjectId: uuid,
  subjectVersion: z.number().int().min(1),
  contentSha256: sha256,
  validationResult: z.enum(["pass", "fail"]),
  validationReport: z.record(z.string(), z.unknown()),
  impact: z.record(z.string(), z.unknown()),
  reviewerRoleCode: z.string(),
  reviewTaskCount: z.number().int().min(0),
  createdAt: timestamp,
});
export type RevisionProposal = z.infer<typeof revisionProposal>;
export const revisionProposalPage = page(revisionProposal);

/** listRevisionProposals filters (`RevisionSubjectTypeQuery`, `RevisionSubjectIdQuery`). */
export const revisionProposalListQuery = z.strictObject({
  subjectType: revisionSubjectType.optional(),
  subjectId: uuid.optional(),
});
