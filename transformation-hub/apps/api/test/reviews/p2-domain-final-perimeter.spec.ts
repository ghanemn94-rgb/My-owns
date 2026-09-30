import { afterAll, describe, expect, it } from 'vitest';
import { closeApp, closePools, owner } from '../helpers';
import { completeVoting, setupGovernance } from '../gates/gate-test-kit';
import { Actors, decisionVersion, tabledDecision, uniq } from '../governance/gov-fixtures';
import { Personas, approveChangeRequest, base, carveoutProject, createItem, item, ok, workstreamId } from '../carveout/carveout-kit';

/**
 * P2 DOMAIN FINAL REVIEW — perimeter-version approval on a G1 decision (docs/reviews/P2-domain-final-review.md; DOM-P2R-03
 * and DOM-P2R-05 fixes, P3 scope REQ-SET-012). Own file: one gate-kit project per file (public demo-login rate limit).
 * `RE …` re-verifies a fix; `OBSERVATION …` pins current behaviour for the governance owner. All data is synthetic.
 */
afterAll(async () => {
  await closeApp();
  await closePools();
});

describe('P2 domain final review — perimeter version and the G1 decision it rests on [REQ-SET-012, AT-07]', () => {
  it('RE DOM-P2R-03/-05: a G1 paper raised FOR version 1 never approves version 2; OBSERVATION DOM-P2F-08: a G1 paper raised for no record, voted while version 1 was the proposal, approves version 2', async () => {
    const { projectId: pv, p } = (await carveoutProject('DFR-PV')) as { projectId: string; p: Personas };
    const ws = await workstreamId(p.pm, pv, 'WS05');
    await createItem(p.pm, pv, { type: 'site', name: 'Final-review site (synthetic)', disposition: 'included', workstreamId: ws, ownerUserId: p.pm.userId });
    const v1 = await ok<{ id: string; versionNo: number; version: number }>(p.pm.post(`${base(pv)}/setup/steps/perimeter`, { note: 'Perimeter v1 (final review, synthetic)' }));
    expect(v1.versionNo).toBe(1);
    const gov = await setupGovernance(pv, p);
    const g1Paper = async (over: Record<string, unknown>) => {
      const d = await tabledDecision(pv, p as unknown as Actors, p.pm, gov.committeeId, gov.meetingId, {
        title: uniq('G1 perimeter decision (final review, synthetic)'),
        decisionTypeKey: 'gate_decision_operational',
        gateKey: 'G1',
        amount: null,
        requiredAuthority: 'Per the DEMO matrix (synthetic)',
        ...over,
      });
      await completeVoting(pv, p, d.id, 'approve');
      const out = await p.secretary.post(`${base(pv)}/decisions/${d.id}/record-outcome`, { expectedVersion: await decisionVersion(p.chair, pv, d.id) });
      expect(out.status, JSON.stringify(out.body)).toBe(201);
      expect(out.body.status).toBe('approved');
      return d.id;
    };
    const forV1 = await g1Paper({ subjectType: 'perimeter_version', subjectId: v1.id });
    const unbound = await g1Paper({});

    // Version 1 is rejected; the register changes; version 2 (a snapshot the committee never saw) is proposed.
    await ok(p.sponsor.post(`${base(pv)}/perimeter/versions/${v1.id}/reject`, { expectedVersion: 1, reason: 'Scope to be revised (synthetic)' }));
    const late = await createItem(p.pm, pv, { type: 'site', name: 'Final-review second site (synthetic)', disposition: 'included', workstreamId: ws, ownerUserId: p.pm.userId, justification: 'Added after v1 (synthetic)' });
    if (late.changeRequest) {
      await approveChangeRequest(p, pv, late.changeRequest.id);
      const cur = await item(p.pm, pv, late.id);
      await ok(p.pm.post(`${base(pv)}/perimeter-items/${late.id}/apply-change`, { expectedVersion: cur.version, changeRequestId: late.changeRequest.id }));
    }
    const v2 = await ok<{ id: string; versionNo: number; snapshotHash: string }>(p.pm.post(`${base(pv)}/setup/steps/perimeter`, { note: 'Perimeter v2 (final review, synthetic)' }));
    expect(v2.versionNo).toBe(2);
    const hashes = (await owner().query(`select version_no, snapshot_hash from perimeter_version where project_id = $1 order by version_no`, [pv])).rows;
    expect(hashes[0].snapshot_hash).not.toBe(hashes[1].snapshot_hash);

    const onV1Paper = await p.sponsor.post(`${base(pv)}/perimeter/versions/${v2.id}/approve`, { expectedVersion: 1, decisionId: forV1, note: 'probe' });
    expect(onV1Paper.status, JSON.stringify(onV1Paper.body)).toBe(422);
    expect(onV1Paper.body.code).toBe('perimeter.version.decision_other_subject');

    // Current behaviour (subject rule `if_set`): the unbound G1 decision backs whichever single version is approved first.
    const onUnbound = await p.sponsor.post(`${base(pv)}/perimeter/versions/${v2.id}/approve`, { expectedVersion: 1, decisionId: unbound, note: 'probe' });
    expect(onUnbound.status, JSON.stringify(onUnbound.body)).toBe(201);
    const voted = (await owner().query(`select max(v.created_at) as last_vote from vote v where v.decision_id = $1`, [unbound])).rows[0].last_vote as Date;
    const proposedV2 = (await owner().query(`select created_at from perimeter_version where id = $1`, [v2.id])).rows[0].created_at as Date;
    expect(voted.getTime()).toBeLessThan(proposedV2.getTime());
  });
});
