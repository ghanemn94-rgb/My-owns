// P6 operations without a route yet, owned by backend-workflow-engineer task T-DG6-BE-I2 (slice C: channel fan-out and deliveries; ADR-0054 §3)
// (docs/architecture/p6-work-split.md §J/C). Remove an entry in the same change that registers its route and exercises it in
// the contract test. Must be empty when the DG6 candidate freezes. Only the owning task edits this file.
// T-DG6-BE-I2: listNotificationDeliveries is routed (admin/notification-channels.ts) and exercised in
// test/integration/contract/p6-exercises-be-i2.ts.
export const P6_PENDING_BE_I2: readonly string[] = [];
