import { Injectable } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { schema } from '@hub/db';
import { forbidden, invalid, linkedDecisionIssue, linkedDecisionIssueCode, notFound, readinessCheckAppliesToPlan, Classification, CutoverStatus, LinkedDecision, ReadinessStatus, RoleKey } from '@hub/domain';
import { newId } from '../../platform/ids';
import { DbService } from '../../platform/db.service';
import { PolicyService } from '../../platform/policy.service';
import { AuditService } from '../../platform/audit.service';
import { OutboxService } from '../../platform/outbox.service';
import { Clock } from '../../platform/clock';
import { RecordVersionService, activeEvidenceCount, evidenceSelfIds, loadInProject, visibleEvidenceCounts } from '../../platform/helpers';
import type { RequestContext } from '../../platform/context';

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

  /** Display names of referenced users (same organization; resolved server-side so the UI never shows bare ids). */
  async people(ids: (string | null | undefined)[]): Promise<Record<string, string>> {
    const uniq = [...new Set(ids.filter((x): x is string => !!x))];
    if (!uniq.length) return {};
    const rows = await this.db.tx().select({ id: schema.appUser.id, name: schema.appUser.displayName }).from(schema.appUser).where(inArray(schema.appUser.id, uniq));
    return Object.fromEntries(rows.map((r) => [r.id, r.name]));
  }

  /** Evidence counts FOR RULES (sign-off, TSA exit, cutover acceptance): every link counts. */
  evidence(projectId: string, targetType: 'readiness_check' | 'tsa_service' | 'cutover_plan', targetId: string) {
    return activeEvidenceCount(this.db, projectId, targetType, targetId);
  }

  /**
   * DOM-P3-10 / SEC-P34-01 (access-matrix §5.1: "the person who recorded the status/evidence" is self): the linkers of the
   * target's CURRENT evidence and the uploaders of the linked versions — one definition, `evidenceSelfIds` (SEC-P34R-03).
   */
  evidenceLinkers(projectId: string, targetType: 'readiness_check' | 'tsa_service' | 'cutover_plan', targetId: string): Promise<string[]> {
    return evidenceSelfIds(this.db, projectId, targetType, targetId);
  }

  /**
   * DOM-P3-09: per readiness check, whether its evidence can still support a sign-off (at least one ACTIVE link and no
   * conflicting one). FOR RULES — every link counts, whatever the caller may see.
   */
  async signoffEvidenceValid(projectId: string, checkIds: string[]): Promise<Map<string, boolean>> {
    if (checkIds.length === 0) return new Map();
    const r = await this.db.tx().execute<{ target_id: string; active: number; conflicting: number }>(sql`
      select target_id, count(*) filter (where status = 'active')::int as active, count(*) filter (where status = 'conflicting')::int as conflicting
        from evidence_link
       where project_id = ${projectId} and target_type = 'readiness_check' and target_id in (${sql.join(checkIds.map((i) => sql`${i}::uuid`), sql`, `)})
       group by target_id`);
    const m = new Map<string, boolean>(checkIds.map((id) => [id, false]));
    for (const x of r.rows) m.set(x.target_id, Number(x.active) > 0 && Number(x.conflicting) === 0);
    return m;
  }

  /**
   * DOM-P3-03 — one writer of a project's Day-1 readiness state at a time: the transaction-scoped advisory lock
   * `hub_readiness:<projectId>`, taken FIRST (before the rows are read) by every command that changes a gating input of a
   * GO (test run, sign-off, determination, reopen, waiver application, re-binding, check creation, the evidence reaction)
   * and by the GO / execution commands, so a GO never commits on an evaluation that missed a concurrently committed change.
   * Lock order: `hub_readiness` → decision row (GO reliance). TSA commands do not take it.
   */
  async lockReadiness(projectId: string) {
    await this.db.query(`select pg_advisory_xact_lock(hashtextextended('hub_readiness:' || $1, 0))`, [projectId]);
  }

  /** Cutover plans of the project that a check (as bound) gates (`readinessCheckAppliesToPlan`). */
  async plansGatedBy(projectId: string, check: { cutoverPlanId: string | null; siteId: string | null }) {
    const rows = await this.db
      .tx()
      .select({ id: schema.cutoverPlan.id, code: schema.cutoverPlan.code, siteId: schema.cutoverPlan.siteId, status: schema.cutoverPlan.status, goDecisionId: schema.cutoverPlan.goDecisionId, isDemo: schema.cutoverPlan.isDemo })
      .from(schema.cutoverPlan)
      .where(eq(schema.cutoverPlan.projectId, projectId));
    return rows.filter((p) => readinessCheckAppliesToPlan(check, p));
  }

  /** Append an entry to a plan's go/no-go decision history (actor null = recorded by the system). */
  async recordPlanHistory(
    ctx: RequestContext,
    plan: { id: string; status: CutoverStatus; goDecisionId: string | null; isDemo: boolean },
    projectId: string,
    kind: 'go_flagged' | 'execution_blocked' | 'check_bound' | 'check_unbound' | 'site_changed',
    rationale: string,
    evaluation: { blockers: { id: string; title: string; status: ReadinessStatus; blocker: boolean; evidenceInvalid?: boolean }[]; missing: string[] } | null,
  ) {
    await this.db
      .tx()
      .insert(schema.cutoverDecisionRecord)
      .values({
        id: newId(),
        orgId: ctx.principal.orgId,
        projectId,
        cutoverPlanId: plan.id,
        kind,
        fromStatus: plan.status,
        toStatus: plan.status,
        actorUserId: ctx.principal.kind === 'service' ? null : (ctx.principal.userId ?? null),
        rationale: rationale.slice(0, 4000),
        goDecisionId: plan.goDecisionId,
        evaluation,
        isDemo: plan.isDemo,
      });
  }

  /**
   * DOM-P3-04 / DOM-P3-09: a gating check that is OPEN again (failed test, reopened, sign-off evidence rejected) flags the
   * GO of every plan it gates that is at `approved_go`: an entry in the plan's decision history and an audit event. The GO
   * itself is not changed (it is a recorded decision); recording the execution is refused until the check is cleared /
   * waived or the GO is withdrawn for a new decision (`CutoverService.recordExecution`, `return_to_planning`).
   */
  async flagGoPlans(ctx: RequestContext, projectId: string, check: { id: string; code: string; title: string; status: ReadinessStatus; blocker: boolean; mandatory: boolean; cutoverPlanId: string | null; siteId: string | null }, why: string) {
    if (!check.blocker && !check.mandatory) return [];
    const plans = (await this.plansGatedBy(projectId, check)).filter((p) => p.status === 'approved_go');
    for (const plan of plans) {
      const blocker = { id: check.id, title: `${check.code} — ${check.title}`, status: check.status, blocker: check.blocker };
      await this.recordPlanHistory(ctx, plan, projectId, 'go_flagged', `${check.code}: ${why}`, { blockers: [blocker], missing: [] });
      await this.audit.record({
        action: 'readiness.cutover.go_flagged',
        entityType: 'cutover_plan',
        entityId: plan.id,
        projectId,
        after: { status: plan.status, flagged: true, checkId: check.id, checkCode: check.code, checkStatus: check.status },
        reason: `${check.code}: ${why} — the GO is flagged for re-decision; execution is refused until the check is cleared or the GO is withdrawn`,
      });
      await this.outbox.emit({ type: 'readiness.changed', projectId, aggregateType: 'cutover_plan', aggregateId: plan.id, payload: { reason: 'readiness:go_flagged', checkId: check.id } });
    }
    return plans.map((p) => p.code);
  }

  /** Evidence counts FOR DISPLAY: only links the caller could see in the evidence list (SEC-P1R-05). */
  async visibleEvidence(ctx: RequestContext, projectId: string, targetType: 'readiness_check' | 'tsa_service' | 'cutover_plan', targetId: string) {
    return (await visibleEvidenceCounts(this.db, this.policy, ctx, projectId, targetType, [targetId])).get(targetId) ?? { active: 0, conflicting: 0 };
  }

  /**
   * Status dimensions are owned by the gates module: emit `readiness.changed` (gates subscribes it to its recompute job).
   * Deduplicated per change key (entity + version), so a retried command never emits twice.
   */
  async enqueueDimensions(ctx: RequestContext, projectId: string, key: string) {
    void ctx;
    const [kind, id] = key.split(':');
    await this.outbox.emit({
      type: 'readiness.changed',
      projectId,
      aggregateType: kind === 'tsa' ? 'tsa_service' : kind === 'check' ? 'readiness_check' : kind === 'plan' ? 'cutover_plan' : 'project',
      aggregateId: (kind === 'tsa' || kind === 'check' || kind === 'plan') && id ? id : projectId,
      payload: { reason: `readiness:${kind}` },
      dedupeKey: `readiness.changed:${projectId}:${key}`.slice(0, 200),
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
      issueCode: linkedDecisionIssueCode(this.linked(d), allowedTypeKeys),
    };
  }
}
