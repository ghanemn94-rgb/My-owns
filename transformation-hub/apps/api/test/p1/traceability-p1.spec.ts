import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApp, closePools, DC, loginAs, owner, projectIdByCode } from '../helpers';
import { setupProject } from '../gates/gate-test-kit';

/**
 * Acceptance tests named in the requirement register that had no dedicated test at the P1 review (QA-P1-10):
 * REQ-ENT-003 (one legal entity in two projects, no duplication) and REQ-DAT-009 (soft-deleted records hidden from
 * lists and totals). Each creates its own records.
 */
let dcId: string;
let orgId: string;

beforeAll(async () => {
  dcId = await projectIdByCode(DC);
  orgId = (await owner().query('select org_id from project where id = $1', [dcId])).rows[0].org_id;
});
afterAll(async () => {
  await closeApp();
  await closePools();
});

describe('REQ-ENT-003 — a legal entity is separate from the project', () => {
  it('one entity is linked to two projects without being duplicated; each project sees the same entity', async () => {
    const { projectId: a, p } = await setupProject('TR-ENT3-A');
    const { projectId: b } = await setupProject('TR-ENT3-B');
    const listA = (await p.pm.get(`/api/v1/projects/${a}/legal-entities`).expect(200)).body.items as { id: string; role: string }[];
    const newco = listA.find((e) => e.role === 'newco')!.id;
    const before = Number((await owner().query('select count(*)::int n from legal_entity where org_id = $1', [orgId])).rows[0].n);

    // The PM of both projects links project A's NewCo into project B (as a counterparty of B's own separation).
    const r = await p.pm.post(`/api/v1/projects/${b}/legal-entities/link`, { legalEntityId: newco, role: 'counterparty' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.id).toBe(newco);

    const after = Number((await owner().query('select count(*)::int n from legal_entity where org_id = $1', [orgId])).rows[0].n);
    expect(after).toBe(before); // linked, not copied
    const links = await owner().query<{ project_id: string; role: string }>('select project_id, role::text as role from project_entity where legal_entity_id = $1 order by role::text', [newco]);
    expect(links.rows).toEqual([
      { project_id: b, role: 'counterparty' },
      { project_id: a, role: 'newco' },
    ]);
    const listB = (await p.pm.get(`/api/v1/projects/${b}/legal-entities`).expect(200)).body.items as { id: string; role: string }[];
    expect(listB.filter((e) => e.id === newco).map((e) => e.role)).toEqual(['counterparty']);
    // B still has its own NewCo: a project may involve several entities (Mobily, NewCo, partner, counterparties).
    expect(listB.some((e) => e.role === 'newco' && e.id !== newco)).toBe(true);
    // Linking the same entity twice with the same role is refused.
    expect((await p.pm.post(`/api/v1/projects/${b}/legal-entities/link`, { legalEntityId: newco, role: 'counterparty' })).status).toBe(409);
  });
});

describe('REQ-DAT-009 — soft deletion keeps records auditable and out of normal views', () => {
  it('a soft-deleted document disappears from the list, the total and the detail view, but the row and its history remain', async () => {
    const pm = await loginAs('pm');
    const title = `TR-DAT9 soft delete probe ${Date.now()} (test)`;
    const id = (await owner().query(`insert into document (org_id, project_id, title, kind, classification) values ($1,$2,$3,'evidence','internal') returning id`, [orgId, dcId, title])).rows[0].id as string;
    const q = encodeURIComponent(title);
    let list = (await pm.get(`/api/v1/projects/${dcId}/documents?q=${q}`).expect(200)).body;
    expect(list.total).toBe(1);
    await pm.get(`/api/v1/projects/${dcId}/documents/${id}`).expect(200);

    await owner().query('update document set deleted_at = now(), deleted_by = $2 where id = $1', [id, pm.userId]);
    list = (await pm.get(`/api/v1/projects/${dcId}/documents?q=${q}`).expect(200)).body;
    expect(list.total).toBe(0);
    expect(list.items).toEqual([]);
    expect((await pm.get(`/api/v1/projects/${dcId}/documents/${id}`)).status).toBe(404);
    // Still present (soft) and never hard-deletable.
    expect((await owner().query('select count(*)::int n from document where id = $1', [id])).rows[0].n).toBe(1);
    await expect(owner().query('delete from document where id = $1', [id])).rejects.toThrow(/soft-deleted only/);
  });
});
