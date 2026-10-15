// P5 operations without a route yet, owned by kpi-benefits-engineer task T-DG5-KBE-E2 (slice G: restatement decision, recalculation and reissue offers)
// (docs/architecture/p5-work-split.md §G/§H). Remove an entry in the same change that registers its route and exercises it in
// the contract test. Must be empty when the DG5 candidate freezes. Only the owning task edits this file.
// T-DG5-KBE-E2: decideKpiRestatement (kpi/restatement-decisions.ts) and listKpiRestatementReissueOffers
// (kpi/restatement-offers.ts) are routed and exercised in test/integration/contract/p5-exercises-kbe-e2.ts.
export const P5_PENDING_KBE_E2: readonly string[] = [];
