// P4 operations without a route yet, owned by backend-workflow-engineer task BE-M3 (slice K: portfolios and workstreams with their memberships)
// (docs/architecture/p4-work-split.md §J+K). Remove an entry in the same change that registers its route and exercises
// it in the contract test. Must be empty when the DG4 candidate freezes. Only the owning task edits this file.
// T-DG4-BE-M3 routed all 14 operations (portfolio/structure.ts) and exercises them in p4-exercises-be-m.ts.
export const P4_PENDING_BE_M3: readonly string[] = [];
