import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { schema } from '@hub/db';
import {
  APPROVED_GATE_STATUSES,
  accessLevelAllows,
  clearanceAllows,
  forbidden,
  invalid,
  matrixUsable,
  notFound,
  roomTypeOf,
  ruleViolation,
  Classification,
  DecisionAuthorityOutcome,
  DecisionStatus,
  GateAssessmentStatus,
  GateCycleState,
  JvDecisionIssueCode,
  LinkedDecision,
  RoleKey,
  RoomAccessEventKind,
  RoomAccessLevel,
  linkedDecisionIssue,
  linkedDecisionIssueCode,
} from '@hub/domain';
import { DbService } from '../../platform/db.service';
import { PolicyService, ResourceAttrs } from '../../platform/policy.service';
import { AuditService } from '../../platform/audit.service';
import { OutboxService } from '../../platform/outbox.service';
import { Clock } from '../../platform/clock';
import { APP_CONFIG, AppConfig } from '../../platform/config';
import { activeEvidenceCount, loadInProject, updateVersioned, visibleEvidenceCounts } from '../../platform/helpers';
import { newId, payloadHash } from '../../platform/ids';
import type { RequestContext } from '../../platform/context';
import { currentDecisionReliance, type RelianceRule } from '../governance/decision-reliance';

export type ProjectRow = typeof schema.project.$inferSelect;
export type RoomRow = typeof schema.partnerRoom.$inferSelect;
export type DecisionRow = typeof schema.decision.$inferSelect;
export type ApprovalRequestRow = typeof schema.approvalRequest.$inferSelect;

export const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

/** Roles that exist only inside a room: never accountable owners of project-level JV records. */
const ROOM_ONLY_ROLES = ['clean_team', 'external_partner_limited'];

/**
 * Shared plumbing of the JV module (partners, rooms, DD, signing/closing, post-close). Every command: load in project
 * (404) → policy (RBAC + ABAC) → domain rule (packages/domain/src/jv.ts) → versioned write → audit → outbox, inside the
 * request transaction. Visibility of lists and counts is applied inside SQL.
 */
@Injectable()
export class JvSupport {
  constructor(
    readonly db: DbService,
    readonly policy: PolicyService,
    readonly audit: AuditService,
    readonly outbox: OutboxService,
    readonly clock: Clock,
    @Inject(APP_CONFIG) readonly config: AppConfig,
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
   * Access to a project-level JV list / record (rows are then filtered by classification in SQL): out of scope or
   * room-only principal (clean team / external partner) → 404; no grant of the permission in the project → 403.
   */
  assertListable(ctx: RequestContext, projectId: string, permission: string) {
    if (!this.policy.inScope(ctx, projectId) || this.policy.isRoomOnly(ctx.principal, projectId)) throw notFound();
    if (!this.policy.canInProject(ctx, permission, projectId)) throw forbidden('policy.forbidden', `Missing permission ${permission}`);
  }

  /** Classification of a new record: never above the author's clearance (access-matrix §2.4 `classification`). */
  assertClassification(ctx: RequestContext, classification: Classification) {
    if (!clearanceAllows(ctx.principal.clearance, classification)) {
      throw ruleViolation('jv.classification_above_clearance', "A record's classification cannot exceed its author's clearance");
    }
  }

  /** Waivers, verifications and confirmations are made by accountable people only — never AI or service identities. */
  assertHuman(ctx: RequestContext, action: string) {
    if (ctx.principal.kind !== 'user' || !ctx.principal.userId) {
      throw forbidden('jv.human_only', `${action} requires an accountable human user; service and AI identities cannot perform it`);
    }
  }

  rolesOf(ctx: RequestContext, projectId: string): RoleKey[] {
    const s = ctx.principal.projects.get(projectId);
    return s ? [...s.roles] : [];
  }

  /** Accountable people are active, full (non room-only) members of the project. */
  async isFullMember(projectId: string, userId: string): Promise<boolean> {
    const r = await this.db.tx().execute<{ ok: boolean }>(sql`
      select exists (
        select 1 from project_membership m join app_user u on u.id = m.user_id
         where m.project_id = ${projectId} and m.user_id = ${userId} and m.revoked_at is null
           and m.valid_from <= now() and (m.valid_to is null or m.valid_to > now()) and u.is_active
           and m.role not in (${sql.join(ROOM_ONLY_ROLES.map((x) => sql`${x}`), sql`, `)})
      ) as ok`);
    return !!r.rows[0]?.ok;
  }

  async assertMember(projectId: string, userId: string, field: string) {
    if (!(await this.isFullMember(projectId, userId))) throw invalid('jv.user_not_member', `${field}: the selected person is not an active member of this project`);
  }

  /** Display names of referenced users (same organization; resolved server-side). */
  async people(ids: (string | null | undefined)[]): Promise<Record<string, string>> {
    const uniq = [...new Set(ids.filter((x): x is string => !!x))];
    if (!uniq.length) return {};
    const rows = await this.db.tx().select({ id: schema.appUser.id, name: schema.appUser.displayName }).from(schema.appUser).where(inArray(schema.appUser.id, uniq));
    return Object.fromEntries(rows.map((r) => [r.id, r.name]));
  }

  /** Evidence count FOR RULES (verification, readiness): every link counts, visible to the caller or not. */
  evidence(projectId: string, targetType: 'closing_condition' | 'closing_deliverable' | 'post_close_obligation', targetId: string) {
    return activeEvidenceCount(this.db, projectId, targetType, targetId);
  }

  /**
   * FOR RULES (SEC-P34-01, access-matrix §5.1): the people who linked the ACTIVE evidence of a record — "the person who
   * recorded the evidence" is self for its verification / acceptance. Every link counts, visible to the caller or not.
   */
  async evidenceLinkers(projectId: string, targetType: 'closing_condition' | 'closing_deliverable' | 'post_close_obligation', targetId: string): Promise<string[]> {
    const r = await this.db.tx().execute<{ added_by: string }>(sql`
      select distinct added_by::text as added_by from evidence_link
       where project_id = ${projectId} and target_type = ${targetType} and target_id = ${targetId} and status = 'active'`);
    return r.rows.map((x) => x.added_by);
  }

  /**
   * Evidence counters FOR DISPLAY (SEC-P1R-05): counted with the evidence list's visibility, so a counter never reveals
   * that restricted / room evidence exists on a CP, deliverable or obligation.
   */
  visibleEvidenceMap(ctx: RequestContext, projectId: string, targetType: 'closing_condition' | 'closing_deliverable' | 'post_close_obligation', ids: string[]) {
    return visibleEvidenceCounts(this.db, this.policy, ctx, projectId, targetType, ids);
  }

  /** Active-evidence counts FOR RULES for many targets of one type (set-based; unfiltered — see visibleEvidenceMap). */
  async evidenceMap(projectId: string, targetType: string, ids: string[]): Promise<Map<string, { active: number; conflicting: number }>> {
    const out = new Map<string, { active: number; conflicting: number }>();
    if (!ids.length) return out;
    const r = await this.db.tx().execute<{ target_id: string; active: number; conflicting: number }>(sql`
      select target_id, count(*) filter (where status = 'active')::int as active, count(*) filter (where status = 'conflicting')::int as conflicting
        from evidence_link where project_id = ${projectId} and target_type = ${targetType}
         and target_id in (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})
       group by target_id`);
    for (const row of r.rows) out.set(row.target_id, { active: row.active, conflicting: row.conflicting });
    return out;
  }

  /** Next human-readable code `PREFIX-001` (counts every row of the project with that prefix, visible or not). */
  async nextCode(table: 'partner' | 'partner_proposal' | 'deal_scenario' | 'negotiation_issue' | 'diligence_finding' | 'closing' | 'closing_condition' | 'closing_deliverable' | 'funds_flow_item' | 'post_close_obligation', column: 'code' | 'reference', projectId: string, prefix: string): Promise<string> {
    // Counted with the owner-independent helper function-free SQL; the caller's RLS may hide room-bound rows, so the
    // code is derived from the maximum numeric suffix and retried by the unique index on conflict.
    const r = await this.db.query<{ n: number }>(
      `select coalesce(max(nullif(regexp_replace(${column}, '^' || $2 || '-', ''), '')::int), 0) as n from ${table} where project_id = $1 and ${column} ~ ('^' || $2 || '-[0-9]+$')`,
      [projectId, prefix],
    );
    return `${prefix}-${String((r.rows[0]?.n ?? 0) + 1).padStart(3, '0')}`;
  }

  // ---------------------------------------------------------------------------------------------------------
  // Rooms

  async room(projectId: string, roomId: string): Promise<RoomRow> {
    return loadInProject(this.db, schema.partnerRoom, projectId, roomId);
  }

  /** ABAC attributes of room CONTENT (room + clean-team conditions apply: a grant is required). */
  roomAttrs(room: RoomRow, classification?: Classification | null): ResourceAttrs {
    return { projectId: room.projectId, classification: (classification ?? room.classification) as Classification, roomId: room.id, roomIsCleanTeam: room.isCleanTeam };
  }

  roomType(room: RoomRow) {
    return roomTypeOf({ isCleanTeam: room.isCleanTeam, partnerId: room.partnerId });
  }

  /** Room administration (grants, lock, metadata) is a project-level function: it never opens the room's content. */
  adminAttrs(room: RoomRow, extra: Partial<ResourceAttrs> = {}): ResourceAttrs {
    return { projectId: room.projectId, classification: room.classification as Classification, ...extra };
  }

  /** The caller's active grant on a room (null when none, revoked, expired, or the room is locked). */
  async myGrant(ctx: RequestContext, roomId: string): Promise<{ id: string; accessLevel: RoomAccessLevel; role: string | null } | null> {
    if (!ctx.principal.userId) return null;
    const r = await this.db.tx().execute<{ id: string; access_level: RoomAccessLevel; role: string | null }>(sql`
      select g.id, g.access_level, g.role::text as role from room_grant g join partner_room r on r.id = g.room_id and r.locked_at is null
       where g.room_id = ${roomId} and g.user_id = ${ctx.principal.userId} and g.revoked_at is null and (g.expires_at is null or g.expires_at > now())
       order by case g.access_level when 'manage' then 0 when 'contribute' then 1 else 2 end limit 1`);
    const g = r.rows[0];
    return g ? { id: g.id, accessLevel: g.access_level, role: g.role } : null;
  }

  /** Content operations need a minimum grant level (read < contribute < manage). Service identities are exempt. */
  async assertLevel(ctx: RequestContext, room: RoomRow, level: RoomAccessLevel) {
    if (ctx.principal.kind === 'service') return;
    const g = await this.myGrant(ctx, room.id);
    if (!g) throw notFound();
    if (!accessLevelAllows(g.accessLevel, level)) throw forbidden('jv.room.access_level', `This action needs "${level}" access to the room (you have "${g.accessLevel}")`);
  }

  /** Append-only room access / disclosure history (AT-19: history is retained after revocation). */
  async roomEvent(ctx: RequestContext, e: { projectId: string; roomId: string; kind: RoomAccessEventKind; subjectUserId?: string | null; grantId?: string | null; disclosureId?: string | null; diligenceRequestId?: string | null; documentVersionId?: string | null; note?: string | null }) {
    await this.db
      .tx()
      .insert(schema.roomAccessEvent)
      .values({
        id: newId(),
        orgId: ctx.principal.orgId,
        projectId: e.projectId,
        roomId: e.roomId,
        kind: e.kind,
        actorUserId: ctx.principal.userId,
        subjectUserId: e.subjectUserId ?? null,
        grantId: e.grantId ?? null,
        disclosureId: e.disclosureId ?? null,
        diligenceRequestId: e.diligenceRequestId ?? null,
        documentVersionId: e.documentVersionId ?? null,
        note: e.note?.slice(0, 2000) ?? null,
      });
  }

  /**
   * The gates module owns the `jv_transaction` status dimension; `cp.changed` triggers its recompute job (as for signing /
   * closing events). Partner stages move the dimension too (DOM-P4-10: partner preparation, diligence and negotiation).
   */
  async jvDimensionChanged(projectId: string, key: string) {
    await this.outbox.emit({ type: 'cp.changed', projectId, aggregateType: 'partner', aggregateId: key.split(':')[1] ?? projectId, payload: { reason: key }, dedupeKey: `cp.changed:${projectId}:${key}`.slice(0, 200) });
  }

  /** Grants and their room revocations change who may read what: other modules (AI index, notifications) react. */
  async permissionChanged(projectId: string, roomId: string, change: string, extra: Record<string, unknown> = {}) {
    await this.outbox.emit({ type: 'permission.changed', projectId, aggregateType: 'partner_room', aggregateId: roomId, payload: { roomId, change, ...extra } });
  }

  // ---------------------------------------------------------------------------------------------------------
  // Documents referenced by JV records

  /** A document submitted by the client: same project, not disposed, and readable by the caller (404 otherwise). */
  async visibleDocument(ctx: RequestContext, projectId: string, documentId: string) {
    const d = await loadInProject(this.db, schema.document, projectId, documentId);
    let roomIsCleanTeam = false;
    if (d.roomId) roomIsCleanTeam = (await this.room(projectId, d.roomId)).isCleanTeam;
    if (d.deletedAt || !this.policy.canSee(ctx, { projectId, classification: d.classification as Classification, roomId: d.roomId, roomIsCleanTeam })) throw notFound();
    return d;
  }

  /** A version of the document (the current one when not given); `usable` = not quarantined / pending / rejected. */
  async documentVersion(projectId: string, documentId: string, versionId: string | null | undefined, currentVersionId: string | null) {
    const id = versionId ?? currentVersionId;
    if (!id) throw ruleViolation('jv.document.no_version', 'The document has no stored version');
    const [v] = await this.db
      .tx()
      .select()
      .from(schema.documentVersion)
      .where(and(eq(schema.documentVersion.id, id), eq(schema.documentVersion.projectId, projectId), eq(schema.documentVersion.documentId, documentId)));
    if (!v) throw notFound();
    return { version: v, usable: versionUsable(v.scanStatus, this.config.storage.allowUnscanned) };
  }

  // ---------------------------------------------------------------------------------------------------------
  // Business gates (owned by the gates module; read here — G5 before a signing, G7 before program closure)

  /**
   * The CURRENT cycle of a business gate of the project (read-only use of the gates tables, as the status dimensions do):
   * status, the decision that backed its approval, and whether the approval is flagged for controlled reassessment
   * (DOM-P2-05: `evaluation.needsReassessment`).
   */
  async gateCycle(projectId: string, gateKey: string): Promise<GateCycleState> {
    const [g] = await this.db
      .tx()
      .select({ id: schema.gateAssessment.id, status: schema.gateAssessment.status, decisionId: schema.gateAssessment.decisionId, evaluation: schema.gateAssessment.evaluation })
      .from(schema.gateAssessment)
      .innerJoin(schema.gateDefinition, and(eq(schema.gateDefinition.id, schema.gateAssessment.gateId), eq(schema.gateDefinition.projectId, schema.gateAssessment.projectId)))
      .where(and(eq(schema.gateAssessment.projectId, projectId), eq(schema.gateDefinition.key, gateKey), eq(schema.gateAssessment.isCurrent, true)))
      .limit(1);
    const status = (g?.status as GateAssessmentStatus | undefined) ?? null;
    const flagged = (g?.evaluation as { needsReassessment?: boolean } | null | undefined)?.needsReassessment === true;
    return { assessmentId: g?.id ?? null, status, underReassessment: !!status && APPROVED_GATE_STATUSES.includes(status) && flagged, decisionId: g?.decisionId ?? null };
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

  /** Stored reference (no visibility check — server-side rule evaluation only; never returned as is). */
  async decisionRow(projectId: string, decisionId: string | null): Promise<DecisionRow | null> {
    if (!decisionId) return null;
    const [d] = await this.db.tx().select().from(schema.decision).where(and(eq(schema.decision.id, decisionId), eq(schema.decision.projectId, projectId)));
    return d ?? null;
  }

  decisionState(d: DecisionRow | null) {
    return d ? { status: d.status as DecisionStatus, authorityOutcome: d.authorityOutcome as DecisionAuthorityOutcome, externalAuthorityReference: d.externalAuthorityReference, decisionTypeKey: d.decisionTypeKey } : null;
  }

  /** Summary for responses — null when the caller cannot read the decision (its code/status are not leaked). */
  decisionSummary(ctx: RequestContext, projectId: string, d: DecisionRow | null, allowedTypeKeys: readonly string[] | null, purpose: string) {
    if (!d || !this.canReadDecision(ctx, projectId, d)) return null;
    const keys = allowedTypeKeys ?? (d.decisionTypeKey ? [d.decisionTypeKey] : ['(any)']);
    const linked: LinkedDecision = { id: d.id, status: d.status, authorityOutcome: d.authorityOutcome, externalAuthorityReference: d.externalAuthorityReference, decisionTypeKey: allowedTypeKeys ? d.decisionTypeKey : keys[0]! };
    return {
      id: d.id,
      code: d.code,
      status: d.status,
      authorityOutcome: d.authorityOutcome,
      decisionTypeKey: d.decisionTypeKey,
      issue: linkedDecisionIssue(linked, keys, purpose),
      issueCode: linkedDecisionIssueCode(linked, keys),
    };
  }

  /**
   * `decisionSummary` with the reliance state of the decision for the record (DOM-P4-01/08, shared facility
   * governance/decision-reliance.ts): when the decision is otherwise final and of the right type, `issueCode` also reports
   * `evidence_invalid` (the evidence of its external approval is no longer an active, verified link — on a confirmed event
   * this flags that the confirmation rests on an external approval no longer evidenced), `already_used` (it backs another
   * record of the same kind) and `other_subject` (raised for another record). `rule` null = no reliance state.
   */
  async relianceSummary(ctx: RequestContext, projectId: string, d: DecisionRow | null, allowedTypeKeys: readonly string[] | null, purpose: string, rule: RelianceRule | null) {
    const s = this.decisionSummary(ctx, projectId, d, allowedTypeKeys, purpose);
    if (!s || !d || !rule || s.issueCode) return s;
    const { issue } = await currentDecisionReliance(this.db, projectId, d, rule);
    const code: JvDecisionIssueCode | null = !issue
      ? null
      : issue.kind === 'evidence_invalid' || issue.kind === 'already_used' || issue.kind === 'other_subject'
        ? issue.kind
        : issue.kind === 'no_subject'
          ? 'other_subject'
          : issue.kind === 'type_mismatch'
            ? 'wrong_type'
            : 'not_approved';
    return code ? { ...s, issue: issue!.reason, issueCode: code } : s;
  }

  /**
   * Delegated authority from the project's approved authority matrix in force (access-matrix §2.4 `authority`, §5.2):
   * the matrix covers one of the decision types. Demo policies count only on demo projects (matrixUsable).
   */
  async matrixAuthority(p: ProjectRow, decisionTypeKeys: readonly string[] | null): Promise<{ within: boolean; basis: string }> {
    const today = this.today(p);
    const rows = await this.db
      .tx()
      .select()
      .from(schema.authorityMatrixVersion)
      .where(and(eq(schema.authorityMatrixVersion.projectId, p.id), eq(schema.authorityMatrixVersion.status, 'approved')))
      .orderBy(desc(schema.authorityMatrixVersion.versionNo));
    for (const m of rows) {
      const u = matrixUsable({ status: m.status, isDemoPolicy: m.isDemoPolicy, effectiveFrom: m.effectiveFrom, effectiveTo: m.effectiveTo }, today, p.isDemo);
      if (!u.usable) continue;
      if (!decisionTypeKeys) return { within: true, basis: `Authority matrix v${m.versionNo} in force${m.isDemoPolicy ? ' (DEMO policy)' : ''}` };
      const types = ((m.policy as { decisionTypes?: { key: string }[] }).decisionTypes ?? []).map((t) => t.key);
      const key = decisionTypeKeys.find((k) => types.includes(k));
      if (key) return { within: true, basis: `Authority matrix v${m.versionNo} (${key})${m.isDemoPolicy ? ' — DEMO policy' : ''}` };
    }
    return { within: false, basis: `No approved authority matrix in force covers ${decisionTypeKeys?.join(' / ') ?? 'this action'}` };
  }

  // ---------------------------------------------------------------------------------------------------------
  // Approval requests (bound to subject version + payload hash)

  async createApprovalRequest(
    ctx: RequestContext,
    projectId: string,
    r: { subjectType: 'partner' | 'closing' | 'project' | 'closing_deliverable'; subjectId: string; subjectVersion: number; action: string; requiredPermission: string; payload: Record<string, unknown>; note: string },
  ): Promise<string> {
    const id = newId();
    await this.db.tx().insert(schema.approvalRequest).values({
      id,
      orgId: ctx.principal.orgId,
      projectId,
      subjectType: r.subjectType,
      subjectId: r.subjectId,
      subjectVersion: r.subjectVersion,
      action: r.action,
      payload: r.payload,
      payloadHash: payloadHash(r.payload),
      requiredPermission: r.requiredPermission,
      requestedBy: ctx.principal.userId!,
      status: 'pending',
      note: r.note.slice(0, 2000),
    });
    await this.outbox.emit({ type: 'approval.pending', projectId, aggregateType: 'approval_request', aggregateId: id, payload: { subjectType: r.subjectType, subjectId: r.subjectId, requiredPermission: r.requiredPermission } });
    return id;
  }

  async approvalRequest(projectId: string, id: string | null): Promise<ApprovalRequestRow | null> {
    if (!id) return null;
    const [r] = await this.db.tx().select().from(schema.approvalRequest).where(and(eq(schema.approvalRequest.id, id), eq(schema.approvalRequest.projectId, projectId)));
    return r ?? null;
  }

  approvalStep(r: ApprovalRequestRow | null) {
    return r ? { requestId: r.id, status: r.status, requestedBy: r.requestedBy, requestedAt: r.createdAt.toISOString() } : null;
  }

  /** Records the approver's decision on a pending request (approval_record is append-only). */
  async decideApproval(ctx: RequestContext, projectId: string, req: ApprovalRequestRow, decision: 'approve' | 'reject', comment: string | null, authorityBasis: string | null) {
    await this.db.tx().insert(schema.approvalRecord).values({
      id: newId(),
      orgId: ctx.principal.orgId,
      projectId,
      approvalRequestId: req.id,
      approverUserId: ctx.principal.userId!,
      decision,
      comment,
      authorityBasis,
      payloadHash: req.payloadHash,
    });
    await updateVersioned(this.db, schema.approvalRequest, { id: req.id, projectId, expectedVersion: req.version }, { status: decision === 'approve' ? 'approved' : 'rejected' });
  }

  async invalidateApproval(projectId: string, req: ApprovalRequestRow | null, why: string) {
    if (!req || req.status !== 'pending') return;
    await updateVersioned(this.db, schema.approvalRequest, { id: req.id, projectId, expectedVersion: req.version }, { status: 'invalidated', note: `${req.note ?? ''} — invalidated: ${why}`.slice(0, 2000) });
  }

  /** Active grants of external accounts in a partner's rooms (for withdrawal / unbinding). */
  async revokeExternalGrants(ctx: RequestContext, projectId: string, partnerId: string, userId: string | null, reason: string): Promise<number> {
    const rooms = await this.db.tx().select({ id: schema.partnerRoom.id }).from(schema.partnerRoom).where(and(eq(schema.partnerRoom.projectId, projectId), eq(schema.partnerRoom.partnerId, partnerId)));
    if (!rooms.length) return 0;
    const g = schema.roomGrant;
    const conds = [eq(g.projectId, projectId), inArray(g.roomId, rooms.map((r) => r.id)), isNull(g.revokedAt), eq(g.role, 'external_partner_limited')];
    if (userId) conds.push(eq(g.userId, userId));
    const revoked = await this.db
      .tx()
      .update(g)
      .set({ revokedAt: this.clock.now(), revokedBy: ctx.principal.userId, revokeReason: reason.slice(0, 2000) })
      .where(and(...conds))
      .returning({ id: g.id, roomId: g.roomId, userId: g.userId });
    for (const r of revoked) {
      await this.roomEvent(ctx, { projectId, roomId: r.roomId, kind: 'grant_revoked', subjectUserId: r.userId, grantId: r.id, note: reason });
      await this.audit.record({ action: 'jv.room.revoke_access', entityType: 'room_grant', entityId: r.id, projectId, after: { roomId: r.roomId, userId: r.userId, revoked: true }, reason });
      await this.permissionChanged(projectId, r.roomId, 'grant_revoked', { grantId: r.id });
    }
    return revoked.length;
  }
}

/** Mirrors documents' scanUsable (ADR-0010): quarantined / rejected / pending never; not_scanned only when allowed. */
export function versionUsable(status: string, allowUnscanned: boolean): boolean {
  if (['quarantined', 'rejected', 'pending'].includes(status)) return false;
  if (status === 'not_scanned') return allowUnscanned;
  return true;
}

export function money(amount: string | null, currency: string | null, unitScale: number | null) {
  return amount !== null && currency && unitScale ? { amount: String(amount), currency, unitScale: unitScale as 1 | 1000 | 1000000 } : null;
}

