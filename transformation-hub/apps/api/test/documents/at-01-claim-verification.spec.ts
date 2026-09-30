import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApp, closePools, DC, loginAs, owner, projectIdByCode, Client } from '../helpers';
import { createProject, grant, task, workstreams } from '../planning/fixtures';

/**
 * AT-01 invariants (DOM-P2-04) and two-sided claim conflicts (DOM-P2-19) on an isolated, synthetic project.
 *  - A historical-unverified claim never becomes "confirmed" by a status change alone — not directly, not by hopping
 *    through proposed / assumed. It is confirmed only with verification evidence from a DIFFERENT source of the project,
 *    by a verifier who is neither its extractor nor the reviewer of its previous step. Nothing is applied automatically.
 *  - A claim reviewed as conflicting with another claim flags BOTH (AT-14, REQ-SRC-007); the counterpart keeps what it
 *    said and its confirmed value; its pending "apply" proposal is invalidated.
 */
let pid: string;
let admin: Client;
let pm: Client;
let finance: Client;
let legal: Client;
let secretary: Client;
let taskId: string;
let historicalSource: string;
let minutesSource: string;

const S = (p: string) => `/api/v1/projects/${p}/sources`;
const C = (p: string) => `/api/v1/projects/${p}/claims`;
const claimRow = async (id: string) => (await owner().query(`select verification_status, origin_status, verification_source_id, confirmed_value, conflict_with_claim_id, reviewer_user_id, version from source_claim where id = $1`, [id])).rows[0];
const newClaim = async (sourceId: string, over: Record<string, unknown> = {}) => {
  const r = await pm.post(`${S(pid)}/${sourceId}/claims`, {
    location: 'Sheet "Tracker" row 4 (synthetic)',
    subject: 'Status of the synthetic task',
    targetType: 'task',
    targetId: taskId,
    field: 'status',
    extractedValue: 'done',
    sourceReportedValue: 'Completed',
    verificationStatus: 'historical_unverified',
    ...over,
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.id as string;
};

beforeAll(async () => {
  admin = await loginAs('portfolio.admin');
  pm = await loginAs('pm');
  finance = await loginAs('finance');
  legal = await loginAs('legal');
  secretary = await loginAs('secretary');
  pid = await createProject(admin, pm, 'CLM-P2FX');
  await grant(admin, pid, finance, 'finance_restricted');
  await grant(admin, pid, legal, 'legal_restricted');
  await grant(admin, pid, secretary, 'secretary_cpmo');
  taskId = await task(pm, pid, (await workstreams(pm, pid)).get('WS01')!.id, 'Claim target task (synthetic)', { durationDays: 3 });
  historicalSource = (await pm.post(S(pid), { sourceType: 'image', filename: 'old-status-slide.jpeg', extractionStatus: 'partial', classification: 'internal' }).expect(201)).body.id;
  minutesSource = (await pm.post(S(pid), { sourceType: 'minutes', filename: 'approved-minutes-synthetic.pdf', extractionStatus: 'performed', classification: 'internal' }).expect(201)).body.id;
}, 300_000);
afterAll(async () => {
  await closeApp();
  await closePools();
});

describe('AT-01 — a historical claim is never confirmed by status hopping; only a different verifier with a newer source confirms it [REQ-SRC-003, REQ-SRC-004, REQ-SRC-007, DOM-P2-04]', () => {
  let h: string;

  it('proposed → confirmed without verification evidence is refused; the origin stays historical', async () => {
    h = await newClaim(historicalSource);
    const step1 = await finance.post(`${C(pid)}/${h}/review`, { expectedVersion: 1, verificationStatus: 'proposed', note: 'Reclassified (synthetic)' });
    expect(step1.status, JSON.stringify(step1.body)).toBe(201);
    const step2 = await finance.post(`${C(pid)}/${h}/review`, { expectedVersion: step1.body.version, verificationStatus: 'confirmed', confirmedValue: 'done' });
    expect(step2.status).toBe(422);
    expect(step2.body.code).toBe('claims.historical_cannot_be_confirmed');
    expect(await claimRow(h)).toMatchObject({ verification_status: 'proposed', origin_status: 'historical_unverified', confirmed_value: null });
    const detail = await pm.get(`${S(pid)}/${historicalSource}`).expect(200);
    expect(detail.body.claims.find((c: { id: string }) => c.id === h)).toMatchObject({ verificationStatus: 'proposed', originStatus: 'historical_unverified', verificationSourceId: null });
    // Still not applicable: it is not confirmed (and its origin is historical).
    expect((await pm.post(`${C(pid)}/${h}/propose-change`, { expectedVersion: step1.body.version })).status).toBe(422);
  });

  it('hopping through "assumed" does not help either', async () => {
    const h2 = await newClaim(historicalSource, { location: 'Sheet "Tracker" row 5 (synthetic)' });
    const a = await finance.post(`${C(pid)}/${h2}/review`, { expectedVersion: 1, verificationStatus: 'assumed' }).expect(201);
    const r = await legal.post(`${C(pid)}/${h2}/review`, { expectedVersion: a.body.version, verificationStatus: 'confirmed', confirmedValue: 'done' });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('claims.historical_cannot_be_confirmed');
    expect((await claimRow(h2)).verification_status).toBe('assumed');
  });

  it('the reviewer of the previous step cannot verify it; the claim\'s own source is not verification; another project\'s source is invisible (404)', async () => {
    const v = (await claimRow(h)).version as number;
    const sameReviewer = await finance.post(`${C(pid)}/${h}/review`, { expectedVersion: v, verificationStatus: 'confirmed', confirmedValue: 'done', verificationSourceId: minutesSource });
    expect(sameReviewer.status).toBe(403);
    expect(sameReviewer.body.code).toBe('claims.verifier_is_previous_reviewer');
    const ownSource = await legal.post(`${C(pid)}/${h}/review`, { expectedVersion: v, verificationStatus: 'confirmed', confirmedValue: 'done', verificationSourceId: historicalSource });
    expect(ownSource.status).toBe(422);
    expect(ownSource.body.code).toBe('claims.verification_source_same');
    const dcId = await projectIdByCode(DC);
    const foreign = (await owner().query(`select id from source_record where project_id = $1 limit 1`, [dcId])).rows[0].id as string;
    expect((await legal.post(`${C(pid)}/${h}/review`, { expectedVersion: v, verificationStatus: 'confirmed', confirmedValue: 'done', verificationSourceId: foreign })).status).toBe(404);
    const onlyWhenConfirming = await legal.post(`${C(pid)}/${h}/review`, { expectedVersion: v, verificationStatus: 'unknown', verificationSourceId: minutesSource });
    expect(onlyWhenConfirming.status).toBe(422);
    expect(onlyWhenConfirming.body.code).toBe('claims.verification_source_unexpected');
    expect(await claimRow(h)).toMatchObject({ verification_status: 'proposed', verification_source_id: null, version: v });
  });

  it('a different verifier citing the newer minutes confirms it; the value is only PROPOSED to the record owner (AT-01)', async () => {
    const v = (await claimRow(h)).version as number;
    const ok = await legal.post(`${C(pid)}/${h}/review`, { expectedVersion: v, verificationStatus: 'confirmed', confirmedValue: 'done', verificationSourceId: minutesSource, note: 'Verified against the approved minutes (synthetic)' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(await claimRow(h)).toMatchObject({ verification_status: 'confirmed', origin_status: 'historical_unverified', verification_source_id: minutesSource, confirmed_value: 'done' });
    const before = (await owner().query(`select status, version from task where id = $1`, [taskId])).rows[0];
    const prop = await pm.post(`${C(pid)}/${h}/propose-change`, { expectedVersion: ok.body.version });
    expect(prop.status, JSON.stringify(prop.body)).toBe(201);
    expect(prop.body).toMatchObject({ status: 'pending', proposedValue: 'done' });
    expect((await owner().query(`select status, version from task where id = $1`, [taskId])).rows[0]).toEqual(before);
    const audit = await owner().query(`select after from audit_event where project_id = $1 and action = 'documents.claim.review' and entity_id = $2 order by seq desc limit 1`, [pid, h]);
    expect(audit.rows[0].after).toMatchObject({ verificationStatus: 'confirmed', verificationSourceId: minutesSource });
  });
});

describe('AT-14 — a conflicting claim is flagged on BOTH sides and the originals are preserved [REQ-SRC-007, DOM-P2-19]', () => {
  it('the counterpart becomes conflicting too, keeps its confirmed value, and its pending proposal is invalidated', async () => {
    const a = await newClaim(minutesSource, { verificationStatus: 'proposed', extractedValue: 'in_progress', sourceReportedValue: 'In progress', location: 'Minutes §2 (synthetic)' });
    const ac = await legal.post(`${C(pid)}/${a}/review`, { expectedVersion: 1, verificationStatus: 'confirmed', confirmedValue: 'in_progress' }).expect(201);
    const prop = (await pm.post(`${C(pid)}/${a}/propose-change`, { expectedVersion: ac.body.version }).expect(201)).body.proposalId as string;
    const b = await newClaim(minutesSource, { verificationStatus: 'proposed', extractedValue: 'blocked', sourceReportedValue: 'Blocked', location: 'Minutes §5 (synthetic)' });
    const r = await finance.post(`${C(pid)}/${b}/review`, { expectedVersion: 1, verificationStatus: 'conflicting', conflictWithClaimId: a, note: 'Minutes §2 and §5 disagree (synthetic)' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(await claimRow(b)).toMatchObject({ verification_status: 'conflicting', conflict_with_claim_id: a });
    expect(await claimRow(a)).toMatchObject({ verification_status: 'conflicting', conflict_with_claim_id: b, confirmed_value: 'in_progress', reviewer_user_id: finance.userId });
    const ext = (await owner().query(`select extracted_value, source_reported_value from source_claim where id = $1`, [a])).rows[0];
    expect(ext).toEqual({ extracted_value: 'in_progress', source_reported_value: 'In progress' });
    expect((await owner().query(`select status from approval_request where id = $1`, [prop])).rows[0].status).toBe('invalidated');
    const audit = await owner().query(`select actor_user_id, after from audit_event where project_id = $1 and action = 'documents.claim.conflict' and entity_id = $2`, [pid, a]);
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]).toMatchObject({ actor_user_id: finance.userId, after: { verificationStatus: 'conflicting', conflictWithClaimId: b } });
    // A confirmed-then-conflicting claim can no longer be applied.
    expect((await pm.post(`${C(pid)}/${a}/propose-change`, { expectedVersion: (await claimRow(a)).version })).status).toBe(422);
  });

  it('the counterpart is re-classified under separation of duties: its own extractor cannot flag it (403, nothing changes)', async () => {
    const c = (await secretary.post(`${S(pid)}/${minutesSource}/claims`, { location: 'Minutes §7 (synthetic)', subject: 'Secretariat extract', extractedValue: 'x', verificationStatus: 'proposed' }).expect(201)).body.id as string;
    const d = await newClaim(minutesSource, { verificationStatus: 'proposed', location: 'Minutes §8 (synthetic)' });
    const r = await secretary.post(`${C(pid)}/${d}/review`, { expectedVersion: 1, verificationStatus: 'conflicting', conflictWithClaimId: c });
    expect(r.status).toBe(403);
    expect(await claimRow(c)).toMatchObject({ verification_status: 'proposed', conflict_with_claim_id: null });
    expect(await claimRow(d)).toMatchObject({ verification_status: 'proposed', conflict_with_claim_id: null });
  });
});
