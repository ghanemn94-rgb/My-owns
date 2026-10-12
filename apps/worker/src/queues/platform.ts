// Platform queues and pg-boss setup (ADR-0008; moved from src/queues.ts by T-DG4-BE-A, p4-work-split §I+C.1). The queue schema itself is installed by `mth-db migrate` (migration 0006, as mth_owner);
// the worker starts pg-boss with migrate=false, so it fails fast unless the expected schema version is installed, and
// it only runs DML as mth_app (queues are non-partitioned rows in pgboss.queue).
import { SUPERVISE_INTERVAL_SECONDS } from "@mth/config";
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
  /** P4 (ADR-0025 §3): a job schedule changed through the API; the worker re-registers the schedules. */
  jobScheduleUpdated: "job_schedule.updated",
} as const;
export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

/** Outbox event type -> queue. An event type without a queue is recorded as a relay failure, never dropped. */
export const PLATFORM_EVENT_QUEUES: Readonly<Record<string, string>> = {
  "transformation.created": QUEUES.transformationCreated,
  "job_schedule.updated": QUEUES.jobScheduleUpdated,
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

/**
 * The supervision cadence createBoss passes to pg-boss (F-DG4-128, D-131). pg-boss 11.0.0 gives
 * `superviseIntervalSeconds` NO default: unset, Boss.start runs setInterval(onSupervise, NaN), which Node turns into
 * a 1 ms loop (TimeoutNaNWarning) of back-to-back supervision passes. So the value is always explicit: the caller's
 * (the worker passes WORKER_SUPERVISE_INTERVAL_SECONDS from @mth/config; tests shorten it to 1 s) or the documented
 * 60 s. Anything that is not an integer in SUPERVISE_INTERVAL_SECONDS' range (1-600) is refused, never passed on.
 */
export function superviseIntervalSecondsOf(value: number | undefined): number {
  const seconds = value ?? SUPERVISE_INTERVAL_SECONDS.default;
  if (
    !Number.isInteger(seconds) ||
    seconds < SUPERVISE_INTERVAL_SECONDS.min ||
    seconds > SUPERVISE_INTERVAL_SECONDS.max
  ) {
    throw new RangeError(
      `superviseIntervalSeconds must be an integer from ${SUPERVISE_INTERVAL_SECONDS.min} to ${SUPERVISE_INTERVAL_SECONDS.max}`,
    );
  }
  return seconds;
}

export function createBoss(
  databaseUrl: string,
  options: {
    applicationName?: string;
    schedule?: boolean;
    supervise?: boolean;
    /**
     * Supervision cadence in seconds (F-DG4-128): defaults to SUPERVISE_INTERVAL_SECONDS.default (60), never left to
     * pg-boss, which has no default for it. The worker passes its configured value; tests shorten it.
     */
    superviseIntervalSeconds?: number;
    /** Per-queue monitoring cadence; pg-boss's own default (60 s) applies when omitted. Tests shorten it. */
    monitorIntervalSeconds?: number;
  } = {},
): PgBoss {
  const superviseIntervalSeconds = superviseIntervalSecondsOf(options.superviseIntervalSeconds);
  const { connectionString, options: pgOptions } = connectionWithSessionOptions(databaseUrl, "-c TimeZone=UTC");
  const url = new URL(connectionString);
  if (pgOptions) url.searchParams.set("options", pgOptions);
  return new PgBoss({
    connectionString: url.toString(),
    application_name: options.applicationName ?? "mth-worker",
    migrate: false, // the schema is owned by `mth-db migrate` (ADR-0003); fail fast when it is missing or outdated
    schedule: options.schedule ?? true,
    supervise: options.supervise ?? true,
    superviseIntervalSeconds,
    ...(options.monitorIntervalSeconds !== undefined ? { monitorIntervalSeconds: options.monitorIntervalSeconds } : {}),
    max: 5,
  });
}

export interface QueuePolicyOverrides {
  readonly retryLimit?: number;
  readonly retryDelay?: number;
  readonly retryBackoff?: boolean;
}

/** Create or update the platform queues (idempotent, DML only). The domain queues are created by queues/index.ts. */
export async function ensurePlatformQueues(boss: PgBoss, overrides: QueuePolicyOverrides = {}): Promise<void> {
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
  const scheduleSync = {
    name: QUEUES.jobScheduleUpdated,
    policy: "standard" as const,
    retryLimit: overrides.retryLimit ?? RETRY_POLICY.retryLimit,
    retryDelay: overrides.retryDelay ?? RETRY_POLICY.retryDelaySeconds,
    retryBackoff: overrides.retryBackoff ?? RETRY_POLICY.retryBackoff,
    deadLetter: QUEUES.failed,
  };
  for (const q of [failed, created, purge, scheduleSync]) {
    const { name, ...opts } = q;
    await boss.createQueue(name, q);
    await boss.updateQueue(name, { name, ...opts });
  }
}

export async function schedulePurge(boss: PgBoss, timeZone: string): Promise<void> {
  await boss.schedule(QUEUES.purge, PURGE_CRON, {}, { tz: timeZone });
}
