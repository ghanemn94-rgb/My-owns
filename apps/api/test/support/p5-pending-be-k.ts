// P5 operations without a route yet, owned by backend-workflow-engineer task T-DG5-BE-K (slice E: sequential/parallel approval routes, conditional approval and condition escalation)
// (docs/architecture/p5-work-split.md §D/§E). Remove an entry in the same change that registers its route and exercises it in
// the contract test. Must be empty when the DG5 candidate freezes. Only the owning task edits this file.
// T-DG5-BE-K routed and exercised all five (p5-exercises-be-k.ts): listApprovalRoutes, getApprovalRoute,
// decideApprovalRouteStep, listGateConditions, closeGateCondition.
export const P5_PENDING_BE_K: readonly string[] = [];
