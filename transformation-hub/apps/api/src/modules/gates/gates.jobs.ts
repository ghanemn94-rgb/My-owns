import type { INestApplicationContext } from '@nestjs/common';
import type { OutboxEventType } from '@hub/domain';
import { JobRegistry } from '../../platform/jobs/job-registry';
import { JobContextFactory } from '../../platform/jobs/job-context';
import { DbService } from '../../platform/db.service';
import { PolicyService } from '../../platform/policy.service';
import type { ClaimedJob } from '../../platform/jobs/job-queue.service';
import { GatesService, RECOMPUTE_DIMENSIONS_JOB, EVIDENCE_CONFLICTS_JOB } from './gates.service';
import { StatusDimensionsService } from './status-dimensions.service';

/**
 * Explicit permission allowlist of the gates service identity (deny by default — ARCH-09). The jobs only read registers
 * and maintain derived gate state (evaluation caches, conflict flags, status dimensions); nothing user-facing is sent.
 */
export const GATES_SERVICE_PERMISSIONS = ['gates.gate.read', 'portfolio.project.read', 'carveout.register.read', 'readiness.register.read', 'governance.decision.read'];

/** Events that can move a status dimension (module guide §2 "Status dimensions"). */
export const DIMENSION_EVENTS: OutboxEventType[] = ['perimeter.changed', 'evidence.changed', 'cp.changed', 'tsa.expiring', 'decision.status_changed', 'document.changed'];

/** Register this module's job handlers and outbox subscriptions (called by src/jobs.ts in the worker). */
export function registerGatesJobs(app: INestApplicationContext): void {
  const registry = app.get(JobRegistry);
  const contexts = app.get(JobContextFactory);
  const db = app.get(DbService);
  const policy = app.get(PolicyService);
  const gates = app.get(GatesService);
  const dims = app.get(StatusDimensionsService);

  const inProject = async <T>(job: ClaimedJob, fn: (projectId: string) => Promise<T>): Promise<T | { skipped: string }> => {
    if (!job.project_id) return { skipped: 'event without project' };
    const projectId = job.project_id;
    const ctx = contexts.forService(job, 'svc-gates', GATES_SERVICE_PERMISSIONS);
    return db.run(ctx, async () => {
      policy.assert(ctx, 'gates.gate.read', { projectId });
      return fn(projectId);
    });
  };

  // AT-14: conflicting evidence on a gate criterion → mark conflicting / flag decided gates for controlled reopen.
  registry.register(EVIDENCE_CONFLICTS_JOB, async (job) => inProject(job, (pid) => gates.processEvidenceConflicts(pid)));
  registry.subscribe('evidence.changed', EVIDENCE_CONFLICTS_JOB);

  // Status dimensions (REQ-LCY-006): recompute from registers whenever an input may have changed.
  registry.register(RECOMPUTE_DIMENSIONS_JOB, async (job) => inProject(job, (pid) => dims.recomputeDimensions(pid)));
  for (const e of DIMENSION_EVENTS) registry.subscribe(e, RECOMPUTE_DIMENSIONS_JOB);
}
