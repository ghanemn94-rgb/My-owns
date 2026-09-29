import { Injectable } from '@nestjs/common';
import { schema } from '@hub/db';
import { DbService } from '../db.service';
import { newId } from '../ids';

export interface EnqueueInput {
  kind: string;
  orgId: string;
  projectId: string | null;
  payload: Record<string, unknown>;
  idempotencyKey: string;
  runAt?: Date;
  maxAttempts?: number;
  requestedBy?: string | null;
}

export interface ClaimedJob {
  id: string;
  /** Fencing: the worker that holds the lease (with `attempts` as the token). */
  locked_by: string;
  kind: string;
  org_id: string;
  project_id: string | null;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
  idempotency_key: string;
  requested_by: string | null;
}

/**
 * Durable PostgreSQL job queue (ADR-0004). `job` is an infrastructure table (no RLS); payloads carry ids only.
 * Enqueue inside the business transaction when possible so jobs exist iff the change committed.
 */
@Injectable()
export class JobQueue {
  constructor(private readonly db: DbService) {}

  /** Enqueue in the current transaction (idempotent on key). */
  async enqueue(input: EnqueueInput): Promise<void> {
    await this.db
      .tx()
      .insert(schema.job)
      .values({
        id: newId(),
        orgId: input.orgId,
        projectId: input.projectId,
        kind: input.kind,
        payload: input.payload,
        idempotencyKey: input.idempotencyKey,
        runAt: input.runAt ?? new Date(),
        maxAttempts: input.maxAttempts ?? 5,
        requestedBy: input.requestedBy ?? null,
      })
      .onConflictDoNothing({ target: schema.job.idempotencyKey });
  }

  /** Enqueue outside a request transaction (worker/scheduler) using the pool directly. */
  async enqueueDirect(input: EnqueueInput): Promise<boolean> {
    const r = await this.db.pool.query(
      `insert into job (id, org_id, project_id, kind, payload, idempotency_key, run_at, max_attempts, requested_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict (idempotency_key) do nothing`,
      [newId(), input.orgId, input.projectId, input.kind, JSON.stringify(input.payload), input.idempotencyKey, (input.runAt ?? new Date()).toISOString(), input.maxAttempts ?? 5, input.requestedBy ?? null],
    );
    return (r.rowCount ?? 0) > 0;
  }

  /**
   * Claim up to `limit` due jobs (including expired leases) with SKIP LOCKED. Expired leases of jobs that already
   * used all attempts are dead-lettered instead of re-run (poison jobs — ARCH-08). The returned `attempts` value is
   * the fencing token: complete/fail/extend only succeed while the lease still belongs to this worker+attempt.
   */
  async claim(workerId: string, limit: number, leaseMs: number): Promise<ClaimedJob[]> {
    await this.db.pool.query(
      `update job set status = 'dead', last_error = coalesce(last_error, '') || ' [lease expired after final attempt]',
              locked_by = null, locked_until = null, finished_at = now(), updated_at = now()
        where status = 'running' and locked_until < now() and attempts >= max_attempts`,
    );
    const { rows } = await this.db.pool.query<ClaimedJob>(
      `update job set status = 'running', locked_by = $1, locked_until = now() + ($3::int * interval '1 millisecond'),
              attempts = attempts + 1, updated_at = now()
        where id in (
          select id from job
           where (status = 'queued' and run_at <= now())
              or (status = 'running' and locked_until < now() and attempts < max_attempts)
           order by run_at
           limit $2
           for update skip locked)
        returning id, kind, org_id, project_id, payload, attempts, max_attempts, idempotency_key, requested_by`,
      [workerId, limit, leaseMs],
    );
    return rows.map((r) => ({ ...r, locked_by: workerId }));
  }

  /** Heartbeat for long jobs (report rendering, AI runs): extends the lease only if still owned. */
  async extendLease(job: ClaimedJob, leaseMs: number): Promise<boolean> {
    const r = await this.db.pool.query(
      `update job set locked_until = now() + ($4::int * interval '1 millisecond'), updated_at = now()
        where id = $1 and locked_by = $2 and attempts = $3 and status = 'running'`,
      [job.id, job.locked_by, job.attempts, leaseMs],
    );
    return (r.rowCount ?? 0) > 0;
  }

  /** Fenced completion: a stale worker whose lease was taken over cannot overwrite the new owner's state. */
  async complete(job: ClaimedJob, result: Record<string, unknown>): Promise<boolean> {
    const r = await this.db.pool.query(
      `update job set status = 'succeeded', result = $4, finished_at = now(), locked_by = null, locked_until = null, updated_at = now()
        where id = $1 and locked_by = $2 and attempts = $3 and status = 'running'`,
      [job.id, job.locked_by, job.attempts, JSON.stringify(result)],
    );
    return (r.rowCount ?? 0) > 0;
  }

  /** Exponential backoff with jitter (capped at 15 minutes); dead-letter after max attempts. Fenced. */
  async fail(job: ClaimedJob, error: string, opts: { permanent?: boolean } = {}): Promise<boolean> {
    const dead = opts.permanent || job.attempts >= job.max_attempts;
    const base = Math.min(15 * 60_000, 2 ** job.attempts * 1000);
    const delayMs = Math.round(base * (0.75 + Math.random() * 0.5));
    const r = await this.db.pool.query(
      `update job set status = $4::job_status, last_error = $5, run_at = now() + ($6::int * interval '1 millisecond'),
              locked_by = null, locked_until = null, updated_at = now(), finished_at = case when $4::text = 'dead' then now() else null end
        where id = $1 and locked_by = $2 and attempts = $3 and status = 'running'`,
      [job.id, job.locked_by, job.attempts, dead ? 'dead' : 'queued', error.slice(0, 2000), delayMs],
    );
    return (r.rowCount ?? 0) > 0;
  }

  /** Emergency stop support: cancel queued jobs of a kind for a project. */
  async cancelQueued(projectId: string, kinds: string[]): Promise<number> {
    const r = await this.db.pool.query(
      `update job set status = 'cancelled', finished_at = now(), updated_at = now()
        where project_id = $1 and kind = any($2) and status = 'queued'`,
      [projectId, kinds],
    );
    return r.rowCount ?? 0;
  }
}
