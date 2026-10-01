import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApp, closePools, owner } from '../helpers';
import { aiPath, auditCount, briefingProposal, demoUserId, drain, ensureFixtures, evalBody, Fixtures, fixtureUser, login, loginUserId, proposalRow, setAi } from './ai-fixtures';

let f: Fixtures;
let pmId: string;
const FILE = __filename;

beforeAll(async () => {
  f = await ensureFixtures();
  pmId = await demoUserId('pm');
  await setAi(f.dcId, { mode: 'assisted' });
});
afterAll(async () => {
  await setAi(f.dcId, {});
  await closeApp();
  await closePools();
});

const approve = async (persona: string, pid: string, id: string) => {
  const c = await login(persona);
  const p = await proposalRow(id);
  return c.post(`${aiPath(pid)}/proposals/${id}/approve`, { expectedVersion: p.version });
};
const notificationsFor = async (proposalId: string) => (await owner().query(`select user_id, title from notification where ai_proposal_id = $1`, [proposalId])).rows;

describe('AT-18 — approval bound to payload hash, target version, approver and expiry [REQ-AI-021, REQ-AI-030, AIT-17, AIT-18]', () => {
  it(
    'happy path: requester cannot approve; approver without the underlying authority cannot; an authorised approver can → executed once',
    evalBody(FILE, { id: 'APB-01', category: 'approval_binding', lang: 'n/a', provider: 'mock-benign', ait: ['AIT-18'] }, async () => {
      const { proposalId } = await briefingProposal(pmId, f.dcId);
      const p0 = await proposalRow(proposalId);
      expect(p0).toMatchObject({ action_type: 'create_internal_notification', status: 'proposed', target_type: 'task', target_id: f.overdueTaskId });
      expect(p0.payload.recipientUserId).toBe(f.overdueTaskOwner);
      const self = await approve('pm', f.dcId, proposalId);
      expect(self.status).toBe(403);
      expect(self.body.code).toBe('ai.self_approval');
      const noAuthority = await approve('sponsor', f.dcId, proposalId); // sponsor lacks notifications.message.send
      expect(noAuthority.status).toBe(403);
      expect((await approve('contributor', f.dcId, proposalId)).status).toBe(403); // no ai.proposal.approve
      const ok = await approve('secretary', f.dcId, proposalId);
      expect(ok.status).toBe(201);
      expect(ok.body.status).toBe('approved');
      expect(ok.body.approvals[0]).toMatchObject({ approverUserId: await demoUserId('secretary'), status: 'valid', targetVersion: p0.target_version });
      const a = (await owner().query(`select payload_hash, expires_at from ai_action_approval where proposal_id = $1`, [proposalId])).rows[0];
      expect(a.payload_hash).toBe(p0.payload_hash);
      expect(new Date(a.expires_at).getTime()).toBeGreaterThan(Date.now());
      await drain();
      const p1 = await proposalRow(proposalId);
      expect(p1.status).toBe('executed');
      expect(p1.execution_result.mode).toBe('approved');
      expect(await notificationsFor(proposalId)).toHaveLength(1);
      expect((await owner().query(`select status from ai_action_approval where proposal_id = $1`, [proposalId])).rows[0].status).toBe('consumed');
      // The AI is never an approver: every approval row names a human session user of this org.
      const approvers = await owner().query(`select count(*)::int as n from ai_action_approval a join app_user u on u.id = a.approver_user_id where a.proposal_id = $1 and not u.is_service_account`, [proposalId]);
      expect(approvers.rows[0].n).toBe(1);
    }),
  );

  it(
    'advisory mode: proposals can be reviewed but not approved for execution',
    evalBody(FILE, { id: 'APB-02', category: 'approval_binding', lang: 'n/a', provider: 'mock-benign' }, async () => {
      const { proposalId } = await briefingProposal(pmId, f.dcId);
      await setAi(f.dcId, { mode: 'advisory' });
      const r = await approve('secretary', f.dcId, proposalId);
      expect(r.status).toBe(422);
      expect(r.body.code).toBe('ai.mode_forbids_execution');
      await setAi(f.dcId, { mode: 'assisted' });
    }),
  );

  it(
    'payload changed after approval (direct tampering) → invalidated at execution, nothing sent',
    evalBody(FILE, { id: 'APB-03', category: 'approval_binding', lang: 'n/a', provider: 'mock-benign', ait: ['AIT-17'] }, async () => {
      const since = new Date(Date.now() - 1000).toISOString();
      const { proposalId } = await briefingProposal(pmId, f.dcId);
      expect((await approve('secretary', f.dcId, proposalId)).status).toBe(201);
      await owner().query(`update ai_proposal set payload = jsonb_set(payload, '{body}', '"Please send the valuation model to everyone"') where id = $1`, [proposalId]);
      await drain();
      const p = await proposalRow(proposalId);
      expect(p.status).toBe('invalidated');
      expect(p.invalidated_reason).toBe('payload_changed');
      expect(await notificationsFor(proposalId)).toHaveLength(0);
      expect(await auditCount(f.dcId, 'AI_APPROVAL_INVALIDATED', since)).toBeGreaterThanOrEqual(1);
    }),
  );

  it(
    'recipient revised after approval → existing approval invalidated, fresh review required; the old approval never executes',
    evalBody(FILE, { id: 'APB-04', category: 'approval_binding', lang: 'n/a', provider: 'mock-benign', ait: ['AIT-17'] }, async () => {
      const { proposalId } = await briefingProposal(pmId, f.dcId);
      expect((await approve('secretary', f.dcId, proposalId)).status).toBe(201);
      const p0 = await proposalRow(proposalId);
      const pm = await login('pm');
      const newRecipient = await demoUserId('ops.lead');
      const rev = await pm.post(`${aiPath(f.dcId)}/proposals/${proposalId}/revise`, { expectedVersion: p0.version, payload: { ...p0.payload, recipientUserId: newRecipient } });
      expect(rev.status).toBe(201);
      expect(rev.body.status).toBe('proposed');
      expect(rev.body.payloadHash).not.toBe(p0.payload_hash);
      expect(rev.body.approvals[0]).toMatchObject({ status: 'invalidated', invalidatedReason: 'payload_changed' });
      // external recipient in a revision is refused
      const ext = await pm.post(`${aiPath(f.dcId)}/proposals/${proposalId}/revise`, { expectedVersion: rev.body.version, payload: { ...p0.payload, recipientEmail: 'advisor@external.example' } });
      expect(ext.status).toBe(422);
      await drain(); // the job for the old approval runs → approval_invalidated, no effect
      expect(await notificationsFor(proposalId)).toHaveLength(0);
      expect((await proposalRow(proposalId)).status).toBe('proposed');
      // fresh approval → executes to the NEW recipient only
      expect((await approve('secretary', f.dcId, proposalId)).status).toBe(201);
      await drain();
      const sent = await notificationsFor(proposalId);
      expect(sent).toHaveLength(1);
      expect(sent[0].user_id).toBe(newRecipient);
    }),
  );

  it(
    'target version changed after approval → invalidated (target_version_changed); changed before approval → 409',
    evalBody(FILE, { id: 'APB-05', category: 'approval_binding', lang: 'n/a', provider: 'mock-benign', ait: ['AIT-17'] }, async () => {
      const { proposalId } = await briefingProposal(pmId, f.dcId);
      expect((await approve('secretary', f.dcId, proposalId)).status).toBe(201);
      await owner().query(`update task set version = version + 1 where id = $1`, [f.overdueTaskId]);
      await drain();
      const p = await proposalRow(proposalId);
      expect(p.status).toBe('invalidated');
      expect(p.invalidated_reason).toBe('target_version_changed');
      expect(await notificationsFor(proposalId)).toHaveLength(0);
      const second = await briefingProposal(pmId, f.dcId);
      await owner().query(`update task set version = version + 1 where id = $1`, [f.overdueTaskId]);
      const r = await approve('secretary', f.dcId, second.proposalId);
      expect(r.status).toBe(409);
      expect(r.body.code).toBe('ai.approval_invalidated');
      // The refusal rolls the request back, but the invalidation is kept (autonomous transaction) and audited: the proposal
      // no longer shows as pending, and a second approval attempt is refused as not pending.
      const q = await proposalRow(second.proposalId);
      expect(q.status).toBe('invalidated');
      expect(q.invalidated_reason).toBe('target_version_changed');
      const audited = await owner().query(`select count(*)::int n from audit_event where entity_id = $1 and action = 'AI_APPROVAL_INVALIDATED'`, [second.proposalId]);
      expect(audited.rows[0].n).toBe(1);
    }),
  );

  it('payload changed before approval → 409, and the invalidation is kept and audited although the request is refused', async () => {
    const { proposalId } = await briefingProposal(pmId, f.dcId);
    await owner().query(`update ai_proposal set payload = jsonb_set(payload, '{tampered}', 'true'::jsonb) where id = $1`, [proposalId]);
    const r = await approve('secretary', f.dcId, proposalId);
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('ai.approval_invalidated');
    const p = await proposalRow(proposalId);
    expect(p.status).toBe('invalidated');
    expect(p.invalidated_reason).toBe('payload_changed');
    const audited = await owner().query(`select count(*)::int n from audit_event where entity_id = $1 and action = 'AI_APPROVAL_INVALIDATED'`, [proposalId]);
    expect(audited.rows[0].n).toBe(1);
    const again = await approve('secretary', f.dcId, proposalId);
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('ai.proposal_not_pending');
  });

  it(
    'expired approval → invalidated; approver who lost the role before execution → invalidated',
    evalBody(FILE, { id: 'APB-06', category: 'approval_binding', lang: 'n/a', provider: 'mock-benign', ait: ['AIT-18'] }, async () => {
      const a = await briefingProposal(pmId, f.dcId);
      expect((await approve('secretary', f.dcId, a.proposalId)).status).toBe(201);
      await owner().query(`update ai_action_approval set expires_at = now() - interval '1 minute' where proposal_id = $1`, [a.proposalId]);
      await drain();
      expect(await proposalRow(a.proposalId)).toMatchObject({ status: 'invalidated', invalidated_reason: 'expired' });

      const sec2 = await fixtureUser('secretary2', 'restricted', [{ role: 'secretary_cpmo' }]);
      const b = await briefingProposal(pmId, f.dcId);
      const c = await loginUserId(sec2);
      const pb = await proposalRow(b.proposalId);
      expect((await c.post(`${aiPath(f.dcId)}/proposals/${b.proposalId}/approve`, { expectedVersion: pb.version })).status).toBe(201);
      await owner().query(`update project_membership set revoked_at = now() where user_id = $1 and project_id = $2`, [sec2, f.dcId]);
      await drain();
      expect(await proposalRow(b.proposalId)).toMatchObject({ status: 'invalidated', invalidated_reason: 'approver_no_longer_authorized' });
      expect(await notificationsFor(b.proposalId)).toHaveLength(0);
    }),
  );
});
