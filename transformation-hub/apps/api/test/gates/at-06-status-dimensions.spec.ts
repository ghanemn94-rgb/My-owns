import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApp, closePools, loginAs, owner, projectIdByCode, DC } from '../helpers';
import { setupProject, runWorker, Personas } from './gate-test-kit';

/**
 * AT-06: incorporation confirmed while assets/contracts/operations remain pending → the dimensions stay separate and the
 * carve-out is never shown as complete. Register rows (legal entity verification, perimeter items) are written with the
 * owner pool because the newco/carveout APIs are not in this worktree; the dimension computation, versioning, audit and
 * the worker subscription are exercised for real.
 */
let projectId: string;
let orgId: string;
let p: Personas;

type Dim = { key: string; state: string; explanation: string | null; version: number };
const state = (items: Dim[]) => Object.fromEntries(items.map((d) => [d.key, d.state]));

beforeAll(async () => {
  ({ projectId, orgId, p } = await setupProject('GT-AT06'));
  // NewCo incorporated with VERIFIED evidence (as the newco module records it after Legal verification).
  await owner().query(
    `update legal_entity set incorporation_status = 'incorporated', incorporation_verification = 'confirmed'
      where id = (select legal_entity_id from project_entity where project_id = $1 and role = 'newco')`,
    [projectId],
  );
  // … with the active evidence that verification requires (DOM-P3-08: a verification without valid evidence reads
  // "evidence pending").
  await owner().query(
    `insert into evidence_link (org_id, project_id, target_type, target_id, note, added_by)
     select $1, $2, 'legal_entity', legal_entity_id, 'Synthetic registration extract (test)', $3 from project_entity where project_id = $2 and role = 'newco'`,
    [orgId, projectId, p.pm.userId],
  );
  // Perimeter: one item transfer in progress, one not started; one excluded item.
  await owner().query(
    `insert into perimeter_item (id, org_id, project_id, code, type, name, disposition, transfer_status, economic_transfer_status)
     values (gen_random_uuid(), $1, $2, 'PI-1', 'site', 'Test site A (synthetic)', 'included', 'in_progress', 'in_progress'),
            (gen_random_uuid(), $1, $2, 'PI-2', 'contract', 'Test customer contract (synthetic)', 'included', 'not_started', 'not_started'),
            (gen_random_uuid(), $1, $2, 'PI-3', 'asset', 'Retained asset (synthetic)', 'excluded', 'not_applicable', 'not_applicable')`,
    [orgId, projectId],
  );
});
afterAll(async () => {
  await closeApp();
  await closePools();
});

describe('AT-06 — independent status dimensions [REQ-LCY-006, REQ-LCY-007, REQ-LCY-014]', () => {
  it('recompute keeps incorporation verified while perimeter and readiness stay pending; carve-out not complete', async () => {
    const r = await p.pm.post(`/api/v1/projects/${projectId}/status-dimensions/recompute`, {});
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(state(r.body.items)).toEqual({
      incorporation: 'incorporated_verified',
      perimeter_transfer: 'transfer_in_progress',
      operational_readiness: 'readiness_in_progress',
      jv_transaction: 'not_started',
    });
    expect(r.body.carveOutComplete).toBe(false);
    // readable by any project member (contributor), with the same answer
    const g = await p.contributor.get(`/api/v1/projects/${projectId}/status-dimensions`).expect(200);
    expect(state(g.body.items)).toEqual(state(r.body.items));
    expect(g.body.carveOutComplete).toBe(false);
  });

  it('each change is versioned (record_version) and audited', async () => {
    const rows = await owner().query(`select id, key, version from status_dimension where project_id = $1`, [projectId]);
    const inc = rows.rows.find((x) => x.key === 'incorporation')!;
    expect(inc.version).toBe(2); // not_assessed → incorporated_verified
    const hist = await owner().query(`select version_no, snapshot from record_version where entity_type = 'status_dimension' and entity_id = $1 order by version_no`, [inc.id]);
    expect(hist.rows.map((h) => [h.version_no, h.snapshot.state])).toEqual([
      [1, 'not_assessed'],
      [2, 'incorporated_verified'],
    ]);
    const audit = await owner().query(`select count(*)::int as n from audit_event where project_id = $1 and action = 'gates.status_dimension.recompute'`, [projectId]);
    expect(audit.rows[0].n).toBe(4);
    // recomputing without changes does not create new versions
    await p.pm.post(`/api/v1/projects/${projectId}/status-dimensions/recompute`, {}).expect(201);
    const again = await owner().query(`select version from status_dimension where id = $1`, [inc.id]);
    expect(again.rows[0].version).toBe(2);
  });

  it('a perimeter change reaches the dimensions through the worker (perimeter.changed → gates.recompute_dimensions)', async () => {
    // Legal transfer verified for both items, but economic transfer still pending on one → not transferred (D-05).
    await owner().query(`update perimeter_item set transfer_status = 'transferred_verified' where project_id = $1 and disposition = 'included'`, [projectId]);
    await owner().query(`update perimeter_item set economic_transfer_status = 'transferred_verified' where project_id = $1 and code = 'PI-1'`, [projectId]);
    await owner().query(`insert into outbox_event (id, org_id, project_id, type, aggregate_type, payload) values (gen_random_uuid(), $1, $2, 'perimeter.changed', 'perimeter_item', '{}'::jsonb)`, [orgId, projectId]);
    await runWorker();
    let d = (await p.pm.get(`/api/v1/projects/${projectId}/status-dimensions`).expect(200)).body;
    // One in-scope item fully transferred and verified, the other not (combined not started) → partially transferred.
    expect(state(d.items).perimeter_transfer).toBe('partially_transferred');

    await owner().query(`update perimeter_item set economic_transfer_status = 'transferred_verified' where project_id = $1 and disposition = 'included'`, [projectId]);
    await owner().query(`insert into outbox_event (id, org_id, project_id, type, aggregate_type, payload) values (gen_random_uuid(), $1, $2, 'perimeter.changed', 'perimeter_item', '{}'::jsonb)`, [orgId, projectId]);
    await runWorker();
    d = (await p.pm.get(`/api/v1/projects/${projectId}/status-dimensions`).expect(200)).body;
    // Incorporation verified AND perimeter transferred — still not complete while operational readiness is pending.
    expect(state(d.items)).toMatchObject({ incorporation: 'incorporated_verified', perimeter_transfer: 'transferred_verified', operational_readiness: 'readiness_in_progress' });
    expect(d.carveOutComplete).toBe(false);
    const job = await owner().query(`select status, result from job where project_id = $1 and kind = 'gates.recompute_dimensions' order by created_at desc limit 1`, [projectId]);
    expect(job.rows[0].status).toBe('succeeded');
    const audit = await owner().query(`select actor_kind from audit_event where project_id = $1 and action = 'gates.status_dimension.recompute' order by seq desc limit 1`, [projectId]);
    expect(audit.rows[0].actor_kind).toBe('service');
  });

  it('TSAs and approved enduring arrangements are shown in the independence explanation (REQ-LCY-014)', async () => {
    await owner().query(
      `insert into tsa_service (id, org_id, project_id, code, name, status, is_enduring_arrangement)
       values (gen_random_uuid(), $1, $2, 'TSA-1', 'Test NOC service (synthetic)', 'active', false),
              (gen_random_uuid(), $1, $2, 'TSA-2', 'Test shared procurement (synthetic)', 'active', true)`,
      [orgId, projectId],
    );
    const r = await p.pm.post(`/api/v1/projects/${projectId}/status-dimensions/recompute`, {}).expect(201);
    const ops = r.body.items.find((x: Dim) => x.key === 'operational_readiness');
    expect(ops.explanation).toMatch(/1 transitional service\(s\) not yet exited, 1 approved enduring arrangement/);
  });

  it('recompute is a controlled command (contributor 403); other projects are invisible (404)', async () => {
    expect((await p.contributor.post(`/api/v1/projects/${projectId}/status-dimensions/recompute`, {})).status).toBe(403);
    const pmB = await loginAs('pm.b');
    expect((await pmB.get(`/api/v1/projects/${projectId}/status-dimensions`)).status).toBe(404);
    expect((await pmB.get(`/api/v1/projects/${await projectIdByCode(DC)}/gates`)).status).toBe(404);
  });

  it('the demo project dimensions were computed by the gates seed', async () => {
    const dc = await projectIdByCode(DC);
    const r = await p.pm.get(`/api/v1/projects/${dc}/status-dimensions`).expect(200);
    expect(r.body.items).toHaveLength(4);
    expect(r.body.items.every((d: Dim) => d.state !== 'not_assessed' && d.version >= 2)).toBe(true);
    expect(r.body.carveOutComplete).toBe(false);
  });
});
