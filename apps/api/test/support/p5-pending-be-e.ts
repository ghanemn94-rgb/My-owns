// P5 operations without a route yet, owned by backend-workflow-engineer task T-DG5-BE-E (slice B: version history, comments, attachments)
// (docs/architecture/p5-work-split.md §B/§C). Remove an entry in the same change that registers its route and exercises it in
// the contract test. Must be empty when the DG5 candidate freezes. Only the owning task edits this file.
export const P5_PENDING_BE_E: readonly string[] = [
  "listFormRecordVersions",
  "listFormRecordComments",
  "createFormRecordComment",
  "listFormRecordAttachments",
  "attachFormRecordEvidence",
  "removeFormRecordAttachment",
];
