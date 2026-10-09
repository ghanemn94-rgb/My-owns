// P4 operations without a route yet, owned by backend-workflow-engineer task BE-L (slice H: change requests, materiality policy, impact preview and assessments, the change_request approval subject)
// (docs/architecture/p4-work-split.md §H). Remove an entry in the same change that registers its route and exercises
// it in the contract test. Must be empty when the DG4 candidate freezes. Only the owning task edits this file.
export const P4_PENDING_BE_L: readonly string[] = [
  "getChangeControlPolicy",
  "putChangeControlPolicy",
  "listChangeRequests",
  "createChangeRequest",
  "previewChangeImpact",
  "getChangeRequest",
  "updateChangeRequest",
  "submitChangeRequest",
  "withdrawChangeRequest",
  "getChangeRequestImpactPreview",
  "listImpactAssessments",
  "getImpactAssessment",
];
