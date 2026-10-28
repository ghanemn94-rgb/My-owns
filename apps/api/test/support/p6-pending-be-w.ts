// P6 operations without a route yet, owned by backend task T-DG6-BE-W (slice I: the branding contrast report;
// ADR-0061 §1, §5) (docs/architecture/p6-work-split.md §I/K). Remove an entry in the same change that registers its
// route and exercises it in the contract test. Must be empty when the DG6 candidate freezes. Only the owning task edits
// this file.
export const P6_PENDING_BE_W: readonly string[] = ["getBrandingVersionContrast"];
