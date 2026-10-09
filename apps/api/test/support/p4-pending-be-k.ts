// P4 operations without a route yet, owned by backend-workflow-engineer task BE-K (slice H: G5/G6 evaluators and facts, the G5 scale scope and scale transitions, risk dispositions, gate outbox events and consumers)
// (docs/architecture/p4-work-split.md §H). Remove an entry in the same change that registers its route and exercises
// it in the contract test. Must be empty when the DG4 candidate freezes. Only the owning task edits this file.
export const P4_PENDING_BE_K: readonly string[] = [
  "getScaleScope",
  "listScaleTransitions",
  "createScaleTransition",
  "listRiskDispositions",
  "createRiskDisposition",
  "getRiskDisposition",
];
