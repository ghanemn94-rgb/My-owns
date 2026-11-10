// The provisional-Arabic label of the texts T-DG6-FE-D2 added outside the `productivity` namespace (the ADR-0057 §9
// stale and conflict states in `common`). JSON catalogues cannot carry comments, so the label lives here as data that
// components/six-states.test.tsx binds to the catalogues. The `productivity.compare`, `productivity.drafts` and
// `productivity.inlineEdit` Arabic is covered by the "productivity." entry of saved-views/provisional-ar.ts. Every one
// of them is PROVISIONAL (written by T-DG6-FE-D2) and awaits a Mobily language review. When a reviewed translation
// replaces a text, remove its entry here in the same change.
export const COMPARE_PROVISIONAL_ARABIC: readonly string[] = [
  "common.state.staleUpdated",
  "common.state.staleUnknown",
  "common.conflict.lead",
];
