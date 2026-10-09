// P4 operations without a route yet, owned by kpi-benefits-engineer task KBE-F (slice F: the adoption indicator templates, metric links and indicator values)
// (docs/architecture/p4-work-split.md §F+G). Remove an entry in the same change that registers its route and exercises
// it in the contract test. Must be empty when the DG4 candidate freezes. Only the owning task edits this file.
export const P4_PENDING_KBE_F: readonly string[] = [
  "listAdoptionIndicatorTemplates",
  "listAdoptionMetricLinks",
  "createAdoptionMetricLink",
  "removeAdoptionMetricLink",
  "getAdoptionIndicators",
];
