import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Classification } from '@hub/domain';
import { ScopeService } from '../auth/scope.service';
import { DbService } from '../db.service';
import { RequestContext, withDbScope } from '../context';
import type { ClaimedJob } from './job-queue.service';

/**
 * Builds job execution contexts (ARCH-09, AT-19):
 *  - forService(): a narrowly-permissioned service principal for system maintenance (recompute, indexing);
 *  - forUser(): the HUMAN principal on whose behalf output is produced, re-resolved FRESH at execution time.
 *    Returns null when the user is inactive or no longer has access to the project — callers must then skip the
 *    job's user-facing effect (and record why), never fall back to a broader identity.
 */
@Injectable()
export class JobContextFactory {
  constructor(
    private readonly scopes: ScopeService,
    private readonly db: DbService,
  ) {}

  forService(job: Pick<ClaimedJob, 'org_id' | 'project_id' | 'id'>, identity: string, permissions: string[]): RequestContext {
    const principal = this.scopes.servicePrincipal(job.org_id, job.project_id, identity, permissions);
    return withDbScope({ principal, correlationId: `job-${job.id}`, sessionId: null, ip: null, authMethod: 'service', projectIds: [], locale: 'en' });
  }

  async forUser(userId: string, projectId: string | null, correlationId = `job-${randomUUID()}`): Promise<RequestContext | null> {
    const { rows } = await this.db.pool.query<{ id: string; org_id: string; display_name: string; email: string; clearance: Classification; is_active: boolean; is_demo: boolean; locale: string }>(
      `select * from hub_auth_user_by_id($1)`,
      [userId],
    );
    const u = rows[0];
    if (!u || !u.is_active) return null;
    const principal = await this.scopes.resolveUser({ userId: u.id, orgId: u.org_id, displayName: u.display_name, email: u.email, clearance: u.clearance, isDemo: u.is_demo });
    if (projectId && !principal.projects.has(projectId)) return null;
    return withDbScope({ principal, correlationId, sessionId: null, ip: null, authMethod: 'job', projectIds: [], locale: u.locale === 'ar' ? 'ar' : 'en' });
  }
}
