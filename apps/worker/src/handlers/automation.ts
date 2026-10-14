// automation job handlers (P5; ADR-0043 §5; p5-work-split §D.2; T-DG5-BE-H2): the engine's three consumers. Each is
// idempotent by construction (apps/worker/src/automation/engine.ts): UNIQUE (rule version, trigger key) under lock
// 730258, one `done` result per action key, and each effect's own dedupe key. The attempt pg-boss is on is passed
// through, so the last attempt marks a running execution failed (automation.retries_exhausted) before rethrowing.
import { outboxEnvelope } from "@mth/shared/schemas";
import {
  AUTOMATION_EVALUATE_QUEUE,
  AUTOMATION_TICK_DAILY,
  AUTOMATION_TICK_HOURLY,
  evaluateEvent,
  evaluateTick,
} from "../automation/engine.ts";
import { jobFailedV1 } from "@mth/shared/schemas";
import { JOB_FAILED_QUEUE } from "../kit.ts";
import type { JobHandler } from "./spec.ts";

export const AUTOMATION_HANDLERS: readonly JobHandler[] = [
  {
    queue: AUTOMATION_EVALUATE_QUEUE,
    handle: (db, data, jobId, attempt) => evaluateEvent(db, outboxEnvelope.parse(data), jobId, attempt),
  },
  {
    queue: AUTOMATION_TICK_HOURLY,
    handle: (db, _data, jobId, attempt) => evaluateTick(db, AUTOMATION_TICK_HOURLY, jobId, attempt),
  },
  {
    queue: AUTOMATION_TICK_DAILY,
    handle: (db, _data, jobId, attempt) => evaluateTick(db, AUTOMATION_TICK_DAILY, jobId, attempt),
  },
  // T-DG5-BE-I (ADR-0043 §5, §7): the consumer of the internal job.failed event. The failure itself is already in the
  // queue (written with the event, in one transaction); this consumer validates the event and records nothing more.
  // BE-J wraps it as starter 16 (`starter.job_failed`, ADR-0044 §1) to record the starter's execution.
  {
    queue: JOB_FAILED_QUEUE,
    handle: async (_db, data) => {
      jobFailedV1.parse(outboxEnvelope.parse(data).payload);
      return "captured";
    },
  },
];
