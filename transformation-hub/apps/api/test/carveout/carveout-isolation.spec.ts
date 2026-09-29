import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApp, closePools, loginAs, owner, projectIdByCode, runtimePool, DC } from '../helpers';
import { Personas, base, carveoutProject, createItem, newcoId, ok } from './carveout-kit';

/**
 * AT-03 for the carve-out / NewCo registers: another project's records, ids and counts never leak; submitted foreign ids
 * are refused; classification is applied inside SQL (lists, totals, reconciliation); RLS backs the API.
 */
let a: string;
let b: string;
let p: Personas;
let itemA: string;
let itemB: string;
let siteB: string;

beforeAll(async () => {
  ({ projectId: a, p } = await carveoutProject('CO-ISO-A'));
  ({ projectId: b } = await carveoutProject('CO-ISO-B'));
  itemA = (await createItem(p.pm, a, { type: 'site', name: 'Isolation A site (synthetic)', disposition: 'included' })).id;
  itemB = (await createItem(p.pm, b, { type: 'site', name: 'Isolation B site (synthetic)', disposition: 'included' })).id;
  siteB = (await ok<{ id: string }>(p.pm.post(`${base(b)}/sites`, { name: 'Isolation B physical site (synthetic)' }))).id;
});
afterAll(async () => {
  await closeApp();
  await closePools();
});

describe('Carve-out / NewCo isolation [AT-03, REQ-PER-003, REQ-PER-006]', () => {
  it('a Project-B-only user gets 404 on every carve-out and NewCo route of another project', async () => {
    const pmB = await loginAs('pm.b');
    const dc = await projectIdByCode(DC);
    for (const path of [
      `${base(a)}/perimeter-items`,
      `${base(a)}/perimeter-items/${itemA}`,
      `${base(a)}/perimeter/reconciliation`,
      `${base(a)}/perimeter/day1-contract-positions`,
      `${base(a)}/agreements`,
      `${base(a)}/consents`,
      `${base(a)}/transfers`,
      `${base(a)}/legal-entities`,
      `${base(a)}/regulatory-requirements`,
      `${base(dc)}/perimeter-items`,
    ]) {
      expect((await pmB.get(path)).status, path).toBe(404);
    }
    expect((await pmB.post(`${base(a)}/perimeter-items`, { type: 'site', name: 'x' })).status).toBe(404);
  });

  it('ids of another project are refused (404), never linked', async () => {
    const withSite = await p.pm.post(`${base(a)}/perimeter-items`, { type: 'site', name: 'uses B site', siteId: siteB });
    expect(withSite.status).toBe(404);
    const consent = await p.pm.post(`${base(a)}/consents`, { perimeterItemId: itemB, counterparty: 'x' });
    expect(consent.status).toBe(404);
    const tr = await p.pm.post(`${base(a)}/transfers`, { perimeterItemId: itemB, aspect: 'legal', command: 'mark_not_applicable', expectedVersion: 1, note: 'x' });
    expect(tr.status).toBe(404);
    expect((await p.pm.get(`${base(a)}/perimeter-items/${itemB}`)).status).toBe(404);
    // A legal entity linked only to project B cannot be referenced as a party / target entity in A.
    const entB = await newcoId(p.pm, b);
    const target = await p.pm.post(`${base(a)}/perimeter-items`, { type: 'asset', name: 'uses B entity', targetEntityId: entB });
    expect(target.status).toBe(400);
    const agr = await p.pm.post(`${base(a)}/agreements`, { kindLabel: 'TSA', title: 'x', parties: [{ name: 'x', legalEntityId: entB }] });
    expect(agr.status).toBe(400);
    expect((await p.pm.get(`${base(a)}/legal-entities/${entB}`)).status).toBe(404);
    // pm.b cannot pull project A's NewCo into the demo general project (it sees no link to it).
    const pmB = await loginAs('pm.b');
    const gen = await projectIdByCode('DEMO-TRANSFORM');
    const link = await pmB.post(`${base(gen)}/legal-entities/link`, { legalEntityId: await newcoId(p.pm, a), role: 'counterparty' });
    expect(link.status).toBe(404);
  });

  it('classification is enforced inside SQL: lists, totals and reconciliation exclude records above clearance', async () => {
    const hidden = await createItem(p.pm, a, { type: 'data', name: 'Isolation A restricted data (synthetic)', disposition: 'included' });
    await owner().query(`update perimeter_item set classification = 'restricted' where id = $1`, [hidden.id]);
    const list = (await p.pm.get(`${base(a)}/perimeter-items`).expect(200)).body;
    expect(list.total).toBe(1);
    expect(list.items.map((x: { id: string }) => x.id)).toEqual([itemA]);
    expect((await p.pm.get(`${base(a)}/perimeter-items/${hidden.id}`)).status).toBe(404);
    const rec = (await p.pm.get(`${base(a)}/perimeter/reconciliation`).expect(200)).body;
    expect(rec.summary.items).toBe(1);
    expect(JSON.stringify(rec)).not.toContain(hidden.id);
    // The sponsor (strictly confidential clearance) sees both.
    expect((await p.sponsor.get(`${base(a)}/perimeter-items`).expect(200)).body.total).toBe(2);
  });

  it('RLS: the runtime role without a project context reads no perimeter, consent, agreement or regulatory rows', async () => {
    for (const t of ['perimeter_item', 'transfer_record', 'consent', 'agreement', 'regulatory_requirement', 'perimeter_version', 'perimeter_impact_assessment']) {
      const r = await runtimePool().query(`select count(*)::int n from ${t}`);
      expect(r.rows[0].n, t).toBe(0);
    }
  });
});
