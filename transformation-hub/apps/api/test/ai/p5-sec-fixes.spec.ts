import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { derivedClassification, type AiClaim } from '@hub/domain';
import { closeApp, closePools, owner } from '../helpers';
import { P, doc, login, ok, plusDays, setupJvProject, syntheticUser, type DocClient, type JvProject } from '../jv/jv-kit';
import { proposalRow, serviceHandles, setAi } from './ai-fixtures';
import { runWorker } from '../gates/gate-test-kit';
import type { ModelProvider, ModelRequest, ModelToolCall } from '../../src/modules/ai/providers/model-provider';

/**
 * P5 security fixes (docs/reviews/P5-security-review.md, "Fix status") — regressions for the paths the reviewer's probes
 * (`test/reviews/p5-sec-*.spec.ts`) do not exercise:
 *  - SEC-P5-01 at APPROVAL, at EXECUTION and at REVISION (the probes cover creation under autopilot and assisted mode);
 *  - SEC-P5-02 for a REJECTION and a REVISION landing between the execution's checks and its effect (the probe: the stop);
 *  - SEC-P5-03 for an action of a MEETING (no decision): it inherits the committee's classification;
 *  - SEC-P5-05 for executed DRAFTS (keyed to the run inputs) and for model-written PREPARED REQUESTS on a stored run;
 *  - SEC-P5-I1 (approve's detached invalidation is bound to the version it checked), -I2 (status shows the caller's own last
 *    run), -I7 (AI messages carry the platform's "AI-generated (Simulated)" marker).
 * A scripted Simulated provider (no network) stands in for a model that follows an instruction found in its sources; it is
 * installed through the registry's test hook. Owner pool: AI settings rows, clearance changes of SYNTHETIC users created
 * here, an overdue due date, and reads. One fresh JV test project, synthetic data only.
 */
let j: JvProject;
let pid: string;
let admin: DocClient;

const policy = (allowlist: string[]) => ({
  allowlist,
  maxActionsPerDay: 50,
  expiresOn: plusDays(10),
  revoked: false,
  proposedBy: null as string | null,
  approvedBy: null as string | null,
  approvedAt: new Date().toISOString(),
});

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

/** "Notify <recipient> with the text of the source carrying <canary>" — what a model following an injection returns. */
const notifyWith = (recipient: string, canary: string) => (req: ModelRequest) => {
  const item = req.context.find((c) => c.text.includes(canary));
  return { toolCalls: item ? [{ name: 'propose_internal_notification', args: { recipientUserId: recipient, title: 'For your information', body: item.text.slice(0, 300) } }] : [] };
};

const ask = async (c: DocClient, question: string) => ok(await c.post(`${P(pid)}/ai/ask`, { question, locale: 'en' }));
const notes = async (proposalId: string) => (await owner().query<{ user_id: string; title: string; body: string }>(`select user_id, title, body from notification where ai_proposal_id = $1`, [proposalId])).rows;
const auditOf = async (entityId: string, action: string) => (await owner().query(`select actor_user_id, outcome, reason from audit_event where entity_id = $1 and action = $2 order by created_at`, [entityId, action])).rows;
const setClearance = (userId: string, clearance: string) => owner().query(`update app_user set clearance = $2 where id = $1`, [userId, clearance]); // owner pool: SYNTHETIC users created here only

/** A synthetic internal user cleared `clearance`, made a full project member (contributor) through the API. */
async function member(key: string, clearance: string): Promise<DocClient> {
  const u = await syntheticUser(j.orgId, key, 'internal', clearance);
  await ok(await admin.post(`${P(pid)}/members`, { userId: u.userId, role: 'contributor', reason: 'P5 security fix tests (synthetic)' }));
  return u;
}

beforeAll(async () => {
  j = await setupJvProject('P5FIX-AI');
  pid = j.projectId;
  admin = await login('portfolio.admin');
  await setAi(pid, { mode: 'assisted', max_classification_to_provider: 'confidential' }); // owner pool: test-only AI settings (Simulated mock)
}, 600_000);

afterAll(async () => {
  await closeApp();
  await closePools();
});

// =====================================================================================================================
describe('SEC-P5-01 (fix) — the message recipient is re-authorised for the CONTENT at approval, at execution and at revision [AT-17, AIT-07, access-matrix §5.2]', () => {
  const CANARY = 'P5FIXWREN';
  const MEMO_A = 'P5FIXWRENA';
  const MEMO_B = 'P5FIXWRENB';
  let memo: string;
  let memoA: string; // reclassified above the recipient between the proposal and the approval
  let memoB: string; // reclassified above the recipient between the approval and the execution
  let cleared: DocClient; // cleared at the project's classification (confidential)
  let cleared2: DocClient;
  let ctl: DocClient;
  let low: DocClient; // cleared internal: below this confidential project (QA-P5-03)
  let pApprove: string;
  let pExecute: string;
  let approve: { status: number; code: string };
  let revise: { status: number; code: string };
  let versionBeforeRevise = 0;
  let created: { proposals: number; refused: { name: string; reason: string }[]; audit: { outcome: string; reason: string }[] };

  const reclassifyRestricted = async (id: string) => {
    const cur = (await j.p.secretary.get(`${P(pid)}/documents/${id}`).expect(200)).body;
    await ok(await j.p.secretary.post(`${P(pid)}/documents/${id}/classify`, { expectedVersion: cur.version, classification: 'restricted', reason: 'P5 fix test: reclassified above the recipient (synthetic)' }));
  };

  beforeAll(async () => {
    cleared = await member('p5fix.cleared', 'confidential');
    cleared2 = await member('p5fix.cleared2', 'confidential');
    ctl = await member('p5fix.ctl', 'confidential');
    low = await member('p5fix.low', 'internal');
    for (const id of [cleared.userId, cleared2.userId, ctl.userId]) await setClearance(id, 'confidential'); // idempotent fixture
    memo = (await doc(j.p.pm, pid, 'P5FIX confidential wren memo (synthetic)', { classification: 'confidential', kind: 'evidence', text: `Confidential memo ${CANARY}: the synthetic exclusivity terms remain under negotiation.` })).id;
    memoA = (await doc(j.p.pm, pid, 'P5FIX wren memo A (synthetic)', { classification: 'confidential', kind: 'evidence', text: `Confidential memo ${MEMO_A}: the synthetic fee schedule remains under negotiation.` })).id;
    memoB = (await doc(j.p.pm, pid, 'P5FIX wren memo B (synthetic)', { classification: 'confidential', kind: 'evidence', text: `Confidential memo ${MEMO_B}: the synthetic exit terms remain under negotiation.` })).id;
    await runWorker(); // documents index job
    // (a) Approval: created while the recipient may read memo A; memo A is reclassified to restricted (above the recipient,
    //     still readable by the approver) before the approval.
    const a = await withScript(notifyWith(cleared.userId, MEMO_A), () => ask(j.p.pm, `What does the ${MEMO_A} memo say?`));
    pApprove = a.output.proposals[0].id;
    await reclassifyRestricted(memoA);
    const ra = await j.p.secretary.post(`${P(pid)}/ai/proposals/${pApprove}/approve`, { expectedVersion: (await proposalRow(pApprove)).version });
    approve = { status: ra.status, code: ra.body.code };
    // (b) Execution: approved while the recipient may read memo B; memo B is reclassified before the worker runs.
    const b = await withScript(notifyWith(cleared2.userId, MEMO_B), () => ask(j.p.pm, `Summarise the ${MEMO_B} memo`));
    pExecute = b.output.proposals[0].id;
    await ok(await j.p.secretary.post(`${P(pid)}/ai/proposals/${pExecute}/approve`, { expectedVersion: (await proposalRow(pExecute)).version }));
    await reclassifyRestricted(memoB);
    await runWorker();
    // (c) Revision: the requester re-addresses a fresh proposal to a member cleared below the project's classification.
    const c = await withScript(notifyWith(cleared.userId, CANARY), () => ask(j.p.pm, `Explain the ${CANARY} memo`));
    const pRevise = c.output.proposals[0].id as string;
    const row = await proposalRow(pRevise);
    versionBeforeRevise = row.version;
    const rv = await j.p.pm.post(`${P(pid)}/ai/proposals/${pRevise}/revise`, { expectedVersion: row.version, payload: { ...row.payload, recipientUserId: low.userId } });
    revise = { status: rv.status, code: rv.body.code };
    expect((await proposalRow(pRevise)).version).toBe(versionBeforeRevise);
    // (d) Creation: the model addresses the memo text to that member — no proposal at all.
    const d = await withScript(notifyWith(low.userId, CANARY), () => ask(j.p.pm, `What does the ${CANARY} memo say about the terms?`));
    created = { proposals: d.output.proposals.length, refused: d.output.refusedToolCalls, audit: await auditOf(d.id, 'DESTINATION_NOT_APPROVED') };
  }, 300_000);

  it('creation: no proposal is created for a recipient who may not read the content (here a member cleared below the project\'s classification); the run reports the refusal and the audit names the recipient (id only)', async () => {
    expect(created.proposals).toBe(0);
    expect(created.refused).toEqual([expect.objectContaining({ name: 'propose_internal_notification', reason: expect.stringContaining('recipient_not_cleared_for_content') })]);
    expect(created.audit).toHaveLength(1);
    expect(created.audit[0]!.outcome).toBe('denied');
    expect(created.audit[0]!.reason).toContain(low.userId);
    expect(created.audit[0]!.reason).not.toContain(CANARY);
  });

  it('approval: a recipient who may no longer read a record the message was drafted from is refused BEFORE approval (422 ai.recipient_not_cleared); the proposal is invalidated and audited; nothing is approved or sent', async () => {
    expect((await cleared.get(`${P(pid)}/documents/${memoA}`)).status).toBe(404); // CONTROL: the source is now above the recipient
    expect(approve).toEqual({ status: 422, code: 'ai.recipient_not_cleared' });
    expect(await proposalRow(pApprove)).toMatchObject({ status: 'invalidated', invalidated_reason: 'recipient_not_cleared_for_content' });
    expect((await owner().query(`select count(*)::int n from ai_action_approval where proposal_id = $1`, [pApprove])).rows[0].n).toBe(0);
    const a = await auditOf(pApprove, 'AI_APPROVAL_INVALIDATED');
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ actor_user_id: j.p.secretary.userId, outcome: 'rejected', reason: 'recipient_not_cleared_for_content' });
    expect(await notes(pApprove)).toHaveLength(0);
  });

  it('execution: the worker re-checks the content for the recipient — an approved message whose source was reclassified above the recipient is invalidated and never sent', async () => {
    expect((await cleared2.get(`${P(pid)}/documents/${memoB}`)).status).toBe(404); // CONTROL
    expect(await proposalRow(pExecute)).toMatchObject({ status: 'invalidated', invalidated_reason: 'recipient_not_cleared_for_content' });
    expect(await notes(pExecute)).toHaveLength(0);
    expect((await auditOf(pExecute, 'AI_APPROVAL_INVALIDATED')).some((r: { reason: string }) => r.reason.startsWith('recipient_not_cleared_for_content'))).toBe(true);
    expect(await auditOf(pExecute, 'ai.proposal.execute')).toHaveLength(0);
  });

  it('revision: re-addressing the message to a member who may not read its sources is refused (422 ai.recipient_not_cleared) and changes nothing', async () => {
    expect(revise).toEqual({ status: 422, code: 'ai.recipient_not_cleared' });
  });

  it('CONTROL: a message drafted from NO record (empty run inputs) may still go to a member cleared at the project\'s classification; it carries the platform marker "AI-generated (Simulated)" (SEC-P5-I7)', async () => {
    const empty = await withScript(() => ({ toolCalls: [{ name: 'propose_internal_notification', args: { recipientUserId: ctl.userId, title: 'Reminder (P5FIX control)', body: 'Please update the plan (synthetic).' } }] }), () => ask(j.p.pm, 'P5FIXNOOP overdue'));
    expect((await owner().query(`select evidence_snapshot->'items' as items from ai_run where id = $1`, [empty.id])).rows[0].items).toEqual([]);
    const id = empty.output.proposals[0].id as string;
    expect((await j.p.secretary.post(`${P(pid)}/ai/proposals/${id}/approve`, { expectedVersion: (await proposalRow(id)).version })).status).toBe(201);
    await runWorker();
    expect((await proposalRow(id)).status).toBe('executed');
    const n = await notes(id);
    expect(n).toHaveLength(1);
    expect(n[0]).toMatchObject({ user_id: ctl.userId, title: 'AI-generated (Simulated): Reminder (P5FIX control)' });
  });
});

// =====================================================================================================================
describe('AT-17 "a document instructs the AI to send financials" (SEC-P5-01 fix): an approved figure the model saw never reaches a member without finance read access', () => {
  const CANARY = 'P5FIXHERONFIG';
  let figureId: string;
  let noFinance: DocClient;
  let out: { proposals: number; refused: { name: string; reason: string }[]; sentFigure: boolean };

  beforeAll(async () => {
    // A full project member cleared confidential, without finance.record.read (contributor role).
    noFinance = await member('p5fix.nofinance', 'confidential');
    const f = await ok(await j.p.finance.post(`${P(pid)}/financial-snapshots`, {
      kind: 'actual',
      category: 'opex',
      lineRef: 'P5FIX-1',
      label: `${CANARY} programme actual (synthetic)`,
      period: '2026-09',
      amount: { amount: '7777.0000', currency: 'SAR', unitScale: 1 },
      sourceRef: 'Synthetic source reference (P5 fix test)',
      classification: 'confidential',
    }));
    figureId = f.id;
    // Owner pool (set-up): APPROVED by two people other than the preparer (the table's check constraints); production
    // reaches this state through the validate / approve commands.
    await owner().query(
      `update financial_snapshot set validated_by = $2, validated_at = now(), validated_hash = 'p5fix-synthetic', approved_by = $3, approved_at = now(), approval_state = 'approved' where id = $1`,
      [figureId, j.p.legal.userId, j.p.sponsor.userId],
    );
    const r = await withScript(notifyWith(noFinance.userId, CANARY), () => ask(j.p.pm, 'What is the approved budget amount?'));
    const snap = (await owner().query(`select evidence_snapshot from ai_run where id = $1`, [r.id])).rows[0].evidence_snapshot;
    out = {
      proposals: r.output.proposals.length,
      refused: r.output.refusedToolCalls,
      sentFigure: (snap.items as { type: string; id: string; sentToProvider: boolean }[]).some((i) => i.type === 'financial_snapshot' && i.id === figureId && i.sentToProvider),
    };
  }, 300_000);

  it('CONTROL: the PM\'s run gave the figure to the (Simulated) model; the recipient is refused the figure by the finance module', async () => {
    expect(out.sentFigure).toBe(true);
    expect([403, 404]).toContain((await noFinance.get(`${P(pid)}/financial-snapshots/${figureId}`)).status);
  });

  it('the message carrying the figure is refused at creation (recipient_not_cleared_for_content); nothing is proposed or sent', async () => {
    expect(out.proposals).toBe(0);
    expect(out.refused).toEqual([expect.objectContaining({ name: 'propose_internal_notification', reason: expect.stringContaining('recipient_not_cleared_for_content') })]);
    expect((await owner().query(`select count(*)::int n from notification where user_id = $1`, [noFinance.userId])).rows[0].n).toBe(0);
  });
});

// =====================================================================================================================
describe('SEC-P5-02 (fix) — a rejection or a revision landing between the execution\'s checks and its effect wins; nothing is sent', () => {
  let contributor: DocClient;
  const results: Record<string, { finalStatus: string; notifications: number; executeAudit: number; version?: number }> = {};

  /** Runs the worker while `between` is executed after phase 1 read the proposal (inside its recipient check), outside the job's context. */
  async function raceWith(proposalId: string, between: () => Promise<void>) {
    const { proposals } = await serviceHandles();
    const orig = proposals.recipientAllowed.bind(proposals);
    let fire!: () => void;
    const fired = new Promise<void>((r) => (fire = r));
    const done = (async () => {
      await fired;
      await between();
    })();
    let once = false;
    const spy = vi.spyOn(proposals, 'recipientAllowed').mockImplementation(async (...args: Parameters<typeof orig>) => {
      if (!once) {
        once = true;
        fire();
        await done;
      }
      return orig(...args);
    });
    try {
      await runWorker();
    } finally {
      spy.mockRestore();
    }
    const row = await proposalRow(proposalId);
    return {
      finalStatus: row.status as string,
      notifications: (await notes(proposalId)).length,
      executeAudit: (await auditOf(proposalId, 'ai.proposal.execute')).length,
      version: row.version as number,
    };
  }

  const autopilotMessage = async (tag: string) => {
    const out = await withScript(() => ({ toolCalls: [{ name: 'propose_internal_notification', args: { recipientUserId: contributor.userId, title: `Reminder (${tag})`, body: 'Please update the plan (synthetic).' } }] }), () => ask(j.p.pm, `${tag} overdue`));
    return out.output.proposals[0].id as string;
  };

  beforeAll(async () => {
    contributor = j.p.contributor;
    await setAi(pid, { mode: 'autopilot', max_classification_to_provider: 'confidential', autopilot_policy: { ...policy(['create_internal_notification']), proposedBy: admin.userId, approvedBy: j.p.sponsor.userId } });
    const rejected = await autopilotMessage('P5FIXREJECT');
    results.reject = await raceWith(rejected, async () => {
      const r = await j.p.secretary.post(`${P(pid)}/ai/proposals/${rejected}/reject`, { expectedVersion: (await proposalRow(rejected)).version, note: 'P5 fix test: rejected during the execution (synthetic)' });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
    });
    const revised = await autopilotMessage('P5FIXREVISE');
    results.revise = await raceWith(revised, async () => {
      const row = await proposalRow(revised);
      const r = await j.p.pm.post(`${P(pid)}/ai/proposals/${revised}/revise`, { expectedVersion: row.version, payload: { ...row.payload, body: 'Revised by the requester during the execution (synthetic).' } });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
    });
    await setAi(pid, { mode: 'assisted', max_classification_to_provider: 'confidential' });
  }, 300_000);

  it('rejection between phase 1 and phase 2 → the proposal stays rejected; no notification, no execution audit', async () => {
    expect(results.reject).toMatchObject({ finalStatus: 'rejected', notifications: 0, executeAudit: 0 });
  });

  it('revision between phase 1 and phase 2 → the old payload is never sent; the revised proposal waits for a fresh review', async () => {
    expect(results.revise).toMatchObject({ finalStatus: 'proposed', notifications: 0, executeAudit: 0 });
  });
});

// =====================================================================================================================
describe('SEC-P5-03 (fix) — an action of a committee MEETING inherits the committee\'s classification for the provider ceiling', () => {
  let actionId: string;
  let committeeClassification: string;
  let item: { classification: string; sentToProvider: boolean } | undefined;

  beforeAll(async () => {
    committeeClassification = (await owner().query(`select classification::text c from committee where id = $1`, [j.gov.committeeId])).rows[0].c;
    actionId = (await ok(await j.p.secretary.post(`${P(pid)}/actions`, { title: 'P5FIXPLOVER meeting action (synthetic)', meetingId: j.gov.meetingId, ownerUserId: j.p.secretary.userId, dueDate: plusDays(5) }))).id;
    await owner().query(`update action_item set due_date = current_date - 3 where id = $1`, [actionId]); // owner pool: the action is now overdue
    await setAi(pid, { mode: 'advisory', max_classification_to_provider: 'internal' });
    const out = await ask(j.p.secretary, 'Which committee actions are overdue?');
    await setAi(pid, { mode: 'assisted', max_classification_to_provider: 'confidential' });
    item = ((await owner().query(`select evidence_snapshot->'items' as items from ai_run where id = $1`, [out.id])).rows[0].items as { type: string; id: string; classification: string; sentToProvider: boolean }[]).find((i) => i.type === 'action_item' && i.id === actionId);
  }, 300_000);

  it('the action is retrieved with the committee\'s classification (not "internal") and withheld from a provider whose ceiling is lower', async () => {
    expect(item).toBeDefined();
    expect(item!.classification).toBe(derivedClassification('internal', [committeeClassification]));
    if (committeeClassification !== 'public' && committeeClassification !== 'internal') expect(item!.sentToProvider).toBe(false);
  });
});

// =====================================================================================================================
describe('SEC-P5-05 (fix) — executed drafts and model-written prepared requests follow the reader\'s CURRENT access to the run inputs', () => {
  const LARK = 'P5FIXLARK';
  const FINCH = 'P5FIXFINCH';
  let larkDoc: string;
  let finchDoc: string;
  let draftProposal: string;
  let before: { artifact: boolean; prepared: boolean };
  let after: { artifact: boolean; prepared: boolean; sourceRefs: { type: string; id: string }[] };
  let finchRun: string;

  const artifactShown = async () => JSON.stringify((await j.p.pm.get(`${P(pid)}/ai/artifacts`).expect(200)).body).includes(draftProposal);
  const preparedShown = async () => JSON.stringify((await j.p.pm.get(`${P(pid)}/ai/runs/${finchRun}`).expect(200)).body.output.preparedRequests).includes(FINCH);
  const reclassify = async (id: string) => {
    const cur = (await j.p.secretary.get(`${P(pid)}/documents/${id}`).expect(200)).body;
    await ok(await j.p.secretary.post(`${P(pid)}/documents/${id}/classify`, { expectedVersion: cur.version, classification: 'restricted', reason: 'P5 fix test: reclassified (synthetic)' }));
  };

  beforeAll(async () => {
    larkDoc = (await doc(j.p.pm, pid, 'P5FIX lark memo (synthetic)', { classification: 'confidential', kind: 'evidence', text: `Confidential memo ${LARK}: synthetic negotiation calendar.` })).id;
    finchDoc = (await doc(j.p.pm, pid, 'P5FIX finch memo (synthetic)', { classification: 'confidential', kind: 'evidence', text: `Confidential memo ${FINCH}: synthetic consent strategy.` })).id;
    await runWorker(); // documents index job
    // An executed risk-flag DRAFT written from the lark memo (policy-limited autopilot: no human approval needed).
    await setAi(pid, { mode: 'autopilot', max_classification_to_provider: 'confidential', autopilot_policy: { ...policy(['flag_risk']), proposedBy: admin.userId, approvedBy: j.p.sponsor.userId } });
    const d = await withScript(
      (req) => {
        const it = req.context.find((c) => c.text.includes(LARK));
        return { toolCalls: it ? [{ name: 'propose_risk_flag', args: { title: 'Negotiation calendar risk (synthetic)', description: it.text.slice(0, 300) } }] : [] };
      },
      () => ask(j.p.pm, `What does the ${LARK} memo say?`),
    );
    draftProposal = d.output.proposals[0].id;
    await runWorker();
    expect((await proposalRow(draftProposal)).status).toBe('executed');
    // A model-written PREPARED REQUEST quoting the finch memo.
    await setAi(pid, { mode: 'assisted', max_classification_to_provider: 'confidential' });
    const f = await withScript(
      (req) => {
        const it = req.context.find((c) => c.text.includes(FINCH));
        return { toolCalls: it ? [{ name: 'prepare_request_for_human', args: { requestedAction: 'request', text: `Please review: ${it.text.slice(0, 200)}` } }] : [] };
      },
      () => ask(j.p.pm, `What does the ${FINCH} memo say?`),
    );
    finchRun = f.id;
    before = { artifact: await artifactShown(), prepared: await preparedShown() };
    // Both sources are reclassified above the PM's clearance (documents API, by the secretary).
    await reclassify(larkDoc);
    await reclassify(finchDoc);
    await runWorker(); // document.changed → derived-artefact invalidation
    const row = (await owner().query(`select source_refs from ai_derived_artifact where content->>'proposalId' = $1`, [draftProposal])).rows[0];
    after = { artifact: await artifactShown(), prepared: await preparedShown(), sourceRefs: row.source_refs };
  }, 300_000);

  it('CONTROL: at run time the PM saw the executed draft and the prepared request; the PM can no longer read either source', async () => {
    expect(before).toEqual({ artifact: true, prepared: true });
    for (const id of [larkDoc, finchDoc]) expect((await j.p.pm.get(`${P(pid)}/documents/${id}`)).status).toBe(404);
  });

  it('the executed draft is keyed to the run inputs (the lark memo) and is no longer served to the PM', async () => {
    expect(after.sourceRefs).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'document', id: larkDoc })]));
    expect(after.artifact).toBe(false);
  });

  it('re-reading the stored run no longer shows the model-written prepared request quoting the finch memo', async () => {
    expect(after.prepared).toBe(false);
  });
});

// =====================================================================================================================
describe('SEC-P5-I1 / SEC-P5-I2 (fix) — the detached invalidation is bound to the reviewed version; the status shows the caller\'s own last run', () => {
  let approve: { status: number; code: string };
  let proposalId: string;
  let statusOf: { pm: string | null; pmLatest: string; sponsor: string | null };

  beforeAll(async () => {
    const task = (await j.p.pm.get(`${P(pid)}/tasks?pageSize=1`).expect(200)).body.items[0] as { id: string };
    const out = await withScript(() => ({ toolCalls: [{ name: 'propose_internal_notification', args: { recipientUserId: j.p.contributor.userId, targetType: 'task', targetId: task.id, title: 'Update requested (P5FIX I1)', body: 'Please update this task (synthetic).' } }] }), () => ask(j.p.pm, 'P5FIXIONE overdue'));
    proposalId = out.output.proposals[0].id;
    const v = (await proposalRow(proposalId)).version as number;
    // The approver's binding check fails (target "missing") while a revision by the requester commits concurrently
    // (simulated: the proposal's version moves on between the approver's read and the detached invalidation).
    const { knowledge } = await serviceHandles();
    const spy = vi.spyOn(knowledge, 'targetVersion').mockImplementation(async () => {
      await owner().query(`update ai_proposal set version = version + 1 where id = $1`, [proposalId]);
      return 'missing';
    });
    try {
      const r = await j.p.secretary.post(`${P(pid)}/ai/proposals/${proposalId}/approve`, { expectedVersion: v });
      approve = { status: r.status, code: r.body.code };
    } finally {
      spy.mockRestore();
    }
    const pmStatus = (await j.p.pm.get(`${P(pid)}/ai/status`).expect(200)).body;
    const pmLatest = (await owner().query(`select id from ai_run where project_id = $1 and requested_by = $2 order by created_at desc limit 1`, [pid, j.p.pm.userId])).rows[0].id;
    const sponsorStatus = (await j.p.sponsor.get(`${P(pid)}/ai/status`).expect(200)).body;
    statusOf = { pm: pmStatus.lastRun?.id ?? null, pmLatest, sponsor: sponsorStatus.lastRun?.id ?? null };
  }, 300_000);

  it('SEC-P5-I1: the refused approval (409) does not invalidate the version that superseded the one it checked; nothing is audited as invalidated', async () => {
    expect(approve).toEqual({ status: 409, code: 'ai.approval_invalidated' });
    expect((await proposalRow(proposalId)).status).toBe('proposed');
    expect(await auditOf(proposalId, 'AI_APPROVAL_INVALIDATED')).toHaveLength(0);
  });

  it('SEC-P5-I2: GET /ai/status shows the caller\'s own last run — the PM sees theirs, the sponsor (no run here) none', async () => {
    expect(statusOf.pm).toBe(statusOf.pmLatest);
    expect(statusOf.sponsor).toBeNull();
  });
});
