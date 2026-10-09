// P4 operations without a route yet, owned by kpi-benefits-engineer task KBE-D2 (slice B: overlap warnings and their Finance resolution, scenarios, valuation methods)
// (docs/architecture/p4-work-split.md §B; owned by KBE-D when the orchestrator does not schedule the KBE-D2 split). Remove
// an entry in the same change that registers its route and exercises it in the contract test. Must be empty when the DG4
// candidate freezes. Only the owning task edits this file.
// T-DG4-KBE-D2 routed all 13 (listBenefitOverlaps … decideBenefitValuationMethod); they are exercised in
// test/integration/contract/p4-exercises-kbe-d2.ts.
export const P4_PENDING_KBE_D2: readonly string[] = [];
