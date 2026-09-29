import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApp, closePools, owner } from '../helpers';
import { aiPath, auditCount, drain, ensureFixtures, Fixtures, login, setAi } from './ai-fixtures';

let f: Fixtures;
const T0 = new Date(Date.now() - 1000).toISOString();

beforeAll(async () => {
  f = await ensureFixtures();
});
afterAll(async () => {
  await setAi(f.dcId, {});
  await closeApp();
  await closePools();
});

describe('AI settings & modes [REQ-AI-019, REQ-AI-020, REQ-AI-022, REQ-AI-023, REQ-AI-034]', () => {
  it('Project B stays Off by default; enabling a provider defaults to Advisory and requires a budget', async () => {
    // pristine Project-B row (other evaluation files may have toggled it)
    await owner().query(`update ai_project_settings set mode = 'off', provider = 'off', model = null, monthly_token_budget = 0 where project_id = $1`, [f.genId]);
    const pmB = await login('pm.b');
    // pm.b cannot manage AI settings (ai.settings.manage is sponsor/portfolio admin) → 403
    await pmB.get(`${aiPath(f.genId)}/settings`).expect(403);
    const admin = await login('portfolio.admin');
    const s = await admin.get(`${aiPath(f.genId)}/settings`).expect(200);
    expect(s.body.mode).toBe('off');
    expect(s.body.provider).toBe('off');
    expect(s.body.providerStatus).toBe('off');
    const noBudget = await admin.agent.put(`${aiPath(f.genId)}/settings`).set('x-csrf-token', admin.csrf).send({ expectedVersion: s.body.version, provider: 'mock' });
    expect(noBudget.status).toBe(422);
    expect(noBudget.body.code).toBe('ai.budget_required');
    const ok = await admin.agent.put(`${aiPath(f.genId)}/settings`).set('x-csrf-token', admin.csrf).send({ expectedVersion: s.body.version, provider: 'mock', monthlyTokenBudget: 1000 }).expect(200);
    expect(ok.body.mode).toBe('advisory'); // default when enabled
    expect(ok.body.providerStatus).toBe('simulated');
    // stale version → 409
    const stale = await admin.agent.put(`${aiPath(f.genId)}/settings`).set('x-csrf-token', admin.csrf).send({ expectedVersion: s.body.version, mode: 'off' });
    expect(stale.status).toBe(409);
    // back to Off (Project B's demo state)
    await admin.agent.put(`${aiPath(f.genId)}/settings`).set('x-csrf-token', admin.csrf).send({ expectedVersion: ok.body.version, provider: 'off' }).expect(200);
    expect((await owner().query(`select mode from ai_project_settings where project_id = $1`, [f.genId])).rows[0].mode).toBe('off');
  });

  it('rejects unsafe settings: ceiling above the provider maximum, unconfigured providers, autopilot without an approved policy', async () => {
    const sponsor = await login('sponsor');
    const cur = (await sponsor.get(`${aiPath(f.dcId)}/settings`).expect(200)).body;
    const put = (b: Record<string, unknown>) => sponsor.agent.put(`${aiPath(f.dcId)}/settings`).set('x-csrf-token', sponsor.csrf).send({ expectedVersion: cur.version, ...b });
    expect((await put({ maxClassificationToProvider: 'strictly_confidential' })).body.code).toBe('ai.ceiling_exceeds_provider_limit');
    expect((await put({ provider: 'openai_compatible' })).body.code).toBe('ai.provider_not_configured');
    expect((await put({ provider: 'anthropic' })).body.code).toBe('ai.provider_not_configured');
    expect((await put({ mode: 'autopilot' })).body.code).toBe('ai.autopilot_policy_required');
    expect((await put({ provider: 'mock', model: 'gpt-something' })).body.code).toBe('ai.invalid_model');
    expect((await put({ briefingCron: '99 99 * * *' })).body.code).toBe('ai.invalid_schedule');
    const after = (await sponsor.get(`${aiPath(f.dcId)}/settings`).expect(200)).body;
    expect(after.version).toBe(cur.version); // nothing changed
  });

  it('autopilot policy: proposed by one person, approved by ANOTHER (not_self), allowlist limited to eligible actions', async () => {
    const admin = await login('portfolio.admin');
    const sponsor = await login('sponsor');
    const cur = (await admin.get(`${aiPath(f.dcId)}/settings`).expect(200)).body;
    const expires = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10);
    const bad = await admin.agent.put(`${aiPath(f.dcId)}/settings`).set('x-csrf-token', admin.csrf).send({ expectedVersion: cur.version, autopilotPolicy: { allowlist: ['draft_minutes'], maxActionsPerDay: 5, expiresOn: expires } });
    expect(bad.status).toBe(422);
    expect(bad.body.code).toBe('ai.autopilot_policy_invalid');
    const proposed = await admin.agent.put(`${aiPath(f.dcId)}/settings`).set('x-csrf-token', admin.csrf).send({ expectedVersion: cur.version, autopilotPolicy: { allowlist: ['create_internal_notification'], maxActionsPerDay: 5, expiresOn: expires } }).expect(200);
    expect(proposed.body.autopilotPolicy.status).toBe('proposed');
    // The sponsor proposes a new version → the sponsor cannot approve their own policy.
    const byS = await sponsor.agent.put(`${aiPath(f.dcId)}/settings`).set('x-csrf-token', sponsor.csrf).send({ expectedVersion: proposed.body.version, autopilotPolicy: { allowlist: ['create_internal_notification'], maxActionsPerDay: 3, expiresOn: expires } }).expect(200);
    const self = await sponsor.post(`${aiPath(f.dcId)}/autopilot-policy/approve`, { expectedVersion: byS.body.version });
    expect(self.status).toBe(403);
    expect(await auditCount(f.dcId, 'ai.autopilot.approve', T0)).toBeGreaterThanOrEqual(1); // denied attempt audited by the problem filter
    // portfolio admin lacks ai.autopilot_policy.approve entirely
    expect((await admin.post(`${aiPath(f.dcId)}/autopilot-policy/approve`, { expectedVersion: byS.body.version })).status).toBe(403);
    // re-propose by the admin, approve by the sponsor
    const again = await admin.agent.put(`${aiPath(f.dcId)}/settings`).set('x-csrf-token', admin.csrf).send({ expectedVersion: byS.body.version, autopilotPolicy: { allowlist: ['create_internal_notification'], maxActionsPerDay: 3, expiresOn: expires } }).expect(200);
    const approved = await sponsor.post(`${aiPath(f.dcId)}/autopilot-policy/approve`, { expectedVersion: again.body.version }).expect(201);
    expect(approved.body.autopilotPolicy.status).toBe('approved');
    const auto = await admin.agent.put(`${aiPath(f.dcId)}/settings`).set('x-csrf-token', admin.csrf).send({ expectedVersion: approved.body.version, mode: 'autopilot' }).expect(200);
    expect(auto.body.mode).toBe('autopilot');
    const revoked = await admin.post(`${aiPath(f.dcId)}/autopilot-policy/revoke`, { expectedVersion: auto.body.version, reason: 'test: revoke' }).expect(201);
    expect(revoked.body.mode).toBe('assisted');
    expect(revoked.body.autopilotPolicy.status).toBe('revoked');
  });
});

describe('Kill switch [REQ-AI-031, AIT-28]', () => {
  it('blocks asks, cancels queued AI jobs and pending approvals/proposals; release requires a different person', async () => {
    await setAi(f.dcId, { mode: 'assisted' });
    const pm = await login('pm');
    // a queued async ask (job) to be cancelled
    const queued = await pm.post(`${aiPath(f.dcId)}/ask`, { question: 'What is overdue?', async: true }).expect(201);
    expect(queued.body.status).toBe('queued');
    const act = await pm.post(`${aiPath(f.dcId)}/killswitch/activate`, { reason: 'test emergency stop' }).expect(201);
    expect(act.body.killSwitch).toBe(true);
    expect(act.body.cancelledJobs).toBeGreaterThanOrEqual(1);
    const job = await owner().query(`select status, last_error from job where idempotency_key = $1`, [`ai-run:${queued.body.id}`]);
    expect(job.rows[0]).toMatchObject({ status: 'cancelled', last_error: 'cancelled_killswitch' });
    const pendingProposals = await owner().query(`select count(*)::int as n from ai_proposal where project_id = $1 and status in ('proposed','approved')`, [f.dcId]);
    expect(pendingProposals.rows[0].n).toBe(0); // history preserved as 'cancelled'
    expect((await owner().query(`select count(*)::int as n from ai_proposal where project_id = $1 and invalidated_reason = 'kill_switch'`, [f.dcId])).rows[0].n).toBeGreaterThanOrEqual(1);
    const blocked = await pm.post(`${aiPath(f.dcId)}/ask`, { question: 'Summarise the programme' });
    expect(blocked.status).toBe(422);
    expect(blocked.body.code).toBe('ai.kill_switch');
    expect(await auditCount(f.dcId, 'AI_KILLSWITCH_BLOCKED', T0)).toBeGreaterThanOrEqual(1);
    // pm lacks release; sponsor may release (different person); the activator never can (not_self).
    expect((await pm.post(`${aiPath(f.dcId)}/killswitch/release`, { reason: 'x' })).status).toBe(403);
    await owner().query(`update ai_project_settings set kill_switch_by = (select id from app_user where email = 'demo.sponsor@demo.invalid') where project_id = $1`, [f.dcId]);
    const sponsor = await login('sponsor');
    expect((await sponsor.post(`${aiPath(f.dcId)}/killswitch/release`, { reason: 'self release attempt' })).status).toBe(403);
    await owner().query(`update ai_project_settings set kill_switch_by = (select id from app_user where email = 'demo.pm@demo.invalid') where project_id = $1`, [f.dcId]);
    await sponsor.post(`${aiPath(f.dcId)}/killswitch/release`, { reason: 'test over' }).expect(201);
    expect((await owner().query(`select kill_switch from ai_project_settings where project_id = $1`, [f.dcId])).rows[0].kill_switch).toBe(false);
  });
});

describe('Briefing schedules, status, costs, tool matrix, runs isolation [REQ-AI-010, REQ-AI-026, REQ-AI-029, REQ-AI-033, REQ-AI-024]', () => {
  it('subscribing creates a durable scheduled_job owned by the subscriber (07:30 Asia/Riyadh by default)', async () => {
    await setAi(f.dcId, {});
    const chair = await login('chair');
    const r = await chair.post(`${aiPath(f.dcId)}/briefings`, { kind: 'daily' }).expect(201);
    expect(r.body).toMatchObject({ kind: 'daily', cron: '30 7 * * *', timezone: 'Asia/Riyadh', enabled: true, ownerUserId: chair.userId });
    expect(new Date(r.body.nextRunAt).getUTCHours()).toBe(4); // 07:30 Riyadh = 04:30 UTC
    const again = await chair.post(`${aiPath(f.dcId)}/briefings`, { kind: 'daily', cron: '0 6 * * 0-4' }).expect(201);
    expect(again.body.id).toBe(r.body.id); // upsert, not a duplicate schedule
    const mine = await chair.get(`${aiPath(f.dcId)}/briefings`).expect(200);
    expect(mine.body.items).toHaveLength(1);
    const row = await owner().query(`select kind, owner_user_id, payload from scheduled_job where id = $1`, [r.body.id]);
    expect(row.rows[0]).toMatchObject({ kind: 'ai.briefing', owner_user_id: chair.userId });
    await chair.post(`${aiPath(f.dcId)}/briefings`, { kind: 'daily', enabled: false }).expect(201);
  });

  it('status shows mode, Simulated label, last/next run, budget and a manual fallback; costs per month for operations', async () => {
    const pm = await login('pm');
    const st = await pm.get(`${aiPath(f.dcId)}/status`).expect(200);
    expect(st.body).toMatchObject({ mode: 'advisory', provider: 'mock', providerStatus: 'simulated', simulated: true, health: 'ok' });
    expect(st.body.providerLabel).toMatch(/Simulated/);
    expect(st.body.nextRunAt).not.toBeNull(); // pm's seeded 07:30 briefing
    expect(st.body.manualFallback).toMatch(/optional/);
    expect((await pm.get(`${aiPath(f.dcId)}/costs`)).status).toBe(403); // ai.operations.read only
    const auditor = await login('auditor');
    const c = await auditor.get(`${aiPath(f.dcId)}/costs`).expect(200);
    expect(c.body.items.length).toBeGreaterThanOrEqual(1);
    expect(c.body.items[0].costEstimate).toBe('0.0000'); // mock costs nothing
  });

  it('tool matrix lists every tool with its permission and ai flag; no tool maps to a prohibited action', async () => {
    const pm = await login('pm');
    const m = await pm.get(`${aiPath(f.dcId)}/tools`).expect(200);
    expect(m.body.items.length).toBeGreaterThanOrEqual(20);
    for (const t of m.body.items) {
      expect(t.aiFlag === 'none' ? t.permission === null : t.aiFlag === t.kind).toBe(true);
      expect(m.body.prohibitedActions).not.toContain(t.action);
    }
    expect(m.body.prohibitedActions).toEqual(expect.arrayContaining(['approve_gate', 'declare_closing', 'grant_vdr_access', 'verify_condition', 'create_waiver']));
  });

  it("runs are per user: another user's run is 404; a Project-B user sees nothing of Project A (AIT-08, AT-03)", async () => {
    const pm = await login('pm');
    const run = await pm.post(`${aiPath(f.dcId)}/ask`, { question: 'What is overdue?' }).expect(201);
    expect(run.body.status).toBe('succeeded');
    await pm.get(`${aiPath(f.dcId)}/runs/${run.body.id}`).expect(200);
    const sponsor = await login('sponsor');
    await sponsor.get(`${aiPath(f.dcId)}/runs/${run.body.id}`).expect(404);
    const list = await sponsor.get(`${aiPath(f.dcId)}/runs`).expect(200);
    expect(list.body.items.map((x: { id: string }) => x.id)).not.toContain(run.body.id);
    const pmB = await login('pm.b');
    await pmB.get(`${aiPath(f.dcId)}/runs/${run.body.id}`).expect(404);
    await pmB.get(`${aiPath(f.dcId)}/status`).expect(404);
    expect((await pmB.post(`${aiPath(f.dcId)}/ask`, { question: 'What is overdue?' })).status).toBe(404);
    const contributor = await login('contributor');
    await contributor.get(`${aiPath(f.dcId)}/runs`).expect(403); // contributors may ask but hold no ai.run.read
  });

  it('rules-only detections list overdue work, missing owners and blocking CPs without any provider', async () => {
    await setAi(f.dcId, { mode: 'off', provider: 'off' });
    const pm = await login('pm');
    const d = await pm.get(`${aiPath(f.dcId)}/detections`).expect(200);
    expect(d.body.rulesOnly).toBe(true);
    const codes = new Set(d.body.items.map((x: { code: string }) => x.code));
    expect(codes.has('task_overdue')).toBe(true);
    expect(codes.has('owner_missing')).toBe(true);
    expect(codes.has('cp_missing_evidence')).toBe(true);
    const overdue = d.body.items.find((x: { entityId: string }) => x.entityId === f.overdueTaskId);
    expect(overdue.citations[0]).toMatchObject({ type: 'task', id: f.overdueTaskId });
    await setAi(f.dcId, {});
    await drain();
  });
});
