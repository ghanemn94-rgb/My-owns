// P6 operations without a route yet, owned by backend-workflow-engineer task T-DG6-BE-D (slice F: upload allow-list, upload policy and safe preview; ADR-0052 §1, §2)
// (docs/architecture/p6-work-split.md §E/F). Remove an entry in the same change that registers its route and exercises it in
// the contract test. Must be empty when the DG6 candidate freezes. Only the owning task edits this file.
export const P6_PENDING_BE_D: readonly string[] = ["previewEvidenceContent", "getUploadPolicy", "putUploadPolicy"];
