import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApp, closePools, loginAs, owner, Client } from '../helpers';
import { grant, task, workstreams } from '../planning/fixtures';
import { approvedNonDemoMatrix } from '../governance/gov-fixtures';

/**
 * Actual-project setup wizard, steps 7 and 8 (spec §21), and the onboarding approvals of a real (non-demo) project:
 *  - REQ-SET-015: step 7 sets confidentiality and retention; AI is Off by default; integrations show their honest status;
 *  - REQ-SET-016: step 8 launches monitoring only after required-data validation and returns an explicit gap list;
 *  - REQ-SET-007: a real project cannot leave setup until charter, permissions, sources, entities (carve-out), perimeter
 *    (carve-out), committee, delegation and baseline are approved through their own commands — the checklist names the
 *    roles that approve each item, never an invented person.
 * The project is a fresh, non-demo general-transformation project; all data is synthetic.
 */
let admin: Client;
let pm: Client;
let sponsor: Client;
let contributor: Client;
let secretary: Client;
let legal: Client;
let pid: string;
const base = () => `/api/v1/projects/${pid}`;
const setup = async (c: Client = pm) => (await c.get(`${base()}/setup`).expect(200)).body;
const projectVersion = async () => (await pm.get(base()).expect(200)).body.version as number;
const item = (s: { checklist: { items: { key: string }[] } }, key: string) => s.checklist.items.find((i) => i.key === key) as { key: string; state: string; step: string; byRoles: string[]; evidence: { at: string | null; byName: string | null } | null };

beforeAll(async () => {
  admin = await loginAs('portfolio.admin');
  pm = await loginAs('pm');
  sponsor = await loginAs('sponsor');
  contributor = await loginAs('contributor');
  secretary = await loginAs('secretary');
  legal = await loginAs('legal');
  const templates = (await admin.get('/api/v1/templates').expect(200)).body.items as { id: string; templateKey: string }[];
  const r = await admin
    .post('/api/v1/projects', { templateVersionId: templates.find((t) => t.templateKey === 'general-transformation')!.id, code: 'SETUP-P6', name: 'Setup wizard steps 7-8 test (synthetic)', classification: 'confidential', projectManagerUserId: pm.userId })
    .expect(201);
  pid = r.body.id;
});
afterAll(async () => {
  await closeApp();
  await closePools();
});

describe('REQ-SET-015 — wizard step 7: confidentiality, retention, integrations and AI mode', () => {
  it('UT: wizard defaults AI Off and integrations Not configured', async () => {
    const s = await setup();
    expect(s).toMatchObject({ status: 'setup', isDemo: false, templateKind: 'general_transformation' });
    expect(s.ai).toEqual({ mode: 'off', killSwitch: false, isDefault: true });
    // Honest integration status: nothing is "verified" without a real connectivity check (none is configured in this
    // environment, so the list is empty and the screen shows Not configured).
    const rows = (await owner().query(`select status::text from integration_connection where org_id = (select org_id from project where id = $1)`, [pid])).rows;
    expect(s.integrations.length).toBe(rows.length);
    expect(s.integrations.every((i: { status: string }) => i.status !== 'verified')).toBe(true);
    expect(s.policies).toMatchObject({ classification: 'confidential', retentionYears: null, reviewedAt: null });
    expect(item(s, 'policies').state).toBe('open');
  });

  it('only the project manager sets them, within their own clearance; lowering the confidentiality needs a reason; optimistic concurrency', async () => {
    const v = await projectVersion();
    expect((await contributor.post(`${base()}/setup/steps/policies`, { expectedVersion: v, classification: 'confidential', retentionYears: 10 })).status).toBe(404); // not a member yet
    await grant(pm, pid, contributor, 'contributor');
    expect((await contributor.post(`${base()}/setup/steps/policies`, { expectedVersion: v, classification: 'confidential', retentionYears: 10 })).status).toBe(403);
    const above = await pm.post(`${base()}/setup/steps/policies`, { expectedVersion: v, classification: 'strictly_confidential', retentionYears: 10 });
    expect(above.status).toBe(403);
    expect(above.body.code).toBe('policy.classification_exceeds_clearance');
    const lower = await pm.post(`${base()}/setup/steps/policies`, { expectedVersion: v, classification: 'internal', retentionYears: 10 });
    expect(lower.status).toBe(422);
    expect(lower.body.code).toBe('setup.classification_lowered_reason_required');
    expect((await pm.post(`${base()}/setup/steps/policies`, { expectedVersion: v, classification: 'confidential', retentionYears: 0 })).status).toBe(400);
    expect((await pm.post(`${base()}/setup/steps/policies`, { expectedVersion: v + 5, classification: 'confidential', retentionYears: null })).status).toBe(409);
    // Retention left to be confirmed (null) is allowed — it stays on the gap list as a warning.
    const ok = await pm.post(`${base()}/setup/steps/policies`, { expectedVersion: v, classification: 'confidential', retentionYears: null });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body.version).toBe(v + 1);
    const s = await setup();
    expect(s.policies).toMatchObject({ classification: 'confidential', retentionYears: null, reviewedByName: 'Demo Project Manager' });
    expect(s.policies.reviewedAt).not.toBeNull();
    expect(item(s, 'policies')).toMatchObject({ state: 'done', step: 'settings' });
    expect(s.checklist.warnings).toEqual(expect.arrayContaining(['retention_tbd']));
    const au = await owner().query(`select before, after from audit_event where project_id = $1 and action = 'config.setup.policies' and outcome = 'success'`, [pid]);
    expect(au.rows).toEqual([{ before: { classification: 'confidential', retentionYears: null }, after: { classification: 'confidential', retentionYears: null } }]);
  });
});

describe('REQ-SET-016 / REQ-SET-007 — wizard step 8: launch only after the required approvals, with an explicit gap list', () => {
  it('the checklist lists every required approval with the roles that give it (no invented approver); carve-out items do not apply', async () => {
    const s = await setup();
    expect(s.checklist.items.map((i: { key: string }) => i.key)).toEqual(['objective', 'newco', 'sources', 'perimeter', 'owners', 'permissions', 'committee', 'authority_matrix', 'baseline', 'policies']);
    expect(item(s, 'perimeter').state).toBe('not_applicable');
    expect(item(s, 'newco').state).toBe('not_applicable');
    expect(item(s, 'committee').byRoles).toEqual(['sponsor']);
    expect(item(s, 'baseline').byRoles).toEqual(['sponsor']);
    expect(item(s, 'owners').byRoles).toEqual(expect.arrayContaining(['project_manager']));
    expect(s.checklist.blockingGaps).toEqual(['objective', 'owners', 'permissions', 'committee', 'authority_matrix', 'baseline']);
    expect(s.checklist.warnings).toEqual(['no_sources', 'retention_tbd']);
    for (const i of s.checklist.items) if (i.state !== 'done') expect(i.evidence).toBeNull();
  });

  it('IT: launch blocked while mandatory setup data missing; gap list returned (and recorded)', async () => {
    const v = await projectVersion();
    const r = await pm.post(`${base()}/setup/launch`, { expectedVersion: v, acknowledgedGaps: ['no_sources', 'retention_tbd'] });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('setup.launch_blocked');
    expect(r.body.details.gaps).toEqual(['objective', 'owners', 'permissions', 'committee', 'authority_matrix', 'baseline']);
    expect((await pm.get(base()).expect(200)).body.status).toBe('setup');
    const audit = await owner().query(`select reason from audit_event where actor_user_id = $1 and action = 'config.launch' and outcome = 'rejected' order by seq desc limit 1`, [pm.userId]);
    expect(audit.rows[0].reason).toMatch(/setup\.launch_blocked: .*objective, owners, permissions, committee, authority_matrix, baseline/);
    // Only the project manager launches.
    expect((await contributor.post(`${base()}/setup/launch`, { expectedVersion: v, acknowledgedGaps: [] })).status).toBe(403);
  });

  it('each approval comes from its own module command; unreviewed source claims block; the checklist follows the current records', async () => {
    // Objective (project profile command), permissions (sponsor role), owners (workstream leads).
    await pm.patch(base(), { expectedVersion: await projectVersion(), objective: 'Deliver the synthetic transformation programme' }).expect(200);
    await grant(admin, pid, sponsor, 'sponsor');
    await grant(pm, pid, secretary, 'secretary_cpmo');
    await grant(admin, pid, legal, 'legal_restricted');
    const ws = await workstreams(pm, pid);
    for (const [, w] of ws) await pm.post(`${base()}/workstreams/${w.id}/lead`, { userId: contributor.userId, expectedVersion: w.version }).expect(201);
    // Committee with an approved charter, and an approved, verified delegation (governance commands).
    await approvedNonDemoMatrix(pid, { secretary, sponsor, legal });
    // Baseline proposed by the PM and approved by the sponsor (planning commands).
    await task(pm, pid, ws.get('WS01')!.id, 'Setup test dated task (synthetic)', { durationDays: 5, plannedStart: '2026-10-04', plannedFinish: '2026-10-08' });
    const b = await pm.post(`${base()}/baselines`, {}).expect(201);
    // A source with an unreviewed claim: the sources item is open until the claim is reviewed by someone else.
    const src = (await pm.post(`${base()}/sources`, { sourceType: 'manual_entry', ownerLabel: 'PMO (synthetic)' }).expect(201)).body;
    const claim = (await pm.post(`${base()}/sources/${src.id}/claims`, { location: 'row 1', subject: 'Objective (synthetic)', extractedValue: 'Synthetic value' }).expect(201)).body;
    let s = await setup();
    expect(s.checklist.blockingGaps).toEqual(['sources', 'baseline']);
    expect(s.checklist.warnings).toEqual(['retention_tbd']);
    expect(item(s, 'committee').state).toBe('done');
    expect(item(s, 'committee').evidence?.byName).toBe('Demo Sponsor');
    await sponsor.post(`${base()}/baselines/${b.body.id}/approve`, { expectedVersion: 1 }).expect(201);
    const rv = await secretary.post(`${base()}/claims/${claim.id}/review`, { expectedVersion: 1, verificationStatus: 'assumed' });
    expect(rv.status, JSON.stringify(rv.body)).toBe(201);
    s = await setup();
    expect(s.checklist.blockingGaps).toEqual([]);
    expect(item(s, 'baseline').evidence?.byName).toBe('Demo Sponsor');
    expect(item(s, 'owners').state).toBe('done');
  });

  it('remaining gaps must be acknowledged explicitly; launch then moves the project to Active and records the gap list', async () => {
    const v = await projectVersion();
    const unack = await pm.post(`${base()}/setup/launch`, { expectedVersion: v, acknowledgedGaps: [] });
    expect(unack.status).toBe(422);
    expect(unack.body.code).toBe('setup.gaps_not_acknowledged');
    expect(unack.body.details.warnings).toEqual(['retention_tbd']);
    expect((await pm.post(`${base()}/setup/launch`, { expectedVersion: v + 3, acknowledgedGaps: ['retention_tbd'] })).status).toBe(409);
    const ok = await pm.post(`${base()}/setup/launch`, { expectedVersion: v, acknowledgedGaps: ['retention_tbd'], note: 'Retention to be confirmed by records management (synthetic)' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body).toMatchObject({ status: 'active', version: v + 1, acknowledgedGaps: ['retention_tbd'] });
    expect((await pm.get(base()).expect(200)).body.status).toBe('active');
    const s = await setup();
    expect(s.launch).toMatchObject({ byName: 'Demo Project Manager', acknowledgedGaps: ['retention_tbd'], note: 'Retention to be confirmed by records management (synthetic)' });
    const au = await owner().query(`select before, after from audit_event where project_id = $1 and action = 'config.setup.launch' and outcome = 'success'`, [pid]);
    expect(au.rows[0].before).toEqual({ status: 'setup' });
    expect(au.rows[0].after).toMatchObject({ status: 'active', acknowledgedGaps: ['retention_tbd'] });
    // Leaving setup is final here: no second launch, no setup-wizard policy change after launch.
    expect((await pm.post(`${base()}/setup/launch`, { expectedVersion: v + 1, acknowledgedGaps: ['retention_tbd'] })).body.code).toBe('setup.not_in_setup');
    expect((await pm.post(`${base()}/setup/steps/policies`, { expectedVersion: v + 1, classification: 'confidential', retentionYears: 7 })).body.code).toBe('setup.policies_after_launch');
  });

  it('a status column is never changed by the generic project PATCH (launch is the only command)', async () => {
    const tv = (await owner().query(`select template_version_id from project where id = $1`, [pid])).rows[0].template_version_id;
    const other = await admin.post('/api/v1/projects', { templateVersionId: tv, code: 'SETUP-P6B', name: 'Status probe (synthetic)', projectManagerUserId: pm.userId }).expect(201);
    const v = (await pm.get(`/api/v1/projects/${other.body.id}`).expect(200)).body.version;
    expect((await pm.patch(`/api/v1/projects/${other.body.id}`, { expectedVersion: v, status: 'active' })).status).toBe(400);
    expect((await pm.get(`/api/v1/projects/${other.body.id}`).expect(200)).body.status).toBe('setup');
  });

  it('isolation: another project’s manager gets 404 for the setup state and the commands', async () => {
    const pmB = await loginAs('pm.b');
    expect((await pmB.get(`${base()}/setup`)).status).toBe(404);
    expect((await pmB.post(`${base()}/setup/launch`, { expectedVersion: 1, acknowledgedGaps: [] })).status).toBe(404);
    expect((await pmB.post(`${base()}/setup/steps/policies`, { expectedVersion: 1, classification: 'internal', retentionYears: 1, reason: 'probe' })).status).toBe(404);
  });
});
