import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { aiToolByName } from '@hub/domain';
import { closeApp, closePools, owner } from '../helpers';
import { P, doc, grant, ok, plusDays, room, setupJvProject, today, DocClient, JvProject } from '../jv/jv-kit';
import { serviceHandles, setAi } from '../ai/ai-fixtures';
import { runWorker } from '../gates/gate-test-kit';
import { paper } from '../governance/gov-fixtures';
import { AiSettingsService } from '../../src/modules/ai/ai-settings.service';

/**
 * Focused security RE-CHECK of the P3/P4 security fixes (docs/reviews/P3-P4-security-recheck.md) — the evidence-linker "self"
 * rule (SEC-P34-01) in variants the fix tests do not cover (a linker who later lost access to the evidence; the uploader of
 * the evidence document; My Work offering a verification the command refuses), the AI channels of SEC-P34-02 / -03 beyond
 * retrieval (the proposals list), and the P4 exit criterion "financial data only with the finance-domain clearance and reach"
 * in the AI channel. Written by the security-privacy-reviewer; no implementation file and no existing test was changed.
 * `DEFECT` = `it.fails` asserting the REQUIRED behaviour (red once fixed; then rename "(fixed, regression)", plain `it`);
 * `OBSERVED` pins current behaviour that is a design question, not a defect against the documented rule; `CONTROL` confirms a
 * control. One JV test project, synthetic data only. The owner pool sets an approved figure's approval columns and the
 * project's AI settings (no API offers that setup to a test) and reads rows for assertions; each use is commented.
 */
let j: JvProject;
let pid: string;
const TAG = 'P34SRE';

beforeAll(async () => {
  j = await setupJvProject('P34SRE-JVAI');
  pid = j.projectId;
  await setAi(pid, {}); // owner pool: advisory mode, Simulated mock provider (test-only reset of the AI settings)
}, 600_000);
afterAll(async () => {
  await closeApp();
  await closePools();
});

async function cp(title: string) {
  const s = await ok(await j.p.pm.post(`${P(pid)}/signings`, { name: `${TAG} signing (synthetic)` }));
  const c = await ok(await j.p.pm.post(`${P(pid)}/closings`, { signingId: s.id, name: `${TAG} closing (synthetic)` }));
  return ok(await j.p.pm.post(`${P(pid)}/closing-conditions`, { closingId: c.id, title, ownerUserId: j.p.pm.userId, blocking: true }));
}

// ---------------------------------------------------------------------------------------------------------------------
describe('SEC-P34-01 re-check — "the person who recorded the evidence" in variants', () => {
  it('CONTROL: a linker who later LOST ACCESS to the evidence (room grant revoked; the link is no longer shown to them) is still "self" for the CP verification (403, CP unchanged); an independent verifier verifies', async () => {
    const c = await cp(`${TAG} regulatory consent CP (synthetic)`);
    const roomId = (await room(j.p.pm, pid, { name: `${TAG} internal evidence room (test)`, type: 'internal' })).id as string;
    const g = await ok(await grant(j.p.sponsor, pid, roomId, { userId: j.p.legal.userId, accessLevel: 'read' }));
    const d = await doc(j.p.pm, pid, `${TAG} regulator letter (synthetic)`, { roomId });
    await ok(await j.p.legal.post(`${P(pid)}/evidence`, { targetType: 'closing_condition', targetId: c.id, documentId: d.id, note: 'Regulator letter linked by Legal (synthetic)' }));
    const cur = (await j.p.pm.get(`${P(pid)}/closing-conditions/${c.id}`).expect(200)).body;
    const sub = await ok(await j.p.pm.post(`${P(pid)}/closing-conditions/${c.id}/submit-evidence`, { expectedVersion: cur.version }));
    await ok(await j.p.pm.post(`${P(pid)}/partner-rooms/${roomId}/access-grants/${g.id}/revoke`, { reason: 'Re-check probe: Legal leaves the room (synthetic)' }));
    // Legal no longer sees the link (the document is in a room it lost) …
    const shown = (await j.p.legal.get(`${P(pid)}/evidence?targetType=closing_condition&targetId=${c.id}`).expect(200)).body;
    expect(shown.items.map((x: { addedBy: string }) => x.addedBy)).not.toContain(j.p.legal.userId);
    // … but the rule reads every active link: Legal is refused, the CP is unchanged; the functional approver verifies.
    const self = await j.p.legal.post(`${P(pid)}/closing-conditions/${c.id}/verify`, { expectedVersion: sub.version, outcome: 'verify' });
    expect(self.status, JSON.stringify(self.body)).toBe(403);
    expect(self.body.code).toBe('jv.cp.self_verification');
    expect((await owner().query(`select status from closing_condition where id = $1`, [c.id])).rows[0].status).toBe(sub.status);
    const v = await ok(await j.p.approver.post(`${P(pid)}/closing-conditions/${c.id}/verify`, { expectedVersion: sub.version, outcome: 'verify' }));
    expect(v.status).toBe('verified');
  });

  it('OBSERVED SEC-P34R-03: the UPLOADER of the only evidence document verifies the CP on it (201) although documents.evidence.verify treats the same person as "self" for that link (403)', async () => {
    const c = await cp(`${TAG} board approval CP (synthetic)`);
    const d = await doc(j.p.legal, pid, `${TAG} board resolution authored by Legal (synthetic)`); // uploaded_by = Legal
    const link = await ok(await j.p.pm.post(`${P(pid)}/evidence`, { targetType: 'closing_condition', targetId: c.id, documentId: d.id, note: 'Linked by the PM (synthetic)' }));
    const cur = (await j.p.pm.get(`${P(pid)}/closing-conditions/${c.id}`).expect(200)).body;
    const sub = await ok(await j.p.pm.post(`${P(pid)}/closing-conditions/${c.id}/submit-evidence`, { expectedVersion: cur.version }));
    const rows = await owner().query(`select e.added_by, v.uploaded_by from evidence_link e join document_version v on v.id = e.document_version_id where e.id = $1`, [link.id]);
    expect(rows.rows).toEqual([{ added_by: j.p.pm.userId, uploaded_by: j.p.legal.userId }]);
    const evVerify = await j.p.legal.post(`${P(pid)}/evidence/${link.id}/verify`, { expectedVersion: 1, decision: 'accept' });
    expect(evVerify.status).toBe(403); // the documents module: linker AND version uploader are self (access-matrix §5.1)
    const r = await j.p.legal.post(`${P(pid)}/closing-conditions/${c.id}/verify`, { expectedVersion: sub.version, outcome: 'verify' });
    console.log(`SEC-P34R-03 observed: CP verify by the uploader of its only evidence document → ${r.status} ${JSON.stringify(r.body)}`);
    expect(r.status).toBe(201);
    expect(r.body.status).toBe('verified');
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('SEC-P34R-04 — My Work offers a verification the command refuses to the evidence linker [SEC-P2-03 rule; SEC-P34-01 governance part]', () => {
  let actionId: string;

  beforeAll(async () => {
    const a = await ok(await j.p.secretary.post(`${P(pid)}/actions`, { title: `${TAG}-ACT-CANARY circulate the pack (synthetic)`, meetingId: j.gov.meetingId, ownerUserId: j.p.pm.userId, dueDate: plusDays(7) }));
    actionId = a.id;
    const cur = (await j.p.pm.get(`${P(pid)}/actions/${actionId}`).expect(200)).body;
    await ok(await j.p.pm.post(`${P(pid)}/actions/${actionId}/report-done`, { expectedVersion: cur.version, closureEvidenceNote: 'Pack circulated (synthetic)' }));
    await ok(await j.p.secretary.post(`${P(pid)}/evidence`, { targetType: 'action_item', targetId: actionId, note: 'Distribution list linked by the secretary (synthetic)' }));
  }, 120_000);

  it('CONTROL: the linking secretary is refused the closure verification (403 governance.action.linker_verification); the second secretary is offered it in My Work', async () => {
    const done = (await j.p.pm.get(`${P(pid)}/actions/${actionId}`).expect(200)).body;
    const r = await j.p.secretary.post(`${P(pid)}/actions/${actionId}/verify-closure`, { expectedVersion: done.version });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('governance.action.linker_verification');
    const other = (await (j.gov.secretary2 as unknown as DocClient).get('/api/v1/me/work').expect(200)).body;
    expect(other.items.some((i: { type: string; entityId: string }) => i.type === 'action_closure_verification' && i.entityId === actionId)).toBe(true);
  });

  it.fails('DEFECT SEC-P34R-04: My Work never offers the closure verification of an action to the person who linked its evidence (the command would refuse them)', async () => {
    const mine = (await j.p.secretary.get('/api/v1/me/work').expect(200)).body;
    const offered = mine.items.filter((i: { type: string; entityId: string }) => i.type === 'action_closure_verification' && i.entityId === actionId);
    console.log(`SEC-P34R-04 observed: My Work of the linking secretary → ${JSON.stringify(offered.map((i: { type: string; title: string }) => [i.type, i.title]))}`);
    expect(offered).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('SEC-P34R-05 — the AI proposals list shows proposals about P3/P4 records the reader cannot read [access-matrix §2.5, §2.6; SEC-P34-02 class]', () => {
  let cpId: string;
  let proposalId: string;
  const CANARY = `${TAG}-CP-PROPOSAL-CANARY`;

  beforeAll(async () => {
    cpId = (await cp(`${CANARY} anti-trust clearance (synthetic)`)).id;
    // The runtime's path for a model tool call (AiProposalsService.createFromTool, as the delegating PM inside the PM's own
    // transaction): a reminder to Legal about the CP — what a (non-mock) provider proposes from a closing-condition detection.
    const { contexts, db, runtime, proposals, app } = await serviceHandles();
    const ctx = (await contexts.forUser(j.p.pm.userId, pid))!;
    const run = await db.run(ctx, () => runtime.runBriefingNow(ctx, pid));
    expect(run.status).toBe('succeeded');
    const s = await db.run(ctx, () => app.get(AiSettingsService).load(pid));
    const created = await db.run(ctx, () =>
      proposals.createFromTool(ctx, pid, { id: run.id, requestedBy: j.p.pm.userId }, aiToolByName('propose_internal_notification')!, {
        recipientUserId: j.p.legal.userId,
        targetType: 'closing_condition',
        targetId: cpId,
        title: `Update requested: ${CANARY} anti-trust clearance`,
        body: 'Please update the status of this closing condition (Simulated).',
      }, s),
    );
    expect('proposal' in created, JSON.stringify(created)).toBe(true);
    proposalId = (created as { proposal: { id: string } }).proposal.id;
  }, 300_000);

  it('CONTROL: the secretary (ai.proposal.read, no jv.deal.read) cannot read the CP or the CP register; Legal and the PM can list the proposal', async () => {
    expect([403, 404]).toContain((await j.p.secretary.get(`${P(pid)}/closing-conditions/${cpId}`)).status);
    expect([403, 404]).toContain((await j.p.secretary.get(`${P(pid)}/closing-conditions`)).status);
    for (const c of [j.p.pm, j.p.legal]) {
      const l = (await c.get(`${P(pid)}/ai/proposals?pageSize=100`).expect(200)).body;
      expect(l.items.map((x: { id: string }) => x.id), c.persona).toContain(proposalId);
    }
  });

  it.fails('DEFECT SEC-P34R-05: GET /ai/proposals never lists a proposal whose target the reader cannot read (no CP title, id or count)', async () => {
    const l = (await j.p.secretary.get(`${P(pid)}/ai/proposals?pageSize=100`).expect(200)).body;
    const leaked = l.items.filter((x: { id: string }) => x.id === proposalId);
    console.log(`SEC-P34R-05 observed: secretary's proposal list → total ${l.total}; proposal about the CP: ${JSON.stringify(leaked.map((x: { targetType: string; payload: { title: string } }) => ({ targetType: x.targetType, title: x.payload.title })))}`);
    expect(JSON.stringify(l)).not.toContain(CANARY);
    expect(JSON.stringify(l)).not.toContain(cpId);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('P4 exit criterion re-check — financial data only with the finance-domain clearance AND reach, in the AI channel', () => {
  let figureId: string;
  const CANARY = `${TAG}-SC-FIGURE-CANARY`;

  beforeAll(async () => {
    // Finance (finance-domain clearance strictly_confidential, access-matrix §2.3) records a strictly confidential figure.
    const f = await ok(await j.p.finance.post(`${P(pid)}/financial-snapshots`, {
      kind: 'actual',
      category: 'opex',
      lineRef: `${TAG}-SC-1`,
      label: `${CANARY} programme actual (synthetic)`,
      period: '2026-09',
      amount: { amount: '5555.0000', currency: 'SAR', unitScale: 1 },
      sourceRef: 'Synthetic source reference (probe)',
      classification: 'strictly_confidential',
    }));
    figureId = f.id;
    // Owner pool (setup): APPROVED by two people other than the preparer (as the table's check constraints require);
    // production reaches this through the validate / approve commands.
    await owner().query(
      `update financial_snapshot set validated_by = $2, validated_at = now(), validated_hash = 'p34sre-synthetic', approved_by = $3, approved_at = now(), approval_state = 'approved' where id = $1`,
      [figureId, j.p.legal.userId, j.p.sponsor.userId],
    );
  }, 120_000);

  it('CONTROL: Finance retrieves the figure; the PM (project-wide finance.record.read, base clearance confidential) is refused it in the finance module, in AI retrieval, in the citation re-check and in /ai/ask', async () => {
    const cl = (await owner().query(`select clearance from app_user where id = $1`, [j.p.pm.userId])).rows[0].clearance;
    expect(cl).toBe('confidential');
    const { contexts, db, knowledge } = await serviceHandles();
    const as = async (userId: string) => {
      const ctx = (await contexts.forUser(userId, pid))!;
      return db.run(ctx, async () => ({ fin: await knowledge.approvedFinancials(ctx, pid, true), keys: await knowledge.visibleCitationKeys(ctx, pid, [{ type: 'financial_snapshot', id: figureId }]) }));
    };
    const fin = await as(j.p.finance.userId);
    expect(fin.fin!.figures.map((x) => x.id)).toContain(figureId);
    expect([...fin.keys]).toEqual([`financial_snapshot:${figureId}`]);
    expect((await j.p.finance.get(`${P(pid)}/financial-snapshots/${figureId}`)).status).toBe(200);
    const pm = await as(j.p.pm.userId);
    expect(pm.fin!.figures.map((x) => x.id)).not.toContain(figureId);
    expect(pm.keys.size).toBe(0);
    expect((await j.p.pm.get(`${P(pid)}/financial-snapshots/${figureId}`)).status).toBe(404);
    const ask = await j.p.pm.post(`${P(pid)}/ai/ask`, { question: 'What is the approved actual amount of the programme figures?' });
    expect(ask.status).toBe(201);
    expect(JSON.stringify(ask.body)).not.toContain(CANARY);
    expect(JSON.stringify(ask.body)).not.toContain('5555.0000');
  });

  it.fails('DEFECT SEC-P34R-05 (finance): a draft proposal Finance\'s AI run writes from that figure is never listed to a reader refused the figure (the PM) — derived classification / reach of AI proposals (access-matrix §2.6)', async () => {
    // The runtime's path for a model tool call (createFromTool, as Finance in Finance's own transaction): a decision-paper draft
    // without a target whose content quotes the approved figure Finance retrieved — what a (non-mock) provider drafts.
    const { contexts, db, runtime, proposals, app } = await serviceHandles();
    const ctx = (await contexts.forUser(j.p.finance.userId, pid))!;
    const run = await db.run(ctx, () => runtime.runBriefingNow(ctx, pid));
    expect(run.status).toBe('succeeded');
    const s = await db.run(ctx, () => app.get(AiSettingsService).load(pid));
    const created = await db.run(ctx, () =>
      proposals.createFromTool(ctx, pid, { id: run.id, requestedBy: j.p.finance.userId }, aiToolByName('propose_decision_paper_draft')!, {
        title: `${CANARY} budget paper draft`,
        content: `Approved actual ${CANARY} for 2026-09: 5555.0000 SAR (unit 1). Recommendation: note the actual (Simulated draft).`,
      }, s),
    );
    expect('proposal' in created, JSON.stringify(created)).toBe(true);
    const id = (created as { proposal: { id: string } }).proposal.id;
    expect((await j.p.finance.get(`${P(pid)}/ai/proposals?pageSize=100`).expect(200)).body.items.map((x: { id: string }) => x.id)).toContain(id);
    const l = (await j.p.pm.get(`${P(pid)}/ai/proposals?pageSize=100`).expect(200)).body;
    console.log(`SEC-P34R-05 observed (finance): PM's proposal list contains the strictly confidential figure: ${JSON.stringify(l).includes('5555.0000')}; proposal ${JSON.stringify(l.items.filter((x: { id: string }) => x.id === id).map((x: { actionType: string; payload: { title: string } }) => [x.actionType, x.payload.title]))}`);
    expect(JSON.stringify(l)).not.toContain('5555.0000');
    expect(JSON.stringify(l)).not.toContain(CANARY);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('SEC-P34R-07 — evidence supersede / flag-conflict skip the target\'s command rules that evidence LINK applies [access-matrix §6 documents; SEC-P34-13 and SEC-P2-05 residual; DOM-P34R-06 reaction]', () => {
  let itemId: string;
  let transferLinkId: string;
  let decisionId: string;
  let paperLinkId: string;

  beforeAll(async () => {
    // A transfer verified on both aspects on the PM's evidence (the transfer manager links; Legal verifies).
    const x = await ok(await j.p.pm.post(`${P(pid)}/perimeter-items`, { type: 'asset', name: `${TAG} UPS string (synthetic)`, disposition: 'included', classification: 'confidential' }));
    itemId = x.id;
    let v = x.version as number;
    for (const aspect of ['legal', 'economic'] as const) {
      for (const command of ['plan', 'start', 'report_transferred'] as const) {
        v = (await ok(await j.p.pm.post(`${P(pid)}/transfers`, { perimeterItemId: itemId, aspect, command, expectedVersion: v, mechanism: 'Asset transfer instrument (synthetic)', effectiveDate: today() }))).itemVersion;
      }
    }
    transferLinkId = (await ok(await j.p.pm.post(`${P(pid)}/evidence`, { targetType: 'transfer', targetId: itemId, note: 'Signed asset transfer record (synthetic)' }))).id;
    for (const aspect of ['legal', 'economic'] as const) {
      const rep = (await j.p.pm.get(`${P(pid)}/transfers?perimeterItemId=${itemId}&aspect=${aspect}`).expect(200)).body.items.find((r: { command: string }) => r.command === 'report_transferred');
      const cur = (await j.p.pm.get(`${P(pid)}/perimeter-items/${itemId}`).expect(200)).body;
      await ok(await j.p.legal.post(`${P(pid)}/transfers/${rep.id}/verify`, { expectedVersion: cur.version, note: 'Checked against the signed record (synthetic)' }));
    }
    expect((await j.p.pm.get(`${P(pid)}/perimeter-items/${itemId}`).expect(200)).body.transfer.combined).toBe('transferred_verified');
    // A draft decision paper with the requester's own supporting evidence (SEC-P34-13: only the requester links to it).
    decisionId = (await ok(await j.p.pm.post(`${P(pid)}/decisions`, paper(j.gov.committeeId, { title: `${TAG} paper with evidence (synthetic)` })))).id;
    paperLinkId = (await ok(await j.p.pm.post(`${P(pid)}/evidence`, { targetType: 'decision', targetId: decisionId, note: 'Supporting analysis by the requester (synthetic)' }))).id;
    await runWorker();
  }, 300_000);

  it('CONTROL: LINKING is refused to the same people — the contributor has no carveout.transfer.manage (403 evidence.target_permission); another voting member may not add evidence to the draft paper (403 governance.decision.not_requester)', async () => {
    const t = await j.p.contributor.post(`${P(pid)}/evidence`, { targetType: 'transfer', targetId: itemId, note: 'probe' });
    expect(t.status).toBe(403);
    expect(t.body.code).toBe('evidence.target_permission');
    const d = await j.p.finance.post(`${P(pid)}/evidence`, { targetType: 'decision', targetId: decisionId, note: 'probe' });
    expect(d.status).toBe(403);
    expect(d.body.code).toBe('governance.decision.not_requester');
  });

  it.fails('DEFECT SEC-P34R-07: a contributor without any transfer permission cannot supersede the evidence a VERIFIED transfer relies on (403) — today it does, and the svc-carveout reaction un-verifies both aspects', async () => {
    const lv = (await owner().query(`select version from evidence_link where id = $1`, [transferLinkId])).rows[0].version as number;
    const r = await j.p.contributor.post(`${P(pid)}/evidence/${transferLinkId}/supersede`, { expectedVersion: lv, note: 'Superseded by a contributor without transfer rights (probe, synthetic)' });
    await runWorker();
    const after = (await owner().query(`select transfer_status, economic_transfer_status from perimeter_item where id = $1`, [itemId])).rows[0];
    const sys = (await owner().query(`select aspect, command, recorded_by from transfer_record where perimeter_item_id = $1 and command = 'reject_evidence' order by created_at`, [itemId])).rows;
    console.log(`SEC-P34R-07 observed (transfer): contributor supersede → ${r.status} ${JSON.stringify(r.body)}; item after the worker ${JSON.stringify(after)}; system entries ${JSON.stringify(sys)}`);
    expect(r.status).toBe(403);
    expect(after).toEqual({ transfer_status: 'transferred_verified', economic_transfer_status: 'transferred_verified' });
  });

  it.fails('DEFECT SEC-P34R-07: another voting member cannot supersede the requester\'s supporting evidence on the draft paper (403 governance.decision.not_requester), as for linking', async () => {
    const lv = (await owner().query(`select version from evidence_link where id = $1`, [paperLinkId])).rows[0].version as number;
    const r = await j.p.finance.post(`${P(pid)}/evidence/${paperLinkId}/supersede`, { expectedVersion: lv, note: 'Removed by another voting member (probe, synthetic)' });
    const row = (await owner().query(`select status from evidence_link where id = $1`, [paperLinkId])).rows[0];
    console.log(`SEC-P34R-07 observed (paper): finance supersedes the PM's paper evidence → ${r.status} ${JSON.stringify(r.body)}; link status ${row.status}`);
    expect(r.status).toBe(403);
    expect(row.status).toBe('active');
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('SEC-P34-10 re-check — who the "second person" is', () => {
  it('OBSERVED SEC-P34R-06: the project-wide functional approver (jv.cp.verify, no jv.deal.read) confirms a "not required" request on a closing deliverable it cannot open', async () => {
    const s = await ok(await j.p.pm.post(`${P(pid)}/signings`, { name: `${TAG} signing for the second person (synthetic)` }));
    const item = await ok(await j.p.pm.post(`${P(pid)}/checklist-items`, { eventId: s.id, title: `${TAG} officer certificate (synthetic)` }));
    await ok(await j.p.pm.post(`${P(pid)}/checklist-items/${item.id}/not-required`, { expectedVersion: 1, reason: `${TAG} covered by the SPA (synthetic)` }));
    const roles = await owner().query(`select role from project_membership where project_id = $1 and user_id = $2 and revoked_at is null`, [pid, j.p.approver.userId]);
    expect(roles.rows.map((r) => r.role)).toEqual(['functional_approver']);
    expect([403, 404]).toContain((await j.p.approver.get(`${P(pid)}/signings/${s.id}`)).status);
    expect([403, 404]).toContain((await j.p.approver.get(`${P(pid)}/signings`)).status);
    const conf = await j.p.approver.post(`${P(pid)}/checklist-items/${item.id}/not-required/decide`, { expectedVersion: 1, decision: 'confirm' });
    console.log(`SEC-P34R-06 observed: confirm by a second person who cannot open the item or its event → ${conf.status} ${JSON.stringify(conf.body)}`);
    expect(conf.status).toBe(201);
    expect(conf.body.status).toBe('not_required');
  });
});
