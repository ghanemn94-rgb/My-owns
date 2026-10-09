// P4 operations without a route yet, owned by kpi-benefits-engineer task KBE-D (slice B: the benefits register, lifecycle, enablers, allocations and shared-benefit groups)
// (docs/architecture/p4-work-split.md §B). Remove an entry in the same change that registers its route and exercises it
// in the contract test. Must be empty when the DG4 candidate freezes. Only this task edits this file.
export const P4_PENDING_KBE_D: readonly string[] = [
  "listBenefits",
  "createBenefit",
  "getBenefit",
  "updateBenefit",
  "archiveBenefit",
  "getBenefitLifecycle",
  "advanceBenefitLifecycle",
  "listBenefitEnablers",
  "createBenefitEnabler",
  "removeBenefitEnabler",
  "getBenefitAllocations",
  "replaceBenefitAllocations",
  "listBenefitGroups",
  "createBenefitGroup",
  "getBenefitGroup",
  "updateBenefitGroup",
];
