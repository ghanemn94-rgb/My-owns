// The operations the P7 contract adds (docs/api/openapi.yaml 1.6.0-p7 onward), one block per architecture task. Frozen
// per block (solution-architect); each later ARCH task appends its own block. Used to keep the P2-scoped generated sweeps
// (aud-write-deny.test.ts, kpi-aud-write-deny.test.ts) on their P2 scope, as p3- to p6-operations.ts do; the P7 slices
// add their own AUD tests once their operations are routed (docs/architecture/p7-work-split.md §C, §D).

export const P7_OPERATION_IDS: ReadonlySet<string> = new Set([
  // T-DG7-ARCH-02: slices C and D (19 operations; ADR-0064, ADR-0065). Spelled out so the set does not shrink as the
  // pending lists empty.
  "listMigrationExports",
  "createMigrationExport",
  "getMigrationExport",
  "downloadMigrationExportManifest",
  "downloadMigrationExportAttachmentManifest",
  "listMigrationImports",
  "getMigrationImport",
  "listMigrationReconciliations",
  "getMigrationReconciliation",
  "listIdentityRebinds",
  "listConfigBundleExports",
  "createConfigBundleExport",
  "getConfigBundleExport",
  "downloadConfigBundleExport",
  "listConfigBundleImports",
  "uploadConfigBundleImport",
  "getConfigBundleImport",
  "validateConfigBundleImport",
  "commitConfigBundleImport",
  // T-DG7-ARCH-03: slice E (10 operations; ADR-0066, ADR-0067).
  "listRetentionClasses",
  "getRetentionClass",
  "updateRetentionClass",
  "listRetentionRuns",
  "createRetentionRun",
  "createRetentionDryRun",
  "getRetentionRun",
  "listRetentionRunActions",
  "listRetentionArchivedRecords",
  "listBackupSets",
  // T-DG7-ARCH-04: slices B and F (1 operation; ADR-0069). The /readyz change adds no operation.
  "getDeploymentStatus",
  // T-DG7-ARCH-05: slices I and H (3 operations; ADR-0071). Slice H (ADR-0072) adds no operation.
  "listRequirements",
  "getRequirement",
  "getReleaseAbout",
]);
