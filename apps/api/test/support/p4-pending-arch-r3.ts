// The operations T-DG4-ARCH-R3 added to the contract (repair; ADR-0031 amendment S1, ADR-0035 amendment R1 and ADR-0033
// amendment V1 of 2026-10-10) that have no route yet. Remove an entry in the same change that registers its route and
// exercises it in the contract test. Must be empty when the DG4 candidate freezes.
// T-DG4-BE-R4 routed all three: getInitiativeSchedule (portfolio/schedule-network.ts; p4-exercises-be-e.ts),
// listScaleScopeBusinessUnits (workflows/scale.ts; p4-exercises-be-k.ts) and getAssessmentFormVersion
// (adoption/assessments.ts; p4-exercises-be-h.ts).
export const P4_PENDING_ARCH_R3: readonly string[] = [];
