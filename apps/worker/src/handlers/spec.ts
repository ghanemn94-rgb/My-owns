// The shape of a job handler registration (P4, T-DG4-BE-A): worker.ts starts one pg-boss worker per entry. The handler
// receives the job's data and id; its outcome is logged. It must be idempotent through the kit (../kit.ts).
import type { Db } from "@mth/db";

export interface JobHandler {
  readonly queue: string;
  readonly handle: (db: Db, data: unknown, jobId: string) => Promise<unknown>;
}
