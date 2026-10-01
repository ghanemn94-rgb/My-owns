import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApp, closePools, owner } from '../helpers';
import { P, check, clearCheck, completePlan, createCheck, decisionOfType, drainWorker, insertSite, plan, setupGovernance, setupProject, Gov, Personas } from '../readiness/readiness-kit';

/**
 * P3 DOMAIN REVIEW — concurrency of the Day-1 GO (docs/reviews/P3-domain-review.md; AT-09, AT-16, module guide "One writer
 * of a project's gate state at a time" — the brief asks whether readiness commands need similar protection).
 *
 * Deterministic interleaving: a test-only owner transaction holds the row lock of the plan's go/no-go decision, so the GO
 * request stops at `lockDecisionAndRecheck` — AFTER it has read and evaluated the readiness checks. While it waits, a failing
 * test of a blocker is recorded and commits. Then the lock is released. `DEFECT` is declared with `it.fails` while open;
 * `P3D_PROBE_PLAIN=1` runs it as a plain test. All data is synthetic.
 */
// Implementer (fix of the P3 domain review): the DEFECT probe of this file is fixed and renamed `… (fixed, regression)` — a
// plain `it`, assertion unchanged. The alias stays so that P3D_PROBE_PLAIN=1 keeps working for any probe added later.
const defect = process.env['P3D_PROBE_PLAIN'] ? it : it.fails;
void defect;

let projectId: string;
let p: Personas;
let gov: Gov;

beforeAll(async () => {
  ({ projectId, p } = await setupProject('P3D-RACE'));
  gov = await setupGovernance(projectId, p);
});
afterAll(async () => {
  await drainWorker();
  await closeApp();
  await closePools();
});

type R = { status: number; body: Record<string, unknown> };
const settleWithin = <T>(pr: Promise<T>, ms: number): Promise<T | 'pending'> => Promise.race([pr, new Promise<'pending'>((res) => setTimeout(() => res('pending'), ms))]);

describe('P3 domain review — GO decided while a blocker test fails concurrently [AT-09, AT-16, REQ-RDY-004]', () => {
  it('DOM-P3-03 (concurrency): a GO whose evaluation read the blocker as passed commits after a FAILED test of that blocker committed (fixed, regression)', async () => {
    const siteId = await insertSite(projectId, 'S-P3D-R');
    const planId = await completePlan(p.pm, projectId, { siteId, accountableUserId: p.pm.userId, title: 'Race transition (synthetic)' });
    const checkId = await createCheck(p.pm, projectId, {
      area: 'incident_management',
      title: 'Incident-response process tested (synthetic)',
      mandatory: true,
      blocker: true,
      signoffRole: 'functional_approver',
      cutoverPlanId: planId,
      siteId,
    });
    await clearCheck(p, projectId, checkId);
    const d = await decisionOfType(projectId, p, gov, 'day1_go_no_go');
    let v = await plan(p.pm, projectId, planId);
    expect((await p.pm.post(`${P(projectId)}/cutover-plans/${planId}/go-decision`, { expectedVersion: v.version, decisionId: d.id })).status).toBe(201);
    v = await plan(p.pm, projectId, planId);
    const sub = await p.pm.post(`${P(projectId)}/cutover-plans/${planId}/submit-for-decision`, { expectedVersion: v.version });
    expect(sub.status, JSON.stringify(sub.body)).toBe(201);
    const beforeCheck = await check(p.pm, projectId, checkId);
    expect(beforeCheck.status).toBe('passed');

    const lock = await owner().connect();
    let goP: Promise<R> | null = null;
    let failP: Promise<R> | null = null;
    let testOutcome: R | 'pending' = 'pending';
    try {
      await lock.query('begin');
      await lock.query('select id from decision where id = $1 for update', [d.id]);
      goP = p.sponsor
        .post(`${P(projectId)}/cutover-plans/${planId}/go-no-go`, { expectedVersion: sub.body.version, outcome: 'go', rationale: 'GO (race probe, synthetic)' })
        .then((r) => r as unknown as R);
      // Wait until the GO request is blocked on a row lock (it has evaluated the checks by then). pg_locks is readable by
      // every role; pg_stat_activity.datname (also readable) keeps the count to THIS database's backends.
      let waiting = 0;
      let goSettled: R | 'pending' = 'pending';
      for (let i = 0; i < 100 && waiting === 0; i++) {
        await new Promise((res) => setTimeout(res, 50));
        waiting = (await owner().query(`select count(*)::int n from pg_locks l join pg_stat_activity a on a.pid = l.pid where not l.granted and a.datname = current_database()`)).rows[0].n;
        if (waiting === 0) goSettled = await settleWithin(goP, 1);
        if (goSettled !== 'pending') break;
      }
      expect(waiting, `the GO request is waiting on the decision row lock (GO settled early: ${goSettled === 'pending' ? 'no' : JSON.stringify(goSettled)})`).toBeGreaterThan(0);
      // Meanwhile the incident-response test is re-run and FAILS (another person, another row).
      failP = p.pm
        .post(`${P(projectId)}/readiness-checks/${checkId}/test-runs`, { expectedVersion: beforeCheck.version, result: 'failed', note: 'Major-incident escalation failed in the re-test (synthetic)' })
        .then((r) => r as unknown as R);
      testOutcome = await settleWithin(failP, 3000);
    } finally {
      await lock.query('commit');
      lock.release();
    }
    const goRes = await goP!;
    if (failP) await failP;
    const final = await check(p.pm, projectId, checkId);
    const planAfter = await plan(p.pm, projectId, planId);
    const testCommittedFirst = testOutcome !== 'pending' && testOutcome.status === 201;
    // Required (AT-09 "blockers prevent go-live", AT-16 "prevent lost updates"; business-gates.md §5 "the go/no-go decision
    // cannot be recorded as GO while a blocker check … is not signed off" [server]): never a GO committed on an evaluation
    // that did not see a blocker failure committed before it — the GO must re-read the checks under a lock (e.g. FOR SHARE
    // on the gating checks or a per-plan / per-project readiness lock), so the test waits or the GO is refused.
    expect(
      testCommittedFirst && goRes.status === 201,
      `failed test committed while the GO waited: ${testCommittedFirst} (${testOutcome === 'pending' ? 'pending' : `${testOutcome.status} ${JSON.stringify(testOutcome.body)}`}); GO ${goRes.status} ${JSON.stringify(goRes.body)}; check now ${final.status}; plan ${planAfter.status}, recorded evaluation ${JSON.stringify(planAfter.decisionHistory.at(-1)?.evaluation)}`,
    ).toBe(false);
  });
});
