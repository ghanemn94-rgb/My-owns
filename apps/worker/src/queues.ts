// pg-boss setup (ADR-0008). The queue schema itself is installed by `mth-db migrate` (migration 0006, as mth_owner);
// the worker starts pg-boss with migrate=false, so it fails fast unless the expected schema version is installed, and
// it only runs DML as mth_app (queues are non-partitioned rows in pgboss.queue).
import { connectionWithSessionOptions } from "@mth/db";
import PgBoss from "pg-boss";

/** Queue names (pg-boss). Every job carries an idempotency key; handlers are idempotent (ADR-0008). */
export const QUEUES = {
  /** Starter automation for REQ-S12-004 (P1: records the instantiation request; content arrives in P2/P5). */
  transformationCreated: "transformation.created",
  /** Dead-letter / operational failure queue for every other queue. */
  failed: "ops.failed",
  /** Maintenance: purge expired sessions, login states and idempotency records (not a business automation). */
  purge: "maintenance.purge_expired",
} as const;
export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

/** Outbox event type -> queue. An event type without a queue is recorded as a relay failure, never dropped. */
export const QUEUE_FOR_EVENT: Readonly<Record<string, QueueName>> = {
  "transformation.created": QUEUES.transformationCreated,
};

export const OUTBOX_RELAY = {
  pollIntervalMs: 1000,
  batchSize: 50,
  /** After this many failed publish attempts an event stays unpublished (with last_error) for an operator. */
  maxPublishAttempts: 10,
} as const;

/** Bounded retry: 5 attempts starting at 10 s with exponential backoff, then the dead-letter queue (ADR-0008 §4). */
export const RETRY_POLICY = {
  retryLimit: 5,
  retryDelaySeconds: 10,
  retryBackoff: true,
} as const;

/** Maintenance cron: every 15 minutes, evaluated in the configured business time zone (default Asia/Riyadh). */
export const PURGE_CRON = "*/15 * * * *";

/** Days a failed job is kept in pg-boss (execution history for the failure-queue views). */
const FAILED_RETENTION_SECONDS = 60 * 60 * 24 * 30;

export function createBoss(
  databaseUrl: string,
  options: { applicationName?: string; schedule?: boolean; supervise?: boolean } = {},
): PgBoss {
  const { connectionString, options: pgOptions } = connectionWithSessionOptions(databaseUrl, "-c TimeZone=UTC");
  const url = new URL(connectionString);
  if (pgOptions) url.searchParams.set("options", pgOptions);
  return new PgBoss({
    connectionString: url.toString(),
    application_name: options.applicationName ?? "mth-worker",
    migrate: false, // the schema is owned by `mth-db migrate` (ADR-0003); fail fast when it is missing or outdated
    schedule: options.schedule ?? true,
    supervise: options.supervise ?? true,
    max: 5,
  });
}

export interface QueuePolicyOverrides {
  readonly retryLimit?: number;
  readonly retryDelay?: number;
  readonly retryBackoff?: boolean;
}

/** Create or update the P1 queues (idempotent, DML only). */
export async function ensureQueues(boss: PgBoss, overrides: QueuePolicyOverrides = {}): Promise<void> {
  const failed = { name: QUEUES.failed, policy: "standard" as const, retentionSeconds: FAILED_RETENTION_SECONDS };
  const created = {
    name: QUEUES.transformationCreated,
    policy: "standard" as const,
    retryLimit: overrides.retryLimit ?? RETRY_POLICY.retryLimit,
    retryDelay: overrides.retryDelay ?? RETRY_POLICY.retryDelaySeconds,
    retryBackoff: overrides.retryBackoff ?? RETRY_POLICY.retryBackoff,
    deadLetter: QUEUES.failed,
  };
  const purge = {
    name: QUEUES.purge,
    policy: "standard" as const,
    retryLimit: 2,
    retryDelay: 60,
    deadLetter: QUEUES.failed,
  };
  for (const q of [failed, created, purge]) {
    const { name, ...opts } = q;
    await boss.createQueue(name, q);
    await boss.updateQueue(name, { name, ...opts });
  }
}

export async function schedulePurge(boss: PgBoss, timeZone: string): Promise<void> {
  await boss.schedule(QUEUES.purge, PURGE_CRON, {}, { tz: timeZone });
}
