// P6 operations without a route yet, owned by backend task T-DG6-BE-P (slice H: global search and the index status; ADR-0057 §1-§3)
// (docs/architecture/p6-work-split.md §H/G). Remove an entry in the same change that registers its route and exercises it in
// the contract test. Must be empty when the DG6 candidate freezes. Only the owning task edits this file.
// T-DG6-BE-P2 routed both (searchRecords, getSearchIndexStatus) and exercises them in p6-exercises-be-p.ts.
export const P6_PENDING_BE_P: readonly string[] = [];
