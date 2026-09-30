import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApp, closePools, loginAs, owner, Client } from '../helpers';
import { setupProject, setupGovernance, gateByKey, meetAllMandatory, Personas, Gov } from '../gates/gate-test-kit';
import { paper } from '../governance/gov-fixtures';
import { createProject, grant, milestone, task, workstreams } from '../planning/fixtures';
import { createWithVersion, login as docLogin } from '../documents/doc-helpers';

/**
 * P2 security review probes (docs/reviews/P2-security-review.md). Written by the security-privacy-reviewer; no
 * implementation file and no existing test was changed. Three kinds of test:
 *  - `DEFECT SEC-P2-xx` asserts the REQUIRED behaviour and fails until the finding is fixed (do not weaken it);
 *  - `OBSERVED SEC-P2-xx` pins the CURRENT behaviour of a Low / design finding so the report's evidence is reproducible
 *    (update it together with the fix);
 *  - `CONTROL` confirms a control the review relies on.
 * Every project is created by the test (synthetic data only).
 */
let projectId: string;
let p: Personas;
let gov: Gov;
let admin: Client;

const G = (pid: string) => `/api/v1/projects/${pid}`;
const gateCmd = (pid: string, gateId: string, cmd: string) => `${G(pid)}/gates/${gateId}/assessment/${cmd}`;
type WorkItem = { type: string; entityId: string; projectId: string };
const myWork = async (c: Client, pid: string) => ((await c.get('/api/v1/me/work').expect(200)).body.items as WorkItem[]).filter((i) => i.projectId === pid);

beforeAll(async () => {
  // The sponsor also holds project_manager here (like the DOM-P2-16 spec): it is a G0 gate reviewer AND the G0 approver.
  ({ projectId, p } = await setupProject('SECP2-GT', [['sponsor', 'project_manager']]));
  gov = await setupGovernance(projectId, p);
  admin = await loginAs('portfolio.admin');
}, 600_000);
afterAll(async () => {
  await closeApp();
  await closePools();
});

describe('§2.2 design question — a workstream-only workstream lead (G1 owner) [access-matrix §2.2, DOM-P2-16]', () => {
  it('OBSERVED: can start G1 as its owner, but GET /gates and GET /gates/:id answer 403 (the stricter reach rule)', async () => {
    const scope = await owner().query(`select role, workstream_id from project_membership where project_id = $1 and user_id = $2 and revoked_at is null`, [projectId, p.techLead.userId]);
    expect(scope.rows).toHaveLength(1); // workstream_lead on ONE workstream, no project-wide role
    expect(scope.rows[0].role).toBe('workstream_lead');
    expect(scope.rows[0].workstream_id).not.toBeNull();
    const g1 = await gateByKey(p.pm, projectId, 'G1');
    expect((await p.techLead.get(`${G(projectId)}/gates`)).status).toBe(403);
    expect((await p.techLead.get(`${G(projectId)}/gates/${g1.id}`)).status).toBe(403);
    const start = await p.techLead.post(gateCmd(projectId, g1.id, 'start'), { expectedVersion: g1.assessment.version });
    expect(start.status, JSON.stringify(start.body)).toBe(201);
    // …and the command response itself carries the gate evaluation the read routes refuse.
    expect(start.body.evaluation).toBeTruthy();
    // Project-level planning aggregates are refused the same way (assertProjectRead).
    expect((await p.techLead.get(`${G(projectId)}/schedule`)).status).toBe(403);
  });

  it('OBSERVED SEC-P2-08: the same principal LISTS and SEARCHES project documents (titles) but GET /documents/:id answers 403', async () => {
    const pmDocs = await docLogin('pm');
    const d = await createWithVersion(pmDocs, projectId, { title: 'Internal project memo SECP2 (synthetic)', classification: 'internal' }, { bytes: Buffer.from('synthetic,3\n', 'utf8'), name: 'memo.csv' });
    expect(d.upload.status, JSON.stringify(d.upload.body)).toBe(201);
    const list = (await p.techLead.get(`${G(projectId)}/documents?pageSize=100`).expect(200)).body as { items: { id: string }[] };
    expect(list.items.map((i) => i.id)).toContain(d.id);
    const search = (await p.techLead.get(`${G(projectId)}/documents/search?q=SECP2`).expect(200)).body as { items: { documentId: string }[] };
    expect(search.items.map((i) => i.documentId)).toContain(d.id);
    expect((await p.techLead.get(`${G(projectId)}/documents/${d.id}`)).status).toBe(403);
  });
});

describe('SEC-P2-01 — prerequisites disclose the predecessor record to callers without its read permission [DOM-P2-18]', () => {
  let taskId: string;
  let decisionId: string;
  let agreementId: string;
  let decisionTitle: string;
  let agreementTitle: string;

  beforeAll(async () => {
    const ws = (await p.pm.get(`${G(projectId)}/workstreams`).expect(200)).body.items as { id: string }[];
    taskId = await task(p.pm, projectId, ws[1]!.id, 'Task waiting for a decision and an agreement (synthetic)', { durationDays: 2 });
    decisionTitle = 'Confidential steering decision SECP2 probe (synthetic)';
    const d = await p.pm.post(`${G(projectId)}/decisions`, paper(gov.committeeId, { title: decisionTitle }));
    expect(d.status, JSON.stringify(d.body)).toBe(201);
    decisionId = d.body.id;
    agreementTitle = 'Asset transfer agreement SECP2 probe (synthetic)';
    const a = await p.pm.post(`${G(projectId)}/agreements`, { kindLabel: 'ATA', title: agreementTitle, ownerUserId: p.pm.userId });
    expect(a.status, JSON.stringify(a.body)).toBe(201);
    agreementId = a.body.id;
    for (const [type, id] of [['decision', decisionId], ['agreement', agreementId]] as const) {
      const r = await p.pm.post(`${G(projectId)}/prerequisites`, { successorType: 'task', successorId: taskId, predecessorType: type, predecessorId: id });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
    }
  }, 300_000);

  it('CONTROL: the portfolio administrator holds planning.plan.read but may not read decisions or agreements', async () => {
    expect((await admin.get(`${G(projectId)}/tasks/${taskId}`)).status).toBe(200);
    expect((await admin.get(`${G(projectId)}/decisions/${decisionId}`)).status).toBe(403);
    expect((await admin.get(`${G(projectId)}/agreements/${agreementId}`)).status).toBe(403);
  });

  it('DEFECT SEC-P2-01: the prerequisite list never shows a decision / agreement to a caller who cannot read it', async () => {
    const items = (await admin.get(`${G(projectId)}/prerequisites?successorId=${taskId}`).expect(200)).body.items as { predecessorId: string; predecessorLabel: string }[];
    const leaked = items.filter((i) => i.predecessorId === decisionId || i.predecessorId === agreementId).map((i) => i.predecessorLabel);
    expect(leaked, `labels shown to the portfolio administrator: ${JSON.stringify(leaked)}`).toEqual([]);
  });

  it('DEFECT SEC-P2-01: the activity feed lists a prerequisite only when its predecessor is readable (record-visibility rule)', async () => {
    const feed = (await admin.get(`${G(projectId)}/activity?entityType=record_dependency&pageSize=100`).expect(200)).body as { total: number };
    expect(feed.total, 'record_dependency events listed to the portfolio administrator').toBe(0);
  });
});

describe('SEC-P2-02 — decision separation of duties: the paper editor / submitter votes on it [access-matrix §5.1]', () => {
  it('DEFECT SEC-P2-02: a member who rewrote and submitted the paper cannot vote on it', async () => {
    const d = (await p.pm.post(`${G(projectId)}/decisions`, paper(gov.committeeId, { title: 'Paper drafted by the PM, rewritten by Finance (synthetic)' })).expect(201)).body;
    const edited = await p.finance.patch(`${G(projectId)}/decisions/${d.id}`, { expectedVersion: d.version, recommendation: 'Approve the larger option (rewritten by the finance member, synthetic)' });
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    const sub = await p.finance.post(`${G(projectId)}/decisions/${d.id}/submit`, { expectedVersion: edited.body.version });
    expect(sub.status, JSON.stringify(sub.body)).toBe(201);
    const rev = await p.secretary.post(`${G(projectId)}/decisions/${d.id}/start-review`, { expectedVersion: sub.body.version, meetingId: gov.meetingId });
    expect(rev.status, JSON.stringify(rev.body)).toBe(201);
    const v = await p.finance.post(`${G(projectId)}/decisions/${d.id}/votes`, { expectedVersion: rev.body.version, choice: 'approve' });
    expect(v.status, JSON.stringify(v.body)).toBe(403);
  });
});

describe('SEC-P2-03 — My Work offers a gate decision the command refuses (gate reviewer holding the approver role) [DOM-P2-16]', () => {
  it('OBSERVED: the sponsor endorsed G0 (as PM) and holds the approver role: offered gate_decision, refused by decide (403)', async () => {
    let g0 = await gateByKey(p.pm, projectId, 'G0');
    expect([g0.ownerRole, g0.reviewerRole, g0.approverRole]).toEqual(['secretary_cpmo', 'project_manager', 'sponsor']);
    await p.secretary.post(gateCmd(projectId, g0.id, 'start'), { expectedVersion: g0.assessment.version }).expect(201);
    await meetAllMandatory(p, projectId, 'G0');
    g0 = await gateByKey(p.pm, projectId, 'G0');
    await p.sponsor.post(gateCmd(projectId, g0.id, 'review'), { expectedVersion: g0.assessment.version, outcome: 'endorse', note: 'Endorsed (synthetic)' }).expect(201);
    g0 = await gateByKey(p.pm, projectId, 'G0');
    await p.secretary.post(gateCmd(projectId, g0.id, 'mark-ready'), { expectedVersion: g0.assessment.version }).expect(201);
    g0 = await gateByKey(p.pm, projectId, 'G0');
    expect(g0.assessment.reviewedBy).toBe(p.sponsor.userId);
    const offered = (await myWork(p.sponsor, projectId)).some((i) => i.type === 'gate_decision' && i.entityId === g0.assessment.id);
    expect(offered).toBe(true); // OBSERVED: the inbox passes only the submitter as not_self subject
    const decide = await p.sponsor.post(gateCmd(projectId, g0.id, 'decide'), { expectedVersion: g0.assessment.version, outcome: 'reject', note: 'probe (synthetic)' });
    expect(decide.status).toBe(403); // the command: not the submitter NOR the gate reviewer
  }, 300_000);
});

describe('SEC-P2-05 — evidence can be linked to a gate criterion the caller does not own [gates.evidence.attach C,W]', () => {
  it('OBSERVED: a contributor links evidence to a legal-owned G2 criterion (201) but may not submit it (403)', async () => {
    const g2 = await gateByKey(p.pm, projectId, 'G2');
    expect(g2.ownerRole).toBe('legal_restricted');
    const c = g2.criteria[0]!;
    const link = await p.contributor.post(`${G(projectId)}/evidence`, { targetType: 'gate_criterion', targetId: c.id, note: 'Linked by a contributor (synthetic probe)' });
    expect(link.status, JSON.stringify(link.body)).toBe(201);
    const submit = await p.contributor.post(`${G(projectId)}/gates/${g2.id}/criteria/${c.id}/submit-evidence`, { expectedVersion: c.assessment.version });
    expect(submit.status).toBe(403);
  });
});

describe('SEC-P2-06 — disposal endpoint answers before authorization (existence of hidden documents)', () => {
  it('OBSERVED: for a document the caller cannot see, dispose answers 422 (known id) vs 404 (unknown id)', async () => {
    const sponsorDocs = await docLogin('sponsor');
    const hidden = await createWithVersion(sponsorDocs, projectId, { title: 'Restricted probe document (synthetic)', classification: 'restricted' }, { bytes: Buffer.from('synthetic,1\n', 'utf8'), name: 'restricted-probe.csv' });
    expect(hidden.upload.status, JSON.stringify(hidden.upload.body)).toBe(201);
    const legalDocs = await docLogin('legal');
    expect((await legalDocs.get(`${G(projectId)}/documents/${hidden.id}`)).status).toBe(404); // hidden from legal (clearance)
    // Any pending disposal request id of the project (here: the contributor's own internal document).
    const contributorDocs = await docLogin('contributor');
    const own = await createWithVersion(contributorDocs, projectId, { title: 'Contributor working note (synthetic)', classification: 'internal' }, { bytes: Buffer.from('synthetic,2\n', 'utf8'), name: 'note.csv' });
    expect(own.upload.status, JSON.stringify(own.upload.body)).toBe(201);
    const docV = (await contributorDocs.get(`${G(projectId)}/documents/${own.id}`).expect(200)).body.version as number;
    const req = await contributorDocs.post(`${G(projectId)}/documents/${own.id}/disposal-requests`, { expectedVersion: docV, reason: 'Probe (synthetic)' });
    expect(req.status, JSON.stringify(req.body)).toBe(201);
    const known = await legalDocs.post(`${G(projectId)}/documents/${hidden.id}/dispose`, { expectedVersion: 1, requestId: req.body.requestId, reason: 'probe' });
    const unknown = await legalDocs.post(`${G(projectId)}/documents/0192f0c0-0000-7000-8000-000000000001/dispose`, { expectedVersion: 1, requestId: req.body.requestId, reason: 'probe' });
    expect(unknown.status).toBe(404);
    expect(known.status).toBe(422); // OBSERVED: differs from the unknown id (should be 404 like a missing document)
    expect(known.body.code).toBe('documents.disposal_request_invalid');
  });
});

describe('Cross-project dependencies and prerequisites — minimum disclosure and database guards [DOM-P2-17/18]', () => {
  let pm: Client;
  let opsLead: Client;
  let A: string;
  let B: string;
  let msB: string;
  let taskA: string;
  let agrB: string;

  beforeAll(async () => {
    pm = await loginAs('pm');
    opsLead = await loginAs('ops.lead');
    A = await createProject(admin, pm, 'SECP2-XA');
    B = await createProject(admin, pm, 'SECP2-XB');
    const wsA = await workstreams(pm, A);
    await grant(admin, A, opsLead, 'workstream_lead', wsA.get('WS02')!.id); // workstream-only in A
    await grant(admin, B, opsLead, 'contributor'); // project-wide reader in B
    taskA = await task(pm, A, wsA.get('WS03')!.id, 'Task in A (synthetic)', { durationDays: 2 });
    msB = await milestone(pm, B, (await workstreams(pm, B)).get('WS01')!.id, 'Milestone in B (synthetic)', { plannedDate: '2026-12-15' });
    const agr = await pm.post(`${G(B)}/agreements`, { kindLabel: 'TSA', title: 'Agreement of B (synthetic)', ownerUserId: pm.userId });
    expect(agr.status, JSON.stringify(agr.body)).toBe(201);
    agrB = agr.body.id;
  }, 300_000);

  it('OBSERVED SEC-P2-07: a project-level dependency of A (no local item) is shown to a workstream-only reader of A', async () => {
    const r = await pm.post(`${G(A)}/cross-project-dependencies`, { otherProjectId: B, otherItemType: 'milestone', otherItemId: msB, description: 'Project-level dependency of A on B (synthetic)' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect((await opsLead.get(`${G(A)}/schedule`)).status).toBe(403); // no project-level planning read in A
    const list = (await opsLead.get(`${G(A)}/cross-project-dependencies`).expect(200)).body as { total: number; items: { id: string; description: string }[] };
    expect(list.items.map((i) => i.id)).toContain(r.body.id); // OBSERVED (lenient §2.2 reading), unlike schedule / gates
  });

  it('CONTROL: the activity feed never lists cross_project_dependency events to non-auditors (404 for the type)', async () => {
    expect((await pm.get(`${G(A)}/activity?entityType=cross_project_dependency`)).status).toBe(404);
  });

  it('OBSERVED SEC-P2-04: the database accepts a prerequisite predecessor of another project, and an other-item that is not in the other project', async () => {
    const c = await owner().connect();
    try {
      await c.query('begin');
      const orgId = (await c.query<{ org_id: string }>('select org_id from project where id = $1', [A])).rows[0]!.org_id;
      // record_dependency in A whose predecessor is an agreement of B: no trigger / FK refuses it.
      await c.query(
        `insert into record_dependency (id, org_id, project_id, successor_type, successor_id, predecessor_type, predecessor_id) values (gen_random_uuid(), $1, $2, 'task', $3, 'agreement', $4)`,
        [orgId, A, taskA, agrB],
      );
      // cross_project_dependency A → B whose "other item" is a task of A (not of B): accepted as well.
      await c.query(
        `insert into cross_project_dependency (id, org_id, project_id, other_project_id, other_item_type, other_item_id, description) values (gen_random_uuid(), $1, $2, $3, 'task', $4, 'probe (synthetic)')`,
        [orgId, A, B, taskA],
      );
    } finally {
      await c.query('rollback');
      c.release();
    }
  });
});
