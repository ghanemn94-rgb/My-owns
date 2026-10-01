import { Injectable } from '@nestjs/common';
import { and, count, eq } from 'drizzle-orm';
import { schema } from '@hub/db';
import { assessTsaExpiry, uncoveredReadinessAreas } from '@hub/domain';
import type { RequestContext } from '../../platform/context';
import { ReadinessSupport } from './readiness.support';
import { ReadinessChecksService, waiverEffectiveFor } from './checks.service';
import { TsaService, TSA_EXPIRY_WARN_DAYS } from './tsa.service';

/**
 * Day-1 & TSA Center summary. Every count is computed in SQL inside the caller's scope (visibility + workstream reach),
 * so totals never include records the caller cannot see (ARCH-02 / ARCH-14).
 */
@Injectable()
export class ReadinessSummaryService {
  constructor(
    private readonly s: ReadinessSupport,
    private readonly checks: ReadinessChecksService,
    private readonly tsa: TsaService,
  ) {}

  async get(ctx: RequestContext, projectId: string) {
    const p = await this.s.project(projectId);
    this.s.assertListable(ctx, projectId);
    const tx = this.s.db.tx();
    const c = schema.readinessCheck;
    const byStatus = await tx.select({ status: c.status, n: count() }).from(c).where(this.checks.scopeSql(ctx, projectId)).groupBy(c.status);
    // DOM-P3-16: the same rule as the GO evaluation — a waived blocker is cleared only while its waiver is effective
    // (approved, unexpired, waivable check); a passed one only while its sign-off evidence is valid (DOM-P3-09).
    const today = this.s.today(p);
    const blockers = await tx
      .select({ id: c.id, status: c.status, waivable: c.waivable, waiverId: c.waiverId, w: schema.waiver })
      .from(c)
      .leftJoin(schema.waiver, and(eq(schema.waiver.id, c.waiverId), eq(schema.waiver.projectId, c.projectId)))
      .where(and(this.checks.scopeSql(ctx, projectId), eq(c.blocker, true)));
    const evidenceValid = await this.s.signoffEvidenceValid(projectId, blockers.filter((b) => b.status === 'passed').map((b) => b.id));
    const cleared = (b: (typeof blockers)[number]) =>
      b.status === 'not_applicable' || (b.status === 'passed' && evidenceValid.get(b.id) === true) || (b.status === 'waived' && waiverEffectiveFor(b, b.w, today));
    const blk = { open: blockers.filter((b) => !cleared(b)).length, failed: blockers.filter((b) => b.status === 'failed').length };
    const areas = await tx.selectDistinct({ area: c.area }).from(c).where(this.checks.scopeSql(ctx, projectId));

    const cp = schema.cutoverPlan;
    const cutover = await tx
      .select({ status: cp.status, n: count() })
      .from(cp)
      .where(and(eq(cp.projectId, projectId), this.s.policy.visibilitySql(ctx, projectId, {}), this.s.policy.reachSql(ctx, 'readiness.register.read', projectId, cp.workstreamId)))
      .groupBy(cp.status);

    const t = schema.tsaService;
    const tsas = await tx
      .select({ status: t.status, endDate: t.endDate, replacementAccepted: t.replacementAccepted, enduring: t.isEnduringArrangement })
      .from(t)
      .where(this.tsa.scopeSql(ctx, projectId));
    const tsaByStatus: Record<string, number> = {};
    let expiringSoon = 0;
    for (const x of tsas) {
      tsaByStatus[x.status] = (tsaByStatus[x.status] ?? 0) + 1;
      if (assessTsaExpiry({ status: x.status, endDate: x.endDate, replacementAccepted: x.replacementAccepted, today, warnDays: TSA_EXPIRY_WARN_DAYS }).kind === 'expiring') expiringSoon++;
    }
    const sum = (rows: { n: number }[]) => rows.reduce((a, r) => a + Number(r.n), 0);
    return {
      checks: {
        total: sum(byStatus),
        byStatus: Object.fromEntries(byStatus.map((r) => [r.status, Number(r.n)])),
        openBlockers: blk?.open ?? 0,
        failedBlockers: blk?.failed ?? 0,
        uncoveredAreas: uncoveredReadinessAreas(areas.map((a) => a.area)),
      },
      cutover: { total: sum(cutover), byStatus: Object.fromEntries(cutover.map((r) => [r.status, Number(r.n)])) },
      tsas: {
        total: tsas.length,
        byStatus: tsaByStatus,
        expiringSoon,
        expiredUnresolved: tsaByStatus['expired_unresolved'] ?? 0,
        enduringArrangements: tsas.filter((x) => x.enduring).length,
      },
    };
  }
}
