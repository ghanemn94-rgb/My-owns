import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApp, closePools, loginAs, owner, Client } from '../helpers';
import { P, openMeeting, setupCommittee, type Actors, type TestCommittee } from '../governance/gov-fixtures';
import { addEvidence, auditCount, createProject, grant, task, workstreams } from './fixtures';

/**
 * DOM-P2-07 — a task's (or a task deliverable's) designated approver role is enforced at acceptance (spec §6, §9;
 * REQ-PLN-011) and My Work only offers it to that role.
 * DOM-P2-09 — My Work lists evidence verification, action-closure verification and minutes approval with the same policy
 * checks as the commands, separation of duties included (REQ-UX-018). Synthetic project.
 */
let pid: string;
let a: Actors;
let admin: Client;
let ws1: string;
let tc: TestCommittee;

type WorkItem = { type: string; entityId: string; projectId: string; linkPath: string };
const myWork = async (c: Client) => ((await c.get('/api/v1/me/work').expect(200)).body.items as WorkItem[]).filter((i) => i.projectId === pid);
const T = (id: string) => `${P(pid)}/tasks/${id}`;
const taskRow = async (id: string) => (await owner().query(`select status, version, approver_role from task where id = $1`, [id])).rows[0];

beforeAll(async () => {
  admin = await loginAs('portfolio.admin');
  const keys = ['secretary', 'sponsor', 'chair', 'pm', 'finance', 'legal', 'approver', 'contributor'] as const;
  a = {} as Actors;
  for (const k of keys) a[k] = await loginAs(k);
  pid = await createProject(admin, a.pm, 'MW-P2FX');
  await grant(admin, pid, a.approver, 'functional_approver');
  await grant(admin, pid, a.sponsor, 'sponsor');
  await grant(admin, pid, a.secretary, 'secretary_cpmo');
  await grant(admin, pid, a.chair, 'committee_chair');
  await grant(admin, pid, a.finance, 'finance_restricted');
  await grant(admin, pid, a.legal, 'legal_restricted');
  ws1 = (await workstreams(a.pm, pid)).get('WS01')!.id;
}, 300_000);
afterAll(async () => {
  await closeApp();
  await closePools();
});

async function submittedTask(title: string, approverRole: string) {
  const t = await task(a.pm, pid, ws1, title, { approverRole, requiresAcceptance: true, durationDays: 2 });
  await a.pm.post(`${T(t)}/start`, { expectedVersion: 1 }).expect(201);
  await a.pm.post(`${T(t)}/submit-for-acceptance`, { expectedVersion: 2 }).expect(201);
  await addEvidence(pid, 'task', t, a.pm.userId);
  return t;
}

describe('DOM-P2-07 — the designated approver role accepts, nobody else [REQ-PLN-011]', () => {
  it('a task designating the functional approver is offered to and accepted by the functional approver', async () => {
    const t = await submittedTask('Approver-role task (synthetic)', 'functional_approver');
    expect((await myWork(a.approver)).some((i) => i.type === 'task_acceptance' && i.entityId === t)).toBe(true);
    await a.approver.post(`${T(t)}/accept`, { expectedVersion: 3, note: 'Evidence reviewed (synthetic)' }).expect(201);
    expect((await taskRow(t)).status).toBe('accepted');
  });

  it('a sponsor-approved task is neither offered to nor accepted or returned by a functional approver; its approver role is locked while submitted', async () => {
    const t = await submittedTask('Sponsor-approved task (synthetic)', 'sponsor');
    expect((await myWork(a.approver)).some((i) => i.entityId === t)).toBe(false);
    const deniedBefore = (await auditCount(a.approver.userId, 'denied', 'planning.acceptTask')) + (await auditCount(a.approver.userId, 'denied', 'planning.rejectTaskAcceptance'));
    const acc = await a.approver.post(`${T(t)}/accept`, { expectedVersion: 3 });
    expect(acc.status).toBe(403);
    expect(acc.body.code).toBe('planning.acceptance.not_approver_role');
    const ret = await a.approver.post(`${T(t)}/reject-acceptance`, { expectedVersion: 3, reason: 'probe' });
    expect(ret.status).toBe(403);
    const swap = await a.pm.patch(T(t), { expectedVersion: 3, approverRole: 'functional_approver' });
    expect(swap.status).toBe(422);
    expect(swap.body.code).toBe('task.approver_role_locked');
    expect(await taskRow(t)).toMatchObject({ status: 'submitted_for_acceptance', version: 3, approver_role: 'sponsor' });
    // Both refusals are audited as denied (problem filter), even though the UI would never offer the commands.
    const deniedAfter = (await auditCount(a.approver.userId, 'denied', 'planning.acceptTask')) + (await auditCount(a.approver.userId, 'denied', 'planning.rejectTaskAcceptance'));
    expect(deniedAfter).toBe(deniedBefore + 2);
  });

  it("a deliverable produced by a sponsor-approved task carries that task's approver role", async () => {
    const t = await task(a.pm, pid, ws1, 'Deliverable parent task (synthetic)', { approverRole: 'sponsor', requiresAcceptance: true });
    const d = (await a.pm.post(`${P(pid)}/deliverables`, { workstreamId: ws1, taskId: t, title: 'Sponsor-approved deliverable (synthetic)' }).expect(201)).body.id as string;
    await a.pm.post(`${P(pid)}/deliverables/${d}/start`, { expectedVersion: 1 }).expect(201);
    await a.pm.post(`${P(pid)}/deliverables/${d}/submit`, { expectedVersion: 2 }).expect(201);
    await addEvidence(pid, 'deliverable', d, a.pm.userId);
    expect((await myWork(a.approver)).some((i) => i.entityId === d)).toBe(false);
    const r = await a.approver.post(`${P(pid)}/deliverables/${d}/accept`, { expectedVersion: 3 });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('planning.acceptance.not_approver_role');
  });
});

describe('DOM-P2-09 — evidence verification, action closure and minutes approval in My Work, with separation of duties [REQ-UX-018, AT-30]', () => {
  it('unverified evidence is offered to a verifier, never to the person who linked it; it leaves My Work once verified', async () => {
    const t = await task(a.pm, pid, ws1, 'Evidence target task (synthetic)');
    const link = await a.pm.post(`${P(pid)}/evidence`, { targetType: 'task', targetId: t, note: 'Signed hand-over note (synthetic)' });
    expect(link.status, JSON.stringify(link.body)).toBe(201);
    const item = (await myWork(a.finance)).find((i) => i.type === 'evidence_verification' && i.entityId === link.body.id);
    expect(item?.linkPath).toBe(`/projects/${pid}/plan/tasks/${t}`);
    expect((await myWork(a.pm)).some((i) => i.type === 'evidence_verification' && i.entityId === link.body.id)).toBe(false);
    expect((await myWork(a.contributor)).some((i) => i.type === 'evidence_verification')).toBe(false); // no verify permission
    await a.finance.post(`${P(pid)}/evidence/${link.body.id}/verify`, { expectedVersion: 1, decision: 'accept', note: 'Checked (synthetic)' }).expect(201);
    expect((await myWork(a.finance)).some((i) => i.entityId === link.body.id)).toBe(false);
  });

  it('an action reported done is offered for closure verification to the secretariat, not to the person who reported it', async () => {
    tc = await setupCommittee(pid, a, { matrix: false });
    const act = (await a.secretary.post(`${P(pid)}/actions`, { title: 'Circulate the synthetic cut-over checklist', ownerUserId: a.pm.userId, dueDate: '2026-12-31' }).expect(201)).body;
    await a.pm.post(`${P(pid)}/actions/${act.id}/report-done`, { expectedVersion: act.version, closureEvidenceNote: 'Checklist sent (synthetic)' }).expect(201);
    expect((await myWork(a.secretary)).some((i) => i.type === 'action_closure_verification' && i.entityId === act.id)).toBe(true);
    expect((await myWork(a.pm)).some((i) => i.type === 'action_closure_verification' && i.entityId === act.id)).toBe(false);
  });

  it('draft minutes are offered to the chair for approval, never to their drafter', async () => {
    const m = await openMeeting(pid, a, tc, []);
    let v = (await a.secretary.get(`${P(pid)}/meetings/${m.id}`).expect(200)).body.version as number;
    v = (await a.secretary.post(`${P(pid)}/meetings/${m.id}/close`, { expectedVersion: v }).expect(201)).body.version;
    await a.secretary.post(`${P(pid)}/meetings/${m.id}/minutes`, { expectedVersion: v, text: 'Synthetic minutes for the My Work test' }).expect(201);
    expect((await myWork(a.chair)).some((i) => i.type === 'minutes_approval' && i.entityId === m.id)).toBe(true);
    expect((await myWork(a.secretary)).some((i) => i.type === 'minutes_approval' && i.entityId === m.id)).toBe(false);
  });
});
