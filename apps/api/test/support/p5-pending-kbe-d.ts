// P5 operations without a route yet, owned by kpi-benefits-engineer task T-DG5-KBE-D (slice F: structured owner updates and the executive pack)
// (docs/architecture/p5-work-split.md §F). Remove an entry in the same change that registers its route and exercises it in
// the contract test. Must be empty when the DG5 candidate freezes. Only the owning task edits this file.
export const P5_PENDING_KBE_D: readonly string[] = [
  "listOwnerUpdates",
  "createOwnerUpdate",
  "getOwnerUpdate",
  "updateOwnerUpdate",
  "submitOwnerUpdate",
  "reopenOwnerUpdate",
  "listOwnerUpdateRevisions",
];
