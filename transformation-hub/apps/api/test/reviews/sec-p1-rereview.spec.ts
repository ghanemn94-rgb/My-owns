import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApp, closePools, DC, GEN, loginAs, owner, projectIdByCode, demoUserId } from '../helpers';

/**
 * P1 security RE-REVIEW (docs/reviews/P1-security-rereview.md) — reproducible defects found at 08981f2.
 * Every test below asserts the SECURE behaviour and FAILS on the reviewed revision; each one names its finding.
 * Fixtures are created through the owner role and removed (or neutralised) in `finally` blocks so the rest of the
 * suite is unaffected.
 */
let dcId: string;
let genId: string;
let orgId: string;

beforeAll(async () => {
  dcId = await projectIdByCode(DC);
  genId = await projectIdByCode(GEN);
  orgId = (await owner().query('select org_id from project where id = $1', [dcId])).rows[0].org_id;
});
afterAll(async () => {
  await closeApp();
  await closePools();
});

describe('P1 security re-review — defects', () => {
  it('DEFECT SEC-P1R-01: CSRF denials are audited BEFORE the rate limiter, so one session can write unbounded audit rows', async () => {
    const pm = await loginAs('pm');
    const count = async () => Number((await owner().query(`select count(*)::int n from audit_event where action = 'auth.csrf' and actor_user_id = $1`, [pm.userId])).rows[0].n);
    const before = await count();
    const statuses: Record<number, number> = {};
    for (let i = 0; i < 150; i++) {
      const r = await pm.agent.post('/api/v1/me/locale').send({ locale: 'en' }); // no x-csrf-token header
      statuses[r.status] = (statuses[r.status] ?? 0) + 1;
    }
    const added = (await count()) - before;
    // Secure behaviour: the session is throttled like any other mutation (default 120/min) and the audit chain stops growing.
    // Observed at 08981f2: {"403":150} and 150 audit rows (each in its own detached transaction/connection).
    expect(statuses[429] ?? 0, JSON.stringify(statuses)).toBeGreaterThan(0);
    expect(added).toBeLessThanOrEqual(120);
  });

  it('DEFECT SEC-P1R-02: the activity feed still shows events of records whose visibility is inherited (meeting of a restricted committee)', async () => {
    const auditor = await loginAs('auditor'); // clearance: confidential
    const [c] = (await owner().query(`select c.id, c.classification from committee c where c.project_id = $1 and exists (select 1 from meeting m where m.committee_id = c.id) order by c.created_at limit 1`, [dcId])).rows;
    const [m] = (await owner().query(`select id from meeting where committee_id = $1 order by created_at limit 1`, [c.id])).rows;
    await owner().query(`update committee set classification = 'restricted' where id = $1`, [c.id]);
    try {
      // the meeting itself is invisible (it inherits the committee classification) …
      expect((await auditor.get(`/api/v1/projects/${dcId}/meetings/${m.id}`)).status).toBe(404);
      // … so its history must be invisible too (same answer as for an unknown id: no existence oracle, no actors/actions/reasons)
      const act = await auditor.get(`/api/v1/projects/${dcId}/activity?entityType=meeting&entityId=${m.id}`).expect(200);
      expect(act.body.total, JSON.stringify(act.body.items?.[0] ?? null)).toBe(0);
    } finally {
      await owner().query(`update committee set classification = $2 where id = $1`, [c.id, c.classification]);
    }
  });

  it('DEFECT SEC-P1R-03: a shared legal entity can be changed from another project without any trace in the owning project', async () => {
    const [le] = (await owner().query(`select le.id, le.name, le.version from project_entity pe join legal_entity le on le.id = pe.legal_entity_id where pe.project_id = $1 and pe.role = 'newco'`, [dcId])).rows;
    // The entity is linked to project B as well (legitimately done through POST …/legal-entities/link by someone who sees both).
    const link = (await owner().query(`insert into project_entity (org_id, project_id, legal_entity_id, role) values ($1,$2,$3,'other') returning id`, [orgId, genId, le.id])).rows[0].id;
    try {
      const pmB = await loginAs('pm.b'); // project manager of project B only — no access to the DC project at all
      const pm = await loginAs('pm');
      const r = await pmB.patch(`/api/v1/projects/${genId}/legal-entities/${le.id}`, { expectedVersion: le.version, name: 'Renamed from project B (SEC-P1R-03 test)' });
      const dcView = await pm.get(`/api/v1/projects/${dcId}/legal-entities/${le.id}`).expect(200);
      const dcActivity = await pm.get(`/api/v1/projects/${dcId}/activity?entityType=legal_entity&entityId=${le.id}`).expect(200);
      // Secure behaviour: either the change is refused for someone who is not a member of every project using the entity,
      // or the owning project sees it in its own history / activity. Observed: 200, name changed, DC history [] and DC activity 0.
      const refused = r.status === 403 || r.status === 404;
      const traced = dcView.body.history.length > 0 || dcActivity.body.total > 0;
      expect(refused || traced, `PATCH from B -> ${r.status}; DC sees name "${dcView.body.name}", history ${dcView.body.history.length}, activity ${dcActivity.body.total}`).toBe(true);
    } finally {
      await owner().query(`update legal_entity set name = $2 where id = $1`, [le.id, le.name]);
      await owner().query(`delete from project_entity where id = $1`, [link]);
    }
  });

  it('DEFECT SEC-P1R-04: listing evidence does not check the target module read permission (JV closing-condition notes readable by a contributor)', async () => {
    const contributor = await loginAs('contributor'); // holds documents.document.read, NOT jv.deal.read
    const cc = (await owner().query(`insert into closing_condition (org_id, project_id, reference, title) values ($1,$2,'SECRR-CP-1','Closing condition (SEC-P1R-04 test, synthetic)') returning id`, [orgId, dcId])).rows[0].id;
    const link = (await owner().query(`insert into evidence_link (org_id, project_id, target_type, target_id, note, status, added_by, purpose) values ($1,$2,'closing_condition',$3,'Negotiation note (SEC-P1R-04 test, synthetic)','active',$4,'test') returning id`, [orgId, dcId, cc, await demoUserId('legal')])).rows[0].id;
    try {
      const r = await contributor.get(`/api/v1/projects/${dcId}/evidence?targetType=closing_condition&targetId=${cc}`);
      // Secure behaviour: 404 (the caller cannot read closing conditions). Observed: 200 with the note text.
      expect(r.status, JSON.stringify(r.body).slice(0, 300)).toBe(404);
    } finally {
      await owner().query(`update evidence_link set status = 'rejected' where id = $1`, [link]);
    }
  });

  it('DEFECT SEC-P1R-05: register evidence counts include links to documents the caller cannot read', async () => {
    const contributor = await loginAs('contributor'); // clearance: confidential
    const check = (await owner().query(`select id from readiness_check where project_id = $1 order by created_at limit 1`, [dcId])).rows[0].id;
    const doc = (await owner().query(`insert into document (org_id, project_id, title, kind, classification) values ($1,$2,'Restricted evidence (SEC-P1R-05 test, synthetic)','evidence','restricted') returning id`, [orgId, dcId])).rows[0].id;
    const link = (await owner().query(`insert into evidence_link (org_id, project_id, target_type, target_id, document_id, status, added_by, purpose) values ($1,$2,'readiness_check',$3,$4,'active',$5,'test') returning id`, [orgId, dcId, check, doc, await demoUserId('sponsor')])).rows[0].id;
    try {
      const list = await contributor.get(`/api/v1/projects/${dcId}/evidence?targetType=readiness_check&targetId=${check}`).expect(200);
      const reg = await contributor.get(`/api/v1/projects/${dcId}/readiness-checks?pageSize=100`).expect(200);
      const row = reg.body.items.find((x: { id: string }) => x.id === check);
      // The evidence list omits the restricted link "including from the total" (contract summary); the register count must agree.
      expect(row.evidence.active).toBe(list.body.items.filter((i: { status: string }) => i.status === 'active').length);
    } finally {
      await owner().query(`update evidence_link set status = 'rejected' where id = $1`, [link]);
      await owner().query(`update document set deleted_at = now() where id = $1`, [doc]);
    }
  });

  it('DEFECT SEC-P1R-06: a denied cross-project mutation is audited without the attempted project or target (SEC-P1-11 residual)', async () => {
    const pmB = await loginAs('pm.b');
    const mem = (await owner().query(`select id from project_membership where project_id = $1 order by created_at limit 1`, [dcId])).rows[0].id;
    const r = await pmB.post(`/api/v1/projects/${dcId}/members/${mem}/revoke`, { reason: 'SEC-P1R-06 test' });
    expect(r.status).toBe(404);
    const [row] = (await owner().query(`select project_id, entity_id, after, reason from audit_event where actor_user_id = $1 and outcome = 'denied' order by seq desc limit 1`, [pmB.userId])).rows;
    // Secure behaviour (SEC-P1-11 recommendation): the attempted project and target ids are kept as plain values for
    // investigation. Observed: project_id null, entity_id null, after null, reason "not_found: Resource not found".
    expect(JSON.stringify(row)).toContain(dcId);
    expect(JSON.stringify(row)).toContain(mem);
  });
});
