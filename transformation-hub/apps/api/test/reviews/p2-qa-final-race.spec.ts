import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApp, closePools, owner } from '../helpers';
import { setupProject, setupGovernance, gateByKey, crit, evidenceLinks, makeReady, approveGate, gateDecision, reviewGate, markReady, Personas, Gov } from '../gates/gate-test-kit';
import { Actors, P, decisionVersion, tabledDecision, uniq, verifiedDecisionEvidence, vote } from '../governance/gov-fixtures';
import { createItem, ok, workstreamId } from '../carveout/carveout-kit';

/**
 * P2 QA FINAL re-review (docs/reviews/P2-qa-final-review.md) — independent re-check of the fixes of QA-P2-01 (one decision
 * backs one approval, also under concurrency), QA-P2-03 (no decision on a stale endorsement) and F-03 (distinct agenda
 * numbers), through the real HTTP API and PostgreSQL. Written by the qa-test-engineer; no implementation code was changed.
 *
 * Why this file exists next to p2-qa-adversarial.spec.ts: since DOM-P2R-03 a change-request approval needs a decision RAISED
 * FOR that change request. The original QA-P2-01 probe uses a decision raised for no record, so both of its approvals are
 * now refused with `change_control.decision_no_subject` before the single-use check is reached — it passes, but no longer
 * exercises the race. The probes below use decisions raised for a record, so the approval that CAN pass does pass, and they
 * also cover the combinations asked for in the final re-review: several change requests at once, the same change request
 * several times at once, a change request and a baseline, and a perimeter version and a gate cycle on one decision.
 *
 * Every race runs QA_RACE_RUNS times (default 1, within the default per-user mutation rate limit; the final review ran it with
 * 5 and HUB_RATE_LIMIT_MUTATIONS_PER_MINUTE raised)
 * with fresh records; "forced" = a test-only owner transaction holds a
 * table lock on `outbox_event` (the last write of an approval) until the racing requests are waiting, then releases it.
 * One synthetic demo-flagged project (gate kit; DEMO matrix; change_request_budget limit 1,000,000 SAR).
 */
const RUNS = Number(process.env.QA_RACE_RUNS ?? 1);
let pid: string;
let p: Personas;
let gov: Gov;
const A = () => p as unknown as Actors;
const SAR = (amount: string) => ({ amount, currency: 'SAR', unitScale: 1 });
const count = async (sqlText: string, params: unknown[]) => (await owner().query<{ n: number }>(sqlText, params)).rows[0]!.n;
type Res = { status: number; body: Record<string, unknown> };
/** The two documented refusals of a change-request approval on a decision raised for another change request that another approval may already have consumed. */
const REFUSED = ['change_control.decision_already_used', 'change_control.decision_other_subject'];
const summary = (rs: Res[]) => rs.map((r) => `${r.status}:${(r.body.code as string) ?? (r.body.status as string) ?? ''}`);

beforeAll(async () => {
  ({ projectId: pid, p } = await setupProject('QA-P2F'));
  gov = await setupGovernance(pid, p);
}, 600_000);
afterAll(async () => {
  await closeApp();
  await closePools();
});

/** A change request of `cost` SAR raised by the PM, under review, its cost confirmed by an assessor other than the requester (Finance). */
async function crConfirmed(title: string, cost: string): Promise<string> {
  const cr = await p.pm.post(`${P(pid)}/change-requests`, { title: uniq(title), rationale: 'QA final probe (synthetic)', alternatives: ['Do nothing'], impacts: { scope: 'Synthetic' }, costImpact: SAR(cost) });
  expect(cr.status, JSON.stringify(cr.body)).toBe(201);
  await p.pm.post(`${P(pid)}/change-requests/${cr.body.id}/submit`, { expectedVersion: 1 }).expect(201);
  await p.pm.post(`${P(pid)}/change-requests/${cr.body.id}/start-review`, { expectedVersion: 2 }).expect(201);
  const v = (await p.pm.get(`${P(pid)}/change-requests/${cr.body.id}`).expect(200)).body.version as number;
  await p.finance.post(`${P(pid)}/change-requests/${cr.body.id}/assess`, { expectedVersion: v, impacts: {}, costImpact: SAR(cost), note: 'Assessed by Finance (synthetic)' }).expect(201);
  expect((await p.pm.get(`${P(pid)}/change-requests/${cr.body.id}`).expect(200)).body.costImpactConfirmed).toBe(true);
  return cr.body.id as string;
}
const crVersion = async (id: string) => (await p.pm.get(`${P(pid)}/change-requests/${id}`).expect(200)).body.version as number;

/**
 * A committee paper of type change_request_budget for 1,500,000 SAR (above the DEMO limit) raised FOR `subject`, voted by every
 * present voting member, recorded as a recommendation, then approved by the external body on evidence verified by a second
 * person — a final decision that may back exactly its subject.
 */
async function externallyApprovedFor(subject: { subjectType: string; subjectId: string }, over: Record<string, unknown> = {}) {
  const d = await tabledDecision(pid, A(), p.pm, gov.committeeId, gov.meetingId, { title: uniq('QA final race decision'), decisionTypeKey: 'change_request_budget', amount: SAR('1500000.0000'), ...subject, ...over });
  const v = await decisionVersion(p.chair, pid, d.id);
  for (const k of ['chair', 'sponsor', 'finance', 'legal'] as const) expect((await vote(pid, p[k], d.id, 'approve', v)).status).toBe(201);
  const out = await p.secretary.post(`${P(pid)}/decisions/${d.id}/record-outcome`, { expectedVersion: v });
  expect(out.body.status, JSON.stringify(out.body)).toBe('recommended');
  const evidenceLinkId = await verifiedDecisionEvidence(pid, p.pm, p.legal, d.id);
  const ext = await gov.secretary2.post(`${P(pid)}/decisions/${d.id}/record-external-approval`, { expectedVersion: await decisionVersion(p.chair, pid, d.id), outcome: 'approved', externalReference: 'QA-FINAL-DELEGATING-AUTHORITY (synthetic)', evidenceLinkId });
  expect(ext.status, JSON.stringify(ext.body)).toBe(201);
  return d.id;
}

/**
 * Deterministic interleaving: an owner transaction holds `outbox_event` in SHARE ROW EXCLUSIVE mode; the requests are sent;
 * we wait (max 6 s) until `expectWaiting` backends of THIS database wait on a lock (outbox table, decision / change-request
 * row, audit chain), then release. Returns the responses and the largest number of waiters seen.
 */
async function forced(send: () => Promise<Res>[], expectWaiting: number): Promise<{ results: Res[]; waiting: number }> {
  const locker = await owner().connect();
  try {
    await locker.query('begin');
    await locker.query('lock table outbox_event in share row exclusive mode');
    const pending = send();
    // Held at most 6 s: the API's lock_timeout is 10 s (HUB_DB_LOCK_TIMEOUT_MS); a longer hold makes the waiting request
    // fail with a lock timeout (answered 500 — see the final review, QA-P2F-02), which is not what this probe measures.
    let waiting = 0;
    for (let i = 0; i < 60 && waiting < expectWaiting; i++) {
      await new Promise((r) => setTimeout(r, 100));
      const now = await count(`select count(*)::int n from pg_locks l join pg_stat_activity a on a.pid = l.pid where not l.granted and a.datname = current_database()`, []);
      waiting = Math.max(waiting, now);
    }
    await locker.query('commit');
    return { results: await Promise.all(pending), waiting };
  } finally {
    locker.release();
  }
}
const approveCr = (id: string, expectedVersion: number, decisionId: string): Promise<Res> =>
  p.sponsor.post(`${P(pid)}/change-requests/${id}/approve`, { expectedVersion, decisionId, note: 'QA final race probe (synthetic)' }).then((r) => ({ status: r.status, body: r.body }));
const usesOf = async (decisionId: string) => (await owner().query<{ use_kind: string; subject_id: string }>(`select use_kind, subject_id from decision_use where decision_id = $1 order by use_kind`, [decisionId])).rows;

// Runs first: the per-user mutation rate limit (HUB_RATE_LIMIT_MUTATIONS_PER_MINUTE, 120 by default) is shared with the
// races below, which use the same personas; after them the PM / secretary budget of the minute can be spent (429).
describe('F-03 re-check — agenda numbers stay distinct when requests are screened at the same instant [REQ-GOV-013]', () => {
  it(`five agenda requests accepted onto one meeting at once, ×${RUNS} meetings: numbers 1..5, all 201`, async () => {
    for (let run = 0; run < RUNS; run++) {
      const m = await p.secretary.post(`${P(pid)}/committees/${gov.committeeId}/meetings`, { title: uniq('QA final numbering meeting'), scheduledAt: new Date().toISOString() });
      expect(m.status, JSON.stringify(m.body)).toBe(201);
      const reqs: { id: string; version: number }[] = [];
      for (let i = 0; i < 5; i++) {
        const r = await p.pm.post(`${P(pid)}/agenda-requests`, { committeeId: gov.committeeId, title: uniq(`QA final numbering item ${i}`), kind: 'information', meetingId: m.body.id });
        expect(r.status, JSON.stringify(r.body)).toBe(201);
        reqs.push(r.body as { id: string; version: number });
      }
      const res = await Promise.all(reqs.map((r) => p.secretary.post(`${P(pid)}/agenda-requests/${r.id}/screen`, { expectedVersion: r.version, outcome: 'accept', meetingId: m.body.id })));
      const numbers = (await owner().query<{ number: number }>(`select number from agenda_item where meeting_id = $1 and screening_status = 'accepted' order by number`, [m.body.id])).rows.map((r) => r.number);
      console.log(`F-03 final run ${run + 1}: statuses ${JSON.stringify(res.map((r) => r.status))} numbers ${JSON.stringify(numbers)}`);
      expect(res.map((r) => r.status)).toEqual([201, 201, 201, 201, 201]);
      expect(numbers).toEqual([1, 2, 3, 4, 5]);
    }
  }, 900_000);
});

describe('QA-P2-03 re-check — the gate approver cannot decide on a basis the gate reviewer did not endorse [REQ-LCY-010, DOM-P2-16, AT-16]', () => {
  it('evidence verified after submission: decide approve → 422 review_stale, nothing consumed; after a fresh review the SAME decision approves', async () => {
    await makeReady(p, pid, 'G0');
    let g0 = await gateByKey(p.pm, pid, 'G0');
    expect(g0.assessment.status).toBe('ready_for_decision');
    expect(g0.review.state).toBe('endorsed');
    // A relied-upon evidence link of G0-C01 is verified (accepted) by Legal AFTER the submission: the basis changes.
    const c01 = crit(g0, 'G0-C01');
    const link = (await evidenceLinks(p.pm, pid, c01.id)).find((l) => l.status === 'active')!;
    const verified = await p.legal.post(`${P(pid)}/evidence/${link.id}/verify`, { expectedVersion: link.version, decision: 'accept', note: 'QA final: verified after the submission (synthetic)' });
    expect(verified.status, JSON.stringify(verified.body)).toBe(201);
    g0 = await gateByKey(p.pm, pid, 'G0');
    expect(g0.review.state).toBe('stale');
    const d = await gateDecision(pid, p, gov, 'G0', { externalApproval: true });
    expect(d.status).toBe('approved');
    const refused = await p.sponsor.post(`${P(pid)}/gates/${g0.id}/assessment/decide`, { expectedVersion: g0.assessment.version, outcome: 'approve', decisionId: d.id, note: 'QA final probe (synthetic)' });
    console.log(`QA-P2-03 final: decide on a stale endorsement → ${refused.status} ${refused.body.code}`);
    expect(refused.status, JSON.stringify(refused.body)).toBe(422);
    expect(refused.body.code).toBe('gates.assessment.review_stale');
    expect((await gateByKey(p.pm, pid, 'G0')).assessment.status).toBe('ready_for_decision');
    expect(await usesOf(d.id)).toEqual([]);
    // The owner sends it back, the gate reviewer endorses the current basis, the owner submits: the same decision approves.
    const back = await p.secretary.post(`${P(pid)}/gates/${g0.id}/assessment/back-to-assessment`, { expectedVersion: g0.assessment.version, note: 'Back for a fresh review (synthetic)' });
    expect(back.status, JSON.stringify(back.body)).toBe(201);
    await reviewGate(p, pid, 'G0');
    await markReady(p, pid, 'G0');
    g0 = await gateByKey(p.pm, pid, 'G0');
    const approved = await p.sponsor.post(`${P(pid)}/gates/${g0.id}/assessment/decide`, { expectedVersion: g0.assessment.version, outcome: 'approve', decisionId: d.id, note: 'QA final: approved after a fresh review (synthetic)' });
    expect(approved.status, JSON.stringify(approved.body)).toBe(201);
    expect((await usesOf(d.id)).map((u) => u.use_kind)).toEqual(['gate_cycle']);
  }, 900_000);
});

describe('QA-P2-01 re-check — one decision backs one change request, also at the same time [REQ-GOV-022, REQ-PLN-013, AT-04, AT-16]', () => {
  it(`forced interleaving ×${RUNS}: the decision raised for X approves X; Y approved at the same instant on it is refused; one registered use`, async () => {
    for (let run = 0; run < RUNS; run++) {
      const x = await crConfirmed(`QA forced X${run}`, '1200000.0000');
      const y = await crConfirmed(`QA forced Y${run}`, '1200000.0000');
      const d = await externallyApprovedFor({ subjectType: 'change_request', subjectId: x });
      const [vx, vy] = [await crVersion(x), await crVersion(y)];
      const { results, waiting } = await forced(() => [approveCr(x, vx, d), approveCr(y, vy, d)], 2);
      console.log(`QA-P2-01 final forced run ${run + 1}: waiting ${waiting}; X ${summary([results[0]!])} Y ${summary([results[1]!])}`);
      expect(results.every((r) => r.status < 500)).toBe(true);
      expect(results[0]!.status, JSON.stringify(results[0]!.body)).toBe(201);
      // Refused either by the single-use check (it waited on the decision row lock and then saw X's registered use) or by the
      // subject binding (it ran before X registered): both are documented refusals (decision-reliance.ts, check order).
      expect(results[1]!.status).toBe(422);
      expect(REFUSED).toContain(results[1]!.body.code);
      expect(await count(`select count(*)::int n from change_request where decision_id = $1 and status = 'approved'`, [d])).toBe(1);
      expect(await usesOf(d)).toEqual([{ use_kind: 'change_request', subject_id: x }]);
    }
  }, 900_000);

  it(`plain parallel ×${RUNS}: four change requests approved at once on the decision raised for one of them: only that one is approved`, async () => {
    for (let run = 0; run < RUNS; run++) {
      const ids = [];
      for (let i = 0; i < 4; i++) ids.push(await crConfirmed(`QA parallel ${run}-${i}`, '1200000.0000'));
      const d = await externallyApprovedFor({ subjectType: 'change_request', subjectId: ids[0]! });
      const versions = await Promise.all(ids.map((id) => crVersion(id)));
      const results = await Promise.all(ids.map((id, i) => approveCr(id, versions[i]!, d)));
      console.log(`QA-P2-01 final parallel run ${run + 1}: ${JSON.stringify(summary(results))}`);
      expect(results.every((r) => r.status < 500)).toBe(true);
      expect(results[0]!.status).toBe(201);
      for (const r of results.slice(1)) {
        expect(r.status).toBe(422);
        expect(REFUSED).toContain(r.body.code);
      }
      expect(await count(`select count(*)::int n from change_request where decision_id = $1 and status = 'approved'`, [d])).toBe(1);
      expect(await usesOf(d)).toHaveLength(1);
    }
  }, 900_000);

  it(`the same change request approved three times at once on its decision (plain ×${RUNS}, then forced): one approval, one use, the rest 409`, async () => {
    for (let run = 0; run <= RUNS; run++) {
      const x = await crConfirmed(`QA double ${run}`, '1200000.0000');
      const d = await externallyApprovedFor({ subjectType: 'change_request', subjectId: x });
      const v = await crVersion(x);
      const isForced = run === RUNS;
      const results = isForced ? (await forced(() => [approveCr(x, v, d), approveCr(x, v, d), approveCr(x, v, d)], 3)).results : await Promise.all([approveCr(x, v, d), approveCr(x, v, d), approveCr(x, v, d)]);
      console.log(`QA-P2-01 final same-CR ${isForced ? 'forced' : 'parallel'} run ${run + 1}: ${JSON.stringify(summary(results))}`);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409]);
      expect(await count(`select count(*)::int n from audit_event where action = 'planning.change_request.approve' and entity_id = $1 and outcome = 'success'`, [x])).toBe(1);
      expect(await usesOf(d)).toEqual([{ use_kind: 'change_request', subject_id: x }]);
    }
  }, 900_000);

  it(`change request + baseline on ONE decision at the same time (plain ×${RUNS}, then forced): the change is approved, the baseline refused and still proposed`, async () => {
    for (let run = 0; run <= RUNS; run++) {
      const x = await crConfirmed(`QA cr+baseline ${run}`, '1200000.0000');
      const d = await externallyApprovedFor({ subjectType: 'change_request', subjectId: x });
      const b = await ok<{ id: string; version: number }>(p.pm.post(`${P(pid)}/baselines`, { note: `QA final: baseline proposed for the race ${run} (synthetic)` }));
      const vx = await crVersion(x);
      const approveBaseline = (): Promise<Res> =>
        p.sponsor.post(`${P(pid)}/baselines/${b.id}/approve`, { expectedVersion: b.version, decisionId: d, note: 'QA final race probe (synthetic)' }).then((r) => ({ status: r.status, body: r.body }));
      const isForced = run === RUNS;
      const results = isForced ? (await forced(() => [approveCr(x, vx, d), approveBaseline()], 2)).results : await Promise.all([approveCr(x, vx, d), approveBaseline()]);
      console.log(`QA-P2-01 final cr+baseline ${isForced ? 'forced' : 'parallel'} run ${run + 1}: CR ${summary([results[0]!])} baseline ${summary([results[1]!])}`);
      expect(results.every((r) => r.status < 500)).toBe(true);
      expect(results[0]!.status, JSON.stringify(results[0]!.body)).toBe(201);
      expect(results[1]!.status).toBe(422);
      expect(String(results[1]!.body.code)).toMatch(/^change_control\.decision_(type_mismatch|other_subject)$/);
      const bl = (await owner().query(`select status, decision_id from baseline_version where id = $1`, [b.id])).rows[0];
      expect(bl).toEqual({ status: 'proposed', decision_id: null });
      expect(await usesOf(d)).toEqual([{ use_kind: 'change_request', subject_id: x }]);
      // One proposed baseline per project: reject it so the next run can propose again.
      await ok(p.sponsor.post(`${P(pid)}/baselines/${b.id}/reject`, { expectedVersion: b.version, reason: 'QA final: race baseline withdrawn (synthetic)' }));
    }
  }, 900_000);
});

describe('QA-P2-01 re-check — a G1 decision relied upon by a perimeter version and the G1 gate cycle at the same time [REQ-GOV-022, REQ-SET-012, REQ-LCY-010, AT-04]', () => {
  it('both kinds of use are accepted on one G1 decision (documented rule: one record of EACH kind); registered once each; a second decision attempt on the cycle is 409', async () => {
    // Perimeter version 1 proposed (one site), G0 approved, G1 ready for decision, a final G1 decision.
    const ws = await workstreamId(p.pm, pid, 'WS05');
    await createItem(p.pm, pid, { type: 'site', name: 'QA final site (synthetic)', disposition: 'included', workstreamId: ws, ownerUserId: p.pm.userId });
    const v1 = await ok<{ id: string; versionNo: number }>(p.pm.post(`${P(pid)}/setup/steps/perimeter`, { note: 'QA final: perimeter version for the race (synthetic)' }));
    const g0 = await gateByKey(p.pm, pid, 'G0');
    if (g0.assessment.status !== 'approved') await approveGate(p, gov, pid, 'G0');
    await makeReady(p, pid, 'G1');
    const d = await gateDecision(pid, p, gov, 'G1');
    expect(d.status).toBe('approved');
    const g1 = await gateByKey(p.pm, pid, 'G1');
    const pvVersion = (await owner().query(`select version from perimeter_version where id = $1`, [v1.id])).rows[0].version as number;
    const approvePv = (): Promise<Res> =>
      p.sponsor.post(`${P(pid)}/perimeter/versions/${v1.id}/approve`, { expectedVersion: pvVersion, decisionId: d.id, note: 'QA final race (synthetic)' }).then((r) => ({ status: r.status, body: r.body }));
    const decideG1 = (): Promise<Res> =>
      p.chair.post(`${P(pid)}/gates/${g1.id}/assessment/decide`, { expectedVersion: g1.assessment.version, outcome: 'approve', decisionId: d.id, note: 'QA final race (synthetic)' }).then((r) => ({ status: r.status, body: r.body }));
    const { results, waiting } = await forced(() => [approvePv(), decideG1(), decideG1()], 3);
    console.log(`QA-P2-01 final perimeter+gate forced: waiting ${waiting}; perimeter ${summary([results[0]!])} gate ${JSON.stringify(summary(results.slice(1)))}`);
    expect(results.every((r) => r.status < 500)).toBe(true);
    expect(results[0]!.status, JSON.stringify(results[0]!.body)).toBe(201);
    expect(results.slice(1).map((r) => r.status).sort()).toEqual([201, 409]);
    const uses = await usesOf(d.id);
    expect(uses.map((u) => u.use_kind)).toEqual(['gate_cycle', 'perimeter_version']);
    expect(uses.find((u) => u.use_kind === 'perimeter_version')!.subject_id).toBe(v1.id);
    expect(uses.find((u) => u.use_kind === 'gate_cycle')!.subject_id).toBe(g1.assessment.id);
  }, 900_000);
});

describe('QA-P2F-02 — a request that waits longer than the lock timeout gets a retryable problem, never 500 [REQ-DAT-017, AT-16]', () => {
  // QA-P2F-02 (docs/reviews/P2-qa-final-review.md, Low): PostgreSQL 55P03 lock_not_available (lock_timeout, 10 s by default)
  // and 57014 query_canceled (statement_timeout) are not mapped by platform/errors.ts `fromPg`, so the client gets
  // 500 internal_error. Recorded with `it.fails` until fixed; then drop `.fails`.
  it.fails('an approval blocked for longer than lock_timeout is answered 409/503 with a problem code, and nothing is applied', async () => {
    const x = await crConfirmed('QA lock timeout', '0.0000');
    const v = await crVersion(x);
    const locker = await owner().connect();
    let r: Res;
    try {
      await locker.query('begin');
      await locker.query('lock table outbox_event in share row exclusive mode');
      const pending = p.sponsor.post(`${P(pid)}/change-requests/${x}/approve`, { expectedVersion: v, note: 'QA lock timeout probe (synthetic)' }).then((res) => ({ status: res.status, body: res.body }));
      await new Promise((res) => setTimeout(res, 11_500));
      await locker.query('commit');
      r = await pending;
    } finally {
      locker.release();
    }
    console.log(`QA-P2F-02 probe: approval blocked > lock_timeout → ${r.status} ${String(r.body.code)}`);
    expect((await owner().query(`select status from change_request where id = $1`, [x])).rows[0].status).toBe('under_review');
    expect([409, 503]).toContain(r.status);
  }, 120_000);
});

