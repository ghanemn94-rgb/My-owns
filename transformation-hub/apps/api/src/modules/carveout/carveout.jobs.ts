import type { INestApplicationContext } from '@nestjs/common';
import { JobRegistry } from '../../platform/jobs/job-registry';
import { JobContextFactory } from '../../platform/jobs/job-context';
import { DbService } from '../../platform/db.service';
import type { ClaimedJob } from '../../platform/jobs/job-queue.service';
import { TransfersService } from './transfers.service';

/**
 * Carve-out commands emit `perimeter.changed` and the gates module's worker job (`gates.recompute_dimensions`) recomputes the
 * status dimensions. Change requests are decided in planning; the approved change is applied by an explicit carve-out command
 * (apply-change), never automatically.
 *
 * DOM-P34R-06: the one handler reacts to `evidence.changed` on transfer evidence (target `transfer`): a verified aspect whose
 * evidence is no longer valid returns to in progress. Explicit allowlist (deny by default): it reads the register and records
 * the `reject_evidence` transition — never a verification, a report or a classification.
 */
export const CARVEOUT_EVIDENCE_SERVICE_PERMISSIONS = ['carveout.register.read', 'carveout.transfer.manage'];
export const TRANSFER_EVIDENCE_JOB = 'carveout.transfer_evidence_changed';

export function registerCarveoutJobs(app: INestApplicationContext): void {
  const registry = app.get(JobRegistry);
  const contexts = app.get(JobContextFactory);
  const db = app.get(DbService);
  const transfers = app.get(TransfersService);
  registry.register(TRANSFER_EVIDENCE_JOB, async (job: ClaimedJob) => {
    const p = (job.payload ?? {}) as { targetType?: string; targetId?: string };
    if (!job.project_id || p.targetType !== 'transfer' || !p.targetId) return { skipped: 'not transfer evidence' };
    const projectId = job.project_id;
    const itemId = p.targetId;
    const ctx = contexts.forService(job, 'svc-carveout', CARVEOUT_EVIDENCE_SERVICE_PERMISSIONS);
    return db.run(ctx, () => transfers.processEvidenceChange(ctx, projectId, itemId));
  });
  registry.subscribe('evidence.changed', TRANSFER_EVIDENCE_JOB);
}
