import { afterAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { createApp } from '../../src/bootstrap';
import { closeApp, closePools, demoUserId, getApp, loginAs, owner } from '../helpers';
import { TEST_ENV } from '../test-env';
import { cookieValue } from './closure-kit';

/**
 * P1 closure — the separate worker process (dist/worker.js, the real entrypoint) consumes the transactional outbox, and
 * records survive a restart of the API and of the worker. The API app used by these tests never runs the worker loop,
 * so any dispatch observed here was done by the child process.
 */
const API_ROOT = join(__dirname, '..', '..');
const WORKER_JS = join(API_ROOT, 'dist', 'worker.js');
const started: ChildProcess[] = [];

interface Worker {
  proc: ChildProcess;
  id: string;
  output: () => string;
  exited: Promise<number | null>;
}

/** Spawn dist/worker.js and wait until it reports "worker <id> started" (handlers + SIGTERM handler installed). */
async function startWorker(tag: string): Promise<Worker> {
  expect(existsSync(WORKER_JS), `${WORKER_JS} (built by "pnpm --filter @hub/api test")`).toBe(true);
  const id = `p1c-${tag}-${process.pid}-${Date.now()}`;
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
  await waitFor(`worker ${id} ready`, async () => out.includes(`worker ${id} started`), 30_000, w);
  return w;
}

/** Graceful stop (SIGTERM → drain → exit 0), exactly like a container stop. Only processes started by this spec. */
async function stopWorker(w: Worker): Promise<number | null> {
  if (w.proc.exitCode === null && w.proc.signalCode === null) w.proc.kill('SIGTERM');
  return w.exited;
}

async function waitFor<T>(label: string, fn: () => Promise<T | null | undefined | false>, timeoutMs = 30_000, w?: Worker): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}${w ? `\nworker output:\n${w.output()}` : ''}`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

async function outboxOf(aggregateId: string) {
  return (
    await owner().query<{ id: string; type: string; dispatched_at: Date | null }>('select id, type, dispatched_at from outbox_event where aggregate_id = $1 order by created_at', [aggregateId])
  ).rows;
}

async function outboxOfProject(projectId: string) {
  return (
    await owner().query<{ id: string; type: string; dispatched_at: Date | null }>('select id, type, dispatched_at from outbox_event where project_id = $1 order by created_at', [projectId])
  ).rows;
}

async function jobsOfEvent(eventId: string) {
  return (
    await owner().query<{ id: string; kind: string; status: string; attempts: number; last_error: string | null }>(
      `select id, kind, status::text, attempts, last_error from job where idempotency_key like 'outbox:' || $1 || ':%' order by kind`,
      [eventId],
    )
  ).rows;
}

const STORED_PROJECT_FIELDS = ['id', 'code', 'name', 'status', 'classification', 'isDemo', 'templateKey', 'templateVersionNo', 'description', 'objective', 'timezone', 'workingDays', 'plannedStart', 'version', 'entities'] as const; // setupState.gaps* is recomputed (derived)
function stored(p: Record<string, unknown>) {
  return Object.fromEntries(STORED_PROJECT_FIELDS.map((k) => [k, p[k]]));
}

async function createProjectViaApi(code: string): Promise<string> {
  const admin = await loginAs('portfolio.admin');
  const templates = (await admin.get('/api/v1/templates').expect(200)).body.items as { id: string; templateKey: string }[];
  const tpl = templates.find((t) => t.templateKey === 'general-transformation')!;
  const r = await admin.post('/api/v1/projects', { templateVersionId: tpl.id, code, name: `${code} — worker/restart probe (synthetic)`, projectManagerUserId: await demoUserId('pm') });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.id as string;
}

afterAll(async () => {
  for (const p of started) if (p.exitCode === null && p.signalCode === null) p.kill('SIGKILL');
  await closeApp();
  await closePools();
});

describe('P1 closure — ARC-004: the separate worker process consumes the outbox independently of the API process [REQ-ARC-004, ADR-0004]', () => {
  it('an outbox event written by an API mutation stays pending until dist/worker.js (a separate process, runtime DB role) dispatches it and runs the subscribed job', async () => {
    const projectId = await createProjectViaApi('P1C-ARC004');
    const [event] = (await outboxOf(projectId)).filter((e) => e.type === 'permission.changed');
    expect(event, 'project creation writes a permission.changed outbox event in its transaction').toBeTruthy();

    // The API process has no worker loop: the event is not consumed while no worker runs. Stop the API entirely, so
    // the only process that can consume it is the worker.
    await new Promise((r) => setTimeout(r, 1000));
    expect((await outboxOf(projectId)).find((e) => e.id === event!.id)!.dispatched_at).toBeNull();
    await closeApp();

    const w = await startWorker('arc004');
    try {
      expect(w.proc.pid).toBeTruthy();
      expect(w.proc.pid).not.toBe(process.pid);
      const dispatched = await waitFor('outbox event dispatched by the worker process', async () => (await outboxOf(projectId)).find((e) => e.id === event!.id && e.dispatched_at), 30_000, w);
      expect(dispatched.dispatched_at).toBeInstanceOf(Date);
      const jobs = await waitFor('subscribed job succeeded', async () => {
        const j = await jobsOfEvent(event!.id);
        return j.length > 0 && j.every((x) => x.status === 'succeeded') ? j : null;
      }, 30_000, w);
      expect(jobs.map((j) => j.kind)).toContain('ai.invalidate_derived');
      expect(jobs.every((j) => j.attempts === 1 && j.last_error === null)).toBe(true);
      expect(w.output()).toContain(`worker ${w.id} started`);
      // Least privilege: the worker connects as the non-owner runtime role (hub_app), not the owner or a superuser.
      const conn = await owner().query<{ usename: string; rolsuper: boolean; rolbypassrls: boolean }>(
        `select a.usename, r.rolsuper, r.rolbypassrls from pg_stat_activity a join pg_roles r on r.rolname = a.usename where a.application_name = $1 limit 1`,
        [w.id],
      );
      expect(conn.rows[0]).toEqual({ usename: 'hub_app', rolsuper: false, rolbypassrls: false });
      expect(w.output()).not.toMatch(/SECURITY WARNING/);
    } finally {
      expect(await stopWorker(w)).toBe(0);
    }
    expect(w.output()).toContain('worker stopping');
  });
});

describe('P1 closure — PLT-002: records survive an API restart and a worker restart (server-side persistence) [REQ-PLT-002]', () => {
  it('a record written before the restarts reads back identically afterwards (same session), and the restarted worker resumes without re-processing', async () => {
    // 1. API instance #1: create a project, edit it and add a risk as the PM.
    const projectId = await createProjectViaApi('P1C-PLT002');
    const pmId = await demoUserId('pm'); // resolved first: supertest closes its shared server after the last settled request
    const contributorId = await demoUserId('contributor');
    let pendingAfterRestart: string[] = [];
    const app1 = await getApp();
    const agent1 = request.agent(app1.getHttpServer());
    const login = await agent1.post('/api/v1/auth/demo-login').send({ userId: pmId }).expect(201);
    const csrf = login.body.csrfToken as string;
    const session = await cookieValue(agent1, 'hub_session');
    const v = (await agent1.get(`/api/v1/projects/${projectId}`).expect(200)).body.version as number;
    await agent1.patch(`/api/v1/projects/${projectId}`).set('x-csrf-token', csrf).send({ expectedVersion: v, objective: 'Persisted before the restart (synthetic)' }).expect(200);
    const risk = await agent1.post(`/api/v1/projects/${projectId}/raid/risks`).set('x-csrf-token', csrf).send({ title: 'P1C restart probe risk (synthetic)', probability: 2, impact: 3 });
    expect(risk.status, JSON.stringify(risk.body)).toBe(201);
    const beforeProject = (await agent1.get(`/api/v1/projects/${projectId}`).expect(200)).body;
    const beforeRisk = (await agent1.get(`/api/v1/projects/${projectId}/raid/risks/${risk.body.id}`).expect(200)).body;
    const beforeActivity = (await agent1.get(`/api/v1/projects/${projectId}/activity?pageSize=100`).expect(200)).body;
    expect(beforeActivity.total).toBeGreaterThan(0);

    // 2. Worker #1 consumes the project's outbox, then stops gracefully.
    const w1 = await startWorker('plt002a');
    let firstEvents: { id: string }[] = [];
    try {
      firstEvents = await waitFor('all outbox events of the project dispatched by worker #1', async () => {
        const ev = await outboxOfProject(projectId);
        return ev.length > 0 && ev.every((e) => e.dispatched_at) ? ev : null;
      }, 30_000, w1);
      // Dispatch only enqueues the subscribed jobs; let worker #1 also finish them, so the snapshot below is final and
      // a job still queued at shutdown (run once by worker #2 — correct) is not mistaken for re-processing.
      await waitFor('worker #1 idle on this project', async () => {
        const n = (await owner().query<{ n: number }>(`select count(*)::int n from job where project_id = $1 and status in ('queued', 'running')`, [projectId])).rows[0]!.n;
        return n === 0;
      }, 30_000, w1);
    } finally {
      expect(await stopWorker(w1)).toBe(0);
    }
    const jobsAfterFirst = new Map<string, Awaited<ReturnType<typeof jobsOfEvent>>>();
    for (const e of firstEvents) jobsAfterFirst.set(e.id, await jobsOfEvent(e.id));

    // 3. API restart: close instance #1, boot a brand-new instance against the same database.
    await closeApp();
    let app2: INestApplication | null = (await createApp({ logger: false })).app;
    try {
      const s2 = () => request(app2!.getHttpServer());
      const cookie = `hub_session=${session}; hub_csrf=${csrf}`;
      // Same server-side session (nothing held in the old process), same records, same history.
      const afterProject = (await s2().get(`/api/v1/projects/${projectId}`).set('Cookie', cookie).expect(200)).body;
      // Stored fields are identical (derived read-model fields such as dimensions may be recomputed by the worker).
      expect(stored(afterProject)).toEqual(stored(beforeProject));
      expect(afterProject.objective).toBe('Persisted before the restart (synthetic)');
      expect((await s2().get(`/api/v1/projects/${projectId}/raid/risks/${risk.body.id}`).set('Cookie', cookie).expect(200)).body).toEqual(beforeRisk);
      const afterActivity = (await s2().get(`/api/v1/projects/${projectId}/activity?pageSize=100`).set('Cookie', cookie).expect(200)).body;
      expect(afterActivity.total).toBe(beforeActivity.total);

      // 4. A mutation after the API restart, consumed by a NEW worker process (worker restart).
      const upd = await s2().patch(`/api/v1/projects/${projectId}`).set('Cookie', cookie).set('x-csrf-token', csrf).send({ expectedVersion: afterProject.version, objective: 'Changed after the restart (synthetic)' });
      expect(upd.status, JSON.stringify(upd.body)).toBe(200);
      const raise = await s2().post(`/api/v1/projects/${projectId}/raid/risks`).set('Cookie', cookie).set('x-csrf-token', csrf).send({ title: 'P1C post-restart risk (synthetic)', probability: 1, impact: 1 });
      expect(raise.status, JSON.stringify(raise.body)).toBe(201);
      // A permission change writes an outbox event; with no worker running it stays pending.
      const grant = await s2().post(`/api/v1/projects/${projectId}/members`).set('Cookie', cookie).set('x-csrf-token', csrf).send({ userId: contributorId, role: 'contributor', reason: 'P1C restart probe' });
      expect(grant.status, JSON.stringify(grant.body)).toBe(201);
      const pending = (await outboxOfProject(projectId)).filter((e) => !e.dispatched_at);
      expect(pending.length).toBeGreaterThanOrEqual(1);
      pendingAfterRestart = pending.map((e) => e.id);
    } finally {
      await app2.close();
      app2 = null;
    }

    const w2 = await startWorker('plt002b');
    try {
      await waitFor('events written after the restart dispatched by worker #2', async () => {
        const ev = await outboxOfProject(projectId);
        return pendingAfterRestart.every((id) => ev.find((e) => e.id === id)?.dispatched_at) ? ev : null;
      }, 30_000, w2);
      for (const id of pendingAfterRestart) {
        const jobs = await waitFor(`jobs of post-restart event ${id} succeeded`, async () => {
          const j = await jobsOfEvent(id);
          return j.length > 0 && j.every((x) => x.status === 'succeeded') ? j : null;
        }, 30_000, w2);
        expect(jobs.every((j) => j.attempts === 1)).toBe(true);
      }
      // Let worker #2 run its job pass, then confirm nothing from before the restart was run a second time.
      await waitFor('worker #2 idle on this project', async () => {
        const n = (await owner().query<{ n: number }>(`select count(*)::int n from job where project_id = $1 and status in ('queued', 'running')`, [projectId])).rows[0]!.n;
        return n === 0;
      }, 30_000, w2);
    } finally {
      expect(await stopWorker(w2)).toBe(0);
    }
    for (const [eventId, jobs] of jobsAfterFirst) expect(await jobsOfEvent(eventId), `event ${eventId} not re-processed`).toEqual(jobs);

    // 5. Final read through yet another API instance: the post-restart change is there, the earlier risk too.
    const app3 = (await createApp({ logger: false })).app;
    try {
      const c = `hub_session=${session}`;
      const p3 = (await request(app3.getHttpServer()).get(`/api/v1/projects/${projectId}`).set('Cookie', c).expect(200)).body;
      expect(p3.objective).toBe('Changed after the restart (synthetic)');
      const risks = (await request(app3.getHttpServer()).get(`/api/v1/projects/${projectId}/raid/risks?pageSize=100`).set('Cookie', c).expect(200)).body.items as { title: string }[];
      expect(risks.map((r) => r.title).sort()).toEqual(['P1C post-restart risk (synthetic)', 'P1C restart probe risk (synthetic)']);
    } finally {
      await app3.close();
    }
  });
});
