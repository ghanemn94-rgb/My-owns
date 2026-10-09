// P4 operations without a route yet, owned by kpi-benefits-engineer task KBE-B (slice A: KPI dictionary v2, versions, formula inputs, RAG thresholds, target trajectories, data-quality findings)
// (docs/architecture/p4-work-split.md §A). Remove an entry in the same change that registers its route and exercises it
// in the contract test. Must be empty when the DG4 candidate freezes.
// T-DG4-KBE-B routed 18 of the 19. T-DG4-KBE-C routed the last one, requestKpiVersionApproval (carried by D-095), and
// exercises it in p4-exercises-kbe-c.ts.
export const P4_PENDING_KBE_B: readonly string[] = [];
