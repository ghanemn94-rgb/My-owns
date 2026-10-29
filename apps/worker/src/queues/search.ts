// search queues (P6; ADR-0057 §2; T-DG6-BE-P; stub by T-DG6-BE-A): the two index jobs, created with the standard
// bounded retry policy and the ops.failed dead-letter queue (queues/index.ts). Both are scheduled by their job_schedule
// rows (0115) and consume no outbox event: the audit trail is the feed (ADR-0057 §2).
import type { QueueSpec } from "./spec.ts";

export const SEARCH_QUEUES: readonly QueueSpec[] = [{ name: "search.index_feed" }, { name: "search.reindex" }];
export const SEARCH_EVENT_QUEUES: Readonly<Record<string, string>> = {};
