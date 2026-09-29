import { Inject, Injectable, Logger } from '@nestjs/common';
import { CronExpressionParser } from 'cron-parser';
import { APP_CONFIG, AppConfig } from '../config';
import { DbService } from '../db.service';
import { JobQueue, ClaimedJob } from './job-queue.service';
import { JobRegistry } from './job-registry';

/**
 * Worker loop (runs in `worker.ts`, never in the browser): dispatches outbox events to subscribed job kinds,
 * enqueues due scheduled jobs, and executes jobs with retries/backoff/dead-lettering. Every step is idempotent so
 * multiple workers and restarts are safe (AT-20).
 */
@Injectable()
export class WorkerService {
  private readonly log = new Logger('worker');
  private running = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly db: DbService,
    private readonly queue: JobQueue,
    private readonly registry: JobRegistry,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  start() {
    if (this.running) return;
    this.running = true;
    this.log.log(`worker ${this.config.worker.id} started; handlers: ${this.registry.kinds().join(', ') || '(none)'}`);
    const loop = async () => {
      if (!this.running) return;
      try {
        await this.tick();
      } catch (e) {
        this.log.error(`tick failed: ${(e as Error).message}`);
      }
      if (this.running) this.timer = setTimeout(loop, this.config.worker.pollMs);
    };
    void loop();
  }

  async stop() {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
  }

  /** One full iteration — exposed for tests (deterministic, no timers). */
  async tick(): Promise<{ dispatched: number; scheduled: number; executed: number }> {
    const dispatched = await this.dispatchOutbox();
    const scheduled = await this.enqueueDueSchedules();
    const executed = await this.runJobs();
    return { dispatched, scheduled, executed };
  }

  async dispatchOutbox(limit = 100): Promise<number> {
    const client = await this.db.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query<{ id: string; org_id: string; project_id: string | null; type: string; aggregate_id: string | null; payload: Record<string, unknown> }>(
        `select id, org_id, project_id, type, aggregate_id, payload from outbox_event
          where dispatched_at is null order by created_at limit $1 for update skip locked`,
        [limit],
      );
      for (const ev of rows) {
        for (const kind of this.registry.subscribersOf(ev.type)) {
          await client.query(
            `insert into job (id, org_id, project_id, kind, payload, idempotency_key)
             values (gen_random_uuid(), $1, $2, $3, $4, $5) on conflict (idempotency_key) do nothing`,
            [ev.org_id, ev.project_id, kind, JSON.stringify({ ...ev.payload, eventId: ev.id, eventType: ev.type, aggregateId: ev.aggregate_id }), `outbox:${ev.id}:${kind}`],
          );
        }
        await client.query(`update outbox_event set dispatched_at = now(), attempts = attempts + 1 where id = $1`, [ev.id]);
      }
      await client.query('COMMIT');
      return rows.length;
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }

  async enqueueDueSchedules(): Promise<number> {
    const client = await this.db.pool.connect();
    let n = 0;
    try {
      await client.query('BEGIN');
      const { rows } = await client.query<{ id: string; org_id: string; project_id: string | null; kind: string; cron: string; timezone: string; payload: Record<string, unknown>; next_run_at: Date; owner_user_id: string | null }>(
        `select id, org_id, project_id, kind, cron, timezone, payload, next_run_at, owner_user_id from scheduled_job
          where enabled and next_run_at is not null and next_run_at <= now() for update skip locked`,
      );
      for (const s of rows) {
        const slot = new Date(s.next_run_at).toISOString();
        await client.query(
          `insert into job (id, org_id, project_id, kind, payload, idempotency_key, requested_by)
           values (gen_random_uuid(), $1, $2, $3, $4, $5, $6) on conflict (idempotency_key) do nothing`,
          [s.org_id, s.project_id, s.kind, JSON.stringify({ ...s.payload, scheduledJobId: s.id, slot }), `schedule:${s.id}:${slot}`, s.owner_user_id],
        );
        const next = nextCronRun(s.cron, s.timezone, new Date());
        await client.query(`update scheduled_job set last_run_at = now(), next_run_at = $2, last_status = 'enqueued', updated_at = now() where id = $1`, [s.id, next]);
        n++;
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
    return n;
  }

  async runJobs(limit = 10): Promise<number> {
    const jobs = await this.queue.claim(this.config.worker.id, limit, 120_000);
    for (const job of jobs) await this.execute(job);
    return jobs.length;
  }

  private async execute(job: ClaimedJob) {
    const handler = this.registry.handler(job.kind);
    if (!handler) {
      await this.queue.fail({ ...job, attempts: job.max_attempts }, `no handler registered for ${job.kind}`);
      return;
    }
    try {
      const result = await handler(job);
      await this.queue.complete(job.id, result ?? {});
      if (job.payload['scheduledJobId']) {
        await this.db.pool.query(`update scheduled_job set last_status = 'succeeded', last_error = null where id = $1`, [job.payload['scheduledJobId']]);
      }
    } catch (e) {
      const msg = (e as Error).message ?? String(e);
      this.log.warn(`job ${job.kind} ${job.id} attempt ${job.attempts} failed: ${msg}`);
      await this.queue.fail(job, msg);
      if (job.payload['scheduledJobId']) {
        await this.db.pool.query(`update scheduled_job set last_status = 'failed', last_error = $2 where id = $1`, [job.payload['scheduledJobId'], msg.slice(0, 1000)]);
      }
    }
  }
}

export function nextCronRun(cron: string, timezone: string, from: Date): string {
  const it = CronExpressionParser.parse(cron, { currentDate: from, tz: timezone });
  return it.next().toDate().toISOString();
}
