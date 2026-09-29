import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApp, closePools, owner } from '../helpers';
import { addCalendarDays } from '@hub/domain';
import {
  P,
  addEvidence,
  clock,
  decisionOfType,
  drainWorker,
  plusDays,
  runExpirySchedule,
  setupGovernance,
  setupProject,
  today,
  tsa,
  Gov,
  Personas,
} from './readiness-kit';

/**
 * AT-10: a TSA expires before its replacement is accepted → escalate without declaring exit; extension / continuity
 * options await an approved decision; exit needs accepted replacement evidence (REQ-TSA-001..006, REQ-LCY-014).
 * Time passing is simulated with the app's injectable Clock (reset in afterAll).
 */
let projectId: string;
let p: Personas;
let gov: Gov;
let tsaDecisionId: string;
let tsaId: string;

beforeAll(async () => {
  ({ projectId, p } = await setupProject('RD-AT10'));
  gov = await setupGovernance(projectId, p);
  tsaDecisionId = (await decisionOfType(projectId, p, gov, 'tsa_approval_or_extension')).id;
});
afterAll(async () => {
  await drainWorker(); // leave no queued job of this spec behind (full handler registry)
  (await clock()).setFixed(null);
  await closeApp();
  await closePools();
});

const cmd = (c: typeof p.pm, id: string, path: string, body: Record<string, unknown>) => c.post(`${P(projectId)}/tsa-services/${id}/${path}`, body);

async function outbox(kind: string) {
  const r = await owner().query(`select payload from outbox_event where project_id = $1 and type = 'tsa.expiring' and aggregate_id = $2 and payload->>'kind' = $3`, [projectId, tsaId, kind]);
  return r.rows;
}

describe('AT-10 — TSA end date is never an exit; escalation, approved extension, evidenced exit [REQ-TSA-001, REQ-TSA-002, REQ-TSA-003, REQ-TSA-004, REQ-TSA-005, REQ-TSA-006, REQ-LCY-014]', () => {
  it('REQ-TSA-001: a TSA without exit milestones (and other §7.3 essentials) cannot be approved', async () => {
    const r = await p.pm.post(`${P(projectId)}/tsa-services`, {
      name: 'NOC monitoring service (synthetic)',
      scope: 'Out-of-hours NOC monitoring for the transferred halls (synthetic)',
      sla: '99.9% monitoring availability (synthetic)',
      chargeBasis: 'Monthly fixed fee (synthetic)',
      charge: { amount: '1000.0000', currency: 'SAR', unitScale: 1 },
      startDate: plusDays(-60),
      endDate: plusDays(10),
      ownerUserId: p.approver.userId,
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    tsaId = r.body.id;
    expect(r.body.code).toMatch(/^TSA-\d{3}$/);
    const neg = await cmd(p.pm, tsaId, 'transition', { expectedVersion: 1, command: 'start_negotiation' });
    expect(neg.status, JSON.stringify(neg.body)).toBe(201);
    const incomplete = await cmd(p.pm, tsaId, 'approve', { expectedVersion: neg.body.version, decisionId: tsaDecisionId });
    expect(incomplete.status).toBe(422);
    expect(incomplete.body.code).toBe('tsa.approve.incomplete');
    expect(incomplete.body.details.missing).toEqual(['exit milestones', 'replacement service / plan']);
    // A generic PATCH never changes the status (strict body → 400).
    const sneaky = await p.pm.patch(`${P(projectId)}/tsa-services/${tsaId}`, { expectedVersion: neg.body.version, status: 'approved' });
    expect(sneaky.status).toBe(400);
    const upd = await p.pm.patch(`${P(projectId)}/tsa-services/${tsaId}`, {
      expectedVersion: neg.body.version,
      exitMilestones: [{ title: 'NewCo NOC monitoring live (synthetic)' }, { title: 'Parallel run completed (synthetic)' }],
      replacementService: 'NewCo NOC monitoring (synthetic)',
      replacementPlan: 'Build NewCo NOC, parallel run, cut over monitoring (synthetic)',
    });
    expect(upd.status, JSON.stringify(upd.body)).toBe(200);
    // A no-op PATCH is not a write.
    const noop = await p.pm.patch(`${P(projectId)}/tsa-services/${tsaId}`, { expectedVersion: upd.body.version, replacementService: 'NewCo NOC monitoring (synthetic)' });
    expect(noop.body.version).toBe(upd.body.version);
  });

  it('TSA approval needs a FINAL governance decision; then the TSA is approved and activated', async () => {
    let t = await tsa(p.pm, projectId, tsaId);
    const draft = (await decisionOfType(projectId, p, gov, 'tsa_approval_or_extension', { vote: false })).id;
    const notFinal = await cmd(p.pm, tsaId, 'approve', { expectedVersion: t.version, decisionId: draft });
    expect(notFinal.status).toBe(422);
    expect(notFinal.body.code).toBe('tsa.approve.decision_not_final');
    const ok = await cmd(p.pm, tsaId, 'approve', { expectedVersion: t.version, decisionId: tsaDecisionId });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body.status).toBe('approved');
    const act = await cmd(p.pm, tsaId, 'transition', { expectedVersion: ok.body.version, command: 'activate' });
    expect(act.body.status).toBe('active');
    t = await tsa(p.pm, projectId, tsaId);
    expect(t).toMatchObject({ approvalDecisionId: tsaDecisionId, status: 'active', expiry: { kind: 'expiring', days: 10 } });
    // Approved dates change only through an approved extension.
    const move = await p.pm.patch(`${P(projectId)}/tsa-services/${tsaId}`, { expectedVersion: t.version, endDate: plusDays(200) });
    expect(move.status).toBe(422);
    expect(move.body.code).toBe('tsa.dates_locked');
  });

  it('REQ-TSA-002: illegal transitions are rejected; guarded commands are not reachable through the generic transition', async () => {
    const t = await tsa(p.pm, projectId, tsaId);
    const illegal = await cmd(p.pm, tsaId, 'transition', { expectedVersion: t.version, command: 'remedy_breach', note: 'x' });
    expect(illegal.status).toBe(422);
    expect(illegal.body.code).toBe('tsa.invalid_transition');
    const guarded = await cmd(p.pm, tsaId, 'transition', { expectedVersion: t.version, command: 'accept_exit' });
    expect(guarded.status).toBe(400);
    expect(t.allowedCommands).toEqual(expect.arrayContaining(['start_exit', 'record_breach', 'record_extension', 'mark_expired_unresolved']));
  });

  it('the expiry job (per-project schedule, service identity) warns once before the end date — idempotent', async () => {
    const r1 = await runExpirySchedule(projectId);
    expect(r1).toMatchObject({ expiring: 1, markedExpired: 0 });
    await runExpirySchedule(projectId);
    expect(await outbox('expiring')).toHaveLength(1);
    expect((await tsa(p.pm, projectId, tsaId)).status).toBe('active');
  });

  it('AT-10 / REQ-TSA-003: past the end date without an accepted replacement → expired_unresolved + escalation, never an exit', async () => {
    // Simulate "15 days later" for the worker only (the HTTP session clock is left alone).
    const c = await clock();
    let first: Record<string, number>;
    let second: Record<string, number>;
    c.setFixed(new Date(`${addCalendarDays(today(), 15)}T09:00:00+03:00`));
    try {
      first = await runExpirySchedule(projectId);
      second = await runExpirySchedule(projectId); // idempotent re-run
    } finally {
      c.setFixed(null);
    }
    expect(first).toMatchObject({ markedExpired: 1, escalations: 1 });
    expect(second).toMatchObject({ markedExpired: 0, escalations: 0 });
    const t = await tsa(p.pm, projectId, tsaId);
    expect(t.status).toBe('expired_unresolved');
    expect(t.exitApprovedBy).toBeNull();
    expect(t.escalation).toMatchObject({ status: 'decision_requested' });
    expect(t.escalation.requestedAction).toMatch(/NOT an exit/);
    expect(t.escalation.options.map((o: { title: string }) => o.title)).toEqual(expect.arrayContaining(['Extend the TSA']));
    expect(t.escalation.target).toMatch(/tsa_approval_or_extension/); // routed per the approved (DEMO) authority matrix
    expect(t.allowedCommands).not.toContain('start_negotiation');
    const esc = await owner().query(`select is_system_generated, source_type, raised_by from escalation where source_id = $1`, [tsaId]);
    expect(esc.rows).toEqual([{ is_system_generated: true, source_type: 'tsa_service', raised_by: null }]);
    const audit = await owner().query(`select actor_kind from audit_event where project_id = $1 and action = 'readiness.tsa.mark_expired_unresolved' and entity_id = $2`, [projectId, tsaId]);
    expect(audit.rows).toEqual([{ actor_kind: 'service' }]);
    const events = await outbox('expired_unresolved');
    expect(events).toHaveLength(1);
    expect(events[0].payload).toMatchObject({ kind: 'expired_unresolved', days: 5, endDate: plusDays(10) });
  });

  it('the status dimensions recompute from tsa.expiring: operational readiness is blocked by the expired TSA (REQ-LCY-014)', async () => {
    await drainWorker();
    const d = (await p.pm.get(`${P(projectId)}/status-dimensions`).expect(200)).body;
    const ops = d.items.find((x: { key: string }) => x.key === 'operational_readiness');
    expect(ops.state).toBe('blocked');
    expect(ops.explanation).toMatch(/breached or expired without an accepted exit/);
    expect(d.carveOutComplete).toBe(false);
  });

  it('REQ-TSA-006: no exit without an accepted replacement with evidence', async () => {
    const t = await tsa(p.pm, projectId, tsaId);
    const req = await cmd(p.pm, tsaId, 'request-exit-approval', { expectedVersion: t.version });
    expect(req.status).toBe(422);
    expect(req.body.code).toBe('tsa.exit_not_evidenced');
    const appr = await cmd(p.sponsor, tsaId, 'approve-exit', { expectedVersion: t.version });
    expect(appr.status).toBe(422);
    expect(appr.body.code).toBe('tsa.exit.not_requested');
  });

  it('REQ-TSA-005: the extension awaits a FINAL approved decision — never automatic', async () => {
    let t = await tsa(p.pm, projectId, tsaId);
    const notRequested = await cmd(p.pm, tsaId, 'record-extension', { expectedVersion: t.version });
    expect(notRequested.status).toBe(422);
    expect(notRequested.body.code).toBe('tsa.extension.not_requested');
    const pendingDecision = (await decisionOfType(projectId, p, gov, 'tsa_approval_or_extension', { vote: false })).id;
    const req = await cmd(p.pm, tsaId, 'request-extension', { expectedVersion: t.version, decisionId: pendingDecision, proposedEndDate: plusDays(90), continuityPlan: 'Current operator continues NOC monitoring under the TSA terms (synthetic)' });
    expect(req.status, JSON.stringify(req.body)).toBe(201);
    expect(req.body.status).toBe('expired_unresolved'); // requesting changes nothing yet
    const refused = await cmd(p.pm, tsaId, 'record-extension', { expectedVersion: req.body.version });
    expect(refused.status).toBe(422);
    expect(refused.body.code).toBe('tsa.extension_requires_decision');
    expect(refused.body.detail).toMatch(/under_review/);
    t = await tsa(p.pm, projectId, tsaId);
    expect(t).toMatchObject({ status: 'expired_unresolved', proposedEndDate: plusDays(90), endDate: plusDays(10) });
    expect(t.extensionDecision).toMatchObject({ id: pendingDecision, status: 'under_review' });

    const approved = (await decisionOfType(projectId, p, gov, 'tsa_approval_or_extension')).id;
    const req2 = await cmd(p.pm, tsaId, 'request-extension', { expectedVersion: t.version, decisionId: approved, proposedEndDate: plusDays(90), continuityPlan: 'Current operator continues NOC monitoring under the TSA terms (synthetic)' });
    expect(req2.status, JSON.stringify(req2.body)).toBe(201);
    const ext = await cmd(p.pm, tsaId, 'record-extension', { expectedVersion: req2.body.version, note: 'Extension per approved decision (test)' });
    expect(ext.status, JSON.stringify(ext.body)).toBe(201);
    expect(ext.body.status).toBe('extended');
    t = await tsa(p.pm, projectId, tsaId);
    expect(t).toMatchObject({ endDate: plusDays(90), proposedEndDate: null, extensionDecisionId: approved, expiry: { kind: 'ok' } });
    // The same decision cannot back a further extension.
    const reuse = await cmd(p.pm, tsaId, 'request-extension', { expectedVersion: t.version, decisionId: approved, proposedEndDate: plusDays(120), continuityPlan: 'x' });
    expect(reuse.status).toBe(422);
    expect(reuse.body.code).toBe('tsa.extension.decision_already_used');
    const hist = await owner().query(`select snapshot->>'endDate' as end_date from record_version where entity_type = 'tsa_service' and entity_id = $1 order by version_no`, [tsaId]);
    expect(hist.rows.map((r) => r.end_date)).toContain(plusDays(10)); // the previous end date stays in the history
  });

  it('REQ-TSA-004: a replacement failure escalates with continuity / extension options; nothing is extended', async () => {
    const t = await tsa(p.pm, projectId, tsaId);
    const r = await cmd(p.pm, tsaId, 'report-replacement-failure', {
      expectedVersion: t.version,
      failureSummary: 'NewCo NOC tooling failed acceptance (synthetic)',
      continuityPlan: 'Keep the current operator NOC; weekly review (synthetic)',
      decisionDeadline: plusDays(7),
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.status).toBe('extended');
    const after = await tsa(p.pm, projectId, tsaId);
    expect(after).toMatchObject({ replacementAccepted: false, replacementFailureNote: 'NewCo NOC tooling failed acceptance (synthetic)', continuityPlan: 'Keep the current operator NOC; weekly review (synthetic)', endDate: plusDays(90) });
    // The expiry escalation is still open → reused (one open escalation per TSA).
    expect(r.body.escalationId).toBe(after.escalationId);

    // A fresh TSA without an open escalation gets its own, routed per the authority matrix.
    const created = await p.pm.post(`${P(projectId)}/tsa-services`, { name: 'Billing platform service (synthetic)', startDate: plusDays(-10), endDate: plusDays(100), ownerUserId: p.approver.userId, scope: 'Billing runs (synthetic)', replacementService: 'NewCo billing (synthetic)', exitMilestones: [{ title: 'Billing parallel run (synthetic)' }] });
    let v = created.body.version;
    for (const c of ['start_negotiation']) v = (await cmd(p.pm, created.body.id, 'transition', { expectedVersion: v, command: c })).body.version;
    v = (await cmd(p.pm, created.body.id, 'approve', { expectedVersion: v, decisionId: tsaDecisionId })).body.version;
    v = (await cmd(p.pm, created.body.id, 'transition', { expectedVersion: v, command: 'activate' })).body.version;
    const f = await cmd(p.pm, created.body.id, 'report-replacement-failure', { expectedVersion: v, failureSummary: 'Billing replacement not ready (synthetic)', continuityPlan: 'Continue under the TSA; decision requested (synthetic)', decisionDeadline: plusDays(14) });
    expect(f.status, JSON.stringify(f.body)).toBe(201);
    expect(f.body.status).toBe('active');
    const esc = await owner().query(`select status, decision_deadline::text as deadline, target, raised_by, raised_to_committee_id from escalation where id = $1`, [f.body.escalationId]);
    expect(esc.rows[0]).toMatchObject({ status: 'decision_requested', deadline: plusDays(14), raised_by: p.pm.userId, raised_to_committee_id: gov.committeeId });
    expect(esc.rows[0].target).toMatch(/within its delegated authority \(tsa_approval_or_extension/);
  });

  it('REQ-TSA-006: exit = accepted replacement with evidence + an independent approver bound to the request', async () => {
    let t = await tsa(p.pm, projectId, tsaId);
    const noEvidence = await cmd(p.pm, tsaId, 'accept-replacement', { expectedVersion: t.version, note: 'Accept (test)' });
    expect(noEvidence.status).toBe(422);
    expect(noEvidence.body.code).toBe('tsa.replacement.no_evidence');
    await addEvidence(p.pm, projectId, 'tsa_service', tsaId, 'Replacement acceptance test report (synthetic)');
    const acc = await cmd(p.pm, tsaId, 'accept-replacement', { expectedVersion: t.version, note: 'Replacement NOC accepted after parallel run (synthetic)' });
    expect(acc.status, JSON.stringify(acc.body)).toBe(201);
    const start = await cmd(p.pm, tsaId, 'transition', { expectedVersion: acc.body.version, command: 'start_exit' });
    expect(start.body.status).toBe('exit_in_progress');
    const req = await cmd(p.pm, tsaId, 'request-exit-approval', { expectedVersion: start.body.version, note: 'Exit ready (test)' });
    expect(req.status, JSON.stringify(req.body)).toBe(201);

    // Binding: a later change to the TSA invalidates the pending approval (fresh request needed).
    const edit = await p.pm.patch(`${P(projectId)}/tsa-services/${tsaId}`, { expectedVersion: req.body.version, residualRisks: 'Residual: tooling licence transfer (synthetic)' });
    expect(edit.status, JSON.stringify(edit.body)).toBe(200);
    const stale = await cmd(p.sponsor, tsaId, 'approve-exit', { expectedVersion: edit.body.version });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('tsa.exit.approval_stale');
    const req2 = await cmd(p.pm, tsaId, 'request-exit-approval', { expectedVersion: edit.body.version });
    expect(req2.status, JSON.stringify(req2.body)).toBe(201);
    expect((await owner().query(`select status from approval_request where id = $1`, [req.body.approvalRequestId])).rows[0].status).toBe('invalidated');

    // The TSA owner (a functional approver) cannot approve its own TSA's exit; the requester lacks the permission.
    const byOwner = await cmd(p.approver, tsaId, 'approve-exit', { expectedVersion: req2.body.version });
    expect(byOwner.status).toBe(403);
    expect(byOwner.body.code).toBe('tsa.exit.self_approval');
    const byRequester = await cmd(p.pm, tsaId, 'approve-exit', { expectedVersion: req2.body.version });
    expect(byRequester.status).toBe(403);
    const ok = await cmd(p.sponsor, tsaId, 'approve-exit', { expectedVersion: req2.body.version, note: 'Exit approved on accepted replacement evidence (test)' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body.status).toBe('exit_accepted');
    t = await tsa(p.pm, projectId, tsaId);
    expect(t).toMatchObject({ exitApprovedBy: p.sponsor.userId, exitApprovalStatus: 'approved', replacementAccepted: true, evidence: { active: 1 } });
    const rec = await owner().query(`select decision, approver_user_id from approval_record where approval_request_id = $1`, [req2.body.approvalRequestId]);
    expect(rec.rows).toEqual([{ decision: 'approve', approver_user_id: p.sponsor.userId }]);
    const closed = await p.pm.patch(`${P(projectId)}/tsa-services/${tsaId}`, { expectedVersion: t.version, residualRisks: 'After exit (test)' });
    expect(closed.status).toBe(422);
    expect(closed.body.code).toBe('tsa.locked');
  });

  it('charge basis and amount are shown to finance readers only', async () => {
    const byPm = await tsa(p.pm, projectId, tsaId);
    expect(byPm).toMatchObject({ chargeBasis: 'Monthly fixed fee (synthetic)', charge: { amount: '1000.0000', currency: 'SAR', unitScale: 1 }, chargeRedacted: false });
    const byContributor = await tsa(p.contributor, projectId, tsaId);
    expect(byContributor).toMatchObject({ chargeBasis: null, charge: null, chargeRedacted: true });
  });
});
