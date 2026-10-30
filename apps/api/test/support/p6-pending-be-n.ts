// P6 operations without a route yet, owned by backend task T-DG6-BE-N (slice A: signed webhooks; ADR-0056 §7)
// (docs/architecture/p6-work-split.md §B/A). Remove an entry in the same change that registers its route and exercises it in
// the contract test. Must be empty when the DG6 candidate freezes. Only the owning task edits this file.
// T-DG6-BE-N routed all six (listWebhookEndpoints, createWebhookEndpoint, getWebhookEndpoint, rotateWebhookSecret,
// disableWebhookEndpoint, receiveWebhook) and exercises them in p6-exercises-be-n.ts.
export const P6_PENDING_BE_N: readonly string[] = [];
