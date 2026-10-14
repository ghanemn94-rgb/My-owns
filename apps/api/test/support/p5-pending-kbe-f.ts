// P5 operations without a route yet, owned by kpi-benefits-engineer task T-DG5-KBE-F (slice G: formula preview and the optional NPV/ROI/payback extension)
// (docs/architecture/p5-work-split.md §G/§H). Remove an entry in the same change that registers its route and exercises it in
// the contract test. Must be empty when the DG5 candidate freezes. Only the owning task edits this file.
export const P5_PENDING_KBE_F: readonly string[] = [
  "previewFormula",
  "getFinancialMetricSettings",
  "putFinancialMetricEnablement",
  "putFinancialMetricAssumptions",
  "getBusinessCaseCashFlows",
  "putBusinessCaseCashFlows",
  "getBusinessCaseFinancialMetrics",
  "listTransformationFinancialMetrics",
];
