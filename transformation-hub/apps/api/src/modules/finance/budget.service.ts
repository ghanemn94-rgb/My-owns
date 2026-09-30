import { Injectable } from '@nestjs/common';
import { and, asc, count, eq, ilike, inArray, ne, or, SQL } from 'drizzle-orm';
import { schema } from '@hub/db';
import {
  assertNonNegative,
  assertNotDeclassified,
  assertSameUnit,
  assertTsaLink,
  budgetPosition,
  compareMoney,
  conflict,
  invalid,
  parseMoney,
  ruleViolation,
  separationCostView,
  BUDGET_DECISION_TYPE_KEYS,
  FINANCE_DEFAULT_CLASSIFICATION,
  SEPARATION_COST_CATEGORIES,
} from '@hub/domain';
import type { RouteInput, financeRoutes } from '@hub/contracts';
import type { RequestContext } from '../../platform/context';
import { assertVersion, likeContains, loadInProject, nextCode, offsetOf, pageOf, updateVersioned } from '../../platform/helpers';
import { orderBySort } from '../../platform/sort';
import { newId } from '../../platform/ids';
import { FinanceSupport, iso, messagesOf, money, moneyOrNull, Money } from './finance.support';

type LineRow = typeof schema.budgetLine.$inferSelect;
const T = schema.budgetLine;
type R = typeof financeRoutes;

/**
 * Budget lines (REQ-FIN-003): the approved amount comes only from a FINAL governance decision (change control), while
 * commitments and spend are recorded separately, as of a business date and with their source, in the line's own currency
 * AND unit scale. Separation cost view (REQ-FIN-002): each TSA charge is counted once across the TSA and cost views.
 */
@Injectable()
export class BudgetService {
  constructor(private readonly s: FinanceSupport) {}

  private figures(r: LineRow) {
    return {
      approved: moneyOrNull(r.approvedAmount, r.currency, r.approvedAmount === null ? null : r.unitScale),
      committed: money(r.committedAmount, r.currency, r.unitScale),
      spent: money(r.spentAmount, r.currency, r.unitScale),
    };
  }

  dto(r: LineRow) {
    const f = this.figures(r);
    const pos = budgetPosition(f);
    const flags = messagesOf(pos.flags);
    return {
      id: r.id,
      code: r.code,
      name: r.name,
      category: r.category,
      workstreamId: r.workstreamId,
      tsaServiceId: r.tsaServiceId,
      currency: r.currency,
      unitScale: r.unitScale,
      proposed: moneyOrNull(r.proposedAmount, r.currency, r.proposedAmount === null ? null : r.unitScale),
      approved: f.approved,
      committed: f.committed,
      spent: f.spent,
      openCommitment: money(pos.openCommitment.amount, r.currency, r.unitScale),
      uncommitted: pos.uncommitted ? money(pos.uncommitted.amount, r.currency, r.unitScale) : null,
      flags: flags.en,
      flagsI18n: flags.i18n,
      actualsAsOf: r.actualsAsOf,
      actualsSourceRef: r.actualsSourceRef,
      approvalState: r.approvalState,
      approvalDecisionId: r.approvalDecisionId,
      approvedBy: r.approvedBy,
      approvedAt: iso(r.approvedAt),
      sourceRef: r.sourceRef,
      classification: r.classification,
      isDemo: r.isDemo,
      createdAt: r.createdAt.toISOString(),
      version: r.version,
    };
  }

  scopeSql(ctx: RequestContext, projectId: string): SQL {
    return and(eq(T.projectId, projectId), this.s.visibleSql(ctx, projectId, { classification: T.classification, workstream: T.workstreamId }))!;
  }

  async list(ctx: RequestContext, projectId: string, q: RouteInput<R['listBudgetLines']>['query']) {
    this.s.assertListable(ctx, projectId);
    const where = and(
      this.scopeSql(ctx, projectId),
      q.category ? eq(T.category, q.category) : undefined,
      q.workstreamId ? eq(T.workstreamId, q.workstreamId) : undefined,
      q.approvalState ? eq(T.approvalState, q.approvalState) : undefined,
      q.q ? or(ilike(T.name, likeContains(q.q)), ilike(T.code, likeContains(q.q))) : undefined,
    );
    const tx = this.s.db.tx();
    const [{ total }] = (await tx.select({ total: count() }).from(T).where(where)) as [{ total: number }];
    const order = orderBySort(q.sort, { code: T.code, name: T.name, category: T.category, updatedAt: T.updatedAt }, T.id, [asc(T.code), asc(T.id)]);
    const rows = await tx.select().from(T).where(where).orderBy(...order).limit(q.pageSize).offset(offsetOf(q));
    return pageOf(
      rows.map((r) => this.dto(r)),
      Number(total),
      q,
    );
  }

  async get(ctx: RequestContext, projectId: string, id: string) {
    const r = await loadInProject(this.s.db, T, projectId, id);
    this.s.assertReadable(ctx, projectId, r);
    let tsa: { id: string; code: string; name: string; charge: Money | null } | null = null;
    if (r.tsaServiceId) {
      const t = await loadInProject(this.s.db, schema.tsaService, projectId, r.tsaServiceId);
      if (this.s.canReadTsa(ctx, projectId, t)) tsa = { id: t.id, code: t.code, name: t.name, charge: moneyOrNull(t.chargeAmount, t.chargeCurrency, t.chargeUnitScale) };
    }
    return { ...this.dto(r), tsa, people: await this.s.people([r.createdBy, r.approvedBy]) };
  }

  /** A TSA charge line links a visible TSA service not yet carried by another line (one line per TSA). */
  private async assertTsaFree(ctx: RequestContext, projectId: string, tsaServiceId: string, excludeId?: string) {
    await this.s.tsa(ctx, projectId, tsaServiceId);
    const [other] = await this.s.db
      .tx()
      .select({ id: T.id })
      .from(T)
      .where(and(eq(T.projectId, projectId), eq(T.tsaServiceId, tsaServiceId), excludeId ? ne(T.id, excludeId) : undefined));
    if (other) throw conflict('finance.budget.tsa_already_counted', 'This TSA charge is already carried by another budget line — a TSA charge is counted once');
  }

  async create(ctx: RequestContext, projectId: string, body: RouteInput<R['createBudgetLine']>['body']) {
    const p = await this.s.project(projectId);
    const classification = body.classification ?? FINANCE_DEFAULT_CLASSIFICATION.budget_line;
    this.s.assertClassificationWritable(ctx, projectId, classification);
    this.s.assert(ctx, 'finance.budget.manage', { projectId, classification, workstreamId: body.workstreamId ?? null });
    const unit = { currency: body.currency, unitScale: body.unitScale };
    const m = (a: string | undefined) => (a === undefined ? null : parseMoney({ amount: a, ...unit }));
    const proposed = m(body.proposedAmount);
    const committed = m(body.committedAmount) ?? parseMoney({ amount: '0', ...unit });
    const spent = m(body.spentAmount) ?? parseMoney({ amount: '0', ...unit });
    assertNonNegative(proposed, 'proposedAmount');
    assertNonNegative(committed, 'committedAmount');
    assertNonNegative(spent, 'spentAmount');
    const hasActuals = compareMoney(committed, parseMoney({ amount: '0', ...unit })) !== 0 || compareMoney(spent, parseMoney({ amount: '0', ...unit })) !== 0;
    if (hasActuals && (!body.actualsAsOf || !body.actualsSourceRef?.trim())) {
      throw invalid('finance.budget.actuals_source_required', 'Commitments and spend are recorded as of a date and with their source');
    }
    if (body.actualsAsOf && body.actualsAsOf > this.s.today(p)) throw ruleViolation('finance.budget.actuals_in_future', 'Commitments / spend cannot be recorded as of a future date');
    assertTsaLink(body.category, body.tsaServiceId ?? null);
    if (body.tsaServiceId) await this.assertTsaFree(ctx, projectId, body.tsaServiceId);
    await this.s.workstream(projectId, body.workstreamId);
    const id = newId();
    const code = await nextCode(this.s.db, T, projectId, 'BL');
    const [row] = await this.s.db
      .tx()
      .insert(T)
      .values({
        id,
        orgId: ctx.principal.orgId,
        projectId,
        code,
        name: body.name,
        category: body.category,
        proposedAmount: proposed?.amount ?? null,
        committedAmount: committed.amount,
        spentAmount: spent.amount,
        currency: body.currency,
        unitScale: body.unitScale,
        actualsAsOf: body.actualsAsOf ?? null,
        actualsSourceRef: body.actualsSourceRef ?? null,
        tsaServiceId: body.tsaServiceId ?? null,
        workstreamId: body.workstreamId ?? null,
        sourceRef: body.sourceRef ?? null,
        classification,
        isDemo: p.isDemo,
        createdBy: ctx.principal.userId,
      })
      .returning();
    await this.s.snapshotVersion(projectId, 'budget_line', row!, 'created');
    await this.s.audit.record({ action: 'finance.budget.create', entityType: 'budget_line', entityId: id, projectId, after: { code, name: body.name, category: body.category, currency: body.currency, unitScale: body.unitScale, proposed, committed, spent, tsaServiceId: body.tsaServiceId ?? null } });
    return { id, code, version: 1 };
  }

  async update(ctx: RequestContext, projectId: string, id: string, body: RouteInput<R['updateBudgetLine']>['body']) {
    const r = await loadInProject(this.s.db, T, projectId, id);
    this.s.assert(ctx, 'finance.budget.manage', { projectId, classification: r.classification, workstreamId: r.workstreamId });
    const changes: Record<string, unknown> = {};
    if (body.name !== undefined && body.name !== r.name) changes['name'] = body.name;
    if (body.proposedAmount !== undefined) {
      const pm = body.proposedAmount ? parseMoney(body.proposedAmount) : null;
      if (pm) {
        assertSameUnit({ currency: r.currency, unitScale: r.unitScale }, pm, `Budget line ${r.code}`);
        assertNonNegative(pm, 'proposedAmount');
      }
      if ((pm?.amount ?? null) !== r.proposedAmount) changes['proposedAmount'] = pm?.amount ?? null;
    }
    if (body.workstreamId !== undefined && (body.workstreamId ?? null) !== r.workstreamId) {
      await this.s.workstream(projectId, body.workstreamId);
      if (body.workstreamId) this.s.assert(ctx, 'finance.budget.manage', { projectId, classification: r.classification, workstreamId: body.workstreamId });
      changes['workstreamId'] = body.workstreamId ?? null;
    }
    if (body.sourceRef !== undefined && (body.sourceRef ?? null) !== r.sourceRef) changes['sourceRef'] = body.sourceRef ?? null;
    if (body.classification !== undefined && body.classification !== r.classification) {
      assertNotDeclassified(r.classification, body.classification, 'a budget line');
      this.s.assertClassificationWritable(ctx, projectId, body.classification);
      changes['classification'] = body.classification;
    }
    if (Object.keys(changes).length === 0) {
      assertVersion(r, body.expectedVersion, 'budget line');
      return { id: r.id, version: r.version };
    }
    const row = (await updateVersioned(this.s.db, T, { id: r.id, projectId, expectedVersion: body.expectedVersion }, changes)) as LineRow;
    await this.s.snapshotVersion(projectId, 'budget_line', row, 'updated');
    const cur = r as unknown as Record<string, unknown>;
    await this.s.audit.record({ action: 'finance.budget.update', entityType: 'budget_line', entityId: r.id, projectId, before: Object.fromEntries(Object.keys(changes).map((k) => [k, cur[k]])), after: changes });
    return { id: r.id, version: row.version };
  }

  /** REQ-FIN-003: commitments and spend recorded separately, in the line's currency AND unit scale (AT-29), with source. */
  async recordActuals(ctx: RequestContext, projectId: string, id: string, body: RouteInput<R['recordBudgetActuals']>['body']) {
    const r = await loadInProject(this.s.db, T, projectId, id);
    this.s.assert(ctx, 'finance.budget.manage', { projectId, classification: r.classification, workstreamId: r.workstreamId });
    if (!body.committed && !body.spent) throw invalid('finance.budget.actuals_required', 'Record the committed and/or spent amount');
    const unit = { currency: r.currency, unitScale: r.unitScale };
    const values: Record<string, unknown> = {};
    for (const [k, v] of [
      ['committedAmount', body.committed],
      ['spentAmount', body.spent],
    ] as const) {
      if (!v) continue;
      const m = parseMoney(v);
      assertSameUnit(unit, m, `Budget line ${r.code}`);
      assertNonNegative(m, k);
      values[k] = m.amount;
    }
    const p = await this.s.project(projectId);
    if (body.asOf > this.s.today(p)) throw ruleViolation('finance.budget.actuals_in_future', 'Commitments / spend cannot be recorded as of a future date');
    if (r.actualsAsOf && body.asOf < r.actualsAsOf) throw ruleViolation('finance.budget.actuals_backdated', `The line already carries figures as of ${r.actualsAsOf}; record a later position`, { actualsAsOf: r.actualsAsOf });
    values['actualsAsOf'] = body.asOf;
    values['actualsSourceRef'] = body.sourceRef;
    const row = (await updateVersioned(this.s.db, T, { id: r.id, projectId, expectedVersion: body.expectedVersion }, values)) as LineRow;
    await this.s.snapshotVersion(projectId, 'budget_line', row, 'actuals recorded');
    const pos = budgetPosition(this.figures(row));
    await this.s.audit.record({
      action: 'finance.budget.record_actuals',
      entityType: 'budget_line',
      entityId: r.id,
      projectId,
      before: { committedAmount: r.committedAmount, spentAmount: r.spentAmount, actualsAsOf: r.actualsAsOf },
      after: { ...values, flags: pos.flags.map((f) => f.code) },
      reason: body.note ?? null,
    });
    return { id: r.id, version: row.version };
  }

  /**
   * The approved budget is RECORDED from a final governance decision (baseline / budget change / spend commitment) —
   * never set by this module on its own. The amount must be in the line's currency and unit and within the decision's
   * amount when the decision paper states one in the same currency / unit.
   */
  async recordApproval(ctx: RequestContext, projectId: string, id: string, body: RouteInput<R['recordBudgetApproval']>['body']) {
    const r = await loadInProject(this.s.db, T, projectId, id);
    this.s.assert(ctx, 'finance.budget.manage', { projectId, classification: r.classification, workstreamId: r.workstreamId });
    const d = await this.s.decision(ctx, projectId, body.decisionId);
    const issue = this.s.decisionIssue(d, BUDGET_DECISION_TYPE_KEYS, `the approved budget of ${r.code}`);
    if (issue.issue) throw ruleViolation('finance.budget.decision_not_final', issue.issue, { decisionId: d.id, issueCode: issue.code });
    const approved = parseMoney(body.approvedAmount);
    assertSameUnit({ currency: r.currency, unitScale: r.unitScale }, approved, `Budget line ${r.code}`);
    assertNonNegative(approved, 'approvedAmount');
    if (d.amountAmount !== null && d.amountCurrency && d.amountUnitScale) {
      const decided = money(d.amountAmount, d.amountCurrency, d.amountUnitScale);
      if (decided.currency !== approved.currency || decided.unitScale !== approved.unitScale) {
        throw ruleViolation('finance.budget.decision_unit_mismatch', `Decision ${d.code} states its amount in ${decided.currency} / unit scale ${decided.unitScale}; the line is kept in ${r.currency} / unit scale ${r.unitScale} — no conversion is applied`, {
          decisionCurrency: decided.currency,
          decisionUnitScale: decided.unitScale,
        });
      }
      if (compareMoney(approved, decided) > 0) throw ruleViolation('finance.budget.exceeds_decision', `The approved amount exceeds the amount of decision ${d.code}`, { decisionAmount: decided.amount });
    }
    if (r.approvalDecisionId === d.id) throw conflict('finance.budget.decision_already_recorded', 'This decision is already recorded as the line’s approval; a change needs a new decision');
    assertVersion(r, body.expectedVersion, 'budget line');
    const row = (await updateVersioned(this.s.db, T, { id: r.id, projectId, expectedVersion: body.expectedVersion }, {
      approvedAmount: approved.amount,
      approvalDecisionId: d.id,
      approvedBy: ctx.principal.userId,
      approvedAt: this.s.clock.now(),
      approvalState: 'approved',
    })) as LineRow;
    await this.s.snapshotVersion(projectId, 'budget_line', row, 'approval recorded');
    await this.s.audit.record({
      action: 'finance.budget.record_approval',
      entityType: 'budget_line',
      entityId: r.id,
      projectId,
      before: { approvedAmount: r.approvedAmount, approvalDecisionId: r.approvalDecisionId },
      after: { approvedAmount: approved.amount, currency: r.currency, unitScale: r.unitScale, decisionId: d.id, decisionCode: d.code },
      reason: body.note ?? null,
    });
    return { id: r.id, version: row.version, approvalState: row.approvalState };
  }

  // ---------------------------------------------------------------------------------------------------------
  // Separation cost view (REQ-FIN-002)

  async separationCosts(ctx: RequestContext, projectId: string) {
    this.s.assertListable(ctx, projectId);
    const tx = this.s.db.tx();
    const lines = await tx
      .select()
      .from(T)
      .where(and(this.scopeSql(ctx, projectId), inArray(T.category, [...SEPARATION_COST_CATEGORIES])))
      .orderBy(asc(T.code));
    // TSA register (readiness module, read-only): the TSAs the caller may read (classification + workstream reach).
    const TS = schema.tsaService;
    const tsas = await tx
      .select({ id: TS.id, code: TS.code, name: TS.name, amount: TS.chargeAmount, currency: TS.chargeCurrency, unitScale: TS.chargeUnitScale })
      .from(TS)
      .where(and(eq(TS.projectId, projectId), this.s.policy.visibilitySql(ctx, projectId, { classification: TS.classification }), this.s.policy.reachSql(ctx, 'readiness.register.read', projectId, TS.workstreamId)))
      .orderBy(asc(TS.code));
    const view = separationCostView(
      lines.map((l) => ({ id: l.id, code: l.code, category: l.category, tsaServiceId: l.tsaServiceId, ...this.figures(l) })),
      tsas.map((t) => ({ id: t.id, code: t.code, charge: moneyOrNull(t.amount, t.currency, t.unitScale) })),
    );
    const names = new Map(tsas.map((t) => [t.id, t.name]));
    const findings = messagesOf(view.findings);
    return {
      categories: [...SEPARATION_COST_CATEGORIES],
      groups: view.groups.map((g) => ({ ...g, approved: money(g.approved.amount, g.currency, g.unitScale), committed: money(g.committed.amount, g.currency, g.unitScale), spent: money(g.spent.amount, g.currency, g.unitScale) })),
      tsa: view.tsa.map((t) => {
        const n = messagesOf(t.messages);
        return {
          tsaServiceId: t.tsaServiceId,
          tsaCode: t.tsaCode,
          tsaName: names.get(t.tsaServiceId) ?? t.tsaCode,
          registerCharge: t.registerCharge ? money(t.registerCharge.amount, t.registerCharge.currency, t.registerCharge.unitScale) : null,
          budgetLineId: t.budgetLineId,
          budgetLineCode: t.budgetLineCode,
          countedIn: t.countedIn,
          notes: n.en,
          notesI18n: n.i18n,
        };
      }),
      findings: findings.en,
      findingsI18n: findings.i18n,
    };
  }
}
