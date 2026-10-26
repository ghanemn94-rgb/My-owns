// P6 operations without a route yet, owned by backend task T-DG6-BE-M2 (slice A: import routes and templates; ADR-0056 §2-§6, §9)
// (docs/architecture/p6-work-split.md §B/A). Remove an entry in the same change that registers its route and exercises it in
// the contract test. Must be empty when the DG6 candidate freezes. Only the owning task edits this file.
export const P6_PENDING_BE_M2: readonly string[] = [
  "listImports",
  "createImport",
  "getImport",
  "listImportRows",
  "commitImport",
  "cancelImport",
  "listImportTemplates",
  "downloadImportTemplate",
];
