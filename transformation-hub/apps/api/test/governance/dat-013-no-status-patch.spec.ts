import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ROUTES, buildPath } from '@hub/contracts';
import { closeApp, closePools, DC, demoUserId, getApp, owner, projectIdByCode } from '../helpers';
import { P, actors, paper, setupCommittee, uniq } from './gov-fixtures';

/**
 * REQ-DAT-013 (AT: "PATCH containing status field rejected on every resource") — the API side of
 * packages/contracts/src/patch-status.test.ts. Every PATCH / PUT route of the registry is called by a persona holding its
 * permission, with a body carrying `status` (and other status-like fields): the answer is 400 validation_failed naming the
 * field, never 200 with the field silently dropped. The body is validated before the record is loaded, so random record
 * ids suffice; real records show that nothing was applied.
 */

const PERSONAS = ['pm', 'secretary', 'sponsor', 'chair', 'finance', 'legal', 'approver', 'contributor', 'portfolio.admin', 'platform.admin'];
const PROBES = ['status', 'state', 'stage', 'disposition', 'outcome'];

interface Session {
  persona: string;
  userId: string;
  agent: request.Agent;
  csrf: string;
  /** Mutations sent on this session (the per-session limiter allows 120 a minute; a fresh session is used before that). */
  sent: number;
}

let dc: string;
const sessions: Session[] = [];

async function login(persona: string, userId: string): Promise<Session> {
  const agent = request.agent((await getApp()).getHttpServer());
  const res = await agent.post('/api/v1/auth/demo-login').send({ userId }).expect(201);
  return { persona, userId, agent, csrf: res.body.csrfToken as string, sent: 0 };
}

async function send(s: Session, method: string, path: string, body: Record<string, unknown>) {
  if (s.sent >= 100) Object.assign(s, await login(s.persona, s.userId));
  s.sent++;
  return (method === 'PUT' ? s.agent.put(path) : method === 'PATCH' ? s.agent.patch(path) : s.agent.post(path)).set('x-csrf-token', s.csrf).send(body);
}

beforeAll(async () => {
  dc = await projectIdByCode(DC);
  for (const p of PERSONAS) sessions.push(await login(p, await demoUserId(p)));
}, 300_000);

afterAll(async () => {
  await closeApp();
  await closePools();
});

function pathOf(path: string): string {
  const params: Record<string, string> = {};
  for (const m of path.matchAll(/:([A-Za-z0-9_]+)/g)) params[m[1]!] = m[1] === 'projectId' ? dc : randomUUID();
  return buildPath(path, params);
}

describe('REQ-DAT-013 — a PATCH carrying a status field is rejected with 400 on every resource', () => {
  it('every PATCH / PUT route of the registry answers 400 validation_failed naming the status field (never 200)', async () => {
    const routes = Object.values(ROUTES).filter((r) => r.method === 'PATCH' || r.method === 'PUT');
    expect(routes.length).toBeGreaterThanOrEqual(35);
    const problems: string[] = [];
    for (const r of routes) {
      const path = pathOf(r.path);
      let checked = false;
      for (const s of sessions) {
        const res = await send(s, r.method, path, { expectedVersion: 1, status: 'approved' });
        if (res.status === 403) continue; // this persona lacks the route permission in the project — try the next one
        const named = (res.body?.details?.issues ?? []).some((i: { message: string }) => /"status"/.test(i.message));
        if (res.status !== 400 || res.body.code !== 'validation_failed' || !named) problems.push(`${r.id} (${s.persona}): ${res.status} ${JSON.stringify(res.body).slice(0, 240)}`);
        // Other status-like fields are refused the same way.
        for (const probe of PROBES.slice(1)) {
          const p = await send(s, r.method, path, { expectedVersion: 1, [probe]: 'approved' });
          if (p.status !== 400 || p.body.code !== 'validation_failed') problems.push(`${r.id} (${s.persona}) ← ${probe}: ${p.status}`);
        }
        checked = true;
        break;
      }
      if (!checked) problems.push(`${r.id}: no persona holds the route permission in ${DC}`);
    }
    expect(problems).toEqual([]);
  });

  it('a real draft decision paper: a PATCH with a status is refused as a whole (400) — neither the status nor the other fields change', async () => {
    const a = await actors();
    const tc = await setupCommittee(dc, a, { name: uniq('DAT-013 committee'), matrix: false });
    const d = (await a.pm.post(`${P(dc)}/decisions`, paper(tc.id)).expect(201)).body;
    const r = await a.pm.patch(`${P(dc)}/decisions/${d.id}`, { expectedVersion: d.version, title: 'Changed title (should not apply)', status: 'approved' });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('validation_failed');
    const row = (await owner().query(`select status, title, version from decision where id = $1`, [d.id])).rows[0];
    expect(row).toMatchObject({ status: 'draft', version: d.version });
    expect(row.title).not.toBe('Changed title (should not apply)');
    // Without the status field the same edit is accepted (the rule refuses the status, not the edit).
    const ok = await a.pm.patch(`${P(dc)}/decisions/${d.id}`, { expectedVersion: d.version, title: 'Changed title (synthetic)' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect((await owner().query(`select status, title from decision where id = $1`, [d.id])).rows[0]).toMatchObject({ status: 'draft', title: 'Changed title (synthetic)' });
  });

  it("an assumption's verification status changes only through its command (reason required), not through the PATCH", async () => {
    const pm = sessions.find((s) => s.persona === 'pm')!;
    const created = await send(pm, 'POST', `/api/v1/projects/${dc}/raid/assumptions`, { title: uniq('DAT-013 assumption (synthetic)') });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = created.body.id as string;
    const v = (await pm.agent.get(`/api/v1/projects/${dc}/raid/assumptions/${id}`).expect(200)).body.version as number;
    const patch = await send(pm, 'PATCH', `/api/v1/projects/${dc}/raid/assumptions/${id}`, { expectedVersion: v, verificationStatus: 'confirmed' });
    expect(patch.status).toBe(400);
    const path = `/api/v1/projects/${dc}/raid/assumptions/${id}/verification`;
    expect((await send(pm, 'POST', path, { expectedVersion: v, verificationStatus: 'confirmed' })).status).toBe(400); // reason required
    const ok = await send(pm, 'POST', path, { expectedVersion: v, verificationStatus: 'confirmed', reason: 'Validated with the workstream owner (synthetic)' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body).toMatchObject({ id, verificationStatus: 'confirmed', version: v + 1 });
    const audit = await owner().query(`select reason, before, after from audit_event where action = 'planning.assumption.verification' and entity_id = $1`, [id]);
    expect(audit.rows[0]).toMatchObject({ reason: 'Validated with the workstream owner (synthetic)', before: { verificationStatus: 'assumed' }, after: { verificationStatus: 'confirmed' } });
    const stale = await send(pm, 'POST', path, { expectedVersion: v, verificationStatus: 'unknown', reason: 'Stale (synthetic)' });
    expect(stale.status).toBe(409);
  });
});
