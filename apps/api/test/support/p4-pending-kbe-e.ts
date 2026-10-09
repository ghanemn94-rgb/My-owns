// P4 operations without a route yet, owned by kpi-benefits-engineer task KBE-E (slice B: values, measurements, the Finance validation queue and decisions, corrections, baseline validation and totals)
// (docs/architecture/p4-work-split.md §B). Remove an entry in the same change that registers its route and exercises it
// in the contract test. Must be empty when the DG4 candidate freezes. Only this task edits this file.
export const P4_PENDING_KBE_E: readonly string[] = [
  "decideBenefitBaseline",
  "getBenefitValues",
  "createBenefitPlanValue",
  "updateBenefitPlanValue",
  "listBenefitMeasurements",
  "createBenefitMeasurement",
  "getBenefitMeasurement",
  "updateBenefitMeasurement",
  "submitBenefitMeasurement",
  "listFinanceValidationQueue",
  "getFinanceValidation",
  "decideFinanceValidation",
  "amendFinanceValidation",
  "reverseFinanceValidation",
  "getBenefitTotals",
  "getPortfolioBenefitTotals",
];
