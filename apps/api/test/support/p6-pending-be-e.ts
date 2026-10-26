// P6 operations without a route yet, owned by backend-workflow-engineer task T-DG6-BE-E (slice F: rate-limit matrix and the global audit API; ADR-0052 §4, §8)
// (docs/architecture/p6-work-split.md §E/F). Remove an entry in the same change that registers its route and exercises it in
// the contract test. Must be empty when the DG6 candidate freezes. Only the owning task edits this file.
// T-DG6-BE-E routed and exercised all three (getSecurityRateLimits, listAuditEvents, getAuditEvent).
export const P6_PENDING_BE_E: readonly string[] = [];
