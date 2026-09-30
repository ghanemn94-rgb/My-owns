import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApp, closePools, loginAs, owner, Client } from '../helpers';
import { setupProject, Personas } from '../gates/gate-test-kit';
import { plusDays } from '../governance/gov-fixtures';
import { syntheticUser, DocClient } from '../jv/jv-kit';
import { serviceHandles, setAi } from '../ai/ai-fixtures';

/**
 * P3 / P4 security review probes — carve-out, NewCo, readiness / TSA, finance figures and the AI retrieval of those
 * registers (docs/reviews/P3-P4-security-review.md). Written by the security-privacy-reviewer; no implementation file and
 * no existing test was changed. Kinds of test:
 *  - `DEFECT SEC-P34-xx` asserts the REQUIRED behaviour with `it.fails`: it stays green while the finding is open and turns
 *    red once fixed (then rename it "(fixed, regression)" and make it a plain `it`; never weaken the assertion);
 *  - `OBSERVED SEC-P34-xx` pins the CURRENT behaviour of a Low / design finding (update it together with the fix);
 *  - `CONTROL` confirms a control the review relies on.
 * Every record is created by this spec in its own project (synthetic data only). The owner pool is used for setup that no
 * API offers to the test (a synthetic account's creation, a TSA's status / classification, an approved figure's approval
 * columns, the project's AI settings) and for assertions; each such use is commented.
 *
 * Principal shapes: `p.techLead` holds `workstream_lead` on the FIRST workstream only (finance.record.read, readiness.check.
 * signoff… reach that workstream) PLUS a project-scoped `contributor` role (readiness.register.read, ai.assistant.use
 * project-wide, no finance.record.read) — the shape of the demo personas tech.lead / ops.lead.
 */
let projectId: string;
let orgId: string;
let p: Personas;
let admin: Client;
let ws: string[];
let rlegal: DocClient; // synthetic legal_restricted member with clearance `restricted`

const G = (pid: string) => `/api/v1/projects/${pid}`;
const TAG = 'P34SEC';

beforeAll(async () => {
  ({ projectId, orgId, p } = await setupProject('P34SEC-REG', [['tech.lead', 'contributor']]));
  admin = await loginAs('portfolio.admin');
  ws = ((await p.pm.get(`${G(projectId)}/workstreams`).expect(200)).body.items as { id: string }[]).map((w) => w.id);
  // Owner pool: a synthetic internal account (no provisioning API exists); its project role goes through the portfolio API.
  rlegal = await syntheticUser(orgId, 'p34sec.legal.restricted', 'internal', 'restricted');
  const m = await admin.post(`${G(projectId)}/members`, { userId: rlegal.userId, role: 'legal_restricted', reason: 'P3/P4 security review probe (synthetic)' });
  expect(m.status, JSON.stringify(m.body)).toBe(201);
  const scope = await owner().query(`select role, workstream_id from project_membership where project_id = $1 and user_id = $2 and revoked_at is null order by role`, [projectId, p.techLead.userId]);
  expect(scope.rows.map((r) => [r.role, r.workstream_id === null ? 'project' : 'workstream']).sort()).toEqual([
    ['contributor', 'project'],
    ['workstream_lead', 'workstream'],
  ]);
}, 600_000);
afterAll(async () => {
  await closeApp();
  await closePools();
});

// ---------------------------------------------------------------------------------------------------------------------
describe('SEC-P34-01 — a readiness sign-off by the person who linked the check’s evidence [access-matrix §5.1 readiness.check.signoff]', () => {
  let checkId: string;
  let version: number;

  beforeAll(async () => {
    // A check in the first workstream, created and tested by the contributor, signed off by the workstream lead role.
    const c = await p.contributor.post(`${G(projectId)}/readiness-checks`, { area: 'noc', title: `${TAG} NOC hand-over check (synthetic)`, workstreamId: ws[0], signoffRole: 'workstream_lead', mandatory: true, blocker: false });
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    checkId = c.body.id;
    const t = await p.contributor.post(`${G(projectId)}/readiness-checks/${checkId}/test-runs`, { expectedVersion: c.body.version, result: 'passed', note: 'Synthetic passing test (probe)' });
    expect(t.status, JSON.stringify(t.body)).toBe(201);
    // The signer-to-be links the (only) evidence of the check through the documents API.
    const link = await p.techLead.post(`${G(projectId)}/evidence`, { targetType: 'readiness_check', targetId: checkId, note: 'Evidence linked by the future signer (synthetic probe)' });
    expect(link.status, JSON.stringify(link.body)).toBe(201);
    version = t.body.version;
  }, 120_000);

  it('SEC-P34-01 (fixed, regression): whoever recorded the evidence of a check cannot sign it off (403)', async () => {
    const r = await p.techLead.post(`${G(projectId)}/readiness-checks/${checkId}/sign-off`, { expectedVersion: version, outcome: 'passed', note: 'Signed on my own evidence (probe)' });
    console.log(`SEC-P34-01 observed: sign-off by the evidence linker → ${r.status} ${JSON.stringify(r.body)}`);
    expect(r.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('SEC-P34-02 — AI detections list a TSA the caller may not read (classification) [access-matrix §2.5, §2.6]', () => {
  let tsaId: string;
  const name = `${TAG}-TSA-CANARY restricted transition service (synthetic)`;

  beforeAll(async () => {
    const t = await p.pm.post(`${G(projectId)}/tsa-services`, { name, startDate: plusDays(-30), endDate: plusDays(10) });
    expect(t.status, JSON.stringify(t.body)).toBe(201);
    tsaId = t.body.id;
    // Owner pool (setup): the TSA is ACTIVE and classified `restricted` — a state reached in production through the TSA
    // approval / activation commands and a Legal relabel; the test does not need the governance decision behind it.
    await owner().query(`update tsa_service set status = 'active', classification = 'restricted' where id = $1`, [tsaId]);
  }, 120_000);

  it('CONTROL: the TSA is hidden from the PM and the contributor (clearance confidential): GET 404, absent from the list', async () => {
    for (const c of [p.pm, p.contributor]) {
      expect((await c.get(`${G(projectId)}/tsa-services/${tsaId}`)).status, c.persona).toBe(404);
      const list = (await c.get(`${G(projectId)}/tsa-services?pageSize=100`).expect(200)).body;
      expect(JSON.stringify(list), c.persona).not.toContain(tsaId);
    }
  });

  it.fails('DEFECT SEC-P34-02: GET /ai/detections never lists (id, code, name, end date) a TSA the caller cannot read', async () => {
    const r = await p.contributor.get(`${G(projectId)}/ai/detections`);
    const hits = ((r.body.items ?? []) as { entityType: string; entityId: string; label: string; detail: string }[]).filter((d) => d.entityId === tsaId);
    console.log(`SEC-P34-02 observed: ${r.status}; detections of the hidden TSA shown to the contributor: ${JSON.stringify(hits)}`);
    expect(r.status).toBe(200);
    expect(JSON.stringify(r.body)).not.toContain(tsaId);
    expect(JSON.stringify(r.body)).not.toContain('TSA-CANARY');
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('SEC-P34-03 — AI retrieval of approved figures ignores the finance reach [P4 exit criterion; access-matrix §2.2]', () => {
  let figureId: string;
  const label = `${TAG}-FIGURE-CANARY programme-level actual (synthetic)`;

  beforeAll(async () => {
    const f = await p.finance.post(`${G(projectId)}/financial-snapshots`, {
      kind: 'actual',
      category: 'opex',
      lineRef: `${TAG}-AI-1`,
      label,
      period: '2026-09',
      amount: { amount: '9876.0000', currency: 'SAR', unitScale: 1 },
      sourceRef: 'Synthetic source reference (probe)',
      classification: 'confidential',
    });
    expect(f.status, JSON.stringify(f.body)).toBe(201);
    figureId = f.body.id;
    // Owner pool (setup): mark the project-level figure APPROVED (validated by Legal, approved by the sponsor — two people
    // other than the preparer, as the table's check constraints require). Production reaches this state through the
    // validate / approve commands; the probe only needs an approved figure outside the tech lead's finance reach.
    await owner().query(
      `update financial_snapshot set validated_by = $2, validated_at = now(), validated_hash = 'p34sec-synthetic', approved_by = $3, approved_at = now(), approval_state = 'approved' where id = $1`,
      [figureId, p.legal.userId, p.sponsor.userId],
    );
    await setAi(projectId, {}); // owner pool: advisory mode, Simulated mock provider (test-only reset of the AI settings)
  }, 120_000);

  it('CONTROL: the finance module hides the project-level figure from the tech lead (finance reach = its workstream only) — 404, absent from the list', async () => {
    expect((await p.finance.get(`${G(projectId)}/financial-snapshots/${figureId}`)).status).toBe(200);
    expect((await p.techLead.get(`${G(projectId)}/financial-snapshots/${figureId}`)).status).toBe(404);
    const list = (await p.techLead.get(`${G(projectId)}/financial-snapshots?pageSize=100`).expect(200)).body;
    expect(JSON.stringify(list)).not.toContain(figureId);
  });

  it.fails('DEFECT SEC-P34-03: the AI never retrieves nor answers with a figure outside the caller’s finance reach', async () => {
    const { contexts, db, knowledge } = await serviceHandles();
    const ctx = (await contexts.forUser(p.techLead.userId, projectId))!;
    const r = await db.run(ctx, () => knowledge.approvedFinancials(ctx, projectId, true));
    const retrieved = (r?.figures ?? []).filter((x) => x.id === figureId);
    const ask = await p.techLead.post(`${G(projectId)}/ai/ask`, { question: 'What is the approved actual amount of the programme figures?' });
    console.log(`SEC-P34-03 observed: retrieval → ${JSON.stringify(retrieved)}; ask → ${ask.status}, answer contains the figure: ${JSON.stringify(ask.body).includes('FIGURE-CANARY')}`);
    expect(retrieved).toEqual([]);
    expect(JSON.stringify(ask.body)).not.toContain('FIGURE-CANARY');
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('SEC-P34-05 — regulatory register: a non-legal functional approver makes the applicability determination [REQ-AGR-004]', () => {
  let reqId: string;
  let version: number;

  beforeAll(async () => {
    const r = await p.legal.post(`${G(projectId)}/regulatory-requirements`, { category: 'regulatory', authority: 'Fictional regulator (synthetic)', title: `${TAG} licence requirement (synthetic)` });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    reqId = r.body.id;
    version = (await p.legal.get(`${G(projectId)}/regulatory-requirements/${reqId}`).expect(200)).body.version;
    const roles = await owner().query(`select role from project_membership where project_id = $1 and user_id = $2 and revoked_at is null`, [projectId, p.approver.userId]);
    expect(roles.rows.map((x) => x.role)).toEqual(['functional_approver']); // no legal / regulatory role
  });

  it.fails('DEFECT SEC-P34-05: only Legal / Regulatory roles record an applicability determination (the approver is refused, 403)', async () => {
    const r = await p.approver.post(`${G(projectId)}/regulatory-requirements/${reqId}/assess-applicability`, { expectedVersion: version, applicability: 'not_applicable', basis: 'Determined by a non-legal functional approver (probe)' });
    console.log(`SEC-P34-05 observed: applicability by the functional approver → ${r.status} applicability=${r.body?.applicability ?? r.body?.code}`);
    expect(r.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('SEC-P34-06 — TSA charge shown by RBAC alone, outside the caller’s finance reach [REQ-TSA-001 security rule]', () => {
  let tsaId: string;
  let lineId: string;

  beforeAll(async () => {
    const t = await p.pm.post(`${G(projectId)}/tsa-services`, { name: `${TAG} charged TSA (synthetic)`, chargeBasis: 'Monthly fixed fee (synthetic)', charge: { amount: '4321.0000', currency: 'SAR', unitScale: 1 } });
    expect(t.status, JSON.stringify(t.body)).toBe(201);
    tsaId = t.body.id;
    const l = await p.finance.post(`${G(projectId)}/budget-lines`, { name: `${TAG} programme-level cost line (synthetic)`, category: 'one_off_separation', currency: 'SAR', unitScale: 1 });
    expect(l.status, JSON.stringify(l.body)).toBe(201);
    lineId = l.body.id;
  });

  it('CONTROL: the finance reader sees the charge, a reader without finance.record.read gets it redacted; the finance module hides project-level data from the tech lead', async () => {
    const fin = (await p.finance.get(`${G(projectId)}/tsa-services/${tsaId}`).expect(200)).body;
    expect(fin.charge).toEqual({ amount: '4321.0000', currency: 'SAR', unitScale: 1 });
    const con = (await p.contributor.get(`${G(projectId)}/tsa-services/${tsaId}`).expect(200)).body;
    expect(con.charge).toBeNull();
    expect(con.chargeBasis).toBeNull();
    expect(con.chargeRedacted).toBe(true);
    expect((await p.techLead.get(`${G(projectId)}/budget-lines/${lineId}`)).status).toBe(404); // finance reach: its workstream only
  });

  it.fails('DEFECT SEC-P34-06: the tech lead (finance.record.read on one workstream only) does not see the charge of a project-level TSA', async () => {
    const r = (await p.techLead.get(`${G(projectId)}/tsa-services/${tsaId}`).expect(200)).body;
    console.log(`SEC-P34-06 observed: charge shown to the tech lead → ${JSON.stringify({ charge: r.charge, chargeBasis: r.chargeBasis, chargeRedacted: r.chargeRedacted })}`);
    expect(r.charge).toBeNull();
    expect(r.chargeBasis).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('SEC-P34-07 — consents above the caller’s clearance are shown inside a perimeter item [access-matrix §2.3, §2.5]', () => {
  let itemId: string;
  const counterparty = `${TAG}-RESTRICTED-COUNTERPARTY Fictional Landlord`;

  beforeAll(async () => {
    const it0 = await p.pm.post(`${G(projectId)}/perimeter-items`, { type: 'contract', name: `${TAG} hall lease (synthetic)`, disposition: 'included', classification: 'confidential' });
    expect(it0.status, JSON.stringify(it0.body)).toBe(201);
    itemId = it0.body.id;
    const c = await rlegal.post(`${G(projectId)}/consents`, { perimeterItemId: itemId, counterparty, classification: 'restricted' });
    expect(c.status, JSON.stringify(c.body)).toBe(201);
  });

  it('CONTROL: the consent register hides the restricted consent from the PM (clearance confidential); its author sees it on the item', async () => {
    const list = (await p.pm.get(`${G(projectId)}/consents?pageSize=100`).expect(200)).body;
    expect(JSON.stringify(list)).not.toContain(counterparty);
    const own = (await rlegal.get(`${G(projectId)}/perimeter-items/${itemId}`).expect(200)).body;
    expect(JSON.stringify(own.consents)).toContain(counterparty);
  });

  it('SEC-P34-07 (fixed, regression): the perimeter item detail and the Day-1 positions never show a consent the caller cannot read', async () => {
    const item = (await p.pm.get(`${G(projectId)}/perimeter-items/${itemId}`).expect(200)).body;
    const day1 = (await p.pm.get(`${G(projectId)}/perimeter/day1-contract-positions`).expect(200)).body;
    console.log(`SEC-P34-07 observed: consents on the item shown to the PM → ${JSON.stringify(item.consents)}; in day-1 positions: ${JSON.stringify(day1).includes(counterparty)}`);
    expect(JSON.stringify(item)).not.toContain(counterparty);
    expect(JSON.stringify(day1)).not.toContain(counterparty);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('SEC-P34-08 — a TSA is relabelled above its editor’s clearance [access-matrix §2.4 classification]', () => {
  let tsaId: string;

  beforeAll(async () => {
    const t = await p.pm.post(`${G(projectId)}/tsa-services`, { name: `${TAG} relabel TSA (synthetic)` });
    expect(t.status, JSON.stringify(t.body)).toBe(201);
    tsaId = t.body.id;
  });

  it('CONTROL: creating a TSA above the creator’s clearance is refused', async () => {
    const r = await p.pm.post(`${G(projectId)}/tsa-services`, { name: `${TAG} over-classified TSA (synthetic)`, classification: 'strictly_confidential' });
    expect([403, 404]).toContain(r.status);
  });

  it.fails('DEFECT SEC-P34-08: PATCH may not raise the classification above the editor’s clearance (403, record unchanged)', async () => {
    const r = await p.pm.patch(`${G(projectId)}/tsa-services/${tsaId}`, { expectedVersion: 1, classification: 'strictly_confidential' });
    const row = (await owner().query(`select classification from tsa_service where id = $1`, [tsaId])).rows[0];
    console.log(`SEC-P34-08 observed: relabel by the PM (clearance confidential) → ${r.status}; stored classification ${row.classification}`);
    expect(r.status).toBe(403);
    expect(row.classification).toBe('confidential');
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('SEC-P34-11 — the "creator = owner" claim of create commands (WORK_LOG: checklist from template) [access-matrix §2.4 own_workstream]', () => {
  it('OBSERVED SEC-P34-11: a PROJECT-scoped contributor instantiates the Day-1 checklist of a site and creates a blocker check in a workstream it holds no role in', async () => {
    const site = await p.pm.post(`${G(projectId)}/sites`, { name: `${TAG} site (synthetic)` });
    expect(site.status, JSON.stringify(site.body)).toBe(201);
    const inst = await p.contributor.post(`${G(projectId)}/readiness-checks/from-template`, { siteId: site.body.id });
    expect(inst.status, JSON.stringify(inst.body)).toBe(201);
    expect(inst.body.created).toBeGreaterThan(0);
    const created = await owner().query(`select count(*)::int n, count(*) filter (where created_by = $3)::int mine, count(*) filter (where blocker)::int blockers from readiness_check where project_id = $1 and site_id = $2`, [projectId, site.body.id, p.contributor.userId]);
    expect(created.rows[0].n).toBe(inst.body.created);
    expect(created.rows[0].mine).toBe(inst.body.created); // the contributor is the creator — hence "owner" — of every template check
    const blocker = await p.contributor.post(`${G(projectId)}/readiness-checks`, { area: 'power', title: `${TAG} contributor blocker (synthetic)`, workstreamId: ws[1], blocker: true, mandatory: true, signoffRole: 'functional_approver' });
    expect(blocker.status, JSON.stringify(blocker.body)).toBe(201);
    const roles = await owner().query(`select role, workstream_id from project_membership where project_id = $1 and user_id = $2 and revoked_at is null`, [projectId, p.contributor.userId]);
    expect(roles.rows).toEqual([{ role: 'contributor', workstream_id: null }]);
    // As the creator it then edits and records tests on those checks; sign-off stays with another person (not_self).
    const moved = await p.contributor.patch(`${G(projectId)}/readiness-checks/${blocker.body.id}`, { expectedVersion: blocker.body.version, workstreamId: ws[2] });
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
  });

  it('CONTROL: the workstream lead role cannot manage a check outside its workstream through that role (strict §2.2)', async () => {
    // tech.lead also holds a project-scoped contributor role here; the workstream-only case is pinned by
    // readiness-isolation.spec.ts ("Manage only inside the workstream"). A sign-off in another workstream is refused.
    const c = await p.pm.post(`${G(projectId)}/readiness-checks`, { area: 'cooling', title: `${TAG} other-workstream check (synthetic)`, workstreamId: ws[1], signoffRole: 'workstream_lead' });
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    const r = await p.techLead.post(`${G(projectId)}/readiness-checks/${c.body.id}/sign-off`, { expectedVersion: c.body.version, outcome: 'not_applicable', note: 'probe' });
    expect(r.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('CONTROL — 404 for out-of-scope ids, problem+json without internals, denied mutations audited', () => {
  it('a Project-B user and an unknown id get the same 404 problem body (no existence leak, no stack)', async () => {
    const t = await p.pm.post(`${G(projectId)}/tsa-services`, { name: `${TAG} scope TSA (synthetic)` });
    expect(t.status).toBe(201);
    const pmB = await loginAs('pm.b');
    const foreign = await pmB.get(`${G(projectId)}/tsa-services/${t.body.id}`);
    const unknown = await p.pm.get(`${G(projectId)}/tsa-services/0192f0c0-0000-7000-8000-000000000001`);
    for (const r of [foreign, unknown]) {
      expect(r.status).toBe(404);
      expect(r.headers['content-type']).toMatch(/application\/problem\+json/);
      expect(Object.keys(r.body).sort()).toEqual(['code', 'correlationId', 'detail', 'status', 'title', 'type']);
      expect(JSON.stringify(r.body)).not.toMatch(/stack|select |at Object\.|\.ts:/i);
    }
    expect(foreign.body.code).toBe(unknown.body.code);
    expect(foreign.body.detail).toBe(unknown.body.detail);
    // A body id of another project is refused like an unknown one (TSA of this project cited by Project B's PM is 404).
    const cross = await pmB.post(`${G(projectId)}/tsa-services`, { name: 'x' });
    expect(cross.status).toBe(404);
  });

  it('a denied mutation (contributor creates a TSA) is refused 403 and audited with outcome denied', async () => {
    const before = new Date(Date.now() - 1000).toISOString();
    const r = await p.contributor.post(`${G(projectId)}/tsa-services`, { name: `${TAG} denied TSA (synthetic)` });
    expect(r.status).toBe(403);
    const a = await owner().query(`select outcome, action, reason from audit_event where project_id = $1 and actor_user_id = $2 and created_at >= $3 and outcome = 'denied'`, [projectId, p.contributor.userId, before]);
    expect(a.rows.map((x) => x.action)).toContain('readiness.createTsaService');
  });
});
