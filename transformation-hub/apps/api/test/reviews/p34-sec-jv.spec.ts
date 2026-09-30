import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApp, closePools, owner } from '../helpers';
import { P, grant, in30, login, ok, partnerAt, room, setupJvProject, syntheticUser, DocClient, JvProject } from '../jv/jv-kit';
import { paper } from '../governance/gov-fixtures';

/**
 * P3 / P4 security review probes — JV (partner rooms, due diligence, signing / closing, CPs)
 * (docs/reviews/P3-P4-security-review.md). Written by the security-privacy-reviewer; no implementation file and no
 * existing test was changed. `DEFECT` tests assert the REQUIRED behaviour with `it.fails` (green while the finding is open,
 * red once fixed — then rename to "(fixed, regression)" and make them plain tests; never weaken them); `OBSERVED` pins the
 * current behaviour of a Low / design finding; `CONTROL` confirms a control the review relies on.
 * Every record is created by this spec in its own JV project (synthetic data, fictional partner). The owner pool only
 * creates synthetic accounts (no provisioning API exists for external users) and reads rows for assertions.
 */
let j: JvProject;
let pid: string;
let ws: string[];
let wsl: DocClient; // synthetic internal account holding ONLY workstream_lead on the first workstream

const TAG = 'P34SEC';

beforeAll(async () => {
  j = await setupJvProject('P34SEC-JV');
  pid = j.projectId;
  ws = ((await j.p.pm.get(`${P(pid)}/workstreams`).expect(200)).body.items as { id: string }[]).map((w) => w.id);
  // Owner pool: the synthetic account (no provisioning API); its workstream-scoped role goes through the portfolio API.
  wsl = await syntheticUser(j.orgId, 'p34sec.wsl.only', 'internal', 'confidential');
  const admin = await login('portfolio.admin');
  await ok(await admin.post(`${P(pid)}/members`, { userId: wsl.userId, role: 'workstream_lead', workstreamId: ws[0], reason: 'P3/P4 security review probe (synthetic)' }));
  const scope = await owner().query(`select role, workstream_id from project_membership where project_id = $1 and user_id = $2 and revoked_at is null`, [pid, wsl.userId]);
  expect(scope.rows).toEqual([{ role: 'workstream_lead', workstream_id: ws[0] }]);
}, 600_000);
afterAll(async () => {
  await closeApp();
  await closePools();
});

async function signingAndClosing() {
  const s = await ok(await j.p.pm.post(`${P(pid)}/signings`, { name: `${TAG} signing (synthetic)` }));
  const c = await ok(await j.p.pm.post(`${P(pid)}/closings`, { signingId: s.id, name: `${TAG} closing (synthetic)` }));
  return { signingId: s.id as string, closingId: c.id as string };
}

// ---------------------------------------------------------------------------------------------------------------------
describe('SEC-P34-01 — a CP verified by the person who linked its evidence [access-matrix §5.1 jv.cp.verify]', () => {
  let cpId: string;
  let version: number;

  beforeAll(async () => {
    const { closingId } = await signingAndClosing();
    const cp = await ok(await j.p.legal.post(`${P(pid)}/closing-conditions`, { closingId, title: `${TAG} regulatory approval CP (synthetic)`, ownerUserId: j.p.pm.userId, blocking: true }));
    cpId = cp.id;
    // Legal (jv.cp.manage + jv.cp.verify) links the CP's only evidence; the PM (CP owner) submits it for verification.
    await ok(await j.p.legal.post(`${P(pid)}/evidence`, { targetType: 'closing_condition', targetId: cpId, note: 'Evidence linked by the future verifier (synthetic probe)' }));
    const cur = (await j.p.pm.get(`${P(pid)}/closing-conditions/${cpId}`).expect(200)).body;
    const sub = await ok(await j.p.pm.post(`${P(pid)}/closing-conditions/${cpId}/submit-evidence`, { expectedVersion: cur.version }));
    version = sub.version;
    const links = await owner().query(`select added_by from evidence_link where target_type = 'closing_condition' and target_id = $1 and status = 'active'`, [cpId]);
    expect(links.rows.map((r) => r.added_by)).toEqual([j.p.legal.userId]);
  }, 120_000);

  it.fails('DEFECT SEC-P34-01: whoever recorded the evidence of a CP cannot verify it (403) — its only evidence is their own', async () => {
    const r = await j.p.legal.post(`${P(pid)}/closing-conditions/${cpId}/verify`, { expectedVersion: version, outcome: 'verify' });
    console.log(`SEC-P34-01 (CP) observed: verify by the evidence linker → ${r.status} ${JSON.stringify(r.body)}`);
    expect(r.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('SEC-P34-04 — an external (counterparty) account uses the INTERNAL DD route [access-matrix §2.4 room, §2.8]', () => {
  let roomId: string;
  let ext: DocClient;

  beforeAll(async () => {
    const partnerId = await partnerAt(j, `${TAG} Partner (fictional)`);
    roomId = (await room(j.p.pm, pid, { name: `${TAG} partner room (test)`, type: 'partner', partnerId })).id;
    ext = await syntheticUser(j.orgId, 'p34sec.ext.a', 'external');
    await ok(await j.p.legal.post(`${P(pid)}/partners/${partnerId}/contacts`, { userId: ext.userId }));
    await ok(await grant(j.p.legal, pid, roomId, { userId: ext.userId, role: 'external_partner_limited', accessLevel: 'contribute', expiresAt: in30() }));
  }, 300_000);

  it('CONTROL: through the counterparty route the question is recorded as origin "partner", requester "Counterparty"', async () => {
    const q = await ok(await ext.post(`${P(pid)}/partner-access/rooms/${roomId}/dd-requests`, { question: `${TAG} counterparty question (synthetic)`, domain: 'legal' }));
    const row = (await owner().query(`select origin, requester_label, created_by from diligence_request where id = $1`, [q.id])).rows[0];
    expect(row).toEqual({ origin: 'partner', requester_label: 'Counterparty', created_by: ext.userId });
    // The counterparty has no read access to the internal register.
    expect([403, 404]).toContain((await ext.get(`${P(pid)}/diligence-requests`)).status);
  });

  it.fails('DEFECT SEC-P34-04: the counterparty cannot create a DD request through the internal route (403/404) — no internal-origin record, no free requester label', async () => {
    const r = await ext.post(`${P(pid)}/diligence-requests`, { roomId, question: `${TAG} question posing as internal (synthetic)`, domain: 'finance', requesterLabel: 'Mobily Legal (spoofed label, synthetic)', dueDate: '2026-12-31', classification: 'internal' });
    const row = r.body?.id ? (await owner().query(`select origin, requester_label, due_date::text, classification, created_by from diligence_request where id = $1`, [r.body.id])).rows[0] : null;
    console.log(`SEC-P34-04 observed: external POST /diligence-requests → ${r.status}; stored row ${JSON.stringify(row)}`);
    expect([403, 404]).toContain(r.status);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('SEC-P34-09 — DD findings list vs detail for a workstream-only principal [access-matrix §2.2, §2.5]', () => {
  let findingId: string;

  beforeAll(async () => {
    const f = await ok(await j.p.legal.post(`${P(pid)}/diligence-findings`, { title: `${TAG}-FINDING-CANARY valuation-relevant finding (synthetic)`, materiality: 'low', valuationImplication: 'Synthetic valuation note (probe)', classification: 'confidential' }));
    findingId = f.id;
  }, 120_000);

  it('CONTROL: the workstream-only principal is refused the finding itself (strict §2.2: JV records carry no workstream)', async () => {
    const r = await wsl.get(`${P(pid)}/diligence-findings/${findingId}`);
    expect(r.status).toBe(403);
  });

  it.fails('DEFECT SEC-P34-09: the findings list never shows (title, materiality, valuation implication) a finding the same caller is refused', async () => {
    const r = await wsl.get(`${P(pid)}/diligence-findings?pageSize=100`);
    const shown = ((r.body.items ?? []) as { id: string; title: string }[]).filter((x) => x.id === findingId);
    console.log(`SEC-P34-09 observed: list → ${r.status}, total ${r.body.total}; shown: ${JSON.stringify(shown.map((x) => x.title))}`);
    expect(JSON.stringify(r.body)).not.toContain('FINDING-CANARY');
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('SEC-P34-12 — SEC-P2-01 re-check in P3 / P4 context: a prerequisite shows an agreement the caller cannot open [access-matrix §2.2, §2.5]', () => {
  // The SEC-P2-01 fix applies the predecessor type's read permission, but RBAC-only ("held anywhere in the project"), not
  // with its reach. Agreements are a project-level register (AgreementsService.assertProjectWide: project-wide read) — a
  // workstream-only reader is refused the agreement, yet its code and title are listed as the prerequisite of a task in the
  // reader's own workstream (and the record_dependency activity rule uses the same predicate).
  let agreementId: string;
  let taskId: string;

  beforeAll(async () => {
    const agr = await ok(await j.p.pm.post(`${P(pid)}/agreements`, { kindLabel: 'SPA', title: `${TAG}-AGREEMENT-CANARY share purchase agreement (synthetic)`, ownerUserId: j.p.pm.userId }));
    agreementId = agr.id;
    const t = await ok(await j.p.pm.post(`${P(pid)}/tasks`, { workstreamId: ws[0], title: `${TAG} task waiting for the agreement (synthetic)` }));
    taskId = t.id;
    await ok(await j.p.pm.post(`${P(pid)}/prerequisites`, { successorType: 'task', successorId: taskId, predecessorType: 'agreement', predecessorId: agreementId }));
  }, 120_000);

  it('CONTROL: the workstream-only reader reads its own task but is refused the agreement (404, project-level register)', async () => {
    expect((await wsl.get(`${P(pid)}/tasks/${taskId}`)).status).toBe(200);
    expect((await wsl.get(`${P(pid)}/agreements/${agreementId}`)).status).toBe(404);
  });

  it.fails('DEFECT SEC-P34-12: the prerequisite list never shows (code, title, state) an agreement the caller cannot open', async () => {
    const list = await wsl.get(`${P(pid)}/prerequisites?successorId=${taskId}`);
    console.log(`SEC-P34-12 observed: prerequisites → ${list.status} ${JSON.stringify((list.body.items ?? []).map((i: { predecessorLabel: string }) => i.predecessorLabel))}`);
    expect(JSON.stringify(list.body)).not.toContain('AGREEMENT-CANARY');
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('SEC-P34-10 — a closing checklist item is set "not required" by one person [REQ-JV-012/014; security angle of "nobody bypasses a closing blocker"]', () => {
  it('OBSERVED SEC-P34-10: the PM alone marks a pending deliverable not required and the blocker disappears (no second person, no authority)', async () => {
    const { signingId } = await signingAndClosing();
    const item = await ok(await j.p.pm.post(`${P(pid)}/checklist-items`, { eventId: signingId, title: `${TAG} executed side letter (synthetic)` }));
    const before = (await j.p.pm.get(`${P(pid)}/signings/${signingId}`).expect(200)).body;
    expect(before.blockers.map((b: { ref: string }) => b.ref)).toContain(item.code);
    const nr = await ok(await j.p.pm.post(`${P(pid)}/checklist-items/${item.id}/not-required`, { expectedVersion: 1, reason: 'Not needed (probe, synthetic)' }));
    expect(nr.status).toBe('not_required');
    const after = (await j.p.pm.get(`${P(pid)}/signings/${signingId}`).expect(200)).body;
    expect(after.blockers.map((b: { ref: string }) => b.ref)).not.toContain(item.code);
    const approvals = await owner().query(`select count(*)::int n from approval_request where project_id = $1 and subject_id = $2`, [pid, item.id]);
    expect(approvals.rows[0].n).toBe(0);
  });

  it('CONTROL: a blocking CP cannot be released by a determination (422), and only Legal determines waivability (PM 403)', async () => {
    const { closingId } = await signingAndClosing();
    const cp = await ok(await j.p.pm.post(`${P(pid)}/closing-conditions`, { closingId, title: `${TAG} blocking CP (synthetic)`, ownerUserId: j.p.pm.userId, blocking: true }));
    const cur = (await j.p.legal.get(`${P(pid)}/closing-conditions/${cp.id}`).expect(200)).body;
    const det = await j.p.legal.post(`${P(pid)}/closing-conditions/${cp.id}/determine-waivability`, { expectedVersion: cur.version, blocking: false, waivable: false, waiverAuthorityRole: null, basis: 'Attempt to release (probe)' });
    expect(det.status).toBe(422);
    expect(det.body.code).toBe('jv.cp.blocking_release_not_allowed');
    const pmWaive = await j.p.pm.post(`${P(pid)}/closing-conditions/${cp.id}/determine-waivability`, { expectedVersion: cur.version, blocking: true, waivable: true, waiverAuthorityRole: 'sponsor', basis: 'probe' });
    expect(pmWaive.status).toBe(403); // jv.cp.set_waivability is Legal only
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('SEC-P34-13 — SEC-P2-02 re-check: the paper is shaped only by its requester [access-matrix §5.1, decision-workflow step 3]', () => {
  let decisionId: string;
  let version: number;

  beforeAll(async () => {
    const d = await ok(await j.p.pm.post(`${P(pid)}/decisions`, paper(j.gov.committeeId, { title: `${TAG} paper drafted by the PM (synthetic)` })));
    decisionId = d.id;
    version = d.version;
  });

  it('CONTROL (SEC-P2-02 fix intact): another voting member may neither edit nor submit the paper (403 governance.decision.not_requester)', async () => {
    const e = await j.p.finance.patch(`${P(pid)}/decisions/${decisionId}`, { expectedVersion: version, recommendation: 'Rewritten by the finance member (probe)' });
    expect(e.status).toBe(403);
    expect(e.body.code).toBe('governance.decision.not_requester');
    const s2 = await j.p.finance.post(`${P(pid)}/decisions/${decisionId}/submit`, { expectedVersion: version });
    expect(s2.status).toBe(403);
    expect(s2.body.code).toBe('governance.decision.not_requester');
  });

  it.fails('DEFECT SEC-P34-13: another voting member cannot add evidence to the requester’s draft paper either (the paper’s evidence is part of the paper, DOM-P2-14)', async () => {
    const r = await j.p.finance.post(`${P(pid)}/evidence`, { targetType: 'decision', targetId: decisionId, note: 'Supporting evidence added by a voting member who is not the requester (probe)' });
    console.log(`SEC-P34-13 observed: evidence link on another member's draft paper → ${r.status} ${JSON.stringify(r.body)}`);
    expect(r.status).toBe(403);
  });
});
