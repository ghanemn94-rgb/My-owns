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
];
