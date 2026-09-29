import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApp, closePools, DC, demoUserId, getApp, loginAs, owner, projectIdByCode, type Client } from '../helpers';
import request from 'supertest';

/**
 * Independent QA — P1 gate review (revision 5d0dd09).
 * QA-08 carry-over: REQ-SEC-016 names XSS and injection, but no committed test exercised them.
 * Authored by the QA reviewer (ported by the lead); the former "DEFECT QA-P1-xx" tests are now regressions for the fixed
 * findings of docs/reviews/P1-qa-review.md (assertions kept or tightened, never loosened).
 */
let dcId: string;
let admin: Client;
let pm: Client;
let pmB: Client;
let genTemplateId: string;
let pmUserId: string;

beforeAll(async () => {
  dcId = await projectIdByCode(DC);
  admin = await loginAs('portfolio.admin');
  pm = await loginAs('pm');
  pmB = await loginAs('pm.b');
  pmUserId = pm.userId;
  const templates = (await admin.get('/api/v1/templates').expect(200)).body.items as { id: string; templateKey: string }[];
  genTemplateId = templates.find((t) => t.templateKey === 'general-transformation')!.id;
});
afterAll(async () => {
  await closeApp();
  await closePools();
});

describe('REQ-SEC-016 / QA-08 — injection payloads in list, search and paging parameters are data, never SQL [REQ-SEC-016, REQ-DAT-015, AT-03]', () => {
  it('SQL-looking search input matches nothing and leaks nothing across projects', async () => {
    for (const q of ["' OR 1=1 --", "%' OR '1'='1", "DEMO-DC' UNION SELECT name FROM project --"]) {
      const r = await pmB.get(`/api/v1/projects?q=${encodeURIComponent(q)}`).expect(200);
      expect(r.body.total).toBe(0);
      expect(JSON.stringify(r.body)).not.toMatch(/DEMO-DC|Carve-out/);
    }
  });

  it('a pg_sleep payload is not executed', async () => {
    const t0 = Date.now();
    await pm.get(`/api/v1/projects?q=${encodeURIComponent("x'; select pg_sleep(3); --")}`).expect(200);
    expect(Date.now() - t0).toBeLessThan(2500);
  });

  it('REQ-DAT-015: pageSize > 100, page < 1 and non-numeric paging are rejected with 400 problem+json', async () => {
    for (const qs of ['pageSize=101', 'pageSize=1000000', 'page=0', 'page=-1', 'page=1e309']) {
      const r = await pm.get(`/api/v1/projects?${qs}`);
      expect(r.status, qs).toBe(400);
      expect(r.headers['content-type']).toMatch(/application\/problem\+json/);
    }
  });

  it('path-parameter injection is a plain 404', async () => {
    for (const pid of ["' OR 1=1 --", '..%2F..%2Fadmin', '1']) {
      await pmB.get(`/api/v1/projects/${encodeURIComponent(pid)}`).expect(404);
    }
  });

  it('a client-supplied x-correlation-id is not reflected (no header/log injection)', async () => {
    const app = await getApp();
    const r = await request(app.getHttpServer()).get('/api/v1/auth/config').set('x-correlation-id', '<script>alert(1)</script>');
    expect(r.headers['x-correlation-id']).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('REQ-SEC-016 / QA-08 — stored XSS payloads are persisted verbatim and served as JSON data [REQ-SEC-016]', () => {
  it('HTML/script in project fields round-trips as an inert JSON string (web rendering: e2e qa-p1-review.spec.ts)', async () => {
    const name = 'QA <img src=x onerror="alert(1)"> <script>alert(2)</script>';
    const description = '"><svg onload=alert(3)></svg> javascript:alert(4)';
    const c = await admin.post('/api/v1/projects', { templateVersionId: genTemplateId, code: 'QA-SEC016-XSS', name, description, classification: 'internal', projectManagerUserId: pmUserId }).expect(201);
    const d = await pm.get(`/api/v1/projects/${c.body.id}`).expect(200);
    expect(d.headers['content-type']).toMatch(/application\/json/);
    expect(d.body.name).toBe(name);
    expect(d.body.description).toBe(description);
  });

  it('mass assignment: status, isDemo, orgId and version in the create body are ignored', async () => {
    const c = await admin
      .post('/api/v1/projects', { templateVersionId: genTemplateId, code: 'QA-SEC016-MASS', name: 'mass', projectManagerUserId: pmUserId, status: 'active', isDemo: true, orgId: '01a0ee00-0000-7000-8000-000000000009', version: 99 })
      .expect(201);
    const row = (await owner().query('select status, is_demo, version, org_id = (select org_id from project where code = $2) as same_org from project where id = $1', [c.body.id, DC])).rows[0];
    expect(row).toEqual({ status: 'setup', is_demo: false, version: 1, same_org: true });
  });

  it('a PATCH cannot change the project status column', async () => {
    const before = (await pm.get(`/api/v1/projects/${dcId}`).expect(200)).body;
    const r = await pm.patch(`/api/v1/projects/${dcId}`, { expectedVersion: before.version, status: 'closed' });
    expect(r.status).toBe(400); // unknown fields are rejected, not silently dropped (QA-P1-12)
    const after = (await pm.get(`/api/v1/projects/${dcId}`).expect(200)).body;
    expect(after.status).toBe(before.status);
    expect(after.version).toBe(before.version);
    // a no-op update is not a write (no version bump)
    const noop = await pm.patch(`/api/v1/projects/${dcId}`, { expectedVersion: before.version, name: before.name }).expect(200);
    expect(noop.body.version).toBe(before.version);
  });
});

describe('QA-P1-06 regression — LIKE metacharacters in project and directory search match literally [REQ-SEC-016, REQ-DAT-015]', () => {
  // The documents module already matches "%" literally (at-03-documents-isolation.spec.ts "title search ... literal").
  it('"%" and "_" in /projects?q are matched literally (no project code or name contains them)', async () => {
    for (const q of ['%', '_']) {
      const r = await pm.get(`/api/v1/projects?q=${encodeURIComponent(q)}`).expect(200);
      expect(r.body.total, `q=${q}`).toBe(0);
    }
  });

  it('"%" in /directory/users?q is matched literally (no enumeration of every user)', async () => {
    const r = await pm.get(`/api/v1/directory/users?q=${encodeURIComponent('%')}`).expect(200);
    expect(r.body.items.length).toBe(0);
  });
});

describe('QA-P1-04 regression — external partner accounts cannot hold internal project roles [docs/security/access-matrix.md §2.8, REQ-SEC-003]', () => {
  it('the external partner persona cannot be made project manager of a new project', async () => {
    const partnerId = await demoUserId('partner.alpha');
    const r = await admin.post('/api/v1/projects', { templateVersionId: genTemplateId, code: 'QA-P1-04-EXT', name: 'external PM probe', classification: 'internal', projectManagerUserId: partnerId });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('identity.external_account_role');
  });

  it('the database refuses internal roles for external accounts on any path (defence in depth)', async () => {
    const partnerId = await demoUserId('partner.alpha');
    const pmId = await demoUserId('pm');
    await expect(
      owner().query(`insert into project_membership (org_id, project_id, user_id, role, granted_by, reason) values ((select org_id from project where id = $1), $1, $2, 'contributor', $3, 'probe')`, [dcId, partnerId, pmId]),
    ).rejects.toThrow(/external_account_role/);
  });
});

describe('QA-P1-05 / QA-P1-07 regressions', () => {
  it('a project cannot be created above the creator\'s clearance (the wizard only offers allowed levels)', async () => {
    const r = await admin.post('/api/v1/projects', { templateVersionId: genTemplateId, code: 'QA-P1-05-HI', name: 'above clearance', classification: 'strictly_confidential', projectManagerUserId: await demoUserId('pm') });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('policy.classification_exceeds_clearance');
  });

  it('setup gaps reflect current records: DEMO-DC has an active committee and an approved authority matrix', async () => {
    const p = (await pm.get(`/api/v1/projects/${dcId}`).expect(200)).body;
    expect(p.setupState.gaps).not.toContain('committee');
    expect(p.setupState.gaps).not.toContain('authority_matrix');
    expect(p.setupState.gapsComputedAt).toBeTruthy();
  });
});
