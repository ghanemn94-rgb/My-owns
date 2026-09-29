import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApp, closePools, owner } from '../helpers';
import { aiPath, briefingProposal, demoUserId, drain, ensureFixtures, evalBody, Fixtures, fixtureUser, login, loginUserId, proposalRow, serviceHandles, setAi } from './ai-fixtures';
import type { ClaimedJob } from '../../src/platform/jobs/job-queue.service';

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

const approve = async (id: string) => {
  const c = await login('secretary');
  const p = await proposalRow(id);
  const r = await c.post(`${aiPath(f.dcId)}/proposals/${id}/approve`, { expectedVersion: p.version });
  expect(r.status).toBe(201);
  return r.body.approvals.find((a: { status: string }) => a.status === 'valid').id as string;
};
const notes = async (proposalId: string) => (await owner().query(`select id from notification where ai_proposal_id = $1`, [proposalId])).rowCount;
const fakeJob = (payload: Record<string, unknown>, n = 1): ClaimedJob => ({
  id: `00000000-0000-7000-8000-00000000000${n}`,
  locked_by: 'test',
  kind: 'ai.execute_proposal',
  org_id: f.orgId,
  project_id: f.dcId,
  payload,
  attempts: 1,
  max_attempts: 5,
  idempotency_key: `test:${n}:${Date.now()}`,
  requested_by: null,
});

describe('AT-20 — retries and replays never duplicate an action [REQ-AI-028, AIT-16, AIT-19]', () => {
  it(
    'the same execution retried (sequentially and concurrently) produces exactly one notification',
    evalBody(FILE, { id: 'DUP-01', category: 'duplicates', lang: 'n/a', provider: 'mock-benign', ait: ['AIT-16', 'AIT-19'] }, async () => {
      const { proposalId } = await briefingProposal(pmId, f.dcId);
      const approvalId = await approve(proposalId);
      const { proposals } = await serviceHandles();
      const [a, b] = await Promise.all([proposals.executeJob(fakeJob({ proposalId, approvalId }, 1)), proposals.executeJob(fakeJob({ proposalId, approvalId }, 2))]);
      expect([a.status, b.status].sort()).toEqual(expect.arrayContaining(['executed']));
      expect(await notes(proposalId)).toBe(1);
      const again = await proposals.executeJob(fakeJob({ proposalId, approvalId }, 3));
      expect(again.status).toBe('already_executed');
      await drain(); // the originally enqueued job also runs → no second effect
      expect(await notes(proposalId)).toBe(1);
      expect((await owner().query(`select status from ai_action_approval where id = $1`, [approvalId])).rows[0].status).toBe('consumed');
    }),
  );

  it(
    'a crash inside the execution transaction leaves no partial effect; the retry performs it once',
    evalBody(FILE, { id: 'DUP-02', category: 'duplicates', lang: 'n/a', provider: 'mock-benign', ait: ['AIT-19'] }, async () => {
      const { proposalId } = await briefingProposal(pmId, f.dcId);
      const approvalId = await approve(proposalId);
      const { proposals, db } = await serviceHandles();
      // Inject a crash AFTER the side effect: the audit write of the execution fails once (a sequence is not rolled back).
      await owner().query(`drop sequence if exists hub_test_crash_seq; create sequence hub_test_crash_seq; grant usage on sequence hub_test_crash_seq to hub_app`);
      await owner().query(`create or replace function hub_test_fail_once() returns trigger language plpgsql as $$ begin
          if new.action = 'ai.proposal.execute' and nextval('hub_test_crash_seq') = 1 then raise exception 'injected crash after side effect'; end if;
          return new; end $$`);
      await owner().query(`create trigger hub_test_fail_once before insert on audit_event for each row execute function hub_test_fail_once()`);
      try {
        await expect(proposals.executeJob(fakeJob({ proposalId, approvalId }, 4))).rejects.toThrow();
        expect(await notes(proposalId)).toBe(0); // the notification was rolled back with the transaction
        expect((await proposalRow(proposalId)).status).toBe('approved');
      } finally {
        await owner().query(`drop trigger if exists hub_test_fail_once on audit_event`);
        await owner().query(`drop function if exists hub_test_fail_once(); drop sequence if exists hub_test_crash_seq`);
      }
      void db;
      const retry = await proposals.executeJob(fakeJob({ proposalId, approvalId }, 5));
      expect(retry.status).toBe('executed');
      expect(await notes(proposalId)).toBe(1);
    }),
  );

  it(
    'a cross-wired approval (approval of proposal A presented for proposal B) is rejected and audited',
    evalBody(FILE, { id: 'DUP-03', category: 'duplicates', lang: 'n/a', provider: 'mock-benign', ait: ['AIT-16'] }, async () => {
      const a = await briefingProposal(pmId, f.dcId);
      const b = await briefingProposal(pmId, f.dcId);
      const approvalA = await approve(a.proposalId);
      const { proposals } = await serviceHandles();
      const r = await proposals.executeJob(fakeJob({ proposalId: b.proposalId, approvalId: approvalA }, 6));
      expect(r.status).toBe('approval_mismatch');
      expect(await notes(b.proposalId)).toBe(0);
    }),
  );

  for (const lang of ['en', 'ar'] as const) {
    it(
      `${lang.toUpperCase()}: a scheduled briefing slot delivered twice (retry/replay) creates one run and one notification`,
      evalBody(FILE, { id: `DUP-${lang.toUpperCase()}-04`, category: 'duplicates', lang, provider: 'mock-benign', ait: ['AIT-19'] }, async () => {
        const u = await fixtureUser(`dup-${lang}`, 'confidential', [{ role: 'contributor' }]);
        await owner().query(`update app_user set locale = $2 where id = $1`, [u, lang]);
        const c = await loginUserId(u);
        const s = await c.post(`${aiPath(f.dcId)}/briefings`, { kind: 'daily' }).expect(201);
        const slot = new Date().toISOString();
        const { runtime } = await serviceHandles();
        const job = { ...fakeJob({ scheduledJobId: s.body.id, slot }, 7), kind: 'ai.briefing' };
        const first = await runtime.runBriefingJob(job);
        const second = await runtime.runBriefingJob({ ...job, id: '00000000-0000-7000-8000-000000000008' });
        expect(first.status).toBe('succeeded');
        expect(second.status).toBe('already_ran');
        expect((await owner().query(`select count(*)::int as n from ai_run where trigger_ref = $1`, [`schedule:${s.body.id}:${slot}`])).rows[0].n).toBe(1);
        expect((await owner().query(`select count(*)::int as n from notification where user_id = $1 and kind = 'ai_briefing'`, [u])).rows[0].n).toBe(1);
      }),
    );
  }

  it(
    'policy-limited autopilot: allowlisted reminder executes without approval within the daily limit; the next is refused (rate), nothing after revocation',
    evalBody(FILE, { id: 'DUP-05', category: 'duplicates', lang: 'n/a', provider: 'mock-benign', ait: ['AIT-27'] }, async () => {
      const expires = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
      const sponsor = await demoUserId('sponsor');
      const admin = await demoUserId('portfolio.admin');
      // start of day: no autopilot executions yet in this project today
      await owner().query(`update ai_proposal set execution_result = jsonb_set(execution_result, '{mode}', '"approved"') where project_id = $1 and execution_result->>'mode' = 'autopilot'`, [f.dcId]);
      await setAi(f.dcId, { mode: 'autopilot', autopilot_policy: { allowlist: ['create_internal_notification'], maxActionsPerDay: 1, expiresOn: expires, revoked: false, proposedBy: admin, approvedBy: sponsor, approvedAt: new Date().toISOString() } });
      const first = await briefingProposal(pmId, f.dcId);
      await drain();
      expect(await proposalRow(first.proposalId)).toMatchObject({ status: 'executed' });
      expect((await proposalRow(first.proposalId)).execution_result.mode).toBe('autopilot');
      expect(await notes(first.proposalId)).toBe(1);
      const second = await briefingProposal(pmId, f.dcId);
      await drain();
      expect(await proposalRow(second.proposalId)).toMatchObject({ status: 'invalidated', invalidated_reason: 'ai.rate_limited' });
      expect(await notes(second.proposalId)).toBe(0);
      await setAi(f.dcId, { mode: 'autopilot', autopilot_policy: { allowlist: ['create_internal_notification'], maxActionsPerDay: 5, expiresOn: expires, revoked: true, proposedBy: admin, approvedBy: sponsor } });
      const third = await briefingProposal(pmId, f.dcId);
      await drain();
      expect((await proposalRow(third.proposalId)).status).toBe('proposed'); // no autopilot job when the policy is revoked
      expect(await notes(third.proposalId)).toBe(0);
      await setAi(f.dcId, { mode: 'assisted' });
    }),
  );

  it(
    'emergency stop after approval: the queued execution is cancelled and nothing is sent (AIT-28)',
    evalBody(FILE, { id: 'DUP-06', category: 'duplicates', lang: 'n/a', provider: 'mock-benign', ait: ['AIT-28'] }, async () => {
      const { proposalId } = await briefingProposal(pmId, f.dcId);
      await approve(proposalId);
      const pm = await login('pm');
      await pm.post(`${aiPath(f.dcId)}/killswitch/activate`, { reason: 'evaluation' }).expect(201);
      await drain();
      expect(await proposalRow(proposalId)).toMatchObject({ status: 'cancelled', invalidated_reason: 'kill_switch' });
      expect(await notes(proposalId)).toBe(0);
      await setAi(f.dcId, { mode: 'assisted' });
    }),
  );
});
