// P4 operations without a route yet, owned by kpi-benefits-engineer task KBE-B (slice A: KPI dictionary v2, versions, formula inputs, RAG thresholds, target trajectories, data-quality findings)
// (docs/architecture/p4-work-split.md §A). Remove an entry in the same change that registers its route and exercises it
// in the contract test. Must be empty when the DG4 candidate freezes. Only this task edits this file.
export const P4_PENDING_KBE_B: readonly string[] = [
  "listKpiDictionary",
  "getKpiDictionaryEntry",
  "listKpiVersions",
  "createKpiVersion",
  "getKpiVersion",
  "updateKpiVersion",
  "activateKpiVersion",
  "withdrawKpiVersion",
  "requestKpiVersionApproval",
  "listKpiRagThresholds",
  "createKpiRagThreshold",
  "listTargetTrajectories",
  "createTargetTrajectory",
  "getTargetTrajectory",
  "approveTargetTrajectory",
  "withdrawTargetTrajectory",
  "listDataQualityFindings",
  "getDataQualityFinding",
  "resolveDataQualityFinding",
];
