import { Injectable } from '@nestjs/common';
import { and, count, eq, sql } from 'drizzle-orm';
import Decimal from 'decimal.js';
import { schema } from '@hub/db';
import { budgetPosition, reconciliationState, snapshotDoubleCountFindings, APPROVAL_STATES, BENEFIT_STATUSES, FINANCIAL_KINDS, RECONCILIATION_FLAGS, ReconciliationStatus } from '@hub/domain';
import type { RequestContext } from '../../platform/context';
import { FinanceSupport, messagesOf, money } from './finance.support';
import { SnapshotsService } from './snapshots.service';
import { BudgetService } from './budget.service';
import { ReconciliationsService } from './reconciliations.service';
import { ModelsService } from './models.service';
import { BenefitsService } from './benefits.service';
import { KpisService } from './kpis.service';

const zeroCounts = (keys: readonly string[]) => Object.fromEntries(keys.map((k) => [k, 0])) as Record<string, number>;

/**
 * Finance & value summary (screen 10). Every count and total is computed over rows filtered INSIDE SQL by the caller's
 * finance-domain clearance and workstream reach (lower clearance / other projects see nothing); money totals are grouped
 * per currency and unit scale — never added across them.
 */
@Injectable()
export class FinanceSummaryService {
  constructor(
    private readonly s: FinanceSupport,
    private readonly snapshots: SnapshotsService,
    private readonly budget: BudgetService,
    private readonly recon: ReconciliationsService,
    private readonly models: ModelsService,
    private readonly benefits: BenefitsService,
    private readonly kpis: KpisService,
  ) {}

  async get(ctx: RequestContext, projectId: string) {
    this.s.assertListable(ctx, projectId);
    const tx = this.s.db.tx();

    const S = schema.financialSnapshot;
    const snaps = await tx.select({ kind: S.kind, approvalState: S.approvalState, lineRef: S.lineRef, category: S.category }).from(S).where(this.snapshots.scopeSql(ctx, projectId));
    const byKind = zeroCounts(FINANCIAL_KINDS);
    const byState = zeroCounts(APPROVAL_STATES);
    for (const r of snaps) {
      byKind[r.kind] = (byKind[r.kind] ?? 0) + 1;
      byState[r.approvalState] = (byState[r.approvalState] ?? 0) + 1;
    }

    const B = schema.budgetLine;
    const lines = await tx.select().from(B).where(this.budget.scopeSql(ctx, projectId));
    const groups = new Map<string, { currency: string; unitScale: number; lineCount: number; approved: Decimal; committed: Decimal; spent: Decimal }>();
    let flaggedLines = 0;
    for (const l of lines) {
      const pos = budgetPosition({
        approved: l.approvedAmount === null ? null : money(l.approvedAmount, l.currency, l.unitScale),
        committed: money(l.committedAmount, l.currency, l.unitScale),
        spent: money(l.spentAmount, l.currency, l.unitScale),
      });
      if (pos.flags.some((f) => f.code !== 'finance.budget.no_approved_budget')) flaggedLines++;
      const k = `${l.currency}|${l.unitScale}`;
      const g = groups.get(k) ?? { currency: l.currency, unitScale: l.unitScale, lineCount: 0, approved: new Decimal(0), committed: new Decimal(0), spent: new Decimal(0) };
      g.lineCount++;
      if (l.approvedAmount !== null) g.approved = g.approved.add(l.approvedAmount);
      g.committed = g.committed.add(l.committedAmount);
      g.spent = g.spent.add(l.spentAmount);
      groups.set(k, g);
    }

    const I = schema.intercompanyReconciliation;
    const recons = await tx.select().from(I).where(this.recon.scopeSql(ctx, projectId));
    const byFlag = zeroCounts(RECONCILIATION_FLAGS);
    const diffs = new Map<string, { currency: string; unitScale: number; amount: Decimal; count: number }>();
    let unreconciled = 0;
    for (const r of recons) {
      const st = reconciliationState({
        code: r.code,
        our: money(r.ourBalance, r.currency, r.unitScale),
        their: r.theirBalance === null ? null : money(r.theirBalance, r.currency, r.unitScale),
        status: r.status as ReconciliationStatus,
      });
      byFlag[st.flag] = (byFlag[st.flag] ?? 0) + 1;
      if (st.unreconciled) {
        unreconciled++;
        if (st.difference && !new Decimal(st.difference.amount).isZero()) {
          const k = `${r.currency}|${r.unitScale}`;
          const d = diffs.get(k) ?? { currency: r.currency, unitScale: r.unitScale, amount: new Decimal(0), count: 0 };
          d.amount = d.amount.add(st.difference.amount);
          d.count++;
          diffs.set(k, d);
        }
      }
    }

    const BE = schema.benefit;
    const benefitRows = await tx.select({ status: BE.status, n: count() }).from(BE).where(this.benefits.scopeSql(ctx, projectId)).groupBy(BE.status);
    const byStatus = zeroCounts(BENEFIT_STATUSES);
    let benefitsTotal = 0;
    for (const b of benefitRows) {
      byStatus[b.status] = Number(b.n);
      benefitsTotal += Number(b.n);
    }
    const [kpiCount] = (await tx.select({ n: count() }).from(schema.kpi).where(this.kpis.scopeSql(ctx, projectId))) as [{ n: number }];
    const findings = messagesOf(snapshotDoubleCountFindings(snaps));
    const fx = (d: Decimal) => d.toFixed(4);

    return {
      snapshots: { total: snaps.length, byKind, byState },
      budget: {
        lines: lines.length,
        flaggedLines,
        groups: [...groups.values()]
          .sort((a, b) => a.currency.localeCompare(b.currency) || a.unitScale - b.unitScale)
          .map((g) => ({
            currency: g.currency,
            unitScale: g.unitScale,
            lineCount: g.lineCount,
            approved: money(fx(g.approved), g.currency, g.unitScale),
            committed: money(fx(g.committed), g.currency, g.unitScale),
            spent: money(fx(g.spent), g.currency, g.unitScale),
            openCommitment: money(fx(g.committed.sub(g.spent)), g.currency, g.unitScale),
          })),
      },
      intercompany: {
        total: recons.length,
        unreconciled,
        byFlag,
        differences: [...diffs.values()].sort((a, b) => a.currency.localeCompare(b.currency) || a.unitScale - b.unitScale).map((d) => ({ currency: d.currency, unitScale: d.unitScale, amount: fx(d.amount), count: d.count })),
      },
      models: await this.models.counts(ctx, projectId),
      benefits: { total: benefitsTotal, byStatus },
      kpis: { total: Number(kpiCount.n) },
      findings: findings.en,
      findingsI18n: findings.i18n,
    };
    void and;
    void eq;
    void sql;
  }
}
