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
 * Allowlist of the evidence reaction (DOM-P3-09): it only returns a signed-off check whose evidence is no longer valid to
 * `in_progress` and flags the GO of the plans it gates — never a sign-off, a waiver or a GO decision.
 */
export const READINESS_EVIDENCE_SERVICE_PERMISSIONS = ['readiness.register.read', 'readiness.check.manage'];

/** Reacts to `evidence.changed` on a readiness check (rejected / superseded / conflicting sign-off evidence). */
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
    if (!job.project_id || p.targetType !== 'readiness_check' || !p.targetId) return { skipped: 'not a readiness check' };
    const projectId = job.project_id;
    const checkId = p.targetId;
    const ctx = contexts.forService(job, 'svc-readiness', READINESS_EVIDENCE_SERVICE_PERMISSIONS);
    return db.run(ctx, () => checks.processEvidenceChange(ctx, projectId, checkId));
  });
  registry.subscribe('evidence.changed', READINESS_EVIDENCE_JOB);
}
