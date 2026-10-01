import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { AI_STATUS_AR } from '@hub/domain';
import { closeApp, closePools, owner } from '../helpers';
import { TEST_ENV } from '../test-env';
import { aiPath, ensureFixtures, fixtureUser, loginUserId, setAi, type Fixtures } from '../ai/ai-fixtures';

/**
 * Independent QA RE-CHECK of P5 (docs/reviews/P5-qa-recheck.md) — QA-P5-02 for EVERY subscribing role, through the real
 * worker process (P5 exit criterion "scheduled briefing after the browser closes").
 *
 * Six roles of the policy matrix hold `ai.briefing.subscribe` without `ai.run.read`: contributor, workstream lead, committee
 * chair, functional approver, finance (restricted) and legal (restricted). Each subscriber (synthetic Demo user, cleared at the
 * project's classification like the demo personas; three in Arabic) subscribes through the API, logs out; the API app is
 * closed and `dist/worker.js` alone produces and delivers the briefings. Each subscriber then signs in again and opens the
 * run the notification links to, finds it in "my runs", and opens EVERY citation of the run through the owning module's API
 * (no dangling citation). Another subscriber's run stays 404.
 * The workstream lead is configured as the demo leads are (workstream_lead on WS07 + contributor in the project); a lead
 * holding ONLY the workstream-scoped grant is observed separately.
 *
 * Probe convention: DEFECT = it.fails asserting the required behaviour; OBSERVED = current behaviour; CONTROL = precondition.
 * The owner pool is used only for set-up the API does not offer (fixture users, the schedule's due time) and to read rows.
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

async function startWorker(tag: string): Promise<Worker> {
  expect(existsSync(WORKER_JS), `${WORKER_JS} (built by tsc -p tsconfig.build.json)`).toBe(true);
  const id = `p5qar-${tag}-${process.pid}-${Date.now()}`.slice(0, 60);
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

type Client = Awaited<ReturnType<typeof loginUserId>>;

/**
 * Opens a cited record through its owning module's API as the reader: 200 = it opens; anything else = a dangling citation.
 * Records without a detail route are looked up in their module's list (workstreams, status dimensions); a computation
 * (deterministic CPM result) has no record.
 */
async function openCitation(c: Client, pid: string, x: { type: string; id: string }): Promise<number> {
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
  if (detail[x.type]) return (await c.get(`${P(pid)}/${detail[x.type]}/${x.id}`)).status;
  if (x.type === 'computation') return 200;
  if (x.type === 'gate_definition') return (await c.get(`${P(pid)}/gates/${x.id}`)).status; // the gate detail is keyed by the definition id
  if (x.type === 'workstream' || x.type === 'status_dimension') {
    const r = await c.get(`${P(pid)}/${x.type === 'workstream' ? 'workstreams' : 'status-dimensions'}`);
    if (r.status !== 200) return r.status;
    const items = (r.body.items ?? r.body) as { id: string }[];
    return items.some((i) => i.id === x.id) ? 200 : 404;
  }
  return -1; // a type this probe cannot open: reported, never counted as opening
}

/** Raw enum values of the status vocabularies (an Arabic sentence must use their Arabic labels). */
const RAW_ENUMS = [...new Set(Object.values(AI_STATUS_AR).flatMap((v) => Object.keys(v)))].filter((k) => k.includes('_') || ['draft', 'blocked', 'open', 'planned', 'active', 'approved', 'failed', 'missed'].includes(k));
const rawEnumIn = (s: string) => RAW_ENUMS.filter((e) => new RegExp(`(^|[^A-Za-z_])${e}([^A-Za-z_]|$)`).test(s));

let f: Fixtures;

beforeAll(async () => {
  f = await ensureFixtures();
}, 300_000);

afterAll(async () => {
  for (const p of started) if (p.exitCode === null && p.signalCode === null) p.kill('SIGKILL');
  if (f) await setAi(f.dcId, {});
  await closeApp();
  await closePools();
});

describe('QA-P5-02 re-check — every role that may subscribe opens the briefing the WORKER PROCESS delivered to it, with every citation opening (en + ar) [REQ-AI-010, REQ-AI-001, REQ-AI-004, AT-19]', () => {
  type K = 'contributor' | 'workstream_lead' | 'committee_chair' | 'functional_approver' | 'finance_restricted' | 'legal_restricted';
  const SUBS: Record<K, { memberships: { role: string; workstreamCode?: string }[]; locale: 'en' | 'ar'; clearance: string }> = {
    contributor: { memberships: [{ role: 'contributor' }], locale: 'en', clearance: 'confidential' },
    workstream_lead: { memberships: [{ role: 'workstream_lead', workstreamCode: 'WS07' }, { role: 'contributor' }], locale: 'ar', clearance: 'confidential' },
    committee_chair: { memberships: [{ role: 'committee_chair' }], locale: 'en', clearance: 'restricted' },
    functional_approver: { memberships: [{ role: 'functional_approver' }], locale: 'ar', clearance: 'confidential' },
    finance_restricted: { memberships: [{ role: 'finance_restricted' }], locale: 'en', clearance: 'confidential' },
    legal_restricted: { memberships: [{ role: 'legal_restricted' }], locale: 'ar', clearance: 'confidential' },
  };
  const KEYS = Object.keys(SUBS) as K[];
  const S = {} as Record<K, { user: string; subscribe: number; schedule: string | null; runsTabBefore: number }>;
  type RunRow = { id: string; status: string; trigger: string; locale: string; error: string | null };
  const runs = {} as Record<K, RunRow[]>;
  const notes = {} as Record<K, { kind: string; title: string; link: string }[]>;
  const reads = {} as Record<
    K,
    { run: number; listed: boolean; otherSubscriberRun: number; citations: { key: string; status: number }[]; claims: number; rawEnums: string[]; englishTitles: string[]; outputLocale: string | null }
  >;
  let wsOnly: { subscribe: number; code: string | null; runsList: number; effectiveHasSubscribe: boolean } | null = null;
  let workerExit: number | null = null;

  beforeAll(async () => {
    await setAi(f.dcId, {}); // DEMO-DC: Advisory, Simulated mock (as seeded)
    for (const k of KEYS) {
      const u = await fixtureUser(`p5qar-sub-${k}`, SUBS[k].clearance, SUBS[k].memberships);
      await owner().query(`update app_user set locale = $2, clearance = $3 where id = $1`, [u, SUBS[k].locale, SUBS[k].clearance]); // idempotent fixture
      const c = await loginUserId(u);
      const before = await c.get(`${aiPath(f.dcId)}/runs`);
      const s = await c.post(`${aiPath(f.dcId)}/briefings`, { kind: 'daily' });
      S[k] = { user: u, subscribe: s.status, schedule: s.status === 201 ? s.body.id : null, runsTabBefore: before.status };
      await c.post('/api/v1/auth/logout', {});
    }
    // A workstream lead holding ONLY the workstream-scoped grant (no project-level role) — observed, not part of the run.
    const lead = await fixtureUser('p5qar-sub-wsonly', 'confidential', [{ role: 'workstream_lead', workstreamCode: 'WS07' }]);
    const lc = await loginUserId(lead);
    const ls = await lc.post(`${aiPath(f.dcId)}/briefings`, { kind: 'daily' });
    const me = await lc.get(`/api/v1/me`);
    const perms = (((me.body?.projects ?? []) as { projectId: string; permissions: string[] }[]).find((p) => p.projectId === f.dcId)?.permissions ?? []) as string[];
    wsOnly = { subscribe: ls.status, code: ls.body?.code ?? null, runsList: (await lc.get(`${aiPath(f.dcId)}/runs`)).status, effectiveHasSubscribe: perms.includes('ai.briefing.subscribe') };

    // Every session is gone and the API app stops: only the worker process can produce what follows.
    await closeApp();
    const scheds = KEYS.map((k) => S[k].schedule).filter((x): x is string => !!x);
    await owner().query(`update scheduled_job set next_run_at = now() - interval '1 minute' where id = any($1::uuid[])`, [scheds]);
    const since = new Date();
    const w = await startWorker('roles');
    try {
      for (const k of KEYS.filter((x) => S[x].schedule)) {
        await waitFor(`briefing of ${k} delivered by the worker process`, async () => (await owner().query(`select 1 from notification where user_id = $1 and kind = 'ai_briefing'`, [S[k].user])).rowCount, 120_000, w);
      }
      await waitFor('briefing jobs completed', async () => {
        const j = await owner().query<{ n: number }>(`select count(*)::int n from job where kind = 'ai.briefing' and split_part(idempotency_key, ':', 2) = any($1::text[]) and status = 'succeeded'`, [scheds]);
        return j.rows[0]!.n === scheds.length;
      }, 60_000, w);
    } finally {
      workerExit = await stopWorker(w);
    }
    for (const k of KEYS) {
      runs[k] = S[k].schedule ? (await owner().query<RunRow>(`select id, status, trigger, locale, error from ai_run where trigger_ref like $1`, [`schedule:${S[k].schedule}:%`])).rows : [];
      notes[k] = (await owner().query(`select kind, title, link from notification where user_id = $1 and kind = 'ai_briefing' and created_at >= $2`, [S[k].user, since])).rows;
    }

    // English template titles that have an Arabic counterpart (an Arabic run must use the Arabic one).
    const titled = (
      await owner().query<{ t: string }>(
        `select title as t from task where project_id = $1 and title_ar is not null and title_ar <> title
         union select title from milestone where project_id = $1 and title_ar is not null and title_ar <> title
         union select title from readiness_check where project_id = $1 and title_ar is not null and title_ar <> title
         union select name from workstream where project_id = $1 and name_ar is not null and name_ar <> name`,
        [f.dcId],
      )
    ).rows.map((r) => r.t);

    // The subscribers come back (new sessions): what was delivered must open, with every citation.
    for (const k of KEYS) {
      const c = await loginUserId(S[k].user);
      const run = runs[k][0];
      if (!run) {
        reads[k] = { run: 0, listed: false, otherSubscriberRun: 0, citations: [], claims: 0, rawEnums: [], englishTitles: [], outputLocale: null };
        continue;
      }
      const g = await c.get(`${aiPath(f.dcId)}/runs/${run.id}`);
      const list = await c.get(`${aiPath(f.dcId)}/runs?pageSize=100`);
      const other = KEYS.find((x) => x !== k && runs[x]?.[0]);
      const otherRun = other ? (await c.get(`${aiPath(f.dcId)}/runs/${runs[other]![0]!.id}`)).status : 0;
      const out = g.body?.output as { headline: string; claims: { text: string; citations: { type: string; id: string }[] }[]; missing: { description: string }[] } | null;
      const cits: { key: string; status: number }[] = [];
      const seen = new Set<string>();
      for (const cl of out?.claims ?? []) {
        for (const x of cl.citations) {
          const key = `${x.type}:${x.id}`;
          if (seen.has(key)) continue;
          seen.add(key);
          cits.push({ key, status: await openCitation(c, f.dcId, x) });
        }
      }
      const texts = [out?.headline ?? '', ...(out?.claims ?? []).map((x) => x.text), ...(out?.missing ?? []).map((x) => x.description)];
      reads[k] = {
        run: g.status,
        listed: ((list.body?.items ?? []) as { id: string }[]).some((r) => r.id === run.id),
        otherSubscriberRun: otherRun,
        citations: cits,
        claims: out?.claims.length ?? 0,
        rawEnums: SUBS[k].locale === 'ar' ? [...new Set(texts.flatMap(rawEnumIn))] : [],
        englishTitles: SUBS[k].locale === 'ar' ? titled.filter((t) => texts.some((x) => x.includes(t))) : [],
        outputLocale: run.locale,
      };
    }
    console.log(`P5-QAR roles: worker exit ${workerExit}; ${JSON.stringify({ S, runs, notes, reads, wsOnly })}`);
  }, 600_000);

  it('CONTROL: each of the six roles subscribed through the API (201) while cleared at the project\'s classification; the worker process exited cleanly', () => {
    for (const k of KEYS) expect(S[k].subscribe, k).toBe(201);
    expect(workerExit).toBe(0);
  });

  it('the worker process produced one succeeded scheduled briefing per subscriber, in the subscriber\'s language, and delivered one in-app notification linking to that run', () => {
    for (const k of KEYS) {
      expect(runs[k], k).toHaveLength(1);
      expect(runs[k]![0], k).toMatchObject({ status: 'succeeded', trigger: 'scheduled', locale: SUBS[k].locale });
      expect(notes[k], k).toHaveLength(1);
      expect(notes[k]![0]!.link, k).toBe(`/projects/${f.dcId}/ai/runs/${runs[k]![0]!.id}`);
    }
  });

  it('QA-P5-02: every subscribing role opens the delivered run (200), finds it in "my runs", and is refused another subscriber\'s run (404)', () => {
    for (const k of KEYS) {
      expect(reads[k]!.run, k).toBe(200);
      expect(reads[k]!.listed, k).toBe(true);
      expect(reads[k]!.otherSubscriberRun, k).toBe(404);
    }
  });

  it('no dangling citation: every record the delivered briefing cites opens for its subscriber through the owning module (incl. the workstream lead and the finance / legal roles)', () => {
    for (const k of KEYS) {
      expect(reads[k]!.claims, `${k}: the briefing has cited claims`).toBeGreaterThan(0);
      const bad = reads[k]!.citations.filter((c) => c.status !== 200);
      expect(bad, `${k}: citations that do not open`).toEqual([]);
    }
  });

  it('QA-P5-04 (Arabic subscribers): the delivered Arabic briefing uses no English template title and no raw status value', () => {
    for (const k of KEYS.filter((x) => SUBS[x].locale === 'ar')) {
      expect(reads[k]!.outputLocale, k).toBe('ar');
      expect(reads[k]!.englishTitles, `${k}: English template titles`).toEqual([]);
      expect(reads[k]!.rawEnums, `${k}: raw enum values`).toEqual([]);
    }
  });

  it('OBSERVED: a workstream lead holding ONLY the workstream-scoped grant (no project-level role) cannot subscribe — the briefing is a project-level action under the strict rule (access-matrix §2.2), although /me lists ai.briefing.subscribe for the project (the web offers the Briefings tab on it); the AI runs list answers 200 (own runs)', () => {
    expect(wsOnly!.subscribe).toBe(403);
    expect(wsOnly!.effectiveHasSubscribe).toBe(true);
    expect(wsOnly!.runsList).toBe(200);
  });
});
