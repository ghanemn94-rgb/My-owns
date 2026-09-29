import { and, eq, sql } from 'drizzle-orm';
import { schema } from '@hub/db';
import { DomainError } from '@hub/domain';
import type { ModuleSeed } from '../../cli/seed-modules';
import { DbService } from '../../platform/db.service';
import { JobQueue } from '../../platform/jobs/job-queue.service';
import { StatusDimensionsService } from '../gates/status-dimensions.service';
import { RECOMPUTE_DIMENSIONS_JOB } from '../gates/gates.service';
import { ReadinessChecksService } from './checks.service';
import { CutoverService } from './cutover.service';
import { TsaService } from './tsa.service';

const PLAN_TITLE = 'Day-1 go-live — DEMO (synthetic)';
const TSA_NAME = 'NOC monitoring during transition — DEMO (synthetic)';
/** Project-level default check created by the project factory from the DC template (connectivity, blocker). */
const CONNECTIVITY_CODE = 'connectivity-connectivity_tested';
const NOC_CODE = 'noc-noc_monitoring_coverage';

/**
 * Demo sandbox scenario for readiness / cutover / TSA (idempotent; everything through the module services so policy,
 * validation, audit and outbox apply; every record inherits is_demo from the demo project). No real names, amounts or
 * dates: windows, TSA dates and charges are left TBD, texts are labelled DEMO / synthetic.
 *  - AT-09 illustration: a Day-1 plan whose GO is blocked — a FAILED connectivity test (with its contingency) plus the
 *    open template checks and the missing §7.4 prerequisites (window, testing, communications, decision);
 *  - AT-13 illustration: a waiver request on a non-waivable Day-1 blocker is rejected and audited;
 *  - TSA register: one proposed TSA in negotiation with an owner and a replacement "to be confirmed".
 */
export const readinessSeed: ModuleSeed = {
  name: 'readiness',
  run: async ({ app, dcProjectId: pid, asUser, userId, log }) => {
    const checks = app.get(ReadinessChecksService);
    const cutover = app.get(CutoverService);
    const tsa = app.get(TsaService);
    const db = app.get(DbService);
    const dims = app.get(StatusDimensionsService);
    const pmId = await userId('pm');
    const opsLeadId = await userId('ops.lead');

    const findCheck = (code: string) =>
      asUser('pm', async () => {
        const [c] = await db.tx().select().from(schema.readinessCheck).where(and(eq(schema.readinessCheck.projectId, pid), eq(schema.readinessCheck.code, code)));
        return c ?? null;
      });

    // 1. Day-1 plan (project-wide) — prerequisites deliberately incomplete; accountable owner = demo PM.
    const existingPlan = await asUser('pm', async () => {
      const [p] = await db.tx().select({ id: schema.cutoverPlan.id }).from(schema.cutoverPlan).where(and(eq(schema.cutoverPlan.projectId, pid), eq(schema.cutoverPlan.title, PLAN_TITLE)));
      return p ?? null;
    });
    const planId =
      existingPlan?.id ??
      (
        await asUser('pm', (ctx) =>
          cutover.create(ctx, pid, {
            title: PLAN_TITLE,
            runbookSummary: 'DEMO runbook placeholder — the approved runbook is to be confirmed',
            serviceImpact: 'Assessment pending — specialist (DEMO)',
            accountableUserId: pmId,
            contingencyPlan: 'DEMO contingency placeholder — keep current operations in service until the blockers clear (to be confirmed)',
            rollbackPlan: 'DEMO rollback placeholder — to be confirmed by Operations',
          }),
        )
      ).id;

    // 2. AT-09: a failed connectivity test on the template's Day-1 connectivity blocker, with its contingency.
    const conn = await findCheck(CONNECTIVITY_CODE);
    if (conn) {
      const runs = await asUser('pm', async () => {
        const r = await db.tx().select({ n: sql<number>`count(*)::int` }).from(schema.readinessTestRun).where(eq(schema.readinessTestRun.readinessCheckId, conn.id));
        return r[0]?.n ?? 0;
      });
      if (runs === 0) {
        let v = conn.version;
        if (!conn.failureContingency) {
          v = (await asUser('pm', (ctx) => checks.update(ctx, pid, conn.id, { expectedVersion: v, failureContingency: 'DEMO contingency: keep customer traffic on the current carrier path and invoke the rollback runbook (illustrative)' }))).version;
        }
        await asUser('pm', (ctx) => checks.recordTest(ctx, pid, conn.id, { expectedVersion: v, result: 'failed', note: 'DEMO — synthetic failed test: end-to-end path to the NOC not reachable (illustrative)' }));
        log('readiness: failed connectivity test recorded on the Day-1 blocker (AT-09 demo)');
      }
    }

    // 3. AT-13 (readiness side): a waiver request on a NON-waivable Day-1 blocker is rejected and audited.
    const noc = await findCheck(NOC_CODE);
    if (noc && !noc.waivable) {
      const logged = await asUser('pm', async () => {
        const r = await db
          .tx()
          .select({ n: sql<number>`count(*)::int` })
          .from(schema.auditEvent)
          .where(and(eq(schema.auditEvent.projectId, pid), eq(schema.auditEvent.entityId, noc.id), eq(schema.auditEvent.outcome, 'rejected')));
        return (r[0]?.n ?? 0) > 0;
      });
      if (!logged) {
        try {
          await asUser('pm', (ctx) => checks.requestWaiver(ctx, pid, noc.id, { basis: 'DEMO scenario: attempt to waive NOC monitoring coverage to accelerate Day-1 (synthetic)', impact: 'DEMO scenario: Day-1 without verified NOC monitoring coverage' }));
          throw new Error('expected the non-waivable readiness waiver request to be rejected');
        } catch (e) {
          if (!(e instanceof DomainError) || e.code !== 'gates.waiver.non_waivable') throw e;
          log('readiness: waiver request on a non-waivable Day-1 blocker rejected and audited (AT-13 demo)');
        }
      }
    }

    // 4. TSA register: one proposed TSA in negotiation (dates, charges and the replacement are to be confirmed).
    const existingTsa = await asUser('pm', async () => {
      const [t] = await db.tx().select({ id: schema.tsaService.id, status: schema.tsaService.status, version: schema.tsaService.version }).from(schema.tsaService).where(and(eq(schema.tsaService.projectId, pid), eq(schema.tsaService.name, TSA_NAME)));
      return t ?? null;
    });
    if (!existingTsa) {
      const ws07 = await asUser('pm', async () => {
        const [w] = await db.tx().select({ id: schema.workstream.id }).from(schema.workstream).where(and(eq(schema.workstream.projectId, pid), eq(schema.workstream.code, 'WS07')));
        return w?.id ?? null;
      });
      const created = await asUser('pm', (ctx) =>
        tsa.create(ctx, pid, {
          name: TSA_NAME,
          scope: 'DEMO: out-of-hours NOC monitoring of the transferred perimeter during the transition (synthetic)',
          sla: 'To be confirmed',
          metricMethod: 'To be confirmed',
          chargeBasis: 'To be confirmed — no amount recorded (DEMO)',
          extensionTerms: 'Extension only by an approved decision — never automatic',
          ownerUserId: opsLeadId,
          workstreamId: ws07,
          replacementService: 'To be confirmed (DEMO)',
          exitMilestones: [{ title: 'Replacement monitoring accepted with evidence (DEMO)' }],
          residualRisks: 'Assessment pending — specialist (DEMO)',
        }),
      );
      await asUser('pm', (ctx) => tsa.transitionSimple(ctx, pid, created.id, { expectedVersion: created.version, command: 'start_negotiation', note: 'DEMO: terms under negotiation' }));
      log('readiness: demo TSA registered (in negotiation; dates and charges TBD)');
    }
    void planId;

    // The commands above queued status-dimension recomputes; the seed recomputes synchronously (as the gates seed does) and
    // cancels the now-redundant queued recomputes so no job is left for a worker that may not have the gates handler.
    await asUser('pm', (ctx) => dims.recompute(ctx, pid));
    const cancelled = await app.get(JobQueue).cancelQueued(pid, [RECOMPUTE_DIMENSIONS_JOB]);
    log(`readiness: status dimensions recomputed (${cancelled} redundant queued recompute job(s) cancelled)`);
  },
};
