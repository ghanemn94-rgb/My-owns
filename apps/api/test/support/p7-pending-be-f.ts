// T-DG7-BE-F (backend-workflow; p7-work-split §D.1): the configuration bundle operations. Remove each entry in the same
// change that routes it and adds its exercise to contract/p7-exercises-be-f.ts. Empty at the DG7 freeze.
export const P7_PENDING_BE_F: readonly string[] = [
  "listConfigBundleExports",
  "createConfigBundleExport",
  "getConfigBundleExport",
  "downloadConfigBundleExport",
  "listConfigBundleImports",
  "uploadConfigBundleImport",
  "getConfigBundleImport",
  "validateConfigBundleImport",
  "commitConfigBundleImport",
];
