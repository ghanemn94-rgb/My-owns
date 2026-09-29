import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DomainError } from '@hub/domain';
import { closeApp, closePools, getApp, owner } from '../helpers';
import { setupProject, gateByKey, crit, startGate, Personas } from './gate-test-kit';
import { JobContextFactory } from '../../src/platform/jobs/job-context';
import { DbService } from '../../src/platform/db.service';
import { GatesService } from '../../src/modules/gates/gates.service';
import { WaiverService } from '../../src/modules/gates/waiver.service';

/**
 * AT-12 (gate side): all workstreams green / all tasks done but a mandatory closing condition lacks evidence → the
 * closing gate stays blocked, and an AI (service) identity cannot bypass the condition, create or approve a waiver, or
 * decide the gate — even if its permission allowlist were misconfigured to include those permissions.
 */
let projectId: string;
let orgId: string;
let p: Personas;

beforeAll(async () => {
  ({ projectId, orgId, p } = await setupProject('GT-AT12'));
});
afterAll(async () => {
  await closeApp();
  await closePools();
});

const aiContext = async () => {
  const app = await getApp();
  return app.get(JobContextFactory).forService({ org_id: orgId, project_id: projectId, id: 'at12-test' }, 'svc-ai-pm', [
    'gates.gate.read',
    'gates.waiver.request',
    'gates.waiver.approve',
    'gates.assessment.decide',
    'gates.assessment.review',
  ]);
};

describe('AT-12 (gate side) — green workstreams do not pass G6; AI cannot bypass or waive [REQ-LCY-011, REQ-LCY-012]', () => {
  it('G6 with every task done and workstreams reported green is still blocked by its unevidenced mandatory CP criterion', async () => {
    await owner().query(`update task set status = 'done', reported_progress = 100 where project_id = $1`, [projectId]);
    await startGate(p, projectId, 'G6');
    const g6 = await gateByKey(p.pm, projectId, 'G6');
    expect(g6.evaluation.ready).toBe(false);
    expect(g6.evaluation.blockers.some((b) => b.kind === 'criterion' && b.ref === 'G6-C01')).toBe(true);
    expect(g6.rag).toBe('red');
  });

  it('an AI/service identity cannot request or approve a waiver, review a criterion or decide the gate', async () => {
    const app = await getApp();
    const db = app.get(DbService);
    const gates = app.get(GatesService);
    const waivers = app.get(WaiverService);
    const g6 = await gateByKey(p.pm, projectId, 'G6');
    const c = crit(g6, 'G6-C01');
    const expectHumanOnly = async (fn: (ctx: Awaited<ReturnType<typeof aiContext>>) => Promise<unknown>) => {
      const ctx = await aiContext();
      const err = await db.run(ctx, () => fn(ctx)).then(
        () => null,
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(DomainError);
      expect((err as DomainError).kind).toBe('forbidden');
      expect((err as DomainError).code).toBe('gates.human_only');
    };
    await expectHumanOnly((ctx) => waivers.request(ctx, projectId, 'gate_criterion', c.id, { basis: 'AI suggestion', impact: 'none' }));
    await expectHumanOnly((ctx) => gates.reviewCriterion(ctx, projectId, g6.id, c.id, { expectedVersion: c.assessment.version, outcome: 'met' }));
    await expectHumanOnly((ctx) => gates.decide(ctx, projectId, g6.id, { expectedVersion: g6.assessment.version, outcome: 'approve', note: 'AI approval attempt' }));
    expect((await owner().query(`select count(*)::int as n from waiver where project_id = $1`, [projectId])).rows[0].n).toBe(0);
    const after = await gateByKey(p.pm, projectId, 'G6');
    expect(after.assessment.status).toBe('in_assessment');
    expect(crit(after, 'G6-C01').assessment.status).toBe('unmet');
  });
});
