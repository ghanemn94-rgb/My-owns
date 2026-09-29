import type { INestApplicationContext } from '@nestjs/common';
import { JobRegistry } from '../../platform/jobs/job-registry';
import { JobContextFactory } from '../../platform/jobs/job-context';
import { DbService } from '../../platform/db.service';
import type { ClaimedJob } from '../../platform/jobs/job-queue.service';
import { AiRuntimeService, AI_RUN_JOB } from './ai-runtime.service';
import { AiProposalsService, AI_EXECUTE_JOB } from './ai-proposals.service';
import { AiArtifactsService } from './ai-artifacts.service';
import { AI_BRIEFING_JOB } from './ai-settings.service';

export const AI_INVALIDATE_JOB = 'ai.invalidate_derived';

/**
 * Worker registration (ADR-0004): queued asks, scheduled briefings, proposal execution, and invalidation of derived
 * artefacts on permission/document/evidence changes. Handlers receive ids only and open their own contexts.
 */
export function registerAiJobs(app: INestApplicationContext): void {
  const registry = app.get(JobRegistry);
  if (registry.handler(AI_RUN_JOB)) return; // idempotent (tests may register more than once)
  const runtime = app.get(AiRuntimeService);
  const proposals = app.get(AiProposalsService);
  const artifacts = app.get(AiArtifactsService);
  const contexts = app.get(JobContextFactory);
  const db = app.get(DbService);

  registry.register(AI_RUN_JOB, (job) => runtime.runAsyncJob(job));
  registry.register(AI_BRIEFING_JOB, (job) => runtime.runBriefingJob(job));
  registry.register(AI_EXECUTE_JOB, (job) => proposals.executeJob(job));
  registry.register(AI_INVALIDATE_JOB, async (job: ClaimedJob) => {
    if (!job.project_id) return { skipped: 'no project' };
    // Maintenance identity: writes only the AI module's own derived-artefact table; no domain permissions needed.
    const ctx = contexts.forService(job, 'svc-ai-pm', []);
    // The dispatcher forwards eventId/eventType/aggregateId; the aggregate TYPE is read from the (RLS-exempt) event row.
    let aggregateType = (job.payload['aggregateType'] as string | undefined) ?? null;
    if (!aggregateType && typeof job.payload['eventId'] === 'string') {
      const ev = await db.query<{ aggregate_type: string | null }>(`select aggregate_type from outbox_event where id = $1`, [job.payload['eventId']]);
      aggregateType = ev.rows[0]?.aggregate_type ?? null;
    }
    const n = await db.run(ctx, () =>
      artifacts.invalidateForEvent(job.project_id!, String(job.payload['eventType'] ?? ''), aggregateType, (job.payload['aggregateId'] as string | undefined) ?? null, job.payload),
    );
    return { invalidated: n };
  });
  registry.subscribe('permission.changed', AI_INVALIDATE_JOB);
  registry.subscribe('document.changed', AI_INVALIDATE_JOB);
  registry.subscribe('evidence.changed', AI_INVALIDATE_JOB);
}
