// P4 operations without a route yet, owned by backend-workflow-engineer task BE-K2 (slice H: per-criterion gate reviews and Under Review, gate exceptions, the submission exception lines and the expiry scan)
// (docs/architecture/p4-work-split.md §H). Remove an entry in the same change that registers its route and exercises
// it in the contract test. Must be empty when the DG4 candidate freezes. Only the owning task edits this file.
export const P4_PENDING_BE_K2: readonly string[] = [
  "listGateSubmissionCriteria",
  "listGateCriterionReviews",
  "createGateCriterionReview",
  "listGateExceptions",
  "createGateException",
  "getGateException",
  "decideGateException",
  "withdrawGateException",
  "revokeGateException",
];
