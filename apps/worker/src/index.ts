// @mth/worker skeleton (T-DG1-ARCH-01). backend-workflow-engineer implements the outbox relay and pg-boss
// handlers per ADR-0008. The worker is a separate OS process from the API and shares only the database.

/** Queue names (pg-boss). Every job carries an idempotency key; handlers are idempotent (ADR-0008). */
export const QUEUES = {
  /** Starter automation for REQ-S12-004 (P1: records instantiation request; content arrives in P2/P5). */
  transformationCreated: "transformation.created",
  /** Dead-letter / operational failure queue for every other queue. */
  failed: "ops.failed",
} as const;
export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export const OUTBOX_RELAY = {
  pollIntervalMs: 1000,
  batchSize: 50,
} as const;

export const RETRY_POLICY = {
  retryLimit: 5,
  retryDelaySeconds: 10,
  retryBackoff: true,
} as const;
