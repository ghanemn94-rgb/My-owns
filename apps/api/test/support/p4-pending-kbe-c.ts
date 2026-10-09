// P4 operations without a route yet, owned by kpi-benefits-engineer task KBE-C (slice A: reporting periods, actuals, the accept pipeline, calculation runs, KPI status, RAG overrides)
// (docs/architecture/p4-work-split.md §A). Remove an entry in the same change that registers its route and exercises it
// in the contract test. Must be empty when the DG4 candidate freezes. Only this task edits this file.
// T-DG4-KBE-C routed all 20, and exercises each in p4-exercises-kbe-c.ts.
export const P4_PENDING_KBE_C: readonly string[] = [];
