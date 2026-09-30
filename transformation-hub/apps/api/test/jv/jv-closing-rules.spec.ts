import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ROUTES } from '@hub/contracts';
import { addCalendarDays } from '@hub/domain';
import { closeApp, closePools, getApp, loginAs, owner } from '../helpers';
import { Clock } from '../../src/platform/clock';
import { WorkerService } from '../../src/platform/jobs/worker.service';
import { JobRegistry } from '../../src/platform/jobs/job-registry';
import { registerJobHandlers } from '../../src/jobs';
import { P, auditRows, doc, ok, plusDays, setupJvProject, today, JvProject } from './jv-kit';

/**
 * Closing deliverables need the executed document (REQ-JV-014); funds flow is record-only (REQ-JV-015); overdue
 * conditions subsequent / post-close obligations escalate through the durable worker schedule, in the project timezone
 * (REQ-JV-016); program closure is separate from transaction closing and requires G7 to pass (REQ-JV-019).
 */
let j: JvProject;
let pid: string;
let closing: string;

beforeAll(async () => {
  j = await setupJvProject('JV-CLOSE');
  pid = j.projectId;
  const s = await ok(await j.p.pm.post(`${P(pid)}/signings`, { name: 'Rules signing (synthetic)' }));
  closing = (await ok(await j.p.pm.post(`${P(pid)}/closings`, { signingId: s.id, name: 'Rules closing (synthetic)' }))).id;
});
afterAll(async () => {
  (await getApp()).get(Clock).setFixed(null);
  await closeApp();
  await closePools();
});

async function runOverdueSchedule() {
  const app = await getApp();
  if (!app.get(JobRegistry).handler('jv.obligation_overdue_scan')) registerJobHandlers(app);
  const s = await owner().query(`update scheduled_job set next_run_at = now() - interval '1 second' where project_id = $1 and kind = 'jv.obligation_overdue_scan' returning id`, [pid]);
  expect(s.rowCount, 'overdue schedule exists for the project').toBe(1);
  const worker = app.get(WorkerService);
  expect(await worker.enqueueDueSchedules()).toBeGreaterThanOrEqual(1);
  for (let i = 0; i < 20; i++) {
    const d = await worker.dispatchOutbox(500);
    const e = await worker.runJobs(50);
    if (d === 0 && e === 0) break;
  }
  const job = await owner().query<{ status: string; result: Record<string, number>; last_error: string | null }>(`select status, result, last_error from job where project_id = $1 and kind = 'jv.obligation_overdue_scan' order by created_at desc limit 1`, [pid]);
  expect(job.rows[0]?.status, job.rows[0]?.last_error ?? '').toBe('succeeded');
  return job.rows[0]!.result;
}

describe('REQ-JV-014 — closing deliverables: acceptance requires the executed document', () => {
  it('UT: deliverable acceptance requires an executed document; never by its owner or deliverer', async () => {
    const item = await ok(await j.p.pm.post(`${P(pid)}/checklist-items`, { eventId: closing, title: 'Share transfer instrument (synthetic)', ownerUserId: j.p.pm.userId }));
    const notDelivered = await j.p.approver.post(`${P(pid)}/checklist-items/${item.id}/accept`, { expectedVersion: 1 });
    expect(notDelivered.status).toBe(422);
    expect(notDelivered.body.code).toBe('jv.checklist_item.not_delivered');
    const executed = await doc(j.p.legal, pid, 'Executed transfer instrument (synthetic)', { kind: 'agreement' });
    const delivered = await ok(await j.p.legal.post(`${P(pid)}/checklist-items/${item.id}/deliver`, { expectedVersion: 1, documentId: executed.id }));
    const byDeliverer = await j.p.legal.post(`${P(pid)}/checklist-items/${item.id}/accept`, { expectedVersion: delivered.version });
    expect(byDeliverer.status).toBe(403);
    // Fixture: the executed copy is missing on a delivered item (e.g. data repair) → acceptance is refused.
    await owner().query('update closing_deliverable set executed_version_id = null where id = $1', [item.id]);
    const noCopy = await j.p.approver.post(`${P(pid)}/checklist-items/${item.id}/accept`, { expectedVersion: delivered.version });
    expect(noCopy.status).toBe(422);
    expect(noCopy.body.code).toBe('jv.checklist_item.executed_document_required');
    await owner().query('update closing_deliverable set executed_version_id = $2 where id = $1', [item.id, executed.versionId]);
    const accepted = await ok(await j.p.approver.post(`${P(pid)}/checklist-items/${item.id}/accept`, { expectedVersion: delivered.version }));
    expect(accepted.status).toBe('verified');
    const d = (await j.p.pm.get(`${P(pid)}/closings/${closing}`).expect(200)).body;
    expect(d.checklist[0]).toMatchObject({ id: item.id, status: 'verified', documentId: executed.id, executedVersionId: executed.versionId, verifiedBy: j.p.approver.userId });
  });
});

describe('REQ-JV-015 — funds flow is RECORD-ONLY', () => {
  it('UT: funds flow is record-only; no payment endpoint exists', async () => {
    const jvRoutes = Object.values(ROUTES).filter((r) => r.id.startsWith('jv.'));
    expect(jvRoutes.length).toBeGreaterThan(60);
    expect(jvRoutes.filter((r) => /pay|execute|transfer|instruct|disburse|wire/i.test(`${r.id} ${r.path}`)).map((r) => r.id)).toEqual([]);
    const f = await ok(await j.p.finance.post(`${P(pid)}/closings/${closing}/funds-flows`, { description: 'Consideration (synthetic)', payer: 'Party B (label)', payee: 'Party A (label)', amount: { amount: '1250000.0000', currency: 'SAR', unitScale: 1 }, valueDate: plusDays(30) }));
    const list = (await j.p.pm.get(`${P(pid)}/closings/${closing}/funds-flows`).expect(200)).body;
    expect(list.notice).toMatch(/never executes/);
    expect(list.items[0]).toMatchObject({ id: f.id, status: 'planned', amount: { amount: '1250000.0000', currency: 'SAR', unitScale: 1 } });
    const pmTry = await j.p.pm.post(`${P(pid)}/funds-flows/${f.id}/transition`, { expectedVersion: 1, command: 'confirm' });
    expect(pmTry.status).toBe(403); // Finance Restricted only
    const c = await ok(await j.p.finance.post(`${P(pid)}/funds-flows/${f.id}/transition`, { expectedVersion: 1, command: 'confirm' }));
    const noRef = await j.p.finance.post(`${P(pid)}/funds-flows/${f.id}/transition`, { expectedVersion: c.version, command: 'report_settled' });
    expect(noRef.body.code).toBe('jv.funds_flow.settlement_reference_required');
    const settled = await ok(await j.p.finance.post(`${P(pid)}/funds-flows/${f.id}/transition`, { expectedVersion: c.version, command: 'report_settled', settlementReference: 'BANK-REF-SYNTHETIC-1' }));
    expect(settled.status).toBe('reported_settled');
    const bad = await j.p.finance.post(`${P(pid)}/closings/${closing}/funds-flows`, { description: 'x', payer: 'a', payee: 'b', amount: { amount: '1.5', currency: 'SAR', unitScale: 7 } });
    expect(bad.status).toBe(400);
    await expect(owner().query(`insert into funds_flow_item (org_id, project_id, closing_id, description, payer, payee, amount) values ($1,$2,$3,'probe','a','b', 10)`, [j.orgId, pid, closing])).rejects.toMatchObject({ code: '23514' });
  });
});

describe('REQ-JV-016 — conditions subsequent / post-close obligations escalate when overdue', () => {
  it('UT: overdue obligation escalates (worker job, durable per-project schedule, project timezone) — idempotent', async () => {
    const o = await ok(await j.p.pm.post(`${P(pid)}/post-close-obligations`, { kind: 'condition_subsequent', title: 'Post-closing filing (synthetic)', ownerUserId: j.p.pm.userId, dueDate: plusDays(3), closingId: closing }));
    const sched = await owner().query(`select cron, timezone from scheduled_job where project_id = $1 and kind = 'jv.obligation_overdue_scan'`, [pid]);
    expect(sched.rows).toEqual([{ cron: '0 6 * * *', timezone: 'Asia/Riyadh' }]);
    const r0 = await runOverdueSchedule();
    expect(r0).toMatchObject({ markedOverdue: 0, escalations: 0 });
    const clock = (await getApp()).get(Clock);
    clock.setFixed(new Date(`${addCalendarDays(today(), 5)}T09:00:00+03:00`));
    let first: Record<string, number>;
    let second: Record<string, number>;
    try {
      first = await runOverdueSchedule();
      second = await runOverdueSchedule();
    } finally {
      clock.setFixed(null);
    }
    expect(first).toMatchObject({ markedOverdue: 1, escalations: 1 });
    expect(second).toMatchObject({ markedOverdue: 0, escalations: 0 });
    const list = (await j.p.pm.get(`${P(pid)}/post-close-obligations`).expect(200)).body.items;
    const row = list.find((x: { id: string }) => x.id === o.id);
    expect(row).toMatchObject({ status: 'overdue', overdue: true, overdueSince: plusDays(4) });
    expect(row.escalationId).toBeTruthy();
    const esc = await owner().query(`select source_type, is_system_generated, raised_by, status from escalation where id = $1`, [row.escalationId]);
    expect(esc.rows).toEqual([{ source_type: 'post_close_obligation', is_system_generated: true, raised_by: null, status: 'open' }]);
    const audit = await owner().query(`select actor_kind from audit_event where project_id = $1 and action = 'jv.obligation.mark_overdue' and entity_id = $2`, [pid, o.id]);
    expect(audit.rows).toEqual([{ actor_kind: 'service' }]);
    // Verification needs evidence and a different person.
    const done = await ok(await j.p.pm.post(`${P(pid)}/post-close-obligations/${o.id}/transition`, { expectedVersion: row.version, command: 'report_complete', note: 'Filed (synthetic)' }));
    const noEvidence = await j.p.legal.post(`${P(pid)}/post-close-obligations/${o.id}/verify`, { expectedVersion: done.version, outcome: 'verify' });
    expect(noEvidence.body.code).toBe('jv.obligation.evidence_required');
    await ok(await j.p.pm.post(`${P(pid)}/evidence`, { targetType: 'post_close_obligation', targetId: o.id, note: 'Filing receipt (synthetic)' }));
    const v = await ok(await j.p.legal.post(`${P(pid)}/post-close-obligations/${o.id}/verify`, { expectedVersion: done.version, outcome: 'verify' }));
    expect(v.status).toBe('verified');
  });
});

describe('REQ-JV-019 — program closure is separate from transaction closing and requires G7', () => {
  it('UT: program closure rejected before G7 passes (and logged); then an authorized second person confirms', async () => {
    const st = (await j.p.pm.get(`${P(pid)}/program-closure`).expect(200)).body;
    expect(st).toMatchObject({ closure: null, g7Passed: false });
    const early = await j.p.pm.post(`${P(pid)}/program-closure/request`, { handoverNote: 'Handover pack (synthetic)' });
    expect(early.status).toBe(422);
    expect(early.body.code).toBe('jv.program_closure.g7_not_passed');
    expect((await auditRows(pid, 'jv.program_closure.request', pid)).map((r) => r.outcome)).toEqual(['rejected']);
    // Fixture: G7 approved (the G0–G7 chain through the gates API is exercised by the gates specs).
    await owner().query(`update gate_assessment set status = 'approved' where project_id = $1 and is_current and gate_id = (select id from gate_definition where project_id = $1 and key = 'G7')`, [pid]);
    const req = await ok(await j.p.pm.post(`${P(pid)}/program-closure/request`, { handoverNote: 'Handover pack (synthetic)' }));
    expect(req.status).toBe('requested');
    const byPm = await j.p.pm.post(`${P(pid)}/program-closure/confirm`, { expectedVersion: req.version, outcome: 'confirm' });
    expect(byPm.status).toBe(403); // portfolio.project.archive
    const admin = await loginAs('portfolio.admin');
    const done = await ok(await admin.post(`${P(pid)}/program-closure/confirm`, { expectedVersion: req.version, outcome: 'confirm', note: 'Administrative closure (test)' }));
    expect(done.status).toBe('confirmed');
    const after = (await j.p.pm.get(`${P(pid)}/program-closure`).expect(200)).body;
    expect(after).toMatchObject({ g7Passed: true, closure: { status: 'confirmed' } });
    // Transaction closing is untouched by program closure.
    expect((await j.p.pm.get(`${P(pid)}/closings/${closing}`).expect(200)).body.status).toBe('planned');
  });
});
