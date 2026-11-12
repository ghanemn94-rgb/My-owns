// T-DG7-BE-G (backend-workflow; p7-work-split §E.1): the retention and backup-status operations. Remove each entry in
// the same change that routes it and adds its exercise to contract/p7-exercises-be-g.ts. Empty at the DG7 freeze.
export const P7_PENDING_BE_G: readonly string[] = [
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
];
