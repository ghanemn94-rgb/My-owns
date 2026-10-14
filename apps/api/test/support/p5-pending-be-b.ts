// P5 operations without a route yet, owned by backend-workflow-engineer task T-DG5-BE-B (slice A: element edits, invariants, diff, affected records, compatibility, preview)
// (docs/architecture/p5-work-split.md §A). Remove an entry in the same change that registers its route and exercises it in
// the contract test. Must be empty when the DG5 candidate freezes. Only the owning task edits this file.
// T-DG5-BE-B routed all seven: putConfigElement, removeConfigElement, getConfigVersionDiff, getConfigAffectedRecords,
// listConfigCheckRuns, runConfigCompatibilityCheck, runConfigPreview (methodology/elements.ts, methodology/checks.ts).
export const P5_PENDING_BE_B: readonly string[] = [];
