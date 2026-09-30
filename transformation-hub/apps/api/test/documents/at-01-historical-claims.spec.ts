import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApp, closePools, DC, owner, projectIdByCode } from '../helpers';
import { login, DocClient } from './doc-helpers';

let dcId: string;
let pm: DocClient;
let finance: DocClient;
let imageSourceId: string;

const IMAGE = 'IMG_B65D893D-6B73-4D57-85DF-6B72BA10C15D.jpeg';
const sourcesPath = (pid: string) => `/api/v1/projects/${pid}/sources`;
const claimsPath = (pid: string) => `/api/v1/projects/${pid}/claims`;

async function snapshotStatuses() {
  const tasks = await owner().query('select id, status, planned_finish from task where project_id = $1 order by id', [dcId]);
  const proj = await owner().query('select status, version from project where id = $1', [dcId]);
  const ms = await owner().query('select id, status from milestone where project_id = $1 order by id', [dcId]);
  return JSON.stringify({ tasks: tasks.rows, proj: proj.rows, ms: ms.rows });
}

beforeAll(async () => {
  dcId = await projectIdByCode(DC);
  pm = await login('pm');
  finance = await login('finance');
});
afterAll(async () => {
  await closeApp();
  await closePools();
});

describe('AT-01 — historical Completed/On Track statuses stay historical-unverified and never update current status [REQ-SRC-001, REQ-SRC-003, REQ-SRC-004, REQ-SRC-005, REQ-SRC-006, REQ-SRC-007, REQ-SRC-008, REQ-INT-005]', () => {
  it('the source register records the unavailable image with extraction NOT performed and dates kept separate', async () => {
    const list = await pm.get(sourcesPath(dcId)).expect(200);
    const src = list.body.items.find((s: { filename: string }) => s.filename === IMAGE);
    expect(src).toBeTruthy();
    imageSourceId = src.id;
    expect(src).toMatchObject({ sourceType: 'image', extractionStatus: 'not_performed', reportDate: null, asOfDate: null, extractionDate: null, checksum: null, isDemo: true, claimCount: 10 });
    expect(src.extractionNote).toMatch(/not available/i);
    const detail = await pm.get(`${sourcesPath(dcId)}/${imageSourceId}`).expect(200);
    const bySubject = (p: string) => detail.body.claims.find((c: { subject: string }) => c.subject.startsWith(p));
    expect(bySubject('CLM-009')).toMatchObject({ verificationStatus: 'historical_unverified', extractedValue: 'Completed; On Track', confirmedValue: null, appliedToRecord: false, targetType: null });
    expect(bySubject('CLM-009').sourceReportedValue).toMatch(/Completed.*On Track/);
    expect(bySubject('CLM-010')).toMatchObject({ verificationStatus: 'unknown' });
    expect(detail.body.claims.filter((c: { verificationStatus: string }) => c.verificationStatus === 'confirmed')).toHaveLength(0);
  });

  it('applying the historical claim is refused and audited; confirming it as current is refused; nothing changes', async () => {
    const before = await snapshotStatuses();
    const detail = await pm.get(`${sourcesPath(dcId)}/${imageSourceId}`).expect(200);
    const clm9 = detail.body.claims.find((c: { subject: string }) => c.subject.startsWith('CLM-009'));
    const apply = await pm.post(`${claimsPath(dcId)}/${clm9.id}/propose-change`, { expectedVersion: clm9.version });
    expect(apply.status).toBe(422);
    expect(apply.body.code).toBe('claims.historical_not_applicable');
    const audit = await owner().query(`select count(*)::int n from audit_event where entity_id = $1 and outcome = 'rejected' and action = 'documents.claim.propose_change'`, [clm9.id]);
    expect(audit.rows[0].n).toBe(1);
    const confirm = await finance.post(`${claimsPath(dcId)}/${clm9.id}/review`, { expectedVersion: clm9.version, verificationStatus: 'confirmed', confirmedValue: 'Completed' });
    expect(confirm.status).toBe(422);
    expect(confirm.body.code).toBe('claims.historical_cannot_be_confirmed');
    expect(await snapshotStatuses()).toBe(before);
    const claimRow = await owner().query('select verification_status, applied_to_record, confirmed_value from source_claim where id = $1', [clm9.id]);
    expect(claimRow.rows[0]).toEqual({ verification_status: 'historical_unverified', applied_to_record: false, confirmed_value: null });
    const proposals = await owner().query(`select count(*)::int n from approval_request where action = 'documents.claim.apply' and payload->>'claimId' = $1`, [clm9.id]);
    expect(proposals.rows[0].n).toBe(0);
  });

  it('an item-level "Completed" claim is compared side-by-side but never applied to the task', async () => {
    const task = (await owner().query('select id, status from task where project_id = $1 order by wbs_code limit 1', [dcId])).rows[0];
    const src = await pm.post(sourcesPath(dcId), { sourceType: 'excel', filename: 'demo-tracker-extract.xlsx', ownerLabel: 'Demo PMO (synthetic)', reportDate: '2026-06-30', asOfDate: '2026-06-15', extractionDate: '2026-09-29', extractionStatus: 'partial', supersedesSourceId: imageSourceId }).expect(201);
    const claim = await pm.post(`${sourcesPath(dcId)}/${src.body.id}/claims`, {
      location: 'Sheet "Tracker" row 7 (synthetic)',
      subject: 'CLM-009 — Historical statuses shown in the image',
      targetType: 'task',
      targetId: task.id,
      field: 'status',
      extractedValue: 'Completed',
      sourceReportedValue: 'Completed',
      confidence: '0.4',
      verificationStatus: 'historical_unverified',
    }).expect(201);
    const cmp = await pm.get(`${sourcesPath(dcId)}/${src.body.id}/compare`).expect(200);
    const row = cmp.body.rows.find((r: { claimId: string }) => r.claimId === claim.body.id);
    expect(row).toMatchObject({ currentValue: task.status, claimValue: 'Completed', differs: true, applicable: false, verificationStatus: 'historical_unverified', previousSourceValue: 'Completed; On Track' });
    expect(cmp.body.previousSourceId).toBe(imageSourceId);
    const apply = await pm.post(`${claimsPath(dcId)}/${claim.body.id}/propose-change`, { expectedVersion: 1 });
    expect(apply.status).toBe(422);
    const now = await owner().query('select status from task where id = $1', [task.id]);
    expect(now.rows[0].status).toBe(task.status);
    // The previous source is preserved and linked to its successor; it cannot be superseded twice.
    const prev = await pm.get(`${sourcesPath(dcId)}/${imageSourceId}`).expect(200);
    expect(prev.body.supersededBySourceId).toBe(src.body.id);
    expect(prev.body.claims).toHaveLength(10);
    const twice = await pm.post(sourcesPath(dcId), { sourceType: 'excel', extractionStatus: 'not_performed', supersedesSourceId: imageSourceId });
    expect(twice.status).toBe(409);
  });

  it('claims can never be created as confirmed; only a different reviewer can confirm a non-historical claim', async () => {
    const bad = await pm.post(`${sourcesPath(dcId)}/${imageSourceId}/claims`, { location: 'x', subject: 'x', extractedValue: 'x', verificationStatus: 'confirmed' });
    expect(bad.status).toBe(400);
    const task = (await owner().query('select id, planned_finish from task where project_id = $1 order by wbs_code limit 1', [dcId])).rows[0];
    const c = await pm.post(`${sourcesPath(dcId)}/${imageSourceId}/claims`, { location: 'Demo minutes §3 (synthetic)', subject: 'Planned finish of the first task', targetType: 'task', targetId: task.id, field: 'plannedFinish', extractedValue: '2027-01-31', verificationStatus: 'proposed' }).expect(201);
    const self = await pm.post(`${claimsPath(dcId)}/${c.body.id}/review`, { expectedVersion: 1, verificationStatus: 'confirmed', confirmedValue: '2027-01-31' });
    expect(self.status).toBe(403); // the PM holds no claim.verify; the author could never self-confirm
    const noValue = await finance.post(`${claimsPath(dcId)}/${c.body.id}/review`, { expectedVersion: 1, verificationStatus: 'confirmed' });
    expect(noValue.status).toBe(422);
    const ok = await finance.post(`${claimsPath(dcId)}/${c.body.id}/review`, { expectedVersion: 1, verificationStatus: 'confirmed', confirmedValue: '2027-01-31', note: 'Demo review' }).expect(201);
    expect(ok.body.verificationStatus).toBe('confirmed');
    const before = await snapshotStatuses();
    const p = await pm.post(`${claimsPath(dcId)}/${c.body.id}/propose-change`, { expectedVersion: ok.body.version, note: 'Demo proposal' }).expect(201);
    expect(p.body).toMatchObject({ status: 'pending', targetType: 'task', targetId: task.id, field: 'plannedFinish', proposedValue: '2027-01-31', requiredPermission: 'planning.task.manage' });
    expect(p.body.message).toMatch(/No record was changed/);
    expect(await snapshotStatuses()).toBe(before); // a PROPOSAL only — the task is untouched
    const req = await owner().query('select status, subject_type, subject_id, requested_by from approval_request where id = $1', [p.body.proposalId]);
    expect(req.rows[0]).toEqual({ status: 'pending', subject_type: 'task', subject_id: task.id, requested_by: pm.userId });
    const again = await pm.post(`${claimsPath(dcId)}/${c.body.id}/propose-change`, { expectedVersion: ok.body.version });
    expect(again.status).toBe(422);
    expect(again.body.code).toBe('claims.proposal_pending');
    const detail = await pm.get(`${sourcesPath(dcId)}/${imageSourceId}`).expect(200);
    expect(detail.body.claims.find((x: { id: string }) => x.id === c.body.id)).toMatchObject({ pendingProposalId: p.body.proposalId, appliedToRecord: false });
  });

  it('claim targets must be records of the same project and allowlisted fields', async () => {
    const foreign = (await owner().query(`select t.id from task t join project p on p.id = t.project_id where p.code = 'DEMO-TRANSFORM' limit 1`)).rows[0].id;
    const r = await pm.post(`${sourcesPath(dcId)}/${imageSourceId}/claims`, { location: 'x', subject: 'x', targetType: 'task', targetId: foreign, field: 'status', extractedValue: 'Completed', verificationStatus: 'historical_unverified' });
    expect(r.status).toBe(404);
    const task = (await owner().query('select id from task where project_id = $1 limit 1', [dcId])).rows[0].id;
    const f = await pm.post(`${sourcesPath(dcId)}/${imageSourceId}/claims`, { location: 'x', subject: 'x', targetType: 'task', targetId: task, field: 'accountableUserId', extractedValue: 'x', verificationStatus: 'proposed' });
    expect(f.status).toBe(422);
    expect(f.body.code).toBe('claims.field_unsupported');
  });

  it('claim corrections never rewrite what the source said, and confirmed claims are locked', async () => {
    const detail = await pm.get(`${sourcesPath(dcId)}/${imageSourceId}`).expect(200);
    const clm9 = detail.body.claims.find((c: { subject: string }) => c.subject.startsWith('CLM-009'));
    // REQ-DAT-013: the PATCH body is strict — a correction that also tries to rewrite the extracted value or the verification
    // status is refused as a whole (400; it used to be accepted with those fields stripped) and changes nothing.
    const refused = await pm.patch(`${claimsPath(dcId)}/${clm9.id}`, { expectedVersion: clm9.version, location: 'Master prompt §2, paragraph 2 (second-hand)', extractedValue: 'On Track', verificationStatus: 'confirmed' });
    expect(refused.status).toBe(400);
    expect(refused.body.code).toBe('validation_failed');
    expect((await owner().query('select location, version from source_claim where id = $1', [clm9.id])).rows[0]).toMatchObject({ version: clm9.version });
    const r = await pm.patch(`${claimsPath(dcId)}/${clm9.id}`, { expectedVersion: clm9.version, location: 'Master prompt §2, paragraph 2 (second-hand)' }).expect(200);
    const row = (await owner().query('select location, extracted_value, verification_status, version from source_claim where id = $1', [clm9.id])).rows[0];
    expect(row).toMatchObject({ location: 'Master prompt §2, paragraph 2 (second-hand)', extracted_value: 'Completed; On Track', verification_status: 'historical_unverified', version: r.body.version });
    const confirmed = detail.body.claims.find((c: { verificationStatus: string }) => c.verificationStatus === 'confirmed');
    const locked = await pm.patch(`${claimsPath(dcId)}/${confirmed.id}`, { expectedVersion: confirmed.version, subject: 'x' });
    expect(locked.status).toBe(422);
    expect(locked.body.code).toBe('claims.locked_after_confirmation');
  });
});
