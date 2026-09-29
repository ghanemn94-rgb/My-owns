import { Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { schema } from '@hub/db';
import { forbidden, invalid, linkedDecisionIssue, notFound, Classification, LinkedDecision, RoleKey } from '@hub/domain';
import { DbService } from '../../platform/db.service';
import { PolicyService } from '../../platform/policy.service';
import { AuditService } from '../../platform/audit.service';
import { OutboxService } from '../../platform/outbox.service';
import { Clock } from '../../platform/clock';
import { JobQueue } from '../../platform/jobs/job-queue.service';
import { RecordVersionService, activeEvidenceCount, loadInProject } from '../../platform/helpers';
import type { RequestContext } from '../../platform/context';
import { RECOMPUTE_DIMENSIONS_JOB } from '../gates/gates.service';

export type ProjectRow = typeof schema.project.$inferSelect;
export type DecisionRow = typeof schema.decision.$inferSelect;

export const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

/** Roles that are room-scoped only (clean team / external partner): never accountable for readiness or TSA records. */
const ROOM_ONLY_ROLES = ['clean_team', 'external_partner_limited'];

/**
 * Shared plumbing of the readiness module (Day-1 checks, cutover/go-no-go, TSA). Every command: load in project (404) →
 * policy (RBAC + ABAC) → domain rule → versioned write → audit → outbox / dimension recompute, in the request transaction.
 */
@Injectable()
export class ReadinessSupport {
  constructor(
    readonly db: DbService,
    readonly policy: PolicyService,
    readonly audit: AuditService,
    readonly outbox: OutboxService,
    readonly clock: Clock,
    readonly queue: JobQueue,
    readonly versions: RecordVersionService,
  ) {}

  async project(projectId: string): Promise<ProjectRow> {
    const [p] = await this.db.tx().select().from(schema.project).where(eq(schema.project.id, projectId));
    if (!p) throw notFound();
    return p;
  }

  today(p: ProjectRow): string {
    return this.clock.today(p.timezone);
  }

  /**
   * Access to a LIST / summary (rows are then filtered by visibility + workstream reach in SQL): out of scope or room-only
   * → 404; no grant of the permission anywhere in the project (project, workstream) → 403. A workstream-only principal
   * passes and sees only its workstreams' rows.
   */
  assertListable(ctx: RequestContext, projectId: string, permission = 'readiness.register.read') {
    if (!this.policy.inScope(ctx, projectId) || this.policy.isRoomOnly(ctx.principal, projectId)) throw notFound();
    if (!this.policy.canInProject(ctx, permission, projectId)) throw forbidden('policy.forbidden', `Missing permission ${permission}`);
  }

  /** The actor's roles in the project: project-wide roles, plus workstream roles for `workstreamId` (when given). */
  rolesOf(ctx: RequestContext, projectId: string, workstreamId?: string | null): RoleKey[] {
    const s = ctx.principal.projects.get(projectId);
    if (!s) return [];
    const out = new Set<RoleKey>(s.roles);
    for (const w of s.workstreamRoles) if (workstreamId && w.workstreamId === workstreamId) out.add(w.role);
    return [...out];
  }

  /** Accountable people must be active, full (non room-only) members of the project. */
  async assertMember(projectId: string, userId: string, field: string) {
    const r = await this.db.tx().execute<{ ok: boolean }>(sql`
      select exists (
        select 1 from project_membership m join app_user u on u.id = m.user_id
         where m.project_id = ${projectId} and m.user_id = ${userId} and m.revoked_at is null
           and (m.valid_to is null or m.valid_to > now()) and u.is_active
           and m.role not in (${sql.join(ROOM_ONLY_ROLES.map((r) => sql`${r}`), sql`, `)})
      ) as ok`);
    if (!r.rows[0]?.ok) throw invalid('readiness.user_not_member', `${field}: the selected person is not an active member of this project`);
  }

  /** Same-project references submitted by the client (404 when not a record of this project — never trust an id). */
  async assertRefs(ctx: RequestContext, projectId: string, refs: { siteId?: string | null; workstreamId?: string | null; cutoverPlanId?: string | null; agreementId?: string | null; documentId?: string | null; legalEntityIds?: (string | null | undefined)[] }) {
    if (refs.siteId) await loadInProject(this.db, schema.site, projectId, refs.siteId);
    if (refs.workstreamId) await loadInProject(this.db, schema.workstream, projectId, refs.workstreamId);
    if (refs.cutoverPlanId) await loadInProject(this.db, schema.cutoverPlan, projectId, refs.cutoverPlanId);
    if (refs.agreementId) {
      const a = await loadInProject(this.db, schema.agreement, projectId, refs.agreementId);
      if (!this.policy.canSee(ctx, { projectId, classification: a.classification })) throw notFound();
    }
    if (refs.documentId) {
      const d = await loadInProject(this.db, schema.document, projectId, refs.documentId);
      if (d.deletedAt || !this.policy.canSee(ctx, { projectId, classification: d.classification, roomId: d.roomId })) throw notFound();
    }
    for (const le of refs.legalEntityIds ?? []) {
      if (!le) continue;
      const [pe] = await this.db
        .tx()
        .select({ id: schema.projectEntity.id })
        .from(schema.projectEntity)
        .where(and(eq(schema.projectEntity.projectId, projectId), eq(schema.projectEntity.legalEntityId, le)));
      if (!pe) throw notFound();
    }
  }

  evidence(projectId: string, targetType: 'readiness_check' | 'tsa_service' | 'cutover_plan', targetId: string) {
    return activeEvidenceCount(this.db, projectId, targetType, targetId);
  }

  /** Status dimensions are owned by the gates module: enqueue its recompute job (idempotent per change). */
  async enqueueDimensions(ctx: RequestContext, projectId: string, key: string) {
    await this.queue.enqueue({
      kind: RECOMPUTE_DIMENSIONS_JOB,
      orgId: ctx.principal.orgId,
      projectId,
      payload: { reason: `readiness:${key.split(':')[0]}` },
      idempotencyKey: `${RECOMPUTE_DIMENSIONS_JOB}:readiness:${key}`,
      requestedBy: ctx.principal.userId,
    });
  }

  // ---------------------------------------------------------------------------------------------------------
  // Governance decisions (owned by governance; linked here)

  private canReadDecision(ctx: RequestContext, projectId: string, d: DecisionRow): boolean {
    if (ctx.principal.kind === 'service') return true;
    return this.policy.canInProject(ctx, 'governance.decision.read', projectId) && this.policy.canSee(ctx, { projectId, classification: d.classification as Classification });
  }

  /** A decision submitted by the client: same project AND readable by the caller (404 otherwise). */
  async decision(ctx: RequestContext, projectId: string, decisionId: string): Promise<DecisionRow> {
    const d = await loadInProject(this.db, schema.decision, projectId, decisionId);
    if (!this.canReadDecision(ctx, projectId, d)) throw notFound();
    return d;
  }

  /** Stored reference (no visibility check — used for server-side rule evaluation only; never returned as is). */
  async decisionRow(projectId: string, decisionId: string | null): Promise<DecisionRow | null> {
    if (!decisionId) return null;
    const [d] = await this.db.tx().select().from(schema.decision).where(and(eq(schema.decision.id, decisionId), eq(schema.decision.projectId, projectId)));
    return d ?? null;
  }

  linked(d: DecisionRow): LinkedDecision {
    return { id: d.id, status: d.status, authorityOutcome: d.authorityOutcome, externalAuthorityReference: d.externalAuthorityReference, decisionTypeKey: d.decisionTypeKey };
  }

  /** Summary for responses — null when the caller cannot read the decision (its code/status are not leaked). */
  decisionSummary(ctx: RequestContext, projectId: string, d: DecisionRow | null, allowedTypeKeys: readonly string[], purpose: string) {
    if (!d || !this.canReadDecision(ctx, projectId, d)) return null;
    return {
      id: d.id,
      code: d.code,
      status: d.status,
      authorityOutcome: d.authorityOutcome,
      decisionTypeKey: d.decisionTypeKey,
      issue: linkedDecisionIssue(this.linked(d), allowedTypeKeys, purpose),
    };
  }
}
