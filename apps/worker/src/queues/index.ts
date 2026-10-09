// Queue registry (ADR-0008; P4 split by T-DG4-BE-A, p4-plan §3 seam 18, p4-work-split §I+C.1): the platform queues
// (platform.ts) plus one file per domain. Each task owns only its domain file; this index already imports every one.
import type PgBoss from "pg-boss";
import { APPROVALS_EVENT_QUEUES, APPROVALS_QUEUES } from "./approvals.ts";
import { ACCESS_EVENT_QUEUES, ACCESS_QUEUES } from "./access.ts";
import { KPI_EVENT_QUEUES, KPI_QUEUES } from "./kpi.ts";
import { BENEFITS_EVENT_QUEUES, BENEFITS_QUEUES } from "./benefits.ts";
import { RAID_EVENT_QUEUES, RAID_QUEUES } from "./raid.ts";
import { MEETINGS_EVENT_QUEUES, MEETINGS_QUEUES } from "./meetings.ts";
import { ESCALATIONS_EVENT_QUEUES, ESCALATIONS_QUEUES } from "./escalations.ts";
import { ADOPTION_EVENT_QUEUES, ADOPTION_QUEUES } from "./adoption.ts";
import { SUSTAINMENT_EVENT_QUEUES, SUSTAINMENT_QUEUES } from "./sustainment.ts";
import { GATES_EVENT_QUEUES, GATES_QUEUES } from "./gates.ts";
import {
  ensurePlatformQueues,
  PLATFORM_EVENT_QUEUES,
  QUEUES,
  RETRY_POLICY,
  type QueuePolicyOverrides,
} from "./platform.ts";
import type { QueueSpec } from "./spec.ts";

export {
  createBoss,
  OUTBOX_RELAY,
  PURGE_CRON,
  QUEUES,
  RETRY_POLICY,
  schedulePurge,
  type QueueName,
  type QueuePolicyOverrides,
} from "./platform.ts";
export type { QueueSpec } from "./spec.ts";

/** Every domain queue (P4 slices). */
export const DOMAIN_QUEUES: readonly QueueSpec[] = [
  ...APPROVALS_QUEUES,
  ...ACCESS_QUEUES,
  ...KPI_QUEUES,
  ...BENEFITS_QUEUES,
  ...RAID_QUEUES,
  ...MEETINGS_QUEUES,
  ...ESCALATIONS_QUEUES,
  ...ADOPTION_QUEUES,
  ...SUSTAINMENT_QUEUES,
  ...GATES_QUEUES,
];

/** Outbox event type -> queue. An event type without a queue is recorded as a relay failure, never dropped. */
export const QUEUE_FOR_EVENT: Readonly<Record<string, string>> = {
  ...PLATFORM_EVENT_QUEUES,
  ...APPROVALS_EVENT_QUEUES,
  ...ACCESS_EVENT_QUEUES,
  ...KPI_EVENT_QUEUES,
  ...BENEFITS_EVENT_QUEUES,
  ...RAID_EVENT_QUEUES,
  ...MEETINGS_EVENT_QUEUES,
  ...ESCALATIONS_EVENT_QUEUES,
  ...ADOPTION_EVENT_QUEUES,
  ...SUSTAINMENT_EVENT_QUEUES,
  ...GATES_EVENT_QUEUES,
};

/** Create or update every queue (platform and domain; idempotent, DML only). */
export async function ensureQueues(boss: PgBoss, overrides: QueuePolicyOverrides = {}): Promise<void> {
  await ensurePlatformQueues(boss, overrides);
  for (const spec of DOMAIN_QUEUES) {
    const opts = {
      policy: "standard" as const,
      retryLimit: overrides.retryLimit ?? spec.retryLimit ?? RETRY_POLICY.retryLimit,
      retryDelay: overrides.retryDelay ?? spec.retryDelaySeconds ?? RETRY_POLICY.retryDelaySeconds,
      retryBackoff: overrides.retryBackoff ?? spec.retryBackoff ?? RETRY_POLICY.retryBackoff,
      deadLetter: QUEUES.failed,
    };
    await boss.createQueue(spec.name, { name: spec.name, ...opts });
    await boss.updateQueue(spec.name, { name: spec.name, ...opts });
  }
}
