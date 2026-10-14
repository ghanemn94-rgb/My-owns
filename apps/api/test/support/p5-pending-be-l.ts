// P5 operations without a route yet, owned by backend-workflow-engineer task T-DG5-BE-L (slice E: notification preferences, policy, delivery and digests)
// (docs/architecture/p5-work-split.md §D/§E). Remove an entry in the same change that registers its route and exercises it in
// the contract test. Must be empty when the DG5 candidate freezes. Only the owning task edits this file.
export const P5_PENDING_BE_L: readonly string[] = [
  "getMyNotificationPreferences",
  "putMyNotificationPreferences",
  "getMyNotificationDigest",
  "getNotificationPolicy",
  "putNotificationPolicy",
];
