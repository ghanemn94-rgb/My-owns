// P6 operations without a route yet, owned by backend task T-DG6-BE-N2 (slice B: guarded outbound writes; ADR-0055 §5)
// (docs/architecture/p6-work-split.md §B/A). Remove an entry in the same change that registers its route and exercises it in
// the contract test. Must be empty when the DG6 candidate freezes. Only the owning task edits this file.
// T-DG6-BE-N2 routed all four (listOutboundWrites, executeOutboundWrite, getOutboundWrite, confirmOutboundWrite) and
// exercises them in p6-exercises-be-n.ts.
export const P6_PENDING_BE_N2: readonly string[] = [];
