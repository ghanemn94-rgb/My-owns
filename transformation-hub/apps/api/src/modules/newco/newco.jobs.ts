import type { INestApplicationContext } from '@nestjs/common';
import { JobRegistry } from '../../platform/jobs/job-registry';
import { JobContextFactory } from '../../platform/jobs/job-context';
import { DbService } from '../../platform/db.service';
import { AuditService } from '../../platform/audit.service';
import { PolicyService } from '../../platform/policy.service';
import { LegalEntitiesService } from './legal-entities.service';

/** Explicit permission allowlist of the NewCo service identity (deny by default — ARCH-09): it only reads the register. */
export const NEWCO_SERVICE_PERMISSIONS = ['newco.register.read'];

/**
 * Allowlist of the incorporation evidence reaction (DOM-P3-08): it only returns a confirmed verification whose evidence is no
 * longer valid to `proposed` (evidence pending) — never a verification, a status or a regulatory entry.
 */
export const NEWCO_EVIDENCE_SERVICE_PERMISSIONS = ['newco.register.read', 'newco.incorporation.manage'];

/** Records, in a LINKED project, a change its owning project made to a shared legal entity (SEC-P1R-03). */
export const LEGAL_ENTITY_CHANGED_JOB = 'newco.legal_entity_changed';

/** Reacts to `evidence.changed` on a legal entity (rejected / superseded / conflicting incorporation evidence). */
export const INCORPORATION_EVIDENCE_JOB = 'newco.incorporation_evidence_changed';

/**
 * Incorporation commands recompute the OWNING project's status dimensions synchronously (gates StatusDimensionsService);
 * approval validity is evaluated on read (`validityState`). A scheduled "approval expiring" notification is not
 * implemented (see the module report).
 *
 * Shared legal entities (SEC-P1R-03): a change made in the owning project emits `legal_entity.changed` once per OTHER
 * linked project. This job writes the trace into that project's activity feed (ids, change kind and version only — no
 * notes, no people, no owning-project id); the gates module subscribes the same event to recompute its status dimensions.
 */
export function registerNewcoJobs(app: INestApplicationContext): void {
  const registry = app.get(JobRegistry);
  const contexts = app.get(JobContextFactory);
  const db = app.get(DbService);
  const audit = app.get(AuditService);
  const policy = app.get(PolicyService);

  registry.register(LEGAL_ENTITY_CHANGED_JOB, async (job) => {
    const projectId = job.project_id;
    const p = job.payload as { legalEntityId?: string; change?: string; versionNo?: number };
    if (!projectId || !p.legalEntityId) return { skipped: 'event without project or entity' };
    const ctx = contexts.forService(job, 'svc-newco', NEWCO_SERVICE_PERMISSIONS);
    return db.run(ctx, async () => {
      policy.assert(ctx, 'newco.register.read', { projectId });
      const linked = await db.query('select 1 from project_entity where project_id = $1 and legal_entity_id = $2 limit 1', [projectId, p.legalEntityId]);
      if (!linked.rowCount) return { skipped: 'entity no longer linked to the project' };
      await audit.record({
        action: 'newco.legal_entity.changed_in_owning_project',
        entityType: 'legal_entity',
        entityId: p.legalEntityId,
        projectId,
        after: { change: typeof p.change === 'string' ? p.change.slice(0, 64) : null, versionNo: typeof p.versionNo === 'number' ? p.versionNo : null },
        reason: 'Changed in the project that owns this shared legal entity (read-only here)',
      });
      return { recorded: 1 };
    });
  });
  registry.subscribe('legal_entity.changed', LEGAL_ENTITY_CHANGED_JOB);

  // DOM-P3-08: the evidence a verified incorporation relied on was rejected / superseded / contested → evidence pending.
  const entities = app.get(LegalEntitiesService);
  registry.register(INCORPORATION_EVIDENCE_JOB, async (job) => {
    const p = (job.payload ?? {}) as { targetType?: string; targetId?: string };
    const projectId = job.project_id;
    if (!projectId || p.targetType !== 'legal_entity' || !p.targetId) return { skipped: 'not a legal entity' };
    const entityId = p.targetId;
    const ctx = contexts.forService(job, 'svc-newco', NEWCO_EVIDENCE_SERVICE_PERMISSIONS);
    return db.run(ctx, () => entities.processEvidenceChange(ctx, projectId, entityId));
  });
  registry.subscribe('evidence.changed', INCORPORATION_EVIDENCE_JOB);
}
