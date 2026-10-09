// @mth/worker public surface (ADR-0008). The process entry point is ./main.ts (`node dist/main.js`); importing this
// module never starts the worker. The worker is a separate OS process from the API and shares only the database.
export {
  createBoss,
  ensureQueues,
  OUTBOX_RELAY,
  PURGE_CRON,
  QUEUE_FOR_EVENT,
  QUEUES,
  RETRY_POLICY,
  schedulePurge,
  DOMAIN_QUEUES,
  type QueueName,
  type QueuePolicyOverrides,
  type QueueSpec,
} from "./queues/index.ts";
export { relayOnce, txExecutor, type RelayResult } from "./relay.ts";
export {
  handleTransformationCreated,
  purgeExpired,
  STARTER_AUTOMATION_CONSUMER,
  type HandlerOutcome,
  type PurgeResult,
  DOMAIN_HANDLERS,
  type JobHandler,
} from "./handlers/index.ts";
// P4 scheduled-job kit and schedule registration (ADR-0025 §3; T-DG4-BE-A).
export {
  createWorkItemOnce,
  jobActor,
  runOnce,
  type RunOnceResult,
  type WorkItemInput,
  type WorkItemOnceResult,
} from "./kit.ts";
export { handleJobScheduleUpdated, syncSchedules, type ScheduleSyncResult } from "./schedules.ts";
export { startWorker, type RunningWorker, type WorkerOptions } from "./worker.ts";
