// The shape of a job handler registration (P4, T-DG4-BE-A): worker.ts starts one pg-boss worker per entry. The handler
// receives the job's data, its id and (T-DG4-BE-R2) the attempt pg-boss is on; its outcome is logged. It must be
// idempotent through the kit (../kit.ts).
import type { Db } from "@mth/db";

/**
 * The attempt a pg-boss job is on: `retryCount` retries already made (0 on the first attempt) of `retryLimit`. pg-boss
 * retries a failed job while retry_count < retry_limit, so the attempt with retryCount >= retryLimit is the last one.
 */
export interface JobAttempt {
  readonly retryCount: number;
  readonly retryLimit: number;
}

export interface JobHandler {
  readonly queue: string;
  /** `attempt` is passed by worker.ts from the job's own metadata; a direct call (tests, replays) may omit it. */
  readonly handle: (db: Db, data: unknown, jobId: string, attempt?: JobAttempt) => Promise<unknown>;
}
