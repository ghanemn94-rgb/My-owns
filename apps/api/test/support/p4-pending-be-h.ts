// P4 operations without a route yet, owned by backend-workflow-engineer task BE-H (slice F: T13 stakeholder groups, champions, interventions, involvement and champion constraints)
// (docs/architecture/p4-work-split.md §F+G). Remove an entry in the same change that registers its route and exercises
// it in the contract test. Must be empty when the DG4 candidate freezes. Only the owning task edits this file.
export const P4_PENDING_BE_H: readonly string[] = [
  "listStakeholderGroups",
  "createStakeholderGroup",
  "getStakeholderGroup",
  "updateStakeholderGroup",
  "archiveStakeholderGroup",
  "getAdoptionPlan",
  "listStakeholderChampions",
  "addStakeholderChampion",
  "removeStakeholderChampion",
  "listAdoptionInterventions",
  "createAdoptionIntervention",
  "getAdoptionIntervention",
  "updateAdoptionIntervention",
  "listStakeholderInvolvements",
  "createStakeholderInvolvement",
  "withdrawStakeholderInvolvement",
  "listChampionConstraints",
  "createChampionConstraint",
  "resolveChampionConstraint",
];
