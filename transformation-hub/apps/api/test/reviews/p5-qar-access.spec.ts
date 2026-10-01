import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { aiToolByName } from '@hub/domain';
import { closeApp, closePools, owner } from '../helpers';
import { AiSettingsService } from '../../src/modules/ai/ai-settings.service';
import { aiPath, briefingProposal, CANARY, demoUserId, drain, ensureFixtures, fixtureUser, login, loginUserId, proposalRow, serviceHandles, setAi, type Fixtures } from '../ai/ai-fixtures';

/**
 * Independent QA RE-CHECK of P5 (docs/reviews/P5-qa-recheck.md) — QA-P5-03 and QA-P5-08 through the real API and the worker.
 *
 *  1. Route matrix: a member who holds EVERY AI permission (sponsor + auditor + project manager roles) but is cleared below the
 *     project's classification gets 404 from each of the 21 AI routes — including their OWN run, created while they were
 *     still cleared — exactly like the project / plan routes; the same roles at the project's classification (CONTROL) are
 *     not refused (no 404).
 *  2. Worker paths re-check the CURRENT clearance against the project: an async question, an approved proposal whose
 *     requester / approver / recipient falls below the project, a scheduled briefing — nothing is produced or delivered.
 *  3. No dangling citation for readers who see the project but not everything in it: every citation of every answer (8
 *     questions, en + ar, PM and functional approver) opens for the asker; the restricted canary is never shown.
 *  4. QA-P5-08: GET proposal by id applies the list's visibility (a proposal drafted from a RESTRICTED input is 404 for the
 *     PM, 200 for readers cleared for it; another project's path 404).
 *
 * Probe convention: DEFECT = it.fails asserting the required behaviour; OBSERVED = current behaviour; CONTROL = precondition.
 * The owner pool is used only for set-up the API does not offer (fixture users, clearance changes standing in for the admin
 * clearance grant, AI settings rows, the schedule's due time) and to read rows.
 */

let f: Fixtures;
let pmId: string;

const setClearance = (u: string, c: string) => owner().query(`update app_user set clearance = $2 where id = $1`, [u, c]);
const notesOf = async (proposalId: string) => (await owner().query(`select id from notification where ai_proposal_id = $1`, [proposalId])).rowCount ?? 0;

beforeAll(async () => {
  f = await ensureFixtures();
  pmId = await demoUserId('pm');
}, 300_000);

afterAll(async () => {
  if (f) await setAi(f.dcId, {});
  await closeApp();
  await closePools();
});

// =====================================================================================================================
describe('QA-P5-03 re-check (1) — all 21 AI routes answer 404 to a member cleared below the project\'s classification, as the project / plan routes do [REQ-AI-006, REQ-SEC-021, AT-19]', () => {
  const ROLES = [{ role: 'sponsor' }, { role: 'auditor' }, { role: 'project_manager' }];
  let low: string;
  let ctl: string;
  const result = { low: {} as Record<string, number>, ctl: {} as Record<string, number> };
  let killSwitchAfterLow: boolean | null = null;
  let projectStatus = { low: 0, ctl: 0 };
  let ownRunBody = '';

  beforeAll(async () => {
    await setAi(f.dcId, { mode: 'assisted' });
    low = await fixtureUser('p5qar-low-all', 'confidential', ROLES);
    ctl = await fixtureUser('p5qar-ctl-all', 'confidential', ROLES);
    for (const u of [low, ctl]) await setClearance(u, 'confidential'); // idempotent fixture
    const L = await loginUserId(low);
    const C = await loginUserId(ctl);
    // While cleared at the project's classification: each asks once (own run) and subscribes.
    const lowRun = await L.post(`${aiPath(f.dcId)}/ask`, { question: 'Which tasks are overdue and who owns them?', locale: 'en' });
    const ctlRun = await C.post(`${aiPath(f.dcId)}/ask`, { question: 'Which tasks are overdue and who owns them?', locale: 'en' });
    expect(lowRun.status, JSON.stringify(lowRun.body)).toBe(201);
    expect(ctlRun.status).toBe(201);
    const pa = await briefingProposal(pmId, f.dcId);
    const pb = await briefingProposal(pmId, f.dcId);
    // The clearance falls below the project's classification (DEMO-DC is confidential).
    await setClearance(low, 'internal');
    const settingsVersion = (await C.get(`${aiPath(f.dcId)}/settings`)).body.version as number;
    const pRow = await proposalRow(pa.proposalId);
    const pbRow = await proposalRow(pb.proposalId);
    const { action: _a, ...payload } = pRow.payload as Record<string, unknown>;
    void _a;
    type Call = { key: string; run: (c: Awaited<ReturnType<typeof loginUserId>>, who: 'low' | 'ctl') => Promise<{ status: number; body: unknown }> };
    const A = aiPath(f.dcId);
    const calls: Call[] = [
      { key: 'GET settings', run: (c) => c.get(`${A}/settings`) },
      { key: 'PUT settings', run: (c) => c.agent.put(`${A}/settings`).set('x-csrf-token', c.csrf).send({ expectedVersion: settingsVersion, reason: 'QA re-check probe (synthetic)' }) },
      { key: 'POST autopilot-policy/approve', run: (c) => c.post(`${A}/autopilot-policy/approve`, { expectedVersion: settingsVersion }) },
      { key: 'POST autopilot-policy/revoke', run: (c) => c.post(`${A}/autopilot-policy/revoke`, { expectedVersion: settingsVersion, reason: 'QA re-check probe (synthetic)' }) },
      { key: 'POST killswitch/activate', run: (c) => c.post(`${A}/killswitch/activate`, { reason: 'QA re-check probe (synthetic)' }) },
      { key: 'POST killswitch/release', run: (c) => c.post(`${A}/killswitch/release`, { reason: 'QA re-check probe (synthetic)' }) },
      { key: 'POST ask', run: (c) => c.post(`${A}/ask`, { question: 'Which tasks are overdue and who owns them?', locale: 'en' }) },
      { key: 'GET runs', run: (c) => c.get(`${A}/runs`) },
      { key: 'GET runs/:own', run: (c, who) => c.get(`${A}/runs/${who === 'low' ? lowRun.body.id : ctlRun.body.id}`) },
      { key: 'GET status', run: (c) => c.get(`${A}/status`) },
      { key: 'GET costs', run: (c) => c.get(`${A}/costs`) },
      { key: 'GET detections', run: (c) => c.get(`${A}/detections`) },
      { key: 'GET tools', run: (c) => c.get(`${A}/tools`) },
      { key: 'GET proposals', run: (c) => c.get(`${A}/proposals`) },
      { key: 'GET proposals/:id', run: (c) => c.get(`${A}/proposals/${pa.proposalId}`) },
      { key: 'POST proposals/:id/approve', run: (c, who) => c.post(`${A}/proposals/${who === 'low' ? pa.proposalId : pb.proposalId}/approve`, { expectedVersion: (who === 'low' ? pRow : pbRow).version }) },
      { key: 'POST proposals/:id/reject', run: (c, who) => c.post(`${A}/proposals/${who === 'low' ? pa.proposalId : pb.proposalId}/reject`, { expectedVersion: (who === 'low' ? pRow : pbRow).version, note: 'QA re-check probe (synthetic)' }) },
      { key: 'POST proposals/:id/revise', run: (c) => c.post(`${A}/proposals/${pa.proposalId}/revise`, { expectedVersion: pRow.version, payload: { ...payload, body: 'Revised (QA re-check probe, synthetic)' } }) },
      { key: 'GET briefings', run: (c) => c.get(`${A}/briefings`) },
      { key: 'POST briefings', run: (c) => c.post(`${A}/briefings`, { kind: 'weekly' }) },
      { key: 'GET artifacts', run: (c) => c.get(`${A}/artifacts`) },
    ];
    for (const call of calls) {
      const r = await call.run(L, 'low');
      result.low[call.key] = r.status;
      if (call.key === 'GET runs/:own') ownRunBody = JSON.stringify(r.body);
    }
    killSwitchAfterLow = (await owner().query(`select kill_switch from ai_project_settings where project_id = $1`, [f.dcId])).rows[0].kill_switch;
    for (const call of calls) result.ctl[call.key] = (await call.run(C, 'ctl')).status;
    // The cleared member's emergency stop is released by another person (not_self), as the product requires.
    const sp = await login('sponsor');
    const rel = await sp.post(`${A}/killswitch/release`, { reason: 'QA re-check probe: release after the CONTROL (synthetic)' });
    expect([201, 422]).toContain(rel.status);
    projectStatus = { low: (await L.get(`/api/v1/projects/${f.dcId}`)).status, ctl: (await C.get(`/api/v1/projects/${f.dcId}`)).status };
    console.log(`P5-QAR route matrix: ${JSON.stringify({ projectStatus, killSwitchAfterLow, result })}`);
  }, 300_000);

  it('CONTROL: the planning / portfolio modules refuse the under-cleared member the project (404) and serve the cleared one (200)', () => {
    expect(projectStatus).toEqual({ low: 404, ctl: 200 });
  });

  it('CONTROL: the same roles at the project\'s classification are not refused by any of the 21 routes (no 404)', () => {
    expect(Object.keys(result.ctl)).toHaveLength(21);
    expect(Object.entries(result.ctl).filter(([, s]) => s === 404)).toEqual([]);
  });

  it('QA-P5-03: every AI route answers 404 to the under-cleared member — including their own earlier run — and the emergency-stop request changed nothing', () => {
    expect(Object.keys(result.low)).toHaveLength(21);
    expect(Object.entries(result.low).filter(([, s]) => s !== 404)).toEqual([]);
    expect(ownRunBody).not.toContain('WS07');
    expect(killSwitchAfterLow).toBe(false);
  });
});

// =====================================================================================================================
describe('QA-P5-03 re-check (2) — the worker re-checks the CURRENT clearance against the project before producing or delivering anything [REQ-AI-027, REQ-SEC-021, AT-19]', () => {
  const out = {} as Record<string, unknown>;

  beforeAll(async () => {
    await setAi(f.dcId, { mode: 'assisted' });
    const sec = await login('secretary');
    // (a) Async question queued while cleared; clearance lowered before the worker runs it.
    const asker = await fixtureUser('p5qar-async', 'confidential', [{ role: 'contributor' }]);
    await setClearance(asker, 'confidential');
    const q = await (await loginUserId(asker)).post(`${aiPath(f.dcId)}/ask`, { question: 'Which tasks are overdue and who owns them?', locale: 'en', async: true });
    out.asyncQueued = { status: q.status, runStatus: q.body.status };
    await setClearance(asker, 'internal');
    await drain();
    out.asyncRun = (await owner().query(`select status, error, output from ai_run where id = $1`, [q.body.id])).rows[0];

    // (b) Proposal approved; then its REQUESTER (a PM-role member) falls below the project before execution.
    const req = await fixtureUser('p5qar-req', 'confidential', [{ role: 'project_manager' }]);
    await setClearance(req, 'confidential');
    const b = await briefingProposal(req, f.dcId);
    out.reqApprove = (await sec.post(`${aiPath(f.dcId)}/proposals/${b.proposalId}/approve`, { expectedVersion: (await proposalRow(b.proposalId)).version })).status;
    await setClearance(req, 'internal');
    await drain();
    const pb = await proposalRow(b.proposalId);
    out.requester = { status: pb.status, reason: pb.invalidated_reason, notes: await notesOf(b.proposalId) };

    // (c) Proposal approved by an approver who then falls below the project before execution.
    const apr = await fixtureUser('p5qar-approver', 'confidential', [{ role: 'secretary_cpmo' }]);
    await setClearance(apr, 'confidential');
    const c = await briefingProposal(pmId, f.dcId);
    out.aprApprove = (await (await loginUserId(apr)).post(`${aiPath(f.dcId)}/proposals/${c.proposalId}/approve`, { expectedVersion: (await proposalRow(c.proposalId)).version })).status;
    await setClearance(apr, 'internal');
    await drain();
    const pc = await proposalRow(c.proposalId);
    out.approver = { status: pc.status, reason: pc.invalidated_reason, notes: await notesOf(c.proposalId) };

    // (d) A message whose RECIPIENT falls below the project after the approval (the runtime's tool path, as the delegating PM).
    const rcp = await fixtureUser('p5qar-recipient', 'confidential', [{ role: 'contributor' }]);
    await setClearance(rcp, 'confidential');
    const pm = await login('pm');
    const run = await pm.post(`${aiPath(f.dcId)}/ask`, { question: 'P5QARNOOP overdue', locale: 'en' });
    const { contexts, db, proposals, app } = await serviceHandles();
    const ctx = (await contexts.forUser(pmId, f.dcId))!;
    const s = await db.run(ctx, () => app.get(AiSettingsService).load(f.dcId));
    const created = await db.run(ctx, () =>
      proposals.createFromTool(ctx, f.dcId, { id: run.body.id, requestedBy: pmId }, aiToolByName('propose_internal_notification')!, { recipientUserId: rcp, title: 'P5QAR reminder (synthetic)', body: 'Please update WS07 (synthetic).', targetType: 'task', targetId: f.overdueTaskId }, s),
    );
    const pid = (created as { proposal?: { id: string } }).proposal?.id ?? null;
    out.recipientCreated = pid ? 'created' : JSON.stringify(created);
    if (pid) {
      out.rcpApprove = (await sec.post(`${aiPath(f.dcId)}/proposals/${pid}/approve`, { expectedVersion: (await proposalRow(pid)).version })).status;
      await setClearance(rcp, 'internal');
      await drain();
      const pd = await proposalRow(pid);
      out.recipient = { status: pd.status, reason: pd.invalidated_reason, notes: await notesOf(pid), toRecipient: (await owner().query(`select count(*)::int n from notification where user_id = $1`, [rcp])).rows[0].n };
    }
    // (e) A subscriber DEACTIVATED through the admin API (user revocation, REQ-SEC-021) after subscribing and queuing a question.
    const gone = await fixtureUser('p5qar-deactivated', 'confidential', [{ role: 'contributor' }]);
    await owner().query(`update app_user set is_active = true, clearance = 'confidential' where id = $1`, [gone]); // idempotent fixture
    const g = await loginUserId(gone);
    const sub = await g.post(`${aiPath(f.dcId)}/briefings`, { kind: 'daily' });
    const gq = await g.post(`${aiPath(f.dcId)}/ask`, { question: 'Which tasks are overdue and who owns them?', locale: 'en', async: true });
    const admin = await login('platform.admin');
    out.deactivate = (await admin.post(`/api/v1/admin/users/${gone}/deactivate`, { reason: 'P5 QA re-check: user revocation (synthetic)' })).status;
    await owner().query(`update scheduled_job set next_run_at = now() - interval '1 minute' where id = $1`, [sub.body.id]);
    await drain();
    out.deactivated = {
      subscribe: sub.status,
      queued: gq.status,
      asyncRun: (await owner().query(`select status, error, output is null as no_output from ai_run where id = $1`, [gq.body.id])).rows[0],
      briefing: (await owner().query(`select status, error, output is null as no_output from ai_run where trigger_ref like $1`, [`schedule:${sub.body.id}:%`])).rows,
      notes: (await owner().query(`select count(*)::int n from notification where user_id = $1`, [gone])).rows[0].n,
      sessionAfter: (await g.get('/api/v1/me')).status,
    };
    await owner().query(`update app_user set is_active = true where id = $1`, [gone]); // fixture restored for re-runs
    console.log(`P5-QAR worker paths: ${JSON.stringify(out)}`);
  }, 300_000);

  it('user revocation: a subscriber deactivated through the admin API gets no briefing and no answer from the worker (both recorded skipped, no output, no notification) and their session ends', () => {
    expect(out.deactivate).toBe(201);
    const d = out.deactivated as { subscribe: number; queued: number; asyncRun: { status: string; no_output: boolean }; briefing: { status: string; no_output: boolean }[]; notes: number; sessionAfter: number };
    expect(d.subscribe).toBe(201);
    expect(d.queued).toBe(201);
    expect(d.asyncRun).toMatchObject({ status: 'skipped', no_output: true });
    expect(d.briefing).toHaveLength(1);
    expect(d.briefing[0]).toMatchObject({ status: 'skipped', no_output: true });
    expect(d.notes).toBe(0);
    expect(d.sessionAfter).toBe(401);
  });

  it('async question: queued while cleared, recorded skipped (requester_access_revoked) with no output once the clearance fell below the project', () => {
    expect(out.asyncQueued).toMatchObject({ status: 201, runStatus: 'queued' });
    expect(out.asyncRun).toMatchObject({ status: 'skipped', error: 'requester_access_revoked', output: null });
  });

  it('approved proposal, requester below the project at execution → invalidated (requester_no_longer_authorized), nothing sent', () => {
    expect(out.reqApprove).toBe(201);
    expect(out.requester).toEqual({ status: 'invalidated', reason: 'requester_no_longer_authorized', notes: 0 });
  });

  it('approved proposal, approver below the project at execution → invalidated, nothing sent', () => {
    expect(out.aprApprove).toBe(201);
    expect((out.approver as { status: string }).status).toBe('invalidated');
    expect((out.approver as { notes: number }).notes).toBe(0);
  });

  it('approved message, recipient below the project at execution → invalidated (recipient_not_cleared_for_content), nothing delivered to them', () => {
    expect(out.recipientCreated).toBe('created');
    expect(out.rcpApprove).toBe(201);
    expect(out.recipient).toEqual({ status: 'invalidated', reason: 'recipient_not_cleared_for_content', notes: 0, toRecipient: 0 });
  });
});

// =====================================================================================================================
describe('QA-P5-03 re-check (3) — no dangling citation for readers who see the project but not all of it (8 questions, en + ar) [REQ-AI-004, REQ-AI-006, P5 exit "valid citations / permissions"]', () => {
  const QUESTIONS = {
    en: [
      'Which tasks are overdue and who owns them?',
      'What decisions are awaiting action?',
      'What are the gate blockers?',
      'Which closing conditions are open?',
      'Which TSA services are expiring?',
      'Which readiness checks block go-live?',
      `What does the restricted exclusivity memo ${CANARY.restricted} say?`,
      'Are we ready to close?',
    ],
    ar: [
      'ما المهام المتأخرة ومن يملكها؟',
      'ما القرارات التي تنتظر إجراءً؟',
      'ما عوائق البوابات؟',
      'ما شروط الإتمام المفتوحة؟',
      'ما خدمات الاتفاقية الانتقالية التي تقترب من نهايتها؟',
      'ما فحوصات الجاهزية التي تمنع التشغيل؟',
      `ماذا تقول مذكرة الحصرية المقيدة ${CANARY.restricted}؟`,
      'هل نحن جاهزون للإتمام؟',
    ],
  };
  const P = (pid: string) => `/api/v1/projects/${pid}`;
  const detail: Record<string, string> = {
    task: 'tasks',
    milestone: 'milestones',
    document: 'documents',
    decision: 'decisions',
    action_item: 'actions',
    closing_condition: 'closing-conditions',
    tsa_service: 'tsa-services',
    readiness_check: 'readiness-checks',
    partner: 'partners',
    financial_snapshot: 'financial-snapshots',
  };
  const res: { who: string; lang: string; q: string; claims: number; citations: number; bad: string[]; canary: boolean; types: string[] }[] = [];

  beforeAll(async () => {
    await setAi(f.dcId, {});
    const approver = await fixtureUser('p5qar-cit-approver', 'confidential', [{ role: 'functional_approver' }]);
    const readers = [
      { who: 'pm', c: await login('pm') },
      { who: 'functional_approver', c: await loginUserId(approver) },
    ];
    for (const { who, c } of readers) {
      for (const lang of ['en', 'ar'] as const) {
        for (const q of QUESTIONS[lang]) {
          const r = await c.post(`${aiPath(f.dcId)}/ask`, { question: q, locale: lang });
          expect(r.status, `${who} ${q}`).toBe(201);
          // The run as the reader reads it later (citations re-checked on read).
          const g = await c.get(`${aiPath(f.dcId)}/runs/${r.body.id}`);
          const o = g.body.output as { claims: { citations: { type: string; id: string }[] }[]; conflicts: { citations: { type: string; id: string }[] }[] };
          const cits = [...o.claims.flatMap((x) => x.citations), ...o.conflicts.flatMap((x) => x.citations)];
          const uniq = [...new Map(cits.map((x) => [`${x.type}:${x.id}`, x])).values()];
          const bad: string[] = [];
          for (const x of uniq) {
            if (x.type === 'computation') continue;
            let status: number;
            if (detail[x.type]) status = (await c.get(`${P(f.dcId)}/${detail[x.type]}/${x.id}`)).status;
            else if (x.type === 'gate_definition') status = (await c.get(`${P(f.dcId)}/gates/${x.id}`)).status; // the gate detail is keyed by the definition id
            else if (x.type === 'workstream' || x.type === 'status_dimension') {
              const l = await c.get(`${P(f.dcId)}/${x.type === 'workstream' ? 'workstreams' : 'status-dimensions'}`);
              status = l.status === 200 && ((l.body.items ?? l.body) as { id: string }[]).some((i) => i.id === x.id) ? 200 : 404;
            } else status = -1;
            if (status !== 200) bad.push(`${x.type}:${x.id} → ${status}`);
          }
          res.push({ who, lang, q, claims: o.claims.length, citations: uniq.length, bad, canary: JSON.stringify(g.body.output).includes('fee terms are under negotiation'), types: [...new Set(uniq.map((x) => x.type))] });
        }
      }
    }
    console.log(`P5-QAR citations: ${JSON.stringify(res.map((r) => ({ who: r.who, lang: r.lang, q: r.q.slice(0, 30), claims: r.claims, citations: r.citations, types: r.types, bad: r.bad })))}`);
  }, 600_000);

  it('CONTROL: the answers cite records of several types (not an empty set)', () => {
    expect(res.reduce((n, r) => n + r.citations, 0)).toBeGreaterThan(20);
    expect(new Set(res.flatMap((r) => r.types)).size).toBeGreaterThanOrEqual(3);
  });

  it('every citation of every answer opens for the reader through the owning module (no dangling citation), and the restricted memo is never shown to these readers', () => {
    expect(res.filter((r) => r.bad.length).map((r) => `${r.who}/${r.lang} "${r.q}": ${r.bad.join(', ')}`)).toEqual([]);
    expect(res.filter((r) => r.canary).map((r) => r.q)).toEqual([]);
  });
});

// =====================================================================================================================
describe('QA-P5-08 re-check — GET proposal by id applies the list\'s visibility (target, run inputs, project) [REQ-AI-021, SEC-P34R-05]', () => {
  const r = {} as Record<string, unknown>;

  beforeAll(async () => {
    // The provider ceiling admits the restricted memo for this scenario only (test-only settings row).
    await setAi(f.dcId, { mode: 'assisted', max_classification_to_provider: 'restricted' });
    const sec = await login('secretary'); // cleared restricted; holds notifications.message.send
    const secId = await demoUserId('secretary');
    const sponsorId = await demoUserId('sponsor');
    const run = await sec.post(`${aiPath(f.dcId)}/ask`, { question: `What does the restricted exclusivity memo ${CANARY.restricted} say?`, locale: 'en' });
    const snap = (await owner().query(`select evidence_snapshot from ai_run where id = $1`, [run.body.id])).rows[0].evidence_snapshot as { items: { type: string; id: string; classification: string }[] };
    r.inputClassifications = [...new Set(snap.items.map((i) => i.classification))];
    const { contexts, db, proposals, app } = await serviceHandles();
    const ctx = (await contexts.forUser(secId, f.dcId))!;
    const s = await db.run(ctx, () => app.get(AiSettingsService).load(f.dcId));
    const created = await db.run(ctx, () => proposals.createFromTool(ctx, f.dcId, { id: run.body.id, requestedBy: secId }, aiToolByName('propose_internal_notification')!, { recipientUserId: sponsorId, title: 'P5QAR memo note (synthetic)', body: 'See the memo (synthetic).' }, s));
    const id = (created as { proposal?: { id: string } }).proposal?.id ?? null;
    r.created = id ? 'created' : JSON.stringify(created);
    if (id) {
      const pm = await login('pm');
      const sponsor = await login('sponsor');
      r.pmById = (await pm.get(`${aiPath(f.dcId)}/proposals/${id}`)).status;
      r.pmListed = ((await pm.get(`${aiPath(f.dcId)}/proposals?pageSize=100`)).body.items as { id: string }[]).some((p) => p.id === id);
      r.secById = (await sec.get(`${aiPath(f.dcId)}/proposals/${id}`)).status;
      r.sponsorById = (await sponsor.get(`${aiPath(f.dcId)}/proposals/${id}`)).status;
      r.otherProjectPath = (await sponsor.get(`${aiPath(f.genId)}/proposals/${id}`)).status;
      r.badId = (await sponsor.get(`${aiPath(f.dcId)}/proposals/not-a-uuid`)).status;
    }
    await setAi(f.dcId, {});
    console.log(`P5-QAR proposal by id: ${JSON.stringify(r)}`);
  }, 300_000);

  it('CONTROL: the secretary\'s run sent the RESTRICTED memo to the (Simulated) provider and a message proposal was drafted from it', () => {
    expect(r.inputClassifications).toContain('restricted');
    expect(r.created).toBe('created');
  });

  it('the PM (cleared confidential) gets 404 by id and does not see it in the list; the secretary and the sponsor (cleared for the input) get 200; another project\'s path 404; a malformed id is refused', () => {
    expect(r.pmById).toBe(404);
    expect(r.pmListed).toBe(false);
    expect(r.secById).toBe(200);
    expect(r.sponsorById).toBe(200);
    expect(r.otherProjectPath).toBe(404);
    expect([400, 404]).toContain(r.badId);
  });
});
