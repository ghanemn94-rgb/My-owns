import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApp, closePools, getApp, owner } from '../helpers';
import { WorkerService } from '../../src/platform/jobs/worker.service';
import { JobRegistry } from '../../src/platform/jobs/job-registry';
import { registerJobHandlers } from '../../src/jobs';
import { approveGate, contradictEvidence, crit, evidenceLinks, gateByKey, markReady, meetAllMandatory, reviewGate, runWorker, startGate, supersedeAll } from '../gates/gate-test-kit';
import { P, auditRows, doc, finalDecision, grant, in30, ok, partner, partnerAt, passG5, plusDays, room, setupJvProject, syntheticUser, JvProject } from './jv-kit';
import { docsPath } from '../documents/doc-helpers';

/**
 * Regression tests of the P4 domain-review fixes (docs/reviews/P4-domain-review.md) on the JV side, through the API and the
 * worker, on a synthetic demo-flagged project:
 *  - DOM-P4-02 [REQ-LCY-009]: a signing is requested and recorded only while gate G5 is approved and not under
 *    reassessment, on the decision that approved the current G5 cycle — re-evaluated inside the recording transaction.
 *  - DOM-P4-10 [REQ-LCY-007]: the jv_transaction dimension walks the documented states (partner preparation → diligence →
 *    signing ready → signed → closing conditions in progress) and does not count aborted events.
 *  - DOM-P4-03 [REQ-JV-013, AT-13]: only Legal determines CP blocking status / waivability, and never releases a blocking CP.
 *  - DOM-P4-04 [REQ-JV-013, REQ-JV-018]: validity of a verified CP changes only after a reopen; long-stop dates move later only
 *    with an approved extension; the daily scan lapses CPs past their long-stop date and escalates.
 *  - DOM-P4-05 [REQ-JV-010]: the evidence versions pinned at submission are the ones reviewed and disclosed.
 *  - DOM-P4-11 [REQ-JV-019]: program closure refuses a G7 approval flagged for reassessment.
 */
let j: JvProject;
let pid: string;

const event = async (kind: 'signings' | 'closings', id: string) => (await j.p.pm.get(`${P(pid)}/${kind}/${id}`).expect(200)).body as Record<string, any>;
const cpOf = async (id: string) => (await j.p.pm.get(`${P(pid)}/closing-conditions/${id}`).expect(200)).body as Record<string, any>;
const jvDim = async () => {
  await runWorker();
  const items = (await j.p.pm.get(`${P(pid)}/status-dimensions`).expect(200)).body.items as { key: string; state: string; explanationI18n: { code: string }[] }[];
  return items.find((d) => d.key === 'jv_transaction')!;
};
async function readyEvent(id: string) {
  let v = (await ok(await j.p.pm.post(`${P(pid)}/transaction-events/${id}/transition`, { expectedVersion: 1, command: 'start_preparation' }))).version;
  v = (await ok(await j.p.pm.post(`${P(pid)}/transaction-events/${id}/transition`, { expectedVersion: v, command: 'mark_ready' }))).version;
  return v as number;
}

beforeAll(async () => {
  j = await setupJvProject('JV-P4FIX');
  pid = j.projectId;
}, 600_000);
afterAll(async () => {
  await closeApp();
  await closePools();
});

describe('DOM-P4-02 / DOM-P4-10 — signing after G5; jv_transaction states [REQ-LCY-009, REQ-LCY-007]', () => {
  let partnerId: string;
  let signing: string;
  let executed: string;
  let otherFinal: string;
  let g5a: string;
  let g5b: string;

  it('DOM-P4-10: not started → partner preparation → diligence and negotiation, from the partner process', async () => {
    await ok(await j.p.pm.post(`${P(pid)}/status-dimensions/recompute`, {}));
    expect((await jvDim()).state).toBe('not_started');
    partnerId = await partnerAt(j, 'P4 fixes partner (fictional)');
    expect((await jvDim()).state).toBe('partner_preparation');
    const v = (await partner(j.p.pm, pid, partnerId)).version;
    await ok(await j.p.pm.post(`${P(pid)}/partners/${partnerId}/advance`, { expectedVersion: v, toStage: 'dd' }));
    expect((await jvDim()).state).toBe('diligence_and_negotiation');
  });

  it('DOM-P4-02: before G5 passes, a FINAL signing authorization is refused (422 jv.signing.g5_not_passed); the detail shows G5', async () => {
    signing = (await ok(await j.p.pm.post(`${P(pid)}/signings`, { name: 'P4 fixes signing (synthetic)', partnerId }))).id;
    const v = await readyEvent(signing);
    executed = (await doc(j.p.pm, pid, 'P4 fixes executed agreement (synthetic)', { kind: 'agreement' })).id;
    otherFinal = await finalDecision(j, 'jv_signing_authorization');
    const r = await j.p.pm.post(`${P(pid)}/transaction-events/${signing}/request-confirmation`, { expectedVersion: v, decisionId: otherFinal, executedDocumentId: executed });
    expect(r.status, JSON.stringify(r.body)).toBe(422);
    expect(r.body.code).toBe('jv.signing.g5_not_passed');
    expect(r.body.details).toMatchObject({ gateKey: 'G5' });
    const d = await event('signings', signing);
    expect(d.signingGate).toMatchObject({ gateKey: 'G5', passed: false, underReassessment: false });
    expect(d.status).toBe('ready_for_confirmation');
    const closingView = await j.p.pm.post(`${P(pid)}/closings`, { signingId: signing, name: 'P4 fixes closing (synthetic)' });
    expect((await event('closings', closingView.body.id)).signingGate).toBeNull();
  });

  it('DOM-P4-02 / -10: with G5 approved the dimension is signing_ready; only the decision that approved G5 authorizes the signing', async () => {
    g5a = await passG5(j);
    expect((await jvDim()).state).toBe('signing_ready');
    const v = (await event('signings', signing)).version;
    const other = await j.p.pm.post(`${P(pid)}/transaction-events/${signing}/request-confirmation`, { expectedVersion: v, decisionId: otherFinal, executedDocumentId: executed });
    expect(other.status, JSON.stringify(other.body)).toBe(422);
    expect(other.body.code).toBe('jv.signing.decision_not_g5');
    await ok(await j.p.pm.post(`${P(pid)}/transaction-events/${signing}/request-confirmation`, { expectedVersion: v, decisionId: g5a, executedDocumentId: executed }));
    expect((await event('signings', signing)).signingGate).toMatchObject({ passed: true, status: 'approved' });
  });

  it('DOM-P4-02: G5 flagged for reassessment after the request → recording refused inside the transaction and audited', async () => {
    const g5 = await gateByKey(j.gp.pm, pid, 'G5');
    const c = crit(g5, 'G5-C03');
    const active = (await evidenceLinks(j.gp.pm, pid, c.id)).find((l) => l.status === 'active')!;
    await contradictEvidence(j.gp.pm, pid, c.id, active.id, 'Newer DD report contradicts the one relied upon (synthetic)');
    await runWorker();
    expect((await gateByKey(j.gp.pm, pid, 'G5')).assessment.reassessment.needsReassessment).toBe(true);
    expect((await jvDim()).state).toBe('diligence_and_negotiation'); // a flagged G5 no longer counts as signing readiness
    const e = await event('signings', signing);
    expect(e.signingGate).toMatchObject({ passed: false, underReassessment: true });
    const rec = await j.p.sponsor.post(`${P(pid)}/signings/${signing}/record`, { expectedVersion: e.version });
    expect(rec.status, JSON.stringify(rec.body)).toBe(422);
    expect(rec.body.code).toBe('jv.signing.g5_under_reassessment');
    expect((await event('signings', signing)).status).toBe('ready_for_confirmation');
    const audit = await auditRows(pid, 'jv.signing.record', signing);
    expect(audit.map((a) => a.outcome)).toEqual(['rejected']);
    expect(audit[0]!.reason).toMatch(/reassessment/);
    const again = await j.p.pm.post(`${P(pid)}/transaction-events/${signing}/request-confirmation`, { expectedVersion: e.version, decisionId: g5a });
    expect(again.status).toBe(422);
    expect(again.body.code).toBe('jv.signing.g5_under_reassessment');
  });

  it('DOM-P4-02: after G5 is reassessed on a fresh decision, the pending request on the old decision is refused; a new one records the signing', async () => {
    let g5 = await gateByKey(j.gp.pm, pid, 'G5');
    await ok(await j.gp.chair.post(`${P(pid)}/gates/${g5.id}/assessment/reopen`, { expectedVersion: g5.assessment.version, reason: 'DD evidence conflict (synthetic)' }));
    await startGate(j.gp, pid, 'G5');
    await supersedeAll(j.gp.pm, pid, crit(await gateByKey(j.gp.pm, pid, 'G5'), 'G5-C03').id);
    await meetAllMandatory(j.gp, pid, 'G5');
    await reviewGate(j.gp, pid, 'G5');
    await markReady(j.gp, pid, 'G5');
    g5b = (await approveGate(j.gp, j.gov, pid, 'G5')).decisionId;
    g5 = await gateByKey(j.gp.pm, pid, 'G5');
    expect(g5.assessment).toMatchObject({ cycle: 2, status: 'approved', decisionId: g5b });
    let e = await event('signings', signing);
    const stale = await j.p.sponsor.post(`${P(pid)}/signings/${signing}/record`, { expectedVersion: e.version });
    expect(stale.status, JSON.stringify(stale.body)).toBe(422);
    expect(stale.body.code).toBe('jv.signing.decision_not_g5');
    await ok(await j.p.pm.post(`${P(pid)}/transaction-events/${signing}/request-confirmation`, { expectedVersion: e.version, decisionId: g5b }));
    e = await event('signings', signing);
    const rec = await ok(await j.p.sponsor.post(`${P(pid)}/signings/${signing}/record`, { expectedVersion: e.version }));
    expect(rec.status).toBe('confirmed');
    const snap = await owner().query(`select readiness_snapshot from closing where id = $1`, [signing]);
    expect(snap.rows[0].readiness_snapshot.signingGate).toMatchObject({ gateKey: 'G5', status: 'approved', decisionId: g5b, assessmentId: g5.assessment.id });
    expect((await jvDim()).state).toBe('signed');
  });

  it('DOM-P4-10: closing in preparation → closing_conditions_in_progress; an aborted closing is not counted and is disclosed', async () => {
    const c1 = (await ok(await j.p.pm.post(`${P(pid)}/closings`, { signingId: signing, name: 'P4 fixes closing #2 (synthetic)' }))).id;
    await ok(await j.p.pm.post(`${P(pid)}/transaction-events/${c1}/transition`, { expectedVersion: 1, command: 'start_preparation' }));
    expect((await jvDim()).state).toBe('closing_conditions_in_progress');
    const closings = (await j.p.pm.get(`${P(pid)}/closings?signingId=${signing}`).expect(200)).body.items as { id: string; status: string; version: number }[];
    for (const c of closings) await ok(await j.p.pm.post(`${P(pid)}/transaction-events/${c.id}/transition`, { expectedVersion: c.version, command: 'abort', note: 'Test: closing abandoned (synthetic)' }));
    const d = await jvDim();
    expect(d.state).toBe('signed');
    expect(d.explanationI18n.map((m) => m.code)).toEqual(['dimension.jv.signed', 'dimension.jv.aborted_excluded']);
  });
});

describe('DOM-P4-03 — only Legal determines CP blocking status and waivability; never releases a blocking CP [REQ-JV-013, AT-13]', () => {
  let closing: string;
  beforeAll(async () => {
    const s = (await ok(await j.p.pm.post(`${P(pid)}/signings`, { name: 'CP rules signing (synthetic)' }))).id;
    closing = (await ok(await j.p.pm.post(`${P(pid)}/closings`, { signingId: s, name: 'CP rules closing (synthetic)' }))).id;
  });

  it('a functional approver and a Finance member (both hold gates.criterion.set_waivability) are refused (403)', async () => {
    const c = await ok(await j.p.legal.post(`${P(pid)}/closing-conditions`, { closingId: closing, title: 'Competition clearance (synthetic)', ownerUserId: j.p.pm.userId, blocking: true }));
    const body = { expectedVersion: 1, blocking: true, waivable: true, waiverAuthorityRole: 'sponsor', basis: 'Attempt (test)' };
    for (const who of [j.p.approver, j.p.finance, j.p.pm]) {
      const r = await who.post(`${P(pid)}/closing-conditions/${c.id}/determine-waivability`, body);
      expect(r.status, who.persona).toBe(403);
    }
    expect(await cpOf(c.id)).toMatchObject({ blocking: true, waivable: false, waivabilityDeterminedBy: null });
  });

  it('Legal cannot release a blocking CP (non-waivable or waivable); the refusal is logged; raising blocking is a recorded determination', async () => {
    const c = await ok(await j.p.legal.post(`${P(pid)}/closing-conditions`, { closingId: closing, title: 'Regulatory approval (synthetic)', ownerUserId: j.p.pm.userId, blocking: true }));
    const release = await j.p.legal.post(`${P(pid)}/closing-conditions/${c.id}/determine-waivability`, { expectedVersion: 1, blocking: false, waivable: false, waiverAuthorityRole: null, basis: 'Not a condition to closing (test)' });
    expect(release.status, JSON.stringify(release.body)).toBe(422);
    expect(release.body.code).toBe('jv.cp.blocking_release_not_allowed');
    expect(release.body.details).toMatchObject({ waivable: false });
    const logged = await owner().query(`select outcome from audit_event where project_id = $1 and action = 'jv.determineConditionWaivability' and outcome = 'rejected'`, [pid]);
    expect(logged.rows.length).toBeGreaterThanOrEqual(1);
    const w = await ok(await j.p.legal.post(`${P(pid)}/closing-conditions/${c.id}/determine-waivability`, { expectedVersion: 1, blocking: true, waivable: true, waiverAuthorityRole: 'sponsor', basis: 'Waivable by the sponsor per the agreement (test)' }));
    const release2 = await j.p.legal.post(`${P(pid)}/closing-conditions/${c.id}/determine-waivability`, { expectedVersion: w.version, blocking: false, waivable: true, waiverAuthorityRole: 'sponsor', basis: 'Release (test)' });
    expect(release2.status).toBe(422);
    expect(release2.body.details).toMatchObject({ waivable: true });
    expect((await event('closings', closing)).blockers.map((b: { ref: string }) => b.ref)).toContain(c.code);
    const nb = await ok(await j.p.pm.post(`${P(pid)}/closing-conditions`, { closingId: closing, title: 'Information condition (synthetic)', ownerUserId: j.p.pm.userId, blocking: false }));
    await ok(await j.p.legal.post(`${P(pid)}/closing-conditions/${nb.id}/determine-waivability`, { expectedVersion: 1, blocking: true, waivable: false, waiverAuthorityRole: null, basis: 'A condition to closing per the agreement (test)' }));
    expect(await cpOf(nb.id)).toMatchObject({ blocking: true, waivabilityDeterminedBy: j.p.legal.userId });
    expect((await auditRows(pid, 'jv.cp.determine_waivability', nb.id)).map((a) => a.outcome)).toEqual(['success']);
  });
});

describe('DOM-P4-04 — CP validity and long-stop dates [REQ-JV-013, REQ-JV-018]', () => {
  let closing: string;
  beforeAll(async () => {
    const s = (await ok(await j.p.pm.post(`${P(pid)}/signings`, { name: 'Long-stop signing (synthetic)' }))).id;
    closing = (await ok(await j.p.pm.post(`${P(pid)}/closings`, { signingId: s, name: 'Long-stop closing (synthetic)' }))).id;
  });

  async function verified(title: string, extra: Record<string, unknown>) {
    const c = await ok(await j.p.legal.post(`${P(pid)}/closing-conditions`, { closingId: closing, title, ownerUserId: j.p.pm.userId, blocking: true, ...extra }));
    await ok(await j.p.pm.post(`${P(pid)}/evidence`, { targetType: 'closing_condition', targetId: c.id, note: 'Synthetic evidence (test)' }));
    const s = await ok(await j.p.pm.post(`${P(pid)}/closing-conditions/${c.id}/submit-evidence`, { expectedVersion: 1 }));
    await ok(await j.p.legal.post(`${P(pid)}/closing-conditions/${c.id}/verify`, { expectedVersion: s.version, outcome: 'verify' }));
    return { id: c.id as string, code: c.code as string };
  }

  it('the validity of a verified CP changes only after a reopen and a fresh verification', async () => {
    const c = await verified('Consent valid until yesterday (synthetic)', { validTo: plusDays(-1) });
    let cur = await cpOf(c.id);
    const r = await j.p.pm.patch(`${P(pid)}/closing-conditions/${c.id}`, { expectedVersion: cur.version, validTo: plusDays(60) });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('jv.cp.validity_locked');
    expect((await event('closings', closing)).blockers.filter((b: { ref: string }) => b.ref === c.code).map((b: { messageI18n: { code: string }[] }) => b.messageI18n[0]!.code)).toEqual(['jv.closing.cp_validity_lapsed']);
    await ok(await j.p.pm.post(`${P(pid)}/closing-conditions/${c.id}/reopen`, { expectedVersion: cur.version, reason: 'Renewed consent obtained (synthetic)' }));
    cur = await cpOf(c.id);
    expect(cur.status).toBe('open');
    const upd = await ok(await j.p.pm.patch(`${P(pid)}/closing-conditions/${c.id}`, { expectedVersion: cur.version, validTo: plusDays(60) }), 200);
    const s = await ok(await j.p.pm.post(`${P(pid)}/closing-conditions/${c.id}/submit-evidence`, { expectedVersion: upd.version }));
    await ok(await j.p.legal.post(`${P(pid)}/closing-conditions/${c.id}/verify`, { expectedVersion: s.version, outcome: 'verify' }));
    expect((await event('closings', closing)).blockers.map((b: { ref: string }) => b.ref)).not.toContain(c.code);
  });

  it('a long-stop date is set or brought forward; moving it later or clearing it needs an approved extension', async () => {
    const c = await ok(await j.p.legal.post(`${P(pid)}/closing-conditions`, { closingId: closing, title: 'Landlord consent (synthetic)', ownerUserId: j.p.pm.userId, blocking: true }));
    let v = (await ok(await j.p.pm.patch(`${P(pid)}/closing-conditions/${c.id}`, { expectedVersion: 1, longStopDate: plusDays(90) }), 200)).version;
    v = (await ok(await j.p.pm.patch(`${P(pid)}/closing-conditions/${c.id}`, { expectedVersion: v, longStopDate: plusDays(80) }), 200)).version;
    for (const longStopDate of [plusDays(120), null]) {
      const r = await j.p.pm.patch(`${P(pid)}/closing-conditions/${c.id}`, { expectedVersion: v, longStopDate });
      expect(r.status, String(longStopDate)).toBe(422);
      expect(r.body.code).toBe('jv.cp.long_stop_extension_required');
    }
    expect((await cpOf(c.id)).longStopDate).toBe(plusDays(80));
    const sched = await owner().query(`select cron, timezone from scheduled_job where project_id = $1 and kind = 'jv.cp_long_stop_scan'`, [pid]);
    expect(sched.rows).toEqual([{ cron: '0 6 * * *', timezone: 'Asia/Riyadh' }]);
  });

  async function runLongStopScan() {
    const app = await getApp();
    if (!app.get(JobRegistry).handler('jv.cp_long_stop_scan')) registerJobHandlers(app);
    const s = await owner().query(`update scheduled_job set next_run_at = now() - interval '1 second' where project_id = $1 and kind = 'jv.cp_long_stop_scan' returning id`, [pid]);
    expect(s.rowCount, 'long-stop schedule exists for the project').toBe(1);
    const worker = app.get(WorkerService);
    expect(await worker.enqueueDueSchedules()).toBeGreaterThanOrEqual(1);
    for (let i = 0; i < 20; i++) {
      const d = await worker.dispatchOutbox(500);
      const e = await worker.runJobs(50);
      if (d === 0 && e === 0) break;
    }
    const job = await owner().query<{ status: string; result: Record<string, number>; last_error: string | null }>(`select status, result, last_error from job where project_id = $1 and kind = 'jv.cp_long_stop_scan' order by created_at desc limit 1`, [pid]);
    expect(job.rows[0]?.status, job.rows[0]?.last_error ?? '').toBe('succeeded');
    return job.rows[0]!.result;
  }

  let lapsed: { id: string; code: string };
  let approaching: { id: string; code: string };

  it('the daily scan lapses an unsatisfied CP past its long-stop date and escalates it once; an open CP without evidence near its date is escalated', async () => {
    lapsed = await ok(await j.p.legal.post(`${P(pid)}/closing-conditions`, { closingId: closing, title: 'Filing past its long-stop date (synthetic)', ownerUserId: j.p.pm.userId, blocking: true, longStopDate: plusDays(-2) })) as { id: string; code: string };
    approaching = await ok(await j.p.legal.post(`${P(pid)}/closing-conditions`, { closingId: closing, title: 'Approval due soon, no evidence yet (synthetic)', ownerUserId: j.p.pm.userId, blocking: true, longStopDate: plusDays(10) })) as { id: string; code: string };
    const res = await runLongStopScan();
    expect(res.markedLapsed).toBeGreaterThanOrEqual(1);
    expect(await cpOf(lapsed.id)).toMatchObject({ status: 'lapsed' });
    expect(await cpOf(approaching.id)).toMatchObject({ status: 'open' });
    const lapse = await owner().query(`select actor_kind from audit_event where project_id = $1 and action = 'jv.cp.mark_lapsed' and entity_id = $2`, [pid, lapsed.id]);
    expect(lapse.rows.map((r) => r.actor_kind)).toEqual(['service']);
    const esc = await owner().query(`select source_id, decision_deadline::text as deadline, status, is_system_generated, title from escalation where project_id = $1 and source_type = 'closing_condition' order by code`, [pid]);
    expect(esc.rows.map((r) => [r.source_id, r.deadline, r.status, r.is_system_generated])).toEqual(
      expect.arrayContaining([
        [lapsed.id, plusDays(-2), 'open', true],
        [approaching.id, plusDays(10), 'open', true],
      ]),
    );
    const blockers = (await event('closings', closing)).blockers.filter((b: { ref: string }) => b.ref === lapsed.code);
    expect(blockers[0].messageI18n[0]).toMatchObject({ code: 'jv.closing.cp_unmet', params: { status: 'lapsed' } });
    // Idempotent: a second run changes nothing and raises no second escalation.
    const n = (await owner().query(`select count(*)::int n from escalation where project_id = $1 and source_type = 'closing_condition'`, [pid])).rows[0].n;
    await runLongStopScan();
    expect((await owner().query(`select count(*)::int n from escalation where project_id = $1 and source_type = 'closing_condition'`, [pid])).rows[0].n).toBe(n);
  });

  it('a lapsed CP is open again only on an approved extension (FINAL decision, later date, not reused); it cannot be verified meanwhile', async () => {
    let cur = await cpOf(lapsed.id);
    expect(cur.allowedCommands).toEqual([]);
    const verify = await j.p.legal.post(`${P(pid)}/closing-conditions/${lapsed.id}/verify`, { expectedVersion: cur.version, outcome: 'verify' });
    expect(verify.status).toBe(422);
    const patch = await j.p.pm.patch(`${P(pid)}/closing-conditions/${lapsed.id}`, { expectedVersion: cur.version, longStopDate: plusDays(30) });
    expect(patch.body.code).toBe('jv.cp.long_stop_extension_required');
    const outreach = await finalDecision(j, 'partner_outreach_and_access');
    const wrongType = await j.p.pm.post(`${P(pid)}/closing-conditions/${lapsed.id}/extend-long-stop`, { expectedVersion: cur.version, longStopDate: plusDays(30), decisionId: outreach, reason: 'Extension agreed (synthetic)' });
    expect(wrongType.status).toBe(422);
    expect(wrongType.body.code).toBe('jv.cp.extension_decision_not_final');
    const extension = await finalDecision(j, 'jv_closing_confirmation');
    const past = await j.p.pm.post(`${P(pid)}/closing-conditions/${lapsed.id}/extend-long-stop`, { expectedVersion: cur.version, longStopDate: plusDays(-1), decisionId: extension, reason: 'x (test)' });
    expect(past.body.code).toBe('jv.cp.extension_date_invalid');
    const res = await ok(await j.p.pm.post(`${P(pid)}/closing-conditions/${lapsed.id}/extend-long-stop`, { expectedVersion: cur.version, longStopDate: plusDays(30), decisionId: extension, reason: 'Extension approved by the authorized body (synthetic)' }));
    expect(res.status).toBe('open');
    cur = await cpOf(lapsed.id);
    expect(cur).toMatchObject({ status: 'open', longStopDate: plusDays(30), longStopExtensionDecisionId: extension, longStopExtendedBy: j.p.pm.userId });
    const audit = await owner().query(`select before, after, reason from audit_event where project_id = $1 and action = 'jv.cp.extend_long_stop' and entity_id = $2`, [pid, lapsed.id]);
    expect(audit.rows[0].before).toMatchObject({ status: 'lapsed', longStopDate: plusDays(-2) });
    expect(audit.rows[0].after).toMatchObject({ status: 'open', longStopDate: plusDays(30), decisionId: extension });
    const reuse = await j.p.pm.post(`${P(pid)}/closing-conditions/${lapsed.id}/extend-long-stop`, { expectedVersion: cur.version, longStopDate: plusDays(60), decisionId: extension, reason: 'Again (test)' });
    expect(reuse.body.code).toBe('jv.cp.extension_decision_already_used');
    // The CP is unmet again (open) — it still blocks, but no longer as lapsed.
    const bl = (await event('closings', closing)).blockers.filter((b: { ref: string }) => b.ref === lapsed.code);
    expect(bl[0].messageI18n[0]).toMatchObject({ code: 'jv.closing.cp_unmet', params: { status: 'open' } });
  });
});

describe('DOM-P4-05 — DD evidence pinned at submission is what the reviewer approves and the release discloses [REQ-JV-010]', () => {
  it('a newer evidence version before the review refuses the approval; after resubmission the pinned version is disclosed', async () => {
    const partnerId = await partnerAt(j, 'DD pinning partner (fictional)');
    const r = (await room(j.p.pm, pid, { name: 'DD pinning room (synthetic)', type: 'partner', partnerId })).id;
    await ok(await grant(j.p.legal, pid, r, { userId: j.p.sponsor.userId, accessLevel: 'manage' }));
    await ok(await grant(j.p.sponsor, pid, r, { userId: j.p.legal.userId, accessLevel: 'manage' }));
    await ok(await grant(j.p.legal, pid, r, { userId: j.p.finance.userId, accessLevel: 'contribute' }));
    const ext = await syntheticUser(j.orgId, 'p4fix.ext', 'external');
    await ok(await j.p.legal.post(`${P(pid)}/partners/${partnerId}/contacts`, { userId: ext.userId }));
    await ok(await grant(j.p.legal, pid, r, { userId: ext.userId, role: 'external_partner_limited', accessLevel: 'contribute', expiresAt: in30() }));
    const q = await ok(await ext.post(`${P(pid)}/partner-access/rooms/${r}/dd-requests`, { question: 'Please share the synthetic cabling register.', domain: 'technical' }));
    let d = (await j.p.pm.get(`${P(pid)}/diligence-requests/${q.id}`).expect(200)).body;
    await ok(await j.p.pm.post(`${P(pid)}/diligence-requests/${q.id}/assign`, { expectedVersion: d.version, assigneeUserId: j.p.finance.userId, reviewerUserId: j.p.legal.userId }));
    const ev = await doc(j.p.pm, pid, 'Synthetic cabling register (test)', { roomId: r, text: 'Version 1 (synthetic)' });
    d = (await j.p.finance.get(`${P(pid)}/diligence-requests/${q.id}`).expect(200)).body;
    const drafted = await ok(await j.p.finance.post(`${P(pid)}/diligence-requests/${q.id}/answer`, { expectedVersion: d.version, answerDraft: 'See the synthetic register.', evidenceDocumentIds: [ev.id] }));
    const sub = await ok(await j.p.finance.post(`${P(pid)}/diligence-requests/${q.id}/submit-for-review`, { expectedVersion: drafted.version }));
    d = (await j.p.legal.get(`${P(pid)}/diligence-requests/${q.id}`).expect(200)).body;
    expect(d.evidenceVersions).toEqual([{ documentId: ev.id, versionId: ev.versionId, current: true }]);
    // A newer version is uploaded before the review: the reviewer never saw it → approval refused.
    const up = await j.p.pm.upload(`${docsPath(pid)}/${ev.id}/versions`, Buffer.from('Version 2 (synthetic)'), 'cabling-v2.txt');
    expect(up.status).toBe(201);
    const v2 = up.body.versionId as string;
    d = (await j.p.legal.get(`${P(pid)}/diligence-requests/${q.id}`).expect(200)).body;
    expect(d.evidenceVersions).toEqual([{ documentId: ev.id, versionId: ev.versionId, current: false }]);
    const refused = await j.p.legal.post(`${P(pid)}/diligence-requests/${q.id}/review`, { expectedVersion: sub.version, outcome: 'approve', note: 'x' });
    expect(refused.status, JSON.stringify(refused.body)).toBe(422);
    expect(refused.body.code).toBe('jv.dd.evidence_changed');
    const back = await ok(await j.p.legal.post(`${P(pid)}/diligence-requests/${q.id}/review`, { expectedVersion: sub.version, outcome: 'return', note: 'Evidence changed — resubmit (synthetic)' }));
    expect((await j.p.legal.get(`${P(pid)}/diligence-requests/${q.id}`).expect(200)).body.evidenceVersions).toEqual([]);
    const sub2 = await ok(await j.p.finance.post(`${P(pid)}/diligence-requests/${q.id}/submit-for-review`, { expectedVersion: back.version }));
    const rev = await ok(await j.p.legal.post(`${P(pid)}/diligence-requests/${q.id}/review`, { expectedVersion: sub2.version, outcome: 'approve', note: 'Reviewed with version 2 (synthetic)' }));
    await ok(await j.p.legal.post(`${P(pid)}/diligence-requests/${q.id}/release`, { expectedVersion: rev.version, note: 'Release (test)' }));
    const list = (await j.p.legal.get(`${P(pid)}/partner-rooms/${r}/disclosures`).expect(200)).body.items as { documentVersionId: string; diligenceRequestId: string | null; status: string }[];
    expect(list.filter((x) => x.diligenceRequestId === q.id && x.status === 'released').map((x) => x.documentVersionId)).toEqual([v2]);
  });
});

describe('DOM-P4-11 — program closure refuses a G7 approval flagged for reassessment [REQ-JV-019]', () => {
  it('flagged: G7 not passed and the request is refused (logged); unflagged: allowed', async () => {
    // Fixture (as jv-closing-rules): G7 approved via the owner pool — the G0–G7 chain is exercised by the gates specs — and
    // flagged for reassessment exactly as the gates reassessment handler writes it (evaluation.needsReassessment).
    const g7 = `(select id from gate_definition where project_id = $1 and key = 'G7')`;
    await owner().query(`update gate_assessment set status = 'approved', evaluation = coalesce(evaluation, '{}'::jsonb) || '{"needsReassessment": true}'::jsonb where project_id = $1 and is_current and gate_id = ${g7}`, [pid]);
    const st = (await j.p.pm.get(`${P(pid)}/program-closure`).expect(200)).body;
    expect(st).toMatchObject({ g7Passed: false, g7: { status: 'approved', underReassessment: true } });
    const r = await j.p.pm.post(`${P(pid)}/program-closure/request`, { handoverNote: 'Handover pack (synthetic)' });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('jv.program_closure.g7_under_reassessment');
    expect((await auditRows(pid, 'jv.program_closure.request', pid)).map((a) => a.outcome)).toEqual(['rejected']);
    await owner().query(`update gate_assessment set evaluation = evaluation || '{"needsReassessment": false}'::jsonb where project_id = $1 and is_current and gate_id = ${g7}`, [pid]);
    expect((await j.p.pm.get(`${P(pid)}/program-closure`).expect(200)).body).toMatchObject({ g7Passed: true, g7: { underReassessment: false } });
    await ok(await j.p.pm.post(`${P(pid)}/program-closure/request`, { handoverNote: 'Handover pack (synthetic)' }));
  });
});
