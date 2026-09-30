import { expect } from 'vitest';
import { getApp, loginAs, owner, demoUserId, Client } from '../helpers';
import { WorkerService } from '../../src/platform/jobs/worker.service';
import { JobRegistry } from '../../src/platform/jobs/job-registry';
import { registerJobHandlers } from '../../src/jobs';
import { Actors, setupCommittee, openMeeting, tabledDecision, vote, decisionVersion, verifiedDecisionEvidence } from '../governance/gov-fixtures';
import { demoEmail } from '../../src/cli/seed-demo';

/**
 * Test kit for the gates acceptance tests. Each spec creates its OWN DC project through the portfolio API (isolated from
 * the demo data and other specs) and grants the demo personas their usual roles in it.
 *
 * Evidence links go through the documents API and governance decisions through the governance API (committee, DEMO
 * matrix, meeting, votes, outcome, external approval). The owner pool is used only for register rows of modules not yet
 * implemented (perimeter, TSA, legal-entity verification) and for decision states the governance API cannot produce.
 */

export interface Personas {
  pm: Client;
  sponsor: Client;
  chair: Client;
  secretary: Client;
  legal: Client;
  finance: Client;
  approver: Client;
  contributor: Client;
  /** Holds `workstream_lead` on the project's first workstream only (a workstream-scoped grant). */
  techLead: Client;
}

export interface GateView {
  id: string;
  key: string;
  ownerRole: string;
  reviewerRole: string;
  approverRole: string;
  assessment: {
    id: string;
    cycle: number;
    status: string;
    version: number;
    decisionId: string | null;
    decidedBy: string | null;
    decidedAt: string | null;
    submittedBy: string | null;
    startedBy: string | null;
    reviewedBy: string | null;
    reviewOutcome: string | null;
    reviewNote: string | null;
    reassessment: { needsReassessment: boolean; criteria: { key: string }[]; escalationId: string | null; upstreamGateKeys: string[] };
  };
  /** Gate-level review of the current cycle (DOM-P2-16). */
  review: { state: string; reviewerRole: string; outcome: string | null; reviewedBy: string | null; reviewedByName: string | null; reviewedAt: string | null; note: string | null; startedBy: string | null; startedByName: string | null };
  evaluation: { ready: boolean; hasWaivers: boolean; blockers: { kind: string; ref: string; message: string }[]; counts: Record<string, number> };
  blockers: { kind: string; ref: string; message: string }[];
  rag: string;
  history: { id: string; cycle: number; status: string }[];
  criteria: {
    id: string;
    key: string;
    mandatory: boolean;
    blocking: boolean;
    waivable: boolean;
    version: number;
    ownerRole: string;
    reviewerRole: string;
    evidence: { active: number; conflicting: number };
    assessment: { id: string; status: string; version: number; waiverId: string | null; notApplicable: { approved: boolean } };
  }[];
  cycles: { id: string; cycle: number; status: string; isCurrent: boolean; criteria: { key: string; status: string }[] }[];
  decisions: { id: string; status: string }[];
}

const ROLE_GRANTS: [keyof Personas, string[]][] = [
  ['sponsor', ['sponsor']],
  ['chair', ['committee_chair']],
  ['secretary', ['secretary_cpmo']],
  ['legal', ['legal_restricted', 'functional_approver']],
  ['finance', ['finance_restricted', 'functional_approver']],
  ['approver', ['functional_approver']],
  ['contributor', ['contributor']],
];

export async function setupProject(code: string, extraGrants: [string, string][] = []): Promise<{ projectId: string; orgId: string; p: Personas }> {
  const admin = await loginAs('portfolio.admin');
  const templates = (await admin.get('/api/v1/templates').expect(200)).body.items as { id: string; templateKey: string }[];
  const dc = templates.find((t) => t.templateKey === 'dc-carveout')!;
  const pmId = await demoUserId('pm');
  const created = await admin
    .post('/api/v1/projects', {
      templateVersionId: dc.id,
      code,
      name: `${code} — gates test project`,
      projectManagerUserId: pmId,
      newco: { mode: 'new', name: `${code} NewCo (test entity)`, incorporationStatus: 'unconfirmed' },
    })
    .expect(201);
  const projectId = created.body.id as string;
  // The test project holds synthetic data only; flag it as demo (owner pool — no API sets this) so the governance
  // module accepts the DEMO authority matrix for it, exactly as in the demo sandbox project.
  await owner().query('update project set is_demo = true where id = $1', [projectId]);
  for (const [persona, roles] of ROLE_GRANTS) {
    const userId = await demoUserId(persona);
    for (const role of roles) await admin.post(`/api/v1/projects/${projectId}/members`, { userId, role, reason: 'gates test' }).expect(201);
  }
  for (const [persona, role] of extraGrants) {
    await admin.post(`/api/v1/projects/${projectId}/members`, { userId: await demoUserId(persona), role, reason: 'gates test (extra role)' }).expect(201);
  }
  const org = await owner().query<{ org_id: string }>('select org_id from project where id = $1', [projectId]);
  const p = {} as Personas;
  for (const k of ['pm', 'sponsor', 'chair', 'secretary', 'legal', 'finance', 'approver', 'contributor'] as const) p[k] = await loginAs(k);
  // Workstream-designated criteria (e.g. G5-C07, G6-C03) are reviewed by a workstream lead: grant tech.lead that role on
  // the first template workstream only, so the workstream-scoped path of the designated-reviewer rule is exercised.
  const ws = (await p.pm.get(`/api/v1/projects/${projectId}/workstreams`).expect(200)).body.items as { id: string }[];
  await admin.post(`/api/v1/projects/${projectId}/members`, { userId: await demoUserId('tech.lead'), role: 'workstream_lead', workstreamId: ws[0]!.id, reason: 'gates test (workstream lead)' }).expect(201);
  p.techLead = await loginAs('tech.lead');
  return { projectId, orgId: org.rows[0]!.org_id, p };
}

export async function gateByKey(c: Client, projectId: string, key: string): Promise<GateView> {
  const list = (await c.get(`/api/v1/projects/${projectId}/gates`).expect(200)).body.items as { id: string; key: string }[];
  const g = list.find((x) => x.key === key)!;
  return (await c.get(`/api/v1/projects/${projectId}/gates/${g.id}`).expect(200)).body as GateView;
}

export function crit(g: GateView, key: string) {
  const c = g.criteria.find((x) => x.key === key);
  if (!c) throw new Error(`criterion ${key} not found`);
  return c;
}

/** Link note evidence to a criterion through the DOCUMENTS module API (it owns evidence_link writes). */
export async function addEvidence(c: Client, projectId: string, criterionId: string, note = 'Test evidence note (synthetic)'): Promise<string> {
  const r = await c.post(`/api/v1/projects/${projectId}/evidence`, { targetType: 'gate_criterion', targetId: criterionId, note });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.id as string;
}

export async function evidenceLinks(c: Client, projectId: string, criterionId: string) {
  return (await c.get(`/api/v1/projects/${projectId}/evidence?targetType=gate_criterion&targetId=${criterionId}`).expect(200)).body.items as { id: string; status: string; version: number }[];
}

/** Documents API: a new link that contradicts an earlier one -> both links become conflicting + evidence.changed. */
export async function contradictEvidence(c: Client, projectId: string, criterionId: string, earlierLinkId: string, note: string) {
  const r = await c.post(`/api/v1/projects/${projectId}/evidence`, { targetType: 'gate_criterion', targetId: criterionId, note, conflictsWithLinkId: earlierLinkId, conflictNote: note });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  expect(r.body.status).toBe('conflicting');
  return r.body.id as string;
}

/** Documents API: supersede every non-final link of the criterion (kept for history). */
export async function supersedeAll(c: Client, projectId: string, criterionId: string) {
  for (const l of await evidenceLinks(c, projectId, criterionId)) {
    if (l.status === 'superseded' || l.status === 'rejected') continue;
    await c.post(`/api/v1/projects/${projectId}/evidence/${l.id}/supersede`, { expectedVersion: l.version, note: 'Superseded after conflict resolution (test)' }).expect(201);
  }
}

/**
 * Governance decision row inserted with the OWNER pool -- used only for states the governance API can never produce
 * (defense-in-depth checks) and for a decision of ANOTHER project. Normal decisions go through the governance API.
 */
export async function insertDecisionRow(
  orgId: string,
  projectId: string,
  d: { code: string; status: string; authorityOutcome: string; gateKey?: string | null; externalRef?: string | null },
): Promise<string> {
  const c = await owner().query<{ id: string }>(
    `insert into committee (id, org_id, project_id, kind, name) values (gen_random_uuid(), $1, $2, 'program_steering', $3) returning id`,
    [orgId, projectId, `Owner-inserted test committee ${d.code} (synthetic)`],
  );
  const r = await owner().query<{ id: string }>(
    `insert into decision (id, org_id, project_id, committee_id, code, title, status, authority_outcome, gate_key, external_authority_reference)
     values (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
    [orgId, projectId, c.rows[0]!.id, d.code, `Test decision ${d.code} (synthetic)`, d.status, d.authorityOutcome, d.gateKey ?? null, d.externalRef ?? null],
  );
  return r.rows[0]!.id;
}

export interface Gov {
  committeeId: string;
  meetingId: string;
  /** Second secretariat member (records external approvals; must differ from the recommendation recorder). */
  secretary2: Client;
}

/** Real governance set-up through the governance API: active committee, approved DEMO matrix, open meeting with quorum. */
export async function setupGovernance(projectId: string, p: Personas): Promise<Gov> {
  const tc = await setupCommittee(projectId, p as unknown as Actors);
  const meetingId = (await openMeeting(projectId, p as unknown as Actors, tc, ['chair', 'sponsor', 'secretary', 'finance', 'legal', 'approver'])).id;
  const admin = await loginAs('portfolio.admin');
  const opsLead = await loginAs('ops.lead');
  await admin.post(`/api/v1/projects/${projectId}/members`, { userId: opsLead.userId, role: 'secretary_cpmo', reason: 'gates test: second secretariat member' }).expect(201);
  return { committeeId: tc.id, meetingId, secretary2: await loginAs('ops.lead') };
}

/** Gate passage decision types of the DEMO authority matrix: G0/G5/G6 are reserved matters (recommendation only). */
const GATE_DECISION_TYPE: Record<string, string> = {
  G0: 'gate_decision_mandate',
  G5: 'jv_signing_authorization',
  G6: 'jv_closing_confirmation',
};

/**
 * Governance decision for a gate through the real API: draft -> submit -> review at the meeting -> passing vote -> outcome.
 * Within the committee mandate it ends `approved`; for a reserved matter it ends `recommended` (pending external
 * authority) unless `externalApproval` is set, in which case a second secretary records the authorized body's approval.
 */
export async function gateDecision(
  projectId: string,
  p: Personas,
  gov: Gov,
  gateKey: string,
  opts: { decisionTypeKey?: string; vote?: boolean; externalApproval?: boolean } = {},
): Promise<{ id: string; code: string; status: string }> {
  const a = p as unknown as Actors;
  const d = await tabledDecision(projectId, a, p.pm, gov.committeeId, gov.meetingId, {
    decisionTypeKey: opts.decisionTypeKey ?? GATE_DECISION_TYPE[gateKey] ?? 'gate_decision_operational',
    gateKey,
    amount: null,
    requiredAuthority: 'Per the DEMO authority matrix (synthetic)',
  });
  if (opts.vote === false) return { id: d.id, code: d.code, status: 'under_review' };
  const v = await decisionVersion(p.chair, projectId, d.id);
  for (const k of ['chair', 'sponsor', 'finance', 'legal'] as const) {
    const r = await vote(projectId, p[k], d.id, 'approve', v);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
  }
  const out = await p.secretary.post(`/api/v1/projects/${projectId}/decisions/${d.id}/record-outcome`, { expectedVersion: v });
  expect(out.status, JSON.stringify(out.body)).toBe(201);
  let status = out.body.status as string;
  if (opts.externalApproval && status === 'recommended') {
    // DOM-P2-12: the external decision rests on a verified evidence link on the decision (PM links, Legal verifies).
    const evidenceLinkId = await verifiedDecisionEvidence(projectId, p.pm, p.legal, d.id);
    const ev = await decisionVersion(p.chair, projectId, d.id);
    const ext = await gov.secretary2.post(`/api/v1/projects/${projectId}/decisions/${d.id}/record-external-approval`, {
      expectedVersion: ev,
      outcome: 'approved',
      externalReference: 'DEMO-BOARD-RESOLUTION (synthetic)',
      evidenceLinkId,
      note: 'Synthetic external decision (test)',
    });
    expect(ext.status, JSON.stringify(ext.body)).toBe(201);
    status = ext.body.status;
  }
  return { id: d.id, code: d.code, status };
}

/**
 * The persona holding each gate OWNER role in the test project (DOM-P2-16): the owner starts and submits the cycle. The
 * workstream lead owns through the workstream it leads (tech.lead, first workstream). The project manager may also act as
 * owner (access-matrix §2.4), but for G0/G1 the PM is the gate REVIEWER, who must not start or submit the cycle.
 */
const OWNER_PERSONA: Record<string, keyof Personas> = {
  secretary_cpmo: 'secretary',
  workstream_lead: 'techLead',
  legal_restricted: 'legal',
  project_manager: 'pm',
};

/** The persona holding the gate's owner role. */
export function ownerFor(p: Personas, ownerRole: string): Client {
  const k = OWNER_PERSONA[ownerRole];
  if (!k) throw new Error(`no test persona holds gate owner role ${ownerRole}`);
  return p[k];
}

/** The gate's owner starts the cycle (a new cycle or one reopened through the controlled reopen). */
export async function startGate(p: Personas, projectId: string, key: string) {
  const g = await gateByKey(p.pm, projectId, key);
  if (g.assessment.status === 'not_started' || g.assessment.status === 'reopened') {
    const r = await ownerFor(p, g.ownerRole).post(`/api/v1/projects/${projectId}/gates/${g.id}/assessment/start`, { expectedVersion: g.assessment.version });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
  }
}

/** The persona holding each designated reviewer role in the test project (see ROLE_GRANTS). */
const REVIEWER_PERSONA: Record<string, keyof Personas> = {
  sponsor: 'sponsor',
  committee_chair: 'chair',
  secretary_cpmo: 'secretary',
  project_manager: 'pm',
  workstream_lead: 'techLead',
  functional_approver: 'approver',
  finance_restricted: 'finance',
  legal_restricted: 'legal',
};

/** The criterion's designated reviewer (only that role may accept, return or determine N/A). */
export function reviewerFor(p: Personas, reviewerRole: string): Client {
  const k = REVIEWER_PERSONA[reviewerRole];
  if (!k) throw new Error(`no test persona holds reviewer role ${reviewerRole}`);
  return p[k];
}

/** Project-wide holders of a criterion OWNER role among the kit personas (they also hold `gates.evidence.attach`). */
const CRITERION_OWNER_PERSONA: Record<string, keyof Personas> = {
  finance_restricted: 'finance',
  legal_restricted: 'legal',
};

/**
 * A second project manager per project, granted on first use: a dedicated synthetic test persona (`gates.pm2`, created with
 * the owner pool like the JV kit's synthetic users — no provisioning API exists). Not a demo persona on purpose: `pm.b` and
 * the others are outsiders / inbox owners in other specs, and a grant here would change what they see.
 */
const SECOND_PM = 'gates.pm2';
const secondPms = new Map<string, Promise<Client>>();
function secondPm(projectId: string): Promise<Client> {
  let c = secondPms.get(projectId);
  if (!c) {
    c = (async () => {
      await owner().query(
        `insert into app_user (id, org_id, email, display_name, title, clearance, is_demo, locale, account_type)
         select gen_random_uuid(), org_id, $2, 'Test second project manager (synthetic)', 'Synthetic test persona', 'confidential', true, 'en', 'internal'
           from project where id = $1
         on conflict (org_id, email) do nothing`,
        [projectId, demoEmail(SECOND_PM)],
      );
      const admin = await loginAs('portfolio.admin');
      const pm2 = await loginAs(SECOND_PM);
      await admin.post(`/api/v1/projects/${projectId}/members`, { userId: pm2.userId, role: 'project_manager', reason: 'gates test: second project manager (evidence linker)' }).expect(201);
      return pm2;
    })();
    secondPms.set(projectId, c);
  }
  return c;
}

/**
 * Someone other than the reviewer links the evidence (not_self), and — SEC-P2-05 — only the criterion's OWNER role or a
 * project manager may link evidence to a criterion (the `W` condition of gates.evidence.attach, as for submitting it).
 * The PM links, unless the PM is the designated reviewer: then a project-wide holder of the owner role (finance / legal),
 * or else a second project manager (`gates.pm2`, granted on demand) — the workstream lead is workstream-scoped in the kit, and
 * a workstream-scoped grant does not reach gate criteria (access-matrix §2.2).
 */
export async function evidenceAdderFor(p: Personas, projectId: string, c: { reviewerRole: string; ownerRole: string }): Promise<Client> {
  if (c.reviewerRole !== 'project_manager') return p.pm;
  const owner = CRITERION_OWNER_PERSONA[c.ownerRole];
  return owner ? p[owner] : secondPm(projectId);
}

/** A different person links evidence; the criterion's designated reviewer accepts it as met. */
export async function meetCriterion(p: Personas, projectId: string, gateKey: string, critKey: string) {
  const g = await gateByKey(p.pm, projectId, gateKey);
  const c = crit(g, critKey);
  if (c.evidence.active === 0) await addEvidence(await evidenceAdderFor(p, projectId, c), projectId, c.id);
  const res = await reviewerFor(p, c.reviewerRole).post(`/api/v1/projects/${projectId}/gates/${g.id}/criteria/${c.id}/review`, { expectedVersion: c.assessment.version, outcome: 'met', note: 'test review' });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
}

export async function meetAllMandatory(p: Personas, projectId: string, gateKey: string, except: string[] = []) {
  const g = await gateByKey(p.pm, projectId, gateKey);
  for (const c of g.criteria) if (c.mandatory && !except.includes(c.key) && c.assessment.status !== 'met') await meetCriterion(p, projectId, gateKey, c.key);
}

/** The gate's designated REVIEWER role records the gate-level review (DOM-P2-16) — never the person who started the cycle. */
export async function reviewGate(p: Personas, projectId: string, key: string, outcome: 'endorse' | 'return' = 'endorse', note = 'Gate assessment reviewed (test)') {
  const g = await gateByKey(p.pm, projectId, key);
  const r = await reviewerFor(p, g.reviewerRole).post(`/api/v1/projects/${projectId}/gates/${g.id}/assessment/review`, { expectedVersion: g.assessment.version, outcome, note });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body;
}

/** The gate's owner submits the cycle for decision (needs a current endorsement by the gate reviewer). */
export async function markReady(p: Personas, projectId: string, key: string) {
  const g = await gateByKey(p.pm, projectId, key);
  const r = await ownerFor(p, g.ownerRole).post(`/api/v1/projects/${projectId}/gates/${g.id}/assessment/mark-ready`, { expectedVersion: g.assessment.version });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body;
}

/** Owner starts, criteria met by their designated reviewers, gate reviewer endorses (unless current), owner marks ready. */
export async function makeReady(p: Personas, projectId: string, key: string) {
  await startGate(p, projectId, key);
  await meetAllMandatory(p, projectId, key);
  if ((await gateByKey(p.pm, projectId, key)).review.state !== 'endorsed') await reviewGate(p, projectId, key);
  return markReady(p, projectId, key);
}

/** Approve a ready gate backed by a FINAL governance decision (approver = sponsor for G0, chair otherwise). */
export async function approveGate(p: Personas, gov: Gov, projectId: string, key: string) {
  const d = await gateDecision(projectId, p, gov, key, { externalApproval: true });
  expect(d.status).toBe('approved');
  const g = await gateByKey(p.pm, projectId, key);
  const approver = key === 'G0' ? p.sponsor : p.chair;
  const r = await approver.post(`/api/v1/projects/${projectId}/gates/${g.id}/assessment/decide`, { expectedVersion: g.assessment.version, outcome: 'approve', decisionId: d.id, note: 'test approval' });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return { decisionId: d.id, result: r.body };
}

/**
 * Run the worker exactly as production does (all module handlers registered as in worker.ts): dispatch outbox -> run
 * subscribed jobs, until nothing is left.
 */
export async function runWorker() {
  const app = await getApp();
  if (!app.get(JobRegistry).handler('gates.recompute_dimensions')) registerJobHandlers(app);
  const worker = app.get(WorkerService);
  for (let i = 0; i < 50; i++) {
    const d = await worker.dispatchOutbox(500);
    const e = await worker.runJobs(50);
    if (d === 0 && e === 0) break;
  }
}
