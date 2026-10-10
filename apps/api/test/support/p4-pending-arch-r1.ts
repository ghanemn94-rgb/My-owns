// The operations T-DG4-ARCH-R1 added to the contract (repair; ADR-0027 and ADR-0033 amendments of 2026-10-09) that have
// no route yet. Remove an entry in the same change that registers its route and exercises it in the contract test. Must
// be empty when the DG4 candidate freezes.
// T-DG4-KBE-R2 routed both: listTransformationReportingPeriods (kpi/reporting-periods.ts; exercised in
// p4-exercises-kbe-c.ts) and getAdoptionMetricLink (adoption/indicators.ts; exercised in p4-exercises-kbe-f.ts).
export const P4_PENDING_ARCH_R1: readonly string[] = [];
