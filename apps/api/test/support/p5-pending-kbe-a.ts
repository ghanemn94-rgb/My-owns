// P5 operations without a route yet, owned by kpi-benefits-engineer task T-DG5-KBE-A (slice A: T06 default weights and rubric, REQ-PB-093)
// (docs/architecture/p5-work-split.md §A). Remove an entry in the same change that registers its route and exercises it in
// the contract test. Must be empty when the DG5 candidate freezes. Only the owning task edits this file.
export const P5_PENDING_KBE_A: readonly string[] = [
  "putScoringDefaultsDraft",
  "getScoringDefaults",
  "getTransformationScoringDefaults",
];
