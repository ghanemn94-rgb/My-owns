import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApp, closePools, owner } from '../helpers';
import { P, decisionOfType, drainWorker, plusDays, setupGovernance, setupProject, tsa, Gov, Personas } from '../readiness/readiness-kit';

/**
 * P3/P4 DOMAIN RE-REVIEW, RE-CHECK OF THE FIXES (lead request) — equivalent path around the DOM-P34R-04 fix
 * (docs/reviews/P3-P4-domain-rereview.md "Re-check of the fixes"). The fix binds the extension terms to the DECISION
 * (`tsa_extension_terms`, written "when the extension is first requested on it", business-gates.md §6 rule 5) and refuses other
 * terms once the decision has left draft. A decision that became FINAL before any terms were bound to it gets its first terms
 * after the vote — whatever end date the TSA manager then chooses.
 *
 * `DEFECT …` probes assert the REQUIRED behaviour and are declared with `it.fails` while the defect is open;
 * `P34DRE_PROBE_PLAIN=1` runs them plain. All data is synthetic.
 */
// Implementer (fix of DOM-P34R2-01): the DEFECT probes of this file are fixed and renamed `… (fixed, regression)` — plain
// `it`, assertions unchanged. The alias stays so that P34DRE_PROBE_PLAIN=1 keeps working for any probe added later.
const defect = process.env['P34DRE_PROBE_PLAIN'] ? it : it.fails;
void defect;

let projectId: string;
let p: Personas;
let gov: Gov;

beforeAll(async () => {
  ({ projectId, p } = await setupProject('P34R2-TSA'));
  gov = await setupGovernance(projectId, p);
});
afterAll(async () => {
  await drainWorker();
  await closeApp();
  await closePools();
});

const cmd = (id: string, path: string, body: Record<string, unknown>) => p.pm.post(`${P(projectId)}/tsa-services/${id}/${path}`, body);

/** A complete TSA whose terms are approved on its own FINAL decision, then activated; returns the TSA and that decision. */
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
  return { id, termsDecisionId: terms.id };
}

async function requestAndRecord(id: string, decisionId: string, proposedEndDate: string) {
  let t = await tsa(p.pm, projectId, id);
  const req = await cmd(id, 'request-extension', { expectedVersion: t.version, decisionId, proposedEndDate, continuityPlan: 'Keep the legacy bridge (synthetic)' });
  t = await tsa(p.pm, projectId, id);
  const rec = req.status === 201 ? await cmd(id, 'record-extension', { expectedVersion: t.version, note: 'Extension per the approved decision (probe)' }) : req;
  const final = await tsa(p.pm, projectId, id);
  const terms = (await owner().query(`select proposed_end_date::text as end_date, created_at::text as bound_at from tsa_extension_terms where decision_id = $1`, [decisionId])).rows;
  const dec = (await owner().query(`select status, outcome_recorded_at::text as outcome_recorded_at from decision where id = $1`, [decisionId])).rows[0];
  return { req, rec, final, terms, dec };
}

describe('P3/P4 domain re-review, re-check — extension terms first bound AFTER the decision became final [AT-10, REQ-TSA-005, business-gates.md §6 rules 5-6]', () => {
  it('DOM-P34R2-01a: the decision that approved the TSA\'s TERMS (no extension terms before the committee) backs an extension to an end date chosen after the vote (fixed, regression)', async () => {
    const { id, termsDecisionId } = await activeTsa('Monitoring bridge A (re-check probe, synthetic)', plusDays(-60), plusDays(20));
    const Y = plusDays(3650);
    const r = await requestAndRecord(id, termsDecisionId, Y);
    // Required (business-gates.md §6 rule 5 "record-extension applies the end date the decision saw"; AT-10 "extension options
    // await approval"; REQ-TSA-005 "extension requires an approved decision recorded against the TSA"): a decision that was
    // final before any extension terms were bound to it never saw an end date — it does not back an extension to a date
    // chosen afterwards (refused, or the terms must have been before the committee).
    expect(
      r.final.endDate,
      `terms decision ${JSON.stringify(r.dec)}; request ${r.req.status} ${JSON.stringify(r.req.body)}; record ${r.rec.status} ${JSON.stringify(r.rec.body)}; TSA ${r.final.status} end ${r.final.endDate}; bound terms ${JSON.stringify(r.terms)}`,
    ).not.toBe(Y);
  });

  it('DOM-P34R2-01b: an extension paper approved BEFORE it was linked to the TSA gets its end date after the vote (fixed, regression)', async () => {
    const { id } = await activeTsa('Facility service B (re-check probe, synthetic)', plusDays(-30), plusDays(25));
    const ext = await decisionOfType(projectId, p, gov, 'tsa_approval_or_extension'); // voted and approved, no TSA linked yet
    const Y = plusDays(3000);
    const r = await requestAndRecord(id, ext.id, Y);
    expect(
      r.final.endDate,
      `extension decision ${JSON.stringify(r.dec)}; request ${r.req.status} ${JSON.stringify(r.req.body)}; record ${r.rec.status} ${JSON.stringify(r.rec.body)}; TSA ${r.final.status} end ${r.final.endDate}; bound terms ${JSON.stringify(r.terms)}`,
    ).not.toBe(Y);
  });
});
