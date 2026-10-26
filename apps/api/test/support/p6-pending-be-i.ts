// P6 operations without a route yet, owned by backend-workflow-engineer task T-DG6-BE-I (slice C: notification channels; ADR-0054 §3)
// (docs/architecture/p6-work-split.md §J/C). Remove an entry in the same change that registers its route and exercises it in
// the contract test. Must be empty when the DG6 candidate freezes. Only the owning task edits this file.
export const P6_PENDING_BE_I: readonly string[] = [
  "listNotificationChannels",
  "getNotificationChannel",
  "putNotificationChannel",
  "testNotificationChannel",
];
