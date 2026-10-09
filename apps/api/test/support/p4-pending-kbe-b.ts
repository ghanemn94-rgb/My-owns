// P4 operations without a route yet, owned by kpi-benefits-engineer task KBE-B (slice A: KPI dictionary v2, versions, formula inputs, RAG thresholds, target trajectories, data-quality findings)
// (docs/architecture/p4-work-split.md §A). Remove an entry in the same change that registers its route and exercises it
// in the contract test. Must be empty when the DG4 candidate freezes. Only this task edits this file.
// T-DG4-KBE-B routed 18 of the 19. requestKpiVersionApproval stays pending: it requests a kpi_version_activation
// approval through BE-B's approval service (workflows/approvals.ts, ADR-0026 §4; S-14), which is not merged in the
// KBE-B tree (see docs/delivery/handbacks/DG4/T-DG4-KBE-B-kpi-benefits-engineer.md, "What remains").
export const P4_PENDING_KBE_B: readonly string[] = ["requestKpiVersionApproval"];
