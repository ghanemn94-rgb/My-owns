// P4 operations without a route yet, owned by backend-workflow-engineer task BE-J (slice G: the status model, transition decisions and the governed closure)
// (docs/architecture/p4-work-split.md §F+G). Remove an entry in the same change that registers its route and exercises
// it in the contract test. Must be empty when the DG4 candidate freezes. Only the owning task edits this file.
export const P4_PENDING_BE_J: readonly string[] = [
  "completeInitiativeDelivery",
  "setInitiativeAdoptionStatus",
  "getInitiativeStatusModel",
  "closeInitiative",
  "getTransformationStatusModel",
  "closeTransformation",
  "listClosureRecords",
  "listTransitionDecisions",
  "createTransitionDecision",
  "getTransitionDecision",
  "updateTransitionDecision",
  "submitTransitionDecision",
];
