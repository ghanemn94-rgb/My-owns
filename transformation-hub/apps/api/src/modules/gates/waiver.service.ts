import { Injectable } from '@nestjs/common';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { schema } from '@hub/db';
import { assertWaiverAllowed, waiverIsEffective, conflict, forbidden, notFound, ruleViolation, Classification, RoleKey } from '@hub/domain';
import { DbService } from '../../platform/db.service';
import { PolicyService } from '../../platform/policy.service';
import { AuditService } from '../../platform/audit.service';
import { OutboxService } from '../../platform/outbox.service';
import { Clock } from '../../platform/clock';
import type { RequestContext } from '../../platform/context';
import { loadInProject, updateVersioned } from '../../platform/helpers';
import { newId } from '../../platform/ids';

export type WaiverRecord = typeof schema.waiver.$inferSelect;

/** What the waiver service needs to know about a waivable target (gate criterion, readiness check, closing condition…). */
export interface WaiverTargetInfo {
  /** Human reference used in messages and audit (e.g. criterion key "G3-C08"). */
  label: string;
  /** Specialist-determined waivability (default false). */
  waivable: boolean;
  /** Role that may approve a waiver for this target (null = none). */
  waiverAuthorityRole: RoleKey | null;
  classification?: Classification | null;
  /** Permission needed to request a waiver on this target type. */
  requestPermission: string;
  /** Permission needed to approve/reject a waiver on this target type (conditions: not_self + authority). */
  approvePermission: string;
  /** Throws a rule violation when the target's current state cannot take a waiver (e.g. already met). */
  assertRequestable?: () => void;
}

/**
 * A module that owns a waivable target registers a resolver (targetType must be allowlisted in `hub_target_table()`).
 * `onApproved` applies the approved waiver to the target inside the same transaction (it may throw to abort).
 */
export interface WaiverTargetResolver {
  targetType: string;
  resolve(projectId: string, targetId: string): Promise<WaiverTargetInfo>;
  onApproved?(ctx: RequestContext, projectId: string, waiver: WaiverRecord): Promise<void>;
  onRejected?(ctx: RequestContext, projectId: string, waiver: WaiverRecord): Promise<void>;
}

/** Waivers and gate decisions are made by accountable people only — never by AI or service identities (AT-12). */
export function assertHumanActor(ctx: RequestContext, action: string): void {
  if (ctx.principal.kind !== 'user' || !ctx.principal.userId) {
    throw forbidden('gates.human_only', `${action} requires an accountable human user; service and AI identities cannot perform it`);
  }
}

export interface WaiverRequestInput {
  basis: string;
  impact: string;
  conditions?: string | null;
  expiresOn?: string | null;
}

/**
 * Generic waiver register (spec §3: "An exception cannot override a non-waivable condition… Record every waiver's basis,
 * approval, and impact"; AT-13). Shared by gates (gate_criterion) and, later, readiness (readiness_check) and JV
 * (closing_condition): they register a resolver and call `request` / `approve` / `reject` from their own routes.
 */
@Injectable()
export class WaiverService {
  private readonly resolvers = new Map<string, WaiverTargetResolver>();

  constructor(
    private readonly db: DbService,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly clock: Clock,
  ) {}

  registerTarget(resolver: WaiverTargetResolver) {
    this.resolvers.set(resolver.targetType, resolver);
  }

  private resolver(targetType: string): WaiverTargetResolver {
    const r = this.resolvers.get(targetType);
    if (!r) throw ruleViolation('waiver.unsupported_target', `Waivers are not supported for ${targetType}`);
    return r;
  }

  private async project(projectId: string) {
    const [p] = await this.db.tx().select().from(schema.project).where(eq(schema.project.id, projectId));
    if (!p) throw notFound();
    return p;
  }

  /**
   * Request a waiver. A request on a NON-waivable target is rejected (422) and the rejection is audited in an
   * autonomous transaction so it survives the rollback (AT-13) — the target stays unmet.
   */
  async request(ctx: RequestContext, projectId: string, targetType: string, targetId: string, input: WaiverRequestInput): Promise<WaiverRecord> {
    assertHumanActor(ctx, 'Requesting a waiver');
    const project = await this.project(projectId);
    const info = await this.resolver(targetType).resolve(projectId, targetId);
    this.policy.assert(ctx, info.requestPermission, { projectId, classification: info.classification ?? project.classification });
    if (!info.waivable) {
      await this.audit.recordDetached(ctx, {
        action: `${targetType === 'gate_criterion' ? 'gates' : targetType}.waiver.request`,
        entityType: targetType,
        entityId: targetId,
        projectId,
        outcome: 'rejected',
        reason: `non_waivable: ${info.label} is not waivable — the condition remains unmet`,
        after: { basis: input.basis, impact: input.impact },
      });
      throw ruleViolation('gates.waiver.non_waivable', `${info.label} is not waivable; an exception cannot override a non-waivable condition`, { target: info.label });
    }
    info.assertRequestable?.();
    const today = this.clock.today(project.timezone);
    if (input.expiresOn && input.expiresOn < today) throw ruleViolation('gates.waiver.expiry_in_past', 'The waiver expiry date is in the past');
    const open = await this.db
      .tx()
      .select()
      .from(schema.waiver)
      .where(and(eq(schema.waiver.projectId, projectId), eq(schema.waiver.targetType, targetType), eq(schema.waiver.targetId, targetId), inArray(schema.waiver.status, ['requested', 'approved'])));
    if (open.some((w) => w.status === 'requested' || waiverIsEffective(w, today))) {
      throw conflict('gates.waiver.already_open', `${info.label} already has an open or effective waiver`);
    }
    const [row] = await this.db
      .tx()
      .insert(schema.waiver)
      .values({
        id: newId(),
        orgId: ctx.principal.orgId,
        projectId,
        targetType,
        targetId,
        basis: input.basis,
        impact: input.impact,
        conditions: input.conditions ?? null,
        expiresOn: input.expiresOn ?? null,
        status: 'requested',
        requestedBy: ctx.principal.userId!,
        authorityRole: info.waiverAuthorityRole,
        isDemo: project.isDemo,
      })
      .returning();
    await this.audit.record({
      action: 'gates.waiver.request',
      entityType: 'waiver',
      entityId: row!.id,
      projectId,
      after: { targetType, targetId, target: info.label, basis: input.basis, impact: input.impact, conditions: input.conditions ?? null, expiresOn: input.expiresOn ?? null, authorityRole: info.waiverAuthorityRole },
    });
    await this.outbox.emit({ type: 'approval.pending', projectId, aggregateType: 'waiver', aggregateId: row!.id, payload: { targetType, targetId, authorityRole: info.waiverAuthorityRole } });
    return row!;
  }

  private async loadWaiver(projectId: string, waiverId: string, expectTargetType?: string) {
    const w = await loadInProject(this.db, schema.waiver, projectId, waiverId);
    if (expectTargetType && w.targetType !== expectTargetType) throw notFound();
    return w;
  }

  private actorRoles(ctx: RequestContext, projectId: string): RoleKey[] {
    const s = ctx.principal.projects.get(projectId);
    return s ? [...s.roles] : [];
  }

  /**
   * Approve: holder of the target's waiver authority role (policy `authority`), not the requester (`not_self`), target
   * still waivable at approval time, basis + impact documented (domain `assertWaiverAllowed`).
   */
  async approve(ctx: RequestContext, projectId: string, waiverId: string, body: { expectedVersion: number; note?: string }, expectTargetType?: string): Promise<WaiverRecord> {
    assertHumanActor(ctx, 'Approving a waiver');
    const project = await this.project(projectId);
    const w = await this.loadWaiver(projectId, waiverId, expectTargetType);
    const resolver = this.resolver(w.targetType);
    const info = await resolver.resolve(projectId, w.targetId);
    const roles = this.actorRoles(ctx, projectId);
    if (!this.policy.canInProject(ctx, info.approvePermission, projectId)) throw forbidden('policy.forbidden', `Missing permission ${info.approvePermission}`);
    // Non-waivable is checked before authority so the refusal states the real reason (AT-13).
    if (!info.waivable) throw ruleViolation('gates.waiver.non_waivable', `${info.label} is not waivable; an exception cannot override a non-waivable condition`);
    const withinAuthority = !!info.waiverAuthorityRole && roles.includes(info.waiverAuthorityRole);
    this.policy.assert(ctx, info.approvePermission, { projectId, classification: info.classification ?? project.classification, requesterUserId: w.requestedBy, withinAuthority });
    if (w.status !== 'requested') throw ruleViolation('gates.waiver.invalid_state', `The waiver is ${w.status}; only requested waivers can be decided`);
    assertWaiverAllowed({
      criterionKey: info.label,
      waivable: info.waivable,
      waiverAuthorityRole: info.waiverAuthorityRole,
      approverRoles: roles,
      approverUserId: ctx.principal.userId!,
      requesterUserId: w.requestedBy,
      basis: w.basis,
      impact: w.impact,
    });
    const today = this.clock.today(project.timezone);
    if (w.expiresOn && w.expiresOn < today) throw ruleViolation('gates.waiver.expired', 'The waiver request has expired');
    const updated = (await updateVersioned(this.db, schema.waiver, { id: w.id, projectId, expectedVersion: body.expectedVersion }, {
      status: 'approved',
      decidedBy: ctx.principal.userId,
      decidedAt: new Date(),
      decisionNote: body.note ?? null,
      authorityRole: info.waiverAuthorityRole,
    })) as WaiverRecord;
    await resolver.onApproved?.(ctx, projectId, updated);
    await this.audit.record({
      action: 'gates.waiver.approve',
      entityType: 'waiver',
      entityId: w.id,
      projectId,
      before: { status: w.status },
      after: { status: 'approved', target: info.label, authorityRole: info.waiverAuthorityRole, basis: w.basis, impact: w.impact },
      reason: body.note ?? null,
    });
    return updated;
  }

  async reject(ctx: RequestContext, projectId: string, waiverId: string, body: { expectedVersion: number; note: string }, expectTargetType?: string): Promise<WaiverRecord> {
    assertHumanActor(ctx, 'Rejecting a waiver');
    const project = await this.project(projectId);
    const w = await this.loadWaiver(projectId, waiverId, expectTargetType);
    const resolver = this.resolver(w.targetType);
    const info = await resolver.resolve(projectId, w.targetId);
    const roles = this.actorRoles(ctx, projectId);
    const withinAuthority = !!info.waiverAuthorityRole && roles.includes(info.waiverAuthorityRole);
    this.policy.assert(ctx, info.approvePermission, { projectId, classification: info.classification ?? project.classification, requesterUserId: w.requestedBy, withinAuthority });
    if (w.status !== 'requested') throw ruleViolation('gates.waiver.invalid_state', `The waiver is ${w.status}; only requested waivers can be decided`);
    const updated = (await updateVersioned(this.db, schema.waiver, { id: w.id, projectId, expectedVersion: body.expectedVersion }, {
      status: 'rejected',
      decidedBy: ctx.principal.userId,
      decidedAt: new Date(),
      decisionNote: body.note,
    })) as WaiverRecord;
    await resolver.onRejected?.(ctx, projectId, updated);
    await this.audit.record({ action: 'gates.waiver.reject', entityType: 'waiver', entityId: w.id, projectId, before: { status: w.status }, after: { status: 'rejected', target: info.label }, reason: body.note });
    return updated;
  }

  /** For other modules: is `waiverId` an approved, unexpired waiver of exactly this target? */
  async isEffective(projectId: string, waiverId: string | null | undefined, targetType: string, targetId: string): Promise<boolean> {
    if (!waiverId) return false;
    const project = await this.project(projectId);
    const [w] = await this.db
      .tx()
      .select()
      .from(schema.waiver)
      .where(and(eq(schema.waiver.id, waiverId), eq(schema.waiver.projectId, projectId), eq(schema.waiver.targetType, targetType), eq(schema.waiver.targetId, targetId)));
    return waiverIsEffective(w ?? null, this.clock.today(project.timezone));
  }

  async list(projectId: string, targetType: string, status?: string): Promise<WaiverRecord[]> {
    const conds = [eq(schema.waiver.projectId, projectId), eq(schema.waiver.targetType, targetType)];
    if (status) conds.push(eq(schema.waiver.status, status as WaiverRecord['status']));
    return this.db.tx().select().from(schema.waiver).where(and(...conds)).orderBy(desc(schema.waiver.createdAt));
  }
}
