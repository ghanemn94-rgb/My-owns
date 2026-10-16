// P5 operations without a route yet, owned by backend-workflow-engineer task T-DG5-BE-R2 (slice I: GET /me/navigation and the two text scans)
// (docs/architecture/p5-work-split.md §I/§J). Remove an entry in the same change that registers its route and exercises it in
// the contract test. Must be empty when the DG5 candidate freezes. Only the owning task edits this file.
// T-DG5-BE-R2: getMyNavigation is routed (identity/navigation.ts) and exercised in p5-exercises-be-r2.ts.
export const P5_PENDING_BE_R2: readonly string[] = [];
