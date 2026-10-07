// P3 operations without a route yet, owned by backend-workflow-engineer task BE-A (foundation, G1 extension, readiness, dispensations) (docs/architecture/p3-work-split.md).
// Remove an entry in the same change that registers its route and exercises it in the contract test. Must be empty
// when the DG3 candidate freezes. Only this task edits this file.
// T-DG3-BE-A routed and exercised all six (contract/p3-exercises-be-a.ts): getTransformationReadiness,
// listGateDispensations, createGateDispensation, decideGateDispensation, revokeGateDispensation, getOutcomeHierarchy.
export const P3_PENDING_BE_A: readonly string[] = [];
