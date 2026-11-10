// P6 operations without a route yet, owned by backend task T-DG6-BE-Q (slice H: saved views; ADR-0057 §4)
// (docs/architecture/p6-work-split.md §H/G). Remove an entry in the same change that registers its route and exercises it in
// the contract test. Must be empty when the DG6 candidate freezes. Only the owning task edits this file.
// T-DG6-BE-Q routed and exercised all six (listSavedViews, createSavedView, getSavedView, putSavedView,
// deleteSavedView, shareSavedView; test/integration/contract/p6-exercises-be-q.ts).
export const P6_PENDING_BE_Q: readonly string[] = [];
