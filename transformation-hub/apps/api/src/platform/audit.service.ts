import { Injectable, Logger } from '@nestjs/common';
import { schema } from '@hub/db';
import { DbService, Tx } from './db.service';
import type { RequestContext } from './context';
import { newId } from './ids';

export interface AuditInput {
  action: string; // e.g. 'governance.decision.submit'
  entityType?: string;
  entityId?: string | null;
  projectId?: string | null;
  reason?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  outcome?: 'success' | 'denied' | 'error' | 'rejected';
}

const SECRET_KEYS = /token|secret|password|csrf|authorization|cookie/i;

/** Remove secrets and oversized blobs before persisting audit before/after images. */
function sanitize(obj: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!obj) return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (SECRET_KEYS.test(k)) {
      out[k] = '[redacted]';
      continue;
    }
    if (typeof v === 'string' && v.length > 4000) out[k] = `${v.slice(0, 4000)}…[truncated]`;
    else if (v instanceof Date) out[k] = v.toISOString();
    else out[k] = v;
  }
  return out;
}

@Injectable()
export class AuditService {
  private readonly log = new Logger('audit');
  constructor(private readonly db: DbService) {}

  /** Record inside the current business transaction (commits or rolls back with it). */
  async record(input: AuditInput): Promise<void> {
    await this.insert(this.db.tx(), this.db.ctx(), input);
  }

  /** Record in an autonomous transaction — used for denied/rejected attempts whose main transaction rolls back. */
  async recordDetached(ctx: RequestContext, input: AuditInput): Promise<void> {
    try {
      await this.db.runDetached(ctx, (tx) => this.insert(tx, ctx, input));
    } catch (e) {
      // Never let audit failure mask the original error, but make it visible in logs.
      this.log.error(`failed to persist detached audit for ${input.action}: ${(e as Error).message}`);
    }
  }

  private async insert(tx: Tx, ctx: RequestContext, input: AuditInput) {
    const projectId = input.projectId ?? null;
    // Only write the project id when it is inside the caller's scope (RLS WITH CHECK would reject otherwise).
    const scopedProjectId = projectId && ctx.projectIds.includes(projectId) ? projectId : null;
    await tx.insert(schema.auditEvent).values({
      id: newId(),
      orgId: ctx.principal.orgId,
      projectId: scopedProjectId,
      actorUserId: ctx.principal.userId,
      actorKind: ctx.principal.kind === 'service' ? 'service' : 'user',
      action: input.action,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      outcome: input.outcome ?? 'success',
      reason: input.reason ?? (projectId && !scopedProjectId ? `out-of-scope project reference` : null),
      before: sanitize(input.before),
      after: sanitize(input.after),
      correlationId: ctx.correlationId,
      ip: ctx.ip,
    });
  }
}
