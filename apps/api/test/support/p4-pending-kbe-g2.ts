// P4 operations without a route yet, owned by kpi-benefits-engineer task KBE-G2 (slice J: the Finance and adoption dashboards, My Work and the workspace header)
// (docs/architecture/p4-work-split.md §J+K). Remove an entry in the same change that registers its route and exercises
// it in the contract test. Must be empty when the DG4 candidate freezes. Only the owning task edits this file.
export const P4_PENDING_KBE_G2: readonly string[] = [
  "getFinanceDashboard",
  "getAdoptionDashboard",
  "getMyWork",
  "getWorkspaceHeader",
];
