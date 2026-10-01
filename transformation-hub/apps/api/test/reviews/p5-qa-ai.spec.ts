import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { closeApp, closePools, owner } from '../helpers';
import { TEST_ENV } from '../test-env';
import { aiPath, briefingProposal, demoUserId, drain, ensureFixtures, fixtureUser, login, loginUserId, proposalRow, serviceHandles, setAi, type Fixtures } from '../ai/ai-fixtures';

/**
 * Independent QA review of P5 (docs/reviews/P5-qa-review.md) — probes for the P5 exit criteria (spec §19) that the delivered
 * AT-17…AT-22 / AT-28 specs assert only in part:
 *  1. "Scheduled briefing after the browser closes": the delivered specs drive the briefing job IN-PROCESS (`drain()` calls the
 *     WorkerService methods of the test's own Nest app). Here the subscriber's session is revoked (logout), the API app is
 *     closed, and the separate worker process (`dist/worker.js`, the real entrypoint) alone produces and delivers the briefing.
 *     Its citations are then opened through the API as the subscriber (valid + permission-checked).
 *  2. AT-20 with the real worker process: (a) a crash AFTER the briefing committed (job left `running`, lease expired) → the
 *     restarted worker re-claims the job and delivers nothing twice; (b) the worker process is killed (SIGKILL) while the
 *     approved action's notification insert is in flight → nothing is committed; the restarted worker executes it exactly once;
 *     a second crash after that commit does not resend.
 *  3. §12.4 "deduplication, cooldown": the same reminder proposed by two briefings is executed twice under autopilot (DEFECT).
 *  4. §12.4 "quiet hours" through the real execution path (REQ-AI-028 names only a unit test).
 * Scenarios run in beforeAll; every DEFECT has a CONTROL so a broken set-up cannot hide behind an expected failure.
 */

const API_ROOT = join(__dirname, '..', '..');
const WORKER_JS = join(API_ROOT, 'dist', 'worker.js');
const started: ChildProcess[] = [];
const P = (pid: string) => `/api/v1/projects/${pid}`;

interface Worker {
  proc: ChildProcess;
  id: string;
  output: () => string;
  exited: Promise<number | null>;
}

async function waitFor<T>(label: string, fn: () => Promise<T | null | undefined | false>, timeoutMs = 60_000, w?: Worker): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}${w ? `\nworker output:\n${w.output().slice(-4000)}` : ''}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

/** Spawn dist/worker.js (the production worker entrypoint) and wait until it reports "worker <id> started". */
async function startWorker(tag: string): Promise<Worker> {
  expect(existsSync(WORKER_JS), `${WORKER_JS} (built by "pnpm --filter @hub/api test")`).toBe(true);
  const id = `p5qa-${tag}-${process.pid}-${Date.now()}`.slice(0, 60);
  const url = new URL(TEST_ENV.DATABASE_URL!);
  url.searchParams.set('application_name', id);
  const proc = spawn(process.execPath, [WORKER_JS], {
    cwd: API_ROOT,
    env: { ...process.env, ...TEST_ENV, DATABASE_URL: url.toString(), HUB_WORKER_ID: id, HUB_WORKER_POLL_MS: '200', HUB_LOG_LEVEL: 'info' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  started.push(proc);
  let out = '';
  proc.stdout!.on('data', (d: Buffer) => (out += d.toString()));
  proc.stderr!.on('data', (d: Buffer) => (out += d.toString()));
  const exited = new Promise<number | null>((resolve) => proc.on('exit', (code) => resolve(code)));
  const w = { proc, id, output: () => out, exited };
  await waitFor(`worker ${id} ready`, async () => out.includes(`worker ${id} started`), 60_000, w);
  return w;
}

async function stopWorker(w: Worker): Promise<number | null> {
  if (w.proc.exitCode === null && w.proc.signalCode === null) w.proc.kill('SIGTERM');
  return w.exited;
}

/** API route of a cited record (null → checked by project in the database, as at-28's assertCitationsValid). */
function citationRoute(pid: string, c: { type: string; id: string }): string | null {
  const m: Record<string, string> = {
    task: 'tasks',
    milestone: 'milestones',
    document: 'documents',
    decision: 'decisions',
    action_item: 'actions',
    closing_condition: 'closing-conditions',
    tsa_service: 'tsa-services',
    readiness_check: 'readiness-checks',
  };
  return m[c.type] ? `${P(pid)}/${m[c.type]}/${c.id}` : null;
}

const CLEARANCE_RANK: Record<string, number> = { public: 0, internal: 1, confidential: 2, restricted: 3, strictly_confidential: 4 };

let f: Fixtures;
let pmId: string;

beforeAll(async () => {
  f = await ensureFixtures();
  pmId = await demoUserId('pm');
}, 300_000);

afterAll(async () => {
  for (const p of started) if (p.exitCode === null && p.signalCode === null) p.kill('SIGKILL');
  await owner().query(`drop trigger if exists p5qa_hold_notification on notification`).catch(() => undefined);
  await owner().query(`drop function if exists p5qa_hold_notification()`).catch(() => undefined);
  await owner().query(`drop sequence if exists p5qa_hold_seq`).catch(() => undefined);
  if (f) await setAi(f.dcId, {});
  await closeApp();
  await closePools();
});

// =================================================================================================================
// 1 + 2a. Scheduled briefing produced by the worker PROCESS after the subscriber's session ended and the API stopped.

describe('P5 exit "scheduled briefing after the browser closes" — dist/worker.js alone produces and delivers it; citations open for the subscriber only [REQ-AI-001, REQ-AI-010, REQ-AI-026, REQ-AI-004, REQ-PHS-007, AT-19]', () => {
  type K = 'en' | 'ar' | 'contrib';
  const KEYS: K[] = ['en', 'ar', 'contrib'];
  // en / ar: secretary-role subscribers (they hold ai.run.read); contrib: a contributor (may subscribe, holds no ai.run.read).
  const SUBS: Record<K, { role: string; locale: 'en' | 'ar' }> = { en: { role: 'secretary_cpmo', locale: 'en' }, ar: { role: 'secretary_cpmo', locale: 'ar' }, contrib: { role: 'contributor', locale: 'en' } };
  const S = {} as Record<K, { user: string; schedule: string; meStatusAfterLogout: number; activeSessions: number; runsBeforeWorker: number }>;
  type RunRow = { id: string; status: string; trigger: string; requested_by: string; created_at: Date; locale: string; provider: string; output: { claims: { text: string; citations: { type: string; id: string }[] }[]; headline: string; disclaimer: string } | null; evidence_snapshot: { items: { type: string; id: string; classification: string }[]; cited: { type: string; id: string }[] } };
  const runs = { en: [], ar: [], contrib: [] } as Record<K, RunRow[]>;
  const notes = { en: [], ar: [], contrib: [] } as Record<K, { user_id: string; kind: string; title: string; link: string }[]>;
  let loggedOutAt = new Date();
  let workerExit: number | null = null;
  let workerLog = '';
  const reads = {} as Record<K, { runStatus: number; runCode: string | null; citations: { key: string; status: number }[]; otherSubscriber: number; projectBUser: number; listStatus: number; listed: boolean; listedTrigger: string | null }>;
  // 2a. crash after the briefing committed
  let crash: { jobBefore: unknown; jobAfter: { status: string; attempts: number; result: Record<string, unknown> | null }; runs: number; notes: number } | null = null;

  beforeAll(async () => {
    await setAi(f.dcId, {}); // DEMO-DC: Advisory, Simulated mock (as seeded)
    for (const k of KEYS) {
      // Cleared at the project's classification (DEMO-DC is confidential), like every demo persona of the project.
      const u = await fixtureUser(`p5qa-brief-${k}`, 'confidential', [{ role: SUBS[k].role }]);
      await owner().query(`update app_user set locale = $2 where id = $1`, [u, SUBS[k].locale]);
      const c = await loginUserId(u);
      const s = await c.post(`${aiPath(f.dcId)}/briefings`, { kind: 'daily' });
      expect(s.status, JSON.stringify(s.body)).toBe(201);
      const out = await c.post('/api/v1/auth/logout', {});
      expect([200, 201, 204]).toContain(out.status);
      const me = await c.get('/api/v1/me');
      const active = (await owner().query<{ n: number }>(`select count(*)::int n from session where user_id = $1 and revoked_at is null and absolute_expires_at > now()`, [u])).rows[0]!.n;
      S[k] = { user: u, schedule: s.body.id, meStatusAfterLogout: me.status, activeSessions: active, runsBeforeWorker: 0 };
    }
    // The browser session is gone and the API process stops: nothing below can come from a page or the API.
    await closeApp();
    loggedOutAt = new Date();
    await owner().query(`update scheduled_job set next_run_at = now() - interval '1 minute' where id = any($1::uuid[])`, [KEYS.map((k) => S[k].schedule)]);
    for (const k of KEYS) {
      S[k].runsBeforeWorker = (await owner().query<{ n: number }>(`select count(*)::int n from ai_run where trigger_ref like $1`, [`schedule:${S[k].schedule}:%`])).rows[0]!.n;
    }
    const w = await startWorker('brief');
    try {
      for (const k of KEYS) {
        await waitFor(
          `scheduled briefing (${k}) delivered by the worker process`,
          async () => {
            const n = await owner().query(`select 1 from notification where user_id = $1 and kind = 'ai_briefing'`, [S[k].user]);
            return (n.rowCount ?? 0) > 0;
          },
          120_000,
          w,
        );
      }
      // Let the worker finish its pass over the slots (job completion) before stopping it.
      await waitFor('briefing jobs completed', async () => {
        const j = await owner().query<{ n: number }>(`select count(*)::int n from job where kind = 'ai.briefing' and split_part(idempotency_key, ':', 2) = any($1::text[]) and status = 'succeeded'`, [KEYS.map((k) => S[k].schedule)]);
        return j.rows[0]!.n === KEYS.length;
      }, 60_000, w);
    } finally {
      workerExit = await stopWorker(w);
      workerLog = w.output();
    }
    for (const k of KEYS) {
      runs[k] = (await owner().query<RunRow>(`select id, status, trigger, requested_by, created_at, locale, provider, output, evidence_snapshot from ai_run where trigger_ref like $1`, [`schedule:${S[k].schedule}:%`])).rows;
      notes[k] = (await owner().query(`select user_id, kind, title, link from notification where project_id = $1 and created_at >= $2 and link like '%/ai/runs/%' and user_id = $3`, [f.dcId, loggedOutAt, S[k].user])).rows;
    }

    // A NEW session afterwards (the user comes back): the briefing and every citation open for the subscriber only.
    const pmB = await login('pm.b');
    for (const k of KEYS) {
      const run = runs[k][0]!;
      const c = await loginUserId(S[k].user);
      const g = await c.get(`${aiPath(f.dcId)}/runs/${run.id}`);
      const cits: { key: string; status: number }[] = [];
      // Citations of the stored run (as delivered): each must open for the subscriber through its owning module's API.
      for (const cl of run.output?.claims ?? []) {
        for (const x of cl.citations) {
          const route = citationRoute(f.dcId, x);
          let status = 0;
          if (route) status = (await c.get(route)).status;
          else if (x.type === 'computation') status = 200;
          else {
            const table = x.type === 'gate_definition' ? 'gate_definition' : x.type;
            const r = await owner().query(`select project_id from ${table} where id = $1`, [x.id]).catch(() => ({ rows: [] as { project_id: string }[] }));
            status = r.rows[0]?.project_id === f.dcId ? 200 : 404;
          }
          cits.push({ key: `${x.type}:${x.id}`, status });
        }
      }
      const other = await loginUserId(S[k === 'en' ? 'ar' : 'en'].user);
      const listRes = await c.get(`${aiPath(f.dcId)}/runs?pageSize=100`);
      const list = (listRes.body.items ?? []) as { id: string; trigger: string }[];
      reads[k] = {
        runStatus: g.status,
        runCode: g.body?.code ?? null,
        citations: cits,
        otherSubscriber: (await other.get(`${aiPath(f.dcId)}/runs/${run.id}`)).status,
        projectBUser: (await pmB.get(`${aiPath(f.dcId)}/runs/${run.id}`)).status,
        listStatus: listRes.status,
        listed: list.some((r) => r.id === run.id),
        listedTrigger: list.find((r) => r.id === run.id)?.trigger ?? null,
      };
    }
    console.log(
      `P5-QA briefing after logout: worker exit ${workerExit}; ` +
        JSON.stringify({
          subscribers: S,
          runs: Object.fromEntries(KEYS.map((k) => [k, runs[k].map((r) => ({ status: r.status, trigger: r.trigger, locale: r.locale, provider: r.provider, claims: r.output?.claims.length, headline: r.output?.headline }))])),
          notes,
          reads,
        }),
    );

    // 2a. Crash AFTER the briefing committed: the job is left `running` by a dead worker; its lease expires.
    await closeApp();
    const job = (await owner().query<{ id: string; status: string; attempts: number }>(`select id, status, attempts from job where kind = 'ai.briefing' and idempotency_key like $1`, [`schedule:${S.en.schedule}:%`])).rows[0]!;
    await owner().query(`update job set status = 'running', locked_by = 'p5qa-crashed-worker', locked_until = now() - interval '1 second', finished_at = null, result = null where id = $1`, [job.id]);
    const w2 = await startWorker('brief-replay');
    try {
      await waitFor('crashed briefing job re-claimed and completed by the restarted worker', async () => {
        const j = (await owner().query<{ status: string; attempts: number }>(`select status, attempts from job where id = $1`, [job.id])).rows[0]!;
        return j.status === 'succeeded' && j.attempts > job.attempts ? j : null;
      }, 60_000, w2);
    } finally {
      await stopWorker(w2);
    }
    const after = (await owner().query<{ status: string; attempts: number; result: Record<string, unknown> | null }>(`select status, attempts, result from job where id = $1`, [job.id])).rows[0]!;
    crash = {
      jobBefore: job,
      jobAfter: after,
      runs: (await owner().query<{ n: number }>(`select count(*)::int n from ai_run where trigger_ref like $1`, [`schedule:${S.en.schedule}:%`])).rows[0]!.n,
      notes: (await owner().query<{ n: number }>(`select count(*)::int n from notification where user_id = $1 and kind = 'ai_briefing'`, [S.en.user])).rows[0]!.n,
    };
    console.log(`P5-QA AT-20 crash after the briefing committed: ${JSON.stringify(crash)}`);
  }, 600_000);

  it('CONTROL: the subscriptions are durable schedules owned by the subscribers; their sessions were revoked (GET /me 401, 0 active sessions) and the API app was closed; no run existed for the slot before the worker started', async () => {
    for (const k of KEYS) {
      const sched = (await owner().query(`select kind, owner_user_id, enabled from scheduled_job where id = $1`, [S[k].schedule])).rows[0];
      expect(sched).toMatchObject({ kind: 'ai.briefing', owner_user_id: S[k].user, enabled: true });
      expect(S[k].meStatusAfterLogout).toBe(401);
      expect(S[k].activeSessions).toBe(0);
      expect(S[k].runsBeforeWorker).toBe(0);
    }
    expect(workerExit).toBe(0);
    expect(workerLog).toContain('worker stopping');
  });

  it('the worker process produced exactly one scheduled briefing per subscriber after the session ended (trigger "scheduled", requester = subscriber), delivered in-app to the subscriber only, labelled Simulated in the subscriber\'s language', async () => {
    for (const k of KEYS) {
      const lang = SUBS[k].locale;
      expect(runs[k]).toHaveLength(1);
      const r = runs[k][0]!;
      expect(r).toMatchObject({ status: 'succeeded', trigger: 'scheduled', requested_by: S[k].user, locale: lang, provider: 'mock' });
      expect(new Date(r.created_at).getTime()).toBeGreaterThanOrEqual(loggedOutAt.getTime() - 1000);
      expect(r.output!.claims.length).toBeGreaterThan(0);
      expect(r.output!.disclaimer).toMatch(lang === 'en' ? /SIMULATED/ : /محاكاة/);
      expect(notes[k]).toHaveLength(1);
      expect(notes[k][0]).toMatchObject({ user_id: S[k].user, kind: 'ai_briefing', link: `/projects/${f.dcId}/ai/runs/${r.id}` });
      expect(notes[k][0]!.title).toMatch(lang === 'en' ? /^AI briefing \(Simulated\)$/ : /محاكاة/);
    }
  });

  it('citations of the scheduled briefing: every factual claim is cited, every citation opens for the subscriber (200), nothing above the subscriber\'s clearance (confidential) is cited, and the run is 404 for another subscriber and for a Project-B user', async () => {
    for (const k of KEYS) {
      const r = runs[k][0]!;
      for (const cl of r.output!.claims) expect(cl.citations.length, `claim "${cl.text}"`).toBeGreaterThanOrEqual(1);
      expect(reads[k].citations.length).toBeGreaterThan(0);
      for (const c of reads[k].citations) expect(c.status, `${k}: citation ${c.key}`).toBe(200);
      const cls = new Map(r.evidence_snapshot.items.map((i) => [`${i.type}:${i.id}`, i.classification]));
      for (const c of r.evidence_snapshot.cited) expect(CLEARANCE_RANK[cls.get(`${c.type}:${c.id}`) ?? 'strictly_confidential']!, `cited ${c.type}:${c.id}`).toBeLessThanOrEqual(CLEARANCE_RANK.confidential!);
      expect(reads[k].projectBUser).toBe(404);
    }
    for (const k of ['en', 'ar'] as const) {
      expect(reads[k].runStatus).toBe(200);
      expect(reads[k].otherSubscriber).toBe(404);
      expect(reads[k].listed).toBe(true);
      expect(reads[k].listedTrigger).toBe('scheduled');
    }
  });

  it.fails('DEFECT QA-P5-02: a contributor who may subscribe to briefings can open the briefing delivered to them (the notification links to GET /ai/runs/:id, which needs ai.run.read)', async () => {
    expect(notes.contrib[0]!.link).toBe(`/projects/${f.dcId}/ai/runs/${runs.contrib[0]!.id}`);
    expect(reads.contrib.runStatus).toBe(200);
  });

  it('OBSERVED QA-P5-02: the contributor\'s own briefing run and their runs list are refused (403): the delivered briefing cannot be read through the product', async () => {
    expect(reads.contrib.runStatus).toBe(403);
    expect(reads.contrib.listStatus).toBe(403);
  });

  it('AT-20 (worker process): a crash after the briefing committed (job left running, lease expired) → the restarted worker re-claims the job and finds the slot already ran: one run, one notification', async () => {
    expect(crash).not.toBeNull();
    expect(crash!.jobAfter.status).toBe('succeeded');
    expect(crash!.jobAfter.result).toMatchObject({ status: 'already_ran' });
    expect(crash!.runs).toBe(1);
    expect(crash!.notes).toBe(1);
  });
});

// =================================================================================================================
// 2b. The worker process is killed while the approved action's notification insert is in flight.

describe('AT-20 with the real worker process — killed (SIGKILL) during the notification insert of an approved action: nothing committed; the restarted worker executes it exactly once; a crash after that commit does not resend [REQ-AI-028, AIT-19]', () => {
  let proposalId = '';
  let jobId = '';
  let atKill: { notes: number; proposal: string; job: { status: string; attempts: number } } | null = null;
  let afterRestart: { notes: number; proposal: string; job: { status: string; attempts: number; result: Record<string, unknown> | null } } | null = null;
  let afterSecondCrash: { notes: number; job: { status: string; attempts: number; result: Record<string, unknown> | null } } | null = null;
  let killedExit: { code: number | null; signal: string | null } | null = null;

  beforeAll(async () => {
    await setAi(f.dcId, { mode: 'assisted' });
    ({ proposalId } = await briefingProposal(pmId, f.dcId));
    const sec = await login('secretary');
    const p0 = await proposalRow(proposalId);
    const a = await sec.post(`${aiPath(f.dcId)}/proposals/${proposalId}/approve`, { expectedVersion: p0.version });
    expect(a.status, JSON.stringify(a.body)).toBe(201);
    jobId = (await owner().query<{ id: string }>(`select id from job where kind = 'ai.execute_proposal' and payload->>'proposalId' = $1`, [proposalId])).rows[0]!.id;
    await closeApp();

    // Hold the notification insert of THIS proposal (first attempt only) so the process can be killed mid-transaction.
    await owner().query(`create sequence p5qa_hold_seq; grant usage on sequence p5qa_hold_seq to hub_app`);
    await owner().query(`create or replace function p5qa_hold_notification() returns trigger language plpgsql as $$ begin
        if new.ai_proposal_id = '${proposalId}'::uuid then
          if nextval('p5qa_hold_seq') = 1 then perform pg_sleep(12); end if;
        end if;
        return new; end $$`);
    await owner().query(`create trigger p5qa_hold_notification before insert on notification for each row execute function p5qa_hold_notification()`);
    const w = await startWorker('exec-kill');
    try {
      // nextval() is not transactional: the sequence shows the trigger was reached while the insert is still held.
      await waitFor('the worker is inside the notification insert', async () => {
        const r = await owner().query<{ is_called: boolean }>(`select is_called from p5qa_hold_seq`);
        return r.rows[0]?.is_called === true;
      }, 90_000, w);
      await new Promise((r) => setTimeout(r, 500));
      w.proc.kill('SIGKILL');
      await w.exited;
      killedExit = { code: w.proc.exitCode, signal: w.proc.signalCode };
      // The orphaned backend finishes its sleep, finds the client gone and rolls the transaction back.
      await waitFor('the killed worker\'s backend is gone', async () => {
        const r = await owner().query(`select 1 from pg_stat_activity where application_name = $1`, [w.id]);
        return (r.rowCount ?? 0) === 0;
      }, 60_000);
    } finally {
      await owner().query(`drop trigger if exists p5qa_hold_notification on notification`);
      await owner().query(`drop function if exists p5qa_hold_notification(); drop sequence if exists p5qa_hold_seq`);
    }
    const st = async () => ({
      notes: (await owner().query<{ n: number }>(`select count(*)::int n from notification where ai_proposal_id = $1`, [proposalId])).rows[0]!.n,
      proposal: (await proposalRow(proposalId)).status as string,
      job: (await owner().query<{ status: string; attempts: number; result: Record<string, unknown> | null }>(`select status, attempts, result from job where id = $1`, [jobId])).rows[0]!,
    });
    atKill = await st();
    // The lease of the dead worker expires (time passes): the job becomes claimable again.
    await owner().query(`update job set locked_until = now() - interval '1 second' where id = $1 and status = 'running'`, [jobId]);
    const w2 = await startWorker('exec-restart');
    try {
      await waitFor('the restarted worker executed the approved action', async () => ((await st()).job.status === 'succeeded' ? true : null), 90_000, w2);
      afterRestart = await st();
      // A second crash, this time AFTER the effect committed (job left running, lease expired) → re-claimed, not resent.
      await owner().query(`update job set status = 'running', locked_by = 'p5qa-crashed-worker', locked_until = now() - interval '1 second', finished_at = null, result = null where id = $1`, [jobId]);
      await waitFor('the re-claimed job completed', async () => {
        const s = await st();
        return s.job.status === 'succeeded' && s.job.attempts > afterRestart!.job.attempts ? true : null;
      }, 60_000, w2);
      const s = await st();
      afterSecondCrash = { notes: s.notes, job: s.job };
    } finally {
      await stopWorker(w2);
    }
    console.log(`P5-QA AT-20 worker killed mid-insert: ${JSON.stringify({ killedExit, atKill, afterRestart, afterSecondCrash })}`);
  }, 600_000);

  it('CONTROL: the worker process was killed by SIGKILL while the execution transaction was open; nothing was committed (0 notifications, proposal still approved, job still running)', async () => {
    expect(killedExit).toEqual({ code: null, signal: 'SIGKILL' });
    expect(atKill).toMatchObject({ notes: 0, proposal: 'approved', job: { status: 'running', attempts: 1 } });
  });

  it('the restarted worker re-claims the job and executes the action exactly once', async () => {
    expect(afterRestart).toMatchObject({ notes: 1, proposal: 'executed', job: { status: 'succeeded', attempts: 2 } });
    expect(afterRestart!.job.result).toMatchObject({ status: 'executed' });
  });

  it('a crash after the effect committed (job re-claimed) does not resend: still one notification, the job reports already_executed', async () => {
    expect(afterSecondCrash!.notes).toBe(1);
    expect(afterSecondCrash!.job.result).toMatchObject({ status: 'already_executed' });
  });
});

// =================================================================================================================
// 2c. Citations "open only for authorized users" (§12.1): the AI channel against the owning module's read rule.

describe('§12.1 "citations open only for authorized users" — a project member cleared below the project\'s classification: the planning module refuses the plan, the AI answers, briefings and rules-only detections disclose it [REQ-AI-006, REQ-AI-004, REQ-AI-011, AT-03]', () => {
  let r: {
    projectClassification: string;
    userClearance: string;
    project: number;
    task: number;
    taskList: number;
    ask: { status: number; taskCited: boolean; titleShown: boolean; claims: number };
    briefing: { status: string; taskCited: boolean; titleShown: boolean };
    detections: { status: number; taskListed: boolean };
    citationOpen: number;
    controlPm: { task: number; askCites: boolean };
    provisioned: { create: number; clearance: string; grant: number; grantCode: string | null };
  } | null = null;

  beforeAll(async () => {
    await setAi(f.dcId, {});
    // The configuration is reachable through the product: a newly provisioned user gets the default clearance "internal"
    // (higher clearances need a separate grant) and can be given a contributor role in the confidential project.
    const platformAdmin = await login('platform.admin');
    const created = await platformAdmin.post('/api/v1/admin/users', { email: `qa-p5-provisioned-${Date.now()}@example.invalid`, displayName: 'QA P5 provisioned probe user (synthetic)' });
    const portfolioAdmin = await login('portfolio.admin');
    const granted = created.status === 201 ? await portfolioAdmin.post(`${P(f.dcId)}/members`, { userId: created.body.id, role: 'contributor', reason: 'QA P5 probe: role granted before any clearance grant (synthetic)' }) : null;
    const provisioned = { create: created.status, clearance: created.body?.clearance ?? null, grant: granted?.status ?? 0, grantCode: granted?.body?.code ?? null };
    // The same configuration as a demo-login-capable synthetic user (non-demo users cannot use the demo login).
    const u = await fixtureUser('p5qa-below-classification', 'internal', [{ role: 'contributor' }]);
    const task = (await owner().query<{ title: string; wbs_code: string }>(`select title, wbs_code from task where id = $1`, [f.overdueTaskId])).rows[0]!;
    const c = await loginUserId(u);
    const q = 'Which tasks are overdue and who owns them?';
    const a = await c.post(`${aiPath(f.dcId)}/ask`, { question: q, locale: 'en' });
    const cited = (o: { claims?: { citations: { type: string; id: string }[] }[] } | null | undefined) => !!o?.claims?.some((cl) => cl.citations.some((x) => x.type === 'task' && x.id === f.overdueTaskId));
    const { contexts, db, runtime } = await serviceHandles();
    const ctx = (await contexts.forUser(u, f.dcId))!;
    // Set-up adjusted by the implementer for the QA-P5-03 fix: the briefing of a member who may not see the project is now
    // refused (404, like the planning module) — recorded instead of failing the set-up.
    const b = await db.run(ctx, () => runtime.runBriefingNow(ctx, f.dcId)).catch((e: { getStatus?: () => number; status?: number }) => ({ status: `refused ${e.getStatus?.() ?? e.status ?? 'error'}`, output: null }));
    const d = await c.get(`${aiPath(f.dcId)}/detections`);
    const pm = await login('pm');
    const pmAsk = await pm.post(`${aiPath(f.dcId)}/ask`, { question: q, locale: 'en' });
    r = {
      projectClassification: (await owner().query<{ classification: string }>(`select classification from project where id = $1`, [f.dcId])).rows[0]!.classification,
      userClearance: 'internal',
      project: (await c.get(`/api/v1/projects/${f.dcId}`)).status,
      task: (await c.get(`${P(f.dcId)}/tasks/${f.overdueTaskId}`)).status,
      taskList: (await c.get(`${P(f.dcId)}/tasks`)).status,
      ask: { status: a.status, taskCited: cited(a.body.output), titleShown: JSON.stringify(a.body.output ?? {}).includes(task.title), claims: a.body.output?.claims?.length ?? 0 },
      briefing: { status: b.status, taskCited: cited(b.output as never), titleShown: JSON.stringify(b.output ?? {}).includes(task.title) },
      detections: { status: d.status, taskListed: JSON.stringify(d.body ?? {}).includes(f.overdueTaskId) },
      citationOpen: (await c.get(`${P(f.dcId)}/tasks/${f.overdueTaskId}`)).status,
      controlPm: { task: (await pm.get(`${P(f.dcId)}/tasks/${f.overdueTaskId}`)).status, askCites: cited(pmAsk.body.output) },
      provisioned,
    };
    console.log(`QA-P5-03 member cleared below the project classification (task ${task.wbs_code} "${task.title}"): ${JSON.stringify(r)}`);
  }, 300_000);

  it('CONTROL: DEMO-DC is confidential and the member is cleared internal; the portfolio and the planning module refuse the member the project, the task and the task list (404); the PM (cleared confidential) reads the task and the AI cites it for the PM', async () => {
    expect(r!.projectClassification).toBe('confidential');
    expect(r!.project).toBe(404);
    expect(r!.task).toBe(404);
    expect(r!.taskList).toBe(404);
    expect(r!.controlPm).toEqual({ task: 200, askCites: true });
  });

  it('CONTROL: the configuration is reachable through the product API — a user provisioned by the platform admin (default clearance internal) is granted a contributor role in the confidential project (201)', async () => {
    expect(r!.provisioned).toMatchObject({ create: 201, clearance: 'internal', grant: 201 });
  });

  it('QA-P5-03 (fixed, regression) (ask): the AI answer does not cite or disclose a task the member may not read in the planning module', async () => {
    // The fix answers 404 like the project / plan / task routes (the review's recommendation); the probe expected the ask to
    // run (201) — the one assertion changed by the implementer, recorded in the review's Fix status.
    expect(r!.ask.status).toBe(404);
    expect(r!.ask.taskCited).toBe(false);
    expect(r!.ask.titleShown).toBe(false);
  });

  it('QA-P5-03 (fixed, regression) (briefing): the member\'s briefing does not cite or disclose the task', async () => {
    expect(r!.briefing.taskCited).toBe(false);
    expect(r!.briefing.titleShown).toBe(false);
  });

  it('QA-P5-03 (fixed, regression) (rules-only detections): GET …/ai/detections refuses the member like the planning module (404), or lists no record the member cannot read', async () => {
    expect(r!.detections.status === 404 || !r!.detections.taskListed).toBe(true);
  });

  it('QA-P5-03 (fixed, regression; formerly OBSERVED — it pinned the disclosure): nothing of the plan is cited for the member, and the task would not open for them (GET task → 404)', async () => {
    expect(r!.ask.taskCited || r!.briefing.taskCited).toBe(false);
    expect(r!.citationOpen).toBe(404);
  });
});

// =================================================================================================================
// 3. §12.4 deduplication / cooldown of AI actions across runs.

describe('§12.4 "deduplication, cooldown" (AIT-27) — the same reminder prepared by two briefings of one day is delivered twice under policy-limited autopilot [REQ-AI-028, REQ-AI-022]', () => {
  let first: { proposalId: string } = { proposalId: '' };
  let second: { proposalId: string } = { proposalId: '' };
  let rows: { id: string; status: string; mode: string | null; target_id: string | null; recipient: string; title: string; body: string; payload_hash: string }[] = [];
  let delivered: { title: string; body: string }[] = [];
  let pendingDuplicates = 0;

  beforeAll(async () => {
    const expires = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    const sponsor = await demoUserId('sponsor');
    const admin = await demoUserId('portfolio.admin');
    // Start of day for the daily limit (as DUP-05 does): earlier autopilot executions of this test database are not counted.
    await owner().query(`update ai_proposal set execution_result = jsonb_set(execution_result, '{mode}', '"approved"') where project_id = $1 and execution_result->>'mode' = 'autopilot'`, [f.dcId]);
    await setAi(f.dcId, { mode: 'autopilot', autopilot_policy: { allowlist: ['create_internal_notification'], maxActionsPerDay: 10, expiresOn: expires, revoked: false, proposedBy: admin, approvedBy: sponsor, approvedAt: new Date().toISOString() } });
    const since = new Date(Date.now() - 1000);
    // The PM's daily briefing and, the same morning, the PM's weekly summary (two subscriptions are allowed) — run as the worker would.
    first = await briefingProposal(pmId, f.dcId);
    const { contexts, db, runtime } = await serviceHandles();
    const ctx = (await contexts.forUser(pmId, f.dcId))!;
    const weekly = await db.run(ctx, () => runtime.runBriefingNow(ctx, f.dcId, 'weekly', 'scheduled'));
    second = { proposalId: weekly.output!.proposals[0]!.id };
    await drain();
    rows = (
      await owner().query(
        `select id, status, execution_result->>'mode' as mode, target_id, payload->>'recipientUserId' as recipient, payload->>'title' as title, payload->>'body' as body, payload_hash from ai_proposal where id = any($1::uuid[]) order by created_at`,
        [[first.proposalId, second.proposalId]],
      )
    ).rows;
    delivered = (await owner().query(`select title, body from notification where user_id = $1 and kind = 'ai_action' and created_at >= $2 and source_id = $3`, [rows[0]?.recipient, since, rows[0]?.target_id])).rows;
    // Assisted mode: the same reminder is prepared again by every briefing while an identical one awaits review.
    await setAi(f.dcId, { mode: 'assisted' });
    const a = await briefingProposal(pmId, f.dcId);
    const b = await briefingProposal(pmId, f.dcId);
    const pa = await proposalRow(a.proposalId);
    const pb = await proposalRow(b.proposalId);
    pendingDuplicates = pa.status === 'proposed' && pb.status === 'proposed' && pa.payload_hash === pb.payload_hash ? 2 : 0;
    console.log(`QA-P5 dedupe: autopilot proposals ${JSON.stringify(rows.map((r) => ({ status: r.status, mode: r.mode, target: r.target_id, recipient: r.recipient, title: r.title, hash: r.payload_hash.slice(0, 12) })))}; notifications delivered to the owner for the same target: ${delivered.length} ${JSON.stringify(delivered.map((d) => d.title))}; assisted: identical pending proposals ${pendingDuplicates}`);
    await setAi(f.dcId, {});
  }, 300_000);

  it('CONTROL: two separate runs proposed the identical reminder (same target, recipient, title, body and payload hash) and both were executed by autopilot within the daily limit', async () => {
    expect(rows).toHaveLength(2);
    expect(rows[0]!.payload_hash).toBe(rows[1]!.payload_hash);
    expect(rows[0]).toMatchObject({ status: 'executed', mode: 'autopilot', target_id: f.overdueTaskId, recipient: f.overdueTaskOwner });
    expect(rows[1]).toMatchObject({ status: 'executed', mode: 'autopilot', target_id: f.overdueTaskId, recipient: f.overdueTaskOwner });
  });

  it.fails('DEFECT QA-P5-01: the owner receives the identical AI reminder for the same record only once per cooldown window (deduplication / cooldown, spec §12.4, AIT-27)', async () => {
    expect(delivered).toHaveLength(1);
  });

  it('OBSERVED QA-P5-01: in assisted mode every briefing prepares the identical reminder again while an identical one awaits review (2 pending proposals with one payload hash)', async () => {
    expect(pendingDuplicates).toBe(2);
  });
});

// =================================================================================================================
// 4. Quiet hours through the real execution path (REQ-AI-028 cites only a unit test of the hour window).

describe('§12.4 quiet hours — an approved AI message due inside the project\'s quiet hours is deferred to the end of the window, not sent and not dropped [REQ-AI-028]', () => {
  let proposalId = '';
  let result: { status: string; notes: number; deferred: { run_at: Date; status: string }[]; hourNow: number; window: [number, number] } | null = null;

  beforeAll(async () => {
    // The project's local hour now (Asia/Riyadh) and a two-hour quiet window that contains it.
    const tz = (await owner().query<{ timezone: string }>(`select timezone from project where id = $1`, [f.dcId])).rows[0]!.timezone;
    const h = Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: tz }).format(new Date())) % 24;
    const window: [number, number] = [h, (h + 2) % 24];
    await setAi(f.dcId, { mode: 'assisted', quiet_hours_start: window[0], quiet_hours_end: window[1] });
    ({ proposalId } = await briefingProposal(pmId, f.dcId));
    const sec = await login('secretary');
    const p0 = await proposalRow(proposalId);
    const a = await sec.post(`${aiPath(f.dcId)}/proposals/${proposalId}/approve`, { expectedVersion: p0.version });
    expect(a.status, JSON.stringify(a.body)).toBe(201);
    await drain();
    result = {
      status: (await proposalRow(proposalId)).status,
      notes: (await owner().query<{ n: number }>(`select count(*)::int n from notification where ai_proposal_id = $1`, [proposalId])).rows[0]!.n,
      deferred: (await owner().query(`select run_at, status from job where kind = 'ai.execute_proposal' and payload->>'proposalId' = $1 and idempotency_key like '%:deferred:%'`, [proposalId])).rows,
      hourNow: h,
      window,
    };
    console.log(`QA-P5 quiet hours: ${JSON.stringify(result)}`);
    await setAi(f.dcId, {});
  }, 300_000);

  it('CONTROL + behaviour: nothing is sent now, the proposal stays approved, and one deferred execution is queued for the end of the quiet window', async () => {
    expect(result!.status).toBe('approved');
    expect(result!.notes).toBe(0);
    expect(result!.deferred).toHaveLength(1);
    expect(result!.deferred[0]!.status).toBe('queued');
    const delayH = (new Date(result!.deferred[0]!.run_at).getTime() - Date.now()) / 3_600_000;
    expect(delayH).toBeGreaterThan(0.5);
    expect(delayH).toBeLessThanOrEqual(2.01);
  });
});
