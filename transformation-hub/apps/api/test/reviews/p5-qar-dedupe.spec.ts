import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { aiToolByName } from '@hub/domain';
import { closeApp, closePools, owner } from '../helpers';
import { registerJobHandlers } from '../../src/jobs';
import { WorkerService } from '../../src/platform/jobs/worker.service';
import { AiSettingsService } from '../../src/modules/ai/ai-settings.service';
import { aiPath, demoUserId, drain, ensureFixtures, fixtureUser, login, loginUserId, proposalRow, serviceHandles, setAi, type Fixtures } from '../ai/ai-fixtures';

/**
 * Independent QA RE-CHECK of P5 (docs/reviews/P5-qa-recheck.md) — QA-P5-01 (deduplication + cooldown of AI actions across
 * runs, spec §12.4, AIT-27) beyond the implementer's tests: other delegating users, other recipients, the window boundary,
 * concurrent creation and concurrent execution (two worker claims at once), and the project setting through the API.
 *
 * Proposals are created through the runtime's own tool path (`AiProposalsService.createFromTool`, as the delegating user,
 * in that user's transaction) from real runs, so the arguments (recipient / target) are controlled. Simulated provider only.
 * The owner pool is used for set-up the API does not offer (AI settings rows, fixture users, an execution time in the past)
 * and to read rows.
 */

let f: Fixtures;
let pmId: string;
let pm2Id: string;
let secretary: Awaited<ReturnType<typeof login>>;

const forgetEarlier = () => owner().query(`update ai_proposal set dedupe_key = null where project_id = $1`, [f.dcId]);
const notesOf = async (proposalId: string) => (await owner().query(`select id from notification where ai_proposal_id = $1`, [proposalId])).rowCount ?? 0;

/** A real (Simulated) run of the delegating user with no proposal of its own (an empty question). */
async function runOf(userId: string, tag: string): Promise<string> {
  const c = await loginUserId(userId);
  const r = await c.post(`${aiPath(f.dcId)}/ask`, { question: `P5QARNOOP${tag} overdue`, locale: 'en' });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.id as string;
}

type Created = { proposal?: { id: string }; refused?: true; reason?: string };
/** The runtime's path for a model tool call, in the delegating user's own transaction. */
async function propose(userId: string, runId: string, tool: string, args: Record<string, unknown>): Promise<Created> {
  const { contexts, db, proposals, app } = await serviceHandles();
  const ctx = (await contexts.forUser(userId, f.dcId))!;
  const s = await db.run(ctx, () => app.get(AiSettingsService).load(f.dcId));
  return (await db.run(ctx, () => proposals.createFromTool(ctx, f.dcId, { id: runId, requestedBy: userId }, aiToolByName(tool)!, args, s))) as Created;
}

const reminder = (recipient: string, extra: Record<string, unknown> = {}) => ({ recipientUserId: recipient, title: 'Update requested (P5QAR, synthetic)', body: 'Please update the forecast of this task.', targetType: 'task', targetId: f.overdueTaskId, ...extra });

const approve = async (id: string) => (await secretary.post(`${aiPath(f.dcId)}/proposals/${id}/approve`, { expectedVersion: (await proposalRow(id)).version })).status;

beforeAll(async () => {
  f = await ensureFixtures();
  pmId = await demoUserId('pm');
  pm2Id = await fixtureUser('p5qar-pm2', 'confidential', [{ role: 'project_manager' }]);
  await owner().query(`update app_user set clearance = 'confidential' where id = $1`, [pm2Id]);
  secretary = await login('secretary');
}, 300_000);

afterAll(async () => {
  if (f) await setAi(f.dcId, {});
  await closeApp();
  await closePools();
});

// =====================================================================================================================
describe('QA-P5-01 re-check — the dedupe key and the cooldown window [REQ-AI-028, REQ-AI-022]', () => {
  const r = {} as Record<string, unknown>;

  beforeAll(async () => {
    await forgetEarlier();
    await setAi(f.dcId, { mode: 'assisted', action_cooldown_hours: 24 });
    const owner1 = f.overdueTaskOwner;
    const other = await fixtureUser('p5qar-other-recipient', 'confidential', [{ role: 'contributor' }]);
    await owner().query(`update app_user set clearance = 'confidential' where id = $1`, [other]);
    // (1) Two DIFFERENT delegating users (the PM and a second PM) prepare the same reminder for the same owner.
    const a = await propose(pmId, await runOf(pmId, 'A'), 'propose_internal_notification', reminder(owner1));
    const b = await propose(pm2Id, await runOf(pm2Id, 'B'), 'propose_internal_notification', reminder(owner1, { title: 'Reminder: please update (P5QAR, worded differently)', body: 'The task is overdue.' }));
    // (2) CONTROL: the same target to ANOTHER recipient is a different message.
    const c = await propose(pmId, await runOf(pmId, 'C'), 'propose_internal_notification', reminder(other));
    // (3) The same target and recipient through the OTHER message action (owner update request).
    const d = await propose(pmId, await runOf(pmId, 'D'), 'propose_owner_update_request', reminder(owner1));
    // (4) No target: the same reminder worded differently.
    const e1 = await propose(pmId, await runOf(pmId, 'E1'), 'propose_internal_notification', { recipientUserId: other, title: 'Please update WS07 (P5QAR, synthetic)', body: 'Your task is overdue.' });
    const e2 = await propose(pmId, await runOf(pmId, 'E2'), 'propose_internal_notification', { recipientUserId: other, title: 'Please update WS07 (P5QAR, synthetic)', body: 'Your task is overdue!' });
    const e3 = await propose(pmId, await runOf(pmId, 'E3'), 'propose_internal_notification', { recipientUserId: other, title: 'Please update WS07 (P5QAR, synthetic)', body: 'Your task is overdue.' });
    r.differentRequesters = { first: !!a.proposal, second: b.refused ? b.reason : 'created' };
    r.otherRecipient = c.proposal ? 'created' : c.reason;
    r.otherMessageAction = d.proposal ? 'created' : d.reason;
    r.noTarget = { first: !!e1.proposal, reworded: e2.proposal ? 'created' : e2.reason, identical: e3.proposal ? 'created' : e3.reason };

    // (5) Window boundary: the first reminder is approved and executed; its execution is moved into the past.
    expect(await approve(a.proposal!.id)).toBe(201);
    await drain();
    r.firstExecuted = { status: (await proposalRow(a.proposal!.id)).status, notes: await notesOf(a.proposal!.id) };
    await owner().query(`update ai_proposal set executed_at = now() - interval '23 hours 50 minutes' where id = $1`, [a.proposal!.id]);
    const inside = await propose(pm2Id, await runOf(pm2Id, 'F'), 'propose_internal_notification', reminder(owner1));
    await owner().query(`update ai_proposal set executed_at = now() - interval '24 hours 10 minutes' where id = $1`, [a.proposal!.id]);
    const outside = await propose(pm2Id, await runOf(pm2Id, 'G'), 'propose_internal_notification', reminder(owner1));
    r.boundary = { inside: inside.refused ? inside.reason : 'created', outside: outside.proposal ? 'created' : outside.reason };
    console.log(`P5-QAR dedupe key / window: ${JSON.stringify(r)}`);
  }, 300_000);

  it('the same reminder (action, target, recipient) prepared for a DIFFERENT delegating user and worded differently is refused as a duplicate while the first awaits review', () => {
    expect(r.differentRequesters).toMatchObject({ first: true });
    expect(String((r.differentRequesters as { second: string }).second)).toContain('duplicate_within_cooldown');
  });

  it('CONTROL: the same target to another recipient is not a duplicate', () => {
    expect(r.otherRecipient).toBe('created');
  });

  it('cooldown boundary: an execution 23 h 50 min ago still refuses the twin; 24 h 10 min ago it is prepared again', () => {
    expect(r.firstExecuted).toEqual({ status: 'executed', notes: 1 });
    expect(String((r.boundary as { inside: string }).inside)).toContain('already executed within the 24-hour cooldown');
    expect((r.boundary as { outside: string }).outside).toBe('created');
  });

  it('OBSERVED: the key is per action — the same target and recipient through the other message action (owner update request) is a separate message', () => {
    expect(r.otherMessageAction).toBe('created');
  });

  it('OBSERVED: without a target only the identical payload is a duplicate (documented in the dedupe key) — a reworded twin is prepared, an identical one refused', () => {
    expect(r.noTarget).toMatchObject({ first: true, reworded: 'created' });
    expect(String((r.noTarget as { identical: string }).identical)).toContain('duplicate_within_cooldown');
  });
});

// =====================================================================================================================
describe('QA-P5-01 re-check — concurrency: two runs creating the same reminder at once, and two worker claims executing twins at once [REQ-AI-028, AT-20]', () => {
  const r = {} as Record<string, unknown>;

  beforeAll(async () => {
    // (a) Two transactions create the identical reminder at the same moment (two runs of two delegating users).
    await forgetEarlier();
    await setAi(f.dcId, { mode: 'assisted', action_cooldown_hours: 24 });
    const [runA, runB] = [await runOf(pmId, 'H'), await runOf(pm2Id, 'I')];
    const both = await Promise.all([propose(pmId, runA, 'propose_internal_notification', reminder(f.overdueTaskOwner)), propose(pm2Id, runB, 'propose_internal_notification', reminder(f.overdueTaskOwner))]);
    r.create = { created: both.filter((x) => x.proposal).length, refused: both.filter((x) => x.refused).map((x) => x.reason?.slice(0, 60)) };

    // (b) Two approved twins (prepared while deduplication was off) are executed by two worker claims at the same time.
    await forgetEarlier();
    await setAi(f.dcId, { mode: 'assisted', action_cooldown_hours: 0 });
    const p1 = await propose(pmId, await runOf(pmId, 'J'), 'propose_internal_notification', reminder(f.overdueTaskOwner));
    const p2 = await propose(pm2Id, await runOf(pm2Id, 'K'), 'propose_internal_notification', reminder(f.overdueTaskOwner));
    await setAi(f.dcId, { mode: 'assisted', action_cooldown_hours: 24 });
    await drain(); // nothing else pending (and the job handlers are registered)
    expect(await approve(p1.proposal!.id)).toBe(201);
    expect(await approve(p2.proposal!.id)).toBe(201);
    const { app } = await serviceHandles();
    registerJobHandlers(app);
    const worker = app.get(WorkerService);
    const claimed = await Promise.all([worker.runJobs(1), worker.runJobs(1)]);
    await drain();
    const rows = [await proposalRow(p1.proposal!.id), await proposalRow(p2.proposal!.id)];
    r.execute = {
      claimedInParallel: claimed,
      statuses: rows.map((x) => x.status).sort(),
      reasons: rows.map((x) => x.invalidated_reason).filter(Boolean),
      notes: (await notesOf(p1.proposal!.id)) + (await notesOf(p2.proposal!.id)),
      toOwner: (await owner().query(`select count(*)::int n from notification where ai_proposal_id = any($1::uuid[])`, [[p1.proposal!.id, p2.proposal!.id]])).rows[0].n,
    };
    console.log(`P5-QAR dedupe concurrency: ${JSON.stringify(r)}`);
  }, 300_000);

  it('concurrent creation: exactly one of the two simultaneous identical reminders is created; the other is refused as a duplicate', () => {
    expect(r.create).toMatchObject({ created: 1 });
    expect((r.create as { refused: string[] }).refused).toHaveLength(1);
    expect((r.create as { refused: string[] }).refused[0]).toContain('duplicate_within_cooldown');
  });

  it('concurrent execution: two worker claims executing approved twins at the same time deliver ONE message; the other twin is invalidated (duplicate_within_cooldown)', () => {
    expect((r.execute as { claimedInParallel: number[] }).claimedInParallel).toEqual([1, 1]);
    expect((r.execute as { statuses: string[] }).statuses).toEqual(['executed', 'invalidated']);
    expect((r.execute as { reasons: string[] }).reasons).toEqual(['duplicate_within_cooldown']);
    expect((r.execute as { notes: number }).notes).toBe(1);
  });
});

// =====================================================================================================================
describe('QA-P5-01 re-check — the cooldown is a project setting managed through the API (validation, permission, default, audit) [REQ-AI-028, REQ-AI-023]', () => {
  const r = {} as Record<string, unknown>;

  beforeAll(async () => {
    await setAi(f.dcId, { mode: 'advisory', action_cooldown_hours: 24 });
    const sp = await login('sponsor');
    const put = async (c: typeof sp, v: unknown) => {
      const s = await c.get(`${aiPath(f.dcId)}/settings`);
      const res = await c.agent.put(`${aiPath(f.dcId)}/settings`).set('x-csrf-token', c.csrf).send({ expectedVersion: s.body.version, actionCooldownHours: v, reason: 'P5 QA re-check (synthetic)' });
      return { status: res.status, code: res.body?.code ?? null, value: res.body?.actionCooldownHours ?? null };
    };
    r.minus1 = await put(sp, -1);
    r.fraction = await put(sp, 1.5);
    r.text = await put(sp, '12');
    r.over = await put(sp, 169);
    r.max = await put(sp, 168);
    r.zero = await put(sp, 0);
    r.back = await put(sp, 24);
    r.pm = await put(await login('pm'), 12);
    r.audit = (await owner().query(`select before, after from audit_event where project_id = $1 and entity_type = 'ai_project_settings' order by seq desc limit 3`, [f.dcId])).rows.map((x) => ({ before: x.before?.actionCooldownHours ?? null, after: x.after?.actionCooldownHours ?? null }));
    // The product default: a project whose AI settings row was never written after its creation (version 1; Project B is not
    // used — the AI evaluation fixtures reset its row with deduplication off), read by the portfolio administrator.
    const untouched = (await owner().query<{ project_id: string }>(`select s.project_id from ai_project_settings s join project p on p.id = s.project_id where s.version = 1 and p.org_id = $1 and p.classification in ('public', 'internal', 'confidential') order by p.created_at limit 1`, [f.orgId])).rows[0]?.project_id;
    expect(untouched, 'a project with an untouched AI settings row').toBeTruthy();
    const pa = await login('portfolio.admin');
    const gen = await pa.get(`${aiPath(untouched!)}/settings`);
    r.genDefault = { status: gen.status, value: gen.body?.actionCooldownHours ?? null };
    r.column = (await owner().query(`select column_default, is_nullable from information_schema.columns where table_name = 'ai_project_settings' and column_name = 'action_cooldown_hours'`)).rows[0];
    console.log(`P5-QAR cooldown setting: ${JSON.stringify(r)}`);
  }, 120_000);

  it('out-of-range or non-integer values are refused (400); 0 and 168 are accepted (200)', () => {
    for (const k of ['minus1', 'fraction', 'text', 'over']) expect((r[k] as { status: number }).status, k).toBe(400);
    expect(r.max).toMatchObject({ status: 200, value: 168 });
    expect(r.zero).toMatchObject({ status: 200, value: 0 });
    expect(r.back).toMatchObject({ status: 200, value: 24 });
  });

  it('only holders of ai.settings.manage may change it (the PM: 403)', () => {
    expect((r.pm as { status: number }).status).toBe(403);
  });

  it('every change is audited with before / after; the default is 24 h (schema and an untouched project)', () => {
    expect(r.audit).toEqual(expect.arrayContaining([{ before: 0, after: 24 }, { before: 168, after: 0 }]));
    expect(r.column).toEqual({ column_default: '24', is_nullable: 'NO' });
    expect(r.genDefault).toEqual({ status: 200, value: 24 });
  });
});
