// integrations queues (P6; ADR-0055 §2, ADR-0053 §1-§3; T-DG6-BE-L2; stub by T-DG6-BE-A), created with the standard
// bounded retry policy and the ops.failed dead-letter queue (queues/index.ts):
//   integrations.connector_run        every minute (job_schedule, migration 0116): creates each enabled connector's due
//                                     cadence slot as a queued run, `schedule:<connector id>:<slot start ISO>`, once;
//   integrations.connector_exception  consumes `connector.run_failed` (open or recur the connector's operational
//                                     exception, lock 730305) and `connector.run_recovered` (resolve it `recovered`).
// The runs themselves execute in the API process (apps/api integrations/runs.ts, the run watch): staging validates rows
// through the import targets the domains register in the API composition, and the worker imports no API code.
import type { QueueSpec } from "./spec.ts";

export const INTEGRATIONS_QUEUES: readonly QueueSpec[] = [
  { name: "integrations.connector_run" },
  { name: "integrations.connector_exception" },
];
export const INTEGRATIONS_EVENT_QUEUES: Readonly<Record<string, string>> = {
  "connector.run_failed": "integrations.connector_exception",
  "connector.run_recovered": "integrations.connector_exception",
};
