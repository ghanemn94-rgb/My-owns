// P5 operations without a route yet, owned by backend-workflow-engineer task T-DG5-BE-I (slice D: execution history, the failure queue, retry and dismiss, service identity)
// (docs/architecture/p5-work-split.md §D/§E). Remove an entry in the same change that registers its route and exercises it in
// the contract test. Must be empty when the DG5 candidate freezes. Only the owning task edits this file.
export const P5_PENDING_BE_I: readonly string[] = [];
