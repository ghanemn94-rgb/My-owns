import { Injectable } from '@nestjs/common';
import { and, eq, inArray, sql, SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { schema } from '@hub/db';
import {
  clearanceAllows,
  financeDomainClearance,
  forbidden,
  invalid,
  linkedDecisionIssue,
  linkedDecisionIssueCode,
  localDate,
  notFound,
  renderFinanceMessages,
  Classification,
  LinkedDecision,
  ServerMessage,
} from '@hub/domain';
import { DbService } from '../../platform/db.service';
import { PolicyService, ResourceAttrs } from '../../platform/policy.service';
import { AuditService } from '../../platform/audit.service';
import { OutboxService } from '../../platform/outbox.service';
import { Clock } from '../../platform/clock';
import { RecordVersionService, activeEvidenceCount, loadInProject, visibleEvidenceCounts } from '../../platform/helpers';
import type { RequestContext } from '../../platform/context';
import { newId, payloadHash } from '../../platform/ids';

export type ProjectRow = typeof schema.project.$inferSelect;
export type DecisionRow = typeof schema.decision.$inferSelect;
export type Money = { amount: string; currency: string; unitScale: 1 | 1000 | 1000000 };

export const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
export const money = (amount: string, currency: string, unitScale: number): Money => ({ amount, currency, unitScale: unitScale as Money['unitScale'] });
export const moneyOrNull = (amount: string | null, currency: string | null, unitScale: number | null): Money | null =>
  amount !== null && currency !== null && unitScale !== null ? money(amount, currency, unitScale) : null;
/** `<field>` (English) + `<field>I18n` (codes + parameters) pair for server-computed explanations (module guide §2). */
export const messagesOf = (m: ServerMessage[]) => ({ en: m.map((x) => renderFinanceMessages([x])), i18n: m });

/** Roles that are room-scoped only (clean team / external partner): never accountable for finance records. */
const ROOM_ONLY_ROLES = ['clean_team', 'external_partner_limited'];

/**
 * Shared plumbing of the finance module. Every command: load in project (404) → policy (RBAC + ABAC, with the
 * finance-domain clearance of access-matrix §2.3) → domain rule → versioned write → audit → outbox, in the request
 * transaction. Lists, totals and aggregates apply classification and workstream reach INSIDE SQL.
 */
@Injectable()
export class FinanceSupport {
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

  /** Business date (project timezone) of an instant, e.g. the approval date of a figure. */
  localDate(p: ProjectRow, d: Date | null | undefined): string | null {
    return d ? localDate(d, p.timezone) : null;
  }

  /**
   * Context for FINANCE-domain records: effective clearance = max(user clearance, `domainClearance.finance` of the
   * project-wide roles) — access-matrix §2.3 (finance_restricted → strictly_confidential). Room-scoped roles are not
   * considered (they apply only inside their rooms). Every other attribute of the principal is unchanged.
   */
  fx(ctx: RequestContext, projectId: string): RequestContext {
    const p = ctx.principal;
    if (p.kind === 'service') return ctx;
    const scope = p.projects.get(projectId);
    if (!scope) return ctx;
    const clearance = financeDomainClearance(p.clearance, scope.roles);
    return clearance === p.clearance ? ctx : { ...ctx, principal: { ...p, clearance } };
  }

  /**
   * Access to a LIST / summary (rows are then filtered by visibility + reach in SQL): out of scope or room-only → 404;
   * no grant of the permission anywhere in the project → 403.
   */
  assertListable(ctx: RequestContext, projectId: string, permission = 'finance.record.read') {
    if (!this.policy.inScope(ctx, projectId) || this.policy.isRoomOnly(ctx.principal, projectId)) throw notFound();
    if (!this.policy.canInProject(ctx, permission, projectId)) throw forbidden('policy.forbidden', `Missing permission ${permission}`);
  }

  /**
   * SQL predicate for finance lists, counts and aggregates: classification ≤ finance-domain clearance, and the reach of
   * finance.record.read (a workstream-scoped reader sees only rows of its workstreams; rows without a workstream — or
   * tables without one — need a project-wide grant).
   */
  visibleSql(ctx: RequestContext, projectId: string, cols: { classification: PgColumn; workstream?: PgColumn }): SQL {
    const vis = this.policy.visibilitySql(this.fx(ctx, projectId), projectId, { classification: cols.classification });
    const reach = cols.workstream
      ? this.policy.reachSql(ctx, 'finance.record.read', projectId, cols.workstream)
      : this.policy.permissionReach(ctx, 'finance.record.read', projectId).all
        ? sql`true`
        : sql`false`;
    return and(vis, reach)!;
  }

  /** Row-level read check with the same semantics as {@link visibleSql} (404 when false). */
  canRead(ctx: RequestContext, projectId: string, r: { classification: Classification; workstreamId?: string | null }): boolean {
    return this.policy.can(this.fx(ctx, projectId), 'finance.record.read', { projectId, classification: r.classification, workstreamId: r.workstreamId ?? null });
  }

  assertReadable(ctx: RequestContext, projectId: string, r: { classification: Classification; workstreamId?: string | null }) {
    if (!this.canRead(ctx, projectId, r)) throw notFound();
  }

  /** RBAC + ABAC for a command on a finance record (finance-domain clearance). */
  assert(ctx: RequestContext, permission: string, attrs: ResourceAttrs) {
    this.policy.assert(this.fx(ctx, attrs.projectId), permission, attrs);
  }

  /**
   * Role-level pre-check (RBAC, visibility, classification — not the subject conditions `not_self` / `authority`), with the
   * finance-domain clearance. Never authorizes an approval on its own: the approval path then calls `assert` with the
   * subject's requester and authority (I-R3 — those conditions fail closed when missing).
   */
  assertGranted(ctx: RequestContext, permission: string, attrs: Omit<ResourceAttrs, 'requesterUserId' | 'withinAuthority'>) {
    this.policy.assertGranted(this.fx(ctx, attrs.projectId), permission, attrs);
  }

  /**
   * Create / reclassify: the RESULTING classification must not exceed the caller's (finance-domain) clearance —
   * 403, since the caller is the author (access-matrix §2.4). Checked before visibility so a create is never a 404.
   */
  assertClassificationWritable(ctx: RequestContext, projectId: string, c: Classification) {
    const fx = this.fx(ctx, projectId);
    if (fx.principal.kind !== 'service' && !clearanceAllows(fx.principal.clearance, c)) {
      throw forbidden('policy.classification_exceeds_clearance', `You cannot record finance data classified ${c} (above your clearance)`);
    }
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
    if (!r.rows[0]?.ok) throw invalid('finance.user_not_member', `${field}: the selected person is not an active member of this project`);
  }

  async workstream(projectId: string, id: string | null | undefined) {
    if (id) await loadInProject(this.db, schema.workstream, projectId, id);
  }

  /**
   * A source document submitted by the client: same project, not deleted, readable by the caller (404 otherwise); a
   * source version must be a version of that document.
   */
  async sourceDocument(ctx: RequestContext, projectId: string, documentId: string | null | undefined, versionId: string | null | undefined) {
    if (!documentId) {
      if (versionId) throw invalid('finance.source.version_without_document', 'A source version needs its source document');
      return;
    }
    const d = await loadInProject(this.db, schema.document, projectId, documentId);
    if (d.deletedAt || !this.policy.canSee(ctx, { projectId, classification: d.classification, roomId: d.roomId })) throw notFound();
    if (versionId) {
      const v = await loadInProject(this.db, schema.documentVersion, projectId, versionId);
      if (v.documentId !== d.id) throw invalid('finance.source.version_mismatch', 'The source version is not a version of the source document');
    }
  }

  async importBatch(projectId: string, id: string | null | undefined) {
    if (id) await loadInProject(this.db, schema.importBatch, projectId, id);
  }

  /** TSA service (readiness register, read-only here): same project and visible to the caller (404 otherwise). */
  async tsa(ctx: RequestContext, projectId: string, id: string) {
    const t = await loadInProject(this.db, schema.tsaService, projectId, id);
    if (!this.canReadTsa(ctx, projectId, t)) throw notFound();
    return t;
  }

  canReadTsa(ctx: RequestContext, projectId: string, t: { classification: Classification; workstreamId: string | null }) {
    return this.policy.can(ctx, 'readiness.register.read', { projectId, classification: t.classification, workstreamId: t.workstreamId });
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

  linked(d: DecisionRow): LinkedDecision {
    return { id: d.id, status: d.status, authorityOutcome: d.authorityOutcome, externalAuthorityReference: d.externalAuthorityReference, decisionTypeKey: d.decisionTypeKey };
  }

  decisionIssue(d: DecisionRow, allowed: readonly string[], purpose: string) {
    return { issue: linkedDecisionIssue(this.linked(d), allowed, purpose), code: linkedDecisionIssueCode(this.linked(d), allowed) };
  }

  // ---------------------------------------------------------------------------------------------------------
  // Approval requests / records (governance tables; bound to the subject version + payload hash)

  async openApprovalRequest(
    ctx: RequestContext,
    projectId: string,
    s: { subjectType: 'financial_snapshot' | 'financial_model_version'; subjectId: string; subjectVersion: number; payload: Record<string, unknown>; note: string },
  ): Promise<string> {
    const id = newId();
    await this.db
      .tx()
      .insert(schema.approvalRequest)
      .values({
        id,
        orgId: ctx.principal.orgId,
        projectId,
        subjectType: s.subjectType,
        subjectId: s.subjectId,
        subjectVersion: s.subjectVersion,
        action: `finance.approve:${s.subjectType}`,
        payload: s.payload,
        payloadHash: payloadHash(s.payload),
        requiredPermission: 'finance.snapshot.approve',
        requestedBy: ctx.principal.userId!,
        status: 'pending',
        note: s.note.slice(0, 2000),
      });
    await this.outbox.emit({ type: 'approval.pending', projectId, aggregateType: 'approval_request', aggregateId: id, payload: { subjectType: s.subjectType, subjectId: s.subjectId, requiredPermission: 'finance.snapshot.approve' } });
    return id;
  }

  async approvalRequest(projectId: string, id: string | null) {
    if (!id) return null;
    const [r] = await this.db.tx().select().from(schema.approvalRequest).where(and(eq(schema.approvalRequest.id, id), eq(schema.approvalRequest.projectId, projectId)));
    return r ?? null;
  }

  /** Closes a pending request (approve / reject → append-only approval_record; invalidate → no record). */
  async closeApprovalRequest(ctx: RequestContext, projectId: string, requestId: string | null, outcome: 'approve' | 'reject' | 'invalidate', comment: string | null, authorityBasis: string) {
    const req = await this.approvalRequest(projectId, requestId);
    if (!req || req.status !== 'pending') return;
    if (outcome !== 'invalidate') {
      await this.db.tx().insert(schema.approvalRecord).values({
        id: newId(),
        orgId: ctx.principal.orgId,
        projectId,
        approvalRequestId: req.id,
        approverUserId: ctx.principal.userId!,
        decision: outcome,
        comment,
        authorityBasis,
        payloadHash: req.payloadHash,
      });
    }
    await this.db
      .tx()
      .update(schema.approvalRequest)
      .set({ status: outcome === 'approve' ? 'approved' : outcome === 'reject' ? 'rejected' : 'invalidated', version: sql`${schema.approvalRequest.version} + 1`, updatedAt: new Date() })
      .where(and(eq(schema.approvalRequest.id, req.id), eq(schema.approvalRequest.projectId, projectId)));
  }

  /** Display names of referenced users (same organization; resolved server-side so the UI never shows bare ids). */
  async people(ids: (string | null | undefined)[]): Promise<Record<string, string>> {
    const uniq = [...new Set(ids.filter((x): x is string => !!x))];
    if (!uniq.length) return {};
    const rows = await this.db.tx().select({ id: schema.appUser.id, name: schema.appUser.displayName }).from(schema.appUser).where(inArray(schema.appUser.id, uniq));
    return Object.fromEntries(rows.map((r) => [r.id, r.name]));
  }

  /** Evidence count FOR RULES (every link, whoever can read it). */
  evidence(projectId: string, targetType: 'benefit' | 'financial_snapshot', targetId: string) {
    return activeEvidenceCount(this.db, projectId, targetType, targetId);
  }

  /**
   * FOR RULES (SEC-P34-01, access-matrix §5.1): the people who linked the ACTIVE evidence of a record — "the person who
   * recorded the evidence" is self for its verification. Every link counts, visible to the caller or not.
   */
  async evidenceLinkers(projectId: string, targetType: 'benefit' | 'financial_snapshot', targetId: string): Promise<string[]> {
    const r = await this.db.tx().execute<{ added_by: string }>(sql`
      select distinct added_by::text as added_by from evidence_link
       where project_id = ${projectId} and target_type = ${targetType} and target_id = ${targetId} and status = 'active'`);
    return r.rows.map((x) => x.added_by);
  }

  /**
   * Evidence counters DISPLAYED to the caller: only links the caller could open in the evidence list (SEC-P1R-05,
   * SEC-P1S-04) — a counter never reveals evidence the caller cannot read.
   */
  async evidenceShown(ctx: RequestContext, projectId: string, targetType: 'benefit' | 'financial_snapshot', targetId: string) {
    return (await visibleEvidenceCounts(this.db, this.policy, ctx, projectId, targetType, [targetId])).get(targetId) ?? { active: 0, conflicting: 0 };
  }

  async snapshotVersion(projectId: string, entityType: string, row: { id: string; version: number } & Record<string, unknown>, reason: string) {
    await this.versions.snapshot({ projectId, entityType, entityId: row.id, versionNo: row.version, snapshot: row, reason });
  }
}
