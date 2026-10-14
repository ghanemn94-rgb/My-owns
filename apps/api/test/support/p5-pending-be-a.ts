// P5 operations without a route yet, owned by backend-workflow-engineer task T-DG5-BE-A (slice A: drafts, resolved elements, config pins)
// (docs/architecture/p5-work-split.md §A). Remove an entry in the same change that registers its route and exercises it in
// the contract test. Must be empty when the DG5 candidate freezes. Only the owning task edits this file.
// T-DG5-BE-A routed and exercised all eight (p5-exercises-be-a.ts): listConfigVersions, createConfigDraft,
// getConfigVersion, updateConfigDraft, listConfigElements, discardConfigDraft, listTransformationConfigPins,
// listConfigPinHistory.
export const P5_PENDING_BE_A: readonly string[] = [];
