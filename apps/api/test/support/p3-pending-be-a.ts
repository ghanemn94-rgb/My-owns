// P3 operations without a route yet, owned by backend-workflow-engineer task BE-A (foundation, G1 extension, readiness, dispensations) (docs/architecture/p3-work-split.md).
// Remove an entry in the same change that registers its route and exercises it in the contract test. Must be empty
// when the DG3 candidate freezes. Only this task edits this file.
export const P3_PENDING_BE_A: readonly string[] = [
  "getTransformationReadiness",
  "listGateDispensations",
  "createGateDispensation",
  "decideGateDispensation",
  "revokeGateDispensation",
  "getOutcomeHierarchy",
];
