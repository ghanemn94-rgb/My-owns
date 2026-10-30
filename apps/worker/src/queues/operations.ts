// operations queues (P6; ADR-0053 §2, §3, §6; T-DG6-BE-K2; stub by T-DG6-BE-A), created with the standard bounded retry
// policy and the ops.failed dead-letter queue (queues/index.ts):
//   kpi.freshness_scan           hourly (job_schedule 0117): a KPI whose DG4 freshness became `stale` -> one data.stale
//                                event per stale episode; fresh again -> its `data_stale` exception resolved `recovered`;
//   operations.exception_raise   consumer of data.stale (starter 16 version 2): opens or recurs the KPI's `data_stale`
//                                operational exception, linked to the KPI;
//   operations.exception_alerts  every minute (job_schedule 0117): one alert per OPENED exception (ADR-0053 §6).
// No queue here decides an approval or writes a KPI value.
import type { QueueSpec } from "./spec.ts";

export const OPERATIONS_QUEUES: readonly QueueSpec[] = [
  { name: "kpi.freshness_scan" },
  { name: "operations.exception_raise" },
  { name: "operations.exception_alerts" },
];
export const OPERATIONS_EVENT_QUEUES: Readonly<Record<string, string>> = {
  "data.stale": "operations.exception_raise",
};
