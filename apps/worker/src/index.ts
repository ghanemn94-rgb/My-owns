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
  type QueueName,
  type QueuePolicyOverrides,
} from "./queues.ts";
export { relayOnce, txExecutor, type RelayResult } from "./relay.ts";
export {
  handleTransformationCreated,
  purgeExpired,
  STARTER_AUTOMATION_CONSUMER,
  type HandlerOutcome,
  type PurgeResult,
} from "./handlers.ts";
export { startWorker, type RunningWorker, type WorkerOptions } from "./worker.ts";
