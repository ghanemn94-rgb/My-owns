import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApp, closePools, owner } from '../helpers';
import { P, decisionOfType, drainWorker, plusDays, runExpirySchedule, setupGovernance, setupProject, tsa, Gov, Personas } from '../readiness/readiness-kit';
import { decisionVersion, vote } from '../governance/gov-fixtures';

/**
 * P3 DOMAIN REVIEW — TSA extensions (docs/reviews/P3-domain-review.md; spec §7.3 "a replacement-service failure must trigger
 * escalation, continuity planning, and an extension decision; never automatically extend the contract"; AT-10
 * "extension/continuity options await approval"; business-gates.md §6 rule 2; REQ-TSA-005).
 *
 * `DEFECT …` is declared with `it.fails` while open (`P3D_PROBE_PLAIN=1` runs it plain); `OBSERVED …` pins current
 * behaviour. All data is synthetic.
 */
const defect = process.env['P3D_PROBE_PLAIN'] ? it : it.fails;

let projectId: string;
let p: Personas;
let gov: Gov;

beforeAll(async () => {
  ({ projectId, p } = await setupProject('P3D-TSA'));
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
  lastTermsDecision = terms.id;
  return id;
}
let lastTermsDecision = '';

describe('P3 domain review — what an approved TSA extension decision authorizes [AT-10, REQ-TSA-005]', () => {
  defect('DEFECT DOM-P3-06: after the committee approved the extension requested "to X", the TSA manager re-requests it "to Y" on the same decision and records Y', async () => {
    const id = await activeTsa('Monitoring bridge (probe, synthetic)', plusDays(-60), plusDays(20));
    // The extension is requested while the committee's paper is still under review: proposed end date X.
    const ext = await decisionOfType(projectId, p, gov, 'tsa_approval_or_extension', { vote: false });
    const X = plusDays(110);
    const Y = plusDays(3650);
    let t = await tsa(p.pm, projectId, id);
    const req1 = await cmd(id, 'request-extension', { expectedVersion: t.version, decisionId: ext.id, proposedEndDate: X, continuityPlan: 'Keep the legacy bridge while the replacement is accepted (synthetic)' });
    expect(req1.status, JSON.stringify(req1.body)).toBe(201);
    // The committee votes and approves the paper while the TSA shows the request "to X".
    const v = await decisionVersion(p.chair, projectId, ext.id);
    for (const k of ['chair', 'sponsor', 'finance', 'legal'] as const) {
      const r = await vote(projectId, p[k], ext.id, 'approve', v);
      expect(r.status, JSON.stringify(r.body)).toBe(201);
    }
    const out = await p.secretary.post(`${P(projectId)}/decisions/${ext.id}/record-outcome`, { expectedVersion: v });
    expect(out.status, JSON.stringify(out.body)).toBe(201);
    expect(out.body.status).toBe('approved');
    // After the approval, the TSA manager changes the request on the SAME decision to Y and records the extension.
    t = await tsa(p.pm, projectId, id);
    const req2 = await cmd(id, 'request-extension', { expectedVersion: t.version, decisionId: ext.id, proposedEndDate: Y, continuityPlan: 'Keep the legacy bridge (synthetic)' });
    t = await tsa(p.pm, projectId, id);
    const rec = await cmd(id, 'record-extension', { expectedVersion: t.version, note: 'Extension per the approved decision (probe)' });
    const final = await tsa(p.pm, projectId, id);
    const audit = (await owner().query(`select action, after from audit_event where project_id = $1 and entity_id = $2 and action like 'readiness.tsa.%extension' order by seq`, [projectId, id])).rows;
    // Required (spec §7.3 / AT-10: the extension awaits an approved decision; module guide "Relying on a governance
    // decision" — an approval is bound to what was approved, cf. approval_request payloadHash for TSA exits): the approved
    // decision authorizes the extension that was before the committee (to X). Changing the end date after the decision is
    // final is refused (or needs a new decision); the TSA is never extended to a date the committee did not see.
    expect(final.endDate, `request 1 (X=${X}) ${req1.status}; request 2 (Y=${Y}) ${req2.status} ${JSON.stringify(req2.body)}; record ${rec.status} ${JSON.stringify(rec.body)}; TSA ${final.status} end ${final.endDate}; audit ${JSON.stringify(audit)}`).not.toBe(Y);
  });

  it('OBSERVED DOM-P3-13: the decision that approved the TERMS of TSA A authorizes an EXTENSION of another TSA B (documented "of that TSA or another")', async () => {
    const a = await activeTsa('NOC service A (probe, synthetic)', plusDays(-30), plusDays(40));
    const termsOfA = lastTermsDecision;
    const b = await activeTsa('Facility service B (probe, synthetic)', plusDays(-30), plusDays(45));
    let t = await tsa(p.pm, projectId, b);
    const req = await cmd(b, 'request-extension', { expectedVersion: t.version, decisionId: termsOfA, proposedEndDate: plusDays(200), continuityPlan: 'Continuity for service B (synthetic)' });
    expect(req.status, JSON.stringify(req.body)).toBe(201);
    t = await tsa(p.pm, projectId, b);
    const rec = await cmd(b, 'record-extension', { expectedVersion: t.version, note: 'Extension of B on the decision about A (probe)' });
    const uses = (await owner().query(`select use_kind, subject_id from decision_use where decision_id = $1 order by use_kind`, [termsOfA])).rows;
    // Current behaviour (module-guide.md "Relying on a governance decision": "one decision may approve the terms of a TSA and
    // one extension (of that TSA or another)"): the committee decided about TSA A's terms; the platform records TSA B as
    // extended on that decision. See finding DOM-P3-13 (governance owner to confirm; conservative option: the extension
    // use of a decision is bound to the TSA whose terms it approved).
    expect(rec.status, JSON.stringify(rec.body)).toBe(201);
    expect(uses).toEqual([
      { use_kind: 'tsa_extension', subject_id: b },
      { use_kind: 'tsa_service', subject_id: a },
    ]);
  });

  it('OBSERVED DOM-P3-07: an expired TSA is "extended" to an end date that has already passed (the new date only has to be after the old one)', async () => {
    const id = await activeTsa('Legacy access bridge (probe, synthetic)', plusDays(-120), plusDays(-10));
    const scan = await runExpirySchedule(projectId);
    expect(scan['markedExpired']).toBeGreaterThanOrEqual(1);
    let t = await tsa(p.pm, projectId, id);
    expect(t.status).toBe('expired_unresolved');
    const ext = await decisionOfType(projectId, p, gov, 'tsa_approval_or_extension');
    const past = plusDays(-5);
    const req = await cmd(id, 'request-extension', { expectedVersion: t.version, decisionId: ext.id, proposedEndDate: past, continuityPlan: 'Continuity: keep the bridge (synthetic)' });
    expect(req.status, JSON.stringify(req.body)).toBe(201);
    t = await tsa(p.pm, projectId, id);
    const rec = await cmd(id, 'record-extension', { expectedVersion: t.version, note: 'Extension (probe)' });
    expect(rec.status, JSON.stringify(rec.body)).toBe(201);
    const after = await tsa(p.pm, projectId, id);
    // Current behaviour: the TSA leaves expired_unresolved for `extended` with an end date in the past (until the next daily
    // scan marks it expired again) — the escalation's "extend" option can be discharged by an extension that extends nothing.
    expect(after).toMatchObject({ status: 'extended', endDate: past });
    expect(after.expiry.kind).toBe('expired_unresolved');
  });
});
