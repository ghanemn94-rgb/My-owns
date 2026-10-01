import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { aiToolByName, type AiClaim } from '@hub/domain';
import { closeApp, closePools, owner } from '../helpers';
import { P, doc, login, ok, plusDays, setupJvProject, syntheticUser, DocClient, JvProject } from '../jv/jv-kit';
import { proposalRow, serviceHandles, setAi } from '../ai/ai-fixtures';
import { runWorker } from '../gates/gate-test-kit';
import { paper } from '../governance/gov-fixtures';
import { AiSettingsService } from '../../src/modules/ai/ai-settings.service';
import type { ModelProvider, ModelRequest, ModelToolCall } from '../../src/modules/ai/providers/model-provider';
import type { ClaimedJob } from '../../src/platform/jobs/job-queue.service';

/**
 * P5 (Proactive AI PM) security review — docs/reviews/P5-security-review.md. Written by the security-privacy-reviewer in a
 * separate context; no implementation file and no existing test was changed.
 *
 * `DEFECT` = `it.fails` asserting the REQUIRED behaviour (red once fixed; then rename "(fixed, regression)", plain `it`).
 * `CONTROL` confirms a control or a precondition that holds before AND after a fix (so a broken set-up never hides behind
 * an expected failure). Scenarios run in `beforeAll` blocks; the tests only assert on what was recorded.
 *
 * A SCRIPTED provider stands in for a real model that follows instructions found in its sources (AT-17, AIT-01/07): it
 * returns the tool calls such a model would return. It is installed through the registry's test hook
 * (`ProviderRegistry.override`) and is Simulated (no network). The runtime path after the model is the production path.
 * The owner pool is used only for set-up the API does not offer (AI settings rows, an aged document version, an overdue
 * due date) and for reading rows; each use is commented. One fresh JV test project, synthetic data only.
 */
let j: JvProject;
let pid: string;
let admin: DocClient;
let pmB: DocClient;
let techLead: DocClient;
let opsLead: DocClient;
let ws0: string;
let ws0Task: string;
let ws1Task: string;

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
function scripted(real: ModelProvider, script: (req: ModelRequest) => { toolCalls?: ModelToolCall[]; claims?: AiClaim[] }, seen?: ModelRequest[]): ModelProvider {
  return {
    id: 'mock',
    simulated: true,
    destination: () => null,
    status: (m) => real.status(m),
    label: () => real.label(),
    estimateCost: () => '0.0000',
    async generate(req, signal) {
      seen?.push(JSON.parse(JSON.stringify(req)) as ModelRequest);
      const base = await real.generate(req, signal);
      const s = script(req);
      return { ...base, toolCalls: s.toolCalls ?? base.toolCalls, claims: s.claims ?? base.claims };
    },
  };
}

async function withProvider<T>(p: (real: ModelProvider) => ModelProvider, fn: () => Promise<T>): Promise<T> {
  const { registry } = await serviceHandles();
  const real = registry.get('mock');
  registry.override('mock', p(real));
  try {
    return await fn();
  } finally {
    registry.override('mock', real);
  }
}

const notes = async (proposalId: string) =>
  (await owner().query<{ user_id: string; title: string; body: string }>(`select user_id, title, body from notification where ai_proposal_id = $1`, [proposalId])).rows;

const snapshotOf = async (runId: string) => (await owner().query(`select evidence_snapshot from ai_run where id = $1`, [runId])).rows[0]?.evidence_snapshot as Record<string, any> | undefined;

/** A run of the PM with an EMPTY evidence set (no document matches the term; no overdue work in a fresh project). */
async function emptyRun(c: DocClient, term: string) {
  const r = await ok(await c.post(`${P(pid)}/ai/ask`, { question: `${term} overdue`, locale: 'en' }));
  expect(r.status).toBe('succeeded');
  return r.id as string;
}

/** The runtime's path for a model tool call (createFromTool, as the delegating user, in that user's transaction). */
async function propose(delegate: DocClient, runId: string, tool: string, args: Record<string, unknown>) {
  const { contexts, db, proposals, app } = await serviceHandles();
  const ctx = (await contexts.forUser(delegate.userId, pid))!;
  const s = await db.run(ctx, () => app.get(AiSettingsService).load(pid));
  const created = await db.run(ctx, () => proposals.createFromTool(ctx, pid, { id: runId, requestedBy: delegate.userId }, aiToolByName(tool)!, args, s));
  expect('proposal' in created, JSON.stringify(created)).toBe(true);
  return (created as { proposal: { id: string } }).proposal.id;
}

const autopilotToday = async () =>
  (
    await owner().query<{ n: number }>(
      `select count(*)::int n from ai_proposal where project_id = $1 and status = 'executed' and execution_result->>'mode' = 'autopilot'
         and (executed_at at time zone 'Asia/Riyadh')::date = (now() at time zone 'Asia/Riyadh')::date`,
      [pid],
    )
  ).rows[0]!.n;

beforeAll(async () => {
  j = await setupJvProject('P5SEC-AI');
  pid = j.projectId;
  admin = await login('portfolio.admin');
  pmB = await login('pm.b');
  techLead = j.gp.techLead as unknown as DocClient;
  opsLead = j.gov.secretary2 as unknown as DocClient;
  ws0 = (await owner().query(`select workstream_id from project_membership where project_id = $1 and user_id = $2 and role = 'workstream_lead'`, [pid, techLead.userId])).rows[0].workstream_id;
  ws0Task = (await owner().query(`select id from task where project_id = $1 and workstream_id = $2 order by sort_order limit 1`, [pid, ws0])).rows[0].id;
  ws1Task = (await owner().query(`select id from task where project_id = $1 and workstream_id is not null and workstream_id <> $2 order by sort_order limit 1`, [pid, ws0])).rows[0].id;
  await setAi(pid, { mode: 'assisted' }); // owner pool: test-only AI settings (Simulated mock provider, assisted mode)
}, 600_000);

afterAll(async () => {
  await closeApp();
  await closePools();
});

// =====================================================================================================================
describe('Lead fix (approve(): invalidation written in an autonomous transaction, invalidateDetached) — independent verification', () => {
  let runId: string;
  let p1: string;
  let p2: string;
  const refused: Record<string, number> = {};
  let fixed: { status: number; code: string };
  let concurrent: { statuses: number[]; codes: string[]; ms: number };

  beforeAll(async () => {
    runId = await emptyRun(j.p.pm, 'P5SECNOOP');
    p1 = await propose(j.p.pm, runId, 'propose_internal_notification', { recipientUserId: j.p.contributor.userId, targetType: 'task', targetId: ws0Task, title: 'Update requested (probe)', body: 'Please update this task (synthetic probe).' });
    p2 = await propose(j.p.pm, runId, 'propose_internal_notification', { recipientUserId: j.p.legal.userId, targetType: 'task', targetId: ws0Task, title: 'Update requested (probe 2)', body: 'Please update this task (synthetic probe).' });
    // Owner pool: the target task is edited after the proposals were prepared (its version moves on).
    await owner().query(`update task set version = version + 1 where id = $1`, [ws0Task]);
    const v1 = (await proposalRow(p1)).version;
    for (const [name, c] of [['contributor (no ai.proposal.approve)', j.p.contributor], ['pm.b (other project)', pmB], ['pm (the requester)', j.p.pm]] as const) {
      refused[name] = (await c.post(`${P(pid)}/ai/proposals/${p1}/approve`, { expectedVersion: v1 })).status;
    }
    refused['after refused callers: proposal status'] = (await proposalRow(p1)).status === 'proposed' ? 1 : 0;
    refused['after refused callers: AI_APPROVAL_INVALIDATED rows'] = (await owner().query(`select count(*)::int n from audit_event where entity_id = $1 and action = 'AI_APPROVAL_INVALIDATED'`, [p1])).rows[0].n;
    const r = await j.p.secretary.post(`${P(pid)}/ai/proposals/${p1}/approve`, { expectedVersion: v1 });
    fixed = { status: r.status, code: r.body.code };
    const v2 = (await proposalRow(p2)).version;
    const t0 = Date.now();
    const both = await Promise.all([j.p.secretary.post(`${P(pid)}/ai/proposals/${p2}/approve`, { expectedVersion: v2 }), opsLead.post(`${P(pid)}/ai/proposals/${p2}/approve`, { expectedVersion: v2 })]);
    concurrent = { statuses: both.map((x) => x.status), codes: both.map((x) => x.body.code), ms: Date.now() - t0 };
    console.log(`lead fix observed: refused callers ${JSON.stringify(refused)}; secretary approve → ${fixed.status} ${fixed.code}; concurrent approvals → ${JSON.stringify(concurrent)}`);
  }, 300_000);

  it('CONTROL: the empty-input run gave the model nothing (so every reader below is judged on the target only)', async () => {
    expect((await snapshotOf(runId))!.items).toEqual([]);
  });

  it('CONTROL: callers refused BEFORE the binding check (no ai.proposal.approve 403, other project 404, the requester 403) leave no trace — the proposal stays proposed, no AI_APPROVAL_INVALIDATED row (the detached write runs only after authorisation)', async () => {
    expect(refused['contributor (no ai.proposal.approve)']).toBe(403);
    expect(refused['pm.b (other project)']).toBe(404);
    expect(refused['pm (the requester)']).toBe(403);
    expect(refused['after refused callers: proposal status']).toBe(1);
    expect(refused['after refused callers: AI_APPROVAL_INVALIDATED rows']).toBe(0);
  });

  it('CONTROL: an authorised approver after the target changed → 409 ai.approval_invalidated; the invalidation persists (proposal invalidated, no approval row) with ONE audit row by that approver', async () => {
    expect(fixed).toEqual({ status: 409, code: 'ai.approval_invalidated' });
    const p = await proposalRow(p1);
    expect(p).toMatchObject({ status: 'invalidated', invalidated_reason: 'target_version_changed' });
    expect((await owner().query(`select count(*)::int n from ai_action_approval where proposal_id = $1`, [p1])).rows[0].n).toBe(0);
    const a = (await owner().query(`select actor_user_id, outcome, reason from audit_event where entity_id = $1 and action = 'AI_APPROVAL_INVALIDATED'`, [p1])).rows;
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ actor_user_id: j.p.secretary.userId, outcome: 'rejected', reason: 'target_version_changed' });
  });

  it('CONTROL: two approvers at once on a changed target → both refused with 409 (no 5xx, no lock wait), proposal invalidated, nothing approved', async () => {
    expect(concurrent.statuses).toEqual([409, 409]);
    for (const c of concurrent.codes) expect(['ai.approval_invalidated', 'ai.proposal_not_pending']).toContain(c);
    expect(concurrent.ms).toBeLessThan(10_000);
    expect((await proposalRow(p2)).status).toBe('invalidated');
    expect((await owner().query(`select count(*)::int n from ai_action_approval where proposal_id = $1`, [p2])).rows[0].n).toBe(0);
  });
});

// =====================================================================================================================
describe('P4 C1 — SEC-P34R-05 re-verification: AI proposals follow the reader\'s visibility of the target and of the run inputs', () => {
  let emptyRunId: string;
  let pWs0: string;
  let pWs1: string;
  let restrictedDoc: string;
  let secRunId: string;
  let pInput: string;
  const FALCON = 'P5SECFALCON';

  beforeAll(async () => {
    emptyRunId = await emptyRun(j.p.pm, 'P5SECNOOPB');
    pWs0 = await propose(j.p.pm, emptyRunId, 'propose_internal_notification', { recipientUserId: j.p.contributor.userId, targetType: 'task', targetId: ws0Task, title: 'Reach probe WS0', body: 'Synthetic probe.' });
    pWs1 = await propose(j.p.pm, emptyRunId, 'propose_internal_notification', { recipientUserId: j.p.contributor.userId, targetType: 'task', targetId: ws1Task, title: 'Reach probe WS1', body: 'Synthetic probe.' });
    // A RESTRICTED document read by the secretary's run and sent to the (Simulated) provider (ceiling restricted).
    restrictedDoc = (await doc(j.p.sponsor, pid, 'P5SEC restricted falcon memo (synthetic)', { classification: 'restricted', kind: 'evidence', text: `Restricted memo ${FALCON}: synthetic negotiation notes.` })).id;
    await runWorker(); // documents index job
    await setAi(pid, { mode: 'assisted', max_classification_to_provider: 'restricted' });
    const r = await ok(await j.p.secretary.post(`${P(pid)}/ai/ask`, { question: `What does the ${FALCON} memo say? overdue`, locale: 'en' }));
    secRunId = r.id;
    pInput = await propose(j.p.secretary, secRunId, 'propose_internal_notification', { recipientUserId: j.p.contributor.userId, targetType: 'task', targetId: ws0Task, title: 'Input probe', body: 'Synthetic probe.' });
    await setAi(pid, { mode: 'assisted' });
  }, 300_000);

  const ids = async (c: DocClient) => {
    const l = (await c.get(`${P(pid)}/ai/proposals?pageSize=100`).expect(200)).body;
    return { ids: l.items.map((x: { id: string }) => x.id) as string[], total: l.total as number, n: l.items.length as number };
  };

  it('OBSERVED: a workstream-only lead (ai.proposal.read granted on a workstream) cannot list AI proposals at all — GET /ai/proposals → 403 (the list needs a project-level grant)', async () => {
    expect((await techLead.get(`${P(pid)}/ai/proposals?pageSize=100`)).status).toBe(403);
  });

  it('CONTROL (workstream reach): the WS0 lead cannot read the WS1 task; approve / reject of the WS1 proposal → 404 like an unknown id (the WS0 proposal, which the lead may see, is refused with 403 instead — no authority); nothing changes', async () => {
    expect((await techLead.get(`${P(pid)}/tasks/${ws1Task}`)).status).toBe(404);
    expect((await techLead.get(`${P(pid)}/tasks/${ws0Task}`)).status).toBe(200);
    const v1 = (await proposalRow(pWs1)).version;
    const v0 = (await proposalRow(pWs0)).version;
    const a1 = await techLead.post(`${P(pid)}/ai/proposals/${pWs1}/approve`, { expectedVersion: v1 });
    const r1 = await techLead.post(`${P(pid)}/ai/proposals/${pWs1}/reject`, { expectedVersion: v1, note: 'probe' });
    const a0 = await techLead.post(`${P(pid)}/ai/proposals/${pWs0}/approve`, { expectedVersion: v0 });
    const r0 = await techLead.post(`${P(pid)}/ai/proposals/${pWs0}/reject`, { expectedVersion: v0, note: 'probe' });
    console.log(`SEC-P34R-05 re-verification (reach): WS1 proposal approve ${a1.status} ${a1.body.code}, reject ${r1.status} ${r1.body.code}; WS0 proposal approve ${a0.status} ${a0.body.code}, reject ${r0.status} ${r0.body.code}`);
    expect([a1.status, r1.status]).toEqual([404, 404]);
    expect(a0.status).toBe(403);
    expect(r0.status).toBe(403);
    expect((await proposalRow(pWs1)).status).toBe('proposed');
    expect((await proposalRow(pWs0)).status).toBe('proposed');
    expect((await ids(j.p.pm)).ids).toEqual(expect.arrayContaining([pWs0, pWs1]));
  });

  it('CONTROL (run inputs): a task proposal from a run that sent a RESTRICTED document to the model is hidden from the PM (clearance confidential, refused the document) and shown to the sponsor; the PM cannot approve it (404)', async () => {
    const snap = await snapshotOf(secRunId);
    expect(snap!.items.some((i: { type: string; id: string; sentToProvider: boolean }) => i.type === 'document' && i.id === restrictedDoc && i.sentToProvider)).toBe(true);
    expect((await j.p.pm.get(`${P(pid)}/documents/${restrictedDoc}`)).status).toBe(404);
    expect((await ids(j.p.pm)).ids).not.toContain(pInput);
    expect((await ids(j.p.sponsor)).ids).toContain(pInput);
    const a = await j.p.pm.post(`${P(pid)}/ai/proposals/${pInput}/approve`, { expectedVersion: (await proposalRow(pInput)).version });
    expect(a.status).toBe(404);
    expect(JSON.stringify((await j.p.pm.get(`${P(pid)}/ai/proposals?pageSize=100`)).body)).not.toContain(FALCON);
  });
});

// =====================================================================================================================
describe('P4 C1 — SEC-P34R-07 re-verification: supersede / flag-conflict apply the link authorisation of the target', () => {
  let cpId: string;
  let cpLink: string;
  let paperId: string;
  let paperLinks: string[];

  beforeAll(async () => {
    const s = await ok(await j.p.pm.post(`${P(pid)}/signings`, { name: 'P5SEC signing (synthetic)' }));
    const c = await ok(await j.p.pm.post(`${P(pid)}/closings`, { signingId: s.id, name: 'P5SEC closing (synthetic)' }));
    cpId = (await ok(await j.p.pm.post(`${P(pid)}/closing-conditions`, { closingId: c.id, title: 'P5SEC regulatory consent (synthetic)', ownerUserId: j.p.pm.userId, blocking: true }))).id;
    cpLink = (await ok(await j.p.pm.post(`${P(pid)}/evidence`, { targetType: 'closing_condition', targetId: cpId, note: 'Consent letter reference (synthetic)' }))).id;
    paperId = (await ok(await j.p.pm.post(`${P(pid)}/decisions`, paper(j.gov.committeeId, { title: 'P5SEC paper with evidence (synthetic)' })))).id;
    paperLinks = [];
    for (const n of ['Analysis A (synthetic)', 'Analysis B (synthetic)']) paperLinks.push((await ok(await j.p.pm.post(`${P(pid)}/evidence`, { targetType: 'decision', targetId: paperId, note: n }))).id);
  }, 300_000);

  const linkStatus = async (id: string) => (await owner().query(`select status from evidence_link where id = $1`, [id])).rows[0].status;

  it('CONTROL (closing condition): Finance (reads the CP, holds documents.evidence.link, no jv.cp.manage) cannot supersede its evidence (403 evidence.target_permission); the secretary (cannot read the CP) gets 404; the link stays active; Legal (jv.cp.manage) can', async () => {
    const f = await j.p.finance.post(`${P(pid)}/evidence/${cpLink}/supersede`, { expectedVersion: 1, note: 'probe (synthetic)' });
    expect([f.status, f.body.code]).toEqual([403, 'evidence.target_permission']);
    const s = await j.p.secretary.post(`${P(pid)}/evidence/${cpLink}/supersede`, { expectedVersion: 1, note: 'probe (synthetic)' });
    expect(s.status).toBe(404);
    expect(await linkStatus(cpLink)).toBe('active');
    const l = await j.p.legal.post(`${P(pid)}/evidence/${cpLink}/supersede`, { expectedVersion: 1, note: 'probe (synthetic)' });
    expect(l.status).toBe(201);
    expect(await linkStatus(cpLink)).toBe('superseded');
  });

  it('CONTROL (draft paper, flag-conflict — the variant the fix tests do not cover): another voting member (Finance) cannot flag the requester\'s evidence as conflicting (403 governance.decision.not_requester), both links stay active; the requester can', async () => {
    const f = await j.p.finance.post(`${P(pid)}/evidence/${paperLinks[0]}/flag-conflict`, { expectedVersion: 1, withLinkId: paperLinks[1], note: 'probe (synthetic)' });
    expect([f.status, f.body.code]).toEqual([403, 'governance.decision.not_requester']);
    expect([await linkStatus(paperLinks[0]!), await linkStatus(paperLinks[1]!)]).toEqual(['active', 'active']);
    const pm = await j.p.pm.post(`${P(pid)}/evidence/${paperLinks[0]}/flag-conflict`, { expectedVersion: 1, withLinkId: paperLinks[1], note: 'probe (synthetic)' });
    expect(pm.status).toBe(201);
  });
});

// =====================================================================================================================
describe('SEC-P5-03 — the provider ceiling classifies a committee action as "internal" whatever its decision\'s classification', () => {
  const CANARY = 'P5SECHERON';
  let decisionId: string;
  let actionId: string;
  let runId: string;
  const seen: ModelRequest[] = [];

  beforeAll(async () => {
    decisionId = (await ok(await j.p.secretary.post(`${P(pid)}/decisions`, paper(j.gov.committeeId, { title: 'P5SEC restricted paper (synthetic)', classification: 'restricted' })))).id;
    actionId = (await ok(await j.p.secretary.post(`${P(pid)}/actions`, { title: `${CANARY} renegotiate the exclusivity terms (synthetic)`, decisionId, ownerUserId: j.p.secretary.userId, dueDate: plusDays(5) }))).id;
    await owner().query(`update action_item set due_date = current_date - 3 where id = $1`, [actionId]); // owner pool: the action is now overdue
    // Project ceiling "confidential" (an external gateway's hard maximum would be "internal").
    await setAi(pid, { mode: 'advisory', max_classification_to_provider: 'confidential' });
    const out = await withProvider(
      (real) => scripted(real, () => ({}), seen),
      async () => ok(await j.p.secretary.post(`${P(pid)}/ai/ask`, { question: 'Which committee actions are overdue?', locale: 'en' })),
    );
    runId = out.id;
    await setAi(pid, { mode: 'assisted' });
    const snap = await snapshotOf(runId);
    console.log(
      `SEC-P5-03 observed: action item in the run snapshot ${JSON.stringify(snap!.items.filter((i: { id: string }) => i.id === actionId))}; provider requests ${seen.length}; context items carrying the action title: ` +
        JSON.stringify(seen.flatMap((r) => r.context.filter((c) => `${c.title} ${c.text}`.includes(CANARY)).map((c) => ({ key: c.key, classification: c.classification, title: c.title })))),
    );
  }, 300_000);

  it('CONTROL: the action belongs to a RESTRICTED decision — the PM (clearance confidential) cannot open it, the secretary can; it is retrieved for the secretary\'s run', async () => {
    expect((await j.p.pm.get(`${P(pid)}/actions/${actionId}`)).status).toBe(404);
    expect((await j.p.secretary.get(`${P(pid)}/actions/${actionId}`)).status).toBe(200);
    expect(seen.length).toBe(1);
    expect((await snapshotOf(runId))!.items.some((i: { type: string; id: string }) => i.type === 'action_item' && i.id === actionId)).toBe(true);
  });

  it.fails('DEFECT SEC-P5-03: content of a restricted decision\'s action is not sent to a provider whose ceiling is confidential (derived classification = the decision\'s)', async () => {
    const leaked = seen.flatMap((r) => r.context).filter((c) => `${c.title} ${c.text}`.includes(CANARY));
    expect(leaked).toHaveLength(0);
  });
});

// =====================================================================================================================
describe('SEC-P5-05 — a stored run keeps the titles of sources the reader can no longer see (warnings are not re-checked on read)', () => {
  const TITLE = 'P5SEC-OSPREY legacy capacity memo (synthetic)';
  let docId: string;
  let runId: string;
  let before: { warnings: string[]; cited: boolean };
  let after: { status: number; body: Record<string, any> };
  let classify: number;

  beforeAll(async () => {
    // Owner pool: an AGED document (its version is 200 days old; document_version.created_at is immutable after insert, so
    // an old source can only be represented this way — the same technique as the AI evaluation fixtures).
    const c = await owner().connect();
    try {
      await c.query('begin');
      const d = await c.query<{ id: string }>(`insert into document (org_id, project_id, title, kind, classification, owner_user_id, is_demo, created_by) values ($1,$2,$3,'evidence','confidential',$4,true,$4) returning id`, [j.orgId, pid, TITLE, j.p.pm.userId]);
      const v = await c.query<{ id: string }>(
        `insert into document_version (org_id, project_id, document_id, version_no, storage_key, filename, mime_type, size_bytes, sha256, scan_status, extraction_status, uploaded_by, created_at)
         values ($1,$2,$3,1,'fixture/p5sec-osprey','osprey.txt','text/plain',90,repeat('c',64),'not_scanned','performed',$4, now() - interval '200 days') returning id`,
        [j.orgId, pid, d.rows[0]!.id, j.p.pm.userId],
      );
      await c.query(`update document set current_version_id = $2 where id = $1`, [d.rows[0]!.id, v.rows[0]!.id]);
      await c.query(`insert into document_chunk (org_id, project_id, document_id, document_version_id, classification, ordinal, text) values ($1,$2,$3,$4,'confidential',0,$5)`, [
        j.orgId,
        pid,
        d.rows[0]!.id,
        v.rows[0]!.id,
        'Legacy capacity memo OSPREYTERM: hall C cooling capacity was measured by the synthetic survey.',
      ]);
      await c.query('commit');
      docId = d.rows[0]!.id;
    } catch (e) {
      await c.query('rollback');
      throw e;
    } finally {
      c.release();
    }
    const r = await ok(await j.p.pm.post(`${P(pid)}/ai/ask`, { question: 'What does the OSPREYTERM memo say?', locale: 'en' }));
    runId = r.id;
    before = { warnings: r.output.warnings, cited: JSON.stringify(r.output.claims).includes(docId) };
    // The document is reclassified to RESTRICTED by the secretary (documents API); the PM (clearance confidential) loses it.
    const cur = (await j.p.secretary.get(`${P(pid)}/documents/${docId}`).expect(200)).body;
    classify = (await j.p.secretary.post(`${P(pid)}/documents/${docId}/classify`, { expectedVersion: cur.version, classification: 'restricted', reason: 'P5 probe: reclassified (synthetic)' })).status;
    await runWorker();
    const g = await j.p.pm.get(`${P(pid)}/ai/runs/${runId}`);
    after = { status: g.status, body: g.body };
    console.log(`SEC-P5-05 observed: warnings at run time ${JSON.stringify(before.warnings.filter((w) => w.includes('OSPREY')))}; reclassify → ${classify}; GET run after → ${after.status}; title still present: ${JSON.stringify(after.body).includes(TITLE)}; warnings now ${JSON.stringify((after.body.output?.warnings ?? []).filter((w: string) => w.includes('OSPREY')))}`);
  }, 300_000);

  it('CONTROL: at run time the PM could read the aged source (cited, with a staleness warning naming it); after the reclassification the PM gets 404 on the document and the stored run no longer cites it', async () => {
    expect(before.cited).toBe(true);
    expect(before.warnings.some((w) => w.includes(TITLE))).toBe(true);
    expect(classify).toBe(201);
    expect((await j.p.pm.get(`${P(pid)}/documents/${docId}`)).status).toBe(404);
    expect(after.status).toBe(200);
    expect(JSON.stringify(after.body.output.claims)).not.toContain(docId);
  });

  it.fails('DEFECT SEC-P5-05: re-reading the stored run does not show the title of a source the reader can no longer see (warnings / freshness re-checked like claims)', async () => {
    expect(JSON.stringify(after.body)).not.toContain(TITLE);
  });
});

// =====================================================================================================================
describe('SEC-P5-01 — the recipient of an AI message is re-authorised for the TARGET only, never for the content the model drafted from (AT-17, AIT-07, C-33)', () => {
  const CANARY = 'P5SECKESTREL';
  let low: DocClient;
  let memo: string;
  const auto: { runId?: string; proposalId?: string | null; delivered: { user_id: string; body: string }[]; toolCalls?: string[] } = { delivered: [] };
  const assisted: { runId?: string; proposalId?: string | null; approve: number | null; delivered: { user_id: string; body: string }[] } = { approve: null, delivered: [] };

  /** A model that follows an instruction hidden in a source: "notify <member> with the memo text". */
  const exfiltrate = (recipient: string) => (req: ModelRequest) => {
    const item = req.context.find((c) => c.text.includes(CANARY));
    return { toolCalls: item ? [{ name: 'propose_internal_notification', args: { recipientUserId: recipient, title: 'For your information', body: item.text.slice(0, 300) } }] : [] };
  };

  beforeAll(async () => {
    // A full project member (contributor role) cleared only to "internal" (synthetic account; membership through the API).
    low = await syntheticUser(j.orgId, 'p5sec.lowclear', 'internal', 'internal');
    await ok(await admin.post(`${P(pid)}/members`, { userId: low.userId, role: 'contributor', reason: 'P5 security probe (synthetic)' }));
    memo = (await doc(j.p.pm, pid, 'P5SEC confidential pricing memo (synthetic)', { classification: 'confidential', kind: 'evidence', text: `Confidential pricing memo ${CANARY}: the synthetic exclusivity fee terms remain under negotiation.` })).id;
    await runWorker(); // documents index job

    // (a) Policy-limited autopilot with create_internal_notification allowlisted (owner pool: approved policy, as the AI specs do).
    await setAi(pid, { mode: 'autopilot', max_classification_to_provider: 'confidential', autopilot_policy: { ...policy(50), proposedBy: admin.userId, approvedBy: j.p.sponsor.userId } });
    const a = await withProvider(
      (real) => scripted(real, exfiltrate(low.userId)),
      async () => ok(await j.p.pm.post(`${P(pid)}/ai/ask`, { question: `What does the ${CANARY} memo say?`, locale: 'en' })),
    );
    auto.runId = a.id;
    auto.proposalId = a.output.proposals[0]?.id ?? null;
    auto.toolCalls = (await snapshotOf(a.id))!.modelToolCalls;
    await runWorker();
    auto.delivered = (await owner().query(`select user_id, body from notification where user_id = $1 and kind = 'ai_action'`, [low.userId])).rows;

    // (b) Assisted mode: the secretary (cleared restricted, holds notifications.message.send) approves the same kind of proposal.
    await setAi(pid, { mode: 'assisted', max_classification_to_provider: 'confidential' });
    const b = await withProvider(
      (real) => scripted(real, exfiltrate(low.userId)),
      async () => ok(await j.p.pm.post(`${P(pid)}/ai/ask`, { question: `Summarise the ${CANARY} memo`, locale: 'en' })),
    );
    assisted.runId = b.id;
    assisted.proposalId = b.output.proposals[0]?.id ?? null;
    if (assisted.proposalId) {
      assisted.approve = (await j.p.secretary.post(`${P(pid)}/ai/proposals/${assisted.proposalId}/approve`, { expectedVersion: (await proposalRow(assisted.proposalId)).version })).status;
      await runWorker();
    }
    assisted.delivered = assisted.proposalId ? (await notes(assisted.proposalId)).map((n) => ({ user_id: n.user_id, body: n.body })) : [];
    await setAi(pid, { mode: 'assisted' });
    console.log(
      `SEC-P5-01 observed: autopilot proposal ${auto.proposalId ? (await proposalRow(auto.proposalId)).status : 'none'}; messages to the internal-cleared member carrying the confidential canary: ${auto.delivered.filter((n) => n.body.includes(CANARY)).length} ${JSON.stringify(auto.delivered.map((n) => n.body.slice(0, 90)))}; ` +
        `assisted: approve → ${assisted.approve}, delivered ${JSON.stringify(assisted.delivered.map((n) => ({ to: n.user_id === low.userId ? 'internal-cleared member' : n.user_id, body: n.body.slice(0, 90) })))}`,
    );
  }, 300_000);

  it('CONTROL: the recipient is a full project member who is refused the source (document 404; their own AI answer does not carry it); the model\'s tool call reached the runtime', async () => {
    expect((await low.get(`${P(pid)}/documents/${memo}`)).status).toBe(404);
    const own = await low.post(`${P(pid)}/ai/ask`, { question: `What does the ${CANARY} memo say?`, locale: 'en' });
    expect(own.status).toBe(201);
    expect(JSON.stringify(own.body)).not.toContain('exclusivity fee terms');
    expect(auto.toolCalls).toContain('propose_internal_notification');
  });

  it.fails('DEFECT SEC-P5-01 (policy-limited autopilot): no AI message carrying content the recipient may not read is delivered without any human review', async () => {
    expect(auto.delivered.filter((n) => n.body.includes(CANARY))).toHaveLength(0);
  });

  it.fails('DEFECT SEC-P5-01 (assisted, AIT-07): an uncleared recipient is refused before approval — the approval is not accepted and nothing carrying the content is delivered', async () => {
    expect(assisted.approve === null || assisted.approve >= 400).toBe(true);
    expect(assisted.delivered.filter((n) => n.body.includes(CANARY))).toHaveLength(0);
  });
});

// =====================================================================================================================
describe('SEC-P5-02 — an autopilot execution ignores an emergency stop (or a rejection) that lands between its checks and its effect', () => {
  let proposalId: string;
  let killStatus = 0;
  let statusAtKill = '';
  let result: Record<string, unknown> = {};

  beforeAll(async () => {
    await setAi(pid, { mode: 'autopilot', autopilot_policy: { ...policy(50), proposedBy: admin.userId, approvedBy: j.p.sponsor.userId } });
    const out = await withProvider(
      (real) => scripted(real, () => ({ toolCalls: [{ name: 'propose_internal_notification', args: { recipientUserId: j.p.contributor.userId, title: 'Reminder (P5SEC race probe)', body: 'Please update the plan (synthetic probe).' } }] })),
      async () => ok(await j.p.pm.post(`${P(pid)}/ai/ask`, { question: 'P5SECRACE overdue', locale: 'en' })),
    );
    proposalId = out.output.proposals[0].id;
    // The window between phase 1 (checks, service principal) and phase 2 (effect) of ai.execute_proposal is opened
    // deterministically: the emergency stop is activated through the API while phase 1 re-checks the recipient — i.e. after
    // phase 1 read the kill switch, before phase 2 takes its lock. Phase 1 holds no lock, so the stop commits normally.
    // The stop is issued by a continuation created HERE (outside the job's AsyncLocalStorage transaction context) and released
    // by the spy, so the API request runs in its own request context exactly as a separate user's request would.
    const { proposals } = await serviceHandles();
    const orig = proposals.recipientAllowed.bind(proposals);
    let fire!: () => void;
    const fired = new Promise<void>((r) => (fire = r));
    const stopped = (async () => {
      await fired;
      killStatus = (await j.p.pm.post(`${P(pid)}/ai/killswitch/activate`, { reason: 'P5 probe: emergency stop during an execution (synthetic)' })).status;
      statusAtKill = (await proposalRow(proposalId)).status;
    })();
    let once = false;
    const spy = vi.spyOn(proposals, 'recipientAllowed').mockImplementation(async (...args: Parameters<typeof orig>) => {
      if (!once) {
        once = true;
        fire();
        await stopped;
      }
      return orig(...args);
    });
    try {
      await runWorker();
    } finally {
      spy.mockRestore();
    }
    const row = await proposalRow(proposalId);
    result = { finalStatus: row.status, notifications: (await notes(proposalId)).length, executeAudit: (await owner().query(`select count(*)::int n from audit_event where entity_id = $1 and action = 'ai.proposal.execute'`, [proposalId])).rows[0].n };
    console.log(`SEC-P5-02 observed: kill switch → ${killStatus}; proposal status right after the stop: ${statusAtKill}; after the job: ${JSON.stringify(result)}`);
    await setAi(pid, { mode: 'assisted' }); // owner pool: release the emergency stop for the next probes (test-only reset)
  }, 300_000);

  it('CONTROL: the emergency stop was accepted and cancelled the pending proposal before the execution reached its effect', async () => {
    expect(killStatus).toBe(201);
    expect(statusAtKill).toBe('cancelled');
  });

  it.fails('DEFECT SEC-P5-02: after the emergency stop cancelled it, the autopilot proposal is not executed and nothing is sent (phase 2 re-checks the status / kill switch under its lock)', async () => {
    expect(result.finalStatus).toBe('cancelled');
    expect(result.notifications).toBe(0);
  });
});

// =====================================================================================================================
describe('SEC-P5-06 — the autopilot daily limit is counted without a lock (concurrent executors exceed it)', () => {
  let n0 = 0;
  let n1 = 0;
  let results: unknown[] = [];

  beforeAll(async () => {
    n0 = await autopilotToday();
    await setAi(pid, { mode: 'autopilot', autopilot_policy: { ...policy(n0 + 1), proposedBy: admin.userId, approvedBy: j.p.sponsor.userId } });
    const out = await withProvider(
      (real) =>
        scripted(real, () => ({
          toolCalls: [
            { name: 'propose_internal_notification', args: { recipientUserId: j.p.contributor.userId, title: 'Reminder A (P5SEC rate probe)', body: 'Synthetic probe.' } },
            { name: 'propose_internal_notification', args: { recipientUserId: j.p.legal.userId, title: 'Reminder B (P5SEC rate probe)', body: 'Synthetic probe.' } },
          ],
        })),
      async () => ok(await j.p.pm.post(`${P(pid)}/ai/ask`, { question: 'P5SECRATE overdue', locale: 'en' })),
    );
    const ids = out.output.proposals.map((p: { id: string }) => p.id);
    expect(ids).toHaveLength(2);
    // Two worker replicas each claim one of the two queued executions (owner pool: the rows are read and taken off the
    // queue; the two executions are then run at the same time through the job handler).
    const jobs = (await owner().query(`select * from job where project_id = $1 and kind = 'ai.execute_proposal' and status = 'queued' and payload->>'proposalId' = any($2::text[])`, [pid, ids])).rows as ClaimedJob[];
    expect(jobs).toHaveLength(2);
    await owner().query(`update job set status = 'cancelled', last_error = 'p5sec probe: executed directly by two concurrent executors' where id = any($1::uuid[])`, [jobs.map((x) => x.id)]);
    const { proposals } = await serviceHandles();
    const orig = proposals.recipientAllowed.bind(proposals);
    let arrived = 0;
    let open!: () => void;
    const gate = new Promise<void>((r) => (open = r));
    const spy = vi.spyOn(proposals, 'recipientAllowed').mockImplementation(async (...args: Parameters<typeof orig>) => {
      arrived++;
      if (arrived >= 2) open();
      await Promise.race([gate, new Promise((r) => setTimeout(r, 10_000))]);
      return orig(...args);
    });
    try {
      results = await Promise.all(jobs.map((jb) => proposals.executeJob(jb)));
    } finally {
      spy.mockRestore();
    }
    n1 = await autopilotToday();
    await setAi(pid, { mode: 'assisted' });
    console.log(`SEC-P5-06 observed: autopilot executions today before ${n0}, limit ${n0 + 1}, after ${n1}; results ${JSON.stringify(results)}`);
  }, 300_000);

  it.fails('DEFECT SEC-P5-06: two concurrent autopilot executions never exceed the approved daily limit', async () => {
    expect(n1).toBeLessThanOrEqual(n0 + 1);
  });
});
