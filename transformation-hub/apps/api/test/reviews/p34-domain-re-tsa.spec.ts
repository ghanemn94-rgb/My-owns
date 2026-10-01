import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApp, closePools, owner } from '../helpers';
import { P, decisionOfType, drainWorker, plusDays, setupGovernance, setupProject, tsa, Gov, Personas } from '../readiness/readiness-kit';
import { decisionVersion, vote } from '../governance/gov-fixtures';

/**
 * P3/P4 FOCUSED DOMAIN RE-REVIEW — TSA extension terms bound to their decision after the DOM-P3-06 fix
 * (docs/reviews/P3-P4-domain-rereview.md; business-gates.md §6 rule 5 "once the linked decision has left draft, the requested
 * extension … can no longer be re-requested with other terms on that decision; … record-extension applies the end date the
 * decision saw"; spec §7.3 "never automatically extend"; AT-10; REQ-TSA-005).
 *
 * `DEFECT …` is declared with `it.fails` while open (`P34DRE_PROBE_PLAIN=1` runs it plain); `CONTROL …` is a plain test.
 * All data is synthetic.
 */
const defect = process.env['P34DRE_PROBE_PLAIN'] ? it : it.fails;

let projectId: string;
let p: Personas;
let gov: Gov;

beforeAll(async () => {
  ({ projectId, p } = await setupProject('P34R-TSA'));
  gov = await setupGovernance(projectId, p);
});
afterAll(async () => {
  await drainWorker();
  await closeApp();
  await closePools();
});

const cmd = (id: string, path: string, body: Record<string, unknown>) => p.pm.post(`${P(projectId)}/tsa-services/${id}/${path}`, body);

/** A complete TSA whose terms are approved on its own FINAL decision, then activated. */
async function activeTsa(name: string, startDate: string, endDate: string) {
  const c = await p.pm.post(`${P(projectId)}/tsa-services`, {
    name,
    scope: 'Out-of-hours monitoring of the transferred halls (synthetic)',
    startDate,
    endDate,
    ownerUserId: p.approver.userId,
    replacementService: 'NewCo monitoring platform (synthetic)',
    exitMilestones: [{ title: 'Replacement monitoring accepted with evidence (synthetic)' }],
  });
  expect(c.status, JSON.stringify(c.body)).toBe(201);
  const id = c.body.id as string;
  const neg = await cmd(id, 'transition', { expectedVersion: 1, command: 'start_negotiation' });
  expect(neg.status, JSON.stringify(neg.body)).toBe(201);
  const terms = await decisionOfType(projectId, p, gov, 'tsa_approval_or_extension');
  const ap = await cmd(id, 'approve', { expectedVersion: neg.body.version, decisionId: terms.id });
  expect(ap.status, JSON.stringify(ap.body)).toBe(201);
  const act = await cmd(id, 'transition', { expectedVersion: ap.body.version, command: 'activate' });
  expect(act.status, JSON.stringify(act.body)).toBe(201);
  return id;
}

describe('P3/P4 domain re-review — what an approved TSA extension decision authorizes [AT-10, REQ-TSA-005, business-gates.md §6 rule 5]', () => {
  let id: string;
  let d1: string;
  const X = plusDays(110);
  const Y = plusDays(3650);

  it('CONTROL: request "to X" on decision D1 (under review); D1 approved; re-requesting "to Y" on D1 is refused (422 tsa.extension.terms_bound)', async () => {
    id = await activeTsa('Monitoring bridge (re-review probe, synthetic)', plusDays(-60), plusDays(20));
    const ext = await decisionOfType(projectId, p, gov, 'tsa_approval_or_extension', { vote: false });
    d1 = ext.id;
    let t = await tsa(p.pm, projectId, id);
    const req1 = await cmd(id, 'request-extension', { expectedVersion: t.version, decisionId: d1, proposedEndDate: X, continuityPlan: 'Keep the legacy bridge while the replacement is accepted (synthetic)' });
    expect(req1.status, JSON.stringify(req1.body)).toBe(201);
    const v = await decisionVersion(p.chair, projectId, d1);
    for (const k of ['chair', 'sponsor', 'finance', 'legal'] as const) {
      const r = await vote(projectId, p[k], d1, 'approve', v);
      expect(r.status, JSON.stringify(r.body)).toBe(201);
    }
    const out = await p.secretary.post(`${P(projectId)}/decisions/${d1}/record-outcome`, { expectedVersion: v });
    expect(out.status, JSON.stringify(out.body)).toBe(201);
    expect(out.body.status).toBe('approved');
    t = await tsa(p.pm, projectId, id);
    const direct = await cmd(id, 'request-extension', { expectedVersion: t.version, decisionId: d1, proposedEndDate: Y, continuityPlan: 'Keep the legacy bridge (synthetic)' });
    expect(direct.status, JSON.stringify(direct.body)).toBe(422);
    expect(direct.body.code).toBe('tsa.extension.terms_bound');
  });

  defect('DEFECT DOM-P34R-04: re-linking the request to another decision D2 and then back to the approved D1 with "to Y" clears the binding — the TSA is recorded as extended to Y on D1', async () => {
    // A second tsa_approval_or_extension paper (any one still pending will do) is linked with Y, then D1 again with Y.
    const d2 = (await decisionOfType(projectId, p, gov, 'tsa_approval_or_extension', { vote: false })).id;
    let t = await tsa(p.pm, projectId, id);
    const viaD2 = await cmd(id, 'request-extension', { expectedVersion: t.version, decisionId: d2, proposedEndDate: Y, continuityPlan: 'Keep the legacy bridge (synthetic)' });
    t = await tsa(p.pm, projectId, id);
    const backToD1 = await cmd(id, 'request-extension', { expectedVersion: t.version, decisionId: d1, proposedEndDate: Y, continuityPlan: 'Keep the legacy bridge (synthetic)' });
    t = await tsa(p.pm, projectId, id);
    const rec = await cmd(id, 'record-extension', { expectedVersion: t.version, note: 'Extension per the approved decision (probe)' });
    const final = await tsa(p.pm, projectId, id);
    const uses = (await owner().query(`select use_kind, subject_id from decision_use where decision_id = $1 order by use_kind`, [d1])).rows;
    // Required (business-gates.md §6 rule 5; module guide "Relying on a governance decision" — the decision backs what was
    // before the committee): D1 approved the extension "to X"; the TSA is never recorded as extended by D1 to another date.
    expect(
      final.endDate,
      `X=${X} Y=${Y}; request on D2 ${viaD2.status} ${JSON.stringify(viaD2.body)}; back to D1 ${backToD1.status} ${JSON.stringify(backToD1.body)}; record ${rec.status} ${JSON.stringify(rec.body)}; TSA ${final.status} end ${final.endDate}; uses of D1 ${JSON.stringify(uses)}`,
    ).not.toBe(Y);
  });
});
