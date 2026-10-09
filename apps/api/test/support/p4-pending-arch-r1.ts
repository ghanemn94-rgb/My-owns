// The operations T-DG4-ARCH-R1 added to the contract (repair; ADR-0027 and ADR-0033 amendments of 2026-10-09) that have
// no route yet. Both belong to the kpi-benefits-engineer repair task the orchestrator schedules after ARCH-R1. Remove an
// entry in the same change that registers its route and exercises it in the contract test. Must be empty when the DG4
// candidate freezes.
export const P4_PENDING_ARCH_R1: readonly string[] = [
  // ADR-0027 amendment: reporting periods of the transformation's organization for transformation.read holders.
  "listTransformationReportingPeriods",
  // ADR-0033 amendment: the single-link read that createAdoptionMetricLink's Location points to.
  "getAdoptionMetricLink",
];
