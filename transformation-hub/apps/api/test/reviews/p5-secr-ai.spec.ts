import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { type AiClaim } from '@hub/domain';
import { closeApp, closePools, owner, projectIdByCode, DC } from '../helpers';
import { P, doc, login, ok, plusDays, setupJvProject, syntheticUser, type DocClient, type JvProject } from '../jv/jv-kit';
import { proposalRow, serviceHandles, setAi } from '../ai/ai-fixtures';
import { runWorker } from '../gates/gate-test-kit';
import type { ModelProvider, ModelRequest, ModelToolCall } from '../../src/modules/ai/providers/model-provider';
import type { ClaimedJob } from '../../src/platform/jobs/job-queue.service';

/**
 * P5 security RE-CHECK (docs/reviews/P5-security-recheck.md) of the P5 QA fixes (QA-P5-01/-02/-03/-05/-08/-10) and of the
 * SEC-P5-01..06 fixes at the new revision. Written by the security-privacy-reviewer in a separate context; no implementation
 * file and no existing test was changed.
 *
 * `DEFECT` = `it.fails` asserting the REQUIRED behaviour (red once fixed; then rename "(fixed, regression)", plain `it`).
 * `CONTROL` = a control or precondition that holds before AND after a fix (a broken set-up never hides behind an expected
 * failure). `OBSERVED` = current behaviour recorded, not a defect. Scenarios run in `beforeAll` blocks; tests assert on what
 * was recorded.
 *
 * A SCRIPTED provider (Simulated, no network) stands in for a model that follows an instruction found in its sources; it is
 * installed through the registry's test hook (`ProviderRegistry.override`). The runtime path after the model is the production
 * path. The owner pool is used only for set-up the API does not offer (AI settings rows incl. an approved autopilot policy,
 * clearance changes of SYNTHETIC users created here, taking one execution job off the queue to run it directly) and for
 * reading rows; each use is commented. One fresh JV test project (synthetic data only); DEMO-DC only for the cross-project case.
 */
let j: JvProject;
let pid: string;
let admin: DocClient;
let tasks: string[] = [];

const policy = (maxActionsPerDay: number) => ({
  allowlist: ['create_internal_notification'],
  maxActionsPerDay,
  expiresOn: plusDays(10),
  revoked: false,
  proposedBy: null as string | null,
  approvedBy: null as string | null,
  approvedAt: new Date().toISOString(),
});

/** A Simulated provider returning scripted tool calls / claims on top of the real mock's answer. */
function scripted(real: ModelProvider, script: (req: ModelRequest) => { toolCalls?: ModelToolCall[]; claims?: AiClaim[] }): ModelProvider {
  return {
    id: 'mock',
    simulated: true,
    destination: () => null,
    status: (m) => real.status(m),
    label: () => real.label(),
    estimateCost: () => '0.0000',
    async generate(req, signal) {
      const base = await real.generate(req, signal);
      const s = script(req);
      return { ...base, toolCalls: s.toolCalls ?? base.toolCalls, claims: s.claims ?? base.claims };
    },
  };
}

async function withScript<T>(script: (req: ModelRequest) => { toolCalls?: ModelToolCall[]; claims?: AiClaim[] }, fn: () => Promise<T>): Promise<T> {
  const { registry } = await serviceHandles();
  const real = registry.get('mock');
  registry.override('mock', scripted(real, script));
  try {
    return await fn();
  } finally {
    registry.override('mock', real);
  }
}

const msg = (recipientUserId: string, title: string, body: string, target?: string): ModelToolCall => ({
  name: 'propose_internal_notification',
  args: { recipientUserId, title, body, ...(target ? { targetType: 'task', targetId: target } : {}) },
});

const ask = (c: DocClient, question: string, projectId = pid) => c.post(`${P(projectId)}/ai/ask`, { question, locale: 'en' });
const notes = async (proposalId: string) => (await owner().query<{ user_id: string; body: string }>(`select user_id, body from notification where ai_proposal_id = $1`, [proposalId])).rows;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Owner pool: clearance of a SYNTHETIC user created by this file (no API lowers a clearance in place). */
const setClearance = (userId: string, c: string) => owner().query(`update app_user set clearance = $2 where id = $1`, [userId, c]);
const stripAction = (payload: Record<string, unknown>) => {
  const { action: _a, ...rest } = payload;
  void _a;
  return rest;
};

/** A synthetic internal user, granted project roles through the portfolio API; returns the client and membership ids. */
async function member(key: string, clearance: string, roles: string[]) {
  const c = await syntheticUser(j.orgId, key, 'internal', clearance);
  await setClearance(c.userId, clearance); // idempotent fixture when the database is reused
  const ids: string[] = [];
  for (const role of roles) ids.push((await ok(await admin.post(`${P(pid)}/members`, { userId: c.userId, role, reason: 'P5 security re-check probe (synthetic)' }))).id);
  return { c, membershipIds: ids };
}

beforeAll(async () => {
  j = await setupJvProject('P5SECR-AI');
  pid = j.projectId;
  admin = await login('portfolio.admin');
  tasks = (await owner().query<{ id: string }>(`select id from task where project_id = $1 order by sort_order, id limit 8`, [pid])).rows.map((r) => r.id);
  expect(tasks.length).toBe(8);
}, 600_000);

afterAll(async () => {
  await closeApp();
  await closePools();
});

// =====================================================================================================================
describe('SEC-P5-01 re-verification at the new revision: the CONTENT rule, with a recipient cleared AT the project\'s classification (so the QA-P5-03 project gate cannot be what refuses them)', () => {
  const HERON = 'P5SECRHERON';
  let memo: string;
  let mid: DocClient;
  let projectClassification = '';
  const ctl: Record<string, unknown> = {};
  const auto: { refused: { name: string; reason: string }[]; proposals: number; deliveredToMid: number; sponsorProposal: string | null; sponsorDelivered: number } = { refused: [], proposals: 0, deliveredToMid: 0, sponsorProposal: null, sponsorDelivered: 0 };
  let reviseToMid = { status: 0, code: '' };
  let reviseControl = 0;
  let versionKept = false;

  beforeAll(async () => {
    projectClassification = (await owner().query(`select classification from project where id = $1`, [pid])).rows[0].classification;
    mid = (await member('p5secr.mid', 'confidential', ['contributor'])).c;
    // A RESTRICTED memo (uploaded by the sponsor through the documents API), read by the SECRETARY's run (cleared restricted,
    // holds notifications.message.send) and SENT to the Simulated provider (project ceiling restricted, owner pool).
    memo = (await doc(j.p.sponsor, pid, 'P5SECR restricted heron memo (synthetic)', { classification: 'restricted', kind: 'evidence', text: `Restricted memo ${HERON}: the synthetic exclusivity terms remain under negotiation.` })).id;
    await runWorker(); // documents index job
    const exfiltrate = (recipient: string, title: string) => (req: ModelRequest) => {
      const item = req.context.find((c) => c.text.includes(HERON));
      return { toolCalls: item ? [msg(recipient, title, item.text.slice(0, 300))] : [] };
    };
    // (a) Policy-limited autopilot with create_internal_notification allowlisted (owner pool: approved policy, cooldown 24 h).
    await setAi(pid, { mode: 'autopilot', max_classification_to_provider: 'restricted', action_cooldown_hours: 24, autopilot_policy: { ...policy(50), proposedBy: admin.userId, approvedBy: j.p.sponsor.userId } });
    const a = await withScript(exfiltrate(mid.userId, 'For your information'), async () => ok(await ask(j.p.secretary, `What does the ${HERON} memo say?`)));
    auto.refused = a.output.refusedToolCalls;
    auto.proposals = a.output.proposals.length;
    // CONTROL run: the same instruction addressed to the sponsor (cleared for the memo) is prepared and executed.
    const b = await withScript(exfiltrate(j.p.sponsor.userId, 'For your information (sponsor)'), async () => ok(await ask(j.p.secretary, `Summarise the ${HERON} memo`)));
    auto.sponsorProposal = b.output.proposals[0]?.id ?? null;
    await runWorker();
    auto.deliveredToMid = (await owner().query(`select count(*)::int n from notification where user_id = $1 and kind = 'ai_action' and body like $2`, [mid.userId, `%${HERON}%`])).rows[0].n;
    auto.sponsorDelivered = auto.sponsorProposal ? (await notes(auto.sponsorProposal)).filter((n) => n.body.includes(HERON)).length : 0;
    // Recipient preconditions (CONTROL): mid sees the project and may use the AI channel, but may not read the memo.
    ctl.midProject = (await mid.get(`${P(pid)}`)).status;
    ctl.midMemo = (await mid.get(`${P(pid)}/documents/${memo}`)).status;
    const own = await ask(mid, `What does the ${HERON} memo say?`);
    ctl.midAsk = own.status;
    ctl.midAskCarries = JSON.stringify(own.body).includes('exclusivity terms');
    ctl.clearances = (await owner().query(`select u.id, u.clearance from app_user u where u.id = any($1::uuid[])`, [[mid.userId, j.p.secretary.userId, j.p.sponsor.userId]])).rows;

    // (b) Assisted: the secretary's run addresses the memo text to the sponsor (allowed); the secretary then revises the
    //     recipient to mid (cleared at the project's classification, below the memo).
    await setAi(pid, { mode: 'assisted', max_classification_to_provider: 'restricted', action_cooldown_hours: 24 });
    const c = await withScript(exfiltrate(j.p.sponsor.userId, 'Memo digest (revision probe)'), async () => ok(await ask(j.p.secretary, `Explain the ${HERON} memo`)));
    const pRev = c.output.proposals[0].id as string;
    const row = await proposalRow(pRev);
    const rv = await j.p.secretary.post(`${P(pid)}/ai/proposals/${pRev}/revise`, { expectedVersion: row.version, payload: { ...stripAction(row.payload), recipientUserId: mid.userId } });
    reviseToMid = { status: rv.status, code: rv.body.code };
    versionKept = (await proposalRow(pRev)).version === row.version;
    reviseControl = (await j.p.secretary.post(`${P(pid)}/ai/proposals/${pRev}/revise`, { expectedVersion: row.version, payload: { ...stripAction(row.payload), title: 'Memo digest (revision probe, reworded)' } })).status;
    await setAi(pid, { mode: 'assisted' });
    console.log(
      `SEC-P5-01 re-check: project ${projectClassification}; mid project ${ctl.midProject}, memo ${ctl.midMemo}, own ask ${ctl.midAsk}; ` +
        `autopilot → proposals ${auto.proposals}, refused ${JSON.stringify(auto.refused)}, delivered to mid ${auto.deliveredToMid}; sponsor CONTROL delivered ${auto.sponsorDelivered}; ` +
        `revise → mid ${JSON.stringify(reviseToMid)} (version kept ${versionKept}), reworded to the sponsor ${reviseControl}`,
    );
  }, 300_000);

  it('CONTROL: the recipient is a full member cleared AT the project\'s classification — the project and the AI channel are open to them (200 / 201) — and is refused only the restricted memo (404); the same instruction to a cleared recipient is executed under autopilot', () => {
    expect(projectClassification).toBe('confidential');
    expect(ctl.midProject).toBe(200);
    expect(ctl.midAsk).toBe(201);
    expect(ctl.midAskCarries).toBe(false);
    expect(ctl.midMemo).toBe(404);
    expect(auto.sponsorProposal).toBeTruthy();
    expect(auto.sponsorDelivered).toBe(1);
  });

  it('SEC-P5-01 holds on its own (autopilot, creation): a message drafted from a record above the recipient is never prepared nor delivered — refused "recipient_not_cleared_for_content" with the project gate passed', () => {
    expect(auto.proposals).toBe(0);
    expect(auto.refused).toEqual([expect.objectContaining({ name: 'propose_internal_notification', reason: expect.stringContaining('recipient_not_cleared_for_content') })]);
    expect(auto.deliveredToMid).toBe(0);
  });

  it('SEC-P5-01 holds on its own (revision): re-addressing the message to that recipient → 422 ai.recipient_not_cleared, nothing changed; a revision that keeps a cleared recipient is accepted (CONTROL)', () => {
    expect(reviseToMid).toEqual({ status: 422, code: 'ai.recipient_not_cleared' });
    expect(versionKept).toBe(true);
    expect(reviseControl).toBe(201);
  });
});

// =====================================================================================================================
describe('QA-P5-03 — every AI route answers 404 to a member who holds the AI permissions but is cleared below the project\'s classification; worker execution re-checks the APPROVER', () => {
  const statuses: Record<string, number> = {};
  const after: Record<string, number> = {};
  let appr: { status: string; reason: string | null; notes: number; approve: number } = { status: '', reason: null, notes: 0, approve: 0 };

  beforeAll(async () => {
    await setAi(pid, { mode: 'assisted' });
    // Any proposal and run of the project, to address the id routes.
    const r = await withScript(() => ({ toolCalls: [msg(j.p.contributor.userId, 'P5SECR gate probe', 'Synthetic probe.', tasks[1])] }), async () => ok(await ask(j.p.pm, 'P5SECRGATE overdue')));
    const proposalId = r.output.proposals[0].id as string;
    const runId = r.id as string;
    const pv = (await proposalRow(proposalId)).version;
    const low = await member('p5secr.lowall', 'internal', ['sponsor', 'project_manager', 'secretary_cpmo', 'auditor']);
    await setClearance(low.c.userId, 'internal');
    const c = low.c;
    const A = `${P(pid)}/ai`;
    const calls: [string, () => Promise<{ status: number }>][] = [
      ['GET settings', () => c.get(`${A}/settings`)],
      ['PUT settings', () => c.agent.put(`${A}/settings`).set('x-csrf-token', c.csrf).send({ expectedVersion: 1, actionCooldownHours: 0, reason: 'probe' })],
      ['POST autopilot-policy/approve', () => c.post(`${A}/autopilot-policy/approve`, { expectedVersion: 1 })],
      ['POST autopilot-policy/revoke', () => c.post(`${A}/autopilot-policy/revoke`, { expectedVersion: 1, reason: 'probe' })],
      ['POST killswitch/activate', () => c.post(`${A}/killswitch/activate`, { reason: 'probe' })],
      ['POST killswitch/release', () => c.post(`${A}/killswitch/release`, { reason: 'probe' })],
      ['POST ask', () => c.post(`${A}/ask`, { question: 'What is overdue?' })],
      ['GET runs', () => c.get(`${A}/runs`)],
      ['GET runs/:id', () => c.get(`${A}/runs/${runId}`)],
      ['GET status', () => c.get(`${A}/status`)],
      ['GET costs', () => c.get(`${A}/costs`)],
      ['GET detections', () => c.get(`${A}/detections`)],
      ['GET tools', () => c.get(`${A}/tools`)],
      ['GET proposals', () => c.get(`${A}/proposals`)],
      ['GET proposals/:id', () => c.get(`${A}/proposals/${proposalId}`)],
      ['POST proposals/:id/approve', () => c.post(`${A}/proposals/${proposalId}/approve`, { expectedVersion: pv })],
      ['POST proposals/:id/reject', () => c.post(`${A}/proposals/${proposalId}/reject`, { expectedVersion: pv, note: 'probe' })],
      ['POST proposals/:id/revise', () => c.post(`${A}/proposals/${proposalId}/revise`, { expectedVersion: pv, payload: { recipientUserId: j.p.contributor.userId, title: 'x', body: 'y' } })],
      ['GET briefings', () => c.get(`${A}/briefings`)],
      ['POST briefings', () => c.post(`${A}/briefings`, { kind: 'daily' })],
      ['GET artifacts', () => c.get(`${A}/artifacts`)],
    ];
    for (const [name, call] of calls) statuses[name] = (await call()).status;
    // CONTROL: the same user cleared at the project's classification passes the gate on the read routes.
    await setClearance(c.userId, 'confidential');
    for (const name of ['GET status', 'GET tools', 'GET proposals', 'GET runs', 'GET detections']) after[name] = (await calls.find((x) => x[0] === name)![1]()).status;
    await setClearance(c.userId, 'internal');
    expect((await proposalRow(proposalId)).status).toBe('proposed');
    expect((await owner().query(`select kill_switch from ai_project_settings where project_id = $1`, [pid])).rows[0].kill_switch).toBe(false);

    // Worker path: the APPROVER's clearance falls below the project's classification between approval and execution.
    const ap = await member('p5secr.approver', 'confidential', ['secretary_cpmo']);
    const r2 = await withScript(() => ({ toolCalls: [msg(j.p.chair.userId, 'P5SECR approver probe', 'Synthetic probe.', tasks[2])] }), async () => ok(await ask(j.p.pm, 'P5SECRAPPR overdue')));
    const p2 = r2.output.proposals[0].id as string;
    appr.approve = (await ap.c.post(`${A}/proposals/${p2}/approve`, { expectedVersion: (await proposalRow(p2)).version })).status;
    await setClearance(ap.c.userId, 'internal');
    await runWorker();
    const row2 = await proposalRow(p2);
    appr = { ...appr, status: row2.status, reason: row2.invalidated_reason, notes: (await notes(p2)).length };
    await setClearance(ap.c.userId, 'confidential');
    console.log(`QA-P5-03 re-check: below the project's classification ${JSON.stringify(statuses)}; cleared at it ${JSON.stringify(after)}; approver lowered after approval ${JSON.stringify(appr)}`);
  }, 300_000);

  it('CONTROL + rule: all 21 AI routes → 404 for a member holding sponsor / PM / secretary / auditor roles but cleared below the project (nothing changed); the same member cleared at the project\'s classification gets 200 on the read routes', () => {
    expect(Object.keys(statuses)).toHaveLength(21);
    for (const [name, s] of Object.entries(statuses)) expect(s, name).toBe(404);
    for (const [name, s] of Object.entries(after)) expect(s, name).toBe(200);
  });

  it('worker: an approved message whose APPROVER is no longer cleared for the project is invalidated at execution and never sent (CONTROL: the approval itself was accepted)', () => {
    expect(appr.approve).toBe(201);
    expect(appr.status).toBe('invalidated');
    expect(appr.notes).toBe(0);
  });
});

// =====================================================================================================================
describe('QA-P5-02 — own-run reads with ai.assistant.use / ai.briefing.subscribe widen nothing: other users, other projects, sources reclassified, clearance drop, role revocation, list totals', () => {
  const OSPREY = 'P5SECROSPREYTEXT';
  const TITLE = 'P5SECR osprey memo (synthetic)';
  let runner: DocClient;
  let membership: string;
  const r: Record<string, unknown> = {};

  beforeAll(async () => {
    await setAi(pid, { mode: 'advisory' });
    const m = await member('p5secr.runner', 'confidential', ['contributor']);
    runner = m.c;
    membership = m.membershipIds[0]!;
    const memo = (await doc(j.p.pm, pid, TITLE, { classification: 'confidential', kind: 'evidence', text: `Confidential memo ${OSPREY}: the synthetic cooling contract renewal is pending.` })).id;
    await runWorker(); // documents index job
    const mine = await ok(await ask(runner, 'What does the osprey memo say?'));
    const theirs = await ok(await ask(j.p.contributor, 'What does the osprey memo say?'));
    r.mineCarries = JSON.stringify(mine).includes(OSPREY);
    const list = await runner.get(`${P(pid)}/ai/runs?pageSize=100`);
    r.list = { status: list.status, total: list.body.total, ids: (list.body.items as { id: string }[]).map((x) => x.id) };
    r.ownCount = (await owner().query(`select count(*)::int n from ai_run where project_id = $1 and requested_by = $2`, [pid, runner.userId])).rows[0].n;
    r.getMine = (await runner.get(`${P(pid)}/ai/runs/${mine.id}`)).status;
    r.getTheirs = (await runner.get(`${P(pid)}/ai/runs/${theirs.id}`)).status;
    r.mineId = mine.id;
    r.theirsId = theirs.id;
    // Another project: DEMO-DC (the runner is not a member) and the own run addressed through it.
    const dc = await projectIdByCode(DC);
    r.otherProject = (await runner.get(`${P(dc)}/ai/runs/${mine.id}`)).status;
    r.otherProjectList = (await runner.get(`${P(dc)}/ai/runs`)).status;
    // A source of the run is reclassified above the runner (documents API, by the secretary): the stored run stays readable
    // but carries nothing of it.
    const cur = (await j.p.secretary.get(`${P(pid)}/documents/${memo}`).expect(200)).body;
    await ok(await j.p.secretary.post(`${P(pid)}/documents/${memo}/classify`, { expectedVersion: cur.version, classification: 'restricted', reason: 'P5 re-check: reclassified above the reader (synthetic)' }));
    const re = await runner.get(`${P(pid)}/ai/runs/${mine.id}`);
    r.afterReclass = { status: re.status, carriesText: JSON.stringify(re.body).includes(OSPREY), carriesTitle: JSON.stringify(re.body).includes(TITLE) };
    // Clearance drop below the project's classification.
    await setClearance(runner.userId, 'internal');
    r.afterDrop = { get: (await runner.get(`${P(pid)}/ai/runs/${mine.id}`)).status, list: (await runner.get(`${P(pid)}/ai/runs`)).status };
    await setClearance(runner.userId, 'confidential');
    r.restored = (await runner.get(`${P(pid)}/ai/runs/${mine.id}`)).status;
    // Role revocation (portfolio API).
    await ok(await admin.post(`${P(pid)}/members/${membership}/revoke`, { reason: 'P5 re-check: role revoked (synthetic)' }));
    r.afterRevoke = { get: (await runner.get(`${P(pid)}/ai/runs/${mine.id}`)).status, list: (await runner.get(`${P(pid)}/ai/runs`)).status };
    console.log(`QA-P5-02 re-check: ${JSON.stringify(r)}`);
  }, 300_000);

  it('CONTROL: the runner (contributor: ai.assistant.use, no ai.run.read) reads their own run, which carried the memo at run time', () => {
    expect(r.mineCarries).toBe(true);
    expect(r.getMine).toBe(200);
  });

  it('another user\'s run → 404; the list holds only own runs and its total equals the own-run count; another project → 404', () => {
    expect(r.getTheirs).toBe(404);
    const l = r.list as { status: number; total: number; ids: string[] };
    expect(l.status).toBe(200);
    expect(l.ids).toContain(r.mineId);
    expect(l.ids).not.toContain(r.theirsId);
    expect(l.total).toBe(r.ownCount);
    expect(r.otherProject).toBe(404);
    expect(r.otherProjectList).toBe(404);
  });

  it('a source reclassified above the reader leaves no trace in the stored run (text and title); a clearance below the project → 404 (restored → 200); a revoked role → 404', () => {
    expect(r.afterReclass).toEqual({ status: 200, carriesText: false, carriesTitle: false });
    expect(r.afterDrop).toEqual({ get: 404, list: 404 });
    expect(r.restored).toBe(200);
    expect(r.afterRevoke).toEqual({ get: 404, list: 404 });
  });
});

// =====================================================================================================================
describe('QA-P5-01 — who sets the cooldown; cooldown 0 vs the autopilot limit; dedupe scoped to the project', () => {
  const s: Record<string, unknown> = {};

  beforeAll(async () => {
    await setAi(pid, { mode: 'advisory', action_cooldown_hours: 24 });
    const A = `${P(pid)}/ai`;
    const put = (c: DocClient, body: Record<string, unknown>) => c.agent.put(`${A}/settings`).set('x-csrf-token', c.csrf).send(body);
    const version = async () => (await owner().query(`select version from ai_project_settings where project_id = $1`, [pid])).rows[0].version as number;
    const v0 = await version();
    s.byRole = {
      pm: (await put(j.p.pm, { expectedVersion: v0, actionCooldownHours: 0, reason: 'probe' })).status,
      secretary: (await put(j.p.secretary, { expectedVersion: v0, actionCooldownHours: 0, reason: 'probe' })).status,
      contributor: (await put(j.p.contributor, { expectedVersion: v0, actionCooldownHours: 0, reason: 'probe' })).status,
      chair: (await put(j.p.chair, { expectedVersion: v0, actionCooldownHours: 0, reason: 'probe' })).status,
    };
    s.unchanged = (await version()) === v0;
    s.invalid = {
      negative: (await put(j.p.sponsor, { expectedVersion: v0, actionCooldownHours: -1 })).status,
      fraction: (await put(j.p.sponsor, { expectedVersion: v0, actionCooldownHours: 1.5 })).status,
      over: (await put(j.p.sponsor, { expectedVersion: v0, actionCooldownHours: 169 })).status,
      string: (await put(j.p.sponsor, { expectedVersion: v0, actionCooldownHours: '0' })).status,
    };
    const since = new Date(Date.now() - 2000).toISOString();
    const okPut = await put(j.p.sponsor, { expectedVersion: v0, actionCooldownHours: 0, reason: 'P5 re-check: cooldown off (synthetic)' });
    s.sponsor = okPut.status;
    const audit = (await owner().query(`select actor_user_id, before, after, reason from audit_event where project_id = $1 and action = 'ai.settings.manage' and created_at >= $2 order by chain_pos desc limit 1`, [pid, since])).rows[0];
    s.audit = { actor: audit?.actor_user_id === j.p.sponsor.userId, before: audit?.before?.actionCooldownHours, after: audit?.after?.actionCooldownHours, reason: audit?.reason };

    // Cooldown 0 + autopilot limit: two identical reminders from two runs; the approved daily limit admits one more.
    const today = async () =>
      (await owner().query<{ n: number }>(`select count(*)::int n from ai_proposal where project_id = $1 and status = 'executed' and execution_result->>'mode' = 'autopilot' and (executed_at at time zone 'Asia/Riyadh')::date = (now() at time zone 'Asia/Riyadh')::date`, [pid])).rows[0]!.n;
    const n0 = await today();
    await setAi(pid, { mode: 'autopilot', action_cooldown_hours: 0, autopilot_policy: { ...policy(n0 + 1), proposedBy: admin.userId, approvedBy: j.p.sponsor.userId } });
    const twin = () => ({ toolCalls: [msg(j.p.approver.userId, 'P5SECR rate twin', 'Synthetic probe.')] });
    const a = await withScript(twin, async () => ok(await ask(j.p.pm, 'P5SECRRATEA overdue')));
    const b = await withScript(twin, async () => ok(await ask(j.p.pm, 'P5SECRRATEB overdue')));
    const ids = [a.output.proposals[0]?.id, b.output.proposals[0]?.id].filter(Boolean) as string[];
    await runWorker();
    const rows = await Promise.all(ids.map((id) => proposalRow(id)));
    s.rate = { n0, n1: await today(), created: ids.length, statuses: rows.map((x) => `${x.status}:${x.invalidated_reason ?? ''}`), delivered: (await Promise.all(ids.map(notes))).flat().length };
    await setAi(pid, { mode: 'assisted' });

    // Cross-project: the identical targetless message to the same recipient (a member of both projects) in two projects.
    const dc = await projectIdByCode(DC);
    await setAi(pid, { mode: 'assisted', action_cooldown_hours: 24 });
    await setAi(dc, { mode: 'assisted', action_cooldown_hours: 24 });
    const same = () => ({ toolCalls: [msg(j.p.contributor.userId, 'P5SECR cross-project twin (synthetic)', 'Identical synthetic body.')] });
    const inA = await withScript(same, async () => ok(await ask(j.p.pm, 'P5SECRXPA overdue')));
    const inB = await withScript(same, async () => ok(await ask(j.p.pm, 'P5SECRXPB overdue', dc)));
    const pa = inA.output.proposals[0]?.id as string | undefined;
    const pb = inB.output.proposals[0]?.id as string | undefined;
    s.cross = {
      a: pa ? 'created' : JSON.stringify(inA.output.refusedToolCalls),
      b: pb ? 'created' : JSON.stringify(inB.output.refusedToolCalls),
      sameKey: pa && pb ? (await proposalRow(pa)).dedupe_key === (await proposalRow(pb)).dedupe_key : null,
    };
    // Clean-up of the shared demo project: the probe's DEMO-DC proposal is rejected (no pending twin left), settings reset.
    if (pb) await ok(await j.p.secretary.post(`${P(dc)}/ai/proposals/${pb}/reject`, { expectedVersion: (await proposalRow(pb)).version, note: 'P5 re-check probe clean-up (synthetic)' }));
    await setAi(dc, {});
    await setAi(pid, { mode: 'assisted' });
    console.log(`QA-P5-01 re-check: ${JSON.stringify(s)}`);
  }, 300_000);

  it('CONTROL: only ai.settings.manage changes the cooldown (PM / secretary / contributor / chair → 403, nothing saved); out-of-range or non-integer values → 400; the sponsor\'s change is audited with before/after and the actor', () => {
    expect(s.byRole).toEqual({ pm: 403, secretary: 403, contributor: 403, chair: 403 });
    expect(s.unchanged).toBe(true);
    expect(s.invalid).toEqual({ negative: 400, fraction: 400, over: 400, string: 400 });
    expect(s.sponsor).toBe(200);
    expect(s.audit).toMatchObject({ actor: true, before: 24, after: 0 });
  });

  it('CONTROL: cooldown 0 does not lift the autopilot daily limit — of two identical reminders only one is delivered, the other is refused by the rate limit', () => {
    const rate = s.rate as { n0: number; n1: number; created: number; statuses: string[]; delivered: number };
    expect(rate.created).toBe(2);
    expect(rate.n1).toBeLessThanOrEqual(rate.n0 + 1);
    expect(rate.delivered).toBe(1);
    expect(rate.statuses.sort()).toEqual(['executed:', 'invalidated:ai.rate_limited']);
  });

  it('CONTROL: the deduplication is scoped to the project — the same key in another project does not suppress the proposal', () => {
    expect(s.cross).toEqual({ a: 'created', b: 'created', sameKey: true });
  });
});

// =====================================================================================================================
describe('QA-P5-01 — a proposal the delegating user may NOT see suppresses their action and is named (by id) in the refusal', () => {
  const FALCON = 'P5SECRFALCON';
  let hidden = '';
  let pmGet = 0;
  let sponsorGet = 0;
  let refused: { name: string; reason: string }[] = [];
  let proposals = 0;
  let revise: { status: number; code: string; body: string } = { status: 0, code: '', body: '' };

  beforeAll(async () => {
    const memo = (await doc(j.p.sponsor, pid, 'P5SECR restricted falcon memo (synthetic)', { classification: 'restricted', kind: 'evidence', text: `Restricted memo ${FALCON}: synthetic negotiation notes for the cooling contract.` })).id;
    void memo;
    await runWorker(); // documents index job
    await setAi(pid, { mode: 'assisted', max_classification_to_provider: 'restricted', action_cooldown_hours: 24 });
    // The secretary's run (restricted memo sent to the model) prepares a message to the sponsor about task T.
    const s = await withScript(
      (req) => {
        const item = req.context.find((c) => c.text.includes(FALCON));
        return { toolCalls: item ? [msg(j.p.sponsor.userId, 'Falcon follow-up', item.text.slice(0, 200), tasks[3])] : [] };
      },
      async () => ok(await ask(j.p.secretary, `What does the ${FALCON} memo say?`)),
    );
    hidden = s.output.proposals[0].id;
    pmGet = (await j.p.pm.get(`${P(pid)}/ai/proposals/${hidden}`)).status;
    sponsorGet = (await j.p.sponsor.get(`${P(pid)}/ai/proposals/${hidden}`)).status;
    // The PM's own run (no restricted input) prepares a reminder to the sponsor about the same task.
    const p = await withScript(() => ({ toolCalls: [msg(j.p.sponsor.userId, 'Please update the task', 'Synthetic reminder from the PM.', tasks[3])] }), async () => ok(await ask(j.p.pm, 'P5SECRTWIN overdue')));
    refused = p.output.refusedToolCalls;
    proposals = p.output.proposals.length;
    // Revision variant: the PM's own pending reminder about another task is re-targeted to the same task.
    const own = await withScript(() => ({ toolCalls: [msg(j.p.sponsor.userId, 'Please update the other task', 'Synthetic reminder from the PM.', tasks[4])] }), async () => ok(await ask(j.p.pm, 'P5SECRTWINB overdue')));
    const ownId = own.output.proposals[0].id as string;
    const row = await proposalRow(ownId);
    const rv = await j.p.pm.post(`${P(pid)}/ai/proposals/${ownId}/revise`, { expectedVersion: row.version, payload: { ...stripAction(row.payload), targetId: tasks[3] } });
    revise = { status: rv.status, code: rv.body.code, body: JSON.stringify(rv.body) };
    await setAi(pid, { mode: 'assisted' });
    console.log(`QA-P5-01 hidden twin: PM GET hidden ${pmGet}, sponsor GET ${sponsorGet}; PM run proposals ${proposals}, refused ${JSON.stringify(refused)}; revise ${revise.status} ${revise.body.slice(0, 300)}`);
  }, 300_000);

  it('CONTROL: the secretary\'s proposal exists and is hidden from the PM (GET by id 404) but shown to the sponsor; the PM\'s reminder about the same task to the same recipient is refused as a twin', () => {
    expect(hidden).toBeTruthy();
    expect(pmGet).toBe(404);
    expect(sponsorGet).toBe(200);
    expect(proposals).toBe(0);
    expect(refused).toEqual([expect.objectContaining({ name: 'propose_internal_notification', reason: expect.stringContaining('duplicate_within_cooldown') })]);
    expect(revise.status).toBe(422);
    expect(revise.code).toBe('ai.duplicate_within_cooldown');
  });

  it('DEFECT SEC-P5R-02 (run output): the refusal does not name a proposal the delegating user may not see (fixed, regression)', () => {
    expect(refused.map((x) => x.reason).join(' ')).not.toContain(hidden);
  });

  it('DEFECT SEC-P5R-02 (revision, 422 details): the refusal does not name a proposal the requester may not see (fixed, regression)', () => {
    expect(revise.body).not.toContain(hidden);
  });
});

// =====================================================================================================================
describe('QA-P5-01 lock order — the dedupe-key lock and the audit-chain lock are taken in opposite orders by a run and by an execution', () => {
  let interleaving = { executionHeldKey: false, runWaitedOnAdvisory: false };
  let askOut: { status: number; code?: string; proposals?: number; refused?: string[] } = { status: 0 };
  let exec: { result: unknown; error: string | null; status: string; notes: number } = { result: null, error: null, status: '', notes: 0 };

  beforeAll(async () => {
    await setAi(pid, { mode: 'assisted', action_cooldown_hours: 24 });
    // P: an approved reminder to the contributor about task 5, waiting for its execution.
    const r0 = await withScript(() => ({ toolCalls: [msg(j.p.contributor.userId, 'P5SECR lock-order reminder', 'Synthetic reminder.', tasks[5])] }), async () => ok(await ask(j.p.pm, 'P5SECRLOCKA overdue')));
    const pId = r0.output.proposals[0].id as string;
    const row = await proposalRow(pId);
    const key = row.dedupe_key as string;
    await ok(await j.p.secretary.post(`${P(pid)}/ai/proposals/${pId}/approve`, { expectedVersion: row.version }));
    // Owner pool: the queued execution is taken off the queue and run directly through the job handler (as a worker would).
    const job = (await owner().query(`select * from job where project_id = $1 and kind = 'ai.execute_proposal' and status = 'queued' and payload->>'proposalId' = $2`, [pid, pId])).rows[0] as ClaimedJob;
    expect(job).toBeTruthy();
    await owner().query(`update job set status = 'cancelled', last_error = 'p5secr probe: executed directly' where id = $1`, [job.id]);

    const { proposals } = await serviceHandles();
    const svc = proposals as unknown as { lockDedupe: (k: string) => Promise<void> };
    const orig = svc.lockDedupe.bind(proposals);
    let held!: () => void;
    const executionHolds = new Promise<void>((res) => (held = res));
    let release!: () => void;
    const gate = new Promise<void>((res) => (release = res));
    let armed = true;
    // The second run is created HERE, outside the job's AsyncLocalStorage transaction context: a separate request of the PM.
    // Its model prepares (1) a reminder to the legal member about task 6 (a new key: proposal + audit row), then (2) the same
    // reminder as P (P's key).
    const second = (async () => {
      await executionHolds;
      return ask(j.p.pm, 'P5SECRLOCKB overdue');
    })();
    const watcher = (async () => {
      await executionHolds;
      for (let i = 0; i < 300; i++) {
        const n = (
          await owner().query<{ n: number }>(
            `select count(*)::int n from pg_locks l where l.locktype = 'advisory' and not l.granted and l.database = (select oid from pg_database where datname = current_database())`,
          )
        ).rows[0]!.n;
        if (n > 0) {
          interleaving.runWaitedOnAdvisory = true;
          break;
        }
        await sleep(50);
      }
      release();
    })();
    const spy = vi.spyOn(svc, 'lockDedupe').mockImplementation(async (k: string) => {
      await orig(k);
      // The execution's phase 2 has just taken P's key (before the proposal row, as documented) — it waits here, holding it.
      if (armed && k === key) {
        armed = false;
        interleaving.executionHeldKey = true;
        held();
        await gate;
      }
    });
    try {
      await withScript(
        () => ({ toolCalls: [msg(j.p.legal.userId, 'P5SECR lock-order other reminder', 'Synthetic reminder.', tasks[6]), msg(j.p.contributor.userId, 'P5SECR lock-order reminder', 'Synthetic reminder.', tasks[5])] }),
        async () => {
          exec.result = await proposals.executeJob(job).catch((e: Error) => {
            exec.error = e.message;
            return null;
          });
          const res = await second;
          askOut = { status: res.status, code: res.body?.code, proposals: res.body?.output?.proposals?.length, refused: (res.body?.output?.refusedToolCalls ?? []).map((x: { reason: string }) => x.reason.slice(0, 60)) };
          await watcher;
        },
      );
    } finally {
      spy.mockRestore();
    }
    const after = await proposalRow(pId);
    exec = { ...exec, status: after.status, notes: (await notes(pId)).length };
    await setAi(pid, { mode: 'assisted' });
    console.log(`QA-P5-01 lock order: interleaving ${JSON.stringify(interleaving)}; execution ${JSON.stringify(exec)}; second run ${JSON.stringify(askOut)}`);
  }, 300_000);

  it('CONTROL: the interleaving was reached (the execution held the key while the run prepared the twin) and the approved reminder was executed exactly once', () => {
    // Before the SEC-P5R-01 fix this control also asserted `runWaitedOnAdvisory: true` (the run blocked on the key while holding
    // the audit-chain lock — the deadlock). The fix makes the run TRY the key instead of waiting for it, so it no longer waits;
    // the interleaving is still reached because the execution held the key when the run asked for it.
    expect(interleaving.executionHeldKey).toBe(true);
    expect(exec.status).toBe('executed');
    expect(exec.notes).toBe(1);
  });

  it('DEFECT SEC-P5R-01: a run that prepares the twin of an action being executed waits for it and completes (its twin refused) — no deadlock aborts the run or the execution (fixed, regression)', () => {
    expect(exec.error).toBeNull();
    expect(askOut.status).toBe(201);
    // The fix: the twin is refused at once as a duplicate in progress (the other, new reminder is prepared).
    expect(askOut.proposals).toBe(1);
    expect(askOut.refused).toEqual([expect.stringContaining('duplicate_within_cooldown')]);
  });
});

// =====================================================================================================================
describe('QA-P5-05 / QA-P5-08 — people in the DTO and GET by id: free-draft clearance rule, workstream-only reader, no extra personal field', () => {
  const o: Record<string, unknown> = {};

  beforeAll(async () => {
    await setAi(pid, { mode: 'assisted', action_cooldown_hours: 24 });
    // A targetless draft of the SECRETARY (cleared restricted) — the free-draft rule: only readers cleared at least as high.
    const d = await withScript(() => ({ toolCalls: [{ name: 'propose_minutes_draft', args: { title: 'P5SECR minutes draft (synthetic)', content: 'Synthetic minutes draft for the probe.' } }] }), async () => ok(await ask(j.p.secretary, 'P5SECRDRAFT overdue')));
    o.draftRefused = d.output.refusedToolCalls;
    const draft = d.output.proposals[0]?.id as string | undefined;
    o.draft = draft ?? null;
    if (draft) {
      o.pm = (await j.p.pm.get(`${P(pid)}/ai/proposals/${draft}`)).status;
      const sp = await j.p.sponsor.get(`${P(pid)}/ai/proposals/${draft}`);
      o.sponsor = sp.status;
      o.people = sp.body.people;
      o.pmListHas = ((await j.p.pm.get(`${P(pid)}/ai/proposals?pageSize=100`)).body.items as { id: string }[]).some((x) => x.id === draft);
      o.techLead = (await (j.gp.techLead as unknown as DocClient).get(`${P(pid)}/ai/proposals/${draft}`)).status;
    }
    // A message proposal of the PM, approved by the secretary: people = requester, recipient, approver; nothing else.
    const m = await withScript(() => ({ toolCalls: [msg(j.p.contributor.userId, 'P5SECR people probe', 'Synthetic.', tasks[7])] }), async () => ok(await ask(j.p.pm, 'P5SECRPEOPLE overdue')));
    const mid = m.output.proposals[0].id as string;
    await ok(await j.p.secretary.post(`${P(pid)}/ai/proposals/${mid}/approve`, { expectedVersion: (await proposalRow(mid)).version }));
    const got = await j.p.sponsor.get(`${P(pid)}/ai/proposals/${mid}`);
    o.msgPeople = (got.body.people as { userId: string }[]).map((p) => p.userId).sort();
    o.msgPeopleKeys = [...new Set((got.body.people as Record<string, unknown>[]).flatMap((p) => Object.keys(p)))].sort();
    o.expectedPeople = [j.p.pm.userId, j.p.contributor.userId, j.p.secretary.userId].sort();
    o.emails = JSON.stringify(got.body).includes('@demo.invalid');
    o.unknownTech = (await (j.gp.techLead as unknown as DocClient).get(`${P(pid)}/ai/proposals/00000000-0000-7000-8000-000000000000`)).status;
    o.knownTech = (await (j.gp.techLead as unknown as DocClient).get(`${P(pid)}/ai/proposals/${mid}`)).status;
    await runWorker();
    await setAi(pid, { mode: 'assisted' });
    console.log(`QA-P5-05/08 re-check: ${JSON.stringify(o)}`);
  }, 300_000);

  it('free-draft rule on GET by id: the secretary\'s targetless draft → 404 for the PM (cleared below the delegate) and absent from the PM\'s list; 200 for the sponsor, naming only the delegating user', () => {
    expect(o.draft, JSON.stringify(o.draftRefused)).toBeTruthy();
    expect(o.pm).toBe(404);
    expect(o.pmListHas).toBe(false);
    expect(o.sponsor).toBe(200);
    expect(o.people).toEqual([{ userId: j.p.secretary.userId, displayName: expect.any(String) }]);
  });

  it('people of a message proposal = requester, recipient and approver only, with { userId, displayName } and no e-mail or other personal field', () => {
    expect(o.msgPeople).toEqual(o.expectedPeople);
    expect(o.msgPeopleKeys).toEqual(['displayName', 'userId']);
    expect(o.emails).toBe(false);
  });

  it('a workstream-only reader gets the same 403 for a known and an unknown proposal id (no existence oracle); for a proposal of their reach too', () => {
    expect(o.techLead).toBe(403);
    expect(o.unknownTech).toBe(403);
    expect(o.knownTech).toBe(403);
  });
});
