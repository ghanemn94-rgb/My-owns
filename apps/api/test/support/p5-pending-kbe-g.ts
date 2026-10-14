// P5 operations without a route yet, owned by kpi-benefits-engineer task T-DG5-KBE-G (slice H: health-check questions and scoring schemes)
// (docs/architecture/p5-work-split.md §G/§H). Remove an entry in the same change that registers its route and exercises it in
// the contract test. Must be empty when the DG5 candidate freezes. Only the owning task edits this file.
export const P5_PENDING_KBE_G: readonly string[] = [
  "listHealthCheckQuestions",
  "listHealthCheckSchemes",
  "getHealthCheckScheme",
];
