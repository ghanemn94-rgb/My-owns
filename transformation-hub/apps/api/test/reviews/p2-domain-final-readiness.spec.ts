import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApp, closePools, owner } from '../helpers';
import { P, decisionOfType, drainWorker, plusDays, setupGovernance, setupProject, Gov, Personas } from '../readiness/readiness-kit';

/**
 * P2 DOMAIN FINAL REVIEW — the shared "relying on a governance decision" mechanism outside P2 (docs/reviews/
 * P2-domain-final-review.md, finding DOM-P2F-09, P3 scope: readiness / TSA). Own file: one gate-kit project per file.
 * `DEFECT …` asserts the rule the platform documents for every module (docs/architecture/module-guide.md, "Relying on a
 * governance decision": one decision backs ONE record of each kind; a new consumer binds the decision to its record) and
 * fails at the reviewed revision. It is declared with `it.fails` (suite stays green while the defect is open; drop `.fails`
 * once fixed); `P2F_PROBE_PLAIN=1` runs it as a plain test to show the failure message. All data is synthetic.
 */
const defect = process.env['P2F_PROBE_PLAIN'] ? it : it.fails;

let projectId: string;
let p: Personas;
let gov: Gov;

beforeAll(async () => {
  ({ projectId, p } = await setupProject('DFR-TSA'));
  gov = await setupGovernance(projectId, p);
}, 600_000);
afterAll(async () => {
  await drainWorker();
  await closeApp();
  await closePools();
});

/** A TSA with the §7.3 essentials, in negotiation, ready for approval. */
async function negotiatedTsa(name: string): Promise<{ id: string; version: number }> {
  const r = await p.pm.post(`${P(projectId)}/tsa-services`, {
    name,
    scope: `${name} — scope (synthetic)`,
    sla: '99.9% availability (synthetic)',
    chargeBasis: 'Monthly fixed fee (synthetic)',
    charge: { amount: '1000.0000', currency: 'SAR', unitScale: 1 },
    startDate: plusDays(-30),
    endDate: plusDays(180),
    ownerUserId: p.approver.userId,
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  const neg = await p.pm.post(`${P(projectId)}/tsa-services/${r.body.id}/transition`, { expectedVersion: 1, command: 'start_negotiation' });
  expect(neg.status, JSON.stringify(neg.body)).toBe(201);
  const upd = await p.pm.patch(`${P(projectId)}/tsa-services/${r.body.id}`, {
    expectedVersion: neg.body.version,
    exitMilestones: [{ title: 'Replacement live (synthetic)' }],
    replacementService: 'NewCo service (synthetic)',
    replacementPlan: 'Build, parallel run, cut over (synthetic)',
  });
  expect(upd.status, JSON.stringify(upd.body)).toBe(200);
  return { id: r.body.id as string, version: upd.body.version as number };
}

describe('P2 domain final review — shared decision-reliance mechanism in the readiness module (P3 scope)', () => {
  defect('DEFECT DOM-P2F-09: one TSA-approval decision approves the terms of two different TSAs', async () => {
    const d = (await decisionOfType(projectId, p, gov, 'tsa_approval_or_extension')).id;
    const a = await negotiatedTsa('TSA A — NOC monitoring (synthetic)');
    const b = await negotiatedTsa('TSA B — facility management (synthetic)');
    const first = await p.pm.post(`${P(projectId)}/tsa-services/${a.id}/approve`, { expectedVersion: a.version, decisionId: d });
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    const second = await p.pm.post(`${P(projectId)}/tsa-services/${b.id}/approve`, { expectedVersion: b.version, decisionId: d });
    const rows = (await owner().query(`select code, status, approval_decision_id from tsa_service where project_id = $1 order by code`, [projectId])).rows;
    const uses = (await owner().query(`select count(*)::int n from decision_use where decision_id = $1`, [d])).rows[0].n;
    // Required (module-guide.md "Relying on a governance decision", DOM-P2R-03/-05 principle; spec §4.2 approval interfaces
    // enforcing delegated authority): a decision authorizes the record it was raised for, once per kind of use.
    expect(second.status, `second TSA approved on the same decision: ${JSON.stringify(second.body)}; TSAs ${JSON.stringify(rows)}; registered uses ${uses}`).toBe(422);
  });
});
