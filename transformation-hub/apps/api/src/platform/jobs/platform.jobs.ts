import type { INestApplicationContext } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import { DbService } from '../db.service';
import { DeliveryService } from '../delivery.service';
import { AuditExportService, AUDIT_EXPORT_KIND } from '../audit-export.service';
import { OrgService } from '../org.service';
import { JobContextFactory } from './job-context';
import { JobRegistry } from './job-registry';
import { nextCronRun } from './worker.service';

/**
 * Platform maintenance schedules (ADR-0004 / ADR-0014). Created idempotently per organization at worker start and by
 * the bootstrap/demo CLIs. Times are evaluated in the organization's operating timezone.
 */
export const PLATFORM_SCHEDULES = [
  // Records the audit hash-chain head so deletion of the chain tail becomes detectable (ARCH-05).
  { kind: 'platform.audit.checkpoint', name: 'Audit hash-chain checkpoint', cron: '*/15 * * * *' },
  // Turns deliveries stuck in `sending` (worker crashed mid-send) into `uncertain` — never auto-resent (AT-20).
  { kind: 'platform.delivery.reconcile', name: 'Reconcile unconfirmed external deliveries', cron: '*/10 * * * *' },
  // Ships the audit chain to the independent log repository when HUB_AUDIT_EXPORT is file / syslog (REQ-DAT-007); the
  // schedule row also holds the export cursor. With the export off the run records "not configured".
  { kind: AUDIT_EXPORT_KIND, name: 'Audit export to the independent log repository', cron: '*/5 * * * *' },
] as const;

export function registerPlatformJobs(app: INestApplicationContext) {
  const registry = app.get(JobRegistry);
  if (registry.handler('platform.audit.checkpoint')) return; // idempotent
  const db = app.get(DbService);
  const contexts = app.get(JobContextFactory);
  const delivery = app.get(DeliveryService);

  registry.register('platform.audit.checkpoint', async (job) => {
    // No business permissions: the service principal only sets the organization context required by the function.
    const ctx = contexts.forService(job, 'svc-platform-audit', []);
    const pos = await db.run(ctx, async () => {
      const r = await db.tx().execute<{ pos: string | number }>(sql`select hub_audit_checkpoint(${job.org_id}) as pos`);
      return Number(r.rows[0]?.pos ?? 0);
    });
    return { chainPos: pos };
  });

  registry.register('platform.delivery.reconcile', async () => ({ markedUncertain: await delivery.reconcileStale(10) }));

  const auditExport = app.get(AuditExportService);
  registry.register(AUDIT_EXPORT_KIND, async (job) => {
    const r = await auditExport.run(job.org_id, (job.payload?.['scheduledJobId'] as string | undefined) ?? null);
    return { ...r };
  });
}

/** Idempotently create the platform schedules for one organization (serialized by an advisory lock). */
export async function ensurePlatformSchedules(pool: Pool, orgId: string, timezone = 'Asia/Riyadh'): Promise<number> {
  const client = await pool.connect();
  let created = 0;
  try {
    await client.query('BEGIN');
    await client.query(`select pg_advisory_xact_lock(hashtextextended('hub_platform_schedules:' || $1, 0))`, [orgId]);
    for (const s of PLATFORM_SCHEDULES) {
      const r = await client.query(
        `insert into scheduled_job (id, org_id, project_id, kind, name, cron, timezone, payload, enabled, next_run_at)
         select gen_random_uuid(), $1::uuid, null, $2::varchar, $3::text, $4::varchar, $5::text, '{}'::jsonb, true, $6::timestamptz
          where not exists (select 1 from scheduled_job where org_id = $1::uuid and project_id is null and kind = $2::varchar)`,
        [orgId, s.kind, s.name, s.cron, timezone, nextCronRun(s.cron, timezone, new Date())],
      );
      created += r.rowCount ?? 0;
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
  return created;
}

/** Worker start-up: make sure the default organization has its maintenance schedules. */
export async function ensureDefaultOrgSchedules(app: INestApplicationContext) {
  const db = app.get(DbService);
  const orgId = await app.get(OrgService).defaultOrgId();
  const n = await ensurePlatformSchedules(db.pool, orgId);
  if (n > 0) new Logger('worker').log(`created ${n} platform maintenance schedule(s)`);
}
