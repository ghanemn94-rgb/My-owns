// P2 kpi-module operations declared in docs/api/openapi.yaml with no route yet (T-DG2-ARCH-01B). Owned by
// kpi-benefits-engineer: remove an entry in the same change that registers its route in apps/api/src/modules/kpi and
// exercises it in apps/api/test/integration/contract/kpi-exercises.ts. Must be empty when the DG2 candidate freezes.
export const P2_PENDING_KPI_OPERATIONS: readonly string[] = [
  "listKpiDefinitions",
  "createKpiDefinition",
  "getKpiDefinition",
  "updateKpiDefinition",
  "archiveKpiDefinition",
  "listBaselines",
  "createBaseline",
  "getBaseline",
  "updateBaseline",
  "archiveBaseline",
  "listOutcomeKpis",
  "createOutcomeKpi",
  "getOutcomeKpi",
  "updateOutcomeKpi",
  "archiveOutcomeKpi",
  "listValuePools",
  "createValuePool",
  "getValuePool",
  "updateValuePool",
  "archiveValuePool",
  "validateBaseline",
  "validateValuePool",
  "approveOutcomeKpiTrajectory",
];
