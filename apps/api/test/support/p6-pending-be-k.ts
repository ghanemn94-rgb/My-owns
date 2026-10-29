// P6 operations without a route yet, owned by backend-workflow-engineer task T-DG6-BE-K (slice J: operational exceptions and heartbeat; ADR-0053 §2, §6)
// (docs/architecture/p6-work-split.md §J/C). Remove an entry in the same change that registers its route and exercises it in
// the contract test. Must be empty when the DG6 candidate freezes. Only the owning task edits this file.
// T-DG6-BE-K routed and exercised all five (listOperationalExceptions, getOperationalException,
// acknowledgeOperationalException, resolveOperationalException, getWorkerHeartbeat; p6-exercises-be-k.ts).
export const P6_PENDING_BE_K: readonly string[] = [];
