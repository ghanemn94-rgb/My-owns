// The operations the P5 contract adds (docs/api/openapi.yaml 1.4.0-p5 onward), one block per architecture task. Frozen
// per block (solution-architect); each later ARCH task appends its own block. Used to keep the P2-scoped generated sweep
// (aud-write-deny.test.ts) on its P2 scope, as p3-operations.ts and p4-operations.ts do; the P5 slices add their own AUD
// tests once their operations are routed (docs/architecture/p5-work-split.md §2 rule 7).

export const P5_OPERATION_IDS: ReadonlySet<string> = new Set([
  // T-DG5-ARCH-01: slice A (38 operations; ADR-0039, ADR-0040). Spelled out so the set does not shrink as the
  // pending lists empty.
  "listConfigVersions",
  "createConfigDraft",
  "getConfigVersion",
  "updateConfigDraft",
  "listConfigElements",
  "discardConfigDraft",
  "listTransformationConfigPins",
  "listConfigPinHistory",
  "putConfigElement",
  "removeConfigElement",
  "getConfigVersionDiff",
  "getConfigAffectedRecords",
  "listConfigCheckRuns",
  "runConfigCompatibilityCheck",
  "runConfigPreview",
  "listRevisionProposals",
  "getSourceCoverage",
  "runSourceCoverageCheck",
  "submitConfigReview",
  "listConfigReviews",
  "decideConfigReview",
  "withdrawConfigReview",
  "publishConfigVersion",
  "rollbackConfigVersion",
  "listConfigReviewPolicies",
  "updateConfigReviewPolicy",
  "listMethodologyMigrations",
  "createMethodologyMigration",
  "getMethodologyMigration",
  "previewMethodologyMigration",
  "submitMethodologyMigration",
  "decideMethodologyMigration",
  "executeMethodologyMigration",
  "withdrawMethodologyMigration",
  "listGateReapprovals",
  "putScoringDefaultsDraft",
  "getScoringDefaults",
  "getTransformationScoringDefaults",
]);
