// T-DG7-BE-C (backend-workflow; p7-work-split §C.1): the migration export operations. Remove each entry in the same
// change that routes it and adds its exercise to contract/p7-exercises-be-c.ts. Empty at the DG7 freeze.
export const P7_PENDING_BE_C: readonly string[] = [
  "listMigrationExports",
  "createMigrationExport",
  "getMigrationExport",
  "downloadMigrationExportManifest",
  "downloadMigrationExportAttachmentManifest",
];
