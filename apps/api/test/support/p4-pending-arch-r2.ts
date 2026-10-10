// The operations T-DG4-ARCH-R2 added to the contract (repair; ADR-0038 amendment B3 and ADR-0030 amendment P1 of
// 2026-10-10) that have no route yet. Remove an entry in the same change that registers its route and exercises it in
// the contract test. Must be empty when the DG4 candidate freezes.
// - getInheritedRecord: BE-R3 (reporting/modular.ts; the target of createInheritedRecord's Location).
// getBenefitPlanValue is routed by T-DG4-KBE-R3 (benefits/values.ts) and exercised in p4-exercises-kbe-e.ts.
export const P4_PENDING_ARCH_R2: readonly string[] = ["getInheritedRecord"];
