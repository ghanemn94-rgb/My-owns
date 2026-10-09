// P4 operations without a route yet, owned by kpi-benefits-engineer task KBE-G (slice J: the T10 area engine and RAG, the transformation, executive and workstream dashboards, drill-down and the RAG policy)
// (docs/architecture/p4-work-split.md §J+K). Remove an entry in the same change that registers its route and exercises
// it in the contract test. Must be empty when the DG4 candidate freezes. Only the owning task edits this file.
export const P4_PENDING_KBE_G: readonly string[] = [
  "getExecutiveOverview",
  "getTransformationDashboard",
  "getWorkstreamDashboard",
  "getDashboardDrilldown",
  "getDashboardRagPolicy",
  "putDashboardRagPolicy",
];
