import { Injectable } from '@nestjs/common';
import { and, asc, count, eq, ilike, or, SQL } from 'drizzle-orm';
import { schema } from '@hub/db';
import {
  allowedCommands,
  assertBenefitVerifiable,
  assertHumanActor,
  assertNotDeclassified,
  assertRealizationRecordable,
  assertSameUnit,
  forbidden,
  parseMoney,
  ruleViolation,
  transition,
  BENEFIT_MACHINE,
  FINANCE_DEFAULT_CLASSIFICATION,
  BenefitCommand,
  BenefitStatus,
} from '@hub/domain';
import type { RouteInput, financeRoutes } from '@hub/contracts';
import type { RequestContext } from '../../platform/context';
import { assertVersion, likeContains, loadInProject, nextCode, offsetOf, pageOf, updateVersioned } from '../../platform/helpers';
import { orderBySort } from '../../platform/sort';
import { newId } from '../../platform/ids';
import { FinanceSupport, iso, moneyOrNull } from './finance.support';

type BenefitRow = typeof schema.benefit.$inferSelect;
const T = schema.benefit;
type R = typeof financeRoutes;
const actorOf = (ctx: RequestContext) => ({ kind: ctx.principal.kind, userId: ctx.principal.userId });
const LOCKED: BenefitStatus[] = ['realized_verified', 'cancelled'];

/**
 * Benefits register (REQ-FIN-009): measurement definition, baseline, target, owner, realization date and verification
 * source. A realization is reported with its verification source and stays unverified until a person independent of the
 * owner and the reporter verifies it (not_self); service identities never verify.
 */
@Injectable()
export class BenefitsService {
  constructor(private readonly s: FinanceSupport) {}

  dto(b: BenefitRow) {
    return {
      id: b.id,
      code: b.code,
      title: b.title,
      measurementDefinition: b.measurementDefinition,
      baselineValue: b.baselineValue,
      targetValue: b.targetValue,
      actualValue: b.actualValue,
      unit: b.unit,
      value: moneyOrNull(b.valueAmount, b.valueCurrency, b.valueUnitScale),
      realized: moneyOrNull(b.realizedAmount, b.realizedCurrency, b.realizedUnitScale),
      ownerUserId: b.ownerUserId,
      workstreamId: b.workstreamId,
      realizationDate: b.realizationDate,
      realizedOn: b.realizedOn,
      verificationSource: b.verificationSource,
      status: b.status,
      approvedBy: b.approvedBy,
      approvedAt: iso(b.approvedAt),
      realizationRecordedBy: b.realizationRecordedBy,
      realizationRecordedAt: iso(b.realizationRecordedAt),
      verifiedBy: b.verifiedBy,
      verifiedAt: iso(b.verifiedAt),
      verificationNote: b.verificationNote,
      statusNote: b.statusNote,
      classification: b.classification,
      isDemo: b.isDemo,
      createdAt: b.createdAt.toISOString(),
      createdBy: b.createdBy,
      version: b.version,
    };
  }

  scopeSql(ctx: RequestContext, projectId: string): SQL {
    return and(eq(T.projectId, projectId), this.s.visibleSql(ctx, projectId, { classification: T.classification, workstream: T.workstreamId }))!;
  }

  async list(ctx: RequestContext, projectId: string, q: RouteInput<R['listBenefits']>['query']) {
    this.s.assertListable(ctx, projectId);
    const where = and(
      this.scopeSql(ctx, projectId),
      q.status ? eq(T.status, q.status) : undefined,
      q.ownerUserId ? eq(T.ownerUserId, q.ownerUserId) : undefined,
      q.q ? or(ilike(T.title, likeContains(q.q)), ilike(T.code, likeContains(q.q))) : undefined,
    );
    const tx = this.s.db.tx();
    const [{ total }] = (await tx.select({ total: count() }).from(T).where(where)) as [{ total: number }];
    const order = orderBySort(q.sort, { code: T.code, title: T.title, status: T.status, realizationDate: T.realizationDate, updatedAt: T.updatedAt }, T.id, [asc(T.code), asc(T.id)]);
    const rows = await tx.select().from(T).where(where).orderBy(...order).limit(q.pageSize).offset(offsetOf(q));
    return pageOf(
      rows.map((b) => this.dto(b)),
      Number(total),
      q,
    );
  }

  async get(ctx: RequestContext, projectId: string, id: string) {
    const b = await loadInProject(this.s.db, T, projectId, id);
    this.s.assertReadable(ctx, projectId, b);
    const K = schema.kpi;
    const kpis = await this.s.db
      .tx()
      .select({ id: K.id, key: K.key, name: K.name })
      .from(K)
      .where(and(eq(K.projectId, projectId), eq(K.benefitId, b.id), this.s.visibleSql(ctx, projectId, { classification: K.classification })))
      .orderBy(asc(K.key));
    return {
      ...this.dto(b),
      evidence: await this.s.evidenceShown(ctx, projectId, 'benefit', b.id),
      allowedCommands: allowedCommands(BENEFIT_MACHINE, b.status),
      kpis,
      people: await this.s.people([b.ownerUserId, b.createdBy, b.approvedBy, b.realizationRecordedBy, b.verifiedBy]),
    };
  }

  async create(ctx: RequestContext, projectId: string, body: RouteInput<R['createBenefit']>['body']) {
    const p = await this.s.project(projectId);
    const classification = body.classification ?? FINANCE_DEFAULT_CLASSIFICATION.benefit;
    this.s.assertClassificationWritable(ctx, projectId, classification);
    this.s.assert(ctx, 'finance.benefit.manage', { projectId, classification, workstreamId: body.workstreamId ?? null });
    await this.s.workstream(projectId, body.workstreamId);
    if (body.ownerUserId) await this.s.assertMember(projectId, body.ownerUserId, 'ownerUserId');
    const value = body.value ? parseMoney(body.value) : null;
    const id = newId();
    const code = await nextCode(this.s.db, T, projectId, 'BEN');
    const [row] = await this.s.db
      .tx()
      .insert(T)
      .values({
        id,
        orgId: ctx.principal.orgId,
        projectId,
        code,
        title: body.title,
        measurementDefinition: body.measurementDefinition,
        baselineValue: body.baselineValue ?? null,
        targetValue: body.targetValue ?? null,
        unit: body.unit ?? null,
        valueAmount: value?.amount ?? null,
        valueCurrency: value?.currency ?? null,
        valueUnitScale: value?.unitScale ?? null,
        ownerUserId: body.ownerUserId ?? null,
        workstreamId: body.workstreamId ?? null,
        realizationDate: body.realizationDate ?? null,
        verificationSource: body.verificationSource ?? null,
        classification,
        isDemo: p.isDemo,
        createdBy: ctx.principal.userId,
      })
      .returning();
    await this.s.snapshotVersion(projectId, 'benefit', row!, 'created');
    await this.s.audit.record({ action: 'finance.benefit.create', entityType: 'benefit', entityId: id, projectId, after: { code, title: body.title, ownerUserId: body.ownerUserId ?? null, realizationDate: body.realizationDate ?? null, value } });
    return { id, code, version: 1 };
  }

  async update(ctx: RequestContext, projectId: string, id: string, body: RouteInput<R['updateBenefit']>['body']) {
    const b = await loadInProject(this.s.db, T, projectId, id);
    this.s.assert(ctx, 'finance.benefit.manage', { projectId, classification: b.classification, workstreamId: b.workstreamId });
    const changes: Record<string, unknown> = {};
    const simple = ['title', 'measurementDefinition', 'baselineValue', 'targetValue', 'unit', 'realizationDate', 'verificationSource', 'ownerUserId', 'workstreamId'] as const;
    const cur = b as unknown as Record<string, unknown>;
    for (const k of simple) if (body[k] !== undefined && (body[k] ?? null) !== cur[k]) changes[k] = body[k] ?? null;
    if (body.value !== undefined) {
      const v = body.value ? parseMoney(body.value) : null;
      if ((v?.amount ?? null) !== b.valueAmount || (v?.currency ?? null) !== b.valueCurrency || (v?.unitScale ?? null) !== b.valueUnitScale) {
        Object.assign(changes, { valueAmount: v?.amount ?? null, valueCurrency: v?.currency ?? null, valueUnitScale: v?.unitScale ?? null });
      }
    }
    if (body.classification !== undefined && body.classification !== b.classification) {
      assertNotDeclassified(b.classification, body.classification, 'a benefit');
      this.s.assertClassificationWritable(ctx, projectId, body.classification);
      changes['classification'] = body.classification;
    }
    if (Object.keys(changes).length === 0) {
      assertVersion(b, body.expectedVersion, 'benefit');
      return { id: b.id, version: b.version };
    }
    if (LOCKED.includes(b.status)) throw ruleViolation('finance.benefit.locked', `A ${b.status} benefit is closed`);
    if (b.status === 'realized_unverified' && ('verificationSource' in changes || 'ownerUserId' in changes)) {
      throw ruleViolation('finance.benefit.realization_pending', 'The verification source and owner are fixed while a reported realization awaits verification');
    }
    if (changes['ownerUserId']) await this.s.assertMember(projectId, changes['ownerUserId'] as string, 'ownerUserId');
    if (changes['workstreamId']) {
      await this.s.workstream(projectId, changes['workstreamId'] as string);
      this.s.assert(ctx, 'finance.benefit.manage', { projectId, classification: b.classification, workstreamId: changes['workstreamId'] as string });
    }
    const row = (await updateVersioned(this.s.db, T, { id: b.id, projectId, expectedVersion: body.expectedVersion }, changes)) as BenefitRow;
    await this.s.snapshotVersion(projectId, 'benefit', row, 'updated');
    await this.s.audit.record({ action: 'finance.benefit.update', entityType: 'benefit', entityId: b.id, projectId, before: Object.fromEntries(Object.keys(changes).map((k) => [k, cur[k]])), after: changes });
    return { id: b.id, version: row.version };
  }

  private async apply(ctx: RequestContext, b: BenefitRow, cmd: BenefitCommand, expectedVersion: number, values: Record<string, unknown>, reason: string | null, extraAudit: Record<string, unknown> = {}) {
    const to = transition('benefit', BENEFIT_MACHINE, b.status, cmd);
    assertVersion(b, expectedVersion, 'benefit');
    const row = (await updateVersioned(this.s.db, T, { id: b.id, projectId: b.projectId, expectedVersion }, { status: to, ...values })) as BenefitRow;
    await this.s.snapshotVersion(b.projectId, 'benefit', row, cmd);
    await this.s.audit.record({ action: `finance.benefit.${cmd}`, entityType: 'benefit', entityId: b.id, projectId: b.projectId, before: { status: b.status }, after: { status: to, ...extraAudit }, reason });
    void ctx;
    return { id: b.id, status: row.status, version: row.version };
  }

  /** Register acceptance of the definition — by a Finance reviewer independent of the creator and the owner. */
  async approve(ctx: RequestContext, projectId: string, id: string, body: { expectedVersion: number; note?: string }) {
    const b = await loadInProject(this.s.db, T, projectId, id);
    this.s.assert(ctx, 'finance.benefit.verify', { projectId, classification: b.classification, workstreamId: b.workstreamId, requesterUserId: b.createdBy });
    assertHumanActor(actorOf(ctx), 'Benefit approval');
    if (ctx.principal.userId === b.ownerUserId) throw forbidden('finance.benefit.approve_self', 'Separation of duties: the benefit owner cannot accept its own benefit into the register');
    return this.apply(ctx, b, 'approve', body.expectedVersion, { approvedBy: ctx.principal.userId, approvedAt: this.s.clock.now() }, body.note ?? null);
  }

  async startTracking(ctx: RequestContext, projectId: string, id: string, body: { expectedVersion: number; note?: string }) {
    const b = await loadInProject(this.s.db, T, projectId, id);
    this.s.assert(ctx, 'finance.benefit.manage', { projectId, classification: b.classification, workstreamId: b.workstreamId });
    return this.apply(ctx, b, 'start_tracking', body.expectedVersion, {}, body.note ?? null);
  }

  /** REQ-FIN-009: a realization needs its verification source; it stays unverified until independently verified. */
  async recordRealization(ctx: RequestContext, projectId: string, id: string, body: RouteInput<R['recordBenefitRealization']>['body']) {
    const b = await loadInProject(this.s.db, T, projectId, id);
    this.s.assert(ctx, 'finance.benefit.manage', { projectId, classification: b.classification, workstreamId: b.workstreamId });
    assertHumanActor(actorOf(ctx), 'Reporting a benefit realization');
    const p = await this.s.project(projectId);
    const verificationSource = body.verificationSource?.trim() ? body.verificationSource : b.verificationSource;
    assertRealizationRecordable({ actualValue: body.actualValue, realizedOn: body.realizedOn, verificationSource, today: this.s.today(p) });
    const realized = body.realized ? parseMoney(body.realized) : null;
    const estimate = moneyOrNull(b.valueAmount, b.valueCurrency, b.valueUnitScale);
    if (realized && estimate) assertSameUnit(estimate, realized, `Benefit ${b.code}`);
    const result = await this.apply(
      ctx,
      b,
      'record_realization',
      body.expectedVersion,
      {
        actualValue: body.actualValue,
        realizedAmount: realized?.amount ?? null,
        realizedCurrency: realized?.currency ?? null,
        realizedUnitScale: realized?.unitScale ?? null,
        realizedOn: body.realizedOn,
        verificationSource,
        realizationRecordedBy: ctx.principal.userId,
        realizationRecordedAt: this.s.clock.now(),
        statusNote: body.note ?? null,
      },
      body.note ?? null,
      { actualValue: body.actualValue, realizedOn: body.realizedOn, verificationSource },
    );
    await this.s.outbox.emit({ type: 'approval.pending', projectId, aggregateType: 'benefit', aggregateId: b.id, payload: { kind: 'benefit_verification', requiredPermission: 'finance.benefit.verify' } });
    return result;
  }

  /** Verification by a person independent of the owner and the reporter (not_self); never a service identity. */
  async verify(ctx: RequestContext, projectId: string, id: string, body: { expectedVersion: number; note: string }) {
    const b = await loadInProject(this.s.db, T, projectId, id);
    this.s.assert(ctx, 'finance.benefit.verify', { projectId, classification: b.classification, workstreamId: b.workstreamId, requesterUserId: b.realizationRecordedBy });
    assertBenefitVerifiable({ status: b.status, ownerUserId: b.ownerUserId, realizationRecordedBy: b.realizationRecordedBy, verificationSource: b.verificationSource }, actorOf(ctx));
    const ev = await this.s.evidence(projectId, 'benefit', b.id);
    return this.apply(ctx, b, 'verify', body.expectedVersion, { verifiedBy: ctx.principal.userId, verifiedAt: this.s.clock.now(), verificationNote: body.note }, body.note, {
      verificationSource: b.verificationSource,
      activeEvidence: ev.active,
    });
  }

  async rejectRealization(ctx: RequestContext, projectId: string, id: string, body: { expectedVersion: number; note: string }) {
    const b = await loadInProject(this.s.db, T, projectId, id);
    this.s.assert(ctx, 'finance.benefit.verify', { projectId, classification: b.classification, workstreamId: b.workstreamId, requesterUserId: b.realizationRecordedBy });
    assertHumanActor(actorOf(ctx), 'Rejecting a benefit realization');
    return this.apply(ctx, b, 'reject_realization', body.expectedVersion, { realizationRecordedBy: null, realizationRecordedAt: null, realizedOn: null, statusNote: body.note }, body.note, { rejectedActualValue: b.actualValue });
  }

  async cancel(ctx: RequestContext, projectId: string, id: string, body: { expectedVersion: number; note: string }) {
    const b = await loadInProject(this.s.db, T, projectId, id);
    this.s.assert(ctx, 'finance.benefit.manage', { projectId, classification: b.classification, workstreamId: b.workstreamId });
    return this.apply(ctx, b, 'cancel', body.expectedVersion, { statusNote: body.note }, body.note);
  }
}
