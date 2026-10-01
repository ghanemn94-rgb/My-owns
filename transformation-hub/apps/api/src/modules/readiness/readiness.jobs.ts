import type { INestApplicationContext } from '@nestjs/common';
import { JobRegistry } from '../../platform/jobs/job-registry';
import { JobContextFactory } from '../../platform/jobs/job-context';
import { DbService } from '../../platform/db.service';
import type { ClaimedJob } from '../../platform/jobs/job-queue.service';
import { TsaService, TSA_EXPIRY_JOB } from './tsa.service';
import { ReadinessChecksService } from './checks.service';

/**
 * Explicit permission allowlist of the readiness service identity (deny by default — ARCH-09). The expiry scan reads the
 * TSA register and records the expired-unresolved state + escalation; it never exits, extends or notifies externally.
 */
export const READINESS_SERVICE_PERMISSIONS = ['readiness.register.read', 'readiness.tsa.manage'];

/**
 * Allowlist of the evidence reaction (DOM-P3-09, DOM-P34R-06): it only returns a signed-off check whose evidence is no longer
 * valid to `in_progress` and flags the GO of the plans it gates, and withdraws a TSA replacement acceptance whose evidence is
 * no longer valid — never a sign-off, a waiver, a GO decision, an acceptance or an exit approval.
 */
export const READINESS_EVIDENCE_SERVICE_PERMISSIONS = ['readiness.register.read', 'readiness.check.manage', 'readiness.tsa.manage'];

/** Reacts to `evidence.changed` on a readiness check or a TSA (rejected / superseded / conflicting evidence). */
export const READINESS_EVIDENCE_JOB = 'readiness.check_evidence_changed';

/** Register this module's job handlers (called by src/jobs.ts in the worker). */
export function registerReadinessJobs(app: INestApplicationContext): void {
  const registry = app.get(JobRegistry);
  const contexts = app.get(JobContextFactory);
  const db = app.get(DbService);
  const tsa = app.get(TsaService);
  const checks = app.get(ReadinessChecksService);

  // AT-10 / REQ-TSA-003: daily per-project schedule (created with the project's first TSA). Idempotent: outbox events are
  // deduplicated per TSA / end date / kind and the expired-unresolved transition happens once.
  registry.register(TSA_EXPIRY_JOB, async (job: ClaimedJob) => {
    if (!job.project_id) return { skipped: 'schedule without project' };
    const projectId = job.project_id;
    const ctx = contexts.forService(job, 'svc-readiness', READINESS_SERVICE_PERMISSIONS);
    return db.run(ctx, () => tsa.scanExpiry(ctx, projectId));
  });

  // DOM-P3-09: the evidence a Day-1 sign-off relied on was rejected / superseded / contested → controlled reopen.
  registry.register(READINESS_EVIDENCE_JOB, async (job: ClaimedJob) => {
    const p = (job.payload ?? {}) as { targetType?: string; targetId?: string };
    if (!job.project_id || !p.targetId || (p.targetType !== 'readiness_check' && p.targetType !== 'tsa_service')) return { skipped: 'not a readiness check or TSA' };
    const projectId = job.project_id;
    const targetId = p.targetId;
    const ctx = contexts.forService(job, 'svc-readiness', READINESS_EVIDENCE_SERVICE_PERMISSIONS);
    if (p.targetType === 'tsa_service') return db.run(ctx, () => tsa.processEvidenceChange(ctx, projectId, targetId));
    return db.run(ctx, () => checks.processEvidenceChange(ctx, projectId, targetId));
  });
  registry.subscribe('evidence.changed', READINESS_EVIDENCE_JOB);
}
