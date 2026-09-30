import { Injectable } from '@nestjs/common';
import { and, asc, count, eq, ilike, ne, or, SQL } from 'drizzle-orm';
import { schema } from '@hub/db';
import {
  assertHumanActor,
  assertNotDeclassified,
  assertReconcilable,
  assertSameUnit,
  parseFinancialPeriod,
  parseMoney,
  reconciliationState,
  ruleViolation,
  FINANCE_DEFAULT_CLASSIFICATION,
  Classification,
  Money as DomainMoney,
  ReconciliationStatus,
} from '@hub/domain';
import type { RouteInput, financeRoutes } from '@hub/contracts';
import type { RequestContext } from '../../platform/context';
import { assertVersion, likeContains, loadInProject, nextCode, offsetOf, pageOf, updateVersioned } from '../../platform/helpers';
import { orderBySort } from '../../platform/sort';
import { newId } from '../../platform/ids';
import { FinanceSupport, iso, messagesOf, money, Money } from './finance.support';

type ReconRow = typeof schema.intercompanyReconciliation.$inferSelect;
const T = schema.intercompanyReconciliation;
type R = typeof financeRoutes;
const actorOf = (ctx: RequestContext) => ({ kind: ctx.principal.kind, userId: ctx.principal.userId });
const RANKS: Classification[] = ['public', 'internal', 'confidential', 'restricted', 'strictly_confidential'];

/**
 * Intercompany reconciliation between the parent and NewCo (REQ-FIN-004): our balance vs the counterparty's, in the same
 * currency and unit; any unreconciled difference is flagged; reconciling needs an explanation of a non-zero difference
 * and a human reviewer who did not prepare it.
 */
@Injectable()
export class ReconciliationsService {
  constructor(private readonly s: FinanceSupport) {}

  private our(r: ReconRow): Money {
    return money(r.ourBalance, r.currency, r.unitScale);
  }

  private their(r: ReconRow): Money | null {
    return r.theirBalance === null ? null : money(r.theirBalance, r.currency, r.unitScale);
  }

  dto(r: ReconRow) {
    const st = reconciliationState({ code: r.code, our: this.our(r), their: this.their(r), status: r.status as ReconciliationStatus });
    const notes = messagesOf(st.messages);
    return {
      id: r.id,
      code: r.code,
      financialSnapshotId: r.financialSnapshotId,
      counterpartyLabel: r.counterpartyLabel,
      period: r.period,
      ourBalance: this.our(r),
      theirBalance: this.their(r),
      difference: st.difference ? money(st.difference.amount, st.difference.currency, st.difference.unitScale) : null,
      status: r.status as ReconciliationStatus,
      flag: st.flag,
      unreconciled: st.unreconciled,
      notes: notes.en,
      notesI18n: notes.i18n,
      explanation: r.explanation,
      sourceRef: r.sourceRef,
      preparedBy: r.preparedBy,
      reviewerUserId: r.reviewerUserId,
      reviewedAt: iso(r.reviewedAt),
      classification: r.classification,
      isDemo: r.isDemo,
      createdAt: r.createdAt.toISOString(),
      version: r.version,
    };
  }

  scopeSql(ctx: RequestContext, projectId: string): SQL {
    return and(eq(T.projectId, projectId), this.s.visibleSql(ctx, projectId, { classification: T.classification }))!;
  }

  async list(ctx: RequestContext, projectId: string, q: RouteInput<R['listReconciliations']>['query']) {
    this.s.assertListable(ctx, projectId);
    const where = and(
      this.scopeSql(ctx, projectId),
      q.status ? eq(T.status, q.status) : undefined,
      q.unreconciled === 'true' ? ne(T.status, 'reconciled') : q.unreconciled === 'false' ? eq(T.status, 'reconciled') : undefined,
      q.q ? or(ilike(T.code, likeContains(q.q)), ilike(T.counterpartyLabel, likeContains(q.q))) : undefined,
    );
    const tx = this.s.db.tx();
    const [{ total }] = (await tx.select({ total: count() }).from(T).where(where)) as [{ total: number }];
    const order = orderBySort(q.sort, { code: T.code, period: T.period, status: T.status, updatedAt: T.updatedAt }, T.id, [asc(T.code), asc(T.id)]);
    const rows = await tx.select().from(T).where(where).orderBy(...order).limit(q.pageSize).offset(offsetOf(q));
    return pageOf(
      rows.map((r) => this.dto(r)),
      Number(total),
      q,
    );
  }

  /** Visible reconciliations of one figure (for the figure's detail view). */
  async forSnapshot(ctx: RequestContext, projectId: string, snapshotId: string) {
    const rows = await this.s.db.tx().select().from(T).where(and(this.scopeSql(ctx, projectId), eq(T.financialSnapshotId, snapshotId))).orderBy(asc(T.code));
    return rows.map((r) => this.dto(r));
  }

  private async load(ctx: RequestContext, projectId: string, id: string) {
    const r = await loadInProject(this.s.db, T, projectId, id);
    this.s.assertReadable(ctx, projectId, r);
    return r;
  }

  async get(ctx: RequestContext, projectId: string, id: string) {
    const r = await this.load(ctx, projectId, id);
    return { ...this.dto(r), people: await this.s.people([r.preparedBy, r.reviewerUserId, r.createdBy]) };
  }

  private async insert(
    ctx: RequestContext,
    projectId: string,
    v: { financialSnapshotId: string | null; counterpartyLabel: string; period: string; our: DomainMoney; their: DomainMoney | null; explanation: string | null; sourceRef: string; classification: Classification },
  ) {
    const p = await this.s.project(projectId);
    this.s.assertClassificationWritable(ctx, projectId, v.classification);
    this.s.assert(ctx, 'finance.budget.manage', { projectId, classification: v.classification });
    if (v.their) assertSameUnit(v.our, v.their, 'Counterparty balance');
    const id = newId();
    const code = await nextCode(this.s.db, T, projectId, 'IC');
    const [row] = await this.s.db
      .tx()
      .insert(T)
      .values({
        id,
        orgId: ctx.principal.orgId,
        projectId,
        code,
        financialSnapshotId: v.financialSnapshotId,
        counterpartyLabel: v.counterpartyLabel,
        period: v.period,
        ourBalance: v.our.amount,
        theirBalance: v.their?.amount ?? null,
        currency: v.our.currency,
        unitScale: v.our.unitScale,
        status: 'open',
        explanation: v.explanation,
        sourceRef: v.sourceRef,
        preparedBy: ctx.principal.userId,
        classification: v.classification,
        isDemo: p.isDemo,
        createdBy: ctx.principal.userId,
      })
      .returning();
    await this.s.snapshotVersion(projectId, 'intercompany_reconciliation', row!, 'created');
    const st = reconciliationState({ code, our: v.our, their: v.their, status: 'open' });
    await this.s.audit.record({
      action: 'finance.reconciliation.create',
      entityType: 'intercompany_reconciliation',
      entityId: id,
      projectId,
      after: { code, financialSnapshotId: v.financialSnapshotId, period: v.period, ourBalance: v.our, theirBalance: v.their, flag: st.flag },
    });
    return { id, code, version: 1 };
  }

  async create(ctx: RequestContext, projectId: string, body: RouteInput<R['createReconciliation']>['body']) {
    const our = parseMoney(body.ourBalance);
    return this.insert(ctx, projectId, {
      financialSnapshotId: null,
      counterpartyLabel: body.counterpartyLabel,
      period: parseFinancialPeriod(body.period).period,
      our,
      their: body.theirBalance ? parseMoney(body.theirBalance) : null,
      explanation: body.explanation ?? null,
      sourceRef: body.sourceRef,
      classification: body.classification ?? FINANCE_DEFAULT_CLASSIFICATION.intercompany_reconciliation,
    });
  }

  /** REQ-FIN-004 (`POST …/financial-snapshots/{id}/reconciliations`): our balance = the intercompany / opening balance figure. */
  async createForSnapshot(ctx: RequestContext, projectId: string, snapshotId: string, body: RouteInput<R['createSnapshotReconciliation']>['body']) {
    const snap = await loadInProject(this.s.db, schema.financialSnapshot, projectId, snapshotId);
    this.s.assertReadable(ctx, projectId, snap);
    if (!['intercompany', 'opening_balance', 'working_capital'].includes(snap.category)) {
      throw ruleViolation('finance.recon.category', `Only intercompany, opening balance or working capital figures are reconciled here (this one is ${snap.category})`);
    }
    // A reconciliation is at least as sensitive as the figure it reconciles (derived data, access-matrix §2.6).
    const base = FINANCE_DEFAULT_CLASSIFICATION.intercompany_reconciliation;
    const classification = RANKS.indexOf(snap.classification) >= RANKS.indexOf(base) ? snap.classification : base;
    return this.insert(ctx, projectId, {
      financialSnapshotId: snap.id,
      counterpartyLabel: body.counterpartyLabel,
      period: snap.period,
      our: money(snap.amount, snap.currency, snap.unitScale),
      their: body.theirBalance ? parseMoney(body.theirBalance) : null,
      explanation: body.explanation ?? null,
      sourceRef: body.sourceRef,
      classification,
    });
  }

  async update(ctx: RequestContext, projectId: string, id: string, body: RouteInput<R['updateReconciliation']>['body']) {
    const r = await loadInProject(this.s.db, T, projectId, id);
    this.s.assert(ctx, 'finance.budget.manage', { projectId, classification: r.classification });
    const changes: Record<string, unknown> = {};
    if (body.counterpartyLabel !== undefined && body.counterpartyLabel !== r.counterpartyLabel) changes['counterpartyLabel'] = body.counterpartyLabel;
    if (body.theirBalance !== undefined) {
      const their = body.theirBalance ? parseMoney(body.theirBalance) : null;
      if (their) assertSameUnit(this.our(r), their, 'Counterparty balance');
      if ((their?.amount ?? null) !== r.theirBalance) changes['theirBalance'] = their?.amount ?? null;
    }
    if (body.explanation !== undefined && (body.explanation ?? null) !== r.explanation) changes['explanation'] = body.explanation ?? null;
    if (body.sourceRef !== undefined && body.sourceRef !== r.sourceRef) changes['sourceRef'] = body.sourceRef;
    if (body.classification !== undefined && body.classification !== r.classification) {
      assertNotDeclassified(r.classification, body.classification, 'a reconciliation');
      this.s.assertClassificationWritable(ctx, projectId, body.classification);
      changes['classification'] = body.classification;
    }
    if (Object.keys(changes).length === 0) {
      assertVersion(r, body.expectedVersion, 'reconciliation');
      const st = reconciliationState({ code: r.code, our: this.our(r), their: this.their(r), status: r.status as ReconciliationStatus });
      return { id: r.id, status: r.status as ReconciliationStatus, flag: st.flag, version: r.version };
    }
    if (r.status === 'reconciled') throw ruleViolation('finance.recon.locked', 'A reconciled balance is locked: reopen it (with a reason) before changing it');
    if (Object.keys(changes).some((k) => k !== 'classification')) changes['preparedBy'] = ctx.principal.userId;
    const row = (await updateVersioned(this.s.db, T, { id: r.id, projectId, expectedVersion: body.expectedVersion }, changes)) as ReconRow;
    await this.s.snapshotVersion(projectId, 'intercompany_reconciliation', row, 'updated');
    const st = reconciliationState({ code: row.code, our: this.our(row), their: this.their(row), status: row.status as ReconciliationStatus });
    const cur = r as unknown as Record<string, unknown>;
    await this.s.audit.record({ action: 'finance.reconciliation.update', entityType: 'intercompany_reconciliation', entityId: r.id, projectId, before: Object.fromEntries(Object.keys(changes).map((k) => [k, cur[k]])), after: { ...changes, flag: st.flag } });
    return { id: r.id, status: row.status as ReconciliationStatus, flag: st.flag, version: row.version };
  }

  /** Reconciled only with the counterparty balance, an explanation of any difference and an independent human reviewer. */
  async reconcile(ctx: RequestContext, projectId: string, id: string, body: { expectedVersion: number; note?: string }) {
    const r = await loadInProject(this.s.db, T, projectId, id);
    this.s.assert(ctx, 'finance.snapshot.approve', { projectId, classification: r.classification, requesterUserId: r.preparedBy, withinAuthority: true });
    assertReconcilable({ our: this.our(r), their: this.their(r), status: r.status as ReconciliationStatus, explanation: r.explanation, preparedBy: r.preparedBy }, actorOf(ctx));
    return this.setStatus(ctx, r, 'reconciled', body.expectedVersion, { reviewerUserId: ctx.principal.userId, reviewedAt: this.s.clock.now() }, body.note ?? null);
  }

  async dispute(ctx: RequestContext, projectId: string, id: string, body: { expectedVersion: number; note: string }) {
    const r = await loadInProject(this.s.db, T, projectId, id);
    this.s.assert(ctx, 'finance.budget.manage', { projectId, classification: r.classification });
    if (r.status !== 'open') throw ruleViolation('finance.recon.invalid_state', `Only an open reconciliation can be disputed (this one is ${r.status})`);
    return this.setStatus(ctx, r, 'disputed', body.expectedVersion, {}, body.note);
  }

  async reopen(ctx: RequestContext, projectId: string, id: string, body: { expectedVersion: number; note: string }) {
    const r = await loadInProject(this.s.db, T, projectId, id);
    // Reopening is a role-level act (audited with a reason); the reconciliation then needs a fresh review.
    this.s.assertGranted(ctx, 'finance.snapshot.approve', { projectId, classification: r.classification });
    assertHumanActor(actorOf(ctx), 'Reopening a reconciliation');
    if (r.status === 'open') throw ruleViolation('finance.recon.invalid_state', 'The reconciliation is already open');
    return this.setStatus(ctx, r, 'open', body.expectedVersion, { reviewerUserId: null, reviewedAt: null }, body.note);
  }

  private async setStatus(ctx: RequestContext, r: ReconRow, status: ReconciliationStatus, expectedVersion: number, values: Record<string, unknown>, reason: string | null) {
    assertVersion(r, expectedVersion, 'reconciliation');
    const row = (await updateVersioned(this.s.db, T, { id: r.id, projectId: r.projectId, expectedVersion }, { status, ...values })) as ReconRow;
    const st = reconciliationState({ code: row.code, our: this.our(row), their: this.their(row), status });
    await this.s.snapshotVersion(r.projectId, 'intercompany_reconciliation', row, status);
    await this.s.audit.record({
      action: `finance.reconciliation.${status === 'open' ? 'reopen' : status === 'reconciled' ? 'reconcile' : 'dispute'}`,
      entityType: 'intercompany_reconciliation',
      entityId: r.id,
      projectId: r.projectId,
      before: { status: r.status },
      after: { status, flag: st.flag, difference: st.difference?.amount ?? null },
      reason,
    });
    void ctx;
    return { id: r.id, status, flag: st.flag, version: row.version };
  }
}
