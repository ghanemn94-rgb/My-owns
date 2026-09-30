import { Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, ilike, inArray, or, SQL } from 'drizzle-orm';
import Decimal from 'decimal.js';
import { schema } from '@hub/db';
import { invalid, parseFinancialPeriod, FINANCE_DEFAULT_CLASSIFICATION } from '@hub/domain';
import type { RouteInput, financeRoutes } from '@hub/contracts';
import type { RequestContext } from '../../platform/context';
import { likeContains, loadInProject, offsetOf, pageOf } from '../../platform/helpers';
import { orderBySort } from '../../platform/sort';
import { newId } from '../../platform/ids';
import { FinanceSupport } from './finance.support';

type KpiRow = typeof schema.kpi.$inferSelect;
type ObsRow = typeof schema.kpiObservation.$inferSelect;
const K = schema.kpi;
const O = schema.kpiObservation;
type R = typeof financeRoutes;
type Quality = 'ok' | 'incomplete' | 'stale' | 'unknown';

/**
 * KPI definitions and manual observations (spec §11 KPI fields; REQ-FIN-009 entity KPIObservation). Observations are
 * append-only (a correction is a new observation) and keep their source; a ratio is computed deterministically from its
 * numerator and denominator (never estimated).
 */
@Injectable()
export class KpisService {
  constructor(private readonly s: FinanceSupport) {}

  private obsDto(o: ObsRow) {
    return {
      id: o.id,
      period: o.period,
      value: o.value,
      numerator: o.numerator,
      denominator: o.denominator,
      dataQuality: o.dataQuality as Quality,
      sourceRef: o.sourceRef,
      note: o.note,
      computedAt: o.computedAt.toISOString(),
      computedBy: o.computedBy,
      recordedBy: o.recordedBy,
    };
  }

  private dto(k: KpiRow, latest: ObsRow | null, isDemo: boolean) {
    return {
      id: k.id,
      key: k.key,
      name: k.name,
      nameAr: k.nameAr,
      definition: k.definition,
      formula: k.formula,
      unit: k.unit,
      period: k.period,
      ownerRole: k.ownerRole,
      ownerUserId: k.ownerUserId,
      benefitId: k.benefitId,
      source: k.source,
      target: k.target,
      thresholds: k.thresholds,
      direction: k.direction,
      frequency: k.frequency,
      computation: k.computation,
      verificationStatus: k.verificationStatus,
      classification: k.classification,
      isDemo,
      createdAt: k.createdAt.toISOString(),
      version: k.version,
      latestObservation: latest ? this.obsDto(latest) : null,
    };
  }

  scopeSql(ctx: RequestContext, projectId: string): SQL {
    return and(eq(K.projectId, projectId), this.s.visibleSql(ctx, projectId, { classification: K.classification }))!;
  }

  private async latest(projectId: string, ids: string[]) {
    if (!ids.length) return new Map<string, ObsRow>();
    const rows = await this.s.db.tx().select().from(O).where(and(eq(O.projectId, projectId), inArray(O.kpiId, ids))).orderBy(desc(O.computedAt), desc(O.id));
    const out = new Map<string, ObsRow>();
    for (const r of rows) if (!out.has(r.kpiId)) out.set(r.kpiId, r);
    return out;
  }

  async list(ctx: RequestContext, projectId: string, q: RouteInput<R['listKpis']>['query']) {
    const p = await this.s.project(projectId);
    this.s.assertListable(ctx, projectId);
    const where = and(this.scopeSql(ctx, projectId), q.benefitId ? eq(K.benefitId, q.benefitId) : undefined, q.q ? or(ilike(K.name, likeContains(q.q)), ilike(K.key, likeContains(q.q))) : undefined);
    const tx = this.s.db.tx();
    const [{ total }] = (await tx.select({ total: count() }).from(K).where(where)) as [{ total: number }];
    const order = orderBySort(q.sort, { key: K.key, name: K.name, updatedAt: K.updatedAt }, K.id, [asc(K.key), asc(K.id)]);
    const rows = await tx.select().from(K).where(where).orderBy(...order).limit(q.pageSize).offset(offsetOf(q));
    const latest = await this.latest(
      projectId,
      rows.map((r) => r.id),
    );
    return pageOf(
      rows.map((k) => this.dto(k, latest.get(k.id) ?? null, p.isDemo)),
      Number(total),
      q,
    );
  }

  async get(ctx: RequestContext, projectId: string, id: string) {
    const k = await loadInProject(this.s.db, K, projectId, id);
    this.s.assertReadable(ctx, projectId, k);
    const p = await this.s.project(projectId);
    const obs = await this.s.db.tx().select().from(O).where(and(eq(O.projectId, projectId), eq(O.kpiId, k.id))).orderBy(desc(O.computedAt), desc(O.id)).limit(100);
    return { ...this.dto(k, obs[0] ?? null, p.isDemo), observations: obs.map((o) => this.obsDto(o)), people: await this.s.people([k.ownerUserId, k.createdBy, ...obs.map((o) => o.recordedBy)]) };
  }

  async create(ctx: RequestContext, projectId: string, body: RouteInput<R['createKpi']>['body']) {
    const classification = body.classification ?? FINANCE_DEFAULT_CLASSIFICATION.kpi;
    this.s.assertClassificationWritable(ctx, projectId, classification);
    this.s.assert(ctx, 'finance.kpi.manage', { projectId, classification });
    if (body.ownerUserId) await this.s.assertMember(projectId, body.ownerUserId, 'ownerUserId');
    if (body.benefitId) {
      const b = await loadInProject(this.s.db, schema.benefit, projectId, body.benefitId);
      this.s.assertReadable(ctx, projectId, b);
    }
    const id = newId();
    const [row] = await this.s.db
      .tx()
      .insert(K)
      .values({
        id,
        orgId: ctx.principal.orgId,
        projectId,
        key: body.key,
        name: body.name,
        nameAr: body.nameAr ?? null,
        definition: body.definition,
        formula: body.formula,
        unit: body.unit,
        period: body.period,
        ownerUserId: body.ownerUserId ?? null,
        benefitId: body.benefitId ?? null,
        source: body.source,
        target: body.target ?? null,
        thresholds: body.thresholds,
        direction: body.direction,
        frequency: body.frequency,
        classification,
        createdBy: ctx.principal.userId,
      })
      .returning();
    await this.s.snapshotVersion(projectId, 'kpi', row!, 'created');
    await this.s.audit.record({ action: 'finance.kpi.create', entityType: 'kpi', entityId: id, projectId, after: { key: body.key, name: body.name, unit: body.unit, benefitId: body.benefitId ?? null } });
    return { id, version: 1 };
  }

  async observe(ctx: RequestContext, projectId: string, kpiId: string, body: RouteInput<R['recordKpiObservation']>['body']) {
    const k = await loadInProject(this.s.db, K, projectId, kpiId);
    this.s.assert(ctx, 'finance.kpi.manage', { projectId, classification: k.classification });
    const period = parseFinancialPeriod(body.period).period;
    let value = body.value ?? null;
    if ((body.numerator === undefined) !== (body.denominator === undefined)) throw invalid('finance.kpi.ratio_incomplete', 'A ratio needs both its numerator and its denominator');
    if (body.numerator !== undefined && body.denominator !== undefined) {
      const den = new Decimal(body.denominator);
      if (den.isZero()) throw invalid('finance.kpi.zero_denominator', 'The denominator cannot be zero');
      const computed = new Decimal(body.numerator).div(den).toFixed(4);
      if (value !== null && new Decimal(value).toFixed(4) !== computed) throw invalid('finance.kpi.value_mismatch', 'The value does not equal numerator / denominator');
      value = computed;
    }
    if (value === null) throw invalid('finance.kpi.value_required', 'Record the value (or its numerator and denominator)');
    const id = newId();
    await this.s.db
      .tx()
      .insert(O)
      .values({
        id,
        orgId: ctx.principal.orgId,
        projectId,
        kpiId: k.id,
        period,
        value: new Decimal(value).toFixed(4),
        numerator: body.numerator ?? null,
        denominator: body.denominator ?? null,
        dataQuality: body.dataQuality,
        sourceRef: body.sourceRef,
        note: body.note ?? null,
        computedBy: 'manual',
        recordedBy: ctx.principal.userId,
      });
    await this.s.audit.record({ action: 'finance.kpi.observe', entityType: 'kpi', entityId: k.id, projectId, after: { observationId: id, period, value, dataQuality: body.dataQuality, sourceRef: body.sourceRef } });
    return { id };
  }
}
