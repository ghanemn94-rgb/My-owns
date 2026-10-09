// P4 operations without a route yet, owned by backend-workflow-engineer task BE-M (slice K: trace links, allocation sets and contribution shares, the traceability view, the orphan report and downstream impact)
// (docs/architecture/p4-work-split.md §J+K). Remove an entry in the same change that registers its route and exercises
// it in the contract test. Must be empty when the DG4 candidate freezes. Only the owning task edits this file.
// T-DG4-BE-M routed all 10 (reporting/traceability.ts, orphans.ts, impact.ts; portfolio/links.ts).
export const P4_PENDING_BE_M: readonly string[] = [];
