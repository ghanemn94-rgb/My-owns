// P4 operations without a route yet, owned by backend-workflow-engineer task BE-K2 (slice H: per-criterion gate reviews and Under Review, gate exceptions, the submission exception lines and the expiry scan)
// (docs/architecture/p4-work-split.md §H). Remove an entry in the same change that registers its route and exercises
// it in the contract test. Must be empty when the DG4 candidate freezes. Only the owning task edits this file.
// T-DG4-BE-K2 routed all nine (workflows/gate-reviews.ts, workflows/gate-exceptions.ts); each is exercised in
// test/integration/contract/p4-exercises-be-k.ts (exerciseP4BeK2Operations).
export const P4_PENDING_BE_K2: readonly string[] = [];
