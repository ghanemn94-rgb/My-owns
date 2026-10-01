import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApp, closePools, loginAs, Client } from '../helpers';

/**
 * Reports & Administration — screen 16b (REQ-UX-020, deployment-settings part) and template administration (REQ-ENT-009):
 * the deployment configuration is shown honestly and WITHOUT secrets (only whether a part is configured and the host names it
 * talks to); the template versions are listed with the projects pinned to each and the diff between two versions.
 */
let platformAdmin: Client;
let portfolioAdmin: Client;
let auditor: Client;
let pm: Client;

beforeAll(async () => {
  platformAdmin = await loginAs('platform.admin');
  portfolioAdmin = await loginAs('portfolio.admin');
  auditor = await loginAs('auditor');
  pm = await loginAs('pm');
});
afterAll(async () => {
  await closeApp();
  await closePools();
});

describe('REQ-UX-020 — deployment settings: honest configuration, no secrets, administrators only', () => {
  it('the platform administrator reads the running configuration; no secret value appears anywhere in the response', async () => {
    const r = await platformAdmin.get('/api/v1/admin/deployment-settings');
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({ mode: 'demo', nodeEnv: 'test', identity: { demoLogin: true, oidcConfigured: false, oidcIssuerHost: null }, storage: { driver: 'local', s3: null } });
    expect(r.body.ai).toEqual({ mockProviderAllowed: true, openAiCompatibleEndpointHost: null, anthropicGatewayHost: null });
    const text = JSON.stringify(r.body);
    // The database URL (with its password), the cookie / OIDC / S3 secrets and connection strings are never returned.
    expect(text).not.toMatch(/hub_dev_only|postgres:\/\/|DATABASE|secret|password|clientSecret|accessKey/i);
    const keys = new Set<string>();
    const walk = (o: unknown) => {
      if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) (keys.add(k), walk(v));
    };
    walk(r.body);
    expect([...keys].filter((k) => /secret|password|token|credential|url$/i.test(k))).toEqual([]);
  });

  it('other roles are refused (settings are administrator-only)', async () => {
    for (const c of [portfolioAdmin, auditor, pm]) expect((await c.get('/api/v1/admin/deployment-settings')).status).toBe(403);
  });
});

describe('REQ-ENT-009 — template administration: versions, pinned projects, diff between versions (read-only)', () => {
  it('lists every version of each template with the projects pinned to it; the demo projects are on version 2', async () => {
    const r = await portfolioAdmin.get('/api/v1/admin/templates');
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const dc = r.body.items.find((t: { key: string }) => t.key === 'dc-carveout');
    const gen = r.body.items.find((t: { key: string }) => t.key === 'general-transformation');
    expect(dc.versions.map((v: { versionNo: number }) => v.versionNo)).toEqual([2, 1]);
    expect(gen.versions.map((v: { versionNo: number }) => v.versionNo)).toEqual([2, 1]);
    expect(dc.versions[0]).toMatchObject({ status: 'published', counts: { gates: 8, workstreams: 12, kpis: 15 } });
    expect(dc.versions[0].projects).toBeGreaterThanOrEqual(1); // DEMO-DC
    expect(gen.nameAr).toBeTruthy();
    // Auditors read it too; a project-only role does not (organization-level template reading).
    expect((await auditor.get('/api/v1/admin/templates')).status).toBe(200);
    expect((await pm.get('/api/v1/admin/templates')).status).toBe(403);
  });

  it('the diff of the shipped version 2: Arabic KPI texts and the stated RAG default — no structural change', async () => {
    const t = (await portfolioAdmin.get('/api/v1/admin/templates').expect(200)).body.items.find((x: { key: string }) => x.key === 'general-transformation');
    const [v2, v1] = t.versions;
    const d = await portfolioAdmin.get(`/api/v1/admin/templates/versions/${v2.id}/diff?from=${v1.id}`);
    expect(d.status, JSON.stringify(d.body)).toBe(200);
    expect(d.body).toMatchObject({ templateKey: 'general-transformation', fromVersionNo: 1, toVersionNo: 2 });
    expect(d.body.diff.kpiTextsArabicOnly.sort()).toEqual(['benefits_realized', 'deliverables_accepted_vs_due', 'milestone_delay_days', 'overdue_decisions', 'update_freshness']);
    expect(d.body.diff.ragPolicyChanged).toBe(true);
    for (const k of ['addedGates', 'removedGates', 'changedGates', 'addedWorkstreams', 'removedWorkstreams', 'addedActivities', 'removedActivities', 'changedActivities', 'addedKpis', 'removedKpis', 'changedKpis']) {
      expect(d.body.diff[k], k).toEqual([]);
    }
    const dc = (await portfolioAdmin.get('/api/v1/admin/templates').expect(200)).body.items.find((x: { key: string }) => x.key === 'dc-carveout');
    const other = await portfolioAdmin.get(`/api/v1/admin/templates/versions/${v2.id}/diff?from=${dc.versions[1].id}`);
    expect(other.status).toBe(422);
    expect(other.body.code).toBe('config.template_diff.other_template');
  });
});
