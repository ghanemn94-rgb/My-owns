import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApp, closePools, owner } from '../helpers';
import { aiPath, briefingProposal, demoUserId, drain, ensureFixtures, evalBody, fixtureUser, login, loginUserId, proposalRow, serviceHandles, setAi, type Fixtures } from './ai-fixtures';

/**
 * Fixes of the independent P5 QA review (docs/reviews/P5-qa-review.md, "Fix status"):
 *  QA-P5-01 deduplication / cooldown of AI actions across runs (spec §12.4, AIT-27): creation, revision and execution;
 *  QA-P5-02 a subscriber reads the briefing runs delivered to them (self-scoped; never anyone else's run);
 *  QA-P5-04 Arabic AI output uses the Arabic template titles and translated statuses; detections carry codes + parameters;
 *  QA-P5-05 the approver sees the recipient's and requester's names through the proposal DTO;
 *  QA-P5-06 the Committee Hub escalation register carries the codes of the system-written TSA escalation texts;
 *  QA-P5-08 GET one proposal by id (same visibility as the list);
 *  QA-P5-10 an AI run without a policy version is rejected by the schema (REQ-AI-029).
 * The QA review's own probes (test/reviews/p5-qa-ai.spec.ts) are kept as regressions; these add the edges.
 */

let f: Fixtures;
let pmId: string;
const FILE = __filename;

beforeAll(async () => {
  f = await ensureFixtures();
  pmId = await demoUserId('pm');
}, 300_000);

afterAll(async () => {
  await setAi(f.dcId, {});
  await closeApp();
  await closePools();
});

/** Proposals other specs left in this shared test database are not twins of this file's actions. */
const forgetEarlierProposals = () => owner().query(`update ai_proposal set dedupe_key = null where project_id = $1`, [f.dcId]);

/** A briefing run of the PM as the worker would run it; returns the proposals it created and its refused tool calls. */
async function pmBriefing() {
  const { contexts, db, runtime } = await serviceHandles();
  const ctx = (await contexts.forUser(pmId, f.dcId))!;
  const run = await db.run(ctx, () => runtime.runBriefingNow(ctx, f.dcId));
  expect(run.status).toBe('succeeded');
  return { runId: run.id, proposals: run.output!.proposals.map((p) => p.id), refused: run.output!.refusedToolCalls };
}

const approve = async (id: string) => {
  const sec = await login('secretary');
  const p = await proposalRow(id);
  const r = await sec.post(`${aiPath(f.dcId)}/proposals/${id}/approve`, { expectedVersion: p.version });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
};
const notes = async (proposalId: string) => (await owner().query(`select id from notification where ai_proposal_id = $1`, [proposalId])).rowCount ?? 0;

describe('QA-P5-01 — deduplication and cooldown of AI actions across runs (spec §12.4, AIT-27) [REQ-AI-028, REQ-AI-022]', () => {
  it('creation: the same reminder (action, target, recipient) is not prepared again while one awaits review, nor within the cooldown after its execution; it is refused and audited, and allowed again once the window has passed', evalBody(FILE, { id: 'DUP-07', category: 'duplicates', lang: 'n/a', provider: 'mock-benign', ait: ['AIT-27'] }, async () => {
    await forgetEarlierProposals();
    await setAi(f.dcId, { mode: 'assisted', action_cooldown_hours: 24 });
    const since = new Date(Date.now() - 1000).toISOString();
    const a = await briefingProposal(pmId, f.dcId);
    const pa = await proposalRow(a.proposalId);
    expect(pa.dedupe_key).toMatch(/^[0-9a-f]{64}$/);
    // Pending twin → refused (the run still succeeds; the refusal is on record and audited).
    const b = await pmBriefing();
    expect(b.proposals).toEqual([]);
    expect(b.refused).toEqual([expect.objectContaining({ name: 'propose_internal_notification', reason: expect.stringContaining('duplicate_within_cooldown') })]);
    expect(b.refused[0]!.reason).toContain('awaiting review');
    const audited = await owner().query(`select reason from audit_event where project_id = $1 and action = 'AI_ACTION_DEDUPLICATED' and entity_id = $2 and created_at >= $3`, [f.dcId, b.runId, since]);
    expect(audited.rowCount).toBe(1);
    expect(audited.rows[0].reason).toContain(a.proposalId);
    // Executed within the window → still refused.
    await approve(a.proposalId);
    await drain();
    expect((await proposalRow(a.proposalId)).status).toBe('executed');
    expect(await notes(a.proposalId)).toBe(1);
    const c = await pmBriefing();
    expect(c.proposals).toEqual([]);
    expect(c.refused[0]!.reason).toContain('already executed within the 24-hour cooldown');
    // The window has passed (execution 25 h ago) → prepared again.
    await owner().query(`update ai_proposal set executed_at = now() - interval '25 hours' where id = $1`, [a.proposalId]);
    const d = await pmBriefing();
    expect(d.proposals).toHaveLength(1);
    const pd = await proposalRow(d.proposals[0]!);
    expect(pd).toMatchObject({ status: 'proposed', target_id: pa.target_id, dedupe_key: pa.dedupe_key });
    // A rejected proposal is not a twin: after the rejection the same reminder may be prepared again.
    const sec = await login('secretary');
    await sec.post(`${aiPath(f.dcId)}/proposals/${pd.id}/reject`, { expectedVersion: pd.version, note: 'QA-P5-01 fixture (synthetic)' }).expect(201);
    const e = await pmBriefing();
    expect(e.proposals).toHaveLength(1);
  }));

  it('cooldown 0 turns deduplication off (the project setting): two runs prepare two identical proposals', async () => {
    await forgetEarlierProposals();
    await setAi(f.dcId, { mode: 'assisted', action_cooldown_hours: 0 });
    const a = await briefingProposal(pmId, f.dcId);
    const b = await briefingProposal(pmId, f.dcId);
    expect(a.proposalId).not.toBe(b.proposalId);
    const [pa, pb] = [await proposalRow(a.proposalId), await proposalRow(b.proposalId)];
    expect(pa.status).toBe('proposed');
    expect(pb.status).toBe('proposed');
    expect(pa.dedupe_key).toBe(pb.dedupe_key);
  });

  it('execution: of two identical proposals (prepared while deduplication was off) only the first is executed — the second, approved later by a human, is invalidated "duplicate_within_cooldown" and sends nothing', async () => {
    await forgetEarlierProposals();
    await setAi(f.dcId, { mode: 'assisted', action_cooldown_hours: 0 });
    const a = await briefingProposal(pmId, f.dcId);
    const b = await briefingProposal(pmId, f.dcId);
    await setAi(f.dcId, { mode: 'assisted', action_cooldown_hours: 24 });
    await approve(a.proposalId);
    await drain();
    expect((await proposalRow(a.proposalId)).status).toBe('executed');
    await approve(b.proposalId);
    await drain();
    expect(await proposalRow(b.proposalId)).toMatchObject({ status: 'invalidated', invalidated_reason: 'duplicate_within_cooldown' });
    expect(await notes(a.proposalId)).toBe(1);
    expect(await notes(b.proposalId)).toBe(0);
    const inv = await owner().query(`select status, invalidated_reason from ai_action_approval where proposal_id = $1`, [b.proposalId]);
    expect(inv.rows).toEqual([{ status: 'invalidated', invalidated_reason: 'duplicate_within_cooldown' }]);
  });

  it('autopilot: two identical queued reminders are delivered once — the second execution is invalidated under the per-key lock', evalBody(FILE, { id: 'DUP-08', category: 'duplicates', lang: 'n/a', provider: 'mock-benign', ait: ['AIT-27', 'AIT-19'] }, async () => {
    await forgetEarlierProposals();
    await owner().query(`update ai_proposal set execution_result = jsonb_set(execution_result, '{mode}', '"approved"') where project_id = $1 and execution_result->>'mode' = 'autopilot'`, [f.dcId]);
    const expires = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    const policy = { allowlist: ['create_internal_notification'], maxActionsPerDay: 10, expiresOn: expires, revoked: false, proposedBy: await demoUserId('portfolio.admin'), approvedBy: await demoUserId('sponsor'), approvedAt: new Date().toISOString() };
    await setAi(f.dcId, { mode: 'autopilot', autopilot_policy: policy, action_cooldown_hours: 0 });
    const a = await briefingProposal(pmId, f.dcId);
    const b = await briefingProposal(pmId, f.dcId);
    await setAi(f.dcId, { mode: 'autopilot', autopilot_policy: policy, action_cooldown_hours: 24 });
    await drain();
    const [pa, pb] = [await proposalRow(a.proposalId), await proposalRow(b.proposalId)];
    expect([pa.status, pb.status].sort()).toEqual(['executed', 'invalidated']);
    expect([pa, pb].find((p) => p.status === 'invalidated')!.invalidated_reason).toBe('duplicate_within_cooldown');
    expect((await notes(a.proposalId)) + (await notes(b.proposalId))).toBe(1);
    await setAi(f.dcId, { mode: 'assisted' });
  }));

  it('revision: the requester cannot revise a proposal into a twin of one awaiting review (422 ai.duplicate_within_cooldown); without a twin, revising a proposal on its own key is allowed', async () => {
    await forgetEarlierProposals();
    await setAi(f.dcId, { mode: 'assisted', action_cooldown_hours: 0 });
    const a = await briefingProposal(pmId, f.dcId);
    const b = await briefingProposal(pmId, f.dcId);
    await setAi(f.dcId, { mode: 'assisted', action_cooldown_hours: 24 });
    const pm = await login('pm');
    const pa = await proposalRow(a.proposalId);
    const pb = await proposalRow(b.proposalId);
    const { action: _a, ...payload } = pb.payload as Record<string, unknown>;
    void _a;
    const r = await pm.post(`${aiPath(f.dcId)}/proposals/${b.proposalId}/revise`, { expectedVersion: pb.version, payload: { ...payload, body: 'Please update the forecast (revised).' } });
    expect(r.status, JSON.stringify(r.body)).toBe(422);
    expect(r.body.code).toBe('ai.duplicate_within_cooldown');
    expect(r.body.detail).toContain('awaiting review');
    expect((await proposalRow(b.proposalId)).version).toBe(pb.version);
    // Once the twin is gone (rejected), revising A changes only its own wording on its own key: allowed.
    const sec = await login('secretary');
    await sec.post(`${aiPath(f.dcId)}/proposals/${b.proposalId}/reject`, { expectedVersion: pb.version, note: 'QA-P5-01 fixture (synthetic)' }).expect(201);
    const { action: _b, ...payloadA } = pa.payload as Record<string, unknown>;
    void _b;
    const ok = await pm.post(`${aiPath(f.dcId)}/proposals/${a.proposalId}/revise`, { expectedVersion: pa.version, payload: { ...payloadA, body: 'Please update the forecast (revised).' } });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
  });

  it('settings: the cooldown is a project setting (0–168 h, default 24 h in the schema), audited with the other settings', async () => {
    const col = await owner().query(`select column_default, is_nullable from information_schema.columns where table_name = 'ai_project_settings' and column_name = 'action_cooldown_hours'`);
    expect(col.rows[0]).toEqual({ column_default: '24', is_nullable: 'NO' });
    await setAi(f.dcId, { mode: 'advisory' });
    const sp = await login('sponsor');
    const s = await sp.get(`${aiPath(f.dcId)}/settings`).expect(200);
    expect(s.body.actionCooldownHours).toBe(0); // the AI fixtures turn it off
    const bad = await sp.agent.put(`${aiPath(f.dcId)}/settings`).set('x-csrf-token', sp.csrf).send({ expectedVersion: s.body.version, actionCooldownHours: 169, reason: 'QA-P5-01 (synthetic)' });
    expect(bad.status).toBe(400);
    const put = await sp.agent.put(`${aiPath(f.dcId)}/settings`).set('x-csrf-token', sp.csrf).send({ expectedVersion: s.body.version, actionCooldownHours: 12, reason: 'QA-P5-01 (synthetic)' });
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    expect(put.body.actionCooldownHours).toBe(12);
    const audit = await owner().query(`select after from audit_event where project_id = $1 and entity_type = 'ai_project_settings' order by seq desc limit 1`, [f.dcId]);
    expect(JSON.stringify(audit.rows[0].after)).toContain('"actionCooldownHours":12');
    await setAi(f.dcId, {});
  });
});

describe('QA-P5-02 — every role that may subscribe to briefings reads its OWN runs (self-scoped), never anyone else\'s [REQ-AI-010, REQ-AI-021]', () => {
  it('a contributor (ai.briefing.subscribe, no ai.run.read) lists and opens the briefing run delivered to them; another subscriber\'s run stays 404; a role with none of the three permissions gets 403', async () => {
    await setAi(f.dcId, { mode: 'advisory' });
    const contributor = await fixtureUser('qa-p5-02-contrib', 'confidential', [{ role: 'contributor' }]);
    const other = await fixtureUser('qa-p5-02-other', 'confidential', [{ role: 'contributor' }]);
    const cleanTeam = await fixtureUser('qa-p5-02-clean', 'confidential', [{ role: 'clean_team' }]);
    const { contexts, db, runtime } = await serviceHandles();
    const runOf = async (u: string) => {
      const ctx = (await contexts.forUser(u, f.dcId))!;
      return db.run(ctx, () => runtime.runBriefingNow(ctx, f.dcId, 'daily', 'scheduled'));
    };
    const mine = await runOf(contributor);
    const theirs = await runOf(other);
    const c = await loginUserId(contributor);
    const got = await c.get(`${aiPath(f.dcId)}/runs/${mine.id}`);
    expect(got.status, JSON.stringify(got.body)).toBe(200);
    expect(got.body).toMatchObject({ id: mine.id, trigger: 'scheduled' });
    const list = await c.get(`${aiPath(f.dcId)}/runs?pageSize=100`);
    expect(list.status).toBe(200);
    const ids = (list.body.items as { id: string }[]).map((r) => r.id);
    expect(ids).toContain(mine.id);
    expect(ids).not.toContain(theirs.id);
    expect((await c.get(`${aiPath(f.dcId)}/runs/${theirs.id}`)).status).toBe(404);
    // No other permission is widened: the contributor still cannot read proposals or the operations views.
    expect((await c.get(`${aiPath(f.dcId)}/proposals`)).status).toBe(403);
    const ct = await loginUserId(cleanTeam);
    const refused = await ct.get(`${aiPath(f.dcId)}/runs`);
    expect([403, 404]).toContain(refused.status);
    if (refused.status === 403) expect(refused.body.code).toBe('policy.forbidden');
  });
});

describe('QA-P5-05 / QA-P5-08 — the proposal DTO names the people the reviewer must identify; one proposal can be read by id [REQ-AI-021, REQ-AI-022]', () => {
  it('the approver (Secretary, no members-list permission) reads the proposal by id with the recipient\'s and requester\'s display names; ids outside the project or hidden from the reader are 404', async () => {
    await forgetEarlierProposals();
    await setAi(f.dcId, { mode: 'assisted', action_cooldown_hours: 0 });
    const { proposalId } = await briefingProposal(pmId, f.dcId);
    const sec = await login('secretary');
    // Precondition of the finding: the Secretary cannot list project members.
    const members = await sec.get(`/api/v1/projects/${f.dcId}/members`);
    expect([403, 404]).toContain(members.status);
    const r = await sec.get(`${aiPath(f.dcId)}/proposals/${proposalId}`);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.id).toBe(proposalId);
    const recipient = String(r.body.payload.recipientUserId);
    const names = await owner().query<{ id: string; display_name: string }>(`select id, display_name from app_user where id = any($1::uuid[])`, [[recipient, pmId]]);
    const nameOf = (id: string) => names.rows.find((x) => x.id === id)!.display_name;
    expect(r.body.requestedBy).toBe(pmId);
    expect(r.body.people).toEqual(expect.arrayContaining([{ userId: recipient, displayName: nameOf(recipient) }, { userId: pmId, displayName: nameOf(pmId) }]));
    // Only the people of this proposal are named.
    for (const p of r.body.people as { userId: string }[]) expect([recipient, pmId]).toContain(p.userId);
    // The list carries the same field.
    const list = await sec.get(`${aiPath(f.dcId)}/proposals?pageSize=100`);
    expect((list.body.items as { id: string; people: unknown[] }[]).find((x) => x.id === proposalId)!.people).toEqual(r.body.people);
    // 404: unknown id, the proposal through another project, and a member who may not see the project (QA-P5-03).
    expect((await sec.get(`${aiPath(f.dcId)}/proposals/00000000-0000-7000-8000-000000000000`)).status).toBe(404);
    expect((await sec.get(`${aiPath(f.genId)}/proposals/${proposalId}`)).status).toBe(404);
    const low = await fixtureUser('qa-p5-08-low', 'internal', [{ role: 'secretary_cpmo' }]);
    expect((await (await loginUserId(low)).get(`${aiPath(f.dcId)}/proposals/${proposalId}`)).status).toBe(404);
    // A role without ai.proposal.read is refused (403), as for the list.
    const contributor = await fixtureUser('qa-p5-08-contrib', 'confidential', [{ role: 'contributor' }]);
    expect((await (await loginUserId(contributor)).get(`${aiPath(f.dcId)}/proposals/${proposalId}`)).status).toBe(403);
  });
});

describe('QA-P5-10 — an AI run without a policy version is rejected (REQ-AI-029)', () => {
  it('the schema refuses an ai_run row without policy_version (NOT NULL), and every run the runtime records carries one', async () => {
    const col = await owner().query(`select is_nullable from information_schema.columns where table_name = 'ai_run' and column_name = 'policy_version'`);
    expect(col.rows[0].is_nullable).toBe('NO');
    await expect(
      owner().query(`insert into ai_run (id, org_id, project_id, kind, trigger, status, provider, locale) values (gen_random_uuid(), $1, $2, 'ask', 'manual', 'queued', 'mock', 'en')`, [f.orgId, f.dcId]),
    ).rejects.toThrow(/policy_version/);
    const missing = await owner().query(`select count(*)::int as n from ai_run where policy_version is null or policy_version = ''`);
    expect(missing.rows[0].n).toBe(0);
  });
});

describe('QA-P5-04 — Arabic AI output uses the Arabic template titles and translated statuses; detections carry codes + parameters [REQ-UX-001, REQ-UX-002, REQ-AI-004]', () => {
  const RAW_STATUS = /(الحالة|status) (draft|not_started|in_progress|blocked|submitted_for_acceptance)/;

  it('an Arabic question: claims name template tasks by their Arabic title with Arabic statuses; citations carry the Arabic label', async () => {
    await setAi(f.dcId, { mode: 'advisory' });
    const u = await fixtureUser('qa-p5-04-ar', 'confidential', [{ role: 'project_manager' }]);
    await owner().query(`update app_user set locale = 'ar' where id = $1`, [u]);
    const bilingual = (await owner().query<{ id: string; title: string; title_ar: string; code: string }>(`select id, title, title_ar, wbs_code as code from task where project_id = $1 and title_ar is not null and title_ar <> title`, [f.dcId])).rows;
    expect(bilingual.length).toBeGreaterThan(10); // CONTROL: the template tasks carry an Arabic title
    const c = await loginUserId(u);
    const r = await c.post(`${aiPath(f.dcId)}/ask`, { question: 'ما المهام المتأخرة أو التي بلا مالك؟' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const out = r.body.output as { claims: { text: string; citations: { type: string; id: string; label?: string; labelAr?: string | null }[] }[] };
    const texts = out.claims.map((x) => x.text);
    expect(texts.length).toBeGreaterThan(0);
    const english = bilingual.filter((t) => texts.some((x) => x.includes(t.title))).map((t) => t.title);
    const arabic = bilingual.filter((t) => texts.some((x) => x.includes(t.title_ar)));
    expect(english).toEqual([]);
    expect(arabic.length).toBeGreaterThan(0);
    expect(texts.filter((x) => RAW_STATUS.test(x))).toEqual([]);
    const taskCitations = out.claims.flatMap((x) => x.citations).filter((x) => x.type === 'task');
    expect(taskCitations.length).toBeGreaterThan(0);
    for (const ci of taskCitations) {
      const t = bilingual.find((b) => b.id === ci.id);
      if (t) expect(ci).toMatchObject({ label: `${t.code} ${t.title}`, labelAr: `${t.code} ${t.title_ar}` });
    }
  });

  it('an Arabic briefing: its claims and the reminder it prepares use the Arabic title; the stored detections keep the English label + labelAr and detailI18n', async () => {
    await forgetEarlierProposals();
    await setAi(f.dcId, { mode: 'assisted', action_cooldown_hours: 0 });
    const u = await fixtureUser('qa-p5-04-ar-pm', 'confidential', [{ role: 'project_manager' }]);
    await owner().query(`update app_user set locale = 'ar' where id = $1`, [u]);
    const { contexts, db, runtime } = await serviceHandles();
    const ctx = (await contexts.forUser(u, f.dcId))!;
    const run = await db.run(ctx, () => runtime.runBriefingNow(ctx, f.dcId));
    expect(run.status).toBe('succeeded');
    expect(run.locale).toBe('ar');
    const texts = run.output!.claims.map((x) => x.text);
    expect(texts.filter((x) => RAW_STATUS.test(x))).toEqual([]);
    const tt = (await owner().query<{ title: string; title_ar: string | null; code: string }>(`select title, title_ar, wbs_code as code from task where id = $1`, [f.overdueTaskId])).rows[0]!;
    if (tt.title_ar) {
      expect(texts.some((x) => x.includes(tt.title_ar!))).toBe(true);
      expect(texts.some((x) => x.includes(tt.title))).toBe(false);
      const pid = run.output!.proposals[0]?.id;
      expect(pid).toBeTruthy();
      const p = await proposalRow(pid!);
      expect(p.payload.title).toBe(`طلب تحديث: ${tt.code} ${tt.title_ar}`.slice(0, 200));
    }
    const d = run.output!.detections.find((x) => x.code === 'task_overdue' && x.entityId === f.overdueTaskId)!;
    expect(d).toBeTruthy();
    expect(d.label).toBe(`${tt.code} ${tt.title}`);
    expect(d.labelAr).toBe(tt.title_ar ? `${tt.code} ${tt.title_ar}` : undefined);
    expect(d.detailI18n![0]).toMatchObject({ code: 'ai.detection.task_overdue', params: { code: tt.code } });
  });

  it('GET detections: English detail + codes with the raw enum as a parameter (translated by the client), Arabic label for template records', async () => {
    const pm = await login('pm');
    const r = await pm.get(`${aiPath(f.dcId)}/detections`).expect(200);
    const items = r.body.items as { code: string; label: string; labelAr?: string; detail: string; detailI18n: { code: string; params: Record<string, string | number> }[]; entityType: string; entityId: string }[];
    expect(items.length).toBeGreaterThan(0);
    for (const d of items) {
      expect(d.detailI18n.length, d.code).toBeGreaterThan(0);
      for (const msg of d.detailI18n) expect(msg.code.startsWith('ai.detection.'), msg.code).toBe(true);
      expect(d.detail).not.toMatch(/[؀-ۿ]/); // the English sentence; the Arabic screen translates the codes
    }
    const overdue = items.find((d) => d.code === 'task_overdue' && d.entityId === f.overdueTaskId)!;
    expect(String(overdue.detailI18n[0]!.params.status)).toMatch(/^(not_started|in_progress|blocked|submitted_for_acceptance)$/);
    const owners = items.filter((d) => d.code === 'owner_missing' && d.entityType === 'task');
    expect(owners.length).toBeGreaterThan(0);
    const withAr = await owner().query<{ id: string }>(`select id from task where id = any($1::uuid[]) and title_ar is not null`, [owners.map((o) => o.entityId)]);
    for (const o of owners) {
      if (withAr.rows.some((x) => x.id === o.entityId)) expect(o.labelAr, o.label).toMatch(/[؀-ۿ]/);
      else expect(o, 'a title typed by a person carries no labelAr').not.toHaveProperty('labelAr');
    }
  });
});

describe('QA-P5-06 — the Committee Hub escalation register carries the codes of the system-written TSA escalation texts [REQ-UX-001, REQ-UX-002]', () => {
  it('the register DTO gives the TSA escalation\'s requested action and routing target as tsa.* codes (as the TSA page); escalations whose text is not a known template carry none', async () => {
    const pm = await login('pm');
    const r = await pm.get(`/api/v1/projects/${f.dcId}/escalations?pageSize=100`).expect(200);
    const items = r.body.items as { code: string; sourceType: string; isSystemGenerated: boolean; requestedAction: string; requestedActionI18n: { code: string; params: Record<string, string | number> }[]; target: string | null; targetI18n: { code: string }[] }[];
    const tsa = items.find((e) => e.sourceType === 'tsa_service' && e.isSystemGenerated);
    expect(tsa, 'the demo seed raises a TSA expiry escalation').toBeTruthy();
    expect(tsa!.requestedActionI18n).toEqual([expect.objectContaining({ code: 'tsa.escalation.expired_unresolved' })]);
    expect(tsa!.targetI18n.length).toBe(1);
    expect(tsa!.targetI18n[0]!.code).toMatch(/^tsa\.routing\./);
    for (const e of items.filter((x) => x.sourceType !== 'tsa_service')) {
      expect(e.requestedActionI18n, e.code).toEqual([]);
      expect(e.targetI18n, e.code).toEqual([]);
    }
  });
});
