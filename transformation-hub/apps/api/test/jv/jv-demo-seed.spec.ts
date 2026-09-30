import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApp, closePools, DC, owner, projectIdByCode } from '../helpers';
import { login, DocClient } from '../documents/doc-helpers';
import { P } from './jv-kit';

/**
 * The JV demo scenario (seeded through the services by jv.seed.ts): two FICTIONAL partners flagged Demo (REQ-SET-002),
 * a closing BLOCKED by an unverified, non-waivable blocking CP (REQ-SET-004), and the G5–G7 transaction gates seeded
 * from the DC template with their evidence types (REQ-LCY-004).
 */
let dcId: string;
let pm: DocClient;

beforeAll(async () => {
  dcId = await projectIdByCode(DC);
  pm = await login('pm');
});
afterAll(async () => {
  await closeApp();
  await closePools();
});

describe('JV demo sandbox [REQ-SET-002, REQ-SET-004, REQ-LCY-004]', () => {
  it('UT: demo partners flagged is_demo and fictional — exactly two, no real names', async () => {
    // (Other specs add their own fixtures to the shared demo project; the seeded partners carry the DEMO- codes.)
    const list = (await pm.get(`${P(dcId)}/partners?sort=code&pageSize=100`).expect(200)).body;
    list.items = list.items.filter((x: { code: string }) => x.code.startsWith('DEMO-'));
    expect(list.items.map((x: { code: string; name: string; isDemo: boolean }) => [x.code, x.name, x.isDemo])).toEqual([
      ['DEMO-PA', 'Demo Partner Alpha (fictional)', true],
      ['DEMO-PB', 'Demo Partner Beta (fictional)', true],
    ]);
    const db = await owner().query(`select count(*)::int n, bool_and(is_demo) all_demo from partner where project_id = $1 and code like 'DEMO-%'`, [dcId]);
    expect(db.rows[0]).toEqual({ n: 2, all_demo: true });
    const alpha = list.items[0];
    expect(alpha).toMatchObject({ stage: 'materials_access', ndaStatus: 'executed', outreachApproved: true, weightedScore: null });
    // The ownership scenario lists the parties with NO percentage.
    const sc = (await (await login('finance')).get(`${P(dcId)}/deal-scenarios?partnerId=${alpha.id}`).expect(200)).body.items;
    expect(sc).toHaveLength(1);
    expect(sc[0].ownership.every((o: { percent: string | null }) => o.percent === null)).toBe(true);
  });

  it('REQ-SET-004: the demo closing is blocked by an unverified, non-waivable blocking CP', async () => {
    const closings = (await pm.get(`${P(dcId)}/closings`).expect(200)).body.items;
    expect(closings).toHaveLength(1);
    const c = (await pm.get(`${P(dcId)}/closings/${closings[0].id}`).expect(200)).body;
    expect(c).toMatchObject({ status: 'in_preparation', ready: false, isDemo: true });
    const refs = c.blockers.map((b: { ref: string }) => b.ref);
    expect(refs).toContain('DEMO-CP-01');
    const cp1 = c.conditions.find((x: { reference: string }) => x.reference === 'DEMO-CP-01');
    expect(cp1).toMatchObject({ blocking: true, waivable: false, status: 'open' });
    expect(c.conditions.find((x: { reference: string }) => x.reference === 'DEMO-CP-02')).toMatchObject({ status: 'verified', evidence: { active: 1, conflicting: 0 } });
    expect(c.fundsFlows[0].amount).toBeNull(); // amount TBD — never invented
  });

  it('the fictional partner user sees its room, the disclosed note and its answered question only; the clean-team persona its room only', async () => {
    const partner = await login('partner.alpha');
    const all = (await partner.get(`${P(dcId)}/partner-access/rooms`).expect(200)).body.items as { id: string; name: string }[];
    const rooms = all.filter((r) => r.name === 'Demo — Partner Alpha data room (fictional)');
    expect(rooms).toHaveLength(1);
    const disclosed = (await partner.get(`${P(dcId)}/partner-access/rooms/${rooms[0]!.id}/disclosures`).expect(200)).body.items;
    expect(disclosed.map((d: { title: string }) => d.title)).toEqual(['Demo — Data room welcome note (synthetic)']);
    const dd = (await partner.get(`${P(dcId)}/partner-access/rooms/${rooms[0]!.id}/dd-requests`).expect(200)).body.items;
    expect(dd).toHaveLength(1);
    expect(dd[0]).toMatchObject({ status: 'answered' });
    const ct = await login('cleanteam');
    const ctRooms = (await ct.get(`${P(dcId)}/partner-rooms?pageSize=100`).expect(200)).body.items as { name: string; type: string }[];
    expect(ctRooms.filter((r) => r.name === 'Demo — Clean team room (fictional)').map((r) => r.type)).toEqual(['clean_team']);
    expect(ctRooms.every((r) => r.type === 'clean_team')).toBe(true); // a clean-team member sees clean-team rooms only
    expect(ctRooms.some((r) => r.name.includes('Partner Alpha'))).toBe(false);
  });

  it('UT (REQ-LCY-004): G5–G7 criteria are seeded from the template with their evidence types', async () => {
    const gates = (await pm.get(`${P(dcId)}/gates`).expect(200)).body.items as { id: string; key: string }[];
    for (const key of ['G5', 'G6', 'G7']) {
      const g = gates.find((x) => x.key === key)!;
      const d = (await pm.get(`${P(dcId)}/gates/${g.id}`).expect(200)).body;
      expect(d.criteria.length, key).toBeGreaterThan(3);
      for (const c of d.criteria as { key: string; evidenceType: string | null }[]) expect(c.evidenceType, `${key} ${c.key}`).toBeTruthy();
    }
  });
});
