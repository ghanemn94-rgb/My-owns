// The operations T-DG4-ARCH-R3 added to the contract (repair; ADR-0031 amendment S1, ADR-0035 amendment R1 and ADR-0033
// amendment V1 of 2026-10-10) that have no route yet. Remove an entry in the same change that registers its route and
// exercises it in the contract test. Must be empty when the DG4 candidate freezes.
export const P4_PENDING_ARCH_R3: readonly string[] = [
  // ADR-0031 amendment S1: the initiative schedule read (the If-Match source of updateInitiativeSchedule).
  "getInitiativeSchedule",
  // ADR-0035 amendment R1: the business units a G5 scale scope may name, readable by the transformation's readers.
  "listScaleScopeBusinessUnits",
  // ADR-0033 amendment V1: one question version of an assessment form (the version a record was answered on).
  "getAssessmentFormVersion",
];
